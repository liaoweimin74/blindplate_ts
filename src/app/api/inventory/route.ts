import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** GET /api/inventory → 全部库存（按规格排序） */
export async function GET() {
  try {
    const items = await db.inventoryItem.findMany({
      orderBy: [{ spec: 'asc' }, { type: 'asc' }, { material: 'asc' }],
    })
    return NextResponse.json(items)
  } catch (e) {
    console.error('[GET /api/inventory]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取库存失败' },
      { status: 500 }
    )
  }
}
