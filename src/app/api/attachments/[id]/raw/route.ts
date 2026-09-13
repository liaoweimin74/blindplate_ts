import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/attachments/[id]/raw — 附件文件流（img src / audio src 直连）
 * 安全校验：storageKey 仅允许纯文件名（防路径穿越）
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const att = await db.attachment.findUnique({ where: { id } })
    if (!att) return new NextResponse('附件不存在', { status: 404 })
    if (!att.storageKey || att.storageKey.includes('/') || att.storageKey.includes('..')) {
      return new NextResponse('文件路径异常', { status: 400 })
    }
    const path = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const filePath = path.join(process.cwd(), 'uploads', att.storageKey)
    const buf = await readFile(filePath)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': att.mimeType || 'application/octet-stream',
        'Content-Length': String(buf.length),
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
      },
    })
  } catch (e) {
    console.error('[GET /api/attachments/[id]/raw]', e)
    const msg = e instanceof Error && e.message.includes('ENOENT') ? '文件已丢失' : '读取附件失败'
    return new NextResponse(msg, { status: 500 })
  }
}
