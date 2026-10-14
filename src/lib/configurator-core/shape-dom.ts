// ============ Shape IR → SVG DOM 渲染器（createElementNS，零框架依赖） ============
// Vue / 原生 JS 接入入口：shapesToSvgElement(...) 产出可直接 append 的 <svg>，
// Vue 组件在 mounted 中一行接入（见 components/configurator/vue/configurator-vue.ts）。
// React 适配层使用等价的 data→JSX 映射器（components/configurator/shape-icon.tsx），
// 两者消费同一份 Shape 数据、同一套兜底语义，视觉输出一致。
//
// 兜底语义（与 React 映射器保持一致）：
//   - 可填充形状（path/rect/circle/ellipse/polygon/polyline）fill 未指定 → 'none'
//   - 描边未指定 → 'none'（避免 SVG 默认黑描边/黑填充的意外）
//   - text fill 未指定 → paint.stroke（文字缺省可见，颜色跟随描边）

import { resolvePaint, type Shape, type ShapePaint } from './shapes'

export const SVG_NS = 'http://www.w3.org/2000/svg'

export interface DomPaintOptions {
  paint: ShapePaint
  /** 非 text/group 元素统一 non-scaling-stroke（缩放恒定线宽，与 std 库 CSS 方案等价） */
  nonScalingStroke?: boolean
}

function applyCommon(el: SVGElement, s: Shape, opts: DomPaintOptions): void {
  const paint = opts.paint
  const isText = s.kind === 'text'
  const isGroup = s.kind === 'group'
  const fillable = !isText && !isGroup && s.kind !== 'line'
  const stroke = resolvePaint(s.stroke, paint)
  const fill = resolvePaint(s.fill, paint)
  if (stroke !== undefined) el.setAttribute('stroke', stroke)
  else if (!isGroup) el.setAttribute('stroke', 'none')
  if (fill !== undefined) el.setAttribute('fill', fill)
  else if (isText) el.setAttribute('fill', paint.stroke)
  else if (fillable) el.setAttribute('fill', 'none')
  if (s.strokeWidth !== undefined) el.setAttribute('stroke-width', String(s.strokeWidth))
  if (s.dash) el.setAttribute('stroke-dasharray', s.dash)
  if (s.cap) el.setAttribute('stroke-linecap', s.cap)
  if (s.join) el.setAttribute('stroke-linejoin', s.join)
  if (s.opacity !== undefined) el.setAttribute('opacity', String(s.opacity))
  if (opts.nonScalingStroke && !isText && !isGroup) el.setAttribute('vector-effect', 'non-scaling-stroke')
}

function pointsAttr(pts: number[][]): string {
  return pts.map((p) => `${p[0]},${p[1]}`).join(' ')
}

/** 单个 Shape → 独立 SVG 元素（含递归 group） */
export function shapeToElement(s: Shape, opts: DomPaintOptions): SVGElement {
  switch (s.kind) {
    case 'path': {
      const el = document.createElementNS(SVG_NS, 'path')
      el.setAttribute('d', s.d)
      applyCommon(el, s, opts)
      return el
    }
    case 'circle': {
      const el = document.createElementNS(SVG_NS, 'circle')
      el.setAttribute('cx', String(s.cx))
      el.setAttribute('cy', String(s.cy))
      el.setAttribute('r', String(s.r))
      applyCommon(el, s, opts)
      return el
    }
    case 'ellipse': {
      const el = document.createElementNS(SVG_NS, 'ellipse')
      el.setAttribute('cx', String(s.cx))
      el.setAttribute('cy', String(s.cy))
      el.setAttribute('rx', String(s.rx))
      el.setAttribute('ry', String(s.ry))
      applyCommon(el, s, opts)
      return el
    }
    case 'rect': {
      const el = document.createElementNS(SVG_NS, 'rect')
      el.setAttribute('x', String(s.x))
      el.setAttribute('y', String(s.y))
      el.setAttribute('width', String(s.w))
      el.setAttribute('height', String(s.h))
      if (s.rx !== undefined) el.setAttribute('rx', String(s.rx))
      applyCommon(el, s, opts)
      return el
    }
    case 'line': {
      const el = document.createElementNS(SVG_NS, 'line')
      el.setAttribute('x1', String(s.x1))
      el.setAttribute('y1', String(s.y1))
      el.setAttribute('x2', String(s.x2))
      el.setAttribute('y2', String(s.y2))
      applyCommon(el, s, opts)
      return el
    }
    case 'polyline': {
      const el = document.createElementNS(SVG_NS, 'polyline')
      el.setAttribute('points', pointsAttr(s.pts))
      applyCommon(el, s, opts)
      return el
    }
    case 'polygon': {
      const el = document.createElementNS(SVG_NS, 'polygon')
      el.setAttribute('points', pointsAttr(s.pts))
      applyCommon(el, s, opts)
      return el
    }
    case 'text': {
      const el = document.createElementNS(SVG_NS, 'text')
      el.setAttribute('x', String(s.x))
      el.setAttribute('y', String(s.y))
      el.textContent = s.text
      if (s.size !== undefined) el.setAttribute('font-size', String(s.size))
      if (s.weight !== undefined) el.setAttribute('font-weight', String(s.weight))
      if (s.anchor) el.setAttribute('text-anchor', s.anchor)
      if (s.baseline) el.setAttribute('dominant-baseline', s.baseline)
      if (s.family) el.setAttribute('font-family', s.family)
      applyCommon(el, s, opts)
      return el
    }
    case 'group': {
      const el = document.createElementNS(SVG_NS, 'g')
      for (const child of s.children) el.appendChild(shapeToElement(child, opts))
      applyCommon(el, s, opts)
      return el
    }
  }
}

export interface SvgBuildOptions extends DomPaintOptions {
  viewBox?: { x?: number; y?: number; w: number; h: number }
  className?: string
}

/** Shape 数据 → 独立 <svg> 元素（Vue/原生缩略图一行接入；调用方自行 append/remove） */
export function shapesToSvgElement(shapes: Shape[], opts: SvgBuildOptions): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  if (opts.viewBox) {
    svg.setAttribute('viewBox', `${opts.viewBox.x ?? 0} ${opts.viewBox.y ?? 0} ${opts.viewBox.w} ${opts.viewBox.h}`)
  }
  if (opts.className) svg.setAttribute('class', opts.className)
  svg.setAttribute('aria-hidden', 'true')
  for (const s of shapes) svg.appendChild(shapeToElement(s, opts))
  return svg
}
