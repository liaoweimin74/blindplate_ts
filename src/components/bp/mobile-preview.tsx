'use client'
// 移动端模拟器：uniapp + uView2 移动端交互演示（任务/扫码/消息/我的四个 Tab 均对接真实 API，消息与桌面铃铛同源）
import { useEffect, useState, useRef } from 'react'
import { apiGet, apiPost, fmtDate, fmtDateTime } from '@/lib/bp-api'
import {
  ModuleProps, PLATE_STATUS_MAP, POINT_ACTION_MAP, ROLE_MAP, TASK_STATUS_MAP,
  FLOW_STEPS, flowStepIndex, CHANGE_ACTION_MAP,
} from '@/lib/bp-types'
import { NOTIFY_TYPE_META, timeAgo, type BpNotification } from './notification-bell'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ClipboardList, ScanLine, Bell, User, ChevronLeft, ChevronRight, ArrowLeft,
  Signal, Wifi, BatteryMedium, Loader2, CircleCheck, CircleDashed, Inbox, QrCode,
  MapPin, RefreshCw, LogOut, BellRing, Trash2, Info, Download, CloudOff, Smartphone, ScanSearch,
  Route, Ban, KeyRound, Megaphone, Building2, Phone, Eye, EyeOff, Check, X,
  AlertTriangle, BellOff, CheckCheck, MonitorSmartphone, History, FolderOpen,
} from 'lucide-react'

// ============ 类型 ============
interface UnitRow { id: number; name: string; code: string }
interface WorkRequestRow { id: number; code: string; title: string; unitId: number; location: string; status: string; unit?: UnitRow | null }
interface TaskRow {
  id: number; code: string; workRequestId: number; assignee: string
  planStart: string | null; planEnd: string | null; status: string
  workRequest?: WorkRequestRow | null; ticket?: { code: string } | null
  pointsTotal?: number; pointsDone?: number
}
interface PointRow {
  id: number; seq: number; location: string; medium: string | null; blindSpec: string; blindType: string
  action: string; blindPlateId: number | null; done: boolean; doneAt: string | null; operator: string | null
}
interface SchemeRow { id: number; code: string; status: string; points: PointRow[] }
interface PlateRow {
  id: number; code: string; spec: string; type: string; material: string
  thickness: number; pressureRating: string; status: string; location: string | null
  unitId: number | null
}
interface AnnouncementRow {
  id: number; title: string; content: string; createdAt: string; readAt?: string | null
}
interface ChangeRecordRow {
  id: number; blindCode: string; action: string; workCode: string | null
  location: string | null; fromStatus: string | null; toStatus: string | null
  operator: string; note: string | null; createdAt: string
}

/** 消息类型筛选 chips（值域与 notification-bell 的 NOTIFY_TYPE_META 一致） */
const MSG_FILTERS = [
  { key: 'ALL', label: '全部' },
  { key: 'APPROVAL', label: '审批' },
  { key: 'STATUS', label: '进度' },
  { key: 'ALERT', label: '预警' },
  { key: 'EXECUTE', label: '执行' },
  { key: 'SYSTEM', label: '系统' },
] as const
type MsgFilterKey = (typeof MSG_FILTERS)[number]['key']

/** linkModule → 桌面端模块中文名（移动端模拟器不跨模块跳转，仅提示去桌面端处理） */
const LINK_MODULE_LABEL: Record<string, string> = {
  dashboard: '首页看板',
  'approval-center': '审批中心',
  'work-requests': '作业需求',
  schemes: '方案编制',
  'task-mgmt': '作业任务管理',
  ledger: '台账管理',
  stats: '统计分析',
  'base-data': '基础数据管理',
  'system-mgmt': '系统管理',
}

type PhoneTab = 'tasks' | 'scan' | 'msg' | 'me'

/** 我的-修改密码表单 */
interface PwdForm { oldPassword: string; newPassword: string; confirmPassword: string }
const EMPTY_PWD: PwdForm = { oldPassword: '', newPassword: '', confirmPassword: '' }

/** 密码强度：0 弱 / 1 中 / 2 强（与桌面端 user-menu 口径一致） */
function pwdStrength(pwd: string): 0 | 1 | 2 {
  if (!pwd) return 0
  const hasLetter = /[a-zA-Z]/.test(pwd)
  const hasDigit = /\d/.test(pwd)
  const hasSymbol = /[^a-zA-Z0-9]/.test(pwd)
  const kinds = [hasLetter, hasDigit, hasSymbol].filter(Boolean).length
  if (pwd.length >= 10 && kinds >= 2) return 2
  if (pwd.length >= 6 && kinds >= 2) return 1
  return 0
}

const PWD_STRENGTH_META = [
  { label: '弱', bar: 'bg-rose-400', text: 'text-rose-500', width: 'w-1/3' },
  { label: '中', bar: 'bg-amber-400', text: 'text-amber-600', width: 'w-2/3' },
  { label: '强', bar: 'bg-emerald-500', text: 'text-emerald-600', width: 'w-full' },
] as const

const CELL_TONE: Record<string, string> = {
  emerald: 'bg-emerald-50 border-emerald-100 text-emerald-600',
  teal: 'bg-teal-50 border-teal-100 text-teal-600',
  amber: 'bg-amber-50 border-amber-100 text-amber-600',
}

// ============ 扫码识别（模拟扫码 → 解析编号 → 盲板档案卡） ============
/** 扫码动画时长：扫描线上下扫动 1.2s ×2 遍，期间并行请求台账，动画结束即出结果 */
const SCAN_ANIM_MS = 2400

/** 盲板状态 → 「在移动端任务中操作」提示文案（结果卡底部提示行，不真实跳转） */
const PLATE_SCAN_HINT: Record<string, string> = {
  IN_STOCK: '该盲板当前在库可预留。请进入「任务」Tab 选择任务，在隔离点明细中执行「预留盲板」',
  RESERVED: '该盲板已被作业任务预留。现场安装请进入「任务」Tab，在对应隔离点完成执行确认',
  INSTALLED: '该盲板已安装在线。抽堵/拆除作业请进入「任务」Tab，在对应隔离点执行反馈',
  SCRAPPED: '该盲板已报废封存，不可再用于现场作业操作',
}

/**
 * 解析扫码内容 → 盲板编号。
 * 项目暂无盲板实体二维码（仅作业票/方案防伪码），主路径为纯编号直读；
 * 同时兼容台账未来发放盲板二维码时与打印件一致的 BPMS| 前缀协议（BPMS|BLIND-PLATE|{code}）。
 */
function parseScanCode(raw: string): { code: string; unsupported?: string } {
  const text = raw.trim()
  if (!text) return { code: '' }
  if (text.toUpperCase().startsWith('BPMS|')) {
    const seg = text.split('|').map((s) => s.trim())
    if (seg.length >= 3 && seg[1].toUpperCase() === 'BLIND-PLATE') return { code: seg[2] }
    return { code: '', unsupported: '该二维码为作业票/方案防伪码，请扫描盲板本体二维码' }
  }
  return { code: text }
}

/** 「我的」页卡片式功能 Cell（行高 ≥48px 触控友好，右侧 chevron，hover/active 态） */
function MeCell({ icon: Icon, label, sub, tone = 'emerald', onClick }: {
  icon: React.ComponentType<{ className?: string }>; label: string; sub?: string
  tone?: keyof typeof CELL_TONE; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors">
      <span className={cn('w-8 h-8 rounded-lg border flex items-center justify-center shrink-0', CELL_TONE[tone])}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="text-sm font-medium text-stone-700">{label}</span>
      {sub && <span className="text-[11px] text-stone-400 truncate max-w-[130px] hidden sm:block">{sub}</span>}
      <ChevronRight className="w-4 h-4 text-stone-300 ml-auto shrink-0" />
    </button>
  )
}

function MobileProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-stone-200/80 overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-stone-500 tabular-nums">{done}/{total}</span>
    </div>
  )
}

// ============ 流程进度迷你时间线（任务详情屏·八环节缩略版） ============
function TaskFlowTimeline({ status }: { status: string }) {
  const cur = flowStepIndex(status)
  const cancelled = cur < 0
  const allDone = cur >= FLOW_STEPS.length
  return (
    <div className="bp-fade-up rounded-2xl bg-white p-3.5 shadow-sm border border-stone-200">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Route className="w-3.5 h-3.5 text-emerald-600" />
        <span className="text-xs font-medium text-stone-700">流程进度</span>
        {!cancelled && (
          <span className="ml-auto text-[10px] text-stone-400 tabular-nums">
            {Math.min(Math.max(cur, 0), FLOW_STEPS.length)}/{FLOW_STEPS.length} 环节
          </span>
        )}
      </div>
      {cancelled ? (
        <div className="rounded-lg bg-stone-100 border border-stone-200 px-3 py-2.5 flex items-center gap-1.5">
          <Ban className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          <span className="text-xs text-stone-500">流程已取消</span>
        </div>
      ) : (
        <div className="flex flex-col">
          {FLOW_STEPS.map((step, i) => {
            const done = i < cur
            const active = i === cur
            const last = i === FLOW_STEPS.length - 1
            return (
              <div key={step.key} className="flex gap-2.5">
                <div className="flex flex-col items-center shrink-0">
                  {active ? (
                    <span className="relative w-2 h-2">
                      <span className="absolute -inset-[5px] rounded-full bg-emerald-400/25 animate-pulse" />
                      <span className="w-2 h-2 rounded-full bg-white border-2 border-emerald-500" />
                    </span>
                  ) : (
                    <span className={cn('w-2 h-2 rounded-full', done ? 'bg-emerald-500' : 'bg-stone-200')} />
                  )}
                  {!last && (
                    <span className={cn('w-px flex-1 min-h-[12px]',
                      i + 1 < cur ? 'bg-emerald-400' : i + 1 === cur ? 'bg-gradient-to-b from-emerald-400 to-emerald-300' : 'bg-stone-200')} />
                  )}
                </div>
                <div className="flex-1 h-4 -mt-1 flex items-center justify-between">
                  <span className={cn('text-xs',
                    done ? 'text-stone-600' : active ? 'text-emerald-700 font-medium' : 'text-stone-400')}>
                    {step.label}
                  </span>
                  {active && (
                    <span className="text-[10px] leading-[14px] px-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0">进行中</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {allDone && (
        <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-1.5 flex items-center gap-1.5">
          <CircleCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="text-[11px] text-emerald-700 font-medium">作业流程已全部完成</span>
        </div>
      )}
    </div>
  )
}

interface MobilePreviewProps extends ModuleProps {
  /** 退出登录回调（app-shell 注入真实登出，未传时提示去桌面端操作） */
  onLogout?: () => void
}

export default function MobilePreviewModule({ currentUser, onLogout, onNavigate }: MobilePreviewProps) {
  const { toast } = useToast()
  const [tab, setTab] = useState<PhoneTab>('tasks')

  // 任务 Tab
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [openTask, setOpenTask] = useState<TaskRow | null>(null)
  const [scheme, setScheme] = useState<SchemeRow | null>(null)
  const [schemeLoading, setSchemeLoading] = useState(false)
  const [plateCodeMap, setPlateCodeMap] = useState<Map<number, string>>(new Map())

  // 预留盲板
  const [reservePoint, setReservePoint] = useState<PointRow | null>(null)
  const [stockPlates, setStockPlates] = useState<PlateRow[] | null>(null)
  const [reservePlateId, setReservePlateId] = useState('')
  const [busy, setBusy] = useState(false)

  // 执行确认
  const [execPoint, setExecPoint] = useState<PointRow | null>(null)
  const [execOperator, setExecOperator] = useState('')

  // 扫码 Tab（模拟扫码：输入面板/快捷选择 → 扫描线动画 → 盲板档案卡，历史存内存）
  const [scanInputOpen, setScanInputOpen] = useState(false)
  const [scanInput, setScanInput] = useState('')
  const [scanPhase, setScanPhase] = useState<'idle' | 'scanning' | 'found' | 'notfound'>('idle')
  const [scanPlate, setScanPlate] = useState<PlateRow | null>(null)
  const [scanUnitName, setScanUnitName] = useState<string | null>(null)
  const [scanRecords, setScanRecords] = useState<ChangeRecordRow[]>([])
  const [scanNotFoundCode, setScanNotFoundCode] = useState('')
  const [scanSuggestions, setScanSuggestions] = useState<string[]>([])
  const [scanNetError, setScanNetError] = useState('')
  const [scanHistory, setScanHistory] = useState<{ code: string; ok: boolean }[]>([])
  const [quickPlates, setQuickPlates] = useState<PlateRow[] | null>(null)
  const [quickLoading, setQuickLoading] = useState(false)
  const scanSeqRef = useRef(0)

  // 消息 Tab（与桌面铃铛同源：GET /api/notifications + POST /api/notifications/read）
  const [notices, setNotices] = useState<BpNotification[]>([])
  const [noticeUnread, setNoticeUnread] = useState(0)
  const [noticesLoading, setNoticesLoading] = useState(true)
  const [noticesError, setNoticesError] = useState('')
  const [msgFilter, setMsgFilter] = useState<MsgFilterKey>('ALL')
  const [markingAll, setMarkingAll] = useState(false)
  const [linkHintId, setLinkHintId] = useState<number | null>(null)

  // 我的 Tab（个人中心：首页/系统公告子视图 + 修改密码弹层 + 退出确认）
  const [meView, setMeView] = useState<'home' | 'announcements'>('home')
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([])
  const [annLoading, setAnnLoading] = useState(false)
  const [expandedAnn, setExpandedAnn] = useState<number | null>(null)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwdForm, setPwdForm] = useState<PwdForm>(EMPTY_PWD)
  const [pwdShow, setPwdShow] = useState({ old: false, next: false, confirm: false })
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdError, setPwdError] = useState('')
  const [logoutOpen, setLogoutOpen] = useState(false)

  const loadTasks = async () => {
    setTasksLoading(true)
    try {
      setTasks(await apiGet<TaskRow[]>('/api/work-tasks'))
    } catch (e) {
      toast({ variant: 'destructive', title: '加载失败', description: e instanceof Error ? e.message : '获取任务失败' })
    } finally { setTasksLoading(false) }
  }

  // ============ 消息：真实通知中心（与桌面铃铛同源） ============
  const loadNotices = async (showLoading = true) => {
    if (showLoading) setNoticesLoading(true)
    try {
      const res = await apiGet<{ notifications: BpNotification[]; unread: number }>(
        `/api/notifications?userId=${encodeURIComponent(currentUser.id)}&role=${encodeURIComponent(currentUser.role)}&limit=50`
      )
      setNotices(res.notifications ?? [])
      setNoticeUnread(res.unread ?? 0)
      setNoticesError('')
    } catch (e) {
      setNoticesError(e instanceof Error ? e.message : '获取通知失败')
    } finally { if (showLoading) setNoticesLoading(false) }
  }

  /** 点击通知卡：标记已读 + 带 linkModule 时展示「可在桌面端处理」提示行 */
  const openNotice = async (n: BpNotification) => {
    setLinkHintId(n.linkModule ? n.id : null)
    if (n.readAt) return
    try {
      // 携带 userId/role 使 API scope 覆盖「精确推送 + 角色广播 + 全员广播」（与桌面铃铛口径一致）
      await apiPost('/api/notifications/read', { ids: [n.id], userId: currentUser.id, role: currentUser.role })
      const now = new Date().toISOString()
      setNotices((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: now } : x)))
      setNoticeUnread((u) => Math.max(0, u - 1))
    } catch (e) {
      toast({ variant: 'destructive', title: '标记已读失败', description: e instanceof Error ? e.message : '请稍后重试' })
    }
  }

  const markAllNoticesRead = async () => {
    if (markingAll || noticeUnread === 0) return
    setMarkingAll(true)
    try {
      await apiPost('/api/notifications/read', { all: true, userId: currentUser.id, role: currentUser.role })
      const now = new Date().toISOString()
      setNotices((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })))
      setNoticeUnread(0)
      toast({ title: '已全部标为已读', description: '移动端与桌面端通知状态已同步' })
    } catch (e) {
      toast({ variant: 'destructive', title: '操作失败', description: e instanceof Error ? e.message : '请稍后重试' })
    } finally { setMarkingAll(false) }
  }

  // ============ 我的：系统公告 / 修改密码 / 退出登录 ============
  const loadAnnouncements = async () => {
    setAnnLoading(true)
    try {
      const res = await apiGet<{ announcements: AnnouncementRow[] }>('/api/announcements')
      setAnnouncements(res.announcements ?? [])
    } catch {
      setAnnouncements([])
    } finally { setAnnLoading(false) }
  }

  const openAnnouncements = () => {
    setMeView('announcements'); setExpandedAnn(null)
    void loadAnnouncements()
  }

  const openPwdSheet = () => {
    setPwdForm(EMPTY_PWD); setPwdShow({ old: false, next: false, confirm: false })
    setPwdError(''); setPwdOpen(true)
  }

  const pwdStrengthNow = pwdStrength(pwdForm.newPassword)
  const pwdMismatch = pwdForm.confirmPassword.length > 0 && pwdForm.confirmPassword !== pwdForm.newPassword
  const pwdMatched = pwdForm.confirmPassword.length > 0 && pwdForm.confirmPassword === pwdForm.newPassword
  const canSubmitPwd =
    pwdForm.oldPassword.length > 0 && pwdForm.newPassword.length >= 4 && !pwdMismatch && pwdMatched

  const submitPwd = async () => {
    if (!canSubmitPwd || pwdSaving) return
    setPwdSaving(true); setPwdError('')
    try {
      await apiPost('/api/auth/change-password', {
        userId: currentUser.id, oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword,
      })
      toast({ title: '密码修改成功', description: '下次登录请使用新密码' })
      setPwdOpen(false); setPwdForm(EMPTY_PWD)
    } catch (e) {
      setPwdError(e instanceof Error ? e.message : '修改密码失败，请稍后重试')
    } finally { setPwdSaving(false) }
  }

  const confirmLogout = () => {
    setLogoutOpen(false)
    if (onLogout) {
      onLogout()
    } else {
      toast({ title: '请在桌面端退出登录', description: '移动端演示容器未接入登出回调' })
    }
  }

  // Escape 关闭「我的」页弹层（修改密码/退出确认）
  useEffect(() => {
    if (!pwdOpen && !logoutOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPwdOpen(false); setLogoutOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pwdOpen, logoutOpen])

  useEffect(() => {
    void loadTasks()
    void loadNotices()
  }, [])

  // 消息 Tab 激活期间每 30 秒静默刷新（与桌面铃铛口径一致）
  useEffect(() => {
    if (tab !== 'msg') return
    const timer = setInterval(() => { void loadNotices(false) }, 30000)
    return () => clearInterval(timer)
  }, [tab])

  const openTaskDetail = async (task: TaskRow) => {
    setOpenTask(task); setScheme(null); setSchemeLoading(true)
    try {
      const [s, plates] = await Promise.all([
        apiGet<SchemeRow | null>(`/api/isolation-schemes?workRequestId=${task.workRequestId}`),
        apiGet<PlateRow[]>('/api/blind-plates'),
      ])
      setScheme(s)
      setPlateCodeMap(new Map(plates.map((p) => [p.id, p.code] as const)))
    } catch (e) {
      toast({ variant: 'destructive', title: '加载失败', description: e instanceof Error ? e.message : '获取隔离方案失败' })
    } finally { setSchemeLoading(false) }
  }

  const reloadAfterExecute = async () => {
    if (openTask) await openTaskDetail(openTask)
    void loadTasks()
  }

  // ============ 预留 / 执行 ============
  const openReserve = async (point: PointRow) => {
    setReservePoint(point); setReservePlateId(''); setStockPlates(null)
    try {
      setStockPlates(await apiGet<PlateRow[]>(`/api/blind-plates?status=IN_STOCK&spec=${encodeURIComponent(point.blindSpec)}`))
    } catch {
      setStockPlates([])
    }
  }

  const submitReserve = async () => {
    if (!reservePoint) return
    if (!reservePlateId) return toast({ variant: 'destructive', title: '请选择要预留的盲板' })
    setBusy(true)
    try {
      await apiPost(`/api/isolation-points/${reservePoint.id}/reserve`, { blindPlateId: Number(reservePlateId), operator: currentUser.name })
      toast({ title: '盲板预留成功', description: `隔离点${reservePoint.seq}（${reservePoint.location}）` })
      setReservePoint(null)
      await reloadAfterExecute()
    } catch (e) {
      toast({ variant: 'destructive', title: '预留失败', description: e instanceof Error ? e.message : '请稍后重试' })
    } finally { setBusy(false) }
  }

  const submitExecute = async () => {
    if (!execPoint) return
    if (!execOperator.trim()) return toast({ variant: 'destructive', title: '请填写操作人' })
    setBusy(true)
    try {
      await apiPost(`/api/isolation-points/${execPoint.id}/execute`, { operator: execOperator })
      toast({ title: '执行反馈已提交', description: `隔离点${execPoint.seq}（${execPoint.location}）完成` })
      setExecPoint(null)
      await reloadAfterExecute()
    } catch (e) {
      toast({ variant: 'destructive', title: '执行失败', description: e instanceof Error ? e.message : '请稍后重试' })
    } finally { setBusy(false) }
  }

  // ============ 扫码（模拟扫码枪：解析编号 → 台账匹配 → 档案卡） ============
  const openScanPanel = () => {
    setScanInputOpen(true)
    if (quickPlates === null && !quickLoading) void loadQuickPlates()
  }

  const loadQuickPlates = async () => {
    setQuickLoading(true)
    try {
      setQuickPlates(await apiGet<PlateRow[]>('/api/blind-plates'))
    } catch {
      setQuickPlates([])
    } finally { setQuickLoading(false) }
  }

  const pushScanHistory = (code: string, ok: boolean) => {
    setScanHistory((prev) => [{ code, ok }, ...prev.filter((h) => h.code !== code)].slice(0, 5))
  }

  /** 档案卡附属数据：关联变动记录（blindCode 过滤最新 3 条）+ 所属装置名 */
  const loadScanExtras = async (seq: number, plate: PlateRow) => {
    try {
      const [records, units] = await Promise.all([
        apiGet<ChangeRecordRow[]>('/api/change-records?limit=300'),
        plate.unitId != null ? apiGet<UnitRow[]>('/api/units') : Promise.resolve([] as UnitRow[]),
      ])
      if (scanSeqRef.current !== seq) return
      setScanRecords(records.filter((r) => r.blindCode === plate.code).slice(0, 3))
      if (plate.unitId != null) {
        setScanUnitName(units.find((u) => u.id === plate.unitId)?.name ?? null)
      }
    } catch {
      if (scanSeqRef.current !== seq) return
      setScanRecords([])
    }
  }

  const resolveScan = async (raw: string) => {
    if (scanPhase === 'scanning') return
    const parsed = parseScanCode(raw)
    if (!parsed.code) {
      toast({ title: parsed.unsupported ?? '未能解析出盲板编号', description: parsed.unsupported ?? '请输入或选择盲板编号（如 MB-DN100-0003）' })
      return
    }
    const code = parsed.code
    const seq = ++scanSeqRef.current
    setScanInputOpen(false)
    setScanPhase('scanning')
    setScanPlate(null); setScanUnitName(null); setScanRecords([])
    setScanNotFoundCode(''); setScanSuggestions([]); setScanNetError('')
    const startedAt = Date.now()
    const waitAnim = async () => {
      const remain = SCAN_ANIM_MS - (Date.now() - startedAt)
      if (remain > 0) await new Promise((r) => setTimeout(r, remain))
    }
    try {
      const list = await apiGet<PlateRow[]>(`/api/blind-plates?keyword=${encodeURIComponent(code)}`)
      if (scanSeqRef.current !== seq) return
      const upper = code.toUpperCase()
      const plate = list.find((p) => p.code.toUpperCase() === upper)
        ?? (list.length === 1 && list[0].code.toUpperCase().includes(upper) ? list[0] : null)
      await waitAnim()
      if (scanSeqRef.current !== seq) return
      if (plate) {
        setScanPlate(plate); setScanPhase('found')
        pushScanHistory(plate.code, true)
        void loadScanExtras(seq, plate)
      } else {
        setScanNotFoundCode(code)
        setScanSuggestions(list.slice(0, 3).map((p) => p.code))
        setScanPhase('notfound')
        pushScanHistory(code, false)
      }
    } catch (e) {
      await waitAnim()
      if (scanSeqRef.current !== seq) return
      setScanNotFoundCode(code); setScanSuggestions([])
      setScanNetError(e instanceof Error ? e.message : '查询失败，请稍后重试')
      setScanPhase('notfound')
      pushScanHistory(code, false)
    }
  }

  const TABS: { key: PhoneTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'tasks', label: '任务', icon: ClipboardList },
    { key: 'scan', label: '扫码', icon: ScanLine },
    { key: 'msg', label: '消息', icon: Bell },
    { key: 'me', label: '我的', icon: User },
  ]

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr),auto] gap-6 items-start">
      {/* ============ 左侧说明 ============ */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-stone-800">移动端演示（uniapp + uView2）</h3>
              <p className="text-xs text-stone-500">右侧手机壳内为作业人员视角的真实交互模拟</p>
            </div>
          </div>
          <p className="text-sm text-stone-600 leading-relaxed">
            生产环境中移动端基于 <span className="font-medium text-emerald-700">uniapp + uView2 + Vue3</span> 构建，
            供作业人员/监护人现场使用，支持离线缓存与扫码识别盲板。此演示页与 WEB 端共用同一套 API：
            任务列表与执行反馈均为真实接口调用，操作结果实时同步到看板、台账与统计模块。
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {['uniapp', 'uView2', 'Vue3', 'H5 / 小程序 / App', '扫码识别', '离线缓存'].map((t) => (
              <span key={t} className="text-[11px] rounded-full bg-white border border-emerald-200 text-emerald-700 px-2.5 py-1">{t}</span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h4 className="text-sm font-bold text-stone-700 mb-3 flex items-center gap-1.5"><Info className="w-4 h-4 text-teal-500" />移动端核心功能</h4>
          <div className="space-y-3">
            {[
              { icon: ClipboardList, title: '我的任务', desc: '按负责人拉取作业任务，查看计划时间与隔离点执行进度' },
              { icon: ScanSearch, title: '扫码识别', desc: '模拟扫码/快捷选择编号，即时解析盲板档案、装置归属与最近变动' },
              { icon: CircleCheck, title: '执行反馈', desc: '逐点确认「预留盲板 → 现场安装/拆除」，操作人实名留痕' },
              { icon: BellRing, title: '验收申请', desc: '作业完工后推送验收人，消息中心同步审批、进度、预警等全部通知' },
            ].map((f) => {
              const Icon = f.icon
              return (
                <div key={f.title} className="flex gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5 text-emerald-600" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-stone-800">{f.title}</div>
                    <div className="text-xs text-stone-500 leading-relaxed">{f.desc}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm text-xs text-stone-500 leading-relaxed">
          <span className="font-semibold text-stone-700">操作提示：</span>
          进入「任务」Tab 点击任意任务卡进入详情，可对未完成隔离点执行
          <span className="text-emerald-700 font-medium"> 预留盲板 </span>与
          <span className="text-emerald-700 font-medium"> 执行确认 </span>
          （POST /api/isolation-points/[id]/reserve 与 /execute）；「扫码」Tab 点击「模拟扫码」可从台账快捷选择或输入盲板编号（如 MB-DN100-0003），扫描线动画后展示盲板档案卡与最近变动记录，解析失败可从历史一键重查。
        </div>
      </div>

      {/* ============ 右侧手机壳 ============ */}
      <div className="mx-auto w-[390px] h-[780px] rounded-[3rem] border-8 border-stone-800 bg-white overflow-hidden shadow-2xl relative flex flex-col shrink-0">
        {/* 状态栏 + 刘海 */}
        <div className="relative h-11 bg-stone-900 text-white flex items-center justify-between px-6 shrink-0 z-10">
          <span className="text-[11px] font-semibold">9:41</span>
          <div className="absolute left-1/2 -translate-x-1/2 top-1.5 w-28 h-6 bg-stone-800 rounded-full" />
          <span className="flex items-center gap-1">
            <Signal className="w-3.5 h-3.5" /><Wifi className="w-3.5 h-3.5" /><BatteryMedium className="w-4 h-4" />
          </span>
        </div>

        {/* 屏幕内容区 */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-stone-100">
          {/* ===== 任务 Tab ===== */}
          {tab === 'tasks' && !openTask && (
            <div className="p-3.5 space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-base font-bold text-stone-800">我的任务</h3>
                <button onClick={() => void loadTasks()} className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-emerald-700">
                  <RefreshCw className="w-3 h-3" />刷新
                </button>
              </div>
              {tasksLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
              ) : tasks.length === 0 ? (
                <div className="py-16 text-center text-stone-400">
                  <Inbox className="w-10 h-10 mx-auto mb-2 text-stone-300" />
                  <span className="text-sm">暂无作业任务</span>
                </div>
              ) : (
                tasks.map((t) => (
                  <button key={t.id} onClick={() => void openTaskDetail(t)}
                    className="w-full text-left rounded-2xl bg-white p-4 shadow-sm border border-stone-100 active:scale-[0.99] transition-transform">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-emerald-700">{t.code}</span>
                      <Badge variant="outline" className={cn('ml-auto text-[10px] h-5', TASK_STATUS_MAP[t.status]?.className)}>
                        {TASK_STATUS_MAP[t.status]?.label ?? t.status}
                      </Badge>
                    </div>
                    <div className="mt-1.5 text-sm font-semibold text-stone-800 line-clamp-1">{t.workRequest?.title ?? '-'}</div>
                    <div className="text-[11px] text-stone-400 mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />{t.workRequest?.unit?.name ?? '-'} · {t.workRequest?.location ?? '-'}
                    </div>
                    <div className="text-[11px] text-stone-400">负责人 {t.assignee} · {fmtDate(t.planStart)} ~ {fmtDate(t.planEnd)}</div>
                    <div className="mt-2.5">
                      {(t.pointsTotal ?? 0) > 0
                        ? <MobileProgressBar done={t.pointsDone ?? 0} total={t.pointsTotal ?? 0} />
                        : <span className="text-[11px] text-stone-300">无隔离点明细</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* ===== 任务详情屏 ===== */}
          {tab === 'tasks' && openTask && (
            <div className="p-3.5 space-y-3">
              <div className="flex items-center gap-1 -mx-1">
                <button onClick={() => setOpenTask(null)}
                  className="flex items-center gap-0.5 text-sm text-stone-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-white">
                  <ChevronLeft className="w-4.5 h-4.5" />返回
                </button>
                <span className="ml-auto text-xs text-stone-400 pr-2">任务详情</span>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm border border-stone-100">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-emerald-700">{openTask.code}</span>
                  <Badge variant="outline" className={cn('ml-auto text-[10px] h-5', TASK_STATUS_MAP[openTask.status]?.className)}>
                    {TASK_STATUS_MAP[openTask.status]?.label}
                  </Badge>
                </div>
                <div className="mt-1 text-sm font-semibold text-stone-800">{openTask.workRequest?.title ?? '-'}</div>
                <div className="text-[11px] text-stone-400 mt-0.5">{openTask.workRequest?.code} · {openTask.workRequest?.unit?.name}</div>
                <div className="text-[11px] text-stone-400">负责人 {openTask.assignee} · {fmtDate(openTask.planStart)} ~ {fmtDate(openTask.planEnd)}</div>
                {openTask.ticket && (
                  <div className="text-[11px] text-stone-400">关联作业票 <span className="font-mono text-emerald-700">{openTask.ticket.code}</span></div>
                )}
                {scheme && (
                  <div className="mt-3 rounded-xl bg-emerald-50/70 border border-emerald-100 p-3">
                    <div className="text-[11px] text-emerald-800 font-medium mb-1.5">隔离点执行进度（{scheme.code}）</div>
                    <MobileProgressBar done={scheme.points.filter((p) => p.done).length} total={scheme.points.length} />
                  </div>
                )}
              </div>

              {/* 流程进度（八环节缩略时间线，直接取 workRequest.status 推导） */}
              {openTask.workRequest && (
                <TaskFlowTimeline status={openTask.workRequest.status} />
              )}

              {schemeLoading ? (
                Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
              ) : !scheme ? (
                <div className="py-12 text-center text-sm text-stone-400">该任务暂无隔离方案明细</div>
              ) : scheme.points.length === 0 ? (
                <div className="py-12 text-center text-sm text-stone-400">隔离方案尚未编制隔离点</div>
              ) : (
                scheme.points.map((p) => (
                  <div key={p.id} className="rounded-2xl bg-white p-4 shadow-sm border border-stone-100">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{p.seq}</span>
                      <span className="text-sm font-semibold text-stone-800 flex-1 min-w-0 truncate">{p.location}</span>
                      <Badge variant="outline" className={cn('text-[10px] h-5 shrink-0',
                        p.action === 'ADD' ? 'border-violet-200 text-violet-700 bg-violet-50' : 'border-teal-200 text-teal-700 bg-teal-50')}>
                        {POINT_ACTION_MAP[p.action] ?? p.action}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-stone-500 mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 pl-8">
                      <span>介质：{p.medium ?? '-'}</span>
                      <span>规格：<span className="font-mono">{p.blindSpec}</span></span>
                      <span>类型：{p.blindType}</span>
                      <span>盲板：{p.blindPlateId != null ? (plateCodeMap.get(p.blindPlateId) ?? `#${p.blindPlateId}`) : '未预留'}</span>
                    </div>
                    <div className="mt-2.5 pl-8 flex items-center gap-2">
                      {p.done ? (
                        <>
                          <CircleCheck className="w-4 h-4 text-emerald-500" />
                          <span className="text-xs text-emerald-700 font-medium">已完成</span>
                          <span className="text-[11px] text-stone-400 ml-auto">{p.operator} · {fmtDateTime(p.doneAt)}</span>
                        </>
                      ) : (
                        <>
                          <CircleDashed className="w-4 h-4 text-amber-500" />
                          <span className="text-xs text-amber-600 font-medium">待执行</span>
                          <div className="ml-auto flex gap-1.5">
                            {!p.done && p.action === 'ADD' && !p.blindPlateId && (
                              <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                                onClick={() => void openReserve(p)}>
                                预留盲板
                              </Button>
                            )}
                            <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => { setExecPoint(p); setExecOperator(currentUser.name) }}>
                              执行确认
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div className="h-2" />
            </div>
          )}

          {/* ===== 扫码 Tab（模拟扫码：输入面板/快捷选择 → 扫描线动画 → 盲板档案卡） ===== */}
          {tab === 'scan' && (
            <div className="p-3.5 space-y-3">
              <h3 className="text-base font-bold text-stone-800 px-1">扫码识别</h3>

              {/* 模拟扫码大按钮 */}
              <div className="space-y-1.5">
                <Button className="w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-sm"
                  disabled={scanPhase === 'scanning'}
                  onClick={() => (scanInputOpen ? setScanInputOpen(false) : openScanPanel())}>
                  <ScanLine className="w-4.5 h-4.5" />{scanInputOpen ? '收起输入面板' : '模拟扫码'}
                </Button>
                <p className="text-[11px] text-stone-400 text-center leading-relaxed">
                  真机调用 uni.scanCode 摄像头，演示环境点击模拟扫描
                </p>
              </div>

              {/* 取景框（扫码时扫描线上下扫动 1.2s ×2 遍） */}
              <div className="relative rounded-2xl bg-stone-900 overflow-hidden h-56 flex items-center justify-center">
                <div className="absolute inset-0 opacity-25"
                  style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, #44403c 0%, transparent 40%), radial-gradient(circle at 75% 70%, #57534e 0%, transparent 45%)' }} />
                <div className={cn('relative w-40 h-40 rounded-xl border-2',
                  scanPhase === 'scanning' ? 'border-emerald-300' : 'border-emerald-400 animate-pulse')}>
                  {['top-0 left-0 border-t-4 border-l-4 rounded-tl-xl', 'top-0 right-0 border-t-4 border-r-4 rounded-tr-xl',
                    'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl'].map((pos) => (
                    <span key={pos} className={cn('absolute w-7 h-7 border-emerald-300', pos)} />
                  ))}
                  <QrCode className="absolute inset-0 m-auto w-8 h-8 text-emerald-400/60" />
                  {scanPhase === 'scanning' ? (
                    <span data-testid="bp-scan-sweep"
                      className="bp-scan-sweep absolute inset-x-2 h-0.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.9)]" />
                  ) : (
                    <div className="absolute inset-x-3 top-1/2 h-0.5 bg-emerald-400/70 rounded-full" />
                  )}
                </div>
                <p className={cn('absolute bottom-4 inset-x-0 text-center text-[11px]',
                  scanPhase === 'scanning' ? 'text-emerald-300 animate-pulse' : 'text-stone-400')}>
                  {scanPhase === 'scanning' ? '扫描中，正在识别盲板二维码…' : '对准盲板二维码，自动识别盲板档案'}
                </p>
              </div>

              {/* 扫码输入面板（展开式：手动输入回车提交 + 台账快捷选择即点即扫） */}
              {scanInputOpen && (
                <div className="rounded-2xl bg-white p-3.5 shadow-sm border border-stone-200 space-y-2.5 bp-fade-up">
                  <div className="flex items-center gap-1.5">
                    <ScanSearch className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-xs font-semibold text-stone-700">输入编号模拟扫码枪</span>
                    <span className="ml-auto text-[10px] text-stone-400">回车提交</span>
                  </div>
                  <Input value={scanInput} onChange={(e) => setScanInput(e.target.value)} autoFocus
                    placeholder="如 MB-DN100-0003" aria-label="盲板编号输入"
                    className="h-11 font-mono text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && void resolveScan(scanInput)} />
                  <Button className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                    disabled={scanPhase === 'scanning'} onClick={() => void resolveScan(scanInput)}>
                    <ScanLine className="w-4 h-4" />确认识别
                  </Button>
                  <div className="pt-1">
                    <div className="text-[11px] text-stone-400 mb-1.5">或从台账快捷选择（点击即扫）</div>
                    {quickLoading || quickPlates === null ? (
                      <div className="space-y-1.5">
                        <Skeleton className="h-11 rounded-xl" />
                        <Skeleton className="h-11 rounded-xl" />
                        <Skeleton className="h-11 rounded-xl" />
                      </div>
                    ) : quickPlates.length === 0 ? (
                      <div className="h-14 rounded-xl border border-amber-200 bg-amber-50 flex items-center justify-center text-xs text-amber-700">
                        台账加载失败，请手动输入编号
                      </div>
                    ) : (
                      <div className="max-h-44 overflow-y-auto space-y-1.5" role="listbox" aria-label="盲板编号快捷选择">
                        {quickPlates.map((p) => (
                          <button key={p.id} role="option" aria-selected="false" aria-label={`扫描盲板 ${p.code}`}
                            disabled={scanPhase === 'scanning'}
                            onClick={() => { setScanInput(p.code); void resolveScan(p.code) }}
                            className="w-full min-h-[44px] rounded-xl border border-stone-200 px-3 py-2 text-left hover:border-emerald-400 hover:bg-emerald-50/60 active:bg-emerald-100/60 transition-colors disabled:opacity-50">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-stone-800">{p.code}</span>
                              <Badge variant="outline" className={cn('ml-auto text-[10px] h-5 shrink-0', PLATE_STATUS_MAP[p.status]?.className)}>
                                {PLATE_STATUS_MAP[p.status]?.label ?? p.status}
                              </Badge>
                            </div>
                            <div className="text-[11px] text-stone-500 mt-0.5 truncate">{p.spec} · {p.type} · {p.location ?? '盲板库'}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 解析历史（本会话内存，最近 5 条，点击重查） */}
              {scanHistory.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-1 mb-1.5">
                    <History className="w-3.5 h-3.5 text-stone-400" />
                    <span className="text-[11px] text-stone-500 font-medium">本次会话解析历史</span>
                    <span className="text-[10px] text-stone-300">点击重查 · 最多 5 条</span>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                    {scanHistory.map((h) => (
                      <button key={h.code} onClick={() => void resolveScan(h.code)} aria-label={`重查 ${h.code}`}
                        disabled={scanPhase === 'scanning'}
                        className="shrink-0 h-11 px-3 rounded-full border bg-white flex items-center gap-1.5 font-mono text-xs text-stone-600 transition-colors hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50">
                        {h.ok ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <X className="w-3.5 h-3.5 text-rose-400" />}
                        {h.code}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 结果区：扫描中骨架 / 识别成功档案卡 / 解析失败错误卡 / 空态 */}
              {scanPhase === 'scanning' && <Skeleton className="h-44 rounded-2xl" />}

              {scanPhase === 'found' && scanPlate && (
                <div className="rounded-2xl bg-white p-4 shadow-sm border border-emerald-200 bp-fade-up">
                  {/* 头部：编号大字 + 状态徽章 */}
                  <div className="flex items-center gap-2">
                    <CircleCheck className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs text-emerald-700 font-medium">识别成功</span>
                    <Badge variant="outline" className={cn('ml-auto text-[10px] h-5', PLATE_STATUS_MAP[scanPlate.status]?.className)}>
                      {PLATE_STATUS_MAP[scanPlate.status]?.label ?? scanPlate.status}
                    </Badge>
                  </div>
                  <div className="mt-1.5 font-mono text-lg font-bold tracking-tight text-stone-800">{scanPlate.code}</div>
                  {/* 信息网格：规格/类型/材质/压力/厚度/位置/所属装置 */}
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-stone-500">
                    <span>规格：<span className="font-mono text-stone-700">{scanPlate.spec}</span></span>
                    <span>类型：{scanPlate.type}</span>
                    <span>材质：{scanPlate.material}</span>
                    <span>压力等级：{scanPlate.pressureRating}</span>
                    <span>厚度：{scanPlate.thickness}mm</span>
                    <span className="flex items-center gap-1 min-w-0">
                      <MapPin className="w-3 h-3 shrink-0" /><span className="truncate">{scanPlate.location ?? '-'}</span>
                    </span>
                    {scanPlate.unitId != null && (
                      <span className="col-span-2 flex items-center gap-1 min-w-0">
                        <Building2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">所属装置：{scanUnitName ?? `装置#${scanPlate.unitId}`}</span>
                      </span>
                    )}
                  </div>
                  {/* 关联变动记录（blindCode 过滤，最新 3 条时间线） */}
                  <div className="mt-3 border-t border-stone-100 pt-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <History className="w-3.5 h-3.5 text-stone-400" />
                      <span className="text-[11px] font-medium text-stone-600">最近变动记录</span>
                      <span className="text-[10px] text-stone-300">{scanRecords.length > 0 ? `最新 ${scanRecords.length} 条` : '暂无'}</span>
                    </div>
                    {scanRecords.length === 0 ? (
                      <div className="text-[11px] text-stone-300 py-1">该盲板暂无变动记录</div>
                    ) : (
                      <div className="flex flex-col">
                        {scanRecords.map((r, i) => (
                          <div key={r.id} className="flex gap-2.5">
                            <div className="flex flex-col items-center shrink-0 pt-1.5">
                              <span className={cn('w-1.5 h-1.5 rounded-full', r.toStatus === 'SCRAPPED' ? 'bg-stone-400' : 'bg-emerald-500')} />
                              {i < scanRecords.length - 1 && <span className="w-px flex-1 min-h-[14px] bg-stone-200" />}
                            </div>
                            <div className="flex-1 pb-2 min-w-0">
                              <div className="text-xs text-stone-700">
                                <span className="font-medium">{CHANGE_ACTION_MAP[r.action] ?? r.action}</span>
                                <span className="text-stone-400"> · {r.operator}</span>
                              </div>
                              <div className="text-[10px] text-stone-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                {r.workCode && <span className="font-mono">{r.workCode}</span>}
                                <span title={fmtDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</span>
                                {r.location && <span className="truncate max-w-[150px]">{r.location}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* 完整档案入口：跨模块直达台账一板一档（focusId 契约） */}
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-9 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 text-xs"
                      onClick={() => onNavigate?.('ledger', 'plates', scanPlate.id)}
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> 查看完整档案
                    </Button>
                    <p className="mt-1 text-center text-[10px] text-stone-300">在台账中打开一板一档</p>
                  </div>
                  {/* 底部操作提示行（演示说明，不真实跳转） */}
                  <div className="mt-2 rounded-xl bg-teal-50 border border-teal-100 px-3 py-2.5 flex items-start gap-1.5">
                    <MonitorSmartphone className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-px" />
                    <span className="text-[11px] text-teal-700 leading-relaxed">
                      {PLATE_SCAN_HINT[scanPlate.status] ?? '请在「任务」Tab 进入任务详情后对隔离点执行现场操作'}
                    </span>
                  </div>
                </div>
              )}

              {scanPhase === 'notfound' && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 bp-fade-up">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-semibold text-rose-700">{scanNetError ? '查询失败' : '未识别到盲板'}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-rose-600/90 leading-relaxed">
                    {scanNetError
                      ? `${scanNetError}。请检查网络后重试。`
                      : `编号「${scanNotFoundCode}」在盲板台账中不存在，请核对二维码或重新输入。`}
                  </p>
                  {!scanNetError && scanSuggestions.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[10px] text-rose-500/80 mb-1.5">你要找的是不是：</div>
                      <div className="flex flex-wrap gap-1.5">
                        {scanSuggestions.map((s) => (
                          <button key={s} onClick={() => void resolveScan(s)} aria-label={`改查 ${s}`}
                            className="h-11 px-3 rounded-full border border-rose-200 bg-white font-mono text-xs text-rose-600 hover:border-rose-400 hover:bg-rose-100/60 transition-colors">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" className="flex-1 h-11 rounded-xl border-rose-300 text-rose-600 hover:bg-rose-100 text-sm"
                      onClick={() => { setScanInput(scanNotFoundCode); setScanInputOpen(true) }}>
                      重新输入
                    </Button>
                    {scanNetError && (
                      <Button className="flex-1 h-11 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm"
                        onClick={() => void resolveScan(scanNotFoundCode)}>
                        <RefreshCw className="w-4 h-4" />重试查询
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {scanPhase === 'idle' && (
                <div className="rounded-2xl bg-white p-4 shadow-sm border border-dashed border-stone-200 text-center text-xs text-stone-400">
                  尚未识别盲板：点击「模拟扫码」选择或输入编号（如 MB-DN100-0003）
                </div>
              )}
              <div className="h-1" />
            </div>
          )}

          {/* ===== 消息 Tab（真实通知中心，与桌面铃铛同源） ===== */}
          {tab === 'msg' && (() => {
            const filteredNotices = msgFilter === 'ALL' ? notices : notices.filter((n) => n.type === msgFilter)
            return (
              <div className="p-3.5 space-y-2.5 bp-fade-up">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-base font-bold text-stone-800">消息中心</h3>
                  <button onClick={() => void loadNotices()} className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-emerald-700">
                    <RefreshCw className="w-3 h-3" />刷新
                  </button>
                </div>

                {/* 未读汇总条 */}
                <div className="rounded-2xl bg-white shadow-sm border border-stone-100 p-3.5 flex items-center gap-3">
                  <span className="relative w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4 text-emerald-600" />
                    {noticeUnread > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center border border-white">{noticeUnread > 99 ? '99+' : noticeUnread}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm', noticeUnread > 0 ? 'font-semibold text-stone-800' : 'text-stone-500')}>
                      {noticeUnread > 0 ? `${noticeUnread} 条未读消息` : '消息已全部读'}
                    </div>
                    <div className="text-[11px] text-stone-400 mt-0.5">与桌面端消息通知同源 · 共 {notices.length} 条</div>
                  </div>
                  <button onClick={() => void markAllNoticesRead()} disabled={markingAll || noticeUnread === 0}
                    className={cn('shrink-0 min-h-[36px] px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors',
                      noticeUnread > 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:bg-emerald-200'
                        : 'border-stone-200 bg-stone-50 text-stone-300 cursor-not-allowed')}>
                    {markingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                    全部已读
                  </button>
                </div>

                {/* 错误条 + 重试 */}
                {noticesError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-rose-700">消息加载失败</div>
                      <div className="text-[11px] text-rose-600/80 mt-0.5 break-all">{noticesError}</div>
                    </div>
                    <button onClick={() => void loadNotices()}
                      className="shrink-0 min-h-[32px] px-3 rounded-lg border border-rose-300 bg-white text-xs text-rose-600 hover:bg-rose-100 active:bg-rose-200 transition-colors flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />重试
                    </button>
                  </div>
                )}

                {/* 类型筛选 chips（横向滚动） */}
                <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="消息类型筛选">
                  {MSG_FILTERS.map((f) => {
                    const active = msgFilter === f.key
                    const count = f.key === 'ALL' ? notices.length : notices.filter((n) => n.type === f.key).length
                    return (
                      <button key={f.key} onClick={() => setMsgFilter(f.key)} aria-pressed={active}
                        className={cn('shrink-0 min-h-[32px] px-3 rounded-full text-xs border transition-colors flex items-center gap-1',
                          active ? 'bg-emerald-600 border-emerald-600 text-white font-medium'
                            : 'bg-white border-stone-200 text-stone-500 hover:border-emerald-300 hover:text-emerald-700')}>
                        {f.label}
                        <span className={cn('tabular-nums', active ? 'text-emerald-100' : 'text-stone-300')}>{count}</span>
                      </button>
                    )
                  })}
                </div>

                {/* 通知列表 */}
                {noticesLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
                ) : notices.length === 0 ? (
                  <div className="py-16 text-center text-stone-400">
                    <div className="w-12 h-12 rounded-full bg-white border border-stone-200 flex items-center justify-center mx-auto mb-2">
                      <BellOff className="w-5 h-5 text-stone-300" />
                    </div>
                    <div className="text-sm">暂无消息</div>
                    <div className="text-[11px] mt-0.5">业务流转与预警提醒将在这里通知你</div>
                  </div>
                ) : filteredNotices.length === 0 ? (
                  <div className="py-16 text-center text-stone-400">
                    <CheckCheck className="w-10 h-10 mx-auto mb-2 text-emerald-300" />
                    <div className="text-sm">该类型暂无消息</div>
                    <button onClick={() => setMsgFilter('ALL')} className="text-[11px] text-emerald-700 hover:underline mt-0.5">查看全部类型</button>
                  </div>
                ) : (
                  filteredNotices.map((n) => {
                    const meta = NOTIFY_TYPE_META[n.type] ?? NOTIFY_TYPE_META.SYSTEM
                    const Icon = meta.icon
                    const isUnread = !n.readAt
                    const showHint = linkHintId === n.id && !!n.linkModule
                    return (
                      <button key={n.id} onClick={() => void openNotice(n)} aria-label={`${isUnread ? '未读消息' : '消息'}：${n.title}`}
                        className={cn('w-full text-left rounded-2xl p-3.5 shadow-sm border transition-all active:scale-[0.99] hover:border-emerald-200',
                          isUnread ? 'bg-emerald-50/50 border-emerald-200/60' : 'bg-white border-stone-100')}>
                        <div className="flex gap-3">
                          <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', meta.chip)}>
                            <Icon className="w-4 h-4" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={cn('text-sm truncate', isUnread ? 'font-semibold text-stone-800' : 'font-medium text-stone-600')}>{n.title}</span>
                              {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="未读" />}
                              <span className="ml-auto text-[10px] text-stone-400 shrink-0" title={fmtDateTime(n.createdAt)}>{timeAgo(n.createdAt)}</span>
                            </div>
                            <p className="text-xs text-stone-500 leading-relaxed mt-1 line-clamp-2">{n.content}</p>
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              {n.bizCode && (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200 text-stone-500">{n.bizCode}</span>
                              )}
                              <span className={cn('text-[10px] px-1.5 py-0.5 rounded', meta.chip)}>{meta.label}</span>
                            </div>
                            {showHint && (
                              <div className="mt-2 rounded-lg bg-teal-50 border border-teal-100 px-2.5 py-2 flex items-start gap-1.5">
                                <MonitorSmartphone className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-px" />
                                <span className="text-[11px] text-teal-700 leading-relaxed">
                                  该消息关联桌面端「{LINK_MODULE_LABEL[n.linkModule!] ?? n.linkModule}」模块，请在电脑端登录后前往处理
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })
                )}
                {!noticesLoading && notices.length > 0 && (
                  <div className="text-center text-[10px] text-stone-300 pt-1 pb-1.5">按个人与角色推送 · 每 30 秒自动刷新</div>
                )}
                <div className="h-1" />
              </div>
            )
          })()}

          {/* ===== 我的 Tab · 首页（个人中心） ===== */}
          {tab === 'me' && meView === 'home' && (
            <div className="p-3.5 space-y-3">
              {/* 个人信息头部卡 */}
              <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white shadow-sm relative overflow-hidden">
                <div className="absolute -right-7 -top-9 w-28 h-28 rounded-full bg-white/10" />
                <div className="absolute -right-9 top-9 w-16 h-16 rounded-full bg-teal-300/20" />
                <div className="relative flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur border border-white/30 flex items-center justify-center text-xl font-bold shrink-0">
                    {currentUser.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-bold">{currentUser.name}</span>
                      <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium">
                        {ROLE_MAP[currentUser.role]?.label ?? currentUser.role}
                      </span>
                    </div>
                    <div className="text-[11px] text-emerald-100 mt-0.5 font-mono">@{currentUser.username}</div>
                  </div>
                </div>
                <div className="relative mt-3.5 pt-3 border-t border-white/15 space-y-1 text-[11px] text-emerald-50/90">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3 h-3 shrink-0 text-emerald-200" />
                    <span className="truncate">{currentUser.department || '未设置部门'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3 h-3 shrink-0 text-emerald-200" />
                    <span>{currentUser.phone || '未设置联系电话'}</span>
                  </div>
                </div>
              </div>

              {/* 功能入口（真实接口） */}
              <div className="rounded-2xl bg-white shadow-sm border border-stone-100 divide-y divide-stone-100 overflow-hidden">
                <MeCell icon={KeyRound} label="修改密码" sub="自助更换登录密码" onClick={openPwdSheet} />
                <MeCell icon={Megaphone} label="系统公告" sub="管理员全员通知" tone="teal" onClick={openAnnouncements} />
              </div>

              {/* 演示功能（静态项） */}
              <div className="rounded-2xl bg-white shadow-sm border border-stone-100 divide-y divide-stone-100 overflow-hidden">
                {[
                  { icon: CloudOff, label: '离线缓存设置', action: 'toast-cache' },
                  { icon: BellRing, label: '消息推送', action: 'toast-push' },
                  { icon: Trash2, label: '清除本地缓存', action: 'toast-clean' },
                  { icon: Download, label: '检查更新', action: 'toast-update' },
                ].map((row) => {
                  const Icon = row.icon
                  return (
                    <button key={row.label}
                      onClick={() => toast({ title: '演示环境', description: `${row.label}为静态演示项，正式版 uniapp 中可用` })}
                      className="w-full min-h-[48px] flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors">
                      <Icon className="w-4.5 h-4.5 text-stone-400 shrink-0" />
                      <span className="text-sm text-stone-700">{row.label}</span>
                      <ChevronRight className="w-4 h-4 text-stone-300 ml-auto" />
                    </button>
                  )
                })}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <Info className="w-4.5 h-4.5 text-stone-400" />
                  <span className="text-sm text-stone-700">版本</span>
                  <span className="ml-auto text-xs text-stone-400">v1.0.0</span>
                </div>
              </div>

              <button onClick={() => setLogoutOpen(true)}
                className="w-full min-h-[48px] rounded-2xl bg-white border border-rose-200 text-rose-600 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-rose-50 active:bg-rose-100 transition-colors">
                <LogOut className="w-4 h-4" />退出登录
              </button>
              <div className="h-2" />
            </div>
          )}

          {/* ===== 我的 Tab · 系统公告子页 ===== */}
          {tab === 'me' && meView === 'announcements' && (
            <div className="p-3.5 space-y-3 bp-fade-up">
              <div className="flex items-center gap-1 -mx-1">
                <button onClick={() => setMeView('home')}
                  className="flex items-center gap-0.5 text-sm text-stone-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-white">
                  <ArrowLeft className="w-4.5 h-4.5" />返回
                </button>
                <span className="ml-auto text-xs text-stone-400 pr-2">系统公告</span>
                <button onClick={() => void loadAnnouncements()}
                  className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-emerald-700 pr-1">
                  <RefreshCw className="w-3 h-3" />刷新
                </button>
              </div>

              {annLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
              ) : announcements.length === 0 ? (
                <div className="py-16 text-center text-stone-400">
                  <Megaphone className="w-10 h-10 mx-auto mb-2 text-stone-300" />
                  <span className="text-sm">暂无公告</span>
                </div>
              ) : (
                announcements.map((a) => {
                  const expanded = expandedAnn === a.id
                  return (
                    <button key={a.id} onClick={() => setExpandedAnn(expanded ? null : a.id)}
                      className="w-full text-left rounded-2xl bg-white p-4 shadow-sm border border-stone-100 hover:border-emerald-200 active:scale-[0.99] transition-all">
                      <div className="flex items-start gap-2">
                        <span className="w-7 h-7 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0">
                          <Megaphone className="w-3.5 h-3.5 text-teal-600" />
                        </span>
                        <span className="text-sm font-semibold text-stone-800 flex-1 min-w-0 leading-snug">{a.title}</span>
                        <ChevronRight className={cn('w-4 h-4 text-stone-300 shrink-0 mt-0.5 transition-transform duration-200', expanded && 'rotate-90')} />
                      </div>
                      <p className={cn('text-xs text-stone-500 mt-2 leading-relaxed', !expanded && 'line-clamp-2')}>{a.content}</p>
                      <div className="text-[10px] text-stone-400 mt-2 flex items-center justify-between">
                        <span>管理员发布</span>
                        <span>{fmtDateTime(a.createdAt)}</span>
                      </div>
                    </button>
                  )
                })
              )}
              <div className="h-2" />
            </div>
          )}
        </div>

        {/* 底部 TabBar */}
        <div className="shrink-0 border-t border-stone-200 bg-white grid grid-cols-4 pt-1.5 pb-4">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => { setTab(t.key); if (t.key !== 'tasks') setOpenTask(null); if (t.key !== 'me') setMeView('home'); if (t.key === 'msg') void loadNotices(false) }}
                className="relative flex flex-col items-center gap-0.5 py-1">
                <Icon className={cn('w-5 h-5', active ? 'text-emerald-600' : 'text-stone-400')} />
                <span className={cn('text-[10px]', active ? 'text-emerald-600 font-semibold' : 'text-stone-400')}>{t.label}</span>
                {t.key === 'msg' && noticeUnread > 0 && !active && (
                  <span className="absolute -top-0.5 left-1/2 translate-x-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center border border-white shadow-sm">
                    {noticeUnread > 9 ? '9+' : noticeUnread}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* 修改密码底部弹层（手机内 overlay，Escape/返回可关） */}
        {pwdOpen && (
          <div className="absolute inset-0 z-30 flex flex-col justify-end">
            <button aria-label="关闭修改密码" onClick={() => setPwdOpen(false)} className="absolute inset-0 bg-stone-900/50" />
            <div className="relative bg-white rounded-t-3xl shadow-2xl bp-fade-up max-h-[88%] flex flex-col">
              <div className="px-4 pt-2.5 pb-3 border-b border-stone-100 shrink-0">
                <div className="w-10 h-1 rounded-full bg-stone-200 mx-auto mb-3" />
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPwdOpen(false)} aria-label="返回"
                    className="w-8 h-8 -ml-1 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100 active:bg-stone-200 transition-colors">
                    <ArrowLeft className="w-4.5 h-4.5" />
                  </button>
                  <span className="text-sm font-bold text-stone-800 flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-emerald-600" />修改登录密码
                  </span>
                  <span className="ml-auto text-[11px] text-stone-400 font-mono">@{currentUser.username}</span>
                </div>
              </div>

              <div className="px-4 py-4 space-y-4 overflow-y-auto">
                {pwdError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700 flex items-start gap-1.5">
                    <X className="w-3.5 h-3.5 mt-px shrink-0" /><span className="leading-relaxed">{pwdError}</span>
                  </div>
                )}

                <div className="grid gap-1.5">
                  <Label className="text-xs text-stone-600">旧密码</Label>
                  <div className="relative">
                    <Input type={pwdShow.old ? 'text' : 'password'} value={pwdForm.oldPassword} placeholder="请输入当前密码"
                      onChange={(e) => setPwdForm({ ...pwdForm, oldPassword: e.target.value })} className="pr-9 h-10" />
                    <button type="button" aria-label={pwdShow.old ? '隐藏旧密码' : '显示旧密码'}
                      onClick={() => setPwdShow({ ...pwdShow, old: !pwdShow.old })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors">
                      {pwdShow.old ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-xs text-stone-600">新密码</Label>
                  <div className="relative">
                    <Input type={pwdShow.next ? 'text' : 'password'} value={pwdForm.newPassword} placeholder="至少 4 位，建议字母+数字"
                      onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })} className="pr-9 h-10" />
                    <button type="button" aria-label={pwdShow.next ? '隐藏新密码' : '显示新密码'}
                      onClick={() => setPwdShow({ ...pwdShow, next: !pwdShow.next })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors">
                      {pwdShow.next ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {pwdForm.newPassword.length > 0 && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all duration-300',
                          PWD_STRENGTH_META[pwdStrengthNow].bar, PWD_STRENGTH_META[pwdStrengthNow].width)} />
                      </div>
                      <span className={cn('text-[10px] font-medium shrink-0', PWD_STRENGTH_META[pwdStrengthNow].text)}>
                        {PWD_STRENGTH_META[pwdStrengthNow].label}
                      </span>
                    </div>
                  )}
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-xs text-stone-600">确认新密码</Label>
                  <div className="relative">
                    <Input type={pwdShow.confirm ? 'text' : 'password'} value={pwdForm.confirmPassword} placeholder="再次输入新密码"
                      onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })} className="pr-9 h-10" />
                    <button type="button" aria-label={pwdShow.confirm ? '隐藏确认密码' : '显示确认密码'}
                      onClick={() => setPwdShow({ ...pwdShow, confirm: !pwdShow.confirm })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors">
                      {pwdShow.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {pwdMismatch && (
                    <p className="text-xs text-rose-500 flex items-center gap-1"><X className="w-3.5 h-3.5" />两次输入的密码不一致</p>
                  )}
                  {pwdMatched && !pwdMismatch && (
                    <p className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" />两次输入一致</p>
                  )}
                </div>
              </div>

              <div className="px-4 pt-3 pb-6 shrink-0 border-t border-stone-100 bg-white rounded-b-none">
                <Button className="w-full h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                  disabled={pwdSaving || !canSubmitPwd} onClick={() => void submitPwd()}>
                  {pwdSaving ? <><Loader2 className="w-4 h-4 animate-spin" />提交中…</> : '确认修改'}
                </Button>
                <p className="text-[10px] text-stone-400 text-center mt-2">修改成功后下次登录请使用新密码</p>
              </div>
            </div>
          </div>
        )}

        {/* 退出登录确认（手机内 overlay） */}
        {logoutOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-8">
            <button aria-label="取消退出登录" onClick={() => setLogoutOpen(false)} className="absolute inset-0 bg-stone-900/50" />
            <div className="relative w-full max-w-[300px] rounded-2xl bg-white p-5 shadow-2xl bp-fade-up">
              <div className="w-11 h-11 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center mx-auto mb-3">
                <LogOut className="w-5 h-5 text-rose-500" />
              </div>
              <div className="text-center text-sm font-bold text-stone-800">退出登录</div>
              <p className="text-center text-xs text-stone-500 mt-1.5 leading-relaxed">
                确定要退出当前账号「{currentUser.name}」吗？<br />退出后将返回系统登录页。
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => setLogoutOpen(false)}
                  className="h-10 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50 active:bg-stone-100 transition-colors">取消</button>
                <button onClick={confirmLogout}
                  className="h-10 rounded-xl bg-rose-500 text-white text-sm font-medium hover:bg-rose-600 active:bg-rose-700 transition-colors">退出</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============ 预留盲板 Dialog ============ */}
      <Dialog open={!!reservePoint} onOpenChange={(o) => !o && setReservePoint(null)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>预留盲板 · 隔离点{reservePoint?.seq}</DialogTitle>
            <DialogDescription>{reservePoint?.location} · 规格 {reservePoint?.blindSpec}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">选择在库盲板（规格匹配）</Label>
            {stockPlates === null ? (
              <div className="h-14 rounded-md border border-stone-200 flex items-center justify-center text-xs text-stone-400">
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />加载中…
              </div>
            ) : stockPlates.length === 0 ? (
              <div className="h-14 rounded-md border border-amber-200 bg-amber-50 flex items-center justify-center text-xs text-amber-700 text-center px-3">
                该规格暂无在库盲板
              </div>
            ) : (
              <div className="max-h-52 overflow-y-auto space-y-1.5">
                {stockPlates.map((p) => (
                  <button key={p.id} onClick={() => setReservePlateId(String(p.id))}
                    className={cn('w-full rounded-xl border p-2.5 text-left transition-colors',
                      reservePlateId === String(p.id) ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-300' : 'border-stone-200 hover:border-emerald-300')}>
                    <div className="font-mono text-xs font-bold text-stone-800">{p.code}</div>
                    <div className="text-[11px] text-stone-500">{p.type} · {p.material} · {p.location ?? '盲板库'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReservePoint(null)}>取消</Button>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white" disabled={busy || !reservePlateId || stockPlates?.length === 0}
              onClick={() => void submitReserve()}>
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" />提交中…</> : '确认预留'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ 执行确认 AlertDialog ============ */}
      <AlertDialog open={!!execPoint} onOpenChange={(o) => !o && setExecPoint(null)}>
        <AlertDialogContent className="sm:max-w-[380px]">
          <AlertDialogHeader>
            <AlertDialogTitle>执行确认 · 隔离点{execPoint?.seq}</AlertDialogTitle>
            <AlertDialogDescription>
              {execPoint?.location} · {POINT_ACTION_MAP[execPoint?.action ?? ''] ?? execPoint?.action}（规格 {execPoint?.blindSpec}）。
              提交后盲板状态与台账将实时联动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">操作人</Label>
            <Input value={execOperator} onChange={(e) => setExecOperator(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={async (e) => { e.preventDefault(); await submitExecute() }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : '确认执行'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
