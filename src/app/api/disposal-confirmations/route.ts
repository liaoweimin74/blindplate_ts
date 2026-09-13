import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, num, readBody, resolveActor, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/disposal-confirmations 工艺处置确认
 * 需求必须为 PENDING_CONFIRM；result=QUALIFIED → 需求 CONFIRMED，
 * 否则保持 PENDING_CONFIRM 并返回错误提示
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const wid = num(body.workRequestId)
    if (wid === null) return jsonError('无效的 workRequestId')
    const request = await db.workRequest.findUnique({ where: { id: wid } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (request.status !== 'PENDING_CONFIRM') {
      return jsonError(`当前状态为 ${request.status}，仅待工艺处置确认阶段可确认`)
    }
    const confirmer = str(body.confirmer)
    if (!confirmer) return jsonError('确认人不能为空')
    const result = body.result === 'QUALIFIED' ? 'QUALIFIED' : 'UNQUALIFIED'

    // 逐项确认硬闸（一确认一记录）：总体确认合格前，全部处置步骤必须已逐项确认且合格
    const scheme = await db.disposalScheme.findUnique({ where: { workRequestId: wid } })
    if (scheme && result === 'QUALIFIED') {
      const steps = await db.disposalStep.findMany({
        where: { schemeId: scheme.id },
        select: { seq: true, confirmResult: true },
      })
      const unconfirmed = steps.filter((s) => !s.confirmResult).length
      const abnormal = steps.filter((s) => s.confirmResult === 'ABNORMAL').length
      if (unconfirmed > 0 || abnormal > 0) {
        return jsonError(
          `尚有处置步骤未逐项确认合格：未确认 ${unconfirmed} 项、确认异常 ${abnormal} 项（共 ${steps.length} 项）；请先逐项确认全部合格后再总体确认`,
          409
        )
      }
    }

    const data = {
      confirmer,
      confirmedAt: new Date(),
      stepsConfirmed: result === 'QUALIFIED', // 服务端已校验全部步骤逐项确认合格，不信任前端勾选
      flammableResult: str(body.flammableResult) || null,
      oxygenResult: str(body.oxygenResult) || null,
      toxicResult: str(body.toxicResult) || null,
      analysisQualified: Boolean(body.analysisQualified),
      remarks: str(body.remarks) || null,
      result,
    }
    // 支持整改后重新确认（覆盖上次确认记录）
    const confirmation = await db.disposalConfirmation.upsert({
      where: { workRequestId: wid },
      create: { workRequestId: wid, ...data },
      update: data,
    })
    // 绑定移动端上传的处置确认现场照片（上传时 bizType=DISPOSAL_CONFIRM、bizId 空占位）
    const photoIds: string[] = Array.isArray(body.photoIds) ? body.photoIds : []
    if (photoIds.length) {
      const { bindAttachments } = await import('@/lib/bp-attachments')
      await bindAttachments(photoIds, 'DISPOSAL_CONFIRM', confirmation.id, request.code)
    }

    if (result === 'QUALIFIED') {
      const updatedRequest = await db.workRequest.update({
        where: { id: wid },
        data: { status: 'CONFIRMED' },
      })
      // 审计留痕：工艺处置确认合格，需求推进待开票
      const actor = resolveActor(extractActor(body), confirmer)
      await logAudit({
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'STATUS_CHANGE',
        entity: 'WORK_REQUEST',
        entityId: wid,
        entityCode: request.code,
        detail: auditFlowDetail(request.code, request.status, 'CONFIRMED', `工艺处置确认合格（确认人：${confirmer}），可开立作业票`),
      })
      return NextResponse.json({ confirmation, request: updatedRequest }, { status: 201 })
    }
    // 不合格：需求保持 PENDING_CONFIRM，返回错误提示；同样留痕便于追溯
    const actorFail = resolveActor(extractActor(body), confirmer)
    await logAudit({
      actorId: actorFail.actorId,
      actorName: actorFail.actorName,
      action: 'STATUS_CHANGE',
      entity: 'WORK_REQUEST',
      entityId: wid,
      entityCode: request.code,
      detail: auditFlowDetail(request.code, request.status, request.status, `工艺处置确认不合格（确认人：${confirmer}），需整改后重新确认`),
    })
    return NextResponse.json(
      {
        error: '工艺处置结果不合格，请整改后重新确认',
        confirmation,
        request,
      },
      { status: 400 }
    )
  } catch (e) {
    console.error('[POST /api/disposal-confirmations]', e)
    return jsonError(e instanceof Error ? e.message : '工艺处置确认失败', 500)
  }
}
