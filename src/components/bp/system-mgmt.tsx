'use client'
// 系统管理：用户账号管理 + 管理员公告发布 + 操作日志审计
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ModuleProps, ROLE_MAP } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { apiDelete, apiGet, apiPost, apiPut, fmtDateTime, getStoredUser } from '@/lib/bp-api'
import { exportCsv } from '@/lib/bp-export'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Inbox, KeyRound, Megaphone, Pencil, Plus, RefreshCw, Send, Settings2,
  Trash2, Undo2, UserRound, History, Search, Download, ChevronLeft, ChevronRight,
} from 'lucide-react'

// ============ 类型 ============
interface SystemUser {
  id: string
  username: string
  name: string
  role: string
  department?: string | null
  phone?: string | null
  active: boolean
  createdAt?: string
}

interface UserForm {
  username: string
  name: string
  role: string
  department: string
  phone: string
  password: string
}

interface AnnouncementItem {
  id: number
  title: string
  content: string
  createdAt: string
}

interface AuditLogItem {
  id: number
  actorId: string | null
  actorName: string
  action: string
  entity: string
  entityId: string | null
  entityCode: string | null
  detail: string | null
  createdAt: string
}

/** 审计动作 → 中文与徽章配色（严禁 indigo/blue，新动作从 emerald/teal/amber/violet/rose/stone 内选色） */
const AUDIT_ACTION_META: Record<string, { label: string; cls: string }> = {
  CREATE: { label: '创建', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  UPDATE: { label: '更新', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  DELETE: { label: '删除', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  PASSWORD_CHANGE: { label: '修改密码', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  PUBLISH: { label: '发布公告', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  WITHDRAW: { label: '撤回公告', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  LOGIN: { label: '登录', cls: 'bg-stone-100 text-stone-600 border-stone-200' },
  // 业务流转动作
  SUBMIT: { label: '提交', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  APPROVE: { label: '审批通过', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REJECT: { label: '审批驳回', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  STATUS_CHANGE: { label: '状态流转', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  START: { label: '开始作业', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  COMPLETE: { label: '完成', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCEL: { label: '取消', cls: 'bg-stone-100 text-stone-600 border-stone-200' },
}
/** 审计对象模块 → 中文（与 bp-server-utils.ts 的 AUDIT_ENTITY_MAP 保持一致） */
const AUDIT_ENTITY_LABEL: Record<string, string> = {
  USER: '用户管理', UNIT: '装置管理', DICT: '数据字典', ANNOUNCEMENT: '系统公告', AUTH: '认证安全', INVENTORY: '盲板库存',
  WORK_REQUEST: '作业需求', ISOLATION_SCHEME: '隔离方案', DISPOSAL_SCHEME: '工艺处置方案',
  WORK_TICKET: '作业票', WORK_TASK: '作业任务', JSA: 'JSA分析', ACCEPTANCE: '作业验收',
}

const EMPTY_USER_FORM: UserForm = { username: '', name: '', role: 'OPERATOR', department: '', phone: '', password: '' }

function roleBadge(role: string) {
  const meta = ROLE_MAP[role]
  return (
    <Badge variant="outline" className={meta?.className ?? 'bg-stone-100 text-stone-600 border-stone-200'}>
      {meta?.label ?? role}
    </Badge>
  )
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <TableBody>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-[120px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  )
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-stone-400">
      {icon}
      <span className="text-sm">{text}</span>
    </div>
  )
}

// ============ 公告发布 ============
function AnnouncementPanel({ currentUser }: { currentUser: SystemUser | null }) {
  const { toast } = useToast()
  const isAdmin = currentUser?.role === 'ADMIN'
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [withdrawing, setWithdrawing] = useState<AnnouncementItem | null>(null)

  /** 操作者标识（审计日志用） */
  const actorFields = () => ({ __actorId: currentUser?.id ?? '', __actorName: currentUser?.name ?? '' })
  const actorQuery = () => `__actorId=${encodeURIComponent(currentUser?.id ?? '')}&__actorName=${encodeURIComponent(currentUser?.name ?? '')}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<{ announcements: AnnouncementItem[] }>('/api/announcements')
      setAnnouncements(data.announcements ?? [])
    } catch (err) {
      toast({ title: '加载公告失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const publish = async () => {
    if (!title.trim()) {
      toast({ title: '请填写标题', description: '公告标题不能为空', variant: 'destructive' })
      return
    }
    if (!content.trim()) {
      toast({ title: '请填写内容', description: '公告内容不能为空', variant: 'destructive' })
      return
    }
    setPublishing(true)
    try {
      await apiPost('/api/announcements', { title: title.trim(), content: content.trim(), ...actorFields() })
      toast({ title: '发布成功', description: '公告已推送到全员消息中心' })
      setTitle('')
      setContent('')
      await load()
    } catch (err) {
      toast({ title: '发布失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setPublishing(false)
    }
  }

  const confirmWithdraw = async () => {
    if (!withdrawing) return
    try {
      await apiDelete(`/api/announcements/${withdrawing.id}?${actorQuery()}`)
      toast({ title: '已撤回', description: `公告「${withdrawing.title}」已从消息中心移除` })
      setWithdrawing(null)
      await load()
    } catch (err) {
      toast({ title: '撤回失败', description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[400px_1fr] items-start">
      {/* 发布表单 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4 text-emerald-700" />
            发布公告
          </CardTitle>
          <CardDescription>
            {isAdmin ? '全员广播，发布后将推送到所有用户的消息中心' : '仅系统管理员可发布公告，可查看历史公告'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>标题 <span className="text-red-500">*</span></Label>
              <span className="text-[10px] text-stone-400 font-mono">{title.length}/60</span>
            </div>
            <Input
              value={title}
              disabled={!isAdmin}
              maxLength={60}
              placeholder="如：系统升级通知、安全月活动安排"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>内容 <span className="text-red-500">*</span></Label>
              <span className="text-[10px] text-stone-400 font-mono">{content.length}/1000</span>
            </div>
            <Textarea
              value={content}
              disabled={!isAdmin}
              maxLength={1000}
              rows={6}
              placeholder="请输入公告正文…"
              className="resize-none"
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <Button
            className="bg-emerald-700 hover:bg-emerald-800"
            disabled={!isAdmin || publishing}
            onClick={() => void publish()}
          >
            <Send className="h-4 w-4" />
            {publishing ? '发布中…' : '发布公告'}
          </Button>
        </CardContent>
      </Card>

      {/* 已发布公告 */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                已发布公告
                <Badge variant="outline" className="bg-stone-50 text-stone-500 border-stone-200">{announcements.length}</Badge>
              </CardTitle>
              <CardDescription>按发布时间倒序，撤回后所有用户消息中心同步移除</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> 刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : announcements.length === 0 ? (
            <EmptyState icon={<Megaphone className="h-8 w-8" />} text="暂无公告，请在左侧发布第一条公告" />
          ) : (
            <div className="max-h-[420px] overflow-y-auto space-y-3 pr-1">
              {announcements.map((a) => (
                <div key={a.id} className="group rounded-lg border border-stone-200 bg-white p-3.5 hover:border-emerald-300 hover:shadow-sm transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0 mt-0.5">
                        <Megaphone className="h-4 w-4 text-emerald-700" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-stone-800 truncate">{a.title}</div>
                        <p className="text-[13px] text-stone-500 leading-relaxed mt-1 line-clamp-2 whitespace-pre-wrap">{a.content}</p>
                        <div className="text-[11px] text-stone-400 mt-1.5 font-mono">{fmtDateTime(a.createdAt)}</div>
                      </div>
                    </div>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-stone-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setWithdrawing(a)}
                      >
                        <Undo2 className="h-4 w-4" /> 撤回
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 撤回确认 */}
      <AlertDialog open={!!withdrawing} onOpenChange={(v) => !v && setWithdrawing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认撤回公告？</AlertDialogTitle>
            <AlertDialogDescription>
              将撤回公告「{withdrawing?.title}」，所有用户消息中心中的该条通知同步移除，操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void confirmWithdraw()}>
              撤回
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============ 操作日志审计（仅管理员） ============
const PAGE_SIZE = 15

function AuditPanel() {
  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [entity, setEntity] = useState('ALL')
  const [action, setAction] = useState('ALL')
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('') // 防抖后的实际查询关键字
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 关键字 400ms 防抖
  useEffect(() => {
    const t = setTimeout(() => { setQuery(keyword.trim()); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [keyword])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (entity !== 'ALL') params.set('entity', entity)
      if (action !== 'ALL') params.set('action', action)
      if (query) params.set('keyword', query)
      const data = await apiGet<{ logs: AuditLogItem[]; total: number }>(`/api/audit-logs?${params}`)
      setLogs(data.logs); setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载操作日志失败')
    } finally { setLoading(false) }
  }, [page, entity, action, query])

  useEffect(() => { void load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleExport = () => {
    if (logs.length === 0) return
    exportCsv(
      `操作日志_${new Date().toISOString().slice(0, 10)}.csv`,
      ['时间', '操作人', '动作', '模块', '对象', '详情'],
      logs.map((l) => [
        fmtDateTime(l.createdAt),
        l.actorName,
        AUDIT_ACTION_META[l.action]?.label ?? l.action,
        AUDIT_ENTITY_LABEL[l.entity] ?? l.entity,
        l.entityCode ?? '',
        l.detail ?? '',
      ]),
    )
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-emerald-700" />操作日志
              <Badge variant="outline" className="font-normal text-stone-500 border-stone-200">共 {total} 条</Badge>
            </CardTitle>
            <CardDescription>系统管理与业务流转全留痕（谁在何时把哪个单据推进到什么状态）</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={entity} onValueChange={(v) => { setEntity(v); setPage(1) }}>
              <SelectTrigger className="w-[132px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部模块</SelectItem>
                {Object.entries(AUDIT_ENTITY_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={action} onValueChange={(v) => { setAction(v); setPage(1) }}>
              <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部动作</SelectItem>
                {Object.entries(AUDIT_ACTION_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜操作人/对象/详情"
                className="pl-8 h-9 w-[180px]" />
            </div>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void load()}>
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />刷新
            </Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleExport} disabled={loading || logs.length === 0}>
              <Download className="w-3.5 h-3.5" />导出
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-center gap-2">
            <Inbox className="w-4 h-4" />{error}
            <button onClick={() => void load()} className="ml-auto text-xs underline">重试</button>
          </div>
        )}
        <div className="rounded-lg border border-stone-200 overflow-hidden">
          <div className="max-h-[480px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-stone-50 z-10">
                <TableRow className="hover:bg-stone-50">
                  <TableHead className="w-[150px] text-stone-500">时间</TableHead>
                  <TableHead className="w-[100px] text-stone-500">操作人</TableHead>
                  <TableHead className="w-[90px] text-stone-500">动作</TableHead>
                  <TableHead className="w-[100px] text-stone-500">模块</TableHead>
                  <TableHead className="w-[140px] text-stone-500">对象</TableHead>
                  <TableHead className="text-stone-500">详情</TableHead>
                </TableRow>
              </TableHeader>
              {loading ? (
                <TableBody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              ) : logs.length === 0 ? (
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-stone-400">
                      <Inbox className="w-7 h-7 mx-auto mb-2 text-stone-300" />
                      暂无符合条件的操作日志
                    </TableCell>
                  </TableRow>
                </TableBody>
              ) : (
                <TableBody>
                  {logs.map((l) => {
                    const meta = AUDIT_ACTION_META[l.action]
                    return (
                      <TableRow key={l.id} className="hover:bg-stone-50/70">
                        <TableCell className="font-mono text-xs text-stone-500 whitespace-nowrap">{fmtDateTime(l.createdAt)}</TableCell>
                        <TableCell className="text-sm text-stone-700">{l.actorName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-[11px] whitespace-nowrap', meta?.cls ?? 'bg-stone-100 text-stone-600 border-stone-200')}>
                            {meta?.label ?? l.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-stone-500">{AUDIT_ENTITY_LABEL[l.entity] ?? l.entity}</TableCell>
                        <TableCell className="text-sm text-stone-700 max-w-[140px] truncate" title={l.entityCode ?? ''}>{l.entityCode ?? '-'}</TableCell>
                        <TableCell className="text-xs text-stone-500">{l.detail ?? '-'}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              )}
            </Table>
          </div>
        </div>
        {/* 分页 */}
        <div className="mt-3 flex items-center justify-between text-xs text-stone-500">
          <span>第 {page} / {totalPages} 页 · 每页 {PAGE_SIZE} 条</span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============ 主模块 ============
export default function SystemMgmtModule({ initialTab }: ModuleProps) {
  const { toast } = useToast()
  const [users, setUsers] = useState<SystemUser[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SystemUser | null>(null)
  const [form, setForm] = useState<UserForm>(EMPTY_USER_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<SystemUser | null>(null)
  const [currentUser, setCurrentUser] = useState<SystemUser | null>(null)

  const normalizedTab = initialTab === 'announcements' || initialTab === 'audit' ? initialTab : 'users'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<SystemUser[]>('/api/users')
      setUsers(data)
    } catch (err) {
      toast({ title: '加载失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
    try {
      const raw = localStorage.getItem('bp_current_user')
      if (raw) setCurrentUser(JSON.parse(raw) as SystemUser)
    } catch {
      /* 忽略本地缓存解析失败 */
    }
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_USER_FORM)
    setDialogOpen(true)
  }

  const openEdit = (u: SystemUser) => {
    setEditing(u)
    setForm({
      username: u.username,
      name: u.name,
      role: u.role,
      department: u.department ?? '',
      phone: u.phone ?? '',
      password: '',
    })
    setDialogOpen(true)
  }

  const submit = async () => {
    if (!form.username.trim() || !form.name.trim()) {
      toast({ title: '请完善必填项', description: '账号与姓名不能为空', variant: 'destructive' })
      return
    }
    if (!form.role) {
      toast({ title: '请完善必填项', description: '请选择角色', variant: 'destructive' })
      return
    }
    if (!editing && !form.password.trim()) {
      toast({ title: '请完善必填项', description: '新建用户必须设置初始密码', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const actor = { __actorId: currentUser?.id ?? '', __actorName: currentUser?.name ?? '' }
      if (editing) {
        const payload: Partial<UserForm> = { ...form }
        if (!form.password.trim()) delete payload.password // 留空表示不修改密码
        await apiPut(`/api/users/${editing.id}`, { ...payload, ...actor })
        toast({ title: '成功', description: `用户「${form.name}」已更新` })
      } else {
        await apiPost('/api/users', { ...form, ...actor })
        toast({ title: '成功', description: `用户「${form.name}」已创建` })
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await apiDelete(`/api/users/${deleting.id}?__actorId=${encodeURIComponent(currentUser?.id ?? '')}&__actorName=${encodeURIComponent(currentUser?.name ?? '')}`)
      toast({ title: '成功', description: `用户「${deleting.name}」已删除` })
      setDeleting(null)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Tabs key={normalizedTab} defaultValue={normalizedTab} className="w-full">
      <TabsList className="bg-stone-100 mb-4">
        <TabsTrigger value="users" className="gap-1.5">
          <UserRound className="h-3.5 w-3.5" /> 用户管理
        </TabsTrigger>
        <TabsTrigger value="announcements" className="gap-1.5">
          <Megaphone className="h-3.5 w-3.5" /> 公告发布
        </TabsTrigger>
        {currentUser?.role === 'ADMIN' && (
          <TabsTrigger value="audit" className="gap-1.5">
            <History className="h-3.5 w-3.5" /> 操作日志
          </TabsTrigger>
        )}
      </TabsList>

      {/* ============ 用户管理 ============ */}
      <TabsContent value="users" className="mt-0">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings2 className="h-4 w-4 text-emerald-700" />
                  用户管理
                </CardTitle>
                <CardDescription>管理系统账号与角色，默认初始密码 123456</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <RefreshCw className="h-4 w-4" /> 刷新
                </Button>
                <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> 新建用户
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[480px] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>账号</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>部门</TableHead>
                    <TableHead>电话</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                {loading ? (
                  <TableSkeleton cols={7} />
                ) : users.length === 0 ? (
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={7}>
                        <EmptyState icon={<Inbox className="h-8 w-8" />} text="暂无用户，点击「新建用户」添加" />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                ) : (
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-mono text-sm">
                          <span className="inline-flex items-center gap-1.5">
                            <UserRound className="h-3.5 w-3.5 text-stone-400" />
                            {u.username}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell>{roleBadge(u.role)}</TableCell>
                        <TableCell>{u.department || '-'}</TableCell>
                        <TableCell>{u.phone || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={u.active
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-stone-100 text-stone-500 border-stone-200'}>
                            {u.active ? '启用' : '停用'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                              <Pencil className="h-4 w-4" /> 编辑
                            </Button>
                            {currentUser && u.id === currentUser.id ? (
                              <Button
                                variant="ghost" size="sm" disabled
                                title="不能删除当前登录账号"
                              >
                                <Trash2 className="h-4 w-4" /> 删除
                              </Button>
                            ) : (
                              <Button
                                variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => setDeleting(u)}
                              >
                                <Trash2 className="h-4 w-4" /> 删除
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ============ 公告发布 ============ */}
      <TabsContent value="announcements" className="mt-0">
        <AnnouncementPanel currentUser={currentUser} />
      </TabsContent>

      {/* ============ 操作日志（仅管理员） ============ */}
      {currentUser?.role === 'ADMIN' && (
        <TabsContent value="audit" className="mt-0">
          <AuditPanel />
        </TabsContent>
      )}

      {/* 新建/编辑用户 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑用户' : '新建用户'}</DialogTitle>
            <DialogDescription>
              {editing ? '密码留空表示不修改原密码' : '账号需唯一，初始密码建议提示用户首次登录后修改'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>账号 <span className="text-red-500">*</span></Label>
                <Input value={form.username} placeholder="登录账号" onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>姓名 <span className="text-red-500">*</span></Label>
                <Input value={form.name} placeholder="真实姓名" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>角色 <span className="text-red-500">*</span></Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择角色" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_MAP).map(([key, meta]) => (
                      <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>部门</Label>
                <Input value={form.department} placeholder="所属部门" onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>电话</Label>
                <Input value={form.phone} placeholder="联系电话" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>
                  <KeyRound className="mr-1 inline h-3.5 w-3.5 text-stone-400" />
                  密码 {!editing && <span className="text-red-500">*</span>}
                  {editing && <span className="ml-1 text-xs text-stone-400">留空不改</span>}
                </Label>
                <Input
                  type="password" value={form.password} placeholder={editing ? '不修改请留空' : '初始密码（≥8位，含字母+数字）'}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                {!editing && form.password.length > 0 && (form.password.length < 8 || !/[a-zA-Z]/.test(form.password) || !/\d/.test(form.password)) && (
                  <p className="text-xs text-amber-600">初始密码需 ≥8 位且同时包含字母和数字</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除用户？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除用户「{deleting?.name}」（{deleting?.username}），删除后该账号无法登录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  )
}
