import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** PUT /api/blind-plates/[id] 更新盲板台账 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const pid = parseId(id)
    if (!pid) return jsonError('无效的盲板 ID')
    const existing = await db.blindPlate.findUnique({ where: { id: pid } })
    if (!existing) return jsonError('盲板不存在', 404)
    const body = await readBody(req)

    const data: {
      spec?: string
      type?: string
      material?: string
      thickness?: number
      pressureRating?: string
      status?: string
      location?: string | null
      unitId?: number | null
    } = {}
    if (body.spec !== undefined) {
      const spec = str(body.spec)
      if (!spec) return jsonError('规格不能为空')
      data.spec = spec
    }
    if (body.type !== undefined) {
      const type = str(body.type)
      if (!type) return jsonError('类型不能为空')
      data.type = type
    }
    if (body.material !== undefined) {
      const material = str(body.material)
      if (!material) return jsonError('材质不能为空')
      data.material = material
    }
    if (body.thickness !== undefined) {
      const thickness = num(body.thickness)
      if (thickness === null) return jsonError('厚度必须为数字')
      data.thickness = thickness
    }
    if (body.pressureRating !== undefined) {
      const pressureRating = str(body.pressureRating)
      if (!pressureRating) return jsonError('压力等级不能为空')
      data.pressureRating = pressureRating
    }
    if (body.status !== undefined) data.status = str(body.status)
    if (body.location !== undefined) data.location = str(body.location) || null
    if (body.unitId !== undefined) data.unitId = num(body.unitId)

    const plate = await db.blindPlate.update({ where: { id: pid }, data })
    return NextResponse.json(plate)
  } catch (e) {
    console.error('[PUT /api/blind-plates/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新盲板失败', 500)
  }
}
