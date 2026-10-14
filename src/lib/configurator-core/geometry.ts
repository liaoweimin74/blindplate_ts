// ============ 组态引擎几何库（锚点 / 正交路由 / 投影 / 命中 / 吸附） ============
// 全部纯函数、零框架依赖；节点类型泛型化（N extends NodeGeom）。
// 符号「内容边界」通过 setInsetResolver 注入（消除标准符号留白导致的锚点悬空）——
// 宿主可按符号查表返回真实内容 bbox；缺省返回整包围盒。

import type { Anchor, Box, ConnEndpoint, NodeGeom, RoutePoint } from './types'
import { CANVAS_W, CANVAS_H } from './constants'

// ============ 符号内容边界解析器（宿主注入） ============

export type InsetResolver = (n: Pick<NodeGeom, 'type' | 'x' | 'y' | 'w' | 'h'> & { stdId?: string | null }) => Box

let insetResolver: InsetResolver = (n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })

/**
 * 注入符号内容边界解析器：返回符号在包围盒内「实际绘制内容」的 bbox（世界坐标）。
 * BPMS 场景由 std 符号 bbox 表（STD_SYMBOL_BBOX）查表实现；其他业务可按需注入或用缺省。
 */
export function setInsetResolver(r: InsetResolver): void {
  insetResolver = r
}

function insetBox(n: Pick<NodeGeom, 'type' | 'x' | 'y' | 'w' | 'h'> & { stdId?: string | null }): Box {
  return insetResolver(n)
}

// ============ 基础工具 ============

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

let uidSeq = 0
export function uid(prefix: string): string {
  uidSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${uidSeq.toString(36)}`
}

/** t 参数是否需要持久化：0.5（四向中点）即旧数据缺省行为，不写 JSON 保持干净 */
export function freeT(t: number | undefined | null): number | undefined {
  return typeof t === 'number' && Math.abs(t - 0.5) > 1e-6 ? t : undefined
}

/** 自由锚点 t 等值比较（去重判断用；缺省均视为 0.5） */
export function tEq(a: number | undefined, b: number | undefined): boolean {
  return Math.abs((a ?? 0.5) - (b ?? 0.5)) < 1e-6
}

/** 点到线段最短距离 */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** 折线总弧长（SVG 单位） */
export function polylineLength(pts: [number, number][] | null): number {
  if (!pts || pts.length < 2) return 0
  let L = 0
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  return L
}

/** 按归一化弧长参数 t（0..1）取折线上一点；零长折线返回 null */
export function pointAlongPolyline(pts: [number, number][], t: number): { x: number; y: number } | null {
  if (pts.length < 2) return null
  const total = polylineLength(pts)
  if (total <= 0) return null
  let target = Math.min(1, Math.max(0, t)) * total
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    if (target <= seg || i === pts.length - 2) {
      const r = seg > 0 ? target / seg : 0
      return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r }
    }
    target -= seg
  }
  return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] }
}

/** 点到折线的最近投影：返回归一化弧长参数 t（0..1）与距离；零长折线返回 null */
export function projectToPolyline(pts: [number, number][], px: number, py: number): { t: number; dist: number } | null {
  if (pts.length < 2) return null
  const total = polylineLength(pts)
  if (total <= 0) return null
  let best: { t: number; dist: number } | null = null
  let acc = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    const dx = x2 - x1
    const dy = y2 - y1
    const l2 = dx * dx + dy * dy
    let tt = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2
    tt = Math.max(0, Math.min(1, tt))
    const qx = x1 + tt * dx
    const qy = y1 + tt * dy
    const d = Math.hypot(px - qx, py - qy)
    if (!best || d < best.dist) best = { t: (acc + tt * Math.sqrt(l2)) / total, dist: d }
    acc += Math.sqrt(l2)
  }
  return best
}

// ============ 挂接旋转（90° 倍数）锚点名换算 ============

const ANCHOR_ORDER: Anchor[] = ['top', 'right', 'bottom', 'left']

/** 逻辑锚点名在旋转 rot 度后的物理朝向 */
export function rotateAnchorName(a: Anchor, rot: number): Anchor {
  const r = ((((Math.round(rot / 90) * 90) % 360) + 360) % 360)
  if (r === 0) return a
  return ANCHOR_ORDER[(ANCHOR_ORDER.indexOf(a) + r / 90) % 4]
}

/** 物理朝向 → 旋转 rot 下能到达该朝向的锚点名（rotateAnchorName 的逆变换） */
export function anchorNameForPhysical(phys: Anchor, rot: number): Anchor {
  const r = ((((Math.round(rot / 90) * 90) % 360) + 360) % 360)
  if (r === 0) return phys
  return ANCHOR_ORDER[(ANCHOR_ORDER.indexOf(phys) - r / 90 + 4) % 4]
}

export function oppositeAnchor(a: Anchor): Anchor {
  return a === 'top' ? 'bottom' : a === 'bottom' ? 'top' : a === 'left' ? 'right' : 'left'
}

// ============ 锚点定位 ============

/**
 * 节点锚点绝对坐标（自由锚点版）：
 * - 先内收到符号内容真实边界（消除留白悬空），再取 named 边上参数 t 处的点（t=0.5 即四向中点）；
 * - t 语义：top/bottom 沿 x 从左到右、left/right 沿 y 从上到下（0=边起点 1=边终点）；
 * - 挂接旋转（90° 倍数）时参数点绕节点中心旋转——与 nearestFreeAnchorAt 换算精确互逆。
 */
export function anchorPointT<N extends NodeGeom>(s: N, a: Anchor, t?: number): RoutePoint {
  const b = insetBox(s as NodeGeom & { stdId?: string | null })
  const u = Math.min(1, Math.max(0, typeof t === 'number' && Number.isFinite(t) ? t : 0.5))
  const base: RoutePoint =
    a === 'top' ? { x: b.x + u * b.w, y: b.y }
    : a === 'bottom' ? { x: b.x + u * b.w, y: b.y + b.h }
    : a === 'left' ? { x: b.x, y: b.y + u * b.h }
    : { x: b.x + b.w, y: b.y + u * b.h }
  const rot = s.rotation ?? 0
  if (!rot) return base
  const cx = s.x + s.w / 2
  const cy = s.y + s.h / 2
  const rad = (rot * Math.PI) / 180
  const dx = base.x - cx
  const dy = base.y - cy
  return { x: cx + dx * Math.cos(rad) - dy * Math.sin(rad), y: cy + dx * Math.sin(rad) + dy * Math.cos(rad) }
}

/** 节点某锚点的绝对坐标（四向中点） */
export function anchorPoint<N extends NodeGeom>(s: N, a: Anchor): RoutePoint {
  return anchorPointT(s, a)
}

/** 挂接旋转后的物理锚点名：routeConnection 的水平/垂直路由判定按物理朝向（非锚点名） */
export function physAnchor<N extends NodeGeom>(s: N | undefined, a: Anchor): Anchor {
  const rot = s?.rotation ?? 0
  return rot ? rotateAnchorName(a, rot) : a
}

/** 锚点向外延伸 d 像素（自环绕行用） */
export function outward(a: Anchor, p: RoutePoint, d: number): RoutePoint {
  switch (a) {
    case 'top':    return { x: p.x, y: p.y - d }
    case 'bottom': return { x: p.x, y: p.y + d }
    case 'left':   return { x: p.x - d, y: p.y }
    case 'right':  return { x: p.x + d, y: p.y }
  }
}

/** 节点「边框锚点区」物理包围盒：内容盒 + 挂接旋转 90°/270° 时绕中心宽高互换（与 anchorPointT 旋转后的锚点位置一致） */
export function anchorZoneBox<N extends NodeGeom>(s: N): Box {
  const b = insetBox(s as NodeGeom & { stdId?: string | null })
  const rot = (((s.rotation ?? 0) % 360) + 360) % 360
  if (rot === 90 || rot === 270) {
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    return { x: cx - b.h / 2, y: cy - b.w / 2, w: b.h, h: b.w }
  }
  return b
}

/**
 * 自由锚点：指针落在节点边框锚点区时的吸附端点 = 最近物理边 + 沿边参数（0..1）。
 * 点击哪里端点就在哪里（不再吸附四向中点）。
 * 挂接旋转换算：物理边两端点逆旋转回逻辑 content 盒求逻辑参数，端点线性插值——
 * 统一覆盖 90/180/270（旋转下沿边参数可能同向也可能反向），与 anchorPointT 精确互逆。
 */
export function nearestFreeAnchorAt<N extends NodeGeom>(s: N, px: number, py: number): { anchor: Anchor; t: number } {
  const b = anchorZoneBox(s)
  const dl = Math.abs(px - b.x)
  const dr = Math.abs(b.x + b.w - px)
  const dt = Math.abs(py - b.y)
  const db = Math.abs(b.y + b.h - py)
  const dmin = Math.min(dl, dr, dt, db)
  const phys: Anchor = dmin === dl ? 'left' : dmin === dr ? 'right' : dmin === dt ? 'top' : 'bottom'
  // 沿物理边的参数：top/bottom 以 x 从左到右，left/right 以 y 从上到下
  const tPhys = Math.min(1, Math.max(0,
    phys === 'left' || phys === 'right' ? (py - b.y) / b.h : (px - b.x) / b.w))
  const rot = s.rotation ?? 0
  if (!rot) return { anchor: phys, t: tPhys }
  const logical = anchorNameForPhysical(phys, rot)
  // 物理边参数 0/1 端点 → 逆旋转回逻辑坐标 → 逻辑边参数，端点线性插值得逻辑 t
  const lb = insetBox(s as NodeGeom & { stdId?: string | null })
  const cx = s.x + s.w / 2
  const cy = s.y + s.h / 2
  const rad = (rot * Math.PI) / 180
  const cos = Math.cos(-rad)
  const sin = Math.sin(-rad)
  const toLogic = (x: number, y: number) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  })
  const p0 = phys === 'left' || phys === 'top' ? { x: b.x, y: b.y }
    : phys === 'right' ? { x: b.x + b.w, y: b.y }
    : { x: b.x, y: b.y + b.h }
  const p1 = phys === 'top' || phys === 'bottom' ? { x: b.x + b.w, y: p0.y } : { x: p0.x, y: b.y + b.h }
  const par = (q: { x: number; y: number }) =>
    logical === 'top' || logical === 'bottom' ? (q.x - lb.x) / lb.w : (q.y - lb.y) / lb.h
  const t0 = par(toLogic(p0.x, p0.y))
  const t1 = par(toLogic(p1.x, p1.y))
  const t = Math.min(1, Math.max(0, t0 * (1 - tPhys) + t1 * tPhys))
  return { anchor: logical, t }
}

/** 兼容别名（仅取边名）：连线端点拖拽吸附等只需方向的场景 */
export function nearestAnchorAt<N extends NodeGeom>(s: N, px: number, py: number): Anchor {
  return nearestFreeAnchorAt(s, px, py).anchor
}

/** 指针到节点边框锚点区（物理包围盒）的距离：盒内为 0（连线端点拖拽吸附用） */
export function distToAnchorZone<N extends NodeGeom>(s: N, px: number, py: number): number {
  const b = anchorZoneBox(s)
  const dx = Math.max(b.x - px, 0, px - (b.x + b.w))
  const dy = Math.max(b.y - py, 0, py - (b.y + b.h))
  return Math.hypot(dx, dy)
}

/**
 * 连线锚点命中区路径：
 * - 环带模式（evenodd 打洞）：包围盒外扩 m 的边带——「边框附近一圈」可点击连线，本体区域留洞
 *   （保留点击选中/按住拖动语义）；屏幕缩放小时边带仍足够宽
 * - 实心模式：包围盒外扩 m 的实心矩形（含本体+周边环带全部）——连线挂起态下目标节点
 *   「本体及边框周边任意位置」点击即完成连线
 */
export function anchorHitBandPath<N extends NodeGeom>(s: N, m = 18): string {
  const b = anchorZoneBox(s)
  const ox = b.x - m
  const oy = b.y - m
  const ow = b.w + 2 * m
  const oh = b.h + 2 * m
  return `M${ox},${oy}h${ow}v${oh}h${-ow}Z M${b.x},${b.y}h${b.w}v${b.h}h${-b.w}Z`
}

export function anchorHitSolidPath<N extends NodeGeom>(s: N, m = 18): string {
  const b = anchorZoneBox(s)
  const ox = b.x - m
  const oy = b.y - m
  return `M${ox},${oy}h${b.w + 2 * m}v${b.h + 2 * m}h${-(b.w + 2 * m)}Z`
}

/**
 * 连线正交（曼哈顿）自动折弯路由：
 * - 双水平锚点（left/right）：取 midX 拐弯（midOverride 可手动覆盖中段竖线位置）
 * - 双垂直锚点（top/bottom）：取 midY 拐弯（midOverride 可手动覆盖中段横线位置）
 * - 混合：直角两段（无自由中段，忽略 midOverride）
 * - 同节点自环：两端锚点先向外延伸 24px 再绕行
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

/** 节点标签 y 坐标（包围盒下方，反应器类更深） */
export function shapeLabelY<N extends NodeGeom>(s: N): number {
  return s.y + s.h + (s.type === 'reactor' ? 22 : 16)
}

/** 视口中心点（世界坐标） */
export function viewportCenter(v: { x: number; y: number; w: number; h: number }): RoutePoint {
  return { x: v.x + v.w / 2, y: v.y + v.h / 2 }
}

/** 主图区中心（世界坐标） */
export function canvasCenter(): RoutePoint {
  return { x: CANVAS_W / 2, y: CANVAS_H / 2 }
}
