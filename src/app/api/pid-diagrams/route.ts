import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, readBody, str } from '@/lib/bp-server-utils'
import { normalizePidContent, parsePidContent } from '@/lib/bp-types'

export const dynamic = 'force-dynamic'

/** GET /api/pid-diagrams → PID 组态图列表（含 unitName 与 shapeCount/markCount/connCount 统计，按更新时间倒序） */
export async function GET() {
  try {
    const diagrams = await db.pidDiagram.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { unit: true },
    })
    return NextResponse.json({
      list: diagrams.map((d) => {
        const content = parsePidContent(d.content)
        return {
          ...d,
          content: undefined,
          unitName: d.unit?.name ?? null,
          shapeCount: content.shapes.length,
          markCount: content.marks.length,
          connCount: content.connections.length,
        }
      }),
    })
  } catch (e) {
    console.error('[GET /api/pid-diagrams]', e)
    return jsonError(e instanceof Error ? e.message : '获取 PID 图列表失败', 500)
  }
}

/**
 * POST /api/pid-diagrams 创建 PID 组态图
 * body: { name, unitId?, content?, createdBy? }（content 为 JSON 字符串或对象，默认 "{}"）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const name = str(body.name)
    if (!name) return jsonError('图名不能为空')
    if (body.unitId !== undefined && body.unitId !== null && str(body.unitId) !== '' && num(body.unitId) === null) {
      return jsonError('unitId 必须为数字')
    }
    const unitId = num(body.unitId)
    if (unitId !== null) {
      const unit = await db.unit.findUnique({ where: { id: unitId } })
      if (!unit) return jsonError('关联装置不存在')
    }
    let content = '{}'
    if (body.content !== undefined && body.content !== null && str(body.content) !== '') {
      const normalized = normalizePidContent(body.content)
      if (!normalized) return jsonError('content 必须为合法的 JSON 对象')
      content = normalized
    }
    const diagram = await db.pidDiagram.create({
      data: { name, unitId, content, createdBy: str(body.createdBy) || null },
    })
    return NextResponse.json(diagram, { status: 201 })
  } catch (e) {
    console.error('[POST /api/pid-diagrams]', e)
    return jsonError(e instanceof Error ? e.message : '创建 PID 图失败', 500)
  }
}
