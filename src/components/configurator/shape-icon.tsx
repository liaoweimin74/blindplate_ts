'use client'
// ============ Shape IR → React JSX 映射器（框架适配层 · React 侧薄渲染桥） ============
// 与 core/shape-dom.ts（createElementNS，Vue/原生侧）消费同一份 Shape 数据、
// 同一套兜底语义（可填充形状缺省 fill='none'、缺省 stroke='none'、text 缺省 fill=描边色），
// React 侧不做 DOM 手术（保持 React 渲染所有权），仅做纯数据 → JSX 映射。
// 图元数据不含颜色，渲染期经 resolvePaint 解析 '{stroke}'/'{fill}' token。

import type { ReactNode } from 'react'
import type { Shape, ShapePaint } from '@/lib/configurator-core'
import { resolvePaint } from '@/lib/configurator-core'

/** 单个 Shape → JSX 元素（paint token 解析 + non-scaling-stroke） */
export function renderShape(shape: Shape, paint: ShapePaint, key?: React.Key): ReactNode {
  const isText = shape.kind === 'text'
  const isGroup = shape.kind === 'group'
  const stroke = resolvePaint(shape.stroke, paint) ?? 'none'
  const fill = isText ? resolvePaint(shape.fill, paint) ?? paint.stroke : resolvePaint(shape.fill, paint) ?? 'none'
  const common = {
    stroke,
    fill,
    strokeWidth: shape.strokeWidth,
    strokeDasharray: shape.dash,
    strokeLinecap: shape.cap,
    strokeLinejoin: shape.join,
    opacity: shape.opacity,
    vectorEffect: isText || isGroup ? undefined : ('non-scaling-stroke' as const),
  }
  switch (shape.kind) {
    case 'path':
      return <path key={key} d={shape.d} {...common} />
    case 'circle':
      return <circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />
    case 'ellipse':
      return <ellipse key={key} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...common} />
    case 'rect':
      return <rect key={key} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...common} />
    case 'line':
      return <line key={key} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...common} />
    case 'polyline':
      return <polyline key={key} points={shape.pts.map((p) => `${p[0]},${p[1]}`).join(' ')} {...common} />
    case 'polygon':
      return <polygon key={key} points={shape.pts.map((p) => `${p[0]},${p[1]}`).join(' ')} {...common} />
    case 'text':
      return (
        <text
          key={key}
          x={shape.x}
          y={shape.y}
          fontSize={shape.size}
          fontWeight={shape.weight}
          textAnchor={shape.anchor}
          dominantBaseline={shape.baseline}
          fontFamily={shape.family}
          stroke={stroke}
          fill={fill}
        >
          {shape.text}
        </text>
      )
    case 'group':
      return <g key={key} {...common}>{shape.children.map((c, i) => renderShape(c, paint, i))}</g>
  }
}

/** Shape 数组 → JSX 节点（无包裹元素；用于已有 <svg>/<g> 宿主内部，如拖放幻影） */
export function shapesNode(shapes: Shape[], paint: ShapePaint): ReactNode {
  return <>{shapes.map((s, i) => renderShape(s, paint, i))}</>
}

/** 内容级渲染：嵌入宿主坐标系（可选 translate）；画布 ShapeBody / 缩略包装用 */
export function ShapeContent({ shapes, stroke, fill, x, y }: {
  shapes: Shape[]
  stroke: string
  fill: string
  x?: number
  y?: number
}) {
  const body = shapes.map((s, i) => renderShape(s, { stroke, fill }, i))
  if (x === undefined && y === undefined) return <g>{body}</g>
  return <g transform={`translate(${x ?? 0} ${y ?? 0})`}>{body}</g>
}

/** 独立 <svg> 缩略图（viewBox=设计空间；palette 宫格/图例通用，与 StdSymbolThumb 同构） */
export function ShapeSvg({ shapes, vw, vh, className, stroke = '#57534e', fill = '#fff' }: {
  shapes: Shape[]
  vw: number
  vh: number
  className?: string
  stroke?: string
  fill?: string
}) {
  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} className={className} aria-hidden="true">
      {shapes.map((s, i) => renderShape(s, { stroke, fill }, i))}
    </svg>
  )
}
