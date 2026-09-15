import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditFlowDetail, extractActor, generateCode, jsonError, logAudit, num, readBody, resolveActor, str, toDate } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'
import { findPointPipelineConflicts, formatPipelineConflictMessage, type PipelineTicketConflict } from '@/lib/bp-pipeline-occupancy'

export const dynamic = 'force-dynamic'

/** GET /api/work-tickets?workRequestId= → 作业票列表（附关联需求；一需求多票） */
export async function GET(req: NextRequest) {
  try {
    const widRaw = req.nextUrl.searchParams.get('workRequestId')
    const wid = widRaw !== null ? num(widRaw) : null
    if (widRaw !== null && wid === null) return jsonError('无效的 workRequestId')
    const tickets = await db.workTicket.findMany({
      where: wid !== null ? { workRequestId: wid } : undefined,
      orderBy: { createdAt: 'asc' },
    })
    // WorkTicket 与 WorkRequest 无 Prisma 关系，手工关联
    const reqIds = [...new Set(tickets.map((t) => t.workRequestId))]
    const requests = reqIds.length
      ? await db.workRequest.findMany({ where: { id: { in: reqIds } } })
      : []
    const reqMap = new Map(requests.map((r) => [r.id, r]))
    return NextResponse.json(
      tickets.map((t) => ({ ...t, workRequest: reqMap.get(t.workRequestId) ?? null }))
    )
  } catch (e) {
    console.error('[GET /api/work-tickets]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取作业票列表失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/work-tickets — 严格一票一板批量开票（GB 30871-2022）
 * body: { workRequestId, pointIds: number[], plannedStart, plannedEnd, guardian, workers, issuer, safetyMeasures }
 * 每个选中隔离点分别开具一张作业票（一张票只对应一块盲板的一个作业），直接签发进入待批准；
 * 生成票号 BP-YYYYMM-XXX ×N + 一张作业任务单 TSK-（按需求），需求 → TICKET_ISSUED。
 * 管线互斥按点位管线粒度校验（任一点位管线被其他需求生效票占用 → 409 全部拒绝）。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const wid = num(body.workRequestId)
    if (wid === null) return jsonError('无效的 workRequestId')
    const request = await db.workRequest.findUnique({ where: { id: wid } })
    if (!request) return jsonError('作业需求不存在', 404)
    if (!['CONFIRMED', 'TICKET_ISSUED', 'TICKET_APPROVED', 'IN_PROGRESS'].includes(request.status)) {
      return jsonError(`当前状态为 ${request.status}，工艺处置确认通过后才能开票`)
    }

    // 解析点位 ID 列表（兼容数组 / 逗号分隔字符串）
    const rawPoints = Array.isArray(body.pointIds) ? body.pointIds : str(body.pointIds).split(/[,，]/)
    const pointIds = rawPoints.map((x: unknown) => num(x)).filter((x: number | null): x is number => x !== null)
    if (!pointIds.length) return jsonError('请至少选择一个隔离点位开票（一票一板：每个隔离点分别开具一张作业票）')

    // 点位归属校验 + 重复办票校验
    const scheme = await db.isolationScheme.findUnique({
      where: { workRequestId: wid },
      include: { points: { orderBy: { seq: 'asc' } } },
    })
    if (!scheme || !scheme.points.length) return jsonError('该需求尚无隔离方案点位，请先编制并审核隔离方案', 409)
    const schemePoints = scheme.points.filter((p) => pointIds.includes(p.id))
    if (schemePoints.length !== pointIds.length) return jsonError('存在不属于本需求隔离方案的点位', 409)
    const existingTickets = await db.workTicket.findMany({
      where: { workRequestId: wid, pointId: { in: pointIds }, status: { notIn: ['VOID', 'CLOSED'] } },
      select: { pointId: true, code: true, status: true },
    })
    if (existingTickets.length) {
      const p = schemePoints.find((pt) => pt.id === existingTickets[0].pointId)
      return jsonError(
        `隔离点 ${p?.masterCode || p?.code || p?.location} 已存在生效作业票 ${existingTickets[0].code}（${existingTickets[0].status}），一票一板不允许重复办票`,
        409
      )
    }

    const plannedStart = toDate(body.plannedStart)
    const plannedEnd = toDate(body.plannedEnd)
    if (!plannedStart || !plannedEnd) return jsonError('计划作业开始/结束时间不能为空')
    const guardian = str(body.guardian)
    const workers = str(body.workers)
    const issuer = str(body.issuer)
    const safetyMeasures = str(body.safetyMeasures)
    if (!guardian || !workers || !issuer || !safetyMeasures) {
      return jsonError('监护人、作业人员、签发人和安全措施不能为空')
    }

    // 逐人验资（需求 15）：workerCerts JSON [{name,idCard,idPhotoId,idPhotoUrl,qualPhotoIds,qualPhotoUrls}]
    // 校验：姓名唯一、身份证号 15/18 位、身份证照片必传——不合格整单拒绝（零副作用）
    let workerCerts: string | null = null
    if (body.workerCerts !== undefined && body.workerCerts !== null && body.workerCerts !== '') {
      const rawCerts = Array.isArray(body.workerCerts) ? body.workerCerts : (() => { try { return JSON.parse(String(body.workerCerts)) } catch { return null } })()
      if (!Array.isArray(rawCerts)) return jsonError('作业人员验资数据格式错误')
      const seen = new Set<string>()
      const certs = rawCerts.map((c: Record<string, unknown>) => {
        const name = str(c.name)
        const idCard = str(c.idCard)
        const idPhotoUrl = str(c.idPhotoUrl) || null
        const idPhotoId = num(c.idPhotoId)
        const qualPhotoIds = Array.isArray(c.qualPhotoIds) ? c.qualPhotoIds.map((x: unknown) => num(x)).filter((x: number | null): x is number => x !== null) : []
        const qualPhotoUrls = Array.isArray(c.qualPhotoUrls) ? c.qualPhotoUrls.map((x: unknown) => str(x)).filter(Boolean) : []
        return { name, idCard, idPhotoId, idPhotoUrl, qualPhotoIds, qualPhotoUrls }
      })
      if (!certs.length) return jsonError('作业人员验资清单不能为空')
      for (const c of certs) {
        if (!c.name) return jsonError('作业人员验资：存在未填写姓名的人员')
        if (seen.has(c.name)) return jsonError(`作业人员验资：${c.name} 重复出现`)
        seen.add(c.name)
        if (!/^\d{15}$|^\d{17}[\dXx]$/.test(c.idCard)) return jsonError(`作业人员验资：${c.name} 的身份证号无效（需 15/18 位）`)
        if (!c.idPhotoUrl) return jsonError(`作业人员验资：${c.name} 未上传身份证照片（人证核验与现场交底比对必需）`)
      }
      workerCerts = JSON.stringify(certs)
      // 一致性：workers 逗号名单与验资名单对齐（以验资清单为准回写，避免两处不一致）
      const namesFromCerts = certs.map((c) => c.name).join(',')
      if (workers.replace(/，/g, ',').split(',').map((s: string) => s.trim()).filter(Boolean).join(',') !== namesFromCerts) {
        return jsonError('作业人员名单与验资清单不一致，请逐人核对姓名')
      }
    }

    // 安全硬约束：逐点位校验管线占用（任一冲突 → 全部拒绝，零副作用）
    const allConflicts: PipelineTicketConflict[] = []
    for (const pt of schemePoints) {
      const conflicts = await findPointPipelineConflicts(pt.id, wid, request.pipelineId)
      allConflicts.push(...conflicts)
    }
    if (allConflicts.length) {
      return NextResponse.json(
        { error: formatPipelineConflictMessage(allConflicts), conflicts: allConflicts },
        { status: 409 }
      )
    }

    // 批量生成票号 + 每点一票（直接签发 → PENDING_REVIEW）
    const created: Array<Awaited<ReturnType<typeof db.workTicket.create>>> = []
    for (const pt of schemePoints) {
      const ticketCode = await generateCode('BP', (like) =>
        db.workTicket
          .findFirst({ where: { code: { startsWith: like } }, orderBy: { code: 'desc' } })
          .then((r) => r?.code ?? null)
      )
      const ticket = await db.workTicket.create({
        data: {
          code: ticketCode,
          workRequestId: wid,
          pointId: pt.id,
          pointCode: pt.masterCode || pt.code || null,
          pointLocation: pt.location,
          blindSpec: pt.blindSpec,
          blindType: pt.blindType,
          action: pt.action,
          plannedStart,
          plannedEnd,
          guardian,
          workers,
          issuer,
          safetyMeasures,
          workerCerts,
          status: 'PENDING_REVIEW',
        },
      })
      await db.approvalRecord.create({
        data: {
          bizType: 'TICKET',
          bizId: ticket.id,
          bizCode: ticket.code,
          action: 'SUBMIT',
          operator: issuer,
          comment: `一票一板开票（隔离点 ${ticket.pointCode ?? pt.location}），提交批准`,
        },
      })
      created.push(ticket)
    }

    // 作业任务单（按需求一张，作为作业组执行单；进度按方案点位聚合）
    let task = await db.workTask.findUnique({ where: { workRequestId: wid } })
    if (!task) {
      const taskCode = await generateCode('TSK', (like) =>
        db.workTask
          .findFirst({ where: { code: { startsWith: like } }, orderBy: { code: 'desc' } })
          .then((r) => r?.code ?? null)
      )
      const assignee = workers.split(/[,，]/)[0].trim() || workers
      const assigneeUser = await db.user.findFirst({ where: { name: assignee } })
      task = await db.workTask.create({
        data: {
          code: taskCode,
          workRequestId: wid,
          assignee,
          assigneeId: assigneeUser?.id ?? null,
          planStart: plannedStart,
          planEnd: plannedEnd,
          status: 'PENDING',
        },
      })
    }

    const updatedRequest = await db.workRequest.update({
      where: { id: wid },
      data: { status: 'TICKET_ISSUED' },
    })
    await pushNotifications({
      targetRoles: ['MANAGER'],
      type: 'APPROVAL',
      title: `作业票待批准（${created.length} 张）`,
      content: `${request.code}（${request.title}）按一票一板开具 ${created.length} 张作业票（${created.map((t) => t.code).join('、')}），请逐张批准`,
      bizType: 'TICKET',
      bizId: created[0].id,
      bizCode: created[0].code,
      linkModule: 'approval-center',
    })
    // 审计留痕：一票一板批量开票
    const actor = resolveActor(extractActor(body), issuer)
    await logAudit({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: 'CREATE',
      entity: 'WORK_TICKET',
      entityId: created[0].id,
      entityCode: created.map((t) => t.code).join('/'),
      detail: auditFlowDetail(
        created[0].code,
        null,
        'PENDING_REVIEW',
        `一票一板开具 ${created.length} 张作业票（${created.map((t) => `${t.code}=${t.pointCode ?? t.pointLocation}`).join('、')}；需求 ${request.code}，任务 ${task.code}）`
      ),
    })
    return NextResponse.json({ tickets: created, ticket: created[0], task, request: updatedRequest }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/work-tickets]', e)
    return jsonError(e instanceof Error ? e.message : '创建作业票失败', 500)
  }
}
