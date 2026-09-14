// 盲板管理系统 - 图形验证码（零依赖：内存存储 + 手写 SVG）
// 设计要点：
// - 4 位字符（去除 0/O/1/I/L 易混淆字符），5 分钟有效、一次性使用、大小写不敏感
// - 内存 Map 存储（单进程演示环境足够；进程重启后验证码失效，前端点图刷新即可）
// - SVG 手绘：随机旋转/偏移/配色字符 + 噪声曲线 + 噪点，色板仅用项目安全色（emerald/teal/amber/rose/stone/violet 深色系）
export interface CaptchaIssue {
  id: string
  code: string
  svg: string
}

const CODE_LEN = 4
const TTL_MS = 5 * 60 * 1000
// 去除易混淆：0/O、1/I/L、2 与 Z 相近但保留 Z 无碍（仅剔除最易混淆的 0O1lI）
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
// 深色系安全色板（严禁 indigo/blue 的项目约束同样适用于验证码）
const PALETTE = ['#047857', '#0f766e', '#b45309', '#9f1239', '#44403c', '#6d28d9'] as const

// 关键：Next.js 各路由 bundle 的模块实例相互独立（dev 下尤其明显），
// 必须挂到 globalThis 形成进程级单例，否则签发路由写入的码在 login 路由里读不到
interface CaptchaRecord { code: string; expiresAt: number }
const g = globalThis as unknown as { __bpCaptchaStore?: Map<string, CaptchaRecord> }
const store: Map<string, CaptchaRecord> = g.__bpCaptchaStore ?? (g.__bpCaptchaStore = new Map())

/** 清理过期项（惰性触发，避免定时器） */
function cleanup(): void {
  const now = Date.now()
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k)
  }
}

/** 随机整数 [min, max] */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** 生成验证码：返回 id / 明文（仅供签发路由摘除明文）/ SVG 图像 */
export function issueCaptcha(): CaptchaIssue {
  cleanup()
  let code = ''
  for (let i = 0; i < CODE_LEN; i++) code += CHARS[randInt(0, CHARS.length - 1)]
  const id = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  store.set(id, { code, expiresAt: Date.now() + TTL_MS })
  return { id, code, svg: renderSvg(code) }
}

/**
 * 校验验证码（一次性：无论成败立即销毁，防重放）
 * @returns 是否通过
 */
export function verifyCaptcha(id: string, input: string): boolean {
  cleanup()
  const key = String(id ?? '')
  const rec = key ? store.get(key) : undefined
  if (key) store.delete(key)
  if (!rec) return false
  if (rec.expiresAt < Date.now()) return false
  return String(input ?? '').trim().toUpperCase() === rec.code.toUpperCase()
}

/** 当前内存中有效验证码数量（测试用） */
export function captchaStoreSize(): number {
  cleanup()
  return store.size
}

const W = 112
const H = 36

/** 手绘 SVG：噪点 → 噪声曲线 → 字符（后画的盖前画的，字符最上层） */
function renderSvg(code: string): string {
  const parts: string[] = []
  // 噪点
  for (let i = 0; i < 14; i++) {
    parts.push(
      `<circle cx="${randInt(2, W - 2)}" cy="${randInt(2, H - 2)}" r="${(Math.random() * 0.9 + 0.5).toFixed(1)}" fill="${pick(PALETTE)}" opacity="${(Math.random() * 0.25 + 0.15).toFixed(2)}"/>`,
    )
  }
  // 噪声曲线 ×3（贝塞尔）
  for (let i = 0; i < 3; i++) {
    const y1 = randInt(4, H - 4)
    const y2 = randInt(4, H - 4)
    parts.push(
      `<path d="M ${randInt(-6, 8)} ${y1} C ${randInt(W * 0.15, W * 0.35)} ${randInt(2, H - 2)}, ${randInt(W * 0.55, W * 0.8)} ${randInt(2, H - 2)}, ${W - randInt(-6, 8)} ${y2}" stroke="${pick(PALETTE)}" stroke-width="1" fill="none" opacity="0.45" stroke-linecap="round"/>`,
    )
  }
  // 字符：逐个随机字号/旋转/纵向抖动/配色
  const charW = (W - 16) / CODE_LEN
  const glyphs = code.split('').map((ch, i) => {
    const size = randInt(19, 23)
    const x = 8 + charW * i + randInt(0, 3)
    const y = H / 2 + size * 0.36 + randInt(-2, 2)
    const rot = randInt(-18, 18)
    return `<text x="${x}" y="${y.toFixed(1)}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="700" fill="${pick(PALETTE)}" transform="rotate(${rot} ${(x + charW / 2 - 4).toFixed(1)} ${(H / 2).toFixed(1)})">${ch}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="图形验证码"><rect width="${W}" height="${H}" rx="6" fill="#fafaf9"/>${parts.join('')}${glyphs.join('')}</svg>`
}
