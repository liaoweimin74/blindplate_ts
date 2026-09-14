'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost, fmtDateTime } from '@/lib/bp-api'
import type { BpUser } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Bell, BellOff, Stamp, TrendingUp, AlertTriangle, HardHat, Megaphone,
  CheckCheck, Loader2, Filter,
} from 'lucide-react'

/** 通知类型 → 图标与配色（移动端消息中心与桌面铃铛共用同一映射） */
export const NOTIFY_TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; chip: string; label: string }> = {
  APPROVAL: { icon: Stamp, chip: 'bg-amber-100 text-amber-700', label: '审批' },
  STATUS: { icon: TrendingUp, chip: 'bg-emerald-100 text-emerald-700', label: '进度' },
  ALERT: { icon: AlertTriangle, chip: 'bg-rose-100 text-rose-700', label: '预警' },
  EXECUTE: { icon: HardHat, chip: 'bg-violet-100 text-violet-700', label: '执行' },
  SYSTEM: { icon: Megaphone, chip: 'bg-stone-200 text-stone-600', label: '系统' },
}

export interface BpNotification {
  id: number
  userId: string | null
  targetRole: string | null
  type: string
  title: string
  content: string
  bizType?: string | null
  bizId?: number | null
  bizCode?: string | null
  linkModule?: string | null
  linkTab?: string | null
  readAt: string | null
  createdAt: string
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} 天前`
  return fmtDateTime(iso)
}

interface Props {
  user: BpUser
  onNavigate?: (key: string, tab?: string) => void
  /** 移动端紧凑模式（仅图标） */
  compact?: boolean
}

export default function NotificationBell({ user, onNavigate, compact }: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<BpNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [marking, setMarking] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ notifications: BpNotification[]; unread: number }>(
        `/api/notifications?userId=${encodeURIComponent(user.id)}&role=${encodeURIComponent(user.role)}&limit=30`
      )
      setItems(data.notifications ?? [])
      setUnread(data.unread ?? 0)
    } catch {
      /* 轮询失败静默，不打断用户 */
    }
  }, [user.id, user.role])

  // 首次加载 + 30s 轮询 + 跨组件联动刷新（如看板跑马灯公告标记已读后立即同步未读数）
  useEffect(() => {
    load()
    timerRef.current = setInterval(load, 30000)
    const onChanged = () => { void load() }
    window.addEventListener('bp:notifications-changed', onChanged)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      window.removeEventListener('bp:notifications-changed', onChanged)
    }
  }, [load])

  const openPanel = async () => {
    setOpen(true)
    setLoading(true)
    await load()
    setLoading(false)
  }

  const markRead = async (ids: number[]) => {
    try {
      // 携带 userId/role 使 API scope 覆盖「精确推送 + 角色广播 + 全员广播」，否则角色广播通知无法标记已读
      await apiPost('/api/notifications/read', { ids, userId: user.id, role: user.role })
      setItems((prev) => prev.map((n) => (ids.includes(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)))
      setUnread((u) => Math.max(0, u - ids.length))
    } catch { /* 静默 */ }
  }

  const markAll = async () => {
    setMarking(true)
    try {
      await apiPost('/api/notifications/read', { all: true, userId: user.id, role: user.role })
      const now = new Date().toISOString()
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })))
      setUnread(0)
    } catch { /* 静默 */ } finally { setMarking(false) }
  }

  const handleClickItem = async (n: BpNotification) => {
    if (!n.readAt) await markRead([n.id])
    setOpen(false)
    if (n.linkModule) onNavigate?.(n.linkModule, n.linkTab ?? undefined)
  }

  const visibleItems = unreadOnly ? items.filter((n) => !n.readAt) : items

  return (
    <Popover open={open} onOpenChange={(v) => (v ? openPanel() : setOpen(false))}>
      <PopoverTrigger asChild>
        <button
          aria-label={`消息通知${unread ? `，${unread} 条未读` : ''}`}
          className={cn(
            'relative rounded-lg transition-colors',
            compact ? 'p-2 hover:bg-stone-800 text-stone-300' : 'p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-700'
          )}
        >
          <Bell className={cn('w-[18px] h-[18px]', unread > 0 && 'animate-swing-once')} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white shadow-sm">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] max-w-[92vw] p-0">
        {/* 头部 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
          <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <Bell className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-stone-800">消息通知</div>
            <div className="text-[11px] text-stone-400">{unread > 0 ? `${unread} 条未读` : '全部已读'}</div>
          </div>
          <button onClick={() => setUnreadOnly((v) => !v)} title="仅看未读"
            className={cn('h-8 px-2 rounded-md text-xs border transition-colors flex items-center gap-1',
              unreadOnly ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-stone-200 text-stone-500 hover:bg-stone-50')}>
            <Filter className="w-3 h-3" />
            仅未读
          </button>
          <Button variant="ghost" size="sm" disabled={marking || unread === 0} onClick={markAll}
            className="h-8 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 gap-1">
            {marking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
            全部已读
          </Button>
        </div>

        {/* 列表 */}
        <ScrollArea className="h-[380px]">
          {loading && items.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-2 text-stone-400">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-xs">加载中…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-2 text-stone-400">
              <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center">
                <BellOff className="w-5 h-5" />
              </div>
              <span className="text-sm">暂无通知</span>
              <span className="text-[11px]">业务流转与预警信息将在这里提醒你</span>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-2 text-stone-400">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCheck className="w-5 h-5 text-emerald-500" />
              </div>
              <span className="text-sm">没有未读通知</span>
              <button onClick={() => setUnreadOnly(false)} className="text-[11px] text-emerald-700 hover:underline">查看全部通知</button>
            </div>
          ) : (
            <div className="py-1">
              {visibleItems.map((n, idx) => {
                const meta = NOTIFY_TYPE_META[n.type] ?? NOTIFY_TYPE_META.SYSTEM
                const Icon = meta.icon
                const isUnread = !n.readAt
                return (
                  <div key={n.id}>
                    <button onClick={() => handleClickItem(n)}
                      className={cn('w-full text-left px-4 py-3 flex gap-3 transition-colors hover:bg-stone-50', isUnread && 'bg-emerald-50/40')}>
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5', meta.chip)}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('text-[13px] truncate', isUnread ? 'font-semibold text-stone-800' : 'text-stone-600')}>{n.title}</span>
                          {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="未读" />}
                        </div>
                        <p className="text-xs text-stone-500 leading-relaxed mt-0.5 line-clamp-2">{n.content}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {n.bizCode && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 border border-stone-200">{n.bizCode}</span>
                          )}
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded', meta.chip)}>{meta.label}</span>
                          <span className="text-[10px] text-stone-400 ml-auto shrink-0" title={fmtDateTime(n.createdAt)}>{timeAgo(n.createdAt)}</span>
                        </div>
                      </div>
                    </button>
                    {idx < visibleItems.length - 1 && <Separator className="bg-stone-100" />}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>

        {/* 底部 */}
        <div className="px-4 py-2 border-t border-stone-100 text-[10px] text-stone-400 flex items-center justify-between">
          <span>按角色「{user.role}」与个人推送{unreadOnly ? ' · 仅未读' : ''}</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />每 30 秒自动刷新</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
