// PID 管线挂接几何库（Task 73）：阀门/管件/在线仪表/泵 串接管线
// 纯函数、无 DB/DOM 依赖——编辑器（pid-config.tsx 拖拽挂接）与导入端（AI 导入自动挂接）共用
//
// 语义（用户需求 1/3）：
// - 挂接：可挂接图元落到「管线」（已绑定 pipelineId 的连线）上 → 自动旋转对齐管线方向（0/90°）
//         + 管线在挂接点断开为两段，分别与图元两端锚点「粘合」（连线端点归属图元，移动自动跟随）
// - 解除：图元拖离管线 / 删除图元 → 两段重新合并为一条连线（管线自动闭合），图元旋转复位
// - labelT（管线号徽章弧长参数）在断开/合并时按弧长比例折算，midOverride 断开时清空（重拖重排）
import { contentInsetBox } from '@/lib/bp-pid-layout'

export type MountAnchor = 'top' | 'right' | 'bottom' | 'left'

/** 挂接图元最小结构（结构化兼容编辑器 PidShape 与导入 LayoutShape 的超集） */
export interface MountShape {
  id: string
  type: string
  stdId?: string
  x: number
  y: number
  w: number
  h: number
  rotation?: number
}

/** 连线最小结构（结构化兼容编辑器 PidConn） */
export interface MountConn {
  id: string
  fromShape: string
  fromAnchor: MountAnchor
  toShape: string
  toAnchor: MountAnchor
  fromT?: number  // 自由锚点（Task 86-2）：端点沿边参数（缺省 0.5 中点，与旧数据兼容）
  toT?: number
  pipelineId?: number | null
  direction?: string | null
  labelT?: number
  midOverride?: number
}

export interface MountContent {
  shapes: MountShape[]
  connections: MountConn[]
}

/** 折线提供器：编辑器传 routeConnection 实时折线（含 midOverride），导入端用本库 layoutPolylineOf 简化正交路由 */
export type PolylineOf = (c: MountConn) => [number, number][] | null

/** 挂接吸附距离（SVG 单位，与挂标 MARK_PIPE_SNAP_DIST 同级） */
export const MOUNT_SNAP_DIST = 36
/** 挂接点距折线首末端点的最小距离：避免吸附退化到设备端口处重叠 */
export const MOUNT_END_MARGIN = 22

// ============ 可挂接图元判定 ============
// 内建库前缀约定：vl- 阀门（全可挂）· in- 仪表（排除 in-sig-* 信号线）· pp- 管件（排除 pp-line-* 管道类型线与 pp-flow-arrow 流向箭头）
const MOUNT_STD_EXCLUDE_PREFIX: readonly string[] = ['in-sig-', 'pp-line-', 'pp-flow-arrow']

export function isMountableShape(s: { type: string; stdId?: string }): boolean {
  if (s.type === 'pump' || s.type === 'valve') return true
  if (s.type !== 'std' || !s.stdId) return false
  if (!/^(vl|in|pp)-/.test(s.stdId)) return false
  return !MOUNT_STD_EXCLUDE_PREFIX.some((p) => s.stdId!.startsWith(p))
}

// ============ 几何辅助 ============

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function centerOf(s: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 }
}

/** 锚点名 → 顺时针旋转 rot 后的物理朝向名（order 为物理顺时针序：SVG rotate 正角顺时针） */
export function rotateAnchorName(a: MountAnchor, rot: number): MountAnchor {
  const r = ((((Math.round(rot / 90) * 90) % 360) + 360) % 360)
  if (r === 0) return a
  const order: MountAnchor[] = ['top', 'right', 'bottom', 'left']
  return order[(order.indexOf(a) + r / 90) % 4]
}

/** 物理朝向 → 旋转 rot 下能到达该朝向的锚点名（rotateAnchorName 的逆变换） */
export function anchorNameForPhysical(phys: MountAnchor, rot: number): MountAnchor {
  const r = ((((Math.round(rot / 90) * 90) % 360) + 360) % 360)
  if (r === 0) return phys
  const order: MountAnchor[] = ['top', 'right', 'bottom', 'left']
  return order[(order.indexOf(phys) - r / 90 + 4) % 4]
}

export function oppositeAnchor(a: MountAnchor): MountAnchor {
  return a === 'top' ? 'bottom' : a === 'bottom' ? 'top' : a === 'left' ? 'right' : 'left'
}

/** 挂接图元锚点绝对坐标（已含旋转 + 自由锚点沿边参数，Task 86-2）：inset box 边界参数点绕图元中心旋转（90° 倍数精确；t 缺省 0.5 中点） */
export function mountAnchorPoint(s: MountShape, a: MountAnchor, t?: number): { x: number; y: number } {
  const b = contentInsetBox(s)
  const u = Math.min(1, Math.max(0, typeof t === 'number' && Number.isFinite(t) ? t : 0.5))
  const base =
    a === 'top' ? { x: b.x + u * b.w, y: b.y }
    : a === 'bottom' ? { x: b.x + u * b.w, y: b.y + b.h }
    : a === 'left' ? { x: b.x, y: b.y + u * b.h }
    : { x: b.x + b.w, y: b.y + u * b.h }
  const rot = s.rotation ?? 0
  if (!rot) return base
  const c = centerOf(s)
  const rad = (rot * Math.PI) / 180
  const dx = base.x - c.x
  const dy = base.y - c.y
  return { x: c.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: c.y + dx * Math.sin(rad) + dy * Math.cos(rad) }
}

/** 折线总弧长 */
export function polylineLength(pts: [number, number][] | null): number {
  if (!pts || pts.length < 2) return 0
  let L = 0
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  return L
}

// ============ 挂接目标查找 ============

export interface MountTarget<C extends MountConn = MountConn> {
  conn: C
  /** 挂接点（折线上的投影点） */
  point: { x: number; y: number }
  /** 命中段是否水平（决定旋转 0°/90°） */
  horizontal: boolean
  /** 挂接点之前弧长 / 总弧长（labelT 折算用） */
  beforeRatio: number
  dist: number
}

/** 查找挂接目标：图元中心 → 最近「管线」连线折线段（≤ MOUNT_SNAP_DIST） */
export function findMountTarget<C extends MountConn, S extends MountShape>(
  content: { shapes: S[]; connections: C[] },
  shapeId: string,
  polylineOf: PolylineOf,
): MountTarget<C> | null {
  const s = content.shapes.find((x) => x.id === shapeId)
  if (!s || !isMountableShape(s)) return null
  const c0 = centerOf(s)
  let best: MountTarget<C> | null = null
  for (const conn of content.connections) {
    if (conn.pipelineId == null) continue // 只挂「管线」：未绑定管线主数据的普通连线不断开
    if (conn.fromShape === shapeId || conn.toShape === shapeId) continue // 自己的挂接段不再吸附
    const pts = polylineOf(conn)
    if (!pts || pts.length < 2) continue
    const end1 = pts[0]
    const endN = pts[pts.length - 1]
    let before = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[i + 1]
      const dx = x2 - x1
      const dy = y2 - y1
      const L2 = dx * dx + dy * dy
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((c0.x - x1) * dx + (c0.y - y1) * dy) / L2))
      const px = x1 + t * dx
      const py = y1 + t * dy
      const d = Math.hypot(c0.x - px, c0.y - py)
      if (d <= MOUNT_SNAP_DIST && (!best || d < best.dist)) {
        // 距折线首末端点过近不吸（挂接点退化到设备端口会造成零长段）
        if (Math.hypot(px - end1[0], py - end1[1]) < MOUNT_END_MARGIN) continue
        if (Math.hypot(px - endN[0], py - endN[1]) < MOUNT_END_MARGIN) continue
        const total = polylineLength(pts)
        best = {
          conn,
          point: { x: Math.round(px), y: Math.round(py) },
          horizontal: Math.abs(dx) >= Math.abs(dy),
          beforeRatio: total > 0 ? (before + Math.hypot(px - x1, py - y1)) / total : 0.5,
          dist: d,
        }
      }
      before += Math.sqrt(L2)
    }
  }
  return best
}

// ============ 挂接 / 解除 ============

/**
 * 挂接：图元旋转对齐 + 指定连线在挂接点断开为两段粘合图元两端。
 * 段1 保留原 conn id（管线号徽章引用稳定），段2 新建（mkConnId 注入）。
 * 泛型保留调用方具体类型（编辑器 PidShape/PidConn 与导入 LayoutShape/LayoutConn 均可透传）。
 */
export function mountShapeOnConn<S extends MountShape, C extends MountConn>(
  content: { shapes: S[]; connections: C[] },
  shapeId: string,
  target: MountTarget<C>,
  mkConnId: () => string,
): { shapes: S[]; connections: C[] } {
  const rot = target.horizontal ? 0 : 90
  const shapes = content.shapes.map((s) => (s.id === shapeId ? { ...s, rotation: rot } : s))
  const conn = target.conn
  const me = shapes.find((x) => x.id === shapeId)
  const from = content.shapes.find((x) => x.id === conn.fromShape)
  const to = content.shapes.find((x) => x.id === conn.toShape)
  // 「朝向 A 端」的物理方向：比较 A 端锚点与挂接点的相对方位（旋转感知锚点坐标，含自由锚点沿边参数）
  const aPt = from ? mountAnchorPoint(from, conn.fromAnchor, conn.fromT) : target.point
  let physTowardA: MountAnchor
  if (target.horizontal) physTowardA = aPt.x <= target.point.x ? 'left' : 'right'
  else physTowardA = aPt.y <= target.point.y ? 'top' : 'bottom'
  const anchorTowardA = anchorNameForPhysical(physTowardA, rot)
  const anchorTowardB = oppositeAnchor(anchorTowardA)
  // labelT 折算：按挂接点前后弧长比例归属到段1/段2
  const p = Math.min(0.98, Math.max(0.02, target.beforeRatio))
  const t0 = conn.labelT
  const seg1: C = { ...conn }
  seg1.toShape = shapeId
  seg1.toAnchor = anchorTowardA
  seg1.toT = undefined // 原连线 to 端自由锚点参数不属于阀门端，清除（Task 86-2）
  seg1.midOverride = undefined
  seg1.labelT = t0 != null && t0 <= p ? t0 / p : undefined
  const seg2 = {
    id: mkConnId(),
    fromShape: shapeId,
    fromAnchor: anchorTowardB,
    toShape: conn.toShape,
    toAnchor: conn.toAnchor,
    toT: conn.toT, // B 端自由锚点参数继承（Task 86-2）
    pipelineId: conn.pipelineId,
    direction: conn.direction,
    labelT: t0 != null && t0 > p ? (t0 - p) / (1 - p) : undefined,
  } as C
  return {
    shapes,
    connections: content.connections.flatMap((c) => (c.id === conn.id ? [seg1, seg2] : [c])),
  }
}

/**
 * 解除挂接：图元两端的两段连线重新合并为一条（管线自动闭合）。
 * merged=false 表示未找到完整挂接对（调用方按原级联删除逻辑处理单侧残段）。
 */
export function unmountShapeFromPipe<S extends MountShape, C extends MountConn>(
  content: { shapes: S[]; connections: C[] },
  shapeId: string,
  polylineOf: PolylineOf,
): { content: { shapes: S[]; connections: C[] }; merged: boolean } {
  const connTo = content.connections.find((c) => c.toShape === shapeId)
  const connFrom = content.connections.find((c) => c.fromShape === shapeId)
  if (!connTo || !connFrom || connTo.id === connFrom.id) return { content, merged: false }
  // 同一管线的两段才合并（pipelineId 一致或均未绑定）
  if (connTo.pipelineId != null && connFrom.pipelineId != null && connTo.pipelineId !== connFrom.pipelineId) {
    return { content, merged: false }
  }
  // labelT 合并：段1 比例 p = L1/(L1+L2)，按原折算逆运算还原到整条折线
  const L1 = polylineLength(polylineOf(connTo))
  const L2 = polylineLength(polylineOf(connFrom))
  const p = L1 + L2 > 0 ? L1 / (L1 + L2) : 0.5
  const t =
    connTo.labelT != null ? connTo.labelT * p
    : connFrom.labelT != null ? p + connFrom.labelT * (1 - p)
    : undefined
  const merged = {
    id: connTo.id,
    fromShape: connTo.fromShape,
    fromAnchor: connTo.fromAnchor,
    fromT: connTo.fromT, // A 端自由锚点参数继承（Task 86-2）
    toShape: connFrom.toShape,
    toAnchor: connFrom.toAnchor,
    toT: connFrom.toT, // B 端自由锚点参数继承（Task 86-2）
    pipelineId: connTo.pipelineId ?? connFrom.pipelineId ?? null,
    direction: connTo.direction ?? connFrom.direction,
    labelT: t,
  } as C
  return {
    content: {
      ...content,
      connections: content.connections
        .filter((c) => c.id !== connTo.id && c.id !== connFrom.id)
        .concat(merged),
    },
    merged: true,
  }
}

/**
 * 批量自动挂接（导入后处理，需求 3）：遍历可挂接图元，逐个吸附最近管线并断开粘合；
 * 每挂接一个重算连线（后续图元可挂到新产生的段上，支持一管多阀串联）。
 */
export function autoMountInlineShapes<T extends MountContent>(
  content: T,
  polylineOf: PolylineOf,
  mkConnId: () => string,
): T {
  let shapes: MountShape[] = content.shapes
  let connections: MountConn[] = content.connections
  const ids = shapes.filter((s) => isMountableShape(s)).map((s) => s.id)
  for (const id of ids) {
    const hit = findMountTarget({ shapes, connections }, id, polylineOf)
    if (!hit) continue
    const r = mountShapeOnConn({ shapes, connections }, id, hit, mkConnId)
    shapes = r.shapes
    connections = r.connections
  }
  return { ...content, shapes: shapes as T['shapes'], connections: connections as T['connections'] }
}

// ============ 导入端简化折线（无 midOverride / 自环场景） ============

/** 生成导入端 PolylineOf：两端锚点 + 正交折弯（与 routeConnection 同规则，不含自环） */
export function layoutPolylineOf(getShape: (id: string) => MountShape | undefined): PolylineOf {
  return (c) => {
    const f = getShape(c.fromShape)
    const t = getShape(c.toShape)
    if (!f || !t) return null
    const a = mountAnchorPoint(f, c.fromAnchor, c.fromT)
    const b = mountAnchorPoint(t, c.toAnchor, c.toT)
    const aH = c.fromAnchor === 'left' || c.fromAnchor === 'right'
    const bH = c.toAnchor === 'left' || c.toAnchor === 'right'
    if (aH && bH) {
      const midX = (a.x + b.x) / 2
      return [[a.x, a.y], [midX, a.y], [midX, b.y], [b.x, b.y]]
    }
    if (!aH && !bH) {
      const midY = (a.y + b.y) / 2
      return [[a.x, a.y], [a.x, midY], [b.x, midY], [b.x, b.y]]
    }
    if (aH) return [[a.x, a.y], [b.x, a.y], [b.x, b.y]]
    return [[a.x, a.y], [a.x, b.y], [b.x, b.y]]
  }
}
