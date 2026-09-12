'use client'

// 审批中心：隔离方案/工艺处置方案/作业票 三类审批的集中待办工作台 + 审批留痕查询
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, fmtDateTime } from '@/lib/bp-api'
import { ModuleProps, WORK_TYPE_MAP } from '@/lib/bp-types'
import { exportCsv } from '@/lib/bp-export'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  ShieldCheck, FileSignature, FlaskConical, TicketCheck, History, RefreshCw,
  ClipboardList, User, Clock, CheckCircle2, XCircle, Send, Inbox, Stamp, Search, Download,
  BellRing, AlarmClock, AlertTriangle,
} from 'lucide-react'

// ============ 类型 ============
interface PendingReqBrief { id: number; code: string; title: string; status: string; workType: string; unitName: string | null; applicantName: string }
interface IsoPointItem { id: number; seq: number; location: string; medium: string | null; pressure: string | null; temperature: string | null; blindSpec: string; blindType: string; action: string }
interface IsoPending { id: number; code: string; preparedBy: string; preparedAt: string; pointsCount: number; points: IsoPointItem[]; workRequest: PendingReqBrief | null; submittedBy: string; submittedAt: string }
interface DispStepItem { id: number; seq: number; method: string; detail: string | null; standard: string | null }
interface DispPending { id: number; code: string; preparedBy: string; preparedAt: string; stepsCount: number; steps: DispStepItem[]; workRequest: PendingReqBrief | null; submittedBy: string; submittedAt: string }
interface TicketPending { id: number; code: string; issuer: string; guardian: string; workers: string; plannedStart: string; plannedEnd: string; safetyMeasures: string; createdAt: string; pointId?: number | null; pointCode?: string | null; pointLocation?: string | null; blindSpec?: string | null; blindType?: string | null; action?: string | null; workRequest: PendingReqBrief | null; submittedBy: string; submittedAt: string }
interface ApprovalRecordItem { id: number; bizType: string; bizId: number; bizCode: string | null; action: string; operator: string; comment: string | null; createdAt: string }
type ReminderBizType = 'ISOLATION_SCHEME' | 'DISPOSAL_SCHEME' | 'WORK_TICKET'
interface ReminderItem { bizType: ReminderBizType; bizId: number; code: string; workCode: string | null; label: string; title: string | null; pendingHours: number; submittedBy: string | null; submittedAt: string | null }
interface RemindersData { list: ReminderItem[]; thresholdHours: number }
interface RemindersPostData extends RemindersData { sent: number; skipped: number }
interface ApprovalsData {
  pending: { isolation: IsoPending[]; disposal: DispPending[]; ticket: TicketPending[] }
  counts: { isolation: number; disposal: number; ticket: number; total: number }
  records: ApprovalRecordItem[]
}

const BIZ_TYPE_MAP: Record<string, { label: string; className: string }> = {
  ISOLATION: { label: '隔离方案', className: 'bg-violet-100 text-violet-700 border-violet-200' },
  DISPOSAL: { label: '处置方案', className: 'bg-teal-100 text-teal-700 border-teal-200' },
  TICKET: { label: '作业票', className: 'bg-amber-100 text-amber-700 border-amber-200' },
}
const ACTION_MAP: Record<string, { label: string; className: string }> = {
  SUBMIT: { label: '提交', className: 'bg-stone-100 text-stone-600 border-stone-200' },
  APPROVE: { label: '同意', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  REJECT: { label: '驳回', className: 'bg-rose-100 text-rose-700 border-rose-200' },
}
const METHOD_MAP: Record<string, string> = {
  DEPRESSURIZE: '泄压', DRAIN: '排净', REPLACE: '置换', PURGE: '吹扫',
  GAS_TEST: '气体检测', ISOLATE: '隔离', OTHER: '其他',
}
/** 各业务类型的审核角色（与各模块既有口径一致） */
const REVIEW_ROLES: Record<string, string[]> = {
  isolation: ['REVIEWER', 'ADMIN'],
  disposal: ['REVIEWER', 'ADMIN'],
  ticket: ['REVIEWER', 'MANAGER', 'ADMIN'],
}

type ReviewTarget =
  | { kind: 'isolation'; id: number; code: string }
  | { kind: 'disposal'; id: number; code: string }
  | { kind: 'ticket'; id: number; code: string }

export default function ApprovalCenterModule({ currentUser, initialTab }: ModuleProps) {
  const { toast } = useToast()
  const [data, setData] = useState<ApprovalsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(initialTab === 'records' ? 'records' : 'pending')
  const [review, setReview] = useState<ReviewTarget | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [recType, setRecType] = useState('ALL')
  const [recAction, setRecAction] = useState('ALL')
  const [recSearch, setRecSearch] = useState('')
  const [overdue, setOverdue] = useState<ReminderItem[]>([])
  const [thresholdHours, setThresholdHours] = useState(24)
  const [reminding, setReminding] = useState(false)

  const canReview = useCallback((kind: string) => REVIEW_ROLES[kind]?.includes(currentUser.role) ?? false, [currentUser.role])

  /**
   * 超时扫描：GET（角标/卡片徽章数据）+ POST（幂等催办，同一单据当日仅发一次）并行；
   * POST 失败静默（不阻塞页面），GET 失败时降级用 POST 响应里的 list。
   */
  const loadReminders = useCallback(async () => {
    const [getRes, postRes] = await Promise.allSettled([
      apiGet<RemindersData>('/api/approvals/reminders'),
      apiPost<RemindersPostData>('/api/approvals/reminders'),
    ])
    const d = getRes.status === 'fulfilled' ? getRes.value : postRes.status === 'fulfilled' ? postRes.value : null
    if (!d) return
    setOverdue(d.list ?? [])
    setThresholdHours(d.thresholdHours ?? 24)
    if (postRes.status === 'fulfilled' && postRes.value.sent > 0) {
      window.dispatchEvent(new Event('bp:notifications-changed')) // 铃铛立即刷新（既有联动事件）
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    void loadReminders() // 催办扫描与主数据并行，不阻塞
    try {
      const d = await apiGet<ApprovalsData>('/api/approvals')
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载审批数据失败')
    } finally { setLoading(false) }
  }, [loadReminders])

  useEffect(() => { void load() }, [load])

  const openReview = (t: ReviewTarget) => { setReview(t); setComment('') }

  const doReview = async (approve: boolean) => {
    if (!review) return
    if (!approve && !comment.trim()) {
      toast({ title: '驳回必须填写审核意见', variant: 'destructive' }); return
    }
    setSubmitting(true)
    try {
      if (review.kind === 'isolation') {
        await apiPost(`/api/isolation-schemes/${review.id}/review`, { approve, comment, reviewer: currentUser.name })
      } else if (review.kind === 'disposal') {
        await apiPost(`/api/disposal-schemes/${review.id}/review`, { approve, comment, reviewer: currentUser.name })
      } else {
        await apiPost(`/api/work-tickets/${review.id}/review`, { approve, comment, reviewer: currentUser.name })
      }
      toast({ title: approve ? '审批通过' : '已驳回', description: `${review.code} ${approve ? '审核通过' : '已驳回，编制人可修改后重新提交'}` })
      setReview(null)
      await load()
    } catch (e) {
      toast({ title: '操作失败', description: e instanceof Error ? e.message : '请稍后重试', variant: 'destructive' })
    } finally { setSubmitting(false) }
  }

  /** 手动再发一次催办（幂等：同一单据当日已发过的自动去重跳过） */
  const sendReminders = async () => {
    setReminding(true)
    try {
      const r = await apiPost<RemindersPostData>('/api/approvals/reminders')
      setOverdue(r.list ?? [])
      setThresholdHours(r.thresholdHours ?? 24)
      toast({
        title: r.sent > 0 ? `已发送 ${r.sent} 条催办通知` : '今日催办已发送过',
        description: r.sent > 0 ? `${r.skipped} 张单据当日已催办，自动去重` : '同一单据当日仅催办一次，无需重复发送',
      })
      if (r.sent > 0) window.dispatchEvent(new Event('bp:notifications-changed'))
    } catch (e) {
      toast({ title: '催办发送失败', description: e instanceof Error ? e.message : '请稍后重试', variant: 'destructive' })
    } finally { setReminding(false) }
  }

  /** 某张待审单据的已待审小时数（仅在超过阈值时返回值，用于卡片角标） */
  const overdueHours = useCallback((bizType: ReminderBizType, id: number) =>
    overdue.find((r) => r.bizType === bizType && r.bizId === id)?.pendingHours, [overdue])

  /** 超时单据排前（稳定排序：未超时的保持原顺序） */
  const sortedIso = useMemo(() => [...(data?.pending.isolation ?? [])].sort((a, b) =>
    (overdueHours('ISOLATION_SCHEME', b.id) ?? -1) - (overdueHours('ISOLATION_SCHEME', a.id) ?? -1)), [data, overdueHours])
  const sortedDisp = useMemo(() => [...(data?.pending.disposal ?? [])].sort((a, b) =>
    (overdueHours('DISPOSAL_SCHEME', b.id) ?? -1) - (overdueHours('DISPOSAL_SCHEME', a.id) ?? -1)), [data, overdueHours])
  const sortedTicket = useMemo(() => [...(data?.pending.ticket ?? [])].sort((a, b) =>
    (overdueHours('WORK_TICKET', b.id) ?? -1) - (overdueHours('WORK_TICKET', a.id) ?? -1)), [data, overdueHours])

  const filteredRecords = useMemo(() => {
    const list = data?.records ?? []
    return list.filter((r) => {
      if (recType !== 'ALL' && r.bizType !== recType) return false
      if (recAction !== 'ALL' && r.action !== recAction) return false
      if (recSearch.trim()) {
        const q = recSearch.trim().toLowerCase()
        const hit = (r.bizCode ?? '').toLowerCase().includes(q) || r.operator.toLowerCase().includes(q) || (r.comment ?? '').toLowerCase().includes(q)
        if (!hit) return false
      }
      return true
    })
  }, [data, recType, recAction, recSearch])

  /** 导出当前筛选条件下的审批记录 CSV（列与留痕表格一致） */
  const handleExportRecords = () => {
    exportCsv('审批记录',
      ['时间', '业务类型', '业务编号', '动作', '操作人', '意见'],
      filteredRecords.map((r) => [
        fmtDateTime(r.createdAt),
        BIZ_TYPE_MAP[r.bizType]?.label ?? r.bizType,
        r.bizCode ?? '-',
        ACTION_MAP[r.action]?.label ?? r.action,
        r.operator,
        r.comment ?? '',
      ]))
  }

  const kpis = useMemo(() => [
    { label: '隔离方案待审', value: data?.counts.isolation ?? 0, icon: FileSignature, grad: 'from-violet-400 to-violet-600' },
    { label: '处置方案待审', value: data?.counts.disposal ?? 0, icon: FlaskConical, grad: 'from-teal-400 to-emerald-500' },
    { label: '作业票待批', value: data?.counts.ticket ?? 0, icon: TicketCheck, grad: 'from-amber-400 to-orange-500' },
    { label: '审批留痕', value: data?.records.length ?? 0, icon: Stamp, grad: 'from-stone-400 to-stone-600' },
  ], [data])

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-rose-200 bg-rose-50"><CardContent className="flex items-center gap-2 py-3 text-sm text-rose-700">
          <Inbox className="w-4 h-4" />{error}
          <button onClick={() => void load()} className="ml-auto text-xs underline underline-offset-2">重试</button>
        </CardContent></Card>
      )}

      {/* KPI 四卡 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
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
                    <div className="mt-1 text-3xl font-bold text-stone-800 tabular-nums">{k.value}</div>
                  </div>
                </div>
              )
            })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <TabsList className="bg-stone-100">
            <TabsTrigger value="pending" className="gap-1.5"><ClipboardList className="w-3.5 h-3.5" />待办审批
              {(data?.counts.total ?? 0) > 0 && <Badge className="ml-1 bg-rose-500 text-white border-0 px-1.5 min-w-5 h-5 text-[11px]">{data?.counts.total}</Badge>}
              {overdue.length > 0 && (
                <Badge className="ml-1 bg-rose-100 text-rose-700 border-rose-200 px-1.5 min-w-5 h-5 text-[11px] gap-0.5"
                  title={`${overdue.length} 张单据待审超过 ${thresholdHours} 小时，已发送催办通知`}>
                  <BellRing className="w-3 h-3" />{overdue.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="records" className="gap-1.5"><History className="w-3.5 h-3.5" />审批记录</TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />刷新
          </Button>
        </div>

        {/* ============ 待办审批 ============ */}
        <TabsContent value="pending" className="space-y-4 mt-4">
          {!loading && overdue.length > 0 && (data?.counts.total ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2 flex-wrap">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-sm text-amber-800">
                <span className="font-semibold">{overdue.length}</span> 张单据待审超过 {thresholdHours} 小时，已自动发送催办通知（同一单据当日仅催办一次）
              </span>
              <Button size="sm" variant="outline" disabled={reminding} onClick={() => void sendReminders()}
                className="ml-auto border-amber-300 text-amber-700 hover:bg-amber-100 hover:text-amber-800 gap-1.5 shrink-0">
                <BellRing className={cn('w-3.5 h-3.5', reminding && 'animate-pulse')} />{reminding ? '发送中…' : '发送催办'}
              </Button>
            </div>
          )}
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
          ) : (data?.counts.total ?? 0) === 0 ? (
            <Card><CardContent className="py-16 text-center text-sm text-stone-400">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-emerald-200" />
              暂无待审批事项<br /><span className="text-xs">隔离方案、工艺处置方案、作业票提交审批后将集中显示在此</span>
            </CardContent></Card>
          ) : (
            <>
              {/* 隔离方案 */}
              {sortedIso.length > 0 && (
                <Section icon={FileSignature} title="隔离方案审批" tone="violet" count={sortedIso.length}>
                  {sortedIso.map((s) => (
                    <div key={s.id} className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-stone-800">{s.code}</span>
                            <Badge className="bg-violet-100 text-violet-700 border-violet-200" variant="outline">待审核</Badge>
                            <OverdueBadge hours={overdueHours('ISOLATION_SCHEME', s.id)} />
                            {s.workRequest && <Badge variant="outline" className={cn('text-[10px]', 'bg-stone-50 text-stone-500 border-stone-200')}>{WORK_TYPE_MAP[s.workRequest.workType] ?? s.workRequest.workType}</Badge>}
                          </div>
                          {s.workRequest && (
                            <div className="mt-1 text-xs text-stone-500 truncate">
                              {s.workRequest.title} · {s.workRequest.unitName ?? '-'} · 申请人 {s.workRequest.applicantName}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-stone-400 flex-wrap">
                            <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{s.submittedBy} 提交于 {fmtDateTime(s.submittedAt)}</span>
                            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />编制 {s.preparedBy}</span>
                            <span>{s.pointsCount} 个隔离点</span>
                          </div>
                        </div>
                        {canReview('isolation') ? (
                          <Button size="sm" className="bg-violet-700 hover:bg-violet-800 text-white shrink-0" onClick={() => openReview({ kind: 'isolation', id: s.id, code: s.code })}>
                            <Stamp className="w-3.5 h-3.5 mr-1" />审核
                          </Button>
                        ) : (
                          <Badge variant="outline" className="shrink-0 text-[10px] text-stone-400">需 方案审核人 角色</Badge>
                        )}
                      </div>
                      {/* 隔离点预览 */}
                      <div className="rounded-md border border-stone-100 overflow-x-auto">
                        <table className="w-full text-xs min-w-[560px]">
                          <thead><tr className="bg-stone-50 text-stone-400">
                            <th className="px-2.5 py-1.5 text-left font-medium w-10">#</th>
                            <th className="px-2.5 py-1.5 text-left font-medium">隔离位置</th>
                            <th className="px-2.5 py-1.5 text-left font-medium">介质</th>
                            <th className="px-2.5 py-1.5 text-left font-medium">规格/类型</th>
                            <th className="px-2.5 py-1.5 text-left font-medium">操作</th>
                          </tr></thead>
                          <tbody>
                            {s.points.map((p) => (
                              <tr key={p.id} className="border-t border-stone-100">
                                <td className="px-2.5 py-1.5 text-stone-400">{p.seq}</td>
                                <td className="px-2.5 py-1.5 text-stone-700">{p.location}</td>
                                <td className="px-2.5 py-1.5 text-stone-500">{p.medium ?? '-'}</td>
                                <td className="px-2.5 py-1.5 text-stone-500">{p.blindSpec} · {p.blindType}</td>
                                <td className="px-2.5 py-1.5">
                                  <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border',
                                    p.action === 'ADD' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-orange-50 text-orange-700 border-orange-200')}>
                                    {p.action === 'ADD' ? '加装盲板' : '拆除盲板'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {/* 工艺处置方案 */}
              {sortedDisp.length > 0 && (
                <Section icon={FlaskConical} title="工艺处置方案审批" tone="teal" count={sortedDisp.length}>
                  {sortedDisp.map((s) => (
                    <div key={s.id} className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-stone-800">{s.code}</span>
                            <Badge className="bg-teal-100 text-teal-700 border-teal-200" variant="outline">待审核</Badge>
                            <OverdueBadge hours={overdueHours('DISPOSAL_SCHEME', s.id)} />
                          </div>
                          {s.workRequest && (
                            <div className="mt-1 text-xs text-stone-500 truncate">
                              {s.workRequest.title} · {s.workRequest.unitName ?? '-'} · 申请人 {s.workRequest.applicantName}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-stone-400 flex-wrap">
                            <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{s.submittedBy} 提交于 {fmtDateTime(s.submittedAt)}</span>
                            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />编制 {s.preparedBy}</span>
                            <span>{s.stepsCount} 个处置步骤</span>
                          </div>
                        </div>
                        {canReview('disposal') ? (
                          <Button size="sm" className="bg-teal-700 hover:bg-teal-800 text-white shrink-0" onClick={() => openReview({ kind: 'disposal', id: s.id, code: s.code })}>
                            <Stamp className="w-3.5 h-3.5 mr-1" />审核
                          </Button>
                        ) : (
                          <Badge variant="outline" className="shrink-0 text-[10px] text-stone-400">需 方案审核人 角色</Badge>
                        )}
                      </div>
                      <ol className="space-y-1.5">
                        {s.steps.map((st) => (
                          <li key={st.id} className="flex items-start gap-2 text-xs rounded-md bg-stone-50/70 border border-stone-100 px-2.5 py-1.5">
                            <span className="w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] flex items-center justify-center shrink-0 mt-0.5">{st.seq}</span>
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-stone-700">{METHOD_MAP[st.method] ?? st.method}</span>
                              {st.detail && <span className="text-stone-500"> · {st.detail}</span>}
                              {st.standard && <div className="text-[11px] text-emerald-700 mt-0.5">合格标准：{st.standard}</div>}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </Section>
              )}

              {/* 作业票 */}
              {sortedTicket.length > 0 && (
                <Section icon={TicketCheck} title="作业票批准" tone="amber" count={sortedTicket.length}>
                  {sortedTicket.map((t) => (
                    <div key={t.id} className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-stone-800">{t.code}</span>
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200" variant="outline">待批准</Badge>
                            <OverdueBadge hours={overdueHours('WORK_TICKET', t.id)} />
                          </div>
                          {t.workRequest && (
                            <div className="mt-1 text-xs text-stone-500 truncate">
                              {t.workRequest.title} · {t.workRequest.unitName ?? '-'} · 申请人 {t.workRequest.applicantName}
                            </div>
                          )}
                          {/* 一票一板：票面点位信息 */}
                          {t.pointCode && (
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                              <span className="rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[10px] font-mono text-teal-700">{t.pointCode}</span>
                              {t.pointLocation && <span className="text-[11px] text-stone-500 truncate max-w-[320px]">{t.pointLocation}</span>}
                              <span className="text-[10px] text-stone-400">{t.action === 'ADD' ? '装盲板' : t.action === 'REMOVE' ? '拆盲板' : ''}{t.blindSpec ? ` · ${t.blindSpec}` : ''}{t.blindType ? ` · ${t.blindType}` : ''}</span>
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-stone-400 flex-wrap">
                            <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{t.submittedBy} 提交于 {fmtDateTime(t.submittedAt)}</span>
                            <span>监护人 {t.guardian}</span>
                            <span>作业人 {t.workers}</span>
                          </div>
                        </div>
                        {canReview('ticket') ? (
                          <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shrink-0" onClick={() => openReview({ kind: 'ticket', id: t.id, code: t.code })}>
                            <Stamp className="w-3.5 h-3.5 mr-1" />批准
                          </Button>
                        ) : (
                          <Badge variant="outline" className="shrink-0 text-[10px] text-stone-400">需 分管领导/审核人 角色</Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <Kv label="计划开始" value={fmtDateTime(t.plannedStart)} />
                        <Kv label="计划结束" value={fmtDateTime(t.plannedEnd)} />
                        <Kv label="签发人" value={t.issuer} />
                        <Kv label="票面状态" value="待批准" />
                      </div>
                      {t.safetyMeasures && (
                        <div className="rounded-md bg-amber-50/60 border border-amber-100 px-3 py-2 text-xs text-amber-900 whitespace-pre-line leading-relaxed">
                          <span className="font-semibold">安全措施：</span>{t.safetyMeasures}
                        </div>
                      )}
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </TabsContent>

        {/* ============ 审批记录 ============ */}
        <TabsContent value="records" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm font-semibold text-stone-700 flex items-center gap-2">
                  <History className="w-4 h-4 text-stone-400" />审批留痕（最近 {filteredRecords.length} 条）
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-stone-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input value={recSearch} onChange={(e) => setRecSearch(e.target.value)} placeholder="搜编号/操作人/意见"
                      className="h-8 w-44 rounded-md border border-stone-200 pl-7 pr-2 text-xs outline-none focus:border-emerald-400" />
                  </div>
                  <Select value={recType} onValueChange={setRecType}>
                    <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">全部类型</SelectItem>
                      {Object.entries(BIZ_TYPE_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={recAction} onValueChange={setRecAction}>
                    <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">全部动作</SelectItem>
                      {Object.entries(ACTION_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={loading || filteredRecords.length === 0}
                    onClick={handleExportRecords}
                  >
                    <Download className="h-3.5 w-3.5" />导出 CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-md" />)}</div>
              ) : filteredRecords.length === 0 ? (
                <div className="py-14 text-center text-sm text-stone-400">
                  <Inbox className="w-8 h-8 mx-auto mb-2 text-stone-200" />暂无审批记录
                </div>
              ) : (
                <div className="max-h-[560px] overflow-y-auto">
                  <table className="w-full text-xs min-w-[680px]">
                    <thead className="sticky top-0 bg-stone-50 z-10">
                      <tr className="text-stone-400 border-b border-stone-100">
                        <th className="px-4 py-2.5 text-left font-medium">时间</th>
                        <th className="px-3 py-2.5 text-left font-medium">类型</th>
                        <th className="px-3 py-2.5 text-left font-medium">单据编号</th>
                        <th className="px-3 py-2.5 text-left font-medium">动作</th>
                        <th className="px-3 py-2.5 text-left font-medium">操作人</th>
                        <th className="px-4 py-2.5 text-left font-medium">意见</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.map((r) => {
                        const bt = BIZ_TYPE_MAP[r.bizType] ?? { label: r.bizType, className: 'bg-stone-100 text-stone-600 border-stone-200' }
                        const act = ACTION_MAP[r.action] ?? { label: r.action, className: 'bg-stone-100 text-stone-600 border-stone-200' }
                        return (
                          <tr key={r.id} className="border-b border-stone-50 hover:bg-stone-50/60 transition-colors">
                            <td className="px-4 py-2.5 text-stone-500 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                            <td className="px-3 py-2.5"><Badge variant="outline" className={cn('text-[10px]', bt.className)}>{bt.label}</Badge></td>
                            <td className="px-3 py-2.5 font-mono text-stone-700">{r.bizCode ?? '-'}</td>
                            <td className="px-3 py-2.5">
                              <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border', act.className)}>
                                {r.action === 'APPROVE' && <CheckCircle2 className="w-3 h-3" />}
                                {r.action === 'REJECT' && <XCircle className="w-3 h-3" />}
                                {r.action === 'SUBMIT' && <Send className="w-3 h-3" />}
                                {act.label}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-stone-700 whitespace-nowrap">{r.operator}</td>
                            <td className="px-4 py-2.5 text-stone-500 max-w-[280px] truncate" title={r.comment ?? ''}>{r.comment ?? '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 审核 Dialog */}
      <Dialog open={!!review} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stamp className="w-4 h-4 text-emerald-600" />
              {review?.kind === 'ticket' ? '作业票批准' : '方案审核'} · <span className="font-mono">{review?.code}</span>
            </DialogTitle>
            <DialogDescription>
              {review?.kind === 'ticket' ? '批准后作业任务方可下发执行；驳回则退回签发人' : '通过后进入下一环节；驳回后编制人可修改重新提交'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-stone-500 mb-1 block">审核意见 {review?.kind !== 'ticket' && <span className="text-stone-300">（驳回必填）</span>}</label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
                placeholder={review?.kind === 'ticket' ? '如：同意，注意现场气体检测' : '如：隔离点设置合理，同意执行'} />
            </div>
            <div className="rounded-md bg-stone-50 border border-stone-100 px-3 py-2 text-xs text-stone-500">
              审核人：<span className="font-medium text-stone-700">{currentUser.name}</span>（{currentUser.department ?? '-'}）
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setReview(null)} disabled={submitting}>取消</Button>
            <Button variant="destructive" size="sm" onClick={() => void doReview(false)} disabled={submitting} className="gap-1">
              <XCircle className="w-3.5 h-3.5" />{submitting ? '处理中…' : '驳回'}
            </Button>
            <Button size="sm" onClick={() => void doReview(true)} disabled={submitting}
              className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />{submitting ? '处理中…' : '同意'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============ 小组件 ============
/** 超时待审角标：仅当该单据待审时长超过阈值（ reminders 接口返回的 thresholdHours）时显示 */
function OverdueBadge({ hours }: { hours: number | undefined }) {
  if (hours === undefined) return null
  return (
    <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 gap-1 shrink-0">
      <AlarmClock className="w-3 h-3" />已待审 {hours} 小时
    </Badge>
  )
}

function Section({ icon: Icon, title, tone, count, children }: {
  icon: React.ComponentType<{ className?: string }>; title: string; tone: 'violet' | 'teal' | 'amber'; count: number; children: React.ReactNode
}) {
  const toneCls = tone === 'violet' ? 'text-violet-600 bg-violet-50 border-violet-200' : tone === 'teal' ? 'text-teal-600 bg-teal-50 border-teal-200' : 'text-amber-600 bg-amber-50 border-amber-200'
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className={cn('w-7 h-7 rounded-lg border flex items-center justify-center', toneCls)}><Icon className="w-4 h-4" /></span>
        <span className="text-sm font-semibold text-stone-700">{title}</span>
        <Badge variant="outline" className="text-[10px] text-stone-400">{count} 项待处理</Badge>
      </div>
      {children}
    </div>
  )
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-stone-50/80 border border-stone-100 px-2.5 py-1.5">
      <div className="text-[10px] text-stone-400">{label}</div>
      <div className="text-stone-700 truncate" title={value}>{value || '-'}</div>
    </div>
  )
}
