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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/bp-api'
import {
  anchorPointT, routeConnection, shapeLabelY, ShapeBody, MarkGlyph, normalizeState,
  CANVAS_W, CANVAS_H, GRID_S, GRID_L, LINE, STROKE, ROSE, minimapBoundsOf,
  IsoState, ISO_STATE_KEYS, ISO_STATE_STYLE, PidContent, PidMark,
} from './pid-config'
import { MapPin, Crosshair, ZoomIn, ZoomOut, ImageOff, LocateFixed, Workflow, Layers, Move, Map as MapIcon, X } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const [boxW, setBoxW] = useState(0)
  const [stateMap, setStateMap] = useState<Map<string, { state: IsoState; stateLabel: string }>>(new Map())
  const [picks, setPicks] = useState<Record<string, number>>({})
  const boxRef = useRef<HTMLDivElement>(null)

  // ---- 画布视口（viewBox 方案，与 PID 组态主画布同款）：拖拽平移 + 滚轮缩放 + 俯瞰图导航，画布无边界 ----
  const CANVAS_MIN_W = CANVAS_W / 4   // 最大放大 4x
  const CANVAS_MAX_W = CANVAS_W * 2.5 // 最大缩小 0.4x
  const FOCUS_Z = 3                   // 定位初始倍率（视口宽 = CANVAS_W/3，100% = 全图）
  const [vb, setVb] = useState({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H })
  const vbRef = useRef(vb)
  vbRef.current = vb
  const [panning, setPanning] = useState(false)
  const [minimapOpen, setMinimapOpen] = useState(false)
  const minimapNavRef = useRef(false) // 俯瞰图按下拖拽导航中（pointer capture 保证移动/抬起事件回到缩略图）
  const focusKeyRef = useRef('')      // 已聚焦的定位目标语义 key（防父组件重渲染打断用户视角）
  const svgRef = useRef<SVGSVGElement | null>(null)

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
          metas.map((m) => apiGet<{ item: { id: number; name: string; unitName?: string | null; unitId?: number | null; content: unknown } }>(`/api/pid-diagrams/${m.id}`).catch(() => null)),
        )
        if (cancelled) return
        const arr: DiagramLite[] = []
        details.forEach((d, i) => {
          if (d?.item) arr.push({ id: d.item.id, name: d.item.name, unitName: d.item.unitName ?? metas[i].unitName ?? null, unitId: d.item.unitId ?? metas[i].unitId ?? null, content: parseContent(d.item.content) })
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

  // ---- 容器宽度测量（内层 svg 固定 1200x700，外层按宽度裁剪出取景框） ----
  useEffect(() => {
    const el = boxRef.current
    if (!el || !open) return
    const measure = () => setBoxW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, loading])

  const boxH = boxW > 0 ? Math.round((boxW * CANVAS_H) / CANVAS_W) : 0

  // ---- 视图控制（与 PID 组态主画布同款 viewBox 数学）：缩放（锚点为中心）/ 定位聚焦 / 空白拖拽平移，画布无边界 ----
  const applyVb = useCallback((next: { x: number; y: number; w: number }) => {
    const w = Math.max(CANVAS_MIN_W, Math.min(CANVAS_MAX_W, next.w))
    setVb({ x: next.x, y: next.y, w, h: (w * CANVAS_H) / CANVAS_W })
  }, [])
  const zoomAt = useCallback((factor: number, ax?: number, ay?: number) => {
    const cur = vbRef.current
    const cx = ax ?? cur.x + cur.w / 2
    const cy = ay ?? cur.y + cur.h / 2
    const nw = Math.max(CANVAS_MIN_W, Math.min(CANVAS_MAX_W, cur.w / factor))
    const k = nw / cur.w
    applyVb({ x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k, w: nw })
  }, [applyVb])
  const focusView = useCallback((m: { x: number; y: number }) => {
    const w = CANVAS_W / FOCUS_Z
    applyVb({ x: m.x - w / 2, y: m.y - ((w * CANVAS_H) / CANVAS_W) / 2, w })
  }, [applyVb])
  const resetView = useCallback(() => setVb({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }), [])

  // 滚轮缩放（以鼠标位置为锚点）：原生监听非 passive 才能 preventDefault 阻止弹窗滚动
  // loading / 无图阶段 svg 未挂载（ref 为空直接返回），挂载后依赖变化重新绑定
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      if (r.width === 0) return
      const v = vbRef.current
      const s = r.width / v.w
      zoomAt(e.deltaY > 0 ? 1 / 1.12 : 1.12, v.x + (e.clientX - r.left) / s, v.y + (e.clientY - r.top) / s)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomAt, loading, activeDiagram?.id])

  // 定位点/所属图/候选图变化 → 视角自动聚焦；未挂标点 → 全景概览
  // （focusKey 语义守卫：父组件重渲染导致 activeHit 引用变化但定位目标未变时，不打断用户当前视角）
  const focusKey = activeHit ? `${activeHit.diagramId}:${activeHit.mark.id}` : 'none'
  useEffect(() => {
    if (!open) return
    if (focusKeyRef.current === focusKey) return
    focusKeyRef.current = focusKey
    if (activeHit) focusView(activeHit.mark)
    else resetView()
  }, [open, focusKey, activeHit, focusView, resetView])

  // 空白拖拽平移（画布本身无点击语义，无需位移阈值/点击吞除）
  const startPan = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const svg = svgRef.current
    if (!svg) return
    const startCx = e.clientX
    const startCy = e.clientY
    const startVb = vbRef.current
    setPanning(true)
    const onMove = (ev: PointerEvent) => {
      const s = svg.getBoundingClientRect().width / startVb.w
      applyVb({ x: startVb.x - (ev.clientX - startCx) / s, y: startVb.y - (ev.clientY - startCy) / s, w: startVb.w })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setPanning(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- 俯瞰图导航：点击/拖拽缩略图 → 视口中心移动到对应世界坐标（保持当前缩放倍率） ----
  const minimapNavTo = (clientX: number, clientY: number, navSvg: SVGSVGElement) => {
    const r = navSvg.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const m = minimapBoundsOf(vbRef.current)
    const s = Math.min(r.width / m.w, r.height / m.h) // preserveAspectRatio=meet 等比缩放比
    const ox = (r.width - m.w * s) / 2 // letterbox 居中偏移
    const oy = (r.height - m.h * s) / 2
    const wx = m.x + (clientX - r.left - ox) / s
    const wy = m.y + (clientY - r.top - oy) / s
    const v = vbRef.current
    setVb({ x: wx - v.w / 2, y: wy - v.h / 2, w: v.w, h: v.h })
  }

  // 俯瞰图世界包围盒（画布区域 ∪ 当前视口 + 留白）：随平移/缩放动态扩展，无限画布下视口永在框内
  const mmBounds = minimapBoundsOf(vb)

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

        {/* 画布取景框 */}
        <div
          ref={boxRef}
          className="relative w-full overflow-hidden rounded-lg border bg-white"
          style={{ height: boxH > 0 ? boxH : 340 }}
        >
          {loading ? (
            <Skeleton className="h-full w-full rounded-none" />
          ) : !activeDiagram ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-stone-400">
              <Workflow className="h-8 w-8 text-stone-300" />
              <p className="text-xs">暂无已保存的 PID 组态图</p>
              <p className="text-[11px] text-stone-400">请先到「台账管理 → PID 组态」绘制并保存组态图</p>
            </div>
          ) : (
            <>
              <svg
                ref={svgRef}
                viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
                className={cn('absolute inset-0 block h-full w-full touch-none select-none', panning ? 'cursor-grabbing' : 'cursor-grab')}
                onPointerDown={startPan}
              >
                <defs>
                  <pattern id="bp-loc-grid-s" width={20} height={20} patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke={GRID_S} strokeWidth={1} />
                  </pattern>
                  <pattern id="bp-loc-grid-l" width={100} height={100} patternUnits="userSpaceOnUse">
                    <rect width={100} height={100} fill="url(#bp-loc-grid-s)" />
                    <path d="M 100 0 L 0 0 0 100" fill="none" stroke={GRID_L} strokeWidth={1.2} />
                  </pattern>
                  <marker id="bp-loc-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5.5} markerHeight={5.5} orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={LINE} />
                  </marker>
                </defs>
                {/* 无限桌面：白底+网格跟随视口（3 倍视口尺寸，拖到任何位置都有桌面）；画布原点区域虚线标界 */}
                <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="#fff" />
                <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="url(#bp-loc-grid-l)" />
                <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="none" stroke="#d6d3d1" strokeWidth={1.2} strokeDasharray="12 8" vectorEffect="non-scaling-stroke" />

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
              </svg>

              {/* 未挂标引导浮层 */}
              {active && !activeHit && (
                <div className="absolute inset-x-4 top-3 z-10 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 shadow-sm">
                  <div className="flex items-start gap-2">
                    <ImageOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="text-[11px] leading-relaxed text-amber-800">
                      <p className="font-medium">隔离点 <span className="font-mono">{active.code}</span> 尚未在 PID 组态图中挂标，暂无法定位</p>
                      <p className="text-amber-700/80">请到「台账管理 → PID 组态」打开本装置组态图，使用「标注隔离点」工具为该点添加挂标后即可定位查看</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 视图控制（左下角悬浮）：档位缩放 + 俯瞰图开关 + 定位回中 + 操作提示 */}
              <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-lg border bg-white/95 p-1 shadow-sm">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-500" onClick={() => zoomAt(1 / 1.3)} title="缩小">
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="w-10 text-center text-[10px] font-mono text-stone-500">{Math.round((CANVAS_W / vb.w) * 100)}%</span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-500" onClick={() => zoomAt(1.3)} title="放大">
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <div className="mx-0.5 h-4 w-px bg-stone-200" />
                <Button
                  variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', minimapOpen ? 'text-emerald-600' : 'text-stone-500')}
                  onClick={() => setMinimapOpen((v) => !v)}
                  title="俯瞰图开关：画布右下角显示整图缩略导航，点击/拖拽缩略图快速移动视口"
                  aria-pressed={minimapOpen}
                >
                  <MapIcon className="h-3.5 w-3.5" />
                </Button>
                {activeHit && (
                  <Button variant="ghost" size="sm" className="h-7 px-1.5 text-[10px] text-teal-700" onClick={() => focusView(activeHit.mark)} title="回到定位点">
                    <Crosshair className="mr-0.5 h-3 w-3" />定位
                  </Button>
                )}
                <span
                  className="hidden select-none items-center gap-1 pr-1.5 text-[10px] text-stone-400 sm:flex"
                  title="按住画布拖拽平移 · 滚轮缩放 · 画布无边界，跑远了可用俯瞰图找回"
                >
                  <Move className="h-3 w-3" />
                  拖拽平移 · 滚轮缩放
                </span>
              </div>

              {/* 俯瞰图（开关控制，画布右下角）：整图缩略 + 图元/连线/隔离点简化轮廓 + 当前视口 amber 框 + 定位点 amber 光环，点击/拖拽快速定位 */}
              {minimapOpen && activeDiagram && (
                <div className="absolute bottom-3 right-3 z-10 overflow-hidden rounded-lg border border-stone-200 bg-white/95 shadow-md backdrop-blur">
                  <div className="flex items-center justify-between gap-2 border-b border-stone-100 py-1 pl-2 pr-1">
                    <span className="flex select-none items-center gap-1 text-[10px] font-medium text-stone-500">
                      <MapIcon className="h-3 w-3" />
                      俯瞰图
                    </span>
                    <span className="hidden select-none text-[9px] text-stone-400 sm:inline">点击/拖拽定位</span>
                    <button
                      type="button"
                      title="关闭俯瞰图（左下角可重新打开）"
                      className="rounded p-0.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
                      onClick={() => setMinimapOpen(false)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <svg
                    viewBox={`${mmBounds.x} ${mmBounds.y} ${mmBounds.w} ${mmBounds.h}`}
                    className="block h-28 w-44 cursor-pointer touch-none sm:h-32 sm:w-52"
                    onPointerDown={(e) => {
                      if (e.button !== 0) return
                      e.preventDefault()
                      minimapNavRef.current = true
                      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 旧环境无 capture，点击定位仍可用 */ }
                      minimapNavTo(e.clientX, e.clientY, e.currentTarget)
                    }}
                    onPointerMove={(e) => {
                      if (minimapNavRef.current) minimapNavTo(e.clientX, e.clientY, e.currentTarget)
                    }}
                    onPointerUp={(e) => {
                      minimapNavRef.current = false
                      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
                    }}
                    onPointerCancel={() => { minimapNavRef.current = false }}
                  >
                    <g pointerEvents="none">
                      {/* 世界背景：画布区域白底、视口外微灰（画布原点参照） */}
                      <rect x={mmBounds.x} y={mmBounds.y} width={mmBounds.w} height={mmBounds.h} fill="#f5f5f4" />
                      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#fff" stroke="#e7e5e4" vectorEffect="non-scaling-stroke" />
                      {/* 连线（锚点直线近似，细线不随缩略图缩放变粗） */}
                      {activeDiagram.content.connections.map((c) => {
                        const f = activeDiagram.content.shapes.find((s) => s.id === c.fromShape)
                        const t = activeDiagram.content.shapes.find((s) => s.id === c.toShape)
                        if (!f || !t) return null
                        const a = anchorPointT(f, c.fromAnchor, c.fromT)
                        const b = anchorPointT(t, c.toAnchor, c.toT)
                        return (
                          <line
                            key={c.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                            stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.65}
                          />
                        )
                      })}
                      {/* 图元（按类型简化轮廓，保留填充/描边色） */}
                      {activeDiagram.content.shapes.map((s) => {
                        const fill = s.fill && s.fill !== 'transparent' ? s.fill : '#fff'
                        const stroke = s.stroke ?? STROKE
                        if (s.type === 'line') {
                          return s.flip
                            ? <line key={s.id} x1={s.x} y1={s.y + s.h} x2={s.x + s.w} y2={s.y} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            : <line key={s.id} x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        }
                        if (s.type === 'circle') {
                          return <circle key={s.id} cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={Math.min(s.w, s.h) / 2} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        }
                        if (s.type === 'ellipse') {
                          return <ellipse key={s.id} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        }
                        if (s.type === 'triangle') {
                          return <polygon key={s.id} points={`${s.x},${s.y + s.h} ${s.x + s.w},${s.y + s.h} ${s.x + s.w / 2},${s.y}`} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        }
                        return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      })}
                      {/* 隔离点标注（玫红菱形；目标定位点 amber 加大 + 光环） */}
                      {activeDiagram.content.marks.map((m) => {
                        const isTarget = activeHit?.mark.id === m.id
                        const r = (mmBounds.w / 40) * (isTarget ? 1.9 : 1)
                        return (
                          <polygon
                            key={m.id}
                            points={`${m.x},${m.y - r} ${m.x + r},${m.y} ${m.x},${m.y + r} ${m.x - r},${m.y}`}
                            fill={isTarget ? '#f59e0b' : ROSE} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke"
                          />
                        )
                      })}
                      {activeHit && (
                        <circle cx={activeHit.mark.x} cy={activeHit.mark.y} r={mmBounds.w / 26} fill="none" stroke="#f59e0b" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                      )}
                      {/* 当前视口（amber，与定位高亮同色语言） */}
                      <rect
                        x={vb.x} y={vb.y} width={vb.w} height={vb.h}
                        fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  </svg>
                </div>
              )}
            </>
          )}
        </div>

        {/* 六态图例（单行紧凑：无左侧标签占位，窄屏横向滚动不换行） */}
        <div className="flex flex-nowrap items-center gap-x-3 gap-y-0 overflow-x-auto bp-thin-scrollbar" role="list" aria-label="状态图例">
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
