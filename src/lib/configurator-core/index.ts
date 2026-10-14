// ============ 组态引擎核心包（configurator-core） ============
//
// 零框架依赖的通用组态能力，供 React / Vue / 原生等多框架复用（可独立发布为 npm 包）。
//
// ── 分层封装契约 ─────────────────────────────────────────────
//   ① core（本包）：文档模型 / 几何 / 自动布局 / 注册表 / 属性 schema / 撤销栈 —— 纯 TS
//   ② 框架适配层（如 src/components/configurator）：渲染桥（符号缩略图与画布渲染）、
//      图元库面板、属性面板、事件契约组件化 —— 每个框架一层薄壳
//   ③ 业务宿主：注入注册表（图元分类与图形）、属性 schema（扩展属性）、绑定插槽（业务数据 UI）
//
// ── Vue 接入方式（与 React 适配层等价的事件契约） ─────────────
//   - 复用本包全部纯函数与类型（geometry / autoLayout / buildRegistry / searchSymbols /
//     createHistory / 常量），用 Vue 组合式 API 实现画布与面板（SVG 渲染 + 指针事件等价翻译）
//   - 事件契约：onChange(doc) / onSelectionChange(sel) / onNodeDragSettle(node) /
//     onMarkSettle(mark) / onPlaceNode(sym, at) / onReplaceSymbol(ids, sym)
//
// ── 业务接入三扩展点 ─────────────────────────────────────────
//   ① buildRegistry(...)：图元分类树 + 符号元数据（分类与图形可完全不同）
//   ② PropFieldDef schema：每个符号声明扩展属性，面板自动渲染（属性可完全不同）
//   ③ 节点/连线/标注上的业务字段（泛型超集）引擎只透传——绑定 UI 走框架层插槽，
//      交互意图（拖拽落定/标注落定/换符号）走回调由业务联动主数据
export * from './types'
export * from './constants'
export * from './geometry'
export * from './auto-layout'
export * from './registry'
export * from './history'
