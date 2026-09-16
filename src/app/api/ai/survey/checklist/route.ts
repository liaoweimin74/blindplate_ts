import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'
import { bpComplete, BP_BUSINESS_KNOWLEDGE, extractJson } from '@/lib/bp-ai'
import { buildAiCandidates } from '@/lib/bp-ai-retrieval'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST /api/ai/survey/checklist { workRequestId } → 针对本作业的现场勘察要点清单（AI 定制生成，供逐项核对参考） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const wid = Number(body?.workRequestId)
    if (!Number.isFinite(wid)) return jsonError('无效的 workRequestId')

    const wr = await db.workRequest.findUnique({ where: { id: wid } })
    if (!wr) return jsonError('作业需求不存在', 404)
    // WorkRequest 与子表无 Prisma 关系，手工组装（同 /api/ai/draft/jsa 口径）
    const [unit, pipeline] = await Promise.all([
      db.unit.findUnique({ where: { id: wr.unitId } }),
      wr.pipelineId ? db.pipeline.findUnique({ where: { id: wr.pipelineId } }) : Promise.resolve(null),
    ])
    // 候选隔离点主数据：AI 全字段语义分析提取检索要素（设备位号/名称/管线代号）→ 动态查询
    // （需求管线 + 位置提及管线 + 识别设备本装置绑定管线），勘察人应重点确认这些点位的现场可达性与状态
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
    const pointMasters = cand.masters
    const sourceTag = cand.sourceTag

    const pointsBlock = pointMasters.length
      ? `本次作业相关隔离点主数据（【】内为来源：需求管线/位置提及管线/作业设备相连管线）：${pointMasters.map((p) => `${p.code} ${p.name}${p.location ? `（${p.location}）` : ''}【${sourceTag.get(p.id) ?? '需求管线'}】`).join('；')}\n检索依据：${cand.intent.rationale || cand.scopeText}`
      : '该管线暂无标准隔离点主数据（勘察时需人工确认拟作业点位）'

    const context = `【待勘察作业信息】
编号：${wr.code}；标题：${wr.title}
装置：${unit?.name ?? wr.unitId}；作业位置：${wr.location}
管线：${wr.pipelineName ?? pipeline?.name ?? '未关联'}；介质：${wr.medium ?? pipeline?.medium ?? '未知'}；压力：${wr.pressure ?? pipeline?.pressure ?? '未知'}；温度：${wr.temperature ?? '未知'}
作业原因：${wr.reason}
紧急程度：${wr.urgency === 'HIGH' ? '高' : wr.urgency === 'LOW' ? '低' : '中'}
${pointsBlock}`

    const raw = await bpComplete(
      `你是资深石化工艺工程师，正为一次盲板抽堵作业的现场勘察环节编制「一单一策」的勘察要点清单。
${BP_BUSINESS_KNOWLEDGE}
【要求】
1. 生成 6-9 条针对本作业的勘察要点，必须结合上述介质特性、压力温度等级、作业位置与隔离点信息定制，禁止输出与具体作业无关的通用空话；
2. 每条是一个具体、现场可核实的检查项，动词开头并附带核实内容或关注点，例如「确认 E101 入口法兰周边操作空间与脚手架搭设条件」而非「检查现场环境」；
3. 必须覆盖：①作业点定位与管线走向核实 ②隔离点可达性（平台/梯子/空间）③法兰与螺栓现场状态 ④周边环境（地沟/电缆/相邻管线/交叉作业）⑤针对介质危险特性的气体检测与个体防护要点 ⑥照明与应急逃生条件；
4. 介质易燃易爆或有毒时，要点中必须体现便携式气体检测仪、防爆工具、正压呼吸器/防化服等针对性内容；
5. 候选隔离点中带【设备关联管线】标注且与本次作业相关时，须为该点位生成现场可达性与状态核实要点（设备检修隔离常需在相连管线上同步建立边界）；
6. 每条不超过 60 字；只输出 JSON，格式：{"checklist":["要点1","要点2"]}，不要输出 JSON 以外的任何文字。`,
      [{ role: 'user', content: context }],
      { temperature: 0.4 },
    )

    const draft = extractJson<{ checklist?: unknown }>(raw)
    const items = Array.isArray(draft?.checklist)
      ? draft.checklist
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .slice(0, 10)
          .map((c) => c.trim().slice(0, 100))
      : []
    if (!items.length) return jsonError('AI 生成的勘察要点为空，请重试', 502)
    return NextResponse.json({ checklist: items })
  } catch (e) {
    console.error('[ai/survey/checklist]', e)
    return jsonError('AI 服务暂时不可用，请稍后重试', 500)
  }
}
