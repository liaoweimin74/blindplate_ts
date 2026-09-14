import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/bp-server-utils'
import { loadReportArchive, renderAuditPdf } from '@/lib/bp-audit-pdf'

export const dynamic = 'force-dynamic'

/** GET /api/master/validate/pdf?reportId=xxx → 渲染体检报告 PDF（渲染后落盘存档）并返回下载流 */
export async function GET(req: NextRequest) {
  try {
    const reportId = req.nextUrl.searchParams.get('reportId')?.trim()
    if (!reportId) return jsonError('缺少 reportId 参数', 400)
    const data = loadReportArchive(reportId)
    if (!data) return jsonError(`报告 ${reportId} 不存在`, 404)
    const buf = await renderAuditPdf(data)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${reportId}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'PDF 生成失败', 500)
  }
}
