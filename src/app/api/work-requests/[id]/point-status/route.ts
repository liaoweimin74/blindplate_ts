import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, parseId, str } from '@/lib/bp-server-utils'
import { parsePidContent, PID_POINT_STATE_MAP, resolvePidPointState, type PidPointState } from '@/lib/bp-types'

export const dynamic = 'force-dynamic'

/** 单个隔离点的主数据关联与六态条目（详情页徽章用） */
interface PointStatus {
  id: number
  seq: number
  masterPointId: number | null
  masterCode: string | null
  masterName: string | null
  pipelineName: string | null
  state: PidPointState
  stateLabel: string
}

/**
 * GET /api/work-requests/[id]/point-status → 该需求全部隔离点的主数据关联与六态
 * 六态判定基于该需求自身的 scheme/task（同 bp-types.resolvePidPointState）；
 * 并返回关联点位编码出现在哪些 PID 组态图中（marks code 交集，全表扫描）。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const wid = parseId(id)
    if (!wid) return jsonError('无效的需求 ID')
    const request = await db.workRequest.findUnique({ where: { id: wid } })
    if (!request) return jsonError('作业需求不存在', 404)

    const scheme = await db.isolationScheme.findUnique({ where: { workRequestId: wid } })
    const points = scheme
      ? await db.isolationPoint.findMany({ where: { schemeId: scheme.id }, orderBy: { seq: 'asc' } })
      : []
    const task = scheme ? await db.workTask.findUnique({ where: { workRequestId: wid } }) : null

    // 主数据批量查询：masterPointId 精确 + masterCode/code 匹配，Map 关联防 N+1
    const masterIds = [...new Set(points.map((p) => p.masterPointId).filter((v): v is number => v != null))]
    const lookupCodes = [...new Set(points.map((p) => p.masterCode || p.code).filter((v): v is string => !!v))]
    const mastersById = masterIds.length
      ? await db.isoPointMaster.findMany({ where: { id: { in: masterIds } }, include: { pipeline: true } })
      : []
    const mastersByCode = lookupCodes.length
      ? await db.isoPointMaster.findMany({ where: { code: { in: lookupCodes } }, include: { pipeline: true } })
      : []
    const byId = new Map(mastersById.map((m) => [m.id, m]))
    const byCode = new Map(mastersByCode.map((m) => [m.code, m]))

    // 该需求自身的方案/任务状态 + 点位级动作/执行状态决定六态（需求8：加装完工 → 盲板已装，拆除完工 → 盲板已拆）
    const stateOf = (p: (typeof points)[number]) =>
      resolvePidPointState(request.status, scheme?.status ?? null, task?.status ?? null, p.action ?? null, p.done)

    // 关联点位编码出现在哪些 PID 图（解析每张图 marks 的 code 集合求交集）
    const codes = new Set<string>()
    for (const p of points) {
      if (p.code) codes.add(p.code)
      if (p.masterCode) codes.add(p.masterCode)
    }
    const diagrams = await db.pidDiagram.findMany({ select: { id: true, name: true, content: true } })
    const hitDiagrams = diagrams
      .filter((d) => parsePidContent(d.content).marks.some((mk) => codes.has(str(mk.code))))
      .map((d) => ({ id: d.id, name: d.name }))

    const result: PointStatus[] = points.map((p) => {
      const key = p.masterCode || p.code
      const master =
        (p.masterPointId != null ? (byId.get(p.masterPointId) ?? undefined) : undefined) ??
        (key ? (byCode.get(key) ?? undefined) : undefined) ??
        null
      const st = stateOf(p)
      return {
        id: p.id,
        seq: p.seq,
        masterPointId: p.masterPointId,
        masterCode: p.masterCode ?? p.code ?? null,
        masterName: master?.name ?? p.name ?? null,
        pipelineName: master?.pipeline?.name ?? null,
        state: st,
        stateLabel: PID_POINT_STATE_MAP[st].label,
      }
    })

    return NextResponse.json({
      points: result,
      diagrams: hitDiagrams,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[GET /api/work-requests/[id]/point-status]', e)
    return jsonError(e instanceof Error ? e.message : '获取点位状态失败', 500)
  }
}
