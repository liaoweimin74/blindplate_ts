import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor, str } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/** POST /api/work-tickets/[id]/issue { issuer } 签发（DRAFT → PENDING_REVIEW） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tid = parseId(id)
    if (!tid) return jsonError('无效的作业票 ID')
    const ticket = await db.workTicket.findUnique({ where: { id: tid } })
    if (!ticket) return jsonError('作业票不存在', 404)
    if (ticket.status !== 'DRAFT') {
      return jsonError(`当前状态为 ${ticket.status}，仅待签发状态可签发`)
    }
    const body = await readBody(req)
    const issuer = str(body.issuer) || ticket.issuer

    const updated = await db.workTicket.update({
      where: { id: tid },
      data: { status: 'PENDING_REVIEW', issuer },
    })
    await db.approvalRecord.create({
      data: {
        bizType: 'TICKET',
        bizId: tid,
        bizCode: ticket.code,
        action: 'SUBMIT',
        operator: issuer,
        comment: '作业票签发，提交批准',
      },
    })
    const request = await db.workRequest.findUnique({ where: { id: ticket.workRequestId } })
    // 状态聚合修复（Task 96）：单独签发 DRAFT 票后需求状态同步——需求仍为 CONFIRMED（工艺处置已确认）时推进到 TICKET_ISSUED，
    // 与批量开票 POST /api/work-tickets 的需求状态口径一致，避免「票已待批、需求仍显示可开票」的脱节
    if (request && request.status === 'CONFIRMED') {
      await db.workRequest.update({ where: { id: request.id }, data: { status: 'TICKET_ISSUED' } })
    }
    await pushNotifications({
      targetRoles: ['MANAGER'],
      type: 'APPROVAL',
      title: '作业票待批准',
      content: `${request?.code ?? ''}（${request?.title ?? ''}）的作业票 ${ticket.code} 已签发，请批准`,
      bizType: 'TICKET',
      bizId: tid,
      bizCode: ticket.code,
      linkModule: 'approval-center',
    })
    // 审计留痕：作业票签发，提交批准
    const actor = resolveActor(extractActor(body), issuer)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'SUBMIT',
      entity: 'WORK_TICKET',
      entityId: tid,
      entityCode: ticket.code,
      detail: auditFlowDetail(ticket.code, ticket.status, 'PENDING_REVIEW', `签发作业票（签发人：${issuer}），提交批准`),
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[POST /api/work-tickets/[id]/issue]', e)
    return jsonError(e instanceof Error ? e.message : '签发作业票失败', 500)
  }
}
