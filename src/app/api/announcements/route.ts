import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, readBody } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/announcements
 * 列出全部管理员公告（全员广播：userId=null & targetRole=null & SYSTEM/ANNOUNCEMENT）
 */
export async function GET() {
  try {
    const announcements = await db.notification.findMany({
      where: { userId: null, targetRole: null, type: 'SYSTEM', bizType: 'ANNOUNCEMENT' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ announcements })
  } catch (e) {
    console.error('[GET /api/announcements]', e)
    return jsonError(e instanceof Error ? e.message : '获取公告失败', 500)
  }
}

/**
 * POST /api/announcements  { title, content }
 * 发布管理员公告 → 全员广播通知（消息中心可见）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const { actorId, actorName, body: rest } = extractActor(body)
    const title = typeof rest.title === 'string' ? rest.title.trim() : ''
    const content = typeof rest.content === 'string' ? rest.content.trim() : ''
    if (!title) return jsonError('公告标题不能为空')
    if (title.length > 60) return jsonError('公告标题不能超过 60 字')
    if (!content) return jsonError('公告内容不能为空')
    if (content.length > 1000) return jsonError('公告内容不能超过 1000 字')

    const announcement = await db.notification.create({
      data: {
        type: 'SYSTEM',
        bizType: 'ANNOUNCEMENT',
        title,
        content,
        userId: null,
        targetRole: null,
      },
    })
    await logAudit({
      actorId, actorName, action: 'PUBLISH', entity: 'ANNOUNCEMENT', entityId: announcement.id, entityCode: title,
      detail: `发布系统公告「${title}」（全员广播）`,
    })
    return NextResponse.json({ announcement }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/announcements]', e)
    return jsonError(e instanceof Error ? e.message : '发布公告失败', 500)
  }
}
