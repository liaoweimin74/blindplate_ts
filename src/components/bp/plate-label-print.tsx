'use client'

// 盲板台账二维码标签打印：单标签 Dialog + 批量打印视图（Task 13-a）
// QR 协议：BPMS|BLIND-PLATE|{盲板编号} —— 与移动端扫码 parseScanCode（12-b 前瞻兼容）及
// 作业票/方案打印件 BPMS| 前缀约定一致；打印样式模式参考 ticket-print.tsx（window.print + @media print 隔离）
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { apiGet } from '@/lib/bp-api'
import { PLATE_STATUS_MAP } from '@/lib/bp-types'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { Copy, Loader2, Printer, QrCode, X } from 'lucide-react'

// ============ 类型与常量 ============

export interface PlateLabelData {
  id: number
  code: string
  spec: string
  type: string
  material: string
  pressureRating: string
  thickness: number
  status: string
  location?: string | null
  unitId?: number | null
}

export type LabelSize = 'S' | 'M'

/** 尺寸预设：预览用 px，打印用 mm（@page 出纸尺寸与标签耗材一致） */
const SIZE_META: Record<LabelSize, {
  name: string
  qrPx: number       // 预览二维码边长（≥128px）
  cardW: number      // 预览卡宽
  cardMmW: number    // 打印卡宽
  cardMmH: number    // 打印卡高
  qrMm: number       // 打印二维码边长
  batchCols: number  // A4 批量打印每行列数
  pageMm: string     // 单张出纸 @page size
}> = {
  S: { name: '小 60×40', qrPx: 128, cardW: 260, cardMmW: 58, cardMmH: 38, qrMm: 27, batchCols: 3, pageMm: '62mm 42mm' },
  M: { name: '中 80×50', qrPx: 152, cardW: 330, cardMmW: 78, cardMmH: 48, qrMm: 33, batchCols: 2, pageMm: '82mm 52mm' },
}

const SINGLE_STYLE_ID = 'bp-plate-label-print-style'
const BATCH_STYLE_ID = 'bp-plate-label-batch-print-style'
const SINGLE_SHEET_ID = 'bp-plate-label-sheet'
const BATCH_SHEET_ID = 'bp-plate-label-batch'
const BATCH_OVERLAY_ID = 'bp-label-batch-overlay'

/** 盲板二维码协议载荷（移动端扫码端到端联调的约定串） */
export function plateQrPayload(code: string): string {
  return `BPMS|BLIND-PLATE|${code}`
}

// ============ 数据钩子 ============

interface UnitRow {
  id: number
  name: string
}

/** 装置映射（unitId → 装置名），标签「装置/位置」行使用；失败静默（仅显示位置） */
function useUnitMap(): Record<number, string> {
  const [unitMap, setUnitMap] = useState<Record<number, string>>({})
  useEffect(() => {
    let alive = true
    apiGet<UnitRow[]>('/api/units')
      .then((rows) => {
        if (!alive) return
        const map: Record<number, string> = {}
        for (const u of rows) map[u.id] = u.name
        setUnitMap(map)
      })
      .catch(() => { /* 装置名缺失时标签仅显示位置 */ })
    return () => { alive = false }
  }, [])
  return unitMap
}

/** 生成盲板二维码 dataURL（PNG，深色 stone-900 与打印件防伪码同色系） */
function usePlateQr(code: string): string {
  const [qr, setQr] = useState('')
  useEffect(() => {
    if (!code) return
    let alive = true
    QRCode.toDataURL(plateQrPayload(code), {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1c1917', light: '#ffffff' },
    })
      .then((url) => { if (alive) setQr(url) })
      .catch(() => { if (alive) setQr('') })
    return () => { alive = false }
  }, [code])
  return qr
}

// ============ 标签卡片 ============

interface PlateLabelCardProps {
  plate: PlateLabelData
  unitName?: string
  size: LabelSize
  showStatus: boolean
  qr: string
  /** 打印隔离用 DOM id（单张打印时指向标签本体） */
  domId?: string
  /** 批量模式下卡片宽度跟随网格列宽 */
  fullWidth?: boolean
}

function PlateLabelCard({ plate, unitName, size, showStatus, qr, domId, fullWidth }: PlateLabelCardProps) {
  const meta = SIZE_META[size]
  const statusMeta = PLATE_STATUS_MAP[plate.status]
  const placeText = [unitName, plate.location].filter(Boolean).join(' ')
  return (
    <div
      id={domId}
      className="bp-label-card flex flex-col justify-between overflow-hidden rounded-lg border-2 border-stone-800 bg-white p-2.5 text-stone-900 shadow-sm select-none"
      style={fullWidth ? undefined : { width: meta.cardW }}
    >
      {/* 编号整行大字（等宽加粗），避免窄标签下被挤压换行 */}
      <div className="bp-label-code font-mono text-lg leading-tight font-bold tracking-tight">{plate.code}</div>
      <div className="mt-1 flex items-start gap-2.5">
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="shrink-0 rounded-sm border border-stone-300 bg-white p-0.5 leading-none">
                {qr ? (
                  <img
                    src={qr}
                    alt={`盲板 ${plate.code} 二维码`}
                    width={meta.qrPx}
                    height={meta.qrPx}
                    style={{ width: meta.qrPx, height: meta.qrPx }}
                    className="bp-label-qr block"
                  />
                ) : (
                  <div
                    className="bp-label-qr flex items-center justify-center bg-stone-50"
                    style={{ width: meta.qrPx, height: meta.qrPx }}
                  >
                    <Loader2 className="h-5 w-5 animate-spin text-stone-300" />
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="font-mono text-xs">
              {plateQrPayload(plate.code)}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="min-w-0 flex-1">
          <div className="space-y-0.5 text-[11px] leading-snug text-stone-600">
            <div className="truncate">
              规格 <span className="font-semibold text-stone-800">{plate.spec}</span> · {plate.type}
            </div>
            <div className="truncate">{plate.material} · 厚 {plate.thickness}mm · {plate.pressureRating}</div>
            <div className="truncate">装置/位置：{placeText || '—'}</div>
          </div>
          {showStatus && (
            <Badge
              variant="outline"
              className={cn(
                'mt-1.5 h-5 px-1.5 text-[10px]',
                statusMeta?.className ?? 'bg-stone-100 text-stone-600 border-stone-200'
              )}
            >
              {statusMeta?.label ?? plate.status}
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-1.5 border-t border-dashed border-stone-300 pt-1 text-center text-[9px] tracking-[0.2em] text-stone-400">
        石化盲板管理系统 · 扫码查验盲板档案
      </div>
    </div>
  )
}

// ============ 打印选项条（尺寸 + 是否含状态） ============

function LabelOptionsBar({ size, showStatus, onSizeChange, onShowStatusChange }: {
  size: LabelSize
  showStatus: boolean
  onSizeChange: (s: LabelSize) => void
  onShowStatusChange: (v: boolean) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-medium text-stone-500">标签尺寸</span>
        <RadioGroup
          value={size}
          onValueChange={(v) => onSizeChange(v as LabelSize)}
          className="flex items-center gap-3"
        >
          {(['S', 'M'] as const).map((k) => (
            <div key={k} className="flex items-center gap-1.5">
              <RadioGroupItem value={k} id={`label-size-${k}`} />
              <Label htmlFor={`label-size-${k}`} className="cursor-pointer text-xs font-normal text-stone-700">
                {SIZE_META[k].name}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="label-show-status" checked={showStatus} onCheckedChange={onShowStatusChange} />
        <Label htmlFor="label-show-status" className="cursor-pointer text-xs font-normal text-stone-700">
          含状态信息
        </Label>
      </div>
    </div>
  )
}

// ============ 单张标签 Dialog ============

export function PlateLabelDialog({ plate, open, onOpenChange }: {
  plate: PlateLabelData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const [size, setSize] = useState<LabelSize>('M')
  const [showStatus, setShowStatus] = useState(true)
  const [printing, setPrinting] = useState(false)
  const unitMap = useUnitMap()
  const qr = usePlateQr(plate?.code ?? '')

  // 打印隔离：只显示标签本体，@page 按所选标签尺寸出纸（尺寸切换时同步更新）
  useEffect(() => {
    if (!open) return
    const meta = SIZE_META[size]
    const style = document.createElement('style')
    style.id = SINGLE_STYLE_ID
    style.textContent = `
      @media print {
        /* Tailwind 4 独立 translate 属性会劫持 fixed/absolute 定位包含块（打印偏移），统一清除 */
        body, body * { translate: none !important; rotate: none !important; scale: none !important; }
        /* 应用根节点不含标签（Dialog 在 body 门户）→ display:none 移除布局，避免标签页后跟随大量空白小页 */
        body > *:not(:has(#${SINGLE_SHEET_ID})) { display: none !important; }
        body * { visibility: hidden !important; }
        #${SINGLE_SHEET_ID}, #${SINGLE_SHEET_ID} * { visibility: visible !important;
          -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        #${SINGLE_SHEET_ID} { position: fixed !important; inset: 0 !important; margin: auto !important;
          border-radius: 0 !important; box-shadow: none !important;
          width: ${meta.cardMmW}mm !important; height: ${meta.cardMmH}mm !important; }
        #${SINGLE_SHEET_ID} .bp-label-qr { width: ${meta.qrMm}mm !important; height: ${meta.qrMm}mm !important; }
        @page { size: ${meta.pageMm}; margin: 2mm; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById(SINGLE_STYLE_ID)?.remove() }
  }, [open, size])

  const handlePrint = () => {
    if (printing || !plate) return
    setPrinting(true)
    // 短暂延迟确保打印样式注入完成后再唤起系统打印
    window.setTimeout(() => {
      try {
        window.print()
        toast({ title: '打印任务已发送', description: `盲板 ${plate.code} 标签 · 尺寸 ${SIZE_META[size].name}` })
      } finally {
        setPrinting(false)
      }
    }, 180)
  }

  const handleCopy = async () => {
    if (!plate) return
    const payload = plateQrPayload(plate.code)
    const okToast = () => toast({ title: '编码已复制', description: payload })
    try {
      await navigator.clipboard.writeText(payload)
      okToast()
    } catch {
      // 降级：非安全上下文/无剪贴板权限时用隐藏 textarea + execCommand 复制
      try {
        const ta = document.createElement('textarea')
        ta.value = payload
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        if (!ok) throw new Error('execCommand rejected')
        okToast()
      } catch {
        toast({ title: '复制失败', description: '当前浏览器不支持剪贴板访问，请手动记录编码', variant: 'destructive' })
      }
    }
  }

  const unitName = plate?.unitId != null ? unitMap[plate.unitId] : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-emerald-700" /> 打印盲板二维码标签
          </DialogTitle>
          <DialogDescription>
            二维码内容为协议串 BPMS|BLIND-PLATE|{'{盲板编号}'}，移动端「扫码」即可直读盲板档案
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <LabelOptionsBar
            size={size}
            showStatus={showStatus}
            onSizeChange={setSize}
            onShowStatusChange={setShowStatus}
          />
          <div className="flex min-h-[190px] items-center justify-center rounded-md bg-stone-100 p-5">
            {plate && (
              <PlateLabelCard
                plate={plate}
                unitName={unitName}
                size={size}
                showStatus={showStatus}
                qr={qr}
                domId={SINGLE_SHEET_ID}
              />
            )}
          </div>
          <p id="bp-plate-label-payload" className="text-center font-mono text-xs text-stone-500">
            二维码内容：<span className="text-stone-700">{plate ? plateQrPayload(plate.code) : '-'}</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void handleCopy()} disabled={!plate}>
            <Copy className="h-4 w-4" /> 复制编码
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={!plate || printing} onClick={handlePrint}>
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            {printing ? '正在发送打印…' : '打印'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ 批量打印视图 ============

/** 批量卡片：独立组件以便逐卡生成二维码 dataURL */
function BatchCard({ plate, unitName, size, showStatus }: {
  plate: PlateLabelData
  unitName?: string
  size: LabelSize
  showStatus: boolean
}) {
  const qr = usePlateQr(plate.code)
  return (
    <PlateLabelCard
      plate={plate}
      unitName={unitName}
      size={size}
      showStatus={showStatus}
      qr={qr}
      fullWidth
    />
  )
}

export function BatchLabelPrint({ open, plates, onClose }: {
  open: boolean
  plates: PlateLabelData[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const [size, setSize] = useState<LabelSize>('M')
  const [showStatus, setShowStatus] = useState(true)
  const [printing, setPrinting] = useState(false)
  const unitMap = useUnitMap()
  const meta = SIZE_META[size]

  // 打印隔离：遮罩转静态流式布局，A4 网格按尺寸排 2~3 列，卡片分页不截断
  useEffect(() => {
    if (!open) return
    const m = SIZE_META[size]
    const style = document.createElement('style')
    style.id = BATCH_STYLE_ID
    style.textContent = `
      @media print {
        /* Tailwind 4 独立 translate 属性会劫持 absolute 定位包含块（打印偏移），统一清除 */
        body, body * { translate: none !important; rotate: none !important; scale: none !important; }
        body * { visibility: hidden !important; }
        #${BATCH_SHEET_ID}, #${BATCH_SHEET_ID} * { visibility: visible !important;
          -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        /* 遮罩转为文档顶部绝对定位：标签从第一页开始，避免被隐藏的页面内容挤占首页 */
        #${BATCH_OVERLAY_ID} { position: absolute !important; left: 0 !important; top: 0 !important;
          margin: 0 !important; width: 100% !important; overflow: visible !important;
          background: none !important; backdrop-filter: none !important; padding: 0 !important; }
        #${BATCH_SHEET_ID} { position: static !important; max-height: none !important; overflow: visible !important;
          width: 100% !important; max-width: none !important; margin: 0 !important; border-radius: 0 !important;
          box-shadow: none !important; padding: 2mm !important; background: #fff !important;
          grid-template-columns: repeat(${m.batchCols}, 1fr) !important; gap: 3mm !important; }
        #${BATCH_SHEET_ID} .bp-label-card { width: 100% !important; min-height: ${m.cardMmH}mm !important;
          break-inside: avoid !important; page-break-inside: avoid !important; }
        #${BATCH_SHEET_ID} .bp-label-qr { width: ${m.qrMm}mm !important; height: ${m.qrMm}mm !important; }
        @page { size: A4 portrait; margin: 6mm; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById(BATCH_STYLE_ID)?.remove() }
  }, [open, size])

  const handlePrint = () => {
    if (printing || plates.length === 0) return
    setPrinting(true)
    window.setTimeout(() => {
      try {
        window.print()
        toast({ title: '打印任务已发送', description: `共 ${plates.length} 张盲板二维码标签 · 尺寸 ${SIZE_META[size].name}` })
      } finally {
        setPrinting(false)
      }
    }, 180)
  }

  if (!open || plates.length === 0) return null

  return (
    <div
      id={BATCH_OVERLAY_ID}
      className="fixed inset-0 z-[100] overflow-auto bg-stone-900/70 px-3 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 点击工具栏/选项不冒泡到遮罩（遮罩空白处点击才关闭） */}
      <div className="mx-auto max-w-[880px]" onClick={(e) => e.stopPropagation()}>
        {/* 工具栏（打印时隐藏） */}
        <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-stone-100">
              <Printer className="h-4 w-4" /> 批量打印盲板二维码标签
              <Badge variant="outline" className="border-stone-600 bg-stone-800 text-stone-200">
                共 {plates.length} 张
              </Badge>
            </div>
            <div className="mt-0.5 text-xs text-stone-400">
              A4 纸每页排布 {meta.batchCols} 列，标签间留白便于裁切；打印后逐张粘贴到盲板本体
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handlePrint}
              disabled={printing}
              className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800"
            >
              {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              {printing ? '正在发送打印…' : '打印'}
            </Button>
            <Button size="sm" variant="outline" onClick={onClose} className="gap-1.5 bg-white">
              <X className="h-3.5 w-3.5" /> 关闭
            </Button>
          </div>
        </div>
        {/* 打印选项（浅色条，打印时随工具栏一起隐藏） */}
        <div className="no-print mb-3">
          <LabelOptionsBar
            size={size}
            showStatus={showStatus}
            onSizeChange={setSize}
            onShowStatusChange={setShowStatus}
          />
        </div>
        {/* 标签纸面（打印时仅此节点可见） */}
        <div
          id={BATCH_SHEET_ID}
          className={cn(
            'mx-auto grid gap-3 rounded-md bg-white p-5 shadow-2xl',
            meta.batchCols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'
          )}
        >
          {plates.map((p) => (
            <BatchCard
              key={p.id}
              plate={p}
              unitName={p.unitId != null ? unitMap[p.unitId] : undefined}
              size={size}
              showStatus={showStatus}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
