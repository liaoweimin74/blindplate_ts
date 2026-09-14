'use client'
// 全局 AI 助手「小安」：右下角浮动按钮 + 对话面板（多轮问答 / 快捷提问 / 轻量 Markdown 渲染 / 回答内嵌应用入口直达）
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiPost } from '@/lib/bp-api'
import { ROLE_MAP, resolveEntry, dispatchEntryAction } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { Bot, Send, X, Trash2, Sparkles, RotateCcw, ChevronDown, ArrowRight } from 'lucide-react'

interface ChatMsg { role: 'user' | 'assistant'; content: string; error?: boolean }

const QUICK_PROMPTS = [
  '盲板抽堵作业的完整流程是什么？',
  '隔离方案和工艺处置方案分别要编什么？',
  '作业票由谁批准？验收要检查哪些项？',
  '8字盲板和插板的适用场景有何区别？',
]

/** 入口标记点击：模块/tab 直接跳转；动作类先跳模块再延迟派发动作事件（等目标模块挂载后监听处理） */
function useEntryGo(onNavigate?: (key: string, tab?: string) => void) {
  return useCallback((key: string) => {
    const r = resolveEntry(key)
    if (!r || !onNavigate) return
    if (r.type === 'module') onNavigate(r.key)
    else if (r.type === 'tab') onNavigate(r.key, r.tab)
    else {
      onNavigate(r.key)
      window.setTimeout(() => dispatchEntryAction(r.key, r.action), 400)
    }
  }, [onNavigate])
}

/** 入口标记内联按钮（白名单校验，无效 key 回退为原文本防幻觉） */
function EntryLink({ entryKey, label, onGo }: { entryKey: string; label: string; onGo: (key: string) => void }) {
  const r = resolveEntry(entryKey)
  if (!r) return <>{label}</>
  return (
    <button
      type="button"
      onClick={() => onGo(entryKey)}
      title={`点击直达：${label}`}
      className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-0.5 rounded-md border border-violet-300 bg-violet-50 px-1.5 py-0.5 align-baseline text-[11px] font-medium text-violet-700 transition-colors hover:border-violet-400 hover:bg-violet-100"
    >
      <ArrowRight className="h-3 w-3 shrink-0" />
      {label}
    </button>
  )
}

/** 轻量 Markdown 渲染：**加粗** / `code` / # 标题 / - 与 1. 列表 / [入口:key|文字] 直达按钮 / 空行分段（React 节点，无 dangerouslySetInnerHTML） */
function renderRich(text: string, onGo: (key: string) => void) {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let listBuf: { ordered: boolean; items: string[] } | null = null

  const flushList = (key: string) => {
    if (!listBuf) return
    const { ordered, items } = listBuf
    const L = ordered ? 'ol' : 'ul'
    nodes.push(
      <L key={key} className={cn('my-1 ml-4 space-y-0.5 text-[12.5px] leading-relaxed', ordered ? 'list-decimal' : 'list-disc')}>
        {items.map((it, i) => <li key={i}>{renderInline(it, onGo)}</li>)}
      </L>,
    )
    listBuf = null
  }

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trimEnd()
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line)
    const ordered = /^\s*(\d+)[.、)]\s+(.*)$/.exec(line)
    if (bullet) {
      if (!listBuf || listBuf.ordered) { flushList(`l${idx}`); listBuf = { ordered: false, items: [] } }
      listBuf.items.push(bullet[1]); return
    }
    if (ordered) {
      if (!listBuf || !listBuf.ordered) { flushList(`l${idx}`); listBuf = { ordered: true, items: [] } }
      listBuf.items.push(ordered[2]); return
    }
    flushList(`l${idx}`)
    if (!line.trim()) return
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const isHead = !!heading
    nodes.push(
      <p key={idx} className={cn('text-[12.5px] leading-relaxed', isHead && 'font-bold text-stone-800 mt-1.5')}>{renderInline(heading ? heading[2] : line, onGo)}</p>,
    )
  })
  flushList('l-end')
  return nodes
}

function renderInline(text: string, onGo: (key: string) => void): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[入口:([a-z-]+(?::[a-z-]+)?)\|([^\]]+)\])/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) parts.push(<strong key={m.index} className="font-semibold text-stone-800">{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) parts.push(<code key={m.index} className="rounded bg-stone-100 border border-stone-200 px-1 py-0.5 text-[11px] font-mono text-teal-700">{tok.slice(1, -1)}</code>)
    else parts.push(<EntryLink key={m.index} entryKey={m[2]} label={m[3]} onGo={onGo} />)
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export default function AiAssistant({ user, moduleTitle, onNavigate }: { user: { name: string; role: string }; moduleTitle?: string; onNavigate?: (key: string, tab?: string) => void }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastQuestionRef = useRef<string>('')
  // 入口直达：回答内 [入口:key|文字] 标记点击后跳转/触发动作
  const onGo = useEntryGo(onNavigate)

  // 消息变化滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, sending, open])

  const send = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q || sending) return
    lastQuestionRef.current = q
    setInput('')
    setSending(true)
    setMsgs((prev) => [...prev, { role: 'user', content: q }])
    try {
      const res = await apiPost<{ content: string }>('/api/ai/chat', {
        // 除最后一条外裁掉历史中的 error 气泡
        messages: [...msgs.filter((m) => !m.error), { role: 'user', content: q }].slice(-16).map(({ role, content }) => ({ role, content })),
        context: { userName: user.name, userRole: user.role, moduleTitle },
      })
      setMsgs((prev) => [...prev, { role: 'assistant', content: res.content }])
    } catch (e) {
      setMsgs((prev) => [...prev, { role: 'assistant', content: e instanceof Error ? e.message : '请求失败，请稍后重试', error: true }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [msgs, sending, user, moduleTitle])

  const retry = useCallback(() => {
    if (lastQuestionRef.current) void send(lastQuestionRef.current)
  }, [send])

  const clear = () => { setMsgs([]); lastQuestionRef.current = '' }

  const roleLabel = ROLE_MAP[user.role]?.label ?? user.role

  return (
    <>
      {/* 浮动按钮 */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="打开 AI 助手"
          title={`AI 助手 小安 · ${roleLabel}您好，点击提问`}
          className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 group"
        >
          <span className="absolute inset-0 rounded-full bg-violet-500/40 animate-ping opacity-60" />
          <span className="relative flex h-13 w-13 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-violet-700 shadow-lg shadow-violet-500/30 transition-transform group-hover:scale-105">
            <Bot className="h-6 w-6 text-white" />
          </span>
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-amber-950 shadow ring-2 ring-white">AI</span>
        </button>
      )}

      {/* 对话面板 */}
      {open && (
        <div
          className="fixed inset-x-2 bottom-2 z-40 flex max-h-[78vh] flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl shadow-violet-900/10 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[400px]"
          role="dialog"
          aria-label="AI 助手对话面板"
        >
          {/* 头部 */}
          <div className="flex shrink-0 items-center gap-2.5 bg-gradient-to-r from-violet-600 to-violet-700 px-4 py-3 text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              <Bot className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                小安 · AI 助手
                <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              </div>
              <div className="truncate text-[11px] text-violet-200">
                {moduleTitle ? `当前模块：${moduleTitle}` : '盲板抽堵业务与系统操作咨询'}
              </div>
            </div>
            {msgs.length > 0 && (
              <button onClick={clear} title="清空对话" aria-label="清空对话" className="rounded-md p-1.5 text-violet-200 transition-colors hover:bg-white/15 hover:text-white">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => setOpen(false)} title="收起" aria-label="收起面板" className="rounded-md p-1.5 text-violet-200 transition-colors hover:bg-white/15 hover:text-white">
              <ChevronDown className="h-4.5 w-4.5" />
            </button>
          </div>

          {/* 消息区 */}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-stone-50/80 px-3.5 py-3 bp-thin-scrollbar">
            {msgs.length === 0 && (
              <div className="py-2">
                <div className="mb-3 flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-violet-700 shadow-sm">
                    <Bot className="h-4 w-4 text-white" />
                  </span>
                  <div className="max-w-[85%] rounded-xl rounded-tl-sm border border-violet-100 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-stone-600 shadow-sm">
                    您好，{user.name}（{roleLabel}）！我是盲板管理 AI 助手「小安」，可以为您解答：
                    <div className="mt-1.5 space-y-1 text-stone-500">
                      <div>· 盲板抽堵业务流程与 GB 30871 规范要点</div>
                      <div>· 隔离方案 / 工艺处置方案 / 作业票编制要点</div>
                      <div>· 系统各模块的操作指引</div>
                    </div>
                    <div className="mt-1.5 text-[11px] text-stone-400">⚠️ 涉及具体单据数据请以系统各模块实际内容为准。</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-9">
                  {QUICK_PROMPTS.map((p) => (
                    <button key={p} onClick={() => void send(p)} disabled={sending}
                      className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700 transition-colors hover:border-violet-400 hover:bg-violet-100 disabled:opacity-50">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl rounded-br-sm bg-violet-600 px-3 py-2 text-[12.5px] leading-relaxed text-white shadow-sm whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-violet-700 shadow-sm">
                    <Bot className="h-4 w-4 text-white" />
                  </span>
                  <div className={cn(
                    'max-w-[85%] rounded-xl rounded-tl-sm border px-3 py-2 text-[12.5px] leading-relaxed shadow-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
                    m.error ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-violet-100 bg-white text-stone-600',
                  )}>
                    {m.error ? <>{m.content}{lastQuestionRef.current && (
                      <button onClick={retry} className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-rose-300 bg-white px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50">
                        <RotateCcw className="h-3 w-3" />重试
                      </button>
                    )}</> : renderRich(m.content, onGo)}
                  </div>
                </div>
              )
            ))}
            {sending && (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-violet-700 shadow-sm">
                  <Bot className="h-4 w-4 text-white" />
                </span>
                <div className="flex items-center gap-1 rounded-xl rounded-tl-sm border border-violet-100 bg-white px-3 py-2.5 shadow-sm" title="思考中">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="shrink-0 border-t border-stone-200 bg-white p-2.5">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                placeholder="输入问题，Enter 发送 / Shift+Enter 换行"
                aria-label="AI 助手输入框"
                className="max-h-28 min-h-[38px] flex-1 resize-none rounded-lg border border-stone-300 px-3 py-2 text-[12.5px] outline-none transition-colors placeholder:text-stone-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send(input)
                  }
                }}
              />
              <button
                onClick={() => void send(input)}
                disabled={sending || !input.trim()}
                aria-label="发送"
                title="发送"
                className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 px-0.5 text-[10px] text-stone-300">内容由 AI 生成，仅供参考，安全作业要求以现行规范与审批流程为准</p>
          </div>
        </div>
      )}
    </>
  )
}
