import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, bizStatusLabel, extractActor, jsonError, logAudit, parseId, readBody, resolveActor, str } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'
import { findPointPipelineConflicts, findRequestPipelineConflicts, formatPipelineConflictMessage } from '@/lib/bp-pipeline-occupancy'

export const dynamic = 'force-dynamic'

/** 一需求多票：按生效票（非作废）聚合需求状态 */
async function aggregateRequestStatus(wid: number): Promise<string> {
  const tickets = await db.workTicket.findMany({
    where: { workRequestId: wid, status: { not: 'VOID' } },
    select: { status: true },
  })
  if (!tickets.length) return 'CONFIRMED'
  const ACTIVE_DONE = ['APPROVED', 'IN_PROGRESS', 'FINISHED', 'CLOSED']
  const allApproved = tickets.every((t) => ACTIVE_DONE.includes(t.status))
  const allClosed = tickets.every((t) => t.status === 'CLOSED')
  if (allClosed) return 'PENDING_ACCEPTANCE' // 全部完工待验收（close/finish 路由会进一步推进）
  return allApproved ? 'TICKET_APPROVED' : 'TICKET_ISSUED'
}

/**
 * POST /api/work-tickets/[id]/review { approve, comment, reviewer }
 * 一票一板：逐张审批。批准 → 票 APPROVED，全部生效票批准后需求 TICKET_APPROVED；
 * 驳回 → 票 VOID（该隔离点可重新开票），全部作废时需求回 CONFIRMED。
 * 管线互斥按点位管线粒度校验（存量合并票回退需求粒度）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tid = parseId(id)
    if (!tid) return jsonError('无效的作业票 ID')
    const ticket = await db.workTicket.findUnique({ where: { id: tid } })
    if (!ticket) return jsonError('作业票不存在', 404)
    if (ticket.status !== 'PENDING_REVIEW') {
      return jsonError(`当前状态为 ${ticket.status}，仅待批准状态可审核`)
    }
    const body = await readBody(req)
    const approve = Boolean(body.approve)
    const comment = str(body.comment) || null
    const reviewer = str(body.reviewer)
    if (!reviewer) return jsonError('审核人不能为空')

    // 安全硬约束：批准 = 票据即将生效，若该点位管线已被其他需求生效票占用则拒绝
    if (approve) {
      const request = await db.workRequest.findUnique({ where: { id: ticket.workRequestId } })
      const conflicts = ticket.pointId != null
        ? await findPointPipelineConflicts(ticket.pointId, ticket.workRequestId, request?.pipelineId ?? null)
        : await findRequestPipelineConflicts(ticket.workRequestId)
      if (conflicts.length) {
        return NextResponse.json(
          { error: `批准被拒绝：${formatPipelineConflictMessage(conflicts)}`, conflicts },
          { status: 409 }
        )
      }
    }

    const updated = await db.workTicket.update({
      where: { id: tid },
      data: approve
        ? { status: 'APPROVED', comment, approvedBy: reviewer, approvedAt: new Date() }
        : { status: 'VOID', comment },
    })
    await db.approvalRecord.create({
      data: {
        bizType: 'TICKET',
        bizId: tid,
        bizCode: ticket.code,
        action: approve ? 'APPROVE' : 'REJECT',
        operator: reviewer,
        comment,
      },
    })
    const requestStatus = await aggregateRequestStatus(ticket.workRequestId)
    const request = await db.workRequest.update({
      where: { id: ticket.workRequestId },
      data: { status: requestStatus },
    })
    const pointLabel = ticket.pointCode ?? ticket.pointLocation ?? ''
    await pushNotifications(
      approve
        ? {
            targetRoles: ['OPERATOR', 'GUARDIAN'],
            type: 'STATUS',
            title: '作业票已批准，可开始作业',
            content: `${request.code} 作业票 ${ticket.code}（${pointLabel}）已由 ${reviewer} 批准，请按票面安排开始作业`,
            bizType: 'TICKET',
            bizId: tid,
            bizCode: ticket.code,
            linkModule: 'task-mgmt',
            linkTab: 'track',
          }
        : {
            targetRoles: ['ENGINEER'],
            type: 'ALERT',
            title: '作业票被驳回作废',
            content: `${request.code} 作业票 ${ticket.code}（${pointLabel}）被驳回作废（批准人：${reviewer}）${comment ? `：${comment}` : ''}，该隔离点可重新开票`,
            bizType: 'TICKET',
            bizId: tid,
            bizCode: ticket.code,
            linkModule: 'task-mgmt',
            linkTab: 'ticket',
          }
    )
    // 审计留痕：作业票批准/驳回作废，需求状态聚合推进
    const actor = resolveActor(extractActor(body), reviewer)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: approve ? 'APPROVE' : 'REJECT',
      entity: 'WORK_TICKET',
      entityId: tid,
      entityCode: ticket.code,
      detail: auditFlowDetail(
        ticket.code,
        ticket.status,
        updated.status,
        `${approve ? '作业票批准，可开始作业' : `作业票驳回作废（隔离点 ${pointLabel} 可重新办票）`}，需求 ${request.code} 聚合为「${bizStatusLabel(request.status)}」${comment ? `，审批意见：${comment}` : ''}`
      ),
    })
    return NextResponse.json({ ticket: updated, request })
  } catch (e) {
    console.error('[POST /api/work-tickets/[id]/review]', e)
    return jsonError(e instanceof Error ? e.message : '审核作业票失败', 500)
  }
}
