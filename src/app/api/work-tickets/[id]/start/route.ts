import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor } from '@/lib/bp-server-utils'
import { findPointPipelineConflicts, findRequestPipelineConflicts, findSamePipelineRunningTicket, formatPipelineConflictMessage } from '@/lib/bp-pipeline-occupancy'
import { isScanReject, verifyPointScan } from '@/lib/bp-scan-verify'

export const dynamic = 'force-dynamic'

/**
 * POST /api/work-tickets/[id]/start 开始作业（APPROVED → IN_PROGRESS），需求 → IN_PROGRESS
 * 一票一板：逐票开工。安全硬约束三重校验：
 * ⓪ 扫码核对强校验：票面有隔离点编码时必须提交一致的核对编码（移动端扫码/桌面端人工核对，不匹配 403 + 审计）；
 * ① 点位管线未被其他需求生效票占用；② 同需求内同管线无另一张作业中的票（严禁同一管道两处同时抽堵）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tid = parseId(id)
    if (!tid) return jsonError('无效的作业票 ID')
    const ticket = await db.workTicket.findUnique({ where: { id: tid } })
    if (!ticket) return jsonError('作业票不存在', 404)
    if (ticket.status !== 'APPROVED') {
      return jsonError(`当前状态为 ${ticket.status}，仅已批准的作业票可开始作业`)
    }
    const request0 = await db.workRequest.findUnique({ where: { id: ticket.workRequestId } })
    // 安全硬约束①：开工前再次校验管线占用（点粒度；存量合并票回退需求粒度）
    const conflicts = ticket.pointId != null
      ? await findPointPipelineConflicts(ticket.pointId, ticket.workRequestId, request0?.pipelineId ?? null)
      : await findRequestPipelineConflicts(ticket.workRequestId)
    if (conflicts.length) {
      return NextResponse.json(
        { error: `开工被拒绝：${formatPipelineConflictMessage(conflicts)}`, conflicts },
        { status: 409 }
      )
    }
    // 安全硬约束②：同管线同时作业互斥（同需求另一票作业中且落在同一管线 → 拒绝）
    const sameRunning = await findSamePipelineRunningTicket(ticket)
    if (sameRunning) {
      return NextResponse.json(
        {
          error: `开工被拒绝：同一管线禁止两处同时抽堵作业——作业票 ${sameRunning.code}（${sameRunning.pointCode ?? ''}）正在同一管线上作业，请按隔离方案顺序逐点进行`,
          samePipeline: sameRunning,
        },
        { status: 409 }
      )
    }
    // 安全硬约束③：开工前必须完成现场交底且作业方已确认（交底含照片/录音，AI 已与勘察照片核对位置）
    const briefings = await db.briefing.findMany({
      where: { OR: [{ ticketId: tid }, { workRequestId: ticket.workRequestId, ticketId: null }] },
      orderBy: { createdAt: 'desc' },
    })
    if (!briefings.length) {
      return NextResponse.json(
        {
          error: `开工被拒绝：作业票 ${ticket.code} 尚未进行现场交底——请交底方在移动端「现场作业」完成交底（拍照+录音）并经作业方确认后方可开工`,
          briefingRequired: true,
        },
        { status: 409 }
      )
    }
    if (!briefings.some((b) => b.status === 'CONFIRMED')) {
      return NextResponse.json(
        {
          error: `开工被拒绝：现场交底已完成但作业方尚未确认——请作业方在移动端「现场作业」查看交底内容（含照片/录音）并确认后方可开工`,
          briefingRequired: true,
        },
        { status: 409 }
      )
    }
    // 提取操作人（body 可为空：无 __actor 时回落任务负责人快照）
    const body = await readBody(req)
    const extracted = extractActor(body)
    // 安全硬约束⓪：扫码核对强校验（服务端比对票面隔离点编码，失败留痕并拒绝）
    const scan = await verifyPointScan({
      expected: ticket.pointCode,
      scanned: body.scannedPointCode,
      actorId: extracted.actorId,
      actorName: extracted.actorName,
      entity: 'WORK_TICKET',
      entityId: tid,
      entityCode: ticket.code,
      scene: '开工',
    })
    if (isScanReject(scan)) return scan
    const now = new Date()
    const updated = await db.workTicket.update({
      where: { id: tid },
      data: { status: 'IN_PROGRESS', startedAt: now },
    })
    const task = await db.workTask.findFirst({ where: { workRequestId: ticket.workRequestId } })
    const updatedTask = task && task.status === 'PENDING'
      ? await db.workTask.update({
          where: { id: task.id },
          data: { status: 'IN_PROGRESS', actualStart: now },
        })
      : task
    const request = await db.workRequest.update({
      where: { id: ticket.workRequestId },
      data: { status: 'IN_PROGRESS' },
    })
    // 审计留痕：开始作业（票 + 任务两行）
    const actor = resolveActor(extracted, updatedTask?.assignee ?? ticket.issuer, updatedTask?.assigneeId ?? null)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'START',
      entity: 'WORK_TICKET',
      entityId: tid,
      entityCode: ticket.code,
      detail: auditFlowDetail(ticket.code, ticket.status, 'IN_PROGRESS', `开始作业（隔离点 ${ticket.pointCode ?? ticket.pointLocation ?? ''}，需求 ${request.code}${updatedTask && task?.status === 'PENDING' ? `，任务 ${updatedTask.code} 同步开始` : ''}）`),
    })
    if (updatedTask && task?.status === 'PENDING') {
      await logAudit({
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'START',
        entity: 'WORK_TASK',
        entityId: updatedTask.id,
        entityCode: updatedTask.code,
        detail: auditFlowDetail(updatedTask.code, task.status, 'IN_PROGRESS', `任务开始执行（作业票 ${ticket.code}，需求 ${request.code}）`),
      })
    }
    return NextResponse.json({ ticket: updated, task: updatedTask, request })
  } catch (e) {
    console.error('[POST /api/work-tickets/[id]/start]', e)
    return jsonError(e instanceof Error ? e.message : '开始作业失败', 500)
  }
}
