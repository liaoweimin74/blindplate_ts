import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/isolation-points/[id]/reserve { blindPlateId, operator }
 * 绑定盲板（校验在库 IN_STOCK），盲板 → RESERVED、位置='已预留待领用'，
 * 写 ChangeRecord(RESERVE, workCode=方案编号)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const pid = parseId(id)
    if (!pid) return jsonError('无效的隔离点 ID')
    const point = await db.isolationPoint.findUnique({ where: { id: pid } })
    if (!point) return jsonError('隔离点不存在', 404)
    const scheme = await db.isolationScheme.findUnique({ where: { id: point.schemeId } })
    if (!scheme) return jsonError('所属隔离方案不存在', 404)

    const body = await readBody(req)
    const operator = str(body.operator)
    if (!operator) return jsonError('操作人不能为空')
    const blindPlateId = num(body.blindPlateId)
    if (blindPlateId === null) return jsonError('无效的 blindPlateId')
    const plate = await db.blindPlate.findUnique({ where: { id: blindPlateId } })
    if (!plate) return jsonError('盲板不存在', 404)
    if (plate.status !== 'IN_STOCK') {
      return jsonError(`盲板当前状态为 ${plate.status}，仅在库（IN_STOCK）盲板可预留`)
    }

    const [updatedPlate, updatedPoint] = await db.$transaction([
      db.blindPlate.update({
        where: { id: plate.id },
        data: { status: 'RESERVED', location: '已预留待领用' },
      }),
      db.isolationPoint.update({
        where: { id: point.id },
        data: { blindPlateId: plate.id },
      }),
    ])
    await db.changeRecord.create({
      data: {
        blindPlateId: plate.id,
        blindCode: plate.code,
        action: 'RESERVE',
        workCode: scheme.code,
        location: point.location,
        fromStatus: 'IN_STOCK',
        toStatus: 'RESERVED',
        operator,
        note: `为隔离点${point.seq}（${point.location}）预留盲板`,
      },
    })
    return NextResponse.json({ point: updatedPoint, blindPlate: updatedPlate })
  } catch (e) {
    console.error('[POST /api/isolation-points/[id]/reserve]', e)
    return jsonError(e instanceof Error ? e.message : '预留盲板失败', 500)
  }
}
