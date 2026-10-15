// ============ 二级·数据绑定机制（只提供机制，具体数据由三级注入） ============
// 三级抽象定位：绑定 = 「图元字段 ↔ 业务主数据值」的值引用。机制层只管：
//   登记(bind) / 解除(unbind) / 解析(resolve) / 按图元列举(listFor) / 变更通知(subscribe)。
// 值的语义、来源系统（设备台账/管线台账）、编辑器 UI 全部由三级实现 —— 换域零改动。

export type BindTargetKind = 'node' | 'conn' | 'mark'

/** 绑定键：定位到某个图元实例的某个字段（如 node:dev-1:deviceCode） */
export interface BindingKey {
  kind: BindTargetKind
  id: string
  field: string
}

/** 复合键序列化（Map 索引用） */
export function bindingKeyOf(kind: BindTargetKind, id: string, field: string): string {
  return `${kind}:${id}:${field}`
}

export function parseBindingKey(key: string): BindingKey | null {
  const i = key.indexOf(':')
  const j = key.indexOf(':', i + 1)
  if (i < 0 || j < 0) return null
  const kind = key.slice(0, i) as BindTargetKind
  if (kind !== 'node' && kind !== 'conn' && kind !== 'mark') return null
  return { kind, id: key.slice(i + 1, j), field: key.slice(j + 1) }
}

/** 绑定记录：value 由三级解释；source 标记来源系统/主数据路径（机制层透传） */
export interface Binding<V = string> {
  key: BindingKey
  value: V
  source?: string
  updatedAt: number
}

export type BindingListener = (change: {
  type: 'bind' | 'unbind'
  key: BindingKey
}) => void

/** 绑定仓库：机制层核心。实例化一次挂在宿主，画布/属性面板/图元库共享 */
export class BindingStore<V = string> {
  private map = new Map<string, Binding<V>>()
  private listeners = new Set<BindingListener>()

  bind(key: BindingKey, value: V, source?: string): Binding<V> {
    const rec: Binding<V> = { key, value, source, updatedAt: Date.now() }
    this.map.set(bindingKeyOf(key.kind, key.id, key.field), rec)
    this.emit({ type: 'bind', key })
    return rec
  }

  unbind(key: BindingKey): boolean {
    const k = bindingKeyOf(key.kind, key.id, key.field)
    const existed = this.map.delete(k)
    if (existed) this.emit({ type: 'unbind', key })
    return existed
  }

  /** 解析绑定值；缺失返回 undefined（宿主决定兜底展示） */
  resolve(key: BindingKey): V | undefined {
    return this.map.get(bindingKeyOf(key.kind, key.id, key.field))?.value
  }

  /** 图元实例上全部绑定（属性面板「数据绑定」区渲染用） */
  listFor(kind: BindTargetKind, id: string): Binding<V>[] {
    const prefix = `${kind}:${id}:`
    return [...this.map.values()].filter((b) =>
      bindingKeyOf(b.key.kind, b.key.id, b.key.field).startsWith(prefix),
    )
  }

  /** 图元被删除时级联清理其全部绑定（返回清除数量） */
  purgeTarget(kind: BindTargetKind, id: string): number {
    const dead = [...this.map.keys()].filter((k) => k.startsWith(`${kind}:${id}:`))
    dead.forEach((k) => this.map.delete(k))
    return dead.length
  }

  subscribe(fn: BindingListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(change: { type: 'bind' | 'unbind'; key: BindingKey }) {
    this.listeners.forEach((fn) => fn(change))
  }
}
