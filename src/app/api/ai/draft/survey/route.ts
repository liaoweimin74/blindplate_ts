import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'
import { bpComplete, BP_BUSINESS_KNOWLEDGE, extractJson } from '@/lib/bp-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface SurveyDraft { siteCondition: string; pipelineVerify: string; hazardPoints: string; suggestion: string }

const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/** POST /api/ai/draft/survey { workRequestId, notes? } → 现场勘察记录草案（预填表单，不落库）
 *  notes：勘察人在现场随手记的要点（可选）——有则以其为素材组织成专业记录，无则生成待确认框架 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const wid = Number(body?.workRequestId)
    if (!Number.isFinite(wid)) return jsonError('无效的 workRequestId')
    const notes = cut(body?.notes, 800)

    const wr = await db.workRequest.findUnique({ where: { id: wid } })
    if (!wr) return jsonError('作业需求不存在', 404)
    const [unit, pipeline] = await Promise.all([
      db.unit.findUnique({ where: { id: wr.unitId } }),
      wr.pipelineId ? db.pipeline.findUnique({ where: { id: wr.pipelineId } }) : Promise.resolve(null),
    ])
    const pointMasters = wr.pipelineId
      ? await db.isoPointMaster.findMany({ where: { pipelineId: wr.pipelineId }, take: 10, orderBy: { id: 'asc' } })
      : []

    const pointsBlock = pointMasters.length
      ? `该管线下已维护的标准隔离点：${pointMasters.map((p) => `${p.code} ${p.name}${p.location ? `（${p.location}）` : ''}`).join('；')}`
      : '该管线暂无标准隔离点主数据'

    const context = `【作业信息】
编号：${wr.code}；标题：${wr.title}
装置：${unit?.name ?? wr.unitId}；作业位置：${wr.location}
管线：${wr.pipelineName ?? pipeline?.name ?? '未关联'}；介质：${wr.medium ?? pipeline?.medium ?? '未知'}；压力：${wr.pressure ?? pipeline?.pressure ?? '未知'}；温度：${wr.temperature ?? '未知'}
作业原因：${wr.reason}
${pointsBlock}
【勘察人现场随手记要点】
${notes || '（勘察人尚未填写，请生成待现场确认的记录框架）'}`

    const raw = await bpComplete(
      `你是资深石化工艺工程师，请基于作业信息为「现场勘察」环节起草一份勘察记录草稿，供勘察人核对修改后提交。
${BP_BUSINESS_KNOWLEDGE}
【起草纪律（最重要）】
1. 严禁编造勘察人未提及的具体现场事实（如确切的平台高度、脚手架数量、法兰锈蚀程度）——这些只能来源于「勘察人现场随手记要点」；
2. 随手记要点非空时：以要点为素材组织成专业、完整、条理清晰的记录，可润色措辞与补充针对性提示，但不得添加要点之外的具体事实；
3. 随手记要点为空时：生成记录框架，未知的现场细节用「（待现场确认：××）」占位标注，提示勘察人到现场补记；
4. 介质易燃易爆/有毒/高温高压时，风险点与建议中必须体现对应的气体检测、个体防护与处置要求。
【各字段口径】
- siteCondition：现场条件描述，2-3 句（作业点周边环境、平台/空间/照明等，以要点或占位呈现）；
- pipelineVerify：管线参数核实说明，1 句（需现场核对的介质/压力/温度与台账一致性要求）；
- hazardPoints：现场风险点，1-2 句，基于介质特性与现场条件具体化；
- suggestion：勘察建议，1 句（是否具备条件倾向+作业注意事项）。
只输出 JSON，格式：{"siteCondition":"...","pipelineVerify":"...","hazardPoints":"...","suggestion":"..."}，不要输出 JSON 以外的任何文字。`,
      [{ role: 'user', content: context }],
      { temperature: 0.4 },
    )

    const draft = extractJson<Partial<SurveyDraft>>(raw)
    if (!draft) return jsonError('AI 生成的草案格式异常，请重试', 502)
    const result: SurveyDraft = {
      siteCondition: cut(draft.siteCondition, 400),
      pipelineVerify: cut(draft.pipelineVerify, 160),
      hazardPoints: cut(draft.hazardPoints, 160),
      suggestion: cut(draft.suggestion, 160),
    }
    if (!result.siteCondition) return jsonError('AI 生成的现场条件为空，请重试', 502)
    return NextResponse.json({ draft: result })
  } catch (e) {
    console.error('[ai/draft/survey]', e)
    return jsonError('AI 服务暂时不可用，请稍后重试', 500)
  }
}
