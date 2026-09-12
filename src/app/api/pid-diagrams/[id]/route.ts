import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody, str } from '@/lib/bp-server-utils'
import { normalizePidContent } from '@/lib/bp-types'

export const dynamic = 'force-dynamic'

/** GET /api/pid-diagrams/[id] → 完整组态图（含 unitName） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const did = parseId(id)
    if (!did) return jsonError('无效的 PID 图 ID')
    const diagram = await db.pidDiagram.findUnique({ where: { id: did }, include: { unit: true } })
    if (!diagram) return jsonError('PID 图不存在', 404)
    return NextResponse.json({ item: { ...diagram, unitName: diagram.unit?.name ?? null } })
  } catch (e) {
    console.error('[GET /api/pid-diagrams/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '获取 PID 图失败', 500)
  }
}

/** PUT /api/pid-diagrams/[id] 部分更新（name/unitId/content） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const did = parseId(id)
    if (!did) return jsonError('无效的 PID 图 ID')
    const existing = await db.pidDiagram.findUnique({ where: { id: did } })
    if (!existing) return jsonError('PID 图不存在', 404)
    const body = await readBody(req)

    const data: {
      name?: string
      unitId?: number | null
      content?: string
    } = {}
    if (body.name !== undefined) {
      const name = str(body.name)
      if (!name) return jsonError('图名不能为空')
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
    if (body.content !== undefined && body.content !== null) {
      const normalized = normalizePidContent(body.content)
      if (!normalized) return jsonError('content 必须为合法的 JSON 对象')
      data.content = normalized
    }

    const diagram = await db.pidDiagram.update({ where: { id: did }, data })

    // 保存联动：解析连线↔管线、图元↔设备绑定，回写管线起点/终点设备
    // 规则：连线 pipelineId 非空时，fromShape 图元的 equipmentId → 管线起点设备，toShape → 终点设备；
    //       direction === 'reverse' 时对调；多条连线绑同一管线取首条有效值；两端无设备则跳过不覆盖旧值
    if (data.content) {
      try {
        const parsed = JSON.parse(data.content) as {
          shapes?: { id: string; equipmentId?: number | null }[]
          connections?: { pipelineId?: number | null; fromShape: string; toShape: string; direction?: string }[]
        }
        const eqOf = new Map((parsed.shapes ?? []).map((s) => [s.id, s.equipmentId ?? null]))
        const pipeEq = new Map<number, { start?: number | null; end?: number | null }>()
        for (const c of parsed.connections ?? []) {
          const pl = typeof c.pipelineId === 'number' ? c.pipelineId : null
          if (!pl || pipeEq.has(pl)) continue
          const fromEq = eqOf.get(c.fromShape) ?? null
          const toEq = eqOf.get(c.toShape) ?? null
          if (fromEq === null && toEq === null) continue
          const reversed = c.direction === 'reverse'
          pipeEq.set(pl, {
            start: (reversed ? toEq : fromEq) ?? null,
            end: (reversed ? fromEq : toEq) ?? null,
          })
        }
        for (const [pipelineId, eq] of pipeEq) {
          await db.pipeline.updateMany({
            where: { id: pipelineId },
            data: { startEquipmentId: eq.start ?? null, endEquipmentId: eq.end ?? null },
          })
        }
        if (pipeEq.size > 0) console.log(`[pid-save] 回写 ${pipeEq.size} 条管线的起止设备`)
      } catch (linkErr) {
        // 联动失败不阻断保存，仅记录
        console.error('[pid-save 管线设备联动失败]', linkErr)
      }
    }

    return NextResponse.json(diagram)
  } catch (e) {
    console.error('[PUT /api/pid-diagrams/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新 PID 图失败', 500)
  }
}

/** DELETE /api/pid-diagrams/[id] 删除组态图 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const did = parseId(id)
    if (!did) return jsonError('无效的 PID 图 ID')
    const existing = await db.pidDiagram.findUnique({ where: { id: did } })
    if (!existing) return jsonError('PID 图不存在', 404)
    await db.pidDiagram.delete({ where: { id: did } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/pid-diagrams/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '删除 PID 图失败', 500)
  }
}
