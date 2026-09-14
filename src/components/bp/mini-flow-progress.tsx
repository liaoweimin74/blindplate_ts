'use client'
// 共享小组件：列表/明细行内迷你流程进度条（8 段分段可视化）
// 已完成=实绿 / 进行中=呼吸绿 / 未开始=浅灰；右侧字标=已完成环节 n/8；取消=整条置灰
import { FLOW_STEPS, flowStepIndex } from '@/lib/bp-types'
import { cn } from '@/lib/utils'

export function MiniFlowProgress({ status, className }: { status: string; className?: string }) {
  const idx = flowStepIndex(status)
  const total = FLOW_STEPS.length
  const cancelled = idx < 0
  const completed = idx >= total
  const tip = cancelled ? '流程已取消' : completed ? '流程已全部完成' : `当前环节：${FLOW_STEPS[idx].label}`
  return (
    <div className={cn('group flex items-center gap-0.5 w-32 cursor-default', className)} title={tip}>
      {FLOW_STEPS.map((s, i) => (
        <span
          key={s.key}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            cancelled ? 'bg-stone-200 group-hover:bg-stone-300 transition-colors'
            : completed ? 'transition group-hover:brightness-110'
            : i < idx ? 'bg-emerald-500 group-hover:bg-emerald-400 transition-colors'
            : i === idx ? 'bg-emerald-300 group-hover:bg-emerald-200 animate-pulse transition-colors'
            : 'bg-stone-200 group-hover:bg-stone-300 transition-colors',
          )}
          style={completed ? {
            backgroundImage: 'linear-gradient(to right, #10b981, #14b8a6)',
            backgroundSize: '800% 100%',
            backgroundPosition: `${(i / (total - 1)) * 100}% 0`,
          } : undefined}
        />
      ))}
      <span className={cn('font-mono text-[10px] w-6 text-right leading-none', completed ? 'text-emerald-600' : 'text-stone-400')}>
        {cancelled ? '—' : `${completed ? total : idx}/${total}`}
      </span>
    </div>
  )
}
