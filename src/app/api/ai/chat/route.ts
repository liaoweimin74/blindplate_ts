import { NextRequest, NextResponse } from 'next/server'
import { buildAssistantSystemPrompt, bpComplete, sanitizeChatMessages, type AiContext } from '@/lib/bp-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST /api/ai/chat { messages, context? } → { content }（全局 AI 助手多轮对话） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const messages = sanitizeChatMessages(body?.messages)
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return NextResponse.json({ error: '请输入您的问题' }, { status: 400 })
    }
    const ctx = (body?.context ?? {}) as AiContext
    const content = await bpComplete(buildAssistantSystemPrompt(ctx), messages)
    if (!content.trim()) {
      return NextResponse.json({ error: 'AI 未返回内容，请稍后重试' }, { status: 502 })
    }
    return NextResponse.json({ content })
  } catch (e) {
    console.error('[ai/chat]', e)
    return NextResponse.json({ error: 'AI 服务暂时不可用，请稍后重试' }, { status: 500 })
  }
}
