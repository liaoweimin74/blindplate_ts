// ============ 二级·图元库面板 headless（框架无关） ============
// 三级抽象定位：图元库管理是「组态领域共性」——多页签（内建/基础/自建）、分组树、
// 折叠展开、按名搜索。本模块只做状态机与过滤管道（零框架零 DOM），
// React/Vue 壳各写薄渲染层消费 getVisibleTree()。

import type { SymbolMeta, SymbolRegistry } from '@/lib/configurator-core'
import { groupTreeOf, searchSymbols } from '@/lib/configurator-core'

/** 图元库页签：一个注册表一个页签（内建库 / 基础图形 / 自建图元） */
export interface LibraryTab {
  id: string
  label: string
  registry: SymbolRegistry
}

export interface LibraryPanelState {
  activeTab: string
  keyword: string
  /** 折叠节点 key：`g:groupId` 或 `g:groupId:s:subId` */
  collapsed: ReadonlySet<string>
}

/** 过滤后的可见树节点（渲染层直接 map 成 DOM） */
export interface VisibleGroupNode {
  groupId: string
  groupLabel: string
  collapsed: boolean
  subgroups: {
    subId: string
    subLabel: string
    collapsed: boolean
    symbols: SymbolMeta[]
  }[]
  /** 未归类到子分组的直属符号 */
  directSymbols: SymbolMeta[]
}

const KEY_G = (g: string) => `g:${g}`
const KEY_S = (g: string, s: string) => `g:${g}:s:${s}`

export interface LibraryPanel {
  getState(): LibraryPanelState
  getActiveTab(): LibraryTab
  /** 切页签（重置搜索与折叠——各页签浏览状态独立语义更直观） */
  setActiveTab(tabId: string): void
  setKeyword(kw: string): void
  toggleGroup(groupId: string): void
  toggleSubgroup(groupId: string, subId: string): void
  /** 搜索命中总数（空态提示与「N 个结果」徽标用） */
  getMatchCount(): number
  /** 过滤 + 折叠后的分组树（搜索态自动展开全部命中路径） */
  getVisibleTree(): VisibleGroupNode[]
}

export function createLibraryPanel(tabs: LibraryTab[]): LibraryPanel {
  if (tabs.length === 0) throw new Error('library panel needs at least one tab')
  let activeTab = tabs[0].id
  let keyword = ''
  const collapsed = new Set<string>()

  const tabOf = (id: string) => tabs.find((t) => t.id === id) ?? tabs[0]
  const searchMode = () => keyword.trim().length > 0

  return {
    getState: () => ({ activeTab, keyword, collapsed }),
    getActiveTab: () => tabOf(activeTab),

    setActiveTab(tabId) {
      if (!tabs.some((t) => t.id === tabId)) return
      activeTab = tabId
      keyword = ''
      collapsed.clear()
    },

    setKeyword(kw) {
      keyword = kw
    },

    toggleGroup(groupId) {
      const k = KEY_G(groupId)
      if (collapsed.has(k)) collapsed.delete(k)
      else collapsed.add(k)
    },

    toggleSubgroup(groupId, subId) {
      const k = KEY_S(groupId, subId)
      if (collapsed.has(k)) collapsed.delete(k)
      else collapsed.add(k)
    },

    getMatchCount() {
      if (!searchMode()) return tabOf(activeTab).registry.symbols.length
      return searchSymbols(tabOf(activeTab).registry, keyword.trim()).length
    },

    getVisibleTree() {
      const tab = tabOf(activeTab)
      const tree = groupTreeOf(tab.registry)
      const searching = searchMode()
      const kw = keyword.trim().toLowerCase()

      return tree.map(({ group, subgroups, looseSymbols }) => {
        const filterBy = (list: SymbolMeta[]) =>
          searching
            ? list.filter(
                (s) =>
                  s.label.toLowerCase().includes(kw) ||
                  s.id.toLowerCase().includes(kw) ||
                  (s.keywords ?? []).some((k) => k.toLowerCase().includes(kw)),
              )
            : list

        const subs = subgroups
          .map(({ id, label, symbols }) => {
            const filtered = filterBy(symbols)
            const isOpen = searching || !collapsed.has(KEY_S(group.id, id))
            return {
              subId: id,
              subLabel: label,
              collapsed: !isOpen,
              symbols: isOpen ? filtered : [],
            }
          })
          .filter((s) => !searching || s.symbols.length > 0)

        const direct = filterBy(looseSymbols)
        const groupOpen = searching || !collapsed.has(KEY_G(group.id))
        return {
          groupId: group.id,
          groupLabel: group.label,
          collapsed: !groupOpen,
          subgroups: groupOpen ? subs : [],
          directSymbols: groupOpen ? direct : [],
        }
      })
    },
  }
}
