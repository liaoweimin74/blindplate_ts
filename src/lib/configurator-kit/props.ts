// ============ 二级·属性面板 headless（schema 驱动，框架无关） ============
// 三级抽象定位：属性面板 = schema（PropFieldDef）+ 值仓 + 类型转换/校验管道。
// 本模块只做可见性(showFor)、数值收敛(coerce)、范围校验(validate) ——
// React/Vue 壳按字段类型 map 到各自控件（input/select/color picker）即可。

import type { PropFieldDef } from '@/lib/configurator-core'

/** showFor 过滤：声明了 showFor 的字段仅对列表内符号显示 */
export function visiblePropFields(fields: PropFieldDef[], symbolId: string): PropFieldDef[] {
  return fields.filter((f) => !f.showFor || f.showFor.includes(symbolId))
}

export interface CoerceResult {
  ok: boolean
  value?: string | number | boolean
  error?: string
}

/** 原始输入 → 收敛后的字段值（type 感知；数字字段带 min/max/step 边界收敛） */
export function coercePropValue(field: PropFieldDef, raw: unknown): CoerceResult {
  switch (field.type) {
    case 'number': {
      if (raw === '' || raw === null || raw === undefined) return { ok: true, value: undefined }
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (Number.isNaN(n)) return { ok: false, error: `${field.label}：请输入数字` }
      if (field.min !== undefined && n < field.min)
        return { ok: false, error: `${field.label}：不可小于 ${field.min}` }
      if (field.max !== undefined && n > field.max)
        return { ok: false, error: `${field.label}：不可大于 ${field.max}` }
      return { ok: true, value: n }
    }
    case 'boolean':
      return { ok: true, value: raw === true || raw === 'true' }
    case 'select': {
      const v = String(raw ?? '')
      if (field.options && v !== '' && !field.options.some((o) => o.value === v))
        return { ok: false, error: `${field.label}：无效选项` }
      return { ok: true, value: v }
    }
    default:
      return { ok: true, value: raw === undefined || raw === null ? '' : String(raw) }
  }
}

export interface PropIssue {
  key: string
  message: string
}

/** 全量校验（保存/提交前调用；返回空数组 = 通过） */
export function validatePropValues(
  fields: PropFieldDef[],
  values: Record<string, unknown>,
): PropIssue[] {
  const issues: PropIssue[] = []
  for (const f of fields) {
    const r = coercePropValue(f, values[f.key])
    if (!r.ok && r.error) issues.push({ key: f.key, message: r.error })
  }
  return issues
}

/** 属性面板分区模型：基础字段（名称/位置/尺寸/颜色）由机制层固定，
 *  扩展字段来自 registry schema —— 渲染层按 section 分组渲染 */
export interface PropSection {
  id: 'base' | 'extend'
  label: string
  fields: PropFieldDef[]
}

export function basePropFields(): PropFieldDef[] {
  return [
    { key: 'label', label: '名称', type: 'text', placeholder: '图元名称' },
    { key: 'x', label: 'X', type: 'number', step: 1 },
    { key: 'y', label: 'Y', type: 'number', step: 1 },
    { key: 'w', label: '宽', type: 'number', step: 1, min: 8 },
    { key: 'h', label: '高', type: 'number', step: 1, min: 8 },
    { key: 'fill', label: '填充色', type: 'color' },
    { key: 'stroke', label: '描边色', type: 'color' },
    { key: 'rotation', label: '旋转', type: 'number', step: 90, min: 0, max: 270 },
  ]
}

/** 组装分区：基础 + 扩展（扩展来自组级 + 符号级 schema 合并，由宿主传入） */
export function buildPropSections(extendFields: PropFieldDef[]): PropSection[] {
  const sections: PropSection[] = [{ id: 'base', label: '基础属性', fields: basePropFields() }]
  if (extendFields.length > 0)
    sections.push({ id: 'extend', label: '扩展属性', fields: extendFields })
  return sections
}
