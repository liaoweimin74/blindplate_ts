import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, num, readBody, resolveActor, str } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/**
 * POST /api/briefings/[id]/confirm — 作业方确认交底（移动端「我已知晓并确认」）
 * body: { confirmedBy, confirmedById?, confirmRemark?, __actorId/__actorName }
 * PENDING → CONFIRMED；确认后该票方可开工（开工 API 有硬门禁）
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const bid = num(id)
    if (bid === null) return jsonError('无效的交底 ID')
    const briefing = await db.briefing.findUnique({ where: { id: bid } })
    if (!briefing) return jsonError('交底记录不存在', 404)
    if (briefing.status === 'CONFIRMED') return jsonError('该交底已被作业方确认，无需重复确认')
    const body = await readBody(req)
    const confirmedBy = str(body.confirmedBy)
    if (!confirmedBy) return jsonError('确认人不能为空')
    const now = new Date()
    const confirmedById = str(body.confirmedById) || null
    // 扫码签到兼容：主动确认时若确认人在被交底名单内，自动并入已签到名单
    let confirmedUserIds = briefing.confirmedUserIds
    if (confirmedById) {
      try {
        const roster: string[] = briefing.briefedUserIds ? JSON.parse(briefing.briefedUserIds) : []
        const signed: string[] = briefing.confirmedUserIds ? JSON.parse(briefing.confirmedUserIds) : []
        if (roster.includes(confirmedById) && !signed.includes(confirmedById)) {
          signed.push(confirmedById)
          confirmedUserIds = JSON.stringify(signed)
        }
      } catch { /* 存量脏数据忽略 */ }
    }
    const updated = await db.briefing.update({
      where: { id: bid },
      data: {
        status: 'CONFIRMED',
        confirmedBy,
        confirmedById,
        confirmedUserIds,
        confirmedAt: now,
        confirmRemark: str(body.confirmRemark) || null,
      },
    })
    const actor = resolveActor(extractActor(body), confirmedBy)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'STATUS_CHANGE',
      entity: 'BRIEFING',
      entityId: bid,
      entityCode: briefing.ticketCode ?? '',
      detail: `${briefing.ticketCode ?? `交底#${bid}`}：待作业方确认 → 已确认（作业方确认交底，确认人：${confirmedBy}${briefing.pointCode ? `，隔离点 ${briefing.pointCode}` : ''}，该作业票具备开工条件）`,
    })
    // 通知交底方/审批相关角色：交底已确认
    await pushNotifications({
      targetRoles: ['GUARDIAN'],
      type: 'EXECUTE',
      title: '现场交底已确认',
      content: `${briefing.ticketCode ?? ''} 交底已被作业方（${confirmedBy}）确认，可安排开工`,
      bizType: 'TICKET',
      bizId: briefing.ticketId ?? undefined,
      bizCode: briefing.ticketCode ?? undefined,
      linkModule: 'mobile-preview',
    }).catch(() => null)
    return NextResponse.json({ briefing: updated })
  } catch (e) {
    console.error('[POST /api/briefings/[id]/confirm]', e)
    return jsonError(e instanceof Error ? e.message : '确认交底失败', 500)
  }
}
