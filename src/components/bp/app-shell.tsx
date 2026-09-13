'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, apiGet } from '@/lib/bp-api'
import { BpUser, ModuleProps, ROLE_MAP } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  LayoutDashboard, ClipboardList, FileSignature, TicketCheck, BookOpen,
  BarChart3, Database, Settings, Smartphone, Menu, X, Factory, ChevronDown, ShieldCheck,
  RefreshCw, ShieldAlert, ListChecks, FlaskConical, DraftingCompass,
  User, KeyRound, Eye, EyeOff,
} from 'lucide-react'

import DashboardModule from '@/components/bp/dashboard'
import ApprovalCenterModule from '@/components/bp/approval-center'
import WorkRequestsModule from '@/components/bp/work-requests'
import SchemesModule from '@/components/bp/schemes'
import TaskMgmtModule from '@/components/bp/task-mgmt'
import LedgerModule from '@/components/bp/ledger'
import StatsModule from '@/components/bp/stats'
import PidConfigModule from '@/components/bp/pid-config'
import PipelineMasterModule from '@/components/bp/pipeline-master'
import BaseDataModule from '@/components/bp/base-data'
import SystemMgmtModule from '@/components/bp/system-mgmt'
import MobilePreviewModule from '@/components/bp/mobile-preview'
import NotificationBell from '@/components/bp/notification-bell'
import GlobalSearch from '@/components/bp/global-search'
import UserMenu from '@/components/bp/user-menu'
import AiAssistant from '@/components/bp/ai-assistant'

type ModuleKey =
  | 'dashboard' | 'approval-center' | 'work-requests' | 'schemes' | 'task-mgmt' | 'ledger'
  | 'stats' | 'pid-config' | 'pipeline-master' | 'base-data' | 'equipment-master' | 'system-mgmt' | 'mobile-preview'
  // 拆分后的独立模块（schemes/task-mgmt 保留兼容旧跳转）
  | 'isolation-scheme' | 'disposal-scheme' | 'ticket-mgmt' | 'task-track'
  | 'blind-status' | 'iso-point-master'

interface NavItem {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  children?: { key: string; label: string; moduleKey?: ModuleKey }[]
}

const NAV: NavItem[] = [
  { key: 'dashboard', label: '首页看板', icon: LayoutDashboard },
  { key: 'approval-center', label: '审批中心', icon: ShieldCheck },
  {
    key: 'work-requests', label: '作业需求', icon: ClipboardList,
    children: [
      { key: 'list', label: '作业需求' },
      { key: 'survey', label: '现场勘察' },
      { key: 'jsa', label: 'JSA分析' },
    ],
  },
  {
    key: 'scheme-prep', label: '方案编制', icon: DraftingCompass,
    children: [
      { key: 'isolation', label: '隔离方案', moduleKey: 'isolation-scheme' },
      { key: 'disposal', label: '工艺处置方案', moduleKey: 'disposal-scheme' },
    ],
  },
  {
    key: 'task-center', label: '作业任务', icon: ListChecks,
    children: [
      { key: 'ticket', label: '开作业票', moduleKey: 'ticket-mgmt' },
      { key: 'track', label: '作业任务跟踪', moduleKey: 'task-track' },
    ],
  },
  {
    key: 'ledger', label: '台账管理', icon: BookOpen,
    children: [
      { key: 'plates', label: '盲板台账' },
      { key: 'blind-status', label: '盲板状态', moduleKey: 'blind-status' },
      { key: 'records', label: '变动记录' },
      { key: 'inventory', label: '盲板库存' },
      { key: 'pid-config', label: 'PID 组态', moduleKey: 'pid-config' },
    ],
  },
  { key: 'stats', label: '统计分析', icon: BarChart3 },
  {
    key: 'base-data', label: '基础数据管理', icon: Database,
    children: [
      { key: 'units', label: '装置管理' },
      { key: 'dicts', label: '数据字典' },
      { key: 'pipeline-master', label: '管线台账', moduleKey: 'pipeline-master' },
      { key: 'equipment-master', label: '设备管理', moduleKey: 'equipment-master' },
      { key: 'iso-point-master', label: '隔离点主数据', moduleKey: 'iso-point-master' },
    ],
  },
  { key: 'system-mgmt', label: '系统管理', icon: Settings, children: [
    { key: 'users', label: '用户管理' },
    { key: 'announcements', label: '公告发布' },
    { key: 'audit', label: '操作日志' },
  ] },
  { key: 'mobile-preview', label: '移动端预览', icon: Smartphone },
]

const MODULE_META: Record<ModuleKey, { title: string; desc: string }> = {
  'dashboard': { title: '首页看板', desc: '盲板抽堵作业全流程总览与待办提醒' },
  'approval-center': { title: '审批中心', desc: '隔离方案 / 工艺处置方案 / 作业票集中审批与留痕查询' },
  'work-requests': { title: '作业需求', desc: '作业需求受理、现场勘察、JSA 分析' },
  'schemes': { title: '方案编制', desc: '隔离方案与工艺处置方案的编制、提交与审核' },
  'task-mgmt': { title: '作业任务管理', desc: '开作业票、票证审批与作业任务执行跟踪' },
  'ledger': { title: '台账管理', desc: '盲板台账、盲板状态、变动记录、库存与 PID 组态' },
  'stats': { title: '统计分析', desc: '作业量、状态分布、装置排名与库存预警' },
  'pid-config': { title: 'PID 组态', desc: '绘制 PID 图、标注隔离点位并实时查看通/盲与作业状态' },
  'pipeline-master': { title: '管线台账', desc: '管线主数据维护（介质/压力/材质/规格/起止设备），业务环节精确引用' },
  'equipment-master': { title: '设备管理', desc: '减压塔/换热器/泵等设备台账维护，PID 图元绑定设备后自动维护管线起止关联' },
  'iso-point-master': { title: '隔离点主数据', desc: '隔离点主数据维护，业务环节精确引用' },
  'base-data': { title: '基础数据管理', desc: '装置信息、数据字典、管线与隔离点主数据维护' },
  'system-mgmt': { title: '系统管理', desc: '用户账号、权限、管理员公告发布与操作日志审计' },
  'mobile-preview': { title: '移动端预览', desc: 'uniapp 移动端核心流程演示（作业人员视角）' },
  'isolation-scheme': { title: '隔离方案', desc: '依据现场勘察与 JSA 分析确定隔离点位，编制/提交/审核隔离方案' },
  'disposal-scheme': { title: '工艺处置方案', desc: '泄压/排净/置换/吹扫/气体检测等工艺处置步骤编制与审核' },
  'ticket-mgmt': { title: '开作业票', desc: '盲板抽堵安全作业票签发与批准（GB 30871）' },
  'task-track': { title: '作业任务跟踪', desc: '作业任务执行进度跟踪与现场逐点确认' },
  'blind-status': { title: '盲板状态', desc: '按装置查看 PID 组态图上隔离点实时通/盲与作业状态（只读）' },
}

const ROLE_TIP_MAP: Record<string, string> = {
  ADMIN: '系统管理员：全局配置、用户与字典维护、全部数据可见',
  MANAGER: '分管领导：作业票批准、验收监督、库存预警处置',
  ENGINEER: '工艺工程师：勘察/JSA/双方案编制、处置确认',
  REVIEWER: '方案审核人：隔离方案与工艺处置方案审核',
  OPERATOR: '作业人员：现场预留盲板、执行抽堵作业',
  GUARDIAN: '监护人：现场安全监护、执行确认监督',
  ACCEPTOR: '验收人：作业完成后的三项检查与验收结论',
}

/** 验证码签发结果 */
interface CaptchaPayload { captchaId: string; svg: string }

/** 演示账号下拉排序（按业务层级：管理员 → 领导 → 工程师 → 审核 → 作业/监护 → 验收） */
const ROLE_SORT: Record<string, number> = { ADMIN: 0, MANAGER: 1, ENGINEER: 2, REVIEWER: 3, OPERATOR: 4, GUARDIAN: 5, ACCEPTOR: 6 }

function LoginPage({ onLogin }: { onLogin: (u: BpUser) => void }) {
  const [users, setUsers] = useState<BpUser[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // 图形验证码（一次性：任意一次登录尝试后必须刷新）
  const [captcha, setCaptcha] = useState<CaptchaPayload | null>(null)
  const [captchaInput, setCaptchaInput] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => (ROLE_SORT[a.role] ?? 99) - (ROLE_SORT[b.role] ?? 99)),
    [users],
  )
  // 手动输入的用户名若命中内建账号，则下拉同步选中并显示角色提示
  const matched = useMemo(
    () => users.find((u) => u.username === username.trim()) ?? null,
    [users, username],
  )

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true)
    try {
      const data = await apiGet<CaptchaPayload>('/api/auth/captcha')
      setCaptcha(data)
      setCaptchaInput('')
    } catch { /* 验证码加载失败时隐藏图，提交时后端会拦截并提示 */ }
    finally { setCaptchaLoading(false) }
  }, [])

  useEffect(() => {
    let cancelled = false
    apiGet<BpUser[]>('/api/users').then((list) => {
      if (cancelled) return
      const active = list.filter((u) => u.active !== false)
      setUsers(active)
      // 记住上次登录账号：仅预填用户名（密码不预填，保持正式登录形态）
      try {
        const lastId = localStorage.getItem('bp_last_user_id')
        const last = active.find((u) => u.id === lastId)
        if (last) setUsername(last.username)
      } catch { /* ignore */ }
    }).catch(() => { if (!cancelled) setError('加载用户失败，请刷新重试') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { void loadCaptcha() }, [loadCaptcha])

  /** 演示账号快选：自动填入账号与演示密码，聚焦验证码 */
  const pickDemoUser = (id: string) => {
    const u = users.find((x) => x.id === id)
    if (!u) return
    setUsername(u.username)
    setPassword('123456')
    setError('')
    requestAnimationFrame(() => document.getElementById('login-captcha')?.focus())
  }

  const submit = async () => {
    if (!username.trim()) return setError('请输入用户名（或从演示账号快选中选择）')
    if (!password) return setError('请输入密码')
    if (!captchaInput.trim()) {
      setError('请输入图形验证码')
      return
    }
    setLoading(true); setError('')
    try {
      const user = await api<BpUser>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password, captchaId: captcha?.captchaId ?? '', captchaCode: captchaInput }),
      })
      try { localStorage.setItem('bp_last_user_id', user.id) } catch { /* ignore */ }
      onLogin(user)
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败')
      // 验证码一次性：任何一次失败后都换新码（含密码错误/锁定分支）
      void loadCaptcha()
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-stone-50">
      <div className="flex-1 bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900 text-white p-8 md:p-14 flex flex-col justify-center relative overflow-hidden">
        <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-emerald-700/30 blur-3xl" />
        <div className="absolute -left-16 bottom-0 w-72 h-72 rounded-full bg-teal-600/20 blur-3xl" />
        <div className="relative max-w-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
              <Factory className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-wide">石化盲板管理系统</h1>
              <p className="text-emerald-200/80 text-sm">Blind Plate Management System</p>
            </div>
          </div>
          <p className="text-emerald-100/90 leading-relaxed mb-8">
            依据 GB 30871《危险化学品企业特殊作业安全规范》，实现盲板抽堵作业全流程数字化管控——从作业需求、现场勘察、JSA 分析、隔离/工艺处置方案审批，到作业票签发、现场执行与验收，全程留痕、闭环管理。
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-xs md:text-sm">
            {['作业需求', '现场勘察', 'JSA分析', '隔离方案', '工艺处置', '处置确认', '开作业票', '作业执行', '作业验收'].map((s, i) => (
              <div key={s} className="rounded-lg bg-white/10 backdrop-blur px-2 py-3 border border-white/10">
                <div className="text-emerald-300 font-bold mb-1">{i + 1}</div>
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="w-full md:w-[460px] bg-white p-8 md:p-12 flex flex-col justify-center shadow-2xl">
        <div className="bp-fade-up">
          <h2 className="text-xl font-bold text-stone-800 mb-1">用户登录</h2>
          <p className="text-sm text-stone-400 mb-6">请输入账号与密码登录系统</p>
        </div>

        {/* 演示账号快选（内建用户，选中自动填入） */}
        <div className="mb-3 bp-fade-up-d1">
          <Label htmlFor="login-demo" className="text-xs font-medium text-stone-500 mb-1.5 block">演示账号快选</Label>
          <Select value={matched?.id ?? ''} onValueChange={pickDemoUser}>
            <SelectTrigger id="login-demo" aria-label="选择内建演示账号"
              className="w-full h-10 border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 data-[state=open]:border-emerald-500">
              <SelectValue placeholder="选择内建演示账号（自动填入账号密码）" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {sortedUsers.map((u) => (
                <SelectItem key={u.id} value={u.id} title={ROLE_TIP_MAP[u.role] ?? ''}>
                  <span className="font-medium">{u.name}</span>
                  <span className="ml-1.5 text-xs text-stone-400">{ROLE_MAP[u.role]?.label ?? u.role}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-[11px] leading-relaxed text-stone-400">
            内建演示账号密码统一为 <span className="font-mono font-semibold text-stone-600">123456</span>，选中即自动填入账号与密码
          </p>
        </div>

        <div className="relative my-4 bp-fade-up-d1" aria-hidden="true">
          <div className="h-px bg-stone-200" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-[10px] text-stone-400">或手动输入账号</span>
        </div>

        {/* 用户名 */}
        <div className="mb-3 bp-fade-up-d1">
          <Label htmlFor="login-username" className="text-xs font-medium text-stone-500 mb-1.5 block">用户名</Label>
          <div className="relative">
            <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
            <input id="login-username" type="text" value={username} autoComplete="username"
              onChange={(e) => { setUsername(e.target.value); setError('') }}
              placeholder="请输入用户名" aria-label="用户名"
              className="w-full rounded-md border border-stone-300 pl-8 pr-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
          </div>
        </div>

        {/* 密码（支持明文切换） */}
        <div className="mb-3 bp-fade-up-d1">
          <Label htmlFor="login-password" className="text-xs font-medium text-stone-500 mb-1.5 block">密码</Label>
          <div className="relative">
            <KeyRound className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
            <input id="login-password" type={showPwd ? 'text' : 'password'} value={password} autoComplete="current-password"
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="请输入密码" aria-label="密码"
              className="w-full rounded-md border border-stone-300 pl-8 pr-9 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
            <button type="button" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? '隐藏密码' : '显示密码'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-stone-400 transition-colors hover:text-stone-600">
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {matched && (
          <div className="mb-3 rounded-lg bg-stone-50 border border-stone-200 px-3 py-2.5 text-[11px] leading-relaxed text-stone-500 bp-fade-up">
            <span className={cn('inline-block px-1.5 py-0.5 rounded border mr-1.5', ROLE_MAP[matched.role]?.className)}>{ROLE_MAP[matched.role]?.label}</span>
            {ROLE_TIP_MAP[matched.role] ?? ''}
          </div>
        )}
        <div className="mb-4 bp-fade-up-d1">
          <Label htmlFor="login-captcha" className="text-xs font-medium text-stone-500 mb-1.5 block">图形验证码</Label>
          <div className="flex items-stretch gap-2">
            <div className="relative flex-1">
              <ShieldAlert className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
              <input id="login-captcha" type="text" value={captchaInput} maxLength={4}
                onChange={(e) => { setCaptchaInput(e.target.value.replace(/[^a-zA-Z0-9]/g, '')); setError('') }}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="验证码（不区分大小写）" aria-label="图形验证码"
                className="w-full rounded-md border border-stone-300 pl-8 pr-2 py-2.5 text-sm tracking-[0.2em] uppercase outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
            </div>
            <button type="button" onClick={() => void loadCaptcha()} disabled={captchaLoading}
              title="看不清？点击刷新验证码" aria-label="点击刷新验证码"
              className="relative shrink-0 w-[116px] rounded-md border border-stone-300 bg-white overflow-hidden transition-opacity hover:opacity-80 disabled:opacity-60">
              {captcha
                ? <img src={`data:image/svg+xml;utf8,${encodeURIComponent(captcha.svg)}`} alt="图形验证码" className="w-full h-full object-cover select-none" draggable={false} />
                : <span className="flex items-center justify-center h-full text-[11px] text-stone-400">{captchaLoading ? '加载中…' : '点击获取'}</span>}
              {captchaLoading && captcha && <span className="absolute inset-0 flex items-center justify-center bg-white/60"><RefreshCw className="w-4 h-4 text-emerald-700 animate-spin" /></span>}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-stone-400 flex items-center gap-1">
            <RefreshCw className="w-2.5 h-2.5" /> 验证码 5 分钟内有效、一次一换；看不清点击图片刷新
          </p>
        </div>
        {error && <div className="mb-3 rounded-md bg-rose-50 border border-rose-200 text-rose-600 text-xs px-3 py-2">{error}</div>}
        <Button onClick={submit} disabled={loading}
          className="w-full h-11 bg-emerald-700 hover:bg-emerald-800 text-white bp-fade-up-d2">
          {loading ? '登录中…' : '登 录'}
        </Button>
        <p className="text-[11px] text-stone-400 mt-6 leading-relaxed bp-fade-up-d2">
          角色说明：工艺工程师编制勘察/JSA/方案；方案审核人审核；工艺工程师处置确认；分管领导签发票；作业人员执行；验收人验收。系统会记住你上次使用的账号。
        </p>
      </div>
    </div>
  )
}

function ModuleRouter({ active, moduleProps, onLogout }: { active: ModuleKey; moduleProps: ModuleProps; onLogout?: () => void }) {
  switch (active) {
    case 'dashboard': return <DashboardModule {...moduleProps} />
    case 'approval-center': return <ApprovalCenterModule {...moduleProps} />
    case 'work-requests': return <WorkRequestsModule {...moduleProps} />
    // 旧模块 key 保留兼容既有跳转
    case 'schemes': return <SchemesModule {...moduleProps} />
    case 'task-mgmt': return <TaskMgmtModule {...moduleProps} />
    // 拆分后的独立菜单（共用组件必须加 key 强制重挂载：否则菜单互切时 React 复用实例，
    // useState(singleTab) 不随 props 重新初始化，导致页面不切换）
    case 'isolation-scheme': return <SchemesModule key="scheme-isolation" {...moduleProps} singleTab="isolation" />
    case 'disposal-scheme': return <SchemesModule key="scheme-disposal" {...moduleProps} singleTab="disposal" />
    case 'ticket-mgmt': return <TaskMgmtModule key="task-ticket" {...moduleProps} singleTab="ticket" />
    case 'task-track': return <TaskMgmtModule key="task-track" {...moduleProps} singleTab="track" />
    case 'ledger': return <LedgerModule {...moduleProps} />
    case 'stats': return <StatsModule {...moduleProps} />
    case 'pid-config': return <PidConfigModule key="pid-edit" {...moduleProps} />
    case 'blind-status': return <PidConfigModule key="pid-readonly" {...moduleProps} readOnly />
    case 'pipeline-master': return <PipelineMasterModule key="pm-pipelines" {...moduleProps} singleTab="pipelines" />
    case 'iso-point-master': return <PipelineMasterModule key="pm-points" {...moduleProps} singleTab="points" />
    case 'base-data': return <BaseDataModule key="bd-all" {...moduleProps} />
    case 'equipment-master': return <BaseDataModule key="bd-equipments" {...moduleProps} initialTab="equipments" />
    case 'system-mgmt': return <SystemMgmtModule {...moduleProps} />
    case 'mobile-preview': return <MobilePreviewModule {...moduleProps} onLogout={onLogout} />
    default: return null
  }
}

export default function AppShell() {
  const [user, setUser] = useState<BpUser | null>(null)
  const [booted, setBooted] = useState(false)
  const [active, setActive] = useState<ModuleKey>('dashboard')
  const [tab, setTab] = useState<string | undefined>()
  const [focusId, setFocusId] = useState<number | undefined>()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expanded, setExpanded] = useState<string>('work-requests')

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      try {
        const raw = localStorage.getItem('bp_current_user')
        if (raw) setUser(JSON.parse(raw))
      } catch { /* ignore */ }
      setBooted(true)
    })
    return () => { cancelled = true }
  }, [])

  const navigate = useCallback((key: ModuleKey, initTab?: string, focus?: number) => {
    setActive(key); setTab(initTab); setFocusId(focus); setSidebarOpen(false)
  }, [])

  const navigateLoose = useCallback((key: string, tab?: string, focus?: number) => {
    navigate(key as ModuleKey, tab, focus)
  }, [navigate])

  const handleLogin = (u: BpUser) => { localStorage.setItem('bp_current_user', JSON.stringify(u)); setUser(u) }
  const handleLogout = () => { localStorage.removeItem('bp_current_user'); setUser(null) }

  const moduleProps: ModuleProps = useMemo(
    () => ({
      currentUser: user!,
      initialTab: tab,
      focusId,
      onNavigate: (key: string, t?: string, focus?: number) => navigate(key as ModuleKey, t, focus),
    }),
    [user, tab, focusId, navigate]
  )

  if (!booted) return <div className="min-h-screen bg-white" />
  if (!user) return <LoginPage onLogin={handleLogin} />

  const meta = MODULE_META[active]

  const sidebar = (
    <div className="h-full flex flex-col bg-stone-900 text-stone-300 w-60">
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-stone-800 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center">
          <Factory className="w-4.5 h-4.5 text-emerald-400" />
        </div>
        <div className="leading-tight">
          <div className="text-white text-sm font-semibold">石化盲板管理</div>
          <div className="text-[10px] text-stone-500">BPMS v1.0</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5" aria-label="主导航">
        {NAV.map((item) => {
          const Icon = item.icon
          const isGroup = !!item.children
          const expandedOpen = expanded === item.key
          return (
            <div key={item.key}>
              <button
                onClick={() => {
                  if (isGroup) setExpanded(expandedOpen ? '' : item.key)
                  else navigate(item.key as ModuleKey)
                }}
                className={cn('w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  (active === item.key || item.children?.some((c) => c.moduleKey === active)) ? 'bg-emerald-600/20 text-emerald-300 font-medium' : 'hover:bg-stone-800 hover:text-white')}>
                <Icon className="w-4.5 h-4.5 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {isGroup && <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expandedOpen && 'rotate-180')} />}
              </button>
              {isGroup && expandedOpen && (
                <div className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l border-stone-800 pl-2">
                  {item.children!.filter((c) => c.key !== 'audit' || user?.role === 'ADMIN').map((c) => (
                    <button key={c.key} onClick={() => (c.moduleKey ? navigate(c.moduleKey) : navigate(item.key as ModuleKey, c.key))}
                      className={cn('w-full rounded-md px-3 py-2 text-[13px] text-left transition-colors',
                        c.moduleKey
                          ? (active === c.moduleKey ? 'text-emerald-300 bg-stone-800' : 'text-stone-400 hover:text-white hover:bg-stone-800')
                          : (active === item.key && tab === c.key ? 'text-emerald-300 bg-stone-800' : 'text-stone-400 hover:text-white hover:bg-stone-800'))}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div className="p-3 border-t border-stone-800 shrink-0">
        <UserMenu user={user} onLogout={handleLogout} />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col">
      {/* 顶栏(移动端) */}
      <header className="md:hidden sticky top-0 z-40 flex items-center gap-3 bg-stone-900 text-white px-4 h-14">
        <button onClick={() => setSidebarOpen(true)} aria-label="打开菜单"><Menu className="w-5 h-5" /></button>
        <span className="font-semibold text-sm">石化盲板管理系统</span>
        <div className="ml-auto flex items-center gap-1.5">
          <NotificationBell user={user} onNavigate={navigateLoose} compact />
          <UserMenu user={user} onLogout={handleLogout} compact />
        </div>
      </header>
      <div className="flex flex-1">
        {/* 桌面侧边栏 */}
        <aside className="hidden md:block sticky top-0 h-screen shrink-0">{sidebar}</aside>
        {/* 移动端抽屉 */}
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
            <div className="relative z-10 h-full">{sidebar}
              <button onClick={() => setSidebarOpen(false)} aria-label="关闭菜单"
                className="absolute -right-10 top-3 p-1.5 text-white bg-black/40 rounded-md"><X className="w-4 h-4" /></button>
            </div>
          </div>
        )}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="bg-white border-b border-stone-200 px-4 md:px-6 py-4 shrink-0 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-stone-800">{meta.title}</h1>
              <p className="text-xs text-stone-400 mt-0.5">{meta.desc}</p>
            </div>
            <div className="hidden sm:block w-[300px] md:w-[340px] shrink-0">
              <GlobalSearch onNavigate={navigateLoose} />
            </div>
            <NotificationBell user={user} onNavigate={navigateLoose} />
          </div>
          <div className="flex-1 p-4 md:p-6">
            <ModuleRouter active={active} moduleProps={moduleProps} onLogout={handleLogout} />
          </div>
          <footer className="mt-auto px-6 py-3 text-center text-[11px] text-stone-400 bg-transparent shrink-0">
            石化盲板管理系统 · 盲板抽堵作业全流程数字化管控 · 依据 GB 30871 特殊作业安全规范
          </footer>
        </main>
      </div>
      {/* 全局 AI 助手「小安」（登录后可用；onNavigate 供回答内嵌入口直达跳转） */}
      <AiAssistant user={user} moduleTitle={meta?.title} onNavigate={navigateLoose} />
    </div>
  )
}
