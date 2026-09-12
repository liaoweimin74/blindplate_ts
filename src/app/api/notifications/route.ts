import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readBody } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/**
 * GET /api/notifications?userId=&role=&limit=50
 * 返回当前用户可见通知（精确推送 + 角色广播 + 全员广播）与未读数
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const userId = sp.get('userId')
    const role = sp.get('role')
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 100)
    if (!userId && !role) return jsonError('userId 与 role 至少传一个')

    const scope = {
      OR: [
        ...(userId ? [{ userId }] : []),
        ...(role ? [{ userId: null, targetRole: role }] : []),
        { userId: null, targetRole: null },
      ],
    }
    const [notifications, unread] = await Promise.all([
      db.notification.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: limit }),
      db.notification.count({ where: { ...scope, readAt: null } }),
    ])
    return NextResponse.json({ notifications, unread })
  } catch (e) {
    console.error('[GET /api/notifications]', e)
    return jsonError(e instanceof Error ? e.message : '获取通知失败', 500)
  }
}

/**
 * POST /api/notifications
 * { targetRoles?, userIds?, type, title, content, bizType?, bizId?, bizCode?, linkModule?, linkTab? }
 * 创建通知（系统事件 / 管理员公告）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!title) return jsonError('title 不能为空')
    const type = ['APPROVAL', 'STATUS', 'ALERT', 'EXECUTE', 'SYSTEM'].includes(body.type) ? body.type : 'SYSTEM'
    const targetRoles = Array.isArray(body.targetRoles) ? body.targetRoles.filter((r: unknown) => typeof r === 'string' && r) : []
    const userIds = Array.isArray(body.userIds) ? body.userIds.filter((r: unknown) => typeof r === 'string' && r) : []
    const broadcastAll = Boolean(body.all)
    if (!broadcastAll && !targetRoles.length && !userIds.length) return jsonError('targetRoles / userIds / all 至少一个')

    const payload = {
      type,
      title,
      content,
      bizType: typeof body.bizType === 'string' ? body.bizType : undefined,
      bizId: typeof body.bizId === 'number' ? body.bizId : undefined,
      bizCode: typeof body.bizCode === 'string' ? body.bizCode : undefined,
      linkModule: typeof body.linkModule === 'string' ? body.linkModule : undefined,
      linkTab: typeof body.linkTab === 'string' ? body.linkTab : undefined,
    }
    if (broadcastAll) {
      // 全员广播：targetRole 与 userId 均为空
      try {
        await db.notification.create({ data: { ...payload, userId: null, targetRole: null } })
      } catch (e) {
        console.error('[POST /api/notifications] broadcast failed:', e)
        return jsonError('创建全员广播失败', 500)
      }
    } else {
      await pushNotifications({ ...payload, targetRoles, userIds })
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/notifications]', e)
    return jsonError(e instanceof Error ? e.message : '创建通知失败', 500)
  }
}
