// ============ 挂接跟随（attach）—— 业务附属关系的几何执行器 ============
// 分层契约：三级业务声明「谁挂在谁身上」（仪表/泵 附属于 管线、标注 附属于 设备），
// 二级提供关系转译协议，本模块只执行几何后果 —— 父体平移时子体按相对偏移跟随。
// 级联跟随（子挂子）自动收敛；不处理父体缩放（比例/边缘吸附策略留待业务需要时扩展）。
// 一级定位：与业务无关的通用原语，React 壳与 Vue 壳共用。

import type { NodeGeom } from './types'
import type { PosPatch } from './canvas-controller'

/** 绑定挂接：以 parent 当前位置计算相对偏移（调用方负责把返回副本写回文档） */
export function bindAttach<N extends NodeGeom>(node: N, parent: N): N {
  return {
    ...node,
    attach: { to: parent.id, dx: node.x - parent.x, dy: node.y - parent.y },
  }
}

/** 解除挂接（返回去掉 attach 的副本；原节点不变） */
export function unbindAttach<N extends NodeGeom>(node: N): N {
  if (!node.attach) return node
  const copy = { ...node }
  delete copy.attach
  return copy
}

/** 某节点的所有直接子体（挂接在它身上的节点） */
export function attachChildrenOf<N extends NodeGeom>(nodes: N[], parentId: string): N[] {
  return nodes.filter((n) => n.attach?.to === parentId)
}

/** 节点是否挂接在指定节点（含间接）之下 —— 删除/移动约束检查用 */
export function isAttachedTo<N extends NodeGeom>(
  nodes: N[],
  nodeId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let cur = byId.get(nodeId)
  const seen = new Set<string>()
  while (cur?.attach) {
    if (cur.attach.to === ancestorId) return true
    if (seen.has(cur.id)) return false // 环引用防御
    seen.add(cur.id)
    cur = byId.get(cur.attach.to)
  }
  return false
}

/**
 * 挂接跟随：给定本轮已移动节点的位移向量，返回所有直接/间接子体的位置补丁。
 * @param nodes      当前文档节点（位置为本轮移动后的状态）
 * @param movedDeltas 已移动节点 id → 位移 (dx,dy)（含被拖动的父体；拖拽中间态也可用，
 *                    壳层每帧传入增量即可让子体实时跟随）
 * @returns 子体位置补丁（不含已移动的父体本身；调用方按 id 合并进文档）
 */
export function applyAttachFollowing<N extends NodeGeom>(
  nodes: N[],
  movedDeltas: Map<string, { dx: number; dy: number }>,
): PosPatch[] {
  const patches: PosPatch[] = []
  const deltaById = new Map(movedDeltas)
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // 工作队列扩散：子体继承父体 delta 后继续向孙体传播，直至无新节点（深度有限，天然收敛）
  const queue = [...deltaById.keys()]
  while (queue.length > 0) {
    const pid = queue.shift()!
    const d = deltaById.get(pid)!
    if (d.dx === 0 && d.dy === 0) continue
    for (const child of nodes) {
      if (!child.attach || child.attach.to !== pid) continue
      const prev = deltaById.get(child.id)
      if (prev) continue // 已在移动集合中（自身被拖动或已跟随过），不再叠加
      const cd = { dx: d.dx, dy: d.dy }
      deltaById.set(child.id, cd)
      queue.push(child.id)
      const cur = byId.get(child.id)
      if (cur) patches.push({ id: child.id, x: cur.x + cd.dx, y: cur.y + cd.dy })
    }
  }
  return patches
}

/** 清理悬空挂接：attach.to 指向的节点不存在时移除该引用（删除父体后调用） */
export function pruneOrphanAttach<N extends NodeGeom>(nodes: N[]): N[] {
  const ids = new Set(nodes.map((n) => n.id))
  return nodes.map((n) => {
    if (n.attach && !ids.has(n.attach.to)) return unbindAttach(n)
    return n
  })
}
