import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/disposal-steps/[id]/confirm — 工艺处置步骤逐项确认
 * body: { result: 'OK' | 'ABNORMAL', remark?, confirmer }
 * 需求必须为 PENDING_CONFIRM（处置确认阶段）；OK → completed=true；
 * ABNORMAL → completed=false（待整改后重新确认）。全部步骤 OK 是总体确认合格的前置条件。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sid = parseId(id)
    if (!sid) return jsonError('无效的处置步骤 ID')
    const step = await db.disposalStep.findUnique({ where: { id: sid } })
    if (!step) return jsonError('处置步骤不存在', 404)
    const scheme = await db.disposalScheme.findUnique({ where: { id: step.schemeId } })
    if (!scheme) return jsonError('所属处置方案不存在', 404)
    const request = await db.workRequest.findUnique({ where: { id: scheme.workRequestId } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (request.status !== 'PENDING_CONFIRM') {
      return jsonError(`当前需求状态为 ${request.status}，仅待工艺处置确认阶段可逐项确认`)
    }

    const body = await readBody(req)
    const confirmer = str(body.confirmer)
    if (!confirmer) return jsonError('确认人不能为空')
    const result = body.result === 'ABNORMAL' ? 'ABNORMAL' : 'OK'
    const remark = str(body.remark) || null
    const now = new Date()

    const updated = await db.disposalStep.update({
      where: { id: sid },
      data: {
        completed: result === 'OK',
        confirmedBy: confirmer,
        confirmedAt: now,
        confirmResult: result,
        confirmRemark: remark,
      },
    })

    // 汇总进度（供前端刷新与审计描述）
    const steps = await db.disposalStep.findMany({
      where: { schemeId: scheme.id },
      orderBy: { seq: 'asc' },
      select: { seq: true, confirmResult: true },
    })
    const okCount = steps.filter((s) => s.confirmResult === 'OK').length
    const abnormalCount = steps.filter((s) => s.confirmResult === 'ABNORMAL').length

    // 审计留痕：处置步骤逐项确认
    const actor = resolveActor(extractActor(body), confirmer)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'STATUS_CHANGE',
      entity: 'DISPOSAL_STEP',
      entityId: sid,
      entityCode: `${scheme.code}-步骤${step.seq}`,
      detail: auditFlowDetail(
        `${scheme.code} 步骤${step.seq}`,
        step.completed ? '已完成' : '未完成',
        result === 'OK' ? '确认合格' : '确认异常',
        `工艺处置步骤逐项确认${result === 'OK' ? '合格' : '异常'}（${step.detail.slice(0, 30)}…；确认人：${confirmer}；进度 ${okCount}/${steps.length}${abnormalCount ? `，异常 ${abnormalCount} 项` : ''}）${remark ? `，备注：${remark}` : ''}`
      ),
    })
    return NextResponse.json({ step: updated, progress: { ok: okCount, abnormal: abnormalCount, total: steps.length } })
  } catch (e) {
    console.error('[POST /api/disposal-steps/[id]/confirm]', e)
    return jsonError(e instanceof Error ? e.message : '处置步骤确认失败', 500)
  }
}
