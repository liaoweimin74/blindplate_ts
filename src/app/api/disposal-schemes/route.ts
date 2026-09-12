import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, generateCode, jsonError, logAudit, num, parseId, readBody, resolveActor, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

const METHODS = ['VENT', 'DRAIN', 'REPLACE', 'PURGE', 'STEAM', 'GAS_TEST', 'ISOLATE', 'OTHER']

/** GET /api/disposal-schemes?workRequestId= → 方案（含 steps）；不带参数返回全部 */
export async function GET(req: NextRequest) {
  try {
    const widRaw = req.nextUrl.searchParams.get('workRequestId')
    if (widRaw !== null) {
      const wid = parseId(widRaw)
      if (!wid) return jsonError('无效的 workRequestId')
      const scheme = await db.disposalScheme.findUnique({ where: { workRequestId: wid } })
      if (!scheme) return NextResponse.json(null)
      const steps = await db.disposalStep.findMany({
        where: { schemeId: scheme.id },
        orderBy: { seq: 'asc' },
      })
      return NextResponse.json({ ...scheme, steps })
    }
    const schemes = await db.disposalScheme.findMany({ orderBy: { preparedAt: 'desc' } })
    const steps = await db.disposalStep.findMany({ orderBy: { seq: 'asc' } })
    const byScheme = new Map<number, typeof steps>()
    for (const s of steps) {
      const list = byScheme.get(s.schemeId) ?? []
      list.push(s)
      byScheme.set(s.schemeId, list)
    }
    return NextResponse.json(schemes.map((s) => ({ ...s, steps: byScheme.get(s.id) ?? [] })))
  } catch (e) {
    console.error('[GET /api/disposal-schemes]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取处置方案失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/disposal-schemes { workRequestId, preparedBy, steps[] }
 * 生成编号 GY-YYYYMM-XXX，创建方案+步骤，需求状态 → DISPOSAL_PREPARING
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
      return jsonError('该需求已完结，不可编制处置方案')
    }
    const exists = await db.disposalScheme.findUnique({ where: { workRequestId: wid } })
    if (exists) return jsonError('该需求已存在工艺处置方案，请直接编辑', 409)

    const stepsInput: any[] = Array.isArray(body.steps) ? body.steps : []
    for (const s of stepsInput) {
      if (!str(s?.detail)) return jsonError('每个处置步骤必须包含处置内容')
      if (s?.method && !METHODS.includes(str(s.method))) {
        return jsonError('处置方式必须为 VENT/DRAIN/REPLACE/PURGE/STEAM/GAS_TEST/ISOLATE/OTHER')
      }
    }

    const code = await generateCode('GY', (like) =>
      db.disposalScheme
        .findFirst({ where: { code: { startsWith: like } }, orderBy: { code: 'desc' } })
        .then((r) => r?.code ?? null)
    )

    const scheme = await db.disposalScheme.create({
      data: {
        workRequestId: wid,
        code,
        preparedBy,
        status: 'DRAFT',
        steps: {
          create: stepsInput.map((s, i) => ({
            seq: s?.seq !== undefined && s?.seq !== null && Number.isFinite(Number(s.seq)) ? Number(s.seq) : i + 1,
            method: str(s.method) || 'OTHER',
            detail: str(s.detail),
            standard: str(s.standard) || null,
            masterPointId: num(s.masterPointId),
            masterCode: str(s.masterCode) || null,
          })),
        },
      },
      include: { steps: { orderBy: { seq: 'asc' } } },
    })
    const updatedRequest = await db.workRequest.update({
      where: { id: wid },
      data: { status: 'DISPOSAL_PREPARING' },
    })
    // 审计留痕：创建工艺处置方案，需求进入方案编制
    const actor = resolveActor(extractActor(body), preparedBy)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'CREATE',
      entity: 'DISPOSAL_SCHEME',
      entityId: scheme.id,
      entityCode: scheme.code,
      detail: auditFlowDetail(scheme.code, null, 'DRAFT', `创建工艺处置方案（需求 ${request.code} 进入方案编制，${scheme.steps.length} 个处置步骤，编制人：${preparedBy}）`),
    })
    return NextResponse.json({ scheme, request: updatedRequest }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/disposal-schemes]', e)
    return jsonError(e instanceof Error ? e.message : '创建处置方案失败', 500)
  }
}
