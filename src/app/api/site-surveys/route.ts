import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** GET /api/site-surveys → 全部现场勘察记录（按勘察时间倒序，关联需求与装置信息） */
export async function GET(req: NextRequest) {
  try {
    const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 200)
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 500) : 200

    const surveys = await db.siteSurvey.findMany({
      orderBy: { surveyDate: 'desc' },
      take: limit,
    })

    // SiteSurvey 与 WorkRequest/Unit 均无 Prisma relation，按 id 批量手动关联
    const ids = [...new Set(surveys.map((s) => s.workRequestId))]
    const requests = ids.length
      ? await db.workRequest.findMany({ where: { id: { in: ids } } })
      : []
    const reqMap = new Map(requests.map((r) => [r.id, r]))
    const unitIds = [...new Set(requests.map((r) => r.unitId).filter((v): v is number => v != null))]
    const units = unitIds.length ? await db.unit.findMany({ where: { id: { in: unitIds } } }) : []
    const unitMap = new Map(units.map((u) => [u.id, u]))

    // 过滤孤儿记录（需求已删除的勘察残留，裸外键无级联）
    const rows = surveys.filter((s) => reqMap.has(s.workRequestId)).map((s) => {
      const r = reqMap.get(s.workRequestId)
      return {
        id: s.id,
        workRequestId: s.workRequestId,
        workCode: r?.code ?? '',
        title: r?.title ?? '',
        unitName: r ? unitMap.get(r.unitId)?.name ?? '' : '',
        location: r?.location ?? '',
        workStatus: r?.status ?? '',
        applicantName: r?.applicantName ?? '',
        surveyor: s.surveyor,
        surveyDate: s.surveyDate,
        siteCondition: s.siteCondition,
        pipelineVerify: s.pipelineVerify,
        hazardPoints: s.hazardPoints,
        isSafe: s.isSafe,
        suggestion: s.suggestion,
      }
    })

    return NextResponse.json(rows)
  } catch (e) {
    console.error('[GET /api/site-surveys]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取勘察记录失败' },
      { status: 500 }
    )
  }
}
