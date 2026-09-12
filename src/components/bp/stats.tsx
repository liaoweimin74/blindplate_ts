'use client'
// 统计分析：KPI + 筛选栏(装置/月份) + 需求状态分布(点击状态下钻) + 盲板状态分布 + 月度趋势 + 装置排名(点击下钻) + 库存预警 + 状态明细 + 状态下钻明细 + 下钻明细 + 报表导出 + 大屏模式(轮播多页/图表下钻浮层)
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { apiGet, fmtDateTime } from '@/lib/bp-api'
import { CHANGE_ACTION_MAP, ModuleProps, PLATE_STATUS_MAP, STATUS_MAP, URGENCY_MAP, WORK_TYPE_MAP } from '@/lib/bp-types'
import { useToast } from '@/hooks/use-toast'
import type { LucideIcon } from 'lucide-react'
import { PencilRuler, ExternalLink } from 'lucide-react'
import { exportCsv } from '@/lib/bp-export'
import { MiniFlowProgress } from '@/components/bp/mini-flow-progress'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend, AreaChart, Area, LabelList, LineChart, Line,
} from 'recharts'
import {
  Activity, AlertTriangle, BarChart3, Building2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList,
  Download, Filter, Inbox, Layers, ListFilter, ListTree, Loader2, Maximize2, Minimize2, Package, RefreshCw, RotateCcw, Trash2, Tv, X,
} from 'lucide-react'

// ============ 类型 ============
interface StatusCount { status: string; count: number }
interface PlateStatus { status: string; count: number }
interface UnitRank { unitName: string; count: number }
interface MonthlyPoint { month: string; count: number }
interface InventoryAlert {
  id: number; spec: string; type: string; material: string; quantity: number; minQuantity: number; gap: number
}
interface Overview {
  statusCount: StatusCount[]
  plateStatus: PlateStatus[]
  unitRanking: UnitRank[]
  monthly: MonthlyPoint[]
  inventoryAlerts: InventoryAlert[]
}

interface BpUnit { id: number; code: string; name: string; active?: boolean }
/** GET /api/work-requests 列表行（含 unit 关联） */
interface WorkRequestRow {
  id: number
  code: string
  title: string
  workType: string
  unitId: number
  urgency: string
  applicantName?: string | null
  status: string
  createdAt: string
  unit?: BpUnit | null
}
/** recharts Bar onClick 首参：柱子条目（原始数据在 payload 上，类目值同时平铺在条目顶层） */
interface BarClickDatum {
  unitName?: string
  status?: string
  payload?: { unitName?: string; status?: string } | null
}

/** ISO 时间 → 'YYYY-MM'（本地时区，与 fmtDate 口径一致） */
function monthKey(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const PLATE_COLORS: Record<string, string> = {
  IN_STOCK: '#10b981',
  RESERVED: '#f59e0b',
  INSTALLED: '#8b5cf6',
  SCRAPPED: '#a8a29e',
}
/** 需求状态 per-bar 配色（允许色板内循环） */
const BAR_PALETTE = ['#10b981', '#14b8a6', '#f59e0b', '#8b5cf6', '#f43f5e', '#0d9488', '#d97706', '#a8a29e']

/** 进行中状态区间：ISOLATION_PREPARING ~ IN_PROGRESS（13 态，与首页看板口径一致） */
const IN_FLIGHT_STATES = [
  'ISOLATION_PREPARING', 'ISOLATION_PENDING_REVIEW', 'ISOLATION_REJECTED', 'ISOLATION_APPROVED',
  'DISPOSAL_PREPARING', 'DISPOSAL_PENDING_REVIEW', 'DISPOSAL_REJECTED', 'DISPOSAL_APPROVED',
  'PENDING_CONFIRM', 'CONFIRMED', 'TICKET_ISSUED', 'TICKET_APPROVED', 'IN_PROGRESS',
]

const tooltipStyle = { borderRadius: 10, border: '1px solid #e7e5e4', fontSize: 12 }

// ============ 大屏模式共用常量（深色适配，严禁 indigo/blue） ============
/** Recharts 深色 Tooltip：stone-900 底 + 浅字 */
const DARK_TOOLTIP = {
  contentStyle: { backgroundColor: '#1c1917', border: '1px solid #44403c', borderRadius: 10, fontSize: 12 },
  labelStyle: { color: '#d6d3d1', fontSize: 12 },
  itemStyle: { color: '#e7e5e4', fontSize: 12 },
}
/** 深色坐标轴刻度（stone-400） */
const DARK_AXIS_TICK = { fontSize: 11, fill: '#a8a29e' }
/** 深色网格线（stone-700） */
const DARK_GRID = '#44403c'
/** 深色长列表/滚动区细滚动条 */
const DARK_SCROLLBAR =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent'

// ============ 大屏自动轮播常量 ============
/** 每页停留时长（自动翻页定时器与线性进度条动画共用，保证同步） */
const ROTATE_MS = 15_000
/** 轮播页配置：第 1 页作业概览（KPI+趋势+装置排名）/ 第 2 页状态与库存（状态分布+库存预警+最新变动大表） */
const SCREEN_PAGES = [
  { key: 'overview', name: '作业概览' },
  { key: 'status', name: '状态与库存' },
] as const

// ============ 统计报表导出（CSV：与 bp-export.exportCsv 同构的 BOM + 转义；文件名精确为 blind-stats-{ymd}.csv） ============
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** 本地日期 YYYY-MM-DD（手动拼接，规避既有导出 toISOString 的 UTC 日界线偏差） */
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 报表 CSV 内容：汇总 KPI 行 + 按装置统计 + 按状态统计 + 需求明细行（全部按当前筛选口径，全局指标单列口径标注） */
function buildStatsCsv(opts: {
  filterLabel: string
  now: Date
  kpi: Array<{ label: string; value: number | string; scope?: string }>
  byUnit: Array<{ name: string; total: number; inFlight: number; completed: number }>
  byStatus: Array<{ label: string; count: number }>
  rows: WorkRequestRow[]
}): string {
  const lines: unknown[][] = [
    ['盲板管理系统 · 统计分析报表'],
    ['筛选条件', opts.filterLabel || '全部装置 · 全部月份'],
    ['导出时间', fmtDateTime(opts.now.toISOString())],
    [],
    ['【汇总指标】'],
    ['指标', '数值', '口径'],
    ...opts.kpi.map((k) => [k.label, k.value, k.scope ?? '当前筛选']),
    [],
    ['【按装置统计】'],
    ['装置', '需求数', '进行中', '已完成'],
    ...opts.byUnit.map((u) => [u.name, u.total, u.inFlight, u.completed]),
    [],
    ['【按状态统计】'],
    ['状态', '数量'],
    ...opts.byStatus.map((s) => [s.label, s.count]),
    [],
    ['【需求明细】'],
    ['需求编号', '标题', '装置', '作业类型', '状态', '紧急程度', '申请人', '创建时间'],
    ...opts.rows.map((r) => [
      r.code,
      r.title,
      r.unit?.name ?? '-',
      WORK_TYPE_MAP[r.workType] ?? r.workType,
      STATUS_MAP[r.status]?.label ?? r.status,
      URGENCY_MAP[r.urgency]?.label ?? r.urgency,
      r.applicantName ?? '-',
      fmtDateTime(r.createdAt),
    ]),
  ]
  return '\uFEFF' + lines.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/** CSV 落盘（Blob + a.download，与项目 exportCsv 相同模式；文件名由调用方完整指定） */
function downloadCsvFile(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function StatsModule(props: ModuleProps) {
  const { toast } = useToast()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 报表导出 loading 态
  const [exporting, setExporting] = useState(false)

  // 下钻数据：装置列表 + 作业需求全量
  const [units, setUnits] = useState<BpUnit[]>([])
  const [requests, setRequests] = useState<WorkRequestRow[]>([])
  const [drillLoading, setDrillLoading] = useState(true)
  const [drillError, setDrillError] = useState('')

  // 筛选条件：'all' 或 String(unit.id) / 'YYYY-MM'
  const [unitFilter, setUnitFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')

  // 大屏模式（全屏数据看板）
  const [bigScreen, setBigScreen] = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try {
      setData(await apiGet<Overview>('/api/stats/overview'))
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取统计数据失败')
    } finally { setLoading(false) }
  }

  const loadDrill = async () => {
    setDrillLoading(true); setDrillError('')
    try {
      const [unitList, reqList] = await Promise.all([
        apiGet<BpUnit[]>('/api/units'),
        apiGet<WorkRequestRow[]>('/api/work-requests'),
      ])
      setUnits(unitList)
      setRequests(reqList)
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : '获取下钻明细失败')
    } finally { setDrillLoading(false) }
  }

  useEffect(() => { void load(); void loadDrill() }, [])

  // ============ 汇总 ============
  const total = data?.statusCount.reduce((s, i) => s + i.count, 0) ?? 0
  const inFlight = data?.statusCount.filter((i) => IN_FLIGHT_STATES.includes(i.status)).reduce((s, i) => s + i.count, 0) ?? 0
  const completed = data?.statusCount.find((i) => i.status === 'COMPLETED')?.count ?? 0
  const plateCount = (s: string) => data?.plateStatus.find((i) => i.status === s)?.count ?? 0

  const kpis = [
    { label: '总需求', value: total, icon: ClipboardList, grad: 'from-emerald-400 to-teal-500' },
    { label: '进行中', value: inFlight, icon: Activity, grad: 'from-violet-400 to-violet-600' },
    { label: '已完成', value: completed, icon: CheckCircle2, grad: 'from-emerald-500 to-green-600' },
    { label: '在库盲板', value: plateCount('IN_STOCK'), icon: Package, grad: 'from-teal-400 to-emerald-500' },
    { label: '已安装', value: plateCount('INSTALLED'), icon: Layers, grad: 'from-teal-500 to-cyan-600' },
    { label: '已报废', value: plateCount('SCRAPPED'), icon: Trash2, grad: 'from-stone-400 to-stone-500' },
  ]

  /** 横向条形图：recharts 纵向 category 轴自下而上渲染，反转使最大值在顶部 */
  const statusChartData = useMemo(
    () => (data?.statusCount ?? [])
      .map((s) => ({ label: STATUS_MAP[s.status]?.label ?? s.status, count: s.count, status: s.status }))
      .reverse(),
    [data]
  )
  const unitChartData = useMemo(() => (data?.unitRanking ?? []).slice().reverse(), [data])
  const pieData = useMemo(
    () => (data?.plateStatus ?? []).map((p) => ({
      name: PLATE_STATUS_MAP[p.status]?.label ?? p.status, value: p.count, key: p.status,
    })),
    [data]
  )

  /** 月份筛选项：从 /api/stats/overview 的近 6 月序列推导（服务端口径，含空月） */
  const monthOptions = useMemo(() => (data?.monthly ?? []).map((m) => m.month), [data])

  // ============ 下钻过滤 ============
  const filteredRequests = useMemo(() => requests.filter((r) => {
    if (unitFilter !== 'all' && r.unitId !== Number(unitFilter)) return false
    if (monthFilter !== 'all' && monthKey(r.createdAt) !== monthFilter) return false
    return true
  }), [requests, unitFilter, monthFilter])

  const drillStats = useMemo(() => ({
    total: filteredRequests.length,
    inFlight: filteredRequests.filter((r) => IN_FLIGHT_STATES.includes(r.status)).length,
    completed: filteredRequests.filter((r) => r.status === 'COMPLETED').length,
  }), [filteredRequests])

  const hasFilter = unitFilter !== 'all' || monthFilter !== 'all'
  const filterUnitLabel = unitFilter === 'all' ? '全部装置' : units.find((u) => String(u.id) === unitFilter)?.name ?? `装置#${unitFilter}`
  const filterLabel = hasFilter ? `${filterUnitLabel} · ${monthFilter === 'all' ? '全部月份' : monthFilter}` : ''

  /** 装置排名柱子点击 → 装置名反查 id → 设置筛选并滚动到下钻明细 */
  const handleUnitBarClick = (d: BarClickDatum) => {
    const name = d?.payload?.unitName ?? d?.unitName
    if (!name) return
    const u = units.find((x) => x.name === name) ?? requests.find((r) => r.unit?.name === name)?.unit
    if (u) {
      setUnitFilter(String(u.id))
      document.getElementById('bp-stats-drill')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // ============ 状态分布下钻（点击状态柱 → 该状态需求明细） ============
  const [statusDrill, setStatusDrill] = useState<string | null>(null)
  const [statusDrillRows, setStatusDrillRows] = useState<WorkRequestRow[]>([])
  const [statusDrillLoading, setStatusDrillLoading] = useState(false)
  const [statusDrillError, setStatusDrillError] = useState('')
  const [statusDrillTick, setStatusDrillTick] = useState(0)

  /** 状态柱子点击：选中下钻；再次点击同一柱取消下钻 */
  const handleStatusBarClick = (d: BarClickDatum) => {
    const st = d?.payload?.status ?? d?.status
    if (!st) return
    setStatusDrill((prev) => (prev === st ? null : st))
  }

  // 状态下钻数据：GET /api/work-requests?status=XXX（服务端过滤，时间倒序）
  useEffect(() => {
    if (!statusDrill) { setStatusDrillRows([]); setStatusDrillError(''); return }
    let cancelled = false
    setStatusDrillLoading(true); setStatusDrillError('')
    apiGet<WorkRequestRow[]>(`/api/work-requests?status=${encodeURIComponent(statusDrill)}`)
      .then((rows) => { if (!cancelled) { setStatusDrillRows(rows); setStatusDrillLoading(false) } })
      .catch((e) => {
        if (!cancelled) {
          setStatusDrillError(e instanceof Error ? e.message : '获取状态下钻明细失败')
          setStatusDrillLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [statusDrill, statusDrillTick])

  // 下钻卡片渲染后平滑滚动定位
  useEffect(() => {
    if (statusDrill) {
      requestAnimationFrame(() => {
        document.getElementById('bp-stats-status-drill')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [statusDrill])

  /** 状态下钻明细行点击 → 携带 focusId 跳转作业需求列表并自动打开详情 */
  const goRequestDetail = (id: number) => {
    props.onNavigate?.('work-requests', 'list', id)
  }

  const resetFilters = () => { setUnitFilter('all'); setMonthFilter('all') }

  const handleExport = () => {
    exportCsv('统计分析下钻',
      ['需求编号', '标题', '装置', '作业类型', '状态', '紧急程度', '申请人', '创建时间'],
      filteredRequests.map((r) => [
        r.code,
        r.title,
        r.unit?.name ?? '-',
        WORK_TYPE_MAP[r.workType] ?? r.workType,
        STATUS_MAP[r.status]?.label ?? r.status,
        URGENCY_MAP[r.urgency]?.label ?? r.urgency,
        r.applicantName ?? '-',
        fmtDateTime(r.createdAt),
      ]))
  }

  /** 导出报表：当前筛选口径的汇总 KPI + 按装置/按状态统计 + 明细行（blind-stats-{ymd}.csv），带 loading 态 */
  const handleExportReport = () => {
    if (exporting) return
    setExporting(true)
    window.setTimeout(() => {
      try {
        const now = new Date()
        const ymd = localYmd(now)
        const byUnit = units
          .map((u) => {
            const rs = filteredRequests.filter((r) => r.unitId === u.id)
            return {
              name: u.name,
              total: rs.length,
              inFlight: rs.filter((r) => IN_FLIGHT_STATES.includes(r.status)).length,
              completed: rs.filter((r) => r.status === 'COMPLETED').length,
            }
          })
          .filter((u) => u.total > 0)
        const byStatus = Object.entries(
          filteredRequests.reduce<Record<string, number>>((acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1
            return acc
          }, {}),
        )
          .map(([status, count]) => ({ label: STATUS_MAP[status]?.label ?? status, count }))
          .sort((a, b) => b.count - a.count)
        const csv = buildStatsCsv({
          filterLabel: filterLabel || '全部装置 · 全部月份',
          now,
          kpi: [
            { label: '需求总数', value: filteredRequests.length },
            { label: '进行中', value: drillStats.inFlight },
            { label: '待验收', value: filteredRequests.filter((r) => r.status === 'PENDING_ACCEPTANCE').length },
            { label: '已完成', value: drillStats.completed },
            { label: '已取消', value: filteredRequests.filter((r) => r.status === 'CANCELLED').length },
            { label: '在库盲板', value: plateCount('IN_STOCK'), scope: '全局' },
            { label: '已安装盲板', value: plateCount('INSTALLED'), scope: '全局' },
            { label: '已报废盲板', value: plateCount('SCRAPPED'), scope: '全局' },
            { label: '库存预警项', value: data?.inventoryAlerts.length ?? 0, scope: '全局' },
          ],
          byUnit,
          byStatus,
          rows: filteredRequests,
        })
        downloadCsvFile(csv, `blind-stats-${ymd}.csv`)
        toast({ title: '统计报表已导出', description: `blind-stats-${ymd}.csv · 明细 ${filteredRequests.length} 条` })
      } finally {
        setExporting(false)
      }
    }, 350)
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-rose-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />{error}
            <button onClick={() => void load()} className="ml-auto text-xs underline underline-offset-2">重试</button>
          </CardContent>
        </Card>
      )}

      {/* 筛选栏（联动下方下钻明细） */}
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5">
          <span className="mr-1 flex items-center gap-1.5 text-sm font-medium text-stone-700">
            <Filter className="w-4 h-4 text-emerald-600" />筛选分析
          </span>
          <div className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-stone-400" />
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="h-8 w-[170px] bg-white text-xs transition-colors hover:border-emerald-300">
                <SelectValue placeholder="全部装置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部装置</SelectItem>
                {units.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-stone-400" />
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="h-8 w-[140px] bg-white text-xs transition-colors hover:border-emerald-300">
                <SelectValue placeholder="全部月份" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部月份</SelectItem>
                {monthOptions.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="hidden text-xs text-stone-400 md:block">点击下方「装置作业排名」柱形可按装置下钻，点击「需求状态分布」柱形可按状态下钻</p>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 text-xs text-stone-500 transition-colors hover:text-emerald-700"
            disabled={!hasFilter}
            onClick={resetFilters}
          >
            <RotateCcw className="h-3.5 w-3.5" />重置筛选
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-stone-200 text-xs text-stone-600 transition-colors hover:border-emerald-300 hover:text-emerald-700"
            disabled={exporting || drillLoading}
            onClick={handleExportReport}
            aria-label="导出报表"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {exporting ? '导出中…' : '导出报表'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-emerald-200 bg-emerald-50/60 text-xs text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-800"
            onClick={() => setBigScreen(true)}
            aria-label="进入大屏模式"
          >
            <Maximize2 className="h-3.5 w-3.5" />大屏模式
          </Button>
        </CardContent>
      </Card>

      {/* KPI 行 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
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
                    <div className="mt-1 text-2xl font-bold text-stone-800 tabular-nums">{k.value}</div>
                  </div>
                </div>
              )
            })}
      </div>

      {/* 图表 2×2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ① 需求状态分布（横向，点击柱子联动状态下钻） */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="w-4.5 h-4.5 text-emerald-600" />需求状态分布</CardTitle>
            <p className="text-xs text-stone-400">各状态作业需求单量 · 点击柱形可下钻查看明细</p>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-72 w-full" /> : statusChartData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-sm text-stone-400">暂无数据</div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusChartData} layout="vertical" margin={{ top: 4, right: 36, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} />
                    <YAxis type="category" dataKey="label" width={116}
                      tick={{ fontSize: 11, fill: '#57534e' }} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} 单`, '需求量']} cursor={{ fill: '#fafaf9' }} />
                    <Bar dataKey="count" radius={[0, 5, 5, 0]} maxBarSize={16} cursor="pointer" onClick={handleStatusBarClick}>
                      {statusChartData.map((entry, i) => (
                        <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]}
                          fillOpacity={statusDrill && statusDrill !== entry.status ? 0.32 : 1}
                          stroke={statusDrill === entry.status ? '#0f766e' : undefined}
                          strokeWidth={statusDrill === entry.status ? 2 : undefined}
                        />
                      ))}
                      <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#78716c', fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ② 盲板状态分布（饼图） */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-base"><Package className="w-4.5 h-4.5 text-teal-600" />盲板状态分布</CardTitle>
            <p className="text-xs text-stone-400">在库 / 已预留 / 已安装 / 已报废 占比</p>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-72 w-full" /> : pieData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-sm text-stone-400">暂无数据</div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} 块`, n]} />
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12, color: '#57534e' }} />
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="46%" outerRadius={82} innerRadius={46}
                      paddingAngle={2} strokeWidth={2} stroke="#fff"
                      label={(props: { percent?: number }) => `${((props.percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={{ stroke: '#a8a29e', strokeWidth: 1 }}>
                      {pieData.map((entry) => (
                        <Cell key={entry.key} fill={PLATE_COLORS[entry.key] ?? '#a8a29e'} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ③ 近 6 月趋势（面积图） */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="w-4.5 h-4.5 text-teal-600" />近 6 月作业趋势</CardTitle>
            <p className="text-xs text-stone-400">按月新增作业需求数量</p>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-72 w-full" /> : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data?.monthly ?? []} margin={{ top: 10, right: 16, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="monthlyAreaFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} 单`, '新增需求']} />
                    <Area type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2.5}
                      fill="url(#monthlyAreaFill)" dot={{ r: 3, fill: '#14b8a6', stroke: '#fff', strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ④ 装置作业排名（横向，点击柱子联动下钻筛选） */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="w-4.5 h-4.5 text-violet-500" />装置作业排名</CardTitle>
            <p className="text-xs text-stone-400">各装置累计作业需求数 · 点击柱子可下钻筛选</p>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-72 w-full" /> : unitChartData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-sm text-stone-400">暂无数据</div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={unitChartData} layout="vertical" margin={{ top: 4, right: 36, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} />
                    <YAxis type="category" dataKey="unitName" width={110}
                      tick={{ fontSize: 11, fill: '#57534e' }} tickLine={false} axisLine={{ stroke: '#e7e5e4' }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} 单`, '作业数']} cursor={{ fill: '#fafaf9' }} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0, 5, 5, 0]} maxBarSize={18} cursor="pointer"
                      onClick={handleUnitBarClick}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#78716c', fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 状态下钻明细（需求状态分布柱子点击联动，再次点击同一柱取消） */}
      {statusDrill && (
        <Card id="bp-stats-status-drill" className="border-0 shadow-sm scroll-mt-20 bp-fade-up">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <ClipboardList className="w-4.5 h-4.5 text-emerald-600" />状态下钻
              <Badge variant="outline" className={cn('text-[11px]', STATUS_MAP[statusDrill]?.className)}>
                {STATUS_MAP[statusDrill]?.label ?? statusDrill}
              </Badge>
              <span className="text-xs font-normal text-stone-400">共 {statusDrillRows.length} 单</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-8 text-xs text-stone-500 transition-colors hover:text-emerald-700"
                onClick={() => setStatusDrill(null)}
              >
                <X className="h-3.5 w-3.5" />关闭下钻
              </Button>
            </CardTitle>
            <p className="text-xs text-stone-400">该状态下全部作业需求明细 · 点击行可打开需求详情</p>
          </CardHeader>
          <CardContent>
            {statusDrillLoading ? (
              <div className="space-y-2" aria-label="加载中">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : statusDrillError ? (
              <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />{statusDrillError}
                <button onClick={() => setStatusDrillTick((t) => t + 1)} className="ml-auto text-xs underline underline-offset-2">重试</button>
              </div>
            ) : statusDrillRows.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2 text-stone-400">
                <Inbox className="w-9 h-9 text-stone-300" />
                <p className="text-sm">该状态下暂无作业需求</p>
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-stone-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-stone-50 text-stone-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">需求编号</th>
                      <th className="text-left font-medium px-3 py-2.5">标题</th>
                      <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">装置</th>
                      <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">作业类型</th>
                      <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap w-32">进度</th>
                      <th className="text-center font-medium px-3 py-2.5 whitespace-nowrap">紧急程度</th>
                      <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">申请人</th>
                      <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">创建时间</th>
                      <th className="w-8"><span className="sr-only">打开详情</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {statusDrillRows.map((r) => (
                      <tr key={r.id} role="button" tabIndex={0}
                        aria-label={`打开需求 ${r.code} 详情`}
                        onClick={() => goRequestDetail(r.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goRequestDetail(r.id) } }}
                        className="group cursor-pointer transition-colors hover:bg-emerald-50/50 focus-visible:outline-none focus-visible:bg-emerald-50/60"
                      >
                        <td className="px-3 py-2.5 font-mono font-semibold text-stone-700 whitespace-nowrap transition-colors group-hover:text-emerald-800">{r.code}</td>
                        <td className="px-3 py-2.5 text-stone-700 max-w-[220px] truncate" title={r.title}>{r.title}</td>
                        <td className="px-3 py-2.5 text-stone-600 whitespace-nowrap">{r.unit?.name ?? '-'}</td>
                        <td className="px-3 py-2.5 text-stone-600 whitespace-nowrap">{WORK_TYPE_MAP[r.workType] ?? r.workType}</td>
                        <td className="px-3 py-2.5 min-w-[132px]">
                          <MiniFlowProgress status={r.status} />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <Badge variant="outline" className={cn('text-[11px]', URGENCY_MAP[r.urgency]?.className)}>
                            {URGENCY_MAP[r.urgency]?.label ?? r.urgency}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-stone-600 whitespace-nowrap">{r.applicantName ?? '-'}</td>
                        <td className="px-3 py-2.5 text-right text-stone-500 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                        <td className="px-2 py-2.5 text-center">
                          <ChevronRight className="w-4 h-4 mx-auto text-stone-300 transition-colors group-hover:text-emerald-600" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* PID 组态图实时状态入口 */}
      <PidEntryCard onNavigate={props.onNavigate} />

      {/* 库存预警 + 状态明细 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-4.5 h-4.5 text-rose-500" />库存预警
              <Badge className="bg-rose-500 hover:bg-rose-500 text-white border-0">{data?.inventoryAlerts.length ?? 0}</Badge>
              <button onClick={() => void load()} className="ml-auto flex items-center gap-1 text-xs font-normal text-stone-400 hover:text-emerald-700">
                <RefreshCw className="w-3.5 h-3.5" />刷新
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-40 w-full" /> : (data?.inventoryAlerts.length ?? 0) === 0 ? (
              <div className="py-10 text-center text-sm text-stone-400">库存充足，暂无预警项</div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto rounded-lg border border-stone-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-stone-50 text-stone-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2.5">规格</th>
                      <th className="text-left font-medium px-3 py-2.5">类型</th>
                      <th className="text-left font-medium px-3 py-2.5">材质</th>
                      <th className="text-right font-medium px-3 py-2.5">数量</th>
                      <th className="text-right font-medium px-3 py-2.5">最低库存</th>
                      <th className="text-center font-medium px-3 py-2.5">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {data!.inventoryAlerts.map((i) => (
                      <tr key={i.id} className="hover:bg-stone-50/60">
                        <td className="px-3 py-2.5 font-mono font-semibold text-stone-700">{i.spec}</td>
                        <td className="px-3 py-2.5 text-stone-600">{i.type}</td>
                        <td className="px-3 py-2.5 text-stone-600">{i.material}</td>
                        <td className={cn('px-3 py-2.5 text-right font-bold tabular-nums', i.quantity === 0 ? 'text-rose-600' : 'text-amber-600')}>{i.quantity}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-stone-500">{i.minQuantity}</td>
                        <td className="px-3 py-2.5 text-center">
                          <Badge className="bg-rose-100 text-rose-700 border border-rose-200 hover:bg-rose-100">补库 缺{i.gap}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListTree className="w-4.5 h-4.5 text-emerald-600" />需求状态明细
              <span className="ml-auto text-xs font-normal text-stone-400">共 {total} 单</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-40 w-full" /> : (data?.statusCount.length ?? 0) === 0 ? (
              <div className="py-10 text-center text-sm text-stone-400">暂无作业需求</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[480px] overflow-y-auto pr-1">
                {data!.statusCount.map((s) => (
                  <div key={s.status} className="flex items-center justify-between rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2">
                    <Badge variant="outline" className={cn('text-[11px]', STATUS_MAP[s.status]?.className)}>
                      {STATUS_MAP[s.status]?.label ?? s.status}
                    </Badge>
                    <span className="text-sm font-bold text-stone-700 tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 下钻明细（筛选栏 + 装置排名柱子点击联动） */}
      <Card id="bp-stats-drill" className="border-0 shadow-sm scroll-mt-20">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <ListFilter className="w-4.5 h-4.5 text-teal-600" />下钻明细
            {hasFilter && (
              <Badge variant="outline" className="text-[11px] bg-teal-50 text-teal-700 border-teal-200">
                {filterLabel}
              </Badge>
            )}
            <span className="ml-auto text-xs font-normal text-stone-400">共 {drillStats.total} 条</span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={drillLoading || drillError !== '' || filteredRequests.length === 0}
              onClick={handleExport}
            >
              <Download className="h-3.5 w-3.5" />导出
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* 迷你汇总 */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: '筛选结果', value: drillStats.total, icon: ListFilter, grad: 'from-teal-400 to-emerald-500' },
              { label: '进行中', value: drillStats.inFlight, icon: Activity, grad: 'from-violet-400 to-violet-600' },
              { label: '已完成', value: drillStats.completed, icon: CheckCircle2, grad: 'from-emerald-500 to-green-600' },
            ].map((m) => {
              const Icon = m.icon
              return (
                <div key={m.label} className="rounded-lg bg-white border border-stone-200 overflow-hidden shadow-sm">
                  <div className={cn('h-0.5 bg-gradient-to-r', m.grad)} />
                  <div className="px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-stone-500">{m.label}</span>
                      <Icon className="w-3.5 h-3.5 text-stone-300" />
                    </div>
                    <div className="mt-0.5 text-xl font-bold text-stone-800 tabular-nums">{m.value}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {drillError && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />{drillError}
              <button onClick={() => void loadDrill()} className="ml-auto text-xs underline underline-offset-2">重试</button>
            </div>
          )}

          {drillLoading ? <Skeleton className="h-64 w-full" /> : filteredRequests.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-2 text-stone-400">
              <Inbox className="w-10 h-10 text-stone-300" />
              <p className="text-sm">当前筛选条件下暂无作业需求</p>
              {hasFilter && (
                <button onClick={resetFilters} className="text-xs text-emerald-700 underline underline-offset-2">重置筛选查看全部</button>
              )}
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto rounded-lg border border-stone-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-stone-50 text-stone-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">需求编号</th>
                    <th className="text-left font-medium px-3 py-2.5">标题</th>
                    <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">装置</th>
                    <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">作业类型</th>
                    <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap w-32">进度</th>
                    <th className="text-center font-medium px-3 py-2.5 whitespace-nowrap">状态</th>
                    <th className="text-center font-medium px-3 py-2.5 whitespace-nowrap">紧急程度</th>
                    <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">申请人</th>
                    <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">创建时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredRequests.map((r) => (
                    <tr key={r.id} className="transition-colors hover:bg-stone-50">
                      <td className="px-3 py-2.5 font-mono font-semibold text-stone-700 whitespace-nowrap">{r.code}</td>
                      <td className="px-3 py-2.5 text-stone-700 max-w-[220px] truncate" title={r.title}>{r.title}</td>
                      <td className="px-3 py-2.5 text-stone-600 whitespace-nowrap">{r.unit?.name ?? '-'}</td>
                      <td className="px-3 py-2.5 text-stone-600 whitespace-nowrap">{WORK_TYPE_MAP[r.workType] ?? r.workType}</td>
                      <td className="px-3 py-2.5 min-w-[132px]">
                        <MiniFlowProgress status={r.status} />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant="outline" className={cn('text-[11px]', STATUS_MAP[r.status]?.className)}>
                          {STATUS_MAP[r.status]?.label ?? r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant="outline" className={cn('text-[11px]', URGENCY_MAP[r.urgency]?.className)}>
                          {URGENCY_MAP[r.urgency]?.label ?? r.urgency}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-stone-600 whitespace-nowrap">{r.applicantName ?? '-'}</td>
                      <td className="px-3 py-2.5 text-right text-stone-500 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 大屏模式（全屏遮罩层，Escape 或按钮退出） */}
      {bigScreen && <StatsBigScreen onExit={() => setBigScreen(false)} />}
    </div>
  )
}

// ============ 大屏模式 ============
/** GET /api/change-records 行（盲板变动记录，底部跑马灯与第 2 页大表数据源） */
interface ChangeRecordRow {
  id: number
  blindCode: string
  action: string
  workCode: string | null
  location: string | null
  operator: string
  note: string | null
  createdAt: string
}

/** 大屏下钻浮层维度：装置排名柱 / 状态分布柱 / 月度趋势点 */
type ScreenDrillOverlay =
  | { kind: 'unit'; name: string }
  | { kind: 'status'; status: string }
  | { kind: 'month'; month: string }

const pad2 = (n: number) => String(n).padStart(2, '0')
const WEEK_CN = '日一二三四五六'

/** 大屏卡片壳：白色/5 底 + 白/10 边框 + bp-fade-up 交错入场 */
function ScreenCard({
  title, sub, icon: Icon, delay, children,
}: {
  title: string
  sub: string
  icon: LucideIcon
  delay: number
  children: ReactNode
}) {
  return (
    <div
      className="bp-fade-up flex flex-col rounded-xl border border-white/10 bg-white/5 p-4 sm:p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold tracking-wide text-stone-100">{title}</h3>
        <span className="ml-auto text-[11px] text-stone-500">{sub}</span>
      </div>
      {children}
    </div>
  )
}

/** 大屏深色环境状态徽章：白/5 底 + STATUS_MAP.dot 实色圆点（浅色徽章类在深色底不可读） */
function DarkStatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-stone-200">
      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_MAP[status]?.dot ?? 'bg-stone-400')} aria-hidden="true" />
      {STATUS_MAP[status]?.label ?? status}
    </span>
  )
}

/**
 * 统计分析·大屏模式：全屏深色数据看板
 * - 数据复用 /api/stats/overview + /api/change-records + /api/work-requests，进入时独立拉取 + 每 60s 自动刷新（退出清理定时器）
 * - 双页自动轮播（15s 翻页 + 线性进度条提示剩余时间；hover 大屏或打开下钻浮层时暂停，关闭浮层恢复；支持 ←/→ 手动翻页）
 * - 图表接下钻联动：装置排名柱/状态分布柱/月度趋势点 → 深色明细浮层（遮罩/X 关闭，MiniFlowProgress 进度列）
 * - 实时时钟（HH:mm:ss 每秒跳动，初始 null 占位防 SSR 水合不匹配）；Escape 退出；挂载期间 body overflow hidden 防滚动
 */
function StatsBigScreen({ onExit }: { onExit: () => void }) {
  const { toast } = useToast()
  const [data, setData] = useState<Overview | null>(null)
  const [records, setRecords] = useState<ChangeRecordRow[]>([])
  const [reqRows, setReqRows] = useState<WorkRequestRow[] | null>(null)
  const [error, setError] = useState('')
  const [clock, setClock] = useState<Date | null>(null)
  // 轮播：当前页 / 翻页周期计数（重置 15s 定时器与进度条）/ hover 暂停 / 下钻浮层（含退场动画标记）
  const [page, setPage] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [hoverPaused, setHoverPaused] = useState(false)
  const [overlay, setOverlay] = useState<ScreenDrillOverlay | null>(null)
  const [overlayLeaving, setOverlayLeaving] = useState(false)
  // 图表 hover 高亮（非当前柱降透明度）
  const [hoverUnit, setHoverUnit] = useState<string | null>(null)
  const [hoverStatus, setHoverStatus] = useState<string | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [ov, recs, reqs] = await Promise.all([
        apiGet<Overview>('/api/stats/overview'),
        apiGet<ChangeRecordRow[]>('/api/change-records?limit=30'),
        apiGet<WorkRequestRow[]>('/api/work-requests'),
      ])
      setData(ov)
      setRecords(recs)
      setReqRows(reqs)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '大屏数据获取失败')
    }
  }, [])

  // 独立拉取 + 每 60s 自动刷新（首拉经 setTimeout 异步触发，规避 set-state-in-effect）
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 60_000)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [load])

  // 自动轮播：15s 翻页；hover 大屏/浮层打开时暂停；cycle 变化（手动翻页/恢复）重置计时
  const rotating = !hoverPaused && overlay === null && !overlayLeaving
  useEffect(() => {
    if (!rotating || SCREEN_PAGES.length <= 1) return
    const t = window.setTimeout(() => setPage((p) => (p + 1) % SCREEN_PAGES.length), ROTATE_MS)
    return () => window.clearTimeout(t)
  }, [rotating, cycle])

  // 实时时钟：首帧 null 占位，挂载后立即对齐一次并每秒跳动（setTimeout 异步对齐规避 set-state-in-effect）
  useEffect(() => {
    const tick = () => setClock(new Date())
    const first = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 1000)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [])

  /** 关闭浮层：180ms 退场动画后卸载，并恢复轮播（重置周期；若指针仍在屏内，mousemove 会重新暂停） */
  const closeOverlay = useCallback(() => {
    setOverlayLeaving(true)
    const t = window.setTimeout(() => {
      setOverlay(null)
      setOverlayLeaving(false)
      setHoverPaused(false)
      setCycle((c) => c + 1)
    }, 180)
    closeTimerRef.current = t
  }, [])
  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current) }, [])

  // Escape 关闭浮层/退出大屏；←/→ 手动翻页（浮层打开时忽略）；body 防滚动
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (overlay) closeOverlay()
        else onExit()
      } else if (!overlay && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        setPage((p) => (p + dir + SCREEN_PAGES.length) % SCREEN_PAGES.length)
        setCycle((c) => c + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [overlay, closeOverlay, onExit])

  // ============ 汇总（与常规模式口径一致） ============
  const total = data?.statusCount.reduce((s, i) => s + i.count, 0) ?? 0
  const inFlight = data?.statusCount.filter((i) => IN_FLIGHT_STATES.includes(i.status)).reduce((s, i) => s + i.count, 0) ?? 0
  const completed = data?.statusCount.find((i) => i.status === 'COMPLETED')?.count ?? 0
  const pendingAcceptance = data?.statusCount.find((i) => i.status === 'PENDING_ACCEPTANCE')?.count ?? 0
  const installedCount = data?.plateStatus.find((i) => i.status === 'INSTALLED')?.count ?? 0
  const alertCount = data?.inventoryAlerts.length ?? 0

  const kpis = [
    { label: '作业需求总数', value: total, icon: ClipboardList, tone: 'text-stone-50' },
    { label: '进行中', value: inFlight, icon: Activity, tone: 'text-teal-400' },
    { label: '待验收', value: pendingAcceptance, icon: ClipboardCheck, tone: 'text-amber-400' },
    { label: '已完成', value: completed, icon: CheckCircle2, tone: 'text-emerald-400' },
    { label: '盲板已安装', value: installedCount, icon: Layers, tone: 'text-teal-300' },
    { label: '库存预警', value: alertCount, icon: AlertTriangle, tone: 'text-rose-400' },
  ]

  const statusChartData = useMemo(
    () => (data?.statusCount ?? [])
      .map((s) => ({ label: STATUS_MAP[s.status]?.label ?? s.status, count: s.count, status: s.status }))
      .reverse(),
    [data]
  )
  const unitChartData = useMemo(() => (data?.unitRanking ?? []).slice().reverse(), [data])
  const monthly = data?.monthly ?? []
  /** 跑马灯仅取最近 8 条（接口拉 30 条供第 2 页大表） */
  const marqueeRecords = useMemo(() => records.slice(0, 8), [records])

  // ============ 大屏下钻浮层（装置/状态/月份三维度，行数据来自缓存的 /api/work-requests 全量） ============
  const drillRows = useMemo(() => {
    if (!overlay) return []
    if (overlay.kind === 'unit') return (reqRows ?? []).filter((r) => r.unit?.name === overlay.name)
    if (overlay.kind === 'status') return (reqRows ?? []).filter((r) => r.status === overlay.status)
    return (reqRows ?? []).filter((r) => monthKey(r.createdAt) === overlay.month)
  }, [overlay, reqRows])

  const overlayMeta = useMemo(() => {
    if (!overlay) return { title: '', dim: '' }
    const n = drillRows.length
    if (overlay.kind === 'unit') return { title: `${overlay.name} · ${n} 条需求`, dim: '装置维度下钻' }
    if (overlay.kind === 'status') return { title: `${STATUS_MAP[overlay.status]?.label ?? overlay.status} · ${n} 条需求`, dim: '状态维度下钻' }
    return { title: `${overlay.month} · ${n} 条需求`, dim: '月份维度下钻' }
  }, [overlay, drillRows.length])

  /** 打开浮层；维度计数为 0 时 toast 提示不弹层 */
  const openDrill = (o: ScreenDrillOverlay, count: number) => {
    if (count === 0) {
      toast({ description: '该维度暂无数据' })
      return
    }
    setOverlay(o)
  }

  const handleScreenUnitClick = (d: BarClickDatum) => {
    const name = d?.payload?.unitName ?? d?.unitName
    if (!name) return
    openDrill({ kind: 'unit', name }, unitChartData.find((u) => u.unitName === name)?.count ?? 0)
  }
  const handleScreenStatusClick = (d: BarClickDatum) => {
    const st = d?.payload?.status ?? d?.status
    if (!st) return
    openDrill({ kind: 'status', status: st }, statusChartData.find((s) => s.status === st)?.count ?? 0)
  }
  /** 月度趋势点点击（recharts dot/activeDot 事件首参：点条目，payload 上是原始行） */
  const handleScreenMonthClick = (d: unknown) => {
    const p = d as { payload?: { month?: string }; month?: string } | null | undefined
    const month = p?.payload?.month ?? p?.month
    if (!month) return
    openDrill({ kind: 'month', month }, monthly.find((m) => m.month === month)?.count ?? 0)
  }
  const handleScreenUnitHover = (d: BarClickDatum | null) => {
    const name = d ? d?.payload?.unitName ?? d?.unitName : null
    setHoverUnit(name ?? null)
  }
  const handleScreenStatusHover = (d: BarClickDatum | null) => {
    const st = d ? d?.payload?.status ?? d?.status : null
    setHoverStatus(st ?? null)
  }

  // ============ 轮播控制 ============
  const goPage = (i: number) => {
    setPage(((i % SCREEN_PAGES.length) + SCREEN_PAGES.length) % SCREEN_PAGES.length)
    setCycle((c) => c + 1)
  }

  const timeText = clock ? `${pad2(clock.getHours())}:${pad2(clock.getMinutes())}:${pad2(clock.getSeconds())}` : '--:--:--'
  const dateText = clock
    ? `${clock.getFullYear()}年${clock.getMonth() + 1}月${clock.getDate()}日 星期${WEEK_CN[clock.getDay()]}`
    : '—'

  return (
    <div
      id="bp-stats-bigscreen"
      role="dialog"
      aria-modal="true"
      aria-label="盲板作业数据大屏"
      className="fixed inset-0 z-50 flex flex-col bg-stone-950 bg-[radial-gradient(ellipse_at_top,#04211a_0%,#0a100e_55%,#0c0a09_100%)] text-stone-100"
      onMouseMove={() => { if (!hoverPaused) setHoverPaused(true) }}
      onMouseLeave={() => { setHoverPaused(false); setCycle((c) => c + 1) }}
    >
      {/* 顶部标题栏 */}
      <header className="shrink-0 border-b border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10">
              <Tv className="h-5 w-5 text-emerald-400" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-bold tracking-wide text-stone-50 sm:text-lg">盲板作业数据大屏</h2>
              <p className="text-[10px] uppercase tracking-[0.25em] text-stone-500">Blind Plate Operations Dashboard</p>
            </div>
          </div>

          {/* 轮播页码指示器 + 手动切换（←/→ 键同样生效） */}
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
            <button
              aria-label="上一页"
              onClick={() => goPage(page - 1)}
              className="rounded-full p-0.5 text-stone-400 transition-colors hover:bg-white/10 hover:text-emerald-300"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-1.5" role="tablist" aria-label="大屏轮播页">
              {SCREEN_PAGES.map((p, i) => (
                <button
                  key={p.key}
                  role="tab"
                  aria-selected={i === page}
                  aria-label={`切换到第 ${i + 1} 页：${p.name}`}
                  onClick={() => goPage(i)}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-300',
                    i === page ? 'w-6 bg-emerald-400' : 'w-1.5 bg-white/25 transition-colors hover:bg-white/50',
                  )}
                />
              ))}
            </div>
            <button
              aria-label="下一页"
              onClick={() => goPage(page + 1)}
              className="rounded-full p-0.5 text-stone-400 transition-colors hover:bg-white/10 hover:text-emerald-300"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span className="border-l border-white/10 pl-2 text-[11px] font-medium text-stone-300">{SCREEN_PAGES[page].name}</span>
            <span className="text-[10px] tabular-nums text-stone-500">{rotating ? `${ROTATE_MS / 1000}s 自动轮播` : '轮播已暂停'}</span>
          </div>

          <div className="ml-auto flex items-center gap-3 sm:gap-6">
            <div className="text-right">
              <time id="bp-screen-clock" className="block font-mono text-xl font-bold leading-none tabular-nums text-emerald-400 sm:text-2xl">
                {timeText}
              </time>
              <div className="mt-0.5 text-[11px] tabular-nums text-stone-400">{dateText}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-white/15 bg-white/5 text-xs text-stone-200 transition-colors hover:bg-white/10 hover:text-white"
              onClick={onExit}
              aria-label="退出大屏"
            >
              <Minimize2 className="h-3.5 w-3.5" />退出大屏
            </Button>
          </div>
        </div>
      </header>

      {/* 轮播剩余时间线性进度条：与 15s 定时器同步（key 重置起点；hover/浮层打开时冻结） */}
      <div className="relative h-0.5 shrink-0 bg-white/5" aria-hidden="true">
        <div
          key={`${page}-${cycle}`}
          className={cn(
            'bp-rotate-progress absolute inset-y-0 left-0 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 transition-opacity',
            !rotating && 'opacity-40',
          )}
          style={{ animationDuration: `${ROTATE_MS}ms`, animationPlayState: rotating ? 'running' : 'paused' }}
        />
      </div>

      {/* 主内容区（双页轮播，淡入切换） */}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {error && (
          <div className="bp-fade-up mb-4 flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}（每 60 秒自动重试）
          </div>
        )}

        {page === 0 ? (
          <div key="screen-page-overview" className="bp-page-fade space-y-4">
            {/* KPI 大数字横排 */}
            <section aria-label="核心指标" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {kpis.map((k, i) => {
                const Icon = k.icon
                return (
                  <div
                    key={k.label}
                    className="bp-fade-up rounded-xl border border-white/10 bg-white/5 p-4"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-stone-400">{k.label}</span>
                      <Icon className="h-4 w-4 text-white/20" aria-hidden="true" />
                    </div>
                    {data === null ? (
                      <div className="mt-2 h-9 w-16 animate-pulse rounded bg-white/10" aria-hidden="true" />
                    ) : (
                      <div className={cn('mt-1.5 text-3xl font-bold tabular-nums sm:text-4xl', k.tone)}>{k.value}</div>
                    )}
                  </div>
                )
              })}
            </section>

            <section aria-label="趋势与装置排名" className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* 近 6 月作业趋势（折线，点击数据点 → 月份维度下钻浮层） */}
              <ScreenCard title="近 6 月作业趋势" sub="按月新增作业需求 · 点击数据点下钻" icon={Activity} delay={120}>
                {data === null ? (
                  <div className="h-64 animate-pulse rounded-lg bg-white/5 sm:h-72" aria-hidden="true" />
                ) : (
                  <div className="h-64 sm:h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthly} margin={{ top: 10, right: 16, bottom: 0, left: -18 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={DARK_GRID} vertical={false} />
                        <XAxis dataKey="month" tick={DARK_AXIS_TICK} tickLine={false} axisLine={{ stroke: DARK_GRID }} />
                        <YAxis allowDecimals={false} tick={DARK_AXIS_TICK} tickLine={false} axisLine={false} />
                        <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`${v} 单`, '新增需求']} />
                        <Line type="monotone" dataKey="count" stroke="#34d399" strokeWidth={2.5}
                          dot={{ r: 3, fill: '#34d399', stroke: '#0c0a09', strokeWidth: 2, cursor: 'pointer', onClick: handleScreenMonthClick }}
                          activeDot={{ r: 6, cursor: 'pointer', onClick: handleScreenMonthClick }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </ScreenCard>

              {/* 装置作业排名（柱状，点击柱形 → 装置维度下钻浮层；hover 高亮） */}
              <ScreenCard title="装置作业排名" sub="各装置累计作业需求数 · 点击柱形下钻" icon={Building2} delay={200}>
                {data === null ? (
                  <div className="h-64 animate-pulse rounded-lg bg-white/5 sm:h-72" aria-hidden="true" />
                ) : unitChartData.length === 0 ? (
                  <div className="flex h-64 items-center justify-center text-sm text-stone-500 sm:h-72">暂无数据</div>
                ) : (
                  <div className="h-64 sm:h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={unitChartData} layout="vertical" margin={{ top: 4, right: 36, bottom: 0, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={DARK_GRID} horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={DARK_AXIS_TICK} tickLine={false} axisLine={{ stroke: DARK_GRID }} />
                        <YAxis type="category" dataKey="unitName" width={110} tick={DARK_AXIS_TICK} tickLine={false} axisLine={{ stroke: DARK_GRID }} />
                        <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`${v} 单`, '作业数']} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
                        <Bar dataKey="count" radius={[0, 5, 5, 0]} maxBarSize={18} cursor="pointer"
                          onClick={handleScreenUnitClick}
                          onMouseEnter={handleScreenUnitHover}
                          onMouseLeave={() => handleScreenUnitHover(null)}>
                          {unitChartData.map((entry, i) => (
                            <Cell key={i} fill="#2dd4bf"
                              fillOpacity={hoverUnit !== null && hoverUnit !== entry.unitName ? 0.35 : 1}
                              stroke={hoverUnit === entry.unitName ? '#a7f3d0' : undefined}
                              strokeWidth={hoverUnit === entry.unitName ? 1.5 : undefined} />
                          ))}
                          <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#d6d3d1', fontWeight: 600 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </ScreenCard>
            </section>
          </div>
        ) : (
          <div key="screen-page-status" className="bp-page-fade space-y-4">
            <section aria-label="状态分布与库存预警" className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* 需求状态分布（点击柱形 → 状态维度下钻浮层；hover 高亮） */}
              <ScreenCard title="需求状态分布" sub="各状态作业需求单量 · 点击柱形下钻" icon={BarChart3} delay={120}>
                {data === null ? (
                  <div className="h-64 animate-pulse rounded-lg bg-white/5 sm:h-72" aria-hidden="true" />
                ) : statusChartData.length === 0 ? (
                  <div className="flex h-64 items-center justify-center text-sm text-stone-500 sm:h-72">暂无数据</div>
                ) : (
                  <div className="h-64 sm:h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={statusChartData} layout="vertical" margin={{ top: 4, right: 36, bottom: 0, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={DARK_GRID} horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={DARK_AXIS_TICK} tickLine={false} axisLine={{ stroke: DARK_GRID }} />
                        <YAxis type="category" dataKey="label" width={116} tick={DARK_AXIS_TICK} tickLine={false} axisLine={{ stroke: DARK_GRID }} />
                        <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`${v} 单`, '需求量']} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
                        <Bar dataKey="count" radius={[0, 5, 5, 0]} maxBarSize={16} cursor="pointer"
                          onClick={handleScreenStatusClick}
                          onMouseEnter={handleScreenStatusHover}
                          onMouseLeave={() => handleScreenStatusHover(null)}>
                          {statusChartData.map((entry, i) => (
                            <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]}
                              fillOpacity={hoverStatus !== null && hoverStatus !== entry.status ? 0.35 : 1}
                              stroke={hoverStatus === entry.status ? '#e7e5e4' : undefined}
                              strokeWidth={hoverStatus === entry.status ? 1.5 : undefined} />
                          ))}
                          <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#d6d3d1', fontWeight: 600 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </ScreenCard>

              {/* 库存预警列表（rose 点缀） */}
              <ScreenCard title="库存预警" sub={`待补库 ${alertCount} 项`} icon={AlertTriangle} delay={200}>
                {data === null ? (
                  <div className="h-64 animate-pulse rounded-lg bg-white/5 sm:h-72" aria-hidden="true" />
                ) : alertCount === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center gap-2 text-stone-500 sm:h-72">
                    <Package className="h-8 w-8 text-white/15" aria-hidden="true" />
                    <p className="text-sm">库存充足，暂无预警项</p>
                  </div>
                ) : (
                  <ul className={cn('h-64 divide-y divide-white/5 overflow-y-auto pr-1 sm:h-72', DARK_SCROLLBAR)}>
                    {data.inventoryAlerts.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm font-semibold text-stone-100">{i.spec}</p>
                          <p className="truncate text-[11px] text-stone-500">{i.type} · {i.material}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                          <span className="text-stone-400">
                            库存 <span className={cn('font-bold', i.quantity === 0 ? 'text-rose-400' : 'text-amber-400')}>{i.quantity}</span>
                            <span className="text-stone-600"> / {i.minQuantity}</span>
                          </span>
                          <span className="rounded border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 text-[11px] font-medium text-rose-300">
                            补库 缺{i.gap}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </ScreenCard>
            </section>

            {/* 最新变动大表（第 2 页独有：最近 30 条盲板变动记录） */}
            <ScreenCard title="最新变动明细" sub={`盲板变动记录 · 最近 ${records.length} 条`} icon={ClipboardCheck} delay={280}>
              {records.length === 0 ? (
                <div className="flex h-52 flex-col items-center justify-center gap-2 text-stone-500">
                  <Inbox className="h-8 w-8 text-white/15" aria-hidden="true" />
                  <p className="text-sm">{error ? '变动记录加载失败' : '暂无盲板变动记录'}</p>
                </div>
              ) : (
                <div className={cn('max-h-72 overflow-y-auto rounded-lg border border-white/10', DARK_SCROLLBAR)}>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-[#12211c] text-stone-400">
                      <tr>
                        <th className="whitespace-nowrap px-3 py-2 text-left font-medium">盲板编号</th>
                        <th className="whitespace-nowrap px-3 py-2 text-left font-medium">动作</th>
                        <th className="whitespace-nowrap px-3 py-2 text-left font-medium">关联作业票</th>
                        <th className="whitespace-nowrap px-3 py-2 text-left font-medium">操作人</th>
                        <th className="px-3 py-2 text-left font-medium">备注</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-medium">时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {records.map((r) => (
                        <tr key={r.id} className="transition-colors hover:bg-white/5">
                          <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold text-emerald-300">{r.blindCode}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-stone-200">{CHANGE_ACTION_MAP[r.action] ?? r.action}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-stone-400">{r.workCode ?? '-'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-stone-300">{r.operator}</td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-stone-500" title={r.note ?? undefined}>{r.note ?? '-'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-stone-500">{fmtDateTime(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ScreenCard>
          </div>
        )}
      </main>

      {/* 底部滚动信息条：最新盲板变动记录跑马灯 */}
      <footer className="shrink-0 border-t border-white/10 bg-black/40">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />最新变动
          </span>
          {marqueeRecords.length === 0 ? (
            <span className="text-xs text-stone-500">{error ? '变动记录加载失败' : '暂无盲板变动记录'}</span>
          ) : (
            <div className="bp-marquee-wrap relative min-w-0 flex-1 overflow-hidden">
              <div
                className="bp-marquee-track flex w-max items-center"
                style={{ animationDuration: `${Math.max(marqueeRecords.length * 8, 24)}s` }}
              >
                {[...marqueeRecords, ...marqueeRecords].map((r, i) => (
                  <span key={`${r.id}-${i}`} className="mr-12 flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-stone-300">
                    <span className="font-mono font-semibold text-emerald-300">{r.blindCode}</span>
                    <span>{CHANGE_ACTION_MAP[r.action] ?? r.action}</span>
                    <span className="text-stone-500">@ {r.operator}</span>
                    <span className="tabular-nums text-stone-500">{fmtDateTime(r.createdAt)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </footer>

      {/* 下钻明细浮层：遮罩点击/X 关闭；打开期间轮播暂停（关闭后恢复） */}
      {overlay && (
        <div
          className={cn(
            'fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm',
            overlayLeaving ? 'bp-mask-out' : 'bp-mask-in',
          )}
          onClick={() => { if (!overlayLeaving) closeOverlay() }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="大屏下钻明细"
            className={cn(
              'flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl',
              overlayLeaving ? 'bp-overlay-out' : 'bp-overlay-in',
            )}
            style={{ background: 'radial-gradient(ellipse at top left, #0a2e23 0%, #10100e 70%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10">
                <ClipboardList className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-bold text-stone-50">{overlayMeta.title}</h3>
                <p className="text-[11px] text-stone-500">{overlayMeta.dim} · 共 {drillRows.length} 条命中需求</p>
              </div>
              <button
                aria-label="关闭明细浮层"
                onClick={() => { if (!overlayLeaving) closeOverlay() }}
                className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-stone-400 transition-colors hover:bg-white/10 hover:text-stone-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className={cn('min-h-[120px] overflow-y-auto', DARK_SCROLLBAR)}>
              {reqRows === null ? (
                <div className="space-y-2 p-5" aria-label="加载中">
                  <div className="h-10 animate-pulse rounded-lg bg-white/5" />
                  <div className="h-10 animate-pulse rounded-lg bg-white/5" />
                  <div className="h-10 animate-pulse rounded-lg bg-white/5" />
                </div>
              ) : drillRows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-stone-500">
                  <Inbox className="h-9 w-9 text-white/15" aria-hidden="true" />
                  <p className="text-sm">该维度暂无命中需求</p>
                </div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {drillRows.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/5">
                      <span className="shrink-0 font-mono text-sm font-semibold text-emerald-300">{r.code}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-stone-100" title={r.title}>{r.title}</span>
                        <span className="text-[11px] text-stone-500">
                          {r.unit?.name ?? '-'} · {WORK_TYPE_MAP[r.workType] ?? r.workType} · {fmtDateTime(r.createdAt)}
                        </span>
                      </span>
                      <MiniFlowProgress status={r.status} className="hidden shrink-0 sm:flex" />
                      <DarkStatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** PID 组态图实时状态入口卡：列出全部组态图，点击直达 pid-config 查看通/盲与作业实时状态 */
function PidEntryCard({ onNavigate }: { onNavigate?: ModuleProps['onNavigate'] }) {
  const [items, setItems] = useState<{ id: number; name: string; shapeCount: number; markCount: number; updatedAt: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    apiGet<{ list: typeof items }>('/api/pid-diagrams')
      .then((d) => { if (alive) setItems(d.list ?? []) })
      .catch(() => { /* 入口卡加载失败不阻塞统计页 */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PencilRuler className="w-4.5 h-4.5 text-teal-600" />PID 组态图
          <Badge variant="outline" className="ml-1 text-[10px] border-teal-300 text-teal-700">{items.length} 张</Badge>
          <span className="ml-auto text-xs font-normal text-stone-400">隔离点位通/盲与作业状态实时可视</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 flex-1" />)}</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-sm text-stone-400">还没有组态图，去「PID 组态」模块新建并标注隔离点位</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {items.map((d) => (
              <button key={d.id} onClick={() => onNavigate?.('pid-config', undefined, d.id)}
                className="group flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2.5 text-left transition-colors hover:border-teal-300 hover:bg-teal-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-100 text-teal-700">
                  <PencilRuler className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-stone-700 group-hover:text-teal-800">{d.name}</span>
                  <span className="mt-0.5 block text-[11px] text-stone-400">图元 {d.shapeCount} · 隔离点 {d.markCount} · 更新 {fmtDateTime(d.updatedAt)}</span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-stone-300 group-hover:text-teal-600" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
