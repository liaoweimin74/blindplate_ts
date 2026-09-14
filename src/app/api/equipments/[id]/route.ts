import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/equipments/[id] → 设备详情（含 unitName 与关联管线摘要） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const eid = parseId(id)
    if (!eid) return jsonError('无效的设备 ID')
    const equipment = await db.equipment.findUnique({
      where: { id: eid },
      include: {
        unit: true,
        pipeStarts: { select: { id: true, code: true, name: true } },
        pipeEnds: { select: { id: true, code: true, name: true } },
      },
    })
    if (!equipment) return jsonError('设备不存在', 404)
    const pipes = [
      ...equipment.pipeStarts.map((p) => ({ ...p, role: 'start' })),
      ...equipment.pipeEnds.map((p) => ({ ...p, role: 'end' })),
    ]
    return NextResponse.json({
      item: {
        ...equipment,
        unitName: equipment.unit?.name ?? null,
        pipeCount: pipes.length,
        pipes,
      },
    })
  } catch (e) {
    console.error('[GET /api/equipments/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '获取设备详情失败', 500)
  }
}

/** PUT /api/equipments/[id] 更新设备主数据（部分更新） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const eid = parseId(id)
    if (!eid) return jsonError('无效的设备 ID')
    const existing = await db.equipment.findUnique({ where: { id: eid } })
    if (!existing) return jsonError('设备不存在', 404)
    const body = await readBody(req)

    const data: {
      code?: string
      name?: string
      type?: string
      unitId?: number | null
      remark?: string | null
    } = {}
    if (body.code !== undefined) {
      const code = str(body.code)
      if (!code) return jsonError('设备位号不能为空')
      data.code = code
    }
    if (body.name !== undefined) {
      const name = str(body.name)
      if (!name) return jsonError('设备名称不能为空')
      data.name = name
    }
    if (body.type !== undefined) data.type = str(body.type) || 'OTHER'
    if (body.unitId !== undefined) {
      if (body.unitId !== null && str(body.unitId) !== '' && num(body.unitId) === null) {
        return jsonError('unitId 必须为数字')
      }
      const unitId = num(body.unitId)
      if (unitId !== null) {
        const unit = await db.unit.findUnique({ where: { id: unitId } })
        if (!unit) return jsonError('关联装置不存在')
      }
      data.unitId = unitId
    }
    if (body.remark !== undefined) data.remark = str(body.remark) || null

    if (data.code && data.code !== existing.code) {
      const dup = await db.equipment.findFirst({ where: { code: data.code, NOT: { id: eid } } })
      if (dup) return jsonError('设备位号已存在', 409)
    }

    const equipment = await db.equipment.update({
      where: { id: eid },
      data,
      include: { unit: true },
    })
    return NextResponse.json({ item: { ...equipment, unitName: equipment.unit?.name ?? null } })
  } catch (e) {
    console.error('[PUT /api/equipments/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新设备失败', 500)
  }
}

/** DELETE /api/equipments/[id] 删除设备（引用它的管线起止字段自动置空，PID 图内嵌快照不受影响） */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const eid = parseId(id)
    if (!eid) return jsonError('无效的设备 ID')
    const existing = await db.equipment.findUnique({ where: { id: eid } })
    if (!existing) return jsonError('设备不存在', 404)
    // 管线起止引用置空（保留管线本身），避免悬挂引用
    await db.pipeline.updateMany({ where: { startEquipmentId: eid }, data: { startEquipmentId: null } })
    await db.pipeline.updateMany({ where: { endEquipmentId: eid }, data: { endEquipmentId: null } })
    await db.equipment.delete({ where: { id: eid } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/equipments/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '删除设备失败', 500)
  }
}
