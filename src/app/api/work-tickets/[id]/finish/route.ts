import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor } from '@/lib/bp-server-utils'
import { isMobileClient, isScanReject, verifyPointScan } from '@/lib/bp-scan-verify'

export const dynamic = 'force-dynamic'

/**
 * POST /api/work-tickets/[id]/finish 完工作业（IN_PROGRESS → FINISHED）
 * 一票一板：逐票完工。该需求全部生效票均完工时，任务 DONE + 需求 → PENDING_ACCEPTANCE；
 * 尚有其他票未完工时需求保持 IN_PROGRESS（多点按顺序逐票施工）。
 * 扫码核对强校验（需求23：移动端专属环节）：携带 X-Client: mobile 的请求，票面有隔离点编码时必须提交一致的核对编码（不匹配 403 + 审计）；桌面端免扫码。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tid = parseId(id)
    if (!tid) return jsonError('无效的作业票 ID')
    const ticket = await db.workTicket.findUnique({ where: { id: tid } })
    if (!ticket) return jsonError('作业票不存在', 404)
    if (ticket.status !== 'IN_PROGRESS') {
      return jsonError(`当前状态为 ${ticket.status}，仅作业中的作业票可完工`)
    }
    // 提取操作人（body 可为空：无 __actor 时回落任务负责人快照）
    const body = await readBody(req)
    const extracted = extractActor(body)
    // 扫码核对强校验（需求23：仅移动端来源强制比对；桌面端免扫码）
    if (isMobileClient(req)) {
      const scan = await verifyPointScan({
        expected: ticket.pointCode,
        scanned: body.scannedPointCode,
        actorId: extracted.actorId,
        actorName: extracted.actorName,
        entity: 'WORK_TICKET',
        entityId: tid,
        entityCode: ticket.code,
        scene: '完工',
      })
      if (isScanReject(scan)) return scan
    }
    const now = new Date()
    const updated = await db.workTicket.update({
      where: { id: tid },
      data: { status: 'FINISHED', finishedAt: now },
    })
    // 聚合：生效票（非作废）是否全部完工
    const effective = await db.workTicket.findMany({
      where: { workRequestId: ticket.workRequestId, status: { not: 'VOID' } },
      select: { status: true },
    })
    const allFinished = effective.every((t) => t.status === 'FINISHED' || t.status === 'CLOSED')
    const task = await db.workTask.findFirst({ where: { workRequestId: ticket.workRequestId } })
    let updatedTask = task
    if (task && allFinished && task.status !== 'DONE') {
      updatedTask = await db.workTask.update({
        where: { id: task.id },
        data: { status: 'DONE', actualEnd: now },
      })
    }
    const request = await db.workRequest.update({
      where: { id: ticket.workRequestId },
      data: { status: allFinished ? 'PENDING_ACCEPTANCE' : 'IN_PROGRESS' },
    })
    const doneCount = effective.filter((t) => t.status === 'FINISHED' || t.status === 'CLOSED').length
    // 审计留痕：作业完工（票 + 任务两行）
    const actor = resolveActor(extracted, updatedTask?.assignee ?? ticket.issuer, updatedTask?.assigneeId ?? null)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'COMPLETE',
      entity: 'WORK_TICKET',
      entityId: tid,
      entityCode: ticket.code,
      detail: auditFlowDetail(ticket.code, ticket.status, 'FINISHED', `作业完工（隔离点 ${ticket.pointCode ?? ticket.pointLocation ?? ''}；${doneCount}/${effective.length} 张票完工，需求 ${request.code}${allFinished ? ' 进入待验收' : ' 保持作业中'}${updatedTask && allFinished ? `，任务 ${updatedTask.code} 同步完成` : ''}）`),
    })
    if (updatedTask && allFinished && task?.status !== 'DONE') {
      await logAudit({
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'COMPLETE',
        entity: 'WORK_TASK',
        entityId: updatedTask.id,
        entityCode: updatedTask.code,
        detail: auditFlowDetail(updatedTask.code, task?.status ?? null, 'DONE', `任务执行完毕（全部作业票完工，需求 ${request.code}）`),
      })
    }
    return NextResponse.json({ ticket: updated, task: updatedTask, request, progress: { done: doneCount, total: effective.length } })
  } catch (e) {
    console.error('[POST /api/work-tickets/[id]/finish]', e)
    return jsonError(e instanceof Error ? e.message : '作业完工失败', 500)
  }
}
