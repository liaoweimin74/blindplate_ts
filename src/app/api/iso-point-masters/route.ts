import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError, num, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/iso-point-masters?keyword=&pipelineId= → 隔离点主数据列表（含 pipelineName 与被业务引用次数 refCount） */
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
          select: { masterPointId: true },
        })
      : []
    const refMap = new Map<number, number>()
    for (const r of refs) {
      if (r.masterPointId == null) continue
      refMap.set(r.masterPointId, (refMap.get(r.masterPointId) ?? 0) + 1)
    }
    return NextResponse.json({
      list: masters.map((m) => ({
        ...m,
        pipelineName: m.pipeline?.name ?? null,
        refCount: refMap.get(m.id) ?? 0,
      })),
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
