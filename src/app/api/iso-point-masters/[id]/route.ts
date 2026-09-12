import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** PUT /api/iso-point-masters/[id] 更新隔离点主数据（部分更新） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const mid = parseId(id)
    if (!mid) return jsonError('无效的点位 ID')
    const existing = await db.isoPointMaster.findUnique({ where: { id: mid } })
    if (!existing) return jsonError('隔离点主数据不存在', 404)
    const body = await readBody(req)

    const data: {
      code?: string
      name?: string
      pipelineId?: number | null
      location?: string | null
      remark?: string | null
    } = {}
    if (body.code !== undefined) {
      const code = str(body.code)
      if (!code) return jsonError('点位编码不能为空')
      data.code = code
    }
    if (body.name !== undefined) {
      const name = str(body.name)
      if (!name) return jsonError('点位名称不能为空')
      data.name = name
    }
    if (body.pipelineId !== undefined) {
      if (body.pipelineId !== null && str(body.pipelineId) !== '' && num(body.pipelineId) === null) {
        return jsonError('pipelineId 必须为数字')
      }
      const pipelineId = num(body.pipelineId)
      if (pipelineId !== null) {
        const pipeline = await db.pipeline.findUnique({ where: { id: pipelineId } })
        if (!pipeline) return jsonError('关联管线不存在')
      }
      data.pipelineId = pipelineId
    }
    if (body.location !== undefined) data.location = str(body.location) || null
    if (body.remark !== undefined) data.remark = str(body.remark) || null

    if (data.code && data.code !== existing.code) {
      const dup = await db.isoPointMaster.findFirst({ where: { code: data.code, NOT: { id: mid } } })
      if (dup) return jsonError('点位编码已存在', 409)
    }

    const master = await db.isoPointMaster.update({ where: { id: mid }, data })
    return NextResponse.json(master)
  } catch (e) {
    console.error('[PUT /api/iso-point-masters/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新隔离点主数据失败', 500)
  }
}

/** DELETE /api/iso-point-masters/[id] 删除隔离点主数据（被业务隔离点引用时拒绝） */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const mid = parseId(id)
    if (!mid) return jsonError('无效的点位 ID')
    const existing = await db.isoPointMaster.findUnique({ where: { id: mid } })
    if (!existing) return jsonError('隔离点主数据不存在', 404)
    const refCount = await db.isolationPoint.count({ where: { masterPointId: mid } })
    if (refCount > 0) {
      return jsonError(`该点位已被 ${refCount} 个业务隔离点引用，无法删除`)
    }
    await db.isoPointMaster.delete({ where: { id: mid } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/iso-point-masters/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '删除隔离点主数据失败', 500)
  }
}
