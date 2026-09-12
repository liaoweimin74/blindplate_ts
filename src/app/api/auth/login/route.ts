import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, omitPassword, readBody, str } from '@/lib/bp-server-utils'
import { hashPassword, verifyPassword } from '@/lib/password'
import { verifyCaptcha } from '@/lib/captcha'

export const dynamic = 'force-dynamic'

const MAX_FAILED = 5 // 连续失败上限
const LOCK_MINUTES = 10 // 锁定时长（分钟）

/** POST /api/auth/login { username, password, captchaId, captchaCode } → 用户对象（不含密码） */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const username = str(body.username)
    const password = str(body.password)
    if (!username || !password) {
      return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400 })
    }

    // 图形验证码校验（一次性，先于账号查询以防撞库/枚举）
    const captchaId = str(body.captchaId)
    const captchaCode = str(body.captchaCode)
    if (!captchaId || !captchaCode) {
      return NextResponse.json({ error: '请输入图形验证码' }, { status: 400 })
    }
    if (!verifyCaptcha(captchaId, captchaCode)) {
      return NextResponse.json({ error: '验证码错误或已过期，请点击图片刷新后重试' }, { status: 400 })
    }
    const user = await db.user.findUnique({ where: { username } })
    if (!user) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
    }

    // 登录锁定检查
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainMin = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000))
      return NextResponse.json(
        { error: `连续登录失败次数过多，账号已锁定，请约 ${remainMin} 分钟后再试` },
        { status: 423 },
      )
    }

    const { ok, needsUpgrade } = verifyPassword(password, user.password)
    if (!ok) {
      const failedAttempts = user.failedAttempts + 1
      const lock = failedAttempts >= MAX_FAILED
      await db.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: lock ? 0 : failedAttempts,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
        },
      })
      if (lock) {
        await logAudit({
          actorId: user.id, actorName: user.name, action: 'LOGIN', entity: 'AUTH',
          entityId: user.id, entityCode: user.username,
          detail: `账号因连续 ${MAX_FAILED} 次密码错误被锁定 ${LOCK_MINUTES} 分钟`,
        })
        return NextResponse.json(
          { error: `连续登录失败 ${MAX_FAILED} 次，账号已锁定 ${LOCK_MINUTES} 分钟` },
          { status: 423 },
        )
      }
      const remain = MAX_FAILED - failedAttempts
      return NextResponse.json(
        { error: `用户名或密码错误${remain <= 2 ? `（还可尝试 ${remain} 次，超限将锁定 10 分钟）` : ''}` },
        { status: 401 },
      )
    }

    if (!user.active) {
      return NextResponse.json({ error: '该账号已被停用' }, { status: 403 })
    }

    // 存量明文透明升级为 scrypt 哈希；同时清零失败计数
    await db.user.update({
      where: { id: user.id },
      data: {
        ...(needsUpgrade ? { password: hashPassword(password) } : {}),
        failedAttempts: 0,
        lockedUntil: null,
      },
    })

    await logAudit({
      actorId: user.id, actorName: user.name, action: 'LOGIN', entity: 'AUTH',
      entityId: user.id, entityCode: user.username,
      detail: `用户「${user.name}」（${user.role}）登录系统`,
    })
    return NextResponse.json(omitPassword(user))
  } catch (e) {
    console.error('[POST /api/auth/login]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '登录失败' },
      { status: 500 }
    )
  }
}
