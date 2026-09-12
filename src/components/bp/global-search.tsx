'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, fmtDate } from '@/lib/bp-api'
import {
  PLATE_STATUS_MAP, SCHEME_STATUS_MAP, STATUS_MAP, TASK_STATUS_MAP, TICKET_STATUS_MAP,
} from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import {
  Search, FileText, TicketCheck, ListChecks, ShieldCheck, FlaskConical, Database,
  Loader2, SearchX, CornerDownLeft,
} from 'lucide-react'

interface SearchItem {
  id: number
  code: string
  title: string
  status: string | null
  createdAt: string
  extra: string | null
  module: string
  tab: string
}

type GroupKey = 'requests' | 'tickets' | 'tasks' | 'isolation' | 'disposal' | 'plates'
interface SearchResp { keyword: string; groups: Record<GroupKey, SearchItem[]> }
type StatusClsMap = Record<string, { label: string; className: string }>

/** 分组定义：顺序即渲染顺序，statusMap 与项目内 BADGE 约定一致 */
const GROUPS: { key: GroupKey; label: string; icon: React.ComponentType<{ className?: string }>; statusMap: StatusClsMap }[] = [
  { key: 'requests', label: '作业需求', icon: FileText, statusMap: STATUS_MAP },
  { key: 'tickets', label: '作业票', icon: TicketCheck, statusMap: TICKET_STATUS_MAP },
  { key: 'tasks', label: '作业任务', icon: ListChecks, statusMap: TASK_STATUS_MAP },
  { key: 'isolation', label: '隔离方案', icon: ShieldCheck, statusMap: SCHEME_STATUS_MAP },
  { key: 'disposal', label: '工艺处置方案', icon: FlaskConical, statusMap: SCHEME_STATUS_MAP },
  { key: 'plates', label: '盲板档案', icon: Database, statusMap: PLATE_STATUS_MAP },
]

const EMPTY_GROUPS: Record<GroupKey, SearchItem[]> = {
  requests: [], tickets: [], tasks: [], isolation: [], disposal: [], plates: [],
}

interface Props {
  onNavigate?: (key: string, tab?: string, focusId?: number) => void
}

/** 顶栏全局搜索：需求/作业票/任务/双方案/盲板档案 聚合检索（/api/search） */
export default function GlobalSearch({ onNavigate }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [groups, setGroups] = useState<Record<GroupKey, SearchItem[]> | null>(null)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef(0)

  // 点击外部关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Ctrl/Cmd+K 聚焦、Escape 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const doSearch = useCallback(async (keyword: string) => {
    const kw = keyword.trim()
    const seq = ++seqRef.current
    setSearching(true)
    try {
      const res = await apiGet<SearchResp>(`/api/search?keyword=${encodeURIComponent(kw)}`)
      if (seqRef.current !== seq) return // 过期响应丢弃
      const g = res?.groups
      setGroups({
        requests: Array.isArray(g?.requests) ? g!.requests : [],
        tickets: Array.isArray(g?.tickets) ? g!.tickets : [],
        tasks: Array.isArray(g?.tasks) ? g!.tasks : [],
        isolation: Array.isArray(g?.isolation) ? g!.isolation : [],
        disposal: Array.isArray(g?.disposal) ? g!.disposal : [],
        plates: Array.isArray(g?.plates) ? g!.plates : [],
      })
      setActive(-1)
      setOpen(true)
    } catch { /* 静默：保留上次结果 */ } finally {
      if (seqRef.current === seq) setSearching(false)
    }
  }, [])

  // 防抖 350ms
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const kw = q.trim()
    if (kw.length < 2) {
      setGroups(null); setSearching(false); setOpen(false); setActive(-1)
      return
    }
    setSearching(true)
    setOpen(true)
    timerRef.current = setTimeout(() => doSearch(q), 350)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [q, doSearch])

  // 展平结果供键盘导航（含稳定索引）
  const flat = useMemo(() => {
    if (!groups) return []
    return GROUPS.flatMap((g) => (groups[g.key] ?? []).map((item) => ({ item, group: g })))
  }, [groups])

  // 条目 → 展平索引映射，渲染高亮与 data-idx 用
  const idxOf = useMemo(() => {
    const m = new Map<SearchItem, number>()
    flat.forEach((f, i) => m.set(f.item, i))
    return m
  }, [flat])

  const total = flat.length
  const noResult = q.trim().length >= 2 && !searching && groups !== null && total === 0

  // 键盘高亮项滚动到可视区
  useEffect(() => {
    if (active < 0) return
    boxRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = (item: SearchItem) => {
    setOpen(false); setQ(''); setActive(-1)
    onNavigate?.(item.module, item.tab, item.id)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { if (total > 0) { setOpen(true); setActive(0) } else setOpen(true) }
      else setActive((a) => Math.min(a + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      const sel = flat[active >= 0 && active < total ? active : 0]
      if (sel) { e.preventDefault(); go(sel.item) }
    }
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-[300px] md:max-w-[340px]">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (total > 0 || noResult || searching) setOpen(true) }}
          onKeyDown={onInputKeyDown}
          placeholder="搜索需求 / 票 / 任务 / 方案编号…"
          role="combobox"
          aria-expanded={open && (total > 0 || noResult || searching)}
          aria-label="全局搜索"
          aria-controls="global-search-panel"
          className="w-full h-9 rounded-lg border border-stone-200 bg-stone-50 pl-8 pr-14 text-[13px] outline-none transition-all focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 placeholder:text-stone-400"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
          {searching ? <Loader2 className="w-3.5 h-3.5 text-emerald-600 animate-spin" /> : (
            <kbd className="hidden md:flex items-center gap-0.5 text-[10px] text-stone-400 border border-stone-200 rounded px-1 py-0.5 bg-white">
              <CornerDownLeft className="w-2.5 h-2.5" />K
            </kbd>
          )}
        </div>
      </div>

      {open && (total > 0 || noResult || (searching && q.trim().length >= 2)) && (
        <div id="global-search-panel" role="listbox" aria-label="搜索结果"
          className="absolute z-50 mt-1.5 w-[380px] max-w-[90vw] left-0 md:left-auto md:right-0 rounded-xl border border-stone-200 bg-white shadow-xl overflow-hidden">
          {noResult ? (
            <div className="py-8 flex flex-col items-center gap-1.5 text-stone-400">
              <SearchX className="w-6 h-6" />
              <span className="text-xs">未找到与「{q.trim()}」相关的单据或档案</span>
              <span className="text-[10px] text-stone-300">可尝试需求 / 票 / 任务 / 方案 / 盲板编号或标题关键词</span>
            </div>
          ) : searching && total === 0 ? (
            <div className="p-3 space-y-2.5" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-2.5 rounded bg-stone-100 animate-pulse" style={{ width: `${56 + (i % 3) * 12}px` }} />
                  <div className="h-9 rounded-lg bg-stone-50 border border-stone-100 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                </div>
              ))}
              <div className="text-center text-[10px] text-stone-300 pt-1">正在检索需求 / 票 / 任务 / 方案 / 盲板…</div>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              {GROUPS.map((g, gi) => {
                const items = groups?.[g.key] ?? []
                if (items.length === 0) return null
                const GIcon = g.icon
                return (
                  <div key={g.key} className={cn(gi > 0 && 'border-t border-stone-100')}>
                    <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5">
                      <GIcon className="w-3 h-3 text-stone-400" />
                      <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{g.label}</span>
                      <span className="text-[10px] leading-none font-mono px-1.5 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-stone-500">
                        {items.length}
                      </span>
                    </div>
                    {items.map((item) => {
                      const idx = idxOf.get(item) ?? -1
                      const st = item.status ? g.statusMap[item.status] : undefined
                      const isActive = idx === active
                      return (
                        <button key={`${g.key}-${item.id}`} data-idx={idx} role="option" aria-selected={isActive}
                          onClick={() => go(item)}
                          onMouseEnter={() => setActive(idx)}
                          className={cn(
                            'w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors',
                            isActive ? 'bg-emerald-50/80' : 'hover:bg-emerald-50/60'
                          )}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={cn('text-xs font-mono font-medium', g.key === 'plates' ? 'text-stone-700' : 'text-emerald-700')}>
                                {item.code}
                              </span>
                              {st && <span className={cn('text-[10px] px-1.5 rounded border', st.className)}>{st.label}</span>}
                            </div>
                            <div className="text-[13px] text-stone-700 truncate mt-0.5">{item.title}</div>
                          </div>
                          <span className="shrink-0 text-right max-w-[120px]">
                            <span className="block text-[10px] text-stone-400 font-mono">{fmtDate(item.createdAt)}</span>
                            {item.extra && <span className="block text-[10px] text-stone-400 truncate">{item.extra}</span>}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
              <div className="px-3 py-1.5 bg-stone-50 border-t border-stone-100 text-[10px] text-stone-400 flex items-center justify-between gap-2">
                <span>输入至少 2 个字符，每组最多显示 5 条 · 共 {total} 条</span>
                <span className="hidden md:inline shrink-0">↑↓ 选择 · Enter 跳转</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
