import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

const METHODS = ['VENT', 'DRAIN', 'REPLACE', 'PURGE', 'STEAM', 'GAS_TEST', 'ISOLATE', 'OTHER']

/** PUT /api/disposal-schemes/[id] 编辑方案（仅 DRAFT/REJECTED 可改），steps 整体替换 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sid = parseId(id)
    if (!sid) return jsonError('无效的方案 ID')
    const scheme = await db.disposalScheme.findUnique({ where: { id: sid } })
    if (!scheme) return jsonError('工艺处置方案不存在', 404)
    if (scheme.status !== 'DRAFT' && scheme.status !== 'REJECTED') {
      return jsonError(`当前状态为 ${scheme.status}，仅草稿或被驳回状态可编辑`)
    }
    const body = await readBody(req)
    const preparedBy = body.preparedBy !== undefined ? str(body.preparedBy) : scheme.preparedBy
    if (!preparedBy) return jsonError('编制人不能为空')

    // steps 传数组则整体替换，未传则保留原步骤
    const replaceSteps = Array.isArray(body.steps)
    const stepsInput: any[] = replaceSteps ? body.steps : []
    if (replaceSteps) {
      for (const s of stepsInput) {
        if (!str(s?.detail)) return jsonError('每个处置步骤必须包含处置内容')
        if (s?.method && !METHODS.includes(str(s.method))) {
          return jsonError('处置方式必须为 VENT/DRAIN/REPLACE/PURGE/STEAM/GAS_TEST/ISOLATE/OTHER')
        }
      }
    }

    const updated = await db.disposalScheme.update({
      where: { id: sid },
      data: {
        preparedBy,
        ...(replaceSteps
          ? {
              steps: {
                deleteMany: {},
                create: stepsInput.map((s, i) => ({
                  seq:
                    s?.seq !== undefined && s?.seq !== null && Number.isFinite(Number(s.seq))
                      ? Number(s.seq)
                      : i + 1,
                  method: str(s.method) || 'OTHER',
                  detail: str(s.detail),
                  standard: str(s.standard) || null,
                  masterPointId: num(s.masterPointId),
                  masterCode: str(s.masterCode) || null,
                })),
              },
            }
          : {}),
      },
      include: { steps: { orderBy: { seq: 'asc' } } },
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[PUT /api/disposal-schemes/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新处置方案失败', 500)
  }
}
