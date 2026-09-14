import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, jsonError, logAudit, num, readBody, resolveActor, str } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/**
 * GET /api/acceptances?workRequestId= → 验收记录（无则 null）
 * POST /api/acceptances 创建验收：需求必须 PENDING_ACCEPTANCE；
 * 三项检查全部通过 → PASS（需求 COMPLETED），否则 RECTIFY（需求保持）
 */
export async function GET(req: NextRequest) {
  try {
    const widRaw = req.nextUrl.searchParams.get('workRequestId')
    if (widRaw === null) {
      const list = await db.acceptance.findMany({ orderBy: { acceptedAt: 'desc' } })
      return NextResponse.json(list)
    }
    const wid = num(widRaw)
    if (wid === null) return jsonError('无效的 workRequestId')
    const acceptance = await db.acceptance.findUnique({ where: { workRequestId: wid } })
    return NextResponse.json(acceptance)
  } catch (e) {
    console.error('[GET /api/acceptances]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取验收记录失败' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const wid = num(body.workRequestId)
    if (wid === null) return jsonError('无效的 workRequestId')
    const request = await db.workRequest.findUnique({ where: { id: wid } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (request.status !== 'PENDING_ACCEPTANCE') {
      return jsonError(`当前状态为 ${request.status}，仅待验收阶段可验收`)
    }
    const acceptor = str(body.acceptor)
    if (!acceptor) return jsonError('验收人不能为空')

    const leakCheck = Boolean(body.leakCheck)
    const restoreCheck = Boolean(body.restoreCheck)
    const ledgerCheck = Boolean(body.ledgerCheck)
    const conclusion = leakCheck && restoreCheck && ledgerCheck ? 'PASS' : 'RECTIFY'

    const data = {
      acceptor,
      acceptedAt: new Date(),
      leakCheck,
      restoreCheck,
      ledgerCheck,
      conclusion,
      problems: str(body.problems) || null,
      remarks: str(body.remarks) || null,
    }
    // 整改后可重新验收（覆盖上次记录）
    const prev = await db.acceptance.findUnique({ where: { workRequestId: wid } })
    const acceptance = await db.acceptance.upsert({
      where: { workRequestId: wid },
      create: { workRequestId: wid, ...data },
      update: data,
    })
    // 绑定移动端上传的验收照片（上传时 bizType=ACCEPTANCE、bizId 空占位）
    const photoIds: string[] = Array.isArray(body.photoIds) ? body.photoIds : []
    if (photoIds.length) {
      const { bindAttachments } = await import('@/lib/bp-attachments')
      await bindAttachments(photoIds, 'ACCEPTANCE', acceptance.id, request.code)
    }
    let updatedRequest = request
    if (conclusion === 'PASS') {
      updatedRequest = await db.workRequest.update({
        where: { id: wid },
        data: { status: 'COMPLETED' },
      })
      // 一票一板：验收通过 → 批量关闭全部已完工票（流程闭环）
      await db.workTicket.updateMany({
        where: { workRequestId: wid, status: 'FINISHED' },
        data: { status: 'CLOSED', closedAt: new Date() },
      })
    }
    // 审计留痕：验收创建/复验，结论与需求状态影响写入详情
    const failedChecks = [
      !leakCheck && '泄漏检测',
      !restoreCheck && '现场恢复',
      !ledgerCheck && '台账核对',
    ].filter(Boolean).join('、')
    const actor = resolveActor(extractActor(body), acceptor)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: prev ? 'UPDATE' : 'CREATE',
      entity: 'ACCEPTANCE',
      entityId: acceptance.id,
      entityCode: request.code,
      detail: auditFlowDetail(
        request.code,
        request.status,
        updatedRequest.status,
        conclusion === 'PASS'
          ? `${prev ? '整改复验通过' : '验收通过'}：泄漏检测/现场恢复/台账核对三项合格（验收人：${acceptor}），全流程闭环`
          : `验收未通过：${failedChecks || '存在待整改项'}不合格，需整改后重新验收（验收人：${acceptor}）`
      ),
    })
    await pushNotifications({
      targetRoles: ['MANAGER', 'ADMIN'],
      type: conclusion === 'PASS' ? 'STATUS' : 'ALERT',
      title: conclusion === 'PASS' ? '作业验收通过，流程闭环' : '验收未通过，需整改复验',
      content: conclusion === 'PASS'
        ? `${request.code}（${request.title}）已由 ${acceptor} 验收通过，盲板抽堵作业全流程完成`
        : `${request.code} 验收未通过（验收人：${acceptor}）${str(body.problems) ? `：${str(body.problems)}` : ''}，整改后请重新申请验收`,
      bizType: 'ACCEPTANCE',
      bizId: wid,
      bizCode: request.code,
      linkModule: 'work-requests',
    })
    return NextResponse.json({ acceptance, request: updatedRequest }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/acceptances]', e)
    return jsonError(e instanceof Error ? e.message : '保存验收记录失败', 500)
  }
}
