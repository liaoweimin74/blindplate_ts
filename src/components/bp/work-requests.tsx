'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost, fmtDate, fmtDateTime, toLocalInput } from '@/lib/bp-api'
import {
  BpUser, ModuleProps, STATUS_MAP, FLOW_STEPS, flowStepIndex, URGENCY_MAP,
  SCHEME_STATUS_MAP, DISPOSAL_METHOD_MAP, POINT_ACTION_MAP, TICKET_STATUS_MAP, CONCLUSION_MAP,
  APPROVE_ACTION_MAP, entryActionEventName,
} from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'
import {
  ClipboardList, Plus, Search, Send, Ban, Eye, MapPin, FileText, ShieldCheck,
  Stamp, Ticket as TicketIcon, CheckCircle2, Loader2, Trash2, XCircle, ChevronRight, ChevronDown, Download, History, Printer, Factory,
  X, Pencil, Sparkles, ListChecks, AlertTriangle, ShieldAlert, Megaphone,
} from 'lucide-react'
import QrLabelPrint, { type QrLabelPoint } from '@/components/bp/qr-label-print'
import { CrewEditor, CrewWall, crewGaps, type WorkerCert } from '@/components/bp/crew'
import { ISO_STATE_STYLE, IsoState } from '@/components/bp/pid-config'
import { PidLocateDialog, toLocatePoints, type LocatePoint } from '@/components/bp/pid-locate'
import { exportCsv } from '@/lib/bp-export'
import FlowTimeline from '@/components/bp/flow-timeline'
import { MiniFlowProgress } from '@/components/bp/mini-flow-progress'
import WrPrintDialog, { exportWrArchiveCsv } from '@/components/bp/wr-print'
import { AttachmentWall, type AttachmentDto } from '@/components/bp/bp-media'

// ============ 类型 ============
interface Unit { id: number; code: string; name: string }
interface Dict { id: number; category: string; value: string; label: string }
interface Plate { id: number; code: string; spec: string; type: string; status: string; location?: string | null }
interface UserRow { id: string; name: string; role: string }

/** 管线主数据（GET /api/pipelines，响应为 { list } 包装） */
interface Pipeline {
  id: number; code: string; name: string; unitId?: number | null
  medium?: string | null; pressure?: string | null; material?: string | null; spec?: string | null
  unitName?: string | null; pointCount?: number
}

/** 隔离点主数据（GET /api/iso-point-masters，响应为 { list } 包装） */
interface PointMaster {
  id: number; code: string; name: string; pipelineId?: number | null; location?: string | null; remark?: string | null
  pipelineName?: string | null
  pipeline?: { id: number; code: string; name: string; medium?: string | null; pressure?: string | null } | null
}

/** 勘察/JSA 引用的隔离点位（pointRefs JSON 反序列化结构；reason 为 AI 推举理由仅会话内参考；blindState 为移动端勘察现场核实的通盲状态快照，需求25） */
interface PointRef { masterPointId: number; code: string; name: string; pipelineName?: string | null; blindState?: string | null; reason?: string }

/** 管线占用冲突行（GET /api/pipeline-occupancy：同管线已有其他需求生效作业票） */
interface PipelineConflict {
  pipelineId: number; pipelineCode: string; pipelineName: string
  workRequestId: number; workRequestCode: string; workRequestTitle: string; workRequestStatus: string
  ticketCode: string | null; ticketStatus: string | null
}

/** GET /api/pipeline-occupancy 响应 */
interface OccupancyResp { pipelineIds: number[]; conflicts: PipelineConflict[] }

/** 安全解析 SiteSurvey/JsaAnalysis.pointRefs（JSON 字符串） */
function parsePointRefs(raw?: string | null): PointRef[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && x.masterPointId != null && !!x.code)
      .map((x) => ({
        masterPointId: Number(x.masterPointId),
        code: String(x.code),
        name: String(x.name ?? ''),
        pipelineName: typeof x.pipelineName === 'string' ? x.pipelineName : null,
        blindState: typeof x.blindState === 'string' ? x.blindState : null,
      }))
  } catch { return [] }
}

interface WRow {
  id: number; code: string; title: string; unitId: number; location: string
  pipelineName?: string | null
  pipelineId?: number | null
  medium?: string | null; pressure?: string | null; temperature?: string | null; reason: string
  urgency: string; status: string; applicantName: string; plannedStart?: string | null
  plannedEnd?: string | null; createdAt: string
  unit?: Unit | null
}
interface JsaStep { id?: number; seq: number; step: string; hazard: string; measure: string }
interface IsoPoint {
  id: number; seq: number; location: string; medium?: string | null; pressure?: string | null
  temperature?: string | null; blindSpec: string; blindType: string; action: string
  blindPlateId?: number | null; done: boolean; doneAt?: string | null; operator?: string | null
  masterPointId?: number | null; masterCode?: string | null; code?: string | null; name?: string | null
}
/** 隔离点实时状态行（与 /api/pid-diagrams/[id]/status 六态契约一致） */
interface PointStatusRow {
  id: number; seq: number; masterPointId?: number | null; masterCode?: string | null
  masterName?: string | null; pipelineName?: string | null
  state: IsoState; stateLabel: string
}
interface PointStatusResp { points: PointStatusRow[]; diagrams: { id: number; name: string }[]; generatedAt: string }
interface DispStep {
  id: number; seq: number; method: string; detail: string; standard?: string | null; completed: boolean
  confirmedBy?: string | null; confirmedAt?: string | null; confirmResult?: string | null; confirmRemark?: string | null
  masterPointId?: number | null; masterCode?: string | null
}
interface Approval { id: number; bizType: string; bizCode?: string | null; action: string; operator: string; comment?: string | null; createdAt: string }
/** 现场交底记录（移动端交底方提交；Task 75-c 桌面端可视化） */
interface BriefingLite {
  id: number; ticketId: number | null; ticketCode: string | null
  pointCode: string | null; pointLocation: string | null
  briefingUser: string; briefedUsers: string | null
  content: string; status: string
  confirmedBy: string | null; confirmedAt: string | null; confirmRemark: string | null
  aiCheckResult: string | null
  createdAt: string
}
interface Detail extends WRow {
  unit: Unit | null
  survey: { id: number; surveyor: string; surveyDate: string; siteCondition: string; pipelineVerify?: string | null; hazardPoints?: string | null; pointRefs?: string | null; isSafe: boolean; suggestion?: string | null } | null
  jsa: { leader: string; members?: string | null; analysisDate: string; riskLevel: string; residualRisk?: string | null; pointRefs?: string | null; steps: JsaStep[] } | null
  isolationScheme: { id: number; code: string; preparedBy: string; status: string; comment?: string | null; reviewedBy?: string | null; preparedAt?: string | null; reviewedAt?: string | null; points: IsoPoint[] } | null
  disposalScheme: { id: number; code: string; preparedBy: string; status: string; comment?: string | null; reviewedBy?: string | null; preparedAt?: string | null; reviewedAt?: string | null; steps: DispStep[] } | null
  disposalConfirmation: { confirmer: string; confirmedAt: string; flammableResult?: string | null; oxygenResult?: string | null; toxicResult?: string | null; analysisQualified: boolean; remarks?: string | null; result: string } | null
  ticket: { id: number; code: string; plannedStart: string; plannedEnd: string; guardian: string; workers: string; issuer: string; safetyMeasures: string; status: string; comment?: string | null; createdAt?: string | null; approvedAt?: string | null; approvedBy?: string | null; startedAt?: string | null; finishedAt?: string | null; closedAt?: string | null } | null
  tickets: { id: number; code: string; pointId?: number | null; pointCode?: string | null; pointLocation?: string | null; blindSpec?: string | null; blindType?: string | null; action?: string | null; plannedStart: string; plannedEnd: string; guardian: string; workers: string; issuer: string; safetyMeasures: string; workerCerts?: string | null; status: string; comment?: string | null; approvedBy?: string | null; approvedAt?: string | null; startedAt?: string | null; finishedAt?: string | null; closedAt?: string | null }[]
  task: { code: string; status: string } | null
  acceptance: { id: number; acceptor: string; acceptedAt: string; leakCheck: boolean; restoreCheck: boolean; ledgerCheck: boolean; conclusion: string; problems?: string | null; remarks?: string | null } | null
  approvals: Approval[]
}

const ALL_STATUSES = Object.keys(STATUS_MAP)
const CAN_ENG = ['ENGINEER', 'ADMIN']
const CAN_TICKET = ['ENGINEER', 'MANAGER', 'ADMIN']
const CAN_REVIEW = ['REVIEWER', 'MANAGER', 'ADMIN']
const CAN_ACCEPT = ['ACCEPTOR', 'MANAGER', 'ADMIN']

const DEFAULT_MEASURES = `1.作业人员佩戴防化手套、护目镜
2.高处作业系挂安全带，工具系挂防坠绳
3.现场设置警戒区，配备灭火器2具
4.作业前确认可燃气体检测合格
5.专人全程监护，严禁交叉作业`

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_MAP[status]
  return <Badge variant="outline" className={cn('text-[11px] whitespace-nowrap', m?.className)}>{m?.label ?? status}</Badge>
}

function FlowBar({ status }: { status: string }) {
  const idx = flowStepIndex(status)
  if (idx < 0) return <div className="rounded-md bg-stone-100 border border-stone-200 text-stone-500 text-xs px-3 py-2">该需求已取消，流程终止</div>
  return (
    <div className="flex items-center flex-wrap gap-y-2">
      {FLOW_STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] border',
            i < idx ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
            i === idx ? 'bg-white border-emerald-500 text-emerald-700 font-semibold ring-2 ring-emerald-100' :
            'bg-stone-50 border-stone-200 text-stone-400')}>
            <span className={cn('w-2 h-2 rounded-full', i < idx ? 'bg-emerald-500' : i === idx ? 'bg-emerald-500' : 'bg-stone-300')} />
            {s.label}
          </div>
          {i < FLOW_STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-stone-300 mx-0.5 shrink-0" />}
        </div>
      ))}
      {idx >= FLOW_STEPS.length && (
        <div className="ml-1 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] bg-emerald-600 text-white font-semibold">
          <CheckCircle2 className="w-3 h-3" />全流程完成
        </div>
      )}
    </div>
  )
}

/** 列表行内迷你流程进度条：已提取为共享组件 mini-flow-progress.tsx（供统计下钻/看板等复用） */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-stone-500">{label}</Label>
      {children}
    </div>
  )
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-md bg-stone-50 border border-stone-100 px-3 py-2">
      <div className="text-[11px] text-stone-400">{label}</div>
      <div className="text-sm text-stone-800 mt-0.5 break-all">{value || '-'}</div>
    </div>
  )
}

function SectionCard({ icon, title, badge, action, children }: {
  icon: React.ReactNode; title: string; badge?: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="py-3 px-4 flex flex-row items-center gap-2 space-y-0">
        <span className="text-emerald-700">{icon}</span>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {badge}
        <div className="ml-auto">{action}</div>
      </CardHeader>
      {children && <CardContent className="px-4 pb-4 pt-0">{children}</CardContent>}
    </Card>
  )
}

interface PointRow {
  location: string; medium: string; pressure: string; temperature: string; blindSpec: string; blindType: string; action: string; blindPlateId: string
  masterPointId?: number | null; masterCode?: string | null; code?: string | null; name?: string | null
  pipeSel?: string; pointSel?: string // 级联选择器临时状态（不提交后端）
}
interface StepRow { method: string; detail: string; standard: string; masterPointId?: number | null; masterCode?: string | null }

/** AI 草案接口返回结构（/api/ai/draft/isolation、/api/ai/draft/disposal） */
interface AiIsoPointDraft {
  masterCode?: string; code?: string; name?: string; masterPointId?: number | null
  location: string; medium?: string | null; pressure?: string | null; temperature?: string | null
  blindSpec: string; blindType: string; action: string
}
interface AiDispStepDraft { method: string; detail: string; standard?: string | null; masterCode?: string; masterPointId?: number | null }

/** 新建隔离点行的默认值（含主数据引用字段） */
function newIsoRow(medium = '', pressure = '', temperature = ''): PointRow {
  return { location: '', medium, pressure, temperature, blindSpec: '', blindType: '', action: 'ADD', blindPlateId: '', masterPointId: null, masterCode: null, code: null, name: null, pipeSel: '', pointSel: 'none' }
}

/** 工作台模式（侧边栏子菜单 initialTab）：现场勘察 / JSA 分析 */
type Workbench = 'survey' | 'jsa' | null
const SURVEY_WB_STATUSES = ['PENDING_SURVEY', 'SURVEYED']
const JSA_WB_STATUSES = ['SURVEYED', 'JSA_DONE']

export default function WorkRequestsModule({ currentUser, initialTab, focusId, onNavigate }: ModuleProps) {
  const { toast } = useToast()
  const [rows, setRows] = useState<WRow[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  // 工作台模式：勘察/JSA 子菜单进入；服务端取全量，前端 useMemo 强制收敛到本环节状态（覆盖手动状态筛选）
  const workbench: Workbench = initialTab === 'survey' ? 'survey' : initialTab === 'jsa' ? 'jsa' : null
  const [status, setStatus] = useState<string>('ALL')

  const [units, setUnits] = useState<Unit[]>([])
  const [specDict, setSpecDict] = useState<Dict[]>([])
  const [typeDict, setTypeDict] = useState<Dict[]>([])
  const [mediumDict, setMediumDict] = useState<Dict[]>([])
  const [plates, setPlates] = useState<Plate[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [pointMasters, setPointMasters] = useState<PointMaster[]>([])

  // 新建需求
  const [createOpen, setCreateOpen] = useState(false)
  // AI 助手入口直达：[入口:work-requests:new|新建作业需求] → 打开新建对话框
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<{ action?: string }>).detail?.action === 'new') setCreateOpen(true)
    }
    window.addEventListener(entryActionEventName('work-requests'), handler)
    return () => window.removeEventListener(entryActionEventName('work-requests'), handler)
  }, [])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: '', unitId: '', location: '', pipelineId: '', pipelineName: '', medium: '', pressure: '', temperature: '', reason: '', urgency: 'MEDIUM', plannedStart: '', plannedEnd: '' })

  // 取消
  const [cancelId, setCancelId] = useState<number | null>(null)

  // 详情
  const [detail, setDetail] = useState<Detail | null>(null)
  const [surveyPhotos, setSurveyPhotos] = useState<AttachmentDto[]>([])
  const [acceptPhotos, setAcceptPhotos] = useState<AttachmentDto[]>([])
  const [briefings, setBriefings] = useState<BriefingLite[]>([])
  const [briefAtts, setBriefAtts] = useState<Record<number, AttachmentDto[]>>({})
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  // 作业票隔离点位 PID 定位查看弹窗（null = 关闭，否则为当前定位点位下标）
  const [pidLocateIdx, setPidLocateIdx] = useState<number | null>(null)
  // 勘察/JSA 记录编辑模式（详情 Sheet 内切换 展示↔表单，仅在当前环节态下可编辑以免状态回退）
  const [editSurvey, setEditSurvey] = useState(false)
  const [editJsa, setEditJsa] = useState(false)
  // 隔离点实时状态（六态：idle/planned/approved/working/blinded/opened）与关联组态图
  const [pointStatus, setPointStatus] = useState<PointStatusResp | null>(null)
  // 详情档案打印（复用详情已加载的 Detail，含 approvals）
  const [printOpen, setPrintOpen] = useState(false)
  // 作业票票面明细展开（Task 111：每张票可展开查看安全措施+逐人验资照片墙，key=票 id）
  const [ticketDetailOpen, setTicketDetailOpen] = useState<Record<number, boolean>>({})

  // 隔离方案编辑
  const [isoOpen, setIsoOpen] = useState(false)
  const [isoPreparedBy, setIsoPreparedBy] = useState('')
  const [isoRows, setIsoRows] = useState<PointRow[]>([])
  const [isoEditId, setIsoEditId] = useState<number | null>(null)
  // 隔离/处置方案 AI 草案 busy（violet 生成预填；一键导入为同步合并无并发风险，与方案编制模块 schemes.tsx 同款能力）
  const [isoAiBusy, setIsoAiBusy] = useState(false)
  const [dispAiBusy, setDispAiBusy] = useState(false)
  // 处置方案编辑
  const [dispOpen, setDispOpen] = useState(false)
  const [dispPreparedBy, setDispPreparedBy] = useState('')
  const [dispRows, setDispRows] = useState<StepRow[]>([])
  // 处置确认
  const [confirmForm, setConfirmForm] = useState({ confirmer: '', stepsConfirmed: true, flammableResult: '', oxygenResult: '', toxicResult: '', analysisQualified: true, remarks: '', result: 'QUALIFIED' })
  // 确认人默认当前用户（仅当未填写过时填充）
  useEffect(() => {
    setConfirmForm((f) => (f.confirmer ? f : { ...f, confirmer: currentUser.name }))
  }, [currentUser.name])
  // 开票（一票一板：按隔离点批量开票）；workers 由验资清单姓名自动生成，两处永不脱节
  const [ticketOpen, setTicketOpen] = useState(false)
  const [ticketForm, setTicketForm] = useState({ plannedStart: '', plannedEnd: '', guardian: '', issuer: '', safetyMeasures: DEFAULT_MEASURES })
  const [ticketCrew, setTicketCrew] = useState<WorkerCert[]>([])
  const [ticketPointIds, setTicketPointIds] = useState<number[]>([])
  // 处置步骤逐项确认 Dialog（stepId null=关闭）
  const [stepConfirmFor, setStepConfirmFor] = useState<{ id: number; seq: number; detail: string } | null>(null)
  const [stepConfirmForm, setStepConfirmForm] = useState<{ result: string; remark: string; confirmer: string }>({ result: 'OK', remark: '', confirmer: '' })
  const [stepConfirmBusy, setStepConfirmBusy] = useState(false)
  // 管线占用冲突（安全硬约束：一条管线同一时间只允许一张生效中的盲板作业票）
  const [occ, setOcc] = useState<OccupancyResp | null>(null)
  const occConflicts = occ?.conflicts ?? []
  const fetchOccupancy = useCallback(async (id: number) => {
    try {
      setOcc(await apiGet<OccupancyResp>(`/api/pipeline-occupancy?workRequestId=${id}`))
    } catch { setOcc(null) }
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (status !== 'ALL') params.set('status', status)
      const data = await apiGet<WRow[]>(`/api/work-requests?${params.toString()}`)
      setRows(data)
    } catch (e) {
      toast({ title: '加载失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setLoading(false) }
  }, [keyword, status, toast])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => {
    apiGet<Unit[]>('/api/units').then(setUnits).catch(() => {})
    apiGet<Dict[]>('/api/dicts?category=BLIND_SPEC').then(setSpecDict).catch(() => {})
    apiGet<Dict[]>('/api/dicts?category=BLIND_TYPE').then(setTypeDict).catch(() => {})
    apiGet<Dict[]>('/api/dicts?category=MEDIUM').then(setMediumDict).catch(() => {})
    apiGet<Plate[]>('/api/blind-plates?status=IN_STOCK').then(setPlates).catch(() => {})
    apiGet<UserRow[]>('/api/users').then(setUsers).catch(() => {})
    // 管线/隔离点主数据（响应为 { list } 包装）
    apiGet<{ list: Pipeline[] }>('/api/pipelines').then((d) => setPipelines(d.list ?? [])).catch(() => {})
    apiGet<{ list: PointMaster[] }>('/api/iso-point-masters').then((d) => setPointMasters(d.list ?? [])).catch(() => {})
  }, [])

  const openDetail = useCallback(async (id: number) => {
    setDetailOpen(true); setDetailLoading(true); setPointStatus(null); setEditSurvey(false); setEditJsa(false)
    setOcc(null)
    try {
      // 详情 + 隔离点实时状态 + 管线占用并行拉取（后两者失败不阻断详情展示）
      const [d, ps] = await Promise.all([
        apiGet<Detail>(`/api/work-requests/${id}`),
        apiGet<PointStatusResp>(`/api/work-requests/${id}/point-status`).catch(() => null),
        fetchOccupancy(id),
      ])
      setDetail(d)
      setPointStatus(ps)
      loadDetailPhotos(d)
    } catch (e) {
      toast({ title: '加载详情失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
      setDetailOpen(false)
    } finally { setDetailLoading(false) }
  }, [toast, fetchOccupancy])

  // 现场照片（勘察/验收，Task 74 移动端上传；失败不阻断详情）
  const loadDetailPhotos = useCallback((d: Detail) => {
    setSurveyPhotos([]); setAcceptPhotos([])
    setBriefings([]); setBriefAtts({})
    if (d.survey) {
      apiGet<AttachmentDto[]>(`/api/attachments?bizType=SITE_SURVEY&bizId=${d.survey.id}`).then(setSurveyPhotos).catch(() => null)
    }
    if (d.acceptance) {
      apiGet<AttachmentDto[]>(`/api/attachments?bizType=ACCEPTANCE&bizId=${d.acceptance.id}`).then(setAcceptPhotos).catch(() => null)
    }
    // 现场交底记录 + 每条交底的附件（Task 75-c 桌面端可视化；失败不阻断详情）
    apiGet<BriefingLite[]>(`/api/briefings?workRequestId=${d.id}`).then(async (bs) => {
      setBriefings(bs)
      const pairs = await Promise.all(bs.map(async (b) => {
        const atts = await apiGet<AttachmentDto[]>(`/api/attachments?bizType=BRIEFING&bizId=${b.id}`).catch(() => [] as AttachmentDto[])
        return [b.id, atts] as const
      }))
      setBriefAtts(Object.fromEntries(pairs))
    }).catch(() => null)
  }, [])

  // focusId 联动：全局搜索/统计分析下钻携带 focusId 导航进来时，自动打开对应需求详情
  const lastFocusRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (focusId != null && focusId !== lastFocusRef.current) {
      lastFocusRef.current = focusId
      void openDetail(focusId)
    }
  }, [focusId, openDetail])

  const reloadDetail = useCallback(async (id: number) => {
    try {
      const [d, ps] = await Promise.all([
        apiGet<Detail>(`/api/work-requests/${id}`),
        apiGet<PointStatusResp>(`/api/work-requests/${id}/point-status`).catch(() => null),
      ])
      setDetail(d)
      setPointStatus(ps)
      loadDetailPhotos(d)
      void fetchOccupancy(id)
    } catch { /* ignore */ }
  }, [fetchOccupancy])

  const role = currentUser.role
  const canEng = CAN_ENG.includes(role)
  const canTicketRole = CAN_TICKET.includes(role)
  // 隔离点实时状态索引（IsolationPoint.id → 状态行），供详情 Sheet 点位表格渲染
  const psMap: Record<number, PointStatusRow> = pointStatus
    ? Object.fromEntries(pointStatus.points.map((r) => [r.id, r]))
    : {}
  const canAcceptRole = CAN_ACCEPT.includes(role)

  // 工作台模式：在服务端结果上强制收敛到本环节状态（覆盖用户手选的状态筛选，保证进页面即是待办）
  const displayRows = useMemo(() => {
    if (workbench === 'survey') return rows.filter((r) => SURVEY_WB_STATUSES.includes(r.status) && (status === 'ALL' || r.status === status))
    if (workbench === 'jsa') return rows.filter((r) => JSA_WB_STATUSES.includes(r.status) && (status === 'ALL' || r.status === status))
    return rows
  }, [rows, workbench, status])

  // 勘察/JSA 已引用的隔离点位（pointRefs JSON → chips）
  const surveyRefs = detail ? parsePointRefs(detail.survey?.pointRefs) : []
  const jsaRefs = detail ? parsePointRefs(detail.jsa?.pointRefs) : []

  // ============ 操作 ============
  const createRequest = async () => {
    if (!form.title || !form.location || !form.reason || !form.unitId) {
      toast({ title: '请完善必填项', description: '标题、装置、位置、作业原因为必填', variant: 'destructive' }); return
    }
    setBusy(true)
    try {
      await apiPost('/api/work-requests', {
        ...form, unitId: Number(form.unitId),
        pipelineId: form.pipelineId ? Number(form.pipelineId) : null,
        applicantId: currentUser.id, applicantName: currentUser.name,
        plannedStart: form.plannedStart ? new Date(form.plannedStart).toISOString() : null,
        plannedEnd: form.plannedEnd ? new Date(form.plannedEnd).toISOString() : null,
      })
      toast({ title: '成功', description: '作业需求已创建（草稿）' })
      setCreateOpen(false)
      setForm({ title: '', unitId: '', location: '', pipelineId: '', pipelineName: '', medium: '', pressure: '', temperature: '', reason: '', urgency: 'MEDIUM', plannedStart: '', plannedEnd: '' })
      loadList()
    } catch (e) {
      toast({ title: '创建失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  /** 当前登录用户透传（服务端审计留痕 actor） */
  const actor = () => ({ __actorId: currentUser.id, __actorName: currentUser.name })

  const submitRequest = async (row: WRow) => {
    try {
      await apiPost(`/api/work-requests/${row.id}/submit`, actor())
      toast({ title: '已提交', description: `${row.code} 已进入现场勘察环节` })
      loadList(); if (detail?.id === row.id) reloadDetail(row.id)
    } catch (e) {
      toast({ title: '提交失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  const cancelRequest = async () => {
    if (!cancelId) return
    try {
      await apiPost(`/api/work-requests/${cancelId}/cancel`, actor())
      toast({ title: '已取消' })
      setCancelId(null); loadList(); if (detail) reloadDetail(detail.id)
    } catch (e) {
      toast({ title: '取消失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  const saveSurvey = async (s: Omit<NonNullable<Detail['survey']>, 'id'>, pointRefs: PointRef[]) => {
    if (!detail) return
    if (!s.surveyor || !s.siteCondition) {
      toast({ title: '请完善勘察信息', description: '勘察人与现场条件为必填', variant: 'destructive' }); return
    }
    setBusy(true)
    try {
      await apiPost(`/api/work-requests/${detail.id}/survey`, {
        ...s, surveyDate: s.surveyDate || new Date().toISOString(),
        pointRefs: pointRefs.length ? pointRefs : undefined,
        __actorId: currentUser.id, __actorName: currentUser.name,
      })
      toast({ title: '现场勘察已保存', description: '需求进入 JSA 分析环节' })
      setEditSurvey(false)
      reloadDetail(detail.id); loadList()
    } catch (e) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const saveJsa = async (f: { leader: string; members: string; riskLevel: string; residualRisk: string; steps: JsaStep[] }, pointRefs: PointRef[]) => {
    if (!detail) return
    if (!f.leader) { toast({ title: '分析组长不能为空', variant: 'destructive' }); return }
    if (f.steps.some((s) => !s.step || !s.hazard || !s.measure)) {
      toast({ title: '请完善JSA步骤', description: '每个步骤的作业步骤/危害因素/控制措施均不能为空', variant: 'destructive' }); return
    }
    setBusy(true)
    try {
      await apiPost(`/api/work-requests/${detail.id}/jsa`, {
        ...f, analysisDate: new Date().toISOString(),
        steps: f.steps.map((s, i) => ({ ...s, seq: i + 1 })),
        pointRefs: pointRefs.length ? pointRefs : undefined,
        __actorId: currentUser.id, __actorName: currentUser.name,
      })
      toast({ title: 'JSA 分析已保存', description: '需求进入方案编制环节' })
      setEditJsa(false)
      reloadDetail(detail.id); loadList()
    } catch (e) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const openIsoEditor = (scheme?: Detail['isolationScheme']) => {
    setIsoPreparedBy(scheme?.preparedBy ?? currentUser.name)
    setIsoEditId(scheme?.id ?? null)
    setIsoRows(scheme?.points.length ? scheme.points.map((p) => {
      const master = pointMasters.find((m) => m.id === p.masterPointId)
      return {
        location: p.location, medium: p.medium ?? '', pressure: p.pressure ?? '', temperature: p.temperature ?? '',
        blindSpec: p.blindSpec, blindType: p.blindType, action: p.action,
        blindPlateId: p.blindPlateId ? String(p.blindPlateId) : '',
        masterPointId: p.masterPointId ?? null, masterCode: p.masterCode ?? null, code: p.code ?? null, name: p.name ?? null,
        pipeSel: master?.pipelineId != null ? String(master.pipelineId) : '',
        pointSel: p.masterPointId != null ? String(p.masterPointId) : 'none',
      }
    }) : [newIsoRow(detail?.medium ?? '', detail?.pressure ?? '', detail?.temperature ?? '')])
    setIsoOpen(true)
  }

  /** AI 草案：基于作业需求/勘察记录/隔离点主数据/在库盲板生成隔离点清单并预填（纯预填不落库，人工核对后保存） */
  const genIsoAiDraft = async () => {
    if (!detail || isoAiBusy) return
    setIsoAiBusy(true)
    try {
      const res = await apiPost<{ draft: { points: AiIsoPointDraft[] }; scope?: { matchedEquipments?: { code: string }[]; rationale?: string; fallbackUsed?: boolean } }>('/api/ai/draft/isolation', { workRequestId: detail.id })
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
          location: p.location, medium: p.medium ?? '', pressure: p.pressure ?? '', temperature: p.temperature ?? '',
          blindSpec: p.blindSpec, blindType: p.blindType, action: p.action === 'REMOVE' ? 'REMOVE' : 'ADD', blindPlateId,
          code: p.code ?? mp?.code, name: p.name ?? mp?.name,
          masterPointId: mp?.id ?? p.masterPointId ?? null, masterCode: mp?.code ?? p.masterCode,
          pipeSel: mp?.pipelineId != null ? String(mp.pipelineId) : '', pointSel: mp ? String(mp.id) : 'none',
        }
      })
      if (rows.length) setIsoRows(rows)
      toast({ title: 'AI 隔离方案草案已生成', description: [res.scope?.rationale, `${rows.length} 个隔离点已填入，请核对盲板预留与主数据引用后保存`].filter(Boolean).join('｜').slice(0, 140) })
    } catch (e) {
      toast({ title: 'AI 草案生成失败', description: e instanceof Error ? e.message : '请稍后重试', variant: 'destructive' })
    } finally { setIsoAiBusy(false) }
  }

  /** 一键导入：勘察记录已确认引用的隔离点位 → 隔离点行（关联主数据并回填位置/介质/压力；盲板规格/类型为安全属性须人工补选） */
  const importIsoSurveyPoints = () => {
    if (!detail) return
    const refs = parsePointRefs(detail.survey?.pointRefs)
    const fresh = refs.filter((r) => !isoRows.some((x) => x.masterPointId === r.masterPointId))
    if (!fresh.length) { toast({ title: '勘察点位均已在清单中', description: '未新增隔离点' }); return }
    const rows: PointRow[] = fresh.map((r) => {
      const mp = pointMasters.find((m) => m.id === r.masterPointId)
      const pipe = mp?.pipeline ?? pipelines.find((p) => p.id === mp?.pipelineId)
      return {
        ...newIsoRow(pipe?.medium ?? detail.medium ?? '', pipe?.pressure ?? detail.pressure ?? '', detail.temperature ?? ''),
        location: mp?.location || r.name || '',
        code: r.code, name: r.name,
        masterPointId: r.masterPointId, masterCode: r.code,
        pipeSel: mp?.pipelineId != null ? String(mp.pipelineId) : '',
        pointSel: mp ? String(r.masterPointId) : 'none',
      }
    })
    setIsoRows((prev) => [...prev.filter((x) => x.location.trim() || x.masterPointId), ...rows])
    toast({ title: `已导入 ${rows.length} 个勘察点位`, description: '已关联主数据并回填位置/介质/压力，请逐行补选盲板规格/类型并预留库存盲板后保存' })
  }

  const saveIso = async () => {
    if (!detail) return
    if (!isoPreparedBy) { toast({ title: '编制人不能为空', variant: 'destructive' }); return }
    if (isoRows.some((r) => !r.location || !r.blindSpec || !r.blindType)) {
      toast({ title: '请完善隔离点', description: '位置、盲板规格、盲板类型为必填', variant: 'destructive' }); return
    }
    for (const r of isoRows) {
      if (r.action === 'ADD' && !r.blindPlateId) {
        toast({ title: '加装点必须预留盲板', description: `位置「${r.location}」需要从在库盲板中选择`, variant: 'destructive' }); return
      }
    }
    setBusy(true)
    try {
      // pipeSel/pointSel 为级联选择器临时状态不提交；masterPointId/masterCode/code/name 为隔离点主数据引用快照
      const points = isoRows.map((r, i) => ({
        seq: i + 1,
        location: r.location, medium: r.medium, pressure: r.pressure, temperature: r.temperature,
        blindSpec: r.blindSpec, blindType: r.blindType, action: r.action,
        blindPlateId: r.blindPlateId ? Number(r.blindPlateId) : null,
        masterPointId: r.masterPointId ?? null, masterCode: r.masterCode ?? null, code: r.code ?? null, name: r.name ?? null,
      }))
      if (isoEditId) {
        // 编辑已有方案：先 PUT 保存，再提交审核
        const { apiPut } = await import('@/lib/bp-api')
        await apiPut(`/api/isolation-schemes/${isoEditId}`, { preparedBy: isoPreparedBy, points })
        await apiPost(`/api/isolation-schemes/${isoEditId}/submit`)
        toast({ title: '隔离方案已更新并提交审核' })
      } else {
        await apiPost('/api/isolation-schemes', { workRequestId: detail.id, preparedBy: isoPreparedBy, points })
        toast({ title: '隔离方案已保存', description: '请在方案列表提交审核' })
      }
      setIsoOpen(false); setIsoEditId(null); reloadDetail(detail.id); loadList()
    } catch (e) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const submitScheme = async (type: 'isolation' | 'disposal', schemeId: number) => {
    try {
      await apiPost(`/api/${type}-schemes/${schemeId}/submit`)
      toast({ title: '已提交审核' })
      if (detail) reloadDetail(detail.id); loadList()
    } catch (e) {
      toast({ title: '提交失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  const openDispEditor = (scheme?: Detail['disposalScheme']) => {
    setDispPreparedBy(scheme?.preparedBy ?? currentUser.name)
    setDispRows(scheme?.steps.length ? scheme.steps.map((s) => ({ method: s.method, detail: s.detail, standard: s.standard ?? '', masterPointId: s.masterPointId ?? null, masterCode: s.masterCode ?? null })) : [{ method: 'VENT', detail: '', standard: '', masterPointId: null, masterCode: null }])
    setDispOpen(true)
  }

  /** AI 草案：基于需求与已批隔离方案生成「泄压→排净→置换→吹扫→检测」处置步骤序列并预填（纯预填不落库） */
  const genDispAiDraft = async () => {
    if (!detail || dispAiBusy) return
    setDispAiBusy(true)
    try {
      const res = await apiPost<{ draft: { steps: AiDispStepDraft[] } }>('/api/ai/draft/disposal', { workRequestId: detail.id })
      const rows: StepRow[] = res.draft.steps.map((s) => {
        const mp = s.masterCode ? pointMasters.find((m) => m.code === s.masterCode) : undefined
        return {
          method: s.method, detail: s.detail, standard: s.standard ?? '',
          masterPointId: mp?.id ?? s.masterPointId ?? null, masterCode: mp?.code ?? s.masterCode,
        }
      })
      if (rows.length) setDispRows(rows)
      toast({ title: 'AI 处置方案草案已生成', description: `${rows.length} 个步骤已填入，请核对后保存` })
    } catch (e) {
      toast({ title: 'AI 草案生成失败', description: e instanceof Error ? e.message : '请稍后重试', variant: 'destructive' })
    } finally { setDispAiBusy(false) }
  }

  /** 一键导入：隔离方案确认的隔离点位 → 生成「切断加盲板」处置步骤并关联主数据（前后处置序列仍需人工编排） */
  const importDispIsoPoints = () => {
    if (!detail) return
    const src = detail.isolationScheme?.points ?? []
    const fresh = src.filter((p) => !(p.masterPointId && dispRows.some((x) => x.masterPointId === p.masterPointId)))
    if (!fresh.length) { toast({ title: '隔离方案点位均已在步骤中', description: '未新增处置步骤' }); return }
    const rows: StepRow[] = fresh.map((p) => ({
      method: 'ISOLATE',
      detail: `在 ${p.location}${p.action === 'REMOVE' ? '拆除' : '加装'}盲板（${p.blindSpec} ${p.blindType}）`,
      standard: '',
      masterPointId: p.masterPointId ?? null, masterCode: p.masterCode ?? undefined,
    }))
    setDispRows((prev) => [...prev.filter((x) => x.detail.trim() || x.masterPointId), ...rows])
    toast({ title: `已从隔离方案 ${detail.isolationScheme?.code ?? ''} 导入 ${rows.length} 个点位`, description: '已生成切断加盲板步骤并关联主数据，请补全泄压/排净/置换/检测等前置步骤与合格标准后保存' })
  }

  // 隔离方案编辑：勘察记录已确认引用点位（详情已含 survey.pointRefs，无需另拉接口）
  const isoSurveyRefs = isoOpen && detail ? parsePointRefs(detail.survey?.pointRefs) : []
  // 处置方案编辑：上游隔离方案点位（导入数据源）
  const dispIsoSrc = detail?.isolationScheme?.points ?? []

  const saveDisp = async () => {
    if (!detail) return
    if (!dispPreparedBy) { toast({ title: '编制人不能为空', variant: 'destructive' }); return }
    if (dispRows.some((r) => !r.detail)) { toast({ title: '请完善处置步骤内容', variant: 'destructive' }); return }
    setBusy(true)
    try {
      const steps = dispRows.map((r, i) => ({ seq: i + 1, ...r }))
      const existing = detail.disposalScheme
      if (existing && (existing.status === 'DRAFT' || existing.status === 'REJECTED')) {
        const { apiPut } = await import('@/lib/bp-api')
        await apiPut(`/api/disposal-schemes/${existing.id}`, { preparedBy: dispPreparedBy, steps })
      } else {
        await apiPost('/api/disposal-schemes', { workRequestId: detail.id, preparedBy: dispPreparedBy, steps })
      }
      toast({ title: '工艺处置方案已保存' })
      setDispOpen(false); reloadDetail(detail.id); loadList()
    } catch (e) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const saveConfirm = async () => {
    if (!detail) return
    if (!confirmForm.confirmer) { toast({ title: '确认人不能为空', variant: 'destructive' }); return }
    if (confirmForm.result === 'QUALIFIED' && !confirmForm.analysisQualified) {
      toast({ title: '分析未合格不能确认合格', description: '请先完成气体检测分析并合格', variant: 'destructive' }); return
    }
    // 逐项确认硬闸前置提示：全部步骤逐项确认合格前禁止提交
    const steps = detail.disposalScheme?.steps ?? []
    const unconfirmed = steps.filter((s) => !s.confirmResult).length
    const abnormal = steps.filter((s) => s.confirmResult === 'ABNORMAL').length
    if (confirmForm.result === 'QUALIFIED' && (unconfirmed > 0 || abnormal > 0)) {
      toast({ title: '无法确认：处置步骤未全部逐项确认合格', description: `未确认 ${unconfirmed} 项、确认异常 ${abnormal} 项，请先逐项确认`, variant: 'destructive' }); return
    }
    setBusy(true)
    try {
      await apiPost('/api/disposal-confirmations', { workRequestId: detail.id, ...confirmForm })
      toast({ title: '工艺处置已确认', description: '可以按一票一板开具作业票' })
      reloadDetail(detail.id); loadList()
    } catch (e) {
      toast({ title: '确认失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  // 处置步骤逐项确认提交
  const saveStepConfirm = async () => {
    if (!stepConfirmFor || !detail) return
    if (!stepConfirmForm.confirmer.trim()) {
      toast({ title: '确认人不能为空', variant: 'destructive' }); return
    }
    setStepConfirmBusy(true)
    try {
      await apiPost(`/api/disposal-steps/${stepConfirmFor.id}/confirm`, {
        result: stepConfirmForm.result,
        remark: stepConfirmForm.remark,
        confirmer: stepConfirmForm.confirmer,
      })
      toast({ title: stepConfirmForm.result === 'OK' ? `步骤${stepConfirmFor.seq} 确认合格` : `步骤${stepConfirmFor.seq} 标记异常`, description: stepConfirmForm.result === 'OK' ? '可继续确认其余步骤' : '整改后请重新确认该项' })
      setStepConfirmFor(null)
      reloadDetail(detail.id)
    } catch (e) {
      toast({ title: '逐项确认失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setStepConfirmBusy(false) }
  }

  const openTicket = () => {
    setTicketForm({ plannedStart: toLocalInput(detail?.plannedStart), plannedEnd: toLocalInput(detail?.plannedEnd), guardian: '', issuer: currentUser.name, safetyMeasures: DEFAULT_MEASURES })
    setTicketCrew([])
    // 默认勾选尚未办票的点位（一票一板：已办票点位禁选）
    const activePointIds = new Set((detail?.tickets ?? []).filter((t) => t.status !== 'VOID' && t.status !== 'CLOSED').map((t) => t.pointId))
    setTicketPointIds((detail?.isolationScheme?.points ?? []).filter((p) => !activePointIds.has(p.id)).map((p) => p.id))
    setTicketOpen(true)
    // 打开对话框时刷新占用状态（占用可能随时间变化，提交前以服务端校验为准）
    if (detail) void fetchOccupancy(detail.id)
  }

  const saveTicket = async () => {
    if (!detail) return
    if (!ticketPointIds.length) {
      toast({ title: '请选择要办票的隔离点位', description: '一票一板：每个选中点位将分别开具一张作业票', variant: 'destructive' }); return
    }
    const crewGapsList = crewGaps(ticketCrew)
    if (!ticketForm.plannedStart || !ticketForm.plannedEnd || !ticketForm.guardian || crewGapsList.length) {
      toast({ title: '请完善作业票信息', description: crewGapsList.length ? `验资待完善：${crewGapsList.join('；')}` : '计划时间、监护人、作业人员为必填', variant: 'destructive' }); return
    }
    const workers = ticketCrew.map((c) => c.name.trim()).join(',')
    setBusy(true)
    try {
      const r = await apiPost<{ tickets: { code: string }[] }>('/api/work-tickets', {
        workRequestId: detail.id,
        pointIds: ticketPointIds,
        ...ticketForm,
        workers,
        workerCerts: ticketCrew,
        plannedStart: new Date(ticketForm.plannedStart).toISOString(),
        plannedEnd: new Date(ticketForm.plannedEnd).toISOString(),
      })
      toast({ title: `已开具 ${r.tickets.length} 张作业票（一票一板）`, description: `${r.tickets.map((t) => t.code).join('、')} 已提交审批（${ticketCrew.length} 人验资材料已随票归档）` })
      setTicketOpen(false); reloadDetail(detail.id); loadList()
    } catch (e) {
      toast({ title: '开票失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const saveAcceptance = async (a: { acceptor: string; leakCheck: boolean; restoreCheck: boolean; ledgerCheck: boolean; problems: string; remarks: string }) => {
    if (!detail) return
    if (!a.acceptor) { toast({ title: '验收人不能为空', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/acceptances', { workRequestId: detail.id, ...a })
      toast({ title: '验收已提交', description: a.leakCheck && a.restoreCheck && a.ledgerCheck ? '验收通过，需求闭环完成' : '存在未通过项，需整改后复验' })
      reloadDetail(detail.id); loadList()
    } catch (e) {
      toast({ title: '提交失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  // ============ 渲染 ============
  return (
    <div className="space-y-4">
      {/* 工作台横幅：现场勘察 / JSA 子菜单进入时的独立工作台视图（区别于完整作业需求列表） */}
      {workbench === 'survey' && (
        <Card className="shadow-sm border-l-4 border-l-emerald-600">
          <CardContent className="px-4 py-3.5 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 shrink-0"><MapPin className="w-5 h-5" /></span>
            <div className="min-w-[220px]">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-stone-800">现场勘察工作台</span>
                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">勘察环节</Badge>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">以下需求已完成受理，等待现场勘察确认作业条件</p>
            </div>
            <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />待勘察 {rows.filter((r) => r.status === 'PENDING_SURVEY').length} 条</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700"><CheckCircle2 className="w-3 h-3" />已勘察 {rows.filter((r) => r.status === 'SURVEYED').length} 条</span>
            </div>
          </CardContent>
        </Card>
      )}
      {workbench === 'jsa' && (
        <Card className="shadow-sm border-l-4 border-l-teal-600">
          <CardContent className="px-4 py-3.5 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-teal-100 text-teal-700 shrink-0"><FileText className="w-5 h-5" /></span>
            <div className="min-w-[220px]">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-stone-800">JSA 分析工作台</span>
                <Badge variant="outline" className="text-[10px] bg-teal-50 text-teal-700 border-teal-200">JSA 环节</Badge>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">以下需求已完成现场勘察，可开展 JSA 安全分析</p>
            </div>
            <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />待分析 {rows.filter((r) => r.status === 'SURVEYED').length} 条</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700"><CheckCircle2 className="w-3 h-3" />已完成 {rows.filter((r) => r.status === 'JSA_DONE').length} 条</span>
            </div>
          </CardContent>
        </Card>
      )}
      <Card className="shadow-sm">
        <CardHeader className="py-3 px-4 flex flex-col sm:flex-row sm:items-center gap-3 space-y-0">
          <CardTitle className="text-sm font-semibold shrink-0">{workbench === 'survey' ? '勘察待办需求' : workbench === 'jsa' ? 'JSA 分析待办需求' : '作业需求列表'}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜编号/标题/位置" className="pl-8 h-9 w-48 text-xs" />
            </div>
            {workbench ? (
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-56 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="ALL">{workbench === 'survey' ? '全部待办（待勘察+已勘察）' : '全部待办（待分析+已完成）'}</SelectItem>
                  {(workbench === 'survey' ? SURVEY_WB_STATUSES : JSA_WB_STATUSES).map((s) => <SelectItem key={s} value={s}>{STATUS_MAP[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="ALL">全部状态</SelectItem>
                  {ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_MAP[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" className="h-9 bg-emerald-700 hover:bg-emerald-800" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />新建作业需求
            </Button>
            <Button size="sm" variant="outline" className="h-9" disabled={displayRows.length === 0}
              title="导出当前筛选结果"
              onClick={() => exportCsv('作业需求',
                ['需求编号', '标题', '装置', '作业位置', '介质', '紧急度', '状态', '申请人', '创建时间'],
                displayRows.map((r) => [r.code, r.title, r.unit?.name ?? '',
                  r.location, r.medium ?? '', URGENCY_MAP[r.urgency]?.label ?? r.urgency,
                  STATUS_MAP[r.status]?.label ?? r.status, r.applicantName, fmtDate(r.createdAt)]))}>
              <Download className="w-4 h-4 mr-1" />导出
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {loading ? (
            <div className="py-16 text-center text-sm text-stone-400">加载中…</div>
          ) : displayRows.length === 0 ? (
            <div className="py-16 text-center">
              <ClipboardList className="w-10 h-10 text-stone-300 mx-auto mb-2" />
              <p className="text-sm text-stone-400">
                {workbench === 'survey' ? '暂无待勘察需求（本页仅显示 待现场勘察/已勘察待JSA 的需求）'
                  : workbench === 'jsa' ? '暂无待分析需求（本页仅显示 已勘察待JSA/JSA完成 的需求）'
                  : '暂无作业需求'}
              </p>
            </div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 sticky top-0 z-10">
                  <tr className="text-stone-500">
                    <th className="text-left font-medium px-3 py-2.5">编号/标题</th>
                    <th className="text-left font-medium px-3 py-2.5">装置</th>
                    <th className="text-left font-medium px-3 py-2.5">紧急度</th>
                    <th className="text-left font-medium px-3 py-2.5">申请人</th>
                    <th className="text-left font-medium px-3 py-2.5">状态</th>
                    <th className="text-left font-medium px-3 py-2.5 w-32">流程进度</th>
                    <th className="text-left font-medium px-3 py-2.5">创建时间</th>
                    <th className="text-right font-medium px-3 py-2.5">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r) => (
                    <tr key={r.id} className="border-t border-stone-100 hover:bg-emerald-50/40">
                      <td className="px-3 py-2.5">
                        <div className="font-mono text-stone-500 text-[11px]">{r.code}</div>
                        <div className="text-stone-800 font-medium max-w-[220px] truncate">{r.title}</div>
                      </td>
                      <td className="px-3 py-2.5 text-stone-600">{r.unit?.name ?? r.unitId}</td>
                      <td className="px-3 py-2.5"><Badge variant="outline" className={cn('text-[10px]', URGENCY_MAP[r.urgency]?.className)}>{URGENCY_MAP[r.urgency]?.label ?? r.urgency}</Badge></td>
                      <td className="px-3 py-2.5 text-stone-600">{r.applicantName}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-2.5"><MiniFlowProgress status={r.status} /></td>
                      <td className="px-3 py-2.5 text-stone-400 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {workbench === 'survey' && SURVEY_WB_STATUSES.includes(r.status) && (
                            <Button size="sm" className="h-7 text-[11px] px-2 bg-emerald-600 hover:bg-emerald-700 text-white" title={r.status === 'PENDING_SURVEY' ? '进行现场勘察' : '查看/补充勘察记录'} onClick={() => openDetail(r.id)}>
                              <MapPin className="w-3 h-3 mr-0.5" />{r.status === 'PENDING_SURVEY' ? '去勘察' : '勘察记录'}
                            </Button>
                          )}
                          {workbench === 'jsa' && JSA_WB_STATUSES.includes(r.status) && (
                            <Button size="sm" className="h-7 text-[11px] px-2 bg-teal-600 hover:bg-teal-700 text-white" title={r.status === 'SURVEYED' ? '开展 JSA 安全分析' : '查看 JSA 分析记录'} onClick={() => openDetail(r.id)}>
                              <FileText className="w-3 h-3 mr-0.5" />{r.status === 'SURVEYED' ? '去分析' : '分析记录'}
                            </Button>
                          )}
                          {r.status === 'DRAFT' && (
                            <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => submitRequest(r)}>
                              <Send className="w-3 h-3 mr-0.5" />提交
                            </Button>
                          )}
                          {r.status !== 'DRAFT' && r.status !== 'COMPLETED' && r.status !== 'CANCELLED' && (
                            <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-rose-200 text-rose-600 hover:bg-rose-50" onClick={() => setCancelId(r.id)}>
                              <Ban className="w-3 h-3 mr-0.5" />取消
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2 text-stone-500" onClick={() => openDetail(r.id)}>
                            <Eye className="w-3 h-3 mr-0.5" />详情
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新建需求 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>新建作业需求</DialogTitle><DialogDescription>盲板抽堵作业申请（保存为草稿，提交后进入现场勘察环节）</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label="需求标题 *"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：E101原油管线检修隔离" /></Field></div>
            <Field label="所属装置 *">
              <Select value={form.unitId} onValueChange={(v) => setForm({ ...form, unitId: v })}>
                <SelectTrigger><SelectValue placeholder="选择装置" /></SelectTrigger>
                <SelectContent>{units.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="col-span-2"><Field label="作业位置 *"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="如：常压塔进料线 E101入口法兰" /></Field></div>
            <Field label="管线（选择后自动带出介质/压力）">
              <Select value={form.pipelineId || 'none'} onValueChange={(v) => {
                const p = pipelines.find((x) => String(x.id) === v) ?? null
                setForm({ ...form, pipelineId: p ? String(p.id) : '', pipelineName: p ? p.name : '', medium: p?.medium ?? form.medium, pressure: p?.pressure ?? form.pressure })
              }}>
                <SelectTrigger><SelectValue placeholder="选择管线主数据" /></SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="none">不关联（手填介质/压力）</SelectItem>
                  {pipelines.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} · {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="介质">
              <Select value={form.medium} onValueChange={(v) => setForm({ ...form, medium: v })}>
                <SelectTrigger><SelectValue placeholder="选择介质" /></SelectTrigger>
                <SelectContent>{mediumDict.map((d) => <SelectItem key={d.id} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="管线压力"><Input value={form.pressure} onChange={(e) => setForm({ ...form, pressure: e.target.value })} placeholder="如 1.6MPa" /></Field>
            <Field label="管线温度"><Input value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} placeholder="如 180℃" /></Field>
            <div className="col-span-2"><Field label="作业原因 *"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} /></Field></div>
            <Field label="紧急程度">
              <Select value={form.urgency} onValueChange={(v) => setForm({ ...form, urgency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(URGENCY_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div />
            <Field label="计划开始"><Input type="datetime-local" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} /></Field>
            <Field label="计划结束"><Input type="datetime-local" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={createRequest} disabled={busy}>{busy ? '保存中…' : '保存草稿'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 取消确认 */}
      <AlertDialog open={cancelId !== null} onOpenChange={(v) => !v && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认取消该作业需求？</AlertDialogTitle>
            <AlertDialogDescription>取消后流程终止，已预留的盲板将释放回库存。此操作不可恢复。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>返回</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={cancelRequest}>确认取消</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 详情 Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-[880px] overflow-y-auto sm:p-5">
          {detailLoading || !detail ? (
            <>
              <SheetHeader className="p-0">
                <SheetTitle className="sr-only">加载详情中</SheetTitle>
                <SheetDescription className="sr-only">作业需求详情加载中</SheetDescription>
              </SheetHeader>
              <div className="py-24 text-center text-sm text-stone-400"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />加载详情中…</div>
            </>
          ) : (
            <div key={detail.id} className="space-y-3">
              <SheetHeader className="p-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <SheetTitle className="text-base">{detail.title}</SheetTitle>
                  <StatusBadge status={detail.status} />
                  <Badge variant="outline" className={cn('text-[10px]', URGENCY_MAP[detail.urgency]?.className)}>{URGENCY_MAP[detail.urgency]?.label}紧急</Badge>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => setPrintOpen(true)} title="打印全流程档案（A4）">
                      <Printer className="w-3 h-3 mr-1" />打印档案
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-stone-300 text-stone-600 hover:bg-stone-50" onClick={() => exportWrArchiveCsv(detail, currentUser.name)} title="导出全流程档案 CSV">
                      <Download className="w-3 h-3 mr-1" />导出 CSV
                    </Button>
                  </div>
                </div>
                <SheetDescription className="font-mono text-[11px]">{detail.code} · 申请人 {detail.applicantName} · 创建于 {fmtDateTime(detail.createdAt)}</SheetDescription>
              </SheetHeader>
              <FlowBar status={detail.status} />

              {/* 管线占用冲突警示（安全硬约束：一条管线同一时间只允许一张生效中的盲板作业票） */}
              {occConflicts.length > 0 && (
                <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2.5 space-y-1.5" role="alert">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-800">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    管线占用冲突——一条管线同一时间只允许一张生效中的盲板作业票
                  </div>
                  {occConflicts.map((c, i) => (
                    <div key={i} className="font-mono text-[11px] leading-relaxed text-rose-700 break-all">
                      {c.pipelineCode}（{c.pipelineName}）已被 {c.ticketCode ?? '—'}（{c.workRequestCode}「{c.workRequestTitle}」，{STATUS_MAP[c.workRequestStatus]?.label ?? c.workRequestStatus}）占用
                    </div>
                  ))}
                  <div className="text-[11px] leading-relaxed text-rose-600">
                    占用解除（上述作业票关闭或需求取消）前，本需求的开票、批准、开工操作将被系统拒绝，请协调作业排程。
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Info label="所属装置" value={detail.unit?.name} />
                <Info label="作业位置" value={detail.location} />
                <Info label="管线名称" value={detail.pipelineName} />
                <Info label="介质" value={detail.medium} />
                <Info label="压力" value={detail.pressure} />
                <Info label="温度" value={detail.temperature} />
                <Info label="计划时间" value={`${fmtDate(detail.plannedStart)} ~ ${fmtDate(detail.plannedEnd)}`} />
                <div className="col-span-2 md:col-span-4"><Info label="作业原因" value={detail.reason} /></div>
              </div>

              {/* 全流程时间线 */}
              <SectionCard icon={<History className="w-4 h-4" />} title="流程时间线">
                <FlowTimeline detail={detail} />
              </SectionCard>

              {/* 现场勘察 */}
              {(detail.survey || detail.status === 'PENDING_SURVEY') && (
                <SectionCard icon={<MapPin className="w-4 h-4" />} title="现场勘察"
                  badge={detail.survey ? <Badge variant="outline" className="ml-1 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">已勘察</Badge> : undefined}
                  action={canEng && detail.survey && detail.status === 'SURVEYED' ? (
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={() => setEditSurvey((v) => !v)}>
                      <Pencil className="w-3 h-3 mr-1" />{editSurvey ? '取消编辑' : '编辑'}
                    </Button>
                  ) : undefined}>
                  {detail.survey && !editSurvey ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <Info label="勘察人" value={detail.survey.surveyor} />
                      <Info label="勘察时间" value={fmtDateTime(detail.survey.surveyDate)} />
                      <Info label="具备作业条件" value={detail.survey.isSafe ? '是' : '否'} />
                      <div className="col-span-2"><Info label="现场条件" value={detail.survey.siteCondition} /></div>
                      <Info label="管线参数核实" value={detail.survey.pipelineVerify} />
                      <div className="col-span-2"><Info label="风险点" value={detail.survey.hazardPoints} /></div>
                      <Info label="勘察建议" value={detail.survey.suggestion} />
                      {surveyRefs.length > 0 && (
                        <div className="col-span-2 md:col-span-3">
                          <div className="text-[11px] text-stone-400 mb-1">引用隔离点位（{surveyRefs.length} 个，来自隔离点主数据）</div>
                          <PointRefChips refs={surveyRefs} />
                        </div>
                      )}
                      <div className="col-span-2 md:col-span-3">
                        <div className="text-[11px] text-stone-400 mb-1">现场照片（{surveyPhotos.length}，移动端拍摄；AI 交底/作业/验收位置核对的基准）</div>
                        <AttachmentWall photos={surveyPhotos} emptyText="无勘察照片" compact />
                      </div>
                    </div>
                  ) : canEng ? (
                    <SurveyForm detail={detail} busy={busy} pipelines={pipelines} pointMasters={pointMasters} editing={!!detail.survey} onCancel={detail.survey ? () => setEditSurvey(false) : undefined} onSave={saveSurvey} />
                  ) : <p className="text-xs text-stone-400">待工艺工程师进行现场勘察</p>}
                </SectionCard>
              )}

              {/* JSA */}
              {(detail.jsa || detail.status === 'SURVEYED') && (
                <SectionCard icon={<FileText className="w-4 h-4" />} title="JSA 作业安全分析"
                  badge={detail.jsa ? <Badge variant="outline" className="ml-1 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">已完成</Badge> : undefined}
                  action={canEng && detail.jsa && detail.status === 'JSA_DONE' ? (
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={() => setEditJsa((v) => !v)}>
                      <Pencil className="w-3 h-3 mr-1" />{editJsa ? '取消编辑' : '编辑'}
                    </Button>
                  ) : undefined}>
                  {detail.jsa && !editJsa ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Info label="分析组长" value={detail.jsa.leader} />
                        <Info label="参与人员" value={detail.jsa.members} />
                        <Info label="分析日期" value={fmtDate(detail.jsa.analysisDate)} />
                        <Info label="综合风险等级" value={detail.jsa.riskLevel === 'LOW' ? '低' : detail.jsa.riskLevel === 'HIGH' ? '高' : '中'} />
                      </div>
                      {jsaRefs.length > 0 && (
                        <div>
                          <div className="text-[11px] text-stone-400 mb-1">涉及隔离点位（{jsaRefs.length} 个，来自隔离点主数据）</div>
                          <PointRefChips refs={jsaRefs} />
                        </div>
                      )}
                      <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-xs min-w-[560px]">
                          <thead className="bg-stone-50 text-stone-500"><tr><th className="text-left px-2 py-1.5 w-10">#</th><th className="text-left px-2 py-1.5">作业步骤</th><th className="text-left px-2 py-1.5">危害因素</th><th className="text-left px-2 py-1.5">控制措施</th></tr></thead>
                          <tbody>{detail.jsa.steps.map((s) => (
                            <tr key={s.id ?? s.seq} className="border-t border-stone-100">
                              <td className="px-2 py-1.5 text-stone-400">{s.seq}</td><td className="px-2 py-1.5">{s.step}</td>
                              <td className="px-2 py-1.5 text-rose-700/80">{s.hazard}</td><td className="px-2 py-1.5 text-emerald-800">{s.measure}</td>
                            </tr>))}</tbody>
                        </table>
                      </div>
                      {detail.jsa.residualRisk && <Info label="剩余风险与应急措施" value={detail.jsa.residualRisk} />}
                    </div>
                  ) : canEng ? (
                    <JsaFormEditor detail={detail} leader={currentUser.name} busy={busy} pipelines={pipelines} pointMasters={pointMasters} editing={!!detail.jsa} onCancel={detail.jsa ? () => setEditJsa(false) : undefined} onSave={saveJsa} />
                  ) : <p className="text-xs text-stone-400">待工艺工程师开展 JSA 分析</p>}
                </SectionCard>
              )}

              {/* 隔离方案 */}
              {(detail.isolationScheme || ['JSA_DONE', 'ISOLATION_REJECTED'].includes(detail.status)) && (
                <SectionCard icon={<ShieldCheck className="w-4 h-4" />} title="隔离方案"
                  badge={detail.isolationScheme ? <Badge variant="outline" className={cn('ml-1 text-[10px]', SCHEME_STATUS_MAP[detail.isolationScheme.status]?.className)}>{SCHEME_STATUS_MAP[detail.isolationScheme.status]?.label}</Badge> : undefined}
                  action={canEng && !detail.isolationScheme ? <Button size="sm" className="h-7 text-[11px] bg-emerald-700 hover:bg-emerald-800" onClick={() => openIsoEditor()}><Plus className="w-3 h-3 mr-1" />编制隔离方案</Button> :
                    canEng && detail.isolationScheme && ['DRAFT', 'REJECTED'].includes(detail.isolationScheme.status) ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={() => openIsoEditor(detail.isolationScheme!)}>编辑</Button>
                        <Button size="sm" className="h-7 text-[11px] px-2 bg-emerald-700 hover:bg-emerald-800" onClick={() => submitScheme('isolation', detail.isolationScheme!.id)}><Send className="w-3 h-3 mr-1" />提交审核</Button>
                      </div>
                    ) : undefined}>
                  {detail.isolationScheme ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Info label="方案编号" value={detail.isolationScheme.code} />
                        <Info label="编制人" value={detail.isolationScheme.preparedBy} />
                        <Info label="审核人" value={detail.isolationScheme.reviewedBy} />
                        <Info label="审核意见" value={detail.isolationScheme.comment} />
                      </div>
                      {pointStatus?.diagrams?.length ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-md border border-teal-300 bg-teal-50 px-3 py-2">
                          <Factory className="h-4 w-4 text-teal-600 shrink-0" />
                          <span className="text-xs text-teal-800 flex-1 min-w-[180px]">
                            隔离点位已标注在组态图《{pointStatus.diagrams[0].name}》{pointStatus.diagrams.length > 1 ? ` 等 ${pointStatus.diagrams.length} 张` : ''}，可查看通/盲与作业实时状态
                          </span>
                          <Button size="sm" variant="outline"
                            className="h-7 text-[11px] px-2 border-teal-300 text-teal-700 hover:bg-teal-100 hover:text-teal-800"
                            onClick={() => onNavigate?.('pid-config', undefined, pointStatus.diagrams[0].id)}>
                            打开组态图 <ChevronRight className="w-3 h-3 ml-0.5" />
                          </Button>
                        </div>
                      ) : null}
                      <IsoPointsTable points={detail.isolationScheme.points} statusMap={psMap} />
                    </div>
                  ) : <p className="text-xs text-stone-400">JSA 已完成，请编制隔离方案（确定每个隔离点的盲板规格与位置）</p>}
                </SectionCard>
              )}

              {/* 工艺处置方案 */}
              {(detail.disposalScheme || ['ISOLATION_APPROVED', 'DISPOSAL_PREPARING', 'DISPOSAL_REJECTED'].includes(detail.status)) && (
                <SectionCard icon={<FileText className="w-4 h-4" />} title="工艺处置方案"
                  badge={detail.disposalScheme ? <Badge variant="outline" className={cn('ml-1 text-[10px]', SCHEME_STATUS_MAP[detail.disposalScheme.status]?.className)}>{SCHEME_STATUS_MAP[detail.disposalScheme.status]?.label}</Badge> : undefined}
                  action={canEng && !detail.disposalScheme ? <Button size="sm" className="h-7 text-[11px] bg-emerald-700 hover:bg-emerald-800" onClick={() => openDispEditor()}><Plus className="w-3 h-3 mr-1" />编制处置方案</Button> :
                    canEng && detail.disposalScheme && ['DRAFT', 'REJECTED'].includes(detail.disposalScheme.status) ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={() => openDispEditor(detail.disposalScheme!)}>编辑</Button>
                        <Button size="sm" className="h-7 text-[11px] px-2 bg-emerald-700 hover:bg-emerald-800" onClick={() => submitScheme('disposal', detail.disposalScheme!.id)}><Send className="w-3 h-3 mr-1" />提交审核</Button>
                      </div>
                    ) : undefined}>
                  {detail.disposalScheme ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Info label="方案编号" value={detail.disposalScheme.code} />
                        <Info label="编制人" value={detail.disposalScheme.preparedBy} />
                        <Info label="审核人" value={detail.disposalScheme.reviewedBy} />
                        <Info label="审核意见" value={detail.disposalScheme.comment} />
                      </div>
                      <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-xs min-w-[640px]">
                          <thead className="bg-stone-50 text-stone-500"><tr><th className="text-left px-2 py-1.5 w-10">#</th><th className="text-left px-2 py-1.5 w-28">处置方式</th><th className="text-left px-2 py-1.5">处置内容</th><th className="text-left px-2 py-1.5">合格标准</th><th className="text-left px-2 py-1.5 w-40">逐项确认</th></tr></thead>
                          <tbody>{detail.disposalScheme.steps.map((s) => (
                            <tr key={s.id} className="border-t border-stone-100">
                              <td className="px-2 py-1.5 text-stone-400">{s.seq}</td>
                              <td className="px-2 py-1.5"><Badge variant="outline" className="text-[10px] bg-teal-50 text-teal-700 border-teal-200">{DISPOSAL_METHOD_MAP[s.method] ?? s.method}</Badge></td>
                              <td className="px-2 py-1.5">{s.detail}{s.masterCode && <span className="ml-1.5 inline-flex items-center rounded border border-teal-300 bg-teal-50 px-1 py-0.5 text-[10px] font-mono text-teal-700" title="关联隔离点主数据">{s.masterCode}</span>}</td>
                              <td className="px-2 py-1.5 text-stone-500">{s.standard ?? '-'}</td>
                              <td className="px-2 py-1.5">
                                {s.confirmResult === 'OK' ? (
                                  <span className="text-emerald-600" title={s.confirmRemark ?? ''}>✓ {s.confirmedBy ?? '已确认'}{s.confirmedAt ? ` · ${fmtDateTime(s.confirmedAt)}` : ''}</span>
                                ) : s.confirmResult === 'ABNORMAL' ? (
                                  <span className="text-rose-600" title={s.confirmRemark ?? ''}>✗ 异常（待整改复确认）</span>
                                ) : (
                                  <span className="text-stone-400">待确认</span>
                                )}
                              </td>
                            </tr>))}</tbody>
                        </table>
                      </div>
                    </div>
                  ) : <p className="text-xs text-stone-400">隔离方案已审核通过，请编制工艺处置方案（泄压/排净/置换/吹扫/气体检测等）</p>}
                </SectionCard>
              )}

              {/* 工艺处置确认 */}
              {(detail.disposalConfirmation || detail.status === 'PENDING_CONFIRM') && (
                <SectionCard icon={<Stamp className="w-4 h-4" />} title="工艺处置确认"
                  badge={detail.disposalConfirmation ? <Badge variant="outline" className={cn('ml-1 text-[10px]', detail.disposalConfirmation.result === 'QUALIFIED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200')}>{detail.disposalConfirmation.result === 'QUALIFIED' ? '确认合格' : '不合格'}</Badge> : undefined}>
                  {detail.disposalConfirmation ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Info label="确认人" value={detail.disposalConfirmation.confirmer} />
                      <Info label="确认时间" value={fmtDateTime(detail.disposalConfirmation.confirmedAt)} />
                      <Info label="可燃气体(LEL)" value={detail.disposalConfirmation.flammableResult} />
                      <Info label="氧含量" value={detail.disposalConfirmation.oxygenResult} />
                      <Info label="有毒气体" value={detail.disposalConfirmation.toxicResult} />
                      <Info label="分析合格" value={detail.disposalConfirmation.analysisQualified ? '是' : '否'} />
                      <div className="col-span-2"><Info label="备注" value={detail.disposalConfirmation.remarks} /></div>
                    </div>
                  ) : canEng ? (
                    <div className="space-y-2">
                      {/* 逐项确认列表（工艺处置确认前置：每项处置步骤逐一确认合格） */}
                      {(detail.disposalScheme?.steps.length ?? 0) > 0 && (() => {
                        const steps = detail.disposalScheme!.steps
                        const okCount = steps.filter((s) => s.confirmResult === 'OK').length
                        const abnormalCount = steps.filter((s) => s.confirmResult === 'ABNORMAL').length
                        const allOk = okCount === steps.length
                        return (
                          <div className="rounded-lg border border-stone-200 overflow-hidden">
                            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-stone-50 border-b border-stone-200">
                              <ListChecks className="w-3.5 h-3.5 text-teal-600" />
                              <span className="text-xs font-semibold text-stone-700">处置步骤逐项确认</span>
                              <span className="text-[11px] text-stone-400">全部逐项确认合格后才能总体确认（GB 30871 逐项确认要求）</span>
                              <span className={cn('ml-auto text-[11px] font-medium', allOk ? 'text-emerald-600' : 'text-amber-600')}>
                                已确认合格 {okCount}/{steps.length}{abnormalCount ? ` · 异常 ${abnormalCount}` : ''}
                              </span>
                            </div>
                            <div className="max-h-56 overflow-y-auto">
                              {steps.map((s) => (
                                <div key={s.id} className="flex items-center gap-2 px-3 py-2 border-t border-stone-100 first:border-t-0">
                                  <span className="w-5 shrink-0 text-[11px] text-stone-400">{s.seq}</span>
                                  <Badge variant="outline" className="shrink-0 text-[10px] bg-teal-50 text-teal-700 border-teal-200">{DISPOSAL_METHOD_MAP[s.method] ?? s.method}</Badge>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-[11px] text-stone-700" title={s.detail}>{s.detail}</div>
                                    {s.confirmResult === 'OK' && <div className="text-[10px] text-emerald-600">✓ {s.confirmedBy}{s.confirmedAt ? ` · ${fmtDateTime(s.confirmedAt)}` : ''}{s.confirmRemark ? ` · ${s.confirmRemark}` : ''}</div>}
                                    {s.confirmResult === 'ABNORMAL' && <div className="text-[10px] text-rose-600">✗ 异常：{s.confirmRemark ?? '待整改'}（{s.confirmedBy}）</div>}
                                  </div>
                                  {detail.status === 'PENDING_CONFIRM' ? (
                                    <Button size="sm" variant="outline"
                                      className={cn('h-6 shrink-0 px-2 text-[10px]', s.confirmResult === 'OK' ? 'border-stone-200 text-stone-400 hover:text-stone-600' : 'border-teal-300 text-teal-700 hover:bg-teal-50')}
                                      onClick={() => { setStepConfirmForm({ result: s.confirmResult === 'ABNORMAL' ? 'OK' : (s.confirmResult ?? 'OK'), remark: s.confirmRemark ?? '', confirmer: confirmForm.confirmer || currentUser.name }); setStepConfirmFor({ id: s.id, seq: s.seq, detail: s.detail }) }}>
                                      {s.confirmResult === 'OK' ? '重新确认' : s.confirmResult === 'ABNORMAL' ? '复认' : '确认'}
                                    </Button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Field label="确认人"><Input className="h-8 text-xs" defaultValue={currentUser.name} onChange={(e) => setConfirmForm({ ...confirmForm, confirmer: e.target.value })} /></Field>
                        <Field label="可燃气体 LEL%"><Input className="h-8 text-xs" placeholder="如 0.0%" onChange={(e) => setConfirmForm({ ...confirmForm, flammableResult: e.target.value })} /></Field>
                        <Field label="氧含量 %"><Input className="h-8 text-xs" placeholder="如 20.9%" onChange={(e) => setConfirmForm({ ...confirmForm, oxygenResult: e.target.value })} /></Field>
                        <Field label="有毒气体"><Input className="h-8 text-xs" placeholder="如 H2S 未检出" onChange={(e) => setConfirmForm({ ...confirmForm, toxicResult: e.target.value })} /></Field>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        <label className="flex items-center gap-1.5 text-stone-500"><Checkbox checked disabled />处置步骤已全部逐项确认合格（服务端校验）</label>
                        <label className="flex items-center gap-1.5"><Checkbox defaultChecked onCheckedChange={(v) => setConfirmForm({ ...confirmForm, analysisQualified: v === true })} />气体分析合格</label>
                        <span className="text-stone-400">结论：</span>
                        <Select value={confirmForm.result} onValueChange={(v) => setConfirmForm({ ...confirmForm, result: v })}>
                          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="QUALIFIED">合格</SelectItem><SelectItem value="UNQUALIFIED">不合格</SelectItem></SelectContent>
                        </Select>
                      </div>
                      <Textarea className="text-xs" rows={2} placeholder="备注" onChange={(e) => setConfirmForm({ ...confirmForm, remarks: e.target.value })} />
                      {(() => {
                        const steps = detail.disposalScheme?.steps ?? []
                        const notAllOk = steps.length > 0 && (steps.some((s) => s.confirmResult !== 'OK'))
                        return (
                          <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={busy || (confirmForm.result === 'QUALIFIED' && notAllOk)}
                            title={confirmForm.result === 'QUALIFIED' && notAllOk ? '尚有处置步骤未逐项确认合格，请先完成逐项确认' : undefined}
                            onClick={saveConfirm}><Stamp className="w-3.5 h-3.5 mr-1" />确认处置完成</Button>
                        )
                      })()}
                    </div>
                  ) : <p className="text-xs text-stone-400">待工艺工程师现场逐项确认处置结果</p>}
                </SectionCard>
              )}

              {/* 作业票（一票一板：每隔离点一张，多票列表） */}
              {(detail.tickets.length > 0 || detail.status === 'CONFIRMED') && (() => {
                const activePointIds = new Set(detail.tickets.filter((t) => t.status !== 'VOID' && t.status !== 'CLOSED').map((t) => t.pointId))
                const unTicketed = detail.isolationScheme?.points.filter((p) => !activePointIds.has(p.id)) ?? []
                const canIssueMore = canTicketRole && ['CONFIRMED', 'TICKET_ISSUED', 'TICKET_APPROVED', 'IN_PROGRESS'].includes(detail.status) && unTicketed.length > 0 && !!detail.isolationScheme
                return (
                <SectionCard icon={<TicketIcon className="w-4 h-4" />} title="盲板抽堵安全作业票"
                  badge={<Badge variant="outline" className="ml-1 text-[10px] border-teal-200 bg-teal-50 text-teal-700">一票一板 · {detail.tickets.length} 张</Badge>}
                  action={canIssueMore ? <Button size="sm" className="h-7 text-[11px] bg-emerald-700 hover:bg-emerald-800" onClick={openTicket}><Plus className="w-3 h-3 mr-1" />{detail.tickets.length ? `补开作业票（${unTicketed.length} 点未办票）` : '开作业票'}</Button> : undefined}>
                  {detail.tickets.length > 0 ? (
                    <div className="space-y-2">
                      {detail.tickets.map((t) => (
                        <div key={t.id} className="rounded-lg border border-stone-200 bg-white px-3 py-2 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <TicketIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="font-mono text-xs font-semibold text-stone-700">{t.code}</span>
                            <Badge variant="outline" className={cn('text-[10px] h-5', TICKET_STATUS_MAP[t.status]?.className)}>{TICKET_STATUS_MAP[t.status]?.label ?? t.status}</Badge>
                            {t.pointCode && <span className="rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[10px] font-mono text-teal-700">{t.pointCode}</span>}
                            {t.action && <Badge variant="outline" className={cn('text-[10px] h-5', t.action === 'ADD' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>{t.action === 'ADD' ? '装盲板' : '拆盲板'}</Badge>}
                            {(t.blindSpec || t.blindType) && <span className="text-[10px] text-stone-400">{[t.blindSpec, t.blindType].filter(Boolean).join(' · ')}</span>}
                            <span className="ml-auto text-[10px] text-stone-400">监护人 {t.guardian} · 签发 {t.issuer}{t.approvedBy ? ` · 批准 ${t.approvedBy}` : ''}</span>
                            <button
                              type="button"
                              className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-teal-700 transition-colors hover:bg-teal-50"
                              onClick={() => setTicketDetailOpen((m) => ({ ...m, [t.id]: !m[t.id] }))}
                              aria-expanded={!!ticketDetailOpen[t.id]}
                            >
                              {ticketDetailOpen[t.id] ? '收起明细' : '票面明细'}
                              <ChevronDown className={cn('h-3 w-3 transition-transform', ticketDetailOpen[t.id] && 'rotate-180')} />
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-stone-500">
                            {t.pointLocation && <span className="min-w-0 truncate">位置：{t.pointLocation}</span>}
                            <span>计划 {fmtDateTime(t.plannedStart)} ~ {fmtDateTime(t.plannedEnd)}</span>
                            {t.startedAt && <span>开工 {fmtDateTime(t.startedAt)}</span>}
                            {t.finishedAt && <span>完工 {fmtDateTime(t.finishedAt)}</span>}
                          </div>
                          {t.comment && <div className="text-[11px] text-stone-500">审批意见：{t.comment}</div>}
                          {/* 票面明细（Task 111）：安全措施 + 逐人验资材料照片墙（与审批中心同款 CrewWall，缩略图点击新窗看原图） */}
                          {ticketDetailOpen[t.id] && (
                            <div className="space-y-2 rounded-md border border-stone-100 bg-stone-50/60 p-2">
                              <div className="space-y-1">
                                <p className="flex items-center gap-1 text-[10px] font-medium text-stone-500"><ShieldAlert className="h-3 w-3 text-teal-600" />安全措施</p>
                                <p className="text-[11px] leading-relaxed text-stone-600">{t.safetyMeasures || '未填写'}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="flex items-center gap-1 text-[10px] font-medium text-stone-500"><ShieldCheck className="h-3 w-3 text-teal-600" />作业人员验资材料（照片点击可查看原图）</p>
                                <CrewWall workerCerts={t.workerCerts} workers={t.workers} compact />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {detail.isolationScheme && detail.isolationScheme.points.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-stone-600">
                            <MapPin className="w-3.5 h-3.5 text-teal-600" />隔离点位清单
                            <span className="text-[11px] text-stone-400 font-normal">共 {detail.isolationScheme.points.length} 个 · 来自隔离方案 {detail.isolationScheme.code}</span>
                          </div>
                          <TicketPointsTable points={detail.isolationScheme.points} onLocate={setPidLocateIdx} />
                        </div>
                      )}
                    </div>
                  ) : <p className="text-xs text-stone-400">工艺处置已确认（逐项确认合格），可按一票一板开具作业票——每个隔离点分别一张</p>}
                </SectionCard>
                )
              })()}

              {/* 现场交底（移动端交底方提交；作业方确认后方可开工，Task 75-c 桌面端可视化） */}
              {briefings.length > 0 && (
                <SectionCard icon={<Megaphone className="w-4 h-4" />} title="现场交底"
                  badge={<Badge variant="outline" className="ml-1 text-[10px] border-violet-200 bg-violet-50 text-violet-700">{briefings.length} 条 · 交底后作业方确认方可开工</Badge>}>
                  <div className="space-y-2">
                    {briefings.map((b) => {
                      const atts = briefAtts[b.id] ?? []
                      const bPhotos = atts.filter((a) => a.kind === 'PHOTO')
                      const bAudios = atts.filter((a) => a.kind === 'AUDIO')
                      const ai = b.aiCheckResult
                      return (
                        <div key={b.id} className="rounded-lg border border-stone-200 bg-white px-3 py-2 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Megaphone className="w-3.5 h-3.5 text-violet-600 shrink-0" />
                            <span className="font-mono text-xs font-semibold text-stone-700">{b.ticketCode ?? '需求级交底'}</span>
                            {b.status === 'CONFIRMED'
                              ? <Badge variant="outline" className="text-[10px] h-5 border-emerald-200 bg-emerald-50 text-emerald-700">作业方已确认</Badge>
                              : <Badge variant="outline" className="text-[10px] h-5 border-amber-200 bg-amber-50 text-amber-700">待作业方确认</Badge>}
                            {ai && (
                              <Badge variant="outline" className={cn('text-[10px] h-5 gap-0.5',
                                ai === 'CONSISTENT' ? 'border-violet-200 bg-violet-50 text-violet-700'
                                  : ai === 'INCONSISTENT' ? 'border-rose-200 bg-rose-50 text-rose-700'
                                    : 'border-stone-200 bg-stone-50 text-stone-500')}>
                                <Sparkles className="w-3 h-3" />AI {ai === 'CONSISTENT' ? '位置一致' : ai === 'INCONSISTENT' ? '位置不一致' : '无法确定'}
                              </Badge>
                            )}
                            <span className="ml-auto text-[10px] text-stone-400">{fmtDateTime(b.createdAt)} · 交底人 {b.briefingUser}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-stone-500">
                            {b.pointLocation && <span className="min-w-0 truncate">位置：{b.pointLocation}</span>}
                            {b.briefedUsers && <span>被交底：{b.briefedUsers}</span>}
                            {b.status === 'CONFIRMED' && b.confirmedBy && <span>确认人 {b.confirmedBy}{b.confirmedAt ? ` · ${fmtDateTime(b.confirmedAt)}` : ''}</span>}
                          </div>
                          <div className="text-[11px] text-stone-600 bg-violet-50/60 border border-violet-100 rounded-md px-2 py-1.5 leading-relaxed whitespace-pre-wrap line-clamp-4">{b.content}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] text-stone-400 mb-1">交底照片（{bPhotos.length}，移动端拍摄；AI 与勘察照片核对位置）</div>
                              <AttachmentWall photos={bPhotos} emptyText="无交底照片" compact />
                            </div>
                            {bAudios.length > 0 && (
                              <div className="text-[11px] text-violet-600 border border-violet-200 bg-violet-50 rounded-md px-2 py-1.5 shrink-0">
                                🎙️ 录音 {bAudios.length} 段（移动端查看/回放）
                              </div>
                            )}
                          </div>
                          {b.status === 'CONFIRMED' && b.confirmRemark && <div className="text-[11px] text-stone-500">确认意见：{b.confirmRemark}</div>}
                        </div>
                      )
                    })}
                  </div>
                </SectionCard>
              )}

              {/* 验收 */}
              {(detail.acceptance || detail.status === 'PENDING_ACCEPTANCE') && (
                <SectionCard icon={<CheckCircle2 className="w-4 h-4" />} title="作业验收"
                  badge={detail.acceptance ? <Badge variant="outline" className={cn('ml-1 text-[10px]', CONCLUSION_MAP[detail.acceptance.conclusion]?.className)}>{CONCLUSION_MAP[detail.acceptance.conclusion]?.label}</Badge> : undefined}>
                  {detail.acceptance ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Info label="验收人" value={detail.acceptance.acceptor} />
                        <Info label="验收时间" value={fmtDateTime(detail.acceptance.acceptedAt)} />
                        <Info label="无泄漏确认" value={detail.acceptance.leakCheck ? '✓ 通过' : '✗ 未通过'} />
                        <Info label="现场恢复" value={detail.acceptance.restoreCheck ? '✓ 通过' : '✗ 未通过'} />
                        <Info label="台账更新" value={detail.acceptance.ledgerCheck ? '✓ 已确认' : '✗ 未确认'} />
                        {detail.acceptance.problems && <div className="col-span-2"><Info label="发现问题" value={detail.acceptance.problems} /></div>}
                        <div className="col-span-2"><Info label="验收意见" value={detail.acceptance.remarks} /></div>
                      </div>
                      <div>
                        <div className="text-[11px] text-stone-400 mb-1">验收照片（{acceptPhotos.length}，移动端拍摄）</div>
                        <AttachmentWall photos={acceptPhotos} emptyText="" compact />
                      </div>
                    </div>
                  ) : canAcceptRole ? (
                    <AcceptanceForm currentUser={currentUser} busy={busy} onSave={saveAcceptance} />
                  ) : <p className="text-xs text-stone-400">待验收人进行作业验收</p>}
                </SectionCard>
              )}

              {/* 审批留痕 */}
              {detail.approvals.length > 0 && (
                <SectionCard icon={<Stamp className="w-4 h-4" />} title="审批记录">
                  <div className="space-y-2">
                    {detail.approvals.map((a) => (
                      <div key={a.id} className="flex items-start gap-2 text-xs border-l-2 border-emerald-200 pl-3 py-0.5">
                        <div className="flex-1">
                          <span className="font-medium text-stone-700">{a.operator}</span>
                          <Badge variant="outline" className={cn('ml-2 text-[10px]', a.action === 'APPROVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : a.action === 'REJECT' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-stone-50 text-stone-600 border-stone-200')}>{APPROVE_ACTION_MAP[a.action] ?? a.action}</Badge>
                          <span className="ml-2 text-stone-400">{a.bizType === 'ISOLATION' ? '隔离方案' : a.bizType === 'DISPOSAL' ? '处置方案' : '作业票'} {a.bizCode ?? ''}</span>
                          {a.comment && <div className="text-stone-500 mt-0.5">「{a.comment}」</div>}
                        </div>
                        <span className="text-stone-400 whitespace-nowrap">{fmtDateTime(a.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* 全流程档案打印预览（数据直接用详情已加载的 Detail，含 approvals） */}
      <WrPrintDialog open={printOpen} onOpenChange={setPrintOpen} detail={detail} printerName={currentUser.name} />

      {/* PID 图定位查看（以作业票隔离点位为中心放大） */}
      <PidLocateDialog
        open={pidLocateIdx !== null}
        onClose={() => setPidLocateIdx(null)}
        points={toLocatePoints(detail?.isolationScheme?.points ?? [])}
        initialIndex={pidLocateIdx ?? 0}
        preferUnitId={detail?.unitId ?? detail?.unit?.id ?? null}
      />

      {/* 隔离方案编辑 */}
      <Dialog open={isoOpen} onOpenChange={setIsoOpen}>
        <DialogContent className="sm:max-w-[860px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isoEditId ? '编辑隔离方案' : '编制隔离方案'}</DialogTitle>
            <DialogDescription>加装点必须从在库盲板中选择预留；拆除点执行时绑定已安装的盲板</DialogDescription></DialogHeader>
          <div className="space-y-2">
            <Field label="编制人"><Input className="h-8 text-xs w-52" value={isoPreparedBy} onChange={(e) => setIsoPreparedBy(e.target.value)} /></Field>
            {/* AI 草案生成条（violet：与方案编制模块同款，纯预填不落库） */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" />
              <span className="shrink-0 text-[11px] font-medium text-violet-700">AI 草案</span>
              <span className="min-w-[180px] flex-1 text-[11px] text-violet-500/90">基于作业需求、勘察记录、隔离点主数据与在库盲板自动生成隔离点清单，生成后可逐行修改</span>
              <Button size="sm" type="button" variant="outline" disabled={isoAiBusy} onClick={() => void genIsoAiDraft()}
                className="h-7 border-violet-300 bg-white px-2.5 text-[11px] text-violet-700 hover:bg-violet-100">
                {isoAiBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3 text-violet-500" />}
                {isoAiBusy ? 'AI 生成中…' : 'AI 生成草案'}
              </Button>
            </div>
            {/* 一键导入行（teal：确定性数据搬运勘察已确认点位，区别于 AI 草案） */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2">
              <Download className="h-3.5 w-3.5 shrink-0 text-teal-600" />
              <span className="shrink-0 text-[11px] font-medium text-teal-700">一键导入</span>
              <span className="min-w-[160px] flex-1 text-[11px] text-teal-500/90">把现场勘察记录引用的隔离点位带入清单，自动关联主数据并回填位置/介质/压力</span>
              <Button size="sm" type="button" variant="outline" disabled={!isoSurveyRefs.length}
                onClick={importIsoSurveyPoints}
                className="h-7 border-teal-300 bg-white px-2.5 text-[11px] text-teal-700 hover:bg-teal-100 hover:text-teal-800"
                title={!isoSurveyRefs.length ? '该需求的勘察记录未引用隔离点位，可用 AI 草案或手动添加' : '把勘察记录已确认的点位一键带入（合并去重）'}>
                <Download className="mr-1 h-3 w-3" />
                导入勘察点位{isoSurveyRefs.length ? `（${isoSurveyRefs.length}）` : ''}
              </Button>
              {isoSurveyRefs.length > 0 && (
                <span className="w-full truncate text-[11px] text-stone-400" title={isoSurveyRefs.map((r) => `${r.code} ${r.name}`).join('；')}>
                  勘察已确认：{isoSurveyRefs.map((r) => r.code).join('、')}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {isoRows.map((r, i) => (
                <div key={i} className="rounded-md border p-2.5 space-y-2 bg-stone-50/60">
                  <div className="flex items-center gap-2 text-xs text-stone-400">
                    <span className="font-medium text-stone-600">隔离点 {i + 1}</span>
                    {isoRows.length > 1 && <button className="ml-auto text-rose-500 hover:text-rose-700 flex items-center" onClick={() => setIsoRows(isoRows.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3 mr-0.5" />删除</button>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-stone-400 w-12 shrink-0">主数据</span>
                    <Select value={r.pipeSel || 'none'} onValueChange={(v) => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, pipeSel: v === 'none' ? '' : v, pointSel: 'none', masterPointId: null, masterCode: null, code: null, name: null } : x))}>
                      <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="选择管线" /></SelectTrigger>
                      <SelectContent className="max-h-56">
                        <SelectItem value="none">选择管线</SelectItem>
                        {pipelines.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} · {p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={r.pointSel || 'none'} disabled={!r.pipeSel} onValueChange={(v) => {
                      const m = pointMasters.find((x) => String(x.id) === v) ?? null
                      setIsoRows(isoRows.map((x, j) => j === i ? {
                        ...x,
                        pointSel: v,
                        masterPointId: m ? m.id : null,
                        masterCode: m ? m.code : null,
                        code: m ? m.code : null,
                        name: m ? m.name : null,
                        location: m?.location || x.location,
                        medium: m ? (m.pipeline?.medium ?? x.medium) : x.medium,
                        pressure: m ? (m.pipeline?.pressure ?? x.pressure) : x.pressure,
                      } : x))
                    }}>
                      <SelectTrigger className="h-8 w-60 text-xs"><SelectValue placeholder={r.pipeSel ? '选择隔离点（自动填充）' : '先选管线'} /></SelectTrigger>
                      <SelectContent className="max-h-56">
                        <SelectItem value="none">{r.pipeSel ? '不关联' : '先选管线'}</SelectItem>
                        {(r.pipeSel ? pointMasters.filter((m) => String(m.pipelineId ?? '') === r.pipeSel) : []).map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>{m.code} {m.name}{m.location ? `（${m.location}）` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {r.masterPointId ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-[10px] text-teal-700">
                        已关联 <span className="font-mono">{r.masterCode}</span>
                        <button type="button" className="text-teal-400 hover:text-rose-600" title="清除关联" onClick={() => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, masterPointId: null, masterCode: null, code: null, name: null, pointSel: 'none' } : x))}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ) : <span className="text-[11px] text-stone-300">未关联（选中后自动填充位置/介质/压力）</span>}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="col-span-2"><Input className="h-8 text-xs" placeholder="隔离位置 *（如 E101入口法兰）" value={r.location} onChange={(e) => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, location: e.target.value } : x))} /></div>
                    <Input className="h-8 text-xs" placeholder="介质" value={r.medium} onChange={(e) => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, medium: e.target.value } : x))} />
                    <Input className="h-8 text-xs" placeholder="压力" value={r.pressure} onChange={(e) => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, pressure: e.target.value } : x))} />
                    <Input className="h-8 text-xs" placeholder="温度" value={r.temperature} onChange={(e) => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, temperature: e.target.value } : x))} />
                    <Select value={r.blindSpec} onValueChange={(v) => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, blindSpec: v } : x))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="盲板规格 *" /></SelectTrigger>
                      <SelectContent>{specDict.map((d) => <SelectItem key={d.id} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={r.blindType} onValueChange={(v) => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, blindType: v } : x))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="盲板类型 *" /></SelectTrigger>
                      <SelectContent>{typeDict.map((d) => <SelectItem key={d.id} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={r.action} onValueChange={(v) => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, action: v, blindPlateId: v === 'REMOVE' ? '' : x.blindPlateId } : x))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="ADD">加装盲板</SelectItem><SelectItem value="REMOVE">拆除盲板</SelectItem></SelectContent>
                    </Select>
                    {r.action === 'ADD' ? (
                      <Select value={r.blindPlateId} onValueChange={(v) => setIsoRows(isoRows.map((x, j) => j === i ? { ...x, blindPlateId: v } : x))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="预留在库盲板 *" /></SelectTrigger>
                        <SelectContent className="max-h-56">
                          {plates.filter((p) => p.spec === r.blindSpec).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}（{p.spec} {p.type}）</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : <div className="h-8 flex items-center text-[11px] text-stone-400 px-1">拆除点：执行时绑定现场盲板</div>}
                  </div>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="text-xs border-emerald-300 text-emerald-700" onClick={() => setIsoRows([...isoRows, newIsoRow()])}>
              <Plus className="w-3.5 h-3.5 mr-1" />添加隔离点
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsoOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={busy} onClick={saveIso}>{busy ? '保存中…' : isoEditId ? '保存并提交审核' : '保存方案'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 处置方案编辑 */}
      <Dialog open={dispOpen} onOpenChange={setDispOpen}>
        <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>编制工艺处置方案</DialogTitle>
            <DialogDescription>按顺序列出泄压、排净、置换、吹扫、气体检测等处置步骤及合格标准</DialogDescription></DialogHeader>
          <div className="space-y-2">
            <Field label="编制人"><Input className="h-8 text-xs w-52" value={dispPreparedBy} onChange={(e) => setDispPreparedBy(e.target.value)} /></Field>
            {/* AI 草案生成条（violet） */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" />
              <span className="shrink-0 text-[11px] font-medium text-violet-700">AI 草案</span>
              <span className="min-w-[180px] flex-1 text-[11px] text-violet-500/90">基于作业需求与已批隔离方案自动生成「泄压→排净→置换→吹扫→检测」处置步骤，生成后可逐行修改</span>
              <Button size="sm" type="button" variant="outline" disabled={dispAiBusy} onClick={() => void genDispAiDraft()}
                className="h-7 border-violet-300 bg-white px-2.5 text-[11px] text-violet-700 hover:bg-violet-100">
                {dispAiBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3 text-violet-500" />}
                {dispAiBusy ? 'AI 生成中…' : 'AI 生成草案'}
              </Button>
            </div>
            {/* 一键导入行（teal：上游隔离方案点位确定性搬运） */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2">
              <Download className="h-3.5 w-3.5 shrink-0 text-teal-600" />
              <span className="shrink-0 text-[11px] font-medium text-teal-700">一键导入</span>
              <span className="min-w-[160px] flex-1 text-[11px] text-teal-500/90">把隔离方案确认的隔离点位生成「切断加盲板」步骤并关联主数据</span>
              <Button size="sm" type="button" variant="outline" disabled={!dispIsoSrc.length}
                onClick={importDispIsoPoints}
                className="h-7 border-teal-300 bg-white px-2.5 text-[11px] text-teal-700 hover:bg-teal-100 hover:text-teal-800"
                title={!dispIsoSrc.length ? '该需求暂无隔离方案或方案无隔离点位' : '把隔离方案点位一键生成为处置步骤（合并去重）'}>
                <Download className="mr-1 h-3 w-3" />
                导入隔离方案点位{dispIsoSrc.length ? `（${dispIsoSrc.length}）` : ''}
              </Button>
              {dispIsoSrc.length > 0 && (
                <span className="w-full truncate text-[11px] text-stone-400" title={`${detail?.isolationScheme?.code ?? ''}：${dispIsoSrc.map((p) => `${p.masterCode || p.location} ${p.blindSpec} ${p.blindType}`).join('；')}`}>
                  隔离方案 {detail?.isolationScheme?.code ?? ''}：{dispIsoSrc.map((p) => p.masterCode || p.location).join('、')}
                </span>
              )}
            </div>
            <div className="max-h-[42vh] overflow-y-auto -mx-1 px-1 pt-1 space-y-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-track]:bg-transparent">
            {dispRows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <span className="col-span-1 text-xs text-stone-400 text-center">{i + 1}</span>
                <Select value={r.method} onValueChange={(v) => setDispRows(dispRows.map((x, j) => j === i ? { ...x, method: v } : x))}>
                  <SelectTrigger className="col-span-2 h-8 text-xs w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(DISPOSAL_METHOD_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="col-span-4 h-8 text-xs min-w-0" placeholder="处置内容 *" value={r.detail} onChange={(e) => setDispRows(dispRows.map((x, j) => j === i ? { ...x, detail: e.target.value } : x))} />
                <Input className="col-span-2 h-8 text-xs min-w-0" placeholder="合格标准" value={r.standard} onChange={(e) => setDispRows(dispRows.map((x, j) => j === i ? { ...x, standard: e.target.value } : x))} />
                <Select value={r.masterPointId != null ? String(r.masterPointId) : 'none'} onValueChange={(v) => {
                  const m = pointMasters.find((x) => String(x.id) === v) ?? null
                  setDispRows(dispRows.map((x, j) => j === i ? { ...x, masterPointId: m ? m.id : null, masterCode: m ? m.code : null } : x))
                }}>
                  <SelectTrigger className="col-span-2 h-8 text-xs w-full min-w-0"><SelectValue placeholder="关联隔离点" /></SelectTrigger>
                  <SelectContent className="max-h-56">
                    <SelectItem value="none">不关联</SelectItem>
                    {pointMasters.map((m) => <SelectItem key={m.id} value={String(m.id)}>[{m.pipelineName ?? m.pipeline?.name ?? '—'}] {m.code} {m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <button type="button" title="删除该步骤" aria-label={`删除步骤 ${i + 1}`}
                  className="col-span-1 h-8 rounded-md text-rose-500 hover:text-rose-700 hover:bg-rose-50 flex items-center justify-center transition-colors"
                  onClick={() => setDispRows(dispRows.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            </div>
            <Button size="sm" variant="outline" className="text-xs border-emerald-300 text-emerald-700" onClick={() => setDispRows([...dispRows, { method: 'DRAIN', detail: '', standard: '', masterPointId: null, masterCode: null }])}>
              <Plus className="w-3.5 h-3.5 mr-1" />添加步骤
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={busy} onClick={saveDisp}>{busy ? '保存中…' : '保存方案'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 开作业票 */}
      <Dialog open={ticketOpen} onOpenChange={setTicketOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>开具盲板抽堵安全作业票（一票一板）</DialogTitle>
            <DialogDescription>每个选中隔离点位分别开具一张作业票并直接提交审批；批准后按隔离方案顺序逐点作业</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {/* 一票一板：隔离点位勾选（每个选中点位分别开具一张作业票） */}
            {detail?.isolationScheme?.points.length ? (() => {
              const activePointIds = new Set((detail.tickets ?? []).filter((t) => t.status !== 'VOID' && t.status !== 'CLOSED').map((t) => t.pointId))
              const toggle = (id: number) => setTicketPointIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
              return (
                <div className="col-span-2 rounded-md border border-teal-300 bg-teal-50 px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-teal-800">
                    <MapPin className="w-3.5 h-3.5" />
                    选择办票隔离点位（一票一板：已选 {ticketPointIds.length} 点 → 分别开具 {ticketPointIds.length} 张作业票）
                    <span className="ml-auto flex gap-1.5">
                      <button type="button" className="text-[10px] text-teal-600 hover:text-teal-800 hover:underline" onClick={() => setTicketPointIds(detail.isolationScheme!.points.filter((p) => !activePointIds.has(p.id)).map((p) => p.id))}>全选未办票</button>
                      <button type="button" className="text-[10px] text-stone-400 hover:text-stone-600 hover:underline" onClick={() => setTicketPointIds([])}>清空</button>
                    </span>
                  </div>
                  <div className="space-y-1">
                    {detail.isolationScheme.points.map((p) => {
                      const activeTicket = (detail.tickets ?? []).find((t) => t.pointId === p.id && t.status !== 'VOID' && t.status !== 'CLOSED')
                      const checked = ticketPointIds.includes(p.id)
                      return (
                        <label key={p.id} className={cn('flex items-center gap-2 rounded border px-2 py-1.5 text-[11px] transition-colors', activeTicket ? 'border-stone-100 bg-stone-50 opacity-60' : checked ? 'border-teal-400 bg-white cursor-pointer' : 'border-transparent bg-white/60 cursor-pointer hover:bg-white')}
                          title={activeTicket ? `该点已存在生效作业票 ${activeTicket.code}（${TICKET_STATUS_MAP[activeTicket.status]?.label ?? activeTicket.status}），一票一板不可重复办票` : undefined}>
                          <Checkbox checked={!!activeTicket || checked} disabled={!!activeTicket} onCheckedChange={() => !activeTicket && toggle(p.id)} />
                          <span className="font-mono text-teal-700">{p.masterCode || p.code || `点位${p.seq}`}</span>
                          <span className="min-w-0 flex-1 truncate text-stone-600">{p.location}</span>
                          <span className="text-stone-400">{p.blindSpec} · {p.blindType} · {p.action === 'ADD' ? '装' : '拆'}</span>
                          {activeTicket && <span className="font-mono text-[10px] text-stone-400">已办票 {activeTicket.code}</span>}
                        </label>
                      )
                    })}
                  </div>
                  <div className="text-[10px] leading-relaxed text-teal-600/80">符合 GB 30871-2022 一票一板：一张作业票只对应一块盲板的一个作业；同一盲板抽、堵分别办票，多点位按隔离方案顺序逐点抽堵。</div>
                </div>
              )
            })() : (
              <div className="col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">该需求尚无隔离方案点位——一票一板模式下必须先编制并审核隔离方案后才能开票</div>
            )}
            {/* 管线占用冲突阻断提示（安全硬约束：一条管线同一时间只允许一张生效中的盲板作业票） */}
            {occConflicts.length > 0 && (
              <div className="col-span-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 space-y-1" role="alert">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-800">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />管线占用冲突，无法开票
                </div>
                {occConflicts.map((c, i) => (
                  <div key={i} className="font-mono text-[11px] leading-relaxed text-rose-700 break-all">
                    {c.pipelineCode}（{c.pipelineName}）已被 {c.ticketCode ?? '—'}（{c.workRequestCode}「{c.workRequestTitle}」，{STATUS_MAP[c.workRequestStatus]?.label ?? c.workRequestStatus}）占用
                  </div>
                ))}
                <div className="text-[11px] leading-relaxed text-rose-600">
                  一条管线同一时间只允许一张生效中的盲板作业票，并发盲板操作可能引发事故；请待上述作业票关闭或需求取消后再开票。
                </div>
              </div>
            )}
            <Field label="计划开始 *"><Input type="datetime-local" className="h-8 text-xs" value={ticketForm.plannedStart} onChange={(e) => setTicketForm({ ...ticketForm, plannedStart: e.target.value })} /></Field>
            <Field label="计划结束 *"><Input type="datetime-local" className="h-8 text-xs" value={ticketForm.plannedEnd} onChange={(e) => setTicketForm({ ...ticketForm, plannedEnd: e.target.value })} /></Field>
            <Field label="监护人 *">
              <Select value={ticketForm.guardian} onValueChange={(v) => setTicketForm({ ...ticketForm, guardian: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择监护人" /></SelectTrigger>
                <SelectContent>{users.filter((u) => u.role === 'GUARDIAN').map((u) => <SelectItem key={u.id} value={u.name}>{u.name}（监护人）</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="签发人"><Input className="h-8 text-xs" value={ticketForm.issuer} onChange={(e) => setTicketForm({ ...ticketForm, issuer: e.target.value })} /></Field>
            <div className="col-span-2">
              <Field label="作业人员逐人验资 *（GB 30871：身份证照片必传，审批页将核验材料）">
                <div className="max-h-72 overflow-y-auto bp-thin-scrollbar rounded-md pr-0.5">
                  <CrewEditor certs={ticketCrew} onChange={setTicketCrew} currentUser={currentUser} />
                </div>
              </Field>
            </div>
            <div className="col-span-2"><Field label="安全措施"><Textarea className="text-xs" rows={6} value={ticketForm.safetyMeasures} onChange={(e) => setTicketForm({ ...ticketForm, safetyMeasures: e.target.value })} /></Field></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTicketOpen(false)}>取消</Button>
            <Button
              className="bg-emerald-700 hover:bg-emerald-800"
              disabled={busy || occConflicts.length > 0 || !ticketPointIds.length || crewGaps(ticketCrew).length > 0}
              title={
                !ticketPointIds.length ? '请先勾选要办票的隔离点位（一票一板：每点一张）'
                : occConflicts.length > 0 ? '管线占用冲突解除后才能开票（一条管线同一时间只允许一张生效作业票）'
                : crewGaps(ticketCrew).length > 0 ? `验资待完善：${crewGaps(ticketCrew).join('；')}`
                : undefined
              }
              onClick={saveTicket}
            >{busy ? '提交中…' : `开具 ${ticketPointIds.length} 张作业票并提交审批`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 处置步骤逐项确认 */}
      <Dialog open={stepConfirmFor !== null} onOpenChange={(v) => (!v ? setStepConfirmFor(null) : undefined)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-base">处置步骤逐项确认 · 步骤 {stepConfirmFor?.seq}</DialogTitle>
            <DialogDescription className="text-xs line-clamp-2">{stepConfirmFor?.detail}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="确认结果 *">
              <Select value={stepConfirmForm.result} onValueChange={(v) => setStepConfirmForm({ ...stepConfirmForm, result: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OK">✓ 已执行且合格</SelectItem>
                  <SelectItem value="ABNORMAL">✗ 异常（需整改后复认）</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="确认人 *"><Input className="h-8 text-xs" value={stepConfirmForm.confirmer} onChange={(e) => setStepConfirmForm({ ...stepConfirmForm, confirmer: e.target.value })} /></Field>
            <Field label={stepConfirmForm.result === 'OK' ? '实测数据 / 备注' : '异常描述'}>
              <Textarea className="text-xs" rows={2} placeholder={stepConfirmForm.result === 'OK' ? '如：压力表读数 0MPa，LEL 0%' : '如：压力未泄至目标值，需继续泄压'} value={stepConfirmForm.remark} onChange={(e) => setStepConfirmForm({ ...stepConfirmForm, remark: e.target.value })} />
            </Field>
            {stepConfirmForm.result === 'OK' && (
              <p className="text-[11px] leading-relaxed text-teal-600">全部步骤逐项确认合格后，方可进行工艺处置总体确认</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStepConfirmFor(null)}>取消</Button>
            <Button
              className={stepConfirmForm.result === 'OK' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-amber-600 hover:bg-amber-700'}
              disabled={stepConfirmBusy || !stepConfirmForm.confirmer.trim()}
              onClick={saveStepConfirm}
            >{stepConfirmBusy ? '提交中…' : stepConfirmForm.result === 'OK' ? '确认合格' : '标记异常'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============ 内联子组件 ============
function SurveyForm({ detail, busy, pipelines, pointMasters, editing, onCancel, onSave }: {
  detail: Detail
  busy: boolean
  pipelines: Pipeline[]
  pointMasters: PointMaster[]
  editing?: boolean
  onCancel?: () => void
  onSave: (s: Omit<NonNullable<Detail['survey']>, 'id'>, pointRefs: PointRef[]) => void
}) {
  // 编辑已有勘察记录时回显（含 pointRefs chips 反显）
  const [f, setF] = useState(() => ({
    surveyor: detail.survey?.surveyor ?? '',
    surveyDate: detail.survey ? toLocalInput(detail.survey.surveyDate) : toLocalInput(new Date()),
    siteCondition: detail.survey?.siteCondition ?? '',
    pipelineVerify: detail.survey?.pipelineVerify ?? '',
    hazardPoints: detail.survey?.hazardPoints ?? '',
    isSafe: detail.survey?.isSafe ?? true,
    suggestion: detail.survey?.suggestion ?? '',
  }))
  const [refs, setRefs] = useState<PointRef[]>(() => parsePointRefs(detail.survey?.pointRefs))
  // AI 勘察辅助：要点清单（现场核对参考）+ 记录起草（预填表单不落库）
  const { toast } = useToast()
  const [aiBusy, setAiBusy] = useState<'checklist' | 'draft' | null>(null)
  const [checklist, setChecklist] = useState<string[] | null>(null)
  const genChecklist = async () => {
    if (aiBusy) return
    setAiBusy('checklist')
    try {
      const res = await apiPost<{ checklist: string[] }>('/api/ai/survey/checklist', { workRequestId: detail.id })
      setChecklist(res.checklist)
      toast({ title: 'AI 勘察要点已生成', description: `${res.checklist.length} 条要点供现场逐项核对，请结合实际确认` })
    } catch (e) {
      toast({ title: 'AI 勘察要点生成失败', description: e instanceof Error ? e.message : '请稍后重试', variant: 'destructive' })
    } finally { setAiBusy(null) }
  }
  const genDraft = async () => {
    if (aiBusy) return
    setAiBusy('draft')
    try {
      // 已随手记的要点作为素材传给 AI（不编造要点之外的现场事实）
      const res = await apiPost<{ draft: { siteCondition: string; pipelineVerify: string; hazardPoints: string; suggestion: string } }>(
        '/api/ai/draft/survey', { workRequestId: detail.id, notes: f.siteCondition })
      setF((prev) => ({
        ...prev,
        siteCondition: res.draft.siteCondition || prev.siteCondition,
        pipelineVerify: res.draft.pipelineVerify || prev.pipelineVerify,
        hazardPoints: res.draft.hazardPoints || prev.hazardPoints,
        suggestion: res.draft.suggestion || prev.suggestion,
      }))
      toast({ title: 'AI 草稿已填入表单', description: '请逐项核对修改后保存（AI 不代填「具备作业条件」判断）' })
    } catch (e) {
      toast({ title: 'AI 草稿生成失败', description: e instanceof Error ? e.message : '请稍后重试', variant: 'destructive' })
    } finally { setAiBusy(null) }
  }
  // AI 推举引用隔离点位（共用 hook：按作业上下文受限选点，合并去重预填）
  const { refBusy, genRefPoints } = useAiRefPoints({
    workRequestId: detail.id,
    getContext: () => ({ siteCondition: f.siteCondition, hazardPoints: f.hazardPoints }),
    refs, setRefs,
  })
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2 flex flex-wrap items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <span className="text-[11px] text-violet-800 flex-1 min-w-[180px]">AI 勘察辅助：生成针对本作业的要点清单供现场核对；也可先在「现场条件描述」随手记要点，再由 AI 起草成完整记录。</span>
        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-violet-300 bg-white text-violet-700 hover:bg-violet-100" disabled={aiBusy !== null}
          onClick={() => void genChecklist()} title="按介质/压力/位置定制生成现场勘察要点清单">
          {aiBusy === 'checklist' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ListChecks className="w-3.5 h-3.5 mr-1 text-violet-500" />}
          {aiBusy === 'checklist' ? '生成中…' : 'AI 勘察要点'}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-violet-300 bg-white text-violet-700 hover:bg-violet-100" disabled={aiBusy !== null}
          onClick={() => void genDraft()} title="基于作业信息起草勘察记录（现场条件/参数核实/风险点/建议），已有随手记要点将作为素材">
          {aiBusy === 'draft' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1 text-violet-500" />}
          {aiBusy === 'draft' ? '起草中…' : 'AI 起草记录'}
        </Button>
      </div>
      {checklist && (
        <div className="rounded-md border border-violet-200 bg-white px-3 py-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-violet-800">AI 勘察要点清单（现场逐项核对参考）</span>
            <button type="button" className="text-stone-300 hover:text-rose-500" title="收起要点清单" onClick={() => setChecklist(null)}><X className="w-3.5 h-3.5" /></button>
          </div>
          <ul className="space-y-0.5">
            {checklist.map((c, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-stone-700">
                <span className="font-mono text-violet-400 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-stone-400">要点由 AI 基于作业信息生成，仅供现场核对参考，不替代现场实际确认</p>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Field label="勘察人"><Input className="h-8 text-xs" value={f.surveyor} onChange={(e) => setF({ ...f, surveyor: e.target.value })} placeholder="填写勘察人" /></Field>
        <Field label="勘察时间"><Input type="datetime-local" className="h-8 text-xs" value={f.surveyDate} onChange={(e) => setF({ ...f, surveyDate: e.target.value })} /></Field>
        <div className="flex items-end pb-1.5"><label className="flex items-center gap-1.5 text-xs"><Checkbox checked={f.isSafe} onCheckedChange={(v) => setF({ ...f, isSafe: v === true })} />现场具备作业条件</label></div>
        <div className="col-span-2 md:col-span-3"><Field label="现场条件描述"><Textarea className="text-xs" rows={2} value={f.siteCondition} onChange={(e) => setF({ ...f, siteCondition: e.target.value })} placeholder="平台/照明/交叉作业等现场情况" /></Field></div>
        <div className="col-span-2"><Field label="管线参数核实"><Input className="h-8 text-xs" value={f.pipelineVerify} onChange={(e) => setF({ ...f, pipelineVerify: e.target.value })} placeholder={`介质 ${detail.medium ?? '-'} / 压力 ${detail.pressure ?? '-'} / 温度 ${detail.temperature ?? '-'} 是否一致`} /></Field></div>
        <Field label="现场风险点"><Input className="h-8 text-xs" value={f.hazardPoints} onChange={(e) => setF({ ...f, hazardPoints: e.target.value })} placeholder="如：高处作业、残液" /></Field>
        <div className="col-span-2 md:col-span-3"><Field label="勘察建议"><Input className="h-8 text-xs" value={f.suggestion} onChange={(e) => setF({ ...f, suggestion: e.target.value })} /></Field></div>
        <div className="col-span-2 md:col-span-3">
          <PointRefPicker pipelines={pipelines} pointMasters={pointMasters} refs={refs} onChange={setRefs} hint="引用本次勘察确认的作业隔离点位（可跨管线多选）" aiAction={{ busy: refBusy, onRun: () => void genRefPoints() }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={busy}
          onClick={() => onSave({ surveyor: f.surveyor, surveyDate: f.surveyDate ? new Date(f.surveyDate).toISOString() : new Date().toISOString(), siteCondition: f.siteCondition, pipelineVerify: f.pipelineVerify, hazardPoints: f.hazardPoints, isSafe: f.isSafe, suggestion: f.suggestion }, refs)}>
          {editing ? '更新勘察记录' : '保存勘察记录'}
        </Button>
        {onCancel && <Button size="sm" variant="outline" onClick={onCancel}>取消编辑</Button>}
      </div>
    </div>
  )
}

function JsaFormEditor({ detail, leader, busy, pipelines, pointMasters, editing, onCancel, onSave }: {
  detail: Detail
  leader: string
  busy: boolean
  pipelines: Pipeline[]
  pointMasters: PointMaster[]
  editing?: boolean
  onCancel?: () => void
  onSave: (f: { leader: string; members: string; riskLevel: string; residualRisk: string; steps: JsaStep[] }, pointRefs: PointRef[]) => void
}) {
  // 编辑已有 JSA 时回显（含 pointRefs chips 反显与既有步骤）
  const [f, setF] = useState<{ leader: string; members: string; riskLevel: string; residualRisk: string; steps: JsaStep[] }>(() => ({
    leader: detail.jsa?.leader ?? leader,
    members: detail.jsa?.members ?? '',
    riskLevel: detail.jsa?.riskLevel ?? 'MEDIUM',
    residualRisk: detail.jsa?.residualRisk ?? '',
    steps: detail.jsa?.steps?.length
      ? detail.jsa.steps.map((s) => ({ seq: s.seq, step: s.step, hazard: s.hazard, measure: s.measure }))
      : [
          { seq: 1, step: '', hazard: '', measure: '' },
          { seq: 2, step: '', hazard: '', measure: '' },
          { seq: 3, step: '', hazard: '', measure: '' },
        ],
  }))
  const [refs, setRefs] = useState<PointRef[]>(() => parsePointRefs(detail.jsa?.pointRefs))
  const { toast } = useToast()
  const setStep = (i: number, key: keyof JsaStep, v: string) => setF({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, [key]: v } : s) })
  // 勘察点位导入：勘察记录已确认引用的 pointRefs 一键带入 JSA（人工确认数据优先，合并去重）
  const surveyRefSource = parsePointRefs(detail.survey?.pointRefs)
  const importSurveyRefs = () => {
    const fresh = surveyRefSource.filter((r) => !refs.some((p) => p.masterPointId === r.masterPointId))
    if (!fresh.length) { toast({ title: '勘察点位均已在列表中', description: '未新增引用点位' }); return }
    setRefs((prev) => [...prev, ...fresh])
    toast({ title: `已导入 ${fresh.length} 个勘察点位`, description: fresh.map((r) => `${r.code} ${r.name}`).join('；').slice(0, 120) })
  }
  // AI 推举兜底（勘察未引用点位时）：基于勘察记录上下文受限选点
  const { refBusy, genRefPoints } = useAiRefPoints({
    workRequestId: detail.id,
    getContext: () => ({ siteCondition: detail.survey?.siteCondition ?? '', hazardPoints: detail.survey?.hazardPoints ?? '' }),
    refs, setRefs,
  })
  // AI 草案：基于作业需求+勘察记录生成步骤-危害-措施三元组并预填表单
  const [aiBusy, setAiBusy] = useState(false)
  const genAiDraft = async () => {
    if (aiBusy) return
    setAiBusy(true)
    try {
      const res = await apiPost<{ draft: { riskLevel: string; residualRisk: string; steps: { step: string; hazard: string; measure: string }[] } }>('/api/ai/draft/jsa', { workRequestId: detail.id })
      setF((prev) => ({
        ...prev,
        riskLevel: res.draft.riskLevel,
        residualRisk: res.draft.residualRisk || prev.residualRisk,
        steps: res.draft.steps.map((s, i) => ({ seq: i + 1, step: s.step, hazard: s.hazard, measure: s.measure })),
      }))
      toast({ title: 'AI 草案已生成', description: `${res.draft.steps.length} 个步骤已填入表单，请逐项核对后保存` })
    } catch (e) {
      toast({ title: 'AI 草案生成失败', description: e instanceof Error ? e.message : '请稍后重试', variant: 'destructive' })
    } finally { setAiBusy(false) }
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label="分析组长"><Input className="h-8 text-xs" value={f.leader} onChange={(e) => setF({ ...f, leader: e.target.value })} /></Field>
        <Field label="参与人员"><Input className="h-8 text-xs" value={f.members} onChange={(e) => setF({ ...f, members: e.target.value })} placeholder="逗号分隔" /></Field>
        <Field label="综合风险等级">
          <Select value={f.riskLevel} onValueChange={(v) => setF({ ...f, riskLevel: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="LOW">低</SelectItem><SelectItem value="MEDIUM">中</SelectItem><SelectItem value="HIGH">高</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="剩余风险与应急措施"><Input className="h-8 text-xs" value={f.residualRisk} onChange={(e) => setF({ ...f, residualRisk: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-teal-300 text-teal-700 hover:bg-teal-100 hover:text-teal-800"
          disabled={!surveyRefSource.length} onClick={importSurveyRefs}
          title={surveyRefSource.length ? '把现场勘察记录已确认引用的隔离点位一键带入 JSA（合并去重）' : '该需求的勘察记录未引用隔离点位，无法导入'}>
          <Download className="w-3 h-3 mr-1" />导入勘察点位{surveyRefSource.length ? `（${surveyRefSource.length}）` : ''}
        </Button>
        {surveyRefSource.length ? (
          <span className="text-[11px] text-stone-400 truncate max-w-[380px]" title={surveyRefSource.map((r) => `${r.code} ${r.name}`).join('；')}>
            勘察已确认：{surveyRefSource.map((r) => r.code).join('、')}
          </span>
        ) : <span className="text-[11px] text-stone-400">勘察记录未引用点位，可用 AI 推举兜底</span>}
      </div>
      <PointRefPicker pipelines={pipelines} pointMasters={pointMasters} refs={refs} onChange={setRefs} hint="JSA 分析涉及的隔离点位（可跨管线多选）" aiAction={{ busy: refBusy, onRun: () => void genRefPoints() }} />
      <div className="space-y-1.5">
        {f.steps.map((s, i) => (
          <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
            <span className="col-span-1 text-xs text-stone-400 text-center">{i + 1}</span>
            <Input className="col-span-4 h-8 text-xs" placeholder="作业步骤" value={s.step} onChange={(e) => setStep(i, 'step', e.target.value)} />
            <Input className="col-span-3 h-8 text-xs" placeholder="危害因素" value={s.hazard} onChange={(e) => setStep(i, 'hazard', e.target.value)} />
            <Input className="col-span-3 h-8 text-xs" placeholder="控制措施" value={s.measure} onChange={(e) => setStep(i, 'measure', e.target.value)} />
            <button className="col-span-1 text-rose-500 hover:text-rose-700 flex justify-center" onClick={() => setF({ ...f, steps: f.steps.filter((_, j) => j !== i) })} title="删除该行"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="text-xs border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100" disabled={aiBusy} onClick={() => void genAiDraft()} title="基于作业需求与勘察记录，AI 生成作业步骤-危害-控制措施草案">
          {aiBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1 text-violet-500" />}
          {aiBusy ? 'AI 生成中…' : 'AI 生成草案'}
        </Button>
        <Button size="sm" variant="outline" className="text-xs border-emerald-300 text-emerald-700" onClick={() => setF({ ...f, steps: [...f.steps, { seq: f.steps.length + 1, step: '', hazard: '', measure: '' }] })}><Plus className="w-3.5 h-3.5 mr-1" />添加步骤</Button>
        <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={busy} onClick={() => onSave(f, refs)}>{editing ? '更新 JSA 分析' : '保存 JSA 分析'}</Button>
        {onCancel && <Button size="sm" variant="outline" onClick={onCancel}>取消编辑</Button>}
      </div>
    </div>
  )
}

function IsoPointsTable({ points, statusMap }: { points: IsoPoint[]; statusMap?: Record<number, PointStatusRow> }) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full text-xs min-w-[760px]">
        <thead className="bg-stone-50 text-stone-500">
          <tr><th className="text-left px-2 py-1.5 w-10">#</th><th className="text-left px-2 py-1.5">隔离位置</th><th className="text-left px-2 py-1.5 w-32">关联点位</th><th className="text-left px-2 py-1.5 w-20">介质</th><th className="text-left px-2 py-1.5 w-16">压力</th><th className="text-left px-2 py-1.5 w-24">盲板</th><th className="text-left px-2 py-1.5 w-20">动作</th><th className="text-left px-2 py-1.5 w-28">实时状态</th><th className="text-left px-2 py-1.5 w-28">执行状态</th></tr>
        </thead>
        <tbody>
          {points.map((p) => {
            const ps = statusMap?.[p.id]
            const st = ps ? ISO_STATE_STYLE[ps.state] : undefined
            const mc = ps?.masterCode || p.masterCode
            return (
              <tr key={p.id} className="border-t border-stone-100">
                <td className="px-2 py-1.5 text-stone-400">{p.seq}</td>
                <td className="px-2 py-1.5">{p.location}</td>
                <td className="px-2 py-1.5">
                  {mc ? (
                    <span className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-700">
                      <MapPin className="h-2.5 w-2.5" />{mc}{ps?.pipelineName ? <span className="text-teal-500">·{ps.pipelineName}</span> : null}
                    </span>
                  ) : <span className="text-stone-300">未关联</span>}
                </td>
                <td className="px-2 py-1.5 text-stone-600">{p.medium ?? '-'}</td>
                <td className="px-2 py-1.5 text-stone-600">{p.pressure ?? '-'}</td>
                <td className="px-2 py-1.5">{p.blindSpec} {p.blindType}</td>
                <td className="px-2 py-1.5"><Badge variant="outline" className={cn('text-[10px]', p.action === 'ADD' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>{POINT_ACTION_MAP[p.action]}</Badge></td>
                <td className="px-2 py-1.5">
                  {ps && st ? (
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px]', st.chip)}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />{ps.stateLabel}
                    </span>
                  ) : <span className="text-stone-300">—</span>}
                </td>
                <td className="px-2 py-1.5">{p.done ? <span className="text-emerald-600">✓ {p.operator} {fmtDate(p.doneAt)}</span> : <span className="text-stone-400">待执行</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** AI 推举隔离点位（勘察/JSA 表单共用）：调 /api/ai/survey/points 受限选点（后端 masterCode 校验防幻觉），合并去重预填；响应附带设备识别 scope 用于提示透明化 */
function useAiRefPoints(opts: {
  workRequestId: number
  getContext: () => { siteCondition?: string; hazardPoints?: string }
  refs: PointRef[]
  setRefs: (updater: (prev: PointRef[]) => PointRef[]) => void
}) {
  const { toast } = useToast()
  const [refBusy, setRefBusy] = useState(false)
  const genRefPoints = async () => {
    if (refBusy) return
    setRefBusy(true)
    try {
      const res = await apiPost<{
        refs: (PointRef & { reason?: string })[]
        scope?: { matchedEquipments: { code: string; name: string }[]; links: { pipelineCode: string; equipmentCode: string; direction: string }[]; rationale?: string; scopeText?: string; fallbackUsed?: boolean }
      }>('/api/ai/survey/points', {
        workRequestId: opts.workRequestId, ...opts.getContext(),
      })
      const fresh = res.refs.filter((r) => !opts.refs.some((p) => p.masterPointId === r.masterPointId))
      if (!fresh.length) {
        toast({ title: 'AI 推荐点位均已在列表中', description: '未新增引用点位' })
        return
      }
      opts.setRefs((prev) => [...prev, ...fresh.map(({ reason, ...r }) => ({ ...r, reason }))])
      const scopeTip = res.scope?.matchedEquipments?.length
        ? `已识别设备 ${res.scope.matchedEquipments.map((e) => e.code).join('、')}，候选含其相连管线隔离点`
        : res.scope?.fallbackUsed
          ? '需求未提取到设备/管线要素，候选为同装置全部隔离点'
          : null
      toast({
        title: `AI 推举 ${fresh.length} 个隔离点位已填入`,
        description: [scopeTip, res.scope?.rationale, fresh.map((r) => `${r.code}${r.reason ? `（${r.reason}）` : ''}`).join('；')].filter(Boolean).join('｜').slice(0, 140),
      })
    } catch (e) {
      toast({ title: 'AI 推举点位失败', description: e instanceof Error ? e.message : '请稍后重试', variant: 'destructive' })
    } finally { setRefBusy(false) }
  }
  return { refBusy, genRefPoints }
}

/** 需求25：勘察核实通盲状态快照徽章（与 pipeline-master BLIND_STATE_CLS / field-ops BLIND_BADGE_CLS 同口径） */
const POINT_BLIND_LABEL: Record<string, string> = { BLINDED: '盲断', OPEN: '导通', THROUGH: '常通', WORKING: '作业中' }
const POINT_BLIND_CLS: Record<string, string> = {
  BLINDED: 'border-rose-200 bg-rose-50 text-rose-700',
  OPEN: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  THROUGH: 'border-stone-200 bg-stone-100 text-stone-600',
  WORKING: 'border-violet-200 bg-violet-50 text-violet-700',
}

function PointRefChips({ refs, onRemove }: { refs: PointRef[]; onRemove?: (id: number) => void }) {
  if (!refs.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {refs.map((ref) => (
        <span key={ref.masterPointId} title={ref.reason ? `AI 推举理由：${ref.reason}` : undefined} className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-[11px] text-teal-700">
          <MapPin className="h-2.5 w-2.5 shrink-0" />
          <span className="font-mono">{ref.code}</span>
          {ref.name ? <span>{ref.name}</span> : null}
          {ref.pipelineName ? <span className="text-teal-500">·{ref.pipelineName}</span> : null}
          {ref.blindState ? (
            <span title={`勘察现场核实的通盲状态：${POINT_BLIND_LABEL[ref.blindState] ?? ref.blindState}`}
              className={cn('shrink-0 rounded-full border px-1.5 text-[9px] font-medium leading-4', POINT_BLIND_CLS[ref.blindState] ?? 'border-stone-200 bg-stone-50 text-stone-500')}>
              {POINT_BLIND_LABEL[ref.blindState] ?? ref.blindState}
            </span>
          ) : null}
          {onRemove && (
            <button type="button" className="ml-0.5 text-teal-400 hover:text-rose-600" title="移除" onClick={() => onRemove(ref.masterPointId)}>
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

/** 隔离点主数据引用选择器：先选管线 → 再选该管线的隔离点 → teal chips（可跨管线多选、可删除）；aiAction 提供时附 AI 推举按钮。
 * 需求23：不提供「扫码加入」——扫码属于移动端预览专属环节，桌面端以「选管线→选隔离点→添加」组合加入 */
function PointRefPicker({ pipelines, pointMasters, refs, onChange, hint, aiAction }: {
  pipelines: Pipeline[]
  pointMasters: PointMaster[]
  refs: PointRef[]
  onChange: (refs: PointRef[]) => void
  hint?: string
  aiAction?: { busy: boolean; onRun: () => void }
}) {
  const [pipe, setPipe] = useState('none')
  const [point, setPoint] = useState('none')
  // 需求10：现场无码时打印二维码标签（引用点位批量打印，供移动端扫码核对）
  const [labelPrint, setLabelPrint] = useState<{ open: boolean; points: QrLabelPoint[] }>({ open: false, points: [] })
  const pipePoints = pipe === 'none' ? [] : pointMasters.filter((m) => String(m.pipelineId ?? '') === pipe)
  const addRef = () => {
    const m = pointMasters.find((x) => String(x.id) === point)
    if (!m) return
    if (refs.some((r) => r.masterPointId === m.id)) { setPoint('none'); return }
    onChange([...refs, { masterPointId: m.id, code: m.code, name: m.name, pipelineName: m.pipelineName ?? m.pipeline?.name ?? null, blindState: 'THROUGH' }])
    setPoint('none')
  }
  return (
    <div className="rounded-md border border-teal-200 bg-teal-50/50 p-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <MapPin className="w-3.5 h-3.5 text-teal-600 shrink-0" />
        <span className="text-xs font-medium text-teal-800">引用隔离点位</span>
        <span className="text-[11px] text-stone-400">{hint ?? '关联隔离点主数据'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={pipe} onValueChange={(v) => { setPipe(v); setPoint('none') }}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="选择管线" /></SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value="none">选择管线</SelectItem>
            {pipelines.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} · {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={point} onValueChange={setPoint} disabled={pipe === 'none'}>
          <SelectTrigger className="h-8 w-60 text-xs"><SelectValue placeholder={pipe === 'none' ? '先选管线' : '选择隔离点'} /></SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value="none">{pipe === 'none' ? '先选管线' : pipePoints.length ? '选择隔离点' : '该管线暂无隔离点'}</SelectItem>
            {pipePoints.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.code} {m.name}{m.location ? `（${m.location}）` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 text-xs border-teal-300 text-teal-700 hover:bg-teal-100 hover:text-teal-800" disabled={point === 'none'} onClick={addRef}>
          <Plus className="w-3 h-3 mr-1" />添加该管线隔离点
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
          disabled={refs.length === 0}
          onClick={() => setLabelPrint({ open: true, points: refs.map((r) => ({ code: r.code, name: r.name })) })}
          title="为引用点位批量打印二维码标签（现场无码时先打印张贴）">
          <Printer className="w-3 h-3 mr-1 text-emerald-600" />打印标签
        </Button>
        {aiAction && (
          <Button size="sm" variant="outline" className="h-8 text-xs border-violet-300 bg-white text-violet-700 hover:bg-violet-100" disabled={aiAction.busy}
            onClick={aiAction.onRun} title="AI 按作业位置/设备位号/介质/原因从隔离点主数据中推举本次应引用的点位（含设备进/出口相连管线上的隔离点，仅限主数据真值，附推荐理由）">
            {aiAction.busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ListChecks className="w-3 h-3 mr-1 text-violet-500" />}
            {aiAction.busy ? 'AI 推举中…' : 'AI 推荐点位'}
          </Button>
        )}
      </div>
      {refs.length ? (
        <PointRefChips refs={refs} onRemove={(id) => onChange(refs.filter((r) => r.masterPointId !== id))} />
      ) : (
        <p className="text-[11px] text-stone-400">未引用隔离点主数据</p>
      )}
      {/* 需求10：二维码标签打印预览（A4 3×8 网格，BPISO 协议与移动端扫码一致，打印后供移动端现场扫码核对） */}
      <QrLabelPrint
        open={labelPrint.open}
        onClose={() => setLabelPrint({ open: false, points: [] })}
        points={labelPrint.points}
        title="隔离点二维码标签"
      />
    </div>
  )
}

/** 作业票票面隔离点位清单（来自隔离方案：编号/名称/位置/盲板规格/执行状态 + PID 图定位） */
function TicketPointsTable({ points, onLocate }: { points: IsoPoint[]; onLocate: (idx: number) => void }) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full text-xs min-w-[600px]">
        <thead className="bg-stone-50 text-stone-500">
          <tr>
            <th className="text-left px-2 py-1.5 w-10">序号</th>
            <th className="text-left px-2 py-1.5 w-24">操作</th>
            <th className="text-left px-2 py-1.5">隔离点编号</th>
            <th className="text-left px-2 py-1.5">名称</th>
            <th className="text-left px-2 py-1.5">位置</th>
            <th className="text-left px-2 py-1.5 w-28">盲板规格</th>
            <th className="text-left px-2 py-1.5 w-20">执行状态</th>
            <th className="text-left px-2 py-1.5 w-16">PID</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.id} className="border-t border-stone-100">
              <td className="px-2 py-1.5 text-stone-400">{p.seq}</td>
              <td className="px-2 py-1.5">
                <Badge variant="outline" className={cn('text-[10px]', p.action === 'ADD' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                  {p.action === 'ADD' ? 'ADD·装' : 'REMOVE·抽'}
                </Badge>
              </td>
              <td className="px-2 py-1.5 font-mono text-stone-700">{p.masterCode || p.code || '-'}</td>
              <td className="px-2 py-1.5">{p.name || '-'}</td>
              <td className="px-2 py-1.5 text-stone-600">{p.location}</td>
              <td className="px-2 py-1.5">{p.blindSpec} {p.blindType}</td>
              <td className="px-2 py-1.5">{p.done ? <span className="text-emerald-600 font-medium">已执行</span> : <span className="text-amber-600">待执行</span>}</td>
              <td className="px-2 py-1.5">
                <button
                  onClick={() => onLocate(i)}
                  title="在 PID 图中定位该隔离点"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-teal-700 hover:bg-teal-50 border border-teal-200 transition-colors"
                >
                  <MapPin className="w-3 h-3" />图
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AcceptanceForm({ currentUser, busy, onSave }: {
  currentUser: BpUser
  busy: boolean
  onSave: (a: { acceptor: string; leakCheck: boolean; restoreCheck: boolean; ledgerCheck: boolean; problems: string; remarks: string }) => void
}) {
  const [f, setF] = useState({ acceptor: currentUser.name, leakCheck: true, restoreCheck: true, ledgerCheck: true, problems: '', remarks: '' })
  const allPass = f.leakCheck && f.restoreCheck && f.ledgerCheck
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label="验收人"><Input className="h-8 text-xs" value={f.acceptor} onChange={(e) => setF({ ...f, acceptor: e.target.value })} /></Field>
        <div className="col-span-3 flex items-center flex-wrap gap-4 pb-1.5 text-xs">
          <label className="flex items-center gap-1.5"><Checkbox checked={f.leakCheck} onCheckedChange={(v) => setF({ ...f, leakCheck: v === true })} />无泄漏确认</label>
          <label className="flex items-center gap-1.5"><Checkbox checked={f.restoreCheck} onCheckedChange={(v) => setF({ ...f, restoreCheck: v === true })} />现场恢复确认</label>
          <label className="flex items-center gap-1.5"><Checkbox checked={f.ledgerCheck} onCheckedChange={(v) => setF({ ...f, ledgerCheck: v === true })} />台账已更新</label>
        </div>
        {!allPass && <div className="col-span-2 md:col-span-4"><Field label="发现问题"><Input className="h-8 text-xs" onChange={(e) => setF({ ...f, problems: e.target.value })} placeholder="请描述整改要求" /></Field></div>}
        <div className="col-span-2 md:col-span-4"><Field label="验收意见"><Textarea className="text-xs" rows={2} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field></div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={busy} onClick={() => onSave(f)}>提交验收</Button>
        <span className={cn('text-xs', allPass ? 'text-emerald-600' : 'text-rose-500')}>{allPass ? '三项确认全部通过 → 验收通过，流程闭环' : '存在未确认项 → 提交后需整改复验'}</span>
      </div>
    </div>
  )
}
