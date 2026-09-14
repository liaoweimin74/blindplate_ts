import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError, num, withUnit } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/work-tasks?assignee=&status= → 任务列表（附 workRequest(含 unit)、ticket 与隔离点进度 pointsTotal/pointsDone） */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const assignee = sp.get('assignee') ?? undefined
    const status = sp.get('status') ?? undefined
    const where: Prisma.WorkTaskWhereInput = {}
    if (assignee) where.assignee = { contains: assignee }
    if (status) where.status = status

    const tasks = await db.workTask.findMany({ where, orderBy: { createdAt: 'desc' } })
    // WorkTask 与 WorkRequest/WorkTicket 无 Prisma 关系，手工关联
    const reqIds = [...new Set(tasks.map((t) => t.workRequestId))]
    const ticketIds = [
      ...new Set(tasks.map((t) => t.ticketId).filter((x): x is number => typeof x === 'number')),
    ]
    const [requests, tickets] = await Promise.all([
      reqIds.length ? db.workRequest.findMany({ where: { id: { in: reqIds } } }) : Promise.resolve([]),
      ticketIds.length
        ? db.workTicket.findMany({ where: { id: { in: ticketIds } } })
        : Promise.resolve([]),
    ])
    const requestsWithUnit = await withUnit(requests)
    const reqMap = new Map(
      requestsWithUnit.map((r) => [r.id, r] as const)
    )
    const ticketMap = new Map(tickets.map((t) => [t.id, t] as const))

    // 隔离点进度统计：按需求 → 隔离方案 → 隔离点，汇总 total/done
    const schemes = reqIds.length
      ? await db.isolationScheme.findMany({
          where: { workRequestId: { in: reqIds } },
          select: { id: true, workRequestId: true },
        })
      : []
    const schemeIds = schemes.map((s) => s.id)
    const points = schemeIds.length
      ? await db.isolationPoint.findMany({
          where: { schemeId: { in: schemeIds } },
          select: { schemeId: true, done: true },
        })
      : []
    const reqToScheme = new Map(schemes.map((s) => [s.workRequestId, s.id] as const))
    const schemeStats = new Map<number, { total: number; done: number }>()
    for (const p of points) {
      const cur = schemeStats.get(p.schemeId) ?? { total: 0, done: 0 }
      cur.total++
      if (p.done) cur.done++
      schemeStats.set(p.schemeId, cur)
    }

    return NextResponse.json(
      tasks.map((t) => {
        const sid = reqToScheme.get(t.workRequestId)
        const st = sid ? schemeStats.get(sid) : undefined
        return {
          ...t,
          workRequest: reqMap.get(t.workRequestId) ?? null,
          ticket: t.ticketId != null ? (ticketMap.get(t.ticketId) ?? null) : null,
          pointsTotal: st?.total ?? 0,
          pointsDone: st?.done ?? 0,
        }
      })
    )
  } catch (e) {
    console.error('[GET /api/work-tasks]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取作业任务失败' },
      { status: 500 }
    )
  }
}
