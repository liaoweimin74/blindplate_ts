import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/attachments/[id] 附件元数据 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const att = await db.attachment.findUnique({ where: { id } })
    if (!att) return jsonError('附件不存在', 404)
    return NextResponse.json(att)
  } catch (e) {
    console.error('[GET /api/attachments/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '查询附件失败', 500)
  }
}

/** DELETE /api/attachments/[id] 删除附件（元数据 + 落盘文件） */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const att = await db.attachment.findUnique({ where: { id } })
    if (!att) return jsonError('附件不存在', 404)
    await db.attachment.delete({ where: { id } })
    const path = await import('node:path')
    const { unlink } = await import('node:fs/promises')
    // 防路径穿越：storageKey 必须是纯文件名
    if (!att.storageKey || att.storageKey.includes('/') || att.storageKey.includes('..')) {
      return NextResponse.json({ ok: true, warn: '文件路径异常，仅删除了元数据' })
    }
    try {
      await unlink(path.join(process.cwd(), 'uploads', att.storageKey))
    } catch {
      /* 文件已不存在不阻塞 */
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/attachments/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '删除附件失败', 500)
  }
}
