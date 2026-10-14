// ============ 组态引擎核心类型（零框架依赖 · Vue/React 共用） ============
// 本包是「与具体业务无关」的通用组态能力：文档模型 / 几何 / 自动布局 / 图元注册表 / 属性 schema / 撤销栈。
// 业务系统（React / Vue / 原生）通过三个扩展点接入：
//   ① 图元注册表 SymbolRegistry：分类树与符号元数据（图形渲染由各框架适配层实现）
//   ② 属性 schema PropFieldDef：每个符号声明自己的扩展属性，属性面板按 schema 自动渲染
//   ③ 业务绑定字段：节点/连线/标注上的业务字段（泛型 N/E/M 超集）引擎只透传不解释，
//      绑定 UI 走适配层插槽（React children / Vue slot），交互意图走事件回调
// JSON 序列化兼容：DiagramDoc 的字段命名与既有 PID content 完全一致（shapes/connections/marks）。

/** 锚点方位（逻辑锚点名，挂接旋转后物理朝向用 physAnchor 换算） */
export type Anchor = 'top' | 'right' | 'bottom' | 'left'

/** 连线流向 */
export type EdgeDirection = 'forward' | 'reverse' | 'none'

/** 节点（图元实例）几何约束：宿主节点类型为此结构超集即可（平铺扩展字段随意加） */
export interface NodeGeom {
  id: string
  /** 符号 ID（注册表 symbolId；业务语义 = 图元类型） */
  type: string
  x: number
  y: number
  w: number
  h: number
  label: string
  fill?: string
  stroke?: string
  /** 挂接旋转角（度，90° 倍数）：锚点/命中区随中心旋转 */
  rotation?: number
  /** 直线专用：false = 包围盒 \ 对角线，true = / 对角线 */
  flip?: boolean
}

/** 连线（边）几何约束 */
export interface EdgeGeom {
  id: string
  fromShape: string
  fromAnchor: Anchor
  toShape: string
  toAnchor: Anchor
  /** 自由锚点：沿 fromAnchor 边参数（0=边起点 1=边终点；缺省 0.5=四向中点） */
  fromT?: number
  toT?: number
  direction?: EdgeDirection
  /** 边标签沿线位置参数（0..1 归一化弧长，缺省 0.5 中点） */
  labelT?: number
  /** 中段布线手动覆盖：H-H 路由 midX / V-V 路由 midY */
  midOverride?: number
}

/** 标注（画布自由点对象）几何约束 */
export interface MarkGeom {
  id: string
  x: number
  y: number
}

/** 组态文档：节点 / 连线 / 标注（JSON 直接持久化） */
export interface DiagramDoc<
  N extends NodeGeom = NodeGeom,
  E extends EdgeGeom = EdgeGeom,
  M extends MarkGeom = MarkGeom,
> {
  shapes: N[]
  connections: E[]
  marks: M[]
}

/** 画布选中对象（shape/conn/mark 三类） */
export type Selection = { kind: 'shape' | 'conn' | 'mark'; id: string }

/** 视口（viewBox 语义） */
export interface Viewport {
  x: number
  y: number
  w: number
  h: number
}

/** 路由点 */
export interface RoutePoint {
  x: number
  y: number
}

/** 连线端点描述（routeConnection 入参） */
export interface ConnEndpoint {
  x: number
  y: number
  anchor: Anchor
}

/** 包围盒 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

// ============ 属性 schema（扩展属性声明式驱动） ============

export type PropFieldType = 'text' | 'number' | 'boolean' | 'select' | 'color' | 'textarea'

/** 属性面板字段定义：key 取节点平铺字段名；宿主业务字段（如额定电压）按此声明即可自动渲染 */
export interface PropFieldDef {
  key: string
  label: string
  type: PropFieldType
  /** type='select' 选项 */
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  placeholder?: string
  help?: string
  /** 仅这些符号 ID 显示（缺省全部符号显示） */
  showFor?: string[]
}

// ============ 图元注册表（分类与图形可插拔） ============

/** 大分类定义 */
export interface SymbolGroupDef {
  id: string
  label: string
}

/** 子分类定义（隶属大分类） */
export interface SymbolSubgroupDef {
  id: string
  label: string
  group: string
}

/** 符号元数据（图形渲染由框架适配层按 id 提供_RENDER bridge） */
export interface SymbolMeta {
  /** 符号 ID（节点 type 字段取此值） */
  id: string
  label: string
  /** 大分类 id */
  group: string
  /** 子分类 id（可选） */
  sub?: string
  /** 放置时默认尺寸 */
  defaultW: number
  defaultH: number
  /** 属性面板尺寸微调下限（缺省 8） */
  minW?: number
  minH?: number
  /** 悬停说明 */
  desc?: string
  /** 标准依据（如 HG/T 20519） */
  standard?: string
  /** 搜索关键字（额外补充词） */
  keywords?: string[]
  /** 符号级扩展属性 schema（叠加在组级 schema 之上） */
  props?: PropFieldDef[]
  /** 可挂接：拖到连线上自动旋转对齐并断开粘合（语义由宿主决定） */
  mountable?: boolean
}

/** 图元注册表：一个业务域一套（BPMS 工艺图元 / 基础图形 / 自定义图元各一， palette 多页签天然支持多注册表） */
export interface SymbolRegistry {
  groups: SymbolGroupDef[]
  subgroups: SymbolSubgroupDef[]
  symbols: SymbolMeta[]
}

/** 组级属性 schema（注册表可按大分类声明公共字段） */
export interface GroupPropsDef {
  group: string
  props: PropFieldDef[]
}
