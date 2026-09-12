'use client'
// 管线及隔离点主数据管理：管线台账 + 隔离点主数据（供 PID 组态标注与隔离方案引用）
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ModuleProps, type BpUser } from '@/lib/bp-types'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/bp-api'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitBranch, Inbox, MapPin, Network, Pencil, Plus, RefreshCw, ScanSearch, Search, Trash2 } from 'lucide-react'
import { MasterAuditDialog } from '@/components/bp/master-audit'

// ============ 类型（与 /api/pipelines、/api/iso-point-masters 契约一致） ============
interface UnitOpt {
  id: number
  code: string
  name: string
}

interface PipelineRow {
  id: number
  code: string
  name: string
  unitId?: number | null
  unitName?: string | null
  medium?: string | null
  pressure?: string | null
  material?: string | null
  spec?: string | null
  remark?: string | null
  pointCount: number
  startEquipment?: { id: number; code: string; name: string } | null
  endEquipment?: { id: number; code: string; name: string } | null
}

/** 设备选项（起止设备下拉） */
interface EquipOpt { id: number; code: string; name: string }

interface PointRow {
  id: number
  code: string
  name: string
  pipelineId?: number | null
  pipelineName?: string | null
  location?: string | null
  remark?: string | null
  refCount: number
}

// ============ 通用小件 ============
function TableSkeleton({ cols }: { cols: number }) {
  return (
    <TableBody>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-[120px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  )
}

/** 无数据引导卡（图标 + 文案 + 新建按钮） */
function GuideCard({ icon, title, desc, actionLabel, actionClass, onAction }: {
  icon: ReactNode
  title: string
  desc: string
  actionLabel: string
  actionClass: string
  onAction: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-100 text-stone-400">{icon}</div>
      <div className="text-sm font-medium text-stone-700">{title}</div>
      <p className="max-w-sm text-xs leading-relaxed text-stone-500">{desc}</p>
      <Button size="sm" className={cn('mt-1 h-10 px-5 text-white', actionClass)} onClick={onAction}>
        <Plus className="h-4 w-4" /> {actionLabel}
      </Button>
    </div>
  )
}

function SearchBox({ value, onChange, placeholder, className }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      <Input className="h-10 w-64 pl-8" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

// ============ 主模块 ============
export default function PipelineMaster({ onNavigate, currentUser, initialTab, singleTab }: ModuleProps & { singleTab?: 'pipelines' | 'points' }) {
  // 侧边栏子菜单跳转时通过 key 重挂载切换页签（Radix Tabs 非激活内容默认卸载）
  const normalized = singleTab ?? (initialTab === 'points' ? 'points' : 'pipelines')
  const { toast } = useToast()
  const [pipelines, setPipelines] = useState<PipelineRow[]>([])
  const [points, setPoints] = useState<PointRow[]>([])
  const [units, setUnits] = useState<UnitOpt[]>([])
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [pl, pt, un] = await Promise.all([
        apiGet<{ list: PipelineRow[] }>('/api/pipelines'),
        apiGet<{ list: PointRow[] }>('/api/iso-point-masters'),
        apiGet<UnitOpt[]>('/api/units'),
      ])
      setPipelines(pl.list ?? [])
      setPoints(pt.list ?? [])
      setUnits(un ?? [])
    } catch (err) {
      toast({ title: '加载失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4 text-emerald-700" />
              管线及隔离点主数据
            </CardTitle>
            <CardDescription>维护管线台账与隔离点主数据，供 PID 组态标注与隔离方案引用</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">管线 {pipelines.length} 条</Badge>
            <span className="text-xs text-stone-400">·</span>
            <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">隔离点 {points.length} 个</Badge>
            <Button variant="outline" size="sm" className="h-10 px-4" onClick={() => void loadAll()}>
              <RefreshCw className="h-4 w-4" /> 刷新
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs key={normalized} defaultValue={normalized} className="space-y-4">
          {!singleTab && (
          <TabsList>
            <TabsTrigger value="pipelines" className="px-4">管线台账</TabsTrigger>
            <TabsTrigger value="points" className="px-4">隔离点主数据</TabsTrigger>
          </TabsList>
          )}
          <TabsContent value="pipelines">
            <PipelinesTab pipelines={pipelines} units={units} loading={loading} currentUser={currentUser} reload={loadAll} />
          </TabsContent>
          <TabsContent value="points">
            <PointsTab points={points} pipelines={pipelines} loading={loading} currentUser={currentUser} reload={loadAll} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

// ============ 管线台账 ============
interface PipelineForm {
  code: string
  name: string
  unitId: string
  medium: string
  pressure: string
  material: string
  spec: string
  remark: string
  startEquipmentId: string // 'none' 或设备 id
  endEquipmentId: string
}

const EMPTY_PIPELINE_FORM: PipelineForm = {
  code: '', name: '', unitId: 'none', medium: '', pressure: '', material: '', spec: '', remark: '',
  startEquipmentId: 'none', endEquipmentId: 'none',
}

function PipelinesTab({ pipelines, units, loading, currentUser, reload }: {
  pipelines: PipelineRow[]
  units: UnitOpt[]
  loading: boolean
  currentUser: BpUser
  reload: () => Promise<void>
}) {
  const { toast } = useToast()
  const [keyword, setKeyword] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PipelineRow | null>(null)
  const [form, setForm] = useState<PipelineForm>(EMPTY_PIPELINE_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<PipelineRow | null>(null)
  // 行内主数据体检（Task 54）：对单条管线及其邻接数据做自洽性校验
  const [auditTarget, setAuditTarget] = useState<PipelineRow | null>(null)
  const [equipOptions, setEquipOptions] = useState<EquipOpt[]>([])

  // 设备选项（起止设备下拉；加载失败静默，表单仍可维护其他字段）
  useEffect(() => {
    apiGet<{ list: EquipOpt[] }>('/api/equipments')
      .then((d) => setEquipOptions(d.list ?? []))
      .catch(() => { /* 静默 */ })
  }, [])

  /** 操作者标识（审计留痕，与既有模块 __actor 约定一致） */
  const actor = () => ({ __actorId: currentUser.id, __actorName: currentUser.name })
  const actorQ = () =>
    `__actorId=${encodeURIComponent(currentUser.id)}&__actorName=${encodeURIComponent(currentUser.name)}`

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return pipelines
    return pipelines.filter((p) =>
      [p.code, p.name, p.unitName ?? '', p.medium ?? '', p.pressure ?? '', p.spec ?? '']
        .some((v) => v.toLowerCase().includes(kw)),
    )
  }, [pipelines, keyword])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_PIPELINE_FORM)
    setDialogOpen(true)
  }

  const openEdit = (p: PipelineRow) => {
    setEditing(p)
    setForm({
      code: p.code,
      name: p.name,
      unitId: p.unitId != null ? String(p.unitId) : 'none',
      medium: p.medium ?? '',
      pressure: p.pressure ?? '',
      material: p.material ?? '',
      spec: p.spec ?? '',
      remark: p.remark ?? '',
      startEquipmentId: p.startEquipment?.id != null ? String(p.startEquipment.id) : 'none',
      endEquipmentId: p.endEquipment?.id != null ? String(p.endEquipment.id) : 'none',
    })
    setDialogOpen(true)
  }

  const submit = async () => {
    const code = form.code.trim()
    const name = form.name.trim()
    if (!code || !name) {
      toast({ title: '请完善必填项', description: '管线编号与名称不能为空', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        code, name,
        medium: form.medium.trim(),
        pressure: form.pressure.trim(),
        material: form.material.trim(),
        spec: form.spec.trim(),
        remark: form.remark.trim(),
        ...actor(),
      }
      if (form.unitId !== 'none') payload.unitId = Number(form.unitId)
      payload.startEquipmentId = form.startEquipmentId === 'none' ? null : Number(form.startEquipmentId)
      payload.endEquipmentId = form.endEquipmentId === 'none' ? null : Number(form.endEquipmentId)
      if (editing) {
        await apiPut(`/api/pipelines/${editing.id}`, payload)
        toast({ title: '成功', description: `管线「${name}」已更新` })
      } else {
        await apiPost('/api/pipelines', payload)
        toast({ title: '成功', description: `管线「${name}」已创建` })
      }
      setDialogOpen(false)
      await reload()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await apiDelete(`/api/pipelines/${deleting.id}?${actorQ()}`)
      toast({ title: '成功', description: `管线「${deleting.name}」已删除` })
      setDeleting(null)
      await reload()
    } catch (err) {
      // 后端 400（如已有隔离点/方案引用）原样展示服务端 message
      toast({ title: '删除被拒绝', description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索编号/名称/装置/介质" />
        <Button size="sm" className="h-10 bg-emerald-700 px-5 text-white hover:bg-emerald-800" onClick={openCreate}>
          <Plus className="h-4 w-4" /> 新建管线
        </Button>
      </div>

      {loading ? (
        <div className="rounded-md border p-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
      ) : pipelines.length === 0 ? (
        <GuideCard
          icon={<GitBranch className="h-7 w-7" />}
          title="还没有管线主数据"
          desc="先创建管线台账，新建隔离点与 PID 组态标注时可关联所属管线"
          actionLabel="新建管线"
          actionClass="bg-emerald-700 hover:bg-emerald-800"
          onAction={openCreate}
        />
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编号</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>所属装置</TableHead>
                <TableHead>介质</TableHead>
                <TableHead>压力等级</TableHead>
                <TableHead>规格</TableHead>
                <TableHead>起止设备</TableHead>
                <TableHead>隔离点数</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            {filtered.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={9}>
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-stone-400">
                      <Inbox className="h-7 w-7" />
                      <span className="text-sm">没有匹配「{keyword}」的管线</span>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs font-medium">{p.code}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.unitName || '-'}</TableCell>
                    <TableCell>{p.medium || '-'}</TableCell>
                    <TableCell>{p.pressure || '-'}</TableCell>
                    <TableCell>{p.spec || '-'}</TableCell>
                    <TableCell>
                      {p.startEquipment || p.endEquipment ? (
                        <span className="font-mono text-xs text-stone-700">
                          {p.startEquipment?.code ?? '—'}
                          <span className="mx-1 text-teal-600">→</span>
                          {p.endEquipment?.code ?? '—'}
                        </span>
                      ) : (
                        <span className="text-xs text-stone-400">未关联（可由 PID 图连线绑定）</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        'font-mono',
                        p.pointCount > 0
                          ? 'border-teal-200 bg-teal-50 text-teal-700'
                          : 'border-stone-200 bg-stone-50 text-stone-500',
                      )}>
                        {p.pointCount} 个
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost" size="sm"
                          className="text-teal-700 hover:bg-teal-50 hover:text-teal-800"
                          onClick={() => setAuditTarget(p)}
                        >
                          <ScanSearch className="h-4 w-4" /> 校验
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" /> 编辑
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => setDeleting(p)}
                        >
                          <Trash2 className="h-4 w-4" /> 删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
        </div>
      )}

      {/* 行内主数据体检（Task 54） */}
      <MasterAuditDialog
        open={auditTarget !== null}
        onOpenChange={(v) => { if (!v) setAuditTarget(null) }}
        entityType="PIPELINE"
        entityCode={auditTarget?.code ?? ''}
        entityName={auditTarget?.name ?? ''}
      />

      {/* 新建/编辑管线 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑管线' : '新建管线'}</DialogTitle>
            <DialogDescription>管线编号需唯一；已有隔离点或方案引用时删除会被服务端拒绝</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>管线编号 <span className="text-rose-500">*</span></Label>
                <Input value={form.code} placeholder="如 PL-1201" onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>管线名称 <span className="text-rose-500">*</span></Label>
                <Input value={form.name} placeholder="如 反应进料线" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>所属装置</Label>
              <Select value={form.unitId} onValueChange={(v) => setForm({ ...form, unitId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择装置（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联装置</SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>起点设备</Label>
                <Select value={form.startEquipmentId} onValueChange={(v) => setForm({ ...form, startEquipmentId: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="起点设备（可选）" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未关联</SelectItem>
                    {equipOptions.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.code} · {e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>终点设备</Label>
                <Select value={form.endEquipmentId} onValueChange={(v) => setForm({ ...form, endEquipmentId: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="终点设备（可选）" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未关联</SelectItem>
                    {equipOptions.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.code} · {e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-stone-400">
              提示：在 PID 组态中将连线绑定管线、两端图元绑定设备后，保存图会按连线流向自动更新此处起止设备
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>介质</Label>
                <Input value={form.medium} placeholder="如 渣油 / 蒸汽" onChange={(e) => setForm({ ...form, medium: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>压力等级</Label>
                <Input value={form.pressure} placeholder="如 PN2.5" onChange={(e) => setForm({ ...form, pressure: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>材质</Label>
                <Input value={form.material} placeholder="如 20#/316L" onChange={(e) => setForm({ ...form, material: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>规格</Label>
                <Input value={form.spec} placeholder="如 DN100×Φ108×4" onChange={(e) => setForm({ ...form, spec: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>备注</Label>
              <Textarea rows={2} value={form.remark} placeholder="选填" onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除管线？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除管线「{deleting?.name}」（{deleting?.code}）。若该管线下存在隔离点或已被方案/组态图引用，删除将被拒绝。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============ 隔离点主数据 ============
interface PointForm {
  code: string
  name: string
  pipelineId: string
  location: string
  remark: string
}

const EMPTY_POINT_FORM: PointForm = { code: '', name: '', pipelineId: 'none', location: '', remark: '' }

function PointsTab({ points, pipelines, loading, currentUser, reload }: {
  points: PointRow[]
  pipelines: PipelineRow[]
  loading: boolean
  currentUser: BpUser
  reload: () => Promise<void>
}) {
  const { toast } = useToast()
  const [keyword, setKeyword] = useState('')
  const [pipelineFilter, setPipelineFilter] = useState('ALL')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PointRow | null>(null)
  const [form, setForm] = useState<PointForm>(EMPTY_POINT_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<PointRow | null>(null)

  const actor = () => ({ __actorId: currentUser.id, __actorName: currentUser.name })
  const actorQ = () =>
    `__actorId=${encodeURIComponent(currentUser.id)}&__actorName=${encodeURIComponent(currentUser.name)}`

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return points.filter((pt) => {
      if (pipelineFilter !== 'ALL' && String(pt.pipelineId ?? 'none') !== pipelineFilter) return false
      if (!kw) return true
      return [pt.code, pt.name, pt.pipelineName ?? '', pt.location ?? '']
        .some((v) => v.toLowerCase().includes(kw))
    })
  }, [points, keyword, pipelineFilter])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_POINT_FORM, pipelineId: pipelineFilter !== 'ALL' ? pipelineFilter : 'none' })
    setDialogOpen(true)
  }

  const openEdit = (pt: PointRow) => {
    setEditing(pt)
    setForm({
      code: pt.code,
      name: pt.name,
      pipelineId: pt.pipelineId != null ? String(pt.pipelineId) : 'none',
      location: pt.location ?? '',
      remark: pt.remark ?? '',
    })
    setDialogOpen(true)
  }

  const submit = async () => {
    const code = form.code.trim()
    const name = form.name.trim()
    if (!code || !name) {
      toast({ title: '请完善必填项', description: '隔离点编号与名称不能为空', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        code, name,
        location: form.location.trim(),
        remark: form.remark.trim(),
        ...actor(),
      }
      if (form.pipelineId !== 'none') payload.pipelineId = Number(form.pipelineId)
      if (editing) {
        await apiPut(`/api/iso-point-masters/${editing.id}`, payload)
        toast({ title: '成功', description: `隔离点「${name}」已更新` })
      } else {
        await apiPost('/api/iso-point-masters', payload)
        toast({ title: '成功', description: `隔离点「${name}」已创建` })
      }
      setDialogOpen(false)
      await reload()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await apiDelete(`/api/iso-point-masters/${deleting.id}?${actorQ()}`)
      toast({ title: '成功', description: `隔离点「${deleting.name}」已删除` })
      setDeleting(null)
      await reload()
    } catch (err) {
      // 后端 400（隔离点已被组态图/方案引用）原样展示服务端 message
      toast({ title: '删除被拒绝', description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索编号/名称/位置" />
          <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
            <SelectTrigger className="h-10 w-[190px]">
              <SelectValue placeholder="按管线过滤" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部管线</SelectItem>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="h-10 bg-teal-600 px-5 text-white hover:bg-teal-700" onClick={openCreate}>
          <Plus className="h-4 w-4" /> 新建隔离点
        </Button>
      </div>

      {loading ? (
        <div className="rounded-md border p-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
      ) : points.length === 0 ? (
        <GuideCard
          icon={<MapPin className="h-7 w-7" />}
          title="还没有隔离点主数据"
          desc="创建隔离点主数据后，可在 PID 组态图上标注其位置并关联抽堵作业"
          actionLabel="新建隔离点"
          actionClass="bg-teal-600 hover:bg-teal-700"
          onAction={openCreate}
        />
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编号</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>所属管线</TableHead>
                <TableHead>位置</TableHead>
                <TableHead>被引用</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            {filtered.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-stone-400">
                      <Inbox className="h-7 w-7" />
                      <span className="text-sm">没有匹配条件的隔离点</span>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {filtered.map((pt) => (
                  <TableRow key={pt.id}>
                    <TableCell className="font-mono text-xs font-medium">{pt.code}</TableCell>
                    <TableCell>{pt.name}</TableCell>
                    <TableCell>{pt.pipelineName || '-'}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-stone-500">{pt.location || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        'font-mono',
                        pt.refCount > 0
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-stone-200 bg-stone-50 text-stone-500',
                      )}>
                        {pt.refCount} 次
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(pt)}>
                          <Pencil className="h-4 w-4" /> 编辑
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => setDeleting(pt)}
                        >
                          <Trash2 className="h-4 w-4" /> 删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
        </div>
      )}

      {/* 新建/编辑隔离点 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑隔离点' : '新建隔离点'}</DialogTitle>
            <DialogDescription>隔离点编号需唯一；已被组态图标注或方案引用时删除会被服务端拒绝</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>隔离点编号 <span className="text-rose-500">*</span></Label>
                <Input value={form.code} placeholder="如 IP-1201-01" onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>隔离点名称 <span className="text-rose-500">*</span></Label>
                <Input value={form.name} placeholder="如 进料线法兰处" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>所属管线</Label>
              <Select value={form.pipelineId} onValueChange={(v) => setForm({ ...form, pipelineId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择管线（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联管线</SelectItem>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}（{p.code}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>位置描述</Label>
              <Input value={form.location} placeholder="如 二层平台东侧 E-101 出口法兰" onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>备注</Label>
              <Textarea rows={2} value={form.remark} placeholder="选填" onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button className="bg-teal-600 text-white hover:bg-teal-700" disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除隔离点？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除隔离点「{deleting?.name}」（{deleting?.code}）。若该隔离点已被 PID 组态图标注或被隔离方案引用，删除将被拒绝。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
