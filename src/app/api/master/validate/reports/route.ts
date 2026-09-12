import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/bp-server-utils'
import { listReportArchives } from '@/lib/bp-audit-pdf'

export const dynamic = 'force-dynamic'

/** GET /api/master/validate/reports → 体检报告存档列表（upload/master-audit/） */
export async function GET() {
  try {
    return NextResponse.json({ reports: listReportArchives() })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : '读取存档失败', 500)
  }
}
