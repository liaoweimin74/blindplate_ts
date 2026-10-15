// ============ 文档级操作（批量删除等）—— 一级原语 ============
// 批量删除不是「filter 一下」：需级联清理连线（端点悬空非法）、
// 挂接引用（attach.to 悬空非法），返回可回滚的完整新文档。

import type { DiagramDoc, EdgeGeom, NodeGeom } from './types'
import { pruneOrphanAttach } from './attach'

export interface DeleteResult<N extends NodeGeom = NodeGeom> {
  doc: DiagramDoc<N, EdgeGeom>
  /** 实际删除的节点 id（含被级联处理的引用清理） */
  removedIds: string[]
  /** 因端点被删而级联删除的连线 id */
  removedConnIds: string[]
}

/**
 * 批量删除节点：级联删除「两端任一端点在删除集内」的连线，
 * 并清理存活节点上指向被删节点的挂接引用。
 * 不删除 marks（mark 独立选择/删除，吸附语义由宿主决定）。
 */
export function deleteShapes<N extends NodeGeom>(
  doc: DiagramDoc<N, EdgeGeom>,
  shapeIds: string[],
): DeleteResult<N> {
  const idSet = new Set(shapeIds)
  const removedConnIds: string[] = []
  const connections = doc.connections.filter((c) => {
    const dead = idSet.has(c.fromShape) || idSet.has(c.toShape)
    if (dead) removedConnIds.push(c.id)
    return !dead
  })
  const removedIds = doc.shapes.filter((n) => idSet.has(n.id)).map((n) => n.id)
  const shapes = pruneOrphanAttach(doc.shapes.filter((n) => !idSet.has(n.id)))
  return {
    doc: { ...doc, shapes, connections },
    removedIds,
    removedConnIds,
  }
}

/** 平移一组节点（拖拽/对齐/布局落定的通用执行器；不改动其他字段） */
export function translateShapes<N extends NodeGeom>(
  doc: DiagramDoc<N, EdgeGeom>,
  patches: { id: string; x: number; y: number }[],
): DiagramDoc<N, EdgeGeom> {
  if (patches.length === 0) return doc
  const patchById = new Map(patches.map((p) => [p.id, p]))
  return {
    ...doc,
    shapes: doc.shapes.map((n) => {
      const p = patchById.get(n.id)
      return p ? { ...n, x: p.x, y: p.y } : n
    }),
  }
}
