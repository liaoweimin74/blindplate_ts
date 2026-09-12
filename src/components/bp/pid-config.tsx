'use client'
// PID 组态编辑器：内建图元（HG/T 20519 标准符号：设备/液体传输设备/阀门/仪表/管件）+ 基础图形（矩形/圆形/直线/椭圆/三角形）+ 自定义图元
// + 独立图元编辑器（跳转式视图：基础图形/已有图元组合构建自定义图元，保存后自动进入左侧「自定义」页签）
// + 拖拽移动/四角缩放 + 锚点连线（正交曼哈顿自动折弯）+ 隔离点标注 + 查看模式实时状态轮询 + 全屏/窗口切换
// 设计核心：连线只存锚点归属（fromShape/fromAnchor → toShape/toAnchor），折线路径在渲染时实时推导，拖拽/缩放后自动跟随
//            自定义图元实例内嵌部件快照（parts + designW/H），库删除不影响已放置实例的渲染
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, BadgeCheck, ChevronDown, Circle, Copy, Database, Expand, Factory, Fan, FileSignature,
  FlaskConical, History, Hourglass, ListChecks, MapPin, Maximize2, Minimize2, Minus, MonitorDot,
  MousePointer2, Map as MapIcon, Move, MoveDiagonal, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, Shapes, Sparkles, Spline, Square, Thermometer,
  TicketCheck, Trash2, Triangle, Wand2, Workflow, X as CloseIcon,
} from 'lucide-react'
import { ModuleProps, entryActionEventName } from '@/lib/bp-types'
import {
  STATUS_MAP, SCHEME_STATUS_MAP, TICKET_STATUS_MAP, TASK_STATUS_MAP, CONCLUSION_MAP, EQUIP_TYPE_MAP,
} from '@/lib/bp-types'
import { apiDelete, apiGet, apiPost, apiPut, fmtDateTime } from '@/lib/bp-api'
import { useToast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { setPortalContainer } from '@/components/ui/portal-container'
import { PidImportWizard } from '@/components/bp/pid-import'
import {
  StdSymbolShape, StdSymbolThumb, StdSymbolStyle,
  STD_SYMBOLS, STD_SYMBOL_MAP, STD_MAJOR_ORDER, STD_MAJOR_LABEL, STD_SUBGROUPS, STD_SUB_LABEL,
  type StdMajor, type StdSymbol,
} from '@/components/bp/std'
import { contentInsetBox } from '@/lib/bp-pid-layout'

// ============ 隔离点实时状态样式（与后端/演示数据一致，对外导出供大屏/看板复用） ============
export type IsoState = 'idle' | 'planned' | 'approved' | 'working' | 'blinded' | 'opened'

export const ISO_STATE_STYLE: Record<IsoState, {
  legend: string; fill: string; stroke: string; line: string; dot: string
  legendBg: string; badgeBg: string; badgeBorder: string; badgeFg: string; chip: string
}> = {
  idle:     { legend: '常通',        fill: '#f5f5f4', stroke: '#a8a29e', line: '#78716c', dot: '#a8a29e', legendBg: 'bg-stone-100',  badgeBg: 'bg-stone-50',   badgeBorder: 'border-stone-300',  badgeFg: 'text-stone-600',  chip: 'bg-stone-50 text-stone-600 border-stone-300' },
  planned:  { legend: '已计划',      fill: '#fef3c7', stroke: '#d97706', line: '#b45309', dot: '#f59e0b', legendBg: 'bg-amber-100',  badgeBg: 'bg-amber-50',   badgeBorder: 'border-amber-300',  badgeFg: 'text-amber-700',  chip: 'bg-amber-50 text-amber-700 border-amber-300' },
  approved: { legend: '已审核待执行', fill: '#ccfbf1', stroke: '#0d9488', line: '#0f766e', dot: '#14b8a6', legendBg: 'bg-teal-100',   badgeBg: 'bg-teal-50',    badgeBorder: 'border-teal-300',   badgeFg: 'text-teal-700',   chip: 'bg-teal-50 text-teal-700 border-teal-300' },
  working:  { legend: '作业执行中',   fill: '#fde68a', stroke: '#b45309', line: '#92400e', dot: '#d97706', legendBg: 'bg-amber-200',  badgeBg: 'bg-amber-100',  badgeBorder: 'border-amber-400',  badgeFg: 'text-amber-800',  chip: 'bg-amber-100 text-amber-800 border-amber-400' },
  blinded:  { legend: '盲板已装',    fill: '#fecdd3', stroke: '#e11d48', line: '#be123c', dot: '#f43f5e', legendBg: 'bg-rose-100',   badgeBg: 'bg-rose-50',    badgeBorder: 'border-rose-300',   badgeFg: 'text-rose-700',   chip: 'bg-rose-50 text-rose-700 border-rose-300' },
  opened:   { legend: '盲板已拆',    fill: '#d1fae5', stroke: '#059669', line: '#047857', dot: '#10b981', legendBg: 'bg-emerald-100', badgeBg: 'bg-emerald-50', badgeBorder: 'border-emerald-300', badgeFg: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
}

export const ISO_STATE_KEYS = ['idle', 'planned', 'approved', 'working', 'blinded', 'opened'] as const

// ============ 数据模型（content JSON，与后端/演示数据一致） ============
export interface PidShape {
  id: string
  type: 'exchanger' | 'reactor' | 'column' | 'pump' | 'tank' | 'valve'
    | 'rect' | 'circle' | 'ellipse' | 'line' | 'triangle' // 基础图形（用户自建图元）
    | 'symbol' // 自定义图元实例（来自图元编辑器）
    | 'std'    // 内建图元（五大分类符号库 std/ 查表渲染）
  x: number
  y: number
  w: number
  h: number
  label: string
  fill?: string   // 填充色（缺省 #fff；'transparent' 支持透明）
  stroke?: string // 描边色（缺省 stone-700）
  symbolId?: number      // 自定义图元库引用（实例溯源，库删除后实例仍可独立渲染）
  stdId?: string         // 标准图例符号 ID（STD_SYMBOL_MAP 查表；type='std' 时必填）
  equipmentId?: number | null // 绑定的设备主数据（保存图后自动回写关联管线起止设备）
  designW?: number       // 设计空间宽（parts 坐标系基准）
  designH?: number       // 设计空间高
  parts?: SymbolPart[]   // 组成部件快照（放置时固化，渲染时按 w/h 缩放）
  flip?: boolean         // 直线专用：false=包围盒\对角线（左上→右下），true=/对角线（左下→右上）；缺省 false 向后兼容旧数据
}

/** 自定义图元组成部件（图元编辑器设计空间坐标；type 复用 PidShape 类型，支持工艺图元与基础图形组合） */
export interface SymbolPart {
  id: string
  type: PidShape['type']
  x: number
  y: number
  w: number
  h: number
  label?: string
  fill?: string
  stroke?: string
  flip?: boolean // 直线部件方向（与 PidShape.flip 同语义）
}

export type Anchor = 'top' | 'right' | 'bottom' | 'left'

export type PidConnDirection = 'forward' | 'reverse' | 'none'

export interface PidConn {
  id: string
  fromShape: string
  fromAnchor: Anchor
  toShape: string
  toAnchor: Anchor
  direction?: PidConnDirection // 流向：forward 起点→终点（缺省）/ reverse 终点→起点 / none 无向
  pipelineId?: number | null   // 绑定的管线主数据（保存图后按连线起终点自动回写管线起止设备）
  labelT?: number              // 管线号标注沿折线的位置参数（0..1 归一化弧长，缺省 0.5 中点；拖动标注时写入，图元移动后按比例跟随）
  midOverride?: number         // 中段布线手动覆盖：H-H 路由的 midX / V-V 路由的 midY（拖拽中段写入；缺省自动取两端中点，改接端点后清零重排）
}

export interface PidMark {
  id: string
  masterPointId?: number
  code: string
  name?: string
  x: number
  y: number
}

export interface PidContent {
  shapes: PidShape[]
  connections: PidConn[]
  marks: PidMark[]
}

/** 连线端点描述（routeConnection 入参） */
export interface ConnEndpoint {
  x: number
  y: number
  anchor: Anchor
}

export interface RoutePoint {
  x: number
  y: number
}

type PidShapeType = PidShape['type']
type Selection = { kind: 'shape' | 'conn' | 'mark'; id: string }

// ============ API 契约类型 ============
/** 设备主数据选项（图元绑定设备下拉） */
interface EquipOption { id: number; code: string; name: string; type: string; unitName?: string | null }
/** 管线主数据选项（连线绑定管线下拉） */
interface PipeOption { id: number; code: string; name: string }

interface DiagramMeta {
  id: number
  name: string
  unitId: number | null
  unitName?: string | null
  shapeCount: number
  markCount: number
  connCount: number
  updatedAt: string
}

interface DiagramDetail {
  id: number
  name: string
  unitId: number | null
  unitName?: string | null
  content: unknown
}

interface UnitOpt {
  id: number
  code: string
  name: string
}

interface MasterPoint {
  id: number
  code: string
  name: string
  pipelineId?: number | null
  pipelineName?: string | null
  location?: string | null
  remark?: string | null
  refCount: number
}

/** 挂标所属管线变更确认（添加/移动终点位置自动计算与当前归属不一致时弹窗） */
interface PipeOwnershipPrompt {
  markId: string
  masterPointId: number
  code: string
  fromId: number | null
  fromLabel: string // 原所属管线号（null 归属时为「未关联」）
  toId: number
  toLabel: string // 计算所得管线号
  toName: string
  dist: number // 挂标与命中连线的距离（SVG 单位，取整）
}

interface StatusPoint {
  markId: string
  code: string
  name?: string | null
  masterPointId?: number | null
  state?: string
  stateLabel?: string | null
  requestId?: number | null
  requestCode?: string | null
  schemeId?: number | null
  schemeCode?: string | null
  ticketCode?: string | null
  blindCode?: string | null
}

interface StatusResp {
  points: StatusPoint[]
  generatedAt?: string
}

/** 点位作业全生命周期档案链（GET /api/point-dossier 返回） */
interface DossierChain {
  requestId: number
  requestCode: string
  title: string
  workType: string
  urgency: string
  status: string
  createdAt: string
  applicantName: string
  reason: string
  location: string
  medium?: string | null
  pressure?: string | null
  isoPoints: {
    id: number; seq: number; location: string; medium?: string | null; pressure?: string | null
    blindSpec: string; blindType: string; action: string; done: boolean
    doneAt?: string | null; operator?: string | null; code?: string | null; masterCode?: string | null
    blindPlateCode?: string | null
  }[]
  scheme: { id: number; code: string; status: string; preparedBy: string; preparedAt: string; reviewedBy?: string | null; reviewedAt?: string | null; comment?: string | null } | null
  disposal: {
    id: number; code: string; status: string; preparedBy: string
    steps: { seq: number; method: string; detail: string; standard?: string | null; completed: boolean; masterCode?: string | null }[]
    stepsTotal: number
    confirmation: { confirmer: string; confirmedAt: string; result: string; analysisQualified: boolean } | null
  } | null
  ticket: { code: string; status: string; plannedStart: string; plannedEnd: string; guardian: string; workers: string; issuer: string; startedAt?: string | null; finishedAt?: string | null; closedAt?: string | null } | null
  task: { code: string; status: string; assignee: string; actualStart?: string | null; actualEnd?: string | null } | null
  acceptance: { acceptor: string; acceptedAt: string; conclusion: string; problems?: string | null } | null
  finishedAt?: string | null
  active: boolean
}

interface PointDossierResp {
  point: { id: number; code: string; name: string; location?: string | null; pipelineId?: number | null } | null
  chains: DossierChain[]
  generatedAt?: string
}

// ============ 常量 ============
export const CANVAS_W = 1200
export const CANVAS_H = 700
export const STROKE = '#44403c' // stone-700 图元描边
export const LINE = '#78716c'   // stone-500 连线
export const TEAL = '#0d9488'   // 选中框/锚点
export const ROSE = '#e11d48'   // 隔离点标注/删除高亮
export const GRID_S = '#e7e5e4' // stone-200 小格
export const GRID_L = '#d6d3d1' // stone-300 粗格

/** 俯瞰图世界包围盒：画布区域 ∪ 当前视口 再加留白（无限画布下视口可能远离画布原点，包围盒需动态扩展） */
export function minimapBoundsOf(v: { x: number; y: number; w: number; h: number }) {
  const PAD = 120
  const minX = Math.min(0, v.x) - PAD
  const minY = Math.min(0, v.y) - PAD
  const maxX = Math.max(CANVAS_W, v.x + v.w) + PAD
  const maxY = Math.max(CANVAS_H, v.y + v.h) + PAD
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

const ANCHORS: Anchor[] = ['top', 'right', 'bottom', 'left']
const ANCHOR_LABEL: Record<Anchor, string> = { top: '顶部', right: '右侧', bottom: '底部', left: '左侧' }

const DISPOSAL_METHOD_LABEL: Record<string, string> = {
  VENT: '泄压降压', DRAIN: '排净', REPLACE: '置换', PURGE: '吹扫', STEAM: '蒸煮', GAS_TEST: '气体检测', ISOLATE: '切断加盲板', OTHER: '其他',
}
const WORK_TYPE_LABEL: Record<string, string> = { ADD: '装盲板', REMOVE: '抽盲板', BOTH: '抽装盲板' }

interface ShapeLibItem {
  type: PidShapeType
  label: string
  icon: LucideIcon | React.ComponentType<{ className?: string }>
  w: number
  h: number
  minW: number
  minH: number
  group: 'equip' | 'basic' | 'custom' // equip=旧设备图元（已从侧栏移除，仅保留定义供 libOf/旧图渲染/AI 导入/缩放下限）·基础图形（custom=自定义图元占位类型，侧栏单独渲染）
}

/** 椭圆图标（lucide 无专用 Ellipse，用内联 SVG 保证视觉一致） */
function EllipseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className}>
      <ellipse cx="12" cy="12" rx="9.5" ry="6.5" />
    </svg>
  )
}

const SHAPE_LIBRARY: ShapeLibItem[] = [
  { type: 'exchanger', label: '换热器', icon: Thermometer, w: 120, h: 70,  minW: 44, minH: 32, group: 'equip' },
  { type: 'reactor',   label: '反应器', icon: FlaskConical, w: 90,  h: 100, minW: 44, minH: 32, group: 'equip' },
  { type: 'column',    label: '精馏塔', icon: Factory,      w: 72,  h: 170, minW: 44, minH: 32, group: 'equip' },
  { type: 'pump',      label: '泵',     icon: Fan,          w: 72,  h: 60,  minW: 44, minH: 32, group: 'equip' },
  { type: 'tank',      label: '储罐',   icon: Database,     w: 110, h: 90,  minW: 44, minH: 32, group: 'equip' },
  { type: 'valve',     label: '阀门',   icon: Hourglass,    w: 64,  h: 32,  minW: 36, minH: 24, group: 'equip' },
  { type: 'rect',      label: '矩形',   icon: Square,       w: 120, h: 70,  minW: 16, minH: 16, group: 'basic' },
  { type: 'circle',    label: '圆形',   icon: Circle,       w: 64,  h: 64,  minW: 14, minH: 14, group: 'basic' },
  { type: 'ellipse',   label: '椭圆',   icon: EllipseIcon,  w: 110, h: 64,  minW: 18, minH: 12, group: 'basic' },
  { type: 'line',      label: '直线',   icon: Minus,        w: 140, h: 4,   minW: 12, minH: 2,  group: 'basic' },
  { type: 'triangle',  label: '三角形', icon: Triangle,     w: 80,  h: 70,  minW: 16, minH: 16, group: 'basic' },
  // 自定义图元实例占位条目（不进侧栏；供 libOf/typeLabel/缩放下限使用）
  { type: 'symbol',    label: '自定义图元', icon: Shapes,   w: 90,  h: 90,  minW: 24, minH: 24, group: 'custom' },
  // 标准图例符号占位条目（不进侧栏；侧栏由 STD_SYMBOLS 宫格渲染；供 libOf 兼容返回）
  { type: 'std',       label: '标准图例',   icon: Shapes,   w: 64,  h: 48,  minW: 24, minH: 20, group: 'custom' },
]

/** 预设色板（遵守项目配色约束：emerald/teal/amber/rose/violet/stone） */
export const FILL_PALETTE = ['#ffffff', 'transparent', '#d1fae5', '#ccfbf1', '#fef3c7', '#fecdd3', '#ede9fe', '#f5f5f4'] as const
export const STROKE_PALETTE = ['#44403c', '#78716c', '#059669', '#0d9488', '#d97706', '#e11d48', '#7c3aed', '#57534e'] as const

const EMPTY_CONTENT: PidContent = { shapes: [], connections: [], marks: [] }
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

// ============ 纯函数工具 ============
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

let uidSeq = 0
function uid(prefix: string): string {
  uidSeq += 1
  return `${prefix}_${Date.now().toString(36)}_${uidSeq.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

function parseContent(raw: unknown): PidContent {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return { ...EMPTY_CONTENT, shapes: [], connections: [], marks: [] }
    }
  }
  if (!obj || typeof obj !== 'object') return { shapes: [], connections: [], marks: [] }
  const o = obj as Partial<PidContent>
  return {
    shapes: Array.isArray(o.shapes) ? o.shapes : [],
    connections: Array.isArray(o.connections) ? o.connections : [],
    marks: Array.isArray(o.marks) ? o.marks : [],
  }
}

export function normalizeState(s?: string | null): IsoState {
  return s && (ISO_STATE_KEYS as readonly string[]).includes(s) ? (s as IsoState) : 'idle'
}

/** 点到线段最短距离（挂标所属管线自动计算用） */
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** 挂标「落在管线上」判定阈值：挂标中心到已绑定管线连线折线的最短距离 ≤ 该值（SVG 单位） */
export const MARK_PIPE_SNAP_DIST = 36

/** 折线总弧长（SVG 单位） */
function polylineLength(pts: [number, number][]): number {
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  return total
}

/** 按归一化弧长参数 t（0..1）取折线上一点；零长折线返回 null（管线号标注定位用） */
function pointAlongPolyline(pts: [number, number][], t: number): { x: number; y: number } | null {
  const total = polylineLength(pts)
  if (total <= 0) return null
  let target = Math.max(0, Math.min(1, t)) * total
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    if (target <= segLen || i === pts.length - 2) {
      const u = segLen === 0 ? 0 : target / segLen
      return { x: pts[i][0] + u * (pts[i + 1][0] - pts[i][0]), y: pts[i][1] + u * (pts[i + 1][1] - pts[i][1]) }
    }
    target -= segLen
  }
  return null
}

/** 点到折线的最近投影：返回该点的归一化弧长参数 t（0..1）与距离；零长折线返回 null（管线号沿线拖动用） */
function projectToPolyline(pts: [number, number][], px: number, py: number): { t: number; dist: number } | null {
  const total = polylineLength(pts)
  if (total <= 0) return null
  let acc = 0
  let best: { t: number; dist: number } | null = null
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
    const d = Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy))
    if (!best || d < best.dist) best = { t: (acc + u * Math.sqrt(len2)) / total, dist: d }
    acc += Math.sqrt(len2)
  }
  return best
}

/** 管线号标注位置参数上下限：距连线两端各留 6%（不盖住锚点与设备图元） */
export const LABEL_T_MIN = 0.06
export const LABEL_T_MAX = 0.94

/** 连线端点拖拽改接：指针距图元锚点 ≤ 该值（SVG 单位）时吸附为目标 */
export const CONN_END_SNAP_DIST = 48

/** 图元某锚点的绝对坐标：先内收到符号内容真实边界（消除留白悬空），再取四向中点：top=(x+w/2,y) right=(x+w,y+h/2) bottom=(x+w/2,y+h) left=(x,y+h/2) */
export function anchorPoint(s: PidShape, a: Anchor): RoutePoint {
  const b = contentInsetBox(s)
  switch (a) {
    case 'top':    return { x: b.x + b.w / 2, y: b.y }
    case 'bottom': return { x: b.x + b.w / 2, y: b.y + b.h }
    case 'left':   return { x: b.x,           y: b.y + b.h / 2 }
    case 'right':  return { x: b.x + b.w,     y: b.y + b.h / 2 }
  }
}

/** 锚点向外延伸 d 像素（自环绕行用） */
function outward(a: Anchor, p: RoutePoint, d: number): RoutePoint {
  switch (a) {
    case 'top':    return { x: p.x, y: p.y - d }
    case 'bottom': return { x: p.x, y: p.y + d }
    case 'left':   return { x: p.x - d, y: p.y }
    case 'right':  return { x: p.x + d, y: p.y }
  }
}

/**
 * 连线正交（曼哈顿）自动折弯路由：
 * - 双水平锚点（left/right）：取 midX 拐弯（midOverride 可手动覆盖中段竖线位置）
 * - 双垂直锚点（top/bottom）：取 midY 拐弯（midOverride 可手动覆盖中段横线位置）
 * - 混合：直角两段（无自由中段，忽略 midOverride）
 * - 同图元自环：两端锚点先向外延伸 24px 再绕行
 */
export function routeConnection(a: ConnEndpoint, b: ConnEndpoint, sameShape = false, midOverride?: number): [number, number][] {
  const A: RoutePoint = { x: a.x, y: a.y }
  const B: RoutePoint = { x: b.x, y: b.y }
  const aH = a.anchor === 'left' || a.anchor === 'right'
  const bH = b.anchor === 'left' || b.anchor === 'right'
  if (!sameShape) {
    if (aH && bH) {
      const midX = typeof midOverride === 'number' ? midOverride : (a.x + b.x) / 2
      return [[a.x, a.y], [midX, a.y], [midX, b.y], [b.x, b.y]]
    }
    if (!aH && !bH) {
      const midY = typeof midOverride === 'number' ? midOverride : (a.y + b.y) / 2
      return [[a.x, a.y], [a.x, midY], [b.x, midY], [b.x, b.y]]
    }
    if (aH) return [[a.x, a.y], [b.x, a.y], [b.x, b.y]]
    return [[a.x, a.y], [a.x, b.y], [b.x, b.y]]
  }
  const A2 = outward(a.anchor, A, 24)
  const B2 = outward(b.anchor, B, 24)
  let mid: RoutePoint[]
  if (aH && bH) {
    const midX = (A2.x + B2.x) / 2
    mid = [A2, { x: midX, y: A2.y }, { x: midX, y: B2.y }, B2]
  } else if (!aH && !bH) {
    const midY = (A2.y + B2.y) / 2
    mid = [A2, { x: A2.x, y: midY }, { x: B2.x, y: midY }, B2]
  } else if (aH) {
    mid = [A2, { x: A2.x, y: B2.y }, B2]
  } else {
    mid = [A2, { x: B2.x, y: A2.y }, B2]
  }
  return [[A.x, A.y], ...mid.map((p) => [p.x, p.y] as [number, number]), [B.x, B.y]]
}

export function shapeLabelY(s: PidShape): number {
  return s.y + s.h + (s.type === 'reactor' ? 22 : 16)
}

// ============ 自动布局（按连线拓扑分层排列，Task 57） ============
/** 自动布局列间距（SVG 单位）：为正交折线拐弯与管线号标注预留空间 */
const LAYOUT_GAP_X = 130
/** 自动布局行间距 */
const LAYOUT_GAP_Y = 64
/** 挂标跟随阈值：布局前挂标中心到最近连线折线的距离 ≤ 该值才视为挂在该管线上，布局后跟随重投影 */
const LAYOUT_MARK_FOLLOW_DIST = 260

/**
 * 自动布局（Sugiyama 简化版，纯函数不改组件状态）：
 * 1. 有连线图元按有效流向（缺省/forward=起点→终点，reverse 反向）DFS 最长路分层（遇环跳过回边），列内重心排序 4 轮扫掠减少连线交叉，自左向右排列；
 * 2. 未连线图元在流程区下方按阅读顺序（先上后下、先左后右）网格排列；
 * 3. 连线锚点按布局后两图元相对方位自动改选（水平占优→right/left，垂直占优→bottom/top），midOverride 清零交由自动折弯重排；
 * 4. 布局前挂在连线附近（≤ LAYOUT_MARK_FOLLOW_DIST）的标注记录「所在连线 + 弧长参数 t」，布局后重投影到该连线新路径的相同相对位置（管线位置语义不变）；
 * 5. 布局原点取当前图元包围盒左上角——整图在原视口邻域重排，不发生跳位。
 */
export function autoLayoutContent(ct: PidContent): PidContent {
  const shapes = ct.shapes
  if (shapes.length === 0) return ct
  const byId = new Map(shapes.map((s) => [s.id, s]))

  // ---- 有效流向边（自环与悬空端点忽略） ----
  const edges: { from: string; to: string }[] = []
  for (const c of ct.connections) {
    if (!byId.has(c.fromShape) || !byId.has(c.toShape) || c.fromShape === c.toShape) continue
    edges.push(c.direction === 'reverse' ? { from: c.toShape, to: c.fromShape } : { from: c.fromShape, to: c.toShape })
  }
  const linked = new Set<string>()
  const adj = new Map<string, string[]>() // 分层用去重邻接表
  for (const e of edges) {
    linked.add(e.from)
    linked.add(e.to)
    const list = adj.get(e.from) ?? []
    if (!list.includes(e.to)) list.push(e.to)
    adj.set(e.from, list)
  }

  const pos = new Map<string, { x: number; y: number }>()
  let flowLeft = 0
  let flowBottom = 0
  let hasFlow = false

  if (linked.size > 0) {
    // ---- 1. 破环：三色 DFS 收集回边（grey→grey），去回边后即为 DAG ----
    const backEdges = new Set<string>()
    const color = new Map<string, 0 | 1 | 2>() // 0 未访问 / 1 递归栈中 / 2 已完成
    const dfsMark = (u: string) => {
      color.set(u, 1)
      for (const v of adj.get(u) ?? []) {
        const c = color.get(v) ?? 0
        if (c === 1) backEdges.add(`${u}>${v}`)
        else if (c === 0) dfsMark(v)
      }
      color.set(u, 2)
    }
    for (const s of shapes) if (linked.has(s.id) && (color.get(s.id) ?? 0) === 0) dfsMark(s.id)

    // ---- 2. 分层：DAG 上自源点最长路（上游在最左，主流向自左向右可读） ----
    const dagIn = new Map<string, string[]>() // 节点 → DAG 上游父节点
    for (const e of edges) {
      if (backEdges.has(`${e.from}>${e.to}`)) continue
      const list = dagIn.get(e.to) ?? []
      list.push(e.from)
      dagIn.set(e.to, list)
    }
    const layerMemo = new Map<string, number>()
    const layerOf = (u: string): number => {
      const m = layerMemo.get(u)
      if (m != null) return m
      let v = 0
      for (const p of dagIn.get(u) ?? []) v = Math.max(v, layerOf(p) + 1)
      layerMemo.set(u, v)
      return v
    }
    const layer = new Map<string, number>()
    for (const s of shapes) if (linked.has(s.id)) layer.set(s.id, layerOf(s.id))

    // ---- 3. 分列（初序按原 y 保留上下意图）+ 重心排序 4 轮扫掠减少交叉 ----
    const layerMax = Math.max(...layer.values())
    const colIds: string[][] = Array.from({ length: layerMax + 1 }, () => [])
    for (const s of shapes) if (linked.has(s.id)) colIds[layer.get(s.id) ?? 0].push(s.id)
    for (const list of colIds) list.sort((a, b) => (byId.get(a)!.y - byId.get(b)!.y) || (byId.get(a)!.x - byId.get(b)!.x))
    const order = new Map<string, number>()
    colIds.forEach((list) => list.forEach((id, i) => order.set(id, i)))
    const upAdj = new Map<string, Set<string>>() // 邻接上一层（上游）
    const downAdj = new Map<string, Set<string>>() // 邻接下一层（下游）
    for (const e of edges) {
      const lu = layer.get(e.from)
      const lv = layer.get(e.to)
      if (lu == null || lv == null) continue
      if (lv === lu + 1) {
        if (!downAdj.has(e.from)) downAdj.set(e.from, new Set())
        downAdj.get(e.from)!.add(e.to)
        if (!upAdj.has(e.to)) upAdj.set(e.to, new Set())
        upAdj.get(e.to)!.add(e.from)
      } else if (lu === lv + 1) {
        if (!downAdj.has(e.to)) downAdj.set(e.to, new Set())
        downAdj.get(e.to)!.add(e.from)
        if (!upAdj.has(e.from)) upAdj.set(e.from, new Set())
        upAdj.get(e.from)!.add(e.to)
      }
    }
    const bary = (id: string, m: Map<string, Set<string>>): number => {
      const ns = m.get(id)
      if (!ns || ns.size === 0) return order.get(id) ?? 0
      let sum = 0
      for (const n of ns) sum += order.get(n) ?? 0
      return sum / ns.size
    }
    for (let sweep = 0; sweep < 4; sweep++) {
      if (sweep % 2 === 0) {
        for (let l = 1; l < colIds.length; l++) {
          colIds[l].sort((a, b) => bary(a, upAdj) - bary(b, upAdj))
          colIds[l].forEach((id, i) => order.set(id, i))
        }
      } else {
        for (let l = colIds.length - 2; l >= 0; l--) {
          colIds[l].sort((a, b) => bary(a, downAdj) - bary(b, downAdj))
          colIds[l].forEach((id, i) => order.set(id, i))
        }
      }
    }

    // ---- 4. 坐标：列 x 累积（列内水平居中），行 y 累积（各列相对最高列垂直居中） ----
    const colMaxW = colIds.map((list) => Math.max(...list.map((id) => byId.get(id)!.w)))
    const colX: number[] = []
    let acc = 0
    for (let l = 0; l < colIds.length; l++) {
      colX[l] = acc
      acc += colMaxW[l] + LAYOUT_GAP_X
    }
    const colH = colIds.map((list) => list.reduce((sum, id) => sum + byId.get(id)!.h, 0) + LAYOUT_GAP_Y * (list.length - 1))
    const colHMax = Math.max(...colH)
    colIds.forEach((list, l) => {
      let y = (colHMax - colH[l]) / 2
      for (const id of list) {
        const s = byId.get(id)!
        pos.set(id, { x: Math.round(colX[l] + (colMaxW[l] - s.w) / 2), y: Math.round(y) })
        y += s.h + LAYOUT_GAP_Y
      }
    })
    flowLeft = Math.min(...colX)
    flowBottom = colHMax
    hasFlow = true
  }

  // ---- 5. 未连线图元：流程区下方网格（阅读顺序：先上后下、先左后右） ----
  const isolated = shapes.filter((s) => !linked.has(s.id)).sort((a, b) => (a.y - b.y) || (a.x - b.x))
  if (isolated.length > 0) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(isolated.length)))
    const cellW = Math.max(...isolated.map((s) => s.w)) + 56
    const cellH = Math.max(...isolated.map((s) => s.h)) + 56
    const gridTop = hasFlow ? flowBottom + 96 : 0
    isolated.forEach((s, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      pos.set(s.id, {
        x: Math.round(c * cellW + (cellW - 56 - s.w) / 2),
        y: Math.round(gridTop + r * cellH),
      })
    })
  }

  // ---- 6. 平移到当前包围盒左上角（原视口邻域重排，不跳位） ----
  const minX = Math.min(...shapes.map((s) => s.x))
  const minY = Math.min(...shapes.map((s) => s.y))
  for (const p of pos.values()) {
    p.x += minX
    p.y += minY
  }

  // ---- 7. 连线锚点按布局后相对方位改选（自环保留原锚点） ----
  const newAnchors = new Map<string, [Anchor, Anchor]>()
  for (const c of ct.connections) {
    if (c.fromShape === c.toShape) continue
    const fs = byId.get(c.fromShape)
    const ts = byId.get(c.toShape)
    const fp = pos.get(c.fromShape)
    const tp = pos.get(c.toShape)
    if (!fs || !ts || !fp || !tp) continue
    const dx = tp.x + ts.w / 2 - (fp.x + fs.w / 2)
    const dy = tp.y + ts.h / 2 - (fp.y + fs.h / 2)
    newAnchors.set(
      c.id,
      Math.abs(dx) >= Math.abs(dy)
        ? dx >= 0 ? ['right', 'left'] : ['left', 'right']
        : dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'],
    )
  }

  /** 连线折线（useNew=false 布局前含 midOverride / true 布局后新锚点自动折弯） */
  const routeOf = (c: PidConn, useNew: boolean): [number, number][] | null => {
    const f = byId.get(c.fromShape)
    const t = byId.get(c.toShape)
    if (!f || !t) return null
    const fp = useNew ? pos.get(c.fromShape) : f
    const tp = useNew ? pos.get(c.toShape) : t
    if (!fp || !tp) return null
    const fa = useNew ? (newAnchors.get(c.id)?.[0] ?? c.fromAnchor) : c.fromAnchor
    const ta = useNew ? (newAnchors.get(c.id)?.[1] ?? c.toAnchor) : c.toAnchor
    const a = anchorPoint({ ...f, x: fp.x, y: fp.y }, fa)
    const b = anchorPoint({ ...t, x: tp.x, y: tp.y }, ta)
    return routeConnection(
      { x: a.x, y: a.y, anchor: fa },
      { x: b.x, y: b.y, anchor: ta },
      c.fromShape === c.toShape,
      useNew ? undefined : c.midOverride,
    )
  }

  // ---- 8. 挂标跟随：布局前找最近连线记录「所在连线+弧长参数 t」，布局后重投影到新路径同位（clamp 两端 4% 不压设备） ----
  const follow = new Map<string, { connId: string; t: number }>()
  if (ct.marks.length > 0 && ct.connections.length > 0) {
    for (const m of ct.marks) {
      let best: { connId: string; t: number; dist: number } | null = null
      for (const c of ct.connections) {
        const pts = routeOf(c, false)
        if (!pts) continue
        const proj = projectToPolyline(pts, m.x, m.y)
        if (proj && (!best || proj.dist < best.dist)) best = { connId: c.id, t: proj.t, dist: proj.dist }
      }
      if (best && best.dist <= LAYOUT_MARK_FOLLOW_DIST) follow.set(m.id, { connId: best.connId, t: best.t })
    }
  }

  const newConns: PidConn[] = ct.connections.map((c) => {
    const an = newAnchors.get(c.id)
    if (!an) return c.fromShape === c.toShape ? { ...c, midOverride: undefined } : c
    return { ...c, fromAnchor: an[0], toAnchor: an[1], midOverride: undefined }
  })

  const newMarks = ct.marks.map((m) => {
    const f = follow.get(m.id)
    if (!f) return m
    const c = newConns.find((cc) => cc.id === f.connId)
    const pts = c ? routeOf(c, true) : null
    const pt = pts ? pointAlongPolyline(pts, clamp(f.t, 0.04, 0.96)) : null
    return pt ? { ...m, x: Math.round(pt.x), y: Math.round(pt.y) } : m
  })

  const newShapes = shapes.map((s) => {
    const p = pos.get(s.id)
    return p ? { ...s, x: p.x, y: p.y } : s
  })
  return { shapes: newShapes, connections: newConns, marks: newMarks }
}

function libOf(t: PidShapeType): ShapeLibItem {
  return SHAPE_LIBRARY.find((i) => i.type === t) ?? SHAPE_LIBRARY[0]
}

/** 图元类型中文标签（基础图形也归入，供属性面板类型徽章显示） */
function typeLabel(t: PidShapeType): string {
  return libOf(t).label
}

/** 图元库手风琴分类节：点击标题向下展开 / 向上折叠（内容 3 列宫格，展开带下滑淡入动画）
 *  stack=true 时内容不宫格化（大分类节内嵌子分类节用）；nested=true 时子分类缩进+左侧虚线标识层级 */
function LibSection({ label, count, open, onToggle, stack, nested, children }: {
  label: string; count: number; open: boolean; onToggle: () => void
  stack?: boolean; nested?: boolean; children: React.ReactNode
}) {
  return (
    <section className={cn('mb-1', nested && 'ml-2.5 border-l border-dashed border-stone-200 pl-1.5')}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`展开或折叠分类：${label}`}
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-1 rounded-md font-medium transition-colors',
          nested ? 'px-1 py-1 text-[10px]' : 'px-1.5 py-1.5 text-[11px]',
          open ? 'text-teal-800' : 'text-stone-500 hover:bg-stone-50',
        )}
      >
        <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform duration-200', !open && '-rotate-90')} />
        <span className="truncate">{label}</span>
        <span className="ml-auto shrink-0 rounded-full bg-stone-100 px-1.5 text-[10px] font-normal text-stone-400">{count}</span>
      </button>
      {open && (
        <div className={stack ? 'lib-expand px-0.5 pb-1.5' : 'lib-expand grid grid-cols-3 gap-1.5 px-0.5 pb-1.5'}>{children}</div>
      )}
    </section>
  )
}

/** 内建图元宫格单元：缩略图+名称；悬停信息由父级 onEnter 写入 libHover，点击进入放置模式 */
function StdLibCell({ sym, active, onPick, onEnter, onLeave }: {
  sym: StdSymbol; active: boolean; onPick: () => void
  onEnter: (e: React.MouseEvent<HTMLDivElement>) => void; onLeave: () => void
}) {
  return (
    <div
      className={cn(
        'rounded-md border p-1 transition-colors',
        active ? 'border-teal-400 bg-teal-50' : 'border-stone-200 hover:border-teal-300 hover:bg-stone-50',
      )}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        aria-label={`放置${sym.label}`}
        onClick={onPick}
        className="flex h-14 w-full items-center justify-center"
      >
        <StdSymbolThumb id={sym.id} className="h-12 w-full" />
      </button>
      <div className="truncate px-0.5 pb-0.5 text-center text-[10px] leading-tight text-stone-500">{sym.label}</div>
    </div>
  )
}

// ============ 图元绘制（工艺图元 + 基础图形；fill/stroke 可由属性面板自定义） ============
export function ShapeBody({ s }: { s: PidShape }) {
  const { x, y, w, h } = s
  const stroke = s.stroke || STROKE
  const fill = s.fill || '#fff'
  switch (s.type) {
    case 'exchanger':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={3} fill={fill} stroke={stroke} strokeWidth={1.6} />
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.max(6, Math.min(w, h) / 2 - 9)} fill="none" stroke={stroke} strokeWidth={1.4} />
        </g>
      )
    case 'reactor': {
      const r = Math.min(10, h / 4)
      const d = `M ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h} L ${x} ${y + h} Z`
      return (
        <g>
          <path d={d} fill={fill} stroke={stroke} strokeWidth={1.6} />
          <line x1={x + 6} y1={y + h} x2={x + 6} y2={y + h + 6} stroke={stroke} strokeWidth={1.6} />
          <line x1={x + w - 6} y1={y + h} x2={x + w - 6} y2={y + h + 6} stroke={stroke} strokeWidth={1.6} />
        </g>
      )
    }
    case 'column':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={Math.min(12, w / 3)} fill={fill} stroke={stroke} strokeWidth={1.6} />
          {[1, 2, 3].map((i) => (
            <line key={i} x1={x + 6} y1={y + (h * i) / 4} x2={x + w - 6} y2={y + (h * i) / 4} stroke={stroke} strokeWidth={1.2} />
          ))}
        </g>
      )
    case 'pump': {
      const cx = x + w / 2
      const cy = y + h / 2 - 3
      const r = Math.max(8, Math.min(w / 2, (h - 8) / 2) - 2)
      const r0 = r * 0.72
      return (
        <g>
          <line x1={x + 6} y1={y + h - 1} x2={x + w - 6} y2={y + h - 1} stroke={stroke} strokeWidth={1.6} />
          <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={1.6} />
          <polygon
            points={`${cx},${cy - r0} ${cx - r0 * 0.866},${cy + r0 / 2} ${cx + r0 * 0.866},${cy + r0 / 2}`}
            fill="none" stroke={stroke} strokeWidth={1.4}
          />
        </g>
      )
    }
    case 'tank':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={1.6} />
          <ellipse cx={x + w / 2} cy={y} rx={w / 2} ry={7} fill={fill} stroke={stroke} strokeWidth={1.6} />
        </g>
      )
    case 'valve': {
      const cx = x + w / 2
      const cy = y + h / 2
      return (
        <g>
          <polygon points={`${x},${y} ${cx},${cy} ${x},${y + h}`} fill={fill} stroke={stroke} strokeWidth={1.6} />
          <polygon points={`${x + w},${y} ${cx},${cy} ${x + w},${y + h}`} fill={fill} stroke={stroke} strokeWidth={1.6} />
          <line x1={cx} y1={cy} x2={cx} y2={y} stroke={stroke} strokeWidth={1.6} />
        </g>
      )
    }
    // ---- 基础图形（用户自建图元） ----
    case 'rect':
      return (
        <rect x={x} y={y} width={w} height={h} rx={2} fill={fill} stroke={stroke} strokeWidth={1.6} />
      )
    case 'circle':
    case 'ellipse':
      return (
        <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={1.6} />
      )
    case 'line': {
      // 直线 = 包围盒对角线，flip 决定对角方向（支持 \ 与 / 双向，橡皮筋拖拽绘制任意角度）；透明粗垫片保证细线可点选/可拖拽
      const ly1 = s.flip ? y + h : y
      const ly2 = s.flip ? y : y + h
      return (
        <g>
          <line x1={x} y1={ly1} x2={x + w} y2={ly2} stroke="transparent" strokeWidth={12} />
          <line x1={x} y1={ly1} x2={x + w} y2={ly2} stroke={stroke} strokeWidth={1.6} strokeLinecap="round" />
        </g>
      )
    }
    case 'triangle':
      return (
        <polygon points={`${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`} fill={fill} stroke={stroke} strokeWidth={1.6} />
      )
    case 'std':
      // 标准图例符号：设计空间 → 包围盒缩放（HG/T 20519，符号表见 pid-symbols.tsx）
      return <StdSymbolShape id={s.stdId} x={x} y={y} w={w} h={h} stroke={stroke} fill={fill} />
    case 'symbol': {
      // 自定义图元实例：组成部件按设计空间 → 实例包围盒缩放渲染（快照内嵌，不依赖图元库在位）
      const dw = s.designW && s.designW > 0 ? s.designW : 100
      const dh = s.designH && s.designH > 0 ? s.designH : 100
      return (
        <g transform={`translate(${x} ${y}) scale(${w / dw} ${h / dh})`}>
          {(s.parts ?? []).map((p) => (
            <ShapeBody key={p.id} s={{ ...p, label: p.label ?? '' }} />
          ))}
        </g>
      )
    }
  }
}

/** 隔离点标注：编辑态 rose 菱形 + code；查看态按实时状态着色 + stateLabel chip（svg text + 双层 rect 底色） */
export function MarkGlyph({ m, edit, state, stateLabel }: { m: PidMark; edit: boolean; state: IsoState; stateLabel: string }) {
  const d = 7
  const diamond = `${m.x},${m.y - d} ${m.x + d},${m.y} ${m.x},${m.y + d} ${m.x - d},${m.y}`
  if (edit) {
    return (
      <g>
        {/* 透明命中垫片：菱形过小难以点中，用大号透明圆捕获指针便于拖拽/选中 */}
        <circle cx={m.x} cy={m.y} r={14} fill="transparent" />
        <polygon points={diamond} fill="#f43f5e" stroke="#fff" strokeWidth={1.4} />
        <text x={m.x} y={m.y + 20} textAnchor="middle" fontSize={11} fill="#44403c" stroke="#fff" strokeWidth={3} paintOrder="stroke">
          {m.code}
        </text>
      </g>
    )
  }
  const style = ISO_STATE_STYLE[state]
  const label = stateLabel || style.legend
  const chipW = label.length * 10.5 + 12
  return (
    <g>
      <polygon points={diamond} fill={style.fill} stroke={style.stroke} strokeWidth={1.6} />
      <rect x={m.x - chipW / 2} y={m.y + 11} width={chipW} height={16} rx={3} fill={style.fill} stroke={style.stroke} strokeWidth={0.8} />
      <text x={m.x} y={m.y + 22.5} textAnchor="middle" fontSize={10} fill={style.line}>{label}</text>
      <text x={m.x} y={m.y + 40} textAnchor="middle" fontSize={10.5} fill="#78716c" stroke="#fff" strokeWidth={3} paintOrder="stroke">
        {m.code}
      </text>
    </g>
  )
}

/** 属性面板数值微调输入 */
function NumField({ label, value, min, max, onChange, onBlur }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  onBlur?: () => void // 编辑结束时触发（挂标 XY 修改后重算所属管线）
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-stone-500">{label}</Label>
      <Input
        type="number" className="h-8" value={value} min={min} max={max} onBlur={onBlur}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onChange(clamp(Math.round(n), min, max))
        }}
      />
    </div>
  )
}

/** 属性面板预设色板（点选设色；透明项用棋盘格底纹表示） */
function ColorSwatches({ label, palette, value, onChange }: {
  label: string
  palette: readonly string[]
  value: string
  onChange: (c: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px] text-stone-500">{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {palette.map((c) => (
          <button
            key={c} type="button" title={c === 'transparent' ? '透明' : c}
            aria-label={`${label} ${c === 'transparent' ? '透明' : c}`}
            onClick={() => onChange(c)}
            className={cn(
              'h-6 w-6 rounded border border-stone-300 transition-transform hover:scale-110',
              value === c && 'ring-2 ring-teal-500 ring-offset-1',
            )}
            style={{
              background: c === 'transparent'
                ? 'repeating-conic-gradient(#d6d3d1 0% 25%, #ffffff 0% 50%) 50% / 8px 8px'
                : c,
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ============ 自定义图元库（独立图元编辑界面 + 左侧「自定义」页签联动） ============

/** 自定义图元库行（GET /api/pid-symbols 返回，parts 已解析） */
export interface SymbolRow {
  id: number
  name: string
  basedOn?: string | null
  designW: number
  designH: number
  parts: SymbolPart[]
}

/** 图元编辑器上下文（跳转入口携带：新建/编辑/以某图元为基础） */
export interface SymbolEditorCtx {
  mode: 'create' | 'edit'
  symbolId?: number
  name?: string
  basedOn?: string
  parts?: SymbolPart[]
}

const EDITOR_SIZE = 200                                   // 图元设计空间边长
const EDITOR_PALETTE: PidShapeType[] = ['rect', 'circle', 'ellipse', 'line', 'triangle']

/** 放置到组态画布时的默认实例尺寸：设计空间等比缩放到最大边 90px */
function symbolInstanceSize(designW: number, designH: number): { w: number; h: number } {
  const dw = designW > 0 ? designW : 100
  const dh = designH > 0 ? designH : 100
  const k = 90 / Math.max(dw, dh)
  return { w: Math.max(24, Math.round(dw * k)), h: Math.max(24, Math.round(dh * k)) }
}

/** 保存前裁剪：把部件平移到包围盒左上角为原点，designW/H 取包围盒尺寸（去除边缘空白） */
function normalizeSymbolParts(parts: SymbolPart[]): { parts: SymbolPart[]; designW: number; designH: number } {
  const minX = Math.min(...parts.map((p) => p.x))
  const minY = Math.min(...parts.map((p) => p.y))
  const maxX = Math.max(...parts.map((p) => p.x + p.w))
  const maxY = Math.max(...parts.map((p) => p.y + p.h))
  return {
    parts: parts.map((p) => ({ ...p, x: Math.round(p.x - minX), y: Math.round(p.y - minY) })),
    designW: Math.max(20, Math.round(maxX - minX)),
    designH: Math.max(20, Math.round(maxY - minY)),
  }
}

/** 自定义图元缩略图：按部件包围盒自适应 viewBox 的小型预览（图元库列表/部件列表复用） */
export function SymbolThumb({ parts, className }: { parts: SymbolPart[]; className?: string }) {
  if (parts.length === 0) {
    return <Shapes className={cn('h-4 w-4 shrink-0 text-stone-300', className)} />
  }
  const minX = Math.min(...parts.map((p) => p.x))
  const minY = Math.min(...parts.map((p) => p.y))
  const maxX = Math.max(...parts.map((p) => p.x + p.w))
  const maxY = Math.max(...parts.map((p) => p.y + p.h))
  const pad = 4
  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${Math.max(1, maxX - minX + pad * 2)} ${Math.max(1, maxY - minY + pad * 2)}`}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      {parts.map((p) => (
        <ShapeBody key={p.id} s={{ ...p, label: p.label ?? '' }} />
      ))}
    </svg>
  )
}

// ============ 点位作业档案抽屉（盲板状态页点击挂标） ============

/** 时间线行：左侧图标圆点 + 竖向连接线，右侧环节内容 */
function TimelineRow({ icon: Icon, colorCls, title, isLast, children }: {
  icon: LucideIcon
  colorCls: string
  title: string
  isLast: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative flex gap-2.5 pb-3 last:pb-0">
      <div className="relative flex flex-col items-center">
        <div className={cn('z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-white', colorCls)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        {!isLast && <div className="absolute bottom-0 top-6 w-px bg-stone-200" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-stone-700">{title}</div>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  )
}

/** 单条作业链卡片：链头（需求）+ 全生命周期竖向时间线（方案→处置→确认→票→任务→验收） */
function DossierChainCard({ chain }: { chain: DossierChain }) {
  const schemeRows: React.ReactNode[] = []
  if (chain.scheme) {
    schemeRows.push(
      <div key="meta" className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn('border', SCHEME_STATUS_MAP[chain.scheme.status]?.className)}>
          {SCHEME_STATUS_MAP[chain.scheme.status]?.label ?? chain.scheme.status}
        </Badge>
        <span className="text-[11px] text-stone-400">编制 {chain.scheme.preparedBy} · {fmtDateTime(chain.scheme.preparedAt)}</span>
      </div>,
    )
    if (chain.scheme.reviewedBy) {
      schemeRows.push(
        <div key="review" className="text-[11px] text-stone-500">
          审核：{chain.scheme.reviewedBy}
          {chain.scheme.reviewedAt ? ` · ${fmtDateTime(chain.scheme.reviewedAt)}` : ''}
          {chain.scheme.comment ? ` · “${chain.scheme.comment}”` : ''}
        </div>,
      )
    }
    schemeRows.push(
      ...chain.isoPoints.map((p) => (
        <div key={p.id} className="rounded-md border bg-stone-50 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn('border', p.action === 'ADD' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}
            >
              {p.action === 'ADD' ? '加装盲板' : '拆除盲板'}
            </Badge>
            <span className="text-xs font-medium text-stone-700">{p.location}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-stone-500">
            <span>盲板：{p.blindSpec} {p.blindType}</span>
            {p.medium && <span>介质：{p.medium}</span>}
            {p.pressure && <span>压力：{p.pressure}</span>}
            {p.blindPlateCode && <span className="font-mono">板号：{p.blindPlateCode}</span>}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
            {p.done ? (
              <>
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">已执行</span>
                <span className="text-stone-500">{p.operator}{p.doneAt ? ` · ${fmtDateTime(p.doneAt)}` : ''}</span>
              </>
            ) : (
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">待执行</span>
            )}
          </div>
        </div>
      )),
    )
  }

  const disposalNode = chain.disposal && (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn('border', SCHEME_STATUS_MAP[chain.disposal.status]?.className)}>
          {SCHEME_STATUS_MAP[chain.disposal.status]?.label ?? chain.disposal.status}
        </Badge>
        {chain.disposal.stepsTotal > 0 && (
          <span className="text-[11px] text-stone-400">
            共 {chain.disposal.stepsTotal} 步{chain.disposal.steps.length ? `，其中 ${chain.disposal.steps.length} 步涉及本点位` : ''}
          </span>
        )}
      </div>
      {chain.disposal.steps.map((s) => (
        <div key={s.seq} className="rounded-md bg-stone-50 px-2.5 py-1.5 text-[11px] leading-relaxed">
          <span className={cn(
            'mr-1.5 inline-flex items-center rounded px-1.5 py-0.5 font-medium',
            s.completed ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-200 text-stone-600',
          )}>
            {s.completed ? '已完成' : '未完成'}
          </span>
          <span className="font-medium text-stone-700">{DISPOSAL_METHOD_LABEL[s.method] ?? s.method}</span>
          <span className="ml-1.5 text-stone-600">{s.detail}</span>
        </div>
      ))}
      {chain.disposal.confirmation && (
        <div className="rounded-md border border-teal-100 bg-teal-50/60 px-2.5 py-1.5 text-[11px] text-teal-800">
          处置确认：{chain.disposal.confirmation.confirmer} · {fmtDateTime(chain.disposal.confirmation.confirmedAt)}
          {' · '}{chain.disposal.confirmation.result === 'QUALIFIED' ? '分析合格' : '不合格'}
        </div>
      )}
    </div>
  )

  const ticket = chain.ticket
  const task = chain.task
  const acceptance = chain.acceptance

  const rows: { icon: LucideIcon; colorCls: string; title: string; node: React.ReactNode }[] = []
  if (chain.scheme) rows.push({ icon: FileSignature, colorCls: 'border-emerald-200 text-emerald-600', title: `隔离方案 ${chain.scheme.code}`, node: <div className="space-y-1.5">{schemeRows}</div> })
  if (chain.disposal) rows.push({ icon: FlaskConical, colorCls: 'border-teal-200 text-teal-600', title: `工艺处置方案 ${chain.disposal.code}`, node: disposalNode })
  if (ticket) rows.push({
    icon: TicketCheck, colorCls: 'border-violet-200 text-violet-600', title: `安全作业票 ${ticket.code}`,
    node: (
      <div className="space-y-1 text-[11px] text-stone-500">
        <Badge variant="outline" className={cn('border', TICKET_STATUS_MAP[ticket.status]?.className)}>
          {TICKET_STATUS_MAP[ticket.status]?.label ?? ticket.status}
        </Badge>
        <div>计划 {fmtDateTime(ticket.plannedStart)} ~ {fmtDateTime(ticket.plannedEnd)}</div>
        <div>监护人：{ticket.guardian} · 作业人员：{ticket.workers}</div>
        {ticket.startedAt && <div>实际开工：{fmtDateTime(ticket.startedAt)}</div>}
        {ticket.finishedAt && <div className="font-medium text-teal-700">完工：{fmtDateTime(ticket.finishedAt)}</div>}
      </div>
    ),
  })
  if (task) rows.push({
    icon: ListChecks, colorCls: 'border-amber-200 text-amber-600', title: `作业任务 ${task.code}`,
    node: (
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
        <Badge variant="outline" className={cn('border', TASK_STATUS_MAP[task.status]?.className)}>
          {TASK_STATUS_MAP[task.status]?.label ?? task.status}
        </Badge>
        <span>负责人：{task.assignee}</span>
        {task.actualStart && <span>开工 {fmtDateTime(task.actualStart)}</span>}
        {task.actualEnd && <span>完工 {fmtDateTime(task.actualEnd)}</span>}
      </div>
    ),
  })
  if (acceptance) rows.push({
    icon: BadgeCheck, colorCls: 'border-emerald-200 text-emerald-600', title: '作业验收',
    node: (
      <div className="space-y-1 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn('border', CONCLUSION_MAP[acceptance.conclusion]?.className)}>
            {CONCLUSION_MAP[acceptance.conclusion]?.label ?? acceptance.conclusion}
          </Badge>
          <span className="text-stone-500">{acceptance.acceptor} · {fmtDateTime(acceptance.acceptedAt)}</span>
        </div>
        {acceptance.problems && <div className="text-stone-500">问题：{acceptance.problems}</div>}
      </div>
    ),
  })

  return (
    <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="border-b bg-stone-50/70 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('border font-medium', STATUS_MAP[chain.status]?.className)}>
              {STATUS_MAP[chain.status]?.label ?? chain.status}
            </Badge>
            <span className="font-mono text-xs font-medium text-stone-700">{chain.requestCode}</span>
          </div>
          <span className="text-[11px] text-stone-400">{fmtDateTime(chain.createdAt)}</span>
        </div>
        <div className="mt-1 text-xs font-medium text-stone-700">{chain.title}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-stone-500">
          <span>{WORK_TYPE_LABEL[chain.workType] ?? chain.workType}</span>
          {chain.location && <span>位置：{chain.location}</span>}
          <span>申请人：{chain.applicantName}</span>
        </div>
      </div>
      <div className="px-3 py-3">
        {rows.length === 0 ? (
          <div className="py-2 text-center text-[11px] text-stone-400">该作业链尚无后续单据（方案/票证等环节未到达）</div>
        ) : (
          rows.map((r, i) => (
            <TimelineRow key={r.title} icon={r.icon} colorCls={r.colorCls} title={r.title} isLast={i === rows.length - 1}>
              {r.node}
            </TimelineRow>
          ))
        )}
      </div>
    </div>
  )
}

// ============ 独立图元编辑界面（跳转式全替换视图：保存后图元自动进入左侧「自定义」页签） ============
function SymbolEditor({ ctx, currentUser, onClose, onSaved }: {
  ctx: SymbolEditorCtx
  currentUser: { id: string; name: string }
  onClose: () => void
  onSaved: (name: string, mode: 'create' | 'edit') => void
}) {
  const { toast } = useToast()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [name, setName] = useState(ctx.name ?? '')
  const [parts, setParts] = useState<SymbolPart[]>(ctx.parts ? ctx.parts.map((p) => ({ ...p })) : [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placing, setPlacing] = useState<PidShapeType | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState<RoutePoint | null>(null)
  // 直线橡皮筋绘制（与主画布交互一致）：按下定起点 → 拖动实时改角度 → 抬起定终点
  const [lineDraft, setLineDraft] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null)
  const lineDraftRef = useRef<{ sx: number; sy: number; ex: number; ey: number } | null>(null)
  const lineEndAtRef = useRef(0) // 吞掉紧随 pointerup 的 click，防误清新建部件选中态
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmBack, setConfirmBack] = useState(false)

  const selected = parts.find((p) => p.id === selectedId) ?? null

  const mutateParts = (fn: (prev: SymbolPart[]) => SymbolPart[]) => {
    setParts((prev) => fn(prev))
    setDirty(true)
  }

  const toEditorPoint = (e: { clientX: number; clientY: number }): RoutePoint | null => {
    const svg = svgRef.current
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return {
      x: ((e.clientX - r.left) * EDITOR_SIZE) / r.width,
      y: ((e.clientY - r.top) * EDITOR_SIZE) / r.height,
    }
  }

  const addPartAt = (type: PidShapeType, p: RoutePoint) => {
    const lib = libOf(type)
    const w = Math.min(lib.w, EDITOR_SIZE - 8)
    const h = Math.min(lib.h, EDITOR_SIZE - 8)
    const part: SymbolPart = {
      id: uid('p'), type,
      x: Math.round(clamp(p.x - w / 2, 0, EDITOR_SIZE - w)),
      y: Math.round(clamp(p.y - h / 2, 0, EDITOR_SIZE - h)),
      w, h, label: '',
    }
    mutateParts((prev) => [...prev, part])
    setSelectedId(part.id)
    setPlacing(null)
  }

  /** 直线部件创建（橡皮筋抬起落笔）：flip 按拖拽方向推导（/ 与 \ 双向） */
  const addLinePart = (sx: number, sy: number, ex: number, ey: number) => {
    const lib = libOf('line')
    const pid = uid('p')
    mutateParts((prev) => [
      ...prev,
      {
        id: pid,
        type: 'line',
        x: Math.round(Math.min(sx, ex)),
        y: Math.round(Math.min(sy, ey)),
        w: Math.max(lib.minW, Math.round(Math.abs(ex - sx))),
        h: Math.max(lib.minH, Math.round(Math.abs(ey - sy))),
        flip: (ex >= sx) !== (ey >= sy),
        label: '',
      },
    ])
    setSelectedId(pid)
    setPlacing(null)
  }

  const updatePart = (id: string, patch: Partial<SymbolPart>) =>
    mutateParts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const deletePart = (id: string) => {
    mutateParts((prev) => prev.filter((p) => p.id !== id))
    setSelectedId((prev) => (prev === id ? null : prev))
  }
  const deletePartRef = useRef(deletePart)
  deletePartRef.current = deletePart

  /** 部件层级：数组顺序即渲染叠放顺序（越靠后越在上层），上/下移一层交换相邻位置 */
  const moveLayer = (id: string, dir: -1 | 1) => {
    mutateParts((prev) => {
      const i = prev.findIndex((p) => p.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // ---- 部件拖拽移动（放置态时让位给画布橡皮筋绘制） ----
  const startDrag = (e: React.PointerEvent<SVGElement>, p0: SymbolPart) => {
    if (placing) return
    e.stopPropagation()
    const start = toEditorPoint(e)
    if (!start) return
    const offX = start.x - p0.x
    const offY = start.y - p0.y
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const q = toEditorPoint(ev)
      if (!q) return
      moved = true
      const nx = Math.round(clamp(q.x - offX, 0, EDITOR_SIZE - p0.w))
      const ny = Math.round(clamp(q.y - offY, 0, EDITOR_SIZE - p0.h))
      setParts((prev) => prev.map((pp) => (pp.id === p0.id ? { ...pp, x: nx, y: ny } : pp)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) setDirty(true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- 部件四角缩放（放置态时让位；对角为固定点；圆形锁定正圆比例；直线可翻转向） ----
  const startResize = (e: React.PointerEvent<SVGElement>, p0: SymbolPart, handle: ResizeHandle) => {
    if (placing) return
    e.stopPropagation()
    e.preventDefault()
    const lib = libOf(p0.type)
    const minW = lib.minW
    const minH = lib.minH
    const fx = handle === 'nw' || handle === 'sw' ? p0.x + p0.w : p0.x
    const fy = handle === 'nw' || handle === 'ne' ? p0.y + p0.h : p0.y
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const raw = toEditorPoint(ev)
      if (!raw) return
      moved = true
      const px = clamp(raw.x, 0, EDITOR_SIZE)
      const py = clamp(raw.y, 0, EDITOR_SIZE)
      let x1 = Math.min(fx, px)
      let x2 = Math.max(fx, px)
      let y1 = Math.min(fy, py)
      let y2 = Math.max(fy, py)
      if (x2 - x1 < minW) {
        if (px < fx) x1 = x2 - minW
        else x2 = x1 + minW
      }
      if (y2 - y1 < minH) {
        if (py < fy) y1 = y2 - minH
        else y2 = y1 + minH
      }
      if (p0.type === 'circle') {
        const size = Math.max(x2 - x1, y2 - y1)
        if (px >= fx) x2 = x1 + size
        else x1 = x2 - size
        if (py >= fy) y2 = y1 + size
        else y1 = y2 - size
      }
      x1 = Math.max(0, x1)
      y1 = Math.max(0, y1)
      x2 = Math.min(EDITOR_SIZE, x2)
      y2 = Math.min(EDITOR_SIZE, y2)
      const w = Math.max(minW, Math.round(x2 - x1))
      const h = Math.max(minH, Math.round(y2 - y1))
      setParts((prev) => prev.map((pp) => (
        pp.id === p0.id
          ? { ...pp, x: Math.round(x1), y: Math.round(y1), w, h, ...(p0.type === 'line' ? { flip: (px >= fx) !== (py >= fy) } : null) }
          : pp
      )))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) setDirty(true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- 编辑器快捷键：Delete 删除部件 / Esc 取消放置·选中（画布快捷键已让位，见主组件 guard） ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') {
        if (lineDraftRef.current) {
          lineDraftRef.current = null
          setLineDraft(null)
        } else if (placing) setPlacing(null)
        else setSelectedId(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedId) return
        e.preventDefault()
        deletePartRef.current(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing, selectedId])

  // ---- 直线橡皮筋绘制（编辑器内与主画布同交互） ----
  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (placing !== 'line') return
    const p = toEditorPoint(e)
    if (!p) return
    e.preventDefault()
    const sx = clamp(p.x, 0, EDITOR_SIZE)
    const sy = clamp(p.y, 0, EDITOR_SIZE)
    const setDraft = (d: { sx: number; sy: number; ex: number; ey: number } | null) => {
      lineDraftRef.current = d
      setLineDraft(d)
    }
    setDraft({ sx, sy, ex: sx, ey: sy })
    const onMove = (ev: PointerEvent) => {
      const q = toEditorPoint(ev)
      if (!q) return
      setDraft({ sx, sy, ex: clamp(q.x, 0, EDITOR_SIZE), ey: clamp(q.y, 0, EDITOR_SIZE) })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const d = lineDraftRef.current
      setDraft(null)
      lineEndAtRef.current = Date.now()
      if (!d) return
      // 编辑器画布小，阈值 4 设计单位；微距点击不落笔，直线工具保持激活
      if (Math.max(Math.abs(d.ex - d.sx), Math.abs(d.ey - d.sy)) < 4) return
      addLinePart(d.sx, d.sy, d.ex, d.ey)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleCanvasClick = (e: React.MouseEvent<SVGElement>) => {
    // 直线走 pointer 橡皮筋流程；刚结束绘制时吞掉紧随其后的 click（防误清新建部件选中态）
    if (placing === 'line' || Date.now() - lineEndAtRef.current < 350) return
    const p = toEditorPoint(e)
    if (placing) {
      if (p) addPartAt(placing, p)
      return
    }
    setSelectedId(null)
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!placing) {
      if (mousePos !== null) setMousePos(null)
      return
    }
    setMousePos(toEditorPoint(e))
  }

  // ---- 保存：裁剪包围盒 → POST/PUT → 父组件刷新图元库（自动出现在左侧「自定义」页签） ----
  const handleSave = async () => {
    const nm = name.trim()
    if (!nm) {
      toast({ title: '请输入图元名称', variant: 'destructive' })
      return
    }
    if (parts.length === 0) {
      toast({ title: '请至少放置一个组成部件', description: '从左侧基础图形选择并点击画布放置', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const norm = normalizeSymbolParts(parts)
      if (ctx.mode === 'edit' && ctx.symbolId) {
        await apiPut(`/api/pid-symbols/${ctx.symbolId}`, {
          name: nm, parts: norm.parts, designW: norm.designW, designH: norm.designH,
          __actorId: currentUser.id, __actorName: currentUser.name,
        })
      } else {
        await apiPost('/api/pid-symbols', {
          name: nm, parts: norm.parts, designW: norm.designW, designH: norm.designH,
          basedOn: ctx.basedOn ?? null,
          __actorId: currentUser.id, __actorName: currentUser.name,
        })
      }
      onSaved(nm, ctx.mode)
    } catch (err) {
      toast({ title: '保存失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const placingLib = placing ? libOf(placing) : null

  return (
    <>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="outline" className="h-9 px-3"
              onClick={() => (dirty ? setConfirmBack(true) : onClose())}
            >
              <ArrowLeft className="h-4 w-4" /> 返回组态
            </Button>
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Shapes className="h-4 w-4 text-violet-600" />
                图元编辑器
                <Badge variant="outline" className={cn('border', ctx.mode === 'edit' ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-violet-200 bg-violet-50 text-violet-700')}>
                  {ctx.mode === 'edit' ? '编辑已有图元' : '新建图元'}
                </Badge>
                {dirty && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">未保存</Badge>}
              </CardTitle>
              <CardDescription>
                {ctx.basedOn
                  ? `以「${ctx.basedOn}」为基础组合构建 · 保存后自动出现在左侧「自定义」页签`
                  : '用基础图形（矩形/圆形/直线/椭圆/三角形）组合构建 · 保存后自动出现在左侧「自定义」页签'}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="h-10 w-52" placeholder="图元名称，如 双出口泵"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setDirty(true)
              }}
            />
            <Button className="h-10 bg-violet-600 px-5 text-white hover:bg-violet-700" disabled={saving} onClick={() => void handleSave()}>
              <Save className="h-4 w-4" /> 保存图元
              {dirty && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-400" title="有未保存更改" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-stretch gap-3 lg:flex-row">
          {/* 左侧基础图形部件库 */}
          <div className="flex w-full shrink-0 flex-col rounded-lg border bg-white lg:w-52">
            <div className="border-b px-3 py-2 text-xs font-medium text-stone-500">基础图形部件</div>
            <div className="p-2">
              {EDITOR_PALETTE.map((t) => {
                const item = libOf(t)
                const Icon = item.icon
                const active = placing === t
                return (
                  <button
                    key={t} type="button"
                    onClick={() => setPlacing(active ? null : t)}
                    className={cn(
                      'flex min-h-[40px] w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-sm transition-colors',
                      active ? 'border-teal-400 bg-teal-50 text-teal-800' : 'border-transparent text-stone-700 hover:border-stone-200 hover:bg-stone-50',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-stone-500" />
                    <span className="flex-1">{item.label}</span>
                    <span className="font-mono text-[10px] text-stone-400">{item.w}×{item.h}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-auto border-t px-3 py-2 text-[11px] leading-relaxed text-stone-400">
              {placingLib
                ? placingLib.type === 'line'
                  ? '按住左键从起点拖拽到终点绘制直线（任意角度）· Esc 取消'
                  : `点击画布位置放置「${placingLib.label}」，Esc 取消`
                : '点击部件进入放置模式；选中部件后可调颜色、层级'}
            </div>
          </div>

          {/* 中央设计画布（200×200 设计空间，等比放大展示） */}
          <div className="relative min-w-0 flex-1">
            {placingLib && (
              <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs text-teal-800 shadow-sm">
                {placingLib.type === 'line'
                  ? '绘制直线：按住左键定起点，移动调整角度与长度，松开定终点 · Esc 取消'
                  : `正在放置部件：${placingLib.label} · 点击画布落点 · Esc 取消`}
              </div>
            )}
            <div className="mx-auto w-full max-w-[560px]">
              <div className="relative aspect-square overflow-hidden rounded-lg border bg-white">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${EDITOR_SIZE} ${EDITOR_SIZE}`}
                  className="block h-full w-full select-none"
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerLeave={() => setMousePos(null)}
                  onClick={handleCanvasClick}
                >
                  <defs>
                    <pattern id="bp-sym-grid-s" width={10} height={10} patternUnits="userSpaceOnUse">
                      <path d="M 10 0 L 0 0 0 10" fill="none" stroke={GRID_S} strokeWidth={0.8} />
                    </pattern>
                    <pattern id="bp-sym-grid-l" width={50} height={50} patternUnits="userSpaceOnUse">
                      <rect width={50} height={50} fill="url(#bp-sym-grid-s)" />
                      <path d="M 50 0 L 0 0 0 50" fill="none" stroke={GRID_L} strokeWidth={1} />
                    </pattern>
                  </defs>
                  <rect x={0} y={0} width={EDITOR_SIZE} height={EDITOR_SIZE} fill="#fff" />
                  <rect
                    x={0} y={0} width={EDITOR_SIZE} height={EDITOR_SIZE} fill="url(#bp-sym-grid-l)"
                    className={cn(placing === 'line' ? 'cursor-crosshair' : placing && 'cursor-copy')}
                  />

                  {/* 组成部件 */}
                  {parts.map((p) => {
                    const isSel = p.id === selectedId
                    const clampV = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
                    const handles: [ResizeHandle, number, number, string][] = [
                      ['nw', clampV(p.x - 3, 1, EDITOR_SIZE - 1), clampV(p.y - 3, 1, EDITOR_SIZE - 1), 'nwse-resize'],
                      ['ne', clampV(p.x + p.w + 3, 1, EDITOR_SIZE - 1), clampV(p.y - 3, 1, EDITOR_SIZE - 1), 'nesw-resize'],
                      ['sw', clampV(p.x - 3, 1, EDITOR_SIZE - 1), clampV(p.y + p.h + 3, 1, EDITOR_SIZE - 1), 'nesw-resize'],
                      ['se', clampV(p.x + p.w + 3, 1, EDITOR_SIZE - 1), clampV(p.y + p.h + 3, 1, EDITOR_SIZE - 1), 'nwse-resize'],
                    ]
                    return (
                      <g
                        key={p.id}
                        onPointerDown={(e) => startDrag(e, p)}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedId(p.id)
                        }}
                        onPointerEnter={() => setHoverId(p.id)}
                        onPointerLeave={() => setHoverId((prev) => (prev === p.id ? null : prev))}
                        className="cursor-move"
                      >
                        <ShapeBody s={{ ...p, label: '' }} />
                        {isSel && (
                          <>
                            <rect x={p.x - 3} y={p.y - 3} width={p.w + 6} height={p.h + 6} rx={2} fill="none" stroke={TEAL} strokeWidth={1} strokeDasharray="4 3" />
                            {handles.map(([hd, hx, hy, cur]) => (
                              <rect
                                key={hd} x={hx - 3} y={hy - 3} width={6} height={6}
                                fill="#fff" stroke={TEAL} strokeWidth={1.1} style={{ cursor: cur }}
                                onPointerDown={(e) => startResize(e, p, hd)}
                              />
                            ))}
                          </>
                        )}
                      </g>
                    )
                  })}

                  {/* 放置幽灵预览（直线为十字准星引导） */}
                  {placingLib && mousePos && !lineDraft && (
                    <g pointerEvents="none" opacity={0.75}>
                      {placingLib.type === 'line' ? (
                        <>
                          <line x1={mousePos.x - 7} y1={mousePos.y} x2={mousePos.x + 7} y2={mousePos.y} stroke={TEAL} strokeWidth={1} />
                          <line x1={mousePos.x} y1={mousePos.y - 7} x2={mousePos.x} y2={mousePos.y + 7} stroke={TEAL} strokeWidth={1} />
                          <circle cx={mousePos.x} cy={mousePos.y} r={2} fill={TEAL} />
                          <text x={mousePos.x} y={mousePos.y - 10} textAnchor="middle" fontSize={9} fill={TEAL}>按住拖拽绘制</text>
                        </>
                      ) : (() => {
                        const w = Math.min(placingLib.w, EDITOR_SIZE - 8)
                        const h = Math.min(placingLib.h, EDITOR_SIZE - 8)
                        const gx = clamp(mousePos.x - w / 2, 0, EDITOR_SIZE - w)
                        const gy = clamp(mousePos.y - h / 2, 0, EDITOR_SIZE - h)
                        return (
                          <>
                            <rect x={gx} y={gy} width={w} height={h} rx={3} fill="rgba(13,148,136,0.08)" stroke={TEAL} strokeWidth={1.2} strokeDasharray="5 3" />
                            <text x={mousePos.x} y={gy - 4} textAnchor="middle" fontSize={9} fill={TEAL}>{placingLib.label}</text>
                          </>
                        )
                      })()}
                    </g>
                  )}

                  {/* 直线橡皮筋拖拽预览：起点实心 · 终点空心 · 实时长度/角度 */}
                  {lineDraft && (
                    <g pointerEvents="none">
                      <line
                        x1={lineDraft.sx} y1={lineDraft.sy} x2={lineDraft.ex} y2={lineDraft.ey}
                        stroke={TEAL} strokeWidth={1.4} strokeDasharray="5 3"
                      />
                      <circle cx={lineDraft.sx} cy={lineDraft.sy} r={2.4} fill={TEAL} />
                      <circle cx={lineDraft.ex} cy={lineDraft.ey} r={2.4} fill="#fff" stroke={TEAL} strokeWidth={1.2} />
                      <text
                        x={(lineDraft.sx + lineDraft.ex) / 2}
                        y={(lineDraft.sy + lineDraft.ey) / 2 - 6}
                        textAnchor="middle" fontSize={9} fontWeight={500} fill={TEAL}
                        stroke="#fff" strokeWidth={2.5} paintOrder="stroke"
                      >
                        {Math.round(Math.hypot(lineDraft.ex - lineDraft.sx, lineDraft.ey - lineDraft.sy))}
                        {' · '}
                        {Math.round((Math.atan2(-(lineDraft.ey - lineDraft.sy), lineDraft.ex - lineDraft.sx) * 180) / Math.PI)}°
                      </text>
                    </g>
                  )}
                </svg>
                {parts.length === 0 && !placing && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
                    <Shapes className="h-9 w-9 text-stone-300" />
                    <div className="text-sm font-medium text-stone-500">从左侧选择基础图形开始构建</div>
                    <div className="text-xs text-stone-400">点击部件 → 画布放置（直线为按住拖拽绘制）· 拖拽移动 · 四角缩放 · 可多部件组合</div>
                  </div>
                )}
              </div>
              <div className="mt-1.5 text-center text-[11px] text-stone-400">
                设计空间 {EDITOR_SIZE}×{EDITOR_SIZE} · 保存时自动裁剪至部件包围盒 · 部件按顺序叠放
              </div>
            </div>
          </div>

          {/* 右侧部件属性 */}
          <div className="w-full shrink-0 rounded-lg border bg-white lg:w-60">
            <div className="border-b px-3 py-2 text-xs font-medium text-stone-500">部件属性</div>
            <div className="space-y-3 p-3">
              {selected ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-stone-700">部件属性</span>
                    <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-600">{typeLabel(selected.type)}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="X" value={selected.x} min={0} max={EDITOR_SIZE - selected.w} onChange={(v) => updatePart(selected.id, { x: v })} />
                    <NumField label="Y" value={selected.y} min={0} max={EDITOR_SIZE - selected.h} onChange={(v) => updatePart(selected.id, { y: v })} />
                    <NumField label="宽 W" value={selected.w} min={libOf(selected.type).minW} max={EDITOR_SIZE} onChange={(v) => updatePart(selected.id, { w: v })} />
                    <NumField label="高 H" value={selected.h} min={libOf(selected.type).minH} max={EDITOR_SIZE} onChange={(v) => updatePart(selected.id, { h: v })} />
                  </div>
                  {selected.type === 'line' && (
                    <Button
                      variant="outline"
                      className="h-8 w-full border-stone-200 text-stone-600 hover:bg-stone-50"
                      title="镜像翻转直线方向（/ ↔ \）"
                      onClick={() => updatePart(selected.id, { flip: !selected.flip })}
                    >
                      <MoveDiagonal className="h-3.5 w-3.5" /> 交换对角方向
                    </Button>
                  )}
                  <ColorSwatches label="填充色" palette={FILL_PALETTE} value={selected.fill ?? '#ffffff'} onChange={(c) => updatePart(selected.id, { fill: c })} />
                  <ColorSwatches label="描边色" palette={STROKE_PALETTE} value={selected.stroke ?? '#44403c'} onChange={(c) => updatePart(selected.id, { stroke: c })} />
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-8 text-xs" title="上移一层（越靠后越在上层）" onClick={() => moveLayer(selected.id, 1)}>
                      <ArrowUp className="h-3.5 w-3.5" /> 上移一层
                    </Button>
                    <Button variant="outline" className="h-8 text-xs" onClick={() => moveLayer(selected.id, -1)}>
                      <ArrowDown className="h-3.5 w-3.5" /> 下移一层
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    className="h-9 w-full border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    onClick={() => deletePart(selected.id)}
                  >
                    <Trash2 className="h-4 w-4" /> 删除部件（Delete）
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs font-medium text-stone-700">组成部件（{parts.length}）</div>
                  {parts.length === 0 ? (
                    <div className="rounded-md bg-stone-50 p-2.5 text-[11px] leading-relaxed text-stone-400">
                      还没有部件。从左侧选择基础图形放置；也可返回后在画布选中图元，用「存为自定义图元」以它为基础新建。
                    </div>
                  ) : (
                    <div className="bp-thin-scrollbar max-h-64 space-y-1 overflow-y-auto">
                      {parts.map((p, i) => (
                        <button
                          key={p.id} type="button"
                          className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs text-stone-600 transition-colors hover:border-stone-200 hover:bg-stone-50"
                          onClick={() => setSelectedId(p.id)}
                        >
                          <span className="w-4 text-right font-mono text-[10px] text-stone-400">{i + 1}</span>
                          <SymbolThumb parts={[p]} className="h-4 w-4" />
                          <span className="flex-1 truncate">{typeLabel(p.type)}</span>
                          <span className="font-mono text-[10px] text-stone-400">{p.w}×{p.h}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="rounded-md bg-stone-50 p-2.5 text-[11px] leading-relaxed text-stone-400">
                    点击部件选中后可调整位置/尺寸/颜色；快捷键：Delete 删除部件 · Esc 取消放置/选中
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      {/* 未保存返回确认 */}
      <AlertDialog open={confirmBack} onOpenChange={setConfirmBack}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>返回组态编辑器？</AlertDialogTitle>
            <AlertDialogDescription>当前图元的修改尚未保存，返回后将丢失这些更改。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={onClose}>
              丢弃修改并返回
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ============ 主模块 ============
export default function PidConfig({ onNavigate, currentUser, focusId, readOnly }: ModuleProps & { readOnly?: boolean }) {
  const { toast } = useToast()
  const svgRef = useRef<SVGSVGElement | null>(null)

  // ---- 数据 ----
  const [diagrams, setDiagrams] = useState<DiagramMeta[]>([])
  const [diagramsLoading, setDiagramsLoading] = useState(true)
  const [units, setUnits] = useState<UnitOpt[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [detailName, setDetailName] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [content, setContent] = useState<PidContent>(EMPTY_CONTENT)
  const [dirty, setDirty] = useState(false)
  const [mode, setMode] = useState<'edit' | 'view'>(readOnly ? 'view' : 'edit')

  // ---- 画布交互 ----
  const [selected, setSelected] = useState<Selection | null>(null)
  const [hoverShapeId, setHoverShapeId] = useState<string | null>(null)
  const [hoverAnchor, setHoverAnchor] = useState<string | null>(null)
  const [pendingConn, setPendingConn] = useState<{ shapeId: string; anchor: Anchor } | null>(null)
  const [mousePos, setMousePos] = useState<RoutePoint | null>(null)
  const [placingShape, setPlacingShape] = useState<PidShapeType | null>(null)
  const [placingStdId, setPlacingStdId] = useState<string | null>(null)
  // 图元库侧栏：三页签 + 内建图元大分类/子分类两级手风琴 + 搜索 + 悬停信息卡
  const [libTab, setLibTab] = useState<'std' | 'basic' | 'custom'>('std')
  // 内建图元搜索框（按名称/说明/子分类过滤，非空时平铺展示命中结果）
  const [stdSearch, setStdSearch] = useState('')
  // 手风琴展开状态（key：m-大分类 / 子分类id / basic / custom）；语义：undefined 时大分类默认仅设备展开、子分类全展开
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ 'm-equipment': true, basic: true, custom: true })
  const toggleGroup = useCallback((key: string) => setOpenGroups((m) => ({ ...m, [key]: !m[key] })), [])
  const [libHover, setLibHover] = useState<{ title: string; lines: string[]; x: number; y: number } | null>(null)
  const [placingMark, setPlacingMark] = useState<MasterPoint | null>(null)
  const [placingSymbol, setPlacingSymbol] = useState<SymbolRow | null>(null)
  // 直线橡皮筋绘制：按下定起点 → 拖动实时改角度/长度 → 抬起定终点（任意方向，/ 与 \ 双向支持）
  const [lineDraft, setLineDraft] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null)
  const lineDraftRef = useRef<{ sx: number; sy: number; ex: number; ey: number } | null>(null)
  const lineEndAtRef = useRef(0) // 直线绘制结束时刻：吞掉紧随 pointerup 的 click，防误清新线选中态

  // ---- 画布平移缩放（viewBox 方案：内容坐标零侵入，编辑/查看/只读三态通用） ----
  const CANVAS_MIN_W = CANVAS_W / 4   // 最大放大 4x
  const CANVAS_MAX_W = CANVAS_W * 2.5 // 最大缩小 0.4x
  const [vb, setVb] = useState({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H })
  const vbRef = useRef(vb)
  vbRef.current = vb
  const [panning, setPanning] = useState(false)

  // ---- 画布自适应高度（占满视口剩余）：viewBox 高宽比跟随容器实测比例，无 letterbox 坐标偏移 ----
  const [canvasRatio, setCanvasRatio] = useState(CANVAS_H / CANVAS_W)
  const canvasRatioRef = useRef(canvasRatio)
  canvasRatioRef.current = canvasRatio
  const canvasBoxRef = useRef<HTMLDivElement | null>(null)
  const canvasRowRef = useRef<HTMLDivElement | null>(null)
  const [canvasH, setCanvasH] = useState(0) // 0 = 未测量（回落到画布比例兜底）
  const [canvasW, setCanvasW] = useState(0) // 浮动工具条定位 clamp 用
  const suppressClickAtRef = useRef(0) // 平移拖拽结束时刻：吞掉紧随 pointerup 的 click，防误点挂标/误取消选中

  // ---- 俯瞰图（工具栏开关，画布右下角显示：整图缩略 + 当前视口框，点击/拖拽快速定位） ----
  const [minimapOpen, setMinimapOpen] = useState(false)
  const minimapNavRef = useRef(false) // 俯瞰图按下拖拽导航中（pointer capture 保证移动/抬起事件回到缩略图）

  // ---- 标注隔离点 Dialog ----
  const [markDialogOpen, setMarkDialogOpen] = useState(false)
  const [markKeyword, setMarkKeyword] = useState('')
  const [masterPoints, setMasterPoints] = useState<MasterPoint[]>([])
  const [masterLoading, setMasterLoading] = useState(false)

  // ---- 隔离点所属管线自动计算（添加/移动终点位置推导，变化时确认后更新主数据归属） ----
  const [pipePrompt, setPipePrompt] = useState<PipeOwnershipPrompt | null>(null)
  const [pipePromptBusy, setPipePromptBusy] = useState(false)

  // ---- 管线号标注沿线拖动（labelT 归一化弧长参数；拖拽中连线徽章高亮） ----
  const [draggingLabelId, setDraggingLabelId] = useState<string | null>(null)

  // ---- 连线交互增强：中段拖拽（竖线横向/横线纵向）+ 端点拖拽改接锚点 ----
  const [draggingConnSeg, setDraggingConnSeg] = useState<string | null>(null)
  const [connEndDrag, setConnEndDrag] = useState<
    { id: string; which: 'from' | 'to'; x: number; y: number; hover: { shapeId: string; anchor: Anchor } | null } | null
  >(null)
  const connDragEndAtRef = useRef(0) // 连线拖拽结束时刻：吞掉紧随 pointerup 的 click，防误清选中

  // ---- 查看模式状态 ----
  const [statusPoints, setStatusPoints] = useState<StatusPoint[]>([])
  const [statusAt, setStatusAt] = useState<string | null>(null)
  const [statusTick, setStatusTick] = useState(0)

  // ---- 全屏/窗口切换（PID 组态与盲板状态两个页面共用本组件，一处实现两页生效） ----
  const [full, setFull] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // ---- 盲板状态页点击挂标 → 点位盲板作业全生命周期抽屉 ----
  const [dossierMark, setDossierMark] = useState<PidMark | null>(null)
  const [dossierOpen, setDossierOpen] = useState(false)
  const [dossierLoading, setDossierLoading] = useState(false)
  const [dossierData, setDossierData] = useState<PointDossierResp | null>(null)

  // ---- 自定义图元库（保存后自动出现在左侧「自定义」页签） ----
  const [symbols, setSymbols] = useState<SymbolRow[]>([])
  const [symbolsLoading, setSymbolsLoading] = useState(false)
  const [deleteSymbolTarget, setDeleteSymbolTarget] = useState<SymbolRow | null>(null)

  // ---- 设备/管线主数据（图元绑定设备、连线绑定管线 + 保存回写） ----
  const [equipOptions, setEquipOptions] = useState<EquipOption[]>([])
  const [pipeOptions, setPipeOptions] = useState<PipeOption[]>([])

  // ---- 独立图元编辑界面（非 null 时整个模块跳转为编辑器视图） ----
  const [symbolEditor, setSymbolEditor] = useState<SymbolEditorCtx | null>(null)

  // ---- 图管理 Dialog ----
  const [newOpen, setNewOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  // AI 助手入口直达：[入口:pid-config:import|AI 识别导入 PID] → 打开识别导入向导（只读盲板状态页不响应）
  useEffect(() => {
    if (readOnly) return
    const handler = (e: Event) => {
      if ((e as CustomEvent<{ action?: string }>).detail?.action === 'import') setImportOpen(true)
    }
    window.addEventListener(entryActionEventName('pid-config'), handler)
    return () => window.removeEventListener(entryActionEventName('pid-config'), handler)
  }, [readOnly])
  const [newForm, setNewForm] = useState<{ name: string; unitId: string }>({ name: '', unitId: 'none' })
  const [creating, setCreating] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DiagramMeta | null>(null)
  const [saving, setSaving] = useState(false)

  // ---- 渲染期同步 ref（供稳定回调读取最新值） ----
  const contentRef = useRef(content)
  contentRef.current = content
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const symbolEditorRef = useRef(symbolEditor)
  symbolEditorRef.current = symbolEditor
  const pipeOptionsRef = useRef(pipeOptions)
  pipeOptionsRef.current = pipeOptions

  // ---- 派生 ----
  const shapeMap = useMemo(() => new Map(content.shapes.map((s) => [s.id, s])), [content])
  const markedCodes = useMemo(() => new Set(content.marks.map((m) => m.code)), [content])
  const statusMap = useMemo(() => new Map(statusPoints.map((p) => [p.markId, p])), [statusPoints])
  const activeDiagram = diagrams.find((d) => d.id === activeId) ?? null
  const selectedShape = selected?.kind === 'shape' ? shapeMap.get(selected.id) ?? null : null
  const selectedConn = selected?.kind === 'conn' ? content.connections.find((c) => c.id === selected.id) ?? null : null
  const selectedMark = selected?.kind === 'mark' ? content.marks.find((m) => m.id === selected.id) ?? null : null
  // 俯瞰图世界包围盒（画布区域 ∪ 当前视口 + 留白）：随平移/缩放动态扩展，无限画布下视口永在框内
  const mmBounds = minimapBoundsOf(vb)

  // ---- 挂标跨图占用提示（写入侧对称提示：该点已在其他 N 张图挂标，防多图版本漂移） ----
  const [markUsage, setMarkUsage] = useState<{ diagramName: string; unitName: string | null }[] | null>(null)
  useEffect(() => {
    if (selected?.kind !== 'mark' || !selectedMark) { setMarkUsage(null); return }
    const params = new URLSearchParams()
    if (selectedMark.masterPointId != null) params.set('masterPointId', String(selectedMark.masterPointId))
    else if (selectedMark.code) params.set('code', selectedMark.code)
    else { setMarkUsage(null); return }
    if (activeId != null) params.set('excludeDiagramId', String(activeId))
    let cancelled = false
    const t = setTimeout(() => {
      apiGet<{ list: { diagramName: string; unitName: string | null }[] }>(`/api/pid-diagrams/mark-usage?${params}`)
        .then((r) => { if (!cancelled) setMarkUsage(r.list ?? []) })
        .catch(() => { if (!cancelled) setMarkUsage(null) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [selectedMark, activeId])
  // 隔离点主数据索引（挂标所属管线显示 + 位置自动计算比对当前归属）
  const masterById = useMemo(() => new Map(masterPoints.map((mp) => [mp.id, mp])), [masterPoints])
  const masterByIdRef = useRef(masterById)
  masterByIdRef.current = masterById

  /** 统一内容变更入口：任何图元/连线/标注的增删改都置 dirty */
  const mutate = (fn: (prev: PidContent) => PidContent) => {
    setContent((prev) => fn(prev))
    setDirty(true)
  }

  // ---- 全屏/窗口切换 ----
  const enterFull = () => {
    setFull(true)
    // 浏览器原生全屏尽力尝试（iframe/沙箱受限时静默降级为 CSS 覆盖层全屏）
    try {
      void wrapRef.current?.requestFullscreen?.().catch(() => {})
    } catch {
      /* 降级 CSS 覆盖层 */
    }
  }
  const exitFull = () => {
    setFull(false)
    try {
      if (document.fullscreenElement) void document.exitFullscreen()
    } catch {
      /* noop */
    }
  }
  // 浏览器原生全屏被 Esc 退出时同步本地状态
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFull(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])
  // 全屏期间把弹窗 Portal（Dialog/AlertDialog/Sheet/Select 下拉/Toast）重定向进全屏容器，
  // 否则原生 Fullscreen 的 top layer 会盖住所有 body 层弹窗（弹窗被遮盖 bug）
  useEffect(() => {
    setPortalContainer(full ? (wrapRef.current ?? null) : null)
    return () => {
      if (full) setPortalContainer(null)
    }
  }, [full])
  // CSS 覆盖层全屏模式下 Esc 退出（原生全屏由浏览器处理）
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  // ---- 点位作业档案抽屉（盲板状态页点击挂标） ----
  const openDossier = useCallback(async (m: PidMark, st?: StatusPoint) => {
    setDossierMark(m)
    setDossierOpen(true)
    setDossierLoading(true)
    setDossierData(null)
    try {
      const q = st?.masterPointId
        ? `masterPointId=${st.masterPointId}`
        : `code=${encodeURIComponent(m.code)}`
      const data = await apiGet<PointDossierResp>(`/api/point-dossier?${q}`)
      setDossierData(data)
    } catch (err) {
      toast({ title: '作业档案加载失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setDossierLoading(false)
    }
  }, [toast])

  // ---- 坐标转换：屏幕 → SVG viewBox（按当前缩放视口换算，缩放/平移后落点依然准确） ----
  const toSvgPoint = (e: { clientX: number; clientY: number }): RoutePoint | null => {
    const svg = svgRef.current
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    const v = vbRef.current
    const s = r.width / v.w // viewBox 宽高比恒等于画布比，无 letterbox，x/y 同比例
    return {
      x: v.x + (e.clientX - r.left) / s,
      y: v.y + (e.clientY - r.top) / s,
    }
  }

  // ---- 视图控制：缩放（锚点为中心）/ 重置 / 空白拖拽平移 ----
  const applyVb = useCallback((next: { x: number; y: number; w: number }) => {
    const w = clamp(next.w, CANVAS_MIN_W, CANVAS_MAX_W)
    const h = w * canvasRatioRef.current // 高宽比跟随容器实测（画布占满可用高度，无 letterbox）
    // 画布无限大：平移不设边界（白底/网格跟随视口，任意位置都是可绘制桌面）；跑远了用俯瞰图或重置视图找回
    setVb({ x: next.x, y: next.y, w, h })
  }, [])
  const zoomAt = useCallback((factor: number, ax?: number, ay?: number) => {
    const cur = vbRef.current
    const cx = ax ?? cur.x + cur.w / 2
    const cy = ay ?? cur.y + cur.h / 2
    const nw = clamp(cur.w / factor, CANVAS_MIN_W, CANVAS_MAX_W)
    const k = nw / cur.w
    applyVb({ x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k, w: nw })
  }, [applyVb])
  const resetView = useCallback(() => setVb({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_W * canvasRatioRef.current }), [])

  // 容器实测比例（ResizeObserver）：画布高度自适应后 viewBox 高宽比 = 容器比，屏幕坐标换算零偏移
  useEffect(() => {
    const el = canvasBoxRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 4 && r.height > 4) {
        setCanvasW(Math.round(r.width))
        setCanvasRatio(r.height / r.width)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [detailLoading])

  // 比例变化（容器尺寸变化）时同步校正当前视口高度（保持 x/y/w）
  useEffect(() => {
    setVb((v) => {
      const h = v.w * canvasRatio
      return Math.abs(h - v.h) < 0.5 ? v : { ...v, h }
    })
  }, [canvasRatio])

  // 画布高度 = 视口剩余高度（三栏行显式撑满，页面恰为一屏；回顶时重新校准避免滚动偏移干扰）
  useEffect(() => {
    const measure = () => {
      const row = canvasRowRef.current
      if (!row) { setCanvasH(0); return }
      const top = row.getBoundingClientRect().top
      setCanvasH(Math.max(380, Math.round(window.innerHeight - top - 20)))
    }
    measure()
    const onScroll = () => { if (window.scrollY < 4) measure() }
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', onScroll)
    }
  }, [detailLoading, full])

  // 滚轮缩放（以鼠标位置为锚点）：原生监听非 passive 才能 preventDefault 阻止页面滚动
  // detailLoading 参与依赖：骨架屏阶段 svg 未挂载，加载完成后必须重新绑定
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || detailLoading) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      if (r.width === 0) return
      const v = vbRef.current
      const s = r.width / v.w
      zoomAt(e.deltaY > 0 ? 1 / 1.12 : 1.12, v.x + (e.clientX - r.left) / s, v.y + (e.clientY - r.top) / s)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomAt, detailLoading])

  const startPan = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const startCx = e.clientX
    const startCy = e.clientY
    const startVb = vbRef.current
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startCx
      const dy = ev.clientY - startCy
      if (!moved && Math.hypot(dx, dy) < 4) return
      moved = true
      setPanning(true)
      const s = svg.getBoundingClientRect().width / startVb.w
      applyVb({ x: startVb.x - dx / s, y: startVb.y - dy / s, w: startVb.w })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setPanning(false)
      // 实际拖拽过才吞 click：轻点（<4px）保留原有点击语义（取消选中/打开档案）
      if (moved) suppressClickAtRef.current = Date.now() + 350
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- 俯瞰图导航：点击/拖拽缩略图 → 画布视口中心移动到对应世界坐标（保持当前缩放倍率） ----
  const minimapNavTo = (clientX: number, clientY: number, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const m = minimapBoundsOf(vbRef.current)
    const s = Math.min(r.width / m.w, r.height / m.h) // preserveAspectRatio=meet 等比缩放比
    const ox = (r.width - m.w * s) / 2 // letterbox 居中偏移（缩略图容器与包围盒宽高比不一致时）
    const oy = (r.height - m.h * s) / 2
    const wx = m.x + (clientX - r.left - ox) / s
    const wy = m.y + (clientY - r.top - oy) / s
    const v = vbRef.current
    setVb({ x: wx - v.w / 2, y: wy - v.h / 2, w: v.w, h: v.h })
  }

  // ---- 自动布局（编辑态工具栏）：确认弹窗 → 应用快照对比 + toast 撤销 ----
  const [layoutConfirmOpen, setLayoutConfirmOpen] = useState(false)
  const layoutSnapshotRef = useRef<PidContent | null>(null)
  const applyAutoLayout = () => {
    setLayoutConfirmOpen(false)
    const before = contentRef.current
    const after = autoLayoutContent(before)
    const beforeShape = new Map(before.shapes.map((s) => [s.id, s]))
    const movedShapes = after.shapes.filter((s) => {
      const b = beforeShape.get(s.id)
      return b && (b.x !== s.x || b.y !== s.y)
    }).length
    const beforeMark = new Map(before.marks.map((m) => [m.id, m]))
    const movedMarks = after.marks.filter((m) => {
      const b = beforeMark.get(m.id)
      return b && (b.x !== m.x || b.y !== m.y)
    }).length
    const anchorChanged = after.connections.some((c) => {
      const b = before.connections.find((x) => x.id === c.id)
      return b && (b.fromAnchor !== c.fromAnchor || b.toAnchor !== c.toAnchor)
    })
    if (movedShapes === 0 && movedMarks === 0 && !anchorChanged) {
      toast({ title: '已是整齐布局', description: '当前图元位置与连线走向无需调整' })
      return
    }
    layoutSnapshotRef.current = before
    setContent(after)
    setDirty(true)
    toast({
      title: '自动布局完成',
      description: `重排图元 ${movedShapes} 个 · 标注跟随管线 ${movedMarks} 个（尚未保存，记得保存）`,
      duration: 12000, // 覆盖手工摆放的重操作：给足撤销窗口（缺省 5s 太短）
      action: (
        <ToastAction
          altText="撤销自动布局"
          onClick={() => {
            if (layoutSnapshotRef.current) {
              setContent(layoutSnapshotRef.current)
              setDirty(true)
              toast({ title: '已撤销自动布局', description: '已恢复布局前的位置（尚未保存）' })
              layoutSnapshotRef.current = null
            }
          }}
        >
          撤销
        </ToastAction>
      ),
    })
  }

  // ---- 保存 ----
  const saveContent = useCallback(async (silent = false): Promise<boolean> => {
    const id = activeIdRef.current
    if (!id) return false
    try {
      await apiPut(`/api/pid-diagrams/${id}`, {
        content: JSON.stringify(contentRef.current),
        __actorId: currentUser.id,
        __actorName: currentUser.name,
      })
      setDirty(false)
      return true
    } catch (err) {
      if (!silent) toast({ title: '保存失败', description: (err as Error).message, variant: 'destructive' })
      return false
    }
  }, [currentUser.id, currentUser.name, toast])

  const loadDiagrams = useCallback(async (): Promise<DiagramMeta[]> => {
    setDiagramsLoading(true)
    try {
      const data = await apiGet<{ list: DiagramMeta[] }>('/api/pid-diagrams')
      setDiagrams(data.list ?? [])
      return data.list ?? []
    } catch (err) {
      toast({ title: '加载组态图列表失败', description: (err as Error).message, variant: 'destructive' })
      return []
    } finally {
      setDiagramsLoading(false)
    }
  }, [toast])

  const loadUnits = useCallback(async () => {
    try {
      const data = await apiGet<UnitOpt[]>('/api/units')
      setUnits(data ?? [])
    } catch {
      /* 装置列表失败不阻塞主流程 */
    }
  }, [])

  const loadSymbols = useCallback(async () => {
    setSymbolsLoading(true)
    try {
      const data = await apiGet<{ list: SymbolRow[] }>('/api/pid-symbols')
      setSymbols(
        (data.list ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          basedOn: r.basedOn ?? null,
          designW: r.designW > 0 ? r.designW : 100,
          designH: r.designH > 0 ? r.designH : 100,
          parts: Array.isArray(r.parts) ? r.parts : [],
        })),
      )
    } catch {
      /* 图元库加载失败不阻塞画布主流程 */
    } finally {
      setSymbolsLoading(false)
    }
  }, [])

  const loadBindOptions = useCallback(async () => {
    try {
      const [eq, pl] = await Promise.all([
        apiGet<{ list: { id: number; code: string; name: string; type: string; unitName?: string | null }[] }>('/api/equipments'),
        apiGet<{ list: { id: number; code: string; name: string }[] }>('/api/pipelines'),
      ])
      setEquipOptions((eq.list ?? []).map((e) => ({ id: e.id, code: e.code, name: e.name, type: e.type, unitName: e.unitName ?? null })))
      setPipeOptions((pl.list ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name })))
    } catch {
      /* 绑定选项加载失败不阻塞画布主流程 */
    }
  }, [])

  useEffect(() => {
    void loadDiagrams()
    void loadUnits()
    void loadSymbols()
    void loadBindOptions() // 只读页也需要（画布显示已绑管线徽章/设备角标提示）
  }, [loadDiagrams, loadUnits, loadSymbols, loadBindOptions])

  const selectDiagram = useCallback(async (id: number) => {
    // 切换前自动保存未保存内容（更简单可靠，避免丢失）
    if (dirtyRef.current && activeIdRef.current) {
      const ok = await saveContent(true)
      if (ok) toast({ title: '已自动保存', description: '切换前的工作区更改已保存' })
    }
    setDetailLoading(true)
    setSelected(null)
    setPendingConn(null)
    setPlacingShape(null)
    setPlacingMark(null)
    setPlacingSymbol(null)
    setHoverShapeId(null)
    setHoverAnchor(null)
    try {
      const data = await apiGet<{ item: DiagramDetail }>(`/api/pid-diagrams/${id}`)
      setActiveId(id)
      setDetailName(data.item.name)
      setContent(parseContent(data.item.content))
      setDirty(false)
      setStatusPoints([])
      setStatusAt(null)
      resetView() // 切换组态图时视图重置回 1:1 全景
    } catch (err) {
      toast({ title: '加载组态图失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setDetailLoading(false)
    }
  }, [saveContent, toast, resetView])

  // 首次加载/删除当前图后自动选中第一张
  useEffect(() => {
    if (activeId === null && !diagramsLoading && diagrams.length > 0) {
      void selectDiagram(diagrams[0].id)
    }
  }, [activeId, diagramsLoading, diagrams, selectDiagram])

  // 跨模块深链：作业需求详情/统计页携带 focusId 直达指定图，并切到查看模式看实时状态
  const focusAppliedRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (focusId != null && focusId !== focusAppliedRef.current && !diagramsLoading && diagrams.some((d) => d.id === focusId)) {
      focusAppliedRef.current = focusId
      void selectDiagram(focusId)
      setMode('view')
    }
  }, [focusId, diagramsLoading, diagrams, selectDiagram])

  const handleSave = async () => {
    if (!activeId) return
    setSaving(true)
    const ok = await saveContent(false)
    setSaving(false)
    if (ok) {
      toast({ title: '保存成功', description: `「${detailName}」组态内容已更新` })
      void loadDiagrams()
    }
  }

  const switchMode = async (m: 'edit' | 'view') => {
    if (m === mode) return
    if (dirtyRef.current && activeIdRef.current) {
      const ok = await saveContent(true)
      if (ok) toast({ title: '已自动保存', description: '切换模式前的工作区更改已保存' })
    }
    setMode(m)
    setSelected(null)
    setPendingConn(null)
    setPlacingShape(null)
    setPlacingMark(null)
    setPlacingSymbol(null)
  }

  // 查看模式：拉取实时状态 + 10s 自动轮询
  useEffect(() => {
    if (mode !== 'view' || !activeId) return
    let alive = true
    const fetchStatus = async (showError: boolean) => {
      try {
        const data = await apiGet<StatusResp>(`/api/pid-diagrams/${activeId}/status`)
        if (!alive) return
        setStatusPoints(data.points ?? [])
        setStatusAt(data.generatedAt ?? new Date().toISOString())
      } catch (err) {
        if (showError && alive) toast({ title: '状态加载失败', description: (err as Error).message, variant: 'destructive' })
      }
    }
    void fetchStatus(true)
    const timer = window.setInterval(() => {
      void fetchStatus(false)
    }, 10000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [mode, activeId, statusTick, toast])

  // 拉取隔离点主数据：标注 Dialog 打开 / 编辑模式（挂标所属管线自动计算需要主数据当前归属）
  useEffect(() => {
    if (!markDialogOpen && mode !== 'edit') return
    let alive = true
    setMasterLoading(true)
    apiGet<{ list: MasterPoint[] }>('/api/iso-point-masters')
      .then((d) => {
        if (alive) setMasterPoints(d.list ?? [])
      })
      .catch((err) => {
        if (alive) toast({ title: '隔离点主数据加载失败', description: (err as Error).message, variant: 'destructive' })
      })
      .finally(() => {
        if (alive) setMasterLoading(false)
      })
    return () => {
      alive = false
    }
  }, [markDialogOpen, mode, toast])

  // ---- 图元增删改 ----
  const addShapeAt = (type: PidShapeType, p: RoutePoint, stdId?: string) => {
    if (type === 'std') {
      // 标准图例符号：默认尺寸=设计空间尺寸，命名=符号名-序号
      const sym = stdId ? STD_SYMBOL_MAP[stdId] : null
      if (!sym) return
      const seq = content.shapes.filter((s) => s.type === 'std' && s.stdId === stdId).length + 1
      const shape: PidShape = {
        id: uid('s'),
        type: 'std',
        stdId,
        x: Math.round(p.x - sym.sw / 2),
        y: Math.round(p.y - sym.sh / 2),
        w: sym.sw,
        h: sym.sh,
        label: `${sym.label}-${seq}`,
      }
      mutate((prev) => ({ ...prev, shapes: [...prev.shapes, shape] }))
      setSelected({ kind: 'shape', id: shape.id })
      setPlacingShape(null)
      return
    }
    const lib = libOf(type)
    const seq = content.shapes.filter((s) => s.type === type).length + 1
    const shape: PidShape = {
      id: uid('s'),
      type,
      // 无限画布：落点即中心，不再限制在 0..CANVAS_W（跑远后用俯瞰图找回）
      x: Math.round(p.x - lib.w / 2),
      y: Math.round(p.y - lib.h / 2),
      w: lib.w,
      h: lib.h,
      label: `${lib.label}-${seq}`,
    }
    mutate((prev) => ({ ...prev, shapes: [...prev.shapes, shape] }))
    setSelected({ kind: 'shape', id: shape.id })
    setPlacingShape(null)
  }

  /** 直线图元创建（橡皮筋抬起落笔）：函数式更新避免 window 回调闭包读到旧 shapes；flip 按拖拽方向推导（/ 与 \ 双向） */
  const addLineShape = (sx: number, sy: number, ex: number, ey: number) => {
    const lib = libOf('line')
    const sid = uid('s')
    setContent((prev) => {
      const seq = prev.shapes.filter((s) => s.type === 'line').length + 1
      const shape: PidShape = {
        id: sid,
        type: 'line',
        x: Math.round(Math.min(sx, ex)),
        y: Math.round(Math.min(sy, ey)),
        w: Math.max(lib.minW, Math.round(Math.abs(ex - sx))),
        h: Math.max(lib.minH, Math.round(Math.abs(ey - sy))),
        flip: (ex >= sx) !== (ey >= sy),
        label: `直线-${seq}`,
      }
      return { ...prev, shapes: [...prev.shapes, shape] }
    })
    setSelected({ kind: 'shape', id: sid })
    setPlacingShape(null)
  }

  // ---- 隔离点所属管线自动计算：挂标添加/拖拽终点位置 → 最近已绑定管线的连线（阈值内） ----
  /** 计算距 (x,y) 最近且已绑定管线的连线（MARK_PIPE_SNAP_DIST 阈值内），返回管线与距离；无命中返回 null */
  const nearestPipeAt = (x: number, y: number): { pipelineId: number; dist: number } | null => {
    const ct = contentRef.current
    const sm = new Map(ct.shapes.map((s) => [s.id, s]))
    let best: { pipelineId: number; dist: number } | null = null
    for (const c of ct.connections) {
      if (c.pipelineId == null) continue // 未绑定管线的连线无法推导归属
      const from = sm.get(c.fromShape)
      const to = sm.get(c.toShape)
      if (!from || !to) continue
      const a = anchorPoint(from, c.fromAnchor)
      const b = anchorPoint(to, c.toAnchor)
      const pts = routeConnection(
        { x: a.x, y: a.y, anchor: c.fromAnchor },
        { x: b.x, y: b.y, anchor: c.toAnchor },
        c.fromShape === c.toShape,
        c.midOverride,
      )
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
        if (d <= MARK_PIPE_SNAP_DIST && (!best || d < best.dist)) best = { pipelineId: c.pipelineId, dist: d }
      }
    }
    return best
  }

  /** 挂标添加/移动终点后调用：按位置计算的所属管线与主数据当前归属不一致时弹确认（确认后才更新） */
  const checkMarkPipeOwnership = (mark: PidMark) => {
    if (mode !== 'edit' || !mark.masterPointId) return
    const hit = nearestPipeAt(mark.x, mark.y)
    if (!hit) return // 附近无已绑定管线：保持原归属
    const master = masterByIdRef.current.get(mark.masterPointId)
    if (master && master.pipelineId === hit.pipelineId) return // 归属未变化
    const toPipe = pipeOptionsRef.current.find((p) => p.id === hit.pipelineId)
    if (!toPipe) return
    const fromLabel = master?.pipelineName
      ?? (master?.pipelineId != null ? pipeOptionsRef.current.find((p) => p.id === master.pipelineId)?.code : null)
      ?? null
    setPipePrompt({
      markId: mark.id,
      masterPointId: mark.masterPointId,
      code: mark.code,
      fromId: master?.pipelineId ?? null,
      fromLabel: fromLabel ?? '未关联',
      toId: toPipe.id,
      toLabel: toPipe.code,
      toName: toPipe.name,
      dist: Math.round(hit.dist),
    })
  }

  const addMarkAt = (p: RoutePoint) => {
    if (!placingMark) return
    const mark: PidMark = {
      id: uid('m'),
      masterPointId: placingMark.id,
      code: placingMark.code,
      name: placingMark.name,
      x: Math.round(p.x),
      y: Math.round(p.y),
    }
    const placed = placingMark
    mutate((prev) => ({ ...prev, marks: [...prev.marks, mark] }))
    setPlacingMark(null)
    setSelected({ kind: 'mark', id: mark.id })
    toast({ title: '标注完成', description: `${placed.code} ${placed.name}（记得保存）` })
    checkMarkPipeOwnership(mark) // 按放置位置自动计算所属管线（与当前归属不一致时弹确认）
  }

  const updateShape = (id: string, patch: Partial<PidShape>) => {
    mutate((prev) => ({ ...prev, shapes: prev.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  }

  // ---- 放置自定义图元实例（部件快照内嵌，之后库删除/修改均不影响该实例） ----
  const addSymbolInstance = (sym: SymbolRow, p: RoutePoint) => {
    const { w, h } = symbolInstanceSize(sym.designW, sym.designH)
    const seq = content.shapes.filter((s) => s.type === 'symbol' && s.symbolId === sym.id).length + 1
    const shape: PidShape = {
      id: uid('s'), type: 'symbol', symbolId: sym.id,
      x: Math.round(p.x - w / 2),
      y: Math.round(p.y - h / 2),
      w, h, label: `${sym.name}-${seq}`,
      designW: sym.designW, designH: sym.designH,
      parts: sym.parts.map((pp) => ({ ...pp })),
    }
    mutate((prev) => ({ ...prev, shapes: [...prev.shapes, shape] }))
    setSelected({ kind: 'shape', id: shape.id })
    setPlacingSymbol(null)
  }

  // ---- 跳转独立图元编辑界面（各入口统一清理画布放置态） ----
  const clearPlacementStates = () => {
    setPlacingShape(null)
    setPlacingMark(null)
    setPlacingSymbol(null)
    setPendingConn(null)
  }

  /** 工具条「新建图元」：空白设计空间，用基础图形从头构建 */
  const enterCreateSymbol = () => {
    clearPlacementStates()
    setSymbolEditor({ mode: 'create' })
  }

  /** 设备图元库条目「以此为模板」：以内置图元为单个基础部件进入编辑器 */
  const enterEditorFromLib = (item: ShapeLibItem) => {
    clearPlacementStates()
    const w = Math.min(item.w, EDITOR_SIZE - 8)
    const h = Math.min(item.h, EDITOR_SIZE - 8)
    setSymbolEditor({
      mode: 'create', basedOn: item.label,
      parts: [{ id: uid('p'), type: item.type, x: Math.round((EDITOR_SIZE - w) / 2), y: Math.round((EDITOR_SIZE - h) / 2), w, h, label: '' }],
    })
  }

  /** 自定义图元「编辑」：载入库中部件到设计空间 */
  const enterEditSymbol = (sym: SymbolRow) => {
    clearPlacementStates()
    setSymbolEditor({
      mode: 'edit', symbolId: sym.id, name: sym.name, basedOn: sym.basedOn ?? undefined,
      parts: sym.parts.map((p) => ({ ...p })),
    })
  }

  /** 自定义图元「以此为模板」：部件等比缩放居中后作为基础 */
  const enterCopyOfSymbol = (sym: SymbolRow) => {
    clearPlacementStates()
    const k = Math.min(1, (EDITOR_SIZE - 16) / Math.max(sym.designW, sym.designH))
    const offX = Math.round((EDITOR_SIZE - sym.designW * k) / 2)
    const offY = Math.round((EDITOR_SIZE - sym.designH * k) / 2)
    setSymbolEditor({
      mode: 'create', basedOn: sym.name,
      parts: sym.parts.map((p) => ({
        ...p, id: uid('p'),
        x: Math.round(p.x * k + offX), y: Math.round(p.y * k + offY),
        w: Math.max(6, Math.round(p.w * k)), h: Math.max(4, Math.round(p.h * k)),
      })),
    })
  }

  /** 属性面板「存为自定义图元」：以画布选中的图元为基础（自定义图元实例则展开为部件并居中） */
  const enterEditorFromShape = (s: PidShape) => {
    clearPlacementStates()
    if (s.type === 'symbol' && s.designW && s.designH && s.parts?.length) {
      const k = Math.min(1, (EDITOR_SIZE - 16) / Math.max(s.designW, s.designH))
      const offX = Math.round((EDITOR_SIZE - s.designW * k) / 2)
      const offY = Math.round((EDITOR_SIZE - s.designH * k) / 2)
      setSymbolEditor({
        mode: 'create', basedOn: s.label,
        parts: s.parts.map((p) => ({
          ...p, id: uid('p'),
          x: Math.round(p.x * k + offX), y: Math.round(p.y * k + offY),
          w: Math.max(6, Math.round(p.w * k)), h: Math.max(4, Math.round(p.h * k)),
        })),
      })
      return
    }
    const k = Math.min(1, (EDITOR_SIZE - 16) / Math.max(s.w, s.h))
    const w = Math.max(12, Math.round(s.w * k))
    const h = Math.max(10, Math.round(s.h * k))
    setSymbolEditor({
      mode: 'create', basedOn: s.label,
      parts: [{ id: uid('p'), type: s.type, x: Math.round((EDITOR_SIZE - w) / 2), y: Math.round((EDITOR_SIZE - h) / 2), w, h, label: '', fill: s.fill, stroke: s.stroke }],
    })
  }

  const deleteSelection = (sel: Selection) => {
    if (!activeIdRef.current) return
    if (sel.kind === 'shape') {
      // 删除图元时级联删除其上所有连线
      mutate((prev) => ({
        shapes: prev.shapes.filter((s) => s.id !== sel.id),
        connections: prev.connections.filter((c) => c.fromShape !== sel.id && c.toShape !== sel.id),
        marks: prev.marks,
      }))
    } else if (sel.kind === 'conn') {
      mutate((prev) => ({ ...prev, connections: prev.connections.filter((c) => c.id !== sel.id) }))
    } else {
      mutate((prev) => ({ ...prev, marks: prev.marks.filter((m) => m.id !== sel.id) }))
    }
    setSelected(null)
  }

  const deleteSelectionRef = useRef(deleteSelection)
  deleteSelectionRef.current = deleteSelection

  // ---- 以选中图元为基础复制新建（副本偏移 24px，保持形状/尺寸/颜色/标签，便于在既有图元上改造） ----
  const duplicateShape = (s: PidShape) => {
    const copy: PidShape = {
      ...s,
      id: uid('s'),
      x: Math.round(s.x + 24),
      y: Math.round(s.y + 24),
      label: `${s.label}-副本`,
    }
    mutate((prev) => ({ ...prev, shapes: [...prev.shapes, copy] }))
    setSelected({ kind: 'shape', id: copy.id })
    toast({ title: '已复制图元', description: `「${copy.label}」可继续修改形状与属性（记得保存）` })
  }

  const duplicateShapeRef = useRef(duplicateShape)
  duplicateShapeRef.current = duplicateShape

  // ---- 键盘：Delete 删除选中 / Ctrl+D 复制图元 / Esc 取消放置·连线·选中 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (symbolEditorRef.current) return // 图元编辑器界面打开时，画布快捷键全部让位给编辑器
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') {
        if (lineDraftRef.current) {
          lineDraftRef.current = null
          setLineDraft(null)
        }
        else if (placingMark) setPlacingMark(null)
        else if (placingShape) setPlacingShape(null)
        else if (placingSymbol) setPlacingSymbol(null)
        else if (pendingConn) setPendingConn(null)
        else setSelected(null)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        if (mode !== 'edit' || !selected || selected.kind !== 'shape') return
        const s = contentRef.current.shapes.find((sh) => sh.id === selected.id)
        if (!s) return
        e.preventDefault()
        duplicateShapeRef.current(s)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (mode !== 'edit' || !selected) return
        e.preventDefault()
        deleteSelectionRef.current(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, selected, placingMark, placingShape, pendingConn])

  // ---- 画布事件 ----
  const handleCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== 'edit' || (!placingShape && !placingMark && !placingSymbol && !pendingConn)) {
      if (mousePos !== null) setMousePos(null)
      return
    }
    setMousePos(toSvgPoint(e))
  }

  // ---- 画布 pointerdown：空白左键拖拽平移（三态通用）+ 直线橡皮筋（编辑态直线工具） ----
  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // 平移：编辑态放置/连线挂起时让位给落点流程（placingXxx 走 click 落点）；直线绘制模式不平移
    if (e.button === 0 && !(mode === 'edit' && (placingShape || placingMark || placingSymbol || pendingConn))) {
      startPan(e)
    }
    if (mode !== 'edit' || placingShape !== 'line') return
    const p = toSvgPoint(e)
    if (!p) return
    e.preventDefault()
    const sx = p.x
    const sy = p.y
    const setDraft = (d: { sx: number; sy: number; ex: number; ey: number } | null) => {
      lineDraftRef.current = d
      setLineDraft(d)
    }
    setDraft({ sx, sy, ex: sx, ey: sy })
    const onMove = (ev: PointerEvent) => {
      const q = toSvgPoint(ev)
      if (!q) return
      setDraft({ sx, sy, ex: q.x, ey: q.y })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const d = lineDraftRef.current
      setDraft(null)
      lineEndAtRef.current = Date.now()
      if (!d) return
      // 位移过小视为误触单击：不落笔，直线工具保持激活（Esc 退出）
      if (Math.max(Math.abs(d.ex - d.sx), Math.abs(d.ey - d.sy)) < 5) return
      addLineShape(d.sx, d.sy, d.ex, d.ey)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleCanvasClick = (e: React.MouseEvent<SVGElement>) => {
    if (mode !== 'edit') return
    // 平移拖拽刚结束：吞掉本次 click（拖拽画布不等于点击空白）
    if (Date.now() < suppressClickAtRef.current) return
    // 直线走 pointer 橡皮筋流程；刚结束绘制时吞掉紧随其后的 click（否则会误清新线选中态）
    if (placingShape === 'line' || Date.now() - lineEndAtRef.current < 350) return
    // 连线（中段/端点）拖拽刚结束时同样吞 click，保留连线选中态
    if (Date.now() - connDragEndAtRef.current < 350) return
    const p = toSvgPoint(e)
    if (placingShape) {
      if (p) addShapeAt(placingShape, p, placingStdId ?? undefined)
      return
    }
    if (placingSymbol) {
      if (p) addSymbolInstance(placingSymbol, p)
      return
    }
    if (placingMark) {
      if (p) addMarkAt(p)
      return
    }
    if (pendingConn) {
      setPendingConn(null)
      return
    }
    setSelected(null)
  }

  const handleShapeClick = (e: React.MouseEvent<SVGElement>, id: string) => {
    if (mode !== 'edit') return
    if (placingShape || placingMark || placingSymbol || pendingConn) return // 放置/连线挂起时冒泡给画布统一处理
    e.stopPropagation()
    setSelected({ kind: 'shape', id })
  }

  const handleMarkClick = (e: React.MouseEvent<SVGElement>, id: string) => {
    const m = contentRef.current.marks.find((mk) => mk.id === id)
    if (!m) return
    if (mode !== 'edit') {
      // 平移拖拽刚结束：吞掉本次 click（拖拽画布不等于点击挂标，防误开档案抽屉）
      if (Date.now() < suppressClickAtRef.current) return
      // 盲板状态页（查看模式）：点击隔离点挂标 → 打开该点位盲板作业全生命周期抽屉
      e.stopPropagation()
      void openDossier(m, statusMap.get(id))
      return
    }
    if (placingShape || placingMark || placingSymbol) return
    e.stopPropagation()
    setSelected({ kind: 'mark', id })
  }

  const handleConnClick = (e: React.MouseEvent<SVGPolylineElement>, id: string) => {
    if (mode !== 'edit') return
    if (placingShape || placingMark || placingSymbol) return
    e.stopPropagation()
    if (pendingConn) {
      setPendingConn(null)
      return
    }
    setSelected({ kind: 'conn', id })
  }

  const onAnchorClick = (e: React.MouseEvent<SVGElement>, shapeId: string, anchor: Anchor) => {
    e.stopPropagation()
    if (mode !== 'edit' || placingShape || placingMark || placingSymbol) return
    if (!pendingConn) {
      setPendingConn({ shapeId, anchor })
      return
    }
    const { shapeId: fromShape, anchor: fromAnchor } = pendingConn
    setPendingConn(null)
    if (fromShape === shapeId && fromAnchor === anchor) return // 同锚点再点视为取消
    const dup = content.connections.some(
      (c) => c.fromShape === fromShape && c.fromAnchor === fromAnchor && c.toShape === shapeId && c.toAnchor === anchor,
    )
    if (dup) {
      toast({ title: '连线已存在', description: '相同方向的连线已存在，已跳过创建' })
      return
    }
    mutate((prev) => ({
      ...prev,
      connections: [...prev.connections, { id: uid('c'), fromShape, fromAnchor, toShape: shapeId, toAnchor: anchor }],
    }))
  }

  // ---- 拖拽移动（图元 / 标注） ----
  const startDragShape = (e: React.PointerEvent<SVGElement>, s: PidShape) => {
    if (mode !== 'edit' || placingShape || placingMark || placingSymbol) return
    e.stopPropagation()
    const start = toSvgPoint(e)
    if (!start) return
    const offX = start.x - s.x
    const offY = start.y - s.y
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const p = toSvgPoint(ev)
      if (!p) return
      moved = true
      // 无限画布：拖拽不限制在 0..CANVAS_W（与放置/缩放边界策略一致）
      const nx = Math.round(p.x - offX)
      const ny = Math.round(p.y - offY)
      setContent((prev) => ({
        ...prev,
        shapes: prev.shapes.map((sh) => (sh.id === s.id ? { ...sh, x: nx, y: ny } : sh)),
      }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) setDirty(true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startDragMark = (e: React.PointerEvent<SVGElement>, m: PidMark) => {
    if (mode !== 'edit' || placingShape || placingMark || placingSymbol) return
    e.stopPropagation()
    const start = toSvgPoint(e)
    if (!start) return
    const offX = start.x - m.x
    const offY = start.y - m.y
    let moved = false
    let last = { x: m.x, y: m.y } // 拖拽终点（移动判定以此为准）
    const onMove = (ev: PointerEvent) => {
      const p = toSvgPoint(ev)
      if (!p) return
      moved = true
      const nx = Math.round(p.x - offX)
      const ny = Math.round(p.y - offY)
      last = { x: nx, y: ny }
      setContent((prev) => ({
        ...prev,
        marks: prev.marks.map((mk) => (mk.id === m.id ? { ...mk, x: nx, y: ny } : mk)),
      }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!moved) return
      setDirty(true)
      // 移动终点：按落点所属管线与当前归属不一致时弹确认
      checkMarkPipeOwnership({ ...m, x: last.x, y: last.y })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- 管线号标注沿线拖动：指针位置投影到连线折线，标注只能沿管线滑动（不偏离折线） ----
  const startDragConnLabel = (e: React.PointerEvent<SVGElement>, c: PidConn) => {
    if (mode !== 'edit' || placingShape || placingMark || placingSymbol) return
    e.stopPropagation()
    const ct = contentRef.current
    const from = ct.shapes.find((s) => s.id === c.fromShape)
    const to = ct.shapes.find((s) => s.id === c.toShape)
    if (!from || !to) return
    // 拖拽期间图元不动，折线在闭包内预先算好（与渲染同源：anchorPoint + routeConnection）
    const a = anchorPoint(from, c.fromAnchor)
    const b = anchorPoint(to, c.toAnchor)
    const pts = routeConnection(
      { x: a.x, y: a.y, anchor: c.fromAnchor },
      { x: b.x, y: b.y, anchor: c.toAnchor },
      c.fromShape === c.toShape,
    )
    let moved = false
    setDraggingLabelId(c.id)
    const onMove = (ev: PointerEvent) => {
      const p = toSvgPoint(ev)
      if (!p) return
      const proj = projectToPolyline(pts, p.x, p.y)
      if (!proj) return
      moved = true
      // 投影参数 clamp 在两端 6% 内（不盖住锚点/设备），保留 3 位小数存储
      const t = Math.round(clamp(proj.t, LABEL_T_MIN, LABEL_T_MAX) * 1000) / 1000
      setContent((prev) => ({
        ...prev,
        connections: prev.connections.map((cc) => (cc.id === c.id ? { ...cc, labelT: t } : cc)),
      }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDraggingLabelId(null)
      if (moved) setDirty(true)
      // 原地点击的选中在命中区 onClick（stopPropagation）里处理，避免被 svg 根 click 清除
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- 连线中段拖拽：H-H 路由竖直中段横向移动 / V-V 路由水平中段纵向移动（写入 midOverride，折线实时重排） ----
  const startDragConnSeg = (e: React.PointerEvent<SVGElement>, c: PidConn, axis: 'x' | 'y') => {
    if (mode !== 'edit' || placingShape || placingMark || placingSymbol) return
    e.stopPropagation()
    setDraggingConnSeg(c.id)
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const p = toSvgPoint(ev)
      if (!p) return
      moved = true
      const val = Math.round(axis === 'x' ? p.x : p.y) // 无限画布：中段覆盖值不限制在画布内
      setContent((prev) => ({
        ...prev,
        connections: prev.connections.map((cc) => (cc.id === c.id ? { ...cc, midOverride: val } : cc)),
      }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDraggingConnSeg(null)
      connDragEndAtRef.current = Date.now()
      if (moved) setDirty(true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- 连线端点拖拽改接：拖起起点/终点 → 移动中吸附最近图元锚点并实时预览折线 → 松手改接（无目标回退，改接后清 midOverride 重新自动布线） ----
  const startDragConnEnd = (e: React.PointerEvent<SVGElement>, c: PidConn, which: 'from' | 'to') => {
    if (mode !== 'edit' || placingShape || placingMark || placingSymbol) return
    e.stopPropagation()
    const start = toSvgPoint(e)
    if (!start) return
    setConnEndDrag({ id: c.id, which, x: start.x, y: start.y, hover: null })
    let hover: { shapeId: string; anchor: Anchor } | null = null
    const onMove = (ev: PointerEvent) => {
      const p = toSvgPoint(ev)
      if (!p) return
      hover = null
      let bestD = CONN_END_SNAP_DIST
      for (const s of contentRef.current.shapes) {
        for (const a of ANCHORS) {
          const ap = anchorPoint(s, a)
          const d = Math.hypot(p.x - ap.x, p.y - ap.y)
          if (d < bestD) {
            bestD = d
            hover = { shapeId: s.id, anchor: a }
          }
        }
      }
      setConnEndDrag({ id: c.id, which, x: p.x, y: p.y, hover })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setConnEndDrag(null)
      connDragEndAtRef.current = Date.now()
      const target = hover
      if (!target) return // 空白处松手：回退原接线
      const cc = contentRef.current.connections.find((x) => x.id === c.id)
      if (!cc) return
      const otherShape = which === 'from' ? cc.toShape : cc.fromShape
      const otherAnchor = which === 'from' ? cc.toAnchor : cc.fromAnchor
      const changed = which === 'from'
        ? cc.fromShape !== target.shapeId || cc.fromAnchor !== target.anchor
        : cc.toShape !== target.shapeId || cc.toAnchor !== target.anchor
      if (!changed) return
      if (target.shapeId === otherShape && target.anchor === otherAnchor) {
        toast({ title: '无法改接', description: '起点与终点不能落在同一锚点' })
        return
      }
      const dup = contentRef.current.connections.some((x) =>
        x.id !== cc.id && (
          which === 'from'
            ? x.fromShape === target.shapeId && x.fromAnchor === target.anchor && x.toShape === cc.toShape && x.toAnchor === cc.toAnchor
            : x.fromShape === cc.fromShape && x.fromAnchor === cc.fromAnchor && x.toShape === target.shapeId && x.toAnchor === target.anchor
        ),
      )
      if (dup) {
        toast({ title: '连线已存在', description: '相同方向的连线已存在，已保留原接线' })
        return
      }
      const patch = which === 'from' ? { fromShape: target.shapeId, fromAnchor: target.anchor } : { toShape: target.shapeId, toAnchor: target.anchor }
      mutate((prev) => ({
        ...prev,
        connections: prev.connections.map((x) => (x.id === c.id ? { ...x, ...patch, midOverride: undefined } : x)),
      }))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- 四角缩放：对角为固定点，nw/sw 时 x/y 跟随变化；直线拖任意手柄 = 拖动该端点（可实时翻转向） ----
  const startResize = (e: React.PointerEvent<SVGElement>, s: PidShape, handle: ResizeHandle) => {
    if (mode !== 'edit' || placingShape || placingMark || placingSymbol) return
    e.stopPropagation()
    e.preventDefault()
    const lib = libOf(s.type)
    const minW = lib.minW
    const minH = lib.minH
    // 固定点 = 对角
    const fx = handle === 'nw' || handle === 'sw' ? s.x + s.w : s.x
    const fy = handle === 'nw' || handle === 'ne' ? s.y + s.h : s.y
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const raw = toSvgPoint(ev)
      if (!raw) return
      moved = true
      const px = raw.x // 无限画布：缩放指针/新边界不再限制在 0..CANVAS_W
      const py = raw.y
      let x1 = Math.min(fx, px)
      let x2 = Math.max(fx, px)
      let y1 = Math.min(fy, py)
      let y2 = Math.max(fy, py)
      if (x2 - x1 < minW) {
        if (px < fx) x1 = x2 - minW
        else x2 = x1 + minW
      }
      if (y2 - y1 < minH) {
        if (py < fy) y1 = y2 - minH
        else y2 = y1 + minH
      }
      if (s.type === 'circle') {
        // 圆形锁定正圆比例：以对角固定点为锚，取最大边同步宽高（拖成椭圆的需求请用椭圆图元）
        const size = Math.max(x2 - x1, y2 - y1)
        if (px >= fx) x2 = x1 + size
        else x1 = x2 - size
        if (py >= fy) y2 = y1 + size
        else y1 = y2 - size
      }
      const w = Math.max(minW, Math.round(x2 - x1))
      const h = Math.max(minH, Math.round(y2 - y1))
      setContent((prev) => ({
        ...prev,
        shapes: prev.shapes.map((sh) => (
          sh.id === s.id
            ? { ...sh, x: Math.round(x1), y: Math.round(y1), w, h, ...(s.type === 'line' ? { flip: (px >= fx) !== (py >= fy) } : null) }
            : sh
        )),
      }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) setDirty(true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- 图管理 ----
  const openNew = () => {
    setNewForm({ name: '', unitId: 'none' })
    setNewOpen(true)
  }

  // ---- AI 识别导入完成后：刷新列表与绑定选项，选中新图 ----
  const handleImportDone = useCallback(async (diagramId: number) => {
    const list = await loadDiagrams()
    void loadBindOptions()
    if (list.some((d) => d.id === diagramId)) await selectDiagram(diagramId)
  }, [loadDiagrams, loadBindOptions, selectDiagram])

  const createDiagram = async () => {
    const name = newForm.name.trim()
    if (!name) {
      toast({ title: '请输入图名称', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const body: Record<string, unknown> = {
        name,
        content: JSON.stringify(EMPTY_CONTENT),
        __actorId: currentUser.id,
        __actorName: currentUser.name,
      }
      if (newForm.unitId !== 'none') body.unitId = Number(newForm.unitId)
      const res = await apiPost<{ id?: number; item?: { id?: number } }>('/api/pid-diagrams', body)
      setNewOpen(false)
      const list = await loadDiagrams()
      const newId = res?.id ?? res?.item?.id ?? null
      const target = newId != null ? list.find((d) => d.id === newId) : list.find((d) => d.name === name)
      if (target) await selectDiagram(target.id)
      toast({ title: '成功', description: `组态图「${name}」已创建` })
    } catch (err) {
      toast({ title: '创建失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const submitRename = async () => {
    if (!activeId) return
    const name = renameVal.trim()
    if (!name) {
      toast({ title: '请输入图名称', variant: 'destructive' })
      return
    }
    setRenaming(true)
    try {
      await apiPut(`/api/pid-diagrams/${activeId}`, {
        name,
        __actorId: currentUser.id,
        __actorName: currentUser.name,
      })
      setRenameOpen(false)
      setDetailName(name)
      await loadDiagrams()
      toast({ title: '成功', description: `组态图已重命名为「${name}」` })
    } catch (err) {
      toast({ title: '重命名失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setRenaming(false)
    }
  }

  const confirmDeleteDiagram = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    try {
      await apiDelete(`/api/pid-diagrams/${target.id}?__actorId=${encodeURIComponent(currentUser.id)}&__actorName=${encodeURIComponent(currentUser.name)}`)
      toast({ title: '成功', description: `组态图「${target.name}」已删除` })
      setDeleteTarget(null)
      const wasActive = target.id === activeId
      await loadDiagrams()
      if (wasActive) {
        setActiveId(null)
        setDetailName('')
        setContent(EMPTY_CONTENT)
        setDirty(false)
        setSelected(null)
        setStatusPoints([])
        setStatusAt(null)
      }
    } catch (err) {
      toast({ title: '删除失败', description: (err as Error).message, variant: 'destructive' })
    }
  }

  // ---- 删除自定义图元 ----
  const confirmDeleteSymbol = async () => {
    if (!deleteSymbolTarget) return
    const target = deleteSymbolTarget
    try {
      await apiDelete(`/api/pid-symbols/${target.id}`)
      toast({ title: '成功', description: `自定义图元「${target.name}」已删除，画布上已放置的实例不受影响` })
      setDeleteSymbolTarget(null)
      await loadSymbols()
    } catch (err) {
      toast({ title: '删除失败', description: (err as Error).message, variant: 'destructive' })
    }
  }

  // ---- 确认更新隔离点所属管线（挂标位置自动计算结果，写回隔离点主数据） ----
  const confirmPipeOwnership = async () => {
    if (!pipePrompt) return
    const p = pipePrompt
    setPipePromptBusy(true)
    try {
      await apiPut(`/api/iso-point-masters/${p.masterPointId}`, { pipelineId: p.toId })
      setMasterPoints((prev) =>
        prev.map((mp) => (mp.id === p.masterPointId ? { ...mp, pipelineId: p.toId, pipelineName: p.toLabel } : mp)),
      )
      setPipePrompt(null)
      toast({ title: '所属关系已更新', description: `${p.code} 所属管线更新为 ${p.toLabel}（隔离点台账同步生效）` })
    } catch (err) {
      toast({ title: '更新失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setPipePromptBusy(false)
    }
  }

  // ---- 标注隔离点 ----
  const filteredMasters = useMemo(() => {
    const kw = markKeyword.trim().toLowerCase()
    if (!kw) return masterPoints
    return masterPoints.filter((mp) =>
      [mp.code, mp.name, mp.pipelineName ?? ''].some((v) => v.toLowerCase().includes(kw)),
    )
  }, [masterPoints, markKeyword])

  const pickMasterPoint = (mp: MasterPoint) => {
    setMarkDialogOpen(false)
    setPlacingMark(mp)
    toast({ title: '进入放置模式', description: `在画布上点击位置放置 ${mp.code}，Esc 取消` })
  }

  // ---- 渲染：连线（路径实时推导，自动跟随） ----
  const renderConnections = () =>
    content.connections.map((c) => {
      const from = shapeMap.get(c.fromShape)
      const to = shapeMap.get(c.toShape)
      if (!from || !to) return null
      const a = anchorPoint(from, c.fromAnchor)
      const b = anchorPoint(to, c.toAnchor)
      const pts = routeConnection(
        { x: a.x, y: a.y, anchor: c.fromAnchor },
        { x: b.x, y: b.y, anchor: c.toAnchor },
        c.fromShape === c.toShape,
        c.midOverride,
      )
      const ptsAttr = pts.map((p) => p.join(',')).join(' ')
      const isSel = selected?.kind === 'conn' && selected.id === c.id
      const midPt = pts[Math.floor(pts.length / 2)]
      // 中段拖拽提示：H-H/V-V 路由选中时中段显示可拖虚线（竖线横向 / 横线纵向）
      const cA = c.fromAnchor === 'left' || c.fromAnchor === 'right'
      const cB = c.toAnchor === 'left' || c.toAnchor === 'right'
      const segDraggable = mode === 'edit' && isSel && c.fromShape !== c.toShape && pts.length >= 4 && ((cA && cB) || (!cA && !cB))
      // 流向：forward 起点→终点（缺省）/ reverse 终点→起点 / none 无向；反向时起点端同步出箭头
      const dir = c.direction ?? 'forward'
      const arrowStart = dir === 'reverse' ? (isSel ? 'url(#bp-pid-arrow-rose)' : 'url(#bp-pid-arrow)') : undefined
      const arrowEnd = dir === 'forward' ? (isSel ? 'url(#bp-pid-arrow-rose)' : 'url(#bp-pid-arrow)') : undefined
      return (
        <g key={c.id}>
          <polyline
            points={ptsAttr} fill="none"
            stroke={isSel ? ROSE : LINE}
            strokeWidth={isSel ? 2.4 : 2}
            markerStart={arrowStart}
            markerEnd={arrowEnd}
          />
          {mode === 'edit' && (
            <polyline
              points={ptsAttr} fill="none" stroke="transparent" strokeWidth={12} className="cursor-pointer"
              onClick={(e) => handleConnClick(e, c.id)}
            />
          )}
          {/* 中段拖拽提示线（选中态）：拖动可横向/纵向调整布线 */}
          {segDraggable && (
            <line
              x1={pts[1][0]} y1={pts[1][1]} x2={pts[2][0]} y2={pts[2][1]}
              stroke={draggingConnSeg === c.id ? ROSE : TEAL}
              strokeWidth={draggingConnSeg === c.id ? 3.2 : 1.4}
              strokeDasharray="4 3" opacity={0.9} pointerEvents="none"
            />
          )}
          {/* 已绑定管线的管线号徽章改为统一在 renderConnBadges 渲染（层级高于所有连线，避免被其他连线的点击层遮挡） */}
          {isSel && mode === 'edit' && (
            <g
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                deleteSelection({ kind: 'conn', id: c.id })
              }}
            >
              <circle cx={midPt[0]} cy={midPt[1]} r={9} fill="#fff" stroke={ROSE} strokeWidth={1.4} />
              <line x1={midPt[0] - 3.5} y1={midPt[1] - 3.5} x2={midPt[0] + 3.5} y2={midPt[1] + 3.5} stroke={ROSE} strokeWidth={1.6} />
              <line x1={midPt[0] - 3.5} y1={midPt[1] + 3.5} x2={midPt[0] + 3.5} y2={midPt[1] - 3.5} stroke={ROSE} strokeWidth={1.6} />
            </g>
          )}
        </g>
      )
    })

  // ---- 渲染：管线号徽章独立图层（在全部连线之后渲染，层级高于所有连线折线/点击层，避免重叠连线遮挡徽章拖拽） ----
  const renderConnBadges = () =>
    content.connections.map((c) => {
      if (c.pipelineId == null) return null
      const from = shapeMap.get(c.fromShape)
      const to = shapeMap.get(c.toShape)
      if (!from || !to) return null
      const a = anchorPoint(from, c.fromAnchor)
      const b = anchorPoint(to, c.toAnchor)
      const pts = routeConnection(
        { x: a.x, y: a.y, anchor: c.fromAnchor },
        { x: b.x, y: b.y, anchor: c.toAnchor },
        c.fromShape === c.toShape,
        c.midOverride,
      )
      const pipe = pipeOptions.find((p) => p.id === c.pipelineId)
      if (!pipe) return null
      const label = pipe.code
      const wHalf = label.length * 3.4 + 6
      const lt = clamp(typeof c.labelT === 'number' ? c.labelT : 0.5, 0, 1)
      const lp = pointAlongPolyline(pts, lt) ?? { x: pts[0][0], y: pts[0][1] }
      const dragging = draggingLabelId === c.id
      const isSel = selected?.kind === 'conn' && selected.id === c.id
      const badgeStroke = dragging || isSel ? ROSE : '#0d9488'
      return (
        <g key={`badge-${c.id}`} pointerEvents={mode === 'edit' ? undefined : 'none'}>
          {mode === 'edit' && (
            <rect
              x={lp.x - wHalf - 5} y={lp.y - 11} width={wHalf * 2 + 10} height={22} rx={6}
              fill="transparent" className="cursor-grab"
              onPointerDown={(e) => startDragConnLabel(e, c)}
              onClick={(e) => {
                e.stopPropagation()
                setSelected({ kind: 'conn', id: c.id })
              }}
            >
              <title>拖动可沿线调整标注位置（只能沿管线移动）</title>
            </rect>
          )}
          <rect x={lp.x - wHalf} y={lp.y - 8} width={wHalf * 2} height={16} rx={4}
            fill="#fff" stroke={badgeStroke} strokeWidth={dragging ? 1.6 : 1} opacity={0.95} pointerEvents="none" />
          <text x={lp.x} y={lp.y + 3.5} textAnchor="middle" fontSize={9} fontFamily="ui-monospace, monospace"
            fill={badgeStroke === ROSE ? ROSE : '#0f766e'} pointerEvents="none">{label}</text>
        </g>
      )
    })

  // ---- 渲染：图元（含选中框/缩放手柄/锚点） ----
  const renderShapes = () =>
    content.shapes.map((s) => {
      const isSel = selected?.kind === 'shape' && selected.id === s.id
      const showAnchors = mode === 'edit' && (hoverShapeId === s.id || isSel || pendingConn?.shapeId === s.id)
      // 手柄显示位置 clamp 进当前视口（无限画布下贴边图元的角手柄不被裁剪、始终可点）；缩放计算基于指针位置不受影响
      const clampV = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
      const vx0 = vbRef.current.x + 2
      const vx1 = vbRef.current.x + vbRef.current.w - 2
      const vy0 = vbRef.current.y + 2
      const vy1 = vbRef.current.y + vbRef.current.h - 2
      const handles: [ResizeHandle, number, number, string][] = [
        ['nw', clampV(s.x - 6, vx0, vx1), clampV(s.y - 6, vy0, vy1), 'nwse-resize'],
        ['ne', clampV(s.x + s.w + 6, vx0, vx1), clampV(s.y - 6, vy0, vy1), 'nesw-resize'],
        ['sw', clampV(s.x - 6, vx0, vx1), clampV(s.y + s.h + 6, vy0, vy1), 'nesw-resize'],
        ['se', clampV(s.x + s.w + 6, vx0, vx1), clampV(s.y + s.h + 6, vy0, vy1), 'nwse-resize'],
      ]
      return (
        <g
          key={s.id}
          onPointerDown={(e) => startDragShape(e, s)}
          onClick={(e) => handleShapeClick(e, s.id)}
          onPointerEnter={() => {
            if (mode === 'edit') setHoverShapeId(s.id)
          }}
          onPointerLeave={() => setHoverShapeId((prev) => (prev === s.id ? null : prev))}
          className={mode === 'edit' ? 'cursor-move' : undefined}
        >
          <ShapeBody s={s} />
          {/* 已绑定设备：左上角 emerald 圆点角标（hover 提示设备位号） */}
          {s.equipmentId != null && (() => {
            const eq = equipOptions.find((x) => x.id === s.equipmentId)
            return (
              <g pointerEvents="none">
                <circle cx={s.x + 2} cy={s.y + 2} r={4.5} fill="#059669" stroke="#fff" strokeWidth={1.4} />
                <title>{eq ? `已绑定设备：${eq.code} ${eq.name}` : `已绑定设备 #${s.equipmentId}`}</title>
              </g>
            )
          })()}
          <text
            x={s.x + s.w / 2} y={shapeLabelY(s)} textAnchor="middle" fontSize={12} fill="#57534e"
            stroke="#fff" strokeWidth={3} paintOrder="stroke"
          >
            {s.label}
          </text>
          {isSel && mode === 'edit' && (
            <>
              <rect
                x={s.x - 6} y={s.y - 6} width={s.w + 12} height={s.h + 12} rx={4}
                fill="none" stroke={TEAL} strokeWidth={1.2} strokeDasharray="5 3"
              />
              {handles.map(([hd, hx, hy, cur]) => (
                <rect
                  key={hd} x={hx - 4} y={hy - 4} width={8} height={8}
                  fill="#fff" stroke={TEAL} strokeWidth={1.3} style={{ cursor: cur }}
                  onPointerDown={(e) => startResize(e, s, hd)}
                />
              ))}
            </>
          )}
          {showAnchors &&
            ANCHORS.map((a) => {
              const p = anchorPoint(s, a)
              const key = `${s.id}:${a}`
              return (
                <circle
                  key={a} cx={p.x} cy={p.y} r={hoverAnchor === key ? 7 : 5}
                  fill={TEAL} stroke="#fff" strokeWidth={1.5} className="cursor-crosshair"
                  onPointerEnter={(e) => {
                    e.stopPropagation()
                    setHoverAnchor(key)
                  }}
                  onPointerLeave={() => setHoverAnchor((prev) => (prev === key ? null : prev))}
                  onClick={(e) => onAnchorClick(e, s.id, a)}
                />
              )
            })}
        </g>
      )
    })

  // ---- 渲染：隔离点标注（编辑态可拖拽选中；查看态可点击打开作业档案抽屉） ----
  const renderMarks = () =>
    content.marks.map((m) => {
      const st = statusMap.get(m.id)
      const state = normalizeState(st?.state)
      const isSel = selected?.kind === 'mark' && selected.id === m.id
      return (
        <g
          key={m.id}
          onPointerDown={(e) => startDragMark(e, m)}
          onClick={(e) => handleMarkClick(e, m.id)}
          className={mode === 'edit' ? 'cursor-move' : 'cursor-pointer'}
        >
          {mode !== 'edit' && <title>点击查看该点位盲板作业全生命周期档案</title>}
          {isSel && mode === 'edit' && (
            <circle cx={m.x} cy={m.y} r={11} fill="none" stroke={TEAL} strokeWidth={1.2} strokeDasharray="3 2" />
          )}
          <MarkGlyph m={m} edit={mode === 'edit'} state={state} stateLabel={st?.stateLabel ?? ''} />
          {/* 编辑态：挂标当前所属管线号小徽章（自动计算/确认更新后实时可见） */}
          {mode === 'edit' && m.masterPointId != null && (() => {
            const mp = masterById.get(m.masterPointId)
            const pipeCode = mp?.pipelineName
              ?? (mp?.pipelineId != null ? pipeOptions.find((p) => p.id === mp.pipelineId)?.code ?? null : null)
            if (!pipeCode) return null
            const w = pipeCode.length * 5.6 + 10
            return (
              <g pointerEvents="none">
                <rect x={m.x - w / 2} y={m.y + 26} width={w} height={13} rx={3} fill="#f0fdfa" stroke="#5eead4" strokeWidth={0.8} />
                <text x={m.x} y={m.y + 35.5} textAnchor="middle" fontSize={8.5} fontFamily="ui-monospace, monospace" fill="#0f766e">{pipeCode}</text>
              </g>
            )
          })()}
        </g>
      )
    })

  const placingShapeLib = placingShape ? libOf(placingShape) : null
  const placingStdSym = placingShape === 'std' && placingStdId ? STD_SYMBOL_MAP[placingStdId] ?? null : null
  const placingLabel = placingStdSym?.label ?? placingShapeLib?.label ?? ''

  // 点位档案过滤：进行中作业 + 当日完工作业显示；今日以前完工的历史作业隐藏（按浏览器本地时区判定“当天”）
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const allDossierChains = dossierData?.chains ?? []
  const visibleDossierChains = allDossierChains.filter(
    (c) => c.active || (c.finishedAt ? new Date(c.finishedAt).getTime() >= todayStart.getTime() : true),
  )
  const hiddenDossierCount = allDossierChains.length - visibleDossierChains.length

  // ---- 独立图元编辑界面：跳转式全替换视图（编辑/新建自定义图元） ----
  if (symbolEditor) {
    return (
      <div ref={wrapRef} className={cn(full && 'fixed inset-0 z-40 overflow-auto bg-stone-100 p-4')}>
        <Card className={cn(full && 'min-h-full rounded-none border-none shadow-none')}>
          <SymbolEditor
            ctx={symbolEditor}
            currentUser={currentUser}
            onClose={() => setSymbolEditor(null)}
            onSaved={(nm, m) => {
              setSymbolEditor(null)
              void loadSymbols()
              toast({
                title: m === 'edit' ? '图元已更新' : '图元已保存',
                description: `「${nm}」已出现在左侧「自定义」页签，点击即可放置到画布`,
              })
            }}
          />
        </Card>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={cn(full && 'fixed inset-0 z-40 overflow-auto bg-stone-100 p-4')}>
    <Card className={cn(full && 'min-h-full rounded-none border-none shadow-none')}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {readOnly ? <MonitorDot className="h-4 w-4 text-teal-700" /> : <Workflow className="h-4 w-4 text-teal-700" />}
              {readOnly ? '盲板状态 · 组态图只读查看' : 'PID 组态编辑器'}
            </CardTitle>
          </div>
          {activeDiagram && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-stone-200 bg-stone-50 font-mono text-stone-600">
                图元 {content.shapes.length}
              </Badge>
              <Badge variant="outline" className="border-stone-200 bg-stone-50 font-mono text-stone-600">
                连线 {content.connections.length}
              </Badge>
              <Badge variant="outline" className="border-teal-200 bg-teal-50 font-mono text-teal-700">
                标注 {content.marks.length}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 工具条 */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={activeId != null ? String(activeId) : ''}
            onValueChange={(v) => void selectDiagram(Number(v))}
          >
            <SelectTrigger className="h-10 w-[210px]" disabled={diagramsLoading || diagrams.length === 0}>
              <SelectValue placeholder={diagramsLoading ? '加载中…' : '选择组态图'} />
            </SelectTrigger>
            <SelectContent>
              {diagrams.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!readOnly && (
          <Button variant="outline" className="h-10 w-10 p-0" title="新建组态图" onClick={openNew}>
            <Plus className="h-4 w-4" />
          </Button>
          )}
          {!readOnly && (
          <Button
            variant="outline"
            className="h-10 w-10 border-violet-200 bg-violet-50 p-0 text-violet-700 hover:bg-violet-100"
            title="AI 识别导入：上传 PID 图纸，AI 识别设备/管线/隔离点并一键生成主数据与组态图"
            onClick={() => setImportOpen(true)}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
          )}
          {!readOnly && (
          <Button
            variant="outline" className="h-10 w-10 p-0"
            title="重命名当前组态图"
            disabled={!activeDiagram}
            onClick={() => {
              setRenameVal(detailName)
              setRenameOpen(true)
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          )}
          {!readOnly && (
          <Button
            variant="outline"
            className="h-10 w-10 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            title="删除当前组态图"
            disabled={!activeDiagram}
            onClick={() => activeDiagram && setDeleteTarget(activeDiagram)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          )}
          <div className="mx-1 h-6 w-px bg-stone-200" />
          {!readOnly && (
          <Tabs value={mode} onValueChange={(v) => void switchMode(v as 'edit' | 'view')}>
            <TabsList>
              <TabsTrigger value="edit" className="px-4">编辑</TabsTrigger>
              <TabsTrigger value="view" className="px-4">查看</TabsTrigger>
            </TabsList>
          </Tabs>
          )}
          <div className="flex-1" />
          {mode === 'edit' ? (
            <>
              <Button
                variant="outline"
                className="h-10 w-10 border-teal-300 p-0 text-teal-700 hover:bg-teal-50"
                title="标注隔离点"
                disabled={!activeId}
                onClick={() => {
                  setMarkKeyword('')
                  setMarkDialogOpen(true)
                }}
              >
                <MapPin className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-10 w-10 border-violet-300 p-0 text-violet-700 hover:bg-violet-50"
                title="新建图元：进入独立图元编辑器，用基础图形或已有图元组合新的自定义图元"
                onClick={enterCreateSymbol}
              >
                <Shapes className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-10 w-10 p-0"
                title="自动布局：按管线连接关系自左向右分层排列图元（未连线图元在下方网格排列），连线锚点自动适配，隔离点标注跟随所在管线"
                disabled={!activeId || content.shapes.length === 0}
                onClick={() => setLayoutConfirmOpen(true)}
              >
                <Wand2 className="h-4 w-4" />
              </Button>
              <Button
                className="relative h-10 w-10 bg-emerald-700 p-0 text-white hover:bg-emerald-800"
                title={dirty ? '保存（有未保存更改）' : '保存'}
                disabled={!activeId || saving}
                onClick={() => void handleSave()}
              >
                <Save className="h-4 w-4" />
                {dirty && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white" title="有未保存更改" />}
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <span>状态{statusAt ? `更新于 ${fmtDateTime(statusAt)}` : '未加载'} · 每 10s 自动刷新</span>
              <Button
                variant="outline" className="h-9 w-9 p-0"
                title="立即刷新隔离点状态"
                disabled={!activeId}
                onClick={() => setStatusTick((t) => t + 1)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="mx-1 hidden h-6 w-px bg-stone-200 sm:block" />
          <Button
            variant="outline"
            className={cn('h-10 w-10 p-0', minimapOpen && 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100')}
            title="俯瞰图开关：画布右下角显示整图缩略导航，点击/拖拽缩略图快速移动画布视口"
            aria-pressed={minimapOpen}
            onClick={() => setMinimapOpen((v) => !v)}
          >
            <MapIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-10 w-10 p-0"
            title={full ? '退出全屏（Esc）' : '全屏显示（Esc 退出）'}
            onClick={full ? exitFull : enterFull}
          >
            {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>

        {diagrams.length === 0 && !diagramsLoading ? (
          /* 空态：还没有任何组态图 */
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-100 text-stone-400">
              <Workflow className="h-7 w-7" />
            </div>
            <div className="text-sm font-medium text-stone-700">还没有组态图</div>
            <p className="max-w-sm text-xs leading-relaxed text-stone-500">
              创建第一张 PID 组态图，从左侧图元库放置泵、塔器、换热器等标准图元，连接管线并标注隔离点位置
            </p>
            <Button size="sm" className="mt-1 h-10 bg-emerald-700 px-5 text-white hover:bg-emerald-800" onClick={openNew}>
              <Plus className="h-4 w-4" /> 新建组态图
            </Button>
          </div>
        ) : (
          <div ref={canvasRowRef} className="flex items-stretch gap-3" style={canvasH > 0 ? { height: canvasH } : undefined}>
            {/* 左侧图元库（编辑模式）：设备图元 + 基础图形两组 */}
            {mode === 'edit' && (
              <div className="flex w-60 shrink-0 flex-col rounded-lg border bg-white">
                <div className="border-b px-3 py-2 text-xs font-medium text-stone-500">图元库</div>
                <div className="flex gap-1 border-b px-2 py-1.5">
                  {([['std', '内建图元'], ['basic', '基础图形'], ['custom', '自定义']] as const).map(([v, lbl]) => (
                    <button
                      key={v} type="button"
                      onClick={() => setLibTab(v)}
                      className={cn(
                        'flex-1 rounded-md px-1 py-1 text-[11px] font-medium transition-colors',
                        libTab === v ? 'bg-teal-50 text-teal-800' : 'text-stone-500 hover:bg-stone-50',
                      )}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                {libTab === 'std' && (
                  <div className="border-b px-2 py-1.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-stone-400" />
                      <input
                        value={stdSearch}
                        onChange={(e) => setStdSearch(e.target.value)}
                        placeholder="搜索图元：名称/说明/分类…"
                        aria-label="搜索内建图元"
                        className="h-7 w-full rounded-md border border-stone-200 bg-stone-50 pl-6 pr-6 text-[11px] text-stone-700 placeholder:text-stone-400 focus:border-teal-400 focus:bg-white focus:outline-none"
                      />
                      {stdSearch && (
                        <button
                          type="button"
                          aria-label="清空搜索"
                          onClick={() => setStdSearch('')}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-stone-400 hover:text-stone-600"
                        >
                          <CloseIcon className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <StdSymbolStyle />
                {/* 悬停信息卡（fixed 定位不受侧栏滚动裁剪） */}
                {libHover && (
                  <div
                    className="pointer-events-none fixed z-50 w-52 rounded-md border border-stone-200 bg-white px-2.5 py-2 shadow-lg"
                    style={{
                      left: Math.min(libHover.x + 8, (typeof window !== 'undefined' ? window.innerWidth : 1920) - 224),
                      top: Math.min(libHover.y, (typeof window !== 'undefined' ? window.innerHeight : 1080) - 120),
                    }}
                  >
                    <div className="text-xs font-semibold text-stone-700">{libHover.title}</div>
                    {libHover.lines.map((l, i) => (
                      <div key={i} className={cn('text-[10px] leading-relaxed', i === 0 ? 'text-teal-700' : 'text-stone-500')}>{l}</div>
                    ))}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto p-2 bp-thin-scrollbar">
                  {/* 基础图形：内置形状宫格（缩略图复用 ShapeBody 画布渲染）·手风琴分类 */}
                  {libTab === 'basic' && (
                    <LibSection label="基础形状" count={SHAPE_LIBRARY.filter((i) => i.group === 'basic').length} open={!!openGroups.basic} onToggle={() => toggleGroup('basic')}>
                      {SHAPE_LIBRARY.filter((item) => item.group === 'basic').map((item) => {
                        const activePlacing = placingShape === item.type
                        return (
                          <div
                            key={item.type}
                            className={cn(
                              'group relative rounded-md border p-1 transition-colors',
                              activePlacing ? 'border-teal-400 bg-teal-50' : 'border-stone-200 hover:border-teal-300 hover:bg-stone-50',
                            )}
                            onMouseEnter={(e) => {
                              const r = e.currentTarget.getBoundingClientRect()
                              setLibHover({ title: item.label, lines: [`默认尺寸 ${item.w}×${item.h}`, '点击选择后点击画布放置'], x: r.right, y: r.top })
                            }}
                            onMouseLeave={() => setLibHover(null)}
                          >
                            <button
                              type="button"
                              aria-label={`放置${item.label}`}
                              onClick={() => {
                                setPlacingShape(activePlacing ? null : item.type)
                                setPlacingStdId(null)
                                setPlacingSymbol(null)
                                setPlacingMark(null)
                                setPendingConn(null)
                              }}
                              className="flex h-14 w-full items-center justify-center"
                            >
                              <svg viewBox={`0 0 ${item.w} ${item.h}`} className="max-h-12 max-w-full" aria-hidden="true">
                                <ShapeBody s={{ id: `lib-${item.type}`, type: item.type, x: 0, y: 0, w: item.w, h: item.h, label: '' }} />
                              </svg>
                            </button>
                            <div className="truncate px-0.5 pb-0.5 text-center text-[10px] leading-tight text-stone-500">{item.label}</div>
                            <button
                              type="button"
                              title={`以「${item.label}」为基础新建图元（进入图元编辑器）`}
                              className="absolute right-0.5 top-0.5 hidden rounded bg-white/90 p-0.5 text-stone-300 shadow-sm transition-colors hover:text-violet-600 group-hover:block"
                              onClick={(e) => {
                                e.stopPropagation()
                                enterEditorFromLib(item)
                              }}
                            >
                              <Shapes className="h-3 w-3" />
                            </button>
                          </div>
                        )
                      })}
                    </LibSection>
                  )}
                  {/* 内建图元：五大分类→子分类两级手风琴 + 搜索过滤 */}
                  {libTab === 'std' && (() => {
                    const q = stdSearch.trim().toLowerCase()
                    const pick = (sym: StdSymbol) => {
                      const activeStd = placingShape === 'std' && placingStdId === sym.id
                      setPlacingShape(activeStd ? null : 'std')
                      setPlacingStdId(activeStd ? null : sym.id)
                      setPlacingSymbol(null)
                      setPlacingMark(null)
                      setPendingConn(null)
                    }
                    const onStdEnter = (sym: StdSymbol) => (e: React.MouseEvent<HTMLDivElement>) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setLibHover({
                        title: sym.label,
                        lines: [`${STD_MAJOR_LABEL[sym.major]} · ${STD_SUB_LABEL[sym.sub] ?? sym.sub} · ${sym.standard}`, sym.desc, `默认尺寸 ${sym.sw}×${sym.sh} · 点击画布放置`],
                        x: r.right, y: r.top,
                      })
                    }
                    const renderCells = (items: StdSymbol[]) => items.map((sym) => (
                      <StdLibCell
                        key={sym.id} sym={sym}
                        active={placingShape === 'std' && placingStdId === sym.id}
                        onPick={() => pick(sym)}
                        onEnter={onStdEnter(sym)}
                        onLeave={() => setLibHover(null)}
                      />
                    ))
                    if (q) {
                      const hits = STD_SYMBOLS.filter((sym) =>
                        sym.label.toLowerCase().includes(q)
                        || sym.desc.toLowerCase().includes(q)
                        || (STD_SUB_LABEL[sym.sub] ?? '').toLowerCase().includes(q)
                        || sym.id.toLowerCase().includes(q))
                      return hits.length === 0 ? (
                        <div className="px-1 py-3 text-center text-[11px] leading-relaxed text-stone-400">
                          未找到与「{stdSearch.trim()}」匹配的图元（库内共 {STD_SYMBOLS.length} 个）
                        </div>
                      ) : (
                        <LibSection label={`搜索「${stdSearch.trim()}」`} count={hits.length} open onToggle={() => setStdSearch('')}>
                          {renderCells(hits)}
                        </LibSection>
                      )
                    }
                    return STD_MAJOR_ORDER.map((m: StdMajor) => {
                      const items = STD_SYMBOLS.filter((sym) => sym.major === m)
                      const majorOpen = openGroups[`m-${m}`] ?? m === 'equipment'
                      return (
                        <LibSection key={m} label={STD_MAJOR_LABEL[m]} count={items.length} open={majorOpen} onToggle={() => toggleGroup(`m-${m}`)} stack>
                          {STD_SUBGROUPS[m].map((sd) => {
                            const subItems = STD_SYMBOLS.filter((sym) => sym.sub === sd.id)
                            return (
                              <LibSection
                                key={sd.id} nested
                                label={sd.label} count={subItems.length}
                                open={openGroups[sd.id] ?? true}
                                onToggle={() => toggleGroup(sd.id)}
                              >
                                {renderCells(subItems)}
                              </LibSection>
                            )
                          })}
                        </LibSection>
                      )
                    })
                  })()}
                  {/* 自定义图元（保存后自动出现在此页签） */}
                  {libTab === 'custom' && (
                    <>
                      {symbolsLoading && (
                        <div className="px-1 py-2 text-[11px] text-stone-400">自定义图元加载中…</div>
                      )}
                      <LibSection label="我的图元" count={symbols.length} open={!!openGroups.custom} onToggle={() => toggleGroup('custom')}>
                        {symbols.map((sym) => {
                          const activeSym = placingSymbol?.id === sym.id
                          return (
                            <div
                              key={`sym-${sym.id}`}
                              className={cn(
                                'group relative rounded-md border p-1 transition-colors',
                                activeSym ? 'border-teal-400 bg-teal-50' : 'border-stone-200 hover:border-teal-300 hover:bg-stone-50',
                              )}
                              onMouseEnter={(e) => {
                                const r = e.currentTarget.getBoundingClientRect()
                                setLibHover({ title: sym.name, lines: [sym.basedOn ? `基于「${sym.basedOn}」` : '自定义图元', '点击选择后点击画布放置'], x: r.right, y: r.top })
                              }}
                              onMouseLeave={() => setLibHover(null)}
                            >
                              <button
                                type="button"
                                title={`点击画布放置「${sym.name}」`}
                                onClick={() => {
                                  setPlacingSymbol(activeSym ? null : sym)
                                  setPlacingShape(null)
                                  setPlacingStdId(null)
                                  setPlacingMark(null)
                                  setPendingConn(null)
                                }}
                                className="flex h-14 w-full items-center justify-center"
                              >
                                <SymbolThumb parts={sym.parts} className="h-12 w-12 text-stone-500" />
                              </button>
                              <div className="truncate px-0.5 pb-0.5 text-center text-[10px] leading-tight text-stone-500">{sym.name}</div>
                              <div className="absolute right-0.5 top-0.5 hidden gap-0.5 rounded bg-white/90 p-0.5 shadow-sm group-hover:flex">
                                <button type="button" title="编辑此图元" className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-teal-700" onClick={(e) => { e.stopPropagation(); setLibHover(null); enterEditSymbol(sym) }}>
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button type="button" title="以此图元为基础新建" className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-violet-700" onClick={(e) => { e.stopPropagation(); setLibHover(null); enterCopyOfSymbol(sym) }}>
                                  <Copy className="h-3 w-3" />
                                </button>
                                <button type="button" title="删除此图元" className="rounded p-0.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600" onClick={(e) => { e.stopPropagation(); setLibHover(null); setDeleteSymbolTarget(sym) }}>
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </LibSection>
                      {!symbolsLoading && symbols.length === 0 && (
                        <div className="px-1 py-3 text-center text-[11px] leading-relaxed text-stone-400">
                          暂无自定义图元——选中画布图元后用「存为自定义图元」创建
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="mt-auto border-t px-3 py-2 text-[11px] leading-relaxed text-stone-400">
                  {placingSymbol
                    ? `点击画布位置放置自定义图元「${placingSymbol.name}」，Esc 取消`
                    : placingShapeLib
                      ? placingShapeLib.type === 'line'
                        ? '按住左键从起点拖拽到终点绘制直线（任意角度）· Esc 取消'
                        : `点击画布位置放置「${placingLabel}」，Esc 取消`
                      : '悬停查看图元信息，点击大分类/子分类标题展开折叠，点击图元进入放置模式；内建图元含设备/管道与管件/阀门/仪表与控制/电气与安全 5 大类 126 符号，支持顶部搜索'}
                </div>
              </div>
            )}

            {/* 中央画布 */}
            <div className="relative min-w-0 flex-1">
              {placingMark && (
                <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs text-teal-800 shadow-sm">
                  正在放置隔离点标注：{placingMark.code} {placingMark.name} · 点击画布落点 · Esc 取消
                </div>
              )}
                  {placingShapeLib && (
                <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs text-teal-800 shadow-sm">
                  {placingShapeLib.type === 'line'
                    ? '绘制直线：按住左键定起点，移动调整角度与长度，松开定终点 · Esc 取消'
                    : `正在放置图元：${placingLabel} · 点击画布落点 · Esc 取消`}
                </div>
              )}
              <div
                ref={canvasBoxRef}
                className="relative overflow-hidden rounded-lg border bg-white"
                style={canvasH > 0 ? { height: canvasH } : { aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
              >
                {detailLoading ? (
                  <Skeleton className="h-full w-full rounded-none" />
                ) : (
                  <svg
                    ref={svgRef}
                    viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
                    className={cn('block h-full w-full select-none', panning ? 'cursor-grabbing' : 'cursor-grab')}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerLeave={() => setMousePos(null)}
                    onClick={handleCanvasClick}
                  >
                    <defs>
                      <pattern id="bp-pid-grid-s" width={20} height={20} patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke={GRID_S} strokeWidth={1} />
                      </pattern>
                      <pattern id="bp-pid-grid-l" width={100} height={100} patternUnits="userSpaceOnUse">
                        <rect width={100} height={100} fill="url(#bp-pid-grid-s)" />
                        <path d="M 100 0 L 0 0 0 100" fill="none" stroke={GRID_L} strokeWidth={1.2} />
                      </pattern>
                      <marker id="bp-pid-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5.5} markerHeight={5.5} orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={LINE} />
                      </marker>
                      <marker id="bp-pid-arrow-rose" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5.5} markerHeight={5.5} orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={ROSE} />
                      </marker>
                    </defs>

                    {/* 无限画布底：白底+网格跟随当前视口（平移到任何位置都有可绘制桌面），画布原点区域虚线框标界 */}
                    <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="#fff" />
                    <rect
                      x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="url(#bp-pid-grid-l)"
                      className={cn(
                        mode === 'edit' && placingShape === 'line' && 'cursor-crosshair',
                        mode === 'edit' && placingShape && placingShape !== 'line' && 'cursor-copy',
                        mode === 'edit' && placingMark && 'cursor-copy',
                      )}
                    />
                    {/* 画布原点标界（0,0 起的 1200×700 主图区域，无限桌面上找回「家」的参照） */}
                    <rect
                      x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="none"
                      stroke="#d6d3d1" strokeWidth={1.2} strokeDasharray="12 8" vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />

                    {/* 空态提示 */}
                    {mode === 'edit' && content.shapes.length === 0 && content.marks.length === 0 && (
                      <g pointerEvents="none">
                        <text x={CANVAS_W / 2} y={CANVAS_H / 2 - 10} textAnchor="middle" fontSize={15} fill="#a8a29e">
                          从左侧选择图元开始绘制
                        </text>
                        <text x={CANVAS_W / 2} y={CANVAS_H / 2 + 16} textAnchor="middle" fontSize={12} fill="#d6d3d1">
                          点击图元 → 点击画布放置 · 拖拽移动 · 四角缩放 · 锚点连线
                        </text>
                      </g>
                    )}
                    {mode === 'view' && content.marks.length === 0 && (
                      <g pointerEvents="none">
                        <text x={CANVAS_W / 2} y={CANVAS_H / 2} textAnchor="middle" fontSize={14} fill="#a8a29e">
                          本图尚未标注隔离点
                        </text>
                      </g>
                    )}

                    {/* 连线（先渲染，位于图元下层） */}
                    {renderConnections()}

                    {/* 管线号徽章图层（全部连线之上，避免重叠连线遮挡） */}
                    {renderConnBadges()}

                    {/* 图元 */}
                    {renderShapes()}

                    {/* 隔离点标注 */}
                    {renderMarks()}

                    {/* 连线编辑 overlay（最上层）：选中连线的中段拖拽命中区 + 起止端点拖拽改接手柄 */}
                    {mode === 'edit' && selectedConn && !connEndDrag && !pendingConn && (() => {
                      const from = shapeMap.get(selectedConn.fromShape)
                      const to = shapeMap.get(selectedConn.toShape)
                      if (!from || !to) return null
                      const a = anchorPoint(from, selectedConn.fromAnchor)
                      const b = anchorPoint(to, selectedConn.toAnchor)
                      const pts = routeConnection(
                        { x: a.x, y: a.y, anchor: selectedConn.fromAnchor },
                        { x: b.x, y: b.y, anchor: selectedConn.toAnchor },
                        selectedConn.fromShape === selectedConn.toShape,
                        selectedConn.midOverride,
                      )
                      const oaH = selectedConn.fromAnchor === 'left' || selectedConn.fromAnchor === 'right'
                      const obH = selectedConn.toAnchor === 'left' || selectedConn.toAnchor === 'right'
                      const segOk = selectedConn.fromShape !== selectedConn.toShape && ((oaH && obH) || (!oaH && !obH))
                      const last = pts[pts.length - 1]
                      return (
                        <g>
                          {segOk && (
                            <line
                              x1={pts[1][0]} y1={pts[1][1]} x2={pts[2][0]} y2={pts[2][1]}
                              stroke="transparent" strokeWidth={14}
                              className={oaH ? 'cursor-ew-resize' : 'cursor-ns-resize'}
                              onPointerDown={(e) => startDragConnSeg(e, selectedConn, oaH ? 'x' : 'y')}
                            >
                              <title>{oaH ? '拖动调整竖直段水平位置' : '拖动调整水平段垂直位置'}</title>
                            </line>
                          )}
                          <circle
                            cx={pts[0][0]} cy={pts[0][1]} r={6} fill="#fff" stroke={ROSE} strokeWidth={1.8}
                            className="cursor-grab" onPointerDown={(e) => startDragConnEnd(e, selectedConn, 'from')}
                          >
                            <title>拖拽起点改接到其他锚点</title>
                          </circle>
                          <circle cx={pts[0][0]} cy={pts[0][1]} r={2.2} fill={ROSE} pointerEvents="none" />
                          <circle
                            cx={last[0]} cy={last[1]} r={6} fill="#fff" stroke={ROSE} strokeWidth={1.8}
                            className="cursor-grab" onPointerDown={(e) => startDragConnEnd(e, selectedConn, 'to')}
                          >
                            <title>拖拽终点改接到其他锚点</title>
                          </circle>
                          <circle cx={last[0]} cy={last[1]} r={2.2} fill={ROSE} pointerEvents="none" />
                        </g>
                      )
                    })()}

                    {/* 端点拖拽中：全部候选锚点高亮 + 吸附目标 rose 放大 + 实时预览折线（移动过程自动排列） */}
                    {mode === 'edit' && connEndDrag && (() => {
                      const c = content.connections.find((x) => x.id === connEndDrag.id)
                      if (!c) return null
                      const from = shapeMap.get(c.fromShape)
                      const to = shapeMap.get(c.toShape)
                      if (!from || !to) return null
                      const a = anchorPoint(from, c.fromAnchor)
                      const b = anchorPoint(to, c.toAnchor)
                      const otherShapeId = connEndDrag.which === 'from' ? c.toShape : c.fromShape
                      const fixed = connEndDrag.which === 'from'
                        ? { x: b.x, y: b.y, anchor: c.toAnchor }
                        : { x: a.x, y: a.y, anchor: c.fromAnchor }
                      const movingAnchor = connEndDrag.hover?.anchor
                        ?? (connEndDrag.which === 'from' ? c.fromAnchor : c.toAnchor)
                      const hoverShape = connEndDrag.hover ? shapeMap.get(connEndDrag.hover.shapeId) : null
                      let previewPts: [number, number][]
                      if (hoverShape && connEndDrag.hover) {
                        const mp = anchorPoint(hoverShape, connEndDrag.hover.anchor)
                        const moving = { x: mp.x, y: mp.y, anchor: movingAnchor }
                        previewPts = connEndDrag.which === 'from'
                          ? routeConnection(moving, fixed, connEndDrag.hover.shapeId === otherShapeId)
                          : routeConnection(fixed, moving, connEndDrag.hover.shapeId === otherShapeId)
                      } else {
                        previewPts = [[fixed.x, fixed.y], [connEndDrag.x, connEndDrag.y]]
                      }
                      return (
                        <g pointerEvents="none">
                          {content.shapes.map((s) =>
                            ANCHORS.map((an) => {
                              const ap = anchorPoint(s, an)
                              const hot = connEndDrag.hover?.shapeId === s.id && connEndDrag.hover.anchor === an
                              return (
                                <circle
                                  key={`${s.id}:${an}`} cx={ap.x} cy={ap.y} r={hot ? 7.5 : 4}
                                  fill={hot ? ROSE : '#fff'} stroke={hot ? ROSE : '#a8a29e'} strokeWidth={1.4}
                                />
                              )
                            }),
                          )}
                          <polyline
                            points={previewPts.map((p) => p.join(',')).join(' ')} fill="none"
                            stroke={ROSE} strokeWidth={2} strokeDasharray="6 4"
                          />
                          <circle cx={connEndDrag.x} cy={connEndDrag.y} r={3.5} fill={ROSE} />
                        </g>
                      )
                    })()}

                    {/* 连线挂起：跟随鼠标的 dashed 引导线 */}
                    {mode === 'edit' && pendingConn && mousePos &&
                      (() => {
                        const from = shapeMap.get(pendingConn.shapeId)
                        if (!from) return null
                        const a = anchorPoint(from, pendingConn.anchor)
                        return (
                          <g pointerEvents="none">
                            <line x1={a.x} y1={a.y} x2={mousePos.x} y2={mousePos.y} stroke={TEAL} strokeWidth={2} strokeDasharray="6 4" />
                            <circle cx={mousePos.x} cy={mousePos.y} r={3.5} fill={TEAL} />
                          </g>
                        )
                      })()}

                    {/* 放置幽灵预览（直线为十字准星引导，其余为包围盒框） */}
                    {mode === 'edit' && placingShapeLib && mousePos && !lineDraft && (
                      <g pointerEvents="none" opacity={0.75}>
                        {placingShapeLib.type === 'line' ? (
                          <>
                            <line x1={mousePos.x - 12} y1={mousePos.y} x2={mousePos.x + 12} y2={mousePos.y} stroke={TEAL} strokeWidth={1.2} />
                            <line x1={mousePos.x} y1={mousePos.y - 12} x2={mousePos.x} y2={mousePos.y + 12} stroke={TEAL} strokeWidth={1.2} />
                            <circle cx={mousePos.x} cy={mousePos.y} r={3} fill={TEAL} />
                            <text x={mousePos.x} y={mousePos.y - 18} textAnchor="middle" fontSize={11} fill={TEAL}>
                              按住左键拖拽绘制
                            </text>
                          </>
                        ) : placingStdSym ? (
                          <>
                            <rect
                              x={mousePos.x - placingStdSym.sw / 2} y={mousePos.y - placingStdSym.sh / 2}
                              width={placingStdSym.sw} height={placingStdSym.sh} rx={3}
                              fill="rgba(13,148,136,0.08)" stroke={TEAL} strokeWidth={1.4} strokeDasharray="6 4"
                            />
                            <g transform={`translate(${mousePos.x - placingStdSym.sw / 2} ${mousePos.y - placingStdSym.sh / 2})`} className="pid-std" opacity={0.85}>
                              {placingStdSym.render({ stroke: '#44403c', fill: '#fff' })}
                            </g>
                            <text x={mousePos.x} y={mousePos.y - placingStdSym.sh / 2 - 6} textAnchor="middle" fontSize={11} fill={TEAL}>
                              {placingStdSym.label}
                            </text>
                          </>
                        ) : (
                          <>
                            <rect
                              x={mousePos.x - placingShapeLib.w / 2} y={mousePos.y - placingShapeLib.h / 2}
                              width={placingShapeLib.w} height={placingShapeLib.h} rx={3}
                              fill="rgba(13,148,136,0.08)" stroke={TEAL} strokeWidth={1.4} strokeDasharray="6 4"
                            />
                            <text x={mousePos.x} y={mousePos.y - placingShapeLib.h / 2 - 6} textAnchor="middle" fontSize={11} fill={TEAL}>
                              {placingShapeLib.label}
                            </text>
                          </>
                        )}
                      </g>
                    )}
                    {/* 直线橡皮筋拖拽预览：起点实心 · 终点空心 · 实时长度/角度 */}
                    {lineDraft && (
                      <g pointerEvents="none">
                        <line
                          x1={lineDraft.sx} y1={lineDraft.sy} x2={lineDraft.ex} y2={lineDraft.ey}
                          stroke={TEAL} strokeWidth={1.8} strokeDasharray="6 4"
                        />
                        <circle cx={lineDraft.sx} cy={lineDraft.sy} r={3.2} fill={TEAL} />
                        <circle cx={lineDraft.ex} cy={lineDraft.ey} r={3.2} fill="#fff" stroke={TEAL} strokeWidth={1.4} />
                        <text
                          x={(lineDraft.sx + lineDraft.ex) / 2}
                          y={(lineDraft.sy + lineDraft.ey) / 2 - 9}
                          textAnchor="middle" fontSize={11} fontWeight={500} fill={TEAL}
                          stroke="#fff" strokeWidth={3} paintOrder="stroke"
                        >
                          {Math.round(Math.hypot(lineDraft.ex - lineDraft.sx, lineDraft.ey - lineDraft.sy))}
                          {' · '}
                          {Math.round((Math.atan2(-(lineDraft.ey - lineDraft.sy), lineDraft.ex - lineDraft.sx) * 180) / Math.PI)}°
                        </text>
                      </g>
                    )}
                    {mode === 'edit' && placingSymbol && mousePos && (
                      <g pointerEvents="none" opacity={0.8}>
                        {(() => {
                          const { w: gw, h: gh } = symbolInstanceSize(placingSymbol.designW, placingSymbol.designH)
                          const gx = mousePos.x - gw / 2
                          const gy = mousePos.y - gh / 2
                          return (
                            <>
                              <rect x={gx} y={gy} width={gw} height={gh} rx={3} fill="rgba(124,58,237,0.06)" stroke="#7c3aed" strokeWidth={1.4} strokeDasharray="6 4" />
                              <g transform={`translate(${gx} ${gy}) scale(${gw / placingSymbol.designW} ${gh / placingSymbol.designH})`}>
                                {placingSymbol.parts.map((p) => <ShapeBody key={p.id} s={{ ...p, label: p.label ?? '' }} />)}
                              </g>
                              <text x={mousePos.x} y={gy - 6} textAnchor="middle" fontSize={11} fill="#7c3aed">{placingSymbol.name}</text>
                            </>
                          )
                        })()}
                      </g>
                    )}
                    {mode === 'edit' && placingMark && mousePos && (
                      <g pointerEvents="none" opacity={0.7}>
                        <polygon
                          points={`${mousePos.x},${mousePos.y - 7} ${mousePos.x + 7},${mousePos.y} ${mousePos.x},${mousePos.y + 7} ${mousePos.x - 7},${mousePos.y}`}
                          fill="#f43f5e" stroke="#fff" strokeWidth={1.4}
                        />
                        <text
                          x={mousePos.x} y={mousePos.y + 22} textAnchor="middle" fontSize={11} fill={ROSE}
                          stroke="#fff" strokeWidth={3} paintOrder="stroke"
                        >
                          {placingMark.code}
                        </text>
                      </g>
                    )}
                  </svg>
                )}
                {!detailLoading && (
                  <>
                  {/* 视图控制浮层（HTML 层实现，交互稳定不随画布缩放变形） */}
                  <div className="absolute bottom-2.5 left-2.5 z-10 flex items-center gap-0.5 rounded-lg border border-stone-200 bg-white/95 p-1 shadow-sm backdrop-blur">
                    <button
                      type="button"
                      title="缩小（或画布上滚动滚轮）"
                      className="rounded p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={vb.w >= CANVAS_MAX_W - 1}
                      onClick={() => zoomAt(1 / 1.25)}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span
                      className="w-11 select-none text-center font-mono text-xs font-medium text-stone-600"
                      title="当前缩放比例（1:1 = 100%）"
                    >
                      {Math.round((CANVAS_W / vb.w) * 100)}%
                    </span>
                    <button
                      type="button"
                      title="放大（或画布上滚动滚轮）"
                      className="rounded p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={vb.w <= CANVAS_MIN_W + 1}
                      onClick={() => zoomAt(1.25)}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <div className="mx-0.5 h-4 w-px bg-stone-200" />
                    <button
                      type="button"
                      title="重置视图（1:1 全景）"
                      className="rounded p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
                      onClick={resetView}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <div className="mx-0.5 h-4 w-px bg-stone-200" />
                    <span
                      className="hidden select-none items-center gap-1 pr-1.5 text-[10px] text-stone-400 sm:flex"
                      title="按住空白处拖拽平移画布 · 滚轮缩放 · 画布无边界，跑远了可用俯瞰图或重置找回 · 切换图后视图自动重置"
                    >
                      <Move className="h-3 w-3" />
                      拖拽平移 · 滚轮缩放 · 画布无限大
                    </span>
                  </div>

                  {/* 俯瞰图（工具栏开关控制）：整图缩略 + 图元/连线/隔离点简化轮廓 + 当前视口 amber 框，点击/拖拽快速定位（无限画布下远距离找回的主要手段） */}
                  {minimapOpen && (
                    <div className="absolute bottom-2.5 right-2.5 z-10 overflow-hidden rounded-lg border border-stone-200 bg-white/95 shadow-md backdrop-blur">
                      <div className="flex items-center justify-between gap-2 border-b border-stone-100 py-1 pl-2 pr-1">
                        <span className="flex select-none items-center gap-1 text-[10px] font-medium text-stone-500">
                          <MapIcon className="h-3 w-3" />
                          俯瞰图
                        </span>
                        <span className="hidden select-none text-[9px] text-stone-400 sm:inline">点击/拖拽定位</span>
                        <button
                          type="button"
                          title="关闭俯瞰图（工具栏可重新打开）"
                          className="rounded p-0.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
                          onClick={() => setMinimapOpen(false)}
                        >
                          <CloseIcon className="h-3 w-3" />
                        </button>
                      </div>
                      <svg
                        viewBox={`${mmBounds.x} ${mmBounds.y} ${mmBounds.w} ${mmBounds.h}`}
                        className="block h-28 w-44 cursor-pointer touch-none sm:h-32 sm:w-52"
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          e.preventDefault()
                          minimapNavRef.current = true
                          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 旧环境无 capture，点击定位仍可用 */ }
                          minimapNavTo(e.clientX, e.clientY, e.currentTarget)
                        }}
                        onPointerMove={(e) => {
                          if (minimapNavRef.current) minimapNavTo(e.clientX, e.clientY, e.currentTarget)
                        }}
                        onPointerUp={(e) => {
                          minimapNavRef.current = false
                          try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
                        }}
                        onPointerCancel={() => { minimapNavRef.current = false }}
                      >
                        <g pointerEvents="none">
                          {/* 世界背景：画布区域白底、视口外微灰（画布原点参照） */}
                          <rect x={mmBounds.x} y={mmBounds.y} width={mmBounds.w} height={mmBounds.h} fill="#f5f5f4" />
                          <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#fff" stroke="#e7e5e4" vectorEffect="non-scaling-stroke" />
                          {/* 连线（锚点直线近似，细线不随缩略图缩放变组） */}
                          {content.connections.map((c) => {
                            const f = shapeMap.get(c.fromShape)
                            const t = shapeMap.get(c.toShape)
                            if (!f || !t) return null
                            const a = anchorPoint(f, c.fromAnchor)
                            const b = anchorPoint(t, c.toAnchor)
                            return (
                              <line
                                key={c.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                                stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.65}
                              />
                            )
                          })}
                          {/* 图元（按类型简化轮廓，保留填充/描边色） */}
                          {content.shapes.map((s) => {
                            const fill = s.fill && s.fill !== 'transparent' ? s.fill : '#fff'
                            const stroke = s.stroke ?? STROKE
                            if (s.type === 'line') {
                              return s.flip
                                ? <line key={s.id} x1={s.x} y1={s.y + s.h} x2={s.x + s.w} y2={s.y} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                                : <line key={s.id} x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            }
                            if (s.type === 'circle') {
                              return <circle key={s.id} cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={Math.min(s.w, s.h) / 2} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            }
                            if (s.type === 'ellipse') {
                              return <ellipse key={s.id} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            }
                            if (s.type === 'triangle') {
                              return <polygon key={s.id} points={`${s.x},${s.y + s.h} ${s.x + s.w},${s.y + s.h} ${s.x + s.w / 2},${s.y}`} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            }
                            return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                          })}
                          {/* 隔离点标注（玫红菱形，世界半径随包围盒反向缩放保持屏幕可见） */}
                          {content.marks.map((m) => {
                            const r = mmBounds.w / 40
                            return (
                              <polygon
                                key={m.id}
                                points={`${m.x},${m.y - r} ${m.x + r},${m.y} ${m.x},${m.y + r} ${m.x - r},${m.y}`}
                                fill={ROSE} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke"
                              />
                            )
                          })}
                          {/* 当前视口（amber，与定位高亮同色语言） */}
                          <rect
                            x={vb.x} y={vb.y} width={vb.w} height={vb.h}
                            fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                          />
                        </g>
                      </svg>
                    </div>
                  )}
                  </>
                )}

                {/* 选中图元浮动工具条：悬浮在选中图元右上角（画布内浮层；只读/查看态不渲染） */}
                {mode === 'edit' && !detailLoading && selectedShape && canvasW > 0 && (() => {
                  const s = selectedShape
                  const k = canvasW / vb.w
                  const px = (s.x + s.w - vb.x) * k
                  const py = (s.y - vb.y) * k
                  if (px < -60 || px > canvasW + 60 || py < -60 || py > (canvasH || 9999) + 60) return null
                  const left = Math.min(Math.max(px, 170), canvasW - 8)
                  const top = Math.max(py, 44)
                  const hasSource = s.type === 'symbol' && s.symbolId != null && symbols.some((sym) => sym.id === s.symbolId)
                  return (
                    <div
                      className="absolute z-20 flex items-center gap-0.5 rounded-lg border border-stone-200 bg-white/95 p-0.5 shadow-md backdrop-blur"
                      style={{ left, top, transform: 'translate(-100%, -100%) translateY(-10px)' }}
                    >
                      {hasSource && (
                        <button
                          type="button"
                          title="编辑源图元（跳转图元编辑器，保存后库中同步更新）"
                          className="rounded p-1.5 text-teal-700 transition-colors hover:bg-teal-50"
                          onClick={() => { const sym = symbols.find((s2) => s2.id === s.symbolId); if (sym) enterEditSymbol(sym) }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        title="以此图元为基础新建副本（Ctrl+D）"
                        className="rounded p-1.5 text-emerald-700 transition-colors hover:bg-emerald-50"
                        onClick={() => duplicateShape(s)}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="存为自定义图元（进入图元编辑器组合构建）"
                        className="rounded p-1.5 text-violet-700 transition-colors hover:bg-violet-50"
                        onClick={() => enterEditorFromShape(s)}
                      >
                        <Shapes className="h-4 w-4" />
                      </button>
                      <div className="mx-0.5 h-4 w-px bg-stone-200" />
                      <button
                        type="button"
                        title="删除图元（Delete）"
                        className="rounded p-1.5 text-rose-600 transition-colors hover:bg-rose-50"
                        onClick={() => deleteSelection({ kind: 'shape', id: s.id })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* 右侧属性面板（编辑模式） */}
            {mode === 'edit' && (
              <div className="flex w-60 shrink-0 flex-col rounded-lg border bg-white">
                <div className="border-b px-3 py-2 text-xs font-medium text-stone-500">属性面板</div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 bp-thin-scrollbar">
                  {selectedShape ? (
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-stone-700">图元属性</div>
                      <div className="grid gap-1.5">
                        <Label className="text-[11px] text-stone-500">名称</Label>
                        <Input
                          className="h-8" value={selectedShape.label}
                          onChange={(e) => updateShape(selectedShape.id, { label: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-stone-500">类型</span>
                        <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-600">
                          {typeLabel(selectedShape.type)}
                        </Badge>
                      </div>

                      {/* 绑定设备（保存图后与连线绑定管线联动回写管线起止设备） */}
                      <div className="space-y-1.5">
                        <Label className="text-[11px] text-stone-500">绑定设备</Label>
                        <select
                          className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-xs text-stone-700 focus:border-emerald-500 focus:outline-none"
                          value={selectedShape.equipmentId ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value)
                            updateShape(selectedShape.id, { equipmentId: v })
                          }}
                        >
                          <option value="">未绑定</option>
                          {equipOptions.map((e) => (
                            <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
                          ))}
                        </select>
                        {selectedShape.equipmentId != null && (() => {
                          const eq = equipOptions.find((x) => x.id === selectedShape.equipmentId)
                          return eq ? (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] leading-relaxed text-emerald-800">
                              <span className="font-medium">{eq.code} · {eq.name}</span>
                              <span className="text-emerald-600">（{EQUIP_TYPE_MAP[eq.type]?.label ?? eq.type}{eq.unitName ? ` · ${eq.unitName}` : ''}）</span>
                              <div className="text-emerald-600">该设备的管线连接关系将在保存图时自动更新</div>
                            </div>
                          ) : null
                        })()}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <NumField
                          label="X" value={selectedShape.x} min={-CANVAS_W * 100} max={CANVAS_W * 100}
                          onChange={(v) => updateShape(selectedShape.id, { x: v })}
                        />
                        <NumField
                          label="Y" value={selectedShape.y} min={-CANVAS_H * 100} max={CANVAS_H * 100}
                          onChange={(v) => updateShape(selectedShape.id, { y: v })}
                        />
                        <NumField
                          label="宽 W" value={selectedShape.w} min={libOf(selectedShape.type).minW} max={CANVAS_W * 100}
                          onChange={(v) => updateShape(selectedShape.id, { w: v })}
                        />
                        <NumField
                          label="高 H" value={selectedShape.h} min={libOf(selectedShape.type).minH} max={CANVAS_H * 100}
                          onChange={(v) => updateShape(selectedShape.id, { h: v })}
                        />
                      </div>
                      {selectedShape.type === 'line' && (
                        <Button
                          variant="outline"
                          className="h-8 w-full border-stone-200 text-stone-600 hover:bg-stone-50"
                          title="镜像翻转直线方向（/ ↔ \）"
                          onClick={() => updateShape(selectedShape.id, { flip: !selectedShape.flip })}
                        >
                          <MoveDiagonal className="h-3.5 w-3.5" /> 交换对角方向
                        </Button>
                      )}
                      {selectedShape.type === 'symbol' ? (
                        <div className="rounded-md bg-violet-50/70 px-2.5 py-2 text-[11px] leading-relaxed text-violet-700">
                          自定义图元实例 · 构成与颜色在「图元编辑器」中维护，实例随组态图独立保存
                        </div>
                      ) : (
                        <>
                          <ColorSwatches
                            label="填充色"
                            palette={FILL_PALETTE}
                            value={selectedShape.fill ?? '#ffffff'}
                            onChange={(c) => updateShape(selectedShape.id, { fill: c })}
                          />
                          <ColorSwatches
                            label="描边色"
                            palette={STROKE_PALETTE}
                            value={selectedShape.stroke ?? '#44403c'}
                            onChange={(c) => updateShape(selectedShape.id, { stroke: c })}
                          />
                        </>
                      )}
                      {/* 图元操作按钮（副本/存为自定义/删除/编辑源图元）已悬浮至画布中选中图元右上角 */}
                    </div>
                  ) : selectedConn ? (
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-stone-700">连线属性</div>
                      <div className="space-y-1.5 rounded-md bg-stone-50 p-2.5 text-xs text-stone-600">
                        <div>
                          <span className="text-stone-400">起点</span>{' '}
                          {shapeMap.get(selectedConn.fromShape)?.label ?? '(已删除)'} · {ANCHOR_LABEL[selectedConn.fromAnchor]}
                        </div>
                        <div>
                          <span className="text-stone-400">终点</span>{' '}
                          {shapeMap.get(selectedConn.toShape)?.label ?? '(已删除)'} · {ANCHOR_LABEL[selectedConn.toAnchor]}
                        </div>
                        <div className="border-t border-stone-200 pt-1.5 text-[11px] text-stone-400">
                          画布上可拖拽：红色端点手柄改接锚点 · 虚线中段横/纵调整
                        </div>
                      </div>

                      {/* 中段布线（H-H 竖直段横向 / V-V 水平段纵向；自动 = 两端中点） */}
                      {(() => {
                        const paH = selectedConn.fromAnchor === 'left' || selectedConn.fromAnchor === 'right'
                        const pbH = selectedConn.toAnchor === 'left' || selectedConn.toAnchor === 'right'
                        const adjustable = selectedConn.fromShape !== selectedConn.toShape && ((paH && pbH) || (!paH && !pbH))
                        if (!adjustable) return null
                        return (
                          <div className="space-y-1.5">
                            <Label className="text-xs text-stone-500">中段布线</Label>
                            <div className="flex items-center justify-between gap-2 rounded-md bg-stone-50 p-2 text-xs text-stone-600">
                              <span>
                                {typeof selectedConn.midOverride === 'number'
                                  ? <>
                                    手动
                                    <span className="ml-1 font-mono text-stone-700">
                                      {paH ? 'x=' : 'y='}{selectedConn.midOverride}
                                    </span>
                                  </>
                                  : '自动（两端中点）'}
                                <span className="text-stone-400">，可拖拽中段虚线调整</span>
                              </span>
                              {typeof selectedConn.midOverride === 'number' && (
                                <button
                                  type="button"
                                  className="shrink-0 rounded border border-stone-300 bg-white px-1.5 py-0.5 text-[10px] text-stone-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                                  onClick={() =>
                                    mutate((prev) => ({
                                      ...prev,
                                      connections: prev.connections.map((cc) =>
                                        cc.id === selectedConn.id ? { ...cc, midOverride: undefined } : cc,
                                      ),
                                    }))
                                  }
                                >
                                  重置自动
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })()}

                      {/* 流向（起点→终点 / 终点→起点 / 无向） */}
                      <div className="space-y-1.5">
                        <Label className="text-xs text-stone-500">介质流向</Label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {([
                            { v: 'forward', label: '起点→终点', title: '箭头指向终点图元' },
                            { v: 'reverse', label: '终点→起点', title: '箭头指向起点图元' },
                            { v: 'none', label: '无向', title: '不显示方向箭头' },
                          ] as const).map((o) => {
                            const cur = selectedConn.direction ?? 'forward'
                            const on = cur === o.v
                            return (
                              <button
                                key={o.v}
                                type="button"
                                title={o.title}
                                onClick={() =>
                                  mutate((prev) => ({
                                    ...prev,
                                    connections: prev.connections.map((c) =>
                                      c.id === selectedConn.id ? { ...c, direction: o.v } : c,
                                    ),
                                  }))
                                }
                                className={cn(
                                  'h-7 rounded-md border text-[11px] transition-colors',
                                  on
                                    ? 'border-emerald-600 bg-emerald-600 text-white font-medium'
                                    : 'border-stone-200 bg-white text-stone-600 hover:border-emerald-300 hover:bg-emerald-50',
                                )}
                              >
                                {o.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* 绑定管线（保存图后自动按连线起终点回写管线起止设备） */}
                      <div className="space-y-1.5">
                        <Label className="text-xs text-stone-500">绑定管线</Label>
                        <select
                          className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-xs text-stone-700 focus:border-emerald-500 focus:outline-none"
                          value={selectedConn.pipelineId ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value)
                            mutate((prev) => ({
                              ...prev,
                              connections: prev.connections.map((c) =>
                                c.id === selectedConn.id ? { ...c, pipelineId: v } : c,
                              ),
                            }))
                          }}
                        >
                          <option value="">未绑定</option>
                          {pipeOptions.map((p) => (
                            <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                          ))}
                        </select>
                        {selectedConn.pipelineId != null && (() => {
                          const pipe = pipeOptions.find((p) => p.id === selectedConn.pipelineId)
                          const fromEq = shapeMap.get(selectedConn.fromShape)?.equipmentId ?? null
                          const toEq = shapeMap.get(selectedConn.toShape)?.equipmentId ?? null
                          const reversed = (selectedConn.direction ?? 'forward') === 'reverse'
                          const startEq = equipOptions.find((e) => e.id === (reversed ? toEq : fromEq))
                          const endEq = equipOptions.find((e) => e.id === (reversed ? fromEq : toEq))
                          return (
                            <div className="space-y-1 rounded-md border border-teal-200 bg-teal-50 p-2 text-[11px] leading-relaxed text-teal-800">
                              <div className="font-medium">
                                管线 {pipe ? `${pipe.code} · ${pipe.name}` : `#${selectedConn.pipelineId}`}
                              </div>
                              <div className="text-teal-700">
                                保存图后将更新关联设备：{startEq ? `${startEq.code} ${startEq.name}` : '（起点图元未绑定设备）'}
                                {' → '}
                                {endEq ? `${endEq.code} ${endEq.name}` : '（终点图元未绑定设备）'}
                              </div>
                              <div className="flex items-center justify-between gap-2 border-t border-teal-200/70 pt-1.5">
                                <span className="text-teal-700">
                                  标注位置 {Math.round((typeof selectedConn.labelT === 'number' ? selectedConn.labelT : 0.5) * 100)}%
                                  （画布上可沿线拖动）
                                </span>
                                {typeof selectedConn.labelT === 'number' && (
                                  <button
                                    type="button"
                                    className="shrink-0 rounded border border-teal-300 bg-white px-1.5 py-0.5 text-[10px] text-teal-700 transition-colors hover:bg-teal-100"
                                    onClick={() =>
                                      mutate((prev) => ({
                                        ...prev,
                                        connections: prev.connections.map((cc) =>
                                          cc.id === selectedConn.id
                                            ? { ...cc, labelT: undefined }
                                            : cc,
                                        ),
                                      }))
                                    }
                                  >
                                    重置居中
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })()}
                      </div>

                      <Button
                        variant="outline"
                        className="h-9 w-full border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => deleteSelection({ kind: 'conn', id: selectedConn.id })}
                      >
                        <Trash2 className="h-4 w-4" /> 删除连线（Delete）
                      </Button>
                    </div>
                  ) : selectedMark ? (
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-stone-700">隔离点标注</div>
                      <div className="rounded-md bg-stone-50 p-2.5 text-xs">
                        <div className="font-mono font-medium text-stone-700">{selectedMark.code}</div>
                        {selectedMark.name && <div className="mt-0.5 text-stone-500">{selectedMark.name}</div>}
                      </div>
                      {(() => {
                        const mp = selectedMark.masterPointId != null ? masterById.get(selectedMark.masterPointId) : null
                        const pipeCode = mp?.pipelineName
                          ?? (mp?.pipelineId != null ? pipeOptions.find((p) => p.id === mp.pipelineId)?.code ?? `#${mp.pipelineId}` : null)
                        return (
                          <div className="flex items-center justify-between rounded-md border border-teal-100 bg-teal-50/60 px-2.5 py-1.5 text-xs">
                            <span className="text-stone-500">所属管线</span>
                            {pipeCode ? (
                              <span className="font-mono font-medium text-teal-700">{pipeCode}</span>
                            ) : (
                              <span className="text-stone-400">未关联（移到管线上可自动计算）</span>
                            )}
                          </div>
                        )
                      })()}
                      {/* 跨图占用提示（写入侧：与定位查看侧的多图命中策略对称） */}
                      {markUsage && markUsage.length > 0 && (
                        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                          <div className="text-[11px] leading-relaxed text-amber-800">
                            <span className="font-medium">该点已在其他 {markUsage.length} 张图挂标</span>
                            <span className="text-amber-700/80">：{markUsage.map((u) => u.diagramName + (u.unitName ? `（${u.unitName}）` : '')).join('、')}</span>
                            <div className="text-amber-700/70">多图表达同一隔离点属正常场景，但请注意版本一致性——调整位置/删除本图挂标时建议同步核对其他图。</div>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <NumField
                          label="X" value={selectedMark.x} min={-CANVAS_W * 100} max={CANVAS_W * 100}
                          onBlur={() => {
                            const mk = contentRef.current.marks.find((x) => x.id === selectedMark.id)
                            if (mk) checkMarkPipeOwnership(mk) // 数值修改结束重算所属管线
                          }}
                          onChange={(v) =>
                            mutate((prev) => ({
                              ...prev,
                              marks: prev.marks.map((mk) => (mk.id === selectedMark.id ? { ...mk, x: v } : mk)),
                            }))
                          }
                        />
                        <NumField
                          label="Y" value={selectedMark.y} min={-CANVAS_H * 100} max={CANVAS_H * 100}
                          onBlur={() => {
                            const mk = contentRef.current.marks.find((x) => x.id === selectedMark.id)
                            if (mk) checkMarkPipeOwnership(mk)
                          }}
                          onChange={(v) =>
                            mutate((prev) => ({
                              ...prev,
                              marks: prev.marks.map((mk) => (mk.id === selectedMark.id ? { ...mk, y: v } : mk)),
                            }))
                          }
                        />
                      </div>
                      <Button
                        variant="outline"
                        className="h-9 w-full border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => deleteSelection({ kind: 'mark', id: selectedMark.id })}
                      >
                        <Trash2 className="h-4 w-4" /> 删除标注（Delete）
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-stone-700">操作指引</div>
                      <ol className="space-y-2.5 text-xs leading-relaxed text-stone-500">
                        <li className="flex gap-2">
                          <MousePointer2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                          <span><b className="text-stone-700">放置</b>：点击左侧图元（内建图元/基础图形/自定义），再点击画布位置</span>
                        </li>
                        <li className="flex gap-2">
                          <Copy className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                          <span><b className="text-stone-700">复制改造</b>：选中图元后点「以此图元为基础新建副本」或 Ctrl+D，在副本上修改</span>
                        </li>
                        <li className="flex gap-2">
                          <Move className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                          <span><b className="text-stone-700">拖拽</b>：按住图元或标注拖动调整位置</span>
                        </li>
                        <li className="flex gap-2">
                          <Expand className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                          <span><b className="text-stone-700">缩放</b>：选中图元后拖动四角手柄（圆形自动锁定正圆比例）</span>
                        </li>
                        <li className="flex gap-2">
                          <Spline className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                          <span><b className="text-stone-700">连线</b>：依次点击两个图元的锚点，折线自动生成</span>
                        </li>
                        <li className="flex gap-2">
                          <Shapes className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                          <span><b className="text-stone-700">自定义图元</b>：工具条「新建图元」进入独立编辑器，用基础图形或已有图元组合，保存后进入「自定义」页签</span>
                        </li>
                      </ol>
                      <div className="rounded-md bg-stone-50 p-2.5 text-[11px] leading-relaxed text-stone-400">
                        快捷键：Delete 删除选中 · Ctrl+D 复制图元 · Esc 取消放置/连线/选中 · 连线中点出现 × 可点击删除
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 底部图例（查看模式） */}
        {mode === 'view' && activeId != null && !detailLoading && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="mr-1 text-xs text-stone-400">隔离点状态图例：</span>
            {ISO_STATE_KEYS.map((k) => {
              const st = ISO_STATE_STYLE[k]
              return (
                <span
                  key={k}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-600',
                    st.legendBg,
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: st.dot }} />
                  {st.legend}
                </span>
              )
            })}
          </div>
        )}
      </CardContent>

      {/* 新建组态图 */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>新建组态图</DialogTitle>
            <DialogDescription>将创建空白画布，随后从左侧图元库开始绘制</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>图名称 <span className="text-rose-500">*</span></Label>
              <Input
                value={newForm.name} placeholder="如 加氢装置抽堵盲板 PID"
                onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>所属装置</Label>
              <Select value={newForm.unitId} onValueChange={(v) => setNewForm({ ...newForm, unitId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择装置（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联装置</SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={creating} onClick={() => void createDiagram()}>
              {creating ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名组态图 */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>重命名组态图</DialogTitle>
            <DialogDescription>修改图名称，不影响已绘制的图元与标注</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label>图名称 <span className="text-rose-500">*</span></Label>
            <Input value={renameVal} placeholder="输入新名称" onChange={(e) => setRenameVal(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={renaming} onClick={() => void submitRename()}>
              {renaming ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI 识别 PID 导入向导 */}
      <PidImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        units={units}
        onDone={(id) => void handleImportDone(id)}
      />

      {/* 删除组态图确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除组态图？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「{deleteTarget?.name}」及其全部图元、连线与隔离点标注，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => void confirmDeleteDiagram()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 自动布局确认 */}
      <AlertDialog open={layoutConfirmOpen} onOpenChange={setLayoutConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>应用自动布局？</AlertDialogTitle>
            <AlertDialogDescription>
              将按管线连接关系把图元自左向右分层排列（未连线图元在下方按网格排列），连线锚点按新方位自动改选，隔离点标注自动跟随所在管线。当前手工摆放位置会被覆盖，应用后可立即撤销；保存前不会写入数据库。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={applyAutoLayout}>应用布局</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除自定义图元确认 */}
      <AlertDialog open={!!deleteSymbolTarget} onOpenChange={(v) => !v && setDeleteSymbolTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除自定义图元？</AlertDialogTitle>
            <AlertDialogDescription>
              将从「自定义」页签移除「{deleteSymbolTarget?.name}」。已放置到各张组态图上的实例不受影响（实例内嵌部件快照，可继续显示）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => void confirmDeleteSymbol()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 隔离点所属管线变更确认（添加/移动终点位置自动计算，确认后写回主数据） */}
      <AlertDialog open={!!pipePrompt} onOpenChange={(v) => !v && setPipePrompt(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>隔离点所属管线变更确认</AlertDialogTitle>
            <AlertDialogDescription>
              根据挂标位置自动计算出距离最近且已绑定管线的连线（相距约 {pipePrompt?.dist ?? 0} 单位），与该点位当前所属管线不一致：
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2.5 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-rose-500" />
              <span className="font-mono font-medium text-stone-700">{pipePrompt?.code}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-stone-500">原所属</span>
              {pipePrompt?.fromId != null ? (
                <Badge variant="outline" className="border-stone-300 bg-white font-mono text-stone-600">{pipePrompt.fromLabel}</Badge>
              ) : (
                <span className="text-stone-400">未关联管线</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-stone-500">计算结果</span>
              <Badge variant="outline" className="border-teal-300 bg-teal-50 font-mono text-teal-700">{pipePrompt?.toLabel}</Badge>
              <span className="truncate text-stone-500">{pipePrompt?.toName}</span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-stone-500">
            确认后将更新隔离点主数据的所属管线（隔离点台账同步生效，该点位归属一并变更）；点「暂不更新」仅保留挂标当前位置，归属不变。
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pipePromptBusy}>暂不更新</AlertDialogCancel>
            <AlertDialogAction
              disabled={pipePromptBusy}
              onClick={(e) => {
                e.preventDefault()
                void confirmPipeOwnership()
              }}
            >
              {pipePromptBusy ? '更新中…' : '确认更新'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 标注隔离点选择 */}
      <Dialog open={markDialogOpen} onOpenChange={setMarkDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>标注隔离点</DialogTitle>
            <DialogDescription>从隔离点主数据中选择，随后在画布上点击位置放置菱形标注</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <Input
              className="pl-8" placeholder="搜索编号 / 名称 / 管线"
              value={markKeyword} onChange={(e) => setMarkKeyword(e.target.value)}
            />
          </div>
          <div className="max-h-96 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编号</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>所属管线</TableHead>
                  <TableHead className="text-right">状态</TableHead>
                </TableRow>
              </TableHeader>
              {masterLoading ? (
                <TableBody>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 4 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full max-w-[110px]" /></TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              ) : filteredMasters.length === 0 ? (
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={4}>
                      <div className="py-8 text-center text-sm text-stone-400">
                        没有匹配的隔离点，请先在「管线及隔离点主数据」中创建
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              ) : (
                <TableBody>
                  {filteredMasters.map((mp) => {
                    const used = markedCodes.has(mp.code)
                    return (
                      <TableRow
                        key={mp.id}
                        className={cn(!used && 'cursor-pointer')}
                        onClick={() => !used && pickMasterPoint(mp)}
                      >
                        <TableCell className="font-mono text-xs">{mp.code}</TableCell>
                        <TableCell>{mp.name}</TableCell>
                        <TableCell className="text-stone-500">{mp.pipelineName || '-'}</TableCell>
                        <TableCell className="text-right">
                          {used ? (
                            <Badge variant="outline" className="border-stone-200 bg-stone-100 text-stone-500">已标注</Badge>
                          ) : (
                            <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">可选择</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              )}
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* 点位盲板作业全生命周期抽屉（盲板状态页点击挂标触发） */}
      <Sheet open={dossierOpen} onOpenChange={setDossierOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <SheetHeader className="border-b bg-stone-50/60 px-4 py-3.5">
            <SheetTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 shrink-0 text-teal-700" />
              <span className="font-mono">{dossierMark?.code}</span>
              {dossierMark?.name && <span className="truncate text-sm font-normal text-stone-500">{dossierMark.name}</span>}
            </SheetTitle>
            <SheetDescription>
              盲板作业全生命周期档案 · 仅显示进行中作业与当日完工作业，今日以前完工的历史作业已自动隐藏
            </SheetDescription>
          </SheetHeader>
          <div className="bp-thin-scrollbar flex-1 overflow-y-auto px-4 py-4">
            {dossierLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
              </div>
            ) : !dossierData ? (
              <div className="py-10 text-center text-sm text-stone-400">暂无数据</div>
            ) : (
              <div className="space-y-4">
                {hiddenDossierCount > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] leading-relaxed text-stone-500">
                    <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>已隐藏 {hiddenDossierCount} 条今日以前完工的历史作业记录（进行中作业与当日完工作业不受影响）</span>
                  </div>
                )}
                {visibleDossierChains.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-6 py-10 text-center">
                    <BadgeCheck className="h-8 w-8 text-stone-300" />
                    <div className="text-sm font-medium text-stone-600">该点位当前常通，暂无进行中的盲板作业</div>
                    <p className="max-w-xs text-[11px] leading-relaxed text-stone-400">
                      历史已完工作业（今日以前）已按规则隐藏；当该点位有作业计划或当日完工作业时会在此展示全生命周期档案
                    </p>
                  </div>
                ) : (
                  visibleDossierChains.map((c) => <DossierChainCard key={c.requestId} chain={c} />)
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
    </div>
  )
}
