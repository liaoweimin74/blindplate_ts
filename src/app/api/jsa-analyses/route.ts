import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** GET /api/jsa-analyses → 全部 JSA 分析记录（按分析时间倒序，含步骤，关联需求与装置信息） */
export async function GET(req: NextRequest) {
  try {
    const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 200)
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 500) : 200

    const analyses = await db.jsaAnalysis.findMany({
      include: { steps: { orderBy: { seq: 'asc' } } },
      orderBy: { analysisDate: 'desc' },
      take: limit,
    })

    // JsaAnalysis 与 WorkRequest/Unit 均无 Prisma relation，按 id 批量手动关联
    const ids = [...new Set(analyses.map((a) => a.workRequestId))]
    const requests = ids.length
      ? await db.workRequest.findMany({ where: { id: { in: ids } } })
      : []
    const reqMap = new Map(requests.map((r) => [r.id, r]))
    const unitIds = [...new Set(requests.map((r) => r.unitId).filter((v): v is number => v != null))]
    const units = unitIds.length ? await db.unit.findMany({ where: { id: { in: unitIds } } }) : []
    const unitMap = new Map(units.map((u) => [u.id, u]))

    // 过滤孤儿记录（需求已删除的 JSA 残留，裸外键无级联）
    const rows = analyses.filter((a) => reqMap.has(a.workRequestId)).map((a) => {
      const r = reqMap.get(a.workRequestId)
      return {
        id: a.id,
        workRequestId: a.workRequestId,
        workCode: r?.code ?? '',
        title: r?.title ?? '',
        unitName: r ? unitMap.get(r.unitId)?.name ?? '' : '',
        location: r?.location ?? '',
        workStatus: r?.status ?? '',
        applicantName: r?.applicantName ?? '',
        leader: a.leader,
        members: a.members,
        analysisDate: a.analysisDate,
        riskLevel: a.riskLevel,
        residualRisk: a.residualRisk,
        steps: a.steps.map((s) => ({ seq: s.seq, step: s.step, hazard: s.hazard, measure: s.measure })),
      }
    })

    return NextResponse.json(rows)
  } catch (e) {
    console.error('[GET /api/jsa-analyses]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取JSA分析记录失败' },
      { status: 500 }
    )
  }
}
