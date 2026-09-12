'use client'
// 首页看板：问候横幅 + 公告跑马灯 + KPI 总览 + 待办提醒 + 作业趋势 + 装置排名 + 最新动态 + 九环节流程导航
import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, fmtDateTime } from '@/lib/bp-api'
import { BUSINESS_STEPS, CHANGE_ACTION_MAP, ModuleProps, ROLE_MAP } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import {
  ClipboardList, Layers, CheckCircle2, ClipboardCheck, AlertTriangle, Activity,
  BellRing, History, Workflow, Inbox, RefreshCw, ChevronRight,
  Megaphone, Sun, Sunrise, Sunset, Moon, ArrowRight, PackageX, Check,
  Sparkles, Loader2, Bot,
} from 'lucide-react'

/** 简报文本渲染：**加粗** + 分段（无其他 Markdown 依赖） */
function renderBrief(text: string): React.ReactNode[] {
  return text.split('\n').filter((l) => l.trim()).map((line, i) => {
    const parts: React.ReactNode[] = []
    const regex = /\*\*([^*]+)\*\*/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(line))) {
      if (m.index > last) parts.push(line.slice(last, m.index))
      parts.push(<strong key={m.index} className="font-semibold text-stone-800">{m[1]}</strong>)
      last = m.index + m[0].length
    }
    if (last < line.length) parts.push(line.slice(last))
    return <p key={i} className="text-[12.5px] leading-relaxed text-stone-600">{parts}</p>
  })
}

// ============ 类型 ============
interface StatusCount { status: string; count: number }
interface PlateStatus { status: string; count: number }
interface UnitRank { unitName: string; count: number }
interface MonthlyPoint { month: string; count: number }
interface InventoryAlert { id: number; spec: string; type: string; material: string; quantity: number; minQuantity: number; gap: number }
interface TodoCount {
  pendingSurvey: number; pendingJsa: number
  isolationPreparing: number; isolationPendingReview: number
  disposalPreparing: number; disposalPendingReview: number
  pendingConfirm: number; pendingTicket: number; ticketPendingReview: number
  inProgress: number; pendingAcceptance: number
}
interface Overview {
  statusCount: StatusCount[]
  plateStatus: PlateStatus[]
  unitRanking: UnitRank[]
  monthly: MonthlyPoint[]
  inventoryAlerts: InventoryAlert[]
  todoCount: TodoCount
}
interface ChangeRecordRow {
  id: number; blindCode: string; action: string; workCode: string | null
  location: string | null; operator: string; note: string | null; createdAt: string
}
interface AnnouncementRow { id: number; title: string; content: string; createdAt: string; readAt?: string | null }

/** 问候时段 → 文案与图标 */
function greetInfo(now: Date): { text: string; icon: React.ComponentType<{ className?: string }> } {
  const h = now.getHours()
  if (h < 6) return { text: '夜深了', icon: Moon }
  if (h < 9) return { text: '早上好', icon: Sunrise }
  if (h < 12) return { text: '上午好', icon: Sun }
  if (h < 14) return { text: '中午好', icon: Sun }
  if (h < 18) return { text: '下午好', icon: Sun }
  return { text: '晚上好', icon: Sunset }
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 九大环节 → 导航目标与对应待办字段（与 TODO_NAV 口径一致；todoKeys 为该环节全部待办，角标取和） */
const STEP_NAV: { key: string; tab: string; todoKeys?: (keyof TodoCount)[]; hint: string }[] = [
  { key: 'work-requests', tab: 'list', hint: '查看/受理作业需求' },
  { key: 'work-requests', tab: 'survey', todoKeys: ['pendingSurvey'], hint: '待勘察需求前往处理' },
  { key: 'work-requests', tab: 'jsa', todoKeys: ['pendingJsa'], hint: '待 JSA 分析需求前往处理' },
  { key: 'schemes', tab: 'isolation', todoKeys: ['isolationPreparing', 'isolationPendingReview'], hint: '隔离方案编制与审核' },
  { key: 'schemes', tab: 'disposal', todoKeys: ['disposalPreparing', 'disposalPendingReview'], hint: '工艺处置方案编制与审核' },
  { key: 'work-requests', tab: 'list', todoKeys: ['pendingConfirm'], hint: '待处置确认需求前往处理' },
  { key: 'task-mgmt', tab: 'ticket', todoKeys: ['pendingTicket', 'ticketPendingReview'], hint: '待开作业票/票审批需求前往处理' },
  { key: 'task-mgmt', tab: 'track', todoKeys: ['inProgress'], hint: '作业执行跟踪' },
  { key: 'work-requests', tab: 'list', todoKeys: ['pendingAcceptance'], hint: '待验收需求前往处理' },
]

/** 进行中区间：ISOLATION_PREPARING ~ IN_PROGRESS */
const IN_FLIGHT_STATES = [
  'ISOLATION_PREPARING', 'ISOLATION_PENDING_REVIEW', 'ISOLATION_REJECTED', 'ISOLATION_APPROVED',
  'DISPOSAL_PREPARING', 'DISPOSAL_PENDING_REVIEW', 'DISPOSAL_REJECTED', 'DISPOSAL_APPROVED',
  'PENDING_CONFIRM', 'CONFIRMED', 'TICKET_ISSUED', 'TICKET_APPROVED', 'IN_PROGRESS',
]

/** 变动动作 → 时间线圆点颜色 */
const ACTION_DOT: Record<string, string> = {
  RESERVE: 'bg-amber-500', INSTALL: 'bg-violet-500', REMOVE: 'bg-teal-500',
  RETURN: 'bg-emerald-500', SCRAP: 'bg-stone-400', PURCHASE: 'bg-emerald-600',
}

/** 待办项 → 点击跳转的模块/页签 */
const TODO_NAV: Record<string, { key: string; tab?: string }> = {
  '待现场勘察': { key: 'work-requests', tab: 'survey' },
  '待JSA分析': { key: 'work-requests', tab: 'jsa' },
  '待编制隔离方案': { key: 'schemes', tab: 'isolation' },
  '隔离方案待审核': { key: 'approval-center', tab: 'pending' },
  '待编制工艺处置方案': { key: 'schemes', tab: 'disposal' },
  '处置方案待审核': { key: 'approval-center', tab: 'pending' },
  '待工艺处置确认': { key: 'work-requests', tab: 'list' },
  '待开作业票': { key: 'task-mgmt', tab: 'ticket' },
  '作业票待审批': { key: 'approval-center', tab: 'pending' },
  '作业中': { key: 'task-mgmt', tab: 'track' },
  '待验收': { key: 'work-requests', tab: 'list' },
}

interface KpiItem {
  label: string; value: number; icon: React.ComponentType<{ className?: string }>
  grad: string; sub: string
}

export default function DashboardModule(props: ModuleProps) {
  const onNavigate = props.onNavigate
  const currentUser = props.currentUser
  const [data, setData] = useState<Overview | null>(null)
  const [records, setRecords] = useState<ChangeRecordRow[]>([])
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([])
  const [openAnn, setOpenAnn] = useState<AnnouncementRow | null>(null)
  // 已读公告 id 集合（本会话内点击过跑马灯/弹窗的；与铃铛未读数联动）
  const [readAnnIds, setReadAnnIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // AI 运行简报
  const [aiBriefing, setAiBriefing] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiAt, setAiAt] = useState<string>('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [overview, recs, anns] = await Promise.all([
        apiGet<Overview>('/api/stats/overview'),
        apiGet<ChangeRecordRow[]>('/api/change-records?limit=8'),
        apiGet<{ announcements: AnnouncementRow[] }>('/api/announcements').catch(() => ({ announcements: [] as AnnouncementRow[] })),
      ])
      setData(overview); setRecords(recs); setAnnouncements(anns.announcements ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载看板数据失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  /** AI 运行简报：聚合全库统计 → LLM 生成管理层简报（仅前端触发，不自动请求） */
  const genBriefing = async () => {
    setAiLoading(true); setAiError('')
    try {
      const res = await apiPost<{ content: string; generatedAt: string }>('/api/ai/briefing')
      setAiBriefing(res.content); setAiAt(fmtDateTime(res.generatedAt))
    } catch (e) {
      setAiError(e instanceof Error ? e.message : '生成失败，请稍后重试')
    } finally { setAiLoading(false) }
  }

  /** 点击跑马灯公告：看全文 + 标记已读（静默失败不影响阅读）+ 联动铃铛未读数即时刷新 */
  const openAnnouncement = (a: AnnouncementRow) => {
    setOpenAnn(a)
    if (readAnnIds.has(a.id)) return // 本会话已标记过，避免重复请求
    void apiPost('/api/notifications/read', { ids: [a.id] })
      .then(() => {
        setReadAnnIds((prev) => new Set(prev).add(a.id))
        // 通知铃铛立即刷新未读数（避免等 30s 轮询）
        window.dispatchEvent(new CustomEvent('bp:notifications-changed'))
      })
      .catch(() => {})
  }

  const kpis: KpiItem[] = useMemo(() => {
    const total = data?.statusCount.reduce((s, i) => s + i.count, 0) ?? 0
    const inFlight = data?.statusCount.filter((i) => IN_FLIGHT_STATES.includes(i.status)).reduce((s, i) => s + i.count, 0) ?? 0
    const pending = data?.statusCount.find((i) => i.status === 'PENDING_ACCEPTANCE')?.count ?? 0
    const completed = data?.statusCount.find((i) => i.status === 'COMPLETED')?.count ?? 0
    const installed = data?.plateStatus.find((i) => i.status === 'INSTALLED')?.count ?? 0
    const alerts = data?.inventoryAlerts.length ?? 0
    return [
      { label: '作业需求总数', value: total, icon: ClipboardList, grad: 'from-emerald-400 to-teal-500', sub: '累计受理' },
      { label: '进行中', value: inFlight, icon: Activity, grad: 'from-violet-400 to-violet-600', sub: '隔离准备~作业执行' },
      { label: '待验收', value: pending, icon: ClipboardCheck, grad: 'from-amber-400 to-orange-500', sub: 'PENDING_ACCEPTANCE' },
      { label: '已完成', value: completed, icon: CheckCircle2, grad: 'from-emerald-500 to-green-600', sub: '全程闭环' },
      { label: '盲板已安装', value: installed, icon: Layers, grad: 'from-teal-400 to-emerald-500', sub: '现场在装' },
      { label: '库存预警', value: alerts, icon: AlertTriangle, grad: 'from-rose-400 to-red-500', sub: '低于最低库存' },
    ]
  }, [data])

  // 问候语（挂载时取一次，避免 SSR/CSR 不一致与每帧跳动）
  const [now] = useState(() => new Date())
  const greet = greetInfo(now)
  const GreetIcon = greet.icon
  const dateText = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${WEEKDAYS[now.getDay()]}`
  const roleLabel = ROLE_MAP[currentUser.role]?.label ?? currentUser.role

  // 九环节各自待办数（与 STEP_NAV 顺序对应；多字段求和，如编制+审核）
  const stepTodos = useMemo(() => {
    const t = data?.todoCount
    return STEP_NAV.map((n) => (n.todoKeys && t ? n.todoKeys.reduce((s, k) => s + (t[k] ?? 0), 0) : 0))
  }, [data])
  const totalTodos = useMemo(
    () => stepTodos.reduce((s, n) => s + n, 0),
    [stepTodos],
  )

  const todoItems = useMemo(() => {
    const t = data?.todoCount
    if (!t) return []
    return [
      { label: '待现场勘察', count: t.pendingSurvey, tone: 'amber' as const },
      { label: '待JSA分析', count: t.pendingJsa, tone: 'amber' as const },
      { label: '待编制隔离方案', count: t.isolationPreparing, tone: 'amber' as const },
      { label: '隔离方案待审核', count: t.isolationPendingReview, tone: 'violet' as const },
      { label: '待编制工艺处置方案', count: t.disposalPreparing, tone: 'amber' as const },
      { label: '处置方案待审核', count: t.disposalPendingReview, tone: 'violet' as const },
      { label: '待工艺处置确认', count: t.pendingConfirm, tone: 'violet' as const },
      { label: '待开作业票', count: t.pendingTicket, tone: 'amber' as const },
      { label: '作业票待审批', count: t.ticketPendingReview, tone: 'violet' as const },
      { label: '作业中', count: t.inProgress, tone: 'violet' as const },
      { label: '待验收', count: t.pendingAcceptance, tone: 'amber' as const },
    ].filter((i) => i.count > 0).map((i) => ({ ...i, nav: TODO_NAV[i.label] }))
  }, [data])

  return (
    <div className="space-y-4">
      {/* 错误提示 */}
      {error && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-rose-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />{error}
            <button onClick={() => void load()} className="ml-auto text-xs underline underline-offset-2">重试</button>
          </CardContent>
        </Card>
      )}

      {/* 问候横幅（渐变 Hero + 待办角标） */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-500 text-white shadow-sm">
        <div className="absolute -right-10 -top-14 w-44 h-44 rounded-full bg-white/10" />
        <div className="absolute right-24 -bottom-12 w-32 h-32 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-center gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <GreetIcon className="w-5 h-5 text-amber-200" />
              <span className="text-lg font-bold tracking-wide">{greet.text}，{currentUser.name}</span>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium">{roleLabel}</span>
            </div>
            <div className="mt-1 text-xs text-white/80">{dateText}{currentUser.department ? ` · ${currentUser.department}` : ''}</div>
            <div className="mt-1.5 text-xs text-white/70">
              {totalTodos > 0 ? `当前共 ${totalTodos} 项作业环节待处理，请及时跟进` : '各环节暂无待办，流程运转顺畅'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate?.('approval-center', 'pending')}
              className="group flex items-center gap-3 rounded-xl bg-white/15 px-4 py-2.5 backdrop-blur-sm transition-colors hover:bg-white/25 cursor-pointer"
              title="点击前往审批中心"
            >
              <div className="text-right">
                <div className="text-[11px] text-white/75">我的待办</div>
                <div className="text-2xl font-bold leading-none tabular-nums">{totalTodos}<span className="ml-0.5 text-xs font-normal">项</span></div>
              </div>
              <ArrowRight className="w-4 h-4 text-white/70 transition-transform group-hover:translate-x-0.5" />
            </button>
            {(data?.inventoryAlerts.length ?? 0) > 0 && (
              <button
                onClick={() => onNavigate?.('ledger', 'inventory')}
                className="group relative flex items-center gap-2 rounded-xl bg-rose-500/90 px-3.5 py-2.5 backdrop-blur-sm transition-colors hover:bg-rose-500 cursor-pointer"
                title="库存低于最低储备，点击前往盲板库存"
              >
                <PackageX className="w-4.5 h-4.5 text-white" />
                <div className="text-left">
                  <div className="text-[11px] text-white/80">库存预警</div>
                  <div className="text-lg font-bold leading-none tabular-nums">{data?.inventoryAlerts.length}<span className="ml-0.5 text-[11px] font-normal">项</span></div>
                </div>
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-300 ring-2 ring-white/60 animate-pulse" />
              </button>
            )}
          </div>
        </div>
        {/* 公告跑马灯条（hover 暂停，点击看全文） */}
        <div className="relative border-t border-white/15 bg-black/10">
          <div className="flex items-center gap-2 px-4 py-1.5">
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-400/90 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
              <Megaphone className="w-3 h-3" />公告
            </span>
            {loading ? (
              <span className="text-xs text-white/60">公告加载中…</span>
            ) : announcements.length === 0 ? (
              <span className="text-xs text-white/50">暂无公告</span>
            ) : (
              <div className="bp-marquee-wrap relative min-w-0 flex-1 overflow-hidden">
                <div
                  className="bp-marquee-track flex w-max items-center gap-10"
                  style={{ animationDuration: `${Math.max(announcements.length * 14, 20)}s` }}
                >
                  {[...announcements, ...announcements].map((a, i) => {
                    const read = readAnnIds.has(a.id) || !!a.readAt
                    return (
                      <button
                        key={`${a.id}-${i}`}
                        onClick={() => openAnnouncement(a)}
                        className={cn(
                          'flex shrink-0 items-center gap-1.5 text-xs transition-colors hover:underline underline-offset-2 cursor-pointer',
                          read ? 'text-white/50' : 'text-white/90 hover:text-white',
                        )}
                        title={read ? '已读 · 点击查看全文' : '点击查看公告全文（并标记已读）'}
                      >
                        {read && <Check className="w-3 h-3 text-emerald-300/80" />}
                        <span className="font-medium">{a.title}</span>
                        <span className="text-[10px] text-white/50">{fmtDateTime(a.createdAt)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI 六卡 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          : kpis.map((k) => {
              const Icon = k.icon
              return (
                <div key={k.label} className="rounded-xl bg-white border border-stone-200 overflow-hidden shadow-sm">
                  <div className={cn('h-1 bg-gradient-to-r', k.grad)} />
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-stone-500">{k.label}</span>
                      <Icon className="w-4 h-4 text-stone-300" />
                    </div>
                    <div className="mt-1.5 text-3xl font-bold text-stone-800 tabular-nums">{k.value}</div>
                    <div className="mt-1 text-[11px] text-stone-400">{k.sub}</div>
                  </div>
                </div>
              )
            })}
      </div>

      {/* AI 运行简报（LLM 基于全库实时统计生成） */}
      <div className="overflow-hidden rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-violet-100 bg-violet-50/60 px-4 py-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 shadow-sm">
            <Sparkles className="h-4 w-4 text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-violet-900">AI 运行简报</span>
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-600">大模型生成 · 仅供参考</span>
            </div>
            <div className="truncate text-[11px] text-violet-400/90">基于全库实时统计（作业分布 / 库存预警 / 变动记录 / 在办作业）自动撰写管理层简报</div>
          </div>
          <Button
            size="sm"
            onClick={() => void genBriefing()}
            disabled={aiLoading}
            className="h-8 bg-violet-600 px-3 text-xs text-white shadow-sm hover:bg-violet-700"
          >
            {aiLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {aiLoading ? '生成中…' : aiBriefing ? '重新生成' : '生成简报'}
          </Button>
        </div>
        <div className="px-4 py-3">
          {aiLoading && (
            <div className="flex items-center gap-2 py-3 text-xs text-violet-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              小安正在分析全库数据，生成运行简报…
              <span className="inline-flex gap-0.5">{[0, 1, 2].map((i) => <span key={i} className="h-1 w-1 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
            </div>
          )}
          {!aiLoading && aiError && (
            <div className="flex items-center gap-2 py-2 text-xs text-rose-600">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{aiError}
              <button onClick={() => void genBriefing()} className="rounded border border-rose-300 bg-white px-1.5 py-0.5 text-[11px] hover:bg-rose-50">重试</button>
            </div>
          )}
          {!aiLoading && !aiError && !aiBriefing && (
            <div className="flex items-center gap-2 py-2 text-xs text-stone-400">
              <Bot className="h-4 w-4 shrink-0 text-violet-300" />
              点击右上角「生成简报」，AI 将汇总当前作业态势、库存与在办风险，输出一段管理层简报。
            </div>
          )}
          {!aiLoading && !aiError && aiBriefing && (
            <div className="space-y-1.5">
              {renderBrief(aiBriefing)}
              <div className="pt-1 text-right text-[10px] text-stone-300">生成于 {aiAt}</div>
            </div>
          )}
        </div>
      </div>

      {/* 待办提醒 + 最新动态 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="w-4.5 h-4.5 text-amber-500" />待办提醒
              <span className="ml-auto text-xs font-normal text-stone-400">各环节待处理事项</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
            ) : todoItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-stone-400">
                <Inbox className="w-8 h-8 mb-2 text-stone-300" />
                <span className="text-sm">全部环节暂无待办，流程运转顺畅</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {todoItems.map((t) => (
                  <button key={t.label}
                    onClick={() => t.nav && onNavigate?.(t.nav.key, t.nav.tab)}
                    title="点击前往处理"
                    className={cn('w-full flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition-all',
                      t.tone === 'amber' ? 'border-amber-200 bg-amber-50/70 hover:bg-amber-100/80 hover:border-amber-300' : 'border-violet-200 bg-violet-50/70 hover:bg-violet-100/80 hover:border-violet-300',
                      'group cursor-pointer')}>
                    <span className={cn('text-sm group-hover:underline underline-offset-2', t.tone === 'amber' ? 'text-amber-800' : 'text-violet-800')}>{t.label}</span>
                    <span className="flex items-center gap-1.5">
                      <Badge className={cn('border font-bold tabular-nums',
                        t.tone === 'amber' ? 'bg-amber-500 hover:bg-amber-500 text-white border-amber-500' : 'bg-violet-500 hover:bg-violet-500 text-white border-violet-500')}>
                        {t.count}
                      </Badge>
                      <ChevronRight className="w-3.5 h-3.5 text-stone-300 group-hover:text-stone-500 transition-colors" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="w-4.5 h-4.5 text-teal-500" />最新动态
              <span className="ml-auto text-xs font-normal text-stone-400">盲板变动实时记录</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
            ) : records.length === 0 ? (
              <div className="py-8 text-center text-sm text-stone-400">暂无变动记录</div>
            ) : (
              <div className="relative max-h-[300px] overflow-y-auto pr-1">
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-stone-200" />
                <div className="space-y-3.5">
                  {records.map((r) => (
                    <div key={r.id} className="relative flex items-start gap-3 pl-0">
                      <span className={cn('relative z-10 mt-1 w-[15px] h-[15px] rounded-full border-2 border-white shrink-0', ACTION_DOT[r.action] ?? 'bg-stone-400')} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold text-stone-800">{r.blindCode}</span>
                          <Badge variant="outline" className="h-5 px-1.5 text-[11px] border-stone-200 text-stone-600">
                            {CHANGE_ACTION_MAP[r.action] ?? r.action}
                          </Badge>
                          <span className="ml-auto text-[11px] text-stone-400 whitespace-nowrap">{fmtDateTime(r.createdAt)}</span>
                        </div>
                        <div className="text-xs text-stone-500 mt-0.5 truncate">
                          {r.location ?? '-'} · 操作人 {r.operator}{r.workCode ? ` · ${r.workCode}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 图表：趋势 + 装置排名 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-base">近 6 月作业趋势</CardTitle>
            <p className="text-xs text-stone-400">按月新增作业需求数量</p>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-64 w-full" /> : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data?.monthly ?? []} margin={{ top: 10, right: 16, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e7e5e4', fontSize: 12 }}
                      formatter={(v) => [`${v} 单`, '新增需求']} />
                    <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2.5}
                      dot={{ r: 3.5, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-base">各装置作业排名</CardTitle>
            <p className="text-xs text-stone-400">按装置累计作业需求数</p>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-64 w-full" /> : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.unitRanking ?? []} margin={{ top: 18, right: 16, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                    <XAxis dataKey="unitName" tick={{ fontSize: 10, fill: '#78716c' }} tickLine={false} axisLine={{ stroke: '#e7e5e4' }}
                      interval={0} tickFormatter={(v: string) => (v.length > 4 ? `${v.slice(0, 4)}…` : v)} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e7e5e4', fontSize: 12 }}
                      formatter={(v) => [`${v} 单`, '作业数']} />
                    <Bar dataKey="count" fill="#14b8a6" radius={[6, 6, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 九大业务环节流程导航（可点击直达 + 待办角标） */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="w-4.5 h-4.5 text-emerald-600" />盲板抽堵作业九大环节
            <span className="ml-1 text-[11px] font-normal text-stone-400">点击环节直达对应模块，角标为该环节待办数</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start">
            {BUSINESS_STEPS.map((step, i) => {
              const nav = STEP_NAV[i]
              const todoN = stepTodos[i] ?? 0
              return (
                <div key={step} className="flex items-start flex-1 last:flex-none min-w-0">
                  <button
                    onClick={() => onNavigate?.(nav.key, nav.tab)}
                    title={`${nav.hint}（点击进入）`}
                    className="group flex flex-col items-center gap-1.5 shrink-0 rounded-lg px-1 py-0.5 transition-transform cursor-pointer hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    <span className="relative">
                      <span className={cn('flex w-8 h-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors group-hover:border-emerald-600 group-hover:bg-emerald-600 group-hover:text-white',
                        i < 2 ? 'bg-emerald-600 border-emerald-600 text-white'
                          : i < 5 ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                          : 'bg-white border-stone-200 text-stone-400 group-hover:text-white')}>
                        {i + 1}
                      </span>
                      {todoN > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white shadow-sm ring-1 ring-white">
                          {todoN > 9 ? '9+' : todoN}
                        </span>
                      )}
                    </span>
                    <span className={cn('text-[11px] whitespace-nowrap transition-colors group-hover:text-emerald-700',
                      i < 5 ? 'text-stone-700 font-medium' : 'text-stone-400')}>{step}</span>
                  </button>
                  {i < BUSINESS_STEPS.length - 1 && (
                    <div className={cn('flex-1 h-0.5 mt-4 min-w-[14px]', i < 4 ? 'bg-emerald-300' : 'bg-stone-200')} />
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-stone-400 border-t border-stone-100 pt-3">
            <span>当前流程模板：需求受理 → 勘察 → JSA → 隔离方案 → 工艺处置 → 确认 → 开票 → 执行 → 验收</span>
            <button onClick={() => void load()} className="flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-medium">
              <RefreshCw className="w-3.5 h-3.5" />刷新看板
            </button>
          </div>
        </CardContent>
      </Card>

      {/* 公告全文 Dialog */}
      <Dialog open={!!openAnn} onOpenChange={(o) => !o && setOpenAnn(null)}>
        <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <Megaphone className="w-4.5 h-4.5 shrink-0 text-amber-500" />
              <span className="leading-snug">{openAnn?.title}</span>
              {openAnn && (readAnnIds.has(openAnn.id) || openAnn.readAt) && (
                <span className="shrink-0 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">已读</span>
              )}
            </DialogTitle>
            <div className="text-xs text-stone-400">系统公告 · {openAnn ? fmtDateTime(openAnn.createdAt) : ''}</div>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
            {openAnn?.content}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
