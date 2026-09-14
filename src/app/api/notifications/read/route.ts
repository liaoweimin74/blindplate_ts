import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readBody } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/notifications/read
 * { ids?: number[] }                        → 标记指定通知已读
 * { all: true, userId?, role? }             → 当前用户可见范围全部已读
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const userId = typeof body.userId === 'string' ? body.userId : ''
    const role = typeof body.role === 'string' ? body.role : ''
    const scope = {
      OR: [
        ...(userId ? [{ userId }] : []),
        ...(role ? [{ userId: null, targetRole: role }] : []),
        { userId: null, targetRole: null },
      ],
    }

    if (body.all) {
      const result = await db.notification.updateMany({
        where: { ...scope, readAt: null },
        data: { readAt: new Date() },
      })
      return NextResponse.json({ ok: true, updated: result.count })
    }

    const ids = Array.isArray(body.ids) ? body.ids.map((v: unknown) => Number(v)).filter((v: number) => Number.isInteger(v) && v > 0) : []
    if (!ids.length) return jsonError('ids 不能为空（或传 all:true 全部已读）')
    const result = await db.notification.updateMany({
      where: { id: { in: ids }, ...scope, readAt: null },
      data: { readAt: new Date() },
    })
    return NextResponse.json({ ok: true, updated: result.count })
  } catch (e) {
    console.error('[POST /api/notifications/read]', e)
    return jsonError(e instanceof Error ? e.message : '标记已读失败', 500)
  }
}
