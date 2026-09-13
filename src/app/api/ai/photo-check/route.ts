import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readBody } from '@/lib/bp-server-utils'
import { bpVisionCompleteMulti, extractJson } from '@/lib/bp-ai'
import { attachmentDataUrls, bindAttachments, toAttachmentDto } from '@/lib/bp-attachments'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const SCENE_META: Record<string, { label: string; baseLabel: string; checkLabel: string }> = {
  BRIEFING_VS_SURVEY: { label: '交底照片 vs 勘察照片', baseLabel: '勘察基准照', checkLabel: '交底现场照' },
  EXECUTION_VS_BRIEFING: { label: '作业照片 vs 交底照片', baseLabel: '交底基准照', checkLabel: '作业现场照' },
  ACCEPTANCE_VS_EXEC: { label: '验收照片 vs 作业/交底照片', baseLabel: '作业基准照', checkLabel: '验收现场照' },
}

export interface PhotoCheckPayload {
  result: 'CONSISTENT' | 'INCONSISTENT' | 'UNCERTAIN'
  confidence: number
  reason: string
  detail: Array<{ image: number; observation: string; matchesBase: boolean }>
}

function buildSystemPrompt(scene: string): string {
  const meta = SCENE_META[scene] ?? SCENE_META.BRIEFING_VS_SURVEY
  return `你是石化企业盲板抽堵作业的位置安全核对 AI。任务：判断多张「${meta.checkLabel}」是否与「${meta.baseLabel}」拍摄于同一作业位置（同一设备/管线/法兰区域）。
输入图片顺序：前若干张为${meta.baseLabel}（位置基准），其余为${meta.checkLabel}（待核对）。
【核对特征清单】逐项对比：①设备位号牌/编号文字；②管线走向、口径与保温/涂装；③法兰、阀门、螺栓等部件特征；④背景构筑物（塔器/储罐/泵房/管廊）；⑤地面与周边环境。
【判定规则（严格执行）】
1. 待核对图与基准图在上述特征中有两项以上明确对应（同一设备、同一管线段、同一区域），即使拍摄角度/距离/平移不同、局部被遮挡 → result 必须为 CONSISTENT；
2. 仅当照片模糊、无法辨认任何共同特征、或确实信息不足时 → UNCERTAIN（角度差异和遮挡不算信息不足）；
3. 出现明确冲突特征（明显是不同设备/不同管线区域/不同车间）→ INCONSISTENT；
4. confidence 反映你判定的把握，与 result 保持一致（同一区域判定不要低于 80）。
必须只输出 JSON（不要输出任何其他文字）：
{"result":"CONSISTENT|INCONSISTENT|UNCERTAIN","confidence":0到100的整数,"reason":"一句话判定理由（中文，点名对应或冲突的特征）","detail":[{"image":2,"observation":"该图可见的位置特征（中文简短）","matchesBase":true或false}]}
其中 image 为该图在全部输入图片中的序号（从 1 开始，含基准图）。detail 覆盖全部待核对图（不含基准图）。`
}

/** 解析各 scene 的默认照片集（base/check 未显式给定时自动回源） */
async function resolveScenePhotos(scene: string, workRequestId: number, ticketId: number | null, briefingId: number | null) {
  // 交底照片 bizId=briefing.id（创建交底时绑定），需先按票/需求定位交底记录
  const briefingIdsOf = async () => {
    const rows = await db.briefing.findMany({
      where: ticketId ? { ticketId } : { workRequestId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    return rows.map((b) => b.id)
  }
  const photosOf = (bizType: string, ids: number[]) =>
    ids.length
      ? db.attachment.findMany({ where: { bizType, kind: 'PHOTO', bizId: { in: ids } }, orderBy: { createdAt: 'asc' } })
      : Promise.resolve([])
  if (scene === 'BRIEFING_VS_SURVEY') {
    const survey = await db.siteSurvey.findUnique({ where: { workRequestId } })
    const base = survey
      ? await db.attachment.findMany({ where: { bizType: 'SITE_SURVEY', bizId: survey.id, kind: 'PHOTO' }, orderBy: { createdAt: 'asc' } })
      : []
    // 明确传了 briefingId → 只核本次交底的照片（历史交底照片混入会稀释核对语义并诱发模型输出漂移）；
    // 未传时（老客户端/兜底）保留按票回源全部交底照片
    const check = briefingId
      ? await db.attachment.findMany({ where: { bizType: 'BRIEFING', kind: 'PHOTO', bizId: briefingId }, orderBy: { createdAt: 'asc' } })
      : await photosOf('BRIEFING', await briefingIdsOf())
    return { base, check }
  }
  if (scene === 'EXECUTION_VS_BRIEFING') {
    const base = await photosOf('BRIEFING', await briefingIdsOf())
    const check = await photosOf('EXECUTION', ticketId ? [ticketId] : [])
    return { base, check }
  }
  // ACCEPTANCE_VS_EXEC：基准=作业照片（无则回退交底照片），待核对=验收照片（bizId=acceptance.id；验收记录未建时回退 bizCode 占位照片）
  const exec = await photosOf('EXECUTION', ticketId ? [ticketId] : [])
  let base = exec
  if (!base.length) base = await photosOf('BRIEFING', await briefingIdsOf())
  const acceptance = await db.acceptance.findUnique({ where: { workRequestId } })
  let check = acceptance ? await photosOf('ACCEPTANCE', [acceptance.id]) : []
  if (!check.length) {
    const req = await db.workRequest.findUnique({ where: { id: workRequestId }, select: { code: true } })
    check = await db.attachment.findMany({
      where: { bizType: 'ACCEPTANCE', kind: 'PHOTO', bizId: null, bizCode: req?.code },
      orderBy: { createdAt: 'asc' },
    })
  }
  return { base, check }
}

/** 归一化结果枚举：容忍模型输出中文同义词（实测 DeepSeek 视觉通道会输出 "result":"一致" 而非 CONSISTENT，
 *  旧逻辑把无法识别的值静默归 UNCERTAIN → 造成「照片明明一致却判不通过」。无法识别返回 null） */
function parseResult(r: unknown): 'CONSISTENT' | 'INCONSISTENT' | 'UNCERTAIN' | null {
  const s = String(r ?? '').trim().toUpperCase()
  if (s === 'CONSISTENT' || s === 'INCONSISTENT' || s === 'UNCERTAIN') return s
  // 中文输出：先判否定/冲突再判肯定（「不一致」包含「一致」子串）
  if (/不一致|不符|不同|冲突|并非同一|不属于同一|不同位置|不匹配/.test(s)) return 'INCONSISTENT'
  if (/一致|相同|同一|匹配|完全相同/.test(s)) return 'CONSISTENT'
  if (/不确定|无法确定|无法判断|信息不足|模糊/.test(s)) return 'UNCERTAIN'
  return null
}

/** 模型理由是否明确断定同一位置（用于调和自相矛盾输出） */
function assertSame(reason: unknown): boolean {
  const s = String(reason ?? '')
  return /(同一作业位置|同一作业区域|同一位置|同一区域|完全一致|属于同一|确认为同一)/.test(s)
}

/** 同内容照片去重（多轮重传同一文件会产生多份拷贝；fileName+size 定内容，storageKey 每次上传唯一不可用） */
function dedupePhotos<T extends { fileName: string | null; size: number }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((a) => {
    const key = `${a.fileName ?? ''}|${a.size}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 单次多图 VLM 调用 + JSON 解析（失败返回 null）
 *  严格校验：result 必须可归一化且 reason 非空——否则视为无效响应（模型偶发输出残缺 JSON，
 *  若放行会入库 conf=0/reason=null 的无理由「无法确定」，用户无法理解）。返回时 result 已归一化 */
async function callVisionOnce(prompt: string, images: string[]): Promise<PhotoCheckPayload | null> {
  const text = await bpVisionCompleteMulti(prompt, images)
  const parsed = extractJson<PhotoCheckPayload>(text)
  const result = parsed ? parseResult(parsed.result) : null
  const reasonOk = !!parsed && String(parsed.reason ?? '').trim().length > 0
  return parsed && result && reasonOk ? { ...parsed, result } : null
}

/**
 * POST /api/ai/photo-check — 照片位置 AI 核对
 * body: { scene, workRequestId, ticketId?, baseIds?, checkIds?, briefingId?, attachmentIds?(绑定到核对), __actorId/__actorName }
 * 返回 PhotoCheck 记录；BRIEFING_VS_SURVEY 同时回写 briefing.aiCheckResult
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const scene = String(body.scene || '')
    if (!SCENE_META[scene]) return jsonError(`scene 无效（允许：${Object.keys(SCENE_META).join('/')}）`)
    const workRequestId = Number(body.workRequestId)
    if (!workRequestId) return jsonError('缺少 workRequestId')
    const ticketId = body.ticketId ? Number(body.ticketId) : null

    // 可选显式指定照片集，否则按 scene 自动回源（briefingId 用于交底场景精确限定本次照片）
    const briefingId = body.briefingId ? Number(body.briefingId) : null
    let baseRows = body.baseIds?.length
      ? await db.attachment.findMany({ where: { id: { in: body.baseIds }, kind: 'PHOTO' } })
      : (await resolveScenePhotos(scene, workRequestId, ticketId, briefingId)).base
    let checkRows = body.checkIds?.length
      ? await db.attachment.findMany({ where: { id: { in: body.checkIds }, kind: 'PHOTO' } })
      : (await resolveScenePhotos(scene, workRequestId, ticketId, briefingId)).check

    // 交底场景支持「本次新上传的照片先绑定再核对」
    if (Array.isArray(body.attachmentIds) && body.attachmentIds.length && ticketId) {
      await bindAttachments(body.attachmentIds, 'BRIEFING', ticketId, null, String(body.pointCode || '') || null)
      checkRows = await db.attachment.findMany({ where: { id: { in: body.attachmentIds }, kind: 'PHOTO' } })
    }
    // 同内容拷贝去重：多轮交底重传同一照片/单次误传重复图会产生多份同文件附件，
    // 重复图会稀释 VLM 注意力并诱发输出漂移（实测同一张图 ×4 输入导致残缺 JSON）
    baseRows = dedupePhotos(baseRows)
    checkRows = dedupePhotos(checkRows)
    if (!baseRows.length) return jsonError('缺少基准照片（如勘察/交底照片），无法核对', 422)
    if (!checkRows.length) return jsonError('缺少待核对照片，请先拍摄现场照片', 422)

    const baseUrls = await attachmentDataUrls(baseRows.map((a) => a.id))
    const checkUrls = await attachmentDataUrls(checkRows.map((a) => a.id))
    const usableBase = baseUrls.filter((u): u is string => !!u)
    const usableCheck = checkUrls.filter((u): u is string => !!u)
    if (!usableBase.length || !usableCheck.length) return jsonError('照片文件读取失败（可能已丢失），无法核对', 422)

    const prompt = buildSystemPrompt(scene)
    const images = [...usableBase, ...usableCheck]
    let parsed = await callVisionOnce(prompt, images)
    if (!parsed) parsed = await callVisionOnce(prompt, images) // 无效/残缺响应自动重试一次（幂等调用）
    if (!parsed) throw new Error('AI 返回格式无法解析，请稍后重试')
    let result = parsed.result // callVisionOnce 已归一化（含中文同义词映射）
    let reconciled: string | null = null
    // 模型偶发自相矛盾：reason 已明确断定同一位置却输出 UNCERTAIN（实测抖动）→ 重试一次；仍矛盾则按理由调和并透明记录
    if (result === 'UNCERTAIN' && assertSame(parsed.reason)) {
      const retry = await callVisionOnce(prompt, images)
      if (retry) {
        const r2 = retry.result
        if (r2 !== 'UNCERTAIN') { parsed = retry; result = r2 }
        else if (assertSame(retry.reason)) { parsed = retry; result = 'CONSISTENT'; reconciled = '模型理由与结论矛盾（两轮均断定同一位置但 result=UNCERTAIN），系统按模型理由调和为 CONSISTENT' }
        else { parsed = retry /* 重试自洽地判 UNCERTAIN（理由未断定同一位置）→ 采用重试结果，避免留下「理由说一致但结论不确定」的矛盾记录 */ }
      } else {
        result = 'CONSISTENT'; reconciled = '重试未获有效响应，按首轮模型理由（明确断定同一位置）调和为 CONSISTENT'
      }
    }
    // confidence 宽容解析：模型偶发输出 "100%"/"约95" 等带杂字符形式，提取数字部分
    const confRaw = typeof parsed.confidence === 'number' ? parsed.confidence : Number(String(parsed.confidence ?? '').replace(/[^0-9.]/g, ''))
    const confidence = Math.max(0, Math.min(100, Math.round(confRaw || 0)))

    const check = await db.photoCheck.create({
      data: {
        scene,
        workRequestId,
        ticketId,
        result,
        confidence,
        reason: String(parsed.reason || '').slice(0, 500) || null,
        detail: JSON.stringify({ items: parsed.detail ?? [], ...(reconciled ? { reconciled: true, reconcileNote: reconciled } : {}) }),
        photos: JSON.stringify({
          baseIds: baseRows.map((a) => a.id),
          checkIds: checkRows.map((a) => a.id),
        }),
      },
    })

    if (briefingId) {
      await db.briefing.update({ where: { id: briefingId }, data: { aiCheckResult: result } }).catch(() => null)
    }

    return NextResponse.json({
      check,
      base: baseRows.map(toAttachmentDto),
      checkPhotos: checkRows.map(toAttachmentDto),
      summary: `${SCENE_META[scene].label}：${result === 'CONSISTENT' ? '位置一致' : result === 'INCONSISTENT' ? '位置不一致' : '无法确定'}（置信度 ${confidence}%）`,
    })
  } catch (e) {
    console.error('[POST /api/ai/photo-check]', e)
    return jsonError(e instanceof Error ? e.message : 'AI 照片核对失败', 500)
  }
}
