import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/stats/overview → 驾驶舱汇总统计 */
export async function GET() {
  try {
    const [workGroups, plateGroups, unitGroups, createdAtRows, inventoryItems] = await Promise.all([
      db.workRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      db.blindPlate.groupBy({ by: ['status'], _count: { _all: true } }),
      db.workRequest.groupBy({ by: ['unitId'], _count: { _all: true } }),
      db.workRequest.findMany({ select: { createdAt: true } }),
      db.inventoryItem.findMany({
        orderBy: [{ spec: 'asc' }, { type: 'asc' }, { material: 'asc' }],
      }),
    ])

    // 需求状态分布
    const statusCount = workGroups
      .map((g) => ({ status: g.status, count: g._count._all }))
      .sort((a, b) => b.count - a.count)

    // 盲板状态分布
    const plateStatus = plateGroups
      .map((g) => ({ status: g.status, count: g._count._all }))
      .sort((a, b) => b.count - a.count)

    // 各装置作业数排名
    const unitIds = unitGroups.map((g) => g.unitId)
    const units = unitIds.length ? await db.unit.findMany({ where: { id: { in: unitIds } } }) : []
    const unitMap = new Map(units.map((u) => [u.id, u]))
    const unitRanking = unitGroups
      .map((g) => ({
        unitName: unitMap.get(g.unitId)?.name ?? `装置#${g.unitId}`,
        count: g._count._all,
      }))
      .sort((a, b) => b.count - a.count)

    // 近 6 个月作业趋势
    const now = new Date()
    const monthly: { month: string; count: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthly.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, count: 0 })
    }
    for (const row of createdAtRows) {
      const key = `${row.createdAt.getFullYear()}-${String(row.createdAt.getMonth() + 1).padStart(2, '0')}`
      const hit = monthly.find((m) => m.month === key)
      if (hit) hit.count++
    }

    // 低库存预警（含缺口数量）
    const inventoryAlerts = inventoryItems
      .filter((i) => i.quantity <= i.minQuantity)
      .map((i) => ({ ...i, gap: i.minQuantity - i.quantity }))
      .sort((a, b) => b.gap - a.gap)

    // 待办计数（按需求状态聚合到业务环节）
    // 编制类待办口径：JSA_DONE/ISOLATION_PREPARING/ISOLATION_REJECTED → 待编制隔离方案（新建/继续编/驳回重编）；
    // ISOLATION_APPROVED（历史瞬时态，防御性纳入）+ DISPOSAL_PREPARING（隔离方案审批通过后直接进入，含草稿未提交）+ DISPOSAL_REJECTED → 待编制工艺处置方案
    const countByStatus = new Map(workGroups.map((g) => [g.status, g._count._all]))
    const cnt = (...keys: string[]) => keys.reduce((s, k) => s + (countByStatus.get(k) ?? 0), 0)
    const todoCount = {
      pendingSurvey: countByStatus.get('PENDING_SURVEY') ?? 0,
      pendingJsa: countByStatus.get('SURVEYED') ?? 0,
      isolationPreparing: cnt('JSA_DONE', 'ISOLATION_PREPARING', 'ISOLATION_REJECTED'),
      isolationPendingReview: countByStatus.get('ISOLATION_PENDING_REVIEW') ?? 0,
      disposalPreparing: cnt('ISOLATION_APPROVED', 'DISPOSAL_PREPARING', 'DISPOSAL_REJECTED'),
      disposalPendingReview: countByStatus.get('DISPOSAL_PENDING_REVIEW') ?? 0,
      pendingConfirm: countByStatus.get('PENDING_CONFIRM') ?? 0,
      pendingTicket: countByStatus.get('CONFIRMED') ?? 0,
      ticketPendingReview: countByStatus.get('TICKET_ISSUED') ?? 0,
      inProgress: countByStatus.get('IN_PROGRESS') ?? 0,
      pendingAcceptance: countByStatus.get('PENDING_ACCEPTANCE') ?? 0,
    }

    return NextResponse.json({
      statusCount,
      plateStatus,
      unitRanking,
      monthly,
      inventoryAlerts,
      todoCount,
    })
  } catch (e) {
    console.error('[GET /api/stats/overview]', e)
    return jsonError(e instanceof Error ? e.message : '获取统计数据失败', 500)
  }
}
