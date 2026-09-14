import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { num } from '@/lib/bp-server-utils'
import { parsePidContent } from '@/lib/bp-types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pid-diagrams/mark-usage?masterPointId=&code=&excludeDiagramId=
 * → 隔离点挂标跨图占用查询（挂标写入侧对称提示：该点已在其他 N 张图挂标）
 * 匹配规则与定位查看一致：masterPointId 精确优先，无主数据时按 code 编码匹配。
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const masterPointId = num(sp.get('masterPointId') ?? '')
    const code = (sp.get('code') ?? '').trim()
    const excludeId = num(sp.get('excludeDiagramId') ?? '')
    if (masterPointId === null && !code) {
      return NextResponse.json({ list: [] })
    }
    const diagrams = await db.pidDiagram.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { unit: { select: { name: true } } },
    })
    const list: { diagramId: number; diagramName: string; unitName: string | null; markId: string; markCode: string }[] = []
    for (const d of diagrams) {
      if (excludeId !== null && d.id === excludeId) continue
      const content = parsePidContent(d.content)
      const hit = content.marks.find(
        (mk) =>
          (masterPointId !== null && mk.masterPointId === masterPointId) ||
          (masterPointId === null && code && mk.code === code)
      )
      if (hit) {
        list.push({
          diagramId: d.id,
          diagramName: d.name,
          unitName: d.unit?.name ?? null,
          markId: hit.id,
          markCode: hit.code,
        })
      }
    }
    return NextResponse.json({ list })
  } catch (e) {
    console.error('[GET /api/pid-diagrams/mark-usage]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '查询挂标占用失败' },
      { status: 500 }
    )
  }
}
