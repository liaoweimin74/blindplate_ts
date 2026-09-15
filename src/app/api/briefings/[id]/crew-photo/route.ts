import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, num, readBody, resolveActor, str } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/**
 * POST /api/briefings/[id]/crew-photo — 人证核验补拍（需求 17 photoGap 兜底路径）
 * body: { userId, photoUrl, name?, __actorId/__actorName }
 * 场景：签到时漏拍（photoGap>0）或照片无效重拍；补齐后若全员齐备自动置 CONFIRMED
 * 校验：briefing 存在且 PENDING、userId 在名单内且已签到
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const bid = num(id)
    if (bid === null) return jsonError('无效的交底 ID')
    const briefing = await db.briefing.findUnique({ where: { id: bid } })
    if (!briefing) return jsonError('交底记录不存在', 404)
    if (briefing.status === 'CONFIRMED') return jsonError('该交底已全员签到确认且人证拍照齐备，无需补拍')

    const body = await readBody(req)
    const userId = str(body.userId)
    const photoUrl = str(body.photoUrl)
    if (!userId || !photoUrl) return jsonError('缺少被交底人标识或现场照片')

    let roster: string[] = []
    try {
      roster = briefing.briefedUserIds ? (JSON.parse(briefing.briefedUserIds) as string[]) : []
    } catch { roster = [] }
    if (!roster.includes(userId)) return jsonError('该人员不在被交底名单内', 403)

    let signed: string[] = []
    try {
      signed = briefing.confirmedUserIds ? (JSON.parse(briefing.confirmedUserIds) as string[]) : []
    } catch { signed = [] }
    if (!signed.includes(userId)) return jsonError('该人员尚未扫码签到，请先签到再拍照留痕')

    // 名单内取实名（调用方传 name 优先，否则退 userId）
    const realName = str(body.name) || userId
    const now = new Date()
    let crewPhotos: Record<string, { photoUrl: string; verifiedName: string; verifiedAt: string }> = {}
    try { crewPhotos = briefing.crewPhotos ? (JSON.parse(briefing.crewPhotos) as typeof crewPhotos) : {} } catch { crewPhotos = {} }
    crewPhotos[userId] = { photoUrl, verifiedName: realName, verifiedAt: now.toISOString() }

    const allSigned = roster.every((u) => signed.includes(u))
    const photoGap = roster.filter((u) => signed.includes(u) && !crewPhotos[u]).length
    const allDone = allSigned && photoGap === 0

    const updated = await db.briefing.update({
      where: { id: bid },
      data: {
        crewPhotos: JSON.stringify(crewPhotos),
        ...(allDone
          ? {
              status: 'CONFIRMED',
              confirmedAt: now,
              confirmedBy: '人证核验齐备',
            }
          : {}),
      },
    })

    const actor = resolveActor(extractActor(body), realName)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'SIGN',
      entity: 'BRIEFING',
      entityId: bid,
      entityCode: briefing.ticketCode ?? '',
      detail: allDone
        ? `人证核验拍照补齐（${signed.length}/${roster.length}），全员齐备交底自动生效`
        : `${realName} 人证核验拍照留痕，当前 photoGap=${photoGap}（已签到缺拍照人数）`,
    }).catch(() => null)

    if (allDone) {
      await pushNotifications({
        targetRoles: ['GUARDIAN'],
        type: 'EXECUTE',
        title: '现场交底已确认',
        content: `${briefing.ticketCode ?? ''} 交底全员签到且人证核验拍照补齐（${signed.length}/${roster.length}），可安排开工`,
        bizType: 'TICKET',
        bizId: briefing.ticketId ?? undefined,
        bizCode: briefing.ticketCode ?? undefined,
        linkModule: 'mobile-preview',
      }).catch(() => null)
    }

    return NextResponse.json({
      briefing: updated,
      signedCount: signed.length,
      rosterCount: roster.length,
      allDone,
      allSigned,
      photoGap,
    })
  } catch (e) {
    console.error('[POST /api/briefings/[id]/crew-photo]', e)
    return jsonError(e instanceof Error ? e.message : '人证核验拍照提交失败', 500)
  }
}
