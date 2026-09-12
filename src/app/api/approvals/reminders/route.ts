import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/**
 * 审批催办/超时提醒（13-HANDOVER 建议③通知体系增强）
 *
 * GET  /api/approvals/reminders?hours=24
 *   纯读：并行扫描三类待审单据（隔离方案/工艺处置方案/作业票，status=PENDING_REVIEW），
 *   返回「已待审 ≥ hours 小时」的超时清单与生效阈值，供审批中心角标/卡片徽章/提示条。
 *
 * POST /api/approvals/reminders?hours=24
 *   幂等催办：对超时单据发送 type=REMINDER 的站内通知（同一单据当日只发一次），
 *   返回 { sent, skipped, list }。发送失败不阻塞响应（pushNotifications 内置静默降级）。
 *
 * 待审时长口径：IsolationScheme/DisposalScheme 无 updatedAt、WorkTicket 无签发时间字段，
 * 统一取最近一次 ApprovalRecord(action=SUBMIT) 的时间（即单据进入待审的时刻），
 * 无留痕时兜底 preparedAt（方案）/ createdAt（作业票）——与 GET /api/approvals 的 submittedAt 口径一致。
 * 催办受众与各单据「提交审批」时的既有通知受众完全一致：
 * isolation/disposal submit → REVIEWER+MANAGER；ticket issue → MANAGER。
 */

type OverdueBizType = 'ISOLATION_SCHEME' | 'DISPOSAL_SCHEME' | 'WORK_TICKET'

/** 催办通知受众（与各业务 submit/issue 路由既有 pushNotifications 的 targetRoles 一致） */
const REMINDER_ROLES: Record<OverdueBizType, string[]> = {
  ISOLATION_SCHEME: ['REVIEWER', 'MANAGER'],
  DISPOSAL_SCHEME: ['REVIEWER', 'MANAGER'],
  WORK_TICKET: ['MANAGER'],
}
/** Notification.bizType 沿用既有审批通知的值域（ISOLATION/DISPOSAL/TICKET），保证通知中心口径统一 */
const NOTIFY_BIZ_TYPE: Record<OverdueBizType, string> = {
  ISOLATION_SCHEME: 'ISOLATION',
  DISPOSAL_SCHEME: 'DISPOSAL',
  WORK_TICKET: 'TICKET',
}
const BIZ_LABEL: Record<OverdueBizType, string> = {
  ISOLATION_SCHEME: '隔离方案',
  DISPOSAL_SCHEME: '工艺处置方案',
  WORK_TICKET: '作业票',
}

const DEFAULT_THRESHOLD_HOURS = 24
const MAX_THRESHOLD_HOURS = 24 * 30

function parseThreshold(req: NextRequest): number {
  const rawParam = req.nextUrl.searchParams.get('hours')
  if (rawParam === null || rawParam.trim() === '') return DEFAULT_THRESHOLD_HOURS // 缺省 24（注意 Number(null)=0 的坑）
  const raw = Number(rawParam)
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_THRESHOLD_HOURS
  return Math.min(raw, MAX_THRESHOLD_HOURS)
}

interface ReminderItem {
  bizType: OverdueBizType
  bizId: number
  code: string
  workCode: string | null // 所属作业需求编号
  label: string
  title: string | null // 需求标题
  pendingHours: number // 保留 1 位小数
  submittedBy: string | null
  submittedAt: string | null
}

/** 并行扫描三类待审单据，计算待审时长并过滤出超时清单（超时多的排前） */
async function scanOverdue(thresholdHours: number): Promise<{ list: ReminderItem[] }> {
  const now = new Date()
  const [isoPending, dispPending, ticketPending] = await Promise.all([
    db.isolationScheme.findMany({ where: { status: 'PENDING_REVIEW' }, orderBy: { preparedAt: 'asc' } }),
    db.disposalScheme.findMany({ where: { status: 'PENDING_REVIEW' }, orderBy: { preparedAt: 'asc' } }),
    db.workTicket.findMany({ where: { status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'asc' } }),
  ])

  // 关联作业需求（编号/标题）
  const reqIds = [...new Set([...isoPending, ...dispPending, ...ticketPending].map((x) => x.workRequestId))]
  const requests = reqIds.length ? await db.workRequest.findMany({ where: { id: { in: reqIds } } }) : []
  const reqMap = new Map(requests.map((r) => [r.id, r]))

  // 最近一次 SUBMIT 审批留痕（按时间倒序，首个命中即最新一次提交）
  const submits = await db.approvalRecord.findMany({
    where: { action: 'SUBMIT', bizType: { in: ['ISOLATION', 'DISPOSAL', 'TICKET'] } },
    orderBy: { createdAt: 'desc' },
  })
  const submitMap = new Map<string, { operator: string; at: Date }>()
  for (const r of submits) {
    const key = `${r.bizType}:${r.bizId}`
    if (!submitMap.has(key)) submitMap.set(key, { operator: r.operator, at: r.createdAt })
  }

  const hoursOf = (key: string, fallbackAt: Date) => {
    const since = submitMap.get(key)?.at ?? fallbackAt
    return Math.round(((now.getTime() - since.getTime()) / 3600000) * 10) / 10
  }

  const items: ReminderItem[] = []
  for (const s of isoPending) {
    const wr = reqMap.get(s.workRequestId)
    const sub = submitMap.get(`ISOLATION:${s.id}`)
    items.push({
      bizType: 'ISOLATION_SCHEME', bizId: s.id, code: s.code,
      workCode: wr?.code ?? null, label: BIZ_LABEL.ISOLATION_SCHEME, title: wr?.title ?? null,
      pendingHours: hoursOf(`ISOLATION:${s.id}`, s.preparedAt),
      submittedBy: sub?.operator ?? s.preparedBy, submittedAt: (sub?.at ?? s.preparedAt).toISOString(),
    })
  }
  for (const s of dispPending) {
    const wr = reqMap.get(s.workRequestId)
    const sub = submitMap.get(`DISPOSAL:${s.id}`)
    items.push({
      bizType: 'DISPOSAL_SCHEME', bizId: s.id, code: s.code,
      workCode: wr?.code ?? null, label: BIZ_LABEL.DISPOSAL_SCHEME, title: wr?.title ?? null,
      pendingHours: hoursOf(`DISPOSAL:${s.id}`, s.preparedAt),
      submittedBy: sub?.operator ?? s.preparedBy, submittedAt: (sub?.at ?? s.preparedAt).toISOString(),
    })
  }
  for (const t of ticketPending) {
    const wr = reqMap.get(t.workRequestId)
    const sub = submitMap.get(`TICKET:${t.id}`)
    items.push({
      bizType: 'WORK_TICKET', bizId: t.id, code: t.code,
      workCode: wr?.code ?? null, label: BIZ_LABEL.WORK_TICKET, title: wr?.title ?? null,
      pendingHours: hoursOf(`TICKET:${t.id}`, t.createdAt),
      submittedBy: sub?.operator ?? t.issuer, submittedAt: (sub?.at ?? t.createdAt).toISOString(),
    })
  }

  const list = items
    .filter((x) => x.pendingHours >= thresholdHours)
    .sort((a, b) => b.pendingHours - a.pendingHours)
  return { list }
}

/**
 * GET /api/approvals/reminders?hours=24 → { list, thresholdHours }
 */
export async function GET(req: NextRequest) {
  try {
    const thresholdHours = parseThreshold(req)
    const { list } = await scanOverdue(thresholdHours)
    return NextResponse.json({ list, thresholdHours })
  } catch (e) {
    console.error('[GET /api/approvals/reminders]', e)
    return jsonError(e instanceof Error ? e.message : '获取审批催办数据失败', 500)
  }
}

/**
 * POST /api/approvals/reminders?hours=24 → { sent, skipped, list, thresholdHours }
 * 幂等：同一单据当日（本地 0 点起）已有 REMINDER 通知则跳过（bizId 跨表不唯一，按 bizType+bizId 联合去重）。
 */
export async function POST(req: NextRequest) {
  try {
    const thresholdHours = parseThreshold(req)
    const { list } = await scanOverdue(thresholdHours)

    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const sentToday = await db.notification.findMany({
      where: { type: 'REMINDER', createdAt: { gte: dayStart } },
      select: { bizType: true, bizId: true },
    })
    const sentKeys = new Set(sentToday.map((n) => `${n.bizType}:${n.bizId}`))

    let sent = 0
    let skipped = 0
    for (const item of list) {
      const notifyBizType = NOTIFY_BIZ_TYPE[item.bizType]
      if (sentKeys.has(`${notifyBizType}:${item.bizId}`)) {
        skipped++
        continue
      }
      await pushNotifications({
        targetRoles: REMINDER_ROLES[item.bizType],
        type: 'REMINDER',
        title: '审批催办',
        content: item.workCode
          ? `${item.workCode}（${item.title ?? ''}）的${item.label} ${item.code} 已待审 ${item.pendingHours} 小时，请及时处理`
          : `${item.label} ${item.code} 已待审 ${item.pendingHours} 小时，请及时处理`,
        bizType: notifyBizType,
        bizId: item.bizId,
        bizCode: item.code,
        linkModule: 'approval-center',
      })
      sent++
    }
    return NextResponse.json({ sent, skipped, list, thresholdHours })
  } catch (e) {
    console.error('[POST /api/approvals/reminders]', e)
    return jsonError(e instanceof Error ? e.message : '发送审批催办失败', 500)
  }
}
