'use client'
// 移动端现场作业共享媒体组件：拍照（相机 capture）/ 录音（MediaRecorder）/ 附件墙 / AI 照片核对卡
// 配色约定：AI=violet；不一致警告=rose；一致=emerald；存疑=amber
import { useRef, useState } from 'react'
import { apiUpload, fmtDateTime } from '@/lib/bp-api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  Camera, X, Loader2, Mic, Square, Play, Trash2, AudioLines, ImageOff,
  Sparkles, RefreshCw, CircleCheck, AlertTriangle, HelpCircle,
} from 'lucide-react'

// ============ 类型 ============
export interface AttachmentDto {
  id: string
  bizType: string
  bizId: number | null
  bizCode: string | null
  pointCode: string | null
  kind: string // PHOTO | AUDIO
  fileName: string
  mimeType: string
  size: number
  label: string | null
  uploadedBy: string
  uploadedById: string | null
  createdAt: string
  url?: string
}

export interface PhotoCheckDto {
  id: number
  scene: string
  workRequestId: number
  ticketId: number | null
  result: 'CONSISTENT' | 'INCONSISTENT' | 'UNCERTAIN'
  confidence: number | null
  reason: string | null
  detail: string | null
  photos: string | null
  createdAt: string
}

export const SCENE_LABEL: Record<string, string> = {
  BRIEFING_VS_SURVEY: '交底照片 vs 勘察照片',
  EXECUTION_VS_BRIEFING: '作业照片 vs 交底照片',
  ACCEPTANCE_VS_EXEC: '验收照片 vs 作业/交底照片',
}

export const attUrl = (a: AttachmentDto) => a.url ?? `/api/attachments/${a.id}/raw`

// ============ 上传 + 图片压缩 ============
export interface UploadMeta {
  bizType: string
  bizId?: number | null
  bizCode?: string | null
  pointCode?: string | null
  kind?: 'PHOTO' | 'AUDIO'
  label?: string | null
  uploadedBy: string
  uploadedById?: string | null
}

/** 上传单个文件到 /api/attachments */
export async function uploadFile(file: File | Blob, fileName: string, meta: UploadMeta): Promise<AttachmentDto> {
  const form = new FormData()
  form.append('file', file, fileName)
  form.append('bizType', meta.bizType)
  if (meta.bizId != null) form.append('bizId', String(meta.bizId))
  if (meta.bizCode) form.append('bizCode', meta.bizCode)
  if (meta.pointCode) form.append('pointCode', meta.pointCode)
  form.append('kind', meta.kind ?? 'PHOTO')
  if (meta.label) form.append('label', meta.label)
  form.append('uploadedBy', meta.uploadedBy)
  if (meta.uploadedById) form.append('uploadedById', meta.uploadedById)
  return apiUpload<AttachmentDto>('/api/attachments', form)
}

/** 照片压缩：最长边 ≤1280px，JPEG 质量 0.82（<200KB 小图原样直传） */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  if (file.size < 200 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1 && file.type === 'image/jpeg') return file
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// ============ 拍照组件（PhotoPicker） ============
export function PhotoPicker(props: {
  photos: AttachmentDto[]
  onChange: (photos: AttachmentDto[]) => void
  meta: Omit<UploadMeta, 'kind'>
  disabled?: boolean
  /** 多角度快选标签（勘察按点位拍照用） */
  angleTags?: string[]
  compact?: boolean
}) {
  const { photos, onChange, meta, disabled, angleTags, compact } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [pendingLabel, setPendingLabel] = useState<string>('')
  const { toast } = useToast()

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    // 关键：先固化数量。finally 中 input.value='' 会清空 FileList，惰性 updater 里再读 files.length 将得 0，
    // 导致 uploading 计数永不归零、拍照按钮被永久禁用
    const count = files.length
    setUploading((n) => n + count)
    try {
      const uploaded: AttachmentDto[] = []
      for (const f of Array.from(files)) {
        const compressed = await compressImage(f)
        const dto = await uploadFile(compressed, compressed.name, { ...meta, kind: 'PHOTO', label: pendingLabel || null })
        uploaded.push(dto)
      }
      onChange([...photos, ...uploaded])
      if (pendingLabel) setPendingLabel('')
    } catch (e) {
      toast({ variant: 'destructive', title: '照片上传失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setUploading((n) => Math.max(0, n - count))
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async (id: string) => {
    onChange(photos.filter((p) => p.id !== id))
    fetch(`/api/attachments/${id}`, { method: 'DELETE' }).catch(() => null)
  }

  return (
    <div className="space-y-1.5">
      {angleTags && angleTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {angleTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setPendingLabel(pendingLabel === tag ? '' : tag)}
              disabled={disabled}
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] border transition-colors',
                pendingLabel === tag
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white text-teal-700 border-teal-200 hover:bg-teal-50',
              )}
              aria-pressed={pendingLabel === tag}
            >
              {pendingLabel === tag ? `✓ ${tag}` : tag}
            </button>
          ))}
        </div>
      )}
      <div className={cn('grid gap-1.5', compact ? 'grid-cols-4' : 'grid-cols-3')}>
        {photos.map((p) => (
          <div key={p.id} className="relative group rounded-md overflow-hidden border border-stone-200 bg-stone-100 aspect-square">
            { }
            <img src={attUrl(p)} alt={p.label || p.fileName} className="w-full h-full object-cover" loading="lazy" />
            {p.label && (
              <span className="absolute left-1 top-1 px-1 py-px rounded bg-black/55 text-white text-[9px] max-w-full truncate">{p.label}</span>
            )}
            <button
              type="button"
              onClick={() => void remove(p.id)}
              disabled={disabled}
              className="absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-rose-600"
              aria-label={`删除照片${p.label ? `（${p.label}）` : ''}`}
              title="删除照片"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {uploading > 0 && (
          <div className="rounded-md border border-dashed border-violet-300 bg-violet-50 aspect-square flex flex-col items-center justify-center text-violet-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-[9px] mt-1">上传中…</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading > 0}
          className="rounded-md border border-dashed border-stone-300 bg-stone-50 hover:bg-teal-50 hover:border-teal-400 text-stone-400 hover:text-teal-600 flex flex-col items-center justify-center gap-0.5 aspect-square transition-colors disabled:opacity-50"
          aria-label="拍摄照片"
          title="点击拍摄/选择照片"
        >
          <Camera className="w-5 h-5" />
          <span className="text-[9px]">拍照</span>
        </button>
      </div>
      {/* capture=environment：真机直接调起后置相机；桌面浏览器退化为文件选择 */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
        data-testid="photo-input"
      />
    </div>
  )
}

// ============ 录音组件（VoiceRecorder） ============
export function VoiceRecorder(props: {
  audio: AttachmentDto | null
  onChange: (audio: AttachmentDto | null) => void
  meta: Omit<UploadMeta, 'kind'>
  disabled?: boolean
}) {
  const { audio, onChange, meta, disabled } = props
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { toast } = useToast()

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ variant: 'destructive', title: '当前环境不支持录音', description: '请在真实移动端浏览器中使用，或更换支持麦克风的浏览器' })
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        void finish()
      }
      rec.start()
      recorderRef.current = rec
      setRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch {
      toast({ variant: 'destructive', title: '麦克风不可用', description: '请授权麦克风权限后重试' })
    }
  }

  const finish = async () => {
    if (timerRef.current) clearInterval(timerRef.current)
    setRecording(false)
    setBusy(true)
    try {
      const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || 'audio/webm' })
      if (!blob.size) throw new Error('录音为空')
      const dto = await uploadFile(blob, `交底录音-${Date.now()}.webm`, { ...meta, kind: 'AUDIO' })
      onChange(dto)
      toast({ title: '录音已上传', description: `${Math.round(blob.size / 1024)}KB` })
    } catch (e) {
      toast({ variant: 'destructive', title: '录音上传失败', description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setBusy(false)
      recorderRef.current = null
    }
  }

  const stop = () => recorderRef.current?.stop()

  const remove = () => {
    if (!audio) return
    onChange(null)
    fetch(`/api/attachments/${audio.id}`, { method: 'DELETE' }).catch(() => null)
  }

  const durText = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {!recording ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void start()} disabled={disabled || busy}
            className="h-9 border-violet-200 text-violet-700 hover:bg-violet-50" aria-label="开始录音">
            <Mic className="w-4 h-4 mr-1.5" />开始录音
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={stop} disabled={busy}
            className="h-9 bg-rose-600 hover:bg-rose-700 text-white" aria-label="停止录音">
            <Square className="w-4 h-4 mr-1.5" />停止 {durText(seconds)}
          </Button>
        )}
        {busy && <Loader2 className="w-4 h-4 animate-spin text-violet-500" />}
        {!recording && !audio && !busy && (
          <span className="text-[10px] text-stone-400 flex items-center gap-1"><AudioLines className="w-3 h-3" />交底讲解录音（可选）</span>
        )}
      </div>
      {recording && (
        <div className="flex items-center gap-1 h-6" aria-hidden="true">
          {[0.5, 0.9, 0.6, 1, 0.7, 0.4, 0.85, 0.55].map((h, i) => (
            <span key={i} className="w-1 rounded-full bg-rose-400 animate-pulse" style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${i * 120}ms` }} />
          ))}
          <span className="text-[10px] text-rose-500 ml-1">录音中…</span>
        </div>
      )}
      {audio && (
        <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5">
          <Play className="w-3.5 h-3.5 text-violet-600 shrink-0" />
          { }
          <audio controls src={attUrl(audio)} className="h-8 flex-1 min-w-0" preload="none" />
          <button type="button" onClick={remove} disabled={disabled}
            className="w-6 h-6 rounded-full flex items-center justify-center text-stone-400 hover:text-rose-600 hover:bg-white" aria-label="删除录音" title="删除录音">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ============ 附件墙（只读展示） ============
export function AttachmentWall(props: { photos: AttachmentDto[]; audios?: AttachmentDto[]; emptyText?: string; compact?: boolean }) {
  const { photos, audios, emptyText, compact } = props
  if (!photos.length && !audios?.length) {
    return emptyText ? <p className="text-[11px] text-stone-400">{emptyText}</p> : null
  }
  return (
    <div className="space-y-2">
      {photos.length > 0 && (
        <div className={cn('grid gap-1.5', compact ? 'grid-cols-4' : 'grid-cols-3 sm:grid-cols-4')}>
          {photos.map((p) => (
            <a key={p.id} href={attUrl(p)} target="_blank" rel="noreferrer" className="relative rounded-md overflow-hidden border border-stone-200 bg-stone-100 aspect-square group">
              { }
              <img src={attUrl(p)} alt={p.label || p.fileName} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
              {p.pointCode && <span className="absolute left-1 top-1 px-1 py-px rounded bg-black/55 text-white text-[9px]">{p.pointCode}</span>}
              {p.label && !p.pointCode && <span className="absolute left-1 top-1 px-1 py-px rounded bg-black/55 text-white text-[9px]">{p.label}</span>}
            </a>
          ))}
        </div>
      )}
      {audios?.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5">
          <AudioLines className="w-3.5 h-3.5 text-violet-600 shrink-0" />
          { }
          <audio controls src={attUrl(a)} className="h-8 flex-1 min-w-0" preload="none" />
          <span className="text-[10px] text-stone-400 shrink-0">{a.uploadedBy}</span>
        </div>
      ))}
    </div>
  )
}

// ============ AI 照片核对卡（violet） ============
export const RESULT_META: Record<string, { label: string; icon: typeof CircleCheck; cls: string; bar: string }> = {
  CONSISTENT: { label: '位置一致', icon: CircleCheck, cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', bar: 'bg-emerald-500' },
  INCONSISTENT: { label: '位置不一致', icon: AlertTriangle, cls: 'text-rose-600 bg-rose-50 border-rose-200', bar: 'bg-rose-500' },
  UNCERTAIN: { label: '无法确定', icon: HelpCircle, cls: 'text-amber-600 bg-amber-50 border-amber-200', bar: 'bg-amber-500' },
}

export function AiCheckCard(props: {
  check: PhotoCheckDto | null
  loading?: boolean
  onRun?: () => void
  runDisabled?: boolean
  runHint?: string
  compact?: boolean
}) {
  const { check, loading, onRun, runDisabled, runHint, compact } = props
  if (loading) {
    return (
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 flex items-center gap-2" role="status" aria-live="polite">
        <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
        <span className="text-xs text-violet-700">AI 正在比对照片位置特征（设备/管线/法兰/周边环境）…</span>
      </div>
    )
  }
  if (!check) {
    if (!onRun) return null
    return (
      <button type="button" onClick={onRun} disabled={runDisabled}
        className="w-full rounded-lg border border-dashed border-violet-300 bg-violet-50 hover:bg-violet-100 p-3 flex items-center justify-center gap-2 text-violet-700 text-xs transition-colors disabled:opacity-50"
        title={runHint}>
        <Sparkles className="w-4 h-4" />AI 位置核对{runHint ? `（${runHint}）` : ''}
      </button>
    )
  }
  const meta = RESULT_META[check.result] ?? RESULT_META.UNCERTAIN
  const Icon = meta.icon
  return (
    <div className={cn('rounded-lg border p-3 space-y-1.5', compact && 'p-2', meta.cls)} data-testid="ai-check-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="w-4 h-4 shrink-0" />
          <span className="text-xs font-semibold truncate">AI 位置核对：{meta.label}</span>
        </div>
        <span className="text-[10px] text-violet-400 shrink-0">{SCENE_LABEL[check.scene] ?? check.scene}</span>
      </div>
      {check.confidence != null && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-white/70 overflow-hidden">
            <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${check.confidence}%` }} />
          </div>
          <span className="text-[10px] shrink-0 opacity-80">置信度 {check.confidence}%</span>
        </div>
      )}
      {check.reason
        ? <p className="text-[11px] leading-relaxed opacity-90">{check.reason}</p>
        : <p className="text-[11px] leading-relaxed opacity-70">AI 未返回判定理由（响应异常），建议点击「重新核对」再试一次</p>}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-[9px] opacity-60">{fmtDateTime(check.createdAt)}</span>
        {onRun && (
          <button type="button" onClick={onRun} disabled={runDisabled} className="inline-flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-800 disabled:opacity-50" title="重新核对">
            <RefreshCw className="w-3 h-3" />重新核对
          </button>
        )}
      </div>
    </div>
  )
}

// ============ 不一致警告条（用户要求：不一致警告用户） ============
export function InconsistentWarning({ show, scene }: { show: boolean; scene: string }) {
  if (!show) return null
  return (
    <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 flex items-start gap-2" role="alert" data-testid="inconsistent-warning">
      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
      <div className="text-xs text-rose-700 leading-relaxed">
        <p className="font-semibold">⚠️ AI 核对发现位置不一致！</p>
        <p className="mt-0.5">{SCENE_LABEL[scene] ?? scene}判定与基准照片可能不是同一作业位置。请核对是否走错作业点；确认无误可注明原因后继续，若有疑问立即停止并联系交底方/技术人员。</p>
      </div>
    </div>
  )
}

// ============ 照片加载失败的占位（列表场景兜底） ============
export function PhotoBroken() {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 aspect-square flex items-center justify-center text-stone-300">
      <ImageOff className="w-5 h-5" />
    </div>
  )
}
