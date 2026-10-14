'use client'
// ============ 组态引擎 React 适配层 · 通用节点属性面板 ============
// NodePropertyPanel：注册表/几何驱动的节点属性面板（名称/类型徽章/XYWH 微调/直线翻转/填充描边色板
// + 符号与组级 schema 扩展属性自动渲染），业务绑定 UI 通过 children 插槽注入（引擎不解释业务字段）。
// styleLocked：宿主对「图形本体在别处维护」的实例（如自定义图元）锁定颜色编辑。

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoveDiagonal } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  CANVAS_H, CANVAS_W, FILL_PALETTE, STROKE_PALETTE,
  groupLabelOf, subgroupLabelOf, symbolMapOf, symbolMinSize,
  type NodeGeom, type PropFieldDef, type SymbolRegistry,
} from '@/lib/configurator-core'
import { ColorSwatches, NumField, PropFieldEditor } from './fields'

export interface NodePropertyPanelProps<N extends NodeGeom> {
  node: N
  /** 类型中文徽章文案（宿主或注册表提供） */
  typeLabel: string
  /** 提供注册表时：自动渲染符号/组级 schema 扩展属性 */
  registry?: SymbolRegistry
  /** 提供时：类型徽章附加分类路径（大分类 · 子分类） */
  showGroupPath?: boolean
  onPatch: (patch: Partial<N>) => void
  /** 尺寸微调下限（缺省注册表符号 minW/minH，再缺省 8） */
  minW?: number
  minH?: number
  /** 图形本体在别处维护（自定义图元实例等）：锁定名称外的图形编辑并给出说明 */
  styleLocked?: boolean
  lockHint?: string
  /** 业务绑定插槽（挂接状态卡 / 绑定设备 / 主数据编辑等） */
  children?: ReactNode
  /** XY 微调范围倍率（缺省画布尺寸 ×100） */
  rangeMul?: number
}

export function NodePropertyPanel<N extends NodeGeom>(props: NodePropertyPanelProps<N>) {
  const { node, typeLabel, registry, showGroupPath, onPatch, minW, minH, styleLocked, lockHint, children, rangeMul = 100 } = props
  const sym = registry ? symbolMapOf(registry).get(node.type) : undefined
  const min = symbolMinSize(sym)
  const fields: PropFieldDef[] = registry && sym ? collectSchemaFields(registry, node.type) : []
  const groupPath = (() => {
    if (!registry || !showGroupPath || !sym) return null
    const g = groupLabelOf(registry).get(sym.group)
    const s = sym.sub ? subgroupLabelOf(registry).get(sym.sub) : undefined
    return [g, s].filter(Boolean).join(' · ')
  })()

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-stone-700">图元属性</div>
      <div className="grid gap-1.5">
        <Label className="text-[11px] text-stone-500">名称</Label>
        <Input className="h-8" value={node.label} onChange={(e) => onPatch({ label: e.target.value } as Partial<N>)} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-stone-500">类型</span>
        <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-600" title={groupPath ?? typeLabel}>
          {typeLabel}
        </Badge>
      </div>

      {children}

      <div className="grid grid-cols-2 gap-2">
        <NumField label="X" value={node.x} min={-CANVAS_W * rangeMul} max={CANVAS_W * rangeMul} onChange={(v) => onPatch({ x: v } as Partial<N>)} />
        <NumField label="Y" value={node.y} min={-CANVAS_H * rangeMul} max={CANVAS_H * rangeMul} onChange={(v) => onPatch({ y: v } as Partial<N>)} />
        <NumField label="宽 W" value={node.w} min={minW ?? min.minW} max={CANVAS_W * rangeMul} onChange={(v) => onPatch({ w: v } as Partial<N>)} />
        <NumField label="高 H" value={node.h} min={minH ?? min.minH} max={CANVAS_H * rangeMul} onChange={(v) => onPatch({ h: v } as Partial<N>)} />
      </div>

      {node.type === 'line' && (
        <Button
          variant="outline"
          className="h-8 w-full border-stone-200 text-stone-600 hover:bg-stone-50"
          title="镜像翻转直线方向（/ ↔ \）"
          onClick={() => onPatch({ flip: !node.flip } as Partial<N>)}
        >
          <MoveDiagonal className="h-3.5 w-3.5" /> 交换对角方向
        </Button>
      )}

      {styleLocked ? (
        <div className="rounded-md bg-violet-50/70 px-2.5 py-2 text-[11px] leading-relaxed text-violet-700">
          {lockHint ?? '该图元实例的构成与颜色在图元编辑器中维护，实例随组态图独立保存'}
        </div>
      ) : (
        <>
          <ColorSwatches label="填充色" palette={FILL_PALETTE} value={node.fill ?? '#ffffff'} onChange={(c) => onPatch({ fill: c } as Partial<N>)} />
          <ColorSwatches label="描边色" palette={STROKE_PALETTE} value={node.stroke ?? '#44403c'} onChange={(c) => onPatch({ stroke: c } as Partial<N>)} />
        </>
      )}

      {fields.length > 0 && (
        <div className="space-y-2 border-t border-dashed border-stone-200 pt-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">扩展属性</div>
          {fields.map((f) => (
            <PropFieldEditor key={f.key} field={f} node={node as unknown as Record<string, unknown>} onPatch={onPatch as (patch: Record<string, unknown>) => void} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 汇集符号有效 schema：注册表内嵌组级 props（buildRegistry 时由宿主合并）+ 符号级 props，按 showFor 过滤 */
export function collectSchemaFields(registry: SymbolRegistry, symbolId: string): PropFieldDef[] {
  const sym = symbolMapOf(registry).get(symbolId)
  if (!sym) return []
  const all = [...(sym.props ?? [])]
  return all.filter((f) => !f.showFor || f.showFor.includes(symbolId))
}
