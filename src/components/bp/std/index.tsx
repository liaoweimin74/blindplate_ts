'use client'
// ============ PID 内建图元库聚合（Task 61 全量重建；Task 116 绘制数据化） ============
// 五大分类 × 子分类两级体系（用户指定分类框架，共 126 符号）：
//   equipment 设备(40) · piping 管道与管件(26) · valve 阀门(28) · instrument 仪表与控制(17) · electric 电气与安全(15)
// 参考：EN ISO 10628 / ISA-5.1 / HG/T 20519 / GB/T 4728。旧 pid-symbols.tsx 单文件库已废弃删除。
//
// 【框架无关绘制】运行时图形来自 Shape IR 数据包（lib/configurator-packs/std-shapes.ts，
// 由 scripts/convert-std-symbols.ts 从本库 TSX 设计源生成）：
//   - React 侧（本文件）：data → JSX 映射器（configurator/shape-icon）
//   - Vue / 原生侧：同一份数据经 core shape-dom（createElementNS）渲染
//   TSX render 保留为图元「设计源码」——改形改色在 std/*.tsx 改后重跑脚本再生成。
import type { StdMajor, StdSymbol } from './types'
import { EQUIP_SYMBOLS } from './equipment'
import { PIPING_SYMBOLS } from './piping'
import { VALVE_SYMBOLS } from './valves'
import { INSTRUMENT_SYMBOLS } from './instruments'
import { ELECTRIC_SYMBOLS } from './electric'
import { ShapeContent, ShapeSvg } from '@/components/configurator/shape-icon'
import { STD_SHAPE_DATA } from '@/lib/configurator-packs/std-shapes'

export * from './types'

export const STD_SYMBOLS: StdSymbol[] = [
  ...EQUIP_SYMBOLS,
  ...PIPING_SYMBOLS,
  ...VALVE_SYMBOLS,
  ...INSTRUMENT_SYMBOLS,
  ...ELECTRIC_SYMBOLS,
]

export const STD_SYMBOL_MAP: Record<string, StdSymbol> = Object.fromEntries(STD_SYMBOLS.map((s) => [s.id, s]))

/** 缩放描边恒定（vector-effect 不继承，用 CSS 类统一作用；text 不受影响）+ 图元库分类展开动画。
 *  注：Shape 映射器已在每个元素上设置 vector-effect，本样式作为容器级兜底保留。 */
export function StdSymbolStyle() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html:
          '.pid-std :is(path,line,polyline,polygon,circle,ellipse,rect){vector-effect:non-scaling-stroke}' +
          '@keyframes libExpand{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}' +
          '.lib-expand{animation:libExpand .18s ease-out}',
      }}
    />
  )
}

/** 画布渲染：设计空间 → 实例包围盒缩放（数据驱动）；未知 stdId 兜底虚线矩形（防数据异常不可见） */
export function StdSymbolShape({ id, x, y, w, h, stroke, fill }: {
  id?: string; x: number; y: number; w: number; h: number; stroke: string; fill: string
}) {
  const data = id ? STD_SHAPE_DATA[id] : undefined
  if (!data) {
    return (
      <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke={stroke} strokeWidth={1.4} strokeDasharray="6 4" />
    )
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${w / data.sw} ${h / data.sh})`} className="pid-std">
      <ShapeContent shapes={data.shapes} stroke={stroke} fill={fill} />
    </g>
  )
}

/** 缩略图（宫格/悬停卡复用）：viewBox=设计空间（数据驱动） */
export function StdSymbolThumb({ id, className, stroke = '#57534e' }: {
  id: string; className?: string; stroke?: string
}) {
  const data = STD_SHAPE_DATA[id]
  if (!data) return null
  return <ShapeSvg shapes={data.shapes} vw={data.sw} vh={data.sh} className={className} stroke={stroke} />
}
