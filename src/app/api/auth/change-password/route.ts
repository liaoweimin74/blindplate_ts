import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, readBody, str } from '@/lib/bp-server-utils'
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/lib/password'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/change-password  { userId, oldPassword, newPassword }
 * 用户自助修改登录密码（校验旧密码）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const userId = str(body.userId)
    const oldPassword = str(body.oldPassword)
    const newPassword = str(body.newPassword)
    if (!userId || !oldPassword || !newPassword) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 })
    }
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }
    const { ok } = verifyPassword(oldPassword, user.password)
    if (!ok) {
      return NextResponse.json({ error: '旧密码不正确' }, { status: 400 })
    }
    // 新密码强度策略（≥8 位 + 字母 + 数字；存量演示密码不受影响，仅约束新密码）
    const strength = validatePasswordStrength(newPassword)
    if (!strength.ok) {
      return NextResponse.json({ error: strength.message }, { status: 400 })
    }
    if (newPassword === oldPassword) {
      return NextResponse.json({ error: '新密码不能与旧密码相同' }, { status: 400 })
    }
    await db.user.update({ where: { id: userId }, data: { password: hashPassword(newPassword), failedAttempts: 0, lockedUntil: null } })
    await logAudit({
      actorId: user.id, actorName: user.name, action: 'PASSWORD_CHANGE', entity: 'AUTH',
      entityId: user.id, entityCode: user.username,
      detail: `用户「${user.name}」自助修改了登录密码`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[POST /api/auth/change-password]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '修改密码失败' },
      { status: 500 }
    )
  }
}
