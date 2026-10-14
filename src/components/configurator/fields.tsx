'use client'
// ============ 组态引擎 React 适配层 · 属性面板通用控件 ============
// NumField 数值微调 / ColorSwatches 预设色板 / PropFieldEditor schema 字段编辑器。
// 均为业务无关控件：任何注册表驱动的属性面板都可复用。

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { clamp, FILL_PALETTE, STROKE_PALETTE, type PropFieldDef } from '@/lib/configurator-core'

/** 数值微调输入 */
export function NumField({ label, value, min, max, onChange, onBlur }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  onBlur?: () => void
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-stone-500">{label}</Label>
      <Input
        type="number" className="h-8" value={value} min={min} max={max} onBlur={onBlur}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onChange(clamp(Math.round(n), min, max))
        }}
      />
    </div>
  )
}

/** 预设色板（点选设色；透明项用棋盘格底纹表示） */
export function ColorSwatches({ label, palette, value, onChange }: {
  label: string
  palette?: readonly string[]
  value: string
  onChange: (c: string) => void
}) {
  const colors = palette ?? FILL_PALETTE
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px] text-stone-500">{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {colors.map((c) => (
          <button
            key={c} type="button" title={c === 'transparent' ? '透明' : c}
            aria-label={`${label} ${c === 'transparent' ? '透明' : c}`}
            onClick={() => onChange(c)}
            className={cn(
              'h-6 w-6 rounded border border-stone-300 transition-transform hover:scale-110',
              value === c && 'ring-2 ring-teal-500 ring-offset-1',
            )}
            style={{
              background: c === 'transparent'
                ? 'repeating-conic-gradient(#d6d3d1 0% 25%, #ffffff 0% 50%) 50% / 8px 8px'
                : c,
            }}
          />
        ))}
      </div>
    </div>
  )
}

/** 描边色板便捷别名 */
export const StrokeSwatches = (p: Omit<Parameters<typeof ColorSwatches>[0], 'palette'>) => (
  <ColorSwatches {...p} palette={STROKE_PALETTE} />
)

/**
 * schema 字段编辑器：按 PropFieldDef 渲染 text/number/boolean/select/color/textarea。
 * 值读写走节点平铺字段（泛型 N 超集），类型安全由宿主 schema 声明保证。
 */
export function PropFieldEditor<N extends Record<string, unknown>>({ field, node, onPatch }: {
  field: PropFieldDef
  node: N
  onPatch: (patch: Partial<N>) => void
}) {
  const value = node[field.key]
  const label = (
    <Label className="text-[11px] text-stone-500">
      {field.label}
      {field.help && <span className="ml-1 font-normal text-stone-400">（{field.help}）</span>}
    </Label>
  )
  switch (field.type) {
    case 'number':
      return (
        <div className="grid gap-1">
          {label}
          <Input
            type="number" className="h-8" placeholder={field.placeholder}
            value={typeof value === 'number' ? value : ''}
            min={field.min} max={field.max} step={field.step}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) {
                onPatch({ [field.key]: clamp(Math.round(n), field.min ?? -1e9, field.max ?? 1e9) } as Partial<N>)
              }
            }}
          />
        </div>
      )
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-2">
          {label}
          <Switch
            checked={value === true}
            onCheckedChange={(v) => onPatch({ [field.key]: v } as Partial<N>)}
            aria-label={field.label}
          />
        </div>
      )
    case 'select':
      return (
        <div className="grid gap-1">
          {label}
          <select
            className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-xs text-stone-700 focus:border-emerald-500 focus:outline-none"
            value={value == null ? '' : String(value)}
            onChange={(e) => {
              const raw = e.target.value
              const opt = field.options?.find((o) => String(o.value) === raw)
              const out = opt ? (typeof opt.value === 'number' ? Number(raw) : raw) : raw
              onPatch({ [field.key]: raw === '' ? undefined : out } as Partial<N>)
            }}
            aria-label={field.label}
          >
            <option value="">{field.placeholder ?? '未设置'}</option>
            {(field.options ?? []).map((o) => (
              <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
            ))}
          </select>
        </div>
      )
    case 'color':
      return <ColorSwatches label={field.label} value={typeof value === 'string' ? value : '#ffffff'} onChange={(c) => onPatch({ [field.key]: c } as Partial<N>)} />
    case 'textarea':
      return (
        <div className="grid gap-1">
          {label}
          <Textarea
            className="min-h-16 text-xs" placeholder={field.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onPatch({ [field.key]: e.target.value } as Partial<N>)}
          />
        </div>
      )
    default:
      return (
        <div className="grid gap-1">
          {label}
          <Input
            className="h-8" placeholder={field.placeholder}
            value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
            onChange={(e) => onPatch({ [field.key]: e.target.value } as Partial<N>)}
          />
        </div>
      )
  }
}
