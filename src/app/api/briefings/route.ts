import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, num, readBody, resolveActor, str } from '@/lib/bp-server-utils'
import { bindAttachments } from '@/lib/bp-attachments'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** GET /api/briefings?id= 单条 | ?workRequestId= | ?ticketId= | ?status=PENDING 交底记录列表 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const id = num(sp.get('id'))
    if (id !== null) {
      const briefing = await db.briefing.findUnique({ where: { id } })
      if (!briefing) return jsonError('交底记录不存在', 404)
      return NextResponse.json(briefing)
    }
    const wid = num(sp.get('workRequestId'))
    const tid = num(sp.get('ticketId'))
    const status = sp.get('status')
    const where: Record<string, unknown> = {}
    if (wid !== null) where.workRequestId = wid
    if (tid !== null) where.ticketId = tid
    if (status) where.status = status
    const list = await db.briefing.findMany({ where, orderBy: { createdAt: 'desc' } })
    return NextResponse.json(list)
  } catch (e) {
    console.error('[GET /api/briefings]', e)
    return jsonError(e instanceof Error ? e.message : '查询交底记录失败', 500)
  }
}

/**
 * POST /api/briefings 创建现场交底（交底方：拍照+录音后提交）
 * body: { workRequestId, ticketId?, ticketCode?, pointCode?, pointLocation?, briefingUser,
 *         briefingUserId?, briefedUsers?, content, photoIds?(已上传的 BRIEFING 占位附件), __actorId/__actorName }
 * 创建后同步把 BRIEFING 占位照片绑到 briefing.id；AI 位置核对（vs 勘察照片）由前端确认创建后调用 /api/ai/photo-check 触发（避免阻塞创建响应）。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const wid = num(body.workRequestId)
    if (wid === null) return jsonError('无效的 workRequestId')
    const request = await db.workRequest.findUnique({ where: { id: wid } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (request.status !== 'TICKET_APPROVED' && request.status !== 'IN_PROGRESS') {
      return jsonError(`当前需求状态为 ${request.status}，仅作业票批准后（未验收前）可做现场交底`)
    }
    const briefingUser = str(body.briefingUser)
    if (!briefingUser) return jsonError('交底人不能为空')
    const content = str(body.content)
    if (!content) return jsonError('交底内容不能为空')

    let ticketCode = str(body.ticketCode) || null
    let pointCode = str(body.pointCode) || null
    let pointLocation = str(body.pointLocation) || null
    const ticketId = num(body.ticketId)
    if (ticketId !== null) {
      const ticket = await db.workTicket.findUnique({ where: { id: ticketId } })
      if (!ticket) return jsonError('关联作业票不存在', 404)
      ticketCode = ticket.code
      pointCode = pointCode ?? ticket.pointCode ?? null
      pointLocation = pointLocation ?? ticket.pointLocation ?? null
      if (ticket.workRequestId !== wid) return jsonError('作业票不属于该作业需求')
    }

    const briefing = await db.briefing.create({
      data: {
        workRequestId: wid,
        ticketId,
        ticketCode,
        pointCode,
        pointLocation,
        briefingUser,
        briefingUserId: str(body.briefingUserId) || null,
        briefedUsers: str(body.briefedUsers) || null,
        content,
        status: 'PENDING',
      },
    })
    // 绑定先上传的交底照片/录音（上传时 bizType=BRIEFING、bizId 空占位）
    const photoIds: string[] = Array.isArray(body.photoIds) ? body.photoIds : []
    const audioIds: string[] = Array.isArray(body.audioIds) ? body.audioIds : []
    await bindAttachments(photoIds, 'BRIEFING', briefing.id, ticketCode, pointCode)
    await bindAttachments(audioIds, 'BRIEFING', briefing.id, ticketCode, pointCode)

    const actor = resolveActor(extractActor(body), briefingUser)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'CREATE',
      entity: 'BRIEFING',
      entityId: briefing.id,
      entityCode: ticketCode ?? request.code,
      detail: `现场交底已创建（需求 ${request.code}${ticketCode ? `，作业票 ${ticketCode}` : ''}${pointCode ? `，隔离点 ${pointCode}` : ''}；交底人：${briefingUser}，照片 ${photoIds.length} 张、录音 ${audioIds.length} 段），待作业方确认`,
    })

    // 通知作业方（OPERATOR/GUARDIAN）待确认
    await pushNotifications({
      targetRoles: ['OPERATOR'],
      type: 'EXECUTE',
      title: '现场交底待确认',
      content: `${request.code} ${ticketCode ?? ''} ${briefingUser} 已完成现场交底（含 ${photoIds.length} 张现场照片），请作业方移动端确认`,
      bizType: 'TICKET',
      bizId: ticketId ?? undefined,
      bizCode: ticketCode ?? request.code,
      linkModule: 'field-ops',
    }).catch(() => null)

    return NextResponse.json({ briefing }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/briefings]', e)
    return jsonError(e instanceof Error ? e.message : '创建交底失败', 500)
  }
}

/** PATCH /api/briefings?id= 修正交底内容（仅 PENDING 可改；留痕从简） */
export async function PATCH(req: NextRequest) {
  try {
    const body = await readBody(req)
    const id = num(body.id)
    if (id === null) return jsonError('无效的交底 ID')
    const briefing = await db.briefing.findUnique({ where: { id } })
    if (!briefing) return jsonError('交底记录不存在', 404)
    if (briefing.status !== 'PENDING') return jsonError('作业方已确认的交底不可修改')
    const data: Record<string, unknown> = {}
    if (str(body.content)) data.content = str(body.content)
    if (body.briefedUsers !== undefined) data.briefedUsers = str(body.briefedUsers) || null
    const updated = await db.briefing.update({ where: { id }, data })
    return NextResponse.json({ briefing: updated })
  } catch (e) {
    console.error('[PATCH /api/briefings]', e)
    return jsonError(e instanceof Error ? e.message : '更新交底失败', 500)
  }
}

/** DELETE /api/briefings?id= 撤回交底（仅 PENDING） */
export async function DELETE(req: NextRequest) {
  try {
    const id = num(req.nextUrl.searchParams.get('id'))
    if (id === null) return jsonError('无效的交底 ID')
    const briefing = await db.briefing.findUnique({ where: { id } })
    if (!briefing) return jsonError('交底记录不存在', 404)
    if (briefing.status !== 'PENDING') return jsonError('作业方已确认的交底不可撤回')
    await db.briefing.delete({ where: { id } })
    await logAudit({
      actorName: briefing.briefingUser,
      action: 'DELETE',
      entity: 'BRIEFING',
      entityId: briefing.id,
      entityCode: briefing.ticketCode ?? '',
      detail: auditFlowDetail(briefing.ticketCode ?? `交底#${briefing.id}`, 'PENDING', '撤回', '交底在作业方确认前被撤回'),
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/briefings]', e)
    return jsonError(e instanceof Error ? e.message : '撤回交底失败', 500)
  }
}
