import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, omitPassword, readBody, str } from '@/lib/bp-server-utils'
import { hashPassword, validatePasswordStrength } from '@/lib/password'

export const dynamic = 'force-dynamic'

/** GET /api/users → 用户列表（不含密码） */
export async function GET() {
  try {
    const users = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json(users.map(omitPassword))
  } catch (e) {
    console.error('[GET /api/users]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取用户列表失败' },
      { status: 500 }
    )
  }
}

/** POST /api/users 创建用户（用户名唯一） */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const username = str(body.username)
    const name = str(body.name)
    const role = str(body.role)
    if (!username || !name || !role) {
      return jsonError('用户名、姓名和角色不能为空')
    }
    const exists = await db.user.findUnique({ where: { username } })
    if (exists) return jsonError('用户名已存在', 409)
    const { actorId, actorName, body: rest } = extractActor(body)
    // 新密码强度策略（建号设了密码则校验；留空走默认演示密码逻辑）
    if (rest.password !== undefined && rest.password !== '') {
      const strength = validatePasswordStrength(String(rest.password))
      if (!strength.ok) return jsonError(strength.message, 400)
    }
    const user = await db.user.create({
      data: {
        username,
        name,
        role,
        password: rest.password !== undefined && rest.password !== '' ? hashPassword(String(rest.password)) : undefined,
        department: str(rest.department) || null,
        phone: str(rest.phone) || null,
        active: rest.active === undefined ? true : Boolean(rest.active),
      },
    })
    await logAudit({
      actorId, actorName, action: 'CREATE', entity: 'USER', entityId: user.id, entityCode: user.username,
      detail: `创建用户「${user.name}」（${user.role}）`,
    })
    return NextResponse.json(omitPassword(user), { status: 201 })
  } catch (e) {
    console.error('[POST /api/users]', e)
    return jsonError(e instanceof Error ? e.message : '创建用户失败', 500)
  }
}
