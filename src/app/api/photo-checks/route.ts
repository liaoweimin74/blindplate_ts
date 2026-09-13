import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/photo-checks?workRequestId=&ticketId=&scene= AI 照片核对记录（新→旧） */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const wid = num(sp.get('workRequestId'))
    const tid = num(sp.get('ticketId'))
    const scene = sp.get('scene')
    const where: Record<string, unknown> = {}
    if (wid !== null) where.workRequestId = wid
    if (tid !== null) where.ticketId = tid
    if (scene) where.scene = scene
    const list = await db.photoCheck.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 })
    return NextResponse.json(list)
  } catch (e) {
    console.error('[GET /api/photo-checks]', e)
    return jsonError(e instanceof Error ? e.message : '查询核对记录失败', 500)
  }
}
