'use client'
/**
 * DictCombobox（Task 94）：数据字典驱动的可输入下拉框
 * —— 字典中有该分类时选项来自 /api/dicts?category=；同时保留自由输入兜底（实际值可能不在字典）
 * 模块级缓存：同分类一次会话只拉一次（字典量小且变更低频；管理端改动后刷新页面即生效）
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronsUpDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DictCategory = 'BLIND_SPEC' | 'BLIND_TYPE' | 'MATERIAL' | 'PRESSURE' | 'MEDIUM'

export interface DictRow {
  id: number
  category: string
  value: string
  label: string
  order: number
}

/** 模块级缓存：category → rows（Promise 去重并发） */
const cache = new Map<string, Promise<DictRow[]>>()

export function fetchDict(category: DictCategory): Promise<DictRow[]> {
  let p = cache.get(category)
  if (!p) {
    p = fetch(`/api/dicts?category=${category}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: unknown) => (Array.isArray(rows) ? (rows as DictRow[]) : []))
      .catch(() => [])
    cache.set(category, p)
  }
  return p
}

/** 供外部在字典变更后清缓存（如字典管理页保存后） */
export function invalidateDictCache(category?: DictCategory) {
  if (category) cache.delete(category)
  else cache.clear()
}

export function DictCombobox({
  value, onChange, category, placeholder, disabled, className, allowFree = true,
}: {
  value: string
  onChange: (v: string) => void
  category: DictCategory
  placeholder?: string
  disabled?: boolean
  className?: string
  /** 允许字典外自由输入（默认 true；false 时仅可选字典项） */
  allowFree?: boolean
}) {
  const [rows, setRows] = useState<DictRow[]>([])
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1) // 键盘高亮
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void fetchDict(category).then((r) => {
      if (alive) setRows(r)
    })
    return () => {
      alive = false
    }
  }, [category])

  // 输入过滤（value 作为过滤词会干扰选中回显，用独立 keyword 状态）
  const [keyword, setKeyword] = useState('')
  const options = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const list = q ? rows.filter((r) => r.value.toLowerCase().includes(q) || r.label.toLowerCase().includes(q)) : rows
    return list
  }, [rows, keyword])

  // 点外关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  const pick = (v: string) => {
    onChange(v)
    setKeyword('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const dictHit = rows.some((r) => r.value === value)

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={placeholder}
        className={cn(
          'flex h-9 w-full rounded-md border border-stone-200 bg-white px-3 py-1 pr-8 text-sm shadow-sm transition-colors placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          value && !dictHit && allowFree && 'border-amber-300',
        )}
        value={keyword || value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          setKeyword('')
          setOpen(true)
          setHi(-1)
        }}
        onChange={(e) => {
          if (!allowFree) return // 仅选模式：输入仅作过滤
          setKeyword(e.target.value)
          onChange(e.target.value)
          setOpen(true)
          setHi(-1)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHi((h) => Math.min(h + 1, options.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, -1))
          } else if (e.key === 'Enter' && open && hi >= 0 && options[hi]) {
            e.preventDefault()
            pick(options[hi].value)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={`${placeholder}字典选项`}
          className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-stone-200 bg-white py-1 shadow-md bp-thin-scrollbar"
        >
          {options.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-stone-400">
              {rows.length === 0 ? '该分类暂无字典项，可直接输入' : '无匹配项'}
              {allowFree && keyword.trim() && (
                <button type="button" className="ml-1 text-emerald-700 underline-offset-2 hover:underline" onClick={() => pick(keyword.trim())}>
                  使用「{keyword.trim()}」
                </button>
              )}
            </div>
          ) : (
            options.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={r.value === value}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm transition-colors',
                  i === hi ? 'bg-emerald-50 text-emerald-900' : 'text-stone-700 hover:bg-stone-50',
                )}
                onPointerDown={(e) => e.preventDefault() // 防 blur 先于 click 关闭
                }
                onClick={() => pick(r.value)}
              >
                <span className="min-w-0 truncate">
                  {r.value}
                  {r.label !== r.value && <span className="ml-1.5 text-xs text-stone-400">{r.label}</span>}
                </span>
                {r.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
              </button>
            ))
          )}
          {allowFree && keyword.trim() && !options.some((r) => r.value === keyword.trim()) && (
            <button
              type="button"
              className="flex w-full items-center gap-1.5 border-t border-stone-100 px-2.5 py-1.5 text-left text-xs text-emerald-700 hover:bg-emerald-50"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(keyword.trim())}
            >
              自由值：使用「{keyword.trim()}」（不在字典中）
            </button>
          )}
        </div>
      )}
    </div>
  )
}
