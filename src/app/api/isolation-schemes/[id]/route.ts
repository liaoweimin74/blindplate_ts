import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, num, parseId, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** PUT /api/isolation-schemes/[id] 编辑方案（仅 DRAFT/REJECTED 可改），points 整体替换 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sid = parseId(id)
    if (!sid) return jsonError('无效的方案 ID')
    const scheme = await db.isolationScheme.findUnique({ where: { id: sid } })
    if (!scheme) return jsonError('隔离方案不存在', 404)
    if (scheme.status !== 'DRAFT' && scheme.status !== 'REJECTED') {
      return jsonError(`当前状态为 ${scheme.status}，仅草稿或被驳回状态可编辑`)
    }
    const body = await readBody(req)
    const preparedBy = body.preparedBy !== undefined ? str(body.preparedBy) : scheme.preparedBy
    if (!preparedBy) return jsonError('编制人不能为空')

    // points 传数组则整体替换，未传则保留原隔离点
    const replacePoints = Array.isArray(body.points)
    const pointsInput: any[] = replacePoints ? body.points : []
    if (replacePoints) {
      for (const p of pointsInput) {
        if (!str(p?.location) || !str(p?.blindSpec) || !str(p?.blindType)) {
          return jsonError('每个隔离点必须包含位置、盲板规格和盲板类型')
        }
        if (p?.action !== 'ADD' && p?.action !== 'REMOVE') {
          return jsonError('隔离点操作类型必须为 ADD（加装）或 REMOVE（拆除）')
        }
      }
    }

    const updated = await db.isolationScheme.update({
      where: { id: sid },
      data: {
        preparedBy,
        ...(replacePoints
          ? {
              points: {
                deleteMany: {},
                create: pointsInput.map((p, i) => ({
                  seq:
                    p?.seq !== undefined && p?.seq !== null && Number.isFinite(Number(p.seq))
                      ? Number(p.seq)
                      : i + 1,
                  location: str(p.location),
                  medium: str(p.medium) || null,
                  pressure: str(p.pressure) || null,
                  temperature: str(p.temperature) || null,
                  blindSpec: str(p.blindSpec),
                  blindType: str(p.blindType),
                  action: p.action,
                  blindPlateId: num(p.blindPlateId),
                  // 主数据关联字段透传（宽松：数字/字符串均可，空则 null）
                  code: str(p.code) || null,
                  name: str(p.name) || null,
                  masterPointId: num(p.masterPointId),
                  masterCode: str(p.masterCode) || null,
                })),
              },
            }
          : {}),
      },
      include: { points: { orderBy: { seq: 'asc' } } },
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[PUT /api/isolation-schemes/[id]]', e)
    return jsonError(e instanceof Error ? e.message : '更新隔离方案失败', 500)
  }
}
