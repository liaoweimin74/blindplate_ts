import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** PUT /api/units/[id] 更新装置 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const uid = parseId(id)
    if (!uid) return jsonError('无效的装置 ID')
    const existing = await db.unit.findUnique({ where: { id: uid } })
    if (!existing) return jsonError('装置不存在', 404)
    const { actorId, actorName, body } = extractActor(await readBody(req))

    const data: {
      code?: string
      name?: string
      manager?: string | null
      phone?: string | null
      remark?: string | null
      active?: boolean
    } = {}
    if (body.code !== undefined) {
      const code = str(body.code)
      if (!code) return jsonError('装置编号不能为空')
      data.code = code
    }
    if (body.name !== undefined) {
      const name = str(body.name)
      if (!name) return jsonError('装置名称不能为空')
      data.name = name
    }
    if (body.manager !== undefined) data.manager = str(body.manager) || null
    if (body.phone !== undefined) data.phone = str(body.phone) || null
    if (body.remark !== undefined) data.remark = str(body.remark) || null
    if (body.active !== undefined) data.active = Boolean(body.active)

    if (data.code && data.code !== existing.code) {
      const dup = await db.unit.findFirst({ where: { code: data.code, NOT: { id: uid } } })
      if (dup) return jsonError('装置编号已存在', 409)
    }

    const unit = await db.unit.update({ where: { id: uid }, data })
    await logAudit({
      actorId, actorName, action: 'UPDATE', entity: 'UNIT', entityId: uid, entityCode: unit.code,
      detail: `更新装置「${unit.name}」`,
    })
    return NextResponse.json(unit)
  } catch (e) {
    console.error('[PUT /api/units/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新装置失败', 500)
  }
}

/** DELETE /api/units/[id] 硬删除装置（操作者经 query 传递） */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const uid = parseId(id)
    if (!uid) return jsonError('无效的装置 ID')
    const existing = await db.unit.findUnique({ where: { id: uid } })
    if (!existing) return jsonError('装置不存在', 404)
    // 引用检查：存在关联作业需求时禁止删除
    const refCount = await db.workRequest.count({ where: { unitId: uid } })
    if (refCount > 0) {
      return jsonError(`该装置下存在 ${refCount} 条作业需求，无法删除`)
    }
    const sp = new URL(req.url).searchParams
    await db.unit.delete({ where: { id: uid } })
    await logAudit({
      actorId: sp.get('__actorId'), actorName: sp.get('__actorName') || '未知用户',
      action: 'DELETE', entity: 'UNIT', entityId: uid, entityCode: existing.code,
      detail: `删除装置「${existing.name}」`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/units/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '删除装置失败', 500)
  }
}
