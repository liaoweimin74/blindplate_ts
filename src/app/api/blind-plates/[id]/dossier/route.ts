import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, parseId } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/blind-plates/[id]/dossier → 盲板「一板一档」聚合档案
 * 一次性返回：
 * - plate: BlindPlate 完整字段 + unitName（所属装置名，unitId 可空时为 null）
 * - changes: 变动记录（blindPlateId 命中 OR blindCode 命中，按 createdAt 降序）
 * - businesses: 关联业务单据链路（以 IsolationPoint 为准 → 隔离方案 → 作业需求，
 *   每条需求并行补齐勘察/JSA/方案/票/任务/验收摘要）
 * （BlindPlate/ChangeRecord/IsolationPoint 与 Unit/WorkRequest 均无 Prisma 关系，手工组装）
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const pid = parseId(id)
    if (!pid) return jsonError('无效的盲板 ID')
    const plate = await db.blindPlate.findUnique({ where: { id: pid } })
    if (!plate) return jsonError('盲板不存在', 404)

    const [unit, changes, points] = await Promise.all([
      plate.unitId != null ? db.unit.findUnique({ where: { id: plate.unitId } }) : Promise.resolve(null),
      db.changeRecord.findMany({
        where: { OR: [{ blindPlateId: pid }, { blindCode: plate.code }] },
        orderBy: { createdAt: 'desc' },
      }),
      db.isolationPoint.findMany({ where: { blindPlateId: pid }, include: { scheme: true } }),
    ])

    // 隔离点 → 隔离方案 → 作业需求（去重）；同一需求可能有多处点位用到该盲板
    const pointsByWr = new Map<number, { action: string; location: string }[]>()
    for (const p of points) {
      const wrId = p.scheme?.workRequestId
      if (wrId == null) continue
      const list = pointsByWr.get(wrId) ?? []
      list.push({ action: p.action, location: p.location })
      pointsByWr.set(wrId, list)
    }
    const wrIds = [...pointsByWr.keys()]

    const wrRows = wrIds.length
      ? await db.workRequest.findMany({ where: { id: { in: wrIds } }, orderBy: { createdAt: 'desc' } })
      : []
    // 批量补齐需求的所属装置名（WorkRequest 与 Unit 无关系）
    const unitIds = [...new Set(wrRows.map((w) => w.unitId))]
    const units = unitIds.length ? await db.unit.findMany({ where: { id: { in: unitIds } } }) : []
    const unitNameById = new Map(units.map((u) => [u.id, u.name]))

    const businesses = await Promise.all(
      wrRows.map(async (wr) => {
        const matched = pointsByWr.get(wr.id) ?? []
        const [survey, jsa, isolationScheme, disposalScheme, ticket, tasks, acceptances] =
          await Promise.all([
            db.siteSurvey.findUnique({ where: { workRequestId: wr.id } }),
            db.jsaAnalysis.findUnique({ where: { workRequestId: wr.id } }),
            db.isolationScheme.findUnique({ where: { workRequestId: wr.id } }),
            db.disposalScheme.findUnique({ where: { workRequestId: wr.id } }),
            db.workTicket.findMany({ where: { workRequestId: wr.id }, orderBy: { createdAt: "asc" } }),
            db.workTask.findMany({ where: { workRequestId: wr.id }, orderBy: { code: 'asc' } }),
            db.acceptance.findMany({ where: { workRequestId: wr.id }, orderBy: { acceptedAt: 'desc' } }),
          ])
        return {
          workRequestId: wr.id,
          workCode: wr.code,
          workTitle: wr.title,
          workStatus: wr.status,
          pointAction: matched[0]?.action ?? '',
          pointLocation: [...new Set(matched.map((m) => m.location))].join('；'),
          applicantName: wr.applicantName,
          unitName: unitNameById.get(wr.unitId) ?? null,
          plannedStart: wr.plannedStart,
          plannedEnd: wr.plannedEnd,
          survey: survey
            ? {
                surveyor: survey.surveyor,
                surveyDate: survey.surveyDate,
                isSafe: survey.isSafe,
                siteCondition: survey.siteCondition,
                suggestion: survey.suggestion,
              }
            : null,
          jsa: jsa
            ? { leader: jsa.leader, members: jsa.members, analysisDate: jsa.analysisDate, riskLevel: jsa.riskLevel }
            : null,
          isolationScheme: isolationScheme
            ? { code: isolationScheme.code, status: isolationScheme.status, reviewedBy: isolationScheme.reviewedBy, comment: isolationScheme.comment }
            : null,
          disposalScheme: disposalScheme
            ? { code: disposalScheme.code, status: disposalScheme.status, reviewedBy: disposalScheme.reviewedBy }
            : null,
          ticket: ticket.length
            ? {
                code: ticket.map((t) => t.code).join('/'),
                status: ticket[0].status === ticket[ticket.length - 1].status ? ticket[0].status : ticket.map((t) => t.status).join('/'),
                guardian: [...new Set(ticket.map((t) => t.guardian))].join('、'),
                issuer: [...new Set(ticket.map((t) => t.issuer))].join('、'),
                startedAt: ticket.find((t) => t.startedAt)?.startedAt ?? null,
                finishedAt: ticket.every((t) => t.finishedAt) ? ticket[ticket.length - 1].finishedAt : null,
                closedAt: ticket.every((t) => t.closedAt) ? ticket[ticket.length - 1].closedAt : null,
              }
            : null,
          tasks: tasks.map((t) => ({
            id: t.id,
            code: t.code,
            status: t.status,
            assignee: t.assignee,
            planStart: t.planStart,
            planEnd: t.planEnd,
          })),
          acceptances: acceptances.map((a) => ({
            id: a.id,
            conclusion: a.conclusion,
            acceptor: a.acceptor,
            acceptedAt: a.acceptedAt,
            problems: a.problems,
          })),
        }
      })
    )

    return NextResponse.json({
      plate: { ...plate, unitName: unit?.name ?? null },
      changes,
      businesses,
    })
  } catch (e) {
    console.error('[GET /api/blind-plates/[id]/dossier]', e)
    return jsonError(e instanceof Error ? e.message : '获取盲板档案失败', 500)
  }
}
