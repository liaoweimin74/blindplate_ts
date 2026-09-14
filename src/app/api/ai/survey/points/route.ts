import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'
import { bpComplete, BP_BUSINESS_KNOWLEDGE, extractJson } from '@/lib/bp-ai'
import { buildAiCandidates, summarizeEquipmentScope } from '@/lib/bp-ai-retrieval'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST /api/ai/survey/points { workRequestId, siteCondition?, hazardPoints? }
 *  → AI 推举本次作业需引用的隔离点位（仅从候选主数据中受限选择，masterCode 校验防幻觉，附带推荐理由）
 *  候选构造（bp-ai-retrieval 共享链路）：AI 通读作业需求全字段提取检索要素（设备位号/设备名称/管线代号）
 *  → 动态查询：需求管线 + 位置提及管线 + 识别设备本装置绑定管线；皆空时回退同装置全部管线 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const wid = Number(body?.workRequestId)
    if (!Number.isFinite(wid)) return jsonError('无效的 workRequestId')
    const siteCondition = typeof body?.siteCondition === 'string' ? body.siteCondition.slice(0, 600).trim() : ''
    const hazardPoints = typeof body?.hazardPoints === 'string' ? body.hazardPoints.slice(0, 300).trim() : ''

    const wr = await db.workRequest.findUnique({ where: { id: wid } })
    if (!wr) return jsonError('作业需求不存在', 404)
    const unit = await db.unit.findUnique({ where: { id: wr.unitId } })

    const cand = await buildAiCandidates({
      unitId: wr.unitId,
      wrPipelineId: wr.pipelineId,
      wrPipelineName: wr.pipelineName,
      input: {
        code: wr.code,
        title: wr.title,
        workTypeText: wr.workType === 'ADD' ? '加装盲板' : wr.workType === 'REMOVE' ? '拆除盲板' : '抽装盲板（先拆后装或先装后拆）',
        unitName: unit?.name ?? `#${wr.unitId}`,
        location: wr.location,
        pipelineName: wr.pipelineName,
        medium: wr.medium,
        pressure: wr.pressure,
        temperature: wr.temperature,
        reason: wr.reason,
        extra: siteCondition || hazardPoints ? `【勘察已填内容（供参考）】\n现场条件：${siteCondition || '（未填）'}\n现场风险点：${hazardPoints || '（未填）'}` : undefined,
      },
    })
    if (!cand.masters.length) {
      return jsonError('该作业关联管线、识别到的设备相连管线及所属装置下暂无隔离点主数据，无法自动推举，请在下方手动选择', 422)
    }

    const masterByCode = new Map(cand.masters.map((m) => [m.code, m]))

    const context = `【作业信息】
编号：${wr.code}；标题：${wr.title}
作业类型：${wr.workType === 'ADD' ? '加装盲板' : wr.workType === 'REMOVE' ? '拆除盲板' : '抽装盲板（先拆后装或先装后拆）'}
装置：${unit?.name ?? wr.unitId}；作业位置：${wr.location}
管线：${wr.pipelineName ?? '未关联'}；介质：${wr.medium ?? '未知'}；压力：${wr.pressure ?? '未知'}；温度：${wr.temperature ?? '未知'}
作业原因：${wr.reason}
【AI 检索依据】${cand.intent.rationale || '（按需求字段语义分析）'}
${cand.scope.matched.length ? `【识别到的作业设备】\n${summarizeEquipmentScope(cand.scope)}\n` : ''}【候选范围：${cand.scopeText}】
${cand.masters.map((m) => `- 主数据编码 ${m.code}｜名称 ${m.name}｜位置 ${m.location ?? '见现场'}｜所属管线 ${m.pipeline?.name ?? '—'}｜管线介质 ${m.pipeline?.medium ?? '-'}｜管线压力 ${m.pipeline?.pressure ?? '-'}｜来源 ${cand.sourceTag.get(m.id) ?? '同装置'}`).join('\n')}`

    const raw = await bpComplete(
      `你是资深石化工艺工程师。请从候选隔离点主数据中，推举本次盲板抽堵作业现场勘察应确认引用的隔离点位。
${BP_BUSINESS_KNOWLEDGE}
【推举纪律（最重要）】
1. 只能从上方候选列表中选择，masterCode 必须原样引用候选中的编码，严禁编造任何候选之外的编码；
2. 只推举与本次作业真正相关的点位（依据作业位置/设备/管线/介质/原因/勘察已填内容判断）：无关点位一律不选，宁缺毋滥；
3. 作业位置若为全集型表述（如「分馏塔连接管线的所有隔离点位」），应覆盖识别设备相连的全部候选管线点位，推举数量上限放宽至 6 个；
4. 候选中「来源=设备关联管线」的点位位于作业设备的进/出口相连管线上：设备检修隔离通常需要在设备周边多条管线同时建立盲板边界，若与本次作业相关应一并推举，并在 reason 中说明设备关联（如「T-301 出口侧上下游隔离」）；
5. 每条 reason 不超过 40 字，说明为什么本次勘察需要确认该点位（如位置贴合/设备进出口关联/同管线上下游/介质关联）。
只输出 JSON，格式：{"points":[{"masterCode":"IP-xxx","reason":"..."}]}，不要输出 JSON 以外的任何文字。`,
      [{ role: 'user', content: context }],
      { temperature: 0.3 },
    )

    const draft = extractJson<{ points?: unknown }>(raw)
    const rawPoints = Array.isArray(draft?.points) ? draft.points : []
    const refs: { masterPointId: number; code: string; name: string; pipelineName: string | null; reason: string }[] = []
    for (const p of rawPoints) {
      if (!p || typeof p !== 'object') continue
      const code = typeof (p as { masterCode?: unknown }).masterCode === 'string' ? (p as { masterCode: string }).masterCode.trim() : ''
      const m = masterByCode.get(code)
      if (!m || refs.some((r) => r.masterPointId === m.id)) continue // 幻觉编码/重复 → 丢弃
      refs.push({
        masterPointId: m.id,
        code: m.code,
        name: m.name,
        pipelineName: m.pipeline?.name ?? null,
        reason: String((p as { reason?: unknown }).reason ?? '').slice(0, 60).trim(),
      })
      if (refs.length >= 6) break
    }
    if (!refs.length) return jsonError('AI 未能推举出有效点位（可能候选与作业无关），请手动选择', 502)
    return NextResponse.json({
      refs,
      scope: {
        matchedEquipments: cand.scope.matched.map((m) => ({ code: m.code, name: m.name })),
        links: cand.scope.links.map((l) => ({ pipelineCode: l.pipelineCode, pipelineName: l.pipelineName, equipmentCode: l.equipmentCode, direction: l.direction })),
        rationale: cand.intent.rationale,
        scopeText: cand.scopeText,
        fallbackUsed: cand.fallbackUsed,
      },
    })
  } catch (e) {
    console.error('[ai/survey/points]', e)
    return jsonError('AI 服务暂时不可用，请稍后重试', 500)
  }
}
