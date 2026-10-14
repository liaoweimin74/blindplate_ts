'use client'

/**
 * PID 俯瞰图简化场景（bp 层共享，Task 126）
 * —— pid-config 编辑/查看画布与 pid-locate 定位弹窗的俯瞰缩略此前各持一份
 *    近乎逐行相同的 ~55 行渲染（连线直线近似 + 图元简化轮廓 + 隔离点菱形），
 *    收敛至此；世界背景/白底原点/amber 视口框由 ViewerMinimap 壳自绘，
 *    本组件只渲染业务内容。
 */
import { anchorPointT, LINE, STROKE, ROSE, PidContent, PidMark } from './pid-config'
import type { ViewportRect } from '@/lib/configurator-core'

/** 俯瞰场景（内容 + 可选定位目标高亮；bounds 决定菱形/光环世界半径随缩略视野反向缩放） */
export function PidMinimapScene({
  content, bounds, targetMarkId,
}: {
  content: Pick<PidContent, 'shapes' | 'connections' | 'marks'>
  /** 俯瞰世界包围盒（useDiagramViewport().bounds，菱形半径 = bounds.w/40 保持屏幕可见） */
  bounds: ViewportRect
  /** 定位目标挂标 id：amber 放大 + 光环（pid-locate 专属语义） */
  targetMarkId?: string | null
}) {
  const shapeMap = new Map(content.shapes.map((s) => [s.id, s]))
  return (
    <>
      {/* 连线（锚点直线近似，细线不随缩略图缩放变粗） */}
      {content.connections.map((c) => {
        const f = shapeMap.get(c.fromShape)
        const t = shapeMap.get(c.toShape)
        if (!f || !t) return null
        const a = anchorPointT(f, c.fromAnchor, c.fromT)
        const b = anchorPointT(t, c.toAnchor, c.toT)
        return (
          <line
            key={c.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.65}
          />
        )
      })}
      {/* 图元（按类型简化轮廓，保留填充/描边色） */}
      {content.shapes.map((s) => {
        const fill = s.fill && s.fill !== 'transparent' ? s.fill : '#fff'
        const stroke = s.stroke ?? STROKE
        if (s.type === 'line') {
          return s.flip
            ? <line key={s.id} x1={s.x} y1={s.y + s.h} x2={s.x + s.w} y2={s.y} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            : <line key={s.id} x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        }
        if (s.type === 'circle') {
          return <circle key={s.id} cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={Math.min(s.w, s.h) / 2} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        }
        if (s.type === 'ellipse') {
          return <ellipse key={s.id} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        }
        if (s.type === 'triangle') {
          return <polygon key={s.id} points={`${s.x},${s.y + s.h} ${s.x + s.w},${s.y + s.h} ${s.x + s.w / 2},${s.y}`} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        }
        return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      })}
      {/* 隔离点标注（玫红菱形，世界半径随包围盒反向缩放保持屏幕可见；目标点 amber 放大 + 光环） */}
      {content.marks.map((m: PidMark) => {
        const isTarget = targetMarkId != null && m.id === targetMarkId
        const r = (bounds.w / 40) * (isTarget ? 1.9 : 1)
        return (
          <g key={m.id}>
            <polygon
              points={`${m.x},${m.y - r} ${m.x + r},${m.y} ${m.x},${m.y + r} ${m.x - r},${m.y}`}
              fill={isTarget ? '#f59e0b' : ROSE} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke"
            />
            {isTarget && (
              <circle cx={m.x} cy={m.y} r={bounds.w / 26} fill="none" stroke="#f59e0b" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            )}
          </g>
        )
      })}
    </>
  )
}
