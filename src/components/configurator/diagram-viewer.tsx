'use client'

/**
 * DiagramViewer —— 组态图查看壳（React 适配层，Task 126）
 *
 * 「SVG 渲染 + 缩放平移 + 图例 + 显隐开关 + 俯瞰图」的唯一下沉点。
 * 此前 pid-config（编辑/查看画布）、pid-locate（定位放大图）、pid-import（原图查看器）
 * 各持一份视口状态机（vb/applyVb/zoomAt/startPan/俯瞰导航）与两份近乎逐行相同的
 * 俯瞰图 UI + 缩放控制条 UI；本模块收敛为四件套：
 *
 *   ① useDiagramViewport  视口状态机 hook（vb 状态/锚点缩放/拖拽平移/滚轮绑定/容器测量/百分比）
 *   ② ViewerControls      缩放控制条（± / % / 复位 / 俯瞰开关 / 显隐 toggles / 额外按钮）
 *   ③ ViewerMinimap       俯瞰图浮层框（标题栏 + 点击/拖拽导航 svg + amber 视口框）
 *   ④ DiagramViewer       组合壳：取景框 + svg(viewBox) + 无限桌面 + 控制条 + 俯瞰 + 图例 slot
 *
 * 分层契约（与 Task 116 框架无关化一致）：
 *   - 本文件零业务依赖：不 import bp/*，只依赖 core/viewport 数学与 useWheelZoom；
 *     PID 专属的俯瞰简化场景由消费方经 minimapScene / scene 注入
 *   - 纯查看消费方（pid-locate / pid-import）直接用 ④ 组合壳；
 *     编辑器画布（pid-config）用 ①②③ 套件自行组装（画布手势/场景渲染保持编辑器自有）
 *   - 缩放口径：percent = base / vb.w × 100；base = base100 'world'（全图=100%，默认）
 *     或 'container'（容器宽=100%，像素级 1:1，原图查看器用）
 *   - 高宽比策略：ratio 'aspect'（固定 world 比，容器 aspect-ratio 跟随，无 letterbox）
 *     或 'measure'（容器实测比，画布满高，窗口式裁剪）——与 core/viewport「h 留给调用方」契约对齐
 */

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Map as MapIcon, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { minimapBoundsOf, panByScreen, zoomViewport, minimapNavigateWorld, createCanvasController, type ViewportRect } from '@/lib/configurator-core'
import { useWheelZoom } from './use-wheel-zoom'

// ============ ① useDiagramViewport：视口状态机 ============

export interface DiagramViewportOptions {
  /** 世界宽（世界坐标系总宽，如 CANVAS_W 或图片 naturalWidth） */
  worldW: number
  /** 世界高 */
  worldH: number
  /** 100% 基准：'world' 全图=100%（默认）| 'container' 容器宽=100%（1:1 像素，图片查看器） */
  base100?: 'world' | 'container'
  /** 最小缩放比例（相对 base），默认 0.4 */
  minZoom?: number
  /** 最大缩放比例（相对 base），默认 4 */
  maxZoom?: number
  /** 高宽比策略：'aspect' 固定 world 比（默认）| 'measure' 容器实测（窗口式裁剪，无 letterbox） */
  ratio?: 'aspect' | 'measure'
  /** 初始视图：'world' 全景（默认）| 'width' 适配容器宽并纵向居中（图片查看器） */
  initial?: 'world' | 'width'
  /** false 时不绑滚轮/不允许手势（骨架屏阶段） */
  enabled?: boolean
}

/** 视口控制面（hook 返回值）——缩放/平移/导航/测量一站式 */
export interface DiagramViewportApi {
  /** 视口取景框（viewBox 四元组） */
  vb: ViewportRect
  /** 直写视口（俯瞰导航等特殊场景；常规缩放平移请用 zoomAt/startPan） */
  setVb: React.Dispatch<React.SetStateAction<ViewportRect>>
  /** 恒最新视口 ref（滚轮/手势/换算闭包用） */
  vbRef: RefObject<ViewportRect>
  /** 取景框容器 ref（必须挂到裁剪容器上；measure 模式靠它实测） */
  boxRef: RefObject<HTMLDivElement | null>
  /** 容器挂载入口（ref 回调直用）：late-mount 安全的 RO 测量（containerW/measureRatio 首测+跟随） */
  attachBox: (el: HTMLDivElement | null) => void
  /** svg ref（必须挂到 viewBox svg 上；滚轮绑定/平移换算用） */
  svgRef: RefObject<SVGSVGElement | null>
  /** 实测容器宽 px（0 = 未测量；base100='container' 的 100% 基准） */
  containerW: number
  /** 实测容器高宽比（measure 模式；aspect 模式 = worldH/worldW） */
  ratio: number
  /** 锚点缩放：factor>1 放大；(ax,ay)=世界锚点，缺省视口中心 */
  zoomAt: (factor: number, ax?: number, ay?: number) => void
  /** 复位到初始视图（'world' 全景 / 'width' 适配世界全宽并纵向居中） */
  resetView: () => void
  /** 全宽看世界：世界宽铺满视口宽，纵向居中（图片查看器「适应窗口」） */
  fitWorld: () => void
  /** 按百分比缩放（以当前视口中心为锚）：setPercent(100) 即 1:1 */
  setPercent: (p: number) => void
  /** 视口中心对准世界点（保倍率；pid-locate 定位聚焦） */
  focusOn: (x: number, y: number, w?: number) => void
  /** 世界点 → 视口中心（俯瞰导航落点；保倍率） */
  navToWorld: (x: number, y: number) => void
  /** 空白拖拽平移（挂 svg onPointerDown；编辑器可传 moveThreshold/onMovedEnd 对齐点击语义） */
  startPan: (e: React.PointerEvent<SVGSVGElement>, opts?: { moveThreshold?: number; onMovedEnd?: (moved: boolean) => void }) => void
  /** 平移进行中（cursor 切换） */
  panning: boolean
  /** 当前缩放 %（base/vb.w×100） */
  percent: number
  /** 已到最小/最大缩放边界（控制条按钮 disabled） */
  atMin: boolean
  atMax: boolean
  /** 俯瞰图世界包围盒（画布区域 ∪ 当前视口 + 留白） */
  bounds: ViewportRect
}

export function useDiagramViewport(opts: DiagramViewportOptions): DiagramViewportApi {
  const { worldW, worldH, base100 = 'world', minZoom = 0.4, maxZoom = 4, ratio: ratioMode = 'aspect', initial = 'world', enabled = true } = opts

  const [vb, setVb] = useState<ViewportRect>({ x: 0, y: 0, w: worldW, h: worldH })
  const vbRef = useRef(vb)
  // 恒最新视口（effect 同步：滚轮/手势事件均在 effects 之后触发，读到的必然是最新值）
  useEffect(() => {
    vbRef.current = vb
  })
  const [panning, setPanning] = useState(false)
  const [containerW, setContainerW] = useState(0)
  const [measureRatio, setMeasureRatio] = useState(worldH / worldW)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // 100% 基准宽（container 未测出时回落 world，避免除零）；
  // maxW 至少容纳整幅世界宽——container 基准 + 小 minZoom 时 base/minZoom 可能小于 worldW，
  // 否则「适应窗口」会被缩放下限夹住、永远看不到整图宽（Task 126 E2E 实测修）
  const base = base100 === 'container' ? (containerW > 0 ? containerW : worldW) : worldW
  const minW = base / maxZoom
  const maxW = Math.max(base / minZoom, worldW)
  const ratioRef = useRef(measureRatio)
  useEffect(() => {
    ratioRef.current = measureRatio
  })

  const applyVb = useCallback((next: { x: number; y: number; w: number }) => {
    const w = Math.max(minW, Math.min(maxW, next.w))
    const h = ratioMode === 'aspect' ? w * (worldH / worldW) : w * ratioRef.current
    // 平移不设边界：无限桌面/窗口裁剪下任意位置可达，跑远了用俯瞰图或复位找回
    setVb({ x: next.x, y: next.y, w, h })
  }, [minW, maxW, ratioMode, worldW, worldH])

  const zoomAt = useCallback((factor: number, ax?: number, ay?: number) => {
    // 锚点缩放数学在 core/viewport.zoomViewport（框架无关唯一下沉点）；h 由 applyVb 按比例策略回填
    applyVb(zoomViewport(vbRef.current, factor, minW, maxW, ax, ay))
  }, [applyVb, minW, maxW])

  const fitWorld = useCallback(() => {
    const h = worldW * (ratioMode === 'aspect' ? worldH / worldW : ratioRef.current)
    applyVb({ x: 0, y: (worldH - h) / 2, w: worldW })
  }, [applyVb, ratioMode, worldH, worldW])

  const setPercent = useCallback((p: number) => {
    const v = vbRef.current
    const nw = Math.max(minW, Math.min(maxW, base / Math.max(0.01, p / 100)))
    // 以当前视口中心为锚缩放：中心世界坐标在缩放前后保持不变
    const cx = v.x + v.w / 2
    const cy = v.y + v.h / 2
    const h = nw * (ratioMode === 'aspect' ? worldH / worldW : ratioRef.current)
    setVb({ x: cx - nw / 2, y: cy - h / 2, w: nw, h })
  }, [base, minW, maxW, ratioMode, worldH, worldW])

  const resetView = useCallback(() => {
    if (initial === 'width') fitWorld()
    else setVb({ x: 0, y: 0, w: worldW, h: worldW * (worldH / worldW) })
  }, [fitWorld, initial, worldH, worldW])

  const focusOn = useCallback((x: number, y: number, w?: number) => {
    const nw = w ?? vbRef.current.w
    const h = nw * (ratioMode === 'aspect' ? worldH / worldW : ratioRef.current)
    setVb({ x: x - nw / 2, y: y - h / 2, w: nw, h })
  }, [ratioMode, worldH, worldW])

  const navToWorld = useCallback((x: number, y: number) => {
    const v = vbRef.current
    setVb({ x: x - v.w / 2, y: y - v.h / 2, w: v.w, h: v.h })
  }, [])

  // ---- 容器测量：containerW（base100/percent 用）+ measure 模式的实测高宽比；
  //      比例变化时同步校正当前视口高（保持 x/y/w，防窗口缩放后坐标漂移）。
  //      RO 生命周期在 attachBox（ref 回调）内而非 effect：容器可 late-mount（如 pid-config
  //      主画布在编辑 tab 切换后才渲染），effect 只在组件 mount 跑一次会永久错过
  //      （Task 128 E2E 实测：boxRef 悬空 → containerW 恒 0 → 浮动工具条永不渲染，
  //      且 measure 比例停留初值 → vb 与容器比例错配 → 指针换算 y 向恒定偏差） ----
  const roRef = useRef<ResizeObserver | null>(null)
  const measure = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width > 4 && r.height > 4) {
      setContainerW(Math.round(r.width))
      if (ratioMode === 'measure') {
        const ratio = r.height / r.width
        setMeasureRatio(ratio)
        setVb((v) => {
          const h = v.w * ratio
          return Math.abs(h - v.h) < 0.5 ? v : { ...v, h }
        })
      }
    }
  }, [ratioMode])
  /** 容器挂载入口（ref 回调直用）：挂载即建 RO 并首测，卸载即断开——late-mount 安全 */
  const attachBox = useCallback((el: HTMLDivElement | null) => {
    boxRef.current = el
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    const ro = new ResizeObserver(measure) // observe 即触发一次初始回调，无需手劲首测
    ro.observe(el)
    roRef.current = ro
    measure()
  }, [measure])
  // 卸载清理（attachBox 的 disconnect 仅覆盖容器换挂场景；组件级卸载由本 effect 兜底）
  useEffect(() => () => roRef.current?.disconnect(), [])

  // initial='width'：世界尺寸就绪后全宽适配一次（图片 naturalWidth 异步到达时重适配）；
  // 视口初始化属测量后同步校正语义，非派生状态，豁免 setState-in-effect
  const fittedForRef = useRef('')
  useEffect(() => {
    if (initial !== 'width' || worldW <= 0) return
    const key = `${worldW}x${Math.round(worldH)}`
    if (fittedForRef.current === key) return
    fittedForRef.current = key
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVb({
      x: 0,
      y: (worldH - worldW * (ratioMode === 'aspect' ? worldH / worldW : ratioRef.current)) / 2,
      w: worldW,
      h: worldW * (ratioMode === 'aspect' ? worldH / worldW : ratioRef.current),
    })
  }, [initial, worldW, worldH, ratioMode])

  // 滚轮缩放（鼠标位置为锚点）：生命周期在 useWheelZoom，数学在 core/viewport.wheelZoomIntent
  useWheelZoom(svgRef, { enabled, vbRef: vbRef as RefObject<ViewportRect>, zoomAt })

  // 空白拖拽平移：手势会话走 core createCanvasController（与编辑器同源），
  // 屏幕位移 → viewBox 换算在 core/viewport.panByScreen（惰性单例控制器）
  const [panCtl] = useState(() => createCanvasController<{ x: number; y: number }>({ toPoint: (cx, cy) => ({ x: cx, y: cy }) }))

  const startPan = useCallback((e: React.PointerEvent<SVGSVGElement>, opts?: { moveThreshold?: number; onMovedEnd?: (moved: boolean) => void }) => {
    if (e.button !== 0) return
    const svg = svgRef.current
    if (!svg) return
    const startCx = e.clientX
    const startCy = e.clientY
    const startVb = vbRef.current
    panCtl.run({
      kind: 'pan',
      start: { x: startCx, y: startCy },
      toPoint: (cx, cy) => ({ x: cx, y: cy }),
      moveThreshold: opts?.moveThreshold,
      onMove: (p) => {
        setPanning(true)
        const s = svg.getBoundingClientRect().width / startVb.w
        applyVb(panByScreen(startVb, p.x - startCx, p.y - startCy, s))
      },
      onEnd: (_p, s) => {
        setPanning(false)
        opts?.onMovedEnd?.(s.moved)
      },
    })
  }, [applyVb, panCtl])

  const percent = Math.round((base / (vb.w || 1)) * 100)
  const atMin = vb.w >= maxW - 0.5
  const atMax = vb.w <= minW + 0.5

  return {
    vb, setVb, vbRef: vbRef as RefObject<ViewportRect>, boxRef, svgRef, attachBox,
    containerW, ratio: ratioMode === 'aspect' ? worldH / worldW : measureRatio,
    zoomAt, resetView, fitWorld, setPercent, focusOn, navToWorld, startPan, panning,
    percent, atMin, atMax, bounds: minimapBoundsOf(vb),
  }
}

// ============ ② ViewerControls：缩放控制条 ============

/** 图层显隐开关描述（控制条右侧通用 chips） */
export interface ViewerToggle {
  key: string
  label: string
  icon: ReactNode
  on: boolean
  onToggle: () => void
}

/** 控制条按钮统一样式（三处消费方视觉收敛：teal 激活 / stone 常态） */
const ctlBtn = 'rounded p-1.5 transition-colors'

export function ViewerControls({
  percent, onZoomIn, onZoomOut, atMin, atMax,
  onReset, minimapOn, onToggleMinimap,
  toggles = [], extra, className,
}: {
  percent: number
  onZoomIn: () => void
  onZoomOut: () => void
  atMin?: boolean
  atMax?: boolean
  /** 有则显示复位按钮 */
  onReset?: () => void
  /** 有则显示俯瞰图开关按钮 */
  minimapOn?: boolean
  onToggleMinimap?: () => void
  /** 图层显隐开关（激活态 teal 高亮 + aria-pressed） */
  toggles?: ViewerToggle[]
  /** 额外按钮（定位回中 / 1:1 / 适应窗口等，追加在末尾） */
  extra?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('absolute bottom-2.5 left-2.5 z-10 flex items-center gap-0.5 rounded-lg border border-stone-200 bg-white/95 p-1 shadow-sm backdrop-blur', className)}>
      <button
        type="button"
        title="缩小（或画布上滚动滚轮）"
        aria-label="缩小"
        className={cn(ctlBtn, 'text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40')}
        disabled={atMin}
        onClick={onZoomOut}
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <span className="w-11 select-none text-center font-mono text-xs font-medium text-stone-600" title="当前缩放比例（1:1 = 100%）">
        {percent}%
      </span>
      <button
        type="button"
        title="放大（或画布上滚动滚轮）"
        aria-label="放大"
        className={cn(ctlBtn, 'text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40')}
        disabled={atMax}
        onClick={onZoomIn}
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      {onReset && (
        <>
          <div className="mx-0.5 h-4 w-px bg-stone-200" />
          <button type="button" title="重置视图" aria-label="重置视图" className={cn(ctlBtn, 'text-stone-500 hover:bg-stone-100 hover:text-stone-800')} onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
          </button>
        </>
      )}
      {(onToggleMinimap != null) && (
        <>
          <div className="mx-0.5 h-4 w-px bg-stone-200" />
          <button
            type="button"
            title="俯瞰图开关：画布右下角显示整图缩略导航，点击/拖拽缩略图快速移动视口"
            aria-label="俯瞰图开关"
            aria-pressed={minimapOn}
            className={cn(ctlBtn, minimapOn ? 'bg-emerald-50 text-emerald-700' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800')}
            onClick={onToggleMinimap}
          >
            <MapIcon className="h-4 w-4" />
          </button>
        </>
      )}
      {toggles.length > 0 && <div className="mx-0.5 h-4 w-px bg-stone-200" />}
      {toggles.map((t) => (
        <button
          key={t.key}
          type="button"
          title={t.label}
          aria-label={t.label}
          aria-pressed={t.on}
          className={cn(ctlBtn, t.on ? 'bg-teal-50 text-teal-700' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-600')}
          onClick={t.onToggle}
        >
          {t.icon}
        </button>
      ))}
      {extra}
    </div>
  )
}

// ============ ③ ViewerMinimap：俯瞰图浮层框 ============

export function ViewerMinimap({
  bounds, vb, onNavigate, onClose, open = true, scene, originW, originH,
}: {
  /** 俯瞰世界包围盒（useDiagramViewport().bounds） */
  bounds: ViewportRect
  /** 当前视口（amber 框自绘） */
  vb: ViewportRect
  /** 点击/拖拽导航（世界坐标落点） */
  onNavigate: (x: number, y: number) => void
  onClose: () => void
  open?: boolean
  /** 世界简化场景（消费方注入：连线直线近似 + 图元轮廓 + 标注菱形） */
  scene: ReactNode
  /** 世界原点区域尺寸（白底参照矩形，如 CANVAS_W/H） */
  originW: number
  originH: number
}) {
  const navRef = useRef(false)
  const navTo = (clientX: number, clientY: number, el: SVGSVGElement) => {
    const w = minimapNavigateWorld(clientX, clientY, el.getBoundingClientRect(), bounds)
    if (w) onNavigate(w.x, w.y)
  }
  if (!open) return null
  return (
    <div className="absolute bottom-2.5 right-2.5 z-10 overflow-hidden rounded-lg border border-stone-200 bg-white/95 shadow-md backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-stone-100 py-1 pl-2 pr-1">
        <span className="flex select-none items-center gap-1 text-[10px] font-medium text-stone-500">
          <MapIcon className="h-3 w-3" />
          俯瞰图
        </span>
        <span className="hidden select-none text-[9px] text-stone-400 sm:inline">点击/拖拽定位</span>
        <button
          type="button"
          title="关闭俯瞰图（工具栏可重新打开）"
          aria-label="关闭俯瞰图"
          className="rounded p-0.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <svg
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
        className="block h-28 w-44 cursor-pointer touch-none sm:h-32 sm:w-52"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          navRef.current = true
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 旧环境无 capture，点击定位仍可用 */ }
          navTo(e.clientX, e.clientY, e.currentTarget)
        }}
        onPointerMove={(e) => {
          if (navRef.current) navTo(e.clientX, e.clientY, e.currentTarget)
        }}
        onPointerUp={(e) => {
          navRef.current = false
          try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
        }}
        onPointerCancel={() => { navRef.current = false }}
      >
        <g pointerEvents="none">
          {/* 世界背景：画布区域白底、视口外微灰（画布原点参照） */}
          <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="#f5f5f4" />
          <rect x={0} y={0} width={originW} height={originH} fill="#fff" stroke="#e7e5e4" vectorEffect="non-scaling-stroke" />
          {scene}
          {/* 当前视口（amber，与定位高亮同色语言） */}
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
    </div>
  )
}

// ============ ④ DiagramViewer：组合壳（纯查看器一键落地） ============

export function DiagramViewer({
  worldW, worldH, base100, minZoom, maxZoom, ratio, initial = 'world', enabled = true, bindKey,
  desktop = false, bgImage, bgOpacity = 0.55, defs, scene, minimapScene, minimapDefaultOpen = false,
  toggles, extra, showReset = false, legend,
  onSvgPointerDown, onSvgPointerMove, onSvgClick, svgClassName,
  boxClassName, boxStyle, height, onViewportApi,
}: {
  worldW: number
  worldH: number
  base100?: 'world' | 'container'
  minZoom?: number
  maxZoom?: number
  ratio?: 'aspect' | 'measure'
  /** 初始视图：'world' 全景（默认）| 'width' 适配容器宽 */
  initial?: 'world' | 'width'
  enabled?: boolean
  /** svg 重挂载重绑滚轮键（如图切换 id） */
  bindKey?: string | number
  /** 无限桌面：白底+双层网格跟随视口 + 世界原点虚线框（PID 画布风格） */
  desktop?: boolean
  /** 底图（PID 扫描图/照片 data URL，Task 127）：绘制在世界原点区域内、网格之下，衬底对位描画 */
  bgImage?: string | null
  /** 底图不透明度（默认 0.55） */
  bgOpacity?: number
  /** 额外 svg defs（箭头 marker 等） */
  defs?: ReactNode
  /** 世界坐标场景内容（svg 内部，viewBox 变换后渲染） */
  scene?: ReactNode
  /** 俯瞰图简化场景（渲染 prop：入参为实时俯瞰包围盒；提供则启用俯瞰开关 + 浮层） */
  minimapScene?: (bounds: ViewportRect) => ReactNode
  minimapDefaultOpen?: boolean
  /** 图层显隐开关 */
  toggles?: ViewerToggle[]
  /** 控制条额外按钮 */
  extra?: ReactNode
  /** 显示复位按钮 */
  showReset?: boolean
  /** 图例 slot（渲染于取景框下方，消费方自带样式） */
  legend?: ReactNode
  /** 命令式视口控制外泄（每次渲染后回调最新 api；消费方存入自身 ref 后可 focusOn/setPercent 驱动视角） */
  onViewportApi?: (api: DiagramViewportApi) => void
  /** 覆盖 svg 手势（编辑器画布传入自有 pointerDown；缺省内置拖拽平移） */
  onSvgPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void
  onSvgPointerMove?: (e: React.PointerEvent<SVGSVGElement>) => void
  onSvgClick?: (e: React.MouseEvent<SVGSVGElement>) => void
  svgClassName?: string
  boxClassName?: string
  boxStyle?: CSSProperties
  /** 取景框高度（measure 模式；缺省 aspect 模式按 world 比自适应） */
  height?: number
}) {
  const vp = useDiagramViewport({ worldW, worldH, base100, minZoom, maxZoom, ratio, initial, enabled })
  const { attachBox: vpAttachBox, svgRef: vpSvgRef } = vp
  const [minimapOpen, setMinimapOpen] = useState(minimapDefaultOpen)
  const pid = useId().replace(/:/g, '') // 多实例同屏 pattern id 防冲突

  // 命令式控制面外泄（每次渲染后回调；消费方存入自身 ref 驱动视角，不做状态同步故无环）
  useEffect(() => {
    onViewportApi?.(vp)
  })

  const aspectStyle: CSSProperties = ratio === 'measure'
    ? { height: height ?? 0 }
    : { aspectRatio: `${worldW} / ${worldH}` }

  return (
    <>
      <div
        ref={vpAttachBox}
        className={cn('relative w-full overflow-hidden rounded-lg border bg-white', boxClassName)}
        style={{ ...aspectStyle, ...boxStyle }}
      >
        <svg
          ref={vpSvgRef}
          viewBox={`${vp.vb.x} ${vp.vb.y} ${vp.vb.w} ${vp.vb.h}`}
          className={cn(
            'absolute inset-0 block h-full w-full touch-none select-none',
            vp.panning ? 'cursor-grabbing' : 'cursor-grab',
            svgClassName,
          )}
          onPointerDown={onSvgPointerDown ?? ((e) => vp.startPan(e))}
          onPointerMove={onSvgPointerMove}
          onClick={onSvgClick}
        >
          <defs>
            {desktop && (
              <>
                <pattern id={`${pid}-grid-s`} width={20} height={20} patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e7e5e4" strokeWidth={1} />
                </pattern>
                <pattern id={`${pid}-grid-l`} width={100} height={100} patternUnits="userSpaceOnUse">
                  <rect width={100} height={100} fill={`url(#${pid}-grid-s)`} />
                  <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#d6d3d1" strokeWidth={1.2} />
                </pattern>
              </>
            )}
            {defs}
          </defs>
          {desktop && (
            <>
              {/* 无限桌面：白底+网格跟随视口（3 倍视口尺寸，拖到任何位置都有桌面） */}
              <rect x={vp.vb.x - vp.vb.w} y={vp.vb.y - vp.vb.h} width={vp.vb.w * 3} height={vp.vb.h * 3} fill="#fff" />
              {/* 底图衬底（网格之下，对位描画） */}
              {bgImage && (
                <image href={bgImage} x={0} y={0} width={worldW} height={worldH} preserveAspectRatio="xMidYMid meet" opacity={bgOpacity} pointerEvents="none" />
              )}
              <rect x={vp.vb.x - vp.vb.w} y={vp.vb.y - vp.vb.h} width={vp.vb.w * 3} height={vp.vb.h * 3} fill={`url(#${pid}-grid-l)`} />
              {/* 世界原点标界虚线框（无限桌面上找回「家」的参照） */}
              <rect x={0} y={0} width={worldW} height={worldH} fill="none" stroke="#d6d3d1" strokeWidth={1.2} strokeDasharray="12 8" vectorEffect="non-scaling-stroke" pointerEvents="none" />
            </>
          )}
          {scene}
        </svg>

        <ViewerControls
          percent={vp.percent}
          onZoomIn={() => vp.zoomAt(1.25)}
          onZoomOut={() => vp.zoomAt(1 / 1.25)}
          atMin={vp.atMin}
          atMax={vp.atMax}
          onReset={showReset ? vp.resetView : undefined}
          minimapOn={minimapScene != null ? minimapOpen : undefined}
          onToggleMinimap={minimapScene != null ? () => setMinimapOpen((v) => !v) : undefined}
          toggles={toggles}
          extra={extra}
        />

        {minimapScene != null && (
          <ViewerMinimap
            open={minimapOpen}
            bounds={vp.bounds}
            vb={vp.vb}
            onNavigate={vp.navToWorld}
            onClose={() => setMinimapOpen(false)}
            originW={worldW}
            originH={worldH}
            scene={minimapScene(vp.bounds)}
          />
        )}
      </div>
      {legend}
    </>
  )
}
