import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/** POST /api/work-requests/[id]/submit 提交需求（仅 DRAFT → PENDING_SURVEY） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rid = parseId(id)
    if (!rid) return jsonError('无效的需求 ID')
    const request = await db.workRequest.findUnique({ where: { id: rid } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (request.status !== 'DRAFT') {
      return jsonError(`当前状态为 ${request.status}，仅草稿状态可提交`)
    }
    // 提取操作人（body 可为空：前端提交不携带 body，回落申请人快照）
    const extracted = extractActor(await readBody(req))
    const updated = await db.workRequest.update({
      where: { id: rid },
      data: { status: 'PENDING_SURVEY' },
    })
    await pushNotifications({
      targetRoles: ['ENGINEER'],
      type: 'APPROVAL',
      title: '新作业需求待现场勘察',
      content: `${updated.code}（${updated.title}）已提交，申请人：${updated.applicantName}，请安排现场勘察`,
      bizType: 'REQUEST',
      bizId: rid,
      bizCode: updated.code,
      linkModule: 'work-requests',
      linkTab: 'survey',
    })
    // 审计留痕：需求提交（前端未透传 __actor 时回落到申请人快照）
    const actor = resolveActor(extracted, request.applicantName)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'SUBMIT',
      entity: 'WORK_REQUEST',
      entityId: rid,
      entityCode: request.code,
      detail: auditFlowDetail(request.code, 'DRAFT', 'PENDING_SURVEY', `提交作业需求「${request.title}」，进入现场勘察环节`),
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[POST /api/work-requests/[id]/submit]', e)
    return jsonError(e instanceof Error ? e.message : '提交需求失败', 500)
  }
}
