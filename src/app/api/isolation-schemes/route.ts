import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, generateCode, jsonError, logAudit, num, parseId, readBody, resolveActor, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/isolation-schemes?workRequestId= → 方案（含 points）；不带参数返回全部（含 workRequest 摘要，按 preparedAt 倒序，最多200条） */
export async function GET(req: NextRequest) {
  try {
    const widRaw = req.nextUrl.searchParams.get('workRequestId')
    if (widRaw !== null) {
      const wid = parseId(widRaw)
      if (!wid) return jsonError('无效的 workRequestId')
      const scheme = await db.isolationScheme.findUnique({ where: { workRequestId: wid } })
      if (!scheme) return NextResponse.json(null)
      const points = await db.isolationPoint.findMany({
        where: { schemeId: scheme.id },
        orderBy: { seq: 'asc' },
      })
      return NextResponse.json({ ...scheme, points })
    }
    const schemes = await db.isolationScheme.findMany({ orderBy: { preparedAt: 'desc' }, take: 200 })
    const points = await db.isolationPoint.findMany({ orderBy: { seq: 'asc' } })
    const byScheme = new Map<number, typeof points>()
    for (const p of points) {
      const list = byScheme.get(p.schemeId) ?? []
      list.push(p)
      byScheme.set(p.schemeId, list)
    }
    // 附所属作业需求（编号/标题/状态/装置），供方案工作台列表展示
    const reqIds = [...new Set(schemes.map((s) => s.workRequestId))]
    const requests = reqIds.length
      ? await db.workRequest.findMany({
          where: { id: { in: reqIds } },
          select: { id: true, code: true, title: true, status: true, unitId: true },
        })
      : []
    const reqMap = new Map(requests.map((r) => [r.id, r]))
    return NextResponse.json(
      schemes.map((s) => ({ ...s, points: byScheme.get(s.id) ?? [], workRequest: reqMap.get(s.workRequestId) ?? null }))
    )
  } catch (e) {
    console.error('[GET /api/isolation-schemes]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取隔离方案失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/isolation-schemes { workRequestId, preparedBy, points[] }
 * 生成编号 GL-YYYYMM-XXX，创建方案+隔离点，需求状态 → ISOLATION_PREPARING
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const wid = num(body.workRequestId)
    const preparedBy = str(body.preparedBy)
    if (wid === null) return jsonError('无效的 workRequestId')
    if (!preparedBy) return jsonError('编制人不能为空')
    const request = await db.workRequest.findUnique({ where: { id: wid } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (request.status === 'COMPLETED' || request.status === 'CANCELLED') {
      return jsonError('该需求已完结，不可编制隔离方案')
    }
    const exists = await db.isolationScheme.findUnique({ where: { workRequestId: wid } })
    if (exists) return jsonError('该需求已存在隔离方案，请直接编辑', 409)

    const pointsInput: any[] = Array.isArray(body.points) ? body.points : []
    for (const p of pointsInput) {
      if (!str(p?.location) || !str(p?.blindSpec) || !str(p?.blindType)) {
        return jsonError('每个隔离点必须包含位置、盲板规格和盲板类型')
      }
      if (p?.action !== 'ADD' && p?.action !== 'REMOVE') {
        return jsonError('隔离点操作类型必须为 ADD（加装）或 REMOVE（拆除）')
      }
    }

    const code = await generateCode('GL', (like) =>
      db.isolationScheme
        .findFirst({ where: { code: { startsWith: like } }, orderBy: { code: 'desc' } })
        .then((r) => r?.code ?? null)
    )

    const scheme = await db.isolationScheme.create({
      data: {
        workRequestId: wid,
        code,
        preparedBy,
        status: 'DRAFT',
        points: {
          create: pointsInput.map((p, i) => ({
            seq: p?.seq !== undefined && p?.seq !== null && Number.isFinite(Number(p.seq)) ? Number(p.seq) : i + 1,
            location: str(p.location),
            medium: str(p.medium) || null,
            pressure: str(p.pressure) || null,
            temperature: str(p.temperature) || null,
            blindSpec: str(p.blindSpec),
            blindType: str(p.blindType),
            action: p.action,
            blindPlateId: num(p.blindPlateId),
            // 主数据关联字段透传（宽松：数字/字符串均可，空则 null）
            code: str(p.code) || null,
            name: str(p.name) || null,
            masterPointId: num(p.masterPointId),
            masterCode: str(p.masterCode) || null,
          })),
        },
      },
      include: { points: { orderBy: { seq: 'asc' } } },
    })
    const updatedRequest = await db.workRequest.update({
      where: { id: wid },
      data: { status: 'ISOLATION_PREPARING' },
    })
    // 审计留痕：创建隔离方案，需求进入方案编制
    const actor = resolveActor(extractActor(body), preparedBy)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'CREATE',
      entity: 'ISOLATION_SCHEME',
      entityId: scheme.id,
      entityCode: scheme.code,
      detail: auditFlowDetail(scheme.code, null, 'DRAFT', `创建隔离方案（需求 ${request.code} 进入方案编制，${scheme.points.length} 个隔离点，编制人：${preparedBy}）`),
    })
    return NextResponse.json({ scheme, request: updatedRequest }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/isolation-schemes]', e)
    return jsonError(e instanceof Error ? e.message : '创建隔离方案失败', 500)
  }
}
