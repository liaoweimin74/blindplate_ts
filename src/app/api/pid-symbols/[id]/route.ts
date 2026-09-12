import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/pid-symbols/[id] → 单个自定义图元（含解析后的 parts） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sid = parseId(id)
    if (!sid) return jsonError('无效的图元 ID')
    const row = await db.pidSymbol.findUnique({ where: { id: sid } })
    if (!row) return jsonError('自定义图元不存在', 404)
    let parts: unknown = []
    try {
      parts = JSON.parse(row.parts)
    } catch {
      parts = []
    }
    return NextResponse.json({ item: { ...row, parts } })
  } catch (e) {
    console.error('[GET /api/pid-symbols/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '获取自定义图元失败', 500)
  }
}

/** PUT /api/pid-symbols/[id] 更新自定义图元（name/parts/designW/designH） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sid = parseId(id)
    if (!sid) return jsonError('无效的图元 ID')
    const existing = await db.pidSymbol.findUnique({ where: { id: sid } })
    if (!existing) return jsonError('自定义图元不存在', 404)
    const body = await readBody(req)
    const data: {
      name?: string
      basedOn?: string | null
      designW?: number
      designH?: number
      parts?: string
    } = {}
    if (body.name !== undefined) {
      const name = str(body.name)
      if (!name) return jsonError('图元名称不能为空')
      if (name.length > 40) return jsonError('图元名称不能超过 40 个字符')
      if (name !== existing.name) {
        const dup = await db.pidSymbol.findUnique({ where: { name } })
        if (dup) return jsonError(`图元名称「${name}」已存在，请换个名称`, 409)
      }
      data.name = name
    }
    if (body.parts !== undefined) {
      let parts: unknown = body.parts
      if (typeof parts === 'string') {
        try {
          parts = JSON.parse(parts)
        } catch {
          return jsonError('parts 必须为合法的 JSON')
        }
      }
      if (!Array.isArray(parts) || parts.length === 0) return jsonError('图元至少需要包含一个组成部件')
      data.parts = JSON.stringify(parts)
    }
    if (body.designW !== undefined) {
      const n = Number(body.designW)
      if (Number.isFinite(n) && n > 0) data.designW = Math.round(n)
    }
    if (body.designH !== undefined) {
      const n = Number(body.designH)
      if (Number.isFinite(n) && n > 0) data.designH = Math.round(n)
    }
    if (body.basedOn !== undefined) data.basedOn = str(body.basedOn) || null
    const symbol = await db.pidSymbol.update({ where: { id: sid }, data })
    return NextResponse.json(symbol)
  } catch (e) {
    console.error('[PUT /api/pid-symbols/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新自定义图元失败', 500)
  }
}

/** DELETE /api/pid-symbols/[id] 删除自定义图元（已放置到画布的实例因内嵌快照不受影响） */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sid = parseId(id)
    if (!sid) return jsonError('无效的图元 ID')
    const existing = await db.pidSymbol.findUnique({ where: { id: sid } })
    if (!existing) return jsonError('自定义图元不存在', 404)
    await db.pidSymbol.delete({ where: { id: sid } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/pid-symbols/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '删除自定义图元失败', 500)
  }
}
