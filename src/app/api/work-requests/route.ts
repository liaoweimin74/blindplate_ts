import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { generateCode, jsonError, num, readBody, str, toDate, withUnit } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

const URGENCIES = ['LOW', 'MEDIUM', 'HIGH']

/** GET /api/work-requests?status=&keyword=&unitId= → 列表（含 unit，时间倒序） */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const status = sp.get('status') ?? undefined
    const keyword = sp.get('keyword') ?? undefined
    const unitId = num(sp.get('unitId'))
    const where: Prisma.WorkRequestWhereInput = {}
    if (status) where.status = status
    if (keyword) {
      where.OR = [
        { code: { contains: keyword } },
        { title: { contains: keyword } },
        { location: { contains: keyword } },
      ]
    }
    if (unitId !== null) where.unitId = unitId
    const rows = await db.workRequest.findMany({ where, orderBy: { createdAt: 'desc' } })
    const list = await withUnit(rows)
    // 批量挂隔离/处置方案摘要（编号+状态）：方案编制下拉需展示关联方案编号并拦截重复创建
    const ids = rows.map((r) => r.id)
    type SchemeBrief = { workRequestId: number; code: string; status: string }
    const empty = Promise.resolve([] as SchemeBrief[])
    const [isoSchemes, dispSchemes] = await Promise.all([
      ids.length
        ? db.isolationScheme.findMany({ where: { workRequestId: { in: ids } }, select: { workRequestId: true, code: true, status: true } })
        : empty,
      ids.length
        ? db.disposalScheme.findMany({ where: { workRequestId: { in: ids } }, select: { workRequestId: true, code: true, status: true } })
        : empty,
    ])
    const isoMap = new Map(isoSchemes.map((s) => [s.workRequestId, s]))
    const dispMap = new Map(dispSchemes.map((s) => [s.workRequestId, s]))
    const enriched = list.map((r) => ({
      ...r,
      isolationScheme: isoMap.get(r.id) ?? null,
      disposalScheme: dispMap.get(r.id) ?? null,
    }))
    return NextResponse.json(enriched)
  } catch (e) {
    console.error('[GET /api/work-requests]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取作业需求列表失败' },
      { status: 500 }
    )
  }
}

/** POST /api/work-requests 新建需求（服务端生成编号 WR-YYYYMM-XXX，状态 DRAFT） */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const title = str(body.title)
    const location = str(body.location)
    const reason = str(body.reason)
    const applicantId = str(body.applicantId)
    const applicantName = str(body.applicantName)
    const unitId = num(body.unitId)
    if (!title || !location || !reason || !applicantId || !applicantName) {
      return jsonError('标题、位置、作业原因和申请人不能为空')
    }
    if (unitId === null) return jsonError('所属装置不能为空')
    const unit = await db.unit.findUnique({ where: { id: unitId } })
    if (!unit) return jsonError('所属装置不存在', 404)
    const urgency = str(body.urgency) || 'MEDIUM'
    if (!URGENCIES.includes(urgency)) return jsonError('紧急程度必须为 LOW/MEDIUM/HIGH')

    const code = await generateCode('WR', (like) =>
      db.workRequest
        .findFirst({ where: { code: { startsWith: like } }, orderBy: { code: 'desc' } })
        .then((r) => r?.code ?? null)
    )

    const request = await db.workRequest.create({
      data: {
        code,
        title,
        unitId,
        location,
        pipelineId: num(body.pipelineId),
        pipelineName: str(body.pipelineName) || null,
        medium: str(body.medium) || null,
        pressure: str(body.pressure) || null,
        temperature: str(body.temperature) || null,
        reason,
        urgency,
        plannedStart: toDate(body.plannedStart),
        plannedEnd: toDate(body.plannedEnd),
        applicantId,
        applicantName,
        status: 'DRAFT',
      },
    })
    return NextResponse.json({ ...request, unit }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/work-requests]', e)
    return jsonError(e instanceof Error ? e.message : '创建作业需求失败', 500)
  }
}
