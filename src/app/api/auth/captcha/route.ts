import { NextResponse } from 'next/server'
import { issueCaptcha } from '@/lib/captcha'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/captcha
 * 签发图形验证码：{ captchaId, svg }（明文 code 不出参，仅存内存待 login 校验）
 * 5 分钟有效、一次性使用；前端点击图片重新获取
 */
export async function GET() {
  try {
    const { id, svg } = issueCaptcha()
    return NextResponse.json(
      { captchaId: id, svg },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    console.error('[GET /api/auth/captcha]', e)
    return NextResponse.json({ error: '验证码生成失败' }, { status: 500 })
  }
}
