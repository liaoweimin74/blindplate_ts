// PID 拓扑推导隔离点位（Task 81）：隔离包络边界图算法
// 纯函数、无 DB/DOM 依赖——derive-isolation 路由（服务端）专用，几何复用 bp-pid-mount
//
// 规则（用户批准：按「隔离包络边界」执行）：
// - 整图主要设备（设备类图元）各自作为隔离包络，对每一条「对外连接」推导 1 个隔离点
// - 对外连接：从设备锚点出发沿连线图展开，穿过内联符号（阀门/仪表/管件）继续延伸，
//   到达另一个设备（或管线盲端）即形成一条对外连接
// - 隔离点位置：优先取靠包络侧最近的「截断阀」的包络侧法兰（阀侧管线段中点）；
//   无截断阀 → 设备接口法兰（首段连线中点）；盲端 → 管线末端向外延伸
// - 阀门类型筛选：仅截断阀（闸/截止/球/蝶/旋塞/针/隔膜，含基础阀门图形）可作隔离边界；
//   止回阀/调节阀/泄放阀/执行机构/仪表/管件一律穿透不设点（不可靠隔离或非切断用途）
// - 连线方向存储与行走方向无关（E 可能是 conn.toShape），路径统一按行走方向记录
//   fromId/fromAnchor → toId/toAnchor，锚点坐标经 mountAnchorPoint（含挂接旋转）解析
import { isMountableShape, mountAnchorPoint, type MountAnchor, type MountShape } from './bp-pid-mount'

export interface DeriveShape extends MountShape {
  label?: string
  equipmentId?: number | null
}

export interface DeriveConn {
  id: string
  fromShape: string
  fromAnchor: MountAnchor
  toShape: string
  toAnchor: MountAnchor
  pipelineId?: number | null
}

export interface DeriveMark {
  id: string
  code?: string
  name?: string
  x: number
  y: number
  masterPointId?: number
}

/** 截断阀标准符号（std/valves.tsx 的 vl-shutoff 子类，7 种）——唯一可作为隔离边界的阀门类型 */
const SHUTOFF_STD = new Set([
  'vl-gate', // 闸阀
  'vl-globe', // 截止阀
  'vl-ball', // 球阀
  'vl-butterfly', // 蝶阀
  'vl-plug', // 旋塞阀
  'vl-needle', // 针型阀
  'vl-diaphragm', // 隔膜阀
])

/** 阀门语义分类（供 LLM 风险提示参考；shutoff/base 之外均不可作隔离边界） */
export function valveKindOf(stdId?: string, type?: string): 'shutoff' | 'check' | 'control' | 'relief' | 'special' | 'actuator' | 'base' | null {
  if (type === 'valve') return 'base' // 基础阀门图形（通用手动阀，按截断阀对待）
  const sid = stdId ?? ''
  if (!sid.startsWith('vl-')) return null
  if (SHUTOFF_STD.has(sid)) return 'shutoff'
  if (sid.startsWith('vl-check-')) return 'check'
  if (sid.startsWith('vl-control-')) return 'control'
  if (sid.startsWith('vl-relief-')) return 'relief'
  if (sid.startsWith('vl-act-')) return 'actuator'
  return 'special'
}

function valveKindName(k: NonNullable<ReturnType<typeof valveKindOf>>): string {
  return k === 'shutoff' ? '截断阀' : k === 'check' ? '止回阀' : k === 'control' ? '调节阀'
    : k === 'relief' ? '泄放阀' : k === 'actuator' ? '执行机构' : k === 'base' ? '阀门' : '特殊阀'
}

/** 工艺设备图元判定（与 generate-master 同口径：设备类型/eq-* 标准符号/自定义图元；阀门管件仪表不算设备） */
export function isEquipmentLike(s: DeriveShape): boolean {
  if (['exchanger', 'reactor', 'column', 'pump', 'tank'].includes(s.type)) return true
  if (s.type === 'std' && typeof s.stdId === 'string' && s.stdId.startsWith('eq-')) return true
  if (s.type === 'symbol') return true
  return false
}

/** 内联符号判定（可穿透节点：阀门/仪表/管件；信号线/管道线类图元除外） */
function isInlineSymbol(s: DeriveShape): boolean {
  if (isEquipmentLike(s)) return false
  return isMountableShape(s)
}

/** 图元 label → 位号提取（与 generate-master 同规则） */
export function tagOf(label: string | undefined): string | null {
  if (!label) return null
  const first = label.trim().split(/\s+/)[0] ?? ''
  return /^[A-Za-z]{1,4}-?\d{1,4}[A-Za-z]?$/.test(first) ? first.toUpperCase() : null
}

export interface DerivedCandidate {
  /** 挂标落点（SVG 坐标） */
  x: number
  y: number
  /** 隔离包络设备（推导目标侧） */
  equipShapeId: string
  equipLabel: string
  equipTag: string | null
  /** 对端设备（直连/穿越后到达；盲端为 null） */
  otherLabel: string | null
  otherTag: string | null
  /** 沿途绑定的管线主数据（首条命中的 pipelineId） */
  pipelineId: number | null
  /** 隔离边界阀门（null = 设备接口法兰/盲端回退） */
  valveShapeId: string | null
  valveLabel: string | null
  valveKind: ReturnType<typeof valveKindOf>
  /** 推导模式：valve=靠截断阀包络侧法兰 | nozzle=设备接口法兰 | dead-end=管线盲端 */
  mode: 'valve' | 'nozzle' | 'dead-end'
  /** 供 LLM 语义分析的路径摘要 */
  pathDesc: string
}

interface AdjEntry {
  conn: DeriveConn
  myAnchor: MountAnchor
  otherId: string
  otherAnchor: MountAnchor
}

/** 行走方向路径段：fromId --conn--> toId（锚点为各自行走端在 conn 上的锚点名） */
interface PathSeg {
  fromId: string
  fromAnchor: MountAnchor
  toId: string
  toAnchor: MountAnchor
  conn: DeriveConn
}

const MID = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/**
 * 整图推导：每台设备作为隔离包络，对其每条对外连接产出候选隔离点。
 * 邻接表 + DFS 穿透内联符号；visited 防环；同一落点重复候选由调用方按距离去重。
 */
export function deriveIsolationCandidates(
  shapes: DeriveShape[],
  connections: DeriveConn[],
): DerivedCandidate[] {
  const shapeById = new Map(shapes.map((s) => [s.id, s]))
  const adj = new Map<string, AdjEntry[]>()
  const push = (id: string, e: AdjEntry) => {
    if (!adj.has(id)) adj.set(id, [])
    adj.get(id)!.push(e)
  }
  for (const c of connections) {
    push(c.fromShape, { conn: c, myAnchor: c.fromAnchor, otherId: c.toShape, otherAnchor: c.toAnchor })
    push(c.toShape, { conn: c, myAnchor: c.toAnchor, otherId: c.fromShape, otherAnchor: c.fromAnchor })
  }

  const candidates: DerivedCandidate[] = []
  const kindOf = (s: DeriveShape | undefined) => (s ? valveKindOf(s.stdId, s.type) : null)
  /** 可作隔离边界的阀门（截断阀/基础阀门图形） */
  const isBoundaryValve = (s: DeriveShape | undefined) => {
    const k = kindOf(s)
    return k === 'shutoff' || k === 'base'
  }

  for (const E of shapes.filter(isEquipmentLike)) {
    const entries = adj.get(E.id) ?? []

    const emit = (path: PathSeg[], terminal: DeriveShape | null) => {
      if (path.length === 0) return
      // 沿途管线取首条绑定值
      const pipelineId = path.find((p) => p.conn.pipelineId != null)?.conn.pipelineId ?? null
      // 靠包络侧最近截断阀：按行走顺序找第一个边界阀节点（path[i].toId）
      let valveIdx = path.findIndex((p) => isBoundaryValve(shapeById.get(p.toId)))

      let pos: { x: number; y: number }
      let mode: DerivedCandidate['mode']
      if (valveIdx >= 0) {
        // 阀的包络侧法兰：该段连线两端锚点中点（阀端与包络侧相邻节点端）
        const seg = path[valveIdx]
        pos = MID(
          mountAnchorPoint(shapeById.get(seg.fromId)!, seg.fromAnchor),
          mountAnchorPoint(shapeById.get(seg.toId)!, seg.toAnchor),
        )
        mode = 'valve'
      } else if (terminal) {
        // 设备接口法兰：首段连线两端锚点中点
        pos = MID(
          mountAnchorPoint(E, path[0].fromAnchor),
          mountAnchorPoint(shapeById.get(path[0].toId)!, path[0].toAnchor),
        )
        mode = 'nozzle'
      } else {
        // 盲端：末端锚点沿末段方向向外延伸
        const last = path[path.length - 1]
        const end = mountAnchorPoint(shapeById.get(last.toId)!, last.toAnchor)
        const prev = mountAnchorPoint(shapeById.get(last.fromId)!, last.fromAnchor)
        const dx = end.x - prev.x
        const dy = end.y - prev.y
        const len = Math.hypot(dx, dy) || 1
        pos = { x: end.x + (dx / len) * 20, y: end.y + (dy / len) * 20 }
        mode = 'dead-end'
      }

      // 路径摘要（供 LLM）：设备 → 途经节点（阀门带类型名）→ …
      const pathNames = [
        E.label || E.id,
        ...path.map((p) => {
          const n = shapeById.get(p.toId)
          if (!n) return '?'
          const k = kindOf(n)
          const base = n.label || n.id
          return k && k !== 'base' ? `${base}(${valveKindName(k)})` : base
        }),
      ]
      const valveShape = valveIdx >= 0 ? shapeById.get(path[valveIdx].toId) : undefined
      candidates.push({
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        equipShapeId: E.id,
        equipLabel: E.label || E.id,
        equipTag: tagOf(E.label),
        otherLabel: terminal ? (terminal.label || terminal.id) : null,
        otherTag: terminal ? tagOf(terminal.label) : null,
        pipelineId,
        valveShapeId: valveShape?.id ?? null,
        valveLabel: valveShape?.label ?? null,
        valveKind: kindOf(valveShape),
        mode,
        pathDesc: pathNames.join(' → '),
      })
    }

    const walk = (curId: string, path: PathSeg[], visited: Set<string>) => {
      const cur = shapeById.get(curId)
      // 到达另一台设备 → 对外连接闭合
      if (cur && isEquipmentLike(cur)) {
        emit(path, cur)
        return
      }
      // 内联符号穿透（visited 防环）
      if (cur && isInlineSymbol(cur) && !visited.has(curId)) {
        visited.add(curId)
        const incoming = path[path.length - 1]
        const nexts = (adj.get(curId) ?? []).filter((e) => e.conn.id !== incoming.conn.id)
        let branched = false
        for (const n of nexts) {
          if (visited.has(n.otherId)) continue
          branched = true
          walk(n.otherId, [...path, { fromId: curId, fromAnchor: n.myAnchor, toId: n.otherId, toAnchor: n.otherAnchor, conn: n.conn }], new Set(visited))
        }
        if (branched) return
        emit(path, null) // 内联符号无其他出路 → 盲端
        return
      }
      emit(path, null) // 悬挂节点/环路死路 → 盲端
    }

    for (const start of entries) {
      walk(
        start.otherId,
        [{ fromId: E.id, fromAnchor: start.myAnchor, toId: start.otherId, toAnchor: start.otherAnchor, conn: start.conn }],
        new Set([E.id]),
      )
    }
  }

  return candidates
}
