import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError, num, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/equipments?keyword=&unitId= → 设备主数据列表（含 unitName 与关联管线数 pipeCount，keyword 模糊匹配 code/name） */
export async function GET(req: NextRequest) {
  try {
    const keyword = req.nextUrl.searchParams.get('keyword') ?? undefined
    const unitId = num(req.nextUrl.searchParams.get('unitId') ?? undefined)
    const where: Prisma.EquipmentWhereInput = {}
    if (keyword) {
      where.OR = [{ code: { contains: keyword } }, { name: { contains: keyword } }]
    }
    if (unitId !== null) where.unitId = unitId
    const equipments = await db.equipment.findMany({
      where,
      orderBy: { code: 'asc' },
      include: { unit: true, _count: { select: { pipeStarts: true, pipeEnds: true } } },
    })
    return NextResponse.json({
      list: equipments.map((e) => {
        const { _count, ...rest } = e
        return {
          ...rest,
          unitName: e.unit?.name ?? null,
          pipeCount: _count.pipeStarts + _count.pipeEnds,
        }
      }),
    })
  } catch (e) {
    console.error('[GET /api/equipments]', e)
    return jsonError(e instanceof Error ? e.message : '获取设备列表失败', 500)
  }
}

/**
 * POST /api/equipments 创建设备主数据
 * body: { code, name, type, unitId?, remark? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const code = str(body.code)
    const name = str(body.name)
    const type = str(body.type) || 'OTHER'
    if (!code || !name) return jsonError('设备位号和名称不能为空')
    if (body.unitId !== undefined && body.unitId !== null && str(body.unitId) !== '' && num(body.unitId) === null) {
      return jsonError('unitId 必须为数字')
    }
    const unitId = num(body.unitId)
    if (unitId !== null) {
      const unit = await db.unit.findUnique({ where: { id: unitId } })
      if (!unit) return jsonError('关联装置不存在')
    }
    const exists = await db.equipment.findUnique({ where: { code } })
    if (exists) return jsonError('设备位号已存在', 409)
    const equipment = await db.equipment.create({
      data: { code, name, type, unitId, remark: str(body.remark) || null },
      include: { unit: true },
    })
    return NextResponse.json({ item: { ...equipment, unitName: equipment.unit?.name ?? null } }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/equipments]', e)
    return jsonError(e instanceof Error ? e.message : '创建设备失败', 500)
  }
}
