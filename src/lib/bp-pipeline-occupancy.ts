/**
 * 管线作业互斥校验（安全硬约束）
 * 规则：一条管线同一时间只允许有一张「生效中」的盲板作业票。
 * 生效中 = 作业需求已开票（TICKET_ISSUED）且未到达终态，即：
 *   TICKET_ISSUED 待批准 / TICKET_APPROVED 已批准待作业 / IN_PROGRESS 作业中 / PENDING_ACCEPTANCE 待验收
 * 需求 COMPLETED（验收完成）或 CANCELLED（取消）后释放管线占用。
 * 冲突时开票/批准/开工接口直接 409 拒绝，防止两条作业在同一管线并发盲板操作引发事故。
 */
import { db } from '@/lib/db'
import { bizStatusLabel } from '@/lib/bp-server-utils'

/** 占用管线的作业需求状态集合（开票 → 终态前） */
export const PIPELINE_OCCUPYING_STATUSES = [
  'TICKET_ISSUED',
  'TICKET_APPROVED',
  'IN_PROGRESS',
  'PENDING_ACCEPTANCE',
]

/** 管线占用冲突明细 */
export interface PipelineTicketConflict {
  pipelineId: number
  pipelineCode: string
  pipelineName: string
  workRequestId: number
  workRequestCode: string
  workRequestTitle: string
  workRequestStatus: string
  ticketCode: string | null
  ticketStatus: string | null
}

/**
 * 收集某作业需求占用的全部管线 ID：
 * ① 需求直接引用的管线（WorkRequest.pipelineId）
 * ② 隔离方案点位引用的隔离点主数据所属管线（IsolationPoint.masterPointId → IsoPointMaster.pipelineId）
 */
export async function collectRequestPipelineIds(workRequestId: number): Promise<number[]> {
  const ids = new Set<number>()
  const req = await db.workRequest.findUnique({
    where: { id: workRequestId },
    select: { pipelineId: true },
  })
  if (req?.pipelineId != null) ids.add(req.pipelineId)
  const scheme = await db.isolationScheme.findUnique({
    where: { workRequestId },
    select: { id: true },
  })
  if (scheme) {
    const points = await db.isolationPoint.findMany({
      where: { schemeId: scheme.id },
      select: { masterPointId: true },
    })
    const masterIds = [
      ...new Set(points.map((p) => p.masterPointId).filter((x): x is number => typeof x === 'number')),
    ]
    if (masterIds.length) {
      const masters = await db.isoPointMaster.findMany({
        where: { id: { in: masterIds } },
        select: { pipelineId: true },
      })
      for (const m of masters) if (m.pipelineId != null) ids.add(m.pipelineId)
    }
  }
  return [...ids]
}

/**
 * 查询这些管线当前被哪些「生效作业票」的其他需求占用。
 * 匹配双向覆盖：对方需求直接引用管线，或其隔离点位主数据落在这些管线上。
 * @param pipelineIds 目标管线 ID 集合
 * @param excludeRequestId 排除的需求（自身票据操作场景排除自己）
 */
export async function findPipelineTicketConflicts(
  pipelineIds: number[],
  excludeRequestId?: number
): Promise<PipelineTicketConflict[]> {
  if (!pipelineIds.length) return []

  // 目标管线上的隔离点主数据（用于反向匹配对方需求的点位引用）
  const masters = await db.isoPointMaster.findMany({
    where: { pipelineId: { in: pipelineIds } },
    select: { id: true, pipelineId: true },
  })
  const masterId2Pipe = new Map(masters.map((m) => [m.id, m.pipelineId]))
  const masterIds = masters.map((m) => m.id)

  // 候选占用需求：① 直接引用管线 ② 隔离点主数据引用
  const direct = await db.workRequest.findMany({
    where: {
      status: { in: PIPELINE_OCCUPYING_STATUSES },
      pipelineId: { in: pipelineIds },
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
    },
  })
  const candMap = new Map<number, (typeof direct)[number]>()
  for (const r of direct) candMap.set(r.id, r)

  if (masterIds.length) {
    const pts = await db.isolationPoint.findMany({
      where: { masterPointId: { in: masterIds } },
      select: { schemeId: true },
    })
    const schemeIds = [...new Set(pts.map((p) => p.schemeId))]
    const schemes = schemeIds.length
      ? await db.isolationScheme.findMany({
          where: { id: { in: schemeIds } },
          select: { workRequestId: true },
        })
      : []
    const wids = [
      ...new Set(schemes.map((s) => s.workRequestId).filter((id) => id !== excludeRequestId)),
    ]
    if (wids.length) {
      const viaPoint = await db.workRequest.findMany({
        where: { id: { in: wids }, status: { in: PIPELINE_OCCUPYING_STATUSES } },
      })
      for (const r of viaPoint) candMap.set(r.id, r)
    }
  }
  if (!candMap.size) return []

  // 计算每个候选需求实际匹配到的目标管线集合
  const candIds = [...candMap.keys()]
  const candSchemes = await db.isolationScheme.findMany({
    where: { workRequestId: { in: candIds } },
    select: { id: true, workRequestId: true },
  })
  const schemeId2Wid = new Map(candSchemes.map((s) => [s.id, s.workRequestId]))
  const candSchemeIds = candSchemes.map((s) => s.id)
  const candPoints = candSchemeIds.length
    ? await db.isolationPoint.findMany({
        where: { schemeId: { in: candSchemeIds }, masterPointId: { not: null } },
        select: { schemeId: true, masterPointId: true },
      })
    : []
  const wid2Pipes = new Map<number, Set<number>>()
  const ensure = (wid: number) => {
    let s = wid2Pipes.get(wid)
    if (!s) {
      s = new Set()
      wid2Pipes.set(wid, s)
    }
    return s
  }
  for (const r of candMap.values()) {
    if (r.pipelineId != null && pipelineIds.includes(r.pipelineId)) ensure(r.id).add(r.pipelineId)
  }
  for (const p of candPoints) {
    const pid = p.masterPointId != null ? masterId2Pipe.get(p.masterPointId) : undefined
    if (pid == null || !pipelineIds.includes(pid)) continue
    const wid = schemeId2Wid.get(p.schemeId)
    if (wid != null) ensure(wid).add(pid)
  }

  // 管线标签 / 票据快照
  const pipelines = await db.pipeline.findMany({
    where: { id: { in: pipelineIds } },
    select: { id: true, code: true, name: true },
  })
  const pipeMap = new Map(pipelines.map((p) => [p.id, p]))
  const tickets = await db.workTicket.findMany({
    where: { workRequestId: { in: candIds } },
    select: { workRequestId: true, code: true, status: true, pointCode: true },
    orderBy: { createdAt: 'desc' },
  })
  // 一需求多票：取代表性票（createdAt 倒序下，第一张生效中票优先；否则最新一张）
  const ticketMap = new Map<number, (typeof tickets)[number]>()
  for (const t of tickets) {
    const prev = ticketMap.get(t.workRequestId)
    if (!prev) { ticketMap.set(t.workRequestId, t); continue }
    const prevActive = prev.status !== 'VOID' && prev.status !== 'CLOSED'
    if (!prevActive) ticketMap.set(t.workRequestId, t)
  }

  const conflicts: PipelineTicketConflict[] = []
  for (const r of candMap.values()) {
    const t = ticketMap.get(r.id)
    for (const pid of wid2Pipes.get(r.id) ?? []) {
      const pl = pipeMap.get(pid)
      if (!pl) continue
      conflicts.push({
        pipelineId: pid,
        pipelineCode: pl.code,
        pipelineName: pl.name,
        workRequestId: r.id,
        workRequestCode: r.code,
        workRequestTitle: r.title,
        workRequestStatus: r.status,
        ticketCode: t?.code ?? null,
        ticketStatus: t?.status ?? null,
      })
    }
  }
  conflicts.sort((a, b) => a.pipelineId - b.pipelineId || a.workRequestId - b.workRequestId)
  return conflicts
}

/**
 * 收集指定隔离点（一票一板：票→点位）占用的管线 ID：
 * ① 点位主数据所属管线（IsolationPoint.masterPointId → IsoPointMaster.pipelineId）
 * ② 点位无主数据时回退需求直接引用管线（WorkRequest.pipelineId）
 */
export async function collectPointPipelineIds(pointId: number, fallbackPipelineId?: number | null): Promise<number[]> {
  const point = await db.isolationPoint.findUnique({
    where: { id: pointId },
    select: { masterPointId: true },
  })
  if (point?.masterPointId != null) {
    const master = await db.isoPointMaster.findUnique({
      where: { id: point.masterPointId },
      select: { pipelineId: true },
    })
    if (master?.pipelineId != null) return [master.pipelineId]
  }
  return fallbackPipelineId != null ? [fallbackPipelineId] : []
}

/**
 * 点粒度管线占用冲突（一票一板开票/批准 gate）：
 * 该点位所在管线是否已被其他需求的生效作业票占用。
 */
export async function findPointPipelineConflicts(
  pointId: number,
  excludeRequestId: number,
  fallbackPipelineId?: number | null
): Promise<PipelineTicketConflict[]> {
  const ids = await collectPointPipelineIds(pointId, fallbackPipelineId)
  return findPipelineTicketConflicts(ids, excludeRequestId)
}

/**
 * 同管线同时作业互斥（/start 专用）：同需求内已有另一张作业中的票落在同一管线。
 * 依据化工盲板抽堵规程「严禁在同一管道上同时进行两处及以上盲板抽堵作业」，
 * 多点抽堵应按隔离方案顺序逐点进行（跨需求占用已由 findPipelineTicketConflicts 覆盖）。
 */
export async function findSamePipelineRunningTicket(
  ticket: { id: number; workRequestId: number; pointId: number | null }
): Promise<{ code: string; pointId: number | null; pointCode: string | null } | null> {
  if (ticket.pointId == null) return null
  const myPipeIds = await collectPointPipelineIds(ticket.pointId)
  if (!myPipeIds.length) return null
  const running = await db.workTicket.findMany({
    where: { workRequestId: ticket.workRequestId, status: 'IN_PROGRESS', id: { not: ticket.id } },
    select: { id: true, code: true, pointId: true, pointCode: true },
  })
  for (const t of running) {
    if (t.pointId == null) continue
    const pipes = await collectPointPipelineIds(t.pointId)
    if (pipes.some((p) => myPipeIds.includes(p))) return { code: t.code, pointId: t.pointId, pointCode: t.pointCode }
  }
  return null
}

/** 便捷：某需求的管线占用冲突（自动收集该需求涉及的管线，排除自身） */
export async function findRequestPipelineConflicts(
  workRequestId: number
): Promise<PipelineTicketConflict[]> {
  const ids = await collectRequestPipelineIds(workRequestId)
  return findPipelineTicketConflicts(ids, workRequestId)
}

/** 冲突中文文案（开票/批准/开工阻断提示，toast 直接展示） */
export function formatPipelineConflictMessage(conflicts: PipelineTicketConflict[]): string {
  const parts = conflicts.map(
    (c) =>
      `${c.pipelineCode}${c.pipelineName && c.pipelineName !== c.pipelineCode ? `（${c.pipelineName}）` : ''}` +
      `已被生效作业票 ${c.ticketCode ?? '—'}（需求 ${c.workRequestCode}「${c.workRequestTitle}」，${bizStatusLabel(c.workRequestStatus)}）占用`
  )
  return (
    `管线占用冲突：${parts.join('；')}。` +
    '按规定一条管线同一时间只允许一张生效中的盲板作业票，请待上述作业票关闭或需求取消后再操作。'
  )
}
