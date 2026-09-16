import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUnit } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

const TAKE = 5

/** 统一搜索结果条目：module/tab 供前端 onNavigate 跳转 */
export interface SearchItem {
  id: number
  code: string
  title: string
  status: string | null
  createdAt: string
  extra: string | null
  module: string
  tab: string
}

export interface SearchGroups {
  requests: SearchItem[]
  tickets: SearchItem[]
  tasks: SearchItem[]
  isolation: SearchItem[]
  disposal: SearchItem[]
  plates: SearchItem[]
}

const EMPTY_GROUPS: SearchGroups = {
  requests: [], tickets: [], tasks: [], isolation: [], disposal: [], plates: [],
}

/** 单组查询失败不拖垮整体，降级为空数组 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch (e) {
    console.error('[GET /api/search] group query failed', e)
    return fallback
  }
}

/**
 * GET /api/search?keyword= → 全局聚合搜索（各分组限 5 条）
 * 覆盖：作业需求(code/title)、作业票(code)、作业任务(code)、隔离方案(code)、工艺处置方案(code)、盲板档案(code/spec/location)
 * SQLite contains 基于 LIKE，ASCII 不区分大小写，无需特殊处理
 */
export async function GET(req: NextRequest) {
  const keyword = (req.nextUrl.searchParams.get('keyword') ?? '').trim()
  if (keyword.length < 2) {
    return NextResponse.json({ keyword, groups: EMPTY_GROUPS })
  }

  try {
    const like = { contains: keyword }

    const [requests, tickets, tasks, isoSchemes, dispSchemes, plates] = await Promise.all([
      safe(() => db.workRequest.findMany({
        where: { OR: [{ code: like }, { title: like }] },
        orderBy: { createdAt: 'desc' }, take: TAKE,
      }), []),

      safe(() => db.workTicket.findMany({
        where: { code: like },
        orderBy: { createdAt: 'desc' }, take: TAKE,
      }), []),

      safe(() => db.workTask.findMany({
        where: { code: like },
        orderBy: { createdAt: 'desc' }, take: TAKE,
      }), []),

      safe(() => db.isolationScheme.findMany({
        where: { code: like },
        orderBy: { preparedAt: 'desc' }, take: TAKE,
      }), []),

      safe(() => db.disposalScheme.findMany({
        where: { code: like },
        orderBy: { preparedAt: 'desc' }, take: TAKE,
      }), []),

      safe(() => db.blindPlate.findMany({
        where: { OR: [{ code: like }, { spec: like }, { location: like }] },
        orderBy: { createdAt: 'desc' }, take: TAKE,
      }), []),
    ])

    // 票/任务/方案均挂接作业需求：取需求标题作为展示标题
    const relIds = [...new Set(
      [...tickets, ...tasks, ...isoSchemes, ...dispSchemes].map((x) => x.workRequestId)
    )]
    const relRequests = relIds.length
      ? await db.workRequest.findMany({ where: { id: { in: relIds } } })
      : []
    const reqMap = new Map(relRequests.map((r) => [r.id, r]))
    const reqTitle = (wid: number) => reqMap.get(wid)?.title ?? '关联作业需求已删除'

    const withUnits = await safe(
      () => withUnit(requests),
      requests.map((r) => ({ ...r, unit: null }))
    )

    const groups: SearchGroups = {
      requests: withUnits.map((r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        extra: r.unit?.name ?? r.location ?? null,
        module: 'work-requests',
        tab: 'list',
      })),
      tickets: tickets.map((t) => ({
        id: t.id,
        code: t.code,
        title: reqTitle(t.workRequestId),
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        extra: `监护人 ${t.guardian}`,
        module: 'task-mgmt',
        tab: 'ticket',
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        code: t.code,
        title: reqTitle(t.workRequestId),
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        extra: `负责人 ${t.assignee}`,
        module: 'task-mgmt',
        tab: 'track',
      })),
      isolation: isoSchemes.map((s) => ({
        id: s.id,
        code: s.code,
        title: reqTitle(s.workRequestId),
        status: s.status,
        createdAt: s.preparedAt.toISOString(),
        extra: `编制 ${s.preparedBy}`,
        module: 'schemes',
        tab: 'isolation',
      })),
      disposal: dispSchemes.map((s) => ({
        id: s.id,
        code: s.code,
        title: reqTitle(s.workRequestId),
        status: s.status,
        createdAt: s.preparedAt.toISOString(),
        extra: `编制 ${s.preparedBy}`,
        module: 'schemes',
        tab: 'disposal',
      })),
      plates: plates.map((p) => ({
        id: p.id,
        code: p.code,
        title: p.spec,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        extra: [p.type, p.material, p.location].filter(Boolean).join(' · ') || null,
        module: 'ledger',
        tab: 'plates',
      })),
    }

    return NextResponse.json({ keyword, groups })
  } catch (e) {
    console.error('[GET /api/search]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '全局搜索失败' },
      { status: 500 }
    )
  }
}
