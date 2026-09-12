import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, parseId, str } from '@/lib/bp-server-utils'
import { parsePidContent, PID_POINT_STATE_MAP, resolvePidPointState, type PidPointState } from '@/lib/bp-types'

export const dynamic = 'force-dynamic'

/** 单个挂标的六态状态条目 */
interface MarkStatus {
  markId: string
  code: string
  name: string | null
  masterPointId: number | null
  state: PidPointState
  stateLabel: string
  requestId: number | null
  requestCode: string | null
  schemeId: number | null
  schemeCode: string | null
  ticketCode: string | null
  blindCode: string | null
}

/**
 * GET /api/pid-diagrams/[id]/status → 组态图各挂标(mark)的六态实时状态
 * 匹配规则：mark.code === IsolationPoint.masterCode || mark.code === IsolationPoint.code；
 * 一个 mark 命中多条历史业务时，取所属作业需求最新（createdAt 降序，id 兜底）的一条。
 * 六态判定规则见 bp-types.resolvePidPointState（无匹配 idle → COMPLETED opened → IN_PROGRESS blinded
 * → 方案已审核 working/approved → 计划环节 planned → 其余 idle）。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const did = parseId(id)
    if (!did) return jsonError('无效的 PID 图 ID')
    const diagram = await db.pidDiagram.findUnique({ where: { id: did } })
    if (!diagram) return jsonError('PID 图不存在', 404)

    const marks = parsePidContent(diagram.content).marks

    // 批量拉取业务链路：隔离点(+方案) → 需求/任务/作业票，Map 关联防 N+1
    const points = await db.isolationPoint.findMany({ include: { scheme: true } })
    const reqIds = [...new Set(points.map((p) => p.scheme.workRequestId))]
    const [requests, tasks, tickets] = await Promise.all([
      db.workRequest.findMany({ where: { id: { in: reqIds } } }),
      db.workTask.findMany({ where: { workRequestId: { in: reqIds } } }),
      db.workTicket.findMany({ where: { workRequestId: { in: reqIds } } }),
    ])
    const reqMap = new Map(requests.map((r) => [r.id, r]))
    const taskMap = new Map(tasks.map((t) => [t.workRequestId, t]))
    const ticketMap = new Map(tickets.map((t) => [t.workRequestId, t]))

    // mark 编码 → 隔离点主数据（供前端关联跳转）
    const markCodes = [...new Set(marks.map((m) => str(m.code)).filter(Boolean))]
    const masters = markCodes.length ? await db.isoPointMaster.findMany({ where: { code: { in: markCodes } } }) : []
    const masterMap = new Map(masters.map((m) => [m.code, m]))

    /** 匹配一个编码对应的业务隔离点（多条历史取需求最新） */
    const matchOf = (code: string) => {
      if (!code) return null
      const candidates = points
        .filter((p) => p.masterCode === code || p.code === code)
        .map((p) => ({ point: p, request: reqMap.get(p.scheme.workRequestId) }))
        .filter((x): x is { point: (typeof points)[number]; request: (typeof requests)[number] } => x.request != null)
      if (!candidates.length) return null
      candidates.sort((a, b) => {
        const ta = a.request.createdAt.getTime()
        const tb = b.request.createdAt.getTime()
        if (ta !== tb) return tb - ta
        if (a.request.id !== b.request.id) return b.request.id - a.request.id
        return b.point.id - a.point.id
      })
      return candidates[0]
    }

    const matches = marks.map((m) => matchOf(str(m.code)))

    // 批量补盲板编号（matched point 绑定的盲板实体）
    const plateIds = [
      ...new Set(
        matches
          .filter((x) => x?.point.blindPlateId != null)
          .map((x) => x!.point.blindPlateId as number)
      ),
    ]
    const plates = plateIds.length ? await db.blindPlate.findMany({ where: { id: { in: plateIds } } }) : []
    const plateMap = new Map(plates.map((p) => [p.id, p]))

    const result: MarkStatus[] = marks.map((m, i) => {
      const code = str(m.code)
      const match = matches[i] ?? null
      const request = match?.request ?? null
      const task = request ? (taskMap.get(request.id) ?? null) : null
      const ticket = request ? (ticketMap.get(request.id) ?? null) : null
      const master = code ? (masterMap.get(code) ?? null) : null
      const plate = match?.point.blindPlateId != null ? (plateMap.get(match.point.blindPlateId) ?? null) : null
      const state = resolvePidPointState(
        request?.status ?? null,
        match ? match.point.scheme.status : null,
        task?.status ?? null
      )
      return {
        markId: str(m.id) || `mark-${i + 1}`,
        code,
        name: str(m.name) || null,
        masterPointId: master?.id ?? null,
        state,
        stateLabel: PID_POINT_STATE_MAP[state].label,
        requestId: request?.id ?? null,
        requestCode: request?.code ?? null,
        schemeId: match ? match.point.schemeId : null,
        schemeCode: match ? match.point.scheme.code : null,
        ticketCode: ticket?.code ?? null,
        blindCode: plate?.code ?? null,
      }
    })

    return NextResponse.json({ points: result, generatedAt: new Date().toISOString() })
  } catch (e) {
    console.error('[GET /api/pid-diagrams/[id]/status]', e)
    return jsonError(e instanceof Error ? e.message : '获取 PID 图状态失败', 500)
  }
}
