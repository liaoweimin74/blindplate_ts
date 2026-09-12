import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, logAudit, parseId } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/announcements/[id]
 * 撤回（删除）管理员公告
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const nid = parseId(id)
    if (nid === null) return jsonError('无效的公告 ID')

    const existing = await db.notification.findUnique({ where: { id: nid } })
    if (!existing || existing.bizType !== 'ANNOUNCEMENT' || existing.userId !== null || existing.targetRole !== null) {
      return jsonError('公告不存在或已被撤回', 404)
    }
    const sp = new URL(req.url).searchParams
    await db.notification.delete({ where: { id: nid } })
    await logAudit({
      actorId: sp.get('__actorId'), actorName: sp.get('__actorName') || '未知用户',
      action: 'WITHDRAW', entity: 'ANNOUNCEMENT', entityId: nid, entityCode: existing.title,
      detail: `撤回系统公告「${existing.title}」`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/announcements/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '撤回公告失败', 500)
  }
}
