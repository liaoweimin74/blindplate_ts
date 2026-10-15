// ============ PID 组态工作台 · Vue 3 完整复刻（对照 pid-config.tsx 组态体验） ============
// 复刻边界（与 pid-config 的差异）：本文件复刻「组态体验」全部能力——
//   画布分层渲染 / 126 标准符号图元库 / 两步+拖拽连线 / 端点改接 / 正交路由 /
//   管线号徽章(labelT 沿线拖拽) / 隔离点六态 / 图例 / 装置绑定角标 / 底图 / 视口四件套 /
//   俯瞰图 / 图层显隐 / 搜索定位闪烁 / 撤销重做 / 多选对齐分布 / 键盘全集 / SVG+PNG 导出。
//   业务 CRUD（图纸 API / 主数据 / 作业票档案 / 10s 轮询 / 图元编辑器）以富 mock 替代。
// 架构：Vue 3 render function（无 SFC 依赖）× 零框架 configurator-core；
//   配色红线：teal/emerald 主色，amber/rose 警示，AI/ violet，严禁 indigo/blue。
import {
  computed, createApp, h, nextTick, reactive, ref, withDirectives,
  type Directive, type VNode,
} from 'vue'
import {
  CANVAS_W, CANVAS_H, STROKE, LINE, TEAL, ROSE, GRID_S, GRID_L,
  FILL_PALETTE, STROKE_PALETTE, ANCHOR_LABEL, minimapBoundsOf,
  createCanvasController, resizeBox, hitTestRect, normRect, isRealRubber,
  alignBoxes, distributeBoxes, snapConnEnd, connExists, rewireConnTarget, labelTAt,
  routeConnection, anchorPointT, physAnchor, nearestFreeAnchorAt, anchorHitBandPath, anchorHitSolidPath,
  anchorZoneBox, pointAlongPolyline, shapeLabelY, isTinyLineDraft, freeT, uid, clamp,
  createHistory, zoomViewport, wheelZoomIntent, panByScreen, minimapNavigateWorld, autoLayout,
  resolvePaint, setInsetResolver, symbolMinSize, searchSymbols, groupTreeOf,
  type Anchor, type ConnEndTarget, type EdgeGeom, type NodeGeom, type RubberRect,
  type Selection, type Shape, type ShapePaint, type SymbolMeta, type SymbolRegistry, type Viewport,
} from '@/lib/configurator-core'
import { mountSymbolThumb } from '@/components/configurator/vue/configurator-vue'
import { buildStdRegistry, buildBasicRegistry, pidTypeLabel, pidTypeLibOf } from '@/components/bp/pid-registry'
import { contentInsetBox } from '@/lib/bp-pid-layout'
import { STD_SHAPE_DATA } from '@/lib/configurator-packs/std-shapes'

// std 符号内容边界注入：锚点贴符号真实内容（与 React 壳同一解析器）
setInsetResolver((n) => contentInsetBox(n))

// ============ 领域类型（NodeGeom/EdgeGeom 超集，业务字段平铺） ============
export interface RShape extends NodeGeom {
  stdId?: string
  equip?: string | null
}
export interface RConn extends EdgeGeom {
  pipe?: string | null
}
export type IsoState = 'idle' | 'planned' | 'approved' | 'working' | 'blinded' | 'opened'
export interface RMark {
  id: string
  x: number
  y: number
  code: string
  name: string
  state: IsoState
}
export interface Doc {
  shapes: RShape[]
  connections: RConn[]
  marks: RMark[]
}

// ============ 隔离点六态（与 pid-config ISO_STATE_STYLE 同源色值） ============
export const ISO_STATE_STYLE: Record<IsoState, { legend: string; fill: string; stroke: string; line: string; dot: string }> = {
  idle: { legend: '常通', fill: '#f5f5f4', stroke: '#a8a29e', line: '#78716c', dot: '#a8a29e' },
  planned: { legend: '已计划', fill: '#fef3c7', stroke: '#d97706', line: '#b45309', dot: '#f59e0b' },
  approved: { legend: '已审核待执行', fill: '#ccfbf1', stroke: '#0d9488', line: '#0f766e', dot: '#14b8a6' },
  working: { legend: '作业执行中', fill: '#fde68a', stroke: '#b45309', line: '#92400e', dot: '#d97706' },
  blinded: { legend: '盲板已装', fill: '#fecdd3', stroke: '#e11d48', line: '#be123c', dot: '#f43f5e' },
  opened: { legend: '盲板已拆', fill: '#d1fae5', stroke: '#059669', line: '#047857', dot: '#10b981' },
}
const ISO_STATE_KEYS = Object.keys(ISO_STATE_STYLE) as IsoState[]

const FONTS = 'PingFang SC, Microsoft YaHei, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const RATIO = CANVAS_H / CANVAS_W
const VB_MIN_W = 300   // 最大放大 4×
const VB_MAX_W = 3000  // 最小放大 0.4×
const STORE_KEY = 'bp-vue-pid-replica-doc-v1'
const TOGGLE_KEY = 'bp-vue-pid-replica-toggles-v1'

// ============ mock 主数据（替代业务 API） ============
const EQUIPS = [
  { id: 'e1', code: 'E-101', name: '原料储罐' },
  { id: 'e2', code: 'E-102', name: '反应釜' },
  { id: 'e3', code: 'E-103', name: '精馏塔' },
  { id: 'e4', code: 'E-104', name: '回流罐' },
  { id: 'e5', code: 'E-105', name: '管壳换热器' },
  { id: 'e6', code: 'P-101A', name: '进料泵' },
]
const PIPES = [
  { id: 'p1', code: 'PL-1201', name: '原料输送线' },
  { id: 'p2', code: 'PL-1202', name: '反应进料线' },
  { id: 'p3', code: 'PL-1203', name: '塔顶回流线' },
  { id: 'p4', code: 'PL-1204', name: '成品输出线' },
  { id: 'p5', code: 'PL-1205', name: '氮封线' },
]
const pipeCodeOf = (id: string | null | undefined) => PIPES.find((p) => p.id === id)?.code ?? ''
const equipOf = (id: string | null | undefined) => EQUIPS.find((e) => e.id === id) ?? null

// 底图（内建 SVG 工厂平面示意，dataURI；替代上传通道）
const BG_HREF = (() => {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700">`
    + `<rect width="1200" height="700" fill="#fafaf9"/>`
    + `<rect x="40" y="40" width="1120" height="620" fill="none" stroke="#d6d3d1" stroke-width="2" stroke-dasharray="10 6"/>`
    + `<rect x="80" y="80" width="380" height="260" rx="6" fill="#f5f5f4" stroke="#d6d3d1"/>`
    + `<text x="90" y="106" font-size="14" fill="#a8a29e">原料储存区</text>`
    + `<rect x="500" y="60" width="300" height="280" rx="6" fill="#f5f5f4" stroke="#d6d3d1"/>`
    + `<text x="510" y="86" font-size="14" fill="#a8a29e">反应区</text>`
    + `<rect x="860" y="60" width="260" height="240" rx="6" fill="#f5f5f4" stroke="#d6d3d1"/>`
    + `<text x="870" y="86" font-size="14" fill="#a8a29e">精馏区</text>`
    + `<rect x="80" y="420" width="500" height="200" rx="6" fill="#f5f5f4" stroke="#d6d3d1"/>`
    + `<text x="90" y="446" font-size="14" fill="#a8a29e">输送泵区</text>`
    + `<rect x="640" y="380" width="480" height="240" rx="6" fill="#f5f5f4" stroke="#d6d3d1"/>`
    + `<text x="650" y="406" font-size="14" fill="#a8a29e">辅助与公用工程区</text>`
    + `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`
})()

// ============ 演示场景（打开即有完整 PID：设备/阀门/管线/隔离点） ============
function demoDoc(): Doc {
  return {
    shapes: [
      { id: 's1', type: 'std', stdId: 'eq-vtank', x: 60, y: 90, w: 96, h: 120, label: 'T-101', equip: 'e1' },
      { id: 's2', type: 'std', stdId: 'eq-pump-c', x: 250, y: 120, w: 64, h: 52, label: 'P-101A', equip: 'e6' },
      { id: 's3', type: 'std', stdId: 'eq-pump-c', x: 250, y: 224, w: 64, h: 52, label: 'P-101B' },
      { id: 's4', type: 'std', stdId: 'vl-gate', x: 372, y: 132, w: 36, h: 28, label: 'XV-101' },
      { id: 's5', type: 'std', stdId: 'eq-stirred-re', x: 480, y: 80, w: 90, h: 140, label: 'R-101', equip: 'e2' },
      { id: 's6', type: 'std', stdId: 'vl-control-pneu', x: 620, y: 268, w: 36, h: 28, label: 'FV-102' },
      { id: 's7', type: 'std', stdId: 'eq-tray-col', x: 730, y: 56, w: 72, h: 200, label: 'C-101', equip: 'e3' },
      { id: 's8', type: 'std', stdId: 'eq-reflux-drum', x: 900, y: 66, w: 110, h: 64, label: 'V-102', equip: 'e4' },
      { id: 's9', type: 'std', stdId: 'vl-ball', x: 872, y: 152, w: 36, h: 28, label: 'XV-103' },
      { id: 's10', type: 'std', stdId: 'eq-bhe', x: 560, y: 392, w: 150, h: 72, label: 'E-101', equip: 'e5' },
      { id: 's11', type: 'std', stdId: 'vl-check-swing', x: 356, y: 236, w: 36, h: 28, label: 'NR-101' },
      { id: 's12', type: 'rect', x: 920, y: 300, w: 130, h: 80, label: '备压区', fill: '#f5f5f4' },
      { id: 's13', type: 'circle', x: 932, y: 440, w: 56, h: 56, label: 'N2', fill: '#ccfbf1' },
      { id: 's14', type: 'std', stdId: 'eq-pump-c', x: 250, y: 396, w: 64, h: 52, label: 'P-102' },
      { id: 's15', type: 'triangle', x: 770, y: 470, w: 70, h: 60, label: '放空', fill: '#fef3c7' },
      { id: 's16', type: 'ellipse', x: 56, y: 380, w: 110, h: 56, label: '氮封', fill: '#d1fae5' },
    ],
    connections: [
      { id: 'c1', fromShape: 's1', fromAnchor: 'bottom', toShape: 's2', toAnchor: 'left', pipe: 'p1', labelT: 0.32 },
      { id: 'c2', fromShape: 's1', fromAnchor: 'bottom', toShape: 's3', toAnchor: 'left', pipe: 'p1' },
      { id: 'c3', fromShape: 's2', fromAnchor: 'right', toShape: 's4', toAnchor: 'left', pipe: 'p2' },
      { id: 'c4', fromShape: 's4', fromAnchor: 'right', toShape: 's5', toAnchor: 'left', toT: 0.35, pipe: 'p2' },
      { id: 'c5', fromShape: 's5', fromAnchor: 'bottom', toShape: 's6', toAnchor: 'top', pipe: 'p2', labelT: 0.45 },
      { id: 'c6', fromShape: 's6', fromAnchor: 'right', toShape: 's7', toAnchor: 'left', pipe: 'p2' },
      { id: 'c7', fromShape: 's7', fromAnchor: 'top', toShape: 's8', toAnchor: 'left', pipe: 'p3' },
      { id: 'c8', fromShape: 's8', fromAnchor: 'bottom', toShape: 's9', toAnchor: 'right', pipe: 'p3', labelT: 0.6 },
      { id: 'c9', fromShape: 's13', fromAnchor: 'top', toShape: 's12', toAnchor: 'bottom', direction: 'none' },
      { id: 'c10', fromShape: 's3', fromAnchor: 'right', toShape: 's11', toAnchor: 'left', pipe: 'p1' },
      { id: 'c11', fromShape: 's11', fromAnchor: 'right', toShape: 's5', toAnchor: 'left', toT: 0.72, pipe: 'p1' },
      { id: 'c12', fromShape: 's14', fromAnchor: 'right', toShape: 's10', toAnchor: 'left', pipe: 'p4', labelT: 0.55 },
      { id: 'c13', fromShape: 's10', fromAnchor: 'right', toShape: 's15', toAnchor: 'left', direction: 'none' },
      { id: 'c14', fromShape: 's16', fromAnchor: 'top', toShape: 's1', toAnchor: 'left', direction: 'reverse', pipe: 'p5' },
    ],
    marks: [
      { id: 'm1', x: 176, y: 168, code: 'ISO-301', name: '原料线隔离', state: 'planned' },
      { id: 'm2', x: 448, y: 210, code: 'ISO-302', name: '反应进料', state: 'approved' },
      { id: 'm3', x: 664, y: 300, code: 'ISO-303', name: '塔进料调节', state: 'working' },
      { id: 'm4', x: 858, y: 122, code: 'ISO-304', name: '塔顶回流', state: 'blinded' },
      { id: 'm5', x: 452, y: 428, code: 'ISO-305', name: '成品输出', state: 'opened' },
    ],
  }
}

// ============ 缩略图指令（palette 宫格复用 mountSymbolThumb） ============
type ThumbHost = HTMLElement & { __thumbDispose?: () => void }
const vThumb: Directive<HTMLElement, SymbolMeta> = {
  mounted(el: ThumbHost, binding) {
    el.__thumbDispose = mountSymbolThumb(el, binding.value, { className: 'h-10 w-full' })
  },
  unmounted(el: ThumbHost) {
    el.__thumbDispose?.()
    el.__thumbDispose = undefined
  },
}

// ============ 内联图标（Vue 壳不引 lucide-react；24×24 stroke 图标） ============
const ICON_PATHS: Record<string, string[]> = {
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-4.5-4.5'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  wand: ['M15 4V2', 'M15 10V8', 'M12.5 6.5H10.5', 'M19.5 6.5H17.5', 'M13.8 5.2 12.4 3.8', 'M17.6 9 19 10.4', 'M13.8 7.8 12.4 9.2', 'M17.6 4 19 2.6', 'M9 21l-6-6L14 4l6 6L9 21z'],
  pin: ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z', 'M9 4v14', 'M15 6v14'],
  expand: ['M8 3H5a2 2 0 0 0-2 2v3', 'M16 3h3a2 2 0 0 1 2 2v3', 'M8 21H5a2 2 0 0 1-2-2v-3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  reset: ['M12 3a9 9 0 1 0 9 9', 'M21 3v6h-6'],
}
function icon(name: string, cls = 'h-4 w-4'): VNode {
  return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: cls, 'aria-hidden': true },
    (ICON_PATHS[name] ?? []).map((d) => h('path', { d })))
}

// ============ Shape IR → Vue vnode（与 core shape-dom 语义一致的 Vue 渲染桥） ============
function irAttrs(s: Shape, paint: ShapePaint): Record<string, unknown> {
  const isText = s.kind === 'text'
  const isGroup = s.kind === 'group'
  const fillable = !isText && !isGroup && s.kind !== 'line'
  const attrs: Record<string, unknown> = {}
  const stroke = resolvePaint(s.stroke, paint)
  const fill = resolvePaint(s.fill, paint)
  attrs.stroke = stroke !== undefined ? stroke : 'none'
  if (fill !== undefined) attrs.fill = fill
  else if (isText) attrs.fill = paint.stroke
  else if (fillable) attrs.fill = 'none'
  if (s.strokeWidth !== undefined) attrs['stroke-width'] = String(s.strokeWidth)
  if (s.dash) attrs['stroke-dasharray'] = s.dash
  if (s.cap) attrs['stroke-linecap'] = s.cap
  if (s.join) attrs['stroke-linejoin'] = s.join
  if (s.opacity !== undefined) attrs.opacity = String(s.opacity)
  if (!isText && !isGroup) attrs['vector-effect'] = 'non-scaling-stroke'
  return attrs
}
function irVnode(s: Shape, paint: ShapePaint): VNode {
  const a = irAttrs(s, paint)
  switch (s.kind) {
    case 'path': return h('path', { ...a, d: s.d })
    case 'circle': return h('circle', { ...a, cx: s.cx, cy: s.cy, r: s.r })
    case 'ellipse': return h('ellipse', { ...a, cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry })
    case 'rect': return h('rect', { ...a, x: s.x, y: s.y, width: s.w, height: s.h, ...(s.rx !== undefined ? { rx: s.rx } : {}) })
    case 'line': return h('line', { ...a, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })
    case 'polyline': return h('polyline', { ...a, points: s.pts.map((p) => p.join(',')).join(' ') })
    case 'polygon': return h('polygon', { ...a, points: s.pts.map((p) => p.join(',')).join(' ') })
    case 'text': return h('text', { ...a, x: s.x, y: s.y, ...(s.size !== undefined ? { 'font-size': s.size } : {}), ...(s.weight !== undefined ? { 'font-weight': s.weight } : {}), ...(s.anchor ? { 'text-anchor': s.anchor } : {}) }, s.text)
    case 'group': return h('g', a, s.children.map((c) => irVnode(c, paint)))
  }
}

// 基础图形 Shape IR（basic 页签缩略图与画布渲染共用）
function basicIr(type: string, w: number, h: number, flip = false): Shape[] {
  const st = '{stroke}'; const fi = '{fill}'
  switch (type) {
    case 'rect': return [{ kind: 'rect', x: 0, y: 0, w, h, rx: 2, stroke: st, fill: fi, strokeWidth: 1.6 }]
    case 'circle': return [{ kind: 'ellipse', cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, stroke: st, fill: fi, strokeWidth: 1.6 }]
    case 'ellipse': return [{ kind: 'ellipse', cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, stroke: st, fill: fi, strokeWidth: 1.6 }]
    case 'line': return [{ kind: 'line', x1: 0, y1: flip ? h : 0, x2: w, y2: flip ? 0 : h, stroke: st, strokeWidth: 1.6, cap: 'round' }]
    case 'triangle': return [{ kind: 'polygon', pts: [[w / 2, 0], [w, h], [0, h]], stroke: st, fill: fi, strokeWidth: 1.6 }]
    default: return []
  }
}

// ============ 挂载入口 ============
export interface PidReplicaHandle {
  unmount: () => void
}
export function mountPidReplica(el: HTMLElement, opts: { onReady?: (info: { vue: string }) => void } = {}): PidReplicaHandle {
  const Root = {
    setup() {
      // ── 注册表 ──
      const stdReg: SymbolRegistry = buildStdRegistry()
      const basicReg: SymbolRegistry = buildBasicRegistry()
      const stdMeta = new Map(stdReg.symbols.map((m) => [m.id, m]))
      const libTab = ref<'std' | 'basic'>('std')
      const libKw = ref('')
      const openGroups = ref<Set<string>>(new Set([stdReg.groups[0]?.id ?? '']))

      // ── 文档与历史 ──
      const stored = (() => {
        try {
          const raw = localStorage.getItem(STORE_KEY)
          if (!raw) return null
          const d = JSON.parse(raw) as Doc
          return Array.isArray(d.shapes) ? d : null
        } catch { return null }
      })()
      const doc = reactive<Doc>(stored ?? demoDoc())
      const history = createHistory<Doc>(80)
      const histSize = ref({ undo: 0, redo: 0 })
      const dirty = ref(false)
      const lastOp = ref('内核就绪：与 pid-config 同源的 40+ core API 已接入')
      const cloneDoc = (): Doc => JSON.parse(JSON.stringify(doc)) as Doc
      const commit = (op?: string) => {
        history.push(cloneDoc())
        histSize.value = history.size()
        dirty.value = true
        if (op) lastOp.value = op
      }
      const flash = (msg: string) => { lastOp.value = msg }

      // ── 模式 / 选中 / 多选 ──
      const mode = ref<'edit' | 'view'>('edit')
      const selected = ref<Selection | null>(null)
      const bulkIds = ref<Set<string>>(new Set())
      const shapeById = (id: string) => doc.shapes.find((s) => s.id === id)
      const connById = (id: string) => doc.connections.find((c) => c.id === id)
      const markById = (id: string) => doc.marks.find((m) => m.id === id)
      const selShape = computed(() => (selected.value?.kind === 'shape' ? shapeById(selected.value.id) ?? null : null))
      const selConn = computed(() => (selected.value?.kind === 'conn' ? connById(selected.value.id) : null))
      const selMark = computed(() => (selected.value?.kind === 'mark' ? markById(selected.value.id) ?? null : null))
      const bulkList = computed(() => doc.shapes.filter((s) => bulkIds.value.has(s.id)))

      // ── 视口 ──
      const vb = ref<Viewport>({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H })
      const svgEl = ref<SVGSVGElement | null>(null)
      const wrapEl = ref<HTMLDivElement | null>(null)
      const miniEl = ref<SVGSVGElement | null>(null)
      const canvasW = ref(1200)
      const canvasH = ref(700)
      const percent = computed(() => Math.round(CANVAS_W / vb.value.w * 100))
      const applyVb = (v: { x: number; y: number; w: number }) => {
        const w = clamp(v.w, VB_MIN_W, VB_MAX_W)
        vb.value = { x: v.x, y: v.y, w, h: w * RATIO }
      }
      const resetView = () => { applyVb({ x: 0, y: 0, w: CANVAS_W }); flash('视图复位 1:1') }
      const zoomBy = (f: number) => applyVb(zoomViewport(vb.value, f, VB_MIN_W, VB_MAX_W))
      const focusWorld = (x: number, y: number, w: number) => applyVb({ x: x - w / 2, y: y - (w * RATIO) / 2, w })
      const scale = () => {
        const r = svgEl.value?.getBoundingClientRect()
        return r && r.width > 0 ? r.width / vb.value.w : 1
      }
      const toPoint = (cx: number, cy: number) => {
        const r = svgEl.value?.getBoundingClientRect()
        if (!r || r.width === 0) return null
        const k = vb.value.w / r.width
        return { x: vb.value.x + (cx - r.left) * k, y: vb.value.y + (cy - r.top) * k }
      }
      const ctl = createCanvasController<{ x: number; y: number }>({ toPoint })

      // ── 图层开关（localStorage 持久化） ──
      const toggles = reactive<Record<string, boolean>>({
        device: true, pipe: true, mark: true, badge: true, grid: true, bg: true, legend: true, minimap: true,
      })
      try {
        const t = JSON.parse(localStorage.getItem(TOGGLE_KEY) ?? '{}') as Record<string, boolean>
        for (const k of Object.keys(toggles)) if (typeof t[k] === 'boolean') toggles[k] = t[k]
      } catch { /* 忽略坏数据 */ }
      const setToggle = (k: string) => {
        toggles[k] = !toggles[k]
        try { localStorage.setItem(TOGGLE_KEY, JSON.stringify({ ...toggles })) } catch { /* 私有模式 */ }
      }
      const bgOpacity = ref(0.55)
      const bgPop = ref(false)

      // ── 工具态 ──
      const placing = ref<{ kind: 'std'; stdId: string } | { kind: 'basic'; type: string } | { kind: 'line' } | { kind: 'mark' } | null>(null)
      const pendingConn = ref<{ shapeId: string; anchor: Anchor; t: number } | null>(null)
      const hoverShapeId = ref<string | null>(null)
      const hoverAnchor = ref<{ shapeId: string; anchor: Anchor; t: number } | null>(null)
      const mouse = ref<{ x: number; y: number } | null>(null)
      const rubber = ref<RubberRect | null>(null)
      const lineDraft = ref<{ sx: number; sy: number; ex: number; ey: number } | null>(null)
      const connDraft = ref<{ from: { shapeId: string; anchor: Anchor; t: number }; to: ConnEndTarget | null; cx: number; cy: number } | null>(null)
      const connEndDrag = ref<ConnEndTarget | null>(null)
      const markSeq = ref(doc.marks.length + 1)
      const typeSeq: Record<string, number> = {}
      const autoLabel = (type: string) => {
        typeSeq[type] = (typeSeq[type] ?? 0) + 1
        const lib = pidTypeLibOf(type)
        return `${lib.label}-${typeSeq[type]}`
      }

      // ── 搜索定位 ──
      const searchOpen = ref(false)
      const searchQ = ref('')
      const locateHit = ref<{ kind: 'shape' | 'mark'; id: string } | null>(null)
      let locateTimer: ReturnType<typeof setTimeout> | undefined
      const equipText = (s: RShape) => {
        const e = equipOf(s.equip)
        return e ? `${e.code} ${e.name}` : ''
      }
      const searchResults = computed(() => {
        const q = searchQ.value.trim().toLowerCase()
        if (!q) return []
        const out: { kind: 'shape' | 'mark'; id: string; title: string; sub: string }[] = []
        for (const s of doc.shapes) {
          const hay = `${s.label} ${equipText(s)}`.toLowerCase()
          if (hay.includes(q)) out.push({ kind: 'shape', id: s.id, title: s.label, sub: equipText(s) || pidTypeLabel(s.type) })
        }
        for (const m of doc.marks) {
          const hay = `${m.code} ${m.name}`.toLowerCase()
          if (hay.includes(q)) out.push({ kind: 'mark', id: m.id, title: m.code, sub: m.name || '隔离点' })
        }
        return out.slice(0, 10)
      })
      const runLocate = (r: { kind: 'shape' | 'mark'; id: string } | undefined) => {
        if (!r) return
        if (r.kind === 'shape') {
          const s = shapeById(r.id)
          if (s) focusWorld(s.x + s.w / 2, s.y + s.h / 2, Math.max(s.w, s.h) * 3.5)
        } else {
          const m = markById(r.id)
          if (m) focusWorld(m.x, m.y, 300)
        }
        locateHit.value = { kind: r.kind, id: r.id }
        clearTimeout(locateTimer)
        locateTimer = setTimeout(() => { locateHit.value = null }, 2600)
        searchOpen.value = false
        flash(`定位：${r.kind === 'shape' ? '图元' : '隔离点'} ${r.id}`)
      }

      // ── 查看态：隔离点档案卡（mock 替代作业票 API） ──
      const markCard = ref<{ x: number; y: number; id: string } | null>(null)
      const mockRefs = (m: RMark) => ({
        req: `BP-2026${(100 + m.code.charCodeAt(m.code.length - 1)) % 900}-…`,
        ticket: m.state === 'idle' ? '—' : `BP-${m.code.slice(-3)}`,
      })

      // ── 几何：连线折线 / 徽章位置 ──
      const connPts = (c: RConn): [number, number][] => {
        const a = shapeById(c.fromShape)
        const b = shapeById(c.toShape)
        if (!a || !b) return []
        return routeConnection(
          { ...anchorPointT(a, c.fromAnchor, c.fromT), anchor: physAnchor(a, c.fromAnchor) },
          { ...anchorPointT(b, c.toAnchor, c.toT), anchor: physAnchor(b, c.toAnchor) },
          c.fromShape === c.toShape, c.midOverride,
        )
      }
      const selRing = (s: RShape) => h('rect', {
        x: s.x - 6, y: s.y - 6, width: s.w + 12, height: s.h + 12, rx: 4,
        fill: 'none', stroke: TEAL, 'stroke-width': 1.2, 'stroke-dasharray': '5 3', 'data-noexport': '1',
      })

      // ── 文档操作 ──
      const addShape = (type: string, x: number, y: number, w: number, hgt: number, stdId?: string) => {
        commit(`放置 ${stdId ? (stdMeta.get(stdId)?.label ?? stdId) : pidTypeLabel(type)}`)
        doc.shapes.push({
          id: uid('s'), type, stdId, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hgt),
          label: autoLabel(type), fill: '#ffffff',
        })
        flash(`已放置 ${pidTypeLabel(type)}（继续点击可连续放置，Esc 退出）`)
      }
      const addMark = (x: number, y: number) => {
        commit('标注隔离点')
        const code = `ISO-3${String(markSeq.value).padStart(2, '0')}`
        markSeq.value += 1
        doc.marks.push({ id: uid('m'), x: Math.round(x), y: Math.round(y), code, name: '', state: 'idle' })
        selected.value = { kind: 'mark', id: doc.marks[doc.marks.length - 1].id }
        flash(`已标注 ${code}（右侧面板可命名与模拟状态）`)
      }
      const commitConn = (
        from: { shapeId: string; anchor: Anchor; t?: number },
        to: { shapeId: string; anchor: Anchor; t?: number },
      ) => {
        if (from.shapeId === to.shapeId && from.anchor === to.anchor && Math.abs((from.t ?? 0.5) - (to.t ?? 0.5)) < 1e-6) return
        if (connExists(doc.connections, from, to)) { flash('已存在同向连线，已取消'); return }
        commit('创建连线')
        doc.connections.push({
          id: uid('c'), fromShape: from.shapeId, fromAnchor: from.anchor, fromT: freeT(from.t),
          toShape: to.shapeId, toAnchor: to.anchor, toT: freeT(to.t), direction: 'forward', pipe: null,
        })
        flash('连线创建（两步锚点流）')
      }
      const deleteSelection = () => {
        const sel = selected.value
        if (sel?.kind === 'shape') {
          const ids = bulkIds.value.size > 1 ? [...bulkIds.value] : [sel.id]
          commit(`删除 ${ids.length} 个图元`)
          doc.shapes = doc.shapes.filter((s) => !ids.includes(s.id))
          doc.connections = doc.connections.filter((c) => !ids.includes(c.fromShape) && !ids.includes(c.toShape))
          selected.value = null; bulkIds.value = new Set()
        } else if (sel?.kind === 'conn') {
          commit('删除连线')
          doc.connections = doc.connections.filter((c) => c.id !== sel.id)
          selected.value = null
        } else if (sel?.kind === 'mark') {
          commit('删除标注')
          doc.marks = doc.marks.filter((m) => m.id !== sel.id)
          selected.value = null
        }
      }
      const applyAlign = (m: Parameters<typeof alignBoxes>[2]) => {
        const patches = alignBoxes(doc.shapes, [...bulkIds.value], m)
        if (!patches.length) return
        commit('多选对齐')
        for (const p of patches) { const s = shapeById(p.id); if (s) { s.x = p.x; s.y = p.y } }
        flash(`对齐完成（${patches.length} 个图元）`)
      }
      const applyDistribute = (axis: 'h' | 'v') => {
        const patches = distributeBoxes(doc.shapes, [...bulkIds.value], axis)
        if (patches === null) { flash('均匀分布至少需要 3 个图元'); return }
        if (!patches.length) { flash('图元重叠，无法分布'); return }
        commit('多选分布')
        for (const p of patches) { const s = shapeById(p.id); if (s) { s.x = p.x; s.y = p.y } }
        flash('均匀分布完成')
      }
      const duplicateSel = () => {
        const s = selShape.value
        if (!s) return
        commit('复制图元')
        const copy: RShape = { ...s, id: uid('s'), x: s.x + 24, y: s.y + 24, label: `${s.label}-副本`, equip: null }
        doc.shapes.push(copy)
        selected.value = { kind: 'shape', id: copy.id }
        bulkIds.value = new Set()
        flash(`已复制 ${s.label}`)
      }
      const undo = () => {
        const snap = history.undo(cloneDoc())
        if (!snap) return
        doc.shapes = snap.shapes; doc.connections = snap.connections; doc.marks = snap.marks
        selected.value = null; bulkIds.value = new Set()
        histSize.value = history.size(); dirty.value = true
        flash('撤销')
      }
      const redo = () => {
        const snap = history.redo(cloneDoc())
        if (!snap) return
        doc.shapes = snap.shapes; doc.connections = snap.connections; doc.marks = snap.marks
        selected.value = null; bulkIds.value = new Set()
        histSize.value = history.size(); dirty.value = true
        flash('重做')
      }
      const saveDoc = () => {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); dirty.value = false; flash('已保存到浏览器本地') }
        catch { flash('保存失败（存储不可用）') }
      }
      const resetDemo = () => {
        commit('重置演示场景')
        const d = demoDoc()
        doc.shapes = d.shapes; doc.connections = d.connections; doc.marks = d.marks
        selected.value = null; bulkIds.value = new Set(); markSeq.value = 6
        applyVb({ x: 0, y: 0, w: CANVAS_W })
        flash('演示场景已重置')
      }

      // ── 交互：画布空白 ──
      const startPan = (e: PointerEvent) => {
        const startVb = { ...vb.value }
        const k = scale()
        const sx = e.clientX; const sy = e.clientY
        ctl.run({
          kind: 'pan', start: { x: sx, y: sy },
          toPoint: (cx, cy) => ({ x: cx, y: cy }),
          moveThreshold: 4,
          onMove: (p) => applyVb(panByScreen(startVb, p.x - sx, p.y - sy, k)),
          onEnd: (_p, s) => {
            ctl.guard.arm('click')
            if (!s.moved) { selected.value = null; bulkIds.value = new Set(); markCard.value = null }
          },
        })
      }
      const startRubber = (sx: number, sy: number) => {
        let r: RubberRect = { x0: sx, y0: sy, x1: sx, y1: sy }
        ctl.run({
          kind: 'select', start: { x: sx, y: sy }, moveThreshold: 3,
          onMove: (p) => { r = normRect(sx, sy, p.x, p.y); rubber.value = { ...r } },
          onEnd: (_p, s) => {
            rubber.value = null; ctl.guard.arm('click')
            if (!s.moved || !isRealRubber(r)) return
            const ids = hitTestRect(doc.shapes, r)
            bulkIds.value = new Set(ids)
            if (ids.length) { const last = ids[ids.length - 1]; selected.value = { kind: 'shape', id: last } }
            flash(`框选命中 ${ids.length} 个图元`)
          },
        })
      }
      const svgDown = (e: PointerEvent) => {
        markCard.value = null
        const p = toPoint(e.clientX, e.clientY)
        if (!p) return
        if (mode.value !== 'edit') { startPan(e); return }
        const pl = placing.value
        if (pl?.kind === 'std') {
          const meta = stdMeta.get(pl.stdId)
          if (meta) addShape('std', p.x - meta.defaultW / 2, p.y - meta.defaultH / 2, meta.defaultW, meta.defaultH, pl.stdId)
          return
        }
        if (pl?.kind === 'basic') {
          const meta = basicReg.symbols.find((m) => m.id === pl.type)
          if (meta) addShape(pl.type, p.x - meta.defaultW / 2, p.y - meta.defaultH / 2, meta.defaultW, meta.defaultH)
          return
        }
        if (pl?.kind === 'mark') { addMark(p.x, p.y); return }
        if (pl?.kind === 'line') {
          let d = { sx: p.x, sy: p.y, ex: p.x, ey: p.y }
          ctl.run({
            kind: 'line-draft', start: p,
            onMove: (q, s, first) => {
              if (first) { d = { sx: p.x, sy: p.y, ex: p.x, ey: p.y }; lineDraft.value = { ...d } }
              d = { ...d, ex: q.x, ey: q.y }
              lineDraft.value = { ...d }
            },
            onEnd: (q, s) => {
              lineDraft.value = null; ctl.guard.arm('lineEnd')
              const fin = { sx: d.sx, sy: d.sy, ex: q?.x ?? d.ex, ey: q?.y ?? d.ey }
              if (!s.moved || isTinyLineDraft(fin, 5)) return
              commit('绘制直线')
              const x = Math.min(fin.sx, fin.ex); const y = Math.min(fin.sy, fin.ey)
              const w = Math.max(12, Math.abs(fin.ex - fin.sx)); const h2 = Math.max(2, Math.abs(fin.ey - fin.sy))
              const flip = (fin.ex >= fin.sx) !== (fin.ey >= fin.sy)
              doc.shapes.push({ id: uid('s'), type: 'line', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h2), label: autoLabel('line'), flip })
            },
          })
          return
        }
        if (pendingConn.value) { pendingConn.value = null; return }
        if (e.shiftKey || e.ctrlKey || e.metaKey) { startRubber(p.x, p.y); return }
        startPan(e)
      }
      const svgMove = (e: PointerEvent) => {
        mouse.value = toPoint(e.clientX, e.clientY)
      }
      const svgLeave = () => { mouse.value = null; hoverShapeId.value = null }
      const onWheel = (e: WheelEvent) => {
        const r = svgEl.value?.getBoundingClientRect()
        if (!r) return
        const intent = wheelZoomIntent(e, r, vb.value)
        if (!intent) return
        e.preventDefault()
        applyVb(zoomViewport(vb.value, intent.factor, VB_MIN_W, VB_MAX_W, intent.ax, intent.ay))
      }

      // ── 交互：图元 ──
      const shapeDown = (s: RShape, e: PointerEvent) => {
        if (mode.value !== 'edit') return
        e.stopPropagation()
        const p = toPoint(e.clientX, e.clientY)
        if (!p) return
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          const next = new Set(bulkIds.value)
          if (next.has(s.id)) next.delete(s.id); else next.add(s.id)
          bulkIds.value = next
          selected.value = { kind: 'shape', id: s.id }
          return
        }
        if (bulkIds.value.size && !bulkIds.value.has(s.id)) bulkIds.value = new Set()
        selected.value = { kind: 'shape', id: s.id }
        markCard.value = null
        const isBulkDrag = bulkIds.value.size > 1 && bulkIds.value.has(s.id)
        const origins = new Map(bulkList.value.map((x) => [x.id, { x: x.x, y: x.y }]))
        const offX = p.x - s.x; const offY = p.y - s.y
        ctl.run({
          kind: 'drag-shape', targetId: s.id, start: p,
          onMove: (q, sess, first) => {
            if (first && !sess.data.pushed) { commit('拖动图元'); sess.data.pushed = true; ctl.guard.arm('shapeClick') }
            if (isBulkDrag) {
              const dx = q.x - p.x; const dy = q.y - p.y
              for (const [id, o] of origins) { const t = shapeById(id); if (t) { t.x = Math.round(o.x + dx); t.y = Math.round(o.y + dy) } }
            } else { s.x = Math.round(q.x - offX); s.y = Math.round(q.y - offY) }
          },
          onEnd: () => ctl.guard.arm('shapeClick'),
        })
      }
      const resizeDown = (s: RShape, handle: 'nw' | 'ne' | 'sw' | 'se', e: PointerEvent) => {
        e.stopPropagation(); e.preventDefault()
        const p = toPoint(e.clientX, e.clientY)
        if (!p) return
        const fixed = handle === 'nw' || handle === 'sw' ? s.x + s.w : s.x
        const b0 = { x: s.x, y: s.y, w: s.w, h: s.h }
        const min = s.type === 'std' ? { minW: 20, minH: 16 } : { minW: pidTypeLibOf(s.type).minW, minH: pidTypeLibOf(s.type).minH }
        ctl.run({
          kind: 'resize', targetId: s.id, start: { x: fixed, y: handle === 'nw' || handle === 'ne' ? s.y + s.h : s.y },
          onMove: (q, sess, first) => {
            if (first && !sess.data.pushed) { commit('缩放图元'); sess.data.pushed = true; ctl.guard.arm('shapeClick') }
            const r = resizeBox({
              handle, box: b0, px: q.x, py: q.y, minW: min.minW, minH: min.minH,
              lockSquare: s.type === 'circle',
            })
            s.x = r.x; s.y = r.y; s.w = r.w; s.h = r.h
            if (s.type === 'line') s.flip = r.flip
          },
          onEnd: () => ctl.guard.arm('shapeClick'),
        })
      }

      // ── 交互：锚点环带（连线两步 + 一步拖拽） ──
      const bandDown = (s: RShape, e: PointerEvent) => {
        if (mode.value !== 'edit') return
        e.stopPropagation()
        const p = toPoint(e.clientX, e.clientY)
        if (!p) return
        if (pendingConn.value) {
          const t = nearestFreeAnchorAt(s, p.x, p.y)
          commitConn(pendingConn.value, { shapeId: s.id, ...t })
          pendingConn.value = null
          return
        }
        const src = nearestFreeAnchorAt(s, p.x, p.y)
        let draft = { from: { shapeId: s.id, ...src }, to: null as ConnEndTarget | null, cx: p.x, cy: p.y }
        connDraft.value = { ...draft }
        ctl.run({
          kind: 'conn-draft', targetId: s.id, start: p, moveThreshold: 4,
          onMove: (q, sess, first) => {
            if (first) ctl.guard.arm('shapeClick')
            draft = { ...draft, to: snapConnEnd(doc.shapes, q.x, q.y), cx: q.x, cy: q.y }
            connDraft.value = { ...draft }
          },
          onEnd: (q, s2) => {
            connDraft.value = null
            if (s2.moved) {
              ctl.guard.arm('click')
              if (q && draft.to) commitConn(draft.from, { shapeId: draft.to.shapeId, anchor: draft.to.anchor, t: draft.to.t })
            } else {
              ctl.guard.arm('shapeClick')
              pendingConn.value = { shapeId: s.id, ...src }
              selected.value = { kind: 'shape', id: s.id }
              bulkIds.value = new Set()
              flash('连线挂起：点击目标图元完成（Esc 取消）')
            }
          },
        })
      }
      const bandMove = (s: RShape, e: PointerEvent) => {
        if (mode.value !== 'edit' || pendingConn.value || connDraft.value) return
        const p = toPoint(e.clientX, e.clientY)
        if (!p) return
        hoverAnchor.value = { shapeId: s.id, ...nearestFreeAnchorAt(s, p.x, p.y) }
      }
      const bandLeave = () => { hoverAnchor.value = null }

      // ── 交互：连线 ──
      const connDown = (c: RConn, e: PointerEvent) => {
        if (mode.value !== 'edit') return
        e.stopPropagation()
        if (ctl.guard.block('connDragEnd') || ctl.guard.block('shapeClick')) return
        selected.value = { kind: 'conn', id: c.id }
        bulkIds.value = new Set()
      }
      const badgeDown = (c: RConn, e: PointerEvent) => {
        if (mode.value !== 'edit') return
        e.stopPropagation()
        const pts = connPts(c)
        if (pts.length < 2) return
        ctl.run({
          kind: 'conn-label', targetId: c.id, start: toPoint(e.clientX, e.clientY) ?? { x: 0, y: 0 },
          onMove: (q, sess, first) => {
            if (first && !sess.data.pushed) { commit('调整管线号位置'); sess.data.pushed = true }
            const t = labelTAt(pts, q.x, q.y)
            if (t !== null) c.labelT = t
          },
          onEnd: () => ctl.guard.arm('connDragEnd'),
        })
      }
      const endHandleDown = (c: RConn, which: 'from' | 'to', e: PointerEvent) => {
        e.stopPropagation()
        let preview: ConnEndTarget | null = null
        ctl.run({
          kind: 'conn-end', targetId: c.id, start: toPoint(e.clientX, e.clientY) ?? { x: 0, y: 0 },
          onMove: (q) => { preview = snapConnEnd(doc.shapes, q.x, q.y); connEndDrag.value = preview },
          onEnd: () => {
            connEndDrag.value = null
            const target = preview
            if (target) {
              const r = rewireConnTarget(doc.connections, c.id, which, { shapeId: target.shapeId, anchor: target.anchor, t: target.t })
              if (r.ok) { commit('端点改接'); doc.connections = r.conns; flash('端点已改接（中段布线已复位自动）') }
              else if (r.reason === 'dup') flash('改接取消：存在同向重复连线')
              else if (r.reason === 'same-anchor') flash('改接取消：起点终点重合')
            }
            ctl.guard.arm('connDragEnd')
          },
        })
      }
      const segDown = (c: RConn, e: PointerEvent) => {
        if (mode.value !== 'edit') return
        e.stopPropagation()
        const a = shapeById(c.fromShape); const b = shapeById(c.toShape)
        if (!a || !b) return
        const aH = physAnchor(a, c.fromAnchor) === 'left' || physAnchor(a, c.fromAnchor) === 'right'
        const bH = physAnchor(b, c.toAnchor) === 'left' || physAnchor(b, c.toAnchor) === 'right'
        const axis: 'x' | 'y' = aH && bH ? 'x' : (!aH && !bH ? 'y' : 'x')
        ctl.run({
          kind: 'conn-seg', targetId: c.id, start: toPoint(e.clientX, e.clientY) ?? { x: 0, y: 0 },
          onMove: (q, sess, first) => {
            if (first && !sess.data.pushed) { commit('调整布线中段'); sess.data.pushed = true }
            c.midOverride = Math.round(axis === 'x' ? q.x : q.y)
          },
          onEnd: () => ctl.guard.arm('connDragEnd'),
        })
      }
      const markDown = (m: RMark, e: PointerEvent) => {
        if (mode.value === 'view') {
          markCard.value = { x: e.clientX, y: e.clientY, id: m.id }
          return
        }
        e.stopPropagation()
        const p = toPoint(e.clientX, e.clientY)
        if (!p) return
        selected.value = { kind: 'mark', id: m.id }
        bulkIds.value = new Set()
        const offX = p.x - m.x; const offY = p.y - m.y
        ctl.run({
          kind: 'drag-mark', targetId: m.id, start: p,
          onMove: (q, sess, first) => {
            if (first && !sess.data.pushed) { commit('拖动标注'); sess.data.pushed = true; ctl.guard.arm('click') }
            m.x = Math.round(q.x - offX); m.y = Math.round(q.y - offY)
          },
          onEnd: () => ctl.guard.arm('click'),
        })
      }

      // ── 键盘 ──
      const onKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        if (mode.value !== 'edit' && e.key !== 'Escape') return
        const mod = e.ctrlKey || e.metaKey
        if (e.key === 'Escape') {
          if (markCard.value) markCard.value = null
          else if (lineDraft.value) lineDraft.value = null
          else if (placing.value) { placing.value = null; flash('已退出放置模式') }
          else if (pendingConn.value) pendingConn.value = null
          else if (bulkIds.value.size) bulkIds.value = new Set()
          else if (selected.value) selected.value = null
          searchOpen.value = false
          return
        }
        if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
        if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return }
        if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSel(); return }
        if (mod && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault()
          bulkIds.value = new Set(doc.shapes.map((s) => s.id))
          if (doc.shapes.length) selected.value = { kind: 'shape', id: doc.shapes[doc.shapes.length - 1].id }
          flash(`全选 ${doc.shapes.length} 个图元`)
          return
        }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return }
        if (e.key.startsWith('Arrow')) {
          const d = e.shiftKey ? 10 : 2
          const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
          const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
          if (!dx && !dy) return
          e.preventDefault()
          const targets = bulkIds.value.size > 1 ? bulkList.value : selShape.value ? [selShape.value] : selMark.value ? [] : []
          if (targets.length) {
            commit('方向键微移')
            for (const s of targets) { s.x += dx; s.y += dy }
          } else if (selMark.value) {
            commit('方向键微移')
            selMark.value.x += dx; selMark.value.y += dy
          }
        }
      }
      window.addEventListener('keydown', onKey)

      // ── 俯瞰图导航 ──
      const miniDown = (e: PointerEvent) => {
        const mm = svgEl.value
        const mini = miniEl.value
        if (!mm || !mini) return
        const nav = (cx: number, cy: number) => {
          const w = minimapNavigateWorld(cx, cy, mini.getBoundingClientRect(), minimapBoundsOf(vb.value))
          if (w) applyVb({ x: w.x - vb.value.w / 2, y: w.y - vb.value.h / 2, w: vb.value.w })
        }
        nav(e.clientX, e.clientY)
        ctl.run({
          kind: 'custom', start: { x: e.clientX, y: e.clientY },
          toPoint: (cx, cy) => ({ x: cx, y: cy }),
          onMove: (p) => nav(p.x, p.y),
        })
      }

      // ── 画布容器尺寸跟踪：盒尺寸 = 容器内最大 12:7 内接矩形（杜绝 letterbox 与比例漂移） ──
      const ro = new ResizeObserver(() => {
        const r = wrapEl.value?.getBoundingClientRect()
        if (r && r.width > 0 && r.height > 0) {
          const w = Math.min(r.width, r.height * CANVAS_W / CANVAS_H)
          canvasW.value = w
          canvasH.value = w * CANVAS_H / CANVAS_W
        }
      })

      // ── 保存 / 导出 ──
      const download = (blob: Blob, name: string) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      }
      const buildExportSvg = async (): Promise<string | null> => {
        const live = svgEl.value
        if (!live) return null
        selected.value = null; bulkIds.value = new Set(); locateHit.value = null
        hoverAnchor.value = null; hoverShapeId.value = null
        await nextTick()
        const clone = live.cloneNode(true) as SVGSVGElement
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
        clone.setAttribute('viewBox', `0 0 ${CANVAS_W} ${CANVAS_H}`)
        clone.setAttribute('width', String(CANVAS_W))
        clone.setAttribute('height', String(CANVAS_H))
        clone.removeAttribute('class'); clone.removeAttribute('style')
        for (const el of Array.from(clone.querySelectorAll('[class]'))) el.removeAttribute('class')
        for (const el of Array.from(clone.querySelectorAll('[data-noexport]'))) el.remove()
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        bg.setAttribute('x', '0'); bg.setAttribute('y', '0')
        bg.setAttribute('width', String(CANVAS_W)); bg.setAttribute('height', String(CANVAS_H))
        bg.setAttribute('fill', '#ffffff')
        clone.insertBefore(bg, clone.firstChild)
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
        style.textContent = `text{font-family:ui-sans-serif,system-ui,${FONTS}}`
        clone.insertBefore(style, clone.firstChild)
        return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`
      }
      const exporting = ref(false)
      const doExport = async (fmt: 'svg' | 'png') => {
        exporting.value = true
        try {
          const str = await buildExportSvg()
          if (!str) return
          if (fmt === 'svg') {
            download(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }), 'Vue复刻_PID图纸.svg')
            flash('已导出 SVG 矢量图（1200×700）')
          } else {
            const img = new Image()
            await new Promise<void>((res, rej) => {
              img.onload = () => res()
              img.onerror = () => rej(new Error('解码失败'))
              img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(str)}`
            })
            const cv = document.createElement('canvas')
            cv.width = CANVAS_W * 2; cv.height = CANVAS_H * 2
            const ctx = cv.getContext('2d')
            if (!ctx) throw new Error('canvas 不可用')
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height)
            ctx.drawImage(img, 0, 0, cv.width, cv.height)
            const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'))
            if (blob) { download(blob, 'Vue复刻_PID图纸.png'); flash('已导出 PNG 位图（2400×1400 · 2×）') }
          }
        } catch (err) {
          flash(`导出失败：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          exporting.value = false
        }
      }

      // ══════════ 渲染区 ══════════
      const shapeBody = (s: RShape): VNode[] => {
        const paint: ShapePaint = { stroke: s.stroke ?? STROKE, fill: s.fill ?? '#ffffff' }
        if (s.type === 'std') {
          const data = s.stdId ? STD_SHAPE_DATA[s.stdId] : undefined
          if (!data) {
            return [h('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 3, fill: paint.fill, stroke: paint.stroke, 'stroke-width': 1.5, 'stroke-dasharray': '5 3' })]
          }
          const k = `translate(${s.x} ${s.y}) scale(${s.w / data.sw} ${s.h / data.sh})`
          return [h('g', { transform: k }, data.shapes.map((ir) => irVnode(ir, paint)))]
        }
        return [basicShapeVnode(s, paint)]
      }
      function basicShapeVnode(s: RShape, paint: ShapePaint): VNode {
        switch (s.type) {
          case 'rect': return h('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 2, fill: paint.fill, stroke: paint.stroke, 'stroke-width': 1.6 })
          case 'circle': return h('ellipse', { cx: s.x + s.w / 2, cy: s.y + s.h / 2, rx: s.w / 2, ry: s.h / 2, fill: paint.fill, stroke: paint.stroke, 'stroke-width': 1.6 })
          case 'ellipse': return h('ellipse', { cx: s.x + s.w / 2, cy: s.y + s.h / 2, rx: s.w / 2, ry: s.h / 2, fill: paint.fill, stroke: paint.stroke, 'stroke-width': 1.6 })
          case 'line': return h('line', { x1: s.x, y1: s.flip ? s.y + s.h : s.y, x2: s.x + s.w, y2: s.flip ? s.y : s.y + s.h, stroke: paint.stroke, 'stroke-width': 1.6, 'stroke-linecap': 'round' })
          case 'triangle': return h('polygon', { points: `${s.x + s.w / 2},${s.y} ${s.x + s.w},${s.y + s.h} ${s.x},${s.y + s.h}`, fill: paint.fill, stroke: paint.stroke, 'stroke-width': 1.6 })
          default: return h('rect', { x: s.x, y: s.y, width: s.w, height: s.h, fill: paint.fill, stroke: paint.stroke })
        }
      }

      const renderShapes = () => doc.shapes.map((s) => {
        const isSel = selected.value?.kind === 'shape' && selected.value.id === s.id
        const isBulk = bulkIds.value.has(s.id)
        const hovered = hoverShapeId.value === s.id
        const eq = equipOf(s.equip)
        const children: VNode[] = [...shapeBody(s)]
        if (toggles.device && s.type !== 'line') {
          children.push(h('text', {
            x: s.x + s.w / 2, y: shapeLabelY(s), 'text-anchor': 'middle', 'font-size': 12,
            fill: '#57534e', stroke: '#ffffff', 'stroke-width': 3, 'paint-order': 'stroke',
            'font-family': FONTS, 'pointer-events': 'none',
          }, s.label))
        }
        if (toggles.badge && eq) {
          const cx = s.x + s.w / 2; const cy = s.y + s.h / 2
          const bw = eq.code.length * 5.6 + 10
          children.push(
            h('rect', { x: cx - bw / 2, y: cy - 6.5, width: bw, height: 13, rx: 3, fill: '#f0fdfa', stroke: '#5eead4', 'stroke-width': 0.8, 'pointer-events': 'none' }),
            h('text', { x: cx, y: cy + 3, 'text-anchor': 'middle', 'font-size': 8.5, fill: '#0f766e', 'font-family': MONO, 'pointer-events': 'none' }, eq.code),
            h('title', null, `已绑定设备：${eq.code} ${eq.name}`),
          )
        }
        return h('g', {
          key: s.id, 'data-shape': s.id,
          style: `cursor:${mode.value === 'edit' ? 'move' : 'default'};`,
          onPointerdown: (e: PointerEvent) => shapeDown(s, e),
          onPointerenter: () => { hoverShapeId.value = s.id },
          onPointerleave: () => { if (hoverShapeId.value === s.id) hoverShapeId.value = null },
        }, children)
      })

      const renderConnections = () => doc.connections.map((c) => {
        const pts = connPts(c)
        if (pts.length < 2) return null
        const isSel = selected.value?.kind === 'conn' && selected.value.id === c.id
        const stroke = isSel ? ROSE : LINE
        const dir = c.direction ?? 'forward'
        const a: Record<string, unknown> = {
          points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke,
          'stroke-width': isSel ? 2 : 1.4, 'marker-end': dir === 'forward' ? 'url(#pr-arrow)' : undefined,
          'marker-start': dir === 'reverse' ? 'url(#pr-arrow-rev)' : undefined,
        }
        const hit = h('polyline', {
          points: a.points, fill: 'none', stroke: 'transparent', 'stroke-width': 10,
          style: 'cursor:pointer;', onPointerdown: (e: PointerEvent) => connDown(c, e), 'data-noexport': '1',
        })
        return h('g', { key: c.id }, [h('polyline', a), hit])
      })

      const renderBadges = () => {
        if (!toggles.pipe) return null
        return doc.connections.map((c) => {
          if (!c.pipe) return null
          const pts = connPts(c)
          if (pts.length < 2) return null
          const label = pipeCodeOf(c.pipe)
          if (!label) return null
          const t = clamp(c.labelT ?? 0.5, 0, 1)
          const lp = pointAlongPolyline(pts, t)
          if (!lp) return null
          const wHalf = label.length * 3.4 + 6
          const isSel = selected.value?.kind === 'conn' && selected.value.id === c.id
          const active = isSel
          const strokeC = active ? ROSE : '#0d9488'
          const textC = active ? ROSE : '#0f766e'
          return h('g', { key: c.id, 'data-noexport': undefined }, [
            h('rect', {
              x: lp.x - wHalf - 3, y: lp.y - 9, width: wHalf * 2 + 6, height: 18, rx: 6,
              fill: 'transparent', style: 'cursor:grab;', 'data-noexport': '1',
              onPointerdown: (e: PointerEvent) => badgeDown(c, e),
            }, [h('title', null, '拖动可沿线调整标注位置；点击选中连线')]),
            h('rect', { x: lp.x - wHalf, y: lp.y - 8, width: wHalf * 2, height: 16, rx: 4, fill: '#ffffff', opacity: 0.95, stroke: strokeC, 'stroke-width': active ? 1.6 : 1, 'pointer-events': 'none' }),
            h('text', { x: lp.x, y: lp.y + 3.5, 'text-anchor': 'middle', 'font-size': 9, fill: textC, 'font-family': MONO, 'pointer-events': 'none' }, label),
          ])
        })
      }

      const renderMarks = () => doc.marks.map((m) => {
        const st = ISO_STATE_STYLE[m.state] ?? ISO_STATE_STYLE.idle
        const isSel = selected.value?.kind === 'mark' && selected.value.id === m.id
        const edit = mode.value === 'edit'
        const kids: VNode[] = []
        if (edit) {
          kids.push(h('circle', { cx: m.x, cy: m.y, r: 14, fill: 'transparent', 'data-noexport': '1', style: 'cursor:move;', onPointerdown: (e: PointerEvent) => markDown(m, e) }))
          kids.push(h('polygon', { points: `${m.x},${m.y - 7} ${m.x + 7},${m.y} ${m.x},${m.y + 7} ${m.x - 7},${m.y}`, fill: '#f43f5e', stroke: '#ffffff', 'stroke-width': 1.4, 'pointer-events': 'none' }))
          kids.push(h('text', { x: m.x, y: m.y + 20, 'text-anchor': 'middle', 'font-size': 11, fill: '#44403c', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke', 'font-family': FONTS, 'pointer-events': 'none' }, m.code))
        } else {
          kids.push(h('polygon', {
            points: `${m.x},${m.y - 7} ${m.x + 7},${m.y} ${m.x},${m.y + 7} ${m.x - 7},${m.y}`,
            fill: st.fill, stroke: st.stroke, 'stroke-width': 1.6, style: 'cursor:pointer;',
            onPointerdown: (e: PointerEvent) => markDown(m, e),
          }, [h('title', null, `${m.code} ${m.name} · ${st.legend}`)]))
          if (toggles.mark) {
            const chipW = st.legend.length * 10.5 + 12
            kids.push(
              h('rect', { x: m.x - chipW / 2, y: m.y + 11, width: chipW, height: 16, rx: 3, fill: st.fill, stroke: st.stroke, 'stroke-width': 0.8, 'pointer-events': 'none' }),
              h('text', { x: m.x, y: m.y + 22.5, 'text-anchor': 'middle', 'font-size': 10, fill: st.line, 'font-family': FONTS, 'pointer-events': 'none' }, st.legend),
              h('text', { x: m.x, y: m.y + 40, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#78716c', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke', 'font-family': MONO, 'pointer-events': 'none' }, m.code),
            )
          }
        }
        if (isSel) kids.push(h('circle', { cx: m.x, cy: m.y, r: 11, fill: 'none', stroke: TEAL, 'stroke-width': 1.2, 'stroke-dasharray': '3 2', 'data-noexport': '1' }))
        return h('g', { key: m.id }, kids)
      })

      const renderOverlay = () => {
        const out: VNode[] = []
        // 锚点环带 / 挂起实心命中区（编辑态）
        if (mode.value === 'edit') {
          for (const s of doc.shapes) {
            out.push(h('path', {
              d: pendingConn.value ? anchorHitSolidPath(s, 18) : anchorHitBandPath(s, 18),
              fill: pendingConn.value ? (pendingConn.value.shapeId === s.id ? 'rgba(13,148,136,0.06)' : 'rgba(13,148,136,0.10)') : 'transparent',
              'fill-rule': 'evenodd', stroke: 'none', 'data-noexport': '1',
              onPointerdown: (e: PointerEvent) => bandDown(s, e),
              onPointermove: (e: PointerEvent) => bandMove(s, e),
              onPointerleave: bandLeave,
            }))
          }
          if (hoverAnchor.value && !pendingConn.value && !connDraft.value) {
            const s = shapeById(hoverAnchor.value.shapeId)
            if (s) {
              const ap = anchorPointT(s, hoverAnchor.value.anchor, hoverAnchor.value.t)
              out.push(h('circle', { cx: ap.x, cy: ap.y, r: 6, fill: TEAL, stroke: '#fff', 'stroke-width': 1.5, 'pointer-events': 'none', 'data-noexport': '1' }))
            }
          }
          if (pendingConn.value) {
            const s = shapeById(pendingConn.value.shapeId)
            if (s) {
              const ap = anchorPointT(s, pendingConn.value.anchor, pendingConn.value.t)
              out.push(h('circle', { cx: ap.x, cy: ap.y, r: 6, fill: TEAL, stroke: '#fff', 'stroke-width': 1.5, 'pointer-events': 'none', 'data-noexport': '1' }))
              if (mouse.value) {
                out.push(h('line', { x1: ap.x, y1: ap.y, x2: mouse.value.x, y2: mouse.value.y, stroke: TEAL, 'stroke-width': 1.4, 'stroke-dasharray': '6 4', 'pointer-events': 'none', 'data-noexport': '1' }))
              }
            }
          }
          if (connDraft.value) {
            const s = shapeById(connDraft.value.from.shapeId)
            if (s) {
              const ap = anchorPointT(s, connDraft.value.from.anchor, connDraft.value.from.t)
              const to = connDraft.value.to
              const ex = to ? anchorPointT(shapeById(to.shapeId) ?? s, to.anchor, to.t).x : connDraft.value.cx
              const ey = to ? anchorPointT(shapeById(to.shapeId) ?? s, to.anchor, to.t).y : connDraft.value.cy
              out.push(h('line', { x1: ap.x, y1: ap.y, x2: ex, y2: ey, stroke: TEAL, 'stroke-width': 1.4, 'stroke-dasharray': '6 4', 'pointer-events': 'none', 'data-noexport': '1' }))
              out.push(h('circle', { cx: ex, cy: ey, r: 3.5, fill: TEAL, 'pointer-events': 'none', 'data-noexport': '1' }))
              if (to) {
                const tz = shapeById(to.shapeId)
                if (tz) {
                  const zb = anchorZoneBox(tz)
                  out.push(h('rect', { x: zb.x - 6, y: zb.y - 6, width: zb.w + 12, height: zb.h + 12, rx: 4, fill: 'none', stroke: TEAL, 'stroke-width': 1.2, 'stroke-dasharray': '5 3', 'pointer-events': 'none', 'data-noexport': '1' }))
                }
              }
            }
          }
        }
        // 选中图元环 + 角柄
        if (mode.value === 'edit' && selShape.value) {
          const s = selShape.value
          out.push(selRing(s))
          if (!bulkIds.value.has(s.id) || bulkIds.value.size <= 1) {
            for (const hd of ['nw', 'ne', 'sw', 'se'] as const) {
              const cx = hd === 'ne' || hd === 'se' ? s.x + s.w : s.x
              const cy = hd === 'sw' || hd === 'se' ? s.y + s.h : s.y
              out.push(h('rect', {
                x: cx - 4, y: cy - 4, width: 8, height: 8, fill: '#fff', stroke: TEAL, 'stroke-width': 1.3,
                style: `cursor:${hd === 'nw' || hd === 'se' ? 'nwse' : 'nesw'}-resize;`, 'data-noexport': '1',
                onPointerdown: (e: PointerEvent) => resizeDown(s, hd, e),
              }))
            }
          }
        }
        if (mode.value === 'edit') {
          for (const id of bulkIds.value) {
            const s = shapeById(id)
            if (s && (!selShape.value || selShape.value.id !== id || bulkIds.value.size > 1)) out.push(selRing(s))
          }
        }
        // 选中连线：端点手柄 / 中段提示 / 删除
        if (mode.value === 'edit' && selConn.value) {
          const c = selConn.value
          const pts = connPts(c)
          if (pts.length >= 2) {
            const ep = (which: 'from' | 'to'): [number, number] => {
              const s = shapeById(which === 'from' ? c.fromShape : c.toShape)
              const an = which === 'from' ? c.fromAnchor : c.toAnchor
              const tt = which === 'from' ? c.fromT : c.toT
              return s ? [anchorPointT(s, an, tt).x, anchorPointT(s, an, tt).y] : pts[0]
            }
            for (const which of ['from', 'to'] as const) {
              const [x, y] = ep(which)
              out.push(h('g', { 'data-noexport': '1' }, [
                h('circle', { cx: x, cy: y, r: 6, fill: '#fff', stroke: ROSE, 'stroke-width': 1.8, style: 'cursor:grab;', onPointerdown: (e: PointerEvent) => endHandleDown(c, which, e) }, [h('title', null, '拖动改接到其他图元锚点')]),
                h('circle', { cx: x, cy: y, r: 2.2, fill: ROSE, 'pointer-events': 'none' }),
              ]))
            }
            const a = shapeById(c.fromShape); const b = shapeById(c.toShape)
            if (a && b) {
              const pa = physAnchor(a, c.fromAnchor); const pb = physAnchor(b, c.toAnchor)
              const aH = pa === 'left' || pa === 'right'; const bH = pb === 'left' || pb === 'right'
              if ((aH && bH) || (!aH && !bH)) {
                const [p1, p2] = [pts[1], pts[2]]
                out.push(h('line', {
                  x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: 'transparent', 'stroke-width': 12,
                  style: 'cursor:move;', 'data-noexport': '1', onPointerdown: (e: PointerEvent) => segDown(c, e),
                }, [h('title', null, '拖动调整中段布线')]),
                  h('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: TEAL, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'pointer-events': 'none', 'data-noexport': '1' }))
              }
            }
            const mid = pointAlongPolyline(pts, 0.5)
            if (mid) {
              out.push(h('g', { 'data-noexport': '1', style: 'cursor:pointer;', onPointerdown: (e: PointerEvent) => { e.stopPropagation(); selected.value = { kind: 'conn', id: c.id }; deleteSelection() } }, [
                h('circle', { cx: mid.x, cy: mid.y, r: 9, fill: '#fff', stroke: ROSE, 'stroke-width': 1.4 }, [h('title', null, '删除连线')]),
                h('path', { d: `M${mid.x - 3.5},${mid.y - 3.5} L${mid.x + 3.5},${mid.y + 3.5} M${mid.x + 3.5},${mid.y - 3.5} L${mid.x - 3.5},${mid.y + 3.5}`, stroke: ROSE, 'stroke-width': 1.6, 'stroke-linecap': 'round', fill: 'none' }),
              ]))
            }
          }
          if (connEndDrag.value) {
            const t = connEndDrag.value
            const ts = shapeById(t.shapeId)
            if (ts) {
              const zb = anchorZoneBox(ts)
              out.push(h('rect', { x: zb.x - 6, y: zb.y - 6, width: zb.w + 12, height: zb.h + 12, rx: 4, fill: 'none', stroke: ROSE, 'stroke-width': 1.4, 'data-noexport': '1' }))
              const ap = anchorPointT(ts, t.anchor, t.t)
              out.push(h('circle', { cx: ap.x, cy: ap.y, r: 7.5, fill: ROSE, stroke: '#fff', 'stroke-width': 1.5, 'data-noexport': '1' }))
            }
          }
        }
        // 搜索定位闪烁环
        if (locateHit.value) {
          const lh = locateHit.value
          if (lh.kind === 'shape') {
            const s = shapeById(lh.id)
            if (s) out.push(h('rect', { x: s.x - 7, y: s.y - 7, width: s.w + 14, height: s.h + 14, rx: 6, fill: 'rgba(245,158,11,0.10)', stroke: '#f59e0b', 'stroke-width': 2.5, 'stroke-dasharray': '7 4', class: 'pr-pulse', 'data-noexport': '1' }))
          } else {
            const m = markById(lh.id)
            if (m) out.push(h('circle', { cx: m.x, cy: m.y, r: 15, fill: 'rgba(245,158,11,0.12)', stroke: '#f59e0b', 'stroke-width': 2.5, 'stroke-dasharray': '7 4', class: 'pr-pulse', 'data-noexport': '1' }))
          }
        }
        // 放置幽灵 / 直线橡皮筋 / 框选橡皮筋
        if (mode.value === 'edit' && mouse.value && placing.value) {
          const pl = placing.value
          if (pl.kind === 'std') {
            const meta = stdMeta.get(pl.stdId)
            if (meta) {
              const gx = mouse.value.x - meta.defaultW / 2; const gy = mouse.value.y - meta.defaultH / 2
              const data = STD_SHAPE_DATA[pl.stdId]
              out.push(h('g', {
                transform: `translate(${gx} ${gy}) scale(${meta.defaultW / (data?.sw ?? meta.defaultW)} ${meta.defaultH / (data?.sh ?? meta.defaultH)})`,
                opacity: 0.85, 'pointer-events': 'none', 'data-noexport': '1',
              }, (data?.shapes ?? []).map((ir) => irVnode(ir, { stroke: TEAL, fill: 'rgba(13,148,136,0.08)' }))))
            }
          } else if (pl.kind === 'basic') {
            const meta = basicReg.symbols.find((m) => m.id === pl.type)
            if (meta) {
              out.push(h('rect', {
                x: mouse.value.x - meta.defaultW / 2, y: mouse.value.y - meta.defaultH / 2,
                width: meta.defaultW, height: meta.defaultH, rx: 3,
                fill: 'rgba(13,148,136,0.08)', stroke: TEAL, 'stroke-width': 1.4, 'stroke-dasharray': '5 3',
                'pointer-events': 'none', 'data-noexport': '1',
              }))
            }
          } else if (pl.kind === 'mark') {
            const mx = mouse.value.x; const my = mouse.value.y
            out.push(h('polygon', {
              points: `${mx},${my - 7} ${mx + 7},${my} ${mx},${my + 7} ${mx - 7},${my}`,
              fill: 'rgba(244,63,94,0.25)', stroke: ROSE, 'stroke-width': 1.4, 'pointer-events': 'none', 'data-noexport': '1',
            }))
          }
        }
        if (lineDraft.value) {
          const d = lineDraft.value
          out.push(h('line', { x1: d.sx, y1: d.sy, x2: d.ex, y2: d.ey, stroke: TEAL, 'stroke-width': 1.6, 'pointer-events': 'none', 'data-noexport': '1' }))
        }
        if (rubber.value) {
          const r = rubber.value
          out.push(h('rect', {
            x: r.x0, y: r.y0, width: Math.max(r.x1 - r.x0, 0.01), height: Math.max(r.y1 - r.y0, 0.01), rx: 2,
            fill: 'rgba(13,148,136,0.08)', stroke: TEAL, 'stroke-width': 1.5, 'stroke-dasharray': '6 3',
            'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none', 'data-noexport': '1',
          }))
        }
        return out
      }

      const renderCanvas = () => {
        const v = vb.value
        return h('svg', {
          ref: svgEl,
          'data-ver': 'v3-native-pointer',
          viewBox: `${v.x} ${v.y} ${v.w} ${v.h}`,
          class: 'block h-full w-full select-none',
          style: `cursor:${placing.value ? 'crosshair' : 'default'};`,
          preserveAspectRatio: 'xMidYMid meet',
          // pointer 事件由 onVnodeMounted 原生绑定（svg 根的 Vue patch 事件在部分刷新时序下不可靠；wheel 无此问题保留 Vue 绑定）
          onWheel: onWheel,
        }, [
          h('defs', { 'data-noexport': '1' }, [
            h('pattern', { id: 'pr-grid-s', width: 20, height: 20, patternUnits: 'userSpaceOnUse' }, [
              h('path', { d: 'M 20 0 L 0 0 0 20', fill: 'none', stroke: GRID_S, 'stroke-width': 1 }),
            ]),
            h('pattern', { id: 'pr-grid-l', width: 100, height: 100, patternUnits: 'userSpaceOnUse' }, [
              h('rect', { width: 100, height: 100, fill: 'url(#pr-grid-s)' }),
              h('path', { d: 'M 100 0 L 0 0 0 100', fill: 'none', stroke: GRID_L, 'stroke-width': 1.2 }),
            ]),
            h('marker', { id: 'pr-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5.5, markerHeight: 5.5, orient: 'auto-start-reverse' }, [
              h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: LINE }),
            ]),
            h('marker', { id: 'pr-arrow-rev', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5.5, markerHeight: 5.5, orient: 'auto-start-reverse' }, [
              h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: ROSE }),
            ]),
          ]),
          h('rect', { x: v.x - v.w, y: v.y - v.h, width: v.w * 3, height: v.h * 3, fill: '#ffffff' }),
          ifV(toggles.bg, () => h('image', { href: BG_HREF, x: 0, y: 0, width: CANVAS_W, height: CANVAS_H, opacity: bgOpacity.value, preserveAspectRatio: 'xMidYMid meet', 'pointer-events': 'none' })),
          h('rect', { x: v.x - v.w, y: v.y - v.h, width: v.w * 3, height: v.h * 3, fill: 'url(#pr-grid-l)', 'data-noexport': '1', 'pointer-events': 'none' }),
          h('rect', { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H, fill: 'none', stroke: GRID_L, 'stroke-width': 1.2, 'stroke-dasharray': '12 8', 'vector-effect': 'non-scaling-stroke', 'data-noexport': '1' }),
          h('g', {}, renderConnections()),
          h('g', {}, renderBadges()),
          h('g', {}, renderShapes()),
          h('g', {}, renderMarks()),
          h('g', {}, renderOverlay()),
        ])
      }

      // ── 浮层：视口控制 / 图例 / 俯瞰图 / 多选工具条 / 档案卡 ──
      const tbtn = (label: string, title: string, active: boolean, onClick: () => void, extraCls = '') => h('button', {
        title, class: [
          'flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors',
          active ? 'border-teal-300 bg-teal-50 text-teal-700' : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-700',
          extraCls,
        ], onClick,
      }, label)

      const renderViewControls = () => h('div', { class: 'absolute bottom-2.5 left-2.5 z-10 flex items-center gap-1 rounded-lg border border-stone-200 bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur' }, [
        h('button', { title: '缩小', class: 'flex h-7 w-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100', onClick: () => zoomBy(1 / 1.25) }, [icon('minus')]),
        h('span', { class: 'w-11 select-none text-center font-mono text-[11px] text-stone-600' }, `${percent.value}%`),
        h('button', { title: '放大', class: 'flex h-7 w-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100', onClick: () => zoomBy(1.25) }, [icon('plus')]),
        h('div', { class: 'mx-1 h-4 w-px bg-stone-200' }),
        h('button', { title: '复位视图 1:1', class: 'flex h-7 w-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100', onClick: resetView }, [icon('reset')]),
        h('div', { class: 'mx-1 h-4 w-px bg-stone-200' }),
        tbtn('名', '设备名（图元标签）显隐', toggles.device, () => setToggle('device')),
        tbtn('线', '管线号徽章显隐', toggles.pipe, () => setToggle('pipe')),
        tbtn('标', '标注文字显隐（查看态）', toggles.mark, () => setToggle('mark')),
        tbtn('链', '设备绑定角标显隐', toggles.badge, () => setToggle('badge')),
        tbtn('网', '网格显隐', toggles.grid, () => setToggle('grid')),
        tbtn('底', '底图显隐', toggles.bg, () => { setToggle('bg'); bgPop.value = false }),
      ])

      const renderLegend = () => {
        if (mode.value !== 'view' || !toggles.legend) return null
        return h('div', {
          class: 'absolute bottom-2.5 z-10 flex max-w-full items-center gap-1.5 overflow-x-auto rounded-lg border border-stone-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur',
          style: toggles.minimap ? 'right:calc(clamp(8.5rem, 30%, 12.5rem) + 0.75rem);' : 'right:0.625rem;',
        }, ISO_STATE_KEYS.map((k) => {
          const st = ISO_STATE_STYLE[k]
          return h('span', { key: k, class: 'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]', style: `background:${st.fill};color:${st.line};` }, [
            h('i', { class: 'h-2 w-2 rounded-full inline-block', style: `background:${st.dot};` }),
            st.legend,
          ])
        }))
      }

      const renderMinimap = () => {
        if (!toggles.minimap) return null
        const m = minimapBoundsOf(vb.value)
        return h('div', { class: 'absolute bottom-2.5 right-2.5 z-10 overflow-hidden rounded-lg border border-stone-200 bg-white/95 shadow-sm backdrop-blur', style: 'width:clamp(8.5rem, 30%, 12.5rem);' }, [
          h('div', { class: 'flex items-center justify-between border-b border-stone-100 px-1.5 py-0.5' }, [
            h('span', { class: 'text-[9px] font-medium text-stone-400' }, '俯瞰图 · 点击/拖拽导航'),
            h('button', { class: 'text-[10px] leading-none text-stone-400 hover:text-stone-600', title: '关闭俯瞰图', onClick: () => setToggle('minimap') }, '×'),
          ]),
          h('svg', {
            ref: miniEl, viewBox: `${m.x} ${m.y} ${m.w} ${m.h}`, class: 'block w-full', style: 'height:auto;cursor:crosshair;', onPointerdown: miniDown,
          }, [
            ...doc.connections.map((c) => {
              const pts = connPts(c)
              if (pts.length < 2) return null
              return h('line', { key: c.id, x1: pts[0][0], y1: pts[0][1], x2: pts[pts.length - 1][0], y2: pts[pts.length - 1][1], stroke: LINE, 'stroke-width': 1 })
            }),
            ...doc.shapes.map((s) => h('rect', { key: s.id, x: s.x, y: s.y, width: s.w, height: s.h, fill: s.fill ?? '#fff', stroke: STROKE, 'stroke-width': 1 })),
            ...doc.marks.map((mk) => h('polygon', { key: mk.id, points: `${mk.x},${mk.y - 5} ${mk.x + 5},${mk.y} ${mk.x},${mk.y + 5} ${mk.x - 5},${mk.y}`, fill: ROSE })),
            h('rect', { x: vb.value.x, y: vb.value.y, width: vb.value.w, height: vb.value.h, fill: 'rgba(245,158,11,0.15)', stroke: '#f59e0b', 'stroke-width': 1.5, 'pointer-events': 'none' }),
          ]),
        ])
      }

      const bulkBox = computed(() => {
        const ms = bulkList.value
        if (ms.length === 0) return null
        const x0 = Math.min(...ms.map((s) => s.x)); const y0 = Math.min(...ms.map((s) => s.y))
        const x1 = Math.max(...ms.map((s) => s.x + s.w)); const y1 = Math.max(...ms.map((s) => s.y + s.h))
        return { x: x0, y: y0, x1, y1, w: x1 - x0, h: y1 - y0, n: ms.length }
      })
      const renderBulkToolbar = () => {
        if (mode.value !== 'edit') return null
        const bb = bulkBox.value
        if (!bb || bb.n < 2 || !wrapEl.value) return null
        const k = canvasW.value / vb.value.w
        const left = clamp((bb.x + bb.w / 2 - vb.value.x) * k, 130, Math.max(140, canvasW.value - 130))
        const top = clamp((bb.y - vb.value.y) * k, 44, 4000)
        const alignBtn = (m: Parameters<typeof applyAlign>[0], label: string) => h('button', {
          class: 'flex h-7 items-center justify-center rounded border border-stone-200 bg-white px-1.5 text-[10px] text-stone-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700',
          onClick: () => applyAlign(m),
        }, label)
        return h('div', {
          class: 'absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-lg border border-teal-200 bg-white/95 px-1.5 py-1 shadow-md backdrop-blur',
          style: `left:${left}px;top:${top - 8}px;`,
        }, [
          h('span', { class: 'rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700' }, `已选 ${bb.n}`),
          alignBtn('left', '左'), alignBtn('hcenter', '中'), alignBtn('right', '右'),
          alignBtn('top', '顶'), alignBtn('vcenter', '中'), alignBtn('bottom', '底'),
          h('button', { class: 'flex h-7 items-center rounded border border-stone-200 bg-white px-1.5 text-[10px] text-stone-600 hover:border-teal-300 hover:text-teal-700', title: '水平均匀分布（≥3）', onClick: () => applyDistribute('h') }, '⇔'),
          h('button', { class: 'flex h-7 items-center rounded border border-stone-200 bg-white px-1.5 text-[10px] text-stone-600 hover:border-teal-300 hover:text-teal-700', title: '垂直均匀分布（≥3）', onClick: () => applyDistribute('v') }, '⇕'),
          h('button', { class: 'flex h-7 items-center rounded border border-rose-200 bg-white px-1.5 text-[10px] text-rose-600 hover:bg-rose-50', onClick: deleteSelection }, '删除'),
          h('button', { class: 'flex h-7 items-center rounded px-1 text-[10px] text-stone-400 hover:text-stone-600', title: '退出多选', onClick: () => { bulkIds.value = new Set() } }, '×'),
        ])
      }

      const renderMarkCard = () => {
        const mc = markCard.value
        if (!mc || mode.value !== 'view') return null
        const m = markById(mc.id)
        if (!m) return null
        const st = ISO_STATE_STYLE[m.state] ?? ISO_STATE_STYLE.idle
        const refv = mockRefs(m)
        return h('div', {
          class: 'fixed z-40 w-64 rounded-lg border border-stone-200 bg-white p-3 shadow-lg',
          style: `left:${clamp(mc.x - 132, 8, window.innerWidth - 270)}px;top:${clamp(mc.y + 14, 8, window.innerHeight - 190)}px;`,
          onPointerdown: (e: PointerEvent) => e.stopPropagation(),
        }, [
          h('div', { class: 'flex items-center gap-2' }, [
            h('i', { class: 'h-3 w-3 rotate-45 inline-block border', style: `background:${st.fill};border-color:${st.stroke};` }),
            h('span', { class: 'font-mono text-sm font-semibold text-stone-800' }, m.code),
            h('span', { class: 'rounded-full px-1.5 py-0.5 text-[10px]', style: `background:${st.fill};color:${st.line};` }, st.legend),
          ]),
          h('div', { class: 'mt-1 text-xs text-stone-500' }, m.name || '隔离点'),
          h('div', { class: 'mt-2 space-y-0.5 border-t border-stone-100 pt-2 text-[10px] leading-relaxed text-stone-400' }, [
            h('div', null, `作业需求：${refv.req}`),
            h('div', null, `作业票：${refv.ticket}`),
            h('div', null, 'Vue 复刻演示：档案链以 mock 呈现（pid-config 为 API 全链）'),
          ]),
        ])
      }

      // ── 左侧图元库 ──
      const pickCell = (kind: 'std' | 'basic', id: string) => {
        if (kind === 'std') {
          if (placing.value?.kind === 'std' && placing.value.stdId === id) { placing.value = null; flash('已退出放置模式'); return }
          placing.value = { kind: 'std', stdId: id }
        } else {
          if (id === 'line') {
            if (placing.value?.kind === 'line') { placing.value = null; flash('已退出直线工具'); return }
            placing.value = { kind: 'line' }
          } else {
            if (placing.value?.kind === 'basic' && placing.value.type === id) { placing.value = null; flash('已退出放置模式'); return }
            placing.value = { kind: 'basic', type: id }
          }
        }
        pendingConn.value = null
        flash(kind === 'std' ? `放置模式：${stdMeta.get(id)?.label ?? id}（点击画布放置）` : `放置模式：${pidTypeLabel(id)}${id === 'line' ? '（按住拖拽绘制）' : '（点击画布放置）'}`)
      }
      const renderLibrary = () => {
        if (mode.value !== 'edit') return null
        const reg = libTab.value === 'std' ? stdReg : basicReg
        const kw = libKw.value
        const found = kw.trim() ? searchSymbols(reg, kw) : null
        const tree = groupTreeOf(reg)
        const cells = (syms: SymbolMeta[]) => h('div', { class: 'grid grid-cols-3 gap-1.5' }, syms.map((m) => {
          const active = (placing.value?.kind === 'std' && placing.value.stdId === m.id)
            || (placing.value?.kind === 'basic' && placing.value.type === m.id)
          return h('button', {
            key: m.id, title: `${m.label}${m.desc ? ` · ${m.desc}` : ''}${m.standard ? `（${m.standard}）` : ''}`,
            class: [
              'flex flex-col items-center gap-0.5 rounded-md border p-1 transition-colors',
              active ? 'border-teal-400 bg-teal-50' : 'border-stone-200 bg-white hover:border-teal-300 hover:bg-stone-50',
            ],
            onClick: () => pickCell(m.group === 'std' ? 'std' : 'basic', m.id),
          }, [
            m.group === 'std'
              ? withDirectives(h('div', { class: 'h-10 w-full' }), [[vThumb, m]])
              : basicThumbVnode(m),
            h('span', { class: 'w-full truncate text-center text-[9px] leading-tight text-stone-500' }, m.label),
          ])
        }))
        const body: VNode[] = []
        if (found) {
          body.push(found.length ? cells(found) : h('div', { class: 'py-6 text-center text-xs text-stone-400' }, '未找到匹配符号'))
        } else {
          for (const g of tree) {
            const open = openGroups.value.has(g.group.id)
            const hasKids = g.subgroups.length > 0 || g.looseSymbols.length > 0
            if (!hasKids) continue
            body.push(h('div', { key: g.group.id, class: 'rounded-md border border-stone-200' }, [
              h('button', {
                class: 'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50',
                onClick: () => {
                  const next = new Set(openGroups.value)
                  if (next.has(g.group.id)) next.delete(g.group.id); else next.add(g.group.id)
                  openGroups.value = next
                },
              }, [
                h('span', null, `${g.group.label} · ${g.subgroups.reduce((a, s) => a + s.symbols.length, 0) + g.looseSymbols.length}`),
                h('span', { class: 'text-stone-400' }, open ? '▾' : '▸'),
              ]),
              ...(open ? [
                ...g.subgroups.map((sub) => h('div', { key: sub.id, class: 'border-t border-stone-100 px-1.5 py-1.5' }, [
                  h('div', { class: 'mb-1 text-[10px] text-stone-400' }, `${sub.label} · ${sub.symbols.length}`),
                  cells(sub.symbols),
                ])),
                ...(g.looseSymbols.length ? [h('div', { class: 'border-t border-stone-100 px-1.5 py-1.5' }, cells(g.looseSymbols))] : []),
              ] : []),
            ]))
          }
        }
        return h('div', { class: 'flex w-60 shrink-0 flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-50/60' }, [
          h('div', { class: 'flex gap-1 border-b border-stone-200 bg-white p-1.5' }, [
            h('button', {
              class: ['flex-1 rounded px-2 py-1 text-xs', libTab.value === 'std' ? 'bg-teal-50 font-medium text-teal-800' : 'text-stone-500 hover:bg-stone-100'],
              onClick: () => { libTab.value = 'std'; openGroups.value = new Set([stdReg.groups[0]?.id ?? '']) },
            }, `内建图元 ${stdReg.symbols.length}`),
            h('button', {
              class: ['flex-1 rounded px-2 py-1 text-xs', libTab.value === 'basic' ? 'bg-teal-50 font-medium text-teal-800' : 'text-stone-500 hover:bg-stone-100'],
              onClick: () => { libTab.value = 'basic' },
            }, '基础图形'),
          ]),
          h('div', { class: 'p-1.5' }, [
            h('input', {
              type: 'text', value: libKw.value, placeholder: `搜索${libTab.value === 'std' ? '符号/描述/标准' : '基础图形'}…`,
              class: 'w-full rounded-md border border-stone-200 px-2 py-1 text-xs outline-none focus:border-teal-400',
              onInput: (e: Event) => { libKw.value = (e.target as HTMLInputElement).value },
            }),
          ]),
          h('div', { class: 'flex-1 space-y-1.5 overflow-y-auto p-1.5' }, body),
          h('div', { class: 'border-t border-stone-200 bg-white px-2 py-1.5 text-[10px] leading-relaxed text-stone-400' },
            placing.value
              ? (placing.value.kind === 'line' ? '直线工具：在画布按住拖拽绘制，Esc 退出' : '点击画布放置（可连续放置），再次点击图元库项或 Esc 退出')
              : `${stdReg.symbols.length} 个 HG/T 20519 标准符号 · 5 大类，支持搜索`),
        ])
      }

      // ── 右侧属性面板 ──
      const numField = (label: string, value: number, onSet: (v: number) => void, min = -120000, max = 120000) => h('label', { class: 'flex items-center gap-1' }, [
        h('span', { class: 'w-4 text-[10px] text-stone-400' }, label),
        h('input', {
          type: 'number', value: Math.round(value), min, max,
          class: 'w-full rounded border border-stone-200 px-1 py-0.5 text-xs tabular-nums outline-none focus:border-teal-400',
          onInput: (e: Event) => {
            const n = Number((e.target as HTMLInputElement).value)
            if (Number.isFinite(n)) onSet(clamp(Math.round(n), min, max))
          },
        }),
      ])
      const swatches = (label: string, palette: readonly string[], value: string | undefined, onSet: (v: string | undefined) => void) => h('div', { class: 'flex items-center gap-1' }, [
        h('span', { class: 'w-10 shrink-0 text-[10px] text-stone-400' }, label),
        ...palette.map((c) => h('button', {
          key: c, title: c,
          class: ['h-5 w-5 rounded border transition-transform', (value ?? palette[0]) === c ? 'scale-110 border-teal-500 ring-1 ring-teal-300' : 'border-stone-300 hover:scale-105'],
          style: c === 'transparent' ? 'background:repeating-conic-gradient(#e7e5e4 0% 25%, #fff 0% 50%) 50%/8px 8px;' : `background:${c};`,
          onClick: () => onSet(c),
        })),
      ])
      const sectionCard = (title: string, kids: VNode[], tone: 'stone' | 'teal' | 'rose' = 'stone') => h('div', {
        class: [
          'rounded-lg border p-2',
          tone === 'teal' ? 'border-teal-200 bg-teal-50/50' : tone === 'rose' ? 'border-rose-200 bg-rose-50/50' : 'border-stone-200 bg-white',
        ],
      }, [h('div', { class: 'mb-1.5 text-[11px] font-medium text-stone-600' }, title), ...kids])
      const renderProps = () => {
        if (mode.value !== 'edit') return null
        const kids: VNode[] = []
        const multi = bulkIds.value.size > 1
        if (multi) {
          kids.push(sectionCard(`多选 · ${bulkIds.value.size} 个图元`, [
            h('div', { class: 'grid grid-cols-3 gap-1' }, [
              h('button', { class: 'rounded border border-stone-200 px-1 py-0.5 text-[10px] hover:border-teal-300 hover:text-teal-700', onClick: () => applyAlign('left') }, '左对齐'),
              h('button', { class: 'rounded border border-stone-200 px-1 py-0.5 text-[10px] hover:border-teal-300 hover:text-teal-700', onClick: () => applyAlign('hcenter') }, '水平居中'),
              h('button', { class: 'rounded border border-stone-200 px-1 py-0.5 text-[10px] hover:border-teal-300 hover:text-teal-700', onClick: () => applyAlign('right') }, '右对齐'),
              h('button', { class: 'rounded border border-stone-200 px-1 py-0.5 text-[10px] hover:border-teal-300 hover:text-teal-700', onClick: () => applyAlign('top') }, '顶对齐'),
              h('button', { class: 'rounded border border-stone-200 px-1 py-0.5 text-[10px] hover:border-teal-300 hover:text-teal-700', onClick: () => applyAlign('vcenter') }, '垂直居中'),
              h('button', { class: 'rounded border border-stone-200 px-1 py-0.5 text-[10px] hover:border-teal-300 hover:text-teal-700', onClick: () => applyAlign('bottom') }, '底对齐'),
            ]),
            h('div', { class: 'mt-1.5 grid grid-cols-2 gap-1' }, [
              h('button', { class: 'rounded border border-stone-200 px-1 py-0.5 text-[10px] hover:border-teal-300 hover:text-teal-700', onClick: () => applyDistribute('h') }, '⇔ 水平均分'),
              h('button', { class: 'rounded border border-stone-200 px-1 py-0.5 text-[10px] hover:border-teal-300 hover:text-teal-700', onClick: () => applyDistribute('v') }, '⇕ 垂直均分'),
            ]),
            h('button', { class: 'mt-1.5 w-full rounded border border-rose-200 bg-white py-1 text-[10px] text-rose-600 hover:bg-rose-50', onClick: deleteSelection }, '批量删除'),
          ]))
        } else if (selShape.value) {
          const s = selShape.value
          const eq = equipOf(s.equip)
          kids.push(sectionCard('图元属性', [
            h('div', { class: 'mb-1.5 flex items-center gap-1.5' }, [
              h('input', {
                value: s.label, class: 'w-full rounded border border-stone-200 px-1.5 py-1 text-xs outline-none focus:border-teal-400',
                onInput: (e: Event) => { commit('重命名图元'); s.label = (e.target as HTMLInputElement).value },
              }),
              h('span', { class: 'shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500' }, pidTypeLabel(s.type)),
            ]),
            h('div', { class: 'grid grid-cols-2 gap-1' }, [
              numField('X', s.x, (v) => { commit('移动图元'); s.x = v }),
              numField('Y', s.y, (v) => { commit('移动图元'); s.y = v }),
              numField('W', s.w, (v) => { commit('调整尺寸'); s.w = Math.max(s.type === 'std' ? symbolMinSize(stdMeta.get(s.stdId ?? '')).minW : pidTypeLibOf(s.type).minW, v) }),
              numField('H', s.h, (v) => { commit('调整尺寸'); s.h = Math.max(s.type === 'std' ? symbolMinSize(stdMeta.get(s.stdId ?? '')).minH : pidTypeLibOf(s.type).minH, v) }),
            ]),
            h('div', { class: 'mt-1.5 space-y-1' }, [
              swatches('填充', FILL_PALETTE, s.fill, (v) => { commit('改填充色'); s.fill = v }),
              swatches('描边', STROKE_PALETTE, s.stroke, (v) => { commit('改描边色'); s.stroke = v }),
            ]),
            ...(s.type === 'line' ? [h('button', { class: 'mt-1.5 w-full rounded border border-stone-200 py-1 text-[10px] text-stone-600 hover:border-teal-300 hover:text-teal-700', onClick: () => { commit('交换对角方向'); s.flip = !s.flip } }, '⤢ 交换对角方向（flip）')] : []),
            ...(s.type === 'std' && s.stdId ? [h('div', { class: 'mt-1 text-[10px] text-stone-400' }, `标准符号：${s.stdId}（${stdMeta.get(s.stdId)?.standard ?? 'HG/T 20519'}）`)] : []),
          ]))
          kids.push(sectionCard('绑定设备（mock 主数据）', [
            h('select', {
              value: s.equip ?? '', class: 'w-full rounded border border-stone-200 px-1.5 py-1 text-xs outline-none focus:border-teal-400',
              onChange: (e: Event) => { commit('绑定设备'); const v = (e.target as HTMLSelectElement).value; s.equip = v || null },
            }, [
              h('option', { value: '' }, '未绑定'),
              ...EQUIPS.map((eq) => h('option', { value: eq.id }, `${eq.code} · ${eq.name}`)),
            ]),
            ...(eq ? [h('div', { class: 'mt-1 rounded border border-emerald-200 bg-emerald-50/60 px-1.5 py-1 text-[10px] text-emerald-700' }, `画布角标将显示 ${eq.code}（可在图层开关「链」中隐藏）`)] : []),
          ]))
          kids.push(h('button', { class: 'w-full rounded border border-rose-200 bg-white py-1.5 text-xs text-rose-600 hover:bg-rose-50', onClick: deleteSelection }, '删除图元（Delete）'))
        } else if (selConn.value) {
          const c = selConn.value
          const from = shapeById(c.fromShape); const to = shapeById(c.toShape)
          kids.push(sectionCard('连线属性', [
            h('div', { class: 'space-y-0.5 text-[11px] text-stone-600' }, [
              h('div', null, `起点：${from?.label ?? '?'} · ${ANCHOR_LABEL[c.fromAnchor]}${c.fromT !== undefined ? `（沿边 ${Math.round(c.fromT * 100)}%）` : ''}`),
              h('div', null, `终点：${to?.label ?? '?'} · ${ANCHOR_LABEL[c.toAnchor]}${c.toT !== undefined ? `（沿边 ${Math.round(c.toT * 100)}%）` : ''}`),
            ]),
            h('div', { class: 'mt-1.5 text-[10px] text-stone-400' }, '介质流向'),
            h('div', { class: 'grid grid-cols-3 gap-1' }, (['forward', 'reverse', 'none'] as const).map((d) => h('button', {
              class: ['rounded border px-1 py-0.5 text-[10px]', (c.direction ?? 'forward') === d ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-stone-200 text-stone-500 hover:border-emerald-300'],
              onClick: () => { commit('切换流向'); c.direction = d },
            }, d === 'forward' ? '起点→终点' : d === 'reverse' ? '终点→起点' : '无向'))),
          ]))
          kids.push(sectionCard('管线绑定（mock）', [
            h('select', {
              value: c.pipe ?? '', class: 'w-full rounded border border-stone-200 px-1.5 py-1 text-xs outline-none focus:border-teal-400',
              onChange: (e: Event) => { commit('绑定管线'); const v = (e.target as HTMLSelectElement).value; c.pipe = v || null },
            }, [
              h('option', { value: '' }, '不绑定（无徽章）'),
              ...PIPES.map((p) => h('option', { value: p.id }, `${p.code} · ${p.name}`)),
            ]),
            ...(c.pipe ? [
              h('div', { class: 'mt-1 text-[10px] text-stone-500' }, `标注位置：${Math.round((c.labelT ?? 0.5) * 100)}%（拖动徽章可沿线调整）`),
              h('button', { class: 'mt-1 w-full rounded border border-stone-200 py-0.5 text-[10px] text-stone-600 hover:border-teal-300 hover:text-teal-700', onClick: () => { commit('标注居中'); c.labelT = undefined } }, '标注位置重置居中'),
            ] : []),
            ...(c.midOverride !== undefined ? [h('button', { class: 'mt-1 w-full rounded border border-stone-200 py-0.5 text-[10px] text-stone-600 hover:border-teal-300 hover:text-teal-700', onClick: () => { commit('布线复位'); c.midOverride = undefined } }, '中段布线复位为自动')] : []),
          ]))
          kids.push(h('button', { class: 'w-full rounded border border-rose-200 bg-white py-1.5 text-xs text-rose-600 hover:bg-rose-50', onClick: deleteSelection }, '删除连线'))
        } else if (selMark.value) {
          const m = selMark.value
          kids.push(sectionCard('隔离点标注', [
            h('input', {
              value: m.code, class: 'mb-1 w-full rounded border border-stone-200 px-1.5 py-1 font-mono text-xs outline-none focus:border-teal-400',
              onInput: (e: Event) => { commit('改标注编码'); m.code = (e.target as HTMLInputElement).value },
            }),
            h('input', {
              value: m.name, placeholder: '标注名称…', class: 'w-full rounded border border-stone-200 px-1.5 py-1 text-xs outline-none focus:border-teal-400',
              onInput: (e: Event) => { commit('改标注名称'); m.name = (e.target as HTMLInputElement).value },
            }),
            h('div', { class: 'mt-1.5 text-[10px] text-stone-400' }, '模拟状态（查看态联动图例与徽章）'),
            h('select', {
              value: m.state, class: 'w-full rounded border border-stone-200 px-1.5 py-1 text-xs outline-none focus:border-teal-400',
              onChange: (e: Event) => { commit('模拟状态变更'); m.state = (e.target as HTMLSelectElement).value as IsoState },
            }, ISO_STATE_KEYS.map((k) => h('option', { value: k }, ISO_STATE_STYLE[k].legend))),
            h('div', { class: 'mt-1.5 grid grid-cols-2 gap-1' }, [
              numField('X', m.x, (v) => { commit('移动标注'); m.x = v }),
              numField('Y', m.y, (v) => { commit('移动标注'); m.y = v }),
            ]),
          ], 'teal'))
          kids.push(h('button', { class: 'w-full rounded border border-rose-200 bg-white py-1.5 text-xs text-rose-600 hover:bg-rose-50', onClick: deleteSelection }, '删除标注'))
        } else {
          kids.push(sectionCard('操作指引', [
            h('ul', { class: 'list-inside list-disc space-y-1 text-[11px] leading-relaxed text-stone-500' }, [
              h('li', null, '左侧选择符号 → 点击画布放置（可连续）'),
              h('li', null, '点图元边框一圈 = 连线挂起 → 点目标完成；拖拽边框 = 一步连线'),
              h('li', null, 'Shift + 空白拖拽 = 框选多选；多选可对齐/分布'),
              h('li', null, '选中连线：端点拖改接 / 中段拖布线 / × 删除'),
              h('li', null, '滚轮缩放（指针为锚）；空白拖拽平移；底部按钮切图层'),
            ]),
          ]))
          kids.push(sectionCard('快捷键', [
            h('div', { class: 'space-y-0.5 font-mono text-[10px] text-stone-500' }, [
              h('div', null, 'Esc 逐级取消 · Del 删除'),
              h('div', null, 'Ctrl+Z / Y 撤销重做'),
              h('div', null, 'Ctrl+D 复制 · Ctrl+A 全选'),
              h('div', null, '方向键微移（Shift ×5）'),
            ]),
          ]))
        }
        return h('div', { class: 'flex w-60 shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-stone-200 bg-stone-50/60 p-2' }, kids)
      }

      // ── 顶部工具条 ──
      const tbBtn = (label: string, iconName: string, title: string, onClick: () => void, o: { active?: boolean; disabled?: boolean; cls?: string; dot?: boolean } = {}) => h('button', {
        title, disabled: o.disabled,
        class: [
          'relative flex h-8 items-center gap-1 rounded-md border px-2 text-xs transition-colors',
          o.disabled ? 'cursor-not-allowed border-stone-100 bg-stone-50 text-stone-300' :
            o.active ? 'border-teal-400 bg-teal-50 text-teal-700' :
              o.cls ?? 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-800',
        ],
        onClick: () => { if (!o.disabled) onClick() },
      }, [icon(iconName), h('span', null, label),
        ...(o.dot ? [h('i', { class: 'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400' })] : [])])

      const exportPop = ref(false)
      const renderToolbar = () => h('div', { class: 'flex flex-wrap items-center gap-1.5' }, [
        h('div', { class: 'flex overflow-hidden rounded-md border border-stone-200' }, [
          h('button', {
            class: ['px-2.5 py-1.5 text-xs', mode.value === 'edit' ? 'bg-teal-600 font-medium text-white' : 'bg-white text-stone-500 hover:bg-stone-50'],
            onClick: () => { if (mode.value !== 'edit') { mode.value = 'edit'; placing.value = null; pendingConn.value = null; bulkIds.value = new Set(); selected.value = null; markCard.value = null; flash('编辑模式') } },
          }, '编辑'),
          h('button', {
            class: ['px-2.5 py-1.5 text-xs', mode.value === 'view' ? 'bg-teal-600 font-medium text-white' : 'bg-white text-stone-500 hover:bg-stone-50'],
            onClick: () => { if (mode.value !== 'view') { mode.value = 'view'; placing.value = null; pendingConn.value = null; bulkIds.value = new Set(); selected.value = null; flash('查看模式：隔离点六态 + 图例 + 档案卡') } },
          }, '查看'),
        ]),
        tbBtn('撤销', 'undo', '撤销（Ctrl+Z）', undo, { disabled: histSize.value.undo === 0 }),
        tbBtn('重做', 'redo', '重做（Ctrl+Y）', redo, { disabled: histSize.value.redo === 0 }),
        h('div', { class: 'mx-0.5 h-5 w-px bg-stone-200' }),
        tbBtn('标注隔离点', 'pin', '选择后在画布点击挂标（teal）', () => { placing.value = placing.value?.kind === 'mark' ? null : { kind: 'mark' } }, { active: placing.value?.kind === 'mark', cls: 'border-teal-300 bg-teal-50/60 text-teal-700 hover:bg-teal-50' }),
        tbBtn('自动布局', 'wand', 'Sugiyama 简化布局（core autoLayout）', () => {
          if (!doc.shapes.length) { flash('画布为空，无需布局'); return }
          commit('自动布局')
          const out = autoLayout({ shapes: doc.shapes, connections: doc.connections, marks: doc.marks })
          doc.shapes = out.shapes as RShape[]; doc.connections = out.connections as RConn[]; doc.marks = out.marks as RMark[]
          selected.value = null; bulkIds.value = new Set()
          flash('自动布局完成（撤销可回退）')
        }, { disabled: doc.shapes.length === 0 }),
        h('div', { class: 'flex-1' }),
        tbBtn('重置场景', 'reset', '恢复内建演示场景', resetDemo),
        tbBtn(`保存${dirty.value ? ' ·' : ''}`, 'save', '保存到浏览器本地（localStorage）', saveDoc, { cls: dirty.value ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50', dot: dirty.value }),
        h('div', { class: 'relative' }, [
          tbBtn('搜索定位', 'search', '按位号/设备/隔离点搜索（Enter 定位第一个）', () => { searchOpen.value = !searchOpen.value }, { active: searchOpen.value }),
          ...(searchOpen.value ? [renderSearchPop()] : []),
        ]),
        h('div', { class: 'relative' }, [
          tbBtn('导出', 'download', '导出 SVG 矢量 / PNG 2× 位图', () => { exportPop.value = !exportPop.value }, { active: exportPop.value, disabled: exporting.value }),
          ...(exportPop.value ? [h('div', { class: 'absolute right-0 top-9 z-30 w-44 rounded-lg border border-stone-200 bg-white p-1 shadow-lg' }, [
            h('button', { class: 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-600 hover:bg-teal-50 hover:text-teal-700', onClick: () => { exportPop.value = false; void doExport('svg') } }, [icon('download', 'h-3.5 w-3.5'), 'SVG 矢量 1200×700']),
            h('button', { class: 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-600 hover:bg-teal-50 hover:text-teal-700', onClick: () => { exportPop.value = false; void doExport('png') } }, [icon('download', 'h-3.5 w-3.5'), 'PNG 位图 2×（2400×1400）']),
          ])] : []),
        ]),
        tbBtn('俯瞰图', 'map', '显示/隐藏右下角俯瞰导航', () => setToggle('minimap'), { active: toggles.minimap }),
      ])

      const renderSearchPop = () => h('div', { class: 'absolute right-0 top-9 z-30 w-80 rounded-lg border border-stone-200 bg-white p-2 shadow-lg' }, [
        h('input', {
          autoFocus: true, type: 'text', value: searchQ.value, placeholder: '位号 / 设备编码/名称 / 隔离点编码…',
          class: 'w-full rounded-md border border-stone-200 px-2 py-1.5 text-xs outline-none focus:border-teal-400',
          onInput: (e: Event) => { searchQ.value = (e.target as HTMLInputElement).value },
          onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') runLocate(searchResults.value[0]) },
        }),
        h('div', { class: 'mt-1.5 max-h-56 space-y-0.5 overflow-y-auto' }, [
          ...(searchQ.value.trim() && searchResults.value.length === 0
            ? [h('div', { class: 'py-3 text-center text-xs text-stone-400' }, '无匹配结果')]
            : searchResults.value.map((r) => h('button', {
              key: `${r.kind}-${r.id}`, class: 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-stone-50',
              onClick: () => runLocate(r),
            }, [
              h('span', { class: `shrink-0 rounded px-1 py-0.5 text-[9px] ${r.kind === 'shape' ? 'bg-teal-50 text-teal-700' : 'bg-rose-50 text-rose-600'}` }, r.kind === 'shape' ? '图元' : '隔离点'),
              h('span', { class: 'truncate text-xs text-stone-700' }, r.title),
              h('span', { class: 'ml-auto truncate text-[10px] text-stone-400' }, r.sub),
            ]))),
          ...(searchQ.value.trim() ? [] : [h('div', { class: 'py-2 text-center text-[10px] text-stone-400' }, '输入关键字：图元匹配位号+绑定设备；标注匹配编码+名称')]),
        ]),
      ])

      // ── 状态条 ──
      const renderStatus = () => h('div', { class: 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-[11px] text-stone-500' }, [
        h('span', { class: ['rounded px-1.5 py-0.5 font-medium', mode.value === 'edit' ? 'bg-teal-50 text-teal-700' : 'bg-stone-100 text-stone-600'] }, mode.value === 'edit' ? '编辑模式' : '查看模式'),
        h('span', null, `图元 ${doc.shapes.length} · 连线 ${doc.connections.length} · 标注 ${doc.marks.length}`),
        h('span', null, `缩放 ${percent.value}%`),
        h('span', null, `撤销 ${histSize.value.undo} / 重做 ${histSize.value.redo}`),
        ...(selected.value ? [h('span', { class: 'text-teal-700' }, `选中：${describeSel()}`)] : []),
        ...(bulkIds.value.size > 1 ? [h('span', { class: 'text-teal-700' }, `多选 ${bulkIds.value.size}`)] : []),
        ...(placing.value ? [h('span', { class: 'text-amber-600' }, '放置中…')] : []),
        ...(pendingConn.value ? [h('span', { class: 'text-teal-600' }, '连线挂起：点击目标图元')] : []),
        h('span', { class: 'ml-auto flex items-center gap-1.5 truncate' }, [
          dirty.value ? h('i', { class: 'h-1.5 w-1.5 rounded-full bg-amber-400', title: '有未保存变更' }) : null,
          h('span', { class: 'truncate', title: lastOp.value }, lastOp.value),
        ]),
      ])
      const describeSel = (): string => {
        const sel = selected.value
        if (!sel) return ''
        if (sel.kind === 'shape') { const s = shapeById(sel.id); return s ? `图元 ${s.label}` : '图元' }
        if (sel.kind === 'conn') {
          const c = connById(sel.id)
          const code = c?.pipe ? pipeCodeOf(c.pipe) : ''
          return `连线${code ? `（${code}）` : ''}`
        }
        const m = markById(sel.id)
        return m ? `标注 ${m.code}` : '标注'
      }

      // ══════════ 根渲染 ══════════
      return () => h('div', {
        class: 'flex flex-col gap-2',
        onVnodeMounted: () => {
          const r = wrapEl.value?.getBoundingClientRect()
          if (r && r.width > 0) canvasW.value = r.width
          if (wrapEl.value) ro.observe(wrapEl.value)
          // svg 根 pointer 三件套：原生绑定（与 Vue patch 事件机制解耦，确保手势路由稳定）
          if (svgEl.value) {
            svgEl.value.addEventListener('pointerdown', svgDown)
            svgEl.value.addEventListener('pointermove', svgMove)
            svgEl.value.addEventListener('pointerleave', svgLeave)
          }
          opts.onReady?.({ vue: '3.5' })
        },
        onVnodeBeforeUnmount: () => {
          ro.disconnect()
          window.removeEventListener('keydown', onKey)
          clearTimeout(locateTimer)
          if (svgEl.value) {
            svgEl.value.removeEventListener('pointerdown', svgDown)
            svgEl.value.removeEventListener('pointermove', svgMove)
            svgEl.value.removeEventListener('pointerleave', svgLeave)
          }
        },
      }, [
        renderToolbar(),
        h('div', { class: 'flex min-h-0 items-stretch gap-2', style: 'height:clamp(430px, calc(100vh - 330px), 900px);' }, [
          renderLibrary(),
          h('div', { ref: wrapEl, class: 'relative flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50' }, [
            h('div', { class: 'relative', style: `width:${canvasW.value}px;height:${canvasH.value}px;` }, [
              renderCanvas(),
              renderViewControls(),
              renderLegend(),
              renderMinimap(),
              renderBulkToolbar(),
              renderMarkCard(),
            ]),
          ]),
          renderProps(),
        ]),
        renderStatus(),
      ])
    },
  }

  const app = createApp(Root)
  app.directive('thumb', vThumb)
  app.mount(el)
  return { unmount: () => app.unmount() }
}

// ============ 小工具 ============
function ifV(cond: boolean, render: () => VNode): VNode {
  return cond ? render() : h('g')
}
function basicThumbVnode(m: SymbolMeta): VNode {
  const ir = basicIr(m.id, m.defaultW, m.defaultH)
  const pad = 4
  return h('svg', {
    viewBox: `${-pad} ${-pad} ${m.defaultW + pad * 2} ${m.defaultH + pad * 2}`,
    class: 'h-10 w-full', 'aria-hidden': 'true',
  }, ir.map((s) => irVnode(s, { stroke: '#57534e', fill: '#fff' })))
}
