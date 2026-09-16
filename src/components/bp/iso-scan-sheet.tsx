'use client'
// 共享扫码核对 Sheet（Task 96/96-b 范式）：勘察扫码加入 / 移动端开工确认 / 隔离点执行确认 三场景共用
// 布局铁律（Task 96-b）：固定区（标题+进度+取景框）shrink-0 恒在顶部，名单/手动输入在滚动区 flex-1 min-h-0
// → 列表再长取景框不被顶走；演示环境以「点击名单项=模拟扫到其二维码」代替真实相机
import { useEffect, useMemo, useRef, useState } from 'react'
import { QrCode, ScanLine, ChevronRight, X, Loader2, CircleCheck, MapPin, ScanSearch, Printer } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'

/** 候选扫码点位（隔离点二维码：BPISO|{code} 协议，展示用 code/location） */
export interface ScanPoint {
  code: string
  name?: string | null
  location?: string | null
}

/** 扫码动画时长：扫描线扫动 1.1s 后回调 onScan（与 QrSignSheet 同款节奏） */
export const SCAN_SIM_MS = 1100

interface IsoScanSheetProps {
  open: boolean
  onClose: () => void
  /** sheet 标题（如：扫码加入勘察点位 / 扫码核对隔离点） */
  title: string
  /** 候选点位名单（点击=模拟扫描其二维码；已完成的项打勾禁用） */
  points: ScanPoint[]
  /** 已完成点位编码（进度条与打勾） */
  doneCodes?: string[]
  /** 提交中（禁用交互） */
  busy?: boolean
  /** 取景框下提示文案 */
  hint?: string
  /** 识别成功回调：code 为点位编码（调用方负责核对与提交） */
  onScan: (code: string, point: ScanPoint) => void | Promise<void>
  /** 需求10：现场无码时为该点打印二维码标签（传入则名单行显示打印按钮） */
  onPrintLabel?: (point: ScanPoint) => void
}

/**
 * 扫码核对隔离点二维码 Sheet（移动端底部抽屉形态）。
 * - 名单项点击 → 扫描线动画 1.1s → onScan(code, point)
 * - 手动输入：标签破损时输入二维码内容（BPISO|code）或直接输入点位编码
 * - 核对语义：扫码结果必须命中候选名单（调用方兜底校验），扫到名单外编码视为错误二维码
 */
export default function IsoScanSheet(props: IsoScanSheetProps) {
  const { open, onClose, title, points, doneCodes = [], busy, hint, onScan, onPrintLabel } = props
  const { toast } = useToast()
  const [phase, setPhase] = useState<'idle' | 'scanning'>('idle')
  const [manual, setManual] = useState('')
  // open 状态 ref：扫描动画回调执行前 sheet 已关闭则丢弃本次识别（避免幽灵 onScan）
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])

  const remaining = useMemo(() => points.filter((p) => !doneCodes.includes(p.code)), [points, doneCodes])
  const doneCount = points.length - remaining.length

  /** 模拟扫描：扫描线动画后回调 */
  const fireScan = (point: ScanPoint) => {
    if (phase === 'scanning' || busy) return
    if (doneCodes.includes(point.code)) {
      toast({ title: '该点位已处理', description: `${point.code} 已在本次清单中完成，无需重复扫描` })
      return
    }
    setPhase('scanning')
    setTimeout(() => {
      if (!openRef.current) return
      setPhase('idle')
      void onScan(point.code, point)
    }, SCAN_SIM_MS)
  }

  /** 手动输入二维码内容或点位编码 */
  const fireManual = () => {
    const raw = manual.trim()
    if (!raw || phase === 'scanning' || busy) return
    const code = raw.startsWith('BPISO|') ? raw.slice(6).trim() : raw
    const hit = points.find((p) => p.code.toLowerCase() === code.toLowerCase())
    if (!hit) {
      toast({ variant: 'destructive', title: '二维码无法识别', description: '扫描结果不在本次隔离点清单内，请核对点位编码' })
      return
    }
    setManual('')
    void onScan(hit.code, hit)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/60" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-t-2xl bg-stone-100 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ===== 固定区：标题 + 进度 + 取景框（Task 96-b：扫码框恒悬浮，不被列表顶走） ===== */}
        <div className="shrink-0 space-y-3">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-teal-600" />
            <p className="text-sm font-bold text-stone-800">{title}</p>
            <span className="ml-auto text-[11px] tabular-nums text-stone-500">已完成 {doneCount}/{points.length}</span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 bg-white"
              aria-label="关闭扫码"
            >
              <X className="w-3.5 h-3.5 text-stone-500" />
            </button>
          </div>

          {/* 进度条 */}
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full bg-teal-500 transition-all"
              style={{ width: points.length ? `${(doneCount / points.length) * 100}%` : '0%' }}
            />
          </div>

          {/* 取景框（演示：点击名单项模拟扫描其标签） */}
          <div className="space-y-3 rounded-xl bg-stone-900 p-4">
            <div className="relative mx-auto h-40 w-40 overflow-hidden rounded-xl border-2 border-stone-600">
              <ScanLine
                className={cn(
                  'absolute left-1/2 h-0.5 w-full -translate-x-1/2 text-teal-300 shadow-[0_0_12px_2px_rgba(94,234,212,0.8)]',
                  phase === 'scanning' ? 'bp-scan-sweep top-0' : 'top-1/2 -translate-y-1/2',
                )}
              />
              {phase === 'idle' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-400">
                  <QrCode className="mb-1.5 w-8 h-8" />
                  <p className="px-3 text-center text-[10px] leading-relaxed">
                    对准隔离点标签二维码<br />点击下方点位模拟扫到它
                  </p>
                </div>
              )}
              {phase === 'scanning' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-teal-300" />
                </div>
              )}
            </div>
            <p className="text-center text-[10px] text-stone-400">
              {hint ?? '正式版 uniapp 调用相机扫码；演示环境以模拟识别代替'}
            </p>
          </div>
        </div>

        {/* ===== 滚动区：待处理名单 + 手动输入（列表再长取景框不动） ===== */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bp-thin-scrollbar">
          {/* 待处理点位名单（模拟识别入口） */}
          <div className="space-y-1.5 rounded-xl bg-white p-3">
            <p className="text-[10px] font-semibold text-stone-500">待处理点位（点击模拟扫描其标签二维码）</p>
            {remaining.length === 0 ? (
              <p className="flex items-center gap-1 py-1 text-[11px] text-teal-600">
                <CircleCheck className="w-3 h-3" />全部点位核对完成
              </p>
            ) : (
              remaining.map((p) => (
                <div
                  key={p.code}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border border-stone-200 px-2.5 py-2 text-left transition-colors hover:border-teal-300 hover:bg-teal-50/50',
                    (phase === 'scanning' || busy) && 'opacity-60',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => fireScan(p)}
                    disabled={phase === 'scanning' || busy}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-stone-400" />
                    <span className="text-[11px] font-medium text-stone-700">{p.name || p.code}</span>
                    {p.name && p.code && <span className="font-mono text-[10px] text-stone-400">{p.code}</span>}
                    <span className="ml-auto flex shrink-0 items-center text-[10px] text-teal-600">
                      扫描 <ChevronRight className="inline w-3 h-3" />
                    </span>
                  </button>
                  {onPrintLabel && (
                    <button
                      type="button"
                      onClick={() => onPrintLabel(p)}
                      disabled={phase === 'scanning' || busy}
                      title={`现场无码？打印 ${p.code} 二维码标签`}
                      aria-label={`打印 ${p.code} 二维码标签`}
                      className="shrink-0 rounded-md border border-stone-200 p-1.5 text-stone-400 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* 手动输入（标签破损兜底） */}
          <div className="space-y-1.5 rounded-xl bg-white p-3">
            <p className="flex items-center gap-1 text-[10px] font-semibold text-stone-500">
              <ScanSearch className="w-3 h-3" />标签破损时手动输入二维码内容或点位编码
            </p>
            <div className="flex gap-1.5">
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') fireManual() }}
                className="h-8 font-mono text-[11px]"
                placeholder="BPISO|… 或 点位编码"
              />
              <Button
                size="sm"
                className="h-8 bg-teal-600 px-3 text-xs text-white hover:bg-teal-700"
                onClick={fireManual}
                disabled={phase === 'scanning' || busy || !manual.trim()}
              >
                核对
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
