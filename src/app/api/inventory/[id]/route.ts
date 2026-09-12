import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** PUT /api/inventory/[id] { minQuantity } → 更新库存预警线（最低库存） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const iid = parseId(id)
    if (!iid) return jsonError('无效的库存 ID')
    const item = await db.inventoryItem.findUnique({ where: { id: iid } })
    if (!item) return jsonError('库存记录不存在', 404)

    const body = await readBody(req)
    const minQuantity = num(body.minQuantity)
    if (minQuantity === null || minQuantity < 0 || !Number.isInteger(minQuantity)) {
      return jsonError('预警线必须为不小于 0 的整数')
    }
    const updated = await db.inventoryItem.update({
      where: { id: iid },
      data: { minQuantity },
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[PUT /api/inventory/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新库存预警线失败', 500)
  }
}
