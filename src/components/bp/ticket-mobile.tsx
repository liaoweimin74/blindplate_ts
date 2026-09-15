'use client'
// 移动端开票 / 作业票审批（需求 16）：TicketNewPage 开作业票（含逐人验资）+ TicketReviewPage 作业票审批（票面详情+CrewWall 照片墙）
// 复用 web 端同一套 API（/api/work-tickets 含 workerCerts 校验）与共享组件（CrewEditor/CrewWall），移动端呈现为底部抽屉/全屏页形态
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, fmtDateTime } from '@/lib/bp-api'
import { TICKET_STATUS_MAP } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ChevronLeft, Loader2, MapPin, RefreshCw, CircleCheck, ClipboardList, Ticket as TicketIcon,
  ShieldCheck, UserCheck, XCircle, HardHat, FileText,
} from 'lucide-react'
import { CrewEditor, CrewWall, crewGaps, type WorkerCert } from '@/components/bp/crew'
import { PidLocateDialog, type LocatePoint } from '@/components/bp/pid-locate'
import type { ModuleProps } from '@/lib/bp-types'

// ============ 共享小件 ============
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

interface MobileReqLite {
  id: number; code: string; title: string; status: string; location: string
  unit?: { id: number; name: string } | null
}
interface MobileSchemePoint { id: number; seq: number; masterCode: string | null; code: string | null; location: string | null; blindSpec: string; blindType: string; action: string }
interface MobileTicket {
  id: number; code: string; status: string; pointId: number | null; pointCode: string | null
  pointLocation: string | null; blindSpec: string | null; blindType: string | null; action: string | null
  plannedStart: string; plannedEnd: string; guardian: string; workers: string; issuer: string
  safetyMeasures: string; workerCerts?: string | null
  workRequest?: { id: number; code: string; title: string; unit?: { name: string } | null } | null
}
interface MobileUser { id: string; name: string; role: string; active: boolean }

// ============ 需求11扩展：开票/审批页隔离点 → PID 放大定位（与 field-ops 同款 Context 模式） ============
const LocateCtx = createContext<(code: string, location?: string | null, preferUnitId?: number | null) => void>(() => {})

/** 紧凑 PID 定位按钮（有编码才显示；嵌入 label/卡片时传 stop 防触发外层点击） */
function TicketLocateBtn({ code, location, preferUnitId, stop }: { code?: string | null; location?: string | null; preferUnitId?: number | null; stop?: boolean }) {
  const openLocate = useContext(LocateCtx)
  if (!code) return null
  return (
    <button
      type="button"
      onClick={(e) => { if (stop) { e.stopPropagation(); e.preventDefault() } openLocate(code, location, preferUnitId ?? null) }}
      title="在 PID 组态图中放大定位该隔离点"
      aria-label={`在 PID 图中定位 ${code}`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded border border-teal-200 bg-white px-1.5 py-0.5 text-[10px] text-teal-700 transition-colors hover:bg-teal-50"
    >
      <MapPin className="h-3 w-3" />PID
    </button>
  )
}

/** 开票/审批页共用：定位弹窗状态 + 受控 PidLocateDialog（preferUnitId 让本装置图优先命中） */
function useTicketLocate() {
  const [locateState, setLocateState] = useState<{ points: LocatePoint[]; preferUnitId: number | null } | null>(null)
  const openLocate = useCallback((code: string, location?: string | null, preferUnitId?: number | null) => {
    setLocateState({ points: [{ key: code, code, name: null, masterPointId: null, masterCode: null, sub: location ?? null }], preferUnitId: preferUnitId ?? null })
  }, [])
  const dialog = (
    <PidLocateDialog open={!!locateState} onClose={() => setLocateState(null)} points={locateState?.points ?? []} preferUnitId={locateState?.preferUnitId ?? null} />
  )
  return { openLocate, dialog }
}

// ============ ① 开作业票（移动端） ============
export function TicketNewPage(props: { currentUser: ModuleProps['currentUser']; onBack: () => void; onDone: () => void }) {
  const { currentUser, onBack, onDone } = props
  const { toast } = useToast()
  const [reqs, setReqs] = useState<MobileReqLite[]>([])
  const [loading, setLoading] = useState(true)
  const [reqId, setReqId] = useState<number | null>(null)
  const [detail, setDetail] = useState<{ points: MobileSchemePoint[]; ticketedPointIds: number[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [pointIds, setPointIds] = useState<number[]>([])
  const [users, setUsers] = useState<MobileUser[]>([])
  const [form, setForm] = useState({ plannedStart: '', plannedEnd: '', guardian: '', issuer: '' })
  const [measures, setMeasures] = useState('1. 作业前确认工艺处置到位、压力已泄放\n2. 现场气体检测合格（LEL 0%）\n3. 佩戴防护面罩、防化手套\n4. 监护人全程在场，作业人员站位安全')
  const [crew, setCrew] = useState<WorkerCert[]>([])
  const [busy, setBusy] = useState(false)
  // 需求11扩展：所选隔离点 → PID 放大定位（本装置图优先命中）
  const locate = useTicketLocate()

  const loadReqs = async () => {
    setLoading(true)
    try {
      const list = await apiGet<MobileReqLite[]>('/api/work-requests')
      // 处置已确认（可开票）+ 已开过票（可补开）；TICKET_APPROVED/IN_PROGRESS 属作业推进态，一票一板补开仍允许（后端同口径）
      setReqs(list.filter((r) => ['CONFIRMED', 'TICKET_ISSUED', 'TICKET_APPROVED'].includes(r.status)))
    } catch (e) {
      toast({ variant: 'destructive', title: '加载失败', description: e instanceof Error ? e.message : '获取需求失败' })
    } finally { setLoading(false) }
  }

  useEffect(() => {
    void loadReqs()
    apiGet<MobileUser[]>('/api/users').then((us) => setUsers(us.filter((u) => u.active))).catch(() => null)
     
  }, [])

  useEffect(() => {
    if (reqId == null) { setDetail(null); return }
    setDetailLoading(true)
    setPointIds([])
    apiGet<{ isolationScheme?: { points: (MobileSchemePoint & { workRequestId: number })[] } | null; tickets?: { pointId: number | null; status: string }[] }>(`/api/work-requests/${reqId}`)
      .then((d) => {
        const ticketed = new Set((d.tickets ?? []).flatMap((t) => (t.status !== 'VOID' && t.status !== 'CLOSED' && t.pointId != null ? [t.pointId] : [])))
        setDetail({ points: d.isolationScheme?.points ?? [], ticketedPointIds: [...ticketed] })
        if (!d.isolationScheme?.points?.length) toast({ title: '该需求尚无隔离方案点位', description: '一票一板模式下必须先编制并审核隔离方案', variant: 'destructive' })
      })
      .catch((e) => toast({ variant: 'destructive', title: '加载需求详情失败', description: e instanceof Error ? e.message : '' }))
      .finally(() => setDetailLoading(false))
     
  }, [reqId])

  const gaps = crewGaps(crew)
  const submit = async () => {
    if (reqId == null || !pointIds.length) { toast({ title: '请先选择需求与办票点位', variant: 'destructive' }); return }
    if (!form.plannedStart || !form.plannedEnd || !form.guardian) { toast({ title: '请完善计划时间与监护人', variant: 'destructive' }); return }
    if (gaps.length) { toast({ title: '验资待完善', description: gaps.join('；'), variant: 'destructive' }); return }
    setBusy(true)
    try {
      const r = await apiPost<{ tickets: { code: string }[] }>('/api/work-tickets', {
        workRequestId: reqId,
        pointIds,
        plannedStart: new Date(form.plannedStart).toISOString(),
        plannedEnd: new Date(form.plannedEnd).toISOString(),
        guardian: form.guardian,
        issuer: form.issuer || currentUser.name,
        workers: crew.map((c) => c.name.trim()).join(','),
        workerCerts: crew,
        safetyMeasures: measures,
      })
      toast({ title: `已开具 ${r.tickets.length} 张作业票`, description: `${r.tickets.map((t) => t.code).join('、')} 已提交审批（${crew.length} 人验资材料随票归档）` })
      onDone()
    } catch (e) {
      toast({ variant: 'destructive', title: '开票失败', description: e instanceof Error ? e.message : '' })
    } finally { setBusy(false) }
  }

  return (
    <LocateCtx.Provider value={locate.openLocate}>
    <PageShell title="开作业票（一票一板）" sub="GB 30871：每个隔离点分别一张作业票，逐人验资" onBack={onBack}>
      {loading ? (
        <div className="flex items-center justify-center py-10 text-stone-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : reqs.length === 0 ? (
        <div className="rounded-xl bg-white p-6 text-center text-xs text-stone-400">暂无工艺处置已确认的需求——完成「处置确认」后可在此开票</div>
      ) : reqId == null ? (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-stone-500">选择作业需求</p>
          {reqs.map((r) => (
            <button key={r.id} type="button" onClick={() => setReqId(r.id)}
              className="w-full rounded-xl border border-stone-200 bg-white p-3 text-left hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                <span className="font-mono text-[11px] text-stone-500">{r.code}</span>
                <Badge variant="outline" className="ml-auto text-[9px] bg-teal-50 text-teal-700 border-teal-200">
                  {r.status === 'CONFIRMED' ? '可开票' : r.status === 'TICKET_ISSUED' ? '可补开' : '推进中·可补开'}
                </Badge>
              </div>
              <p className="mt-1 text-xs font-medium text-stone-800 truncate">{r.title}</p>
              <p className="text-[10px] text-stone-400">{r.unit?.name ?? '-'} · {r.location}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {/* 点位选择 */}
          <div className="rounded-xl bg-white p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-teal-600" />
              <p className="text-[11px] font-semibold text-stone-600">选择办票隔离点位（已选 {pointIds.length}）</p>
              <button type="button" className="ml-auto text-[10px] text-teal-600" onClick={() => { setReqId(null); setDetail(null) }}>重选需求</button>
            </div>
            {detailLoading ? <Loader2 className="w-4 h-4 animate-spin text-stone-300" /> : detail?.points.length ? detail.points.map((p) => {
              const ticketed = detail.ticketedPointIds.includes(p.id)
              const checked = pointIds.includes(p.id)
              return (
                <label key={p.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2', ticketed ? 'border-stone-100 bg-stone-50 opacity-60' : checked ? 'border-teal-300 bg-teal-50/50' : 'border-stone-200')}>
                  <Checkbox checked={checked} disabled={ticketed} onCheckedChange={(v) => setPointIds((prev) => (v ? [...prev, p.id] : prev.filter((x) => x !== p.id)))} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-stone-700 truncate">{p.masterCode || p.code} · {p.location}</p>
                    <p className="text-[9px] text-stone-400">{p.action === 'ADD' ? '加装' : '拆除'}盲板 {p.blindType} {p.blindSpec}{ticketed ? ' · 已办票（一票一板）' : ''}</p>
                  </div>
                  <TicketLocateBtn code={p.masterCode || p.code} location={p.location} preferUnitId={reqs.find((r) => r.id === reqId)?.unit?.id ?? null} stop />
                </label>
              )
            }) : <p className="text-[11px] text-stone-400">该需求尚无隔离方案点位</p>}
          </div>

          {/* 票面信息 */}
          <div className="rounded-xl bg-white p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-600"><TicketIcon className="w-3.5 h-3.5 text-teal-600" />票面信息</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-[10px]">计划开始 *</Label><Input type="datetime-local" className="h-8 text-xs" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-[10px]">计划结束 *</Label><Input type="datetime-local" className="h-8 text-xs" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">监护人 *</Label>
              <select className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-xs" value={form.guardian} onChange={(e) => setForm({ ...form, guardian: e.target.value })}>
                <option value="">选择监护人</option>
                {users.filter((u) => u.role === 'GUARDIAN').map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label className="text-[10px]">签发人</Label><Input className="h-8 text-xs" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} placeholder={currentUser.name} /></div>
          </div>

          {/* 逐人验资 */}
          <div className="rounded-xl bg-white p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-stone-600"><UserCheck className="w-3.5 h-3.5 text-teal-600" />作业人员逐人验资（身份证照片必传）</p>
            <div className="max-h-80 overflow-y-auto bp-thin-scrollbar">
              <CrewEditor certs={crew} onChange={setCrew} currentUser={{ id: currentUser.id, name: currentUser.name }} />
            </div>
          </div>

          {/* 安全措施 */}
          <div className="rounded-xl bg-white p-3 space-y-1">
            <Label className="text-[10px]">安全措施</Label>
            <Textarea rows={4} className="text-xs" value={measures} onChange={(e) => setMeasures(e.target.value)} />
          </div>

          <Button className="h-10 w-full bg-emerald-600 hover:bg-emerald-700 text-sm text-white" disabled={busy || !pointIds.length || gaps.length > 0}
            onClick={submit}
            title={gaps.length ? `验资待完善：${gaps.join('；')}` : undefined}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `开具 ${pointIds.length} 张作业票并提交审批`}
          </Button>
        </div>
      )}
    </PageShell>
    {locate.dialog}
    </LocateCtx.Provider>
  )
}

// ============ ② 作业票审批（移动端） ============
export function TicketReviewPage(props: { currentUser: ModuleProps['currentUser']; onBack: () => void; onDone: () => void }) {
  const { currentUser, onBack, onDone } = props
  const { toast } = useToast()
  const [tickets, setTickets] = useState<MobileTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<MobileTicket | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  // 需求11扩展：票面隔离点 → PID 放大定位（列表卡与详情页均可）
  const locate = useTicketLocate()

  const load = async () => {
    setLoading(true)
    try {
      const data = await apiGet<{ pending: { ticket: MobileTicket[] } }>('/api/approvals')
      setTickets(data.pending?.ticket ?? [])
    } catch (e) {
      toast({ variant: 'destructive', title: '加载失败', description: e instanceof Error ? e.message : '' })
    } finally { setLoading(false) }
  }

  useEffect(() => { void load()   }, [])

  const doReview = async (ticket: MobileTicket, approve: boolean) => {
    if (!approve && !comment.trim()) { toast({ title: '驳回必填审核意见', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost(`/api/work-tickets/${ticket.id}/review`, { approve, comment, reviewer: currentUser.name, __actorId: currentUser.id, __actorName: currentUser.name })
      toast({ title: approve ? '已批准' : '已驳回', description: `作业票 ${ticket.code} ${approve ? '批准生效，可安排交底开工' : '已退回签发人'}` })
      setDetail(null); setComment('')
      await load()
      onDone()
    } catch (e) {
      toast({ variant: 'destructive', title: '审批失败', description: e instanceof Error ? e.message : '' })
    } finally { setBusy(false) }
  }

  if (detail) {
    return (
      <LocateCtx.Provider value={locate.openLocate}>
      <PageShell title={`作业票审批 · ${detail.code}`} sub={detail.workRequest ? `${detail.workRequest.code} ${detail.workRequest.title}` : undefined} onBack={() => setDetail(null)}>
        <div className="space-y-3">
          {/* 票面信息 */}
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800"><FileText className="w-3.5 h-3.5" />票面信息{detail.pointCode && <span className="rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 font-mono text-teal-700">{detail.pointCode}</span>}<span className="ml-auto"><TicketLocateBtn code={detail.pointCode} location={detail.pointLocation} /></span></p>
            <div className="space-y-1 text-[11px] text-stone-600">
              <p>隔离位置：{detail.pointLocation ?? '-'}</p>
              <p>盲板：{detail.blindType ?? '-'} {detail.blindSpec ?? ''}（{detail.action === 'ADD' ? '加装' : '拆除'}）</p>
              <p>计划：{fmtDateTime(detail.plannedStart)} → {fmtDateTime(detail.plannedEnd)}</p>
              <p>监护人：{detail.guardian} · 签发：{detail.issuer}</p>
            </div>
            {detail.safetyMeasures && (
              <div className="rounded-md border border-stone-100 bg-white/80 px-2.5 py-1.5">
                <p className="text-[9px] text-stone-400">安全措施</p>
                <p className="whitespace-pre-wrap text-[10px] leading-relaxed text-stone-600">{detail.safetyMeasures}</p>
              </div>
            )}
          </div>
          {/* 验资照片墙 */}
          <div className="rounded-xl bg-white p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-stone-600"><UserCheck className="w-3.5 h-3.5 text-teal-600" />作业人员验资</p>
            <CrewWall workerCerts={detail.workerCerts} workers={detail.workers} compact />
          </div>
          {/* 审批操作 */}
          <div className="space-y-1.5 rounded-xl bg-white p-3">
            <Label className="text-[10px]">审核意见（驳回必填）</Label>
            <Textarea rows={2} className="text-xs" placeholder="如：同意，注意现场气体检测" value={comment} onChange={(e) => setComment(e.target.value)} />
            <p className="text-[10px] text-stone-400">审核人：{currentUser.name}</p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="h-9 flex-1 border-rose-200 text-rose-600 hover:bg-rose-50 text-xs" disabled={busy} onClick={() => void doReview(detail, false)}>
                <XCircle className="w-3.5 h-3.5 mr-1" />驳回
              </Button>
              <Button className="h-9 flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs text-white" disabled={busy} onClick={() => void doReview(detail, true)}>
                <ShieldCheck className="w-3.5 h-3.5 mr-1" />批准
              </Button>
            </div>
          </div>
        </div>
      </PageShell>
      {locate.dialog}
      </LocateCtx.Provider>
    )
  }

  return (
    <LocateCtx.Provider value={locate.openLocate}>
    <PageShell title="作业票审批" sub={`待批准 ${tickets.length} 张 · 批准后方可交底开工`} onBack={onBack}>
      {loading ? (
        <div className="flex items-center justify-center py-10 text-stone-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl bg-white p-6 text-center text-xs text-stone-400">
          <CircleCheck className="mx-auto mb-1 w-5 h-5 text-teal-500" />暂无待批准作业票
        </div>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={() => void load()} className="ml-auto flex items-center gap-1 text-[10px] text-stone-400"><RefreshCw className="w-3 h-3" />刷新</button>
          {tickets.map((t) => (
            <div key={t.id} role="button" tabIndex={0}
              onClick={() => setDetail(t)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(t) } }}
              className="w-full cursor-pointer rounded-xl border border-amber-200 bg-white p-3 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60">
              <div className="flex items-center gap-2">
                <TicketIcon className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                <span className="font-mono text-xs font-semibold text-stone-800">{t.code}</span>
                <Badge variant="outline" className="ml-auto text-[9px] bg-amber-100 text-amber-700 border-amber-200">
                  {TICKET_STATUS_MAP[t.status]?.label ?? t.status}
                </Badge>
              </div>
              {t.workRequest && <p className="mt-1 truncate text-[10px] text-stone-500">{t.workRequest.title}</p>}
              <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-stone-400">
                <span className="min-w-0 flex-1">{t.pointCode ? `[${t.pointCode}] ` : ''}{t.pointLocation ?? ''} · 作业人 {t.workers}</span>
                <TicketLocateBtn code={t.pointCode} location={t.pointLocation} stop />
              </p>
              <p className="mt-1 flex items-center gap-1 text-[10px] text-teal-600">查看票面与验资照片 <ChevronLeft className="w-3 h-3 rotate-180" /></p>
            </div>
          ))}
        </div>
      )}
    </PageShell>
    {locate.dialog}
    </LocateCtx.Provider>
  )
}
