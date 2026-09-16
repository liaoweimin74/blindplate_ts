import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/point-dossier?masterPointId=3 或 ?code=IP-R201-01
 * → 隔离点位的盲板作业全生命周期档案（供 PID 盲板状态页点击挂标抽屉展示）
 *
 * 匹配口径（与 PID 状态接口一致）：IsolationPoint.masterPointId 精确优先，
 * 兼容 masterCode / code 历史快照；一个点位可命中多条历史作业链（多个需求）。
 *
 * 返回 chains 为该点位全部有效作业链（已取消 CANCELLED 剔除）；
 * 「当天以前完工的历史作业不显示」由前端按浏览器本地时区过滤（finishedAt 字段支持）。
 */
interface DossierStep {
  seq: number
  method: string
  detail: string
  standard: string | null
  completed: boolean
  masterCode: string | null
  matched: boolean
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mpRaw = sp.get('masterPointId')
    const code = str(sp.get('code'))
    const mid = mpRaw ? Number(mpRaw) : NaN
    if (!mpRaw && !code) return jsonError('缺少 masterPointId 或 code 参数')
    if (mpRaw && (!Number.isInteger(mid) || mid <= 0)) return jsonError('无效的 masterPointId')

    // 1. 隔离点主数据（可能不存在：挂标的 code 对应主数据已删，仍按编码查历史业务）
    const master = Number.isInteger(mid)
      ? await db.isoPointMaster.findUnique({ where: { id: mid } })
      : code
        ? await db.isoPointMaster.findUnique({ where: { code } })
        : null
    const effCode = str(master?.code) || code

    // 2. 命中的业务隔离点（含方案）——主数据 ID / 编码快照 / 历史编码 三口径并集
    const or: Record<string, unknown>[] = []
    if (master) or.push({ masterPointId: master.id })
    if (effCode) {
      or.push({ masterCode: effCode })
      or.push({ code: effCode })
    }
    const matchedPoints = or.length
      ? await db.isolationPoint.findMany({ where: { OR: or }, include: { scheme: true } })
      : []

    // 3. 汇总需求链（剔除已取消）
    const reqIds = [...new Set(matchedPoints.map((p) => p.scheme.workRequestId))]
    const requests = reqIds.length
      ? await db.workRequest.findMany({
          where: { id: { in: reqIds }, status: { not: 'CANCELLED' } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      : []
    const reqMap = new Map(requests.map((r) => [r.id, r]))

    // 4. 批量取链上单据
    const [schemes, disposals, confirmations, tickets, tasks, acceptances] = await Promise.all([
      db.isolationScheme.findMany({ where: { workRequestId: { in: reqIds } } }),
      db.disposalScheme.findMany({ where: { workRequestId: { in: reqIds } }, include: { steps: true } }),
      db.disposalConfirmation.findMany({ where: { workRequestId: { in: reqIds } } }),
      db.workTicket.findMany({ where: { workRequestId: { in: reqIds } } }),
      db.workTask.findMany({ where: { workRequestId: { in: reqIds } } }),
      db.acceptance.findMany({ where: { workRequestId: { in: reqIds } } }),
    ])
    const schemeMap = new Map(schemes.map((s) => [s.workRequestId, s]))
    const disposalMap = new Map(disposals.map((d) => [d.workRequestId, d]))
    const confirmMap = new Map(confirmations.map((c) => [c.workRequestId, c]))
    const ticketMap = new Map(tickets.map((t) => [t.workRequestId, t]))
    const taskMap = new Map(tasks.map((t) => [t.workRequestId, t]))
    const acceptMap = new Map(acceptances.map((a) => [a.workRequestId, a]))

    // 点位绑定的盲板实体编号
    const plateIds = [
      ...new Set(
        matchedPoints.filter((p) => p.blindPlateId != null).map((p) => p.blindPlateId as number),
      ),
    ]
    const plates = plateIds.length ? await db.blindPlate.findMany({ where: { id: { in: plateIds } } }) : []
    const plateMap = new Map(plates.map((p) => [p.id, p]))

    const chains = requests.map((r) => {
      const pointRows = matchedPoints
        .filter((p) => p.scheme.workRequestId === r.id)
        .sort((a, b) => a.seq - b.seq)
        .map((p) => ({
          id: p.id,
          seq: p.seq,
          location: p.location,
          medium: p.medium,
          pressure: p.pressure,
          blindSpec: p.blindSpec,
          blindType: p.blindType,
          action: p.action, // ADD加装 | REMOVE拆除
          done: p.done,
          doneAt: p.doneAt,
          operator: p.operator,
          code: p.code,
          masterCode: p.masterCode,
          blindPlateCode: p.blindPlateId != null ? (plateMap.get(p.blindPlateId)?.code ?? null) : null,
        }))

      const scheme = schemeMap.get(r.id) ?? null
      const disposal = disposalMap.get(r.id) ?? null
      const confirmation = confirmMap.get(r.id) ?? null
      const ticket = ticketMap.get(r.id) ?? null
      const task = taskMap.get(r.id) ?? null
      const acceptance = acceptMap.get(r.id) ?? null

      // 处置步骤：仅展示与该点位相关（masterPointId / masterCode 匹配）的步骤
      let steps: DossierStep[] = []
      let stepsTotal = 0
      if (disposal) {
        stepsTotal = disposal.steps.length
        steps = disposal.steps
          .slice()
          .sort((a, b) => a.seq - b.seq)
          .map((s) => ({
            seq: s.seq,
            method: s.method,
            detail: s.detail,
            standard: s.standard,
            completed: s.completed,
            masterCode: s.masterCode,
            matched: master ? s.masterPointId === master.id : !!effCode && s.masterCode === effCode,
          }))
          .filter((s) => s.matched)
      }

      // 链级完结时间：验收通过 > 作业票完工 > 任务实际结束（用于前端「当日以前完工不显示」过滤）
      const finishedAt = acceptance?.acceptedAt ?? ticket?.finishedAt ?? task?.actualEnd ?? null

      return {
        requestId: r.id,
        requestCode: r.code,
        title: r.title,
        urgency: r.urgency,
        status: r.status,
        createdAt: r.createdAt,
        applicantName: r.applicantName,
        reason: r.reason,
        location: r.location,
        medium: r.medium,
        pressure: r.pressure,
        isoPoints: pointRows,
        scheme: scheme
          ? {
              id: scheme.id,
              code: scheme.code,
              status: scheme.status,
              preparedBy: scheme.preparedBy,
              preparedAt: scheme.preparedAt,
              reviewedBy: scheme.reviewedBy,
              reviewedAt: scheme.reviewedAt,
              comment: scheme.comment,
            }
          : null,
        disposal: disposal
          ? {
              id: disposal.id,
              code: disposal.code,
              status: disposal.status,
              preparedBy: disposal.preparedBy,
              steps,
              stepsTotal,
              confirmation: confirmation
                ? {
                    confirmer: confirmation.confirmer,
                    confirmedAt: confirmation.confirmedAt,
                    result: confirmation.result,
                    analysisQualified: confirmation.analysisQualified,
                  }
                : null,
            }
          : null,
        ticket: ticket
          ? {
              code: ticket.code,
              status: ticket.status,
              plannedStart: ticket.plannedStart,
              plannedEnd: ticket.plannedEnd,
              guardian: ticket.guardian,
              workers: ticket.workers,
              issuer: ticket.issuer,
              startedAt: ticket.startedAt,
              finishedAt: ticket.finishedAt,
              closedAt: ticket.closedAt,
            }
          : null,
        task: task
          ? {
              code: task.code,
              status: task.status,
              assignee: task.assignee,
              actualStart: task.actualStart,
              actualEnd: task.actualEnd,
            }
          : null,
        acceptance: acceptance
          ? {
              acceptor: acceptance.acceptor,
              acceptedAt: acceptance.acceptedAt,
              conclusion: acceptance.conclusion,
              problems: acceptance.problems,
            }
          : null,
        finishedAt,
        active: !['COMPLETED', 'CANCELLED'].includes(r.status),
      }
    })

    return NextResponse.json({
      point: master
        ? { id: master.id, code: master.code, name: master.name, location: master.location, pipelineId: master.pipelineId }
        : null,
      chains,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[GET /api/point-dossier]', e)
    return jsonError(e instanceof Error ? e.message : '获取点位作业档案失败', 500)
  }
}
