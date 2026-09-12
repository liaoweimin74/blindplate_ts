'use client'
// 台账管理：盲板台账 + 变动记录 + 盲板库存
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ModuleProps, PLATE_STATUS_MAP, CHANGE_ACTION_MAP } from '@/lib/bp-types'
import { apiGet, apiPost, apiPut, fmtDate, fmtDateTime } from '@/lib/bp-api'
import { exportCsv } from '@/lib/bp-export'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  AlertTriangle, ArrowRight, BookOpenText, Boxes, ChevronDown, ClipboardList, Download, Gauge, Inbox, Layers, Pencil, Plus, Printer, QrCode, RefreshCw, Search, ShoppingCart,
} from 'lucide-react'
import { BatchLabelPrint, PlateLabelDialog } from '@/components/bp/plate-label-print'
import { PlateDossier } from '@/components/bp/plate-dossier'
import type { BpUser } from '@/lib/bp-types'

// ============ 类型 ============
interface DictItem {
  id: number
  category: string
  value: string
  label: string
  order: number
}

interface BlindPlate {
  id: number
  code: string
  spec: string
  type: string
  material: string
  thickness: number
  pressureRating: string
  status: string
  location?: string | null
  unitId?: number | null
  createdAt: string
  updatedAt: string
}

interface ChangeRecord {
  id: number
  blindPlateId?: number | null
  blindCode: string
  action: string
  workCode?: string | null
  location?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  operator: string
  note?: string | null
  createdAt: string
}

interface InventoryRow {
  id: number
  spec: string
  type: string
  material: string
  quantity: number
  minQuantity: number
  updatedAt: string
}

/** 采购建议单明细行（GET /api/purchase-requests 分组内，quantity/minQuantity 为当前库存快照） */
interface PurchaseItem {
  blindCode: string
  spec: string
  type: string
  material: string
  suggestQty: number
  quantity?: number | null
  minQuantity?: number | null
}

/** 采购建议单（按 PR 编号分组聚合的历史单） */
interface PurchaseGroup {
  code: string
  createdAt: string
  operator: string
  items: PurchaseItem[]
  totalQty: number
}

/** 库存建议单专用的非盲板台账状态文案（LOW_STOCK→ORDERED，仅采购建议场景使用） */
const EXTRA_STATUS_LABEL: Record<string, string> = {
  LOW_STOCK: '低库存',
  ORDERED: '已下单',
}

/** 变动动作徽章配色 */
const ACTION_BADGE: Record<string, string> = {
  RESERVE: 'bg-amber-100 text-amber-800 border-amber-200',
  INSTALL: 'bg-violet-100 text-violet-800 border-violet-200',
  REMOVE: 'bg-orange-100 text-orange-800 border-orange-200',
  RETURN: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  SCRAP: 'bg-stone-200 text-stone-500 border-stone-300',
  PURCHASE: 'bg-teal-100 text-teal-800 border-teal-200',
}

function statusLabel(s?: string | null): string {
  if (!s) return '-'
  return PLATE_STATUS_MAP[s]?.label ?? EXTRA_STATUS_LABEL[s] ?? s
}

function StatusBadge({ status }: { status: string }) {
  const meta = PLATE_STATUS_MAP[status]
  return (
    <Badge variant="outline" className={meta?.className ?? 'bg-stone-100 text-stone-600 border-stone-200'}>
      {meta?.label ?? status}
    </Badge>
  )
}

function ActionBadge({ action }: { action: string }) {
  return (
    <Badge variant="outline" className={ACTION_BADGE[action] ?? 'bg-stone-100 text-stone-600 border-stone-200'}>
      {CHANGE_ACTION_MAP[action] ?? action}
    </Badge>
  )
}

function StatusChangeCell({ from, to }: { from?: string | null; to?: string | null }) {
  if (!from && !to) return <span className="text-stone-400">-</span>
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span>{statusLabel(from)}</span>
      <ArrowRight className="h-3 w-3 text-stone-400" />
      <span className="font-medium">{statusLabel(to)}</span>
    </span>
  )
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <TableBody>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-[110px]" />
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
export default function LedgerModule({ initialTab, currentUser, focusId, onNavigate }: ModuleProps) {
  // 侧边栏子菜单跳转时通过 key 重挂载切换页签（Radix Tabs 非激活内容默认卸载）
  const normalized =
    initialTab === 'records' || initialTab === 'inventory' ? initialTab : 'plates'

  // 字典选项整个模块只加载一次
  const [dicts, setDicts] = useState<DictItem[]>([])
  useEffect(() => {
    apiGet<DictItem[]>('/api/dicts')
      .then(setDicts)
      .catch(() => setDicts([]))
  }, [])

  const specOptions = useMemo(() => dicts.filter((d) => d.category === 'BLIND_SPEC'), [dicts])
  const typeOptions = useMemo(() => dicts.filter((d) => d.category === 'BLIND_TYPE'), [dicts])
  const materialOptions = useMemo(() => dicts.filter((d) => d.category === 'MATERIAL'), [dicts])
  const pressureOptions = useMemo(() => dicts.filter((d) => d.category === 'PRESSURE'), [dicts])

  return (
    <Tabs key={normalized} defaultValue={normalized} className="space-y-4">
      <TabsList>
        <TabsTrigger value="plates">盲板台账</TabsTrigger>
        <TabsTrigger value="records">变动记录</TabsTrigger>
        <TabsTrigger value="inventory">盲板库存</TabsTrigger>
      </TabsList>
      <TabsContent value="plates">
        <PlatesTab
          specOptions={specOptions}
          pressureOptions={pressureOptions}
          typeOptions={typeOptions}
          materialOptions={materialOptions}
          currentUser={currentUser}
          focusId={normalized === 'plates' ? focusId : undefined}
          onNavigate={onNavigate}
        />
      </TabsContent>
      <TabsContent value="records">
        <RecordsTab />
      </TabsContent>
      <TabsContent value="inventory">
        <InventoryTab currentUser={currentUser} />
      </TabsContent>
    </Tabs>
  )
}

// ============ 盲板台账 ============
interface PlateForm {
  spec: string
  type: string
  material: string
  thickness: string
  pressureRating: string
}

interface DictOption {
  value: string
  label: string
}

function PlatesTab({
  specOptions, typeOptions, materialOptions, pressureOptions, currentUser, focusId, onNavigate,
}: {
  specOptions: DictOption[]
  typeOptions: DictOption[]
  materialOptions: DictOption[]
  pressureOptions: DictOption[]
  currentUser: BpUser
  /** 跳转辅助：携带 focusId 进入盲板台账页签时，自动打开对应盲板的一板一档 */
  focusId?: number
  onNavigate?: ModuleProps['onNavigate']
}) {
  const { toast } = useToast()
  const [plates, setPlates] = useState<BlindPlate[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('ALL')
  const [spec, setSpec] = useState('ALL')
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<PlateForm>({
    spec: '', type: '', material: '', thickness: '', pressureRating: '',
  })
  const [saving, setSaving] = useState(false)

  const [editTarget, setEditTarget] = useState<BlindPlate | null>(null)
  const [editForm, setEditForm] = useState<{ status: string; location: string }>({ status: 'IN_STOCK', location: '' })
  const [editSaving, setEditSaving] = useState(false)

  // —— 一板一档（全生命周期档案 Sheet）——
  const [dossierId, setDossierId] = useState<number>()
  // focusId 一次性消费（与 work-requests 同模式）：全局搜索/移动端扫码跳转进来时打开对应档案
  const lastFocusRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (focusId != null && focusId !== lastFocusRef.current) {
      lastFocusRef.current = focusId
      setDossierId(focusId)
    }
  }, [focusId])

  // —— 二维码标签打印（单张 + 批量）——
  const [labelTarget, setLabelTarget] = useState<BlindPlate | null>(null)
  const [selectedPlates, setSelectedPlates] = useState<Set<number>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)
  const selectedPlateRows = useMemo(
    () => plates.filter((p) => selectedPlates.has(p.id)),
    [plates, selectedPlates]
  )
  const allPlatesSelected = plates.length > 0 && plates.every((p) => selectedPlates.has(p.id))
  const somePlatesSelected = plates.some((p) => selectedPlates.has(p.id))

  const togglePlate = (id: number, checked: boolean) => {
    setSelectedPlates((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAllPlates = (checked: boolean) => {
    setSelectedPlates(checked ? new Set(plates.map((p) => p.id)) : new Set())
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status !== 'ALL') params.set('status', status)
      if (spec !== 'ALL') params.set('spec', spec)
      if (keyword.trim()) params.set('keyword', keyword.trim())
      const qs = params.toString()
      const data = await apiGet<BlindPlate[]>(`/api/blind-plates${qs ? `?${qs}` : ''}`)
      setPlates(data)
      // 行选择只保留当前列表中仍存在的盲板（筛选/刷新后清理失效选中）
      setSelectedPlates((prev) => {
        if (prev.size === 0) return prev
        const ids = new Set(data.map((p) => p.id))
        const next = new Set([...prev].filter((id) => ids.has(id)))
        return next.size === prev.size ? prev : next
      })
    } catch (err) {
      toast({ title: '加载失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [status, spec, keyword, toast])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setCreateForm({
      spec: specOptions[0]?.value ?? '',
      type: typeOptions[0]?.value ?? '',
      material: materialOptions[0]?.value ?? '',
      thickness: '',
      pressureRating: pressureOptions[0]?.value ?? '',
    })
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    if (!createForm.spec || !createForm.type || !createForm.material || !createForm.pressureRating) {
      toast({ title: '请完善必填项', description: '规格、类型、材质与压力等级不能为空', variant: 'destructive' })
      return
    }
    const thickness = Number(createForm.thickness)
    if (!createForm.thickness.trim() || !Number.isFinite(thickness) || thickness <= 0) {
      toast({ title: '请完善必填项', description: '厚度必须为大于 0 的数字（mm）', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await apiPost('/api/blind-plates', { ...createForm, thickness })
      toast({ title: '成功', description: '盲板已创建，编号由系统按 MB-规格-序号 生成' })
      setCreateOpen(false)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (p: BlindPlate) => {
    setEditTarget(p)
    setEditForm({ status: p.status, location: p.location ?? '' })
  }

  const submitEdit = async () => {
    if (!editTarget) return
    if (!editForm.status) {
      toast({ title: '请完善必填项', description: '请选择状态', variant: 'destructive' })
      return
    }
    setEditSaving(true)
    try {
      await apiPut(`/api/blind-plates/${editTarget.id}`, {
        status: editForm.status,
        location: editForm.location.trim() || null,
      })
      toast({ title: '成功', description: `盲板「${editTarget.code}」已更新` })
      setEditTarget(null)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-emerald-700" />
              盲板台账
            </CardTitle>
            <CardDescription>一板一码管理盲板从入库到安装、报废的全生命周期</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部状态</SelectItem>
                {Object.entries(PLATE_STATUS_MAP).map(([key, meta]) => (
                  <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={spec} onValueChange={setSpec}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="规格" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部规格</SelectItem>
                {specOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Input
                className="w-[180px]" placeholder="编号 / 位置"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setKeyword(keywordInput)
                }}
              />
              <Button variant="outline" size="sm" onClick={() => setKeyword(keywordInput)}>
                <Search className="h-4 w-4" /> 查询
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> 刷新
            </Button>
            <Button variant="outline" size="sm" disabled={plates.length === 0}
              onClick={() => exportCsv('盲板台账',
                ['盲板编号', '规格', '类型', '材质', '厚度(mm)', '压力等级', '状态', '当前位置', '建档时间'],
                plates.map((p) => [p.code, p.spec, p.type, p.material, p.thickness, p.pressureRating,
                  PLATE_STATUS_MAP[p.status]?.label ?? p.status, p.location ?? '', fmtDate(p.createdAt)]))}>
              <Download className="h-4 w-4" /> 导出
            </Button>
            <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={openCreate}>
              <Plus className="h-4 w-4" /> 新建盲板
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* 已选盲板浮条（批量打印标签入口） */}
        {selectedPlates.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5">
            <span className="text-sm text-emerald-900">
              已选 <span className="font-semibold">{selectedPlateRows.length}</span> 块盲板，可批量打印二维码标签
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedPlates(new Set())}>
                取消选择
              </Button>
              <Button
                size="sm"
                className="bg-emerald-700 hover:bg-emerald-800"
                disabled={selectedPlateRows.length === 0}
                onClick={() => setBatchOpen(true)}
              >
                <Printer className="h-4 w-4" /> 批量打印标签
              </Button>
            </div>
          </div>
        )}
        <div className="max-h-[480px] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPlatesSelected ? true : somePlatesSelected ? 'indeterminate' : false}
                    onCheckedChange={(v) => toggleAllPlates(v === true)}
                    aria-label="全选盲板"
                    disabled={plates.length === 0}
                  />
                </TableHead>
                <TableHead>编号</TableHead>
                <TableHead>规格</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>材质</TableHead>
                <TableHead>厚度(mm)</TableHead>
                <TableHead>压力等级</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>当前位置</TableHead>
                <TableHead>建档时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            {loading ? (
              <TableSkeleton cols={11} />
            ) : plates.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={11}>
                    <EmptyState icon={<Inbox className="h-8 w-8" />} text="未找到符合条件的盲板" />
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {plates.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedPlates.has(p.id)}
                        onCheckedChange={(v) => togglePlate(p.id, v === true)}
                        aria-label={`选择 ${p.code}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm font-medium">{p.code}</TableCell>
                    <TableCell>{p.spec}</TableCell>
                    <TableCell>{p.type}</TableCell>
                    <TableCell>{p.material}</TableCell>
                    <TableCell>{p.thickness}</TableCell>
                    <TableCell>{p.pressureRating}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell className="max-w-[160px] truncate text-stone-500">{p.location || '-'}</TableCell>
                    <TableCell className="text-stone-500">{fmtDate(p.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-emerald-700 hover:text-emerald-800"
                          onClick={() => setDossierId(p.id)}
                          title="查看一板一档"
                        >
                          <BookOpenText className="h-4 w-4" /> 档案
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-emerald-700 hover:text-emerald-800"
                          onClick={() => setLabelTarget(p)}
                          title="打印二维码标签"
                        >
                          <QrCode className="h-4 w-4" /> 打印标签
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" /> 编辑
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

      {/* 新建盲板 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>新建盲板</DialogTitle>
            <DialogDescription>编号由系统按「MB-规格-4位序号」自动生成，并同步累加对应库存</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>规格 <span className="text-red-500">*</span></Label>
                <Select value={createForm.spec} onValueChange={(v) => setCreateForm({ ...createForm, spec: v })}>
                  <SelectTrigger><SelectValue placeholder="选择规格" /></SelectTrigger>
                  <SelectContent>
                    {specOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>类型 <span className="text-red-500">*</span></Label>
                <Select value={createForm.type} onValueChange={(v) => setCreateForm({ ...createForm, type: v })}>
                  <SelectTrigger><SelectValue placeholder="选择类型" /></SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>材质 <span className="text-red-500">*</span></Label>
                <Select value={createForm.material} onValueChange={(v) => setCreateForm({ ...createForm, material: v })}>
                  <SelectTrigger><SelectValue placeholder="选择材质" /></SelectTrigger>
                  <SelectContent>
                    {materialOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>压力等级 <span className="text-red-500">*</span></Label>
                <Select value={createForm.pressureRating} onValueChange={(v) => setCreateForm({ ...createForm, pressureRating: v })}>
                  <SelectTrigger><SelectValue placeholder="选择压力等级" /></SelectTrigger>
                  <SelectContent>
                    {pressureOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>厚度(mm) <span className="text-red-500">*</span></Label>
              <Input
                type="number" step="0.1" min="0.1" value={createForm.thickness} placeholder="如 3"
                onChange={(e) => setCreateForm({ ...createForm, thickness: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={saving} onClick={() => void submitCreate()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑盲板（状态/位置） */}
      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>编辑盲板 {editTarget?.code}</DialogTitle>
            <DialogDescription>可调整台账状态与当前位置；预留/安装状态通常由作业流程自动联动</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>状态 <span className="text-red-500">*</span></Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                <SelectTrigger><SelectValue placeholder="选择状态" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PLATE_STATUS_MAP).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>当前位置</Label>
              <Input
                value={editForm.location} placeholder="在库=库位；已安装=装置+管线位置"
                onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={editSaving} onClick={() => void submitEdit()}>
              {editSaving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 单张二维码标签打印 */}
      <PlateLabelDialog
        open={!!labelTarget}
        plate={labelTarget}
        onOpenChange={(v) => {
          if (!v) setLabelTarget(null)
        }}
      />
      {/* 批量二维码标签打印 */}
      <BatchLabelPrint open={batchOpen} plates={selectedPlateRows} onClose={() => setBatchOpen(false)} />
      {/* 盲板一板一档（全生命周期档案 Sheet；打印标签复用既有单张 Dialog） */}
      <PlateDossier
        plateId={dossierId}
        open={dossierId != null}
        onOpenChange={(o) => {
          if (!o) setDossierId(undefined)
        }}
        currentUser={currentUser}
        onNavigate={onNavigate}
        onPrintLabel={(pid) => {
          setDossierId(undefined)
          const pl = plates.find((x) => x.id === pid)
          if (pl) setLabelTarget(pl)
        }}
      />
    </Card>
  )
}

// ============ 变动记录 ============
function RecordsTab() {
  const { toast } = useToast()
  const [records, setRecords] = useState<ChangeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<ChangeRecord[]>('/api/change-records?limit=100')
      setRecords(data)
    } catch (err) {
      toast({ title: '加载失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () => (action === 'ALL' ? records : records.filter((r) => r.action === action)),
    [records, action]
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-emerald-700" />
              变动记录
            </CardTitle>
            <CardDescription>预留、安装、拆除、归还、报废、采购入库等动作全留痕（最新 100 条）</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="动作" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部动作</SelectItem>
                {Object.entries(CHANGE_ACTION_MAP).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> 刷新
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[480px] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>盲板编号</TableHead>
                <TableHead>动作</TableHead>
                <TableHead>关联单号</TableHead>
                <TableHead>位置</TableHead>
                <TableHead>状态变化</TableHead>
                <TableHead>操作人</TableHead>
                <TableHead className="min-w-[180px]">备注</TableHead>
              </TableRow>
            </TableHeader>
            {loading ? (
              <TableSkeleton cols={8} />
            ) : filtered.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState icon={<Inbox className="h-8 w-8" />} text="暂无变动记录" />
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-stone-500">{fmtDateTime(r.createdAt)}</TableCell>
                    <TableCell className="font-mono text-sm font-medium">{r.blindCode}</TableCell>
                    <TableCell><ActionBadge action={r.action} /></TableCell>
                    <TableCell className="font-mono text-xs text-stone-600">{r.workCode || '-'}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-stone-500">{r.location || '-'}</TableCell>
                    <TableCell><StatusChangeCell from={r.fromStatus} to={r.toStatus} /></TableCell>
                    <TableCell>{r.operator}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-stone-500">{r.note || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// ============ 盲板库存 ============
function InventoryTab({ currentUser }: { currentUser: BpUser }) {
  const { toast } = useToast()
  const [items, setItems] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adjustTarget, setAdjustTarget] = useState<InventoryRow | null>(null)
  const [delta, setDelta] = useState('')
  const [saving, setSaving] = useState(false)
  // 预警线设置（仅管理员）
  const canSetMin = currentUser.role === 'ADMIN'
  const [minTarget, setMinTarget] = useState<InventoryRow | null>(null)
  const [minValue, setMinValue] = useState('')
  const [minSaving, setMinSaving] = useState(false)
  // —— 采购建议单（低库存一键生成 PR）——
  const alertItems = useMemo(() => items.filter((i) => i.quantity <= i.minQuantity), [items])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [prOpen, setPrOpen] = useState(false)
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({})
  const [prSaving, setPrSaving] = useState(false)
  // 采购建议历史（折叠卡）
  const [historyOpen, setHistoryOpen] = useState(false)
  const [prGroups, setPrGroups] = useState<PurchaseGroup[]>([])
  const [prLoading, setPrLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<InventoryRow[]>('/api/inventory')
      setItems(data)
    } catch (err) {
      toast({ title: '加载失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const openAdjust = (item: InventoryRow) => {
    setAdjustTarget(item)
    setDelta('')
  }

  const openMinEdit = (item: InventoryRow) => {
    setMinTarget(item)
    setMinValue(String(item.minQuantity))
  }

  const submitMin = async () => {
    if (!minTarget) return
    const n = Number(minValue)
    if (minValue.trim() === '' || !Number.isInteger(n) || n < 0) {
      toast({ title: '请输入有效数值', description: '预警线必须为不小于 0 的整数', variant: 'destructive' })
      return
    }
    setMinSaving(true)
    try {
      await apiPut<InventoryRow>(`/api/inventory/${minTarget.id}`, { minQuantity: n })
      toast({ title: '成功', description: `${minTarget.spec} ${minTarget.type} 预警线已设为 ${n}` })
      setMinTarget(null)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setMinSaving(false)
    }
  }

  const submitAdjust = async () => {
    if (!adjustTarget) return
    const n = Number(delta)
    if (delta.trim() === '' || !Number.isInteger(n) || n === 0) {
      toast({ title: '请输入有效数值', description: '调整数量必须为非 0 整数，正数入库、负数出库', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const updated = await apiPost<InventoryRow>(`/api/inventory/${adjustTarget.id}/adjust`, { delta: n, __actorId: currentUser.id, __actorName: currentUser.name })
      toast({
        title: '成功',
        description: `${adjustTarget.spec} ${adjustTarget.type} 库存已调整为 ${updated.quantity}`,
      })
      setAdjustTarget(null)
      await load()
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const alertCount = alertItems.length
  const selectedRows = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected])
  const allAlertSelected = alertItems.length > 0 && alertItems.every((i) => selected.has(i.id))
  const someAlertSelected = alertItems.some((i) => selected.has(i.id))

  const loadHistory = useCallback(async () => {
    setPrLoading(true)
    try {
      const data = await apiGet<PurchaseGroup[]>('/api/purchase-requests')
      setPrGroups(data)
    } catch {
      setPrGroups([])
    } finally {
      setPrLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const toggleSelect = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleSelectAllAlerts = (checked: boolean) => {
    setSelected(checked ? new Set(alertItems.map((i) => i.id)) : new Set())
  }

  const openPrDialog = () => {
    // 建议补货量默认填缺口（最低库存 - 当前库存，至少 1），可改
    const draft: Record<number, string> = {}
    for (const i of selectedRows) draft[i.id] = String(Math.max(i.minQuantity - i.quantity, 1))
    setQtyDraft(draft)
    setPrOpen(true)
  }

  const submitPr = async () => {
    if (selectedRows.length === 0) return
    for (const i of selectedRows) {
      const q = Number(qtyDraft[i.id])
      if ((qtyDraft[i.id] ?? '').trim() === '' || !Number.isInteger(q) || q < 1) {
        toast({ title: '请完善建议补货量', description: '每项建议补货量必须为不小于 1 的整数', variant: 'destructive' })
        return
      }
    }
    setPrSaving(true)
    try {
      const res = await apiPost<{ code: string; totalQty: number }>('/api/purchase-requests', {
        __actorId: currentUser.id,
        __actorName: currentUser.name,
        items: selectedRows.map((i) => ({
          inventoryId: i.id,
          spec: i.spec,
          type: i.type,
          material: i.material,
          gap: Math.max(i.minQuantity - i.quantity, 0),
          suggestQty: Number(qtyDraft[i.id]),
        })),
      })
      toast({
        title: '采购建议单已提交',
        description: `编号 ${res.code}：共 ${selectedRows.length} 项、合计建议补货 ${res.totalQty} 件，已通知经理/管理员`,
      })
      setSelected(new Set())
      setPrOpen(false)
      setHistoryOpen(true)
      await Promise.all([load(), loadHistory()])
    } catch (err) {
      toast({ title: '操作失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setPrSaving(false)
    }
  }

  const exportPurchaseCsv = () => {
    exportCsv(
      '采购建议单',
      ['建议单编号', '提交时间', '操作人', '规格', '类型', '材质', '建议补货量(件)'],
      prGroups.flatMap((g) =>
        g.items.map((it) => [g.code, fmtDateTime(g.createdAt), g.operator, it.spec, it.type, it.material, it.suggestQty])
      )
    )
  }

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="h-4 w-4 text-emerald-700" />
              盲板库存
            </CardTitle>
            <CardDescription>
              按「规格 + 类型 + 材质」汇总的在库数量{alertCount > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 text-red-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {alertCount} 项低于预警线
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={items.length === 0}
              onClick={() => exportCsv('盲板库存',
                ['规格', '类型', '材质', '在库数量', '最低库存', '库存状态', '更新时间'],
                items.map((i) => [i.spec, i.type, i.material, i.quantity, i.minQuantity,
                  i.quantity <= i.minQuantity ? '补库预警' : '正常', fmtDateTime(i.updatedAt)]))}>
              <Download className="h-4 w-4" /> 导出
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> 刷新
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* 已选低库存项浮条（表头上方） */}
        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
            <span className="text-sm text-amber-900">
              已选 <span className="font-semibold">{selected.size}</span> 项低库存物料 · 建议数量自动填缺口（可改）
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                取消选择
              </Button>
              <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={openPrDialog}>
                <ShoppingCart className="h-4 w-4" /> 生成采购建议单
              </Button>
            </div>
          </div>
        )}
        <div className="max-h-[480px] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allAlertSelected ? true : someAlertSelected ? 'indeterminate' : false}
                    onCheckedChange={(v) => toggleSelectAllAlerts(v === true)}
                    aria-label="全选低库存项"
                    disabled={alertItems.length === 0}
                  />
                </TableHead>
                <TableHead>规格</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>材质</TableHead>
                <TableHead>在库数量</TableHead>
                <TableHead>最低库存</TableHead>
                <TableHead>库存状态</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            {loading ? (
              <TableSkeleton cols={9} />
            ) : items.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={9}>
                    <EmptyState icon={<Inbox className="h-8 w-8" />} text="暂无库存数据，可通过「新建盲板」生成" />
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {items.map((i) => {
                  const alert = i.quantity <= i.minQuantity
                  return (
                    <TableRow key={i.id} className={alert ? 'bg-red-50/70 hover:bg-red-100/60' : undefined}>
                      <TableCell>
                        {alert ? (
                          <Checkbox
                            checked={selected.has(i.id)}
                            onCheckedChange={(v) => toggleSelect(i.id, v === true)}
                            aria-label={`选择 ${i.spec} ${i.type}`}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="font-medium">{i.spec}</TableCell>
                      <TableCell>{i.type}</TableCell>
                      <TableCell>{i.material}</TableCell>
                      <TableCell className="font-mono">{i.quantity}</TableCell>
                      <TableCell className="font-mono">{i.minQuantity}</TableCell>
                      <TableCell>
                        {alert ? (
                          <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200">补库预警</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">正常</Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-stone-500">{fmtDateTime(i.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canSetMin && (
                            <Button variant="ghost" size="sm" className="text-stone-500 hover:text-amber-700" onClick={() => openMinEdit(i)} title="设置库存预警线">
                              <Gauge className="h-4 w-4" /> 预警线
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => openAdjust(i)}>
                            <Pencil className="h-4 w-4" /> 调整库存
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

      {/* 调整库存 */}
      <Dialog open={!!adjustTarget} onOpenChange={(v) => !v && setAdjustTarget(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>调整库存</DialogTitle>
            <DialogDescription>
              {adjustTarget && (
                <>
                  {adjustTarget.spec} / {adjustTarget.type} / {adjustTarget.material}，当前在库{' '}
                  <span className="font-semibold text-stone-700">{adjustTarget.quantity}</span> 件
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>调整数量（正数入库 / 负数出库） <span className="text-red-500">*</span></Label>
              <Input
                type="number" step="1" value={delta} placeholder="如 5 或 -2" autoFocus
                onChange={(e) => setDelta(e.target.value)}
              />
              <p className="text-xs text-stone-500">
                输入整数后保存，例如 +5 表示采购入库 5 件，-2 表示出库 2 件；调整后库存不能小于 0。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>取消</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={saving} onClick={() => void submitAdjust()}>
              {saving ? '保存中…' : '确认调整'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 设置预警线（仅管理员） */}
      <Dialog open={!!minTarget} onOpenChange={(v) => !v && setMinTarget(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Gauge className="w-4 h-4 text-amber-600" />设置库存预警线</DialogTitle>
            <DialogDescription>
              {minTarget && (
                <>
                  {minTarget.spec} / {minTarget.type} / {minTarget.material}，当前在库{' '}
                  <span className="font-semibold text-stone-700">{minTarget.quantity}</span> 件，当前预警线 {minTarget.minQuantity}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>最低库存（预警线） <span className="text-red-500">*</span></Label>
              <Input
                type="number" step="1" min={0} value={minValue} autoFocus
                onChange={(e) => setMinValue(e.target.value)}
              />
              <p className="text-xs text-stone-500">
                在库数量 ≤ 预警线时，列表行将标红并计入看板库存预警；适用于调整各规格的安全库存水平。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMinTarget(null)}>取消</Button>
            <Button className="bg-amber-600 hover:bg-amber-700 text-white" disabled={minSaving} onClick={() => void submitMin()}>
              {minSaving ? '保存中…' : '保存预警线'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 生成采购建议单（明细确认 + 建议补货量可改） */}
      <Dialog open={prOpen} onOpenChange={setPrOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-emerald-700" /> 生成采购建议单
            </DialogTitle>
            <DialogDescription>
              系统按明细生成 PR 编号并通知经理/管理员；到货入库后在列表「调整库存」中按正数入库。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[300px] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>规格</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>当前库存</TableHead>
                  <TableHead>最低库存</TableHead>
                  <TableHead>建议补货量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedRows.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.spec}</TableCell>
                    <TableCell>{i.type}</TableCell>
                    <TableCell className="font-mono text-red-600">{i.quantity}</TableCell>
                    <TableCell className="font-mono">{i.minQuantity}</TableCell>
                    <TableCell>
                      <Input
                        type="number" min={1} step={1} className="h-8 w-24"
                        value={qtyDraft[i.id] ?? ''}
                        onChange={(e) => setQtyDraft({ ...qtyDraft, [i.id]: e.target.value })}
                        aria-label={`${i.spec} ${i.type} 建议补货量`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-stone-500">
            共 {selectedRows.length} 项 · 建议补货合计{' '}
            <span className="font-semibold text-emerald-700">
              {selectedRows.reduce((s, i) => s + (Number(qtyDraft[i.id]) || 0), 0)}
            </span>{' '}
            件；提交后可在下方「采购建议历史」与「变动记录」中查看
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrOpen(false)}>取消</Button>
            <Button
              className="bg-emerald-700 hover:bg-emerald-800"
              disabled={prSaving || selectedRows.length === 0}
              onClick={() => void submitPr()}
            >
              {prSaving ? '提交中…' : '确认提交'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>

    {/* 采购建议历史（折叠卡） */}
    <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-2 text-stone-700 hover:text-emerald-800">
                <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? '' : '-rotate-90'}`} />
                采购建议历史
                <Badge variant="outline" className="ml-1 bg-teal-50 text-teal-700 border-teal-200">
                  {prGroups.length} 单
                </Badge>
              </Button>
            </CollapsibleTrigger>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={prGroups.length === 0} onClick={exportPurchaseCsv}>
                <Download className="h-4 w-4" /> 导出建议单 CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
                <RefreshCw className="h-4 w-4" /> 刷新
              </Button>
            </div>
          </div>
          <CardDescription>
            由库存预警一键生成的采购建议单（PR 编号），提交时已向经理/管理员广播通知
          </CardDescription>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            {prLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : prGroups.length === 0 ? (
              <EmptyState
                icon={<ShoppingCart className="h-8 w-8" />}
                text="暂无采购建议单，勾选低库存项后点击「生成采购建议单」"
              />
            ) : (
              <div className="max-h-[420px] space-y-3 overflow-y-auto">
                {prGroups.map((g) => (
                  <div key={g.code} className="rounded-lg border border-stone-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-emerald-800">{g.code}</span>
                      <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200">
                        明细 {g.items.length} 项 · 合计 {g.totalQty} 件
                      </Badge>
                      <span className="text-xs text-stone-500">{fmtDateTime(g.createdAt)}</span>
                      <span className="text-xs text-stone-500">操作人：{g.operator}</span>
                    </div>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-stone-100 text-left text-stone-400">
                            <th className="py-1.5 pr-3 font-medium">规格</th>
                            <th className="py-1.5 pr-3 font-medium">类型</th>
                            <th className="py-1.5 pr-3 font-medium">材质</th>
                            <th className="py-1.5 pr-3 text-right font-medium">当前库存</th>
                            <th className="py-1.5 pr-3 text-right font-medium">最低库存</th>
                            <th className="py-1.5 text-right font-medium">建议补货</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-50">
                          {g.items.map((it, idx) => (
                            <tr key={idx} className="text-stone-600">
                              <td className="py-1.5 pr-3 font-mono font-medium text-stone-700">{it.spec}</td>
                              <td className="py-1.5 pr-3">{it.type}</td>
                              <td className="py-1.5 pr-3">{it.material}</td>
                              <td className="py-1.5 pr-3 text-right font-mono">{it.quantity ?? '—'}</td>
                              <td className="py-1.5 pr-3 text-right font-mono">{it.minQuantity ?? '—'}</td>
                              <td className="py-1.5 text-right font-mono font-semibold text-emerald-700">+{it.suggestQty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
    </div>
  )
}
