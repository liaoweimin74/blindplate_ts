// ============ 画布模式（编辑态 / 查看态）—— 交互门禁 ============
// 一级定位：mode 是文档级状态，门禁是纯判定函数；壳层据返回值决定是否绑定
// 指针事件/渲染工具态。查看态保留：平移、缩放、点选（查看属性/高亮定位）。

export type CanvasMode = 'edit' | 'view'

export type CanvasAction =
  | 'select' // 点选/框选（查看态保留：高亮与属性查看）
  | 'pan' // 平移视口
  | 'zoom' // 缩放视口
  | 'dragShape' // 拖动图元
  | 'resizeShape' // 四角缩放
  | 'connect' // 橡皮筋连线/改接
  | 'place' // 从图元库放置新图元
  | 'delete' // 删除
  | 'copy' // 复制
  | 'paste' // 粘贴
  | 'editProps' // 编辑属性
  | 'layout' // 自动布局
  | 'attach' // 建立/解除挂接
  | 'editMeta' // 编辑连线标注/mark

/** 查看态禁止的动作全集（取反即查看态白名单：select / pan / zoom） */
const EDIT_ONLY_ACTIONS: ReadonlySet<CanvasAction> = new Set([
  'dragShape',
  'resizeShape',
  'connect',
  'place',
  'delete',
  'copy',
  'paste',
  'editProps',
  'layout',
  'attach',
  'editMeta',
])

/** 交互门禁：编辑态全放行；查看态仅保留 select / pan / zoom */
export function interactionsAllowed(mode: CanvasMode, action: CanvasAction): boolean {
  if (mode === 'edit') return true
  return !EDIT_ONLY_ACTIONS.has(action)
}
