'use client'
// 基础数据管理：装置管理 + 设备管理 + 数据字典
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { EQUIP_TYPE_MAP, ModuleProps } from '@/lib/bp-types'
import { apiDelete, apiGet, apiPost, apiPut, getStoredUser } from '@/lib/bp-api'
import { useToast } from '@/hooks/use-toast'
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
import { MasterAuditDialog, MasterAuditPanel } from '@/components/bp/master-audit'
import { Building2, Database, Factory, Inbox, Pencil, Plus, RefreshCw, ScanSearch, Search, Trash2 } from 'lucide-react'

// ============ 类型 ============
interface Unit {
  id: number
  code: string
  name: string
  manager?: string | null
  phone?: string | null
  remark?: string | null
  active: boolean
  createdAt: string
}

interface DictItem {
  id: number
  category: string
  value: string
  label: string
  order: number
}

/** 设备主数据行（GET /api/equipments 契约） */
interface EquipmentRow {
  id: number
  code: string
  name: string
  type: string
  unitId?: number | null
  remark?: string | null
  unitName?: string | null
  pipeCount?: number
}

/** 设备类型选项（与 bp-types EQUIP_TYPE_MAP 键一致） */
const EQUIP_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'COLUMN', label: '塔器' },
  { value: 'REACTOR', label: '反应器' },
  { value: 'EXCHANGER', label: '换热器' },
  { value: 'FURNACE', label: '加热炉' },
  { value: 'PUMP', label: '泵' },
  { value: 'COMPRESSOR', label: '压缩机' },
  { value: 'TANK', label: '储罐' },
  { value: 'VESSEL', label: '容器' },
  { value: 'OTHER', label: '其他' },
]

const DICT_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'BLIND_SPEC', label: '盲板规格' },
  { value: 'BLIND_TYPE', label: '盲板类型' },
  { value: 'MATERIAL', label: '材质' },
  { value: 'PRESSURE', label: '压力等级' },
  { value: 'MEDIUM', label: '介质' },
]

function categoryLabel(v: string): string {
  return DICT_CATEGORY_OPTIONS.find((o) => o.value === v)?.label ?? v
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

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-stone-400">
      {icon}
      <span className="text-sm">{text}</span>
    </div>
  )
}

// ============ 主模块 ============
export default function BaseDataModule({ initialTab }: ModuleProps) {
  // 侧边栏子菜单跳转时通过 key 重挂载切换页签（Radix Tabs 非激活内容默认卸载）
  const normalized = initialTab === 'dicts' ? 'dicts' : initialTab === 'equipments' ? 'equipments' : initialTab === 'audit' ? 'audit' : 'units'
  return (
    <Tabs key={normalized} defaultValue={normalized} className="space-y-4">
      <TabsList>
        <TabsTrigger value="units">装置管理</TabsTrigger>
        <TabsTrigger value="equipments">设备管理</TabsTrigger>
        <TabsTrigger value="dicts">数据字典</TabsTrigger>
        <TabsTrigger value="audit">数据体检</TabsTrigger>
      </TabsList>
      <TabsContent value="units">
        <UnitsTab />
      </TabsContent>
      <TabsContent value="equipments">
        <EquipmentsTab />
      </TabsContent>
      <TabsContent value="dicts">
        <DictsTab />
      </TabsContent>
      <TabsContent value="audit">
        <MasterAuditPanel />
      </TabsContent>
    </Tabs>
  )
}

// ============ 装置管理 ============
interface UnitForm {
  code: string
  name: string
  manager: string
  phone: string
  remark: string
}

const EMPTY_UNIT_FORM: UnitForm = { code: '', name: '', manager: '', phone: '', remark: '' }

function UnitsTab() {
  const { toast } = useToast()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Unit | null>(null)
  const [form, setForm] = useState<UnitForm>(EMPTY_UNIT_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Unit | null>(null)

  /** 操作者标识（审计日志用） */
  const actor = () => {
    const u = getStoredUser()
    return { __actorId: u?.id ?? '', __actorName: u?.name ?? '' }
  }
  const actorQ = () => {
    const u = getStoredUser()
    return `__actorId=${encodeURIComponent(u?.id ?? '')}&__actorName=${encodeURIComponent(u?.name ?? '')}`
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<Unit[]>('/api/units')
      setUnits(data)
    } catch (err) {
      toast({ title: '加载失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_UNIT_FORM)
    setDialogOpen(true)
  }

  const openEdit = (u: Unit) => {
    setEditing(u)
    setForm({ code: u.code, name: u.name, manager: u.manager ?? '', phone: u.phone ?? '', remark: u.remark ?? '' })
    setDialogOpen(true)
  }

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast({ title: '请完善必填项', description: '装置编号与名称不能为空', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await apiPut(`/api/units/${editing.id}`, { ...form, ...actor() })
        toast({ title: '成功', description: `装置「${form.name}」已更新` })
      } else {
        await apiPost('/api/units', { ...form, ...actor() })
        toast({ title: '成功', description: `装置「${form.name}」已创建` })
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await apiDelete(`/api/units/${deleting.id}?${actorQ()}`)
      toast({ title: '成功', description: `装置「${deleting.name}」已删除` })
      setDeleting(null)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-emerald-700" />
              装置管理
            </CardTitle>
            <CardDescription>维护装置基础信息，供作业需求与盲板台账关联使用</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> 刷新
            </Button>
            <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={openCreate}>
              <Plus className="h-4 w-4" /> 新建装置
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[480px] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编号</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead>电话</TableHead>
                <TableHead className="min-w-[160px]">备注</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            {loading ? (
              <TableSkeleton cols={7} />
            ) : units.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState icon={<Inbox className="h-8 w-8" />} text="暂无装置数据，点击「新建装置」添加" />
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {units.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.code}</TableCell>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>{u.manager || '-'}</TableCell>
                    <TableCell>{u.phone || '-'}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-stone-500">{u.remark || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={u.active
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        : 'bg-stone-100 text-stone-500 border-stone-200'}>
                        {u.active ? '启用' : '停用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                          <Pencil className="h-4 w-4" /> 编辑
                        </Button>
                        <Button
                          variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleting(u)}
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
      </CardContent>

      {/* 新建/编辑装置 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑装置' : '新建装置'}</DialogTitle>
            <DialogDescription>装置编号需唯一，供作业需求与盲板台账关联</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>装置编号 <span className="text-red-500">*</span></Label>
                <Input value={form.code} placeholder="如 CH-01" onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>装置名称 <span className="text-red-500">*</span></Label>
                <Input value={form.name} placeholder="如 催化裂化装置" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>负责人</Label>
                <Input value={form.manager} placeholder="姓名" onChange={(e) => setForm({ ...form, manager: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>电话</Label>
                <Input value={form.phone} placeholder="联系电话" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>备注</Label>
              <Textarea rows={2} value={form.remark} placeholder="选填" onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除装置？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除装置「{deleting?.name}」（{deleting?.code}）。若该装置下存在作业需求，删除将被拒绝。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ============ 设备管理（减压塔/换热器/泵等静态设备台账，供 PID 图元绑定与管线起止关联） ============
interface EquipForm {
  code: string
  name: string
  type: string
  unitId: string // 'none' 或装置 id
  remark: string
}

const EMPTY_EQUIP_FORM: EquipForm = { code: '', name: '', type: 'COLUMN', unitId: 'none', remark: '' }

function EquipmentsTab() {
  const { toast } = useToast()
  const [equipments, setEquipments] = useState<EquipmentRow[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<EquipmentRow | null>(null)
  const [form, setForm] = useState<EquipForm>(EMPTY_EQUIP_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<EquipmentRow | null>(null)
  // 行内主数据体检（Task 54）：点击行内「校验」按钮对该设备做自洽性校验
  const [auditTarget, setAuditTarget] = useState<EquipmentRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [eq, un] = await Promise.all([
        apiGet<{ list: EquipmentRow[] }>('/api/equipments'),
        apiGet<Unit[]>('/api/units'),
      ])
      setEquipments(eq.list ?? [])
      setUnits(un ?? [])
    } catch (err) {
      toast({ title: '加载失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return equipments
    return equipments.filter((e) =>
      e.code.toLowerCase().includes(kw) || e.name.toLowerCase().includes(kw) || (e.unitName ?? '').toLowerCase().includes(kw),
    )
  }, [equipments, keyword])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_EQUIP_FORM)
    setDialogOpen(true)
  }

  const openEdit = (e: EquipmentRow) => {
    setEditing(e)
    setForm({ code: e.code, name: e.name, type: e.type, unitId: e.unitId != null ? String(e.unitId) : 'none', remark: e.remark ?? '' })
    setDialogOpen(true)
  }

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast({ title: '请完善必填项', description: '设备位号与名称不能为空', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const body = {
        code: form.code.trim(), name: form.name.trim(), type: form.type,
        unitId: form.unitId === 'none' ? null : Number(form.unitId),
        remark: form.remark.trim() || null,
      }
      if (editing) {
        await apiPut(`/api/equipments/${editing.id}`, body)
        toast({ title: '成功', description: `设备「${form.name}」已更新` })
      } else {
        await apiPost('/api/equipments', body)
        toast({ title: '成功', description: `设备「${form.name}」已创建，可在 PID 组态中绑定到图元` })
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await apiDelete(`/api/equipments/${deleting.id}`)
      toast({ title: '成功', description: `设备「${deleting.name}」已删除（引用它的管线起止字段已自动置空）` })
      setDeleting(null)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Factory className="h-4 w-4 text-emerald-700" />
              设备管理
            </CardTitle>
            <CardDescription>
              维护减压塔/换热器/泵等静态设备台账，PID 组态图元可绑定设备、连线可绑定管线并自动回写管线的起止设备
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input
                className="h-8 w-48 pl-8 text-xs" placeholder="搜索位号/名称/装置"
                value={keyword} onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> 刷新
            </Button>
            <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={openCreate}>
              <Plus className="h-4 w-4" /> 新建设备
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[480px] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">设备位号</TableHead>
                <TableHead>设备名称</TableHead>
                <TableHead className="w-24">类型</TableHead>
                <TableHead className="w-36">所属装置</TableHead>
                <TableHead className="w-24 text-center">关联管线</TableHead>
                <TableHead>备注</TableHead>
                <TableHead className="w-36 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            {loading ? (
              <TableSkeleton cols={7} />
            ) : filtered.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState icon={<Inbox className="h-8 w-8" />} text={keyword ? '无匹配设备' : '暂无设备，点击右上角「新建设备」'} />
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {filtered.map((e) => {
                  const t = EQUIP_TYPE_MAP[e.type]
                  return (
                    <TableRow key={e.id} className="hover:bg-stone-50">
                      <TableCell className="font-mono font-medium text-stone-800">{e.code}</TableCell>
                      <TableCell>{e.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={t?.className ?? 'border-stone-200 bg-stone-50 text-stone-600'}>
                          {t?.label ?? e.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-stone-600">{e.unitName ?? '—'}</TableCell>
                      <TableCell className="text-center">
                        {(e.pipeCount ?? 0) > 0 ? (
                          <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
                            {e.pipeCount} 条
                          </Badge>
                        ) : (
                          <span className="text-xs text-stone-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-stone-500" title={e.remark ?? ''}>{e.remark ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="text-teal-700 hover:bg-teal-50 hover:text-teal-800" onClick={() => setAuditTarget(e)}>
                            <ScanSearch className="h-4 w-4" /> 校验
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(e)}>
                            <Pencil className="h-4 w-4" /> 编辑
                          </Button>
                          <Button
                            variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleting(e)}
                          >
                            <Trash2 className="h-4 w-4" /> 删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            )}
          </Table>
        </div>
      </CardContent>

      {/* 行内主数据体检（Task 54） */}
      <MasterAuditDialog
        open={auditTarget !== null}
        onOpenChange={(v) => { if (!v) setAuditTarget(null) }}
        entityType="EQUIPMENT"
        entityCode={auditTarget?.code ?? ''}
        entityName={auditTarget?.name ?? ''}
      />

      {/* 新建/编辑设备 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑设备' : '新建设备'}</DialogTitle>
            <DialogDescription>
              设备位号需唯一；设备可在 PID 组态中绑定到图元，作为管线连接关系的起止端点
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>设备位号 <span className="text-red-500">*</span></Label>
                <Input value={form.code} placeholder="如 T-101 / E-202 / P-101A" onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>设备名称 <span className="text-red-500">*</span></Label>
                <Input value={form.name} placeholder="如 减压塔" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>设备类型</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EQUIP_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>所属装置</Label>
                <Select value={form.unitId} onValueChange={(v) => setForm({ ...form, unitId: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>备注</Label>
              <Textarea rows={2} value={form.remark} placeholder="选填（型号/规格等）" onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除设备？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除设备「{deleting?.name}」（{deleting?.code}）。引用它作为起点/终点的管线将自动解除关联；
              PID 图中已放置的绑定关系不受影响，保存图时会因设备不存在而跳过回写。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ============ 数据字典 ============
interface DictForm {
  category: string
  value: string
  label: string
  order: string
}

const EMPTY_DICT_FORM: DictForm = { category: 'BLIND_SPEC', value: '', label: '', order: '0' }

function DictsTab() {
  const { toast } = useToast()
  /** 操作者标识（审计日志用） */
  const actor = () => {
    const u = getStoredUser()
    return { __actorId: u?.id ?? '', __actorName: u?.name ?? '' }
  }
  const actorQ = () => {
    const u = getStoredUser()
    return `__actorId=${encodeURIComponent(u?.id ?? '')}&__actorName=${encodeURIComponent(u?.name ?? '')}`
  }
  const [items, setItems] = useState<DictItem[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('ALL')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<DictItem | null>(null)
  const [form, setForm] = useState<DictForm>(EMPTY_DICT_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<DictItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = category === 'ALL' ? '' : `?category=${category}`
      const data = await apiGet<DictItem[]>(`/api/dicts${qs}`)
      setItems(data)
    } catch (err) {
      toast({ title: '加载失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [category, toast])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_DICT_FORM, category: category === 'ALL' ? 'BLIND_SPEC' : category })
    setDialogOpen(true)
  }

  const openEdit = (d: DictItem) => {
    setEditing(d)
    setForm({ category: d.category, value: d.value, label: d.label, order: String(d.order ?? 0) })
    setDialogOpen(true)
  }

  const submit = async () => {
    if (!form.value.trim() || !form.label.trim()) {
      toast({ title: '请完善必填项', description: '字典值与显示名不能为空', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = { category: form.category, value: form.value.trim(), label: form.label.trim(), order: Number(form.order) || 0 }
      if (editing) {
        await apiPut(`/api/dicts/${editing.id}`, { ...payload, ...actor() })
        toast({ title: '成功', description: '字典项已更新' })
      } else {
        await apiPost('/api/dicts', { ...payload, ...actor() })
        toast({ title: '成功', description: '字典项已新增' })
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await apiDelete(`/api/dicts/${deleting.id}?${actorQ()}`)
      toast({ title: '成功', description: '字典项已删除' })
      setDeleting(null)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-emerald-700" />
              数据字典
            </CardTitle>
            <CardDescription>维护盲板规格、类型、材质、压力等级、介质等枚举值</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="类别" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部类别</SelectItem>
                {DICT_CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={openCreate}>
              <Plus className="h-4 w-4" /> 新增字典项
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[480px] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>类别</TableHead>
                <TableHead>值</TableHead>
                <TableHead>显示名</TableHead>
                <TableHead>排序</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            {loading ? (
              <TableSkeleton cols={5} />
            ) : items.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState icon={<Inbox className="h-8 w-8" />} text="该类别下暂无字典项，点击「新增字典项」添加" />
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {items.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200">
                        {categoryLabel(d.category)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{d.value}</TableCell>
                    <TableCell>{d.label}</TableCell>
                    <TableCell>{d.order}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>
                          <Pencil className="h-4 w-4" /> 编辑
                        </Button>
                        <Button
                          variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleting(d)}
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
      </CardContent>

      {/* 新增/编辑字典项 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑字典项' : '新增字典项'}</DialogTitle>
            <DialogDescription>同一类别下字典值需唯一，删除前请确认无业务数据引用</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>类别 <span className="text-red-500">*</span></Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类别" />
                </SelectTrigger>
                <SelectContent>
                  {DICT_CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>值 <span className="text-red-500">*</span></Label>
                <Input value={form.value} placeholder="如 DN50" onChange={(e) => setForm({ ...form, value: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>显示名 <span className="text-red-500">*</span></Label>
                <Input value={form.label} placeholder="如 DN50" onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>排序</Label>
              <Input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除字典项？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {categoryLabel(deleting?.category ?? '')} 类别下的「{deleting?.label}」。
              已有业务数据以文本保存，不受影响，但新建数据将无法再选择该项。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
