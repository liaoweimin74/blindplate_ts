'use client'

/**
 * 隔离点二维码标签打印（Task 96 需求 10）：现场没有标签的隔离点，打印后张贴，即可扫码加入/核对位置。
 * - QR 协议：BPMS|ISO-POINT|{masterPointId}|{masterCode}（见 lib/bp-iso-qr）
 * - 入口：移动端现场勘察页「打印二维码标签」；A4 网格排版，window.print + @media print 隔离
 *   （打印样式模式参考 plate-label-print.tsx / ticket-print.tsx）
 */

import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { QrCode, Printer, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { isoQrPayload } from '@/lib/bp-iso-qr'

export interface IsoLabelPoint {
  id: number
  code: string
  name?: string | null
  location?: string | null
  pipelineName?: string | null
}

const SHEET_ID = 'bp-iso-label-sheet'
const STYLE_ID = 'bp-iso-label-print-style'

export function IsoLabelPrintDialog(props: {
  open: boolean
  onClose: () => void
  points: IsoLabelPoint[]
  /** 默认勾选（如勘察页已选点）；不传默认全选 */
  defaultSelectedIds?: number[]
}) {
  const { open, onClose, points, defaultSelectedIds } = props
  const { toast } = useToast()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [qrMap, setQrMap] = useState<Map<number, string>>(new Map())
  const [printing, setPrinting] = useState(false)

  // 打开时默认勾选 + 批量生成二维码（标签量小，一次生成）
  useEffect(() => {
    if (!open) return
    setSelected(new Set(defaultSelectedIds?.length ? defaultSelectedIds : points.map((p) => p.id)))
    let cancelled = false
    void (async () => {
      const m = new Map<number, string>()
      for (const p of points) {
        try {
          m.set(p.id, await QRCode.toDataURL(isoQrPayload(p.id, p.code), { width: 320, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }))
        } catch { /* 单点生成失败跳过 */ }
        if (cancelled) return
      }
      setQrMap(m)
    })()
    return () => { cancelled = true }
  }, [open, points, defaultSelectedIds])

  const picked = useMemo(() => points.filter((p) => selected.has(p.id)), [points, selected])

  // 打印隔离：只显示标签网格（A4），其余全部隐藏
  useEffect(() => {
    if (!open) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      @media print {
        body, body * { translate: none !important; rotate: none !important; scale: none !important; }
        body > *:not(:has(#${SHEET_ID})) { display: none !important; }
        body * { visibility: hidden !important; }
        #${SHEET_ID}, #${SHEET_ID} * { visibility: visible !important;
          -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        #${SHEET_ID} { position: fixed !important; inset: 0 !important; border-radius: 0 !important; box-shadow: none !important; padding: 4mm !important; }
        @page { size: A4; margin: 8mm; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById(STYLE_ID)?.remove() }
  }, [open])

  const handlePrint = () => {
    if (printing || picked.length === 0) return
    setPrinting(true)
    window.setTimeout(() => {
      try {
        window.print()
        toast({ title: '打印任务已发送', description: `隔离点标签 ${picked.length} 张（70mm×37mm 网格）` })
      } finally {
        setPrinting(false)
      }
    }, 180)
  }

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const now = new Date()
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full sm:max-w-[640px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-base">
            <QrCode className="w-4 h-4 text-teal-600" />打印隔离点二维码标签
          </DialogTitle>
          <DialogDescription>
            勾选需要打印的隔离点，打印后张贴在现场对应位置；移动端扫码即可加入勘察或核对作业位置
          </DialogDescription>
        </DialogHeader>

        {/* 点位勾选列表 */}
        <div className="rounded-xl border border-stone-100 divide-y divide-stone-50 max-h-56 overflow-y-auto">
          {points.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-2.5 py-2">
              <Checkbox id={`iso-label-${p.id}`} checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
              <Label htmlFor={`iso-label-${p.id}`} className="flex-1 min-w-0 cursor-pointer text-xs text-stone-700">
                <span className="font-mono font-medium">{p.code}</span>
                <span className="text-stone-500"> {p.name ?? ''}</span>
                {p.location && <span className="text-stone-400"> · {p.location}</span>}
              </Label>
            </div>
          ))}
          {points.length === 0 && <p className="text-xs text-stone-400 px-3 py-6 text-center">暂无隔离点主数据</p>}
        </div>

        {/* 标签预览（打印即此区域） */}
        <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
          <p className="text-[10px] text-stone-400 mb-2">标签预览（70mm × 37mm，A4 网格）</p>
          <div id={SHEET_ID} className="grid grid-cols-2 gap-2.5">
            {picked.length === 0 && qrMap.size === 0 ? (
              <div className="col-span-2 flex items-center justify-center py-8 text-stone-300"><Skeleton className="h-16 w-full" /></div>
            ) : picked.map((p) => (
              <div key={p.id} className="bp-iso-label relative flex gap-2 items-center rounded-lg border-2 border-emerald-600 bg-white px-2 py-1.5" style={{ width: '70mm', height: '37mm' }}>
                <div className="shrink-0 flex flex-col items-center gap-0.5">
                  {qrMap.get(p.id) ? (
                    <img src={qrMap.get(p.id)} alt={`隔离点 ${p.code} 二维码`} className="bp-label-qr w-[26mm] h-[26mm]" />
                  ) : (
                    <div className="w-[26mm] h-[26mm] flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-stone-300" /></div>
                  )}
                  <span className="text-[7px] text-stone-400 leading-none">BPMS 隔离点标签</span>
                </div>
                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <p className="text-[9px] font-bold text-emerald-700 leading-tight">石化盲板管理系统</p>
                  <p className="font-mono text-[11px] font-bold text-stone-900 leading-tight break-all">{p.code}</p>
                  <p className="text-[9px] text-stone-700 leading-tight break-words">{p.name ?? '—'}</p>
                  {p.location && <p className="text-[8px] text-stone-500 leading-tight break-words">位置：{p.location}</p>}
                  {p.pipelineName && <p className="text-[8px] text-stone-500 leading-tight truncate">管线：{p.pipelineName}</p>}
                  <p className="text-[7px] text-stone-400 mt-auto leading-none">{stamp} 打印</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-stone-400">已选 {picked.length}/{points.length}</span>
          <Button variant="outline" className="ml-auto h-8 text-xs" onClick={onClose}>取消</Button>
          <Button className={cn('h-8 text-xs text-white', picked.length ? 'bg-teal-600 hover:bg-teal-700' : 'bg-stone-300')} onClick={handlePrint} disabled={!picked.length || printing}>
            {printing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Printer className="w-3.5 h-3.5 mr-1" />}
            打印标签（{picked.length} 张）
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
