'use client'
// 作业人员验资共享组件（需求 15）：CrewEditor 逐人验资编辑器（开票表单 web/移动端共用）+ CrewWall 照片墙（审批/审核详情共用）
// 铁律：身份证照片必传（后端 work-tickets API 同口径校验），资质证书照片可多张；照片走 /api/attachments
import { useRef, useState } from 'react'
import { BadgePlus, IdCard, Loader2, Trash2, UserRound, Award } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { uploadFile, compressImage, attUrl, type AttachmentDto, type UploadMeta } from '@/components/bp/bp-media'

/** 单个作业人员验资材料（与 WorkTicket.workerCerts JSON 后端口径一致） */
export interface WorkerCert {
  name: string
  idCard: string
  idPhotoId: string | null
  idPhotoUrl: string | null
  qualPhotoIds: string[]
  qualPhotoUrls: string[]
}

export const EMPTY_CERT: WorkerCert = { name: '', idCard: '', idPhotoId: null, idPhotoUrl: null, qualPhotoIds: [], qualPhotoUrls: [] }

/** 安全解析 WorkTicket.workerCerts（JSON 字符串；脏数据返回 []） */
export function parseWorkerCerts(raw?: string | null): WorkerCert[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map((c: Record<string, unknown>) => ({
      name: String(c.name ?? ''),
      idCard: String(c.idCard ?? ''),
      idPhotoId: c.idPhotoId != null ? String(c.idPhotoId) : null,
      idPhotoUrl: c.idPhotoUrl != null ? String(c.idPhotoUrl) : null,
      qualPhotoIds: Array.isArray(c.qualPhotoIds) ? c.qualPhotoIds.map(String) : [],
      qualPhotoUrls: Array.isArray(c.qualPhotoUrls) ? c.qualPhotoUrls.map(String) : [],
    }))
  } catch { return [] }
}

/** 单人材料齐备校验（提交 gate：姓名+15/18 位身份证号+身份证照片必传） */
export function certComplete(c: WorkerCert): boolean {
  return Boolean(c.name.trim() && /^\d{15}$|^\d{17}[\dXx]$/.test(c.idCard.trim()) && c.idPhotoUrl)
}

/** 验资汇总一句话（供提交按钮提示） */
export function crewGaps(certs: WorkerCert[]): string[] {
  if (!certs.length) return ['至少添加 1 名作业人员']
  const gaps: string[] = []
  if (certs.some((c) => !c.name.trim())) gaps.push('存在未填写姓名的人员')
  if (certs.some((c) => c.name.trim() && !/^\d{15}$|^\d{17}[\dXx]$/.test(c.idCard.trim()))) gaps.push('存在身份证号无效的人员')
  if (certs.some((c) => c.name.trim() && !c.idPhotoUrl)) gaps.push('存在未上传身份证照片的人员')
  const names = certs.map((c) => c.name.trim()).filter(Boolean)
  if (new Set(names).size !== names.length) gaps.push('作业人员姓名重复')
  return gaps
}

// ============ 验资照片上传位（单/多张通用小缩略图组件） ============
function CertPhotoSlot(props: {
  photos: { id: string | null; url: string | null }[]
  onChange: (photos: { id: string | null; url: string | null }[]) => void
  meta: Omit<UploadMeta, 'kind'>
  multiple?: boolean
  disabled?: boolean
  label: string
}) {
  const { photos, onChange, meta, multiple, disabled, label } = props
  const inputRef = useRef<HTMLInputElement>(null)
  // 已成功上传的照片（单张模式：photos 始终占 1 位，url 为空代表尚未上传——上传按钮是否显示看这个）
  const shown = photos.filter((p) => p.url)
  const [uploading, setUploading] = useState(false)
  const { toast } = useToast()

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const uploaded: { id: string; url: string }[] = []
      for (const f of Array.from(files)) {
        const compressed = await compressImage(f)
        const att: AttachmentDto = await uploadFile(compressed, compressed.name, { ...meta, kind: 'PHOTO', label })
        uploaded.push({ id: att.id, url: attUrl(att) })
      }
      onChange(multiple ? [...photos, ...uploaded] : uploaded.slice(-1))
    } catch (e) {
      toast({ variant: 'destructive', title: `${label}上传失败`, description: e instanceof Error ? e.message : '请重试' })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((p, i) => (
        <div key={`${p.id}-${i}`} className="group relative h-14 w-20 overflow-hidden rounded-md border border-stone-200 bg-stone-100">
          { }
          <img src={p.url!} alt={`${label} ${i + 1}`} className="h-full w-full object-cover" />
          {!disabled && (
            <button
              type="button"
              aria-label={`删除${label}`}
              className="absolute right-0.5 top-0.5 hidden rounded bg-stone-900/70 p-0.5 text-white group-hover:block"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {/* 修复：单张模式上传按钮按「已上传数」判断——此前用 photos.length（始终≥1）导致身份证照片上传入口永不渲染 */}
      {(multiple || shown.length === 0) && !disabled && (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex h-14 w-20 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-stone-300 text-stone-400 transition-colors hover:border-teal-400 hover:bg-teal-50/50 hover:text-teal-600 disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgePlus className="h-4 w-4" />}
          <span className="text-[9px] leading-none">{uploading ? '上传中…' : shown.length ? '继续上传' : label}</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple={multiple} className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
    </div>
  )
}

// ============ CrewEditor：逐人验资编辑器（开票表单用） ============
export function CrewEditor(props: {
  certs: WorkerCert[]
  onChange: (certs: WorkerCert[]) => void
  currentUser: { id?: string; name?: string }
  disabled?: boolean
}) {
  const { certs, onChange, currentUser, disabled } = props

  const patch = (idx: number, p: Partial<WorkerCert>) => {
    onChange(certs.map((c, i) => (i === idx ? { ...c, ...p } : c)))
  }

  const uploadMeta = (label: string): Omit<UploadMeta, 'kind'> => ({
    bizType: 'TICKET_CREW',
    bizCode: label,
    uploadedBy: currentUser.name ?? '未知',
    uploadedById: currentUser.id,
  })

  return (
    <div className="space-y-2">
      {certs.length === 0 && (
        <p className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 py-3 text-center text-[11px] text-stone-400">
          尚未添加作业人员——点击「添加作业人员」逐人登记姓名、身份证号并上传身份证照片（必传）与资质证书照片
        </p>
      )}
      {certs.map((c, idx) => {
        const ok = certComplete(c)
        return (
          <div key={idx} className={cn('rounded-lg border p-2.5 space-y-2', ok ? 'border-teal-200 bg-teal-50/40' : 'border-amber-300 bg-amber-50/40')}>
            {/* 头部行：序号 + 完善状态 + 删除（姓名/身份证号各自独立一整行，移动端窄屏不再挤压） */}
            <div className="flex items-center gap-1.5">
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', ok ? 'bg-teal-600' : 'bg-amber-500')}>
                {idx + 1}
              </span>
              <UserRound className="h-3.5 w-3.5 shrink-0 text-stone-400" />
              <span className="text-[11px] font-semibold text-stone-600">人员 {idx + 1}</span>
              <span className={cn('ml-auto shrink-0 text-[10px]', ok ? 'text-teal-600' : 'text-amber-600')}>{ok ? '✓ 材料齐' : '待完善'}</span>
              <Button
                type="button" variant="ghost" size="sm"
                className="h-7 w-7 shrink-0 p-0 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                disabled={disabled}
                onClick={() => onChange(certs.filter((_, i) => i !== idx))}
                aria-label={`删除作业人员 ${c.name || idx + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {/* 姓名 · 独立一整行 */}
            <div className="space-y-1 pl-6">
              <Label className="text-[10px] text-stone-500">姓名 *</Label>
              <Input
                className="h-8 w-full text-xs"
                placeholder="请输入作业人员姓名"
                value={c.name}
                disabled={disabled}
                onChange={(e) => patch(idx, { name: e.target.value })}
              />
            </div>
            {/* 身份证号 · 独立一整行 */}
            <div className="space-y-1 pl-6">
              <Label className="text-[10px] text-stone-500">身份证号（15/18 位）*</Label>
              <Input
                className="h-8 w-full font-mono text-xs"
                placeholder="请输入 15 或 18 位身份证号码"
                value={c.idCard}
                disabled={disabled}
                onChange={(e) => patch(idx, { idCard: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-[10px] font-medium text-stone-500">
                  <IdCard className="h-3 w-3 text-teal-600" />身份证照片 <span className="text-rose-500">*必传</span>
                </p>
                <CertPhotoSlot
                  label="身份证照片"
                  photos={[{ id: c.idPhotoId, url: c.idPhotoUrl }]}
                  onChange={(ps) => patch(idx, { idPhotoId: ps[0]?.id ?? null, idPhotoUrl: ps[0]?.url ?? null })}
                  meta={uploadMeta('身份证照片')}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-[10px] font-medium text-stone-500">
                  <Award className="h-3 w-3 text-violet-500" />资质证书照片（可多张）
                </p>
                <CertPhotoSlot
                  label="资质证书"
                  multiple
                  photos={c.qualPhotoUrls.map((u, i) => ({ id: c.qualPhotoIds[i] ?? null, url: u }))}
                  onChange={(ps) => patch(idx, { qualPhotoIds: ps.map((p) => p.id).filter((x): x is string => x != null), qualPhotoUrls: ps.map((p) => p.url).filter((x): x is string => x != null) })}
                  meta={uploadMeta('资质证书')}
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
        )
      })}
      {!disabled && (
        <Button
          type="button" variant="outline" size="sm"
          className="h-8 w-full border-teal-300 text-xs text-teal-700 hover:bg-teal-50 hover:text-teal-800"
          onClick={() => onChange([...certs, { ...EMPTY_CERT }])}
        >
          <BadgePlus className="mr-1 h-3.5 w-3.5" />添加作业人员（逐人验资）
        </Button>
      )}
    </div>
  )
}

// ============ CrewWall：作业人员验资照片墙（审批/审核详情用） ============
export function CrewWall(props: { workerCerts?: string | null; workers?: string | null; compact?: boolean }) {
  const { workerCerts, workers, compact } = props
  const certs = parseWorkerCerts(workerCerts)
  // 降级：无验资材料的存量票按逗号名单展示姓名行
  if (!certs.length) {
    const names = (workers ?? '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    if (!names.length) return <p className="text-[11px] text-stone-400">该票未登记作业人员</p>
    return (
      <p className="text-[11px] text-stone-500">
        作业人员：{names.join('、')}<span className="ml-1 text-stone-400">（存量票未采集验资材料）</span>
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {certs.map((c, i) => (
        <div key={`${c.name}-${i}`} className={cn('rounded-lg border p-2', compact ? 'space-y-1' : 'space-y-1.5', certComplete(c) ? 'border-teal-200 bg-teal-50/40' : 'border-amber-300 bg-amber-50/50')}>
          <div className="flex items-center gap-1.5">
            <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-[9px] font-bold text-white">{i + 1}</span>
            <span className="text-xs font-semibold text-stone-700">{c.name}</span>
            <span className="font-mono text-[10px] text-stone-400">{c.idCard}</span>
            {certComplete(c)
              ? <span className="ml-auto text-[10px] text-teal-600">材料齐全</span>
              : <span className="ml-auto text-[10px] text-amber-600">缺身份证照片</span>}
          </div>
          <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-[9px] text-stone-400"><IdCard className="h-2.5 w-2.5" />身份证照片</p>
              {c.idPhotoUrl ? (
                <a href={c.idPhotoUrl} target="_blank" rel="noreferrer" className="block h-16 overflow-hidden rounded-md border border-stone-200">
                  <img src={c.idPhotoUrl} alt={`${c.name} 身份证照片`} className="h-full w-full object-cover transition-transform hover:scale-105" />
                </a>
              ) : <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-stone-300 text-[9px] text-stone-400">未上传</div>}
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-[9px] text-stone-400"><Award className="h-2.5 w-2.5" />资质证书（{c.qualPhotoUrls.length}）</p>
              {c.qualPhotoUrls.length ? (
                <div className="flex gap-1">
                  {c.qualPhotoUrls.slice(0, compact ? 2 : 3).map((u, j) => (
                    <a key={j} href={u} target="_blank" rel="noreferrer" className="block h-16 w-1/2 overflow-hidden rounded-md border border-stone-200">
                          <img src={u} alt={`${c.name} 资质证书 ${j + 1}`} className="h-full w-full object-cover transition-transform hover:scale-105" />
                    </a>
                  ))}
                </div>
              ) : <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-stone-300 text-[9px] text-stone-400">未上传</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
