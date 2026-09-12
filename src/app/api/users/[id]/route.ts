import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, omitPassword, readBody, str } from '@/lib/bp-server-utils'
import { hashPassword, validatePasswordStrength } from '@/lib/password'

export const dynamic = 'force-dynamic'

/** PUT /api/users/[id] 更新用户（User.id 为 cuid 字符串） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) return jsonError('用户不存在', 404)
    const { actorId, actorName, body } = extractActor(await readBody(req))

    const data: {
      username?: string
      name?: string
      role?: string
      department?: string | null
      phone?: string | null
      active?: boolean
      password?: string
    } = {}
    if (body.username !== undefined) {
      const username = str(body.username)
      if (!username) return jsonError('用户名不能为空')
      data.username = username
    }
    if (body.name !== undefined) {
      const name = str(body.name)
      if (!name) return jsonError('姓名不能为空')
      data.name = name
    }
    if (body.role !== undefined) data.role = str(body.role)
    if (body.department !== undefined) data.department = str(body.department) || null
    if (body.phone !== undefined) data.phone = str(body.phone) || null
    if (body.active !== undefined) data.active = Boolean(body.active)
    if (body.password !== undefined && body.password !== '') {
      const strength = validatePasswordStrength(String(body.password))
      if (!strength.ok) return jsonError(strength.message, 400)
      data.password = hashPassword(String(body.password))
    }

    if (data.username && data.username !== existing.username) {
      const dup = await db.user.findFirst({ where: { username: data.username, NOT: { id } } })
      if (dup) return jsonError('用户名已存在', 409)
    }

    const user = await db.user.update({ where: { id }, data })
    await logAudit({
      actorId, actorName, action: 'UPDATE', entity: 'USER', entityId: id, entityCode: user.username,
      detail: `更新用户「${user.name}」（${user.role}）${body.password ? '，并重置了密码' : ''}`,
    })
    return NextResponse.json(omitPassword(user))
  } catch (e) {
    console.error('[PUT /api/users/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新用户失败', 500)
  }
}

/** DELETE /api/users/[id] 硬删除用户（操作者经 query 传递） */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) return jsonError('用户不存在', 404)
    const sp = new URL(req.url).searchParams
    const actorId = sp.get('__actorId')
    const actorName = sp.get('__actorName') || '未知用户'
    await db.user.delete({ where: { id } })
    await logAudit({
      actorId, actorName, action: 'DELETE', entity: 'USER', entityId: id, entityCode: existing.username,
      detail: `删除用户「${existing.name}」（${existing.role}）`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/users/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '删除用户失败', 500)
  }
}
