// ============ configurator-kit：二级「组态领域共性」层 ============
//
// 三级抽象定位（架构纲领，2025 会话定稿）：
//   一级 configurator-core  —— 几何/交互/渲染/历史/视口/剪贴板/挂接（纯机械原语，零业务零框架）
//   二级 configurator-kit   —— 组态领域共性：图元库面板 headless、数据绑定机制、
//                              工具命令注册表、属性 schema 管道（零框架；可跨 PID/电气/暖通复用）
//   三级 业务宿主           —— React 壳 / Vue 壳 + API：归属关系(设备/管线)、附属关系(泵→管线)、
//                              绑定 schema 与编辑器、图纸 CRUD、AI 导入、隔离点标注、主数据
//
// 依赖方向硬约束：kit → core 允许；core → kit 禁止；kit → 三级禁止（三级经注入接入）。
// 换域验收判据：换成电气组态时，core 与 kit 零改动。

export * from './library'
export * from './binding'
export * from './commands'
export * from './props'
