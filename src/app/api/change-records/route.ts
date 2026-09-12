import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** GET /api/change-records?limit=100 → 盲板变动记录（时间倒序） */
export async function GET(req: NextRequest) {
  try {
    const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 100)
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 500) : 100
    const records = await db.changeRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return NextResponse.json(records)
  } catch (e) {
    console.error('[GET /api/change-records]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取变动记录失败' },
      { status: 500 }
    )
  }
}
