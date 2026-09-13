'use client'
// 现场作业（移动端）：勘察拍照 / 工艺处置现场确认 / 现场交底（拍照+录音+作业方确认+AI位置核对） / 作业拍照核对 / 验收拍照核对
// 移动优先单列布局（真机全宽，桌面居中）；配色：AI=violet、teal 主操作、rose 不一致警告、amber 定位
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, apiPatch, apiDelete, fmtDate, fmtDateTime } from '@/lib/bp-api'
import type { ModuleProps } from '@/lib/bp-types'
import { URGENCY_MAP } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  AttachmentWall, AiCheckCard, InconsistentWarning, PhotoPicker, VoiceRecorder,
  type AttachmentDto, type PhotoCheckDto,
} from '@/components/bp/bp-media'
import {
  ChevronLeft, MapPin, ClipboardCheck, Megaphone, HardHat, ListChecks, RefreshCw,
  Loader2, Camera, Mic, Sparkles, CircleCheck, AlertTriangle, ChevronRight,
  ClipboardList, ShieldCheck, PlayCircle, FileCheck2, Search, Settings2, Undo2,
} from 'lucide-react'

// ============ 类型 ============
interface ReqLite {
  id: number; code: string; title: string; workType: string; location: string
  status: string; medium: string | null; pressure: string | null; temperature: string | null
  urgency: string; plannedStart: string | null; plannedEnd: string | null
  unit?: { id: number; name: string; code: string } | null
}
interface TicketLite {
  id: number; code: string; workRequestId: number; status: string
  pointCode: string | null; pointLocation: string | null
  blindSpec: string | null; blindType: string | null; action: string | null
  guardian: string; workers: string; safetyMeasures: string
  plannedStart: string; plannedEnd: string
  workRequest?: ReqLite | null
}
interface BriefingRow {
  id: number; workRequestId: number; ticketId: number | null; ticketCode: string | null
  pointCode: string | null; pointLocation: string | null
  briefingUser: string; briefingUserId: string | null; briefedUsers: string | null
  content: string; status: string
  confirmedBy: string | null; confirmedAt: string | null; confirmRemark: string | null
  aiCheckResult: string | null
  createdAt: string
}
interface MasterPoint { id: number; code: string; name: string; location: string | null; pipelineId: number | null; pipeline?: { code: string; name: string } | null }
interface DisposalStepRow {
  id: number; seq: number; method: string; detail: string; standard: string | null
  completed: boolean; confirmResult: string | null; confirmRemark: string | null; masterCode?: string | null
}
const METHOD_ZH: Record<string, string> = {
  VENT: '泄压降压', DRAIN: '排净', REPLACE: '置换', PURGE: '吹扫', STEAM: '蒸煮',
  GAS_TEST: '气体检测', ISOLATE: '切断加盲板', OTHER: '其他',
}

type View =
  | { kind: 'todo' }
  | { kind: 'survey'; reqId: number }
  | { kind: 'confirm'; reqId: number }
  | { kind: 'brief-new'; ticketId: number }
  | { kind: 'brief-confirm'; briefingId: number }
  | { kind: 'brief-manage'; briefingId: number }
  | { kind: 'exec'; ticketId: number }
  | { kind: 'accept'; reqId: number }

// ============ 角色门槛（与业务职责对应） ============
const ROLES = {
  survey: ['ENGINEER', 'ADMIN'],
  confirm: ['ENGINEER', 'ADMIN'],
  briefNew: ['GUARDIAN', 'ENGINEER', 'ADMIN'],
  briefConfirm: ['OPERATOR', 'GUARDIAN', 'ADMIN'],
  exec: ['OPERATOR', 'GUARDIAN', 'ENGINEER', 'ADMIN'],
  accept: ['ACCEPTOR', 'MANAGER', 'ADMIN'],
} as const
const hasRole = (role: string | undefined, list: readonly string[]) => !!role && list.includes(role)

// ============ 主组件 ============
export default function FieldOpsModule({ currentUser }: ModuleProps) {
  const { toast } = useToast()
  const [view, setView] = useState<View>({ kind: 'todo' })
  const [reqs, setReqs] = useState<ReqLite[]>([])
  const [tickets, setTickets] = useState<TicketLite[]>([])
  const [briefings, setBriefings] = useState<BriefingRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [r, t, b] = await Promise.all([
        apiGet<ReqLite[]>('/api/work-requests'),
        apiGet<TicketLite[]>('/api/work-tickets'),
        apiGet<BriefingRow[]>('/api/briefings'),
      ])
      setReqs(r)
      setTickets(t)
      setBriefings(b)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const role = currentUser?.role
  // 各环节待办（按角色可见性聚合）
  const surveyTodos = useMemo(() => hasRole(role, ROLES.survey) ? reqs.filter((r) => r.status === 'PENDING_SURVEY') : [], [reqs, role])
  const confirmTodos = useMemo(() => hasRole(role, ROLES.confirm) ? reqs.filter((r) => r.status === 'PENDING_CONFIRM') : [], [reqs, role])
  // 交底：已批准的票（需求处于 TICKET_APPROVED）；区分 未交底 / 已交底待确认
  const briefNewTodos = useMemo(() => {
    if (!hasRole(role, ROLES.briefNew)) return []
    return tickets.filter((t) => t.status === 'APPROVED' && reqs.find((r) => r.id === t.workRequestId)?.status === 'TICKET_APPROVED')
  }, [tickets, reqs, role])
  const briefConfirmTodos = useMemo(() => hasRole(role, ROLES.briefConfirm) ? briefings.filter((b) => b.status === 'PENDING') : [], [briefings, role])
  // 作业：进行中 + 已批准且交底已确认（待开工）
  const execStartTodos = useMemo(() => {
    if (!hasRole(role, ROLES.exec)) return []
    return tickets.filter((t) => t.status === 'APPROVED' && briefings.some((b) => b.ticketId === t.id && b.status === 'CONFIRMED'))
  }, [tickets, briefings, role])
  const execTodos = useMemo(() => hasRole(role, ROLES.exec) ? tickets.filter((t) => t.status === 'IN_PROGRESS') : [], [tickets, role])
  const acceptTodos = useMemo(() => hasRole(role, ROLES.accept) ? reqs.filter((r) => r.status === 'PENDING_ACCEPTANCE') : [], [reqs, role])

  const startTicket = async (ticket: TicketLite) => {
    try {
      await apiPost(`/api/work-tickets/${ticket.id}/start`, { __actorId: currentUser?.id, __actorName: currentUser?.name })
      toast({ title: '已开工', description: `作业票 ${ticket.code} 进入作业中——请先拍摄作业位置照片并完成 AI 核对` })
      await refresh()
    } catch (e) {
      toast({ variant: 'destructive', title: '开工被拒绝', description: e instanceof Error ? e.message : '请稍后重试' })
    }
  }

  const totalTodos = surveyTodos.length + confirmTodos.length + briefNewTodos.length + briefConfirmTodos.length + execStartTodos.length + execTodos.length + acceptTodos.length

  return (
    <div className="min-h-[60vh] bg-stone-100">
      <div className="mx-auto max-w-md px-3 py-4 space-y-3 pb-10">
        {view.kind === 'todo' && (
          <>
            {/* 顶部状态条 */}
            <div className="rounded-xl bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-600 text-white p-4 shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5"><HardHat className="w-4 h-4" />现场作业</p>
                  <p className="text-[11px] text-teal-100 mt-0.5">{currentUser?.name ?? '未登录'} · 移动端现场操作（勘察/处置确认/交底/作业/验收）</p>
                </div>
                <button onClick={() => void refresh()} className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="刷新" title="刷新">
                  <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded-full bg-white/20">我的待办 {totalTodos} 项</span>
                <span className="text-teal-100/80">{fmtDate(new Date())}</span>
              </div>
            </div>

            {loading ? (
              <Skeleton className="h-32 rounded-xl" />
            ) : totalTodos === 0 ? (
              <div className="rounded-xl bg-white p-8 text-center space-y-2">
                <CircleCheck className="w-10 h-10 text-emerald-500 mx-auto" />
                <p className="text-sm text-stone-600">当前没有需要现场处理的任务</p>
                <p className="text-[11px] text-stone-400">待办将随流程推进自动出现在这里（勘察→处置确认→交底→作业→验收）</p>
              </div>
            ) : (
              <div className="space-y-3">
                {surveyTodos.length > 0 && (
                  <TodoSection icon={<MapPin className="w-4 h-4" />} title="现场勘察" tone="teal"
                    desc="确认隔离点位置，多角度拍照留证">
                    {surveyTodos.map((r) => (
                      <TodoCard key={r.id} req={r} actionText="去勘察" onClick={() => setView({ kind: 'survey', reqId: r.id })} />
                    ))}
                  </TodoSection>
                )}
                {confirmTodos.length > 0 && (
                  <TodoSection icon={<ClipboardCheck className="w-4 h-4" />} title="工艺处置现场确认" tone="teal"
                    desc="逐项确认处置步骤、录入气体检测、现场拍照">
                    {confirmTodos.map((r) => (
                      <TodoCard key={r.id} req={r} actionText="去确认" onClick={() => setView({ kind: 'confirm', reqId: r.id })} />
                    ))}
                  </TodoSection>
                )}
                {briefNewTodos.length > 0 && (
                  <TodoSection icon={<Megaphone className="w-4 h-4" />} title="现场交底（交底方）" tone="violet"
                    desc="拍照+录音向作业方交底；提交后 AI 自动与勘察照片核对位置">
                    {briefNewTodos.map((t) => {
                      const pending = briefings.find((b) => b.ticketId === t.id && b.status === 'PENDING')
                      return (
                        <button key={t.id}
                          onClick={() => pending ? setView({ kind: 'brief-manage', briefingId: pending.id }) : setView({ kind: 'brief-new', ticketId: t.id })}
                          className={cn('w-full text-left rounded-lg border p-3 bg-white space-y-1', pending ? 'hover:border-violet-300 transition-colors' : 'hover:border-violet-300 transition-colors')}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono text-stone-500">{t.code}</span>
                            {pending
                              ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">待作业方确认 · 点击管理/补录</span>
                              : <span className="text-[10px] text-violet-600 flex items-center">去交底 <ChevronRight className="w-3 h-3" /></span>}
                          </div>
                          <p className="text-xs font-medium text-stone-800 truncate">{t.pointCode ? `[${t.pointCode}] ` : ''}{t.pointLocation ?? ''}</p>
                          <p className="text-[10px] text-stone-400">{t.blindSpec ?? ''} {t.blindType ?? ''} · {t.action === 'ADD' ? '加装盲板' : t.action === 'REMOVE' ? '拆除盲板' : ''}</p>
                        </button>
                      )
                    })}
                  </TodoSection>
                )}
                {briefConfirmTodos.length > 0 && (
                  <TodoSection icon={<ShieldCheck className="w-4 h-4" />} title="交底确认（作业方）" tone="violet"
                    desc="查看交底内容/照片/录音与 AI 核对结果后确认">
                    {briefConfirmTodos.map((b) => (
                      <button key={b.id} onClick={() => setView({ kind: 'brief-confirm', briefingId: b.id })}
                        className="w-full text-left rounded-lg border p-3 bg-white space-y-1 hover:border-violet-300 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono text-stone-500">{b.ticketCode ?? '需求级交底'}</span>
                          <span className="text-[10px] text-violet-600 flex items-center">查看并确认 <ChevronRight className="w-3 h-3" /></span>
                        </div>
                        <p className="text-xs font-medium text-stone-800 truncate">{b.pointCode ? `[${b.pointCode}] ` : ''}{b.pointLocation ?? ''}</p>
                        <p className="text-[10px] text-stone-400">{fmtDateTime(b.createdAt)} · 交底人 {b.briefingUser}</p>
                      </button>
                    ))}
                  </TodoSection>
                )}
                {execStartTodos.length > 0 && (
                  <TodoSection icon={<PlayCircle className="w-4 h-4" />} title="待开工（交底已确认）" tone="emerald"
                    desc="开工后请立即拍摄作业位置照片完成 AI 核对">
                    {execStartTodos.map((t) => (
                      <div key={t.id} className="rounded-lg border p-3 bg-white space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono text-stone-500">{t.code}</span>
                        </div>
                        <p className="text-xs font-medium text-stone-800 truncate">{t.pointCode ? `[${t.pointCode}] ` : ''}{t.pointLocation ?? ''}</p>
                        <Button size="sm" className="h-8 w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => void startTicket(t)}>
                          <PlayCircle className="w-3.5 h-3.5 mr-1" />确认开工
                        </Button>
                      </div>
                    ))}
                  </TodoSection>
                )}
                {execTodos.length > 0 && (
                  <TodoSection icon={<HardHat className="w-4 h-4" />} title="作业中（拍照核对）" tone="violet"
                    desc="作业位置拍照，AI 与交底照片核对一致性">
                    {execTodos.map((t) => (
                      <TodoTicketCard key={t.id} ticket={t} actionText="作业核对" onClick={() => setView({ kind: 'exec', ticketId: t.id })} />
                    ))}
                  </TodoSection>
                )}
                {acceptTodos.length > 0 && (
                  <TodoSection icon={<ListChecks className="w-4 h-4" />} title="作业验收" tone="teal"
                    desc="验收拍照，AI 核对；不一致将警告">
                    {acceptTodos.map((r) => (
                      <TodoCard key={r.id} req={r} actionText="去验收" onClick={() => setView({ kind: 'accept', reqId: r.id })} />
                    ))}
                  </TodoSection>
                )}
              </div>
            )}
          </>
        )}

        {view.kind === 'survey' && <SurveyPage reqId={view.reqId} currentUser={currentUser} onBack={async () => { setView({ kind: 'todo' }); await refresh() }} />}
        {view.kind === 'confirm' && <DisposalConfirmPage reqId={view.reqId} currentUser={currentUser} onBack={async () => { setView({ kind: 'todo' }); await refresh() }} />}
        {view.kind === 'brief-new' && <BriefNewPage ticketId={view.ticketId} currentUser={currentUser} onBack={async () => { setView({ kind: 'todo' }); await refresh() }} onManage={(id) => setView({ kind: 'brief-manage', briefingId: id })} />}
        {view.kind === 'brief-manage' && <BriefManagePage briefingId={view.briefingId} currentUser={currentUser} onBack={async () => { setView({ kind: 'todo' }); await refresh() }} />}
        {view.kind === 'brief-confirm' && <BriefConfirmPage briefingId={view.briefingId} currentUser={currentUser} onBack={async () => { setView({ kind: 'todo' }); await refresh() }} />}
        {view.kind === 'exec' && <ExecPage ticketId={view.ticketId} currentUser={currentUser} onBack={async () => { setView({ kind: 'todo' }); await refresh() }} />}
        {view.kind === 'accept' && <AcceptPage reqId={view.reqId} currentUser={currentUser} onBack={async () => { setView({ kind: 'todo' }); await refresh() }} />}
      </div>
    </div>
  )
}

// ============ 待办区块/卡片 ============
function TodoSection(props: { icon: React.ReactNode; title: string; desc: string; tone: 'teal' | 'violet' | 'emerald'; children: React.ReactNode }) {
  const toneCls = props.tone === 'violet' ? 'text-violet-600' : props.tone === 'emerald' ? 'text-emerald-600' : 'text-teal-600'
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <span className={toneCls}>{props.icon}</span>
        <h3 className="text-xs font-semibold text-stone-700">{props.title}</h3>
        <span className="text-[10px] text-stone-400 truncate">{props.desc}</span>
      </div>
      <div className="space-y-2">{props.children}</div>
    </section>
  )
}

function ReqHead({ req }: { req: ReqLite }) {
  const urgency = URGENCY_MAP[req.urgency]
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono text-stone-500">{req.code}</span>
        {urgency && req.urgency === 'HIGH' && <span className={cn('text-[9px] px-1 rounded border', urgency.className)}>{urgency.label}急</span>}
      </div>
      <p className="text-xs font-medium text-stone-800 leading-snug">{req.title}</p>
      <p className="text-[10px] text-stone-400 truncate">{req.unit?.name ?? ''} · {req.location}{req.medium ? ` · ${req.medium}` : ''}</p>
    </div>
  )
}

function TodoCard(props: { req: ReqLite; actionText: string; onClick: () => void }) {
  return (
    <button onClick={props.onClick} className="w-full text-left rounded-lg border p-3 bg-white hover:border-teal-300 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <ReqHead req={props.req} />
        <span className="text-[10px] text-teal-600 shrink-0 flex items-center">{props.actionText} <ChevronRight className="w-3 h-3" /></span>
      </div>
    </button>
  )
}

function TodoTicketCard(props: { ticket: TicketLite; actionText: string; onClick: () => void }) {
  const t = props.ticket
  return (
    <button onClick={props.onClick} className="w-full text-left rounded-lg border p-3 bg-white hover:border-teal-300 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <span className="text-xs font-mono text-stone-500">{t.code}</span>
          <p className="text-xs font-medium text-stone-800 truncate">{t.pointCode ? `[${t.pointCode}] ` : ''}{t.pointLocation ?? ''}</p>
          <p className="text-[10px] text-stone-400 truncate">{t.workRequest?.code ? `${t.workRequest.code} · ` : ''}{t.workRequest?.title ?? ''}</p>
        </div>
        <span className="text-[10px] text-teal-600 shrink-0 flex items-center">{props.actionText} <ChevronRight className="w-3 h-3" /></span>
      </div>
    </button>
  )
}

// ============ 页面壳（顶栏返回） ============
function PageShell(props: { title: string; sub?: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-3 px-3 py-2.5 bg-stone-100/95 backdrop-blur flex items-center gap-2 border-b border-stone-200">
        <button onClick={props.onBack} className="w-8 h-8 rounded-full bg-white border border-stone-200 flex items-center justify-center hover:bg-stone-50" aria-label="返回">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-800 leading-tight">{props.title}</p>
          {props.sub && <p className="text-[10px] text-stone-400 truncate">{props.sub}</p>}
        </div>
      </div>
      {props.children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2 text-[11px] leading-relaxed">
      <span className="text-stone-400 shrink-0">{label}</span>
      <span className="text-stone-700 break-all">{value}</span>
    </div>
  )
}

// ============ ① 现场勘察页 ============
function SurveyPage(props: { reqId: number; currentUser: ModuleProps['currentUser']; onBack: () => void }) {
  const { reqId, currentUser, onBack } = props
  const { toast } = useToast()
  const [req, setReq] = useState<(ReqLite & { survey?: { id: number; siteCondition: string; hazardPoints: string | null; suggestion: string | null; isSafe: boolean; pointRefs: string | null } }) | null>(null)
  const [masters, setMasters] = useState<MasterPoint[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [photosByPoint, setPhotosByPoint] = useState<Record<string, AttachmentDto[]>>({})
  const [generalPhotos, setGeneralPhotos] = useState<AttachmentDto[]>([])
  const [condition, setCondition] = useState('')
  const [hazards, setHazards] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [isSafe, setIsSafe] = useState(true)
  const [kw, setKw] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const [detail, mp] = await Promise.all([
          apiGet<ReqLite & { survey?: SurveyRow }>(`/api/work-requests/${reqId}`),
          apiGet<{ list?: MasterPoint[] } | MasterPoint[]>('/api/iso-point-masters'),
        ])
        setReq(detail)
        setMasters(Array.isArray(mp) ? mp : mp.list ?? [])
        if (detail.survey) {
          setCondition(detail.survey.siteCondition ?? '')
          setHazards(detail.survey.hazardPoints ?? '')
          setSuggestion(detail.survey.suggestion ?? '')
          setIsSafe(detail.survey.isSafe ?? true)
          try {
            const refs = JSON.parse(detail.survey.pointRefs ?? '[]') as { masterPointId: number }[]
            setSelected(refs.map((r) => r.masterPointId).filter(Boolean))
          } catch { /* 忽略 */ }
        }
      } finally {
        setLoading(false)
      }
    })()
     
  }, [reqId])
  interface SurveyRow { id: number; siteCondition: string; hazardPoints: string | null; suggestion: string | null; isSafe: boolean; pointRefs: string | null }

  const filteredMasters = useMemo(() => {
    const k = kw.trim().toLowerCase()
    if (!k) return masters
    return masters.filter((m) => `${m.code} ${m.name} ${m.location ?? ''}`.toLowerCase().includes(k))
  }, [masters, kw])
  const selectedPoints = masters.filter((m) => selected.includes(m.id))
  const allPhotos = [...generalPhotos, ...Object.values(photosByPoint).flat()]

  const togglePoint = (id: number) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const submit = async () => {
    if (!condition.trim()) { toast({ variant: 'destructive', title: '现场条件不能为空' }); return }
    if (allPhotos.length === 0) { toast({ variant: 'destructive', title: '请至少拍摄 1 张现场照片', description: '勘察照片是后续交底/作业/验收 AI 位置核对的基准' }); return }
    setSubmitting(true)
    try {
      const pointRefs = selectedPoints.map((m) => ({
        masterPointId: m.id, code: m.code, name: m.name,
        pipelineName: m.pipeline?.name ?? null,
      }))
      await apiPost(`/api/work-requests/${reqId}/survey`, {
        surveyor: currentUser?.name ?? '现场勘察',
        surveyDate: new Date().toISOString(),
        siteCondition: condition,
        hazardPoints: hazards || null,
        suggestion: suggestion || null,
        isSafe,
        pointRefs,
        photoIds: allPhotos.map((p) => p.id),
        __actorId: currentUser?.id, __actorName: currentUser?.name,
      })
      toast({ title: '勘察已提交', description: `需求进入 JSA 分析环节（照片 ${allPhotos.length} 张，将作为交底核对基准）` })
      onBack()
    } catch (e) {
      toast({ variant: 'destructive', title: '勘察提交失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setSubmitting(false)
    }
  }

  const baseMeta = { bizType: 'SITE_SURVEY' as const, bizId: null, bizCode: req?.code ?? null, uploadedBy: currentUser?.name ?? '未知', uploadedById: currentUser?.id ?? null }

  return (
    <PageShell title="现场勘察" sub={req ? `${req.code} ${req.title}` : '加载中…'} onBack={onBack}>
      {loading || !req ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          <div className="rounded-xl bg-white p-3 space-y-1">
            <ReqHead req={req} />
            <InfoRow label="压力" value={req.pressure} />
            <InfoRow label="温度" value={req.temperature} />
            {req.survey && <p className="text-[10px] text-teal-600 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5 inline-block">已有勘察记录，本次提交将更新</p>}
          </div>

          {/* 隔离点位选择 */}
          <div className="rounded-xl bg-white p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-stone-700">确认隔离点位置（多选）</Label>
              <span className="text-[10px] text-stone-400">已选 {selected.length}</span>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-300" />
              <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索隔离点编码/名称/位置" className="h-8 pl-8 text-xs" />
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {filteredMasters.map((m) => {
                const on = selected.includes(m.id)
                return (
                  <button key={m.id} type="button" onClick={() => togglePoint(m.id)} aria-pressed={on}
                    className={cn('px-2 py-1 rounded-full text-[10px] border transition-colors max-w-full truncate',
                      on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-stone-600 border-stone-200 hover:border-teal-300')}>
                    {on && '✓ '}{m.code} {m.name}
                  </button>
                )
              })}
              {filteredMasters.length === 0 && <p className="text-[11px] text-stone-400 py-2">无匹配隔离点</p>}
            </div>
          </div>

          {/* 按点位拍照 */}
          {selectedPoints.map((m) => (
            <div key={m.id} className="rounded-xl bg-white p-3 space-y-2">
              <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-teal-600" />{m.code} {m.name}
                <span className="text-[10px] text-stone-400 font-normal">多角度拍照</span>
              </Label>
              <PhotoPicker
                photos={photosByPoint[m.code] ?? []}
                onChange={(ps) => setPhotosByPoint((prev) => ({ ...prev, [m.code]: ps }))}
                meta={{ ...baseMeta, pointCode: m.code }}
                angleTags={['正面', '侧面', '近照', '远照']}
                compact
              />
            </div>
          ))}

          {/* 环境全貌 */}
          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1">
              <Camera className="w-3.5 h-3.5 text-teal-600" />环境全貌（不区分点位）
            </Label>
            <PhotoPicker photos={generalPhotos} onChange={setGeneralPhotos} meta={baseMeta} angleTags={['全景', '周边', '通道']} compact />
          </div>

          {/* 勘察表单 */}
          <div className="rounded-xl bg-white p-3 space-y-2.5">
            <div className="space-y-1">
              <Label className="text-xs">现场条件 <span className="text-rose-500">*</span></Label>
              <Textarea value={condition} onChange={(e) => setCondition(e.target.value)} rows={3} className="text-xs" placeholder="管线/法兰现状、周边环境、作业空间等" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">现场风险点</Label>
              <Textarea value={hazards} onChange={(e) => setHazards(e.target.value)} rows={2} className="text-xs" placeholder="高处/受限空间/临电/交叉作业等" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">勘察意见</Label>
              <Textarea value={suggestion} onChange={(e) => setSuggestion(e.target.value)} rows={2} className="text-xs" placeholder="建议与注意事项" />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-stone-50 border border-stone-100 px-3 py-2">
              <span className="text-xs text-stone-600">现场具备作业条件</span>
              <Switch checked={isSafe} onCheckedChange={setIsSafe} aria-label="是否具备作业条件" />
            </div>
            <Button className="w-full h-10 bg-teal-600 hover:bg-teal-700 text-white text-sm" onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CircleCheck className="w-4 h-4 mr-1" />}
              提交勘察（照片 {allPhotos.length} 张）
            </Button>
            <p className="text-[10px] text-stone-400 text-center">勘察照片将成为后续交底/作业/验收 AI 位置核对的基准</p>
          </div>
        </>
      )}
    </PageShell>
  )
}

// ============ ② 工艺处置现场确认页 ============
function DisposalConfirmPage(props: { reqId: number; currentUser: ModuleProps['currentUser']; onBack: () => void }) {
  const { reqId, currentUser, onBack } = props
  const { toast } = useToast()
  const [detail, setDetail] = useState<(ReqLite & {
    disposalScheme?: { id: number; code: string; steps: DisposalStepRow[] } | null
    disposalConfirmation?: { id: number; result: string } | null
  }) | null>(null)
  const [photos, setPhotos] = useState<AttachmentDto[]>([])
  const [lel, setLel] = useState('')
  const [o2, setO2] = useState('')
  const [toxic, setToxic] = useState('')
  const [analysisOk, setAnalysisOk] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [stepBusy, setStepBusy] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const d = await apiGet<NonNullable<typeof detail>>(`/api/work-requests/${reqId}`)
      setDetail(d)
    } finally {
      setLoading(false)
    }
  }, [reqId])
  useEffect(() => { void load() }, [load])

  const steps = detail?.disposalScheme?.steps ?? []
  const allOk = steps.length > 0 && steps.every((s) => s.confirmResult === 'OK')

  const confirmStep = async (step: DisposalStepRow, result: 'OK' | 'ABNORMAL') => {
    setStepBusy(step.id)
    try {
      await apiPost(`/api/disposal-steps/${step.id}/confirm`, { result, confirmer: currentUser?.name ?? '确认人', __actorId: currentUser?.id, __actorName: currentUser?.name })
      toast({ title: result === 'OK' ? `步骤 ${step.seq} 确认合格` : `步骤 ${step.seq} 标记异常`, description: result === 'OK' ? undefined : '请整改后重新确认' })
      await load()
    } catch (e) {
      toast({ variant: 'destructive', title: '确认失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setStepBusy(null)
    }
  }

  const submit = async () => {
    const result = allOk && analysisOk ? 'QUALIFIED' : 'UNQUALIFIED'
    setSubmitting(true)
    try {
      await apiPost('/api/disposal-confirmations', {
        workRequestId: reqId,
        confirmer: currentUser?.name ?? '确认人',
        flammableResult: lel || null,
        oxygenResult: o2 || null,
        toxicResult: toxic || null,
        analysisQualified: analysisOk,
        remarks: remarks || null,
        result,
        photoIds: photos.map((p) => p.id),
        __actorId: currentUser?.id, __actorName: currentUser?.name,
      })
      if (result === 'QUALIFIED') {
        toast({ title: '处置确认合格', description: '需求进入开票环节' })
        onBack()
      } else {
        toast({ variant: 'destructive', title: '存在未完成项', description: '全部步骤逐项合格且气体检测合格后方可总体确认合格' })
        await load()
      }
    } catch (e) {
      toast({ variant: 'destructive', title: '提交失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageShell title="工艺处置现场确认" sub={detail ? `${detail.code} ${detail.title}` : '加载中…'} onBack={onBack}>
      {loading || !detail ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          <div className="rounded-xl bg-white p-3">
            <ReqHead req={detail} />
          </div>

          {/* 处置步骤逐项确认 */}
          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700">处置步骤逐项确认（{steps.filter((s) => s.confirmResult === 'OK').length}/{steps.length}）</Label>
            {steps.length === 0 && <p className="text-[11px] text-stone-400">该需求暂无工艺处置方案</p>}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {steps.map((s) => (
                <div key={s.id} className={cn('rounded-lg border p-2.5 space-y-1.5',
                  s.confirmResult === 'OK' ? 'border-emerald-200 bg-emerald-50/50' : s.confirmResult === 'ABNORMAL' ? 'border-rose-200 bg-rose-50/50' : 'border-stone-200')}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] text-stone-700 leading-relaxed min-w-0">
                      <span className="font-mono text-stone-400 mr-1">{s.seq}.</span>
                      <span className="px-1 rounded bg-teal-50 text-teal-700 text-[9px] mr-1 border border-teal-100">{METHOD_ZH[s.method] ?? s.method}</span>
                      {s.detail}
                    </p>
                    {s.confirmResult === 'OK' && <CircleCheck className="w-4 h-4 text-emerald-500 shrink-0" />}
                    {s.confirmResult === 'ABNORMAL' && <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />}
                  </div>
                  {s.standard && <p className="text-[10px] text-stone-400">合格标准：{s.standard}</p>}
                  {!s.confirmResult && (
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-7 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px]"
                        disabled={stepBusy === s.id} onClick={() => void confirmStep(s, 'OK')}>
                        {stepBusy === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CircleCheck className="w-3 h-3 mr-0.5" />}合格
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 flex-1 text-[11px] border-rose-200 text-rose-600 hover:bg-rose-50"
                        disabled={stepBusy === s.id} onClick={() => void confirmStep(s, 'ABNORMAL')}>
                        <AlertTriangle className="w-3 h-3 mr-0.5" />异常
                      </Button>
                    </div>
                  )}
                  {s.confirmResult === 'ABNORMAL' && (
                    <Button size="sm" variant="outline" className="h-7 w-full text-[11px]" disabled={stepBusy === s.id} onClick={() => void confirmStep(s, 'OK')}>
                      整改完成，重新确认合格
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 气体检测 */}
          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700">气体检测（现场实测）</Label>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-stone-500">可燃气体 LEL%</Label>
                <Input value={lel} onChange={(e) => setLel(e.target.value)} inputMode="decimal" className="h-8 text-xs" placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-stone-500">氧含量 %</Label>
                <Input value={o2} onChange={(e) => setO2(e.target.value)} inputMode="decimal" className="h-8 text-xs" placeholder="20.9" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-stone-500">有毒气体</Label>
                <Input value={toxic} onChange={(e) => setToxic(e.target.value)} inputMode="decimal" className="h-8 text-xs" placeholder="0" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-stone-50 border border-stone-100 px-3 py-2">
              <span className="text-xs text-stone-600">分析合格</span>
              <Switch checked={analysisOk} onCheckedChange={setAnalysisOk} aria-label="分析是否合格" />
            </div>
          </div>

          {/* 现场拍照 */}
          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1"><Camera className="w-3.5 h-3.5 text-teal-600" />现场拍照留证</Label>
            <PhotoPicker
              photos={photos} onChange={setPhotos}
              meta={{ bizType: 'DISPOSAL_CONFIRM', bizId: null, bizCode: detail.code, uploadedBy: currentUser?.name ?? '未知', uploadedById: currentUser?.id ?? null }}
              angleTags={['检测位置', '压力表', '置换排放点']} compact
            />
          </div>

          <div className="rounded-xl bg-white p-3 space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">备注</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="text-xs" placeholder="实测数据说明/异常描述" />
            </div>
            <Button className="w-full h-10 bg-teal-600 hover:bg-teal-700 text-white text-sm" onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ClipboardCheck className="w-4 h-4 mr-1" />}
              总体确认（{allOk && analysisOk ? '合格' : '不合格'}）
            </Button>
            {!allOk && <p className="text-[10px] text-amber-600 text-center">尚有处置步骤未逐项确认合格，总体确认将被拒绝</p>}
          </div>
        </>
      )}
    </PageShell>
  )
}

// ============ ③ 现场交底页（交底方） ============
function BriefNewPage(props: { ticketId: number; currentUser: ModuleProps['currentUser']; onBack: () => void; onManage?: (briefingId: number) => void }) {
  const { ticketId, currentUser, onBack, onManage } = props
  const { toast } = useToast()
  const [ticket, setTicket] = useState<TicketLite | null>(null)
  const [content, setContent] = useState('')
  const [briefedUsers, setBriefedUsers] = useState('')
  const [photos, setPhotos] = useState<AttachmentDto[]>([])
  const [audio, setAudio] = useState<AttachmentDto | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<PhotoCheckDto | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [created, setCreated] = useState<BriefingRow | null>(null)

  useEffect(() => {
    void (async () => {
      const t = await apiGet<TicketLite>(`/api/work-tickets/${ticketId}`)
      setTicket(t)
      setContent(t.safetyMeasures ?? '')
      setBriefedUsers(t.workers ?? '')
    })()
  }, [ticketId])

  const submit = async () => {
    if (!content.trim()) { toast({ variant: 'destructive', title: '交底内容不能为空' }); return }
    if (photos.length === 0) { toast({ variant: 'destructive', title: '请至少拍摄 1 张交底位置照片', description: 'AI 将用它与勘察照片核对位置一致性' }); return }
    setSubmitting(true)
    try {
      const res = await apiPost<{ briefing: BriefingRow }>('/api/briefings', {
        workRequestId: ticket?.workRequestId,
        ticketId,
        briefingUser: currentUser?.name ?? '交底人',
        briefingUserId: currentUser?.id ?? null,
        briefedUsers: briefedUsers || null,
        content,
        photoIds: photos.map((p) => p.id),
        audioIds: audio ? [audio.id] : [],
        __actorId: currentUser?.id, __actorName: currentUser?.name,
      })
      setCreated(res.briefing)
      toast({ title: '交底已提交', description: '正在 AI 核对交底位置与勘察位置…' })
      // 自动触发 AI 位置核对（交底照片 vs 勘察照片）
      setChecking(true)
      try {
        const r = await apiPost<{ check: PhotoCheckDto }>('/api/ai/photo-check', {
          scene: 'BRIEFING_VS_SURVEY',
          workRequestId: ticket?.workRequestId,
          ticketId,
          briefingId: res.briefing.id,
        })
        setCheck(r.check)
        if (r.check.result === 'INCONSISTENT') {
          toast({ variant: 'destructive', title: '⚠️ AI 核对：位置不一致', description: r.check.reason ?? '请核对是否走错作业点' })
        } else {
          toast({ title: 'AI 核对完成', description: r.check.result === 'CONSISTENT' ? '交底位置与勘察位置一致' : '图片信息不足，无法确定' })
        }
      } catch (e) {
        setCheckError(e instanceof Error ? e.message : 'AI 核对失败')
      } finally {
        setChecking(false)
      }
    } catch (e) {
      toast({ variant: 'destructive', title: '交底提交失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setSubmitting(false)
    }
  }

  if (created) {
    return (
      <PageShell title="交底已提交" sub={ticket?.code} onBack={onBack}>
        <div className="rounded-xl bg-white p-4 space-y-3">
          <div className="flex items-center gap-2 text-emerald-600">
            <CircleCheck className="w-5 h-5" />
            <p className="text-sm font-semibold">交底完成，等待作业方确认</p>
          </div>
          <p className="text-[11px] text-stone-500 leading-relaxed">
            作业方将在移动端「现场作业」查看交底内容（含 {photos.length} 张照片{audio ? '、1 段录音' : ''}）并确认。
            {check?.result === 'INCONSISTENT' ? '注意：AI 核对提示位置不一致，请留意作业方反馈。' : ''}
          </p>
          <AiCheckCard check={check} loading={checking} compact />
          {checkError && (
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{checkError}</p>
          )}
          {check?.result === 'INCONSISTENT' && <InconsistentWarning show scene="BRIEFING_VS_SURVEY" />}
          {onManage && created && (
            <Button variant="outline" className="w-full h-10 border-violet-200 text-violet-700 hover:bg-violet-50 text-sm"
              onClick={() => onManage(created.id)}>
              <Settings2 className="w-4 h-4 mr-1" /> 管理交底（补录照片/录音 · 撤回）
            </Button>
          )}
          <Button className="w-full h-10 bg-teal-600 hover:bg-teal-700 text-white text-sm" onClick={onBack}>返回待办</Button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell title="现场交底" sub={ticket ? `${ticket.code} ${ticket.pointCode ? `[${ticket.pointCode}]` : ''} ${ticket.pointLocation ?? ''}` : '加载中…'} onBack={onBack}>
      {!ticket ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          <div className="rounded-xl bg-white p-3 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-stone-500">{ticket.code}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">{ticket.blindSpec ?? ''} {ticket.blindType ?? ''}</span>
              <span className="text-[10px] text-stone-400">{ticket.action === 'ADD' ? '加装盲板' : ticket.action === 'REMOVE' ? '拆除盲板' : ''}</span>
            </div>
            <InfoRow label="隔离点" value={ticket.pointLocation} />
            <InfoRow label="监护人" value={ticket.guardian} />
            <InfoRow label="作业人员" value={ticket.workers} />
            <p className="text-[10px] text-stone-400 bg-stone-50 rounded p-2 leading-relaxed border border-stone-100">安全措施：{ticket.safetyMeasures}</p>
          </div>

          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs">交底要点 <span className="text-rose-500">*</span></Label>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} className="text-xs"
              placeholder="作业风险、安全措施、应急处置、作业范围边界等" />
            <div className="space-y-1">
              <Label className="text-[10px] text-stone-500">被交底人员（作业方）</Label>
              <Input value={briefedUsers} onChange={(e) => setBriefedUsers(e.target.value)} className="h-8 text-xs" placeholder="逗号分隔" />
            </div>
          </div>

          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1">
              <Camera className="w-3.5 h-3.5 text-violet-600" />交底位置拍照 <span className="text-rose-500">*</span>
            </Label>
            <PhotoPicker
              photos={photos} onChange={setPhotos}
              meta={{ bizType: 'BRIEFING', bizId: null, bizCode: ticket.code, pointCode: ticket.pointCode, uploadedBy: currentUser?.name ?? '未知', uploadedById: currentUser?.id ?? null }}
              angleTags={['作业位置', '周边环境', '安全设施']} compact
            />
            <p className="text-[10px] text-stone-400 flex items-center gap-1"><Sparkles className="w-3 h-3 text-violet-500" />提交后 AI 自动与勘察照片核对位置一致性（violet 为 AI 能力）</p>
          </div>

          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1"><Mic className="w-3.5 h-3.5 text-violet-600" />交底录音</Label>
            <VoiceRecorder
              audio={audio} onChange={setAudio}
              meta={{ bizType: 'BRIEFING', bizId: null, bizCode: ticket.code, pointCode: ticket.pointCode, uploadedBy: currentUser?.name ?? '未知', uploadedById: currentUser?.id ?? null }}
            />
          </div>

          <Button className="w-full h-11 bg-violet-600 hover:bg-violet-700 text-white text-sm" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Megaphone className="w-4 h-4 mr-1" />}
            提交交底（照片 {photos.length} 张{audio ? ' + 录音' : ''}）
          </Button>
        </>
      )}
    </PageShell>
  )
}

// ============ ③b 交底管理页（交底方：补录照片/录音 · 改要点 · 重新 AI 核对 · 撤回） ============
function BriefManagePage(props: { briefingId: number; currentUser: ModuleProps['currentUser']; onBack: () => void }) {
  const { briefingId, currentUser, onBack } = props
  const { toast } = useToast()
  const [briefing, setBriefing] = useState<BriefingRow | null>(null)
  const [content, setContent] = useState('')
  const [briefedUsers, setBriefedUsers] = useState('')
  const [photos, setPhotos] = useState<AttachmentDto[]>([])
  const [audios, setAudios] = useState<AttachmentDto[]>([])
  const [newAudio, setNewAudio] = useState<AttachmentDto | null>(null)
  const [checks, setChecks] = useState<PhotoCheckDto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)

  const load = useCallback(async () => {
    try {
      const b = await apiGet<BriefingRow>(`/api/briefings?id=${briefingId}`)
      setBriefing(b)
      setContent(b.content)
      setBriefedUsers(b.briefedUsers ?? '')
      const [atts, cs] = await Promise.all([
        apiGet<AttachmentDto[]>(`/api/attachments?bizType=BRIEFING&bizId=${b.id}`),
        apiGet<PhotoCheckDto[]>(`/api/photo-checks?workRequestId=${b.workRequestId}${b.ticketId ? `&ticketId=${b.ticketId}` : ''}&scene=BRIEFING_VS_SURVEY`),
      ])
      setPhotos(atts.filter((a) => a.kind === 'PHOTO'))
      setAudios(atts.filter((a) => a.kind === 'AUDIO'))
      setChecks(cs)
    } finally {
      setLoading(false)
    }
  }, [briefingId])

  useEffect(() => { void load() }, [load])

  const editable = briefing?.status === 'PENDING'

  const saveText = async () => {
    if (!briefing) return
    if (!content.trim()) { toast({ variant: 'destructive', title: '交底内容不能为空' }); return }
    setSaving(true)
    try {
      await apiPatch('/api/briefings', { id: briefing.id, content, briefedUsers: briefedUsers || null })
      toast({ title: '交底要点已更新', description: '作业方确认前可见最新内容' })
      await load()
    } catch (e) {
      toast({ variant: 'destructive', title: '保存失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setSaving(false)
    }
  }

  const recheck = async () => {
    if (!briefing) return
    if (photos.length === 0) { toast({ variant: 'destructive', title: '暂无交底照片，无法核对' }); return }
    setChecking(true)
    try {
      const r = await apiPost<{ check: PhotoCheckDto }>('/api/ai/photo-check', {
        scene: 'BRIEFING_VS_SURVEY',
        workRequestId: briefing.workRequestId,
        ticketId: briefing.ticketId,
        briefingId: briefing.id,
      })
      setChecks((prev) => [r.check, ...prev])
      toast({ title: 'AI 核对完成', description: r.check.result === 'CONSISTENT' ? '交底位置与勘察位置一致' : r.check.result === 'INCONSISTENT' ? '位置不一致，请留意' : '图片信息不足，无法确定' })
    } catch (e) {
      toast({ variant: 'destructive', title: 'AI 核对失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setChecking(false)
    }
  }

  const withdraw = async () => {
    if (!briefing) return
    if (!window.confirm('确定撤回该交底？撤回后作业方将不可见，需重新交底。')) return
    setWithdrawing(true)
    try {
      await apiDelete(`/api/briefings?id=${briefing.id}`)
      toast({ title: '交底已撤回', description: '可重新发起现场交底' })
      onBack()
    } catch (e) {
      toast({ variant: 'destructive', title: '撤回失败', description: e instanceof Error ? e.message : '请重试' })
      setWithdrawing(false)
    }
  }

  if (loading || !briefing) return <PageShell title="交底管理" onBack={onBack}><Skeleton className="h-64 rounded-xl" /></PageShell>
  const latestCheck = checks[0] ?? null

  return (
    <PageShell title="交底管理" sub={briefing.ticketCode ?? '需求级交底'} onBack={onBack}>
      <div className="rounded-xl bg-white p-3 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-stone-800">交底人：{briefing.briefingUser}</span>
          {editable
            ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">待作业方确认 · 可补录/撤回</span>
            : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">作业方已确认 · 只读</span>}
        </div>
        <InfoRow label="交底时间" value={fmtDateTime(briefing.createdAt)} />
        <InfoRow label="隔离点" value={briefing.pointLocation} />
      </div>

      <div className="rounded-xl bg-white p-3 space-y-2">
        <Label className="text-xs">交底要点 {!editable && <span className="text-[10px] text-stone-400">（已确认只读）</span>}</Label>
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} className="text-xs" disabled={!editable} />
        <div className="space-y-1">
          <Label className="text-[10px] text-stone-500">被交底人员（作业方）</Label>
          <Input value={briefedUsers} onChange={(e) => setBriefedUsers(e.target.value)} className="h-8 text-xs" placeholder="逗号分隔" disabled={!editable} />
        </div>
        {editable && (
          <Button size="sm" className="h-8 w-full bg-teal-600 hover:bg-teal-700 text-white text-xs" onClick={() => void saveText()} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ClipboardCheck className="w-3.5 h-3.5 mr-1" />}保存修改
          </Button>
        )}
      </div>

      <div className="rounded-xl bg-white p-3 space-y-2">
        <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1">
          <Camera className="w-3.5 h-3.5 text-violet-600" />交底照片（{photos.length} 张）{editable && <span className="text-[10px] font-normal text-stone-400">· 可继续补拍</span>}
        </Label>
        <PhotoPicker
          photos={photos} onChange={setPhotos} disabled={!editable}
          meta={{ bizType: 'BRIEFING', bizId: briefing.id, bizCode: briefing.ticketCode, pointCode: briefing.pointCode, uploadedBy: currentUser?.name ?? '未知', uploadedById: currentUser?.id ?? null }}
          angleTags={['作业位置', '周边环境', '安全设施']} compact
        />
      </div>

      <div className="rounded-xl bg-white p-3 space-y-2">
        <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1"><Mic className="w-3.5 h-3.5 text-violet-600" />交底录音（{audios.length} 段）</Label>
        {audios.map((a) => (
          <div key={a.id} className="rounded-lg border border-stone-200 p-2 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-stone-500">{a.label ?? '录音'} · {fmtDateTime(a.createdAt)}</p>
              {editable && (
                <button type="button" className="text-[10px] text-rose-500 hover:text-rose-600"
                  onClick={() => {
                    setAudios((prev) => prev.filter((x) => x.id !== a.id))
                    fetch(`/api/attachments/${a.id}`, { method: 'DELETE' }).catch(() => null)
                  }}>
                  删除
                </button>
              )}
            </div>
            <audio controls preload="none" className="w-full h-8" src={`/api/attachments/${a.id}/raw`} />
          </div>
        ))}
        {audios.length === 0 && <p className="text-[10px] text-stone-400">暂无录音{editable ? '，可在下方补录' : ''}</p>}
        {editable && (
          <VoiceRecorder
            audio={newAudio}
            onChange={(a) => {
              if (a) {
                setNewAudio(a)
                setAudios((prev) => (prev.some((x) => x.id === a.id) ? prev : [...prev, a]))
              } else {
                if (newAudio) setAudios((prev) => prev.filter((x) => x.id !== newAudio.id))
                setNewAudio(null)
              }
            }}
            meta={{ bizType: 'BRIEFING', bizId: briefing.id, bizCode: briefing.ticketCode, pointCode: briefing.pointCode, uploadedBy: currentUser?.name ?? '未知', uploadedById: currentUser?.id ?? null }}
          />
        )}
      </div>

      <AiCheckCard check={latestCheck} loading={checking} compact />
      {latestCheck?.result === 'INCONSISTENT' && <InconsistentWarning show scene="BRIEFING_VS_SURVEY" />}
      <Button variant="outline" className="w-full h-10 border-violet-200 text-violet-700 hover:bg-violet-50 text-sm" onClick={() => void recheck()} disabled={checking}>
        {checking ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1 text-violet-500" />}
        重新 AI 核对（与勘察照片）
      </Button>

      {editable && (
        <Button variant="outline" className="w-full h-10 border-rose-200 text-rose-600 hover:bg-rose-50 text-sm" onClick={() => void withdraw()} disabled={withdrawing}>
          {withdrawing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Undo2 className="w-4 h-4 mr-1" />}
          撤回交底（作业方确认前可撤回重做）
        </Button>
      )}
    </PageShell>
  )
}

// ============ ④ 交底确认页（作业方） ============
function BriefConfirmPage(props: { briefingId: number; currentUser: ModuleProps['currentUser']; onBack: () => void }) {
  const { briefingId, currentUser, onBack } = props
  const { toast } = useToast()
  const [briefing, setBriefing] = useState<BriefingRow | null>(null)
  const [photos, setPhotos] = useState<AttachmentDto[]>([])
  const [audios, setAudios] = useState<AttachmentDto[]>([])
  const [checks, setChecks] = useState<PhotoCheckDto[]>([])
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const b = await apiGet<BriefingRow>(`/api/briefings?id=${briefingId}`)
        setBriefing(b)
        const [atts, cs] = await Promise.all([
          apiGet<AttachmentDto[]>(`/api/attachments?bizType=BRIEFING&bizId=${b.id}`),
          apiGet<PhotoCheckDto[]>(`/api/photo-checks?workRequestId=${b.workRequestId}${b.ticketId ? `&ticketId=${b.ticketId}` : ''}&scene=BRIEFING_VS_SURVEY`),
        ])
        setPhotos(atts.filter((a) => a.kind === 'PHOTO'))
        setAudios(atts.filter((a) => a.kind === 'AUDIO'))
        setChecks(cs)
      } finally {
        setLoading(false)
      }
    })()
  }, [briefingId])

  const confirm = async () => {
    setSubmitting(true)
    try {
      await apiPost(`/api/briefings/${briefingId}/confirm`, {
        confirmedBy: currentUser?.name ?? '作业方',
        confirmedById: currentUser?.id ?? null,
        confirmRemark: remark || null,
        __actorId: currentUser?.id, __actorName: currentUser?.name,
      })
      toast({ title: '交底已确认', description: '作业票具备开工条件，交底方/作业方可安排开工' })
      onBack()
    } catch (e) {
      toast({ variant: 'destructive', title: '确认失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setSubmitting(false)
    }
  }

  const latestCheck = checks[0] ?? null

  return (
    <PageShell title="交底确认（作业方）" sub={briefing?.ticketCode ?? ''} onBack={onBack}>
      {loading || !briefing ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          <div className="rounded-xl bg-white p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-800">交底人：{briefing.briefingUser}</span>
              <span className="text-[10px] text-stone-400">{fmtDateTime(briefing.createdAt)}</span>
            </div>
            <InfoRow label="隔离点" value={briefing.pointLocation} />
            <InfoRow label="被交底" value={briefing.briefedUsers} />
            <p className="text-[11px] text-stone-700 bg-violet-50/60 border border-violet-100 rounded-lg p-2.5 leading-relaxed whitespace-pre-wrap">{briefing.content}</p>
          </div>

          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700">交底现场照片（{photos.length}）</Label>
            <AttachmentWall photos={photos} audios={audios} emptyText="无照片" compact />
          </div>

          <AiCheckCard check={latestCheck} compact />
          {latestCheck?.result === 'INCONSISTENT' && <InconsistentWarning show scene="BRIEFING_VS_SURVEY" />}

          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs">确认备注（可选）</Label>
            <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} className="text-xs" placeholder="疑问/补充要求" />
            <Button className="w-full h-11 bg-violet-600 hover:bg-violet-700 text-white text-sm" onClick={() => void confirm()} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
              我已知晓交底内容，确认
            </Button>
            <p className="text-[10px] text-stone-400 text-center">确认后该作业票方可开工（系统开工硬门禁）</p>
          </div>
        </>
      )}
    </PageShell>
  )
}

// ============ ⑤ 作业执行页（拍照 + AI 核对） ============
function ExecPage(props: { ticketId: number; currentUser: ModuleProps['currentUser']; onBack: () => void }) {
  const { ticketId, currentUser, onBack } = props
  const { toast } = useToast()
  const [ticket, setTicket] = useState<TicketLite | null>(null)
  const [briefing, setBriefing] = useState<BriefingRow | null>(null)
  const [briefPhotos, setBriefPhotos] = useState<AttachmentDto[]>([])
  const [photos, setPhotos] = useState<AttachmentDto[]>([])
  const [check, setCheck] = useState<PhotoCheckDto | null>(null)
  const [checking, setChecking] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const t = await apiGet<TicketLite & { workRequestId: number }>(`/api/work-tickets/${ticketId}`)
      setTicket(t)
      const [bs, atts] = await Promise.all([
        apiGet<BriefingRow[]>(`/api/briefings?ticketId=${t.id}`),
        apiGet<AttachmentDto[]>(`/api/attachments?bizType=EXECUTION&bizId=${t.id}`),
      ])
      const confirmed = bs.find((b) => b.status === 'CONFIRMED') ?? bs[0] ?? null
      setBriefing(confirmed)
      if (confirmed) {
        const bp = await apiGet<AttachmentDto[]>(`/api/attachments?bizType=BRIEFING&bizId=${confirmed.id}`)
        setBriefPhotos(bp.filter((a) => a.kind === 'PHOTO'))
      }
      setPhotos(atts)
      const cs = await apiGet<PhotoCheckDto[]>(`/api/photo-checks?ticketId=${t.id}&scene=EXECUTION_VS_BRIEFING`)
      setCheck(cs[0] ?? null)
    } finally {
      setLoading(false)
    }
  }, [ticketId])
  useEffect(() => { void load() }, [load])

  const runCheck = async () => {
    if (!photos.length) { toast({ variant: 'destructive', title: '请先拍摄作业位置照片' }); return }
    setChecking(true)
    try {
      const r = await apiPost<{ check: PhotoCheckDto }>('/api/ai/photo-check', {
        scene: 'EXECUTION_VS_BRIEFING',
        workRequestId: ticket?.workRequestId,
        ticketId,
      })
      setCheck(r.check)
      if (r.check.result === 'INCONSISTENT') {
        toast({ variant: 'destructive', title: '⚠️ AI 核对：作业位置与交底不一致', description: '请核对是否走错作业点！' })
      } else if (r.check.result === 'CONSISTENT') {
        toast({ title: 'AI 核对：位置一致', description: '作业位置与交底照片一致' })
      } else {
        toast({ title: 'AI 核对完成', description: '图片信息不足，无法确定' })
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'AI 核对失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setChecking(false)
    }
  }

  const finish = async () => {
    if (!photos.length) { toast({ variant: 'destructive', title: '请先拍摄作业位置照片', description: '作业照片是验收 AI 核对的基准' }); return }
    setFinishing(true)
    try {
      await apiPost(`/api/work-tickets/${ticketId}/finish`, { __actorId: currentUser?.id, __actorName: currentUser?.name })
      toast({ title: '作业已完工', description: '等待作业验收（验收将再次拍照 AI 核对）' })
      onBack()
    } catch (e) {
      toast({ variant: 'destructive', title: '完工失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setFinishing(false)
    }
  }

  return (
    <PageShell title="作业拍照核对" sub={ticket ? `${ticket.code} ${ticket.pointCode ? `[${ticket.pointCode}]` : ''}` : '加载中…'} onBack={onBack}>
      {loading || !ticket ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          <div className="rounded-xl bg-white p-3 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-stone-500">{ticket.code}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-600 text-white">作业中</span>
            </div>
            <InfoRow label="隔离点" value={ticket.pointLocation} />
            <InfoRow label="安全措施" value={ticket.safetyMeasures} />
          </div>

          {briefing && (
            <div className="rounded-xl bg-white p-3 space-y-2">
              <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1"><Megaphone className="w-3.5 h-3.5 text-violet-600" />交底要点回顾（{briefing.briefingUser}）</Label>
              <p className="text-[11px] text-stone-600 bg-violet-50/60 border border-violet-100 rounded-lg p-2 leading-relaxed line-clamp-4 whitespace-pre-wrap">{briefing.content}</p>
              <AttachmentWall photos={briefPhotos} emptyText="交底无照片" compact />
            </div>
          )}

          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1">
              <Camera className="w-3.5 h-3.5 text-teal-600" />作业位置拍照 <span className="text-rose-500">*</span>
            </Label>
            <PhotoPicker
              photos={photos}
              onChange={(ps) => { setPhotos(ps); setCheck(null) }}
              meta={{ bizType: 'EXECUTION', bizId: ticket.id, bizCode: ticket.code, pointCode: ticket.pointCode, uploadedBy: currentUser?.name ?? '未知', uploadedById: currentUser?.id ?? null }}
              angleTags={['作业点', '盲板安装', '周边警示']} compact
            />
            <AiCheckCard check={check} loading={checking} onRun={photos.length > 0 ? () => void runCheck() : undefined}
              runHint="与交底照片比对" runDisabled={checking} />
            {check?.result === 'INCONSISTENT' && <InconsistentWarning show scene="EXECUTION_VS_BRIEFING" />}
          </div>

          <Button className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white text-sm" onClick={() => void finish()} disabled={finishing}>
            {finishing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FileCheck2 className="w-4 h-4 mr-1" />}
            确认作业完工（照片 {photos.length} 张）
          </Button>
          {photos.length === 0 && <p className="text-[10px] text-amber-600 text-center -mt-2">完工前请拍摄作业位置照片（验收环节将以此为基准核对）</p>}
        </>
      )}
    </PageShell>
  )
}

// ============ ⑥ 验收页（拍照 + AI 核对 + 不一致警告） ============
function AcceptPage(props: { reqId: number; currentUser: ModuleProps['currentUser']; onBack: () => void }) {
  const { reqId, currentUser, onBack } = props
  const { toast } = useToast()
  const [req, setReq] = useState<(ReqLite & { tickets?: TicketLite[] }) | null>(null)
  const [photos, setPhotos] = useState<AttachmentDto[]>([])
  const [leak, setLeak] = useState(false)
  const [restore, setRestore] = useState(false)
  const [ledger, setLedger] = useState(false)
  const [problems, setProblems] = useState('')
  const [remarks, setRemarks] = useState('')
  const [check, setCheck] = useState<PhotoCheckDto | null>(null)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [warnOpen, setWarnOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const d = await apiGet<ReqLite & { tickets?: TicketLite[] }>(`/api/work-requests/${reqId}`)
        setReq(d)
      } finally {
        setLoading(false)
      }
    })()
  }, [reqId])

  const latestTicket = useMemo(() => (req?.tickets ?? []).slice().sort((a, b) => b.id - a.id)[0] ?? null, [req])

  const runCheck = async () => {
    if (!photos.length) { toast({ variant: 'destructive', title: '请先拍摄验收照片' }); return }
    setChecking(true)
    try {
      const r = await apiPost<{ check: PhotoCheckDto }>('/api/ai/photo-check', {
        scene: 'ACCEPTANCE_VS_EXEC',
        workRequestId: reqId,
        ticketId: latestTicket?.id ?? null,
      })
      setCheck(r.check)
      if (r.check.result === 'INCONSISTENT') {
        toast({ variant: 'destructive', title: '⚠️ 验收位置与作业照片不一致！', description: '请现场复核后再提交验收' })
      } else if (r.check.result === 'CONSISTENT') {
        toast({ title: 'AI 核对：位置一致', description: '验收位置与作业/交底照片一致' })
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'AI 核对失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setChecking(false)
    }
  }

  const submit = async () => {
    const pass = leak && restore && ledger
    if (!pass && !problems.trim()) { toast({ variant: 'destructive', title: '存在未通过项时须填写发现问题' }); return }
    // 用户要求：不一致警告用户（确认后仍可提交，问题栏自动预填原因）
    if (check?.result === 'INCONSISTENT' && !warnOpen) {
      setWarnOpen(true)
      return
    }
    setSubmitting(true)
    try {
      const res = await apiPost<{ request?: { status: string } }>('/api/acceptances', {
        workRequestId: reqId,
        acceptor: currentUser?.name ?? '验收人',
        leakCheck: leak,
        restoreCheck: restore,
        ledgerCheck: ledger,
        conclusion: pass ? 'PASS' : 'RECTIFY',
        problems: problems || (check?.result === 'INCONSISTENT' ? 'AI 核对提示验收位置与作业照片存在差异，已现场复核' : null),
        remarks: remarks || null,
        photoIds: photos.map((p) => p.id),
        __actorId: currentUser?.id, __actorName: currentUser?.name,
      })
      if (res.request?.status === 'COMPLETED') {
        toast({ title: '验收通过，流程闭环', description: '需求已完成，台账/变动记录已同步' })
      } else {
        toast({ title: '验收已提交（整改后复验）', description: '存在未通过项，需求保持待验收' })
      }
      onBack()
    } catch (e) {
      toast({ variant: 'destructive', title: '验收提交失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setSubmitting(false)
      setWarnOpen(false)
    }
  }

  const checkItems = [
    { key: 'leak', label: '无泄漏确认', desc: '作业点静压观察无渗漏', value: leak, set: setLeak },
    { key: 'restore', label: '现场恢复确认', desc: '标识/垫片/螺栓紧固恢复', value: restore, set: setRestore },
    { key: 'ledger', label: '台账更新确认', desc: '盲板变动已登记台账', value: ledger, set: setLedger },
  ] as const

  return (
    <PageShell title="作业验收" sub={req ? `${req.code} ${req.title}` : '加载中…'} onBack={onBack}>
      {loading || !req ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          <div className="rounded-xl bg-white p-3">
            <ReqHead req={req} />
          </div>

          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700">验收检查项</Label>
            {checkItems.map((it) => (
              <div key={it.key} className="flex items-center justify-between rounded-lg border border-stone-100 bg-stone-50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs text-stone-700">{it.label}</p>
                  <p className="text-[10px] text-stone-400">{it.desc}</p>
                </div>
                <Switch checked={it.value} onCheckedChange={it.set} aria-label={it.label} />
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-white p-3 space-y-2">
            <Label className="text-xs font-semibold text-stone-700 flex items-center gap-1">
              <Camera className="w-3.5 h-3.5 text-teal-600" />验收拍照 <span className="text-rose-500">*</span>
            </Label>
            <PhotoPicker
              photos={photos}
              onChange={(ps) => { setPhotos(ps); setCheck(null) }}
              meta={{ bizType: 'ACCEPTANCE', bizId: null, bizCode: req.code, uploadedBy: currentUser?.name ?? '未知', uploadedById: currentUser?.id ?? null }}
              angleTags={['作业点', '恢复后', '标识']} compact
            />
            <AiCheckCard check={check} loading={checking} onRun={photos.length > 0 ? () => void runCheck() : undefined}
              runHint="与作业/交底照片比对" runDisabled={checking} />
            {check?.result === 'INCONSISTENT' && <InconsistentWarning show scene="ACCEPTANCE_VS_EXEC" />}
          </div>

          <div className="rounded-xl bg-white p-3 space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">发现问题{!(leak && restore && ledger) && <span className="text-rose-500"> *</span>}</Label>
              <Textarea value={problems} onChange={(e) => setProblems(e.target.value)} rows={2} className="text-xs" placeholder="未通过项说明/整改要求" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">验收意见</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="text-xs" placeholder="总体评价与建议" />
            </div>
            <Button className={cn('w-full h-11 text-white text-sm', leak && restore && ledger ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-500 hover:bg-amber-600')}
              onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ClipboardCheck className="w-4 h-4 mr-1" />}
              {leak && restore && ledger ? '提交验收（通过）' : '提交验收（整改后复验）'}
            </Button>
          </div>

          {/* 不一致时提交拦截确认 */}
          {warnOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40" role="dialog" aria-modal="true" aria-label="位置不一致警告">
              <div className="rounded-xl bg-white p-4 w-full max-w-sm space-y-3 shadow-xl">
                <div className="flex items-center gap-2 text-rose-600">
                  <AlertTriangle className="w-5 h-5" />
                  <p className="text-sm font-semibold">AI 核对：验收位置不一致</p>
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  {check?.reason ?? '验收照片与基准照片位置特征不符'}。请确认是否在正确作业点验收。
                  选择「仍要提交」将自动在发现问题栏记录该差异；建议先现场复核。
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="h-9 text-xs" onClick={() => setWarnOpen(false)}>返回复核</Button>
                  <Button className="h-9 text-xs bg-rose-600 hover:bg-rose-700 text-white" onClick={() => void submit()}>仍要提交</Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
