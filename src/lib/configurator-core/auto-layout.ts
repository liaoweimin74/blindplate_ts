// ============ 组态引擎自动布局（Sugiyama 简化版，纯函数） ============
// 1. 有连线节点按有效流向（缺省/forward=起点→终点，reverse 反向）DFS 破环后最长路分层，
//    列内重心排序 4 轮扫掠减少连线交叉，自左向右排列；
// 2. 未连线节点在流程区下方按阅读顺序（先上后下、先左后右）网格排列；
// 3. 连线锚点按布局后两节点相对方位自动改选（水平占优→right/left，垂直占优→bottom/top），
//    midOverride 与自由锚点 t 清零交由自动折弯重排；
// 4. 布局前挂在连线附近（≤ MARK_FOLLOW_DIST）的标注记录「所在连线 + 弧长参数 t」，
//    布局后重投影到该连线新路径的相同相对位置（沿线语义不变）；
// 5. 布局原点取当前节点包围盒左上角——整图在原视口邻域重排，不发生跳位。

import type { Anchor, DiagramDoc, EdgeGeom, MarkGeom, NodeGeom } from './types'
import { anchorPoint, anchorPointT, physAnchor, routeConnection } from './geometry'
import { clamp, pointAlongPolyline, projectToPolyline } from './geometry'

/** 自动布局列间距（SVG 单位）：为正交折线拐弯与边标签预留空间 */
const LAYOUT_GAP_X = 130
/** 自动布局行间距 */
const LAYOUT_GAP_Y = 64
/** 标注跟随阈值：布局前标注中心到最近连线折线的距离 ≤ 该值才视为挂在该连线上 */
const LAYOUT_MARK_FOLLOW_DIST = 260

export function autoLayout<
  N extends NodeGeom,
  E extends EdgeGeom,
  M extends MarkGeom,
>(ct: DiagramDoc<N, E, M>): DiagramDoc<N, E, M> {
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

  // ---- 5. 未连线节点：流程区下方网格（阅读顺序：先上后下、先左后右） ----
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
  const routeOf = (c: E, useNew: boolean): [number, number][] | null => {
    const f = byId.get(c.fromShape)
    const t = byId.get(c.toShape)
    if (!f || !t) return null
    const fp = useNew ? pos.get(c.fromShape) : f
    const tp = useNew ? pos.get(c.toShape) : t
    if (!fp || !tp) return null
    const fa = useNew ? (newAnchors.get(c.id)?.[0] ?? c.fromAnchor) : c.fromAnchor
    const ta = useNew ? (newAnchors.get(c.id)?.[1] ?? c.toAnchor) : c.toAnchor
    const fs = { ...f, x: fp.x, y: fp.y }
    const ts = { ...t, x: tp.x, y: tp.y }
    const a = useNew ? anchorPoint(fs, fa) : anchorPointT(fs, c.fromAnchor, c.fromT)
    const b = useNew ? anchorPoint(ts, ta) : anchorPointT(ts, c.toAnchor, c.toT)
    return routeConnection(
      { x: a.x, y: a.y, anchor: physAnchor(fs, fa) },
      { x: b.x, y: b.y, anchor: physAnchor(ts, ta) },
      c.fromShape === c.toShape,
      useNew ? undefined : c.midOverride,
    )
  }

  // ---- 8. 标注跟随：布局前找最近连线记录「所在连线+弧长参数 t」，布局后重投影到新路径同位（clamp 两端 4% 不压节点） ----
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

  const newConns: E[] = ct.connections.map((c) => {
    const an = newAnchors.get(c.id)
    if (!an) return c.fromShape === c.toShape ? { ...c, midOverride: undefined } : c
    // 锚点按布局后相对方位改选：原自由锚点沿边参数失效，一并清零回中点
    return { ...c, fromAnchor: an[0], toAnchor: an[1], fromT: undefined, toT: undefined, midOverride: undefined }
  })

  const newMarks: M[] = ct.marks.map((m) => {
    const f = follow.get(m.id)
    if (!f) return m
    const c = newConns.find((cc) => cc.id === f.connId)
    const pts = c ? routeOf(c, true) : null
    const pt = pts ? pointAlongPolyline(pts, clamp(f.t, 0.04, 0.96)) : null
    return pt ? { ...m, x: Math.round(pt.x), y: Math.round(pt.y) } : m
  })

  const newShapes: N[] = shapes.map((s) => {
    const p = pos.get(s.id)
    return p ? { ...s, x: p.x, y: p.y } : s
  })
  return { shapes: newShapes, connections: newConns, marks: newMarks }
}
