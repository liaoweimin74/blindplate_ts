import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/audit-logs
 * 操作审计日志查询（分页 + 筛选）
 * query: entity=USER|UNIT|DICT|ANNOUNCEMENT|AUTH|INVENTORY|WORK_REQUEST|ISOLATION_SCHEME|DISPOSAL_SCHEME|WORK_TICKET|WORK_TASK|JSA|ACCEPTANCE,
 *        action=CREATE|UPDATE|DELETE|SUBMIT|APPROVE|REJECT|STATUS_CHANGE|START|COMPLETE|CANCEL|...,
 *        keyword=（操作人/对象编号/详情模糊）, page=1, pageSize=20
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const entity = str(sp.get('entity'))
    const action = str(sp.get('action'))
    const keyword = str(sp.get('keyword'))
    const page = Math.max(1, Number(sp.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(5, Number(sp.get('pageSize')) || 20))

    const where: {
      entity?: string
      action?: string
      OR?: { actorName?: { contains: string }; entityCode?: { contains: string }; detail?: { contains: string } }[]
    } = {}
    if (entity) where.entity = entity
    if (action) where.action = action
    if (keyword) {
      where.OR = [
        { actorName: { contains: keyword } },
        { entityCode: { contains: keyword } },
        { detail: { contains: keyword } },
      ]
    }

    const [total, logs] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return NextResponse.json({ logs, total, page, pageSize })
  } catch (e) {
    console.error('[GET /api/audit-logs]', e)
    return jsonError(e instanceof Error ? e.message : '获取操作日志失败', 500)
  }
}
