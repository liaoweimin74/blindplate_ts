import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor, str, toDate } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/work-requests/[id]/jsa 保存 JSA 分析（upsert）
 * steps 传数组则删除旧步骤重建；需求状态 → JSA_DONE
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rid = parseId(id)
    if (!rid) return jsonError('无效的需求 ID')
    const request = await db.workRequest.findUnique({ where: { id: rid } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (request.status === 'COMPLETED' || request.status === 'CANCELLED') {
      return jsonError(`当前状态为 ${request.status}，不可填写 JSA 分析`)
    }
    const body = await readBody(req)
    const leader = str(body.leader)
    if (!leader) return jsonError('分析组长不能为空')
    const analysisDate = toDate(body.analysisDate) ?? new Date()
    const stepsInput: any[] = Array.isArray(body.steps) ? body.steps : []
    const stepsData = stepsInput.map((s, i) => ({
      seq: s?.seq !== undefined && s?.seq !== null && Number.isFinite(Number(s.seq)) ? Number(s.seq) : i + 1,
      step: str(s?.step),
      hazard: str(s?.hazard),
      measure: str(s?.measure),
    }))

    const existing = await db.jsaAnalysis.findUnique({ where: { workRequestId: rid } })
    let jsa
    if (existing) {
      jsa = await db.jsaAnalysis.update({
        where: { id: existing.id },
        data: {
          leader,
          members: str(body.members) || null,
          analysisDate,
          riskLevel: str(body.riskLevel) || 'MEDIUM',
          residualRisk: str(body.residualRisk) || null,
          pointRefs: Array.isArray(body.pointRefs) ? JSON.stringify(body.pointRefs) : (str(body.pointRefs) || null),
        },
      })
      // 删除旧步骤重建
      await db.jsaStep.deleteMany({ where: { jsaId: existing.id } })
      if (stepsData.length) {
        await db.jsaStep.createMany({
          data: stepsData.map((s) => ({ ...s, jsaId: existing.id })),
        })
      }
    } else {
      jsa = await db.jsaAnalysis.create({
        data: {
          workRequestId: rid,
          leader,
          members: str(body.members) || null,
          analysisDate,
          riskLevel: str(body.riskLevel) || 'MEDIUM',
          residualRisk: str(body.residualRisk) || null,
          pointRefs: Array.isArray(body.pointRefs) ? JSON.stringify(body.pointRefs) : (str(body.pointRefs) || null),
          steps: { create: stepsData },
        },
      })
    }
    const steps = await db.jsaStep.findMany({ where: { jsaId: jsa.id }, orderBy: { seq: 'asc' } })
    const updatedRequest = await db.workRequest.update({
      where: { id: rid },
      data: { status: 'JSA_DONE' },
    })
    // 审计留痕：JSA 分析完成，需求推进（entityCode 存需求编号便于搜索）
    const actor = resolveActor(extractActor(body), leader)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'COMPLETE',
      entity: 'JSA',
      entityId: jsa.id,
      entityCode: request.code,
      detail: auditFlowDetail(request.code, request.status, 'JSA_DONE', `JSA 分析完成（组长：${leader}，${steps.length} 个分析步骤）`),
    })
    return NextResponse.json({ jsa: { ...jsa, steps }, request: updatedRequest })
  } catch (e) {
    console.error('[POST /api/work-requests/[id]/jsa]', e)
    return jsonError(e instanceof Error ? e.message : '保存 JSA 分析失败', 500)
  }
}
