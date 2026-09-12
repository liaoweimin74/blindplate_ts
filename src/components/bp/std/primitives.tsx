// ============ PID 内建图元——共享绘图基元 ============
// 所有符号共用：管线/箭头/文字/阀芯/仪表气泡/弹簧/填料段/罐体剪影/执行机构。
// 坐标均在符号设计空间内；透明 SW_PAD 线段用作小目标的命中垫片。
import type { ReactNode } from 'react'

export const SW_MAIN = 1.6
export const SW_THIN = 1.2
export const SW_PAD = 14 // 命中垫片线宽（透明）

/** 水平管线（带透明命中垫片） */
export function pipe(y: number, stroke: string, x1 = 2, x2 = 62, sw: number = SW_MAIN): ReactNode {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="transparent" strokeWidth={SW_PAD} />
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} />
    </g>
  )
}

/** 竖直管线 */
export function vline(x: number, y1: number, y2: number, stroke: string, sw: number = SW_MAIN): ReactNode {
  return <line x1={x} y1={y1} x2={x} y2={y2} stroke={stroke} strokeWidth={sw} />
}

/** 右向小箭头（流向提示） */
export function arrowRight(x: number, y: number, stroke: string, s = 5): ReactNode {
  return <polygon points={`${x},${y - s * 0.6} ${x + s},${y} ${x},${y + s * 0.6}`} fill={stroke} stroke="none" />
}

/** 左向小箭头 */
export function arrowLeft(x: number, y: number, stroke: string, s = 5): ReactNode {
  return <polygon points={`${x + s},${y - s * 0.6} ${x},${y} ${x + s},${y + s * 0.6}`} fill={stroke} stroke="none" />
}

/** 上向小箭头 */
export function arrowUp(x: number, y: number, stroke: string, s = 5): ReactNode {
  return <polygon points={`${x - s * 0.6},${y} ${x + s * 0.6},${y} ${x},${y - s}`} fill={stroke} stroke="none" />
}

/** 下向小箭头 */
export function arrowDown(x: number, y: number, stroke: string, s = 5): ReactNode {
  return <polygon points={`${x - s * 0.6},${y} ${x + s * 0.6},${y} ${x},${y + s}`} fill={stroke} stroke="none" />
}

/** 符号内文字（F / M / MCC 等），锚点居中 */
export function symText(x: number, y: number, t: string, stroke: string, size = 13, weight = 600): ReactNode {
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={weight} fill={stroke} stroke="none" fontFamily="ui-sans-serif, system-ui, sans-serif">
      {t}
    </text>
  )
}

/** 空心/实心对顶三角阀芯（水平管线，中心 cx,cy，半宽 hw，半高 hh，solid=截止阀实心语义） */
export function bowtie(cx: number, cy: number, hw: number, hh: number, stroke: string, fill: string, solid = false): ReactNode {
  const f = solid ? stroke : fill
  return (
    <g>
      <polygon points={`${cx - hw},${cy - hh} ${cx - hw},${cy + hh} ${cx - 1.5},${cy}`} fill={f} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      <polygon points={`${cx + hw},${cy - hh} ${cx + hw},${cy + hh} ${cx + 1.5},${cy}`} fill={f} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
    </g>
  )
}

/** ISA-5.1 仪表气泡：field 现场圆 / panel 盘装(加横线) / dcs(虚横线) / sis 方块内菱形 */
export function bubble(
  cx: number, cy: number, r: number, text: string, stroke: string,
  variant: 'field' | 'panel' | 'dcs' | 'sis' = 'field', size?: number,
): ReactNode {
  if (variant === 'sis') {
    const s = r * 1.12
    return (
      <g>
        <rect x={cx - s} y={cy - s} width={s * 2} height={s * 2} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon
          points={`${cx},${cy - s * 0.74} ${cx + s * 0.74},${cy} ${cx},${cy + s * 0.74} ${cx - s * 0.74},${cy}`}
          fill="none" stroke={stroke} strokeWidth={SW_THIN}
        />
        {text ? symText(cx, cy, text, stroke, size ?? 8) : null}
      </g>
    )
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
      {variant !== 'field' && (
        <line
          x1={cx - r} y1={cy} x2={cx + r} y2={cy}
          stroke={stroke} strokeWidth={SW_THIN} strokeDasharray={variant === 'dcs' ? '3 2' : undefined}
        />
      )}
      {text ? symText(cx, cy + (variant !== 'field' ? -r * 0.42 : 0.5), text, stroke, size ?? 10) : null}
    </g>
  )
}

/** 弹簧 zigzag（安全阀/活塞/线圈），从 (x1,y1) 到 (x2,y2)，振幅 amp，n 节 */
export function spring(x1: number, y1: number, x2: number, y2: number, amp: number, n: number, stroke: string, sw: number = SW_THIN): ReactNode {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  const pts: string[] = [`${x1},${y1}`]
  for (let i = 1; i < n; i++) {
    const t = i / n
    const side = i % 2 === 0 ? -amp : amp
    pts.push(`${x1 + dx * t + px * side},${y1 + dy * t + py * side}`)
  }
  pts.push(`${x2},${y2}`)
  return <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
}

/** 填料/床层段：上下边界线 + 交叉斜线（填料塔/固定床/过滤器滤芯） */
export function packing(x1: number, x2: number, y1: number, y2: number, stroke: string): ReactNode {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y1} stroke={stroke} strokeWidth={SW_THIN} />
      <line x1={x1} y1={y2} x2={x2} y2={y2} stroke={stroke} strokeWidth={SW_THIN} />
      <line x1={x1 + 1} y1={y1 + 2} x2={x2 - 1} y2={y2 - 2} stroke={stroke} strokeWidth={SW_THIN} />
      <line x1={x2 - 1} y1={y1 + 2} x2={x1 + 1} y2={y2 - 2} stroke={stroke} strokeWidth={SW_THIN} />
    </g>
  )
}

/** 卧式圆筒剪影（两端半圆封头） */
export function drumH(x: number, y: number, w: number, h: number, stroke: string, fill: string): ReactNode {
  return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
}

/** 立式圆筒剪影（上下双封头），cx=中心线，top=顶缘 */
export function drumV(cx: number, top: number, w: number, h: number, stroke: string, fill: string): ReactNode {
  return <rect x={cx - w / 2} y={top} width={w} height={h} rx={w / 2} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
}

/** 小火焰（加热炉/火焰检测器） */
export function flame(cx: number, cy: number, s: number, stroke: string): ReactNode {
  return (
    <path
      d={`M${cx},${cy - s} Q${cx + s * 0.75},${cy - s * 0.15} ${cx},${cy + s * 0.75} Q${cx - s * 0.75},${cy - s * 0.15} ${cx},${cy - s} Z`}
      fill="none" stroke={stroke} strokeWidth={SW_THIN} strokeLinejoin="round"
    />
  )
}

// ============ 执行机构（阀杆顶点 (cx, yb)——向上绘制，含短阀杆） ============

/** 气动薄膜执行机构：半圆膜头 + 支架横杆 + 阀杆 */
export function actDiaphragm(cx: number, yb: number, stroke: string): ReactNode {
  return (
    <g>
      <path d={`M${cx - 12},${yb - 2} A12,10 0 0 1 ${cx + 12},${yb - 2} Z`} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      <line x1={cx - 15} y1={yb - 2} x2={cx + 15} y2={yb - 2} stroke={stroke} strokeWidth={SW_MAIN} />
      <line x1={cx} y1={yb - 2} x2={cx} y2={yb} stroke={stroke} strokeWidth={SW_MAIN} />
    </g>
  )
}

/** 电动执行机构：矩形箱体 + M 电机标识 */
export function actMotor(cx: number, yb: number, stroke: string): ReactNode {
  return (
    <g>
      <rect x={cx - 9} y={yb - 18} width={18} height={14} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
      {symText(cx, yb - 11, 'M', stroke, 10)}
      <line x1={cx} y1={yb - 4} x2={cx} y2={yb} stroke={stroke} strokeWidth={SW_MAIN} />
    </g>
  )
}

/** 电磁线圈执行机构：矩形 + 内部线圈 */
export function actSolenoid(cx: number, yb: number, stroke: string): ReactNode {
  return (
    <g>
      <rect x={cx - 8} y={yb - 16} width={16} height={12} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
      {spring(cx - 5, yb - 13, cx + 5, yb - 13, 2.4, 6, stroke)}
      <line x1={cx} y1={yb - 4} x2={cx} y2={yb} stroke={stroke} strokeWidth={SW_MAIN} />
    </g>
  )
}

/** 手轮执行机构：椭圆手轮 + 阀杆 */
export function actHandwheel(cx: number, yb: number, stroke: string): ReactNode {
  return (
    <g>
      <ellipse cx={cx} cy={yb - 14} rx={11} ry={3.2} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
      <circle cx={cx} cy={yb - 14} r={1.6} fill={stroke} stroke="none" />
      <line x1={cx} y1={yb - 11} x2={cx} y2={yb} stroke={stroke} strokeWidth={SW_MAIN} />
    </g>
  )
}

/** 活塞执行机构：气缸 + 活塞盘 + 活塞杆 */
export function actPiston(cx: number, yb: number, stroke: string): ReactNode {
  return (
    <g>
      <rect x={cx - 6} y={yb - 22} width={12} height={16} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
      <line x1={cx - 6} y1={yb - 18} x2={cx + 6} y2={yb - 18} stroke={stroke} strokeWidth={SW_THIN} />
      <line x1={cx} y1={yb - 18} x2={cx} y2={yb} stroke={stroke} strokeWidth={SW_MAIN} />
    </g>
  )
}

/** 弹簧杠杆执行机构：弹簧顶托横杆（杠杆）+ 阀杆 */
export function actLever(cx: number, yb: number, stroke: string): ReactNode {
  return (
    <g>
      {spring(cx, yb - 13, cx, yb - 4, 3.2, 6, stroke)}
      <line x1={cx - 10} y1={yb - 13} x2={cx + 10} y2={yb - 13} stroke={stroke} strokeWidth={SW_MAIN} strokeLinecap="round" />
      <circle cx={cx} cy={yb - 13} r={1.8} fill={stroke} stroke="none" />
      <line x1={cx} y1={yb - 4} x2={cx} y2={yb} stroke={stroke} strokeWidth={SW_MAIN} />
    </g>
  )
}
