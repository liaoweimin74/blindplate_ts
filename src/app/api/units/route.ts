import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** GET /api/units → 装置列表 */
export async function GET() {
  try {
    const units = await db.unit.findMany({ orderBy: { code: 'asc' } })
    return NextResponse.json(units)
  } catch (e) {
    console.error('[GET /api/units]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取装置列表失败' },
      { status: 500 }
    )
  }
}

/** POST /api/units 创建装置（编号唯一） */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const code = str(body.code)
    const name = str(body.name)
    if (!code || !name) return jsonError('装置编号和名称不能为空')
    const exists = await db.unit.findUnique({ where: { code } })
    if (exists) return jsonError('装置编号已存在', 409)
    const { actorId, actorName, body: rest } = extractActor(body)
    const unit = await db.unit.create({
      data: {
        code,
        name,
        manager: str(rest.manager) || null,
        phone: str(rest.phone) || null,
        remark: str(rest.remark) || null,
        active: rest.active === undefined ? true : Boolean(rest.active),
      },
    })
    await logAudit({
      actorId, actorName, action: 'CREATE', entity: 'UNIT', entityId: unit.id, entityCode: unit.code,
      detail: `创建装置「${unit.name}」`,
    })
    return NextResponse.json(unit, { status: 201 })
  } catch (e) {
    console.error('[POST /api/units]', e)
    return jsonError(e instanceof Error ? e.message : '创建装置失败', 500)
  }
}
