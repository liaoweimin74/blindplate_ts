'use client'

/**
 * PID 定位查看弹窗（只读）
 * —— 在隔离方案详情 / 作业票点位清单中点击「查看PID图」打开：
 *    自动在已保存的 PID 组态图中查找该隔离点的挂标（marks.masterPointId / marks.code），
 *    以挂标为中心放大展示，amber 光环脉冲高亮；支持点位间切换、档位缩放、拖拽平移；
 *    未挂标的点位给出引导提示（到 PID 组态编辑器为该点添加挂标）。
 * 多图命中策略：一个隔离点在多张图中都有挂标时，收集全部候选图，
 *    本装置图（preferUnitId）优先排序，其余按最近更新倒序；
 *    标题区出现「多图命中」切换条，可手动换图定位查看。
 * 复用 pid-config 的 ShapeBody / MarkGlyph / routeConnection 渲染，与组态编辑器视觉一致。
 * Task 126：视口状态机/缩放平移/俯瞰图/控制条全部收敛至 configurator/diagram-viewer 壳，
 *    本文件只保留数据编排（图加载/点位命中/实时状态）与场景渲染。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/bp-api'
import {
  anchorPointT, routeConnection, shapeLabelY, ShapeBody, MarkGlyph, normalizeState,
  CANVAS_W, CANVAS_H, LINE, IsoState, ISO_STATE_KEYS, ISO_STATE_STYLE, PidContent, PidMark,
} from './pid-config'
import { MapPin, Crosshair, ImageOff, LocateFixed, Workflow, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DiagramViewer, type DiagramViewportApi } from '@/components/configurator/diagram-viewer'
import { PidMinimapScene } from './pid-minimap-scene'

/** 可定位的隔离点（兼容方案隔离点 / 作业票点位两种来源） */
export interface LocatePoint {
  key: string
  code: string // 编号（masterCode || code）
  name?: string | null
  masterPointId?: number | null
  masterCode?: string | null
  sub?: string | null // 次要说明（如位置）
}

interface DiagramLite {
  id: number
  name: string
  unitName?: string | null
  unitId?: number | null
  content: PidContent
  bgImage?: string | null
}

/** 单个隔离点在一张图中的挂标命中 */
interface MarkHit {
  diagramId: number
  diagramName: string
  unitName?: string | null
  unitId?: number | null
  mark: PidMark
}

const parseContent = (raw: unknown): PidContent => {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw
    const obj = (o ?? {}) as Record<string, unknown>
    return {
      shapes: Array.isArray(obj.shapes) ? (obj.shapes as PidContent['shapes']) : [],
      connections: Array.isArray(obj.connections) ? (obj.connections as PidContent['connections']) : [],
      marks: Array.isArray(obj.marks) ? (obj.marks as PidContent['marks']) : [],
    }
  } catch {
    return { shapes: [], connections: [], marks: [] }
  }
}

const FOCUS_Z = 3 // 定位初始倍率（视口宽 = CANVAS_W/3，100% = 全图）

export function PidLocateDialog({
  open, onClose, points, initialIndex = 0, preferUnitId = null,
}: {
  open: boolean
  onClose: () => void
  points: LocatePoint[]
  initialIndex?: number
  /** 所属装置 id：多图命中时本装置图优先展示（来自作业需求/方案的 unitId） */
  preferUnitId?: number | null
}) {
  const [loading, setLoading] = useState(false)
  const [diagrams, setDiagrams] = useState<DiagramLite[]>([])
  const [activeIdx, setActiveIdx] = useState(initialIndex)
  const [stateMap, setStateMap] = useState<Map<string, { state: IsoState; stateLabel: string }>>(new Map())
  const [picks, setPicks] = useState<Record<string, number>>({})

  // ---- 视图控制：状态机/缩放/平移/俯瞰全部由 DiagramViewer 壳托管（Task 126 收敛）；
  //      定位聚焦经 apiRef 命令式驱动（focusKey 语义守卫：父组件重渲染导致
  //      activeHit 引用变化但定位目标未变时，不打断用户当前视角） ----
  const viewerApiRef = useRef<DiagramViewportApi | null>(null)
  const focusKeyRef = useRef('')

  // ---- 打开时加载全部图详情（列表 API 不含 content，逐张拉取；量级小，并发安全） ----
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setActiveIdx(Math.min(initialIndex, Math.max(points.length - 1, 0)))
    setPicks({})
    focusKeyRef.current = '' // 重开弹窗必重新触发一次视角定位/复位
    ;(async () => {
      try {
        const listResp = await apiGet<{ list: { id: number; name: string; unitName?: string | null; unitId?: number | null }[] }>('/api/pid-diagrams')
        const metas = (listResp.list ?? []).slice(0, 24)
        const details = await Promise.all(
          metas.map((m) => apiGet<{ item: { id: number; name: string; unitName?: string | null; unitId?: number | null; content: unknown; bgImage?: string | null } }>(`/api/pid-diagrams/${m.id}`).catch(() => null)),
        )
        if (cancelled) return
        const arr: DiagramLite[] = []
        details.forEach((d, i) => {
          if (d?.item) arr.push({ id: d.item.id, name: d.item.name, unitName: d.item.unitName ?? metas[i].unitName ?? null, unitId: d.item.unitId ?? metas[i].unitId ?? null, content: parseContent(d.item.content), bgImage: d.item.bgImage ?? null })
        })
        setDiagrams(arr)
      } catch {
        if (!cancelled) setDiagrams([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open])

  // ---- 每个点 → 挂标命中（跨图全量收集：masterPointId 精确优先，code 兜底；
  //      一点多图时全部保留，本装置图（preferUnitId）排序置顶，其余保持最近更新倒序） ----
  const hits = useMemo(() => {
    const map = new Map<string, MarkHit[]>()
    for (const p of points) {
      const cands: MarkHit[] = []
      for (const d of diagrams) {
        const mark = d.content.marks.find(
          (mk) => (p.masterPointId != null && mk.masterPointId === p.masterPointId) || (p.masterCode && mk.code === p.masterCode) || (!p.masterPointId && p.code && mk.code === p.code),
        )
        if (mark) cands.push({ diagramId: d.id, diagramName: d.name, unitName: d.unitName ?? null, unitId: d.unitId ?? null, mark })
      }
      if (cands.length > 0) {
        const preferred = preferUnitId != null ? cands.filter((c) => c.unitId === preferUnitId) : []
        const rest = preferUnitId != null ? cands.filter((c) => c.unitId !== preferUnitId) : cands
        map.set(p.key, [...preferred, ...rest])
      }
    }
    return map
  }, [points, diagrams, preferUnitId])

  const active = points[activeIdx] ?? null
  const activeCands = useMemo(() => (active ? hits.get(active.key) ?? [] : []), [active, hits])
  const activeHit = useMemo(() => {
    if (activeCands.length === 0) return null
    const idx = Math.min(picks[active?.key ?? ''] ?? 0, activeCands.length - 1)
    return activeCands[idx] ?? null
  }, [activeCands, picks, active])
  const activeDiagram = useMemo(
    () => (activeHit ? diagrams.find((d) => d.id === activeHit.diagramId) ?? null : diagrams[0] ?? null),
    [activeHit, diagrams],
  )

  // ---- 激活图变化：拉一次实时状态（不轮询）；视角定位/复位由 activeHit 变化统一驱动 ----
  useEffect(() => {
    if (!open || !activeDiagram) return
    let cancelled = false
    ;(async () => {
      try {
        const resp = await apiGet<{ points: { markId: string; state?: string; stateLabel?: string | null }[] }>(`/api/pid-diagrams/${activeDiagram.id}/status`)
        if (cancelled) return
        const m = new Map<string, { state: IsoState; stateLabel: string }>()
        for (const p of resp.points ?? []) m.set(p.markId, { state: normalizeState(p.state), stateLabel: p.stateLabel ?? '' })
        setStateMap(m)
      } catch {
        if (!cancelled) setStateMap(new Map())
      }
    })()
    return () => { cancelled = true }
  }, [open, activeDiagram?.id])

  // 定位点/所属图/候选图变化 → 视角自动聚焦；未挂标点 → 全景概览
  // （api 未就绪时不落 focusKeyRef：子壳 effect 先于父 effect 执行，挂载轮即重试成功）
  const focusKey = activeHit ? `${activeHit.diagramId}:${activeHit.mark.id}` : 'none'
  useEffect(() => {
    if (!open) return
    if (focusKeyRef.current === focusKey) return
    const api = viewerApiRef.current
    if (!api) return
    focusKeyRef.current = focusKey
    if (activeHit) api.focusOn(activeHit.mark.x, activeHit.mark.y, CANVAS_W / FOCUS_Z)
    else api.resetView()
  }, [open, focusKey, activeHit])

  const marked = points.filter((p) => hits.has(p.key)).length

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="w-full sm:max-w-[880px] sm:max-h-[92vh] overflow-y-auto">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <LocateFixed className="h-4 w-4 text-teal-700" />
            PID 图定位查看
            {activeDiagram && (
              <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-600">
                {activeDiagram.name}{activeDiagram.unitName ? ` · ${activeDiagram.unitName}` : ''}
              </Badge>
            )}
            <Badge variant="outline" className="border-teal-200 bg-teal-50 font-mono text-teal-700">
              {marked}/{points.length} 已挂标
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            以隔离点挂标为中心放大展示；菱形标注颜色为该点实时通/盲状态；支持拖拽平移、滚轮缩放、俯瞰图导航，画布无边界
          </DialogDescription>
        </DialogHeader>

        {/* 点位切换 chips */}
        {points.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {points.map((p, i) => {
              const hitList = hits.get(p.key)
              const isActive = i === activeIdx
              return (
                <button
                  key={p.key}
                  onClick={() => setActiveIdx(i)}
                  className={cn(
                    'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    isActive ? 'border-teal-600 bg-teal-600 text-white shadow-sm' : hitList?.length ? 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100' : 'border-stone-200 bg-stone-50 text-stone-500 hover:bg-stone-100',
                  )}
                  title={hitList?.length
                    ? hitList.length > 1
                      ? `已在 ${hitList.length} 张图挂标：${hitList.map((h) => h.diagramName).join('、')}`
                      : `已在「${hitList[0].diagramName}」挂标`
                    : '未在 PID 图中挂标'}
                >
                  {hitList?.length ? <MapPin className="h-3 w-3 shrink-0" /> : <ImageOff className="h-3 w-3 shrink-0" />}
                  <span className="font-mono">{p.code}</span>
                  {p.name && <span className="hidden truncate sm:inline">{p.name}</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* 多图命中：候选图切换条（本装置图已排序置顶） */}
        {activeCands.length > 1 && active && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50/70 px-2.5 py-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-600">
              <Layers className="h-3.5 w-3.5 text-stone-400" />
              该点在 <span className="font-mono text-teal-700">{activeCands.length}</span> 张组态图中均有挂标，点击切换：
            </span>
            {activeCands.map((h, i) => {
              const on = activeHit?.diagramId === h.diagramId
              return (
                <button
                  key={h.diagramId}
                  onClick={() => setPicks((m) => ({ ...m, [active.key]: i }))}
                  title={`切换到「${h.diagramName}」定位查看${h.unitName ? `（${h.unitName}）` : ''}`}
                  className={cn(
                    'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    on ? 'border-teal-600 bg-teal-600 text-white shadow-sm' : 'border-stone-200 bg-white text-stone-600 hover:border-teal-300 hover:text-teal-700',
                  )}
                >
                  <span className="max-w-[160px] truncate font-medium">{h.diagramName}</span>
                  {h.unitName && <span className="hidden max-w-[100px] truncate opacity-70 sm:inline">{h.unitName}</span>}
                  {h.unitId != null && h.unitId === preferUnitId && (
                    <span className={cn('rounded px-1 text-[9px]', on ? 'bg-white/20' : 'bg-teal-50 text-teal-700')}>本装置</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* 画布取景框：骨架屏 / 无图引导 / DiagramViewer 查看壳（视口+俯瞰+控制条全托管） */}
        {loading ? (
          <div className="w-full overflow-hidden rounded-lg border bg-white" style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}>
            <Skeleton className="h-full w-full rounded-none" />
          </div>
        ) : !activeDiagram ? (
          <div className="flex h-[340px] flex-col items-center justify-center gap-2 rounded-lg border bg-white text-stone-400">
            <Workflow className="h-8 w-8 text-stone-300" />
            <p className="text-xs">暂无已保存的 PID 组态图</p>
            <p className="text-[11px] text-stone-400">请先到「台账管理 → PID 组态」绘制并保存组态图</p>
          </div>
        ) : (
          <DiagramViewer
            worldW={CANVAS_W}
            worldH={CANVAS_H}
            enabled
            bindKey={activeDiagram.id}
            desktop
            bgImage={activeDiagram.bgImage}
            onViewportApi={(api) => { viewerApiRef.current = api }}
            defs={
              <marker id="bp-loc-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5.5} markerHeight={5.5} orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={LINE} />
              </marker>
            }
            scene={
              <>
                {/* 连线（与编辑器一致的正交折弯；方向 forward 起点→终点 / reverse 终点→起点 / none 无向） */}
                {activeDiagram.content.connections.map((c) => {
                  const a = activeDiagram.content.shapes.find((s) => s.id === c.fromShape)
                  const b = activeDiagram.content.shapes.find((s) => s.id === c.toShape)
                  if (!a || !b) return null
                  const pts = routeConnection(
                    { ...anchorPointT(a, c.fromAnchor, c.fromT), anchor: c.fromAnchor },
                    { ...anchorPointT(b, c.toAnchor, c.toT), anchor: c.toAnchor },
                    false,
                    c.midOverride,
                  )
                  const dir = c.direction ?? 'forward'
                  return (
                    <polyline
                      key={c.id}
                      points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
                      fill="none" stroke={LINE} strokeWidth={1.6}
                      markerStart={dir === 'reverse' ? 'url(#bp-loc-arrow)' : undefined}
                      markerEnd={dir === 'forward' ? 'url(#bp-loc-arrow)' : undefined}
                    />
                  )
                })}

                {/* 图元 + 标签 */}
                {activeDiagram.content.shapes.map((s) => (
                  <g key={s.id} pointerEvents="none">
                    <ShapeBody s={s} />
                    <text x={s.x + s.w / 2} y={shapeLabelY(s)} textAnchor="middle" fontSize={12} fill="#57534e" stroke="#fff" strokeWidth={3} paintOrder="stroke">
                      {s.label}
                    </text>
                  </g>
                ))}

                {/* 全部挂标（查看态按实时状态着色） */}
                {activeDiagram.content.marks.map((m) => {
                  const st = stateMap.get(m.id)
                  return (
                    <g key={m.id} pointerEvents="none">
                      <MarkGlyph m={m} edit={false} state={st?.state ?? 'idle'} stateLabel={st?.stateLabel ?? ''} />
                    </g>
                  )
                })}

                {/* 目标挂标定位光环（amber 脉冲） */}
                {activeHit && (
                  <g pointerEvents="none">
                    <circle cx={activeHit.mark.x} cy={activeHit.mark.y} r={15} fill="#f59e0b" opacity={0.16} />
                    <circle
                      cx={activeHit.mark.x} cy={activeHit.mark.y} r={15} fill="none" stroke="#d97706" strokeWidth={2.4}
                      className="bp-locate-ring"
                    />
                    <circle cx={activeHit.mark.x} cy={activeHit.mark.y} r={3} fill="#d97706" />
                  </g>
                )}
              </>
            }
            minimapScene={(bounds) => (
              <PidMinimapScene content={activeDiagram.content} bounds={bounds} targetMarkId={activeHit?.mark.id ?? null} />
            )}
            extra={
              activeHit ? (
                <button
                  type="button"
                  title="回到定位点"
                  aria-label="回到定位点"
                  className="flex h-7 items-center rounded px-1.5 text-[10px] text-teal-700 transition-colors hover:bg-teal-50"
                  onClick={() => viewerApiRef.current?.focusOn(activeHit.mark.x, activeHit.mark.y, CANVAS_W / FOCUS_Z)}
                >
                  <Crosshair className="mr-0.5 h-3 w-3" />定位
                </button>
              ) : undefined
            }
            legend={
              /* 六态图例（单行紧凑：无左侧标签占位，窄屏横向滚动不换行） */
              <div className="mt-2 flex flex-nowrap items-center gap-x-3 gap-y-0 overflow-x-auto bp-thin-scrollbar" role="list" aria-label="状态图例">
                {ISO_STATE_KEYS.map((k) => {
                  const st = ISO_STATE_STYLE[k]
                  return (
                    <span key={k} role="listitem" className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rotate-45 rounded-[2px] border" style={{ background: st.fill, borderColor: st.stroke }} />
                      {st.legend}
                    </span>
                  )
                })}
              </div>
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 便捷构造：方案隔离点 / 票点位 → LocatePoint 列表 */
export function toLocatePoints(
  pts: { id?: number | string; seq?: number; masterCode?: string | null; code?: string | null; name?: string | null; masterPointId?: number | null; location?: string | null }[],
): LocatePoint[] {
  return pts.map((p, i) => ({
    key: `${p.id ?? p.seq ?? i}`,
    code: p.masterCode || p.code || `点位${i + 1}`,
    name: p.name ?? null,
    masterPointId: p.masterPointId ?? null,
    masterCode: p.masterCode ?? null,
    sub: p.location ?? null,
  }))
}
