import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/approvals → 审批中心聚合数据
 * {
 *   pending: {
 *     isolation: 隔离方案待审核（含隔离点+关联需求摘要+提交人）
 *     disposal:  工艺处置方案待审核（含处置步骤+关联需求摘要+提交人）
 *     ticket:    作业票待批准（含关联需求摘要+票面信息）
 *   },
 *   counts: { isolation, disposal, ticket, total },
 *   records: 最近 100 条审批留痕（倒序）
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const recordLimitRaw = req.nextUrl.searchParams.get('recordLimit')
    const recordLimit = Math.min(Math.max(Number(recordLimitRaw) || 100, 1), 500)

    const [isoPending, dispPending, ticketPending, records] = await Promise.all([
      db.isolationScheme.findMany({
        where: { status: 'PENDING_REVIEW' },
        orderBy: { preparedAt: 'asc' },
        include: { points: { orderBy: { seq: 'asc' } } },
      }),
      db.disposalScheme.findMany({
        where: { status: 'PENDING_REVIEW' },
        orderBy: { preparedAt: 'asc' },
        include: { steps: { orderBy: { seq: 'asc' } } },
      }),
      db.workTicket.findMany({
        where: { status: 'PENDING_REVIEW' },
        orderBy: { createdAt: 'asc' },
      }),
      db.approvalRecord.findMany({ orderBy: { createdAt: 'desc' }, take: recordLimit }),
    ])

    // 关联需求摘要（编号/标题/装置/类型/申请人）
    const reqIds = [
      ...new Set([
        ...isoPending.map((s) => s.workRequestId),
        ...dispPending.map((s) => s.workRequestId),
        ...ticketPending.map((t) => t.workRequestId),
      ]),
    ]
    const requests = reqIds.length
      ? await db.workRequest.findMany({ where: { id: { in: reqIds } } })
      : []
    // WorkRequest 与 Unit 无 Prisma 关系，手工关联装置名称
    const unitIds = [...new Set(requests.map((r) => r.unitId))]
    const units = unitIds.length ? await db.unit.findMany({ where: { id: { in: unitIds } } }) : []
    const unitMap = new Map(units.map((u) => [u.id, u]))
    const reqMap = new Map(
      requests.map((r) => [r.id, { ...r, unit: unitMap.get(r.unitId) ?? null }])
    )

    // 提交人：从 ApprovalRecord 里找最近一次 SUBMIT 的操作人
    const pendingBizKeys = new Set([
      ...isoPending.map((s) => `ISOLATION:${s.id}`),
      ...dispPending.map((s) => `DISPOSAL:${s.id}`),
      ...ticketPending.map((t) => `TICKET:${t.id}`),
    ])
    const submitterMap = new Map<string, { operator: string; at: Date }>()
    for (const r of records) {
      if (r.action !== 'SUBMIT') continue
      const key = `${r.bizType}:${r.bizId}`
      if (pendingBizKeys.has(key) && !submitterMap.has(key)) {
        submitterMap.set(key, { operator: r.operator, at: r.createdAt })
      }
    }

    const isoList = isoPending.map((s) => {
      const wr = reqMap.get(s.workRequestId)
      const sub = submitterMap.get(`ISOLATION:${s.id}`)
      return {
        ...s,
        pointsCount: s.points.length,
        workRequest: wr
          ? { id: wr.id, code: wr.code, title: wr.title, status: wr.status, workType: wr.workType, unitName: wr.unit?.name ?? null, applicantName: wr.applicantName }
          : null,
        submittedBy: sub?.operator ?? s.preparedBy,
        submittedAt: sub?.at ?? s.preparedAt,
      }
    })
    const dispList = dispPending.map((s) => {
      const wr = reqMap.get(s.workRequestId)
      const sub = submitterMap.get(`DISPOSAL:${s.id}`)
      return {
        ...s,
        stepsCount: s.steps.length,
        workRequest: wr
          ? { id: wr.id, code: wr.code, title: wr.title, status: wr.status, workType: wr.workType, unitName: wr.unit?.name ?? null, applicantName: wr.applicantName }
          : null,
        submittedBy: sub?.operator ?? s.preparedBy,
        submittedAt: sub?.at ?? s.preparedAt,
      }
    })
    const ticketList = ticketPending.map((t) => {
      const wr = reqMap.get(t.workRequestId)
      const sub = submitterMap.get(`TICKET:${t.id}`)
      return {
        ...t,
        workRequest: wr
          ? { id: wr.id, code: wr.code, title: wr.title, status: wr.status, workType: wr.workType, unitName: wr.unit?.name ?? null, applicantName: wr.applicantName }
          : null,
        submittedBy: sub?.operator ?? t.issuer,
        submittedAt: sub?.at ?? t.createdAt,
      }
    })

    return NextResponse.json({
      pending: { isolation: isoList, disposal: dispList, ticket: ticketList },
      counts: {
        isolation: isoList.length,
        disposal: dispList.length,
        ticket: ticketList.length,
        total: isoList.length + dispList.length + ticketList.length,
      },
      records,
    })
  } catch (e) {
    console.error('[GET /api/approvals]', e)
    return jsonError(e instanceof Error ? e.message : '获取审批数据失败', 500)
  }
}
