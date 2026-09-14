import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * 校验 parts JSON（图元编辑器保存的自定义图元组成部件）
 * 允许类型：六种工艺图元 + 五种基础图形；每个部件必须有 id/type/x/y/w/h
 */
function validateParts(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return '图元至少需要包含一个组成部件'
  const ALLOWED = new Set([
    'exchanger', 'reactor', 'column', 'pump', 'tank', 'valve',
    'rect', 'circle', 'ellipse', 'line', 'triangle', 'symbol',
  ])
  for (const p of raw) {
    if (!p || typeof p !== 'object') return '部件数据不合法'
    const o = p as Record<string, unknown>
    if (!ALLOWED.has(str(o.type))) return `不支持的部件类型：${str(o.type)}`
    for (const k of ['x', 'y', 'w', 'h']) {
      const n = Number(o[k])
      if (!Number.isFinite(n)) return '部件坐标/尺寸必须为数字'
    }
    if (str(o.id) === '') return '部件缺少 id'
  }
  return null
}

/** GET /api/pid-symbols → 自定义图元列表（按更新时间倒序） */
export async function GET() {
  try {
    const rows = await db.pidSymbol.findMany({ orderBy: { updatedAt: 'desc' } })
    return NextResponse.json({
      list: rows.map((r) => {
        let parts: unknown = []
        try {
          parts = JSON.parse(r.parts)
        } catch {
          parts = []
        }
        return { ...r, parts }
      }),
    })
  } catch (e) {
    console.error('[GET /api/pid-symbols]', e)
    return jsonError(e instanceof Error ? e.message : '获取自定义图元列表失败', 500)
  }
}

/**
 * POST /api/pid-symbols 创建自定义图元
 * body: { name, parts, designW?, designH?, basedOn?, createdBy? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const name = str(body.name)
    if (!name) return jsonError('图元名称不能为空')
    if (name.length > 40) return jsonError('图元名称不能超过 40 个字符')
    let parts: unknown = body.parts
    if (typeof parts === 'string') {
      try {
        parts = JSON.parse(parts)
      } catch {
        return jsonError('parts 必须为合法的 JSON')
      }
    }
    const invalid = validateParts(parts)
    if (invalid) return jsonError(invalid)
    const dup = await db.pidSymbol.findUnique({ where: { name } })
    if (dup) return jsonError(`图元名称「${name}」已存在，请换个名称`, 409)
    const designW = Number(body.designW)
    const designH = Number(body.designH)
    const symbol = await db.pidSymbol.create({
      data: {
        name,
        basedOn: str(body.basedOn) || null,
        designW: Number.isFinite(designW) && designW > 0 ? Math.round(designW) : 200,
        designH: Number.isFinite(designH) && designH > 0 ? Math.round(designH) : 200,
        parts: JSON.stringify(parts),
        createdBy: str(body.createdBy) || null,
      },
    })
    return NextResponse.json(symbol, { status: 201 })
  } catch (e) {
    console.error('[POST /api/pid-symbols]', e)
    return jsonError(e instanceof Error ? e.message : '创建自定义图元失败', 500)
  }
}
