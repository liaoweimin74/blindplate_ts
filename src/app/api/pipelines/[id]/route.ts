import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** PUT /api/pipelines/[id] 更新管线主数据（部分更新） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const pid = parseId(id)
    if (!pid) return jsonError('无效的管线 ID')
    const existing = await db.pipeline.findUnique({ where: { id: pid } })
    if (!existing) return jsonError('管线不存在', 404)
    const body = await readBody(req)

    const data: {
      code?: string
      name?: string
      unitId?: number | null
      medium?: string | null
      pressure?: string | null
      material?: string | null
      spec?: string | null
      remark?: string | null
      startEquipmentId?: number | null
      endEquipmentId?: number | null
    } = {}
    if (body.code !== undefined) {
      const code = str(body.code)
      if (!code) return jsonError('管线编码不能为空')
      data.code = code
    }
    if (body.name !== undefined) {
      const name = str(body.name)
      if (!name) return jsonError('管线名称不能为空')
      data.name = name
    }
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
    if (body.medium !== undefined) data.medium = str(body.medium) || null
    if (body.pressure !== undefined) data.pressure = str(body.pressure) || null
    if (body.material !== undefined) data.material = str(body.material) || null
    if (body.spec !== undefined) data.spec = str(body.spec) || null
    if (body.remark !== undefined) data.remark = str(body.remark) || null
    for (const key of ['startEquipmentId', 'endEquipmentId'] as const) {
      if (body[key] !== undefined) {
        if (body[key] !== null && str(body[key]) !== '' && num(body[key]) === null) {
          return jsonError(`${key} 必须为数字`)
        }
        const v = num(body[key])
        if (v !== null) {
          const eq = await db.equipment.findUnique({ where: { id: v } })
          if (!eq) return jsonError('起点/终点设备不存在')
        }
        data[key] = v
      }
    }

    if (data.code && data.code !== existing.code) {
      const dup = await db.pipeline.findFirst({ where: { code: data.code, NOT: { id: pid } } })
      if (dup) return jsonError('管线编码已存在', 409)
    }

    const pipeline = await db.pipeline.update({
      where: { id: pid },
      data,
      include: {
        startEquipment: { select: { id: true, code: true, name: true } },
        endEquipment: { select: { id: true, code: true, name: true } },
      },
    })
    return NextResponse.json(pipeline)
  } catch (e) {
    console.error('[PUT /api/pipelines/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新管线失败', 500)
  }
}

/** DELETE /api/pipelines/[id] 删除管线（存在隔离点主数据引用时拒绝，提示先处理点位） */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const pid = parseId(id)
    if (!pid) return jsonError('无效的管线 ID')
    const existing = await db.pipeline.findUnique({ where: { id: pid } })
    if (!existing) return jsonError('管线不存在', 404)
    const refCount = await db.isoPointMaster.count({ where: { pipelineId: pid } })
    if (refCount > 0) {
      return jsonError(`该管线下存在 ${refCount} 个隔离点主数据，请先处理相关点位`)
    }
    await db.pipeline.delete({ where: { id: pid } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/pipelines/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '删除管线失败', 500)
  }
}
