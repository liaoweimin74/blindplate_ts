'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost, apiPut, fmtDate, fmtDateTime } from '@/lib/bp-api'
import {
  BpUser, ModuleProps, SCHEME_STATUS_MAP, DISPOSAL_METHOD_MAP, POINT_ACTION_MAP, WORK_TYPE_MAP,
} from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import SchemePrintDialog, {
  type SchemePrintData, type SchemePrintPoint, type SchemePrintStep, type SchemePrintType,
} from '@/components/bp/scheme-print'
import { PidLocateDialog, toLocatePoints } from '@/components/bp/pid-locate'
import { parsePointRefsJson, entryActionEventName } from '@/lib/bp-types'
import type { PointRefData } from '@/lib/bp-types'
import {
  FileSignature, Eye, CheckCircle2, XCircle, Loader2, Plus, Trash2, Send, Pencil, Stamp, Printer, Network, MapPin, Sparkles, Download,
} from 'lucide-react'

interface UnitLite { id: number; name: string }
interface SchemeRow {
  id: number; workRequestId: number; code: string; preparedBy: string; preparedAt: string
  status: string; comment?: string | null; reviewedBy?: string | null
  points?: IsoPoint[]
  steps?: DispStep[]
  workRequest?: { id: number; code: string; title: string; status: string; workType: string; unitId: number } | null
}
interface IsoPoint {
  id: number; seq: number; location: string; medium?: string | null; pressure?: string | null
  temperature?: string | null; blindSpec: string; blindType: string; action: string
  blindPlateId?: number | null; done: boolean; doneAt?: string | null; operator?: string | null
  code?: string | null; name?: string | null; masterPointId?: number | null; masterCode?: string | null
}
interface DispStep {
  id?: number; seq: number; method: string; detail: string; standard?: string | null; completed: boolean
  masterPointId?: number | null; masterCode?: string | null
}

/** 需求详情中的隔离方案点位（一键导入处置步骤的数据源，GET /api/work-requests/[id]） */
interface WReqIsoPointLite {
  id: number; seq: number; location: string; blindSpec: string; blindType: string; action: string
  masterPointId?: number | null; masterCode?: string | null
}
/** 需求详情最小结构（导入数据源按需拉取） */
interface WReqDetailLite {
  survey?: { pointRefs?: string | null } | null
  isolationScheme?: { code: string; points?: WReqIsoPointLite[] | null } | null
}
interface WRow { id: number; code: string; title: string; workType: string; status: string; unitId: number; isolationScheme?: { code: string; status: string } | null; disposalScheme?: { code: string; status: string } | null }
interface Plate { id: number; code: string; spec: string; type: string; status: string }
interface Dict { id: number; category: string; value: string; label: string }
interface Unit extends UnitLite { code: string }
interface PipelineLite { id: number; code: string; name: string; medium?: string | null; pressure?: string | null }
interface MasterPointLite {
  id: number; code: string; name: string; pipelineId: number; location?: string | null
  pipeline?: { code: string; name: string; medium?: string | null; pressure?: string | null } | null
}

interface PointRow {
  location: string; medium: string; pressure: string; temperature: string; blindSpec: string; blindType: string; action: string; blindPlateId: string
  code?: string; name?: string; masterPointId?: number | null; masterCode?: string
  pipeSel?: string; pointSel?: string // 主数据级联选择临时态（不上送）
}
interface StepRow { method: string; detail: string; standard: string; masterPointId?: number | null; masterCode?: string; pointSel?: string }

/** AI 草案接口返回结构 */
interface AiIsoPointDraft {
  masterCode?: string; code?: string; name?: string; masterPointId?: number | null
  location: string; medium?: string | null; pressure?: string | null; temperature?: string | null
  blindSpec: string; blindType: string; action: string
}
interface AiDispStepDraft { method: string; detail: string; standard?: string | null; masterCode?: string; masterPointId?: number | null }

const emptyPointRow = (): PointRow => ({ location: '', medium: '', pressure: '', temperature: '', blindSpec: '', blindType: '', action: 'ADD', blindPlateId: '' })
const emptyStepRow = (): StepRow => ({ method: 'VENT', detail: '', standard: '' })

// 打印：GET /api/work-requests/[id] 详情中方案相关的最小结构
interface PrintSchemeMeta {
  code: string; preparedBy: string; preparedAt: string; status: string
  comment?: string | null; reviewedBy?: string | null; reviewedAt?: string | null
}
interface PrintDetail {
  code: string; title: string; workType: string
  location?: string | null; pipelineName?: string | null; medium?: string | null
  pressure?: string | null; temperature?: string | null
  unit?: { name?: string | null } | null
  isolationScheme?: (PrintSchemeMeta & { points?: SchemePrintPoint[] | null }) | null
  disposalScheme?: (PrintSchemeMeta & { steps?: SchemePrintStep[] | null }) | null
}

const CAN_REVIEW = ['REVIEWER', 'MANAGER', 'ADMIN']
const CAN_ENG = ['ENGINEER', 'ADMIN']

function SchemeBadge({ status }: { status: string }) {
  const m = SCHEME_STATUS_MAP[status]
  return <Badge variant="outline" className={cn('text-[11px] whitespace-nowrap', m?.className)}>{m?.label ?? status}</Badge>
}

export default function SchemesModule({ currentUser, initialTab, singleTab }: ModuleProps & { singleTab?: 'isolation' | 'disposal' }) {
  const { toast } = useToast()
  const [tab, setTab] = useState<string>(singleTab ?? (initialTab === 'disposal' ? 'disposal' : 'isolation'))
  const [isoSchemes, setIsoSchemes] = useState<SchemeRow[]>([])
  const [dispSchemes, setDispSchemes] = useState<SchemeRow[]>([])
  const [requests, setRequests] = useState<WRow[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [specDict, setSpecDict] = useState<Dict[]>([])
  const [typeDict, setTypeDict] = useState<Dict[]>([])
  const [plates, setPlates] = useState<Plate[]>([])
  const [pipelines, setPipelines] = useState<PipelineLite[]>([])
  const [pointMasters, setPointMasters] = useState<MasterPointLite[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ALL')

  const [detail, setDetail] = useState<SchemeRow | null>(null)
  const [detailType, setDetailType] = useState<'isolation' | 'disposal'>('isolation')
  const [detailOpen, setDetailOpen] = useState(false)
  // PID 图定位查看：idx 为当前定位的隔离点行下标，null = 关闭
  const [pidLocateIdx, setPidLocateIdx] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  // 编辑器
  const [editOpen, setEditOpen] = useState(false)
  const [editPreparedBy, setEditPreparedBy] = useState('')
  const [editPointRows, setEditPointRows] = useState<PointRow[]>([])
  const [editStepRows, setEditStepRows] = useState<StepRow[]>([])
  const [createRequestId, setCreateRequestId] = useState<string>('')
  const [aiBusy, setAiBusy] = useState(false)

  // 打印
  const [printOpen, setPrintOpen] = useState(false)
  const [printType, setPrintType] = useState<SchemePrintType>('ISOLATION')
  const [printData, setPrintData] = useState<SchemePrintData | null>(null)
  const [printingId, setPrintingId] = useState<number | null>(null)

  // 一键导入：勘察点位（隔离方案）/ 隔离方案点位（处置方案）——打开编辑器或切换关联需求时按需拉取
  const [surveyRefs, setSurveyRefs] = useState<PointRefData[]>([])
  const [isoSrcPoints, setIsoSrcPoints] = useState<WReqIsoPointLite[]>([])
  const [isoSrcCode, setIsoSrcCode] = useState('')
  const [importBusy, setImportBusy] = useState(false)

  const role = currentUser.role
  const canReview = CAN_REVIEW.includes(role)
  const canEng = CAN_ENG.includes(role)

  // AI 助手入口直达：[入口:isolation-scheme:new|新建隔离方案] 等动作 → 打开新建编辑器
  // （仅独立菜单实例监听自己的模块 key；openCreate 经 ref 转发避免闭包过期）
  const openCreateRef = useRef<(type: 'isolation' | 'disposal') => void>(() => {})
  useEffect(() => {
    if (!singleTab) return
    const moduleKey = singleTab === 'disposal' ? 'disposal-scheme' : 'isolation-scheme'
    const handler = (e: Event) => {
      if ((e as CustomEvent<{ action?: string }>).detail?.action === 'new') openCreateRef.current(singleTab)
    }
    window.addEventListener(entryActionEventName(moduleKey), handler)
    return () => window.removeEventListener(entryActionEventName(moduleKey), handler)
  }, [singleTab])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [iso, disp, reqs, us, pls, pms] = await Promise.all([
        apiGet<SchemeRow[]>('/api/isolation-schemes'),
        apiGet<SchemeRow[]>('/api/disposal-schemes'),
        apiGet<WRow[]>('/api/work-requests'),
        apiGet<Unit[]>('/api/units'),
        apiGet<{ list: PipelineLite[] }>('/api/pipelines').catch(() => ({ list: [] })),
        apiGet<{ list: MasterPointLite[] }>('/api/iso-point-masters').catch(() => ({ list: [] })),
      ])
      setIsoSchemes(iso)
      setDispSchemes(disp)
      setRequests(reqs)
      setUnits(us)
      setPipelines(pls.list ?? [])
      setPointMasters(pms.list ?? [])
    } catch (e) {
      toast({ title: '加载失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setLoading(false) }
  }, [toast])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => {
    apiGet<Dict[]>('/api/dicts?category=BLIND_SPEC').then(setSpecDict).catch(() => {})
    apiGet<Dict[]>('/api/dicts?category=BLIND_TYPE').then(setTypeDict).catch(() => {})
    apiGet<Plate[]>('/api/blind-plates?status=IN_STOCK').then(setPlates).catch(() => {})
  }, [])

  const reqMap = useMemo(() => new Map(requests.map((r) => [r.id, r])), [requests])
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  // 可新建方案的需求（隔离：JSA 完成或方案被驳回；处置：隔离方案已审核或处置方案被驳回）
  const isoCreatableReqs = useMemo(() => requests.filter((r) => r.status === 'JSA_DONE' || r.status === 'ISOLATION_REJECTED'), [requests])
  // 可编处置方案的需求：隔离方案审批通过后需求直接进入 DISPOSAL_PREPARING（ISOLATION_APPROVED 仅瞬时态不停留），
  // 故候选口径为 DISPOSAL_PREPARING（含刚审批通过待编制的）+ DISPOSAL_REJECTED（被驳回重编）
  const dispCreatableReqs = useMemo(() => requests.filter((r) => r.status === 'DISPOSAL_PREPARING' || r.status === 'DISPOSAL_REJECTED'), [requests])

  const openDetail = (s: SchemeRow, type: 'isolation' | 'disposal') => {
    setDetail(s); setDetailType(type); setComment(''); setDetailOpen(true)
  }

  const review = async (approve: boolean) => {
    if (!detail) return
    if (!comment.trim()) { toast({ title: '请填写审核意见', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost(`/api/${detailType}-schemes/${detail.id}/review`, { approve, comment: comment.trim(), reviewer: currentUser.name })
      toast({ title: approve ? '审核通过' : '已驳回', description: approve ? `方案 ${detail.code} 审核通过，流程已推进` : '已退回编制人修改' })
      setDetailOpen(false)
      loadAll()
    } catch (e) {
      toast({ title: '审核失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const openEditor = (s: SchemeRow, type: 'isolation' | 'disposal') => {
    setDetail(s); setDetailType(type)
    setEditPreparedBy(s.preparedBy)
    if (type === 'isolation') {
      setEditPointRows(s.points?.length ? s.points.map((p) => {
        const mp = p.masterPointId ? pointMasters.find((m) => m.id === p.masterPointId) : undefined
        return {
          location: p.location, medium: p.medium ?? '', pressure: p.pressure ?? '', temperature: p.temperature ?? '',
          blindSpec: p.blindSpec, blindType: p.blindType, action: p.action,
          blindPlateId: p.blindPlateId ? String(p.blindPlateId) : '',
          code: p.code ?? undefined, name: p.name ?? undefined,
          masterPointId: p.masterPointId ?? null, masterCode: p.masterCode ?? undefined,
          pipeSel: mp ? String(mp.pipelineId) : undefined,
          pointSel: p.masterPointId ? String(p.masterPointId) : undefined,
        }
      }) : [emptyPointRow()])
    } else {
      setEditStepRows(s.steps?.length ? s.steps.map((x) => ({
        method: x.method, detail: x.detail, standard: x.standard ?? '',
        masterPointId: x.masterPointId ?? null, masterCode: x.masterCode ?? undefined,
        pointSel: x.masterPointId ? String(x.masterPointId) : '',
      })) : [emptyStepRow()])
    }
    setEditOpen(true)
  }

  // 新建方案（修「隔离方案无法新建」：入口从需求详情页提升到方案编制页）
  const openCreate = (type: 'isolation' | 'disposal') => {
    setDetail(null); setDetailType(type)
    setCreateRequestId('')
    setEditPreparedBy(currentUser.name)
    if (type === 'isolation') setEditPointRows([emptyPointRow()])
    else setEditStepRows([emptyStepRow()])
    setEditOpen(true)
  }
  // 入口动作监听用的最新引用（AI 助手「新建隔离方案/新建工艺处置方案」直达）
  openCreateRef.current = openCreate

  // 主数据级联：选中某个隔离点主数据 → 填充行（位置/介质/压力/编码/名称/主数据引用）
  const applyMasterToPoint = (row: PointRow, mpId: string): PointRow => {
    const mp = pointMasters.find((m) => String(m.id) === mpId)
    if (!mp) return { ...row, pointSel: '' }
    const pipe = pipelines.find((p) => p.id === mp.pipelineId)
    return {
      ...row,
      pointSel: mpId,
      location: mp.location || mp.name || row.location,
      medium: pipe?.medium ?? row.medium,
      pressure: pipe?.pressure ?? row.pressure,
      code: mp.code,
      name: mp.name,
      masterPointId: mp.id,
      masterCode: mp.code,
    }
  }

  // ===== 一键导入（确定性数据搬运：勘察点位 → 隔离方案；隔离方案点位 → 处置步骤） =====
  // 关联需求 id：编辑既有方案取 detail，新建取下拉选择
  const importWid = detail?.workRequestId ?? (createRequestId ? Number(createRequestId) : 0)
  // 打开编辑器或切换关联需求时拉取需求详情（勘察 pointRefs + 隔离方案点位），驱动导入按钮计数/禁用与摘要
  useEffect(() => {
    setSurveyRefs([]); setIsoSrcPoints([]); setIsoSrcCode('')
    if (!editOpen || !importWid) return
    let cancelled = false
    apiGet<WReqDetailLite>(`/api/work-requests/${importWid}`).then((d) => {
      if (cancelled) return
      setSurveyRefs(parsePointRefsJson(d.survey?.pointRefs))
      setIsoSrcCode(d.isolationScheme?.code ?? '')
      setIsoSrcPoints(d.isolationScheme?.points ?? [])
    }).catch(() => { /* 拉取失败时按钮禁用（计数 0），不阻塞编辑 */ })
    return () => { cancelled = true }
  }, [editOpen, importWid])

  /** 隔离方案：导入勘察记录已确认引用的隔离点位 → 隔离点行（自动关联主数据并回填位置/介质/压力；盲板规格/类型为安全属性，须人工补选） */
  const importSurveyPoints = async () => {
    if (!importWid || importBusy) return
    setImportBusy(true)
    try {
      const fresh = surveyRefs.filter((r) => !editPointRows.some((x) => x.masterPointId === r.masterPointId))
      if (!fresh.length) { toast({ title: '勘察点位均已在清单中', description: '未新增隔离点' }); return }
      const rows: PointRow[] = fresh.map((r) => {
        const mp = pointMasters.find((m) => m.id === r.masterPointId)
        const pipe = mp ? pipelines.find((p) => p.id === mp.pipelineId) : undefined
        return {
          ...emptyPointRow(),
          location: mp?.location || r.name || '',
          medium: pipe?.medium ?? '',
          pressure: pipe?.pressure ?? '',
          code: r.code, name: r.name,
          masterPointId: r.masterPointId, masterCode: r.code,
          pipeSel: mp ? String(mp.pipelineId) : undefined,
          pointSel: mp ? String(r.masterPointId) : undefined,
        }
      })
      setEditPointRows((prev) => [...prev.filter((x) => x.location.trim() || x.masterPointId), ...rows])
      toast({
        title: `已导入 ${rows.length} 个勘察点位`,
        description: '已关联主数据并回填位置/介质/压力，请逐行补选盲板规格/类型并预留库存盲板后保存',
      })
    } finally { setImportBusy(false) }
  }

  /** 处置方案：导入隔离方案确认的隔离点位 → 生成「切断加盲板」处置步骤并关联主数据（前后处置序列仍需人工编排） */
  const importIsolationPoints = async () => {
    if (!importWid || importBusy) return
    setImportBusy(true)
    try {
      const fresh = isoSrcPoints.filter((p) => !(p.masterPointId && editStepRows.some((x) => x.masterPointId === p.masterPointId)))
      if (!fresh.length) { toast({ title: '隔离方案点位均已在步骤中', description: '未新增处置步骤' }); return }
      const rows: StepRow[] = fresh.map((p) => ({
        method: 'ISOLATE',
        detail: `在 ${p.location}${p.action === 'REMOVE' ? '拆除' : '加装'}盲板（${p.blindSpec} ${p.blindType}）`,
        standard: '',
        masterPointId: p.masterPointId ?? null,
        masterCode: p.masterCode ?? undefined,
        pointSel: p.masterPointId ? String(p.masterPointId) : '',
      }))
      setEditStepRows((prev) => [...prev.filter((x) => x.detail.trim() || x.masterPointId), ...rows])
      toast({
        title: `已从隔离方案 ${isoSrcCode || ''} 导入 ${rows.length} 个点位`,
        description: '已生成切断加盲板步骤并关联主数据，请补全泄压/排净/置换/检测等前置步骤与合格标准后保存',
      })
    } finally { setImportBusy(false) }
  }

  /** AI 草案：基于作业需求/勘察/主数据/库存生成隔离点或处置步骤并预填编辑器 */
  const genAiDraft = async () => {
    const wid = detail?.workRequestId ?? Number(createRequestId)
    if (!Number.isFinite(wid) || !wid) {
      toast({ title: '请先选择关联作业需求', variant: 'destructive' }); return
    }
    setAiBusy(true)
    try {
      if (detailType === 'isolation') {
        const res = await apiPost<{ draft: { points: AiIsoPointDraft[] }; scope?: { matchedEquipments?: { code: string }[]; rationale?: string; fallbackUsed?: boolean } }>('/api/ai/draft/isolation', { workRequestId: wid })
        const usedPlates = new Set<number>()
        const rows: PointRow[] = res.draft.points.map((p) => {
          const mp = p.masterCode ? pointMasters.find((m) => m.code === p.masterCode) : undefined
          // 自动预留同规格+类型的在库盲板（无精确匹配退回同规格），避免人工逐行挑选
          let blindPlateId = ''
          if (p.action === 'ADD') {
            const cand = plates.find((pl) => pl.spec === p.blindSpec && pl.type === p.blindType && !usedPlates.has(pl.id))
              ?? plates.find((pl) => pl.spec === p.blindSpec && !usedPlates.has(pl.id))
            if (cand) { blindPlateId = String(cand.id); usedPlates.add(cand.id) }
          }
          return {
            location: p.location,
            medium: p.medium ?? '',
            pressure: p.pressure ?? '',
            temperature: p.temperature ?? '',
            blindSpec: p.blindSpec,
            blindType: p.blindType,
            action: p.action === 'REMOVE' ? 'REMOVE' : 'ADD',
            blindPlateId,
            code: p.code ?? mp?.code,
            name: p.name ?? mp?.name,
            masterPointId: mp?.id ?? p.masterPointId ?? null,
            masterCode: mp?.code ?? p.masterCode,
            pipeSel: mp ? String(mp.pipelineId) : undefined,
            pointSel: mp ? String(mp.id) : undefined,
          }
        })
        if (rows.length) setEditPointRows(rows)
        toast({ title: 'AI 隔离方案草案已生成', description: [res.scope?.rationale, `${rows.length} 个隔离点已填入，请核对盲板预留与主数据引用后保存`].filter(Boolean).join('｜').slice(0, 140) })
      } else {
        const res = await apiPost<{ draft: { steps: AiDispStepDraft[] } }>('/api/ai/draft/disposal', { workRequestId: wid })
        const rows: StepRow[] = res.draft.steps.map((s) => {
          const mp = s.masterCode ? pointMasters.find((m) => m.code === s.masterCode) : undefined
          return {
            method: s.method,
            detail: s.detail,
            standard: s.standard ?? '',
            masterPointId: mp?.id ?? s.masterPointId ?? null,
            masterCode: mp?.code ?? s.masterCode,
            pointSel: mp ? String(mp.id) : '',
          }
        })
        if (rows.length) setEditStepRows(rows)
        toast({ title: 'AI 处置方案草案已生成', description: `${rows.length} 个步骤已填入，请核对后保存` })
      }
    } catch (e) {
      toast({ title: 'AI 草案生成失败', description: e instanceof Error ? e.message : '请稍后重试', variant: 'destructive' })
    } finally { setAiBusy(false) }
  }

  const saveEdit = async (andSubmit: boolean) => {
    if (!editPreparedBy) { toast({ title: '编制人不能为空', variant: 'destructive' }); return }
    if (detailType === 'isolation') {
      if (editPointRows.some((r) => !r.location || !r.blindSpec || !r.blindType)) {
        toast({ title: '请完善隔离点', description: '位置、盲板规格、盲板类型为必填', variant: 'destructive' }); return
      }
      for (const r of editPointRows) {
        if (r.action === 'ADD' && !r.blindPlateId) {
          toast({ title: '加装点必须预留盲板', description: `位置「${r.location}」需选择在库盲板`, variant: 'destructive' }); return
        }
      }
    } else {
      if (editStepRows.some((r) => !r.detail)) { toast({ title: '请完善处置步骤内容', variant: 'destructive' }); return }
    }
    if (!detail && !createRequestId) {
      toast({ title: '请选择关联作业需求', description: detailType === 'isolation' ? '需完成 JSA 分析或方案被驳回后可新建' : '需隔离方案审核通过或方案被驳回后可新建', variant: 'destructive' }); return
    }
    setBusy(true)
    try {
      if (detailType === 'isolation') {
        const points = editPointRows.map((r, i) => ({
          seq: i + 1,
          location: r.location,
          medium: r.medium || null,
          pressure: r.pressure || null,
          temperature: r.temperature || null,
          blindSpec: r.blindSpec,
          blindType: r.blindType,
          action: r.action,
          blindPlateId: r.blindPlateId ? Number(r.blindPlateId) : null,
          code: r.code || null,
          name: r.name || null,
          masterPointId: r.masterPointId ?? null,
          masterCode: r.masterCode || null,
        }))
        let schemeId = detail?.id
        if (detail) {
          await apiPut(`/api/isolation-schemes/${detail.id}`, { preparedBy: editPreparedBy, points })
        } else {
          const created = await apiPost<{ scheme: { id: number } }>('/api/isolation-schemes', { workRequestId: Number(createRequestId), preparedBy: editPreparedBy, points })
          schemeId = created.scheme?.id
        }
        if (andSubmit && schemeId) await apiPost(`/api/isolation-schemes/${schemeId}/submit`)
      } else {
        const steps = editStepRows.map((r, i) => ({
          seq: i + 1,
          method: r.method,
          detail: r.detail,
          standard: r.standard || null,
          masterPointId: r.masterPointId ?? null,
          masterCode: r.masterCode || null,
        }))
        let schemeId = detail?.id
        if (detail) {
          await apiPut(`/api/disposal-schemes/${detail.id}`, { preparedBy: editPreparedBy, steps })
        } else {
          const created = await apiPost<{ scheme: { id: number } }>('/api/disposal-schemes', { workRequestId: Number(createRequestId), preparedBy: editPreparedBy, steps })
          schemeId = created.scheme?.id
        }
        if (andSubmit && schemeId) await apiPost(`/api/disposal-schemes/${schemeId}/submit`)
      }
      toast({ title: andSubmit ? (detail ? '已保存并提交审核' : '已创建并提交审核') : (detail ? '已保存' : '已创建草稿') })
      setEditOpen(false)
      setDetailOpen(false)
      loadAll()
    } catch (e) {
      toast({ title: detail ? '保存失败' : '创建失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  // 打印：列表数据缺少需求全量字段（装置名/位置/管线/介质/压力/温度），先拉需求详情再组装
  const openPrint = async (s: SchemeRow, type: 'isolation' | 'disposal') => {
    setPrintingId(s.id)
    try {
      const d = await apiGet<PrintDetail>(`/api/work-requests/${s.workRequestId}`)
      const iso = type === 'isolation' ? d.isolationScheme : null
      const disp = type === 'disposal' ? d.disposalScheme : null
      const scheme = iso ?? disp
      if (!scheme) {
        toast({ title: '打印失败', description: '该需求下暂无对应方案数据', variant: 'destructive' })
        return
      }
      setPrintType(type === 'isolation' ? 'ISOLATION' : 'DISPOSAL')
      setPrintData({
        request: {
          code: d.code, title: d.title, workType: d.workType,
          unitName: d.unit?.name ?? null, location: d.location ?? null,
          pipelineName: d.pipelineName ?? null, medium: d.medium ?? null,
          pressure: d.pressure ?? null, temperature: d.temperature ?? null,
        },
        scheme: {
          code: scheme.code, preparedBy: scheme.preparedBy, preparedAt: scheme.preparedAt,
          status: scheme.status, reviewedBy: scheme.reviewedBy ?? null,
          reviewedAt: scheme.reviewedAt ?? null, comment: scheme.comment ?? null,
        },
        points: iso?.points ?? [],
        steps: disp?.steps ?? [],
      })
      setPrintOpen(true)
    } catch (e) {
      toast({ title: '获取打印数据失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setPrintingId(null) }
  }

  const submitFromList = async (s: SchemeRow) => {
    try {
      await apiPost(`/api/${detailTypeOf(s)}-schemes/${s.id}/submit`)
      toast({ title: '已提交审核' }); loadAll()
    } catch (e) {
      toast({ title: '提交失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  const detailTypeOf = (s: SchemeRow): 'isolation' | 'disposal' => (s.points ? 'isolation' : 'disposal')

  const detailTypeForTab = (tab === 'disposal' ? 'disposal' : 'isolation') as 'isolation' | 'disposal'

  const filterRows = (rows: SchemeRow[]) => (statusFilter === 'ALL' ? rows : rows.filter((r) => r.status === statusFilter))

  const renderTable = (rows: SchemeRow[], type: 'isolation' | 'disposal') => {
    const filtered = filterRows(rows)
    if (loading) return <div className="py-16 text-center text-sm text-stone-400">加载中…</div>
    if (filtered.length === 0) {
      return (
        <div className="py-16 text-center">
          <FileSignature className="w-10 h-10 text-stone-300 mx-auto mb-2" />
          <p className="text-sm text-stone-400">暂无{type === 'isolation' ? '隔离' : '工艺处置'}方案</p>
        </div>
      )
    }
    return (
      <div className="max-h-[520px] overflow-y-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-stone-50 sticky top-0 z-10">
            <tr className="text-stone-500">
              <th className="text-left font-medium px-3 py-2.5">方案编号</th>
              <th className="text-left font-medium px-3 py-2.5">关联需求</th>
              <th className="text-left font-medium px-3 py-2.5">装置</th>
              <th className="text-left font-medium px-3 py-2.5">编制人</th>
              <th className="text-left font-medium px-3 py-2.5">编制时间</th>
              <th className="text-left font-medium px-3 py-2.5">{type === 'isolation' ? '隔离点数' : '步骤数'}</th>
              <th className="text-left font-medium px-3 py-2.5">状态</th>
              <th className="text-right font-medium px-3 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const wr = s.workRequest ?? reqMap.get(s.workRequestId)
              return (
                <tr key={s.id} className="border-t border-stone-100 hover:bg-emerald-50/40">
                  <td className="px-3 py-2.5 font-mono text-[11px] text-stone-500">{s.code}</td>
                  <td className="px-3 py-2.5 max-w-[200px]">
                    <div className="text-stone-800 font-medium truncate">{wr?.title ?? `#${s.workRequestId}`}</div>
                    <div className="text-[11px] text-stone-400 font-mono">{wr?.code ?? '-'} · {wr ? WORK_TYPE_MAP[wr.workType] ?? '' : ''}</div>
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">{wr ? unitMap.get(wr.unitId)?.name ?? '-' : '-'}</td>
                  <td className="px-3 py-2.5 text-stone-600">{s.preparedBy}</td>
                  <td className="px-3 py-2.5 text-stone-400 whitespace-nowrap">{fmtDate(s.preparedAt)}</td>
                  <td className="px-3 py-2.5 text-stone-600">{type === 'isolation' ? s.points?.length ?? 0 : s.steps?.length ?? 0}</td>
                  <td className="px-3 py-2.5"><SchemeBadge status={s.status} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {canEng && ['DRAFT', 'REJECTED'].includes(s.status) && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2 text-stone-500" onClick={() => openEditor(s, type)}><Pencil className="w-3 h-3 mr-0.5" />编辑</Button>
                          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => submitFromList(s)}><Send className="w-3 h-3 mr-0.5" />提交</Button>
                        </>
                      )}
                      {canReview && s.status === 'PENDING_REVIEW' && (
                        <Button size="sm" className="h-7 text-[11px] px-2 bg-emerald-700 hover:bg-emerald-800" onClick={() => openDetail(s, type)}><Stamp className="w-3 h-3 mr-0.5" />审核</Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2 text-stone-500" onClick={() => openDetail(s, type)}><Eye className="w-3 h-3 mr-0.5" />详情</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2 text-stone-500" disabled={printingId === s.id} onClick={() => openPrint(s, type)}>
                        {printingId === s.id ? <Loader2 className="w-3 h-3 mr-0.5 animate-spin" /> : <Printer className="w-3 h-3 mr-0.5" />}打印
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        {!singleTab && (
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="bg-stone-200/60">
            <TabsTrigger value="isolation" className="text-xs">隔离方案</TabsTrigger>
            <TabsTrigger value="disposal" className="text-xs">工艺处置方案</TabsTrigger>
          </TabsList>
        </div>
        )}
        <div className={cn('flex flex-wrap items-center gap-2', singleTab && 'mb-1')}>
          <span className="text-xs text-stone-400">状态筛选</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部状态</SelectItem>
              {Object.entries(SCHEME_STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          {canEng && (detailTypeForTab === 'isolation' ? (
            <Button size="sm" className="h-8 bg-emerald-700 hover:bg-emerald-800" onClick={() => openCreate('isolation')}>
              <Plus className="w-3.5 h-3.5 mr-1" />新建隔离方案
            </Button>
          ) : (
            <Button size="sm" className="h-8 bg-teal-700 hover:bg-teal-800" onClick={() => openCreate('disposal')}>
              <Plus className="w-3.5 h-3.5 mr-1" />新建工艺处置方案
            </Button>
          ))}
        </div>
        <TabsContent value="isolation" className="mt-0">
          <Card className="shadow-sm">
            <CardHeader className="py-3 px-4 space-y-0"><CardTitle className="text-sm font-semibold">隔离方案审核工作台</CardTitle></CardHeader>
            <CardContent className="px-4 pb-4 pt-0">{renderTable(isoSchemes, 'isolation')}</CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="disposal" className="mt-0">
          <Card className="shadow-sm">
            <CardHeader className="py-3 px-4 space-y-0"><CardTitle className="text-sm font-semibold">工艺处置方案审核工作台</CardTitle></CardHeader>
            <CardContent className="px-4 pb-4 pt-0">{renderTable(dispSchemes, 'disposal')}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 方案详情/审核 Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-[820px] overflow-y-auto sm:p-5">
          {detail ? (
            <div className="space-y-3">
              <SheetHeader className="p-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <SheetTitle className="text-base font-mono">{detail.code}</SheetTitle>
                  <SchemeBadge status={detail.status} />
                  <span className="text-xs text-stone-400">{detailType === 'isolation' ? '隔离方案' : '工艺处置方案'}</span>
                </div>
                <SheetDescription className="text-xs">
                  关联需求：{detail.workRequest?.code ?? reqMap.get(detail.workRequestId)?.code ?? '-'} · {detail.workRequest?.title ?? reqMap.get(detail.workRequestId)?.title ?? '-'} · 编制人 {detail.preparedBy} · {fmtDateTime(detail.preparedAt)}
                </SheetDescription>
              </SheetHeader>

              {detail.status === 'REJECTED' && detail.comment && (
                <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-2">驳回意见：{detail.comment}</div>
              )}
              {detail.status === 'APPROVED' && detail.comment && (
                <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs px-3 py-2">审核意见：{detail.comment}（审核人 {detail.reviewedBy}）</div>
              )}

              {detailType === 'isolation' ? (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs min-w-[760px]">
                    <thead className="bg-stone-50 text-stone-500">
                      <tr><th className="text-left px-2 py-1.5 w-10">#</th><th className="text-left px-2 py-1.5">隔离位置</th><th className="text-left px-2 py-1.5 w-24">主数据</th><th className="text-left px-2 py-1.5 w-16">介质</th><th className="text-left px-2 py-1.5 w-14">压力</th><th className="text-left px-2 py-1.5 w-14">温度</th><th className="text-left px-2 py-1.5 w-24">盲板</th><th className="text-left px-2 py-1.5 w-18">动作</th><th className="text-left px-2 py-1.5 w-24">执行状态</th><th className="text-left px-2 py-1.5 w-16">PID</th></tr>
                    </thead>
                    <tbody>
                      {(detail.points ?? []).map((p, i) => (
                        <tr key={p.id} className="border-t border-stone-100">
                          <td className="px-2 py-1.5 text-stone-400">{p.seq}</td>
                          <td className="px-2 py-1.5">{p.location}</td>
                          <td className="px-2 py-1.5">{p.masterCode ? <Badge variant="outline" className="text-[10px] bg-teal-50 text-teal-700 border-teal-200 font-mono">{p.masterCode}</Badge> : <span className="text-stone-300">-</span>}</td>
                          <td className="px-2 py-1.5">{p.medium ?? '-'}</td>
                          <td className="px-2 py-1.5">{p.pressure ?? '-'}</td>
                          <td className="px-2 py-1.5">{p.temperature ?? '-'}</td>
                          <td className="px-2 py-1.5 font-medium">{p.blindSpec} {p.blindType}</td>
                          <td className="px-2 py-1.5"><Badge variant="outline" className={cn('text-[10px]', p.action === 'ADD' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>{POINT_ACTION_MAP[p.action]}</Badge></td>
                          <td className="px-2 py-1.5">{p.done ? <span className="text-emerald-600">✓ {p.operator}</span> : <span className="text-stone-400">待执行</span>}</td>
                          <td className="px-2 py-1.5">
                            <button
                              onClick={() => setPidLocateIdx(i)}
                              title="在 PID 图中定位该隔离点"
                              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-teal-700 hover:bg-teal-50 border border-teal-200 transition-colors"
                            >
                              <MapPin className="h-3 w-3" />图
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs min-w-[560px]">
                    <thead className="bg-stone-50 text-stone-500">
                      <tr><th className="text-left px-2 py-1.5 w-10">#</th><th className="text-left px-2 py-1.5 w-24">处置方式</th><th className="text-left px-2 py-1.5">处置内容</th><th className="text-left px-2 py-1.5">合格标准</th><th className="text-left px-2 py-1.5 w-14">状态</th></tr>
                    </thead>
                    <tbody>
                      {(detail.steps ?? []).map((s) => (
                        <tr key={s.id ?? s.seq} className="border-t border-stone-100">
                          <td className="px-2 py-1.5 text-stone-400">{s.seq}</td>
                          <td className="px-2 py-1.5"><Badge variant="outline" className="text-[10px] bg-teal-50 text-teal-700 border-teal-200">{DISPOSAL_METHOD_MAP[s.method] ?? s.method}</Badge></td>
                          <td className="px-2 py-1.5">{s.detail}{s.masterCode && <Badge variant="outline" className="ml-1 text-[9px] bg-teal-50 text-teal-700 border-teal-200 font-mono">{s.masterCode}</Badge>}</td>
                          <td className="px-2 py-1.5 text-stone-500">{s.standard ?? '-'}</td>
                          <td className="px-2 py-1.5">{s.completed ? <span className="text-emerald-600">✓</span> : <span className="text-stone-400">待执行</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 审核面板 */}
              {canReview && detail.status === 'PENDING_REVIEW' && (
                <Card className="border-emerald-200 shadow-sm">
                  <CardHeader className="py-2.5 px-4 space-y-0">
                    <CardTitle className="text-sm font-semibold text-emerald-800">审核操作</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-0 space-y-2">
                    <Label className="text-xs text-stone-500">审核意见</Label>
                    <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="请填写审核意见（必填）" />
                    <div className="flex gap-2">
                      <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={busy} onClick={() => review(true)}><CheckCircle2 className="w-4 h-4 mr-1" />同意通过</Button>
                      <Button variant="outline" className="border-rose-300 text-rose-600 hover:bg-rose-50" disabled={busy} onClick={() => review(false)}><XCircle className="w-4 h-4 mr-1" />驳回</Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <>
              <SheetHeader className="p-0">
                <SheetTitle className="sr-only">加载中</SheetTitle>
                <SheetDescription className="sr-only">方案详情加载中</SheetDescription>
              </SheetHeader>
              <div className="py-24 text-center text-sm text-stone-400"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />加载中…</div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* 方案编辑/新建弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[860px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail ? (detailType === 'isolation' ? '编辑隔离方案' : '编辑工艺处置方案') : (detailType === 'isolation' ? '新建隔离方案' : '新建工艺处置方案')}{detail ? ` · ${detail.code}` : ''}</DialogTitle>
            <DialogDescription>
              {detail ? '保存后可提交审核；驳回状态重新提交将同步更新需求状态' : (detailType === 'isolation' ? '从主数据引用隔离点位，确定盲板规格与位置后创建方案' : '编制泄压/排净/置换/吹扫/检测等工艺处置步骤后创建方案')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {!detail && (
              <div>
                <Label className="text-xs text-stone-500">关联作业需求 *</Label>
                <Select value={createRequestId} onValueChange={setCreateRequestId}>
                  <SelectTrigger className="h-8 text-xs w-full mt-1"><SelectValue placeholder="选择可编制的需求" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {(detailType === 'isolation' ? isoCreatableReqs : dispCreatableReqs).map((r) => {
                      const existed = detailType === 'isolation' ? r.isolationScheme : r.disposalScheme
                      return (
                        <SelectItem key={r.id} value={String(r.id)} disabled={!!existed}>
                          {r.code} · {r.title}
                          {detailType === 'disposal' && r.isolationScheme && (
                            <span className="text-teal-600">（隔离方案 {r.isolationScheme.code} 已审批）</span>
                          )}
                          {existed && <span className="text-amber-600">（已编制 {existed.code}，请在列表中直接编辑）</span>}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                {(detailType === 'isolation' ? isoCreatableReqs : dispCreatableReqs).length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    暂无可编制的需求（{detailType === 'isolation' ? '需完成 JSA 分析，或隔离方案被驳回后重新编制' : '需隔离方案审核通过，或工艺处置方案被驳回后重新编制'}）
                  </p>
                )}
              </div>
            )}
            <div><Label className="text-xs text-stone-500">编制人</Label>
              <Input className="h-8 text-xs w-52 mt-1" value={editPreparedBy} onChange={(e) => setEditPreparedBy(e.target.value)} /></div>
            {/* AI 草案生成条 */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" />
              <span className="shrink-0 text-[11px] font-medium text-violet-700">AI 草案</span>
              <span className="min-w-[180px] flex-1 text-[11px] text-violet-500/90">
                基于作业需求、勘察记录、隔离点主数据与在库盲板自动生成{detailType === 'isolation' ? '隔离点清单' : '处置步骤'}，生成后可逐行修改
              </span>
              <Button size="sm" type="button" variant="outline" disabled={aiBusy || (!detail && !createRequestId)}
                onClick={() => void genAiDraft()}
                className="h-7 border-violet-300 bg-white px-2.5 text-[11px] text-violet-700 hover:bg-violet-100"
                title={detail || createRequestId ? 'AI 根据该作业需求自动生成草案' : '请先选择关联作业需求'}>
                {aiBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3 text-violet-500" />}
                {aiBusy ? 'AI 生成中…' : 'AI 生成草案'}
              </Button>
            </div>
            {/* 一键导入行（确定性数据搬运：上游环节已确认的点位直接带入，区别于 AI 草案） */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2">
              <Download className="h-3.5 w-3.5 shrink-0 text-teal-600" />
              <span className="shrink-0 text-[11px] font-medium text-teal-700">一键导入</span>
              {detailType === 'isolation' ? (
                <>
                  <span className="min-w-[160px] flex-1 text-[11px] text-teal-500/90">把现场勘察记录引用的隔离点位带入清单，自动关联主数据并回填位置/介质/压力</span>
                  <Button size="sm" type="button" variant="outline" disabled={importBusy || !importWid || !surveyRefs.length}
                    onClick={() => void importSurveyPoints()}
                    className="h-7 border-teal-300 bg-white px-2.5 text-[11px] text-teal-700 hover:bg-teal-100 hover:text-teal-800"
                    title={!importWid ? '请先选择关联作业需求' : !surveyRefs.length ? '该需求的勘察记录未引用隔离点位，可用 AI 草案或手动添加' : '把勘察记录已确认的点位一键带入（合并去重）'}>
                    {importBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                    导入勘察点位{surveyRefs.length ? `（${surveyRefs.length}）` : ''}
                  </Button>
                  {surveyRefs.length > 0 && (
                    <span className="w-full truncate text-[11px] text-stone-400" title={surveyRefs.map((r) => `${r.code} ${r.name}`).join('；')}>
                      勘察已确认：{surveyRefs.map((r) => r.code).join('、')}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="min-w-[160px] flex-1 text-[11px] text-teal-500/90">把隔离方案确认的隔离点位生成「切断加盲板」步骤并关联主数据</span>
                  <Button size="sm" type="button" variant="outline" disabled={importBusy || !importWid || !isoSrcPoints.length}
                    onClick={() => void importIsolationPoints()}
                    className="h-7 border-teal-300 bg-white px-2.5 text-[11px] text-teal-700 hover:bg-teal-100 hover:text-teal-800"
                    title={!importWid ? '请先选择关联作业需求' : !isoSrcPoints.length ? '该需求暂无隔离方案或方案无隔离点位' : '把隔离方案点位一键生成为处置步骤（合并去重）'}>
                    {importBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                    导入隔离方案点位{isoSrcPoints.length ? `（${isoSrcPoints.length}）` : ''}
                  </Button>
                  {isoSrcPoints.length > 0 && (
                    <span className="w-full truncate text-[11px] text-stone-400" title={`${isoSrcCode}：${isoSrcPoints.map((p) => `${p.masterCode || p.location} ${p.blindSpec} ${p.blindType}`).join('；')}`}>
                      隔离方案 {isoSrcCode}：{isoSrcPoints.map((p) => p.masterCode || p.location).join('、')}
                    </span>
                  )}
                </>
              )}
            </div>
            {detailType === 'isolation' ? (
              <div className="space-y-2">
                {editPointRows.map((r, i) => (
                  <div key={i} className="rounded-md border p-2.5 space-y-2 bg-stone-50/60">
                    <div className="flex items-center text-xs text-stone-400">
                      <span className="font-medium text-stone-600">隔离点 {i + 1}</span>
                      {r.masterPointId && r.masterCode && (
                        <Badge variant="outline" className="ml-2 text-[10px] bg-teal-50 text-teal-700 border-teal-200 font-mono">已关联主数据 {r.masterCode}</Badge>
                      )}
                      {editPointRows.length > 1 && <button className="ml-auto text-rose-500 hover:text-rose-700 flex items-center" onClick={() => setEditPointRows(editPointRows.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3 mr-0.5" />删除</button>}
                    </div>
                    {/* 隔离点主数据级联引用 */}
                    <div className="flex flex-wrap items-center gap-1.5 rounded bg-teal-50/70 border border-teal-100 px-2 py-1.5">
                      <Network className="w-3 h-3 text-teal-600 shrink-0" />
                      <span className="text-[11px] text-teal-700 font-medium shrink-0">主数据引用</span>
                      <Select value={r.pipeSel ?? ''} onValueChange={(v) => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, pipeSel: v || undefined, pointSel: '' } : x))}>
                        <SelectTrigger className="h-7 text-[11px] w-[150px] bg-white"><SelectValue placeholder="选择管线" /></SelectTrigger>
                        <SelectContent className="max-h-56">
                          {pipelines.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} {p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select
                        value={r.pointSel ?? ''}
                        disabled={!r.pipeSel}
                        onValueChange={(v) => setEditPointRows(editPointRows.map((x, j) => j === i ? applyMasterToPoint(x, v) : x))}
                      >
                        <SelectTrigger className="h-7 text-[11px] w-[190px] bg-white"><SelectValue placeholder={r.pipeSel ? '选择隔离点' : '先选管线'} /></SelectTrigger>
                        <SelectContent className="max-h-56">
                          {pointMasters.filter((m) => r.pipeSel && String(m.pipelineId) === r.pipeSel).map((m) => (
                            <SelectItem key={m.id} value={String(m.id)}>{m.code} {m.name}{m.location ? `（${m.location}）` : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {r.masterPointId && (
                        <button className="text-[11px] text-stone-400 hover:text-rose-600 ml-1"
                          onClick={() => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, masterPointId: null, masterCode: undefined, code: undefined, name: undefined, pointSel: '' } : x))}>
                          清除关联
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="col-span-2"><Input className="h-8 text-xs" placeholder="隔离位置 *" value={r.location} onChange={(e) => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, location: e.target.value } : x))} /></div>
                      <Input className="h-8 text-xs" placeholder="介质" value={r.medium} onChange={(e) => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, medium: e.target.value } : x))} />
                      <Input className="h-8 text-xs" placeholder="压力" value={r.pressure} onChange={(e) => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, pressure: e.target.value } : x))} />
                      <Input className="h-8 text-xs" placeholder="温度" value={r.temperature} onChange={(e) => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, temperature: e.target.value } : x))} />
                      <Select value={r.blindSpec} onValueChange={(v) => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, blindSpec: v } : x))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="盲板规格 *" /></SelectTrigger>
                        <SelectContent>{specDict.map((d) => <SelectItem key={d.id} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={r.blindType} onValueChange={(v) => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, blindType: v } : x))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="盲板类型 *" /></SelectTrigger>
                        <SelectContent>{typeDict.map((d) => <SelectItem key={d.id} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={r.action} onValueChange={(v) => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, action: v, blindPlateId: v === 'REMOVE' ? '' : x.blindPlateId } : x))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="ADD">加装盲板</SelectItem><SelectItem value="REMOVE">拆除盲板</SelectItem></SelectContent>
                      </Select>
                      {r.action === 'ADD' ? (
                        <Select value={r.blindPlateId} onValueChange={(v) => setEditPointRows(editPointRows.map((x, j) => j === i ? { ...x, blindPlateId: v } : x))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="预留在库盲板 *" /></SelectTrigger>
                          <SelectContent className="max-h-56">
                            {plates.filter((p) => p.spec === r.blindSpec).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}（{p.spec} {p.type}）</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : <div className="h-8 flex items-center text-[11px] text-stone-400 px-1">拆除点：执行时绑定现场盲板</div>}
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="text-xs border-emerald-300 text-emerald-700" onClick={() => setEditPointRows([...editPointRows, emptyPointRow()])}>
                  <Plus className="w-3.5 h-3.5 mr-1" />添加隔离点
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {editStepRows.map((r, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <span className="col-span-1 text-xs text-stone-400 text-center">{i + 1}</span>
                    <Select value={r.method} onValueChange={(v) => setEditStepRows(editStepRows.map((x, j) => j === i ? { ...x, method: v } : x))}>
                      <SelectTrigger className="col-span-2 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(DISPOSAL_METHOD_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="col-span-3 h-8 text-xs" placeholder="处置内容 *" value={r.detail} onChange={(e) => setEditStepRows(editStepRows.map((x, j) => j === i ? { ...x, detail: e.target.value } : x))} />
                    <Input className="col-span-2 h-8 text-xs" placeholder="合格标准" value={r.standard} onChange={(e) => setEditStepRows(editStepRows.map((x, j) => j === i ? { ...x, standard: e.target.value } : x))} />
                    <Select
                      value={r.pointSel ?? (r.masterPointId ? String(r.masterPointId) : '')}
                      onValueChange={(v) => {
                        const mp = pointMasters.find((m) => String(m.id) === v)
                        setEditStepRows(editStepRows.map((x, j) => j === i ? { ...x, pointSel: v, masterPointId: mp?.id ?? null, masterCode: mp?.code ?? undefined } : x))
                      }}
                    >
                      <SelectTrigger className="col-span-3 h-8 text-xs"><SelectValue placeholder="关联隔离点（可选）" /></SelectTrigger>
                      <SelectContent className="max-h-56">
                        <SelectItem value="none">不关联</SelectItem>
                        {pointMasters.map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>[{m.pipeline?.name ?? pipelines.find((p) => p.id === m.pipelineId)?.name ?? ''}] {m.code} {m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button className="col-span-1 text-rose-500 hover:text-rose-700 flex justify-center" onClick={() => setEditStepRows(editStepRows.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="text-xs border-emerald-300 text-emerald-700" onClick={() => setEditStepRows([...editStepRows, emptyStepRow()])}>
                  <Plus className="w-3.5 h-3.5 mr-1" />添加步骤
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button variant="outline" className="border-emerald-300 text-emerald-700" disabled={busy} onClick={() => saveEdit(false)}>{detail ? '仅保存' : '创建草稿'}</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={busy} onClick={() => saveEdit(true)}><Send className="w-3.5 h-3.5 mr-1" />{detail ? '保存并提交审核' : '创建并提交审核'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 方案打印弹窗（隔离/处置 A4） */}
      <SchemePrintDialog open={printOpen} onOpenChange={setPrintOpen} type={printType} data={printData} />

      {/* PID 图定位查看（以隔离点挂标为中心放大） */}
      <PidLocateDialog
        open={pidLocateIdx !== null}
        onClose={() => setPidLocateIdx(null)}
        points={toLocatePoints(detail?.points ?? [])}
        initialIndex={pidLocateIdx ?? 0}
        preferUnitId={detail?.workRequest?.unitId ?? null}
      />
    </div>
  )
}
