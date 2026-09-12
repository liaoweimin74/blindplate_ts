'use client'

// 作业票打印视图：A4 版式 + 二维码防伪 + window.print()
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { apiGet, fmtDateTime } from '@/lib/bp-api'
import { WORK_TYPE_MAP, PLATE_STATUS_MAP } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Printer, X, Loader2 } from 'lucide-react'

export interface PrintTicket {
  code: string
  plannedStart: string | Date
  plannedEnd: string | Date
  guardian: string
  workers: string
  issuer: string
  safetyMeasures: string
  status: string
  pointId?: number | null
  pointCode?: string | null
  pointLocation?: string | null
  blindSpec?: string | null
  blindType?: string | null
  action?: string | null
  comment?: string | null
  approvedBy?: string | null
  approvedAt?: string | Date | null
  startedAt?: string | Date | null
  finishedAt?: string | Date | null
  closedAt?: string | Date | null
  createdAt?: string | Date
}
export interface PrintRequest {
  id: number
  code: string
  title: string
  workType: string
  location: string
  pipelineName?: string | null
  medium?: string | null
  pressure?: string | null
  temperature?: string | null
  unitName?: string | null
  applicantName: string
}
interface PrintPoint {
  seq: number; location: string; medium: string | null; blindSpec: string
  blindType: string; action: string; done: boolean; operator: string | null
}

const TICKET_STATUS_TXT: Record<string, string> = {
  DRAFT: '待签发', PENDING_REVIEW: '待批准', APPROVED: '已批准',
  IN_PROGRESS: '作业中', FINISHED: '已完工', CLOSED: '已关闭', VOID: '已作废',
}

/** QR 内容：票号 + 需求号 + 时间戳（扫码可核验票证真伪） */
function qrPayload(t: PrintTicket, r: PrintRequest) {
  const ts = t.createdAt ? new Date(t.createdAt).getTime() : 0
  return `BPMS|BLIND-TICKET|${t.code}|${r.code}|${ts}`
}

export default function TicketPrint({ ticket, workRequest, onClose }: {
  ticket: PrintTicket
  workRequest: PrintRequest
  onClose: () => void
}) {
  const [qr, setQr] = useState('')
  const [points, setPoints] = useState<PrintPoint[] | null>(null)

  useEffect(() => {
    QRCode.toDataURL(qrPayload(ticket, workRequest), { width: 220, margin: 1, color: { dark: '#1c1917', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [ticket, workRequest])

  useEffect(() => {
    let alive = true
    ;(async () => {
      // 隔离点：需求 → 隔离方案 → points
      try {
        const scheme = await apiGet<{ points?: PrintPoint[] }>(`/api/isolation-schemes?workRequestId=${workRequest.id}`)
        if (alive) setPoints(scheme?.points ?? [])
      } catch {
        if (alive) setPoints([])
      }
    })()
    return () => { alive = false }
  }, [workRequest.id])

  // 打印时隐藏其余内容
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'bp-print-style'
    style.textContent = `
      @media print {
        /* Tailwind 4 独立 translate 属性会劫持 fixed 定位包含块（打印偏移），统一清除 */
        body, body * { translate: none !important; rotate: none !important; scale: none !important; }
        body * { visibility: hidden !important; }
        #bp-print-sheet, #bp-print-sheet * { visibility: visible !important; }
        #bp-print-sheet { position: fixed !important; inset: 0 !important; margin: 0 !important;
          max-height: none !important; box-shadow: none !important; border-radius: 0 !important;
          width: 194mm !important; min-height: 100vh; padding: 12mm !important; }
        .no-print { display: none !important; }
        @page { size: A4 portrait; margin: 8mm; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('bp-print-style')?.remove() }
  }, [])

  const fmt = (v?: string | Date | null) => (v ? fmtDateTime(v as string) : '-')

  return (
    <div className="fixed inset-0 z-[100] bg-stone-900/70 backdrop-blur-sm overflow-auto py-6 px-3" onClick={onClose}>
      <style>{`
        #bp-print-sheet { font-family: "Songti SC","SimSun",serif; }
        #bp-print-sheet table { border-collapse: collapse; }
        #bp-print-sheet td, #bp-print-sheet th { border: 1px solid #44403c; }
      `}</style>
      <div className="no-print max-w-[794px] mx-auto mb-3 flex items-center justify-between">
        <div className="text-xs text-stone-300">作业票打印预览 · A4 竖版 · 扫码可核验票证</div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => window.print()} className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5">
            <Printer className="w-3.5 h-3.5" />打印
          </Button>
          <Button size="sm" variant="outline" onClick={onClose} className="gap-1.5 bg-white"><X className="w-3.5 h-3.5" />关闭</Button>
        </div>
      </div>

      <div id="bp-print-sheet"
        className="max-w-[794px] mx-auto bg-white text-stone-900 shadow-2xl rounded-sm p-8 space-y-4 origin-top"
        onClick={(e) => e.stopPropagation()}>
        {/* 标题区 */}
        <div className="flex items-start justify-between gap-4 border-b-2 border-stone-800 pb-3">
          <div>
            <div className="text-[11px] tracking-[0.3em] text-stone-500">BLIND PLATE WORK PERMIT</div>
            <h1 className="text-2xl font-bold tracking-widest mt-0.5">盲板抽堵安全作业票</h1>
            <div className="text-xs text-stone-500 mt-1">依据 GB 30871《危险化学品企业特殊作业安全规范》</div>
          </div>
          <div className="text-right space-y-1">
            {qr ? (
              <img src={qr} alt="作业票核验二维码" className="w-20 h-20 border border-stone-300 p-0.5" />
            ) : (
              <div className="w-20 h-20 border border-stone-300 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-stone-300" /></div>
            )}
            <div className="font-mono text-sm font-bold">{ticket.code}</div>
            <div className={cn('text-[11px] px-2 py-0.5 border inline-block',
              ticket.status === 'APPROVED' || ticket.status === 'CLOSED' ? 'border-emerald-600 text-emerald-700' : 'border-amber-600 text-amber-700')}>
              {TICKET_STATUS_TXT[ticket.status] ?? ticket.status}
            </div>
          </div>
        </div>

        {/* 基本信息 */}
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">关联需求</td>
              <td className="px-2 py-1.5 font-mono w-[20%]">{workRequest.code}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">所属装置</td>
              <td className="px-2 py-1.5 w-[20%]">{workRequest.unitName ?? '-'}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">作业类型</td>
              <td className="px-2 py-1.5 w-[21%]">{WORK_TYPE_MAP[workRequest.workType] ?? workRequest.workType}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">作业位置</td>
              <td className="px-2 py-1.5" colSpan={3}>{workRequest.location}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">管线名称</td>
              <td className="px-2 py-1.5">{workRequest.pipelineName ?? '-'}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">介质</td>
              <td className="px-2 py-1.5">{workRequest.medium ?? '-'}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">管线压力</td>
              <td className="px-2 py-1.5">{workRequest.pressure ?? '-'}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">管线温度</td>
              <td className="px-2 py-1.5">{workRequest.temperature ?? '-'}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">计划开始</td>
              <td className="px-2 py-1.5">{fmt(ticket.plannedStart)}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">计划结束</td>
              <td className="px-2 py-1.5">{fmt(ticket.plannedEnd)}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">实际完工</td>
              <td className="px-2 py-1.5">{fmt(ticket.finishedAt)}</td>
            </tr>
          </tbody>
        </table>

        {/* 本票作业内容（一票一板：票只对应一个隔离点的一个盲板作业） */}
        {ticket.pointId != null && (
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">本票作业内容</td>
                <td className="px-2 py-1.5 font-medium" colSpan={5}>
                  {ticket.action === 'ADD' ? '加装' : ticket.action === 'REMOVE' ? '拆除' : '盲板作业'}
                  {ticket.blindSpec ? ` ${ticket.blindSpec}` : ''}{ticket.blindType ? `（${ticket.blindType}）` : ''}盲板
                  {ticket.pointCode ? ` @ ${ticket.pointCode}` : ''}{ticket.pointLocation ? `（${ticket.pointLocation}）` : ''}
                  <span className="ml-2 rounded border border-stone-400 px-1 py-0.5 text-[10px] font-normal">一票一板 · GB 30871-2022</span>
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {/* 人员 */}
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">签发人</td>
              <td className="px-2 py-1.5 w-[20%]">{ticket.issuer}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">监护人</td>
              <td className="px-2 py-1.5 w-[20%]">{ticket.guardian}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">批准人</td>
              <td className="px-2 py-1.5">{ticket.approvedBy ?? '-'}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">作业人员</td>
              <td className="px-2 py-1.5" colSpan={5}>{ticket.workers || '-'}</td>
            </tr>
          </tbody>
        </table>

        {/* 安全措施 */}
        <div>
          <div className="text-xs font-bold mb-1.5">安全措施</div>
          <div className="border border-stone-700 px-3 py-2 text-xs leading-relaxed whitespace-pre-line min-h-[48px]">
            {ticket.safetyMeasures || '（无）'}
          </div>
        </div>

        {/* 隔离点明细 */}
        <div>
          <div className="text-xs font-bold mb-1.5">盲板抽堵明细（隔离点）</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-stone-100">
                <th className="px-2 py-1.5 w-8 font-medium">序号</th>
                <th className="px-2 py-1.5 text-left font-medium">抽堵位置</th>
                <th className="px-2 py-1.5 text-left font-medium">介质</th>
                <th className="px-2 py-1.5 text-left font-medium">盲板规格</th>
                <th className="px-2 py-1.5 text-left font-medium">类型</th>
                <th className="px-2 py-1.5 w-16 font-medium">操作</th>
                <th className="px-2 py-1.5 w-20 font-medium">执行人</th>
              </tr>
            </thead>
            <tbody>
              {points === null ? (
                <tr><td colSpan={7} className="px-2 py-3 text-center text-stone-400">加载隔离点中…</td></tr>
              ) : points.length === 0 ? (
                <tr><td colSpan={7} className="px-2 py-3 text-center text-stone-400">无隔离点数据</td></tr>
              ) : points.map((p) => (
                <tr key={p.seq} className={ticket.pointId != null && (p as PrintPoint & { id?: number }).id === ticket.pointId ? 'bg-amber-50 font-medium' : undefined}>
                  <td className="px-2 py-1.5 text-center">{p.seq}</td>
                  <td className="px-2 py-1.5">{p.location}{ticket.pointId != null && (p as PrintPoint & { id?: number }).id === ticket.pointId && <span className="ml-1.5 rounded border border-amber-500 px-1 py-0.5 text-[10px] font-normal">本票</span>}</td>
                  <td className="px-2 py-1.5">{p.medium ?? '-'}</td>
                  <td className="px-2 py-1.5">{p.blindSpec}</td>
                  <td className="px-2 py-1.5">{p.blindType}</td>
                  <td className="px-2 py-1.5 text-center">{p.action === 'ADD' ? '加装' : '拆除'}</td>
                  <td className="px-2 py-1.5 text-center">{p.done ? (p.operator ?? '已完成') : '未执行'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 审批留痕 */}
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">签发时间</td>
              <td className="px-2 py-1.5 w-[20%]">{fmt(ticket.createdAt)}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">批准时间</td>
              <td className="px-2 py-1.5 w-[20%]">{fmt(ticket.approvedAt)}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">开工时间</td>
              <td className="px-2 py-1.5">{fmt(ticket.startedAt)}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">完工时间</td>
              <td className="px-2 py-1.5">{fmt(ticket.finishedAt)}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">关票时间</td>
              <td className="px-2 py-1.5">{fmt(ticket.closedAt)}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">审批意见</td>
              <td className="px-2 py-1.5">{ticket.comment ?? '-'}</td>
            </tr>
          </tbody>
        </table>

        {/* 签字栏 */}
        <div className="grid grid-cols-4 gap-3 pt-2 text-xs">
          {['签发人签字', '批准人签字', '监护人签字', '作业负责人签字'].map((s) => (
            <div key={s} className="border border-stone-400 h-14 p-1.5 flex flex-col justify-between">
              <span className="text-[10px] text-stone-400">{s}</span>
              <span className="text-right text-[10px] text-stone-300">日期：______</span>
            </div>
          ))}
        </div>

        <div className="text-[10px] text-stone-400 text-center pt-1">
          本作业票一式两份，一份留存备查，一份张贴作业现场 · 扫描右上角二维码核验票证信息 · 盲板状态以台账系统为准
        </div>
      </div>
    </div>
  )
}
