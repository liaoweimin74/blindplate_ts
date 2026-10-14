'use client'
// ============ BPMS 业务注册表适配层：PID 图元 → 组态引擎 SymbolRegistry ============
// 职责（业务与引擎的唯一粘合点之一）：
//   1. 注入符号内容边界解析器（std 符号 bbox 表 → 引擎 setInsetResolver）
//   2. 三套注册表构建：std 五大类工艺图元 / 基础图形 / 自定义图元（动态）
//      ——「图元分类和图形不一样」的扩展点：BPMS 工艺符号在此注册，其他系统注册自己的符号
//   3. PID 图元类型查找表（typeLabel / 默认尺寸 / 缩放下限，含旧 equip 兼容占位）
//   4. 缩略图渲染器（palette 宫格）：std 查表 / 基础图形微缩 / 自定义图元 parts 递归

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Circle, Database, Factory, Fan, FlaskConical, Hourglass, Minus, Shapes, Square, Thermometer, Triangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setInsetResolver, type SymbolMeta, type SymbolRegistry } from '@/lib/configurator-core'
import { contentInsetBox } from '@/lib/bp-pid-layout'
import { StdSymbolShape, StdSymbolThumb, STD_SYMBOLS, STD_MAJOR_ORDER, STD_MAJOR_LABEL, STD_SUBGROUPS } from '@/components/bp/std'

// 1. 内容边界解析器注入：std 符号按 bbox 表内收（锚点贴符号真实内容，不悬空）
setInsetResolver((n) => contentInsetBox(n))

// ============ 2. PID 图元类型查找表（含旧 equip 兼容占位，侧栏不展示仅查询） ============

export interface PidTypeLibItem {
  type: string
  label: string
  icon: LucideIcon | React.ComponentType<{ className?: string }>
  w: number
  h: number
  minW: number
  minH: number
  group: 'equip' | 'basic' | 'symbol' | 'custom'
}

/** 椭圆图标（lucide 无专用 Ellipse，内联 SVG 保证视觉一致） */
function EllipseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className}>
      <ellipse cx="12" cy="12" rx="9.5" ry="6.5" />
    </svg>
  )
}

export const PID_TYPE_LIBRARY: PidTypeLibItem[] = [
  { type: 'exchanger', label: '换热器', icon: Thermometer, w: 120, h: 70, minW: 44, minH: 32, group: 'equip' },
  { type: 'reactor',   label: '反应器', icon: FlaskConical, w: 90,  h: 100, minW: 44, minH: 32, group: 'equip' },
  { type: 'column',    label: '精馏塔', icon: Factory,      w: 72,  h: 170, minW: 44, minH: 32, group: 'equip' },
  { type: 'pump',      label: '泵',     icon: Fan,          w: 72,  h: 60,  minW: 44, minH: 32, group: 'equip' },
  { type: 'tank',      label: '储罐',   icon: Database,     w: 110, h: 90,  minW: 44, minH: 32, group: 'equip' },
  { type: 'valve',     label: '阀门',   icon: Hourglass,    w: 64,  h: 32,  minW: 36, minH: 24, group: 'equip' },
  { type: 'rect',      label: '矩形',   icon: Square,       w: 120, h: 70,  minW: 16, minH: 16, group: 'basic' },
  { type: 'circle',    label: '圆形',   icon: Circle,       w: 64,  h: 64,  minW: 14, minH: 14, group: 'basic' },
  { type: 'ellipse',   label: '椭圆',   icon: EllipseIcon,  w: 110, h: 64,  minW: 18, minH: 12, group: 'basic' },
  { type: 'line',      label: '直线',   icon: Minus,        w: 140, h: 4,   minW: 12, minH: 2,  group: 'basic' },
  { type: 'triangle',  label: '三角形', icon: Triangle,     w: 80,  h: 70,  minW: 16, minH: 16, group: 'basic' },
  { type: 'symbol',    label: '自定义图元', icon: Shapes,   w: 90, h: 90, minW: 24, minH: 24, group: 'custom' },
  { type: 'std',       label: '标准图例',   icon: Shapes,   w: 64, h: 48, minW: 24, minH: 20, group: 'symbol' },
]

const PID_TYPE_MAP = new Map(PID_TYPE_LIBRARY.map((i) => [i.type, i]))

/** 图元类型中文标签（属性面板类型徽章 / 提示） */
export function pidTypeLabel(type: string): string {
  return PID_TYPE_MAP.get(type)?.label ?? type
}

/** 图元类型缩放下限与默认尺寸（属性面板/放置/更换图元共用） */
export function pidTypeLibOf(type: string): PidTypeLibItem {
  return PID_TYPE_MAP.get(type) ?? PID_TYPE_LIBRARY[0]
}

// ============ 3. 三套注册表 ============

/** std 五大类工艺图元注册表（分类树来自 std/ 标准符号库） */
export function buildStdRegistry(): SymbolRegistry {
  return {
    groups: STD_MAJOR_ORDER.map((mj) => ({ id: mj, label: STD_MAJOR_LABEL[mj] })),
    subgroups: STD_MAJOR_ORDER.flatMap((mj) => STD_SUBGROUPS[mj].map((s) => ({ id: s.id, label: s.label, group: mj }))),
    symbols: STD_SYMBOLS.map<SymbolMeta>((sym) => ({
      id: sym.id,
      label: sym.label,
      group: sym.major,
      sub: sym.sub,
      defaultW: sym.sw,
      defaultH: sym.sh,
      desc: sym.desc,
      standard: sym.standard,
    })),
  }
}

/** 基础图形注册表（矩形/圆形/椭圆/直线/三角形） */
export function buildBasicRegistry(): SymbolRegistry {
  return {
    groups: [{ id: 'basic', label: '基础图形' }],
    subgroups: [],
    symbols: PID_TYPE_LIBRARY.filter((i) => i.group === 'basic').map<SymbolMeta>((i) => ({
      id: i.type, label: i.label, group: 'basic',
      defaultW: i.w, defaultH: i.h, minW: i.minW, minH: i.minH,
    })),
  }
}

/** 自定义图元库行（GET /api/pid-symbols 返回，parts 已解析） */
export interface CustomSymbolRow {
  id: number
  name: string
  basedOn?: string | null
  designW: number
  designH: number
  parts: unknown[]
}

/** 自定义图元注册表（动态：图元库保存/删除后重建） */
export function buildCustomRegistry(rows: CustomSymbolRow[]): SymbolRegistry {
  return {
    groups: [{ id: 'custom', label: '自定义图元' }],
    subgroups: [],
    symbols: rows.map<SymbolMeta>((r) => {
      const dw = r.designW > 0 ? r.designW : 100
      const dh = r.designH > 0 ? r.designH : 100
      const k = 90 / Math.max(dw, dh)
      return {
        id: `custom-${r.id}`,
        label: r.name,
        group: 'custom',
        defaultW: Math.max(24, Math.round(dw * k)),
        defaultH: Math.max(24, Math.round(dh * k)),
        minW: 24, minH: 24,
        desc: `自定义图元（${r.parts.length} 个部件）`,
      }
    }),
  }
}

/** 自定义图元符号 id → 库行 id（`custom-<rowId>` 约定） */
export function customRowIdOf(symbolId: string): number | null {
  const m = /^custom-(\d+)$/.exec(symbolId)
  return m ? Number(m[1]) : null
}

// ============ 4. 缩略图渲染器（palette 宫格） ============

/** 自定义图元部件（图元编辑器设计空间坐标；type 复用基础图形/std） */
export interface ThumbPart {
  id: string
  type: string
  stdId?: string
  x: number
  y: number
  w: number
  h: number
  label?: string
  fill?: string
  stroke?: string
  flip?: boolean
}

/** 基础图形/自定义部件微缩渲染（0,0,w,h 包围盒；与画布 ShapeBody 基础分支同构） */
function ThumbPartShape({ p }: { p: ThumbPart }) {
  const { x, y, w, h } = p
  const stroke = p.stroke || '#44403c'
  const fill = p.fill || '#fff'
  switch (p.type) {
    case 'rect':
      return <rect x={x} y={y} width={w} height={h} rx={2} fill={fill} stroke={stroke} strokeWidth={1.6} />
    case 'circle':
    case 'ellipse':
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={1.6} />
    case 'line': {
      const ly1 = p.flip ? y + h : y
      const ly2 = p.flip ? y : y + h
      return <line x1={x} y1={ly1} x2={x + w} y2={ly2} stroke={stroke} strokeWidth={1.6} strokeLinecap="round" />
    }
    case 'triangle':
      return <polygon points={`${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`} fill={fill} stroke={stroke} strokeWidth={1.6} />
    case 'std':
      return p.stdId ? <StdSymbolShape id={p.stdId} x={x} y={y} w={w} h={h} stroke={stroke} fill={fill} /> : null
    default:
      return null
  }
}

/** 基础图形缩略图（等比缩放进给定盒） */
export function BasicShapeThumb({ type, className }: { type: string; className?: string }) {
  const lib = pidTypeLibOf(type)
  const w = Math.max(1, lib.w)
  const h = Math.max(1, lib.h)
  return (
    <svg viewBox={`-2 -2 ${w + 4} ${h + 4}`} className={cn('shrink-0', className)} aria-hidden>
      <ThumbPartShape p={{ id: type, type, x: 0, y: 0, w, h, stroke: '#57534e', fill: '#fff' }} />
    </svg>
  )
}

/** 自定义图元缩略图（parts 按包围盒自适应 viewBox，stdId 部件查表渲染） */
export function CustomPartsThumb({ parts, className }: { parts: ThumbPart[]; className?: string }) {
  if (parts.length === 0) {
    return <span className={cn('text-[10px] text-stone-300', className)}>空图元</span>
  }
  const minX = Math.min(...parts.map((p) => p.x))
  const minY = Math.min(...parts.map((p) => p.y))
  const maxX = Math.max(...parts.map((p) => p.x + p.w))
  const maxY = Math.max(...parts.map((p) => p.y + p.h))
  const pad = 4
  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${Math.max(1, maxX - minX + pad * 2)} ${Math.max(1, maxY - minY + pad * 2)}`}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      {parts.map((p) => <ThumbPartShape key={p.id} p={p} />)}
    </svg>
  )
}

/** 注册表页签缩略图分派：std → 查表 / basic → 微缩 / custom → parts 递归（宿主传入 customRows） */
export function pidThumbRenderer(customRows?: CustomSymbolRow[]): (sym: SymbolMeta) => ReactNode {
  const rowMap = new Map((customRows ?? []).map((r) => [`custom-${r.id}`, r]))
  return (sym) => {
    if (rowMap.has(sym.id)) {
      const row = rowMap.get(sym.id)!
      return <CustomPartsThumb parts={row.parts as ThumbPart[]} className="h-12 w-full" />
    }
    if (sym.group === 'basic') return <BasicShapeThumb type={sym.id} className="h-12 w-full" />
    return <StdSymbolThumb id={sym.id} className="h-12 w-full" />
  }
}
