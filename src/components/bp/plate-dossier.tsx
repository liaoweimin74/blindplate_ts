'use client'
// 盲板「一板一档」完整档案页：单块盲板的全生命周期档案
// 头部档案卡（基础参数/当前位置/所属装置）+ 全生命周期变动时间线 + 关联业务单据链路
// 数据源：GET /api/blind-plates/[id]/dossier（一次性聚合）
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, fmtDate, fmtDateTime } from '@/lib/bp-api'
import {
  BpUser, PLATE_STATUS_MAP, STATUS_MAP, SCHEME_STATUS_MAP, TICKET_STATUS_MAP,
  TASK_STATUS_MAP, CONCLUSION_MAP, CHANGE_ACTION_MAP, WORK_TYPE_MAP, POINT_ACTION_MAP,
} from '@/lib/bp-types'
import { timeAgo } from './notification-bell'
import { MiniFlowProgress } from './mini-flow-progress'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  ArrowRight, Building2, ChevronDown, ClipboardList, FileText, FolderOpen, History,
  Inbox, Loader2, MapPin, Printer, ShieldCheck, Ticket as TicketIcon,
} from 'lucide-react'

// ============ 类型（与 /api/blind-plates/[id]/dossier 出参对应） ============
export interface DossierPlate {
  id: number
  code: string
  spec: string
  type: string
  material: string
  thickness: number
  pressureRating: string
  status: string
  location?: string | null
  unitId?: number | null
  createdAt: string
  updatedAt: string
  unitName?: string | null
}

export interface DossierChange {
  id: number
  blindCode: string
  action: string
  workCode?: string | null
  location?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  operator: string
  note?: string | null
  createdAt: string
}

export interface DossierBusiness {
  workRequestId: number
  workCode: string
  workTitle: string
  workStatus: string
  pointAction: string
  pointLocation: string
  workType: string
  applicantName: string
  unitName?: string | null
  plannedStart?: string | null
  plannedEnd?: string | null
  survey?: { surveyor: string; surveyDate: string; isSafe: boolean; siteCondition?: string | null; suggestion?: string | null } | null
  jsa?: { leader: string; members?: string | null; analysisDate: string; riskLevel: string } | null
  isolationScheme?: { code: string; status: string; reviewedBy?: string | null; comment?: string | null } | null
  disposalScheme?: { code: string; status: string; reviewedBy?: string | null } | null
  ticket?: { code: string; status: string; guardian?: string | null; issuer?: string | null; startedAt?: string | null; finishedAt?: string | null; closedAt?: string | null } | null
  tasks?: { id: number; code: string; status: string; assignee: string; planStart?: string | null; planEnd?: string | null }[] | null
  acceptances?: { id: number; conclusion: string; acceptor: string; acceptedAt: string; problems?: string | null }[] | null
}

export interface PlateDossierData {
  plate: DossierPlate
  changes: DossierChange[]
  businesses: DossierBusiness[]
}

interface PlateDossierProps {
  plateId?: number
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUser: BpUser
  /** 跨模块导航（查看需求详情直达 work-requests 模块，focusId 契约） */
  onNavigate?: (key: string, tab?: string, focusId?: number) => void
  /** 打印标签回调（由调用方打开既有 PlateLabelPrint Dialog；未传则隐藏按钮） */
  onPrintLabel?: (plateId: number) => void
}

// ============ 小组件 ============
/** 变动动作 → 时间线节点圆点配色（CHANGE_ACTION_MAP 之外的动作落 stone） */
const ACTION_DOT: Record<string, string> = {
  RESERVE: 'bg-amber-500 ring-amber-100',
  INSTALL: 'bg-violet-500 ring-violet-100',
  REMOVE: 'bg-rose-400 ring-rose-100',
  RETURN: 'bg-emerald-500 ring-emerald-100',
  SCRAP: 'bg-stone-400 ring-stone-100',
  PURCHASE: 'bg-teal-500 ring-teal-100',
}

/** 点位动作短标签（装板/抽板） */
const POINT_SHORT: Record<string, string> = { ADD: '装板', REMOVE: '抽板' }

function StatusBadge({ status }: { status: string }) {
  const meta = PLATE_STATUS_MAP[status]
  return (
    <Badge variant="outline" className={meta?.className ?? 'bg-stone-100 text-stone-600 border-stone-200'}>
      {meta?.label ?? status}
    </Badge>
  )
}

function Info({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-stone-400">{label}</div>
      <div className={cn('text-xs text-stone-700 truncate', mono && 'font-mono')} title={value != null ? String(value) : undefined}>
        {value == null || value === '' ? '-' : value}
      </div>
    </div>
  )
}

function SectionCard({ icon, title, badge, children }: {
  icon: React.ReactNode; title: string; badge?: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="py-3 px-4 flex flex-row items-center gap-2 space-y-0">
        <span className="text-emerald-700">{icon}</span>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {badge}
      </CardHeader>
      {children && <CardContent className="px-4 pb-4 pt-0">{children}</CardContent>}
    </Card>
  )
}

/** 链路详情行（勘察/JSA/方案/票/任务/验收共用的 label + 内容行） */
function LinkRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
      <span className="text-stone-300 mt-px shrink-0">{icon}</span>
      <span className="text-stone-400 shrink-0 w-16">{label}</span>
      <div className="flex-1 min-w-0 text-stone-600 leading-relaxed">{children}</div>
    </div>
  )
}

// ============ 主组件 ============
export function PlateDossier({ plateId, open, onOpenChange, onNavigate, onPrintLabel }: PlateDossierProps) {
  const [data, setData] = useState<PlateDossierData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 档案缓存：同一盲板关闭后再开不重复请求（组件卸载前有效）
  const cacheRef = useRef<Map<number, PlateDossierData>>(new Map())
  const seqRef = useRef(0)

  const load = useCallback(async (pid: number, force = false) => {
    const cached = cacheRef.current.get(pid)
    if (cached && !force) {
      setData(cached)
      setError('')
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    setError('')
    if (!cached) setData(null)
    try {
      const d = await apiGet<PlateDossierData>(`/api/blind-plates/${pid}/dossier`)
      if (seqRef.current !== seq) return
      cacheRef.current.set(pid, d)
      setData(d)
    } catch (e) {
      if (seqRef.current !== seq) return
      setError(e instanceof Error ? e.message : '加载档案失败')
    } finally {
      if (seqRef.current === seq) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && plateId != null) void load(plateId)
  }, [open, plateId, load])

  const plate = data?.plate
  const changes = data?.changes ?? []
  const businesses = data?.businesses ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto sm:p-5">
        <SheetHeader className="p-0 space-y-1">
          <SheetTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4 text-emerald-700" />
            盲板档案{plate ? <span className="font-mono text-stone-500">{plate.code}</span> : null}
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            一板一档 · 全生命周期追溯：基础参数、变动时间线与关联业务单据链路
          </SheetDescription>
        </SheetHeader>

        {/* 加载骨架 */}
        {loading && !plate && (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-64 w-full rounded-lg" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-40 w-full rounded-lg" />
            <p className="text-center text-xs text-stone-400 flex items-center justify-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" /> 正在聚合档案数据…
            </p>
          </div>
        )}

        {/* 错误态 */}
        {!loading && error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            档案加载失败：{error}
            {plateId != null && (
              <Button variant="outline" size="sm" className="ml-3 h-7 border-rose-300 text-rose-600 hover:bg-rose-100"
                onClick={() => plateId != null && void load(plateId, true)}>
                重试
              </Button>
            )}
          </div>
        )}

        {plate && (
          <div key={plate.id} className="mt-3 space-y-3">
            {/* ===== 头部档案卡 ===== */}
            <div className="rounded-xl border border-stone-200 bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/50 p-4">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-mono text-xl font-bold tracking-tight text-stone-800">{plate.code}</span>
                <StatusBadge status={plate.status} />
                {onPrintLabel && (
                  <Button
                    size="sm"
                    className="ml-auto h-7 text-[11px] px-2.5 bg-emerald-700 hover:bg-emerald-800 text-white"
                    onClick={() => onPrintLabel(plate.id)}
                    title="打开该盲板的二维码标签打印"
                  >
                    <Printer className="h-3 w-3 mr-1" /> 打印标签
                  </Button>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2.5">
                <Info label="规格" value={plate.spec} mono />
                <Info label="类型" value={plate.type} />
                <Info label="材质" value={plate.material} />
                <Info label="厚度" value={`${plate.thickness} mm`} mono />
                <Info label="压力等级" value={plate.pressureRating} mono />
                <div className="col-span-2 md:col-span-1">
                  <div className="text-[10px] text-stone-400">当前位置</div>
                  <div className="text-xs text-stone-700 flex items-center gap-1 min-w-0">
                    <MapPin className="h-3 w-3 shrink-0 text-stone-400" />
                    <span className="truncate" title={plate.location ?? undefined}>{plate.location || '-'}</span>
                  </div>
                </div>
                <Info label="所属装置" value={plate.unitName ?? (plate.unitId != null ? `装置#${plate.unitId}` : null)} />
                <Info label="建档时间" value={fmtDate(plate.createdAt)} mono />
              </div>
            </div>

            {/* ===== 全生命周期时间线 ===== */}
            <SectionCard
              icon={<History className="h-4 w-4" />}
              title="全生命周期时间线"
              badge={
                <Badge variant="outline" className="ml-1 text-[10px] bg-stone-50 text-stone-500 border-stone-200">
                  {changes.length > 0 ? `${changes.length} 条变动` : '暂无变动'}
                </Badge>
              }
            >
              {changes.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-6 text-stone-400">
                  <Inbox className="h-6 w-6" />
                  <span className="text-xs">该盲板暂无变动记录</span>
                </div>
              ) : (
                <div className="max-h-[340px] overflow-y-auto pr-1">
                  {changes.map((r, i) => {
                    const isLast = i === changes.length - 1
                    return (
                      <div key={r.id} className="relative flex gap-3">
                        {/* 左侧节点轨道 */}
                        <div className="flex flex-col items-center shrink-0 pt-1">
                          <span className={cn('w-2.5 h-2.5 rounded-full ring-4', ACTION_DOT[r.action] ?? 'bg-stone-300 ring-stone-100')} />
                          {!isLast && <span className="w-px flex-1 min-h-[18px] bg-stone-200 my-0.5" />}
                        </div>
                        {/* 右侧内容 */}
                        <div className={cn('flex-1 min-w-0 pb-3.5', isLast && 'pb-0.5')}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-medium text-stone-800">
                              {CHANGE_ACTION_MAP[r.action] ?? r.action}
                            </span>
                            {(r.fromStatus || r.toStatus) && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-stone-400">
                                {PLATE_STATUS_MAP[r.fromStatus ?? '']?.label ?? '-'}
                                <ArrowRight className="h-3 w-3" />
                                <span className={cn('font-medium', PLATE_STATUS_MAP[r.toStatus ?? ''] ? 'text-stone-600' : 'text-stone-400')}>
                                  {PLATE_STATUS_MAP[r.toStatus ?? '']?.label ?? '-'}
                                </span>
                              </span>
                            )}
                            <span className="text-[11px] text-stone-400 font-mono" title={fmtDateTime(r.createdAt)}>
                              {timeAgo(r.createdAt)}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 border border-stone-200">
                              {r.operator}
                            </span>
                          </div>
                          {(r.workCode || r.location || r.note) && (
                            <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-stone-500">
                              {r.workCode && (
                                <span className="font-mono px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100">
                                  {r.workCode}
                                </span>
                              )}
                              {r.location && (
                                <span className="flex items-center gap-0.5 min-w-0">
                                  <MapPin className="h-3 w-3 shrink-0 text-stone-300" />
                                  <span className="truncate max-w-[240px]" title={r.location}>{r.location}</span>
                                </span>
                              )}
                              {r.note && <span className="text-stone-400 min-w-0 truncate" title={r.note}>{r.note}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </SectionCard>

            {/* ===== 关联业务单据 ===== */}
            <SectionCard
              icon={<ClipboardList className="h-4 w-4" />}
              title="关联业务单据"
              badge={
                <Badge variant="outline" className="ml-1 text-[10px] bg-stone-50 text-stone-500 border-stone-200">
                  {businesses.length > 0 ? `${businesses.length} 条需求` : '暂无'}
                </Badge>
              }
            >
              {businesses.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-6 text-stone-400">
                  <Inbox className="h-6 w-6" />
                  <span className="text-xs">该盲板尚未参与任何作业</span>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[520px] overflow-y-auto p-0.5">
                  {businesses.map((b) => (
                    <BusinessCard key={b.workRequestId} biz={b} onNavigate={onNavigate} />
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ============ 单条关联需求卡（可展开链路详情） ============
function BusinessCard({ biz, onNavigate }: {
  biz: DossierBusiness
  onNavigate?: (key: string, tab?: string, focusId?: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const statusMeta = STATUS_MAP[biz.workStatus]
  const hasDetail = !!(biz.survey || biz.jsa || biz.isolationScheme || biz.disposalScheme || biz.ticket || (biz.tasks && biz.tasks.length > 0) || (biz.acceptances && biz.acceptances.length > 0))
  const lastAcceptance = biz.acceptances && biz.acceptances.length > 0 ? biz.acceptances[0] : null

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <div className="p-3 space-y-2">
        {/* 头行：编号 + 状态 + 进度 + 跳转 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[13px] font-semibold text-stone-800">{biz.workCode}</span>
          <Badge variant="outline" className={cn('text-[10px]', statusMeta?.className ?? 'bg-stone-100 text-stone-600 border-stone-200')}>
            {statusMeta?.label ?? biz.workStatus}
          </Badge>
          <Badge variant="outline" className="text-[10px] bg-stone-50 text-stone-600 border-stone-200">
            {WORK_TYPE_MAP[biz.workType] ?? biz.workType}
          </Badge>
          {biz.pointAction && (
            <Badge variant="outline" className={cn('text-[10px] border-stone-200',
              biz.pointAction === 'ADD' ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700')}>
              {POINT_SHORT[biz.pointAction] ?? POINT_ACTION_MAP[biz.pointAction] ?? biz.pointAction}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            <MiniFlowProgress status={biz.workStatus} />
            <Button
              variant="ghost" size="sm"
              className="h-7 text-[11px] px-2 text-emerald-700 hover:text-emerald-800"
              onClick={() => onNavigate?.('work-requests', undefined, biz.workRequestId)}
              title="跳转到作业需求模块并打开该需求详情"
            >
              查看需求详情
            </Button>
          </div>
        </div>
        {/* 标题 + 点位位置 */}
        <div className="text-sm text-stone-700 font-medium truncate" title={biz.workTitle}>{biz.workTitle}</div>
        <div className="text-[11px] text-stone-400 flex items-center gap-2 flex-wrap">
          {biz.pointLocation && (
            <span className="flex items-center gap-0.5 min-w-0">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[260px]" title={biz.pointLocation}>{biz.pointLocation}</span>
            </span>
          )}
          <span>申请人 {biz.applicantName}</span>
          <span>装置 {biz.unitName ?? '-'}</span>
          <span className="font-mono">计划 {fmtDate(biz.plannedStart)} ~ {fmtDate(biz.plannedEnd)}</span>
        </div>

        {/* 展开链路详情 */}
        {hasDetail && (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 text-[11px] px-1.5 text-stone-500 hover:text-stone-700">
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
                {expanded ? '收起链路详情' : '展开链路详情'}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1.5 rounded-md bg-stone-50 border border-stone-100 divide-y divide-stone-100">
                {biz.survey && (
                  <LinkRow icon={<MapPin className="h-3.5 w-3.5" />} label="现场勘察">
                    <span className="font-medium text-stone-700">{biz.survey.surveyor}</span>
                    <span className="text-stone-400 font-mono"> · {fmtDate(biz.survey.surveyDate)}</span>
                    <span className={cn('ml-1.5', biz.survey.isSafe ? 'text-emerald-700' : 'text-rose-600')}>
                      {biz.survey.isSafe ? '具备作业条件' : '不具备作业条件'}
                    </span>
                    {biz.survey.siteCondition && <div className="text-stone-400 mt-0.5">{biz.survey.siteCondition}</div>}
                  </LinkRow>
                )}
                {biz.jsa && (
                  <LinkRow icon={<FileText className="h-3.5 w-3.5" />} label="JSA 分析">
                    <span className="font-medium text-stone-700">{biz.jsa.leader}</span>
                    <span className="text-stone-400 font-mono"> · {fmtDate(biz.jsa.analysisDate)}</span>
                    <span className="text-stone-400">
                      {' '}· 风险等级 {biz.jsa.riskLevel === 'LOW' ? '低' : biz.jsa.riskLevel === 'HIGH' ? '高' : '中'}
                    </span>
                  </LinkRow>
                )}
                {biz.isolationScheme && (
                  <LinkRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="隔离方案">
                    <span className="font-mono px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100">
                      {biz.isolationScheme.code}
                    </span>
                    <Badge variant="outline" className={cn('ml-1.5 text-[10px]', SCHEME_STATUS_MAP[biz.isolationScheme.status]?.className)}>
                      {SCHEME_STATUS_MAP[biz.isolationScheme.status]?.label ?? biz.isolationScheme.status}
                    </Badge>
                    {biz.isolationScheme.reviewedBy && <span className="text-stone-400 ml-1.5">审核人 {biz.isolationScheme.reviewedBy}</span>}
                  </LinkRow>
                )}
                {biz.disposalScheme && (
                  <LinkRow icon={<FileText className="h-3.5 w-3.5" />} label="处置方案">
                    <span className="font-mono px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100">
                      {biz.disposalScheme.code}
                    </span>
                    <Badge variant="outline" className={cn('ml-1.5 text-[10px]', SCHEME_STATUS_MAP[biz.disposalScheme.status]?.className)}>
                      {SCHEME_STATUS_MAP[biz.disposalScheme.status]?.label ?? biz.disposalScheme.status}
                    </Badge>
                  </LinkRow>
                )}
                {biz.ticket && (
                  <LinkRow icon={<TicketIcon className="h-3.5 w-3.5" />} label="作业票">
                    <span className="font-mono px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100">
                      {biz.ticket.code}
                    </span>
                    <Badge variant="outline" className={cn('ml-1.5 text-[10px]', TICKET_STATUS_MAP[biz.ticket.status]?.className)}>
                      {TICKET_STATUS_MAP[biz.ticket.status]?.label ?? biz.ticket.status}
                    </Badge>
                    {biz.ticket.guardian && <span className="text-stone-400 ml-1.5">监护人 {biz.ticket.guardian}</span>}
                  </LinkRow>
                )}
                {biz.tasks && biz.tasks.length > 0 && (
                  <LinkRow icon={<ClipboardList className="h-3.5 w-3.5" />} label="作业任务">
                    <div className="space-y-1">
                      {biz.tasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-stone-700">{t.code}</span>
                          <Badge variant="outline" className={cn('text-[10px]', TASK_STATUS_MAP[t.status]?.className)}>
                            {TASK_STATUS_MAP[t.status]?.label ?? t.status}
                          </Badge>
                          <span className="text-stone-400">执行人 {t.assignee}</span>
                        </div>
                      ))}
                    </div>
                  </LinkRow>
                )}
                {lastAcceptance && (
                  <LinkRow icon={<Inbox className="h-3.5 w-3.5" />} label="验收结论">
                    <Badge variant="outline" className={cn('text-[10px]', CONCLUSION_MAP[lastAcceptance.conclusion]?.className)}>
                      {CONCLUSION_MAP[lastAcceptance.conclusion]?.label ?? lastAcceptance.conclusion}
                    </Badge>
                    <span className="text-stone-400 ml-1.5">
                      {lastAcceptance.acceptor} · <span className="font-mono">{fmtDate(lastAcceptance.acceptedAt)}</span>
                    </span>
                    {lastAcceptance.problems && <div className="text-stone-400 mt-0.5">问题：{lastAcceptance.problems}</div>}
                  </LinkRow>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  )
}
