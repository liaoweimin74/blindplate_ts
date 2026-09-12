import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor, str, toDate } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** POST /api/work-requests/[id]/survey 保存现场勘察（upsert），需求状态 → SURVEYED */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rid = parseId(id)
    if (!rid) return jsonError('无效的需求 ID')
    const request = await db.workRequest.findUnique({ where: { id: rid } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (request.status === 'COMPLETED' || request.status === 'CANCELLED') {
      return jsonError(`当前状态为 ${request.status}，不可填写勘察记录`)
    }
    const body = await readBody(req)
    const surveyor = str(body.surveyor)
    const siteCondition = str(body.siteCondition)
    if (!surveyor || !siteCondition) return jsonError('勘察人和现场条件不能为空')
    const surveyDate = toDate(body.surveyDate) ?? new Date()

    const data = {
      surveyor,
      surveyDate,
      siteCondition,
      pipelineVerify: str(body.pipelineVerify) || null,
      hazardPoints: str(body.hazardPoints) || null,
      pointRefs: Array.isArray(body.pointRefs) ? JSON.stringify(body.pointRefs) : (str(body.pointRefs) || null),
      isSafe: body.isSafe === undefined ? true : Boolean(body.isSafe),
      suggestion: str(body.suggestion) || null,
    }
    const survey = await db.siteSurvey.upsert({
      where: { workRequestId: rid },
      create: { workRequestId: rid, ...data },
      update: data,
    })
    const updatedRequest = await db.workRequest.update({
      where: { id: rid },
      data: { status: 'SURVEYED' },
    })
    // 审计留痕：现场勘察完成，需求推进
    const actor = resolveActor(extractActor(body), surveyor)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'STATUS_CHANGE',
      entity: 'WORK_REQUEST',
      entityId: rid,
      entityCode: request.code,
      detail: auditFlowDetail(request.code, request.status, 'SURVEYED', `现场勘察完成（勘察人：${surveyor}，现场条件：${siteCondition}）`),
    })
    return NextResponse.json({ survey, request: updatedRequest })
  } catch (e) {
    console.error('[POST /api/work-requests/[id]/survey]', e)
    return jsonError(e instanceof Error ? e.message : '保存勘察记录失败', 500)
  }
}
