// ============ 画布交互控制器（零框架 · Vue/React 共用） ============
// 组态画布交互层的泛型化产物：把「pointerdown 起点解析 + window 级 pointermove/pointerup 会话」
// 的手势循环、click 误触抑制、以及全部交互几何策略收敛到本文件——任何框架只需提供一个
// toPoint(客户端坐标→画布坐标) 换算，即可获得与 React 组态画布完全一致的交互能力：
//   ① runGesture / createCanvasController：统一手势会话（moved 首移标记 + first 事务时机 + 阈值轻点语义）
//   ② ClickGuard：平移/拖拽/连线/落笔结束后吞掉紧随 click 的时间戳防御（替代散落的 useRef 时间戳）
//   ③ 纯几何策略：四角缩放 resizeBox（对角固定点/最小尺寸/正圆锁定/翻转向）、
//      标注沿线 labelTAt（投影 clamp 3 位小数）、端点吸附 snapConnEnd（锚点区最近者）、
//      橡皮筋落笔判定 isTinyLineDraft
//   ④ 连线模型操作：connExists 查重 / rewireConnTarget 改接（EdgeGeom 级纯函数，宿主超集类型直接可用）
// React 壳（pid-config）与 Vue/原生壳（configurator-vue mountCanvasBoard）共用同一套控制器。

import type { Anchor, EdgeGeom, NodeGeom, RoutePoint } from './types'
import { clamp, distToAnchorZone, freeT, nearestFreeAnchorAt, projectToPolyline, tEq } from './geometry'
import { CONN_END_SNAP_DIST, LABEL_T_MAX, LABEL_T_MIN } from './constants'

// ---------- 手势会话 ----------

/** 手势种类（宿主可扩展 'custom'，data 里自由携带语义） */
export type GestureKind =
  | 'pan'          // 空白拖拽平移（屏幕坐标系，toPoint 覆写为恒等）
  | 'drag-shape'   // 图元拖动
  | 'drag-mark'    // 标注拖动
  | 'resize'       // 四角缩放
  | 'conn-label'   // 连线标注沿线拖动
  | 'conn-seg'     // 连线中段拖动
  | 'conn-end'     // 连线端点改接
  | 'line-draft'   // 直线橡皮筋
  | 'select'       // 框选橡皮筋（预留）
  | 'custom'       // 宿主自定义手势

/** 画布坐标点约束：宿主可传 RoutePoint 超集（扩展字段随意加） */
export type CanvasPoint = { x: number; y: number }

/** 一次手势会话的状态（pointerdown 到 pointerup 之间） */
export interface GestureSession<P extends CanvasPoint = RoutePoint> {
  kind: GestureKind
  targetId: string | null
  /** pointerdown 时的画布坐标起点（平移手势 = 屏幕坐标） */
  start: P
  /** 首次有效移动后为 true；配合 moveThreshold 可实现「轻点不位移」语义 */
  moved: boolean
  /** 会话级自由数据（宿主闭包状态，如 hover 快照） */
  data: Record<string, unknown>
}

export interface GestureSpec<P extends CanvasPoint = RoutePoint> {
  kind: GestureKind
  targetId?: string | null
  start: P
  /** 坐标换算覆写（缺省用控制器 host.toPoint；平移等屏幕系手势覆写为恒等） */
  toPoint?: (clientX: number, clientY: number) => P | null
  /**
   * 移动回调。first=true 表示本次移动是会话首次有效移动——拖拽类事务在此压撤销栈
   * （与「无位移不污染快照」的既有语义一一对应）
   */
  onMove?: (p: P, s: GestureSession<P>, first: boolean) => void
  /** 结束回调（pointerup；p 为抬起点换算结果，可能为 null） */
  onEnd?: (p: P | null, s: GestureSession<P>) => void
  /** 移动阈值（画布单位）：位移达到阈值才算 moved（平移 4 / 俯瞰导航等轻点区分场景） */
  moveThreshold?: number
}

/**
 * 运行一次手势会话：绑定 window 级 pointermove/pointerup，pointerup 或会话结束自动解绑。
 * 宿主在 pointerdown 里解析起点后调用；返回无需清理（自动移除监听）。
 */
export function runGesture<P extends CanvasPoint = RoutePoint>(spec: GestureSpec<P>): void {
  const s: GestureSession<P> = { kind: spec.kind, targetId: spec.targetId ?? null, start: spec.start, moved: false, data: {} }
  const toPoint = spec.toPoint
  const onMove = (ev: PointerEvent) => {
    const p = toPoint ? toPoint(ev.clientX, ev.clientY) : null
    if (!p) return
    let first = false
    if (!s.moved) {
      const th = spec.moveThreshold ?? 0
      if (th > 0 && Math.hypot(p.x - s.start.x, p.y - s.start.y) < th) return
      s.moved = true
      first = true
    }
    spec.onMove?.(p, s, first)
  }
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    const p = toPoint ? toPoint(ev.clientX, ev.clientY) : null
    spec.onEnd?.(p, s)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// ---------- click 误触抑制时间戳 ----------

export type GuardKey = 'click' | 'shapeClick' | 'connDragEnd' | 'lineEnd'

/** 各抑制键的缺省有效窗口（ms）：click=平移后 / shapeClick=图元拖动后 / connDragEnd / lineEnd=落笔后 */
const GUARD_DEFAULT_MS: Record<GuardKey, number> = { click: 350, shapeClick: 400, connDragEnd: 350, lineEnd: 350 }

export interface ClickGuard {
  /** 在当前时刻盖章（拖拽/平移/落笔结束时调用；拖拽中可反复盖章续期窗口） */
  arm(key: GuardKey): void
  /** 距上次盖章是否仍在抑制窗口内（缺省窗口见 GUARD_DEFAULT_MS） */
  block(key: GuardKey, ms?: number): boolean
}

export function createClickGuard(): ClickGuard {
  const at: Record<GuardKey, number> = { click: 0, shapeClick: 0, connDragEnd: 0, lineEnd: 0 }
  return {
    arm(key) { at[key] = Date.now() },
    block(key, ms) { return Date.now() - at[key] < (ms ?? GUARD_DEFAULT_MS[key]) },
  }
}

// ---------- 纯几何：四角缩放 ----------

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

/** 对角固定点：nw/sw 固定点在右缘，nw/ne 固定点在下缘 */
export function fixedCornerOf(handle: ResizeHandle, box: { x: number; y: number; w: number; h: number }): RoutePoint {
  return {
    x: handle === 'nw' || handle === 'sw' ? box.x + box.w : box.x,
    y: handle === 'nw' || handle === 'ne' ? box.y + box.h : box.y,
  }
}

export interface ResizeInput {
  handle: ResizeHandle
  /** 缩放前包围盒 */
  box: { x: number; y: number; w: number; h: number }
  /** 指针位置（画布坐标） */
  px: number
  py: number
  minW: number
  minH: number
  /** 正圆锁定（circle 图元）：以对角固定点为锚取最大边同步宽高 */
  lockSquare?: boolean
  /** 结果钳制矩形（图元编辑器 0..EDITOR_SIZE；缺省不限 = 无限画布） */
  clampRect?: { x0: number; y0: number; x1: number; y1: number }
}

export interface ResizeResult {
  x: number
  y: number
  w: number
  h: number
  /** 对角翻转向：(px>=fx)!==(py>=fy)——直线图元缩放时写入 flip */
  flip: boolean
}

/**
 * 四角缩放纯函数：对角为固定点，nw/sw 时 x/y 跟随变化；最小尺寸沿拖拽方向钳制；
 * lockSquare 正圆比例；flip 供直线端点翻转向。主画布与图元编辑器共用（编辑器传 clampRect）。
 */
export function resizeBox(i: ResizeInput): ResizeResult {
  const { x: fx, y: fy } = fixedCornerOf(i.handle, i.box)
  const px = clamp(i.px, i.clampRect?.x0 ?? -Infinity, i.clampRect?.x1 ?? Infinity)
  const py = clamp(i.py, i.clampRect?.y0 ?? -Infinity, i.clampRect?.y1 ?? Infinity)
  let x1 = Math.min(fx, px)
  let x2 = Math.max(fx, px)
  let y1 = Math.min(fy, py)
  let y2 = Math.max(fy, py)
  if (x2 - x1 < i.minW) {
    if (px < fx) x1 = x2 - i.minW
    else x2 = x1 + i.minW
  }
  if (y2 - y1 < i.minH) {
    if (py < fy) y1 = y2 - i.minH
    else y2 = y1 + i.minH
  }
  if (i.lockSquare) {
    const size = Math.max(x2 - x1, y2 - y1)
    if (px >= fx) x2 = x1 + size
    else x1 = x2 - size
    if (py >= fy) y2 = y1 + size
    else y1 = y2 - size
  }
  if (i.clampRect) {
    x1 = Math.max(i.clampRect.x0, x1)
    y1 = Math.max(i.clampRect.y0, y1)
    x2 = Math.min(i.clampRect.x1, x2)
    y2 = Math.min(i.clampRect.y1, y2)
  }
  return {
    x: Math.round(x1),
    y: Math.round(y1),
    w: Math.max(i.minW, Math.round(x2 - x1)),
    h: Math.max(i.minH, Math.round(y2 - y1)),
    flip: (px >= fx) !== (py >= fy),
  }
}

// ---------- 纯几何：框选橡皮筋（'select' 手势配套） ----------

/** 轴对齐矩形（画布坐标；x0<=x1, y0<=y1 由 normRect 保证） */
export interface RubberRect { x0: number; y0: number; x1: number; y1: number }

/** 任意两角归一化为轴对齐矩形（橡皮筋 onMove 里每帧调用） */
export function normRect(ax: number, ay: number, bx: number, by: number): RubberRect {
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }
}

/** 橡皮筋是否有效（任一轴跨度 ≥ minSpan，轻点不算框选） */
export function isRealRubber(r: RubberRect, minSpan = 3): boolean {
  return Math.max(r.x1 - r.x0, r.y1 - r.y0) >= minSpan
}

/**
 * 框选命中：包围盒与橡皮筋相交的图元 id（相交即选中，CAD/Figma 惯例）。
 * 只看 x/y/w/h 包围盒（旋转图元用未旋转包围盒，与单选 hitShape 粒度一致）。
 */
export function hitTestRect<N extends Pick<NodeGeom, 'id' | 'x' | 'y' | 'w' | 'h'>>(
  shapes: N[],
  r: RubberRect,
): string[] {
  const out: string[] = []
  for (const s of shapes) {
    if (s.x + s.w < r.x0 || s.x > r.x1 || s.y + s.h < r.y0 || s.y > r.y1) continue
    out.push(s.id)
  }
  return out
}

// ---------- 纯几何：连线标注沿线 / 端点吸附 / 橡皮筋 ----------

/** 直线橡皮筋草稿（sx/sy 起点 ex/ey 终点） */
export interface LineDraft { sx: number; sy: number; ex: number; ey: number }

/** 橡皮筋落笔判定：最大轴位移 < minLen 视为误触单击，不落笔（工具保持激活） */
export function isTinyLineDraft(d: LineDraft, minLen = 5): boolean {
  return Math.max(Math.abs(d.ex - d.sx), Math.abs(d.ey - d.sy)) < minLen
}

/**
 * 指针投影到折线的归一化弧长参数（两端 clamp 至 [min,max] 防盖住锚点，3 位小数存储）。
 * 折线为空返回 null，宿主直接忽略本次移动。
 */
export function labelTAt(
  pts: [number, number][],
  px: number,
  py: number,
  min = LABEL_T_MIN,
  max = LABEL_T_MAX,
): number | null {
  const proj = projectToPolyline(pts, px, py)
  if (!proj) return null
  return Math.round(clamp(proj.t, min, max) * 1000) / 1000
}

/** 端点改接吸附目标（自由位置：落在哪个图元边框就连哪） */
export interface ConnEndTarget {
  shapeId: string
  anchor: Anchor
  /** 沿边的自由锚点参数（nearestFreeAnchorAt 恒有值） */
  t?: number
}

/** 端点改接吸附：在全部图元锚点区（外扩带）内取距离最近者，超出 snapDist 返回 null（空白松手回退） */
export function snapConnEnd<N extends NodeGeom>(
  shapes: N[],
  px: number,
  py: number,
  snapDist = CONN_END_SNAP_DIST,
): ConnEndTarget | null {
  let best = snapDist
  let hit: ConnEndTarget | null = null
  for (const s of shapes) {
    const d = distToAnchorZone(s, px, py)
    if (d < best) {
      best = d
      hit = { shapeId: s.id, ...nearestFreeAnchorAt(s, px, py) }
    }
  }
  return hit
}

// ---------- 连线模型操作（EdgeGeom 级纯函数） ----------

/** 同向重复连线判定（from→to 全等含自由锚点 t） */
export function connExists<E extends EdgeGeom>(
  conns: E[],
  from: { shapeId: string; anchor: Anchor; t?: number },
  to: { shapeId: string; anchor: Anchor; t?: number },
): boolean {
  return conns.some((c) =>
    c.fromShape === from.shapeId && c.fromAnchor === from.anchor && tEq(c.fromT, from.t)
    && c.toShape === to.shapeId && c.toAnchor === to.anchor && tEq(c.toT, to.t),
  )
}

export type RewireResult<E extends EdgeGeom> =
  | { ok: true; conn: E; conns: E[] }
  | { ok: false; reason: 'noop' | 'same-anchor' | 'dup' }

/**
 * 端点改接（纯函数）：which 端改接到 target。
 * 无变化 noop；起点终点同锚点 same-anchor 拒绝；同向重复 dup 拒绝；
 * 改接端 t 经 freeT 归一化（四向中点不落库），并清除 midOverride 重新自动布线。
 */
export function rewireConnTarget<E extends EdgeGeom>(
  conns: E[],
  id: string,
  which: 'from' | 'to',
  target: { shapeId: string; anchor: Anchor; t?: number },
): RewireResult<E> {
  const cc = conns.find((x) => x.id === id)
  if (!cc) return { ok: false, reason: 'noop' }
  const otherShape = which === 'from' ? cc.toShape : cc.fromShape
  const otherAnchor = which === 'from' ? cc.toAnchor : cc.fromAnchor
  const otherT = which === 'from' ? cc.toT : cc.fromT
  const changed = which === 'from'
    ? cc.fromShape !== target.shapeId || cc.fromAnchor !== target.anchor || !tEq(cc.fromT, target.t)
    : cc.toShape !== target.shapeId || cc.toAnchor !== target.anchor || !tEq(cc.toT, target.t)
  if (!changed) return { ok: false, reason: 'noop' }
  if (target.shapeId === otherShape && target.anchor === otherAnchor && tEq(target.t, otherT)) {
    return { ok: false, reason: 'same-anchor' }
  }
  const dup = conns.some((x) =>
    x.id !== cc.id && (
      which === 'from'
        ? x.fromShape === target.shapeId && x.fromAnchor === target.anchor && tEq(x.fromT, target.t) && x.toShape === cc.toShape && x.toAnchor === cc.toAnchor && tEq(x.toT, cc.toT)
        : x.fromShape === cc.fromShape && x.fromAnchor === cc.fromAnchor && tEq(x.fromT, cc.fromT) && x.toShape === target.shapeId && x.toAnchor === target.anchor && tEq(x.toT, target.t)
    ),
  )
  if (dup) return { ok: false, reason: 'dup' }
  const t = freeT(target.t)
  const conn: E = which === 'from'
    ? { ...cc, fromShape: target.shapeId, fromAnchor: target.anchor, fromT: t, midOverride: undefined }
    : { ...cc, toShape: target.shapeId, toAnchor: target.anchor, toT: t, midOverride: undefined }
  return { ok: true, conn, conns: conns.map((x) => (x.id === id ? conn : x)) }
}

// ---------- 受控控制器（绑定坐标换算 + click 抑制） ----------

export interface CanvasControllerHost<P extends CanvasPoint = RoutePoint> {
  /** 客户端坐标 → 画布坐标（React: svgRef+viewBox 换算；Vue/原生: getBoundingClientRect+viewBox；可空 = 事件忽略） */
  toPoint: (clientX: number, clientY: number) => P | null
}

export interface CanvasController<P extends CanvasPoint = RoutePoint> {
  /** 运行一次手势会话（window 级 pointermove/pointerup，自动清理；缺省用 host.toPoint 换算） */
  run(spec: GestureSpec<P>): void
  /** click 误触抑制时间戳（平移/拖拽/连线/落笔结束防御） */
  guard: ClickGuard
}

/** 创建画布交互控制器：React 壳与 Vue/原生壳各提供一个 toPoint 即获得全部画布交互 */
export function createCanvasController<P extends CanvasPoint = RoutePoint>(host: CanvasControllerHost<P>): CanvasController<P> {
  const guard = createClickGuard()
  return {
    run(spec) {
      runGesture<P>({ ...spec, toPoint: spec.toPoint ?? host.toPoint })
    },
    guard,
  }
}
