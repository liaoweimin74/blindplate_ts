// ============ Vue 3 接入示例壳（零依赖：不 import vue / react，可原样拆入独立 npm 包） ============
// 组态核心（lib/configurator-core）与图元数据包（Shape IR）均为零框架产物，
// Vue 侧无需任何 React 依赖即可渲染同一套图元——SVG 由 core 的 shape-dom
// （createElementNS）直接产出，Vue 组件只在生命周期里挂载/卸载宿主元素即可。
//
// ── 用法示例（Vue 3 SFC · 图元库缩略图组件）─────────────────────────
// <template>
//   <div ref="host" class="sym-thumb" />
// </template>
// <script setup lang="ts">
// import { onMounted, onUnmounted, ref, watch } from 'vue'
// import type { SymbolMeta } from '@/lib/configurator-core'
// import { mountSymbolThumb } from '@/components/configurator/vue/configurator-vue'
//
// const props = defineProps<{ meta: SymbolMeta }>()
// const host = ref<HTMLElement | null>(null)
// let dispose: (() => void) | undefined
// function render() {
//   dispose?.()
//   if (host.value) dispose = mountSymbolThumb(host.value, props.meta)
// }
// onMounted(render)
// watch(() => props.meta, render)
// onUnmounted(() => dispose?.())
// </script>
//
// ── 契约说明（与 React 适配层等价）────────────────────────────────
//   1. registry：buildRegistry(...) / buildStdRegistry 的产物直接可用，
//      SymbolMeta.draw() 返回零框架 Shape IR —— Vue/React 渲染同一份数据
//   2. 缩略图：mountSymbolThumb(el, meta) 一行接入（本文件）
//   3. 画布：createCanvasController({ toPoint }) 一行获得与 React 组态画布
//      完全一致的交互（点选/拖动/多选整体拖动/Shift+空白框选/四角缩放/直线橡皮筋/
//      连线端点吸附改接/click 误触抑制），几何策略（resizeBox/labelTAt/snapConnEnd/
//      hitTestRect 框选命中）与连线模型操作（connExists/rewireConnTarget）
//      全部 core 化——Vue 壳与 React 壳共用同一控制器（见本文件 mountCanvasBoard 示例）
//   4. 属性面板：PropFieldDef schema 驱动，Vue 表单组件按 schema 自动渲染，
//      业务绑定走 Vue slot（对应 React children 插槽）
import type { ShapePaint, SymbolMeta } from '@/lib/configurator-core'
import { createCanvasController, resizeBox, hitTestRect, normRect, type CanvasPoint, type RubberRect } from '@/lib/configurator-core'
import { shapesToSvgElement } from '@/lib/configurator-core'

export interface ThumbMountOptions {
  /** 缺省与 React 侧 StdSymbolThumb 一致（石描边/白填充） */
  paint?: Partial<ShapePaint>
  className?: string
}

/**
 * 把符号缩略图挂载到任意 DOM 宿主（Vue mounted / 原生 JS 均可）。
 * 内部经 core shape-dom 产出真实 <svg>（non-scaling-stroke），返回卸载函数。
 */
export function mountSymbolThumb(el: HTMLElement, meta: SymbolMeta, opts: ThumbMountOptions = {}): () => void {
  const shapes = meta.draw?.() ?? []
  if (shapes.length === 0) return () => {}
  const svg = shapesToSvgElement(shapes, {
    paint: { stroke: opts.paint?.stroke ?? '#57534e', fill: opts.paint?.fill ?? '#fff' },
    nonScalingStroke: true,
    viewBox: { w: meta.defaultW, h: meta.defaultH },
    className: opts.className ?? 'h-12 w-full',
  })
  el.appendChild(svg)
  return () => {
    svg.remove()
  }
}

// ── 画布板示例：与 React 组态画布共用 core createCanvasController ────────
// 演示「点选 / 拖动 / 四角缩放 / Esc 取消选中」全套交互在零框架宿主上的落地，
// 交互手感与 pid-config 主画布同源（同一手势会话与 resizeBox 几何策略）。
// Vue 3 SFC 用法：
//   <div ref="host" class="canvas-board" />
//   onMounted(() => { dispose = mountCanvasBoard(host.value!, { onChange: console.log }) })
//   onUnmounted(() => dispose?.())

export interface CanvasBoardBox {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  fill?: string
  stroke?: string
}

export interface CanvasBoardOptions {
  /** 设计空间尺寸（viewBox；缺省 800×500，等比铺满宿主） */
  viewBox?: { w: number; h: number }
  /** 初始图元（缺省给 3 个演示块） */
  boxes?: CanvasBoardBox[]
  /** 任意几何变化（拖动/缩放落定）回调——业务在此持久化或联动 */
  onChange?: (boxes: CanvasBoardBox[]) => void
}

const BOARD_SVG_NS = 'http://www.w3.org/2000/svg'
const BOARD_TEAL = '#0d9488'
const HANDLE = 7 // 角柄边长（设计单位）

function boardEl(name: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const el = document.createElementNS(BOARD_SVG_NS, name)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  parent?.appendChild(el)
  return el
}

/**
 * 把一个可交互画布板挂载到任意 DOM 宿主（Vue mounted / 原生 JS 均可）。
 * 内部经 core createCanvasController 产出与 React 组态画布同源的交互（拖动/缩放），
 * 几何变化通过 opts.onChange 通知宿主；返回卸载函数。
 */
export function mountCanvasBoard(el: HTMLElement, opts: CanvasBoardOptions = {}): () => void {
  const VW = opts.viewBox?.w ?? 800
  const VH = opts.viewBox?.h ?? 500
  const boxes: CanvasBoardBox[] = (opts.boxes ?? [
    { id: 'b1', label: '反应器', x: 60, y: 60, w: 140, h: 180, fill: '#ccfbf1' },
    { id: 'b2', label: '储罐', x: 320, y: 90, w: 120, h: 150, fill: '#fef3c7' },
    { id: 'b3', label: '泵', x: 520, y: 300, w: 90, h: 70, fill: '#ede9fe' },
  ]).map((b) => ({ ...b }))
  let selectedId: string | null = null
  const bulkIds = new Set<string>() // 多选集（Shift+空白框选 / Shift+点选；成员整体拖动）

  const svg = boardEl('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'w-full h-full block select-none touch-none', style: 'background:#fafaf9' })
  const defs = boardEl('defs', {}, svg)
  const pat = boardEl('pattern', { id: 'board-grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' }, defs)
  boardEl('path', { d: 'M 20 0 L 0 0 0 20', fill: 'none', stroke: '#e7e5e4', 'stroke-width': 1 }, pat)
  boardEl('rect', { x: 0, y: 0, width: VW, height: VH, fill: 'url(#board-grid)' }, svg)
  const boxLayer = boardEl('g', {}, svg)
  const selLayer = boardEl('g', {}, svg) // 选中框 + 角柄（恒在最上层）
  const rubberLayer = boardEl('g', { 'pointer-events': 'none', visibility: 'hidden' }, svg) // 框选橡皮筋（最上层，非交互）

  // Shift + 空白拖拽 = 框选橡皮筋（与 React 壳同源：normRect + hitTestRect 相交命中）
  function startRubberSelect(sx: number, sy: number) {
    let r: RubberRect = { x0: sx, y0: sy, x1: sx, y1: sy }
    const show = (v: RubberRect | null) => {
      if (!v) {
        rubberLayer.setAttribute('visibility', 'hidden')
        return
      }
      rubberLayer.replaceChildren(boardEl('rect', {
        x: v.x0, y: v.y0, width: Math.max(v.x1 - v.x0, 0.01), height: Math.max(v.y1 - v.y0, 0.01),
        rx: 2, fill: 'rgba(13,148,136,0.08)', stroke: BOARD_TEAL, 'stroke-width': 1.5,
        'stroke-dasharray': '6 3', 'vector-effect': 'non-scaling-stroke',
      }))
      rubberLayer.setAttribute('visibility', 'visible')
    }
    show(r)
    ctl.run({
      kind: 'select',
      start: { x: sx, y: sy },
      moveThreshold: 3, // 轻点保留普通空白点击语义
      onMove: (p) => {
        r = normRect(sx, sy, p.x, p.y)
        show(r)
      },
      onEnd: (_p, sess) => {
        show(null)
        if (!sess.moved) return
        bulkIds.clear()
        for (const id of hitTestRect(boxes, r)) bulkIds.add(id)
        if (bulkIds.size) selectedId = [...bulkIds][bulkIds.size - 1] // 属性面板语义跟随最后命中
        renderBoxes()
        renderSelection()
      },
    })
  }

  // 与 React 壳同源：一个 toPoint 换算 + createCanvasController = 全部画布交互
  const ctl = createCanvasController<CanvasPoint>({
    toPoint: (cx, cy) => {
      const r = svg.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      return { x: ((cx - r.left) * VW) / r.width, y: ((cy - r.top) * VH) / r.height }
    },
  })

  const notify = () => opts.onChange?.(boxes.map((b) => ({ ...b })))
  const boxOf = (id: string | null) => (id ? boxes.find((b) => b.id === id) ?? null : null)

  const corner = (b: CanvasBoardBox, h: 'nw' | 'ne' | 'sw' | 'se') => ({ x: h === 'ne' || h === 'se' ? b.x + b.w : b.x, y: h === 'sw' || h === 'se' ? b.y + b.h : b.y })
  const CURSOR: Record<string, string> = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize' }

  function renderSelection() {
    selLayer.replaceChildren()
    const b = boxOf(selectedId)
    if (!b) return
    boardEl('rect', { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, fill: 'none', stroke: BOARD_TEAL, 'stroke-width': 1.5, 'stroke-dasharray': '5 3' }, selLayer)
    boardEl('text', { x: b.x, y: b.y - 10, 'font-size': 12, fill: BOARD_TEAL, 'font-family': 'PingFang SC, Microsoft YaHei, sans-serif' }, selLayer).textContent = b.label
    for (const h of ['nw', 'ne', 'sw', 'se'] as const) {
      const c = corner(b, h)
      const knob = boardEl('rect', { x: c.x - HANDLE / 2, y: c.y - HANDLE / 2, width: HANDLE, height: HANDLE, fill: '#fff', stroke: BOARD_TEAL, 'stroke-width': 1.5, cursor: CURSOR[h] }, selLayer)
      knob.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        e.preventDefault()
        const b0 = { ...b } // 缩放基准快照：对角固定点在整个手势内保持不变（与 React 壳渲染快照同语义）
        ctl.run({
          kind: 'resize',
          targetId: b.id,
          start: c,
          onMove: (p) => {
            // core resizeBox：对角固定点/最小尺寸/翻转向全部与 React 主画布同策略
            const r = resizeBox({ handle: h, box: b0, px: p.x, py: p.y, minW: 24, minH: 18 })
            Object.assign(b, { x: r.x, y: r.y, w: r.w, h: r.h })
            renderBoxes()
            renderSelection()
          },
          onEnd: (_p, s) => { if (s.moved) notify() },
        })
      })
    }
  }

  function renderBoxes() {
    boxLayer.replaceChildren()
    for (const b of boxes) {
      const g = boardEl('g', {}, boxLayer)
      // 多选成员高亮：teal 双描边（与 React 壳 Task 89 isBulk 同语义）
      const isBulk = bulkIds.has(b.id)
      boardEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 3, fill: b.fill ?? '#fff', stroke: isBulk ? BOARD_TEAL : (b.stroke ?? '#44403c'), 'stroke-width': isBulk ? 2.5 : 1.5, cursor: 'move' }, g)
      const t = boardEl('text', { x: b.x + b.w / 2, y: b.y + b.h / 2 + 4, 'text-anchor': 'middle', 'font-size': 13, fill: '#57534e', 'font-family': 'PingFang SC, Microsoft YaHei, sans-serif', 'pointer-events': 'none' }, g)
      t.textContent = b.label
      g.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        const r0 = svg.getBoundingClientRect()
        const sx = ((e.clientX - r0.left) * VW) / r0.width
        const sy = ((e.clientY - r0.top) * VH) / r0.height
        // Shift + 点选：加入/移出多选（与 React 壳 handleShapeClick 同语义）
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          if (bulkIds.has(b.id)) bulkIds.delete(b.id)
          else bulkIds.add(b.id)
          selectedId = b.id
          renderBoxes()
          renderSelection()
          return
        }
        if (bulkIds.size && !bulkIds.has(b.id)) bulkIds.clear()
        selectedId = b.id
        renderBoxes()
        renderSelection()
        // 多选整体拖动（Phase 3）：点中成员在多选集且成员 > 1 时全体同位移（ origins 按下时快照）
        if (bulkIds.size > 1 && bulkIds.has(b.id)) {
          const origins = new Map(boxes.filter((x) => bulkIds.has(x.id)).map((x) => [x.id, { x: x.x, y: x.y }] as const))
          ctl.run({
            kind: 'drag-shape',
            targetId: b.id,
            start: { x: sx, y: sy },
            onMove: (p) => {
              const dx = p.x - sx
              const dy = p.y - sy
              for (const x of boxes) {
                const o = origins.get(x.id)
                if (!o) continue
                x.x = Math.round(o.x + dx)
                x.y = Math.round(o.y + dy)
              }
              renderBoxes()
              renderSelection()
            },
            onEnd: (_p, s) => { if (s.moved) notify() },
          })
          return
        }
        const offX = sx - b.x // 拖拽偏移按下时捕获一次（指针 → 图元左上角）
        const offY = sy - b.y
        ctl.run({
          kind: 'drag-shape',
          targetId: b.id,
          start: { x: sx, y: sy },
          onMove: (p) => {
            b.x = Math.round(p.x - offX)
            b.y = Math.round(p.y - offY)
            renderBoxes()
            renderSelection()
          },
          onEnd: (_p, s) => { if (s.moved) notify() },
        })
      })
    }
  }

  svg.addEventListener('pointerdown', (e) => { // 空白按下：Shift/Ctrl/Cmd = 框选；普通 = 取消选中 + 清多选
    const r0 = svg.getBoundingClientRect()
    const sx = ((e.clientX - r0.left) * VW) / r0.width
    const sy = ((e.clientY - r0.top) * VH) / r0.height
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && !e.altKey) {
      startRubberSelect(sx, sy)
      return
    }
    selectedId = null
    bulkIds.clear()
    renderBoxes()
    renderSelection()
  })
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      selectedId = null
      bulkIds.clear()
      renderBoxes()
      renderSelection()
    }
  }
  window.addEventListener('keydown', onKey)

  renderBoxes()
  renderSelection()
  el.appendChild(svg)
  return () => {
    window.removeEventListener('keydown', onKey)
    svg.remove()
  }
}
