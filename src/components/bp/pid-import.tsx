'use client'
// AI 识别 PID 导入向导：上传 PID 图纸图片 → VLM 结构化识别 → 预览确认（可勾选/编辑）→ 一键导入主数据 + 自动布局生成组态图
// 安全纪律：识别结果仅作草稿，逐项人工确认后才写库；位号为空的项无法导入；主数据按编码幂等（已存在自动复用）
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Copy, FileImage, Loader2, Sparkles, Upload, X } from 'lucide-react'
import { apiGet, apiPost } from '@/lib/bp-api'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { EQUIP_TYPE_MAP } from '@/lib/bp-types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

// ============ 类型 ============
interface EqRow { enabled: boolean; code: string; name: string; type: string; x: number | null; y: number | null; w: number | null; h: number | null }
interface PipeRow { enabled: boolean; code: string; name: string; medium: string; spec: string; fromEquipment: string; toEquipment: string }
interface PointRow { enabled: boolean; code: string; name: string; pipelineCode: string; location: string }

interface ExtractResult {
  diagramName: string
  unitName: string
  equipments: { code: string; name: string; type: string; x: number | null; y: number | null; w: number | null; h: number | null }[]
  pipelines: { code: string; name: string; medium: string; spec: string; fromEquipment: string; toEquipment: string }[]
  isoPoints: { code: string; name: string; pipelineCode: string; location: string }[]
}

interface ItemResult { code: string; id: number | null; created: boolean; note?: string }

interface ImportResult {
  unit: { id: number; name: string; created: boolean } | null
  equipments: ItemResult[]
  pipelines: ItemResult[]
  isoPoints: ItemResult[]
  diagram: { id: number; name: string; shapeCount: number; connCount: number; markCount: number; unconnectedPipes?: number }
}

export interface PidImportWizardProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  units: { id: number; code: string; name: string }[]
  /** 导入成功后回调（携带新组态图 id，父组件刷新列表并选中） */
  onDone?: (diagramId: number) => void
}

const EQUIP_TYPES = Object.keys(EQUIP_TYPE_MAP)

/** 压缩上传图片：最长边 ≤1600px、JPEG 85%——VLM 内部会将长边缩到 ~1344，1600 与原图在模型侧等效但传输/编码更快 */
async function loadImageAsDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = document.createElement('img')
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('图片读取失败'))
      img.src = url
    })
    const MAX = 1600
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画布初始化失败')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function PidImportWizard({ open, onOpenChange, units, onDone }: PidImportWizardProps) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload')
  const [imgData, setImgData] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [importing, setImporting] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 停止轮询（识别结束/组件卸载时）
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const [diagName, setDiagName] = useState('')
  const [unitMode, setUnitMode] = useState<'existing' | 'new'>('existing')
  const [unitId, setUnitId] = useState('none')
  const [newUnitName, setNewUnitName] = useState('')

  const [eqs, setEqs] = useState<EqRow[]>([])
  const [pipes, setPipes] = useState<PipeRow[]>([])
  const [pts, setPts] = useState<PointRow[]>([])
  const [result, setResult] = useState<ImportResult | null>(null)

  // 关闭时重置（下次打开回到上传步）
  const reset = useCallback(() => {
    setStep('upload')
    setImgData(null)
    setExtracting(false)
    setImporting(false)
    setDiagName('')
    setUnitMode('existing')
    setUnitId('none')
    setNewUnitName('')
    setEqs([])
    setPipes([])
    setPts([])
    setResult(null)
  }, [])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  // ---- 选择图片 → 直接开始识别 ----
  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|jpeg|jpg|webp|gif|bmp)$/i.test(file.type)) {
      toast({ title: '仅支持图片文件（PNG/JPG/WebP 等）', variant: 'destructive' })
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: '图片过大', description: '请压缩到 8MB 以内后上传', variant: 'destructive' })
      return
    }
    let dataUrl: string
    try {
      dataUrl = await loadImageAsDataUrl(file)
    } catch (err) {
      toast({ title: '图片读取失败', description: (err as Error).message, variant: 'destructive' })
      return
    }
    setImgData(dataUrl)
    setExtracting(true)
    setElapsed(0)
    const startedAt = Date.now()
    try {
      // 识别已异步任务化：POST 只提交任务并秒回 taskId（LLM 在后台跑），前端 2s 轮询 GET 拿结果。
      // 所有请求都是短请求，彻底规避外层代理/网关埋断 30s+ 长请求导致的 502。
      // 提交遇网络类错误自动重试 1 次；轮询单次网络抖动容错，连续 3 次失败才报错。
      const submitOnce = () => apiPost<{ taskId: string }>('/api/ai/pid/extract', { imageBase64: dataUrl })
      let submitted: { taskId: string }
      try {
        submitted = await submitOnce()
      } catch (err) {
        const msg = (err as Error).message || ''
        if (/fetch|network|abort|timeout|加载失败|请求失败\(5\d\d\)/i.test(msg)) {
          submitted = await submitOnce()
        } else {
          throw err
        }
      }
      const result = await new Promise<ExtractResult>((resolve, reject) => {
        let misses = 0
        const tick = async () => {
          setElapsed(Math.round((Date.now() - startedAt) / 1000))
          if (Date.now() - startedAt > 300_000) {
            reject(new Error('识别超时（超过 5 分钟）——请重试或改用更清晰的图纸'))
            return
          }
          try {
            const st = await apiGet<{ status: 'running' | 'done' | 'error'; result?: ExtractResult; error?: string }>(
              `/api/ai/pid/extract?taskId=${encodeURIComponent(submitted.taskId)}`,
            )
            misses = 0
            if (st.status === 'done' && st.result) {
              resolve(st.result)
              return
            }
            if (st.status === 'error') {
              reject(new Error(st.error || 'AI 识别失败'))
              return
            }
          } catch {
            misses++
            if (misses >= 3) {
              reject(new Error('识别任务查询失败（网络波动或服务重启），请重新上传'))
              return
            }
          }
          pollTimerRef.current = setTimeout(tick, 2000)
        }
        void tick()
      })
      const r = result
      setDiagName(r.diagramName || 'AI 识别 PID 图')
      setEqs(r.equipments.map((e) => ({ enabled: true, code: e.code, name: e.name, type: e.type, x: e.x ?? null, y: e.y ?? null, w: e.w ?? null, h: e.h ?? null })))
      setPipes(r.pipelines.map((p) => ({ enabled: true, ...p })))
      setPts(r.isoPoints.map((p) => ({ enabled: true, ...p })))
      if (r.unitName) {
        const hit = units.find((u) => u.name === r.unitName || u.code === r.unitName)
        if (hit) {
          setUnitMode('existing')
          setUnitId(String(hit.id))
        } else {
          setUnitMode('new')
          setNewUnitName(r.unitName)
        }
      } else {
        setUnitMode('existing')
        setUnitId('none')
      }
      setStep('preview')
      toast({ title: '识别完成', description: `设备 ${r.equipments.length} · 管线 ${r.pipelines.length} · 隔离点 ${r.isoPoints.length}，请逐项核对` })
    } catch (err) {
      toast({ title: 'AI 识别失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setExtracting(false)
      stopPolling()
    }
  }, [toast, units, stopPolling])

  // ---- 确认导入 ----
  const submitImport = useCallback(async () => {
    const eqPayload = eqs.filter((e) => e.enabled && e.code.trim())
    const pipePayload = pipes.filter((p) => p.enabled && p.code.trim())
    const ptPayload = pts.filter((p) => p.enabled && p.code.trim())
    const disabledEmpty = [...eqs, ...pipes, ...pts].filter((x) => x.enabled && !('code' in x ? (x as { code?: string }).code?.trim() : true)).length
    const unitPayload = unitMode === 'existing'
      ? { unitId: unitId === 'none' ? null : Number(unitId), unitName: '' }
      : { unitId: null, unitName: newUnitName.trim() }
    if (unitMode === 'new' && !newUnitName.trim()) {
      toast({ title: '请填写新建装置名称，或切换为「关联现有装置」', variant: 'destructive' })
      return
    }
    if (eqPayload.length === 0 && pipePayload.length === 0 && ptPayload.length === 0) {
      toast({ title: '请至少勾选一项要导入的数据', variant: 'destructive' })
      return
    }
    setImporting(true)
    try {
      const resp = await apiPost<ImportResult>('/api/ai/pid/import', {
        ...unitPayload,
        diagramName: diagName.trim() || 'AI 识别 PID 图',
        equipments: eqPayload.map(({ enabled: _e, ...rest }) => rest),
        pipelines: pipePayload.map(({ enabled: _e, ...rest }) => rest),
        isoPoints: ptPayload.map(({ enabled: _e, ...rest }) => rest),
      })
      setResult(resp)
      setStep('done')
      const createdCount = [...resp.equipments, ...resp.pipelines, ...resp.isoPoints].filter((x) => x.created).length
      toast({
        title: '导入成功',
        description: `新建主数据 ${createdCount} 项（已存在自动复用），组态图「${resp.diagram.name}」已生成`,
      })
    } catch (err) {
      toast({ title: '导入失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }, [diagName, eqs, newUnitName, pipes, pts, toast, unitId, unitMode])

  const enabledCount = eqs.filter((x) => x.enabled && x.code.trim()).length
    + pipes.filter((x) => x.enabled && x.code.trim()).length
    + pts.filter((x) => x.enabled && x.code.trim()).length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!extracting && !importing) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[880px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-violet-800">
            <Sparkles className="h-4 w-4 text-violet-600" /> AI 识别 PID 图纸导入
          </DialogTitle>
          <DialogDescription>
            上传 PID 图纸照片/截图 → AI 识别设备/管线/隔离点 → 核对确认后一键生成主数据与组态图（识别结果仅供参考，以人工核对为准）
          </DialogDescription>
        </DialogHeader>

        {/* ============ 步骤一：上传 ============ */}
        {step === 'upload' && (
          <div className="py-2">
            {extracting ? (
              <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-violet-200 bg-violet-50/60 px-6 py-14 text-center">
                <div className="relative">
                  <Loader2 className="h-10 w-10 animate-spin text-violet-600" />
                  <Sparkles className="absolute -right-1.5 -top-1.5 h-4 w-4 animate-pulse text-violet-400" />
                </div>
                <div className="text-sm font-medium text-violet-900">AI 正在读图…（已 {elapsed} 秒）</div>
                <p className="max-w-sm text-xs leading-relaxed text-violet-600">
                  正在识别图纸中的设备位号、管线连接与隔离点标注；工程图纸较复杂，通常需要 30~120 秒，请勿关闭窗口
                </p>
                <div className="w-56 overflow-hidden rounded-full bg-violet-100">
                  <div className="h-1.5 rounded-full bg-violet-500 transition-all duration-1000" style={{ width: `${Math.min(95, 8 + elapsed * 1.2)}%` }} />
                </div>
              </div>
            ) : (
              <label
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-stone-300 bg-stone-50/60 px-6 py-14 text-center transition-colors',
                  'hover:border-violet-400 hover:bg-violet-50/50',
                )}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void handleFile(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                  <Upload className="h-7 w-7" />
                </div>
                <div className="text-sm font-medium text-stone-700">点击选择 PID 图纸图片</div>
                <p className="max-w-md text-xs leading-relaxed text-stone-500">
                  支持 PNG / JPG / WebP，≤8MB；建议选择位号、管线号文字清晰可辨的图纸或高清照片。<br />
                  AI 将识别设备位号（如 T-101）、管线连接关系、介质标注与隔离点/盲板位置
                </p>
                <FileImage className="h-4 w-4 text-stone-300" />
              </label>
            )}
          </div>
        )}

        {/* ============ 步骤二：预览确认 ============ */}
        {step === 'preview' && (
          <div className="space-y-3">
            <div className="flex gap-3">
              {imgData && (
                <div className="relative hidden w-44 shrink-0 overflow-hidden rounded-md border bg-stone-50 sm:block">
                  <Image src={imgData} alt="上传的 PID 图纸预览" width={176} height={132} className="h-auto w-full object-contain" unoptimized />
                  <span className="absolute bottom-1 right-1 rounded bg-stone-800/70 px-1 text-[10px] text-white">原图</span>
                </div>
              )}
              <div className="grid flex-1 gap-2.5">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-stone-600">组态图名称 <span className="text-rose-500">*</span></Label>
                  <Input value={diagName} onChange={(e) => setDiagName(e.target.value)} className="h-8" placeholder="图纸名称" />
                </div>
                <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                  <Select value={unitMode} onValueChange={(v) => setUnitMode(v as 'existing' | 'new')}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="existing">关联现有装置</SelectItem>
                      <SelectItem value="new">新建装置</SelectItem>
                    </SelectContent>
                  </Select>
                  {unitMode === 'existing' ? (
                    <Select value={unitId} onValueChange={setUnitId}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="选择装置" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">不关联装置</SelectItem>
                        {units.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} className="h-8" placeholder="新装置名称（同名自动复用）" />
                  )}
                </div>
              </div>
            </div>

            <div className="max-h-[46vh] space-y-3 overflow-y-auto rounded-md border bg-stone-50/50 p-2.5 bp-thin-scrollbar">
              {/* 设备 */}
              <GroupHeader label={`设备（${eqs.length}）`} onToggleAll={(v) => setEqs(eqs.map((x) => ({ ...x, enabled: v })))} allOn={eqs.every((x) => x.enabled)} />
              {eqs.map((eq, i) => (
                <RowCard key={`eq-${i}`}>
                  <Checkbox checked={eq.enabled} onCheckedChange={(v) => setEqs(eqs.map((x, j) => (j === i ? { ...x, enabled: v === true } : x)))} />
                  <Input value={eq.code} onChange={(e) => setEqs(eqs.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} className="h-7 w-28 shrink-0 font-mono text-xs" placeholder="位号" />
                  <Input value={eq.name} onChange={(e) => setEqs(eqs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-7 flex-1 text-xs" placeholder="设备名称" />
                  <Select value={eq.type} onValueChange={(v) => setEqs(eqs.map((x, j) => (j === i ? { ...x, type: v } : x)))}>
                    <SelectTrigger className="h-7 w-[92px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EQUIP_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{EQUIP_TYPE_MAP[t]?.label ?? t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </RowCard>
              ))}

              {/* 管线 */}
              <GroupHeader label={`管线（${pipes.length}）`} onToggleAll={(v) => setPipes(pipes.map((x) => ({ ...x, enabled: v })))} allOn={pipes.every((x) => x.enabled)} />
              {pipes.map((p, i) => (
                <RowCard key={`pipe-${i}`}>
                  <Checkbox checked={p.enabled} onCheckedChange={(v) => setPipes(pipes.map((x, j) => (j === i ? { ...x, enabled: v === true } : x)))} />
                  <div className="flex w-52 shrink-0 items-center gap-1.5">
                    <Input value={p.code} onChange={(e) => setPipes(pipes.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} className="h-7 w-24 font-mono text-xs" placeholder="管线号" />
                    <Input value={p.medium} onChange={(e) => setPipes(pipes.map((x, j) => (j === i ? { ...x, medium: e.target.value } : x)))} className="h-7 w-20 text-xs" placeholder="介质" />
                  </div>
                  <Input value={p.name} onChange={(e) => setPipes(pipes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-7 flex-1 text-xs" placeholder="管线名称" />
                  <div className="flex w-[150px] shrink-0 items-center justify-end gap-1 text-[10px]">
                    <Badge variant="outline" className="max-w-[70px] truncate font-mono text-[10px]">{p.fromEquipment || '起点?'}</Badge>
                    <span className="text-stone-400">→</span>
                    <Badge variant="outline" className="max-w-[70px] truncate font-mono text-[10px]">{p.toEquipment || '终点?'}</Badge>
                  </div>
                </RowCard>
              ))}

              {/* 隔离点 */}
              <GroupHeader label={`隔离点（${pts.length}）`} onToggleAll={(v) => setPts(pts.map((x) => ({ ...x, enabled: v })))} allOn={pts.every((x) => x.enabled)} />
              {pts.length === 0 && (
                <div className="rounded-md border border-dashed bg-white px-3 py-2.5 text-center text-xs text-stone-400">
                  图上未识别出隔离点/盲板标注——可导入后在「基础数据 · 隔离点主数据」中手动维护
                </div>
              )}
              {pts.map((p, i) => (
                <RowCard key={`pt-${i}`}>
                  <Checkbox checked={p.enabled} onCheckedChange={(v) => setPts(pts.map((x, j) => (j === i ? { ...x, enabled: v === true } : x)))} />
                  <Input value={p.code} onChange={(e) => setPts(pts.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} className="h-7 w-32 shrink-0 font-mono text-xs" placeholder="隔离点编号" />
                  <Input value={p.name} onChange={(e) => setPts(pts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-7 flex-1 text-xs" placeholder="隔离点名称" />
                  <Select
                    value={p.pipelineCode || 'none'}
                    onValueChange={(v) => setPts(pts.map((x, j) => (j === i ? { ...x, pipelineCode: v === 'none' ? '' : v } : x)))}
                  >
                    <SelectTrigger className="h-7 w-[130px] shrink-0 font-mono text-xs">
                      <SelectValue placeholder="所属管线" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不关联管线</SelectItem>
                      {pipes.filter((x) => x.code.trim()).map((x) => (
                        <SelectItem key={x.code} value={x.code}>{x.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={p.location} onChange={(e) => setPts(pts.map((x, j) => (j === i ? { ...x, location: e.target.value } : x)))} className="h-7 w-40 shrink-0 text-xs" placeholder="位置" />
                </RowCard>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] leading-relaxed text-stone-500">
                位号为空的行不会被导入；已存在的主数据按编码自动复用不会重复创建。导入后将自动生成组态图（设备图元 + 管线连线 + 隔离点挂标）。
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" className="h-9" onClick={() => setStep('upload')} disabled={importing}>
                  <X className="h-4 w-4" /> 重新上传
                </Button>
                <Button size="sm" className="h-9 bg-violet-700 px-4 text-white hover:bg-violet-800" disabled={importing || enabledCount === 0} onClick={() => void submitImport()}>
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {importing ? '导入中…' : `确认导入（${enabledCount} 项）`}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ============ 步骤三：完成 ============ */}
        {step === 'done' && result && (
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              <span>导入完成！组态图「{result.diagram.name}」已生成：图元 {result.diagram.shapeCount} · 连线 {result.diagram.connCount} · 挂标 {result.diagram.markCount}</span>
            </div>
            {(result.diagram.unconnectedPipes ?? 0) > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>{result.diagram.unconnectedPipes} 条管线因起止设备缺失未自动连线（AI 无法追踪线条走向）——已作为主数据导入，可打开组态图手动补线，或在预览中补填起止设备后重新导入</span>
              </div>
            )}
            <div className="grid max-h-[38vh] gap-2 overflow-y-auto bp-thin-scrollbar">
              {result.unit && (
                <SummaryRow
                  icon={<span className="font-mono text-[10px]">UNIT</span>}
                  label={`装置「${result.unit.name}」`}
                  created={result.unit.created}
                  note={result.unit.created ? '新建' : '已存在，复用'}
                />
              )}
              {result.equipments.map((x) => <SummaryRow key={`re-${x.code}-${x.id}`} icon={<span className="font-mono text-[10px]">EQ</span>} label={x.code} created={x.created} note={x.note ?? (x.created ? '新建' : '复用')} />)}
              {result.pipelines.map((x) => <SummaryRow key={`rp-${x.code}-${x.id}`} icon={<span className="font-mono text-[10px]">PIPE</span>} label={x.code} created={x.created} note={x.note ?? (x.created ? '新建' : '复用')} />)}
              {result.isoPoints.map((x) => <SummaryRow key={`ri-${x.code}-${x.id}`} icon={<span className="font-mono text-[10px]">IP</span>} label={x.code} created={x.created} note={x.note ?? (x.created ? '新建' : '复用')} />)}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                className="h-9 bg-violet-700 px-4 text-white hover:bg-violet-800"
                onClick={() => {
                  onDone?.(result.diagram.id)
                  onOpenChange(false)
                }}
              >
                查看生成的组态图
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============ 小组件 ============

function GroupHeader({ label, allOn, onToggleAll }: { label: string; allOn: boolean; onToggleAll: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-xs font-semibold text-stone-700">{label}</span>
      <button
        type="button"
        className="text-[11px] text-violet-600 underline-offset-2 hover:underline"
        onClick={() => onToggleAll(!allOn)}
      >
        {allOn ? '全不选' : '全选'}
      </button>
    </div>
  )
}

function RowCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-white px-2.5 py-1.5">
      {children}
    </div>
  )
}

function SummaryRow({ icon, label, created, note }: { icon: React.ReactNode; label: string; created: boolean; note: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-xs">
      <Badge variant="outline" className={cn('shrink-0 font-mono', created ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-stone-200 bg-stone-50 text-stone-500')}>
        {icon}
      </Badge>
      <span className="flex-1 truncate font-mono text-stone-700">{label}</span>
      <span className={cn('flex shrink-0 items-center gap-1', created ? 'text-violet-700' : 'text-stone-500')}>
        {created ? <Sparkles className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {note}
      </span>
    </div>
  )
}
