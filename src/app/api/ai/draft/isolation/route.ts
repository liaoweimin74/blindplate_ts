import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'
import { bpComplete, BP_BUSINESS_KNOWLEDGE, extractJson } from '@/lib/bp-ai'
import { buildAiCandidates, summarizeEquipmentScope } from '@/lib/bp-ai-retrieval'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface DraftPoint {
  masterCode?: string
  location: string
  medium?: string
  pressure?: string
  temperature?: string
  blindSpec: string
  blindType: string
  action: string
}

/** POST /api/ai/draft/isolation { workRequestId } → 隔离方案草案（隔离点清单）
 *  候选构造（bp-ai-retrieval 共享链路）：AI 通读作业需求全字段提取检索要素（设备位号/名称/管线代号）
 *  → 动态查询：需求管线 + 位置提及管线 + 识别设备本装置绑定管线；皆空时回退同装置全部管线。
 *  （此前未关联管线时为全库候选，AI 会推举无关装置的隔离点——已修复为同装置兜底） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const wid = Number(body?.workRequestId)
    if (!Number.isFinite(wid)) return jsonError('无效的 workRequestId')

    const wr = await db.workRequest.findUnique({ where: { id: wid } })
    if (!wr) return jsonError('作业需求不存在', 404)
    const [survey, pipeline, unit] = await Promise.all([
      db.siteSurvey.findUnique({ where: { workRequestId: wid } }),
      wr.pipelineId ? db.pipeline.findUnique({ where: { id: wr.pipelineId } }) : Promise.resolve(null),
      db.unit.findUnique({ where: { id: wr.unitId } }),
    ])

    // 盲板规格/类型取字典真实枚举
    const [specDict, typeDict, plates] = await Promise.all([
      db.dict.findMany({ where: { category: 'BLIND_SPEC' } }),
      db.dict.findMany({ where: { category: 'BLIND_TYPE' } }),
      db.blindPlate.findMany({ where: { status: 'IN_STOCK' }, select: { spec: true, type: true } }),
    ])

    // AI 全字段语义分析 → 检索要素 → 动态候选（需求管线 + 位置提及管线 + 设备本装置绑定管线，回退同装置）
    const cand = await buildAiCandidates({
      unitId: wr.unitId,
      wrPipelineId: wr.pipelineId,
      wrPipelineName: wr.pipelineName,
      input: {
        code: wr.code,
        title: wr.title,
        unitName: unit?.name ?? `#${wr.unitId}`,
        location: wr.location,
        pipelineName: wr.pipelineName,
        medium: wr.medium,
        pressure: wr.pressure,
        temperature: wr.temperature,
        reason: wr.reason,
      },
    })
    const masters = cand.masters

    const specOptions = specDict.map((d) => d.value)
    const typeOptions = typeDict.map((d) => d.value)
    const masterLines = masters.length
      ? masters.map((m) => `- 主数据编码 ${m.code}｜名称 ${m.name}｜位置 ${m.location || '见现场'}｜所属管线 ${m.pipeline?.name ?? m.pipelineId}｜管线介质 ${m.pipeline?.medium ?? '-'}｜管线压力 ${m.pipeline?.pressure ?? '-'}｜来源 ${cand.sourceTag.get(m.id) ?? '同装置'}`).join('\n')
      : '（该作业关联管线及所属装置下暂无隔离点主数据，请按现场实际位置给出）'
    const plateSummary = plates.length
      ? Object.entries(plates.reduce<Record<string, number>>((acc, p) => { const k = `${p.spec} ${p.type}`; acc[k] = (acc[k] ?? 0) + 1; return acc }, {})).map(([k, n]) => `${k}×${n}`).join('、')
      : '（库存无在库盲板）'

    const context = `【作业需求信息】
编号：${wr.code}；标题：${wr.title}
装置：${unit?.name ?? wr.unitId}；位置：${wr.location}
管线：${wr.pipelineName ?? pipeline?.name ?? '未关联'}；介质：${wr.medium ?? pipeline?.medium ?? '未知'}；压力：${wr.pressure ?? pipeline?.pressure ?? '未知'}；温度：${wr.temperature ?? '未知'}
作业原因：${wr.reason}
${survey?.pointRefs ? `【勘察引用点位】${survey.pointRefs}\n` : ''}【AI 检索依据】${cand.intent.rationale || '（按需求字段语义分析）'}
${cand.scope.matched.length ? `【识别到的作业设备】\n${summarizeEquipmentScope(cand.scope)}\n` : ''}【候选范围：${cand.scopeText}】
${masterLines}
【盲板规格字典可选值】${specOptions.join(' / ')}
【盲板类型字典可选值】${typeOptions.join(' / ')}
【在库盲板概况】${plateSummary}`

    const raw = await bpComplete(
      `你是资深石化工艺工程师，请为下方盲板抽堵作业编制隔离方案草案（隔离点清单）。
${BP_BUSINESS_KNOWLEDGE}
【要求】
1. 每个隔离点一行：优先引用上方"隔离点主数据"的编码(masterCode 原样填写)；无主数据可引用时 masterCode 省略并按现场写位置；
2. 动作 action 只能是 ADD(加装盲板) 或 REMOVE(拆除盲板)，按作业目的逐点位判断（新增隔离/换装新盲板为 ADD，拆除旧盲板/恢复投用为 REMOVE）；
3. 盲板规格 blindSpec 必须从规格字典可选值中选择、类型 blindType 必须从类型字典可选值中选择；介质/压力/温度沿用管线参数；
4. 只引用与本次作业真正相关的点位（依据作业位置/设备/管线/介质/原因/勘察引用点位判断），无关点位一律不引用；
5. 作业位置若为全集型表述（如「分馏塔连接管线的所有隔离点位」），应覆盖识别设备相连的全部相关候选点位；非全集型按最少隔离范围取点（单点能隔离的不多点）；点位总数不超过 8 个；
6. 只输出 JSON：{"points":[{"masterCode":"IP-xxx 或省略","location":"...","medium":"...","pressure":"...","temperature":"...","blindSpec":"DNxxx","blindType":"8字盲板","action":"ADD"}]}，不要输出 JSON 以外文字。`,
      [{ role: 'user', content: context }],
      { temperature: 0.3 },
    )

    const draft = extractJson<{ points?: DraftPoint[] }>(raw)
    if (!draft || !Array.isArray(draft.points) || draft.points.length === 0) {
      return jsonError('AI 生成的草案格式异常，请重试', 502)
    }
    const specSet = new Set(specOptions)
    const typeSet = new Set(typeOptions)
    const masterByCode = new Map(masters.map((m) => [m.code, m]))
    const points = draft.points
      .filter((p) => p && typeof p.location === 'string' && p.location.trim())
      .slice(0, 8)
      .map((p, i) => {
        const masterCode = typeof p.masterCode === 'string' && masterByCode.has(p.masterCode) ? p.masterCode : undefined
        const mp = masterCode ? masterByCode.get(masterCode) : undefined
        return {
          seq: i + 1,
          masterCode: masterCode ?? undefined,
          code: masterCode,
          name: mp?.name,
          masterPointId: mp?.id ?? null,
          location: String(p.location).slice(0, 100).trim(),
          medium: String(p.medium ?? mp?.pipeline?.medium ?? '').slice(0, 40).trim() || undefined,
          pressure: String(p.pressure ?? mp?.pipeline?.pressure ?? '').slice(0, 40).trim() || undefined,
          temperature: String(p.temperature ?? '').slice(0, 40).trim() || undefined,
          blindSpec: specSet.has(p.blindSpec) ? p.blindSpec : (specOptions[0] ?? String(p.blindSpec ?? '').slice(0, 20)),
          blindType: typeSet.has(p.blindType) ? p.blindType : (typeOptions[0] ?? String(p.blindType ?? '').slice(0, 20)),
          action: p.action === 'REMOVE' ? 'REMOVE' : 'ADD',
        }
      })
    if (!points.length) return jsonError('AI 生成的隔离点为空，请重试', 502)
    return NextResponse.json({
      draft: { points },
      dict: { specOptions, typeOptions },
      scope: {
        matchedEquipments: cand.scope.matched.map((m) => ({ code: m.code, name: m.name })),
        rationale: cand.intent.rationale,
        scopeText: cand.scopeText,
        fallbackUsed: cand.fallbackUsed,
      },
    })
  } catch (e) {
    console.error('[ai/draft/isolation]', e)
    return jsonError('AI 服务暂时不可用，请稍后重试', 500)
  }
}
