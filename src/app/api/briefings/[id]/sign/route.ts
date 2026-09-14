import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, num, readBody, resolveActor, str } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/**
 * POST /api/briefings/[id]/sign — 交底扫码签到（交底人扫被交底人「我的身份码」二维码）
 * body: { userId, name, __actorId/__actorName }
 * 校验：briefing 存在、PENDING、userId 必须在交底人指定的被交底名单（briefedUserIds）内——防冒名签到
 * 追加 confirmedUserIds（去重）；全员签到完成时自动 PENDING → CONFIRMED（confirmedBy=末位签到人，名单见 confirmedUserIds）并通知/留痕
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const bid = num(id)
    if (bid === null) return jsonError('无效的交底 ID')
    const briefing = await db.briefing.findUnique({ where: { id: bid } })
    if (!briefing) return jsonError('交底记录不存在', 404)
    if (briefing.status === 'CONFIRMED') return jsonError('该交底已全员签到确认，无需重复扫码')

    const body = await readBody(req)
    const userId = str(body.userId)
    const name = str(body.name)
    if (!userId || !name) return jsonError('身份码无效：缺少用户标识')

    // 名单校验：只允许交底人选定的被交底系统用户签到
    let roster: string[] = []
    try {
      roster = briefing.briefedUserIds ? (JSON.parse(briefing.briefedUserIds) as string[]) : []
    } catch { /* 存量脏数据视为空名单 */ }
    if (roster.length === 0) {
      return jsonError('该交底未指定被交底系统用户名单，请交底人在交底表单中选择后再扫码')
    }
    if (!roster.includes(userId)) {
      return jsonError(`${name} 不在该次交底的被交底名单内，无法签到`, 403)
    }

    let signed: string[] = []
    try {
      signed = briefing.confirmedUserIds ? (JSON.parse(briefing.confirmedUserIds) as string[]) : []
    } catch { signed = [] }
    if (signed.includes(userId)) return jsonError(`${name} 已签到，请扫描下一位被交底人的身份码`)

    signed.push(userId)
    const allDone = roster.every((u) => signed.includes(u))
    const now = new Date()

    const updated = await db.briefing.update({
      where: { id: bid },
      data: {
        confirmedUserIds: JSON.stringify(signed),
        ...(allDone
          ? {
              status: 'CONFIRMED',
              confirmedAt: now,
              confirmedBy: name,
            }
          : {}),
      },
    })

    const actor = resolveActor(extractActor(body), name)
    if (allDone) {
      await logAudit({
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'STATUS_CHANGE',
        entity: 'BRIEFING',
        entityId: bid,
        entityCode: briefing.ticketCode ?? '',
        detail: `${briefing.ticketCode ?? `交底#${bid}`}：待作业方确认 → 已确认（全员扫码签到完成（${signed.length}/${roster.length}，末位：${name}），交底生效，该作业票具备开工条件）`,
      })
      await pushNotifications({
        targetRoles: ['GUARDIAN'],
        type: 'EXECUTE',
        title: '现场交底已确认',
        content: `${briefing.ticketCode ?? ''} 交底全员扫码签到完成（${signed.length}/${roster.length}），可安排开工`,
        bizType: 'TICKET',
        bizId: briefing.ticketId ?? undefined,
        bizCode: briefing.ticketCode ?? undefined,
        linkModule: 'mobile-preview',
      }).catch(() => null)
    } else {
      await logAudit({
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'SIGN',
        entity: 'BRIEFING',
        entityId: bid,
        entityCode: briefing.ticketCode ?? '',
        detail: `${name} 扫码签到确认交底（${signed.length}/${roster.length}），等待其余被交底人签到`,
      })
    }

    return NextResponse.json({
      briefing: updated,
      signedCount: signed.length,
      rosterCount: roster.length,
      allDone,
    })
  } catch (e) {
    console.error('[POST /api/briefings/[id]/sign]', e)
    return jsonError(e instanceof Error ? e.message : '扫码签到失败', 500)
  }
}
