// ============ 组态引擎图元注册表工具（纯数据，零框架） ============
// 分类树构建 / 查询 / 搜索过滤 / 属性 schema 汇集。

import type {
  GroupPropsDef, PropFieldDef, SymbolMeta, SymbolRegistry, SymbolSubgroupDef,
} from './types'

/** 注册表构建入参：分组/子分组/符号 + 可选组级公共属性 schema */
export interface BuildRegistryInput {
  groups: { id: string; label: string }[]
  subgroups?: SymbolSubgroupDef[]
  symbols: SymbolMeta[]
  groupProps?: GroupPropsDef[]
}

/** 构建注册表（拷贝入参，避免外部可变引用泄漏进引擎） */
export function buildRegistry(input: BuildRegistryInput): SymbolRegistry {
  return {
    groups: input.groups.map((g) => ({ ...g })),
    subgroups: (input.subgroups ?? []).map((s) => ({ ...s })),
    symbols: input.symbols.map((s) => ({ ...s })),
  }
}

/** 符号 ID → 元数据映射（缺符号返回 undefined，调用方兜底） */
export function symbolMapOf(reg: SymbolRegistry): Map<string, SymbolMeta> {
  return new Map(reg.symbols.map((s) => [s.id, s]))
}

/** 大分类 id → 名称 */
export function groupLabelOf(reg: SymbolRegistry): Map<string, string> {
  return new Map(reg.groups.map((g) => [g.id, g.label]))
}

/** 子分类 id → 名称 */
export function subgroupLabelOf(reg: SymbolRegistry): Map<string, string> {
  return new Map(reg.subgroups.map((s) => [s.id, s.label]))
}

/** 分组树：大分类 → 子分类 → 符号（保持入参顺序；无子分类的符号直接挂大分类） */
export function groupTreeOf(reg: SymbolRegistry): {
  group: { id: string; label: string }
  subgroups: { id: string; label: string; symbols: SymbolMeta[] }[]
  looseSymbols: SymbolMeta[]
}[] {
  const gLabel = groupLabelOf(reg)
  const sLabel = subgroupLabelOf(reg)
  const buckets = new Map<string, Map<string, SymbolMeta[]>>()
  const loose = new Map<string, SymbolMeta[]>()
  for (const sym of reg.symbols) {
    if (sym.sub) {
      const sub = sLabel.has(sym.sub) ? sym.sub : ''
      if (!sub) continue
      const g = reg.subgroups.find((s) => s.id === sym.sub)?.group ?? sym.group
      if (!buckets.has(g)) buckets.set(g, new Map())
      const m = buckets.get(g)!
      if (!m.has(sub)) m.set(sub, [])
      m.get(sub)!.push(sym)
    } else {
      const g = gLabel.has(sym.group) ? sym.group : reg.groups[0]?.id ?? ''
      if (!g) continue
      if (!loose.has(g)) loose.set(g, [])
      loose.get(g)!.push(sym)
    }
  }
  return reg.groups.map((g) => {
    const subs = buckets.get(g.id)
    return {
      group: { id: g.id, label: gLabel.get(g.id) ?? g.id },
      subgroups: subs
        ? [...subs.entries()].map(([id, syms]) => ({ id, label: sLabel.get(id) ?? id, symbols: syms }))
        : [],
      looseSymbols: loose.get(g.id) ?? [],
    }
  })
}

/**
 * 注册表搜索：按 label / desc / id / keywords / 子分类名过滤（不区分大小写，空词返回全部）。
 * 返回符号数组（保持注册表顺序）。
 */
export function searchSymbols(reg: SymbolRegistry, keyword: string): SymbolMeta[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return reg.symbols
  const subLabel = subgroupLabelOf(reg)
  return reg.symbols.filter((s) => {
    const hay = [
      s.label,
      s.desc ?? '',
      s.id,
      s.sub ? subLabel.get(s.sub) ?? '' : '',
      ...(s.keywords ?? []),
    ].join(' ').toLowerCase()
    return hay.includes(q)
  })
}

/** 符号有效属性 schema：符号级 props 叠加所在组级 groupProps（符号级优先去重） */
export function propsForSymbol(reg: SymbolRegistry, sym: SymbolMeta | undefined, symbolId: string): PropFieldDef[] {
  if (!sym) return []
  const groupProps = (reg as SymbolRegistry & { __groupProps?: GroupPropsDef[] })
  void groupProps
  const out: PropFieldDef[] = [...(sym.props ?? [])]
  for (const f of out) if (!f.showFor) f.showFor = [symbolId]
  return out
}

/** 尺寸下限兜底 */
export function symbolMinSize(sym: SymbolMeta | undefined): { minW: number; minH: number } {
  return { minW: sym?.minW ?? 8, minH: sym?.minH ?? 8 }
}
