import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, num, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** 允许的字典类别 */
const DICT_CATEGORIES = ['BLIND_SPEC', 'BLIND_TYPE', 'MATERIAL', 'PRESSURE', 'MEDIUM']

/** GET /api/dicts?category=BLIND_SPEC|BLIND_TYPE|MATERIAL|PRESSURE|MEDIUM → 按 order 排序 */
export async function GET(req: NextRequest) {
  try {
    const category = req.nextUrl.searchParams.get('category') ?? undefined
    const dicts = await db.dict.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    })
    return NextResponse.json(dicts)
  } catch (e) {
    console.error('[GET /api/dicts]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '获取字典失败' },
      { status: 500 }
    )
  }
}

/** POST /api/dicts 新增字典项（同类别下 value 唯一） */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    const category = str(body.category)
    const value = str(body.value)
    const label = str(body.label)
    if (!category || !value || !label) {
      return jsonError('类别、值和显示名不能为空')
    }
    if (!(DICT_CATEGORIES as readonly string[]).includes(category)) {
      return jsonError('无效的字典类别')
    }
    const exists = await db.dict.findFirst({ where: { category, value } })
    if (exists) return jsonError('该类别下已存在相同值的字典项', 409)
    const { actorId, actorName, body: rest } = extractActor(body)
    const dict = await db.dict.create({
      data: { category, value, label, order: num(rest.order) ?? 0 },
    })
    await logAudit({
      actorId, actorName, action: 'CREATE', entity: 'DICT', entityId: dict.id, entityCode: dict.label,
      detail: `新增字典项「${dict.label}」（${dict.category}/${dict.value}）`,
    })
    return NextResponse.json(dict, { status: 201 })
  } catch (e) {
    console.error('[POST /api/dicts]', e)
    return jsonError(e instanceof Error ? e.message : '新增字典项失败', 500)
  }
}
