'use client'

// 方案打印视图：隔离方案 / 工艺处置方案 A4 版式 + 二维码防伪 + window.print()
// 用法一（触发式）：<SchemePrintDialog open onOpenChange type data /> 弹窗内嵌 A4 预览与"打印/导出 PDF"按钮
// 用法二（嵌入式）：<SchemePrintSheet type data /> 纯 A4 单据，可嵌入任意预览容器
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { apiGet, fmtDateTime } from '@/lib/bp-api'
import {
  WORK_TYPE_MAP, POINT_ACTION_MAP, DISPOSAL_METHOD_MAP, SCHEME_STATUS_MAP,
} from '@/lib/bp-types'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Printer, Loader2 } from 'lucide-react'

// ============ 打印数据契约 ============
export type SchemePrintType = 'ISOLATION' | 'DISPOSAL'

/** 作业需求信息（打印单据抬头用） */
export interface SchemePrintRequest {
  code: string
  title: string
  workType: string
  unitName?: string | null
  location?: string | null
  pipelineName?: string | null
  medium?: string | null
  pressure?: string | null
  temperature?: string | null
}

/** 方案信息（编制/审核） */
export interface SchemePrintScheme {
  code: string
  preparedBy: string
  preparedAt: string | Date
  status: string
  reviewedBy?: string | null
  reviewedAt?: string | Date | null
  comment?: string | null
}

/** 隔离点（打印明细行） */
export interface SchemePrintPoint {
  seq: number
  location: string
  medium?: string | null
  blindSpec: string
  blindType: string
  action: string
  blindPlateId?: number | null
}

/** 工艺处置步骤（打印明细行，含合格标准） */
export interface SchemePrintStep {
  seq: number
  method: string
  detail: string
  standard?: string | null
  completed?: boolean
}

/** 打印组件完整入参 */
export interface SchemePrintData {
  request: SchemePrintRequest
  scheme: SchemePrintScheme
  points?: SchemePrintPoint[] | null
  steps?: SchemePrintStep[] | null
}

interface PlateLite { id: number; code: string }

/** QR 内容：单据编号（扫码核验方案真伪） */
function qrPayload(type: SchemePrintType, code: string) {
  return `BPMS|${type === 'ISOLATION' ? 'ISO-SCHEME' : 'DISPOSAL-SCHEME'}|${code}`
}

/** 预留盲板列文案：优先盲板编号，拆除点未绑定时提示现场确认 */
function plateText(p: SchemePrintPoint, plateNames: Record<number, string>) {
  if (p.blindPlateId) return plateNames[p.blindPlateId] ?? `#${p.blindPlateId}`
  return p.action === 'REMOVE' ? '执行时确认' : '-'
}

// ============ A4 单据本体 ============
export function SchemePrintSheet({ type, data }: { type: SchemePrintType; data: SchemePrintData }) {
  const isIso = type === 'ISOLATION'
  const { request, scheme } = data
  const points = data.points ?? []
  const steps = data.steps ?? []
  const statusLabel = SCHEME_STATUS_MAP[scheme.status]?.label ?? scheme.status

  const [qr, setQr] = useState('')
  const [plateNames, setPlateNames] = useState<Record<number, string>>({})
  // 打印时间以打开单据那一刻为准，避免重渲染时跳动
  const [printedAt] = useState(() => fmtDateTime(new Date()))

  useEffect(() => {
    QRCode.toDataURL(qrPayload(type, scheme.code), { width: 220, margin: 1, color: { dark: '#1c1917', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [type, scheme.code])

  // 隔离点"预留盲板"列需要盲板编号，拉全量台账做 id→编号 映射
  useEffect(() => {
    if (!isIso) return
    let alive = true
    apiGet<PlateLite[]>('/api/blind-plates')
      .then((list) => {
        if (!alive) return
        const m: Record<number, string> = {}
        for (const p of list) m[p.id] = p.code
        setPlateNames(m)
      })
      .catch(() => { if (alive) setPlateNames({}) })
    return () => { alive = false }
  }, [isIso])

  const fmt = (v?: string | Date | null) => (v ? fmtDateTime(v as string) : '—')

  return (
    <div id="bp-scheme-print-sheet"
      className="max-w-[794px] mx-auto bg-white text-stone-900 shadow-2xl rounded-sm p-8 space-y-4 origin-top">
      <style>{`
        #bp-scheme-print-sheet { font-family: "Songti SC","SimSun",serif; }
        #bp-scheme-print-sheet table { border-collapse: collapse; }
        #bp-scheme-print-sheet td, #bp-scheme-print-sheet th { border: 1px solid #d6d3d1; }
      `}</style>

      {/* 标题区：GB 30871 抬头 + 单据编号 + 打印时间 + 二维码 */}
      <div className="flex items-start justify-between gap-4 border-b-2 border-stone-800 pb-3">
        <div>
          <div className="text-[11px] tracking-[0.3em] text-stone-500">
            ××石化 · {isIso ? 'BLIND PLATE ISOLATION SCHEME' : 'BLIND PLATE DISPOSAL SCHEME'}
          </div>
          <h1 className="text-2xl font-bold tracking-widest mt-0.5">盲板抽堵作业{isIso ? '隔离方案' : '工艺处置方案'}</h1>
          <div className="text-xs text-stone-500 mt-1">依据 GB 30871《危险化学品企业特殊作业安全规范》编制</div>
        </div>
        <div className="text-right space-y-1 shrink-0">
          {qr ? (
            <img src={qr} alt="方案核验二维码" className="w-20 h-20 border border-stone-300 p-0.5" />
          ) : (
            <div className="w-20 h-20 border border-stone-300 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-stone-300" />
            </div>
          )}
          <div className="font-mono text-sm font-bold">{scheme.code}</div>
          <div className="text-[11px] text-stone-500">打印时间：{printedAt}</div>
          <div className="text-[11px] px-2 py-0.5 border border-stone-400 text-stone-700 inline-block">{statusLabel}</div>
        </div>
      </div>

      {/* 一、作业需求信息 */}
      <div>
        <div className="text-xs font-bold mb-1.5">一、作业需求信息</div>
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">关联需求</td>
              <td className="px-2 py-1.5 font-mono w-[20%]">{request.code}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">需求标题</td>
              <td className="px-2 py-1.5" colSpan={3}>{request.title}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">所属装置</td>
              <td className="px-2 py-1.5">{request.unitName ?? '-'}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">作业位置</td>
              <td className="px-2 py-1.5" colSpan={3}>{request.location ?? '-'}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">管线名称</td>
              <td className="px-2 py-1.5">{request.pipelineName ?? '-'}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">介质</td>
              <td className="px-2 py-1.5 w-[20%]">{request.medium ?? '-'}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">作业类型</td>
              <td className="px-2 py-1.5">{WORK_TYPE_MAP[request.workType] ?? request.workType}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">管线压力</td>
              <td className="px-2 py-1.5">{request.pressure ?? '-'}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">管线温度</td>
              <td className="px-2 py-1.5" colSpan={3}>{request.temperature ?? '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 二、方案信息（编制 / 审核） */}
      <div>
        <div className="text-xs font-bold mb-1.5">二、方案信息</div>
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">编制人</td>
              <td className="px-2 py-1.5 w-[20%]">{scheme.preparedBy}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">编制时间</td>
              <td className="px-2 py-1.5 w-[20%]">{fmt(scheme.preparedAt)}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium w-[13%]">方案状态</td>
              <td className="px-2 py-1.5">{statusLabel}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">审核人</td>
              <td className="px-2 py-1.5">{scheme.reviewedBy ?? '待审核'}</td>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">审核时间</td>
              <td className="px-2 py-1.5">{fmt(scheme.reviewedAt)}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 px-2 py-1.5 font-medium">审核意见</td>
              <td className="px-2 py-1.5" colSpan={5}>{scheme.comment ?? (scheme.status === 'APPROVED' ? '—' : '待审核')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 三、明细表：隔离点 / 处置步骤（含合格标准列） */}
      <div>
        <div className="text-xs font-bold mb-1.5">{isIso ? '三、隔离点明细' : '三、工艺处置步骤'}</div>
        {isIso ? (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-stone-100">
                <th className="px-2 py-1.5 w-10 font-medium">序号</th>
                <th className="px-2 py-1.5 text-left font-medium">隔离位置</th>
                <th className="px-2 py-1.5 text-left font-medium w-20">介质</th>
                <th className="px-2 py-1.5 text-left font-medium w-20">盲板规格</th>
                <th className="px-2 py-1.5 text-left font-medium w-24">盲板类型</th>
                <th className="px-2 py-1.5 font-medium w-20">动作</th>
                <th className="px-2 py-1.5 text-left font-medium w-32">预留盲板</th>
              </tr>
            </thead>
            <tbody>
              {points.length === 0 ? (
                <tr><td colSpan={7} className="px-2 py-3 text-center text-stone-400">无隔离点数据</td></tr>
              ) : points.map((p) => (
                <tr key={p.seq}>
                  <td className="px-2 py-1.5 text-center">{p.seq}</td>
                  <td className="px-2 py-1.5">{p.location}</td>
                  <td className="px-2 py-1.5">{p.medium ?? '-'}</td>
                  <td className="px-2 py-1.5">{p.blindSpec}</td>
                  <td className="px-2 py-1.5">{p.blindType}</td>
                  <td className="px-2 py-1.5 text-center">{POINT_ACTION_MAP[p.action] ?? p.action}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">{plateText(p, plateNames)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-stone-100">
                <th className="px-2 py-1.5 w-10 font-medium">序号</th>
                <th className="px-2 py-1.5 text-left font-medium w-24">处置方法</th>
                <th className="px-2 py-1.5 text-left font-medium">处置明细</th>
                <th className="px-2 py-1.5 text-left font-medium w-44">合格标准</th>
                <th className="px-2 py-1.5 font-medium w-20">完成状态</th>
              </tr>
            </thead>
            <tbody>
              {steps.length === 0 ? (
                <tr><td colSpan={5} className="px-2 py-3 text-center text-stone-400">无处置步骤数据</td></tr>
              ) : steps.map((s) => (
                <tr key={s.seq}>
                  <td className="px-2 py-1.5 text-center">{s.seq}</td>
                  <td className="px-2 py-1.5">{DISPOSAL_METHOD_MAP[s.method] ?? s.method}</td>
                  <td className="px-2 py-1.5">{s.detail}</td>
                  <td className="px-2 py-1.5">{s.standard ?? '-'}</td>
                  <td className="px-2 py-1.5 text-center">{s.completed ? '已完成' : '待执行'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 四、签字栏：编制 / 审核 */}
      <div>
        <div className="text-xs font-bold mb-1.5">四、签字确认</div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          {([['编制人签字', scheme.preparedBy], ['审核人签字', scheme.reviewedBy ?? '（待审核）']] as const).map(([label, name]) => (
            <div key={label} className="border border-stone-400 h-16 p-1.5 flex flex-col justify-between">
              <span className="text-[11px] text-stone-500">{label}：{name}</span>
              <span className="text-right text-[10px] text-stone-400">签字：____________　　日期：______</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] text-stone-400 text-center pt-1">
        本方案依据 GB 30871-2022 生成 · 扫描右上角二维码核验方案信息 · {isIso ? '盲板预留与执行状态以台账系统为准' : '工艺处置确认合格后方可办理作业票'}
      </div>
    </div>
  )
}

// ============ 触发式打印弹窗（Dialog 内嵌 A4 预览） ============
export default function SchemePrintDialog({ open, onOpenChange, type, data }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: SchemePrintType
  data: SchemePrintData | null
}) {
  // 打印样式隔离：打印时隐藏应用其余内容，仅输出 A4 单据
  useEffect(() => {
    if (!open) return
    const style = document.createElement('style')
    style.id = 'bp-scheme-print-style'
    style.textContent = `
      @media print {
        /* Tailwind 4 居中类编译为独立 translate 属性（非 transform）——不清除会使 DialogContent
           仍是 absolute 后代的包含块，单据整体左/上移出页面（打印只剩右边一部分） */
        body, body * { translate: none !important; rotate: none !important; scale: none !important; }
        body > *:not([data-slot='dialog-content']) { display: none !important; }
        body > [data-slot='dialog-content'] { position: static !important; inset: auto !important;
          width: auto !important; max-width: none !important; border: 0 !important; padding: 0 !important;
          background: #fff !important; box-shadow: none !important; gap: 0 !important; }
        body * { visibility: hidden !important; position: static !important;
          overflow: visible !important; max-height: none !important; transform: none !important; }
        #bp-scheme-print-sheet, #bp-scheme-print-sheet * { visibility: visible !important; }
        #bp-scheme-print-sheet { position: absolute !important; top: 0 !important; left: 0 !important;
          width: 194mm !important; max-width: none !important; margin: 0 !important; padding: 12mm !important;
          box-shadow: none !important; border-radius: 0 !important; }
        .no-print { display: none !important; }
        @page { size: A4 portrait; margin: 8mm; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('bp-scheme-print-style')?.remove() }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">方案打印预览 · {type === 'ISOLATION' ? '隔离方案' : '工艺处置方案'}</DialogTitle>
          <DialogDescription className="text-xs">
            {data
              ? `${data.scheme.code} · A4 竖版 · 点击"打印 / 导出 PDF"后可在系统打印对话框中选择"另存为 PDF"`
              : '正在准备打印数据…'}
          </DialogDescription>
        </DialogHeader>
        {data && (
          <>
            <div className="no-print flex items-center justify-between gap-2">
              <span className="text-[11px] text-stone-400">打印时将自动隐藏系统界面，仅输出 A4 单据</span>
              <Button size="sm" onClick={() => window.print()} className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5">
                <Printer className="w-3.5 h-3.5" />打印 / 导出 PDF
              </Button>
            </div>
            <SchemePrintSheet type={type} data={data} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
