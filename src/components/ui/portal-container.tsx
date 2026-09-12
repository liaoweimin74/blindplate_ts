"use client"
// 弹窗 Portal 容器重定向（外部小 store，无需 Provider 包裹任意深度的组件均可读取）
// 场景：PID 组态等模块进入原生全屏（Fullscreen API）后，全屏元素位于浏览器 top layer，
// Portal 到 document.body 的弹窗（Dialog/AlertDialog/Sheet/Select 下拉/Toast）会被整体盖住；
// 全屏期间把 Portal 容器切到全屏元素本身，弹窗随之进入 top layer 正常显示。
import * as React from "react"

let portalContainer: HTMLElement | null = null
const listeners = new Set<() => void>()

/** 设置全局 Portal 重定向容器（null = 恢复默认 body） */
export function setPortalContainer(el: HTMLElement | null) {
  if (portalContainer !== el) {
    portalContainer = el
    listeners.forEach((l) => l())
  }
}

/** 读取当前 Portal 重定向容器（未设置时返回 undefined，Portal 走默认 body） */
export function usePortalContainer(): HTMLElement | undefined {
  return (
    React.useSyncExternalStore(
      (cb) => {
        listeners.add(cb)
        return () => {
          listeners.delete(cb)
        }
      },
      () => portalContainer,
      () => null,
    ) ?? undefined
  )
}
