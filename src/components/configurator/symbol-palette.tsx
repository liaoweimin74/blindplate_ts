'use client'
// ============ 组态引擎 React 适配层 · 图元库面板（注册表驱动） ============
// SymbolPalette：注册表（分类树+符号元数据）驱动的图元选择侧栏。
// 业务无关：分类与图形由宿主通过 registry 注入；缩略图由宿主渲染器（renderThumb）提供；
// 点击符号回调 onPick（宿主决定进入放置模式 / 更换图形等语义）。
// 多注册表页签（如「内建图元 / 基础图形 / 自定义图元」）由宿主用 PaletteTabs 组合。

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  groupTreeOf, searchSymbols,
  type SymbolMeta, type SymbolRegistry,
} from '@/lib/configurator-core'

/** 手风琴分组节（本引擎与更换图元对话框共用）：stack=true 时内容单列堆叠（如嵌套子分类），否则三列宫格 */
export function PaletteGroup({ label, count, open, onToggle, nested, stack, children }: {
  label: string
  count: number
  open: boolean
  onToggle: () => void
  nested?: boolean
  stack?: boolean
  children: ReactNode
}) {
  return (
    <section className={cn('mb-1', nested && 'ml-2.5 border-l border-dashed border-stone-200 pl-1.5')}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`展开或折叠分类：${label}`}
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-1 rounded-md font-medium transition-colors',
          nested ? 'px-1 py-1 text-[10px]' : 'px-1.5 py-1.5 text-[11px]',
          open ? 'text-teal-800' : 'text-stone-500 hover:bg-stone-50',
        )}
      >
        <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform duration-200', !open && '-rotate-90')} />
        <span className="truncate">{label}</span>
        <span className="ml-auto shrink-0 rounded-full bg-stone-100 px-1.5 text-[10px] font-normal text-stone-400">{count}</span>
      </button>
      {open && <div className={stack ? 'lib-expand px-0.5 pb-1.5' : 'lib-expand grid grid-cols-3 gap-1.5 px-0.5 pb-1.5'}>{children}</div>}
    </section>
  )
}

/** 图元宫格单元（缩略图 + 名称；悬停信息由 onEnter 写入外部或内部卡片；action = 右上角业务操作钮） */
export function PaletteCell({ sym, active, onPick, onEnter, onLeave, thumb, action }: {
  sym: SymbolMeta
  active: boolean
  onPick: () => void
  onEnter: (e: React.MouseEvent<HTMLDivElement>) => void
  onLeave: () => void
  thumb: (sym: SymbolMeta) => ReactNode
  /** 宫格右上角业务操作钮（如编辑/删除自定义图元；group-hover 显隐由宿主控制） */
  action?: ReactNode
}) {
  return (
    <div
      className={cn(
        'group relative rounded-md border p-1 transition-colors',
        active ? 'border-teal-400 bg-teal-50' : 'border-stone-200 hover:border-teal-300 hover:bg-stone-50',
      )}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button type="button" aria-label={`放置${sym.label}`} onClick={onPick} className="flex h-14 w-full items-center justify-center">
        {thumb(sym)}
      </button>
      <div className="truncate px-0.5 pb-0.5 text-center text-[10px] leading-tight text-stone-500">{sym.label}</div>
      {action}
    </div>
  )
}

/** 悬停信息卡（fixed 定位，不受侧栏滚动裁剪） */
export interface PaletteHoverCard {
  title: string
  lines: string[]
  x: number
  y: number
}

export interface PaletteTabDef {
  id: string
  label: string
  registry: SymbolRegistry
}

/**
 * 单注册表图元库面板：
 * - 大分类 → 子分类两级手风琴（无子分类符号直接挂大分类宫格）
 * - 搜索框：非空时平铺展示全部命中（自动展开）
 * - 悬停信息卡：符号说明 / 标准依据 / 默认尺寸
 */
export function SymbolPalette({ registry, renderThumb, onPick, activeSymbolId, searchPlaceholder, cellAction, className }: {
  registry: SymbolRegistry
  renderThumb: (sym: SymbolMeta) => ReactNode
  onPick: (sym: SymbolMeta) => void
  /** 当前放置中的符号 id（宫格高亮） */
  activeSymbolId?: string | null
  searchPlaceholder?: string
  /** 宫格右上角业务操作钮（自定义图元编辑/删除等） */
  cellAction?: (sym: SymbolMeta) => ReactNode
  className?: string
}) {
  const [kw, setKw] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [hover, setHover] = useState<PaletteHoverCard | null>(null)

  const toggleGroup = (key: string) => setOpenGroups((m) => ({ ...m, [key]: !m[key] }))
  const tree = useMemo(() => groupTreeOf(registry), [registry])
  const searching = kw.trim().length > 0
  const hits = useMemo(() => (searching ? searchSymbols(registry, kw) : []), [registry, kw, searching])

  const enterCard = (sym: SymbolMeta) => (e: React.MouseEvent<HTMLDivElement>) => {
    const lines: string[] = []
    if (sym.desc) lines.push(sym.desc)
    if (sym.standard) lines.push(`标准：${sym.standard}`)
    lines.push(`默认尺寸 ${sym.defaultW}×${sym.defaultH}`)
    setHover({ title: sym.label, lines, x: e.clientX, y: e.clientY })
  }

  if (searching) {
    if (hits.length === 0) {
      return (
        <div className={cn('px-2 py-8 text-center text-xs text-stone-400', className)}>
          没有匹配「{kw.trim()}」的图元
        </div>
      )
    }
    return (
      <div className={cn('px-1 pb-2', className)}>
        <div className="grid grid-cols-3 gap-1.5 p-0.5">
          {hits.map((sym) => (
            <PaletteCell key={sym.id} sym={sym} active={activeSymbolId === sym.id} onPick={() => onPick(sym)} onEnter={enterCard(sym)} onLeave={() => setHover(null)} thumb={renderThumb} action={cellAction?.(sym)} />
          ))}
        </div>
        <HoverTip hover={hover} />
      </div>
    )
  }

  return (
    <div className={cn('px-1 pb-2', className)}>
      {tree.map(({ group, subgroups, looseSymbols }) => {
        const total = looseSymbols.length + subgroups.reduce((s, x) => s + x.symbols.length, 0)
        if (total === 0) return null
        const gOpen = openGroups[`g-${group.id}`] ?? group.id === tree[0]?.group.id
        const hasSubs = subgroups.length > 0
        return (
          <PaletteGroup key={group.id} label={group.label} count={total} open={gOpen} onToggle={() => toggleGroup(`g-${group.id}`)} stack={hasSubs}>
            {gOpen && (
              <>
                {subgroups.map((sub) => {
                  const sOpen = openGroups[`s-${sub.id}`] ?? true
                  return (
                    <PaletteGroup key={sub.id} nested label={sub.label} count={sub.symbols.length} open={sOpen} onToggle={() => toggleGroup(`s-${sub.id}`)}>
                      {sub.symbols.map((sym) => (
                        <PaletteCell key={sym.id} sym={sym} active={activeSymbolId === sym.id} onPick={() => onPick(sym)} onEnter={enterCard(sym)} onLeave={() => setHover(null)} thumb={renderThumb} action={cellAction?.(sym)} />
                      ))}
                    </PaletteGroup>
                  )
                })}
                {looseSymbols.length > 0 && (
                  <div className={hasSubs ? 'grid grid-cols-3 gap-1.5' : undefined}>
                    {looseSymbols.map((sym) => (
                      <PaletteCell key={sym.id} sym={sym} active={activeSymbolId === sym.id} onPick={() => onPick(sym)} onEnter={enterCard(sym)} onLeave={() => setHover(null)} thumb={renderThumb} action={cellAction?.(sym)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </PaletteGroup>
        )
      })}
      <HoverTip hover={hover} />
    </div>
  )
}

/** 悬停信息卡渲染（fixed 定位） */
export function HoverTip({ hover }: { hover: PaletteHoverCard | null }) {
  if (!hover) return null
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-56 rounded-md border border-stone-200 bg-white px-2.5 py-2 text-[11px] leading-relaxed text-stone-600 shadow-lg"
      style={{ left: Math.min(hover.x + 14, window.innerWidth - 240), top: hover.y + 12 }}
      role="tooltip"
    >
      <div className="mb-0.5 font-medium text-stone-800">{hover.title}</div>
      {hover.lines.map((l, i) => (
        <div key={i} className="text-stone-500">{l}</div>
      ))}
    </div>
  )
}

/** 搜索框（页签内容顶部，宿主放入自己的页签容器） */
export function PaletteSearch({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative px-2 pb-1.5 pt-1">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-300" />
      <Input
        className="h-8 border-stone-200 bg-stone-50 pl-8 text-xs" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '搜索图元…'}
        aria-label="搜索图元"
      />
    </div>
  )
}
