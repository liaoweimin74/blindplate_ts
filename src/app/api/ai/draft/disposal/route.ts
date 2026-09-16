import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'
import { bpComplete, BP_BUSINESS_KNOWLEDGE, extractJson } from '@/lib/bp-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface DraftStep { method: string; detail: string; standard?: string; masterCode?: string }

const METHOD_KEYS = ['VENT', 'DRAIN', 'REPLACE', 'PURGE', 'STEAM', 'GAS_TEST', 'ISOLATE', 'OTHER']
const METHOD_ZH: Record<string, string> = {
  VENT: '泄压降压', DRAIN: '排净', REPLACE: '置换', PURGE: '吹扫',
  STEAM: '蒸煮', GAS_TEST: '气体检测', ISOLATE: '切断加盲板', OTHER: '其他',
}

/** POST /api/ai/draft/disposal { workRequestId } → 工艺处置方案草案（泄压/排净/置换/吹扫/检测步骤） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const wid = Number(body?.workRequestId)
    if (!Number.isFinite(wid)) return jsonError('无效的 workRequestId')

    const wr = await db.workRequest.findUnique({ where: { id: wid } })
    if (!wr) return jsonError('作业需求不存在', 404)

    // 手工组装：管线 + 已批准隔离方案及其隔离点（WorkRequest 无 Prisma 关系）
    const [pipeline, isoScheme] = await Promise.all([
      wr.pipelineId ? db.pipeline.findUnique({ where: { id: wr.pipelineId } }) : Promise.resolve(null),
      db.isolationScheme.findUnique({ where: { workRequestId: wid } }),
    ])
    const isoPoints = isoScheme
      ? await db.isolationPoint.findMany({ where: { schemeId: isoScheme.id }, orderBy: { seq: 'asc' } })
      : []

    const masters = await db.isoPointMaster.findMany({
      where: wr.pipelineId ? { pipelineId: wr.pipelineId } : undefined,
      select: { id: true, code: true, name: true, location: true },
    })

    const pointLines = isoPoints.length
      ? isoPoints.map((p) => `- 位置 ${p.location}｜动作 ${p.action === 'ADD' ? '加装' : '拆除'} ${p.blindSpec} ${p.blindType}｜介质 ${p.medium ?? '-'}｜压力 ${p.pressure ?? '-'}${p.masterCode ? `｜主数据编码 ${p.masterCode}` : ''}`).join('\n')
      : '（隔离方案尚未编制或无隔离点明细）'
    const masterLines = masters.length
      ? masters.map((m) => `- ${m.code} ${m.name}${m.location ? `（${m.location}）` : ''}`).join('\n')
      : '（无）'

    const context = `【作业需求信息】
编号：${wr.code}；标题：${wr.title}
装置：${wr.unitId}；位置：${wr.location}
管线：${wr.pipelineName ?? pipeline?.name ?? '未关联'}；介质：${wr.medium ?? pipeline?.medium ?? '未知'}；压力：${wr.pressure ?? pipeline?.pressure ?? '未知'}；温度：${wr.temperature ?? '未知'}
作业原因：${wr.reason}
【已批准隔离方案隔离点】
${pointLines}
【本管线隔离点主数据（masterCode 可选值）】
${masterLines}`

    const raw = await bpComplete(
      `你是资深石化工艺工程师，请为下方盲板抽堵作业编制工艺处置方案草案（抽堵作业前对管线/设备进行处理的步骤序列）。
${BP_BUSINESS_KNOWLEDGE}
【要求】
1. 步骤按实际执行顺序：先泄压降压(VENT)→排净(DRAIN)→置换(REPLACE，通常用氮气)→吹扫(PURGE，视介质选蒸汽/氮气)→气体检测(GAS_TEST)→必要时蒸煮(STEAM)；每步关联受影响的隔离点（masterCode 从可选值中选，多点位相同处理可合并省略）；
2. 处置内容写明具体做法与对象（如“对XX管线进行氮气置换，自导淋排放至火炬”）；合格标准写可量化指标（如“可燃气体 LEL<0.2%”“氧含量 19.5%~21%”“系统压力≤0.05MPa”）；易燃易爆/有毒介质必须包含 GAS_TEST 步骤；
3. method 只能使用枚举：VENT/DRAIN/REPLACE/PURGE/STEAM/GAS_TEST/ISOLATE/OTHER；
4. 步骤数 3-8 步；
5. 只输出 JSON：{"steps":[{"method":"VENT","detail":"...","standard":"...","masterCode":"IP-xxx 或省略"}]}，不要输出 JSON 以外文字。`,
      [{ role: 'user', content: context }],
      { temperature: 0.3 },
    )

    const draft = extractJson<{ steps?: DraftStep[] }>(raw)
    if (!draft || !Array.isArray(draft.steps) || draft.steps.length === 0) {
      return jsonError('AI 生成的草案格式异常，请重试', 502)
    }
    const masterByCode = new Map(masters.map((m) => [m.code, m]))
    const steps = draft.steps
      .filter((s) => s && typeof s.detail === 'string' && s.detail.trim())
      .slice(0, 10)
      .map((s, i) => {
        const masterCode = typeof s.masterCode === 'string' && masterByCode.has(s.masterCode) ? s.masterCode : undefined
        return {
          seq: i + 1,
          method: METHOD_KEYS.includes(s.method) ? s.method : 'OTHER',
          methodZh: METHOD_ZH[s.method] ?? METHOD_ZH.OTHER,
          detail: String(s.detail).slice(0, 200).trim(),
          standard: String(s.standard ?? '').slice(0, 120).trim() || undefined,
          masterCode,
          masterPointId: masterCode ? masterByCode.get(masterCode)?.id ?? null : null,
        }
      })
    if (!steps.length) return jsonError('AI 生成的步骤为空，请重试', 502)
    return NextResponse.json({ draft: { steps } })
  } catch (e) {
    console.error('[ai/draft/disposal]', e)
    return jsonError('AI 服务暂时不可用，请稍后重试', 500)
  }
}
