// ============ 组态引擎撤销/重做栈（文档快照，框架无关） ============
// 泛型快照栈：宿主在每次「提交级」变更（拖拽结束/属性修改落定/增删）时 push，
// undo/redo 返回快照由宿主写回文档状态。深拷贝由调用方决定（JSON 文档建议 structuredClone）。

export interface History<T> {
  /** 提交一个快照（入栈并清空重做分支；超限丢弃最旧） */
  push(snapshot: T): void
  /** 撤销：返回上一个快照；无可撤销返回 null（current 为当前未入栈状态，入栈时机由宿主控制） */
  undo(current: T): T | null
  /** 重做：返回下一个快照；无可重做返回 null */
  redo(current: T): T | null
  canUndo(): boolean
  canRedo(): boolean
  /** 清空全部历史（加载新文档时） */
  clear(): void
  size(): { undo: number; redo: number }
}

export function createHistory<T>(limit = 50): History<T> {
  let past: T[] = []
  let future: T[] = []
  return {
    push(snapshot) {
      past.push(snapshot)
      if (past.length > limit) past.shift()
      future = []
    },
    undo(current) {
      if (past.length === 0) return null
      const prev = past.pop()!
      future.push(current)
      return prev
    },
    redo(current) {
      if (future.length === 0) return null
      const next = future.pop()!
      past.push(current)
      return next
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past = []
      future = []
    },
    size: () => ({ undo: past.length, redo: future.length }),
  }
}
