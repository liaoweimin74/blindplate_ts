// ============ 剪贴板（复制 / 粘贴）—— 纯数据操作，零框架依赖 ============
// 复制：抽取选中节点快照 + 两端都在选中集内的连线（保持剪贴板内部拓扑）。
// 粘贴：全量重映射 id，保留内部连线与挂接关系（挂接父不在复制集时自动断开），
//       偏移量与 id 生成策略由宿主决定 —— core 不碰 DOM / 剪贴板 API / 系统事件。
// 一级定位（三级抽象）：图元批量操作原语，React 壳与 Vue 壳共用同一实现。

import type { DiagramDoc, EdgeGeom, NodeGeom } from './types'
import { uid } from './geometry'

/** 剪贴板快照（JSON 序列化安全：调用方持久化到内存 buffer 或系统剪贴板均可） */
export interface ClipboardData<N extends NodeGeom = NodeGeom> {
  nodes: N[]
  connections: EdgeGeom[]
}

/** 选中节点集 → 剪贴板快照；空选中返回 null（宿主可据此禁用复制菜单项） */
export function copySelection<N extends NodeGeom>(
  doc: Pick<DiagramDoc<N, EdgeGeom>, 'shapes' | 'connections'>,
  shapeIds: string[],
): ClipboardData<N> | null {
  const idSet = new Set(shapeIds)
  const nodes = doc.shapes.filter((n) => idSet.has(n.id))
  if (nodes.length === 0) return null
  const nodeIds = new Set(nodes.map((n) => n.id))
  // 仅保留两端都在选中集内的连线：跨边界连线粘贴后端点悬空，语义上不属于「复制图元」
  const connections = doc.connections.filter(
    (c) => nodeIds.has(c.fromShape) && nodeIds.has(c.toShape),
  )
  // 深拷贝快照：后续对原文档的编辑不影响剪贴板内容
  return JSON.parse(JSON.stringify({ nodes, connections })) as ClipboardData<N>
}

export interface PasteOptions {
  /** 粘贴落点偏移（画布坐标；宿主通常给网格步长或指针位置差） */
  dx: number
  dy: number
  /** 自定义 id 生成器（缺省 uid('n')；业务侧需保留自身 id 风格时传入，如 (old) => uid('s')） */
  newId?: (oldId: string) => string
}

export interface PasteResult<N extends NodeGeom = NodeGeom> {
  nodes: N[]
  connections: EdgeGeom[]
  /** 新 id → 旧 id 映射（宿主据此做业务字段去重/重编号，如 设备位号 +P 后缀） */
  idMap: Map<string, string>
}

/** 剪贴板快照 → 粘贴补丁：id 全部重映射，attach.to 与连线端点同步重映射 */
export function pasteClipboard<N extends NodeGeom>(
  data: ClipboardData<N>,
  opts: PasteOptions,
): PasteResult<N> {
  const newId = opts.newId ?? (() => uid('n'))
  const idMap = new Map<string, string>()
  for (const n of data.nodes) idMap.set(n.id, newId(n.id))

  const nodes = data.nodes.map((n) => {
    const copy: N = {
      ...n,
      id: idMap.get(n.id)!,
      x: n.x + opts.dx,
      y: n.y + opts.dy,
    }
    // 挂接重映射：父体在复制集内 → 指向新父体；父体不在 → 断开挂接（悬空引用非法）
    if (copy.attach) {
      const mapped = idMap.get(copy.attach.to)
      if (mapped) copy.attach = { ...copy.attach, to: mapped }
      else delete copy.attach
    }
    return copy
  })

  const connections = data.connections.map((c) => ({
    ...c,
    id: uid('c'),
    fromShape: idMap.get(c.fromShape)!,
    toShape: idMap.get(c.toShape)!,
  }))

  return { nodes, connections, idMap }
}

/** 剪贴板内容包围盒（粘贴对齐/找空位用） */
export function clipboardBounds<N extends NodeGeom>(
  data: ClipboardData<N>,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (data.nodes.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const n of data.nodes) {
    x0 = Math.min(x0, n.x)
    y0 = Math.min(y0, n.y)
    x1 = Math.max(x1, n.x + n.w)
    y1 = Math.max(y1, n.y + n.h)
  }
  return { x0, y0, x1, y1 }
}
