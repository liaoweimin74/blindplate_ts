import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError, num, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/pipelines?keyword= → 管线主数据列表（含 unitName 与关联隔离点数 pointCount，keyword 模糊匹配 code/name） */
export async function GET(req: NextRequest) {
  try {
    const keyword = req.nextUrl.searchParams.get('keyword') ?? undefined
    const where: Prisma.PipelineWhereInput = {}
    if (keyword) {
      where.OR = [{ code: { contains: keyword } }, { name: { contains: keyword } }]
    }
    const pipelines = await db.pipeline.findMany({
      where,
      orderBy: { code: 'asc' },
      include: {
        unit: true,
        startEquipment: { select: { id: true, code: true, name: true } },
        endEquipment: { select: { id: true, code: true, name: true } },
        _count: { select: { points: true } },
      },
    })
    return NextResponse.json({
      list: pipelines.map((p) => {
        const { _count, startEquipment, endEquipment, ...rest } = p
        return {
          ...rest,
          unitName: p.unit?.name ?? null,
          pointCount: _count.points,
          startEquipment: startEquipment ?? null,
          endEquipment: endEquipment ?? null,
        }
      }),
    })
  } catch (e) {
    console.error('[GET /api/pipelines]', e)
    return jsonError(e instanceof Error ? e.message : '获取管线列表失败', 500)
  }
}

/**
 * POST /api/pipelines 创建管线主数据
 * body: { code, name, unitId?, medium?, pressure?, material?, spec?, remark?, startEquipmentId?, endEquipmentId? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const code = str(body.code)
    const name = str(body.name)
    if (!code || !name) return jsonError('管线编码和名称不能为空')
    if (body.unitId !== undefined && body.unitId !== null && str(body.unitId) !== '' && num(body.unitId) === null) {
      return jsonError('unitId 必须为数字')
    }
    const unitId = num(body.unitId)
    if (unitId !== null) {
      const unit = await db.unit.findUnique({ where: { id: unitId } })
      if (!unit) return jsonError('关联装置不存在')
    }
    const equipmentIds: (number | null)[] = []
    for (const key of ['startEquipmentId', 'endEquipmentId'] as const) {
      if (body[key] !== undefined && body[key] !== null && str(body[key]) !== '' && num(body[key]) === null) {
        return jsonError(`${key} 必须为数字`)
      }
      const v = num(body[key])
      if (v !== null) {
        const eq = await db.equipment.findUnique({ where: { id: v } })
        if (!eq) return jsonError('起点/终点设备不存在')
      }
      equipmentIds.push(v)
    }
    const exists = await db.pipeline.findUnique({ where: { code } })
    if (exists) return jsonError('管线编码已存在', 409)
    const pipeline = await db.pipeline.create({
      data: {
        code,
        name,
        unitId,
        medium: str(body.medium) || null,
        pressure: str(body.pressure) || null,
        material: str(body.material) || null,
        spec: str(body.spec) || null,
        remark: str(body.remark) || null,
        startEquipmentId: equipmentIds[0],
        endEquipmentId: equipmentIds[1],
      },
    })
    return NextResponse.json(pipeline, { status: 201 })
  } catch (e) {
    console.error('[POST /api/pipelines]', e)
    return jsonError(e instanceof Error ? e.message : '创建管线失败', 500)
  }
}
