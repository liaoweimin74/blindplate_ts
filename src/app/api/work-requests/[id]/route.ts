import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody, str, toDate } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/work-requests/[id] → 需求详情
 * 附带 unit/survey/jsa(steps)/isolationScheme(points)/disposalScheme(steps)
 * /disposalConfirmation/tickets[]（一票一板多票；ticket 为首张兼容字段）/task/acceptance/approvals
 * （WorkRequest 与子表无 Prisma 关系，手工组装）
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rid = parseId(id)
    if (!rid) return jsonError('无效的需求 ID')
    const request = await db.workRequest.findUnique({ where: { id: rid } })
    if (!request) return jsonError('作业需求不存在', 404)

    const [unit, survey, jsa, isolationScheme, disposalScheme, disposalConfirmation, tickets, task, acceptance] =
      await Promise.all([
        db.unit.findUnique({ where: { id: request.unitId } }),
        db.siteSurvey.findUnique({ where: { workRequestId: rid } }),
        db.jsaAnalysis.findUnique({ where: { workRequestId: rid } }),
        db.isolationScheme.findUnique({ where: { workRequestId: rid } }),
        db.disposalScheme.findUnique({ where: { workRequestId: rid } }),
        db.disposalConfirmation.findUnique({ where: { workRequestId: rid } }),
        db.workTicket.findMany({ where: { workRequestId: rid }, orderBy: { createdAt: 'asc' } }),
        db.workTask.findUnique({ where: { workRequestId: rid } }),
        db.acceptance.findUnique({ where: { workRequestId: rid } }),
      ])
    const ticket = tickets[0] ?? null

    const [jsaSteps, isolationPoints, disposalSteps] = await Promise.all([
      jsa
        ? db.jsaStep.findMany({ where: { jsaId: jsa.id }, orderBy: { seq: 'asc' } })
        : Promise.resolve([]),
      isolationScheme
        ? db.isolationPoint.findMany({ where: { schemeId: isolationScheme.id }, orderBy: { seq: 'asc' } })
        : Promise.resolve([]),
      disposalScheme
        ? db.disposalStep.findMany({ where: { schemeId: disposalScheme.id }, orderBy: { seq: 'asc' } })
        : Promise.resolve([]),
    ])

    // 审批留痕：隔离方案 / 处置方案 / 作业票（多票）三处合并，按时间倒序
    const approvalTargets = [
      isolationScheme ? { bizType: 'ISOLATION', bizId: isolationScheme.id } : null,
      disposalScheme ? { bizType: 'DISPOSAL', bizId: disposalScheme.id } : null,
      ...tickets.map((t) => ({ bizType: 'TICKET', bizId: t.id })),
    ].filter((t): t is { bizType: string; bizId: number } => t !== null)
    const approvals = approvalTargets.length
      ? await db.approvalRecord.findMany({
          where: { OR: approvalTargets.map((t) => ({ bizType: t.bizType, bizId: t.bizId })) },
          orderBy: { createdAt: 'desc' },
        })
      : []

    return NextResponse.json({
      ...request,
      unit,
      survey,
      jsa: jsa ? { ...jsa, steps: jsaSteps } : null,
      isolationScheme: isolationScheme ? { ...isolationScheme, points: isolationPoints } : null,
      disposalScheme: disposalScheme ? { ...disposalScheme, steps: disposalSteps } : null,
      disposalConfirmation,
      tickets,
      ticket,
      task,
      acceptance,
      approvals,
    })
  } catch (e) {
    console.error('[GET /api/work-requests/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '获取需求详情失败', 500)
  }
}

/** PUT /api/work-requests/[id] 编辑基本信息（终态不可编辑） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rid = parseId(id)
    if (!rid) return jsonError('无效的需求 ID')
    const existing = await db.workRequest.findUnique({ where: { id: rid } })
    if (!existing) return jsonError('作业需求不存在', 404)
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      return jsonError('该需求已完结，不可编辑')
    }
    const body = await readBody(req)

    const data: {
      title?: string
      unitId?: number
      location?: string
      pipelineId?: number | null
      pipelineName?: string | null
      medium?: string | null
      pressure?: string | null
      temperature?: string | null
      reason?: string
      urgency?: string
      plannedStart?: Date | null
      plannedEnd?: Date | null
    } = {}
    if (body.title !== undefined) {
      const title = str(body.title)
      if (!title) return jsonError('标题不能为空')
      data.title = title
    }
    if (body.unitId !== undefined) {
      const unitId = num(body.unitId)
      if (unitId === null) return jsonError('所属装置不能为空')
      const unit = await db.unit.findUnique({ where: { id: unitId } })
      if (!unit) return jsonError('所属装置不存在', 404)
      data.unitId = unitId
    }
    if (body.location !== undefined) {
      const location = str(body.location)
      if (!location) return jsonError('位置不能为空')
      data.location = location
    }
    if (body.pipelineId !== undefined) data.pipelineId = num(body.pipelineId)
    if (body.pipelineName !== undefined) data.pipelineName = str(body.pipelineName) || null
    if (body.medium !== undefined) data.medium = str(body.medium) || null
    if (body.pressure !== undefined) data.pressure = str(body.pressure) || null
    if (body.temperature !== undefined) data.temperature = str(body.temperature) || null
    if (body.reason !== undefined) {
      const reason = str(body.reason)
      if (!reason) return jsonError('作业原因不能为空')
      data.reason = reason
    }
    if (body.urgency !== undefined) {
      const urgency = str(body.urgency)
      if (!['LOW', 'MEDIUM', 'HIGH'].includes(urgency)) return jsonError('紧急程度必须为 LOW/MEDIUM/HIGH')
      data.urgency = urgency
    }
    if (body.plannedStart !== undefined) data.plannedStart = toDate(body.plannedStart)
    if (body.plannedEnd !== undefined) data.plannedEnd = toDate(body.plannedEnd)

    const updated = await db.workRequest.update({ where: { id: rid }, data })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[PUT /api/work-requests/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新作业需求失败', 500)
  }
}
