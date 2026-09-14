import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, parseId, readBody, str, toDate } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/work-tickets/[id] → 作业票详情（附关联需求与任务） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tid = parseId(id)
    if (!tid) return jsonError('无效的作业票 ID')
    const ticket = await db.workTicket.findUnique({ where: { id: tid } })
    if (!ticket) return jsonError('作业票不存在', 404)
    const [request, task] = await Promise.all([
      db.workRequest.findUnique({ where: { id: ticket.workRequestId } }),
      db.workTask.findFirst({ where: { workRequestId: ticket.workRequestId } }),
    ])
    return NextResponse.json({
      ...ticket,
      workRequest: request ?? null,
      task: task ?? null,
    })
  } catch (e) {
    console.error('[GET /api/work-tickets/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '获取作业票详情失败', 500)
  }
}

/** PUT /api/work-tickets/[id] 编辑作业票（仅 DRAFT 可编辑） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tid = parseId(id)
    if (!tid) return jsonError('无效的作业票 ID')
    const ticket = await db.workTicket.findUnique({ where: { id: tid } })
    if (!ticket) return jsonError('作业票不存在', 404)
    if (ticket.status !== 'DRAFT') {
      return jsonError(`当前状态为 ${ticket.status}，仅待签发状态可编辑`)
    }
    const body = await readBody(req)

    const data: {
      plannedStart?: Date
      plannedEnd?: Date
      guardian?: string
      workers?: string
      issuer?: string
      safetyMeasures?: string
    } = {}
    if (body.plannedStart !== undefined) {
      const plannedStart = toDate(body.plannedStart)
      if (!plannedStart) return jsonError('计划开始时间格式错误')
      data.plannedStart = plannedStart
    }
    if (body.plannedEnd !== undefined) {
      const plannedEnd = toDate(body.plannedEnd)
      if (!plannedEnd) return jsonError('计划结束时间格式错误')
      data.plannedEnd = plannedEnd
    }
    if (body.guardian !== undefined) {
      const guardian = str(body.guardian)
      if (!guardian) return jsonError('监护人不能为空')
      data.guardian = guardian
    }
    if (body.workers !== undefined) {
      const workers = str(body.workers)
      if (!workers) return jsonError('作业人员不能为空')
      data.workers = workers
    }
    if (body.issuer !== undefined) {
      const issuer = str(body.issuer)
      if (!issuer) return jsonError('签发人不能为空')
      data.issuer = issuer
    }
    if (body.safetyMeasures !== undefined) {
      const safetyMeasures = str(body.safetyMeasures)
      if (!safetyMeasures) return jsonError('安全措施不能为空')
      data.safetyMeasures = safetyMeasures
    }

    const updated = await db.workTicket.update({ where: { id: tid }, data })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[PUT /api/work-tickets/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新作业票失败', 500)
  }
}
