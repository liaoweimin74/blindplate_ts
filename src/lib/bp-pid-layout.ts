// PID 组态图自动布局（AI 识别导入专用，纯函数无 DB 依赖）
// 输入导入后的主数据（含 id），输出与 pid-config.tsx 编辑器完全兼容的 PidContent JSON 结构：
//   shapes（设备图元：VLM 提供了原图归一化坐标时按原图位置+尺寸排版，重叠自动分离；
//           无坐标时回退类型分层网格；无坐标设备在混合场景下沉画布底部兕底带）
//   connections（管线连线，锚点按两设备相对位置自动选择，pipelineId 绑定主数据）
//   marks（隔离点挂标，优先落在所属管线连线中点上方，无连线时排布在画布底部）

// 符号内容真实边界表（getBBox 实测，纯数据无 JSX，可安全被 server 端引用；缺失时回退包围盒）
import { STD_SYMBOL_BBOX, type StdBBox } from '@/components/bp/std/bbox'

// 画布尺寸（与 pid-config.tsx 导出的 CANVAS_W/CANVAS_H 保持一致，避免 server 端 import client 组件）
const CANVAS_W = 1200
const CANVAS_H = 700

type Anchor = 'top' | 'right' | 'bottom' | 'left'
type ShapeType = 'exchanger' | 'reactor' | 'column' | 'pump' | 'tank' | 'rect' | 'std'

export interface LayoutEquip {
  id: number
  code: string
  name: string
  type: string
  /** VLM 识别的原图归一化中心坐标（0~100，x 向右 y 向下）；缺失/无效为 null */
  x?: number | null
  y?: number | null
  /** VLM 估计的符号占整图宽/高百分比（0~100）；缺失/无效为 null */
  w?: number | null
  h?: number | null
}
export interface LayoutPipe {
  id: number
  code: string
  name: string
  fromEquipment: string | null
  toEquipment: string | null
}
export interface LayoutPoint { id: number; code: string; name: string; pipelineCode: string | null }

export interface LayoutShape {
  id: string
  type: ShapeType
  stdId?: string // type='std' 时指向 src/components/bp/std 的 STD_SYMBOL_MAP
  x: number
  y: number
  w: number
  h: number
  label: string
  equipmentId: number
}

export interface LayoutConn {
  id: string
  fromShape: string
  fromAnchor: Anchor
  toShape: string
  toAnchor: Anchor
  direction: 'forward'
  pipelineId: number
}

export interface LayoutMark {
  id: string
  masterPointId: number
  code: string
  name: string
  x: number
  y: number
}

export interface PidLayoutContent {
  shapes: LayoutShape[]
  connections: LayoutConn[]
  marks: LayoutMark[]
}

/** 设备类型 → 布局行（塔/反应器最高层，泵/压缩机最底层，符合工艺流程纵向惯例） */
const ROW_OF: Record<string, number> = {
  COLUMN: 0, REACTOR: 0,
  TANK: 1, VESSEL: 1,
  FURNACE: 2,
  EXCHANGER: 3, OTHER: 3,
  PUMP: 4, COMPRESSOR: 4,
}

/** 设备类型 → 图元：内建图元符号库（src/components/bp/std，Task 61 五大分类全量重建版）
 *  + 默认尺寸（接近符号设计空间纵横比）。AI 识别导入的设备类型映射到新库符号 ID */
const SHAPE_SPEC: Record<string, { stdId: string; w: number; h: number }> = {
  COLUMN: { stdId: 'eq-tray-col', w: 56, h: 112 },
  REACTOR: { stdId: 'eq-fixed-bed', w: 56, h: 112 },
  TANK: { stdId: 'eq-vtank', w: 58, h: 74 },
  VESSEL: { stdId: 'eq-htank', w: 84, h: 48 },
  FURNACE: { stdId: 'eq-furnace', w: 50, h: 70 },
  EXCHANGER: { stdId: 'eq-bhe', w: 96, h: 48 },
  PUMP: { stdId: 'eq-pump-c', w: 56, h: 56 },
  COMPRESSOR: { stdId: 'eq-compressor', w: 64, h: 48 },
  OTHER: { stdId: 'eq-htank', w: 84, h: 48 },
}

const PAD_X = 56
const PAD_Y = 46

/**
 * 图元「内容真实边界」（画布坐标）：内建图元按实测 bbox 将设计空间留白内收，
 * 使连线锚点落在符号实体上而非包围盒空白处；非 std 图元/无 bbox 数据时回退包围盒。
 */
export function contentInsetBox(s: { stdId?: string | null; x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const b: StdBBox | undefined = s.stdId ? STD_SYMBOL_BBOX[s.stdId] : undefined
  if (!b || b.sw <= 0 || b.sh <= 0) return { x: s.x, y: s.y, w: s.w, h: s.h }
  return {
    x: s.x + (b.x / b.sw) * s.w,
    y: s.y + (b.y / b.sh) * s.h,
    w: (b.w / b.sw) * s.w,
    h: (b.h / b.sh) * s.h,
  }
}

function anchorPoint(s: LayoutShape, a: Anchor): { x: number; y: number } {
  const b = contentInsetBox(s)
  switch (a) {
    case 'left': return { x: b.x, y: b.y + b.h / 2 }
    case 'right': return { x: b.x + b.w, y: b.y + b.h / 2 }
    case 'top': return { x: b.x + b.w / 2, y: b.y }
    case 'bottom': return { x: b.x + b.w / 2, y: b.y + b.h }
  }
}

function centerOf(s: LayoutShape): { x: number; y: number } {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 有效归一化中心坐标（0~100，clamp 后返回；缺失/NaN 视为无坐标） */
function posOf(e: LayoutEquip): { cx: number; cy: number } | null {
  const x = typeof e.x === 'number' ? e.x : typeof e.x === 'string' ? parseFloat(e.x) : NaN
  const y = typeof e.y === 'number' ? e.y : typeof e.y === 'string' ? parseFloat(e.y) : NaN
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { cx: Math.min(100, Math.max(0, x)), cy: Math.min(100, Math.max(0, y)) }
}

/** 原图尺寸 → 符号缩放系数：宽/高两方向映射后取几何平均（保持符号宽高比不畸变），clamp 0.6~1.8 */
function scaleOf(e: LayoutEquip, spec: { w: number; h: number }): number {
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const ew = num(e.w)
  const eh = num(e.h)
  const sx = ew !== null ? ((ew / 100) * CANVAS_W) / spec.w : null
  const sy = eh !== null ? ((eh / 100) * CANVAS_H) / spec.h : null
  const raw = sx !== null && sy !== null ? Math.sqrt(sx * sy) : sx ?? sy
  return raw === null ? 1 : clamp(raw, 0.6, 1.8)
}

/** 简单重叠分离：矩形外扩 10px 两两检测，沿重叠较小方向推开，迭代至稳定或 24 轮 */
function separateOverlaps(shapes: LayoutShape[], rounds = 24): void {
  const M = 10
  for (let r = 0; r < rounds; r++) {
    let moved = false
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i]
        const b = shapes[j]
        const ox = Math.min(a.x + a.w + M, b.x + b.w + M) - Math.max(a.x - M, b.x - M)
        const oy = Math.min(a.y + a.h + M, b.y + b.h + M) - Math.max(a.y - M, b.y - M)
        if (ox <= 0 || oy <= 0) continue
        if (ox <= oy) {
          const d = ox / 2 * (a.x + a.w / 2 <= b.x + b.w / 2 ? -1 : 1)
          a.x = Math.round(clamp(a.x + d, 4, Math.max(4, CANVAS_W - a.w - 4)))
          b.x = Math.round(clamp(b.x - d, 4, Math.max(4, CANVAS_W - b.w - 4)))
        } else {
          const d = oy / 2 * (a.y + a.h / 2 <= b.y + b.h / 2 ? -1 : 1)
          a.y = Math.round(clamp(a.y + d, 4, Math.max(4, CANVAS_H - a.h - 4)))
          b.y = Math.round(clamp(b.y - d, 4, Math.max(4, CANVAS_H - b.h - 4)))
        }
        moved = true
      }
    }
    if (!moved) break
  }
}

/**
 * 构建组态图 content：
 * 1. 设备布局：≥1 台带原图坐标 → 坐标排版（中心映射+原图尺寸缩放+重叠分离）；无坐标设备沉底部兕底带；
 *    全部无坐标 → 按类型分层、行内按位号排序的网格排列（旧行为回退，行高/列宽按画布自适应）
 * 2. 管线 → 连线（锚点按两设备中心相对位置选择，优先水平方向）
 * 3. 隔离点 → 挂标（所属管线连线中点上方，同管线多点纵向错开；无连线排布在画布底部）
 */
export function buildPidLayout(equips: LayoutEquip[], pipes: LayoutPipe[], points: LayoutPoint[]): PidLayoutContent {
  const sorted = [...equips].sort((a, b) => (a.code < b.code ? -1 : 1))
  const shapes: LayoutShape[] = []
  const shapeByCode = new Map<string, LayoutShape>()

  const mkShape = (e: LayoutEquip, cx: number, cy: number): LayoutShape => {
    const spec = SHAPE_SPEC[e.type] ?? SHAPE_SPEC.OTHER
    const scale = scaleOf(e, spec)
    const w = Math.round(spec.w * scale)
    const h = Math.round(spec.h * scale)
    const label = `${e.code}${e.name ? ` ${e.name}` : ''}`.slice(0, 18)
    const shape: LayoutShape = {
      id: `s-e${e.id}`,
      type: 'std',
      stdId: spec.stdId,
      x: Math.round(clamp(cx - w / 2, 4, Math.max(4, CANVAS_W - w - 4))),
      y: Math.round(clamp(cy - h / 2, 4, Math.max(4, CANVAS_H - h - 4))),
      w,
      h,
      label,
      equipmentId: e.id,
    }
    shapes.push(shape)
    shapeByCode.set(e.code, shape)
    return shape
  }

  const withPos = sorted.filter((e) => posOf(e) !== null)
  const withoutPos = sorted.filter((e) => posOf(e) === null)

  if (withPos.length > 0) {
    // ---- 1a. 带原图坐标设备：VLM 归一化中心 → 画布坐标 ----
    for (const e of withPos) {
      const p = posOf(e)! // 已过滤，非空
      mkShape(e, (p.cx / 100) * CANVAS_W, (p.cy / 100) * CANVAS_H)
    }
    // ---- 1b. 无坐标设备：画布底部兕底带均布（7 个/行，最多两行） ----
    if (withoutPos.length > 0) {
      const cellW = (CANVAS_W - 40) / 7
      const twoRows = withoutPos.length > 7
      const bandH = 60
      const bandTop = CANVAS_H - 44 - bandH - (twoRows ? bandH + 12 : 0)
      withoutPos.forEach((e, i) => {
        const row = Math.floor(i / 7)
        const col = i % 7
        const spec = SHAPE_SPEC[e.type] ?? SHAPE_SPEC.OTHER
        const w = Math.round(spec.w * scaleOf(e, spec))
        mkShape(e, 20 + col * cellW + cellW / 2, bandTop + row * (bandH + 12) + bandH / 2)
      })
    }
    // ---- 1c. 重叠分离（含坐标区与兕底带之间） ----
    separateOverlaps(shapes)
  } else {
    // ---- 1'. 全部无坐标：按类型分层网格布局（旧行为回退） ----
    const usedRows = [...new Set(sorted.map((e) => ROW_OF[e.type] ?? 3))].sort((a, b) => a - b)
    const rowIndexOf = new Map<number, number>(usedRows.map((r, i) => [r, i]))
    const rowCount = Math.max(1, usedRows.length)

    // 每行项数 → 自适应列宽（最多排开的列数决定）
    const perRow = new Map<number, LayoutEquip[]>()
    for (const e of sorted) {
      const row = rowIndexOf.get(ROW_OF[e.type] ?? 3) ?? 0
      if (!perRow.has(row)) perRow.set(row, [])
      perRow.get(row)!.push(e)
    }
    const maxCols = Math.max(1, ...[...perRow.values()].map((arr) => arr.length))
    const colW = Math.min(210, (CANVAS_W - PAD_X * 2) / maxCols)
    const rowH = Math.min(170, (CANVAS_H - PAD_Y * 2) / rowCount)

    for (const [row, items] of [...perRow.entries()].sort((a, b) => a[0] - b[0])) {
      items.forEach((e, col) => {
        const spec = SHAPE_SPEC[e.type] ?? SHAPE_SPEC.OTHER
        const cellX = PAD_X + col * colW
        const cellY = PAD_Y + row * rowH
        mkShape(e, cellX + Math.max(0, (colW - spec.w) / 2) + spec.w / 2, cellY + Math.max(0, (rowH - spec.h) / 2) + spec.h / 2)
      })
    }
  }

  // ---- 2. 管线连线 ----
  const connections: LayoutConn[] = []
  const connByPipeCode = new Map<string, LayoutConn>()
  pipes.forEach((p) => {
    const from = p.fromEquipment ? shapeByCode.get(p.fromEquipment) : undefined
    const to = p.toEquipment ? shapeByCode.get(p.toEquipment) : undefined
    if (!from || !to || from.id === to.id) return
    const fc = centerOf(from)
    const tc = centerOf(to)
    const dx = tc.x - fc.x
    const dy = tc.y - fc.y
    let fromAnchor: Anchor
    let toAnchor: Anchor
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) { fromAnchor = 'right'; toAnchor = 'left' } else { fromAnchor = 'left'; toAnchor = 'right' }
    } else {
      if (dy >= 0) { fromAnchor = 'bottom'; toAnchor = 'top' } else { fromAnchor = 'top'; toAnchor = 'bottom' }
    }
    const conn: LayoutConn = {
      id: `c-p${p.id}`,
      fromShape: from.id,
      fromAnchor,
      toShape: to.id,
      toAnchor,
      direction: 'forward',
      pipelineId: p.id,
    }
    connections.push(conn)
    connByPipeCode.set(p.code, conn)
  })

  // ---- 3. 隔离点挂标 ----
  const marks: LayoutMark[] = []
  const perPipeCount = new Map<string, number>()
  let orphanIdx = 0
  for (const pt of points) {
    const conn = pt.pipelineCode ? connByPipeCode.get(pt.pipelineCode) : undefined
    if (conn) {
      const from = shapes.find((s) => s.id === conn.fromShape)
      const to = shapes.find((s) => s.id === conn.toShape)
      if (from && to) {
        const a = anchorPoint(from, conn.fromAnchor)
        const b = anchorPoint(to, conn.toAnchor)
        const idx = perPipeCount.get(pt.pipelineCode!) ?? 0
        perPipeCount.set(pt.pipelineCode!, idx + 1)
        marks.push({
          id: `m-p${pt.id}`,
          masterPointId: pt.id,
          code: pt.code,
          name: pt.name,
          x: Math.round(clamp((a.x + b.x) / 2 + idx * 26, 34, CANVAS_W - 34)),
          y: Math.round(clamp((a.y + b.y) / 2 - 26 - idx * 22, 20, CANVAS_H - 30)),
        })
        continue
      }
    }
    // 无所属连线：画布底部均布
    marks.push({
      id: `m-p${pt.id}`,
      masterPointId: pt.id,
      code: pt.code,
      name: pt.name,
      x: Math.round(40 + (orphanIdx % 12) * ((CANVAS_W - 80) / 11)),
      y: Math.round(CANVAS_H - 24 - Math.floor(orphanIdx / 12) * 26),
    })
    orphanIdx++
  }

  return { shapes, connections, marks }
}
