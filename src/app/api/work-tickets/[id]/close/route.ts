import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/work-tickets/[id]/close 关闭作业票（FINISHED → CLOSED）
 * 一票一板：逐票关闭。该需求全部生效票均关闭时需求 → COMPLETED（流程闭环），
 * 否则需求保持当前状态（验收通过时验收路由会批量关闭全部完工票）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tid = parseId(id)
    if (!tid) return jsonError('无效的作业票 ID')
    const ticket = await db.workTicket.findUnique({ where: { id: tid } })
    if (!ticket) return jsonError('作业票不存在', 404)
    if (ticket.status !== 'FINISHED') {
      return jsonError(`当前状态为 ${ticket.status}，仅已完工的作业票可关闭`)
    }
    // 提取操作人（body 可为空：无 __actor 时回落签发人快照）
    const extracted = extractActor(await readBody(req))
    const now = new Date()
    const updated = await db.workTicket.update({
      where: { id: tid },
      data: { status: 'CLOSED', closedAt: now },
    })
    const effective = await db.workTicket.findMany({
      where: { workRequestId: ticket.workRequestId, status: { not: 'VOID' } },
      select: { status: true },
    })
    const allClosed = effective.every((t) => t.status === 'CLOSED')
    const request = await db.workRequest.update({
      where: { id: ticket.workRequestId },
      data: { status: allClosed ? 'COMPLETED' : undefined },
    })
    // 审计留痕：关闭作业票
    const actor = resolveActor(extracted, ticket.issuer)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'COMPLETE',
      entity: 'WORK_TICKET',
      entityId: tid,
      entityCode: ticket.code,
      detail: auditFlowDetail(ticket.code, ticket.status, 'CLOSED', `关闭作业票（隔离点 ${ticket.pointCode ?? ticket.pointLocation ?? ''}）${allClosed ? `，全部票已关闭，需求 ${request.code} 流程闭环` : `，需求 ${request.code} 尚有其他票未关闭`}`),
    })
    return NextResponse.json({ ticket: updated, request })
  } catch (e) {
    console.error('[POST /api/work-tickets/[id]/close]', e)
    return jsonError(e instanceof Error ? e.message : '关闭作业票失败', 500)
  }
}
