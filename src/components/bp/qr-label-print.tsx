'use client'
/**
 * QrLabelPrint（需求10）：隔离点二维码标签打印预览
 * —— 二维码协议与扫码核对一致（BPISO|{code}）；A4 网格 3×8 标签卡，复用作业票打印的样式注入范式
 */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Printer, X, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtDateTime } from '@/lib/bp-api'

export interface QrLabelPoint {
  code: string
  name?: string | null
  location?: string | null
}

const qrPayload = (code: string) => `BPISO|${code}`

export default function QrLabelPrint({ open, onClose, points, title }: {
  open: boolean
  onClose: () => void
  points: QrLabelPoint[]
  /** 场景说明（打印提示行用） */
  title?: string
}) {
  const [qrs, setQrs] = useState<Record<string, string>>({})
  const [printedAt, setPrintedAt] = useState('')

  useEffect(() => {
    if (!open) return
    const ts = fmtDateTime(new Date())
    const map: Record<string, string> = {}
    Promise.all(
      points.map(async (p) => {
        try {
          map[p.code] = await QRCode.toDataURL(qrPayload(p.code), { width: 220, margin: 0, color: { dark: '#1c1917', light: '#ffffff' } })
        } catch {
          map[p.code] = ''
        }
      }),
    ).then(() => {
      setQrs({ ...map })
      setPrintedAt(ts)
    })
  }, [open, points])

  // 打印时隐藏其余内容（与 ticket-print 同款可见性切换方案）
  useEffect(() => {
    if (!open) return
    const style = document.createElement('style')
    style.id = 'bp-label-print-style'
    style.textContent = `
      @media print {
        body, body * { translate: none !important; rotate: none !important; scale: none !important; }
        body * { visibility: hidden !important; }
        #bp-label-sheet, #bp-label-sheet * { visibility: visible !important; }
        #bp-label-sheet { position: fixed !important; inset: 0 !important; margin: 0 !important;
          max-height: none !important; box-shadow: none !important; border-radius: 0 !important;
          background: #fff !important; padding: 6mm !important; overflow: visible !important; }
        .no-print { display: none !important; }
        @page { size: A4 portrait; margin: 8mm; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('bp-label-print-style')?.remove() }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] overflow-auto bg-stone-900/70 px-3 py-6 backdrop-blur-sm" onClick={onClose}>
      <div className="no-print mx-auto mb-3 flex max-w-[794px] items-center justify-between">
        <div className="text-xs text-stone-300">
          {title ?? '隔离点二维码标签'} · 共 {points.length} 张 · 二维码协议 BPISO|点位编码
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => window.print()} className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800" disabled={points.length === 0}>
            <Printer className="h-3.5 w-3.5" />打印
          </Button>
          <Button size="sm" variant="outline" onClick={onClose} className="gap-1.5 bg-white"><X className="h-3.5 w-3.5" />关闭</Button>
        </div>
      </div>

      <div
        id="bp-label-sheet"
        className="mx-auto max-w-[794px] rounded-sm bg-white p-4 text-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {points.length === 0 ? (
          <p className="py-16 text-center text-xs text-stone-400">没有可打印的隔离点标签</p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {points.map((p) => (
              <div key={p.code} className="flex gap-2 rounded-md border-2 border-stone-800 p-1.5" style={{ width: '62mm', height: '36mm' }}>
                <div className="flex shrink-0 flex-col items-center justify-center">
                  {qrs[p.code] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrs[p.code]} alt={`${p.code} 二维码`} style={{ width: '24mm', height: '24mm' }} />
                  ) : (
                    <div className="flex items-center justify-center rounded border border-dashed border-stone-300" style={{ width: '24mm', height: '24mm' }}>
                      <QrCode className="h-5 w-5 text-stone-300" />
                    </div>
                  )}
                  <span className="mt-0.5 font-mono text-[8px] leading-none text-stone-500">BPISO|{p.code}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col py-0.5">
                  <div className="text-[7px] font-semibold uppercase tracking-wider text-stone-400">Blind Plate Isolation</div>
                  <div className="truncate font-mono text-[13px] font-bold leading-tight text-stone-900">{p.code}</div>
                  {p.name && <div className="mt-0.5 line-clamp-2 text-[10px] font-semibold leading-snug text-stone-700">{p.name}</div>}
                  {p.location && <div className="mt-0.5 line-clamp-2 text-[8px] leading-snug text-stone-500">{p.location}</div>}
                  <div className="mt-auto border-t border-stone-200 pt-0.5 text-[7px] leading-tight text-stone-400">
                    石化盲板管理系统 BPMS · 扫码核对隔离点
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="no-print mt-3 text-center text-[10px] text-stone-400">打印时间 {printedAt} · 建议覆膜后粘贴至隔离点法兰旁</div>
      </div>
    </div>
  )
}
