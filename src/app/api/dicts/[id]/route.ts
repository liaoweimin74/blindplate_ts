import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractActor, jsonError, logAudit, num, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

const DICT_CATEGORIES = ['BLIND_SPEC', 'BLIND_TYPE', 'MATERIAL', 'PRESSURE', 'MEDIUM']

/** PUT /api/dicts/[id] 更新字典项（category/value/label/order） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const did = parseId(id)
    if (!did) return jsonError('无效的字典 ID')
    const existing = await db.dict.findUnique({ where: { id: did } })
    if (!existing) return jsonError('字典项不存在', 404)
    const { actorId, actorName, body } = extractActor(await readBody(req))

    const data: { category?: string; value?: string; label?: string; order?: number } = {}
    if (body.category !== undefined) {
      const category = str(body.category)
      if (!category) return jsonError('类别不能为空')
      if (!DICT_CATEGORIES.includes(category)) return jsonError('无效的字典类别')
      data.category = category
    }
    if (body.value !== undefined) {
      const value = str(body.value)
      if (!value) return jsonError('值不能为空')
      data.value = value
    }
    if (body.label !== undefined) {
      const label = str(body.label)
      if (!label) return jsonError('显示名不能为空')
      data.label = label
    }
    if (body.order !== undefined) {
      const order = num(body.order)
      if (order === null) return jsonError('排序必须为数字')
      data.order = order
    }

    if (data.category && data.value) {
      const dup = await db.dict.findFirst({
        where: { category: data.category, value: data.value, NOT: { id: did } },
      })
      if (dup) return jsonError('该类别下已存在相同值的字典项', 409)
    }

    const dict = await db.dict.update({ where: { id: did }, data })
    await logAudit({
      actorId, actorName, action: 'UPDATE', entity: 'DICT', entityId: did, entityCode: dict.label,
      detail: `更新字典项「${dict.label}」（${dict.category}/${dict.value}）`,
    })
    return NextResponse.json(dict)
  } catch (e) {
    console.error('[PUT /api/dicts/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新字典项失败', 500)
  }
}

/** DELETE /api/dicts/[id] 删除字典项（操作者经 query 传递） */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const did = parseId(id)
    if (!did) return jsonError('无效的字典 ID')
    const existing = await db.dict.findUnique({ where: { id: did } })
    if (!existing) return jsonError('字典项不存在', 404)
    const sp = new URL(req.url).searchParams
    await db.dict.delete({ where: { id: did } })
    await logAudit({
      actorId: sp.get('__actorId'), actorName: sp.get('__actorName') || '未知用户',
      action: 'DELETE', entity: 'DICT', entityId: did, entityCode: existing.label,
      detail: `删除字典项「${existing.label}」（${existing.category}/${existing.value}）`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/dicts/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '删除字典项失败', 500)
  }
}
