'use client'
// ============ 组态引擎 React 适配层（薄壳） ============
// 核心层（src/lib/configurator-core，零框架）+ 本适配层 = React 侧完整组态组件库。
// Vue 侧按同一事件契约用核心层实现等价薄壳（见 core/index.ts 契约说明）。
//
// React 公共 API：
//   SymbolPalette / PaletteGroup / PaletteCell / PaletteSearch / HoverTip
//     —— 注册表驱动的图元库（多注册表页签由宿主用 shadcn Tabs 组合）
//   NodePropertyPanel —— 几何/样式/schema 驱动的节点属性面板（children = 业务绑定插槽）
//   NumField / ColorSwatches / PropFieldEditor —— 属性面板通用控件
export { SymbolPalette, PaletteGroup, PaletteCell, PaletteSearch, HoverTip, type PaletteTabDef, type PaletteHoverCard } from './symbol-palette'
export { NodePropertyPanel, collectSchemaFields, type NodePropertyPanelProps } from './property-panel'
export { NumField, ColorSwatches, PropFieldEditor } from './fields'
