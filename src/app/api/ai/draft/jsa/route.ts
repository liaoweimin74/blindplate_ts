import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'
import { bpComplete, BP_BUSINESS_KNOWLEDGE, extractJson } from '@/lib/bp-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface DraftStep { step: string; hazard: string; measure: string }
interface JsaDraft { riskLevel: string; residualRisk: string; steps: DraftStep[] }

/** POST /api/ai/draft/jsa { workRequestId } → JSA 分析草案（步骤-危害-措施三元组 + 风险等级） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const wid = Number(body?.workRequestId)
    if (!Number.isFinite(wid)) return jsonError('无效的 workRequestId')

    const wr = await db.workRequest.findUnique({ where: { id: wid } })
    if (!wr) return jsonError('作业需求不存在', 404)
    // WorkRequest 与子表无 Prisma 关系，手工组装（同 /api/work-requests/[id] 口径）
    const [unit, survey, pipeline] = await Promise.all([
      db.unit.findUnique({ where: { id: wr.unitId } }),
      db.siteSurvey.findUnique({ where: { workRequestId: wid } }),
      wr.pipelineId ? db.pipeline.findUnique({ where: { id: wr.pipelineId } }) : Promise.resolve(null),
    ])

    const surveyBlock = survey
      ? `【现场勘察记录】勘察人 ${survey.surveyor}；现场条件：${survey.siteCondition}；参数核实：${survey.pipelineVerify ?? '无'}；现场风险点：${survey.hazardPoints ?? '无'}；是否具备条件：${survey.isSafe ? '具备' : '不具备'}；勘察意见：${survey.suggestion ?? '无'}`
      : '（尚未现场勘察）'

    const context = `【作业需求信息】
编号：${wr.code}；标题：${wr.title}
作业类型：${wr.workType === 'ADD' ? '加装盲板' : wr.workType === 'REMOVE' ? '拆除盲板' : '抽装盲板（先拆后装或先装后拆）'}
装置：${unit?.name ?? wr.unitId}；位置：${wr.location}
管线：${wr.pipelineName ?? pipeline?.name ?? '未关联'}；介质：${wr.medium ?? pipeline?.medium ?? '未知'}；压力：${wr.pressure ?? pipeline?.pressure ?? '未知'}；温度：${wr.temperature ?? '未知'}
作业原因：${wr.reason}
紧急程度：${wr.urgency === 'HIGH' ? '高' : wr.urgency === 'LOW' ? '低' : '中'}
${surveyBlock}`

    const raw = await bpComplete(
      `你是资深石化工艺工程师，擅长盲板抽堵作业的 JSA（作业安全分析）。请基于下方作业信息生成 JSA 分析草案。
${BP_BUSINESS_KNOWLEDGE}
【要求】
1. 按“作业步骤 → 危害因素 → 控制措施”逐项分析，步骤符合现场实际顺序（如办理票证、工具准备、工艺处置确认、拆除/加装盲板、试压查漏、恢复、清理交验等）；
2. 危害因素具体（介质特性、压力、高处、工器具、交叉作业等），控制措施可执行、贴合 GB 30871 要求；
3. 生成 6-8 个步骤；综合风险等级 LOW/MEDIUM/HIGH 三选一（介质易燃易爆有毒或高压高温时不得评 LOW）；
4. 剩余风险与应急措施 1-2 句。
5. 只输出 JSON，格式：{"riskLevel":"MEDIUM","residualRisk":"...","steps":[{"step":"...","hazard":"...","measure":"..."}]}，不要输出 JSON 以外的任何文字。`,
      [{ role: 'user', content: context }],
      { temperature: 0.4 },
    )

    const draft = extractJson<JsaDraft>(raw)
    if (!draft || !Array.isArray(draft.steps) || draft.steps.length === 0) {
      return jsonError('AI 生成的草案格式异常，请重试', 502)
    }
    const riskLevel = ['LOW', 'MEDIUM', 'HIGH'].includes(draft.riskLevel) ? draft.riskLevel : 'MEDIUM'
    const steps = draft.steps
      .filter((s) => s && typeof s.step === 'string' && s.step.trim())
      .slice(0, 12)
      .map((s, i) => ({
        seq: i + 1,
        step: String(s.step).slice(0, 120).trim(),
        hazard: String(s.hazard ?? '').slice(0, 160).trim(),
        measure: String(s.measure ?? '').slice(0, 200).trim(),
      }))
    if (!steps.length) return jsonError('AI 生成的步骤为空，请重试', 502)
    return NextResponse.json({
      draft: {
        riskLevel,
        residualRisk: String(draft.residualRisk ?? '').slice(0, 200).trim(),
        steps,
      },
    })
  } catch (e) {
    console.error('[ai/draft/jsa]', e)
    return jsonError('AI 服务暂时不可用，请稍后重试', 500)
  }
}
