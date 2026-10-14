// ============ 视口数学（viewBox 方案，框架无关） ============
//
// SVG viewBox 取景框的缩放/平移/导航纯数学——「同一套 viewBox 数学」的唯一下沉点。
// 此前 pid-config（编辑器主画布）与 pid-locate（移动端定位放大图）各持一份逐行相同的
// zoomAt / onWheel / minimapNavTo 实现，本模块将四件套收敛为纯函数：
//   ① zoomViewport        锚点缩放数学（w clamp，h 比例策略留给调用方）
//   ② wheelZoomIntent     wheel 事件 → 缩放因子 + 世界锚点（鼠标位置为中心）
//   ③ minimapNavigateWorld 俯瞰图点击/拖拽 → 世界坐标（letterbox 逆换算）
//   ④ panByScreen         屏幕位移 → viewBox 平移
//
// 契约：
//   - 所有函数均为纯函数（无 DOM / 无框架状态），宿主自持视口状态（React useState / Vue ref 等）
//   - h 不在本模块 clamp/推导：pid-config 用容器实测动态比、pid-locate 用固定画布比，
//     调用方在 applyVb 内按各自策略回填 h（本模块只保证 x/y/w 数学正确）
//   - 俯瞰图世界包围盒用 constants.minimapBoundsOf（画布区域 ∪ 当前视口 + 留白）

/** 视口取景框（viewBox 四元组） */
export interface ViewportRect {
  x: number
  y: number
  w: number
  h: number
}

/** 视口裁剪后的返回值（h 由调用方按比例策略回填） */
export interface ViewportXYW {
  x: number
  y: number
  w: number
}

/** 滚轮缩放步进因子（>1；deltaY>0 缩小取其倒数）——与既有画布手感一致 */
export const WHEEL_ZOOM_STEP = 1.12

/**
 * 锚点缩放：以世界坐标 (ax, ay) 为不动点缩放视口（缺省取视口中心，如 ± 按钮与键盘缩放）。
 * factor > 1 放大、< 1 缩小；视口宽 clamp 到 [minW, maxW]。
 * 数学：k = nw / w；新 x = ax - (ax - x) * k（锚点在新旧视口中屏幕位置不变）。
 */
export function zoomViewport(
  v: ViewportRect,
  factor: number,
  minW: number,
  maxW: number,
  ax?: number,
  ay?: number,
): ViewportXYW {
  const cx = ax ?? v.x + v.w / 2
  const cy = ay ?? v.y + v.h / 2
  const nw = Math.max(minW, Math.min(maxW, v.w / (factor || 1)))
  const k = nw / v.w
  return { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w: nw }
}

/** wheel 缩放意图：由 WheelEvent 与 svg 屏幕矩形解算（factor + 世界锚点）；矩形宽为 0 时返回 null（未挂载/不可见） */
export function wheelZoomIntent(
  e: { clientX: number; clientY: number; deltaY: number },
  rect: { left: number; top: number; width: number },
  v: ViewportRect,
  step: number = WHEEL_ZOOM_STEP,
): { factor: number; ax: number; ay: number } | null {
  if (rect.width === 0) return null
  const s = rect.width / v.w // 屏幕 px / 世界单位
  return {
    factor: e.deltaY > 0 ? 1 / step : step,
    ax: v.x + (e.clientX - rect.left) / s,
    ay: v.y + (e.clientY - rect.top) / s,
  }
}

/**
 * 俯瞰图导航：缩略图上的屏幕点 → 画布世界坐标（preserveAspectRatio=meet 等比 + letterbox 居中偏移逆换算）。
 * m 为 minimapBoundsOf(v) 的世界包围盒；矩形宽或高为 0 时返回 null。
 */
export function minimapNavigateWorld(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  m: ViewportRect,
): { x: number; y: number } | null {
  if (rect.width === 0 || rect.height === 0) return null
  const s = Math.min(rect.width / m.w, rect.height / m.h) // meet 等比缩放比
  const ox = (rect.width - m.w * s) / 2 // letterbox 居中偏移
  const oy = (rect.height - m.h * s) / 2
  return {
    x: m.x + (clientX - rect.left - ox) / s,
    y: m.y + (clientY - rect.top - oy) / s,
  }
}

/** 屏幕位移 → viewBox 平移：scale = 屏幕 px / 世界单位（拖拽平移共用手感） */
export function panByScreen(
  start: ViewportRect,
  dxScreen: number,
  dyScreen: number,
  scale: number,
): ViewportXYW {
  return { x: start.x - dxScreen / scale, y: start.y - dyScreen / scale, w: start.w }
}
