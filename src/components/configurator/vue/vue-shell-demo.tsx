'use client'
// ============ Vue 壳演示模块：真实 Vue 3 运行时 × 零框架组态内核 ============
// 验证 components/configurator/vue/configurator-vue.ts 的两条接入契约：
//   1. mountSymbolThumb —— buildStdRegistry 产物直接可用，Vue 侧渲染同一份 Shape IR
//   2. mountCanvasBoard —— 与 React 壳（pid-config）共用 createCanvasController 同源交互
// Vue 以 render function 接入（无 SFC 构建依赖），useEffect 内动态 import 保证
// vue 运行时与演示模块代码分割在独立 chunk，不污染主包。
// 配色遵守项目红线：teal/emerald 主色，无 indigo/blue。
import { useEffect, useRef, useState } from 'react'
import { Boxes, Github, MousePointer2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/** 演示画布初始图元（覆盖壳缺省配色，遵守 teal/emerald 红线） */
const DEMO_BOXES = [
  { id: 'b1', label: '反应器', x: 60, y: 60, w: 140, h: 180, fill: '#ccfbf1' },
  { id: 'b2', label: '储罐', x: 320, y: 90, w: 120, h: 150, fill: '#d1fae5' },
  { id: 'b3', label: '泵', x: 520, y: 300, w: 90, h: 70, fill: '#f5f5f4' },
]

export default function VueShellDemoModule() {
  const mountEl = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'booting' | 'live' | 'error'>('booting')
  const [err, setErr] = useState<string>('')
  const [vueVersion, setVueVersion] = useState('3.5')

  useEffect(() => {
    let cancelled = false
    let app: { mount: (rootContainer: HTMLElement) => unknown; unmount: () => void } | null = null

    ;(async () => {
      try {
        // 动态 import：vue 运行时 + 壳模块 + 业务注册表全部落入独立 chunk
        const [{ createApp, h, ref, onMounted, onUnmounted, version }, { mountCanvasBoard, mountSymbolThumb }, { buildStdRegistry }] = await Promise.all([
          import('vue'),
          import('@/components/configurator/vue/configurator-vue'),
          import('@/components/bp/pid-registry'),
        ])
        if (cancelled || !mountEl.current) return
        setVueVersion(version.split('.').slice(0, 2).join('.'))

        const registry = buildStdRegistry()
        const thumbs = registry.symbols.filter((s) => s.draw).slice(0, 10)

        const VueDemoApp = {
          setup() {
            const host = ref<HTMLDivElement | null>(null)
            const thumbHost = ref<HTMLDivElement | null>(null)
            const boxCount = ref(DEMO_BOXES.length)
            const lastOp = ref('内核就绪，等待手势')
            const opCount = ref(0)
            const disposes: Array<() => void> = []

            onMounted(() => {
              // 契约 1：缩略图 —— registry.symbols 的 Shape IR 直接渲染
              if (thumbHost.value) {
                for (const meta of thumbs) {
                  const cell = document.createElement('div')
                  cell.className = 'flex w-[92px] shrink-0 flex-col items-center gap-1 rounded-md border border-stone-200 bg-white p-1.5'
                  const slot = document.createElement('div')
                  slot.className = 'h-10 w-full'
                  const cap = document.createElement('div')
                  cap.className = 'w-full truncate text-center text-[10px] text-stone-500'
                  cap.textContent = meta.label
                  cell.append(slot, cap)
                  thumbHost.value.appendChild(cell)
                  disposes.push(mountSymbolThumb(slot, meta, { className: 'h-10 w-full' }))
                }
              }
              // 契约 2：画布板 —— 与 pid-config 同一 createCanvasController
              if (host.value) {
                disposes.push(mountCanvasBoard(host.value, {
                  boxes: DEMO_BOXES.map((b) => ({ ...b })),
                  onChange: (boxes) => {
                    opCount.value += 1
                    boxCount.value = boxes.length
                    const b = boxes[0]
                    lastOp.value = b ? `${b.label} → (${b.x}, ${b.y})` : '结构变更'
                  },
                }))
              }
            })
            onUnmounted(() => { for (const d of disposes) d() })

            return () => h('div', { class: 'flex flex-col gap-4' }, [
              // Vue 响应式状态条：证明 Vue reactivity ↔ 内核手势桥接
              h('div', { class: 'grid grid-cols-3 gap-3' }, [
                h('div', { class: 'rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-2' }, [
                  h('div', { class: 'text-[11px] text-stone-500' }, '画布图元'),
                  h('div', { class: 'text-lg font-semibold text-teal-700' }, String(boxCount.value)),
                ]),
                h('div', { class: 'rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2' }, [
                  h('div', { class: 'text-[11px] text-stone-500' }, '手势落定次数'),
                  h('div', { class: 'text-lg font-semibold text-emerald-700' }, String(opCount.value)),
                ]),
                h('div', { class: 'rounded-lg border border-stone-200 bg-stone-50 px-3 py-2' }, [
                  h('div', { class: 'text-[11px] text-stone-500' }, '最后操作（Vue 响应式）'),
                  h('div', { class: 'truncate text-sm font-medium text-stone-700', title: lastOp.value }, lastOp.value),
                ]),
              ]),
              // 画布宿主：mountCanvasBoard 挂载点
              h('div', {
                ref: host,
                class: 'h-[420px] overflow-hidden rounded-lg border border-stone-200 bg-stone-50 shadow-inner',
              }),
              // 缩略图宿主：mountSymbolThumb 挂载点
              h('div', { class: 'flex flex-col gap-1.5' }, [
                h('div', { class: 'text-xs font-medium text-stone-500' }, `图元库缩略图（mountSymbolThumb × ${thumbs.length}，来自 buildStdRegistry Shape IR）`),
                h('div', { ref: thumbHost, class: 'flex gap-2 overflow-x-auto pb-1' }),
              ]),
            ])
          },
        }

        app = createApp(VueDemoApp)
        app.mount(mountEl.current)
        setStatus('live')
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e))
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      app?.unmount()
      app = null
    }
  }, [])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white">
            <Boxes className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-800">组态内核演示 · Vue 3 壳</h1>
            <p className="text-xs text-stone-500">Vue 3 运行时挂载零框架内核 —— 与 PID 组态（React 壳）共用同一控制器 / 图元 IR / 几何策略</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">vue@{vueVersion} · render fn</Badge>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">零框架内核</Badge>
          <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-600">同源控制器</Badge>
        </div>
      </header>

      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-6">
        {status === 'booting' && (
          <div className="flex h-[420px] items-center justify-center text-sm text-stone-400">
            <MousePointer2 className="mr-2 h-4 w-4 animate-pulse" aria-hidden /> Vue 运行时加载中…
          </div>
        )}
        {status === 'error' && (
          <div className="flex h-[420px] flex-col items-center justify-center gap-2 text-sm text-red-600">
            <span>Vue 壳挂载失败：{err}</span>
            <span className="text-xs text-stone-400">请检查浏览器控制台并刷新重试</span>
          </div>
        )}
        {/* Vue 应用挂载点：状态条 / 画布 / 缩略图均由 Vue render fn 产出 */}
        <div ref={mountEl} className={status === 'live' ? '' : 'hidden'} />
      </div>

      <section className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 text-xs leading-relaxed text-stone-500 md:p-5">
        <div className="mb-2 flex items-center gap-1.5 font-medium text-stone-600">
          <Github className="h-3.5 w-3.5" aria-hidden /> 同源架构说明
        </div>
        <ul className="list-inside list-disc space-y-1">
          <li>画布交互（点选 / 拖动 / 多选整体拖动 / Shift 框选 / 四角缩放 / Esc）全部来自 <code className="rounded bg-stone-200 px-1">lib/configurator-core</code> 的 createCanvasController —— 与 React 壳 pid-config 逐字节同一实现</li>
          <li>图元缩略图由 <code className="rounded bg-stone-200 px-1">buildStdRegistry</code> 的零框架 Shape IR 经 core shape-dom（createElementNS）产出，Vue / React 渲染同一份数据</li>
          <li>本页 Vue 以 render function 接入（无 .vue SFC 构建依赖）；vue 运行时按需代码分割，仅在进入本模块时加载</li>
          <li>手势在画布上落定后，onChange 回调驱动上方 Vue 响应式状态条 —— 跨框架桥接实测通道</li>
        </ul>
      </section>
    </div>
  )
}
