'use client'
// 作业任务管理：开作业票（票证审批流）+ 作业任务跟踪（隔离点预留/执行确认）
import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, fmtDate, fmtDateTime, toLocalInput } from '@/lib/bp-api'
import {
  ModuleProps, POINT_ACTION_MAP, STATUS_MAP, TASK_STATUS_MAP, TICKET_STATUS_MAP, URGENCY_MAP,
} from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  TicketCheck, Route, ClipboardPlus, Gavel, PlayCircle, FlagTriangleRight, LockKeyholeOpen,
  FileCheck2, RefreshCw, Inbox, ClipboardList, User2, CalendarClock, ShieldCheck,
  ChevronRight, ChevronDown, CircleCheck, CircleDashed, Layers, Loader2, Printer, Download, MapPin,
} from 'lucide-react'
import TicketPrint from '@/components/bp/ticket-print'
import { CrewWall } from '@/components/bp/crew'
import { PidLocateDialog, toLocatePoints, type LocatePoint } from '@/components/bp/pid-locate'
import { exportCsv } from '@/lib/bp-export'

// ============ 类型 ============
interface BpUser { id: string; username: string; name: string; role: string; department?: string | null }
interface UnitRow { id: number; name: string; code: string }
interface WorkRequestRow {
  id: number; code: string; title: string; unitId: number; location: string
  medium?: string | null; urgency: string; status: string; plannedStart?: string | null; plannedEnd?: string | null
  unit?: UnitRow | null
}
interface TicketRow {
  id: number; code: string; workRequestId: number; plannedStart: string; plannedEnd: string
  guardian: string; workers: string; issuer: string; safetyMeasures: string; workerCerts?: string | null; status: string
  pointId?: number | null; pointCode?: string | null; pointLocation?: string | null
  blindSpec?: string | null; blindType?: string | null; action?: string | null
  comment?: string | null; approvedBy?: string | null
  approvedAt?: string | null; startedAt?: string | null; finishedAt?: string | null
  closedAt?: string | null; createdAt?: string
}
interface TaskRow {
  id: number; code: string; workRequestId: number; ticketId: number | null; assignee: string
  planStart: string | null; planEnd: string | null; status: string; actualStart: string | null; actualEnd: string | null
  workRequest?: WorkRequestRow | null
  ticket?: TicketRow | null
  pointsTotal?: number; pointsDone?: number
}
interface PointRow {
  id: number; seq: number; location: string; medium: string | null; blindSpec: string; blindType: string
  action: string; blindPlateId: number | null; done: boolean; doneAt: string | null; operator: string | null
  masterCode?: string | null; code?: string | null; name?: string | null; masterPointId?: number | null
}
interface SchemeRow { id: number; code: string; status: string; preparedBy: string; points: PointRow[] }
interface PlateRow { id: number; code: string; spec: string; type: string; material: string; status: string; location: string | null }

/** 票证页签纳入的需求状态 */
const TICKET_REQ_STATUSES = ['CONFIRMED', 'TICKET_ISSUED', 'TICKET_APPROVED', 'IN_PROGRESS', 'FINISHED', 'PENDING_ACCEPTANCE']
const REVIEW_ROLES = ['REVIEWER', 'MANAGER', 'ADMIN']
/** 现场执行角色：预留盲板 / 执行确认 仅限作业人员、监护人、工艺工程师、管理员 */
const FIELD_ROLES = ['OPERATOR', 'GUARDIAN', 'ENGINEER', 'ADMIN']

/** 默认预填安全措施（5 条） */
const DEFAULT_MEASURES = [
  '1. 作业前确认作业票齐全有效，安全措施逐项落实',
  '2. 系统已泄压、排净、置换合格，具备安全作业条件',
  '3. 作业人员佩戴防护用具，特种作业持证上岗',
  '4. 现场设置警戒区域，专人监护，无关人员禁止入内',
  '5. 作业完成后确认盲板安装/拆除到位，无泄漏并恢复现场',
].join('\n')

type TabKey = 'ticket' | 'track'
type TicketAction = 'create' | 'issue' | 'review' | 'start' | 'finish' | 'close' | null

/** 根据需求与票状态推断当前应展示的操作 */
function resolveAction(req: WorkRequestRow, ticket: TicketRow | null | undefined): TicketAction {
  if (!ticket) return req.status === 'CONFIRMED' ? 'create' : null
  switch (ticket.status) {
    case 'DRAFT': return 'issue'
    case 'PENDING_REVIEW': return 'review'
    case 'APPROVED': return 'start'
    case 'IN_PROGRESS': return 'finish'
    case 'FINISHED': return 'close'
    default: return null
  }
}

function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden min-w-[60px]">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-stone-500 tabular-nums whitespace-nowrap">{done}/{total}</span>
    </div>
  )
}

export default function TaskMgmtModule({ currentUser, initialTab, singleTab }: ModuleProps & { singleTab?: 'ticket' | 'track' }) {
  const { toast } = useToast()
  const [tab, setTab] = useState<TabKey>(singleTab ?? (initialTab === 'track' ? 'track' : 'ticket'))

  // ============ 票证页签数据 ============
  const [requests, setRequests] = useState<WorkRequestRow[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [users, setUsers] = useState<BpUser[]>([])
  const [ticketLoading, setTicketLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 开作业票 Dialog
  const [createFor, setCreateFor] = useState<WorkRequestRow | null>(null)
  const [createScheme, setCreateScheme] = useState<SchemeRow | null>(null)
  const [createPointIds, setCreatePointIds] = useState<number[]>([])
  const [form, setForm] = useState({ plannedStart: '', plannedEnd: '', guardian: '', guardianId: '', workers: '', issuer: '', safetyMeasures: '' })

  // 审批 Dialog
  const [reviewFor, setReviewFor] = useState<{ req: WorkRequestRow; ticket: TicketRow } | null>(null)
  const [reviewComment, setReviewComment] = useState('')
  // 作业票票面明细展开（Task 111：每张票可展开查看安全措施+逐人验资照片墙，key=票 id）
  const [ticketDetailOpen, setTicketDetailOpen] = useState<Record<number, boolean>>({})

  // 通用确认框（开始作业/完工/关闭）
  // 需求23：扫码核对为移动端专属环节（现场扫隔离点二维码），桌面端免扫码直接确认；
  // 服务端仅对携带 X-Client: mobile 的请求强制比对（Task 102 强校验语义保留在移动端链路）
  const [confirm, setConfirm] = useState<{ title: string; desc: string; run: () => Promise<void> } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  // ============ 跟踪页签数据 ============
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [taskLoading, setTaskLoading] = useState(true)

  // 执行详情 Sheet
  const [detail, setDetail] = useState<TaskRow | null>(null)
  const [scheme, setScheme] = useState<SchemeRow | null>(null)
  const [sheetTickets, setSheetTickets] = useState<TicketRow[]>([])
  const [schemeLoading, setSchemeLoading] = useState(false)
  const [allPlates, setAllPlates] = useState<PlateRow[]>([])

  // 预留盲板 Dialog
  const [reservePoint, setReservePoint] = useState<PointRow | null>(null)
  const [stockPlates, setStockPlates] = useState<PlateRow[] | null>(null)
  const [reservePlateId, setReservePlateId] = useState('')

  // 执行确认 AlertDialog
  const [execPoint, setExecPoint] = useState<PointRow | null>(null)
  const [execOperator, setExecOperator] = useState('')

  // 作业票打印（拉取完整需求详情保证票面字段齐全）
  const [printData, setPrintData] = useState<{ ticket: TicketRow; req: WorkRequestRow } | null>(null)
  const openPrint = async (req: WorkRequestRow, ticket: TicketRow) => {
    let full = req
    try {
      full = await apiGet<WorkRequestRow>(`/api/work-requests/${req.id}`)
    } catch { /* 列表数据兜底 */ }
    setPrintData({ ticket, req: full })
  }

  // PID 图定位：点位数据就绪后再打开弹窗（PidLocateDialog 的 initialIndex 在 open 翻转时读取，
  // 先开窗后加载数据会导致按行定位失效），支持按索引定位到指定隔离点；unitId 用于多图命中时本装置图优先
  const [pidCtx, setPidCtx] = useState<{ points: LocatePoint[]; index: number; unitId: number | null } | null>(null)
  const [pidLoadingId, setPidLoadingId] = useState<number | null>(null)
  /** 按需求定位（票卡入口：异步拉需求详情 → 隔离方案点位） */
  const openPid = async (req: WorkRequestRow, index = 0) => {
    setPidLoadingId(req.id)
    try {
      const full = await apiGet<WorkRequestRow & { isolationScheme?: { points?: { id: number; seq: number; masterCode?: string | null; code?: string | null; name?: string | null; masterPointId?: number | null; location?: string | null }[] } | null }>(`/api/work-requests/${req.id}`)
      const pts = toLocatePoints(full.isolationScheme?.points ?? [])
      if (pts.length === 0) {
        toast({ title: '暂无可定位的隔离点', description: '该需求尚未编制隔离方案点位，请先完成方案编制' })
        return
      }
      setPidCtx({ points: pts, index, unitId: full.unitId ?? full.unit?.id ?? null })
    } catch {
      toast({ variant: 'destructive', title: '加载失败', description: '获取隔离点数据失败，请稍后重试' })
    } finally {
      setPidLoadingId(null)
    }
  }
  /** 按已加载的点位列表定位（开票 Dialog / 执行详情 Sheet：无需再次请求，可指定索引与所属装置） */
  const openPointsPid = (points: PointRow[], index: number, unitId?: number | null) => {
    const pts = toLocatePoints(points)
    if (pts.length === 0) {
      toast({ title: '暂无可定位的隔离点', description: '该方案尚未编制隔离点' })
      return
    }
    setPidCtx({ points: pts, index: Math.max(0, Math.min(index, pts.length - 1)), unitId: unitId ?? null })
  }

  const ticketsByReq = useMemo(() => {
    const m = new Map<number, TicketRow[]>()
    for (const t of tickets) {
      const arr = m.get(t.workRequestId)
      if (arr) arr.push(t)
      else m.set(t.workRequestId, [t])
    }
    return m
  }, [tickets])
  const plateCodeMap = useMemo(() => new Map(allPlates.map((p) => [p.id, p] as const)), [allPlates])
  const guardians = useMemo(() => users.filter((u) => u.role === 'GUARDIAN'), [users])

  const loadTicketTab = async () => {
    setTicketLoading(true)
    try {
      const [reqs, tks] = await Promise.all([
        apiGet<WorkRequestRow[]>('/api/work-requests'),
        apiGet<TicketRow[]>('/api/work-tickets'),
      ])
      setRequests(reqs.filter((r) => TICKET_REQ_STATUSES.includes(r.status)))
      setTickets(tks)
    } catch (e) {
      toast({ variant: 'destructive', title: '加载失败', description: e instanceof Error ? e.message : '获取票证数据失败' })
    } finally { setTicketLoading(false) }
  }

  const loadTasks = async () => {
    setTaskLoading(true)
    try {
      setTasks(await apiGet<TaskRow[]>('/api/work-tasks'))
    } catch (e) {
      toast({ variant: 'destructive', title: '加载失败', description: e instanceof Error ? e.message : '获取作业任务失败' })
    } finally { setTaskLoading(false) }
  }

  useEffect(() => {
    void loadTicketTab()
    void loadTasks()
    apiGet<BpUser[]>('/api/users').then(setUsers).catch(() => setUsers([]))
  }, [])

  // 打开执行详情 Sheet：加载隔离方案 + 盲板编号映射 + 关联作业票（一票一板门禁判定）
  const openDetail = async (task: TaskRow) => {
    setDetail(task); setScheme(null); setSchemeLoading(true)
    try {
      const [s, plates, ts] = await Promise.all([
        apiGet<SchemeRow | null>(`/api/isolation-schemes?workRequestId=${task.workRequestId}`),
        apiGet<PlateRow[]>('/api/blind-plates'),
        apiGet<TicketRow[]>(`/api/work-tickets?workRequestId=${task.workRequestId}`).catch(() => [] as TicketRow[]),
      ])
      setScheme(s)
      setAllPlates(plates)
      setSheetTickets(ts)
    } catch (e) {
      toast({ variant: 'destructive', title: '加载失败', description: e instanceof Error ? e.message : '获取隔离方案失败' })
    } finally { setSchemeLoading(false) }
  }

  const reloadAfterExecute = async () => {
    if (detail) await openDetail(detail) // 重新加载方案（会重设 loading 态）
    void loadTasks()
  }

  // ============ 票证操作 ============
  const openCreateDialog = (req: WorkRequestRow) => {
    setForm({
      plannedStart: toLocalInput(req.plannedStart),
      plannedEnd: toLocalInput(req.plannedEnd),
      guardian: '', guardianId: '',
      workers: '',
      issuer: currentUser.name,
      safetyMeasures: DEFAULT_MEASURES,
    })
    setCreateFor(req)
    // 预载关联隔离方案点位：一票一板勾选办票点位 + 可直接定位 PID 图
    setCreateScheme(null)
    setCreatePointIds([])
    apiGet<SchemeRow | null>(`/api/isolation-schemes?workRequestId=${req.id}`)
      .then((s) => {
        setCreateScheme(s)
        setCreatePointIds(s?.points.map((p) => p.id) ?? [])
      })
      .catch(() => setCreateScheme(null))
  }

  const submitCreateTicket = async () => {
    if (!createFor) return
    if (!createPointIds.length) return toast({ variant: 'destructive', title: '请勾选要办票的隔离点位', description: '一票一板：每个选中点位分别开具一张作业票' })
    if (!form.plannedStart || !form.plannedEnd) return toast({ variant: 'destructive', title: '请填写计划作业开始/结束时间' })
    if (!form.guardian) return toast({ variant: 'destructive', title: '请选择监护人' })
    if (!form.workers.trim()) return toast({ variant: 'destructive', title: '请填写作业人员' })
    setSubmitting(true)
    try {
      // 一票一板：一次提交按点位批量开票（服务端直接签发进入待批准）
      const res = await apiPost<{ tickets: TicketRow[] }>('/api/work-tickets', {
        workRequestId: createFor.id,
        pointIds: createPointIds,
        plannedStart: form.plannedStart,
        plannedEnd: form.plannedEnd,
        guardian: form.guardian,
        workers: form.workers,
        issuer: form.issuer || currentUser.name,
        safetyMeasures: form.safetyMeasures,
      })
      toast({ title: `已开具 ${res.tickets.length} 张作业票（一票一板）`, description: `${res.tickets.map((t) => t.code).join('、')}，等待逐张批准` })
      setCreateFor(null)
      void loadTicketTab()
      void loadTasks()
    } catch (e) {
      toast({ variant: 'destructive', title: '开作业票失败', description: e instanceof Error ? e.message : '请稍后重试' })
    } finally { setSubmitting(false) }
  }

  const submitIssue = async (req: WorkRequestRow, ticket: TicketRow) => {
    try {
      await apiPost(`/api/work-tickets/${ticket.id}/issue`, { issuer: ticket.issuer })
      toast({ title: '作业票已重新签发', description: `${ticket.code} 已提交批准` })
      void loadTicketTab()
    } catch (e) {
      toast({ variant: 'destructive', title: '签发失败', description: e instanceof Error ? e.message : '请稍后重试' })
    }
  }

  const submitReview = async (approve: boolean) => {
    if (!reviewFor) return
    if (!approve && !reviewComment.trim()) return toast({ variant: 'destructive', title: '驳回时请填写审批意见' })
    setSubmitting(true)
    try {
      await apiPost(`/api/work-tickets/${reviewFor.ticket.id}/review`, {
        approve, comment: reviewComment, reviewer: currentUser.name,
      })
      toast({ title: approve ? '作业票已批准' : '作业票已驳回', description: `${reviewFor.ticket.code}${approve ? '，可开始作业' : '，需求回退至待开票'}` })
      setReviewFor(null); setReviewComment('')
      void loadTicketTab()
      void loadTasks()
    } catch (e) {
      toast({ variant: 'destructive', title: '审批失败', description: e instanceof Error ? e.message : '请稍后重试' })
    } finally { setSubmitting(false) }
  }

  const runTicketAction = (req: WorkRequestRow, ticket: TicketRow, action: Exclude<TicketAction, null>) => {
    if (action === 'issue') { void submitIssue(req, ticket); return }
    if (action === 'review') { setReviewComment(ticket.comment ?? ''); setReviewFor({ req, ticket }); return }
    const map: Record<string, { title: string; desc: string; run: () => Promise<void>; ok: string }> = {
      start: {
        title: '确认开始作业？', desc: `作业票 ${ticket.code} 将进入作业中状态，任务同步开始执行`,
        ok: '作业已开始',
        run: async () => { await apiPost(`/api/work-tickets/${ticket.id}/start`, { __actorId: currentUser.id, __actorName: currentUser.name }) },
      },
      finish: {
        title: '确认作业完工？', desc: `作业票 ${ticket.code} 将标记为已完工，等待作业验收`,
        ok: '作业已完工，等待验收',
        run: async () => { await apiPost(`/api/work-tickets/${ticket.id}/finish`, { __actorId: currentUser.id, __actorName: currentUser.name }) },
      },
      close: {
        title: '确认关闭作业票？', desc: `作业票 ${ticket.code} 将归档关闭，需求流程完结`,
        ok: '作业票已关闭',
        run: async () => { await apiPost(`/api/work-tickets/${ticket.id}/close`, { __actorId: currentUser.id, __actorName: currentUser.name }) },
      },
    }
    const conf = map[action]
    if (conf) {
      setConfirm({ title: conf.title, desc: conf.desc, run: async () => { await conf.run(); toast({ title: conf.ok, description: ticket.code }); void loadTicketTab(); void loadTasks() } })
    }
  }

  // ============ 隔离点操作 ============
  const openReserve = async (point: PointRow) => {
    setReservePoint(point); setReservePlateId(''); setStockPlates(null)
    try {
      const list = await apiGet<PlateRow[]>(`/api/blind-plates?status=IN_STOCK&spec=${encodeURIComponent(point.blindSpec)}`)
      setStockPlates(list)
    } catch (e) {
      toast({ variant: 'destructive', title: '获取在库盲板失败', description: e instanceof Error ? e.message : '请稍后重试' })
      setStockPlates([])
    }
  }

  const submitReserve = async () => {
    if (!reservePoint) return
    if (!reservePlateId) return toast({ variant: 'destructive', title: '请选择要预留的盲板' })
    setSubmitting(true)
    try {
      await apiPost(`/api/isolation-points/${reservePoint.id}/reserve`, {
        blindPlateId: Number(reservePlateId),
        operator: currentUser.name,
      })
      toast({ title: '盲板预留成功', description: `隔离点${reservePoint.seq}（${reservePoint.location}）已绑定盲板` })
      setReservePoint(null)
      await reloadAfterExecute()
    } catch (e) {
      toast({ variant: 'destructive', title: '预留失败', description: e instanceof Error ? e.message : '请稍后重试' })
    } finally { setSubmitting(false) }
  }

  const submitExecute = async () => {
    if (!execPoint) return
    if (!execOperator.trim()) return toast({ variant: 'destructive', title: '请填写操作人' })
    setSubmitting(true)
    try {
      await apiPost(`/api/isolation-points/${execPoint.id}/execute`, { operator: execOperator })
      toast({ title: '执行确认成功', description: `隔离点${execPoint.seq}（${execPoint.location}）已完成` })
      setExecPoint(null)
      await reloadAfterExecute()
    } catch (e) {
      toast({ variant: 'destructive', title: '执行确认失败', description: e instanceof Error ? e.message : '请稍后重试' })
    } finally { setSubmitting(false) }
  }

  // ============ 渲染 ============
  const statusStats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of requests) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
    return TICKET_REQ_STATUSES.map((s) => ({ status: s, count: counts.get(s) ?? 0 })).filter((i) => i.count > 0)
  }, [requests])

  /** 逐票紧凑操作按钮（一票一板：每票独立 审批/开工/完工/关闭） */
  const renderTicketAction = (req: WorkRequestRow, ticket: TicketRow) => {
    const action = resolveAction(req, ticket)
    if (!action || action === 'create') return null
    switch (action) {
      case 'issue':
        return (
          <Button size="sm" variant="outline" className="h-6.5 border-emerald-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50"
            onClick={() => runTicketAction(req, ticket, 'issue')}>
            <FileCheck2 className="w-3 h-3" />重新签发
          </Button>
        )
      case 'review':
        return REVIEW_ROLES.includes(currentUser.role) ? (
          <Button size="sm" className="h-6.5 bg-violet-600 px-2 text-[11px] hover:bg-violet-700 text-white"
            onClick={() => runTicketAction(req, ticket, 'review')}>
            <Gavel className="w-3 h-3" />审批
          </Button>
        ) : (
          <Badge variant="outline" className="text-[10px] border-stone-200 text-stone-400">待批准（需审批权限）</Badge>
        )
      case 'start':
        return (
          <Button size="sm" className="h-6.5 bg-teal-600 px-2 text-[11px] hover:bg-teal-700 text-white"
            onClick={() => runTicketAction(req, ticket, 'start')}>
            <PlayCircle className="w-3 h-3" />开工
          </Button>
        )
      case 'finish':
        return (
          <Button size="sm" className="h-6.5 bg-amber-600 px-2 text-[11px] hover:bg-amber-700 text-white"
            onClick={() => runTicketAction(req, ticket, 'finish')}>
            <FlagTriangleRight className="w-3 h-3" />完工
          </Button>
        )
      case 'close':
        return (
          <Button size="sm" variant="outline" className="h-6.5 border-stone-300 px-2 text-[11px] text-stone-600 hover:bg-stone-50"
            onClick={() => runTicketAction(req, ticket, 'close')}>
            <LockKeyholeOpen className="w-3 h-3" />关闭
          </Button>
        )
    }
  }

  return (
    <div className="space-y-4">
      {/* 页签切换（singleTab 模式下隐藏页签，仅由独立菜单进入） */}
      <div className="flex flex-wrap items-center gap-3">
        {!singleTab && (
        <div className="flex gap-1 rounded-xl bg-stone-200/70 p-1">
          {([['ticket', '开作业票（票证审批）', TicketCheck], ['track', '作业任务跟踪', Route]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn('flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
                tab === key ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700')}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>
        )}
        <button onClick={() => (tab === 'ticket' ? void loadTicketTab() : void loadTasks())}
          className="ml-auto flex items-center gap-1 text-xs text-stone-500 hover:text-emerald-700">
          <RefreshCw className="w-3.5 h-3.5" />刷新
        </button>
      </div>

      {/* ============ 页签一：开作业票 ============ */}
      {tab === 'ticket' && (
        <div className="space-y-4">
          {statusStats.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {statusStats.map((s) => (
                <Badge key={s.status} variant="outline" className={cn('text-xs', STATUS_MAP[s.status]?.className)}>
                  {STATUS_MAP[s.status]?.label ?? s.status} · {s.count}
                </Badge>
              ))}
            </div>
          )}

          {ticketLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}</div>
          ) : requests.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-14 text-stone-400">
                <Inbox className="w-10 h-10 mb-3 text-stone-300" />
                <span className="text-sm">暂无处于开票/执行阶段的需求（需先完成工艺处置确认）</span>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {requests.map((req) => {
                const reqTickets = ticketsByReq.get(req.id) ?? []
                const activeCount = reqTickets.filter((t) => t.status !== 'VOID' && t.status !== 'CLOSED').length
                const canCreate = ['CONFIRMED', 'TICKET_ISSUED', 'TICKET_APPROVED', 'IN_PROGRESS'].includes(req.status)
                const hasAction = reqTickets.some((t) => { const a = resolveAction(req, t); return a && a !== 'create' })
                return (
                  <div key={req.id} className="rounded-xl bg-white border border-stone-200 shadow-sm p-4 flex flex-col gap-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-stone-800">{req.code}</span>
                      <Badge variant="outline" className={cn('text-[11px]', STATUS_MAP[req.status]?.className)}>
                        {STATUS_MAP[req.status]?.label ?? req.status}
                      </Badge>
                      <Badge variant="outline" className={cn('text-[11px]', URGENCY_MAP[req.urgency]?.className)}>
                        {URGENCY_MAP[req.urgency]?.label ?? req.urgency}
                      </Badge>
                      {hasAction && <span className="ml-auto text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">可操作</span>}
                    </div>
                    <div className="text-sm font-medium text-stone-800 line-clamp-1">{req.title}</div>
                    <div className="text-xs text-stone-500">
                      {req.unit?.name ?? '-'} · {req.location}
                    </div>
                    <div className="rounded-lg bg-stone-50 border border-stone-100 px-3 py-2 space-y-2 text-xs text-stone-600">
                      {reqTickets.length > 0 ? (
                        <>
                          <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
                            <TicketCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            一票一板 · 共 {reqTickets.length} 张{activeCount < reqTickets.length ? `（生效 ${activeCount}）` : ''}
                          </div>
                          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
                            {reqTickets.map((ticket) => {
                              const act = resolveAction(req, ticket)
                              return (
                                <div key={ticket.id} className="rounded-lg border border-stone-200 bg-white px-2.5 py-2 space-y-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-mono text-[11px] font-semibold text-stone-700">{ticket.code}</span>
                                    <Badge variant="outline" className={cn('text-[10px] h-4.5 px-1.5', TICKET_STATUS_MAP[ticket.status]?.className)}>
                                      {TICKET_STATUS_MAP[ticket.status]?.label ?? ticket.status}
                                    </Badge>
                                    {ticket.pointCode && <span className="rounded border border-teal-300 bg-teal-50 px-1 py-0.5 text-[10px] font-mono text-teal-700" title={ticket.pointLocation ?? ''}>{ticket.pointCode}</span>}
                                    {ticket.action && <span className="text-[10px] text-stone-400">{ticket.action === 'ADD' ? '装盲板' : '拆盲板'}{ticket.blindSpec ? ` · ${ticket.blindSpec}` : ''}</span>}
                                    <button onClick={() => void openPrint(req, ticket)}
                                      title="打印作业票（A4）"
                                      className="ml-auto inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-stone-400 hover:text-emerald-700 hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition-colors">
                                      <Printer className="w-3 h-3" />打印
                                    </button>
                                    <button onClick={() => setTicketDetailOpen((m) => ({ ...m, [ticket.id]: !m[ticket.id] }))}
                                      aria-expanded={!!ticketDetailOpen[ticket.id]}
                                      title="查看票面明细（安全措施+验资材料照片）"
                                      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-teal-700 hover:bg-teal-50 border border-transparent hover:border-teal-200 transition-colors">
                                      <ChevronDown className={cn('w-3 h-3 transition-transform', ticketDetailOpen[ticket.id] && 'rotate-180')} />明细
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-stone-500">
                                    {ticket.pointLocation && <span className="min-w-0 truncate max-w-full" title={ticket.pointLocation}>{ticket.pointLocation}</span>}
                                    <span>监护 {ticket.guardian}</span>
                                    <span>计划 {fmtDate(ticket.plannedStart)} ~ {fmtDate(ticket.plannedEnd)}</span>
                                    {ticket.startedAt && <span>开工 {fmtDate(ticket.startedAt)}</span>}
                                    {ticket.finishedAt && <span>完工 {fmtDate(ticket.finishedAt)}</span>}
                                  </div>
                                  {/* 票面明细（Task 111）：安全措施 + 逐人验资材料照片墙（与审批中心同款 CrewWall，缩略图点击新窗看原图） */}
                                  {ticketDetailOpen[ticket.id] && (
                                    <div className="space-y-2 rounded-md border border-stone-100 bg-stone-50/60 px-2 py-1.5">
                                      <div className="space-y-0.5">
                                        <p className="text-[10px] font-medium text-stone-500">安全措施</p>
                                        <p className="whitespace-pre-line text-[10px] leading-relaxed text-stone-600">{ticket.safetyMeasures || '未填写'}</p>
                                      </div>
                                      <div className="space-y-0.5">
                                        <p className="flex items-center gap-1 text-[10px] font-medium text-stone-500"><ShieldCheck className="h-3 w-3 text-teal-600" />作业人员验资材料（照片点击查看原图）</p>
                                        <CrewWall workerCerts={ticket.workerCerts} workers={ticket.workers} compact />
                                      </div>
                                    </div>
                                  )}
                                  <div className="flex items-center justify-end gap-1.5">
                                    {ticket.comment && <span className="mr-auto min-w-0 truncate text-[10px] text-stone-400" title={ticket.comment}>意见：{ticket.comment}</span>}
                                    {renderTicketAction(req, ticket)}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </>
                      ) : (
                        <div className="text-stone-400 flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" />尚未开立作业票{req.status === 'CONFIRMED' ? '（工艺处置已确认，可按一票一板开票）' : ''}</div>
                      )}
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <button onClick={() => void openPid(req)}
                        disabled={pidLoadingId === req.id}
                        title="在 PID 图中定位本需求隔离点位（以隔离点为中心放大）"
                        className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-100 transition-colors disabled:opacity-60">
                        {pidLoadingId === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                        PID 图定位
                      </button>
                      {canCreate && (
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white h-8" onClick={() => openCreateDialog(req)}>
                          <ClipboardPlus className="w-4 h-4" />{reqTickets.length ? '补开作业票' : '开作业票（一票一板）'}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ============ 页签二：作业任务跟踪 ============ */}
      {tab === 'track' && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base">作业任务列表</CardTitle>
                <p className="text-xs text-stone-400">开票自动生成执行任务，隔离点作为任务明细逐项确认</p>
              </div>
              <Button size="sm" variant="outline" disabled={tasks.length === 0}
                onClick={() => exportCsv('作业任务',
                  ['任务编号', '需求编号', '需求标题', '装置', '负责人', '计划开始', '计划结束', '进度(已完成/总数)', '状态', '实际开始', '实际结束'],
                  tasks.map((t) => [t.code, t.workRequest?.code ?? '', t.workRequest?.title ?? '', t.workRequest?.unit?.name ?? '',
                    t.assignee, fmtDate(t.planStart), fmtDate(t.planEnd), `${t.pointsDone ?? 0}/${t.pointsTotal ?? 0}`,
                    TASK_STATUS_MAP[t.status]?.label ?? t.status, t.actualStart ? fmtDateTime(t.actualStart) : '', t.actualEnd ? fmtDateTime(t.actualEnd) : '']))}>
                <Download className="w-4 h-4 mr-1" />导出
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {taskLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-stone-400">
                <Inbox className="w-10 h-10 mb-3 text-stone-300" />
                <span className="text-sm">暂无作业任务，请先开立作业票</span>
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto rounded-lg border border-stone-200">
                <Table>
                  <TableHeader className="sticky top-0 bg-stone-50 z-10">
                    <TableRow className="hover:bg-stone-50">
                      <TableHead className="w-[130px]">任务编号</TableHead>
                      <TableHead>需求标题</TableHead>
                      <TableHead className="w-[90px]">负责人</TableHead>
                      <TableHead className="w-[170px]">计划时间</TableHead>
                      <TableHead className="w-[150px]">进度</TableHead>
                      <TableHead className="w-[80px]">状态</TableHead>
                      <TableHead className="w-[100px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs font-semibold text-stone-700">{t.code}</TableCell>
                        <TableCell>
                          <div className="text-sm text-stone-800 line-clamp-1 max-w-[260px]">{t.workRequest?.title ?? '-'}</div>
                          <div className="text-xs text-stone-400">{t.workRequest?.code ?? ''}{t.workRequest?.unit ? ` · ${t.workRequest.unit.name}` : ''}</div>
                        </TableCell>
                        <TableCell className="text-sm text-stone-600">{t.assignee}</TableCell>
                        <TableCell className="text-xs text-stone-500">
                          {fmtDate(t.planStart)} ~ {fmtDate(t.planEnd)}
                        </TableCell>
                        <TableCell>
                          {(t.pointsTotal ?? 0) > 0
                            ? <ProgressBar done={t.pointsDone ?? 0} total={t.pointsTotal ?? 0} />
                            : <span className="text-xs text-stone-300">-</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-[11px]', TASK_STATUS_MAP[t.status]?.className)}>
                            {TASK_STATUS_MAP[t.status]?.label ?? t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" className="h-7 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => void openDetail(t)}>
                            执行详情<ChevronRight className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ============ 开作业票 Dialog（一票一板：按点位勾选批量开票） ============ */}
      <Dialog open={!!createFor} onOpenChange={(o) => { if (!o) { setCreateFor(null); setCreateScheme(null) } }}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>开作业票（一票一板） · {createFor?.code}</DialogTitle>
            <DialogDescription>{createFor?.title}（{createFor?.unit?.name} · {createFor?.location}）；每个选中点位分别开具一张作业票并直接提交审批</DialogDescription>
          </DialogHeader>
          {/* 一票一板：隔离点位勾选（每个选中点位一张票）+ PID 定位入口 */}
          <div className="rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Layers className="w-4 h-4 text-teal-700 shrink-0" />
              <span className="text-xs font-semibold text-teal-800">
                选择办票点位{createScheme ? `（已选 ${createPointIds.length}/${createScheme.points.length} → 开 ${createPointIds.length} 张票）` : '…'}
              </span>
              <span className="ml-auto flex gap-1.5">
                {createScheme && createScheme.points.length > 0 && (
                  <>
                    <button type="button" className="text-[10px] text-teal-600 hover:text-teal-800 hover:underline"
                      onClick={() => setCreatePointIds(createScheme.points.map((p) => p.id))}>全选</button>
                    <button type="button" className="text-[10px] text-stone-400 hover:text-stone-600 hover:underline"
                      onClick={() => setCreatePointIds([])}>清空</button>
                  </>
                )}
                {createScheme && createScheme.points.length > 0 && (
                  <Button size="sm" className="h-6 bg-teal-600 hover:bg-teal-700 text-white gap-1 px-2 text-[10px]"
                    onClick={() => openPointsPid(createScheme.points, 0, createFor?.unitId ?? null)}>
                    <MapPin className="w-3 h-3" />PID 图
                  </Button>
                )}
              </span>
            </div>
            {createScheme && createScheme.points.length > 0 && (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {createScheme.points.map((p, i) => {
                  const checked = createPointIds.includes(p.id)
                  return (
                    <label key={p.id} className={cn('flex items-center gap-2 rounded border px-2 py-1.5 text-[11px] cursor-pointer transition-colors', checked ? 'border-teal-400 bg-white' : 'border-transparent bg-white/60 hover:bg-white')}>
                      <Checkbox checked={checked} onCheckedChange={() => setCreatePointIds((ids) => ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id])} />
                      <span className="font-mono text-teal-700">{p.masterCode || p.code || `点位${p.seq}`}</span>
                      <span className="min-w-0 flex-1 truncate text-stone-600" title={p.location}>{p.location}</span>
                      <span className="text-stone-400">{p.blindSpec} · {p.action === 'ADD' ? '装' : '拆'}</span>
                      <button type="button" onClick={(e) => { e.preventDefault(); openPointsPid(createScheme.points, i, createFor?.unitId ?? null) }}
                        title={`在 PID 图中定位 ${p.masterCode || p.code || `点位${p.seq}`}`}
                        className="shrink-0 rounded px-1 py-0.5 text-[10px] text-teal-600 hover:bg-teal-100">
                        <MapPin className="w-3 h-3" />
                      </button>
                    </label>
                  )
                })}
              </div>
            )}
            {createScheme && createScheme.points.length === 0 && (
              <p className="text-[11px] text-amber-700">该需求关联的隔离方案尚未编制隔离点——一票一板模式下无法开票，请先编制隔离方案</p>
            )}
          </div>
          <div className="grid gap-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">计划开始时间 *</Label>
                <Input type="datetime-local" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">计划结束时间 *</Label>
                <Input type="datetime-local" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">监护人 *（GUARDIAN 角色）</Label>
              <Select value={form.guardianId} onValueChange={(v) => {
                const u = guardians.find((g) => g.id === v)
                setForm({ ...form, guardianId: v, guardian: u?.name ?? '' })
              }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="选择监护人" /></SelectTrigger>
                <SelectContent>
                  {guardians.length === 0 && <div className="px-3 py-2 text-xs text-stone-400">暂无监护人账号，请先在系统管理中添加</div>}
                  {guardians.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}（{g.department ?? '监护人'}）</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">作业人员 *（多人用逗号分隔）</Label>
              <Input value={form.workers} onChange={(e) => setForm({ ...form, workers: e.target.value })} placeholder="如：操作工乙,操作工丙" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">签发人</Label>
              <Input value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">安全措施（已预填 5 条，可修改）</Label>
              <Textarea rows={6} value={form.safetyMeasures} onChange={(e) => setForm({ ...form, safetyMeasures: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFor(null)}>取消</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={submitting || !createPointIds.length}
              title={!createPointIds.length ? '请先勾选要办票的隔离点位（一票一板：每点一张）' : undefined}
              onClick={() => void submitCreateTicket()}>
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />提交中…</> : `开具 ${createPointIds.length} 张票并签发`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ 票审批 Dialog ============ */}
      <Dialog open={!!reviewFor} onOpenChange={(o) => !o && setReviewFor(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>作业票审批 · {reviewFor?.ticket.code}</DialogTitle>
            <DialogDescription>
              {reviewFor?.req.code} {reviewFor?.req.title}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-stone-50 border border-stone-100 px-3 py-2 text-xs text-stone-600 space-y-1.5">
            <div>监护人 {reviewFor?.ticket.guardian} · 作业人 {reviewFor?.ticket.workers}</div>
            <div className="text-stone-400 whitespace-pre-line line-clamp-4">安全措施：{reviewFor?.ticket.safetyMeasures}</div>
            {/* Task 111：审批弹窗同步展示逐人验资材料照片墙（与审批中心同款） */}
            {reviewFor && (
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-[10px] font-medium text-stone-500"><ShieldCheck className="h-3 w-3 text-teal-600" />作业人员验资材料（照片点击查看原图）</p>
                <CrewWall workerCerts={reviewFor.ticket.workerCerts} workers={reviewFor.ticket.workers} compact />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">审批意见（驳回必填）</Label>
            <Textarea rows={3} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="请填写审批意见" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-50" disabled={submitting} onClick={() => void submitReview(false)}>
              驳 回
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={submitting} onClick={() => void submitReview(true)}>
              同意批准
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ 通用确认 AlertDialog ============ */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={confirmBusy}
              onClick={async (e) => {
                e.preventDefault()
                if (!confirm || confirmBusy) return
                setConfirmBusy(true)
                try { await confirm.run(); setConfirm(null) }
                catch (err) {
                  toast({ variant: 'destructive', title: '操作失败', description: err instanceof Error ? err.message : '请稍后重试' })
                } finally { setConfirmBusy(false) }
              }}>
              {confirmBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : '确 认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ============ 执行详情 Sheet ============ */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              执行详情 · <span className="font-mono">{detail?.code}</span>
              <Badge variant="outline" className={cn('text-[11px]', detail ? TASK_STATUS_MAP[detail.status]?.className : '')}>
                {detail ? TASK_STATUS_MAP[detail.status]?.label : ''}
              </Badge>
            </SheetTitle>
            <SheetDescription>{detail?.workRequest?.title}（{detail?.workRequest?.unit?.name}）</SheetDescription>
          </SheetHeader>

          {schemeLoading ? (
            <div className="space-y-3 px-4 pb-6">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : !scheme ? (
            <div className="px-4 py-10 text-center text-sm text-stone-400">该需求暂无隔离方案，无法展示隔离点明细</div>
          ) : (
            <div className="px-4 pb-8 space-y-4">
              {/* 任务/票摘要 */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-stone-200 p-3.5 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-stone-700 mb-1"><User2 className="w-4 h-4 text-emerald-600" />任务信息</div>
                  <div className="text-stone-500">负责人：{detail?.assignee}</div>
                  <div className="flex items-center gap-1.5 text-stone-500"><CalendarClock className="w-3.5 h-3.5" />{fmtDate(detail?.planStart)} ~ {fmtDate(detail?.planEnd)}</div>
                  {(detail?.actualStart) && <div className="text-stone-500">实际开始：{fmtDateTime(detail.actualStart)}</div>}
                  {(detail?.actualEnd) && <div className="text-stone-500">实际结束：{fmtDateTime(detail.actualEnd)}</div>}
                  <div className="pt-2">
                    <div className="text-stone-400 mb-1">隔离点执行进度</div>
                    <ProgressBar done={scheme.points.filter((p) => p.done).length} total={scheme.points.length} />
                  </div>
                </div>
                <div className="rounded-xl border border-stone-200 p-3.5 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-stone-700 mb-1">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />关联作业票 {detail?.ticket?.code}
                    {detail?.ticket && (
                      <Badge variant="outline" className={cn('text-[10px] h-5', TICKET_STATUS_MAP[detail.ticket.status]?.className)}>
                        {TICKET_STATUS_MAP[detail.ticket.status]?.label}
                      </Badge>
                    )}
                  </div>
                  <div className="text-stone-500">监护人：{detail?.ticket?.guardian ?? '-'}</div>
                  <div className="text-stone-500">作业人：{detail?.ticket?.workers ?? '-'}</div>
                  <div className="text-stone-500">签发人：{detail?.ticket?.issuer ?? '-'}</div>
                  <div className="text-stone-400 whitespace-pre-line line-clamp-3 border-t border-stone-100 pt-1.5 mt-1.5 leading-relaxed">
                    {detail?.ticket?.safetyMeasures ?? '无安全措施记录'}
                  </div>
                  {detail?.ticket && detail.workRequest && (
                    <Button size="sm" variant="outline"
                      className="h-7 w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 gap-1.5"
                      onClick={() => void openPrint(detail.workRequest!, detail.ticket!)}>
                      <Printer className="w-3.5 h-3.5" />打印作业票（A4）
                    </Button>
                  )}
                </div>
              </div>

              {/* 隔离点明细表 */}
              <div className="rounded-xl border border-stone-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-50 border-b border-stone-200">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-semibold text-stone-700">隔离点明细</span>
                  <span className="text-xs text-stone-400">方案编号 {scheme.code} · {STATUS_MAP[detail?.workRequest?.status ?? '']?.label}</span>
                  <button onClick={() => openPointsPid(scheme.points, 0, detail?.workRequest?.unitId ?? null)}
                    title="以隔离点为中心放大查看 PID 组态图"
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-teal-200 bg-white px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-50 transition-colors">
                    <MapPin className="w-3 h-3" />PID 图定位
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-white">
                        <TableHead className="w-12">序号</TableHead>
                        <TableHead className="min-w-[140px]">位置</TableHead>
                        <TableHead>介质</TableHead>
                        <TableHead>规格</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead>动作</TableHead>
                        <TableHead>预留盲板</TableHead>
                        <TableHead>执行状态</TableHead>
                        <TableHead className="w-14 text-center">PID</TableHead>
                        <TableHead className="text-right min-w-[150px]">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scheme.points.length === 0 && (
                        <TableRow><TableCell colSpan={10} className="text-center text-xs text-stone-400 py-8">该方案尚未编制隔离点</TableCell></TableRow>
                      )}
                      {scheme.points.map((p, i) => {
                        const plate = p.blindPlateId != null ? plateCodeMap.get(p.blindPlateId) : undefined
                        const canReserve = !p.done && p.action === 'ADD' && !p.blindPlateId
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs font-bold text-stone-500">{p.seq}</TableCell>
                            <TableCell className="text-xs text-stone-800">{p.location}</TableCell>
                            <TableCell className="text-xs text-stone-500">{p.medium ?? '-'}</TableCell>
                            <TableCell className="text-xs font-mono text-stone-600">{p.blindSpec}</TableCell>
                            <TableCell className="text-xs text-stone-600">{p.blindType}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn('text-[10px] h-5',
                                p.action === 'ADD' ? 'border-violet-200 text-violet-700 bg-violet-50' : 'border-teal-200 text-teal-700 bg-teal-50')}>
                                {POINT_ACTION_MAP[p.action] ?? p.action}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-stone-600">
                              {plate ? plate.code : <span className="text-stone-300">未预留</span>}
                            </TableCell>
                            <TableCell>
                              {p.done ? (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                                  <CircleCheck className="w-4 h-4 text-emerald-500" />已完成
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                  <CircleDashed className="w-4 h-4" />待执行
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <button onClick={() => openPointsPid(scheme.points, i, detail?.workRequest?.unitId ?? null)}
                                title="在 PID 图中定位该隔离点（以隔离点为中心放大）"
                                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-teal-700 hover:bg-teal-50 border border-teal-200 transition-colors">
                                <MapPin className="w-3 h-3" />图
                              </button>
                            </TableCell>
                            <TableCell className="text-right">
                              {p.done ? (
                                <span className="text-[11px] text-stone-400">{p.operator ?? '-'} · {fmtDateTime(p.doneAt)}</span>
                              ) : FIELD_ROLES.includes(currentUser.role) ? (() => {
                                // 一票一板门禁：该点绑定票未批准/作业中时禁用执行（服务端同样校验）
                                const bound = sheetTickets.find((t) => t.pointId === p.id && t.status !== 'VOID')
                                const execBlocked = !!bound && !['APPROVED', 'IN_PROGRESS'].includes(bound.status)
                                return (
                                <div className="flex justify-end gap-1.5">
                                  {canReserve && (
                                    <Button size="sm" variant="outline" className="h-7 border-amber-300 text-amber-700 hover:bg-amber-50"
                                      onClick={() => void openReserve(p)}>
                                      预留盲板
                                    </Button>
                                  )}
                                  <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white"
                                    disabled={execBlocked}
                                    title={execBlocked ? `该点作业票 ${bound?.code} 当前为「${TICKET_STATUS_MAP[bound?.status ?? '']?.label ?? bound?.status ?? ''}」，批准后方可执行` : '确认现场已完成盲板作业'}
                                    onClick={() => { setExecPoint(p); setExecOperator(currentUser.name) }}>
                                    执行确认
                                  </Button>
                                </div>
                                )
                              })() : (
                                <Badge variant="outline" className="text-[10px] border-stone-200 text-stone-400">作业人员/监护人 可执行</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============ 预留盲板 Dialog ============ */}
      <Dialog open={!!reservePoint} onOpenChange={(o) => !o && setReservePoint(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>预留盲板 · 隔离点{reservePoint?.seq}</DialogTitle>
            <DialogDescription>{reservePoint?.location} · 规格 {reservePoint?.blindSpec} · {reservePoint?.blindType}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">选择在库盲板（规格 {reservePoint?.blindSpec} 匹配）</Label>
            {stockPlates === null ? (
              <div className="h-16 rounded-md border border-stone-200 flex items-center justify-center text-xs text-stone-400">
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />加载在库盲板中…
              </div>
            ) : stockPlates.length === 0 ? (
              <div className="h-16 rounded-md border border-amber-200 bg-amber-50 flex items-center justify-center text-xs text-amber-700 px-3 text-center">
                该规格暂无在库盲板，请先采购入库或联系库管员
              </div>
            ) : (
              <Select value={reservePlateId} onValueChange={setReservePlateId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="选择盲板编号" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {stockPlates.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.code}（{p.type} · {p.material} · {p.location ?? '盲板库'}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-stone-400 pt-1">预留后盲板将标记为「已预留」，操作人：{currentUser.name}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReservePoint(null)}>取消</Button>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white" disabled={submitting || stockPlates?.length === 0 || !reservePlateId}
              onClick={() => void submitReserve()}>
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />提交中…</> : '确认预留'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ 执行确认 AlertDialog ============ */}
      <AlertDialog open={!!execPoint} onOpenChange={(o) => !o && setExecPoint(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>执行确认 · 隔离点{execPoint?.seq}</AlertDialogTitle>
            <AlertDialogDescription>
              {execPoint?.location} · {POINT_ACTION_MAP[execPoint?.action ?? ''] ?? execPoint?.action} · 规格 {execPoint?.blindSpec}
              {execPoint && !execPoint.blindPlateId && execPoint.action === 'REMOVE' && '（注意：该点未绑定盲板实体，拆除作业将无法确认盲板去向）'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">操作人</Label>
            <Input value={execOperator} onChange={(e) => setExecOperator(e.target.value)} placeholder="请填写实际操作人" />
            {execPoint && scheme && scheme.points.some((p) => p.id === execPoint.id) && (
              <button onClick={() => openPointsPid(scheme.points, scheme.points.findIndex((p) => p.id === execPoint.id), detail?.workRequest?.unitId ?? null)}
                className="inline-flex items-center gap-1 pt-0.5 text-[11px] text-teal-700 hover:text-teal-900 hover:underline">
                <MapPin className="w-3 h-3" />在 PID 图中查看该点位位置（以隔离点为中心放大）
              </button>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={async (e) => {
                e.preventDefault()
                if (submitting) return
                await submitExecute()
              }}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : '确认执行'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ============ 作业票打印预览 ============ */}
      {printData && (
        <TicketPrint
          ticket={printData.ticket}
          workRequest={{
            id: printData.req.id,
            code: printData.req.code,
            title: printData.req.title,
            location: printData.req.location,
            pipelineName: null,
            medium: printData.req.medium ?? null,
            pressure: null,
            temperature: null,
            unitName: printData.req.unit?.name ?? null,
            applicantName: '',
          }}
          onClose={() => setPrintData(null)}
        />
      )}

      {/* PID 图定位查看（以本票隔离点位为中心放大，支持按行/按 chip 指定初始定位点） */}
      <PidLocateDialog
        open={pidCtx !== null}
        onClose={() => setPidCtx(null)}
        points={pidCtx?.points ?? []}
        initialIndex={pidCtx?.index ?? 0}
        preferUnitId={pidCtx?.unitId ?? null}
      />
    </div>
  )
}
