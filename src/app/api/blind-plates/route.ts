import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError, num, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/blind-plates?status=&spec=&keyword=（keyword 模糊匹配 code/location） */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const status = sp.get('status') ?? undefined
    const spec = sp.get('spec') ?? undefined
    const keyword = sp.get('keyword') ?? undefined
    const where: Prisma.BlindPlateWhereInput = {}
    if (status) where.status = status
    if (spec) where.spec = spec
    if (keyword) {
      where.OR = [{ code: { contains: keyword } }, { location: { contains: keyword } }]
    }
    const plates = await db.blindPlate.findMany({ where, orderBy: { code: 'asc' } })
    return NextResponse.json(plates)
  } catch (e) {
    console.error('[GET /api/blind-plates]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取盲板列表失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/blind-plates 新增盲板（一板一码，编号 MB-{规格}-{4位序号}）
 * 同步库存：相同 spec+type+material 的库存项数量 +1（不存在则创建）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const spec = str(body.spec)
    const type = str(body.type)
    const material = str(body.material)
    const pressureRating = str(body.pressureRating)
    const thickness = num(body.thickness)
    if (!spec || !type || !material || !pressureRating) {
      return jsonError('规格、类型、材质和压力等级不能为空')
    }
    if (thickness === null) return jsonError('厚度必须为数字')

    // 生成盲板编号 MB-DN50-0001（同规格内递增）
    const like = `MB-${spec}-`
    const last = await db.blindPlate.findFirst({
      where: { code: { startsWith: like } },
      orderBy: { code: 'desc' },
      select: { code: true },
    })
    const m = last ? last.code.match(/(\d+)$/) : null
    const code = `${like}${String(m ? Number(m[1]) + 1 : 1).padStart(4, '0')}`

    const plate = await db.$transaction(async (tx) => {
      const created = await tx.blindPlate.create({
        data: {
          code,
          spec,
          type,
          material,
          thickness,
          pressureRating,
          status: str(body.status) || 'IN_STOCK',
          location: str(body.location) || null,
          unitId: num(body.unitId),
        },
      })
      // 同步库存汇总
      const inv = await tx.inventoryItem.findFirst({ where: { spec, type, material } })
      if (inv) {
        await tx.inventoryItem.update({
          where: { id: inv.id },
          data: { quantity: inv.quantity + 1 },
        })
      } else {
        await tx.inventoryItem.create({ data: { spec, type, material, quantity: 1 } })
      }
      return created
    })
    return NextResponse.json(plate, { status: 201 })
  } catch (e) {
    console.error('[POST /api/blind-plates]', e)
    return jsonError(e instanceof Error ? e.message : '创建盲板失败', 500)
  }
}
