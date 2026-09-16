import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError, num, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** 主数据通盲状态（需求 20）：该隔离点当前盲板通/断状态的动态推导，不落库 */
export type BlindThroughState = 'BLINDED' | 'OPEN' | 'WORKING' | null

/** 通盲状态推导（与 PID 六态同口径、主数据视角简化）：
 * - 作业执行中（request IN_PROGRESS 且点位未勾完成）→ WORKING 作业中
 * - 否则取最近一次完工记录（done=true，按 doneAt 最新）：ADD → BLINDED 盲断（盲板在装）；REMOVE → OPEN 导通
 * - 无任何业务引用 → null 常通 */
function deriveBlindState(
  refs: Array<{ done: boolean; action: string; doneAt: Date | null; reqStatus: string | null }>
): { state: BlindThroughState; label: string } {
  const EXEC = 'IN_PROGRESS'
  if (refs.some((r) => !r.done && r.reqStatus === EXEC)) {
    return { state: 'WORKING', label: '作业执行中' }
  }
  const finished = refs.filter((r) => r.done)
  if (finished.length > 0) {
    const latest = finished.reduce((a, b) => ((b.doneAt?.getTime() ?? 0) >= (a.doneAt?.getTime() ?? 0) ? b : a))
    if (latest.action === 'ADD') return { state: 'BLINDED', label: '盲断（盲板在装）' }
    return { state: 'OPEN', label: '导通（盲板已拆）' }
  }
  return { state: null, label: '常通' }
}

/** GET /api/iso-point-masters?keyword=&pipelineId= → 隔离点主数据列表（含 pipelineName、通盲状态 blindState 与被业务引用次数 refCount） */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const keyword = sp.get('keyword') ?? undefined
    const pipelineId = num(sp.get('pipelineId'))
    const where: Prisma.IsoPointMasterWhereInput = {}
    if (keyword) {
      where.OR = [{ code: { contains: keyword } }, { name: { contains: keyword } }]
    }
    if (pipelineId !== null) where.pipelineId = pipelineId
    const masters = await db.isoPointMaster.findMany({
      where,
      orderBy: { code: 'asc' },
      include: { pipeline: true },
    })
    // refCount = 被 IsolationPoint.masterPointId 引用次数（批量查询防 N+1）
    const ids = masters.map((m) => m.id)
    const refs = ids.length
      ? await db.isolationPoint.findMany({
          where: { masterPointId: { in: ids } },
          select: { masterPointId: true, done: true, action: true, doneAt: true, schemeId: true },
        })
      : []
    const refMap = new Map<number, number>()
    for (const r of refs) {
      if (r.masterPointId == null) continue
      refMap.set(r.masterPointId, (refMap.get(r.masterPointId) ?? 0) + 1)
    }
    // 通盲状态批量推导：IsolationPoint.schemeId → IsolationScheme.workRequestId → WorkRequest.status
    //（IsolationScheme 无 workRequest 反向导航，三级手工 Map 关联防 N+1）
    const schemeIds = [...new Set(refs.map((r) => r.schemeId))]
    const schemes = schemeIds.length
      ? await db.isolationScheme.findMany({ where: { id: { in: schemeIds } }, select: { id: true, workRequestId: true } })
      : []
    const scheme2wr = new Map(schemes.map((s) => [s.id, s.workRequestId]))
    const wrIds = [...new Set(schemes.map((s) => s.workRequestId))]
    const reqs = wrIds.length
      ? await db.workRequest.findMany({ where: { id: { in: wrIds } }, select: { id: true, status: true } })
      : []
    const wr2status = new Map(reqs.map((w) => [w.id, w.status]))
    const refsByMaster = new Map<number, Array<{ done: boolean; action: string; doneAt: Date | null; reqStatus: string | null }>>()
    for (const r of refs) {
      if (r.masterPointId == null) continue
      const arr = refsByMaster.get(r.masterPointId) ?? []
      arr.push({ done: r.done, action: r.action, doneAt: r.doneAt, reqStatus: wr2status.get(scheme2wr.get(r.schemeId) ?? -1) ?? null })
      refsByMaster.set(r.masterPointId, arr)
    }
    return NextResponse.json({
      list: masters.map((m) => {
        const blind = deriveBlindState(refsByMaster.get(m.id) ?? [])
        return {
          ...m,
          pipelineName: m.pipeline?.name ?? null,
          refCount: refMap.get(m.id) ?? 0,
          blindState: blind.state,
          blindLabel: blind.label,
        }
      }),
    })
  } catch (e) {
    console.error('[GET /api/iso-point-masters]', e)
    return jsonError(e instanceof Error ? e.message : '获取隔离点主数据列表失败', 500)
  }
}

/**
 * POST /api/iso-point-masters 创建隔离点主数据
 * body: { code, name, pipelineId?, location?, remark? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const code = str(body.code)
    const name = str(body.name)
    if (!code || !name) return jsonError('点位编码和名称不能为空')
    if (body.pipelineId !== undefined && body.pipelineId !== null && str(body.pipelineId) !== '' && num(body.pipelineId) === null) {
      return jsonError('pipelineId 必须为数字')
    }
    const pipelineId = num(body.pipelineId)
    if (pipelineId !== null) {
      const pipeline = await db.pipeline.findUnique({ where: { id: pipelineId } })
      if (!pipeline) return jsonError('关联管线不存在')
    }
    const exists = await db.isoPointMaster.findUnique({ where: { code } })
    if (exists) return jsonError('点位编码已存在', 409)
    const master = await db.isoPointMaster.create({
      data: {
        code,
        name,
        pipelineId,
        location: str(body.location) || null,
        remark: str(body.remark) || null,
      },
    })
    return NextResponse.json(master, { status: 201 })
  } catch (e) {
    console.error('[POST /api/iso-point-masters]', e)
    return jsonError(e instanceof Error ? e.message : '创建隔离点主数据失败', 500)
  }
}
