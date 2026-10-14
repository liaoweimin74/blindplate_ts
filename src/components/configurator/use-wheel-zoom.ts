'use client'

// ============ 滚轮缩放绑定（React 适配层薄壳） ============
//
// svg 原生 wheel 监听（非 passive 才能 preventDefault 阻止页面/弹窗滚动）的统一封装。
// 此前 pid-config 与 pid-locate 各持一份逐行相同的 onWheel useEffect，收敛至此。
// 数学在 core/viewport.wheelZoomIntent（框架无关），本 hook 只做事件绑定生命周期。
//
// 用法：
//   const zoomAt = useCallback((f, ax, ay) => setVb(v => ({ ...zoomViewport(v, f, MIN, MAX, ax, ay), h: ... })), [])
//   useWheelZoom(svgRef, { enabled: !loading, bindKey: diagramId, vbRef, zoomAt })

import { useEffect, type RefObject } from 'react'
import { wheelZoomIntent } from '@/lib/configurator-core'

export interface WheelZoomOptions {
  /** false 时不绑定（骨架屏/无图阶段） */
  enabled: boolean
  /**
   * 绑定键：svg 元素被 React 重新挂载（如图切换 key 变化）后 ref.current 更新，
   * 传入会随其变化的值以重新执行绑定（zoomAt/enabled 变化也会自动重绑）
   */
  bindKey?: string | number
  /** 视口 ref（恒取最新值，不触发重绑） */
  vbRef: RefObject<{ x: number; y: number; w: number; h: number }>
  /** 宿主缩放回调（内部用 core zoomViewport 更新视口） */
  zoomAt: (factor: number, ax?: number, ay?: number) => void
}

export function useWheelZoom(
  svgRef: RefObject<SVGSVGElement | null>,
  { enabled, bindKey, vbRef, zoomAt }: WheelZoomOptions,
) {
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !enabled) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const intent = wheelZoomIntent(e, svg.getBoundingClientRect(), vbRef.current)
      if (intent) zoomAt(intent.factor, intent.ax, intent.ay)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [svgRef, enabled, bindKey, zoomAt, vbRef])
}
