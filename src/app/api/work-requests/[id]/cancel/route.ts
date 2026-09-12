import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** POST /api/work-requests/[id]/cancel 取消需求（终态不可取消） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rid = parseId(id)
    if (!rid) return jsonError('无效的需求 ID')
    const request = await db.workRequest.findUnique({ where: { id: rid } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (request.status === 'COMPLETED' || request.status === 'CANCELLED') {
      return jsonError(`当前状态为 ${request.status}，不可取消`)
    }
    // 提取操作人（body 可为空：前端取消不携带 body，回落申请人快照）
    const extracted = extractActor(await readBody(req))
    const updated = await db.workRequest.update({
      where: { id: rid },
      data: { status: 'CANCELLED' },
    })
    // 审计留痕：需求取消
    const actor = resolveActor(extracted, request.applicantName)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'CANCEL',
      entity: 'WORK_REQUEST',
      entityId: rid,
      entityCode: request.code,
      detail: auditFlowDetail(request.code, request.status, 'CANCELLED', `取消作业需求「${request.title}」，流程终止`),
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[POST /api/work-requests/[id]/cancel]', e)
    return jsonError(e instanceof Error ? e.message : '取消需求失败', 500)
  }
}
