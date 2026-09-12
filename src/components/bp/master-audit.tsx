'use client'
// 主数据体检前端（Task 54）：结果展示 / 体检面板（基础数据管理·数据体检页签）/ 行内校验 Dialog（设备/管线台账行）
// 口径：硬矛盾（规则引擎 R1-R8）= 红/amber/slate 分级；AI 疑似矛盾（S1-S3）= violet +「需人工确认」徽标；
//      报告导出 PDF（服务端渲染 + upload/master-audit 存档）；系统绝不自动修改主数据。
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost } from '@/lib/bp-api'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { FileDown, History, Loader2, ScanSearch, ShieldAlert, ShieldCheck, Sparkles, Play } from 'lucide-react'

// ============ 类型（与后端契约一致） ============
export interface AuditViolation {
  ruleId: string
  ruleName: string
  severity: 'ERROR' | 'WARNING' | 'INFO'
  entityType: 'UNIT' | 'EQUIPMENT' | 'PIPELINE' | 'ISO_POINT'
  entityCode: string
  entityName: string
  title: string
  evidence: string[]
  suggestion: string
  aiSuspect: boolean
}

export interface AuditReport {
  reportId: string
  createdAt: string
  scopeText: string
  depth: 'FAST' | 'DEEP'
  stats: { units: number; equipments: number; pipelines: number; isoPoints: number }
  summary: { error: number; warning: number; info: number; aiSuspect: number }
  violations: AuditViolation[]
  durationMs: number
}

export interface AuditArchiveEntry {
  reportId: string
  createdAt: string
  scopeText: string
  depth: 'FAST' | 'DEEP'
  stats: { units: number; equipments: number; pipelines: number; isoPoints: number }
  summary: { error: number; warning: number; info: number; aiSuspect: number }
  pdfReady: boolean
}

const ET_ZH: Record<string, string> = { UNIT: '装置', EQUIPMENT: '设备', PIPELINE: '管线', ISO_POINT: '隔离点' }

const SEV_BADGE: Record<string, string> = {
  ERROR: 'bg-red-100 text-red-800 border-red-200',
  WARNING: 'bg-amber-100 text-amber-800 border-amber-200',
  INFO: 'bg-stone-100 text-stone-700 border-stone-200',
}
const SEV_ZH: Record<string, string> = { ERROR: '错误', WARNING: '警告', INFO: '提示' }

/**
 * 体检任务提交+轮询（深度档 LLM 复核耗时 30~120s，同步等待会被外层代理拖断 502；
 * 异步任务化后所有请求都是短请求）。DEEP 失败时错误信息含 AI 复核真实原因透传，
 * 不自动降级——重试深度档还是改跑快速档由用户自己决定。
 */
async function submitAndPollValidate(
  scope: unknown,
  depth: 'FAST' | 'DEEP',
): Promise<AuditReport> {
  const { taskId } = await apiPost<{ taskId: string }>('/api/master/validate', { scope, depth })
  const t0 = Date.now()
  let misses = 0
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000))
    if (Date.now() - t0 > 300_000) throw new Error('体检超时（超过 5 分钟）——请缩小体检范围后重试')
    let st: { status: 'running' | 'done' | 'error'; report?: AuditReport; error?: string }
    try {
      st = await apiGet<{ status: 'running' | 'done' | 'error'; report?: AuditReport; error?: string }>(
        `/api/master/validate?taskId=${encodeURIComponent(taskId)}`,
      )
      misses = 0
    } catch {
      misses++
      if (misses >= 3) throw new Error('体检任务查询失败（网络波动或服务重启），请重新发起')
      continue
    }
    if (st.status === 'done' && st.report) return st.report
    if (st.status === 'error') throw new Error(st.error || '体检执行失败')
  }
}

// ============ 结果展示（共享） ============
export function MasterAuditResult({ report }: { report: AuditReport }) {
  const { toast } = useToast()
  const [exporting, setExporting] = useState(false)
  const s = report.summary

  const exportPdf = async () => {
    setExporting(true)
    try {
      const res = await fetch(`/api/master/validate/pdf?reportId=${encodeURIComponent(report.reportId)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`导出失败(${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${report.reportId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'PDF 报告已导出', description: '报告已同时存档，可在「历史存档」中随时重新下载' })
    } catch (e) {
      toast({ title: '导出失败', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* 概览行 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-stone-50 p-3">
        <Badge variant="outline" className="border-red-200 bg-red-100 text-red-800">错误 {s.error}</Badge>
        <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">警告 {s.warning}</Badge>
        <Badge variant="outline" className="border-stone-200 bg-stone-100 text-stone-700">提示 {s.info}</Badge>
        {s.aiSuspect > 0 && (
          <Badge variant="outline" className="border-violet-200 bg-violet-100 text-violet-800">
            <Sparkles className="mr-1 h-3 w-3" />AI 疑似 {s.aiSuspect}
          </Badge>
        )}
        <span className="text-xs text-stone-500">
          快照：装置 {report.stats.units} / 设备 {report.stats.equipments} / 管线 {report.stats.pipelines} / 隔离点 {report.stats.isoPoints}
          · 耗时 {(report.durationMs / 1000).toFixed(1)}s
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-stone-400 sm:inline">{report.reportId}</span>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-teal-600 text-teal-700 hover:bg-teal-50 hover:text-teal-800" disabled={exporting} onClick={exportPdf}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} 导出 PDF 报告
          </Button>
        </div>
      </div>

      {/* 矛盾列表 */}
      {report.violations.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <ShieldCheck className="h-5 w-5" /> 未检出矛盾，主数据自洽。
        </div>
      ) : (
        <div className="max-h-[460px] space-y-2.5 overflow-y-auto pr-1 bp-thin-scrollbar">
          {report.violations.map((v, i) => (
            <div key={`${v.ruleId}-${v.entityCode}-${i}`} className={`rounded-lg border p-3 ${v.aiSuspect ? 'border-violet-200 bg-violet-50/40' : v.severity === 'ERROR' ? 'border-red-200 bg-red-50/40' : v.severity === 'WARNING' ? 'border-amber-200 bg-amber-50/40' : 'border-stone-200 bg-stone-50/40'}`}>
              <div className="flex flex-wrap items-center gap-2">
                {!v.aiSuspect && (
                  <Badge variant="outline" className={`shrink-0 ${SEV_BADGE[v.severity]}`}>{SEV_ZH[v.severity]}</Badge>
                )}
                {v.aiSuspect && (
                  <Badge variant="outline" className="shrink-0 border-violet-200 bg-violet-100 text-violet-800">
                    <Sparkles className="mr-1 h-3 w-3" />AI 疑似
                  </Badge>
                )}
                <span className="text-sm font-semibold text-stone-800">
                  {v.ruleId} {v.ruleName}
                </span>
                <span className="text-xs text-stone-500">{ET_ZH[v.entityType]} {v.entityCode}</span>
              </div>
              <p className="mt-1.5 text-sm font-medium text-stone-900">{v.title}</p>
              {v.evidence.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {v.evidence.map((e, j) => (
                    <li key={j} className="text-xs leading-5 text-stone-600">· {e}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-xs leading-5 text-emerald-800">
                <span className="font-medium">处置建议：</span>{v.suggestion}
                {v.aiSuspect && <span className="ml-1 text-violet-700">（AI 疑似结论，修改前请人工核实）</span>}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============ 体检面板（数据体检页签） ============
const DEEP_HINTS = ['规则引擎扫描中（R1-R8 确定性规则）…', '构建主数据快照…', 'AI 语义复核中（介质相容性/名称匹配/位号语义）…', 'AI 正在逐条复核硬矛盾…', '即将完成，生成体检报告…（深度档含 AI 复核，通常 30~120 秒）']

export function MasterAuditPanel() {
  const { toast } = useToast()
  const [scopeType, setScopeType] = useState<'ALL' | 'UNIT' | 'EQUIPMENT' | 'PIPELINE'>('ALL')
  const [unitOptions, setUnitOptions] = useState<{ code: string; name: string }[]>([])
  const [equipOptions, setEquipOptions] = useState<{ code: string; name: string }[]>([])
  const [pipeOptions, setPipeOptions] = useState<{ code: string; name: string }[]>([])
  const [unitCode, setUnitCode] = useState('')
  const [eqCode, setEqCode] = useState('')
  const [pipeCode, setPipeCode] = useState('')
  const [depth, setDepth] = useState<'FAST' | 'DEEP'>('FAST')
  const [running, setRunning] = useState(false)
  const [hintIdx, setHintIdx] = useState(0)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [archives, setArchives] = useState<AuditArchiveEntry[]>([])
  const [archivesLoading, setArchivesLoading] = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadOptions = useCallback(async () => {
    try {
      const [un, eq, pl] = await Promise.all([
        apiGet<{ code: string; name: string; active: boolean }[]>('/api/units'),
        apiGet<{ list: { code: string; name: string }[] }>('/api/equipments'),
        apiGet<{ list: { code: string; name: string }[] }>('/api/pipelines'),
      ])
      // 体检快照只包含 active 装置，下拉同步只列 active，避免选停用装置后「未找到装置」
      setUnitOptions((Array.isArray(un) ? un : []).filter((x) => x.active).map((x) => ({ code: x.code, name: x.name })))
      setEquipOptions((eq.list ?? []).map((x) => ({ code: x.code, name: x.name })))
      setPipeOptions((pl.list ?? []).map((x) => ({ code: x.code, name: x.name })))
    } catch {
      /* 选项加载失败不阻塞 */
    }
  }, [])

  const loadArchives = useCallback(async () => {
    setArchivesLoading(true)
    try {
      const r = await apiGet<{ reports: AuditArchiveEntry[] }>('/api/master/validate/reports')
      setArchives(r.reports ?? [])
    } catch {
      setArchives([])
    } finally {
      setArchivesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOptions()
    void loadArchives()
  }, [loadOptions, loadArchives])

  useEffect(() => {
    if (running) {
      setHintIdx(0)
      timerRef.current = setInterval(() => setHintIdx((i) => Math.min(i + 1, DEEP_HINTS.length - 1)), 4000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [running])

  const run = async () => {
    if (scopeType === 'UNIT' && !unitCode.trim()) return toast({ title: '请选择装置', variant: 'destructive' })
    if (scopeType === 'EQUIPMENT' && !eqCode.trim()) return toast({ title: '请选择设备', variant: 'destructive' })
    if (scopeType === 'PIPELINE' && !pipeCode.trim()) return toast({ title: '请选择管线', variant: 'destructive' })
    setRunning(true)
    setReport(null)
    try {
      const scope =
        scopeType === 'ALL' ? { type: 'ALL' }
        : scopeType === 'UNIT' ? { type: 'UNIT', code: unitCode.trim() }
        : scopeType === 'EQUIPMENT' ? { type: 'EQUIPMENT', code: eqCode.trim() }
        : { type: 'PIPELINE', code: pipeCode.trim() }
      const r = await submitAndPollValidate(scope, depth)
      setReport(r)
      void loadArchives()
      toast({ title: '体检完成', description: `错误 ${r.summary.error} / 警告 ${r.summary.warning} / 提示 ${r.summary.info}${r.summary.aiSuspect ? ` / AI 疑似 ${r.summary.aiSuspect}` : ''}` })
    } catch (e) {
      toast({ title: '体检失败', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 校验配置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanSearch className="h-4 w-4 text-teal-700" /> 主数据体检
          </CardTitle>
          <CardDescription>
            对装置/设备/管线/隔离点主数据做自洽性校验：规则引擎（R1-R8）检出硬矛盾；深度档追加 AI 语义复核（介质相容性/名称匹配/位号语义）。报告可导出 PDF 存档。系统只检出矛盾，不会自动修改任何主数据
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>校验范围</Label>
              <Select value={scopeType} onValueChange={(v) => setScopeType(v as 'ALL' | 'UNIT' | 'EQUIPMENT' | 'PIPELINE')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部主数据</SelectItem>
                  <SelectItem value="UNIT">按装置（装置内全部数据）</SelectItem>
                  <SelectItem value="EQUIPMENT">单设备（含邻接数据）</SelectItem>
                  <SelectItem value="PIPELINE">单管线（含邻接数据）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scopeType === 'UNIT' && (
              <div className="grid gap-1.5">
                <Label>选择装置</Label>
                <Select value={unitCode} onValueChange={setUnitCode}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="选择装置" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {unitOptions.map((u) => (
                      <SelectItem key={u.code} value={u.code}>{u.code} · {u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {scopeType === 'EQUIPMENT' && (
              <div className="grid gap-1.5">
                <Label>选择设备</Label>
                <Select value={eqCode} onValueChange={setEqCode}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="选择设备位号" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {equipOptions.map((e) => (
                      <SelectItem key={e.code} value={e.code}>{e.code} · {e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {scopeType === 'PIPELINE' && (
              <div className="grid gap-1.5">
                <Label>选择管线</Label>
                <Select value={pipeCode} onValueChange={setPipeCode}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="选择管线代号" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {pipeOptions.map((p) => (
                      <SelectItem key={p.code} value={p.code}>{p.code} · {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>校验档位</Label>
              <Select value={depth} onValueChange={(v) => setDepth(v as 'FAST' | 'DEEP')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FAST">快速（纯规则，秒级）</SelectItem>
                  <SelectItem value="DEEP">深度（规则 + AI 语义复核，约 10-30 秒）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="h-10 gap-1.5 bg-teal-700 px-5 text-white hover:bg-teal-800" disabled={running} onClick={() => void run()}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? (depth === 'DEEP' ? DEEP_HINTS[hintIdx] : '校验中…') : '开始校验'}
            </Button>
            <span className="text-xs text-stone-500">深度档由 AI 逐条复核硬矛盾并扫描语义盲区，结论供人工确认</span>
          </div>
        </CardContent>
      </Card>

      {/* 校验结果 */}
      {running && !report && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {report && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">体检结果 · {report.scopeText}</CardTitle>
            <CardDescription>
              {report.depth === 'DEEP' ? '深度校验（规则引擎 + AI 语义复核）' : '快速校验（规则引擎）'} · 报告编号 {report.reportId}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MasterAuditResult report={report} />
          </CardContent>
        </Card>
      )}

      {/* 历史存档 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-stone-500" /> 历史存档
          </CardTitle>
          <CardDescription>体检报告自动存档（upload/master-audit），可随时重新下载 PDF</CardDescription>
        </CardHeader>
        <CardContent>
          {archivesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : archives.length === 0 ? (
            <p className="py-4 text-center text-sm text-stone-500">暂无存档报告</p>
          ) : (
            <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1 bp-thin-scrollbar">
              {archives.map((a) => (
                <div key={a.reportId} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs text-stone-500">{a.reportId}</span>
                      <Badge variant="outline" className={a.depth === 'DEEP' ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-stone-200 bg-stone-50 text-stone-600'}>
                        {a.depth === 'DEEP' ? '深度' : '快速'}
                      </Badge>
                      {a.summary.error > 0 && <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">错误 {a.summary.error}</Badge>}
                      {a.summary.warning > 0 && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">警告 {a.summary.warning}</Badge>}
                      {a.summary.aiSuspect > 0 && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">AI 疑似 {a.summary.aiSuspect}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-stone-500">
                      {new Date(a.createdAt).toLocaleString('zh-CN')} · {a.scopeText} · 快照 设备{a.stats.equipments}/管线{a.stats.pipelines}
                    </p>
                  </div>
                  <Button
                    size="sm" variant="outline" className="h-8 gap-1.5 border-teal-600 text-teal-700 hover:bg-teal-50 hover:text-teal-800"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/master/validate/pdf?reportId=${encodeURIComponent(a.reportId)}`, { cache: 'no-store' })
                        if (!res.ok) throw new Error(`下载失败(${res.status})`)
                        const blob = await res.blob()
                        const url = URL.createObjectURL(blob)
                        const el = document.createElement('a')
                        el.href = url
                        el.download = `${a.reportId}.pdf`
                        document.body.appendChild(el)
                        el.click()
                        el.remove()
                        URL.revokeObjectURL(url)
                      } catch (e) {
                        toast({ title: '下载失败', description: (e as Error).message, variant: 'destructive' })
                      }
                    }}
                  >
                    <FileDown className="h-3.5 w-3.5" /> 下载 PDF
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ============ 行内校验 Dialog（设备/管线台账行「校验」按钮） ============
export function MasterAuditDialog({
  open, onOpenChange, entityType, entityCode, entityName,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  entityType: 'EQUIPMENT' | 'PIPELINE'
  entityCode: string
  entityName?: string | null
}) {
  const { toast } = useToast()
  const [depth, setDepth] = useState<'FAST' | 'DEEP'>('FAST')
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [hintIdx, setHintIdx] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const runAudit = useCallback(async (d: 'FAST' | 'DEEP') => {
    setRunning(true)
    try {
      const r = await submitAndPollValidate({ type: entityType, code: entityCode }, d)
      setReport(r)
    } catch (e) {
      toast({ title: '校验失败', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setRunning(false)
    }
  }, [entityType, entityCode, toast])

  useEffect(() => {
    if (open && entityCode) {
      setReport(null)
      setDepth('FAST')
      void runAudit('FAST')
    }
     
  }, [open, entityCode])

  useEffect(() => {
    if (running) {
      setHintIdx(0)
      timerRef.current = setInterval(() => setHintIdx((i) => Math.min(i + 1, DEEP_HINTS.length - 1)), 4000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [running])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[720px] bp-thin-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-teal-700" />
            主数据体检 · {ET_ZH[entityType]} {entityCode}
            {entityName ? `「${entityName}」` : ''}
          </DialogTitle>
          <DialogDescription>
            校验该{ET_ZH[entityType].toLowerCase()}及其邻接数据（连线/对端/隔离点/同序列设备）的自洽性；报告自动存档
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            size="sm" variant={depth === 'FAST' ? 'default' : 'outline'}
            className={depth === 'FAST' ? 'h-8 bg-teal-700 text-white hover:bg-teal-800' : 'h-8'}
            disabled={running} onClick={() => { setDepth('FAST'); void runAudit('FAST') }}
          >
            快速校验
          </Button>
          <Button
            size="sm" variant={depth === 'DEEP' ? 'default' : 'outline'}
            className={depth === 'DEEP' ? 'h-8 bg-teal-700 text-white hover:bg-teal-800' : 'h-8'}
            disabled={running} onClick={() => { setDepth('DEEP'); void runAudit('DEEP') }}
          >
            深度校验（AI 语义复核）
          </Button>
          {running && <span className="text-xs text-stone-500">{depth === 'DEEP' ? DEEP_HINTS[hintIdx] : '校验中…'}</span>}
        </div>

        {running && !report ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : report ? (
          <MasterAuditResult report={report} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
