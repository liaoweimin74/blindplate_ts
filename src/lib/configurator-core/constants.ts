// ============ 组态引擎常量（画布 / 颜色 / 吸附阈值 / 色板） ============
import type { Anchor } from './types'

/** 画布主图区尺寸（世界坐标原点区域；无限画布可平移出界） */
export const CANVAS_W = 1200
export const CANVAS_H = 700

// 语义色（项目铁律：teal/emerald 主色、警示 amber/rose，严禁 indigo/blue）
export const STROKE = '#44403c' // stone-700 图元描边
export const LINE = '#78716c'   // stone-500 连线
export const TEAL = '#0d9488'   // 选中框/锚点
export const ROSE = '#e11d48'   // 标注/删除高亮
export const GRID_S = '#e7e5e4' // stone-200 小格
export const GRID_L = '#d6d3d1' // stone-300 粗格

/** 标注「落在连线上」判定阈值：标注中心到连线折线最短距离 ≤ 该值（SVG 单位） */
export const MARK_EDGE_SNAP_DIST = 36

/** 边标签位置参数上下限：距连线两端各留 6%（不盖住锚点与图元） */
export const LABEL_T_MIN = 0.06
export const LABEL_T_MAX = 0.94

/** 连线端点拖拽改接：指针距图元锚点 ≤ 该值（SVG 单位）时吸附为目标 */
export const CONN_END_SNAP_DIST = 48

/** 预设色板（填充/描边） */
export const FILL_PALETTE = ['#ffffff', 'transparent', '#d1fae5', '#ccfbf1', '#fef3c7', '#fecdd3', '#ede9fe', '#f5f5f4'] as const
export const STROKE_PALETTE = ['#44403c', '#78716c', '#059669', '#0d9488', '#d97706', '#e11d48', '#7c3aed', '#57534e'] as const

/** 锚点方位中文标签 */
export const ANCHOR_LABEL: Record<Anchor, string> = { top: '顶部', right: '右侧', bottom: '底部', left: '左侧' }

/** 俯瞰图世界包围盒：画布区域 ∪ 当前视口 再加留白（无限画布下视口可能远离画布原点） */
export function minimapBoundsOf(v: { x: number; y: number; w: number; h: number }) {
  const x = Math.min(0, v.x)
  const y = Math.min(0, v.y)
  return {
    x,
    y,
    w: Math.max(CANVAS_W, v.x + v.w) - x,
    h: Math.max(CANVAS_H, v.y + v.h) - y,
  }
}
