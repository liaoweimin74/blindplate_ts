// ============ Vue 3 接入示例壳（零依赖：不 import vue / react，可原样拆入独立 npm 包） ============
// 组态核心（lib/configurator-core）与图元数据包（Shape IR）均为零框架产物，
// Vue 侧无需任何 React 依赖即可渲染同一套图元——SVG 由 core 的 shape-dom
// （createElementNS）直接产出，Vue 组件只在生命周期里挂载/卸载宿主元素即可。
//
// ── 用法示例（Vue 3 SFC · 图元库缩略图组件）─────────────────────────
// <template>
//   <div ref="host" class="sym-thumb" />
// </template>
// <script setup lang="ts">
// import { onMounted, onUnmounted, ref, watch } from 'vue'
// import type { SymbolMeta } from '@/lib/configurator-core'
// import { mountSymbolThumb } from '@/components/configurator/vue/configurator-vue'
//
// const props = defineProps<{ meta: SymbolMeta }>()
// const host = ref<HTMLElement | null>(null)
// let dispose: (() => void) | undefined
// function render() {
//   dispose?.()
//   if (host.value) dispose = mountSymbolThumb(host.value, props.meta)
// }
// onMounted(render)
// watch(() => props.meta, render)
// onUnmounted(() => dispose?.())
// </script>
//
// ── 契约说明（与 React 适配层等价）────────────────────────────────
//   1. registry：buildRegistry(...) / buildStdRegistry 的产物直接可用，
//      SymbolMeta.draw() 返回零框架 Shape IR —— Vue/React 渲染同一份数据
//   2. 缩略图：mountSymbolThumb(el, meta) 一行接入（本文件）
//   3. 画布：Document 模型 + geometry/autoLayout/history 纯函数直接驱动，
//      指针交互按 core/index.ts 头注释的事件契约等价翻译（画布控制器泛型化
//      搬迁完成后，Vue 壳与 React 壳将共用同一 createCanvasController）
//   4. 属性面板：PropFieldDef schema 驱动，Vue 表单组件按 schema 自动渲染，
//      业务绑定走 Vue slot（对应 React children 插槽）
import type { ShapePaint, SymbolMeta } from '@/lib/configurator-core'
import { shapesToSvgElement } from '@/lib/configurator-core'

export interface ThumbMountOptions {
  /** 缺省与 React 侧 StdSymbolThumb 一致（石描边/白填充） */
  paint?: Partial<ShapePaint>
  className?: string
}

/**
 * 把符号缩略图挂载到任意 DOM 宿主（Vue mounted / 原生 JS 均可）。
 * 内部经 core shape-dom 产出真实 <svg>（non-scaling-stroke），返回卸载函数。
 */
export function mountSymbolThumb(el: HTMLElement, meta: SymbolMeta, opts: ThumbMountOptions = {}): () => void {
  const shapes = meta.draw?.() ?? []
  if (shapes.length === 0) return () => {}
  const svg = shapesToSvgElement(shapes, {
    paint: { stroke: opts.paint?.stroke ?? '#57534e', fill: opts.paint?.fill ?? '#fff' },
    nonScalingStroke: true,
    viewBox: { w: meta.defaultW, h: meta.defaultH },
    className: opts.className ?? 'h-12 w-full',
  })
  el.appendChild(svg)
  return () => {
    svg.remove()
  }
}
