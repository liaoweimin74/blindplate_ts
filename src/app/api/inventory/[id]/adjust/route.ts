import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, num, parseId, readBody, resolveActor } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/** POST /api/inventory/[id]/adjust { delta: number } 调整库存数量（结果 < 0 报错） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const iid = parseId(id)
    if (!iid) return jsonError('无效的库存项 ID')
    const body = await readBody(req)
    const delta = num(body.delta)
    if (delta === null || !Number.isInteger(delta)) {
      return jsonError('delta 必须为整数')
    }
    const item = await db.inventoryItem.findUnique({ where: { id: iid } })
    if (!item) return jsonError('库存项不存在', 404)
    const quantity = item.quantity + delta
    if (quantity < 0) {
      return jsonError(`库存不足：当前库存 ${item.quantity}，无法变动 ${delta}`)
    }
    const updated = await db.inventoryItem.update({ where: { id: iid }, data: { quantity } })
    if (quantity <= item.minQuantity) {
      await pushNotifications({
        targetRoles: ['ADMIN', 'MANAGER'],
        type: 'ALERT',
        title: '盲板库存低于预警线',
        content: `${item.spec} ${item.type}（${item.material}）当前在库 ${quantity} 件，已低于/等于预警线 ${item.minQuantity} 件，请及时补库`,
        bizType: 'INVENTORY',
        bizId: iid,
        linkModule: 'ledger',
        linkTab: 'inventory',
      })
    }
    // 审计留痕：库存调整（前端台账暂未透传 __actor，无则记未知用户，待后续补充）
    const actor = resolveActor(extractActor(body))
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'UPDATE',
      entity: 'INVENTORY',
      entityId: iid,
      entityCode: `${item.spec}/${item.type}/${item.material}`,
      detail: `${item.spec} ${item.type}（${item.material}）：库存 ${item.quantity} → ${quantity}（${delta > 0 ? '入库' : delta < 0 ? '出库' : '调整'} ${Math.abs(delta)} 件）`,
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[POST /api/inventory/[id]/adjust]', e)
    return jsonError(e instanceof Error ? e.message : '调整库存失败', 500)
  }
}
