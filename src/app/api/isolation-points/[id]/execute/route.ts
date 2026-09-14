import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, bizStatusLabel, num, parseId, readBody, str } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/**
 * POST /api/isolation-points/[id]/execute { operator }
 * 前置：隔离点未完成 且 方案已 APPROVED
 * ADD：盲板 → INSTALLED、location=隔离点位置、unitId=需求装置
 * REMOVE：盲板 → IN_STOCK、location='盲板库'
 * 写 ChangeRecord(INSTALL/REMOVE, workCode=关联票号)，隔离点标记 done
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const pid = parseId(id)
    if (!pid) return jsonError('无效的隔离点 ID')
    const point = await db.isolationPoint.findUnique({ where: { id: pid } })
    if (!point) return jsonError('隔离点不存在', 404)
    const scheme = await db.isolationScheme.findUnique({ where: { id: point.schemeId } })
    if (!scheme) return jsonError('所属隔离方案不存在', 404)
    if (point.done) return jsonError('该隔离点已执行完成，请勿重复操作')
    if (scheme.status !== 'APPROVED') {
      return jsonError(`隔离方案当前状态为 ${scheme.status}，审核通过后才能执行作业`)
    }

    const body = await readBody(req)
    const operator = str(body.operator)
    if (!operator) return jsonError('操作人不能为空')

    // 一票一板门禁：该点位绑定的作业票必须已批准/作业中才能执行盲板作业
    const boundTicket = await db.workTicket.findFirst({
      where: { pointId: point.id, status: { not: 'VOID' } },
      orderBy: { createdAt: 'desc' },
    })
    if (boundTicket && !['APPROVED', 'IN_PROGRESS'].includes(boundTicket.status)) {
      return jsonError(
        `该点位的作业票 ${boundTicket.code} 当前为「${bizStatusLabel(boundTicket.status)}」，仅批准/作业中状态可执行盲板作业`,
        409
      )
    }
    // 优先使用预留时绑定的盲板；REMOVE 点也可在执行时传入 blindPlateId 绑定已安装盲板
    const plateId = point.blindPlateId ?? num(body.blindPlateId)
    if (!plateId) {
      return jsonError(
        point.action === 'ADD'
          ? '该隔离点尚未预留盲板，请先调用 reserve 预留'
          : '该隔离点未绑定盲板实体，请在执行时传入 blindPlateId'
      )
    }
    const plate = await db.blindPlate.findUnique({ where: { id: plateId } })
    if (!plate) return jsonError('绑定的盲板不存在', 404)

    const request = await db.workRequest.findUnique({ where: { id: scheme.workRequestId } })
    const ticket = boundTicket ?? await db.workTicket.findFirst({ where: { workRequestId: scheme.workRequestId } })
    const now = new Date()
    const isAdd = point.action === 'ADD'

    const updatedPlate = await db.blindPlate.update({
      where: { id: plate.id },
      data: isAdd
        ? { status: 'INSTALLED', location: point.location, unitId: request?.unitId ?? null }
        : { status: 'IN_STOCK', location: '盲板库', unitId: null },
    })
    const updatedPoint = await db.isolationPoint.update({
      where: { id: point.id },
      data: { done: true, doneAt: now, operator },
    })
    await db.changeRecord.create({
      data: {
        blindPlateId: plate.id,
        blindCode: plate.code,
        action: isAdd ? 'INSTALL' : 'REMOVE',
        workCode: ticket?.code ?? null,
        location: isAdd ? point.location : '盲板库',
        fromStatus: plate.status,
        toStatus: isAdd ? 'INSTALLED' : 'IN_STOCK',
        operator,
        note: `${isAdd ? '安装' : '拆除'}盲板 - 隔离点${point.seq}（${point.location}）`,
      },
    })
    await pushNotifications({
      targetRoles: ['GUARDIAN', 'ENGINEER'],
      type: 'EXECUTE',
      title: `隔离点${point.seq}已${isAdd ? '安装' : '拆除'}盲板`,
      content: `${request?.code ?? ''} 隔离点${point.seq}（${point.location}）已${isAdd ? '安装' : '拆除'}盲板 ${plate.code}，操作人：${operator}`,
      bizType: 'REQUEST',
      bizId: scheme.workRequestId,
      bizCode: request?.code ?? undefined,
      linkModule: 'task-mgmt',
      linkTab: 'track',
    })
    return NextResponse.json({ point: updatedPoint, blindPlate: updatedPlate })
  } catch (e) {
    console.error('[POST /api/isolation-points/[id]/execute]', e)
    return jsonError(e instanceof Error ? e.message : '执行隔离点作业失败', 500)
  }
}
