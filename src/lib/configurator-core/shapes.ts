// ============ 图元几何数据 IR（Shape IR）—— 零框架依赖 ============
// 核心思想：图元 = 纯数据描述（不是组件、不是 JSX）。任何框架（React / Vue / 原生）
// 都能把同一份 Shape 数据画成视觉一致的 SVG：
//   - React 适配层：data → JSX 映射器（components/configurator/shape-icon.tsx）
//   - Vue / 原生：  data → DOM 渲染器（本包 shape-dom.ts，createElementNS）
// 颜色 token：'{stroke}' / '{fill}'（支持模板如 '{stroke}55' 半透明后缀），
// 渲染期由 paint 解析为图元实例当前的描边/填充色 —— 「描边/填充跟随画布图元属性」
// 的语义由该机制实现，数据本身不含具体颜色。

/** 渲染期颜色解析入参：图元实例的描边/填充色 */
export interface ShapePaint {
  stroke: string
  fill: string
}

/** 各形状通用绘制属性（全部可选；未指定的属性由渲染器按语义兜底） */
export interface ShapeCommon {
  /** 描边色：具体颜色 / '{stroke}' token / 'none' / 'transparent' */
  stroke?: string
  /** 填充色：具体颜色 / '{fill}' token / '{stroke}'（如同色实心）/ 'none' */
  fill?: string
  strokeWidth?: number
  /** stroke-dasharray（如 '5 3'） */
  dash?: string
  cap?: 'butt' | 'round' | 'square'
  join?: 'miter' | 'round' | 'bevel'
  opacity?: number
}

/**
 * 形状中间表示（与 SVG 标签一一对应，但语言中立、可 JSON 序列化）。
 * 约束：符号在自身设计空间 (0,0)-(sw,sh) 内绘制；非缩放描边由渲染器统一处理。
 */
export type Shape =
  | ({ kind: 'path'; d: string } & ShapeCommon)
  | ({ kind: 'circle'; cx: number; cy: number; r: number } & ShapeCommon)
  | ({ kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number } & ShapeCommon)
  | ({ kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number } & ShapeCommon)
  | ({ kind: 'line'; x1: number; y1: number; x2: number; y2: number } & ShapeCommon)
  | ({ kind: 'polyline'; pts: number[][] } & ShapeCommon)
  | ({ kind: 'polygon'; pts: number[][] } & ShapeCommon)
  | ({
      kind: 'text'
      x: number
      y: number
      text: string
      size?: number
      weight?: number | string
      anchor?: 'start' | 'middle' | 'end'
      /** dominant-baseline（与 React SVG 属性联合类型对齐） */
      baseline?: 'auto' | 'middle' | 'central' | 'hanging' | 'mathematical' | 'alphabetic'
      family?: string
    } & ShapeCommon)
  | ({ kind: 'group'; children: Shape[] } & ShapeCommon)

/** 颜色 token 解析：'{stroke}' / '{fill}' 模板 → 实例色；普通值原样返回（undefined 透传） */
export function resolvePaint(v: string | undefined, paint: ShapePaint): string | undefined {
  if (!v) return v
  if (!v.includes('{')) return v
  return v.replaceAll('{stroke}', paint.stroke).replaceAll('{fill}', paint.fill)
}

/** 默认实例色（工具态幻影/缩略图等未指定 paint 时的兜底） */
export const DEFAULT_PAINT: ShapePaint = { stroke: '#44403c', fill: '#fff' }
