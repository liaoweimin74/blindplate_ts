import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, parseId, readBody, resolveActor, str } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/** POST /api/isolation-schemes/[id]/submit 提交审核（DRAFT/REJECTED → PENDING_REVIEW），写审批留痕，需求 → ISOLATION_PENDING_REVIEW */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sid = parseId(id)
    if (!sid) return jsonError('无效的方案 ID')
    const scheme = await db.isolationScheme.findUnique({ where: { id: sid } })
    if (!scheme) return jsonError('隔离方案不存在', 404)
    if (scheme.status !== 'DRAFT' && scheme.status !== 'REJECTED') {
      return jsonError(`当前状态为 ${scheme.status}，不可提交审核`)
    }
    const body = await readBody(req)
    const operator = str(body.operator) || scheme.preparedBy

    const updated = await db.isolationScheme.update({
      where: { id: sid },
      data: { status: 'PENDING_REVIEW' },
    })
    await db.approvalRecord.create({
      data: {
        bizType: 'ISOLATION',
        bizId: sid,
        bizCode: scheme.code,
        action: 'SUBMIT',
        operator,
        comment: '提交隔离方案审核',
      },
    })
    const request = await db.workRequest.update({
      where: { id: scheme.workRequestId },
      data: { status: 'ISOLATION_PENDING_REVIEW' },
    })
    await pushNotifications({
      targetRoles: ['REVIEWER', 'MANAGER'],
      type: 'APPROVAL',
      title: '隔离方案待审核',
      content: `${request.code}（${request.title}）的隔离方案 ${scheme.code} 已提交审核，请及时处理`,
      bizType: 'ISOLATION',
      bizId: sid,
      bizCode: scheme.code,
      linkModule: 'approval-center',
    })
    // 审计留痕：隔离方案提交审核，需求同步推进
    const actor = resolveActor(extractActor(body), operator)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'SUBMIT',
      entity: 'ISOLATION_SCHEME',
      entityId: sid,
      entityCode: scheme.code,
      detail: auditFlowDetail(scheme.code, scheme.status, 'PENDING_REVIEW', `提交隔离方案审核，需求 ${request.code} 同步进入待审核`),
    })
    return NextResponse.json({ scheme: updated, request })
  } catch (e) {
    console.error('[POST /api/isolation-schemes/[id]/submit]', e)
    return jsonError(e instanceof Error ? e.message : '提交隔离方案失败', 500)
  }
}
