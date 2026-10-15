'use client'
// ============ Vue 壳演示模块：真实 Vue 3 运行时 × 零框架组态内核 × 完整复刻 PID 组态工作台 ============
// 本模块将 pid-config（React 壳，6300+ 行）的「组态体验」完整复刻到 Vue 3 render fn：
//   126 标准符号图元库 / 两步+拖拽连线 / 端点改接 / 正交路由 / 管线号徽章 /
//   隔离点六态+图例 / 装置角标 / 底图 / 视口四件套 / 俯瞰图 / 图层开关 /
//   搜索定位 / 撤销重做 / 多选对齐分布 / 键盘全集 / SVG+PNG 导出（见 pid-replica-vue.ts）
// 业务 CRUD（图纸 API/主数据/作业票/轮询）以富 mock 替代——演示与内核验证两相宜。
import { useEffect, useRef, useState } from 'react'
import { Boxes, MousePointer2, Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export default function VueShellDemoModule() {
  const mountEl = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'booting' | 'live' | 'error'>('booting')
  const [err, setErr] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    let handle: { unmount: () => void } | null = null

    ;(async () => {
      try {
        // 动态 import：vue 运行时 + 完整复刻工作台 + 业务注册表全部落入独立 chunk
        const [{ mountPidReplica }] = await Promise.all([
          import('@/components/configurator/vue/pid-replica-vue'),
        ])
        if (cancelled || !mountEl.current) return
        handle = mountPidReplica(mountEl.current)
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
      handle?.unmount()
      handle = null
    }
  }, [])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white">
            <Workflow className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-800">组态内核演示 · Vue 3 完整复刻 PID 组态</h1>
            <p className="text-xs text-stone-500">
              Vue 3 render fn 完整复刻 pid-config 组态体验 —— 图元库 / 连线 / 徽章 / 隔离点 / 视口 / 俯瞰 / 导出
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">vue@3.5 · render fn</Badge>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">零框架内核</Badge>
          <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-600">126 标准符号</Badge>
          <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">完整复刻</Badge>
        </div>
      </header>

      <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm md:p-4">
        {status === 'booting' && (
          <div className="flex h-[420px] items-center justify-center text-sm text-stone-400">
            <MousePointer2 className="mr-2 h-4 w-4 animate-pulse" aria-hidden /> Vue 工作台加载中…
          </div>
        )}
        {status === 'error' && (
          <div className="flex h-[420px] flex-col items-center justify-center gap-2 text-sm text-red-600">
            <span>Vue 工作台挂载失败：{err}</span>
            <span className="text-xs text-stone-400">请检查浏览器控制台并刷新重试</span>
          </div>
        )}
        {/* Vue 应用挂载点：工具条 / 图元库 / 画布 / 属性面板 / 状态条全部由 Vue render fn 产出 */}
        <div ref={mountEl} className={status === 'live' ? '' : 'hidden'} />
      </div>

      <section className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 text-xs leading-relaxed text-stone-500 md:p-5">
        <div className="mb-2 flex items-center gap-1.5 font-medium text-stone-600">
          <Boxes className="h-3.5 w-3.5" aria-hidden /> 同源架构说明（与 pid-config 的关系）
        </div>
        <ul className="list-inside list-disc space-y-1">
          <li>画布交互（点选/拖动/多选/框选/四角缩放/直线橡皮筋/锚点连线/端点改接）全部来自 <code className="rounded bg-stone-200 px-1">lib/configurator-core</code> —— 与 React 壳 pid-config 逐字节同一实现</li>
          <li>126 个 HG/T 20519 标准符号经 <code className="rounded bg-stone-200 px-1">buildStdRegistry</code> Shape IR 渲染：React 用 data→JSX 映射器、Vue 用 core shape-dom 同源语义桥，视觉一致</li>
          <li>conn 徽章（+6×18 命中垫片 / wHalf×16 胶囊）、隔离点六态色表、导出 data-noexport 约定均按 pid-config 源码实测值复刻</li>
          <li>业务层差异：图纸 CRUD / 主数据 / 作业票档案 / 10s 轮询为 API 驱动，本演示以 localStorage + mock 数据替代（保存 / 重置场景 / 模拟状态）</li>
        </ul>
      </section>
    </div>
  )
}
