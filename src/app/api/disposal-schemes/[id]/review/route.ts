import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, bizStatusLabel, extractActor, jsonError, logAudit, parseId, readBody, resolveActor, str } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/**
 * POST /api/disposal-schemes/[id]/review { approve, comment, reviewer }
 * APPROVED → 需求 PENDING_CONFIRM；REJECTED → 需求 DISPOSAL_REJECTED
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sid = parseId(id)
    if (!sid) return jsonError('无效的方案 ID')
    const scheme = await db.disposalScheme.findUnique({ where: { id: sid } })
    if (!scheme) return jsonError('工艺处置方案不存在', 404)
    if (scheme.status !== 'PENDING_REVIEW') {
      return jsonError(`当前状态为 ${scheme.status}，仅待审核状态可审核`)
    }
    const body = await readBody(req)
    const approve = Boolean(body.approve)
    const comment = str(body.comment) || null
    const reviewer = str(body.reviewer)
    if (!reviewer) return jsonError('审核人不能为空')

    const updated = await db.disposalScheme.update({
      where: { id: sid },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        comment,
        reviewedBy: reviewer,
        reviewedAt: new Date(),
      },
    })
    await db.approvalRecord.create({
      data: {
        bizType: 'DISPOSAL',
        bizId: sid,
        bizCode: scheme.code,
        action: approve ? 'APPROVE' : 'REJECT',
        operator: reviewer,
        comment,
      },
    })
    const request = await db.workRequest.update({
      where: { id: scheme.workRequestId },
      data: { status: approve ? 'PENDING_CONFIRM' : 'DISPOSAL_REJECTED' },
    })
    await pushNotifications({
      targetRoles: approve ? ['ENGINEER'] : ['ENGINEER'],
      type: approve ? 'STATUS' : 'ALERT',
      title: approve ? '处置方案审核通过' : '处置方案被驳回',
      content: approve
        ? `${request.code} 的工艺处置方案 ${scheme.code} 已通过审核（审核人：${reviewer}），请进行现场工艺处置确认`
        : `${request.code} 的工艺处置方案 ${scheme.code} 被驳回（审核人：${reviewer}）${comment ? `：${comment}` : ''}，请修改后重新提交`,
      bizType: 'DISPOSAL',
      bizId: sid,
      bizCode: scheme.code,
      linkModule: approve ? 'work-requests' : 'schemes',
      linkTab: approve ? undefined : 'disposal',
    })
    // 审计留痕：处置方案审核通过/驳回，需求同步推进
    const actor = resolveActor(extractActor(body), reviewer)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: approve ? 'APPROVE' : 'REJECT',
      entity: 'DISPOSAL_SCHEME',
      entityId: sid,
      entityCode: scheme.code,
      detail: auditFlowDetail(
        scheme.code,
        scheme.status,
        updated.status,
        `${approve ? '工艺处置方案审核通过' : '工艺处置方案被驳回'}，需求 ${request.code} 同步推进至「${bizStatusLabel(request.status)}」${comment ? `，审核意见：${comment}` : ''}`
      ),
    })
    return NextResponse.json({ scheme: updated, request })
  } catch (e) {
    console.error('[POST /api/disposal-schemes/[id]/review]', e)
    return jsonError(e instanceof Error ? e.message : '审核处置方案失败', 500)
  }
}
