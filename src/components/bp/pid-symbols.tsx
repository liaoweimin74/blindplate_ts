'use client'
// ============ PID 标准图例符号库（HG/T 20519 手工重绘矢量版） ============
// 图元来源：用户提供的 HG20519.4-92 / HG20519.31-92 标准图例（仪表/阀门/管件/设备），
// 逐个按标准符号语义以 SVG path 重绘为矢量（非位图描摹），画布与工具栏缩略图共用本定义。
// 约定：每个符号在各自设计空间 (0,0)-(sw,sh) 内绘制；描边统一 non-scaling-stroke（缩放不失真不变粗）；
// stroke/fill 跟随画布图元属性（属性面板可自定义配色）。
import type { ReactNode } from 'react'

export type StdSymbolGroup = 'instrument' | 'valve' | 'fitting' | 'equipment' | 'pump'

export interface StdSymbol {
  id: string
  label: string
  group: StdSymbolGroup
  standard: string // 标准号
  desc: string     // 悬停说明
  sw: number       // 设计空间宽
  sh: number       // 设计空间高
  render: (p: { stroke: string; fill: string }) => ReactNode
}

// 公共线宽（non-scaling-stroke，视觉恒定）
const SW_MAIN = 1.6
const SW_THIN = 1.2
const SW_PAD = 14 // 命中垫片线宽（透明）

/** 水平管线穿行线（y=y0，两端留白 2） */
function pipe(y: number, stroke: string, x1 = 2, x2 = 62): ReactNode {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="transparent" strokeWidth={SW_PAD} />
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={SW_MAIN} />
    </g>
  )
}

/** 右向小箭头（流向提示） */
function arrowRight(x: number, y: number, stroke: string, s = 5): ReactNode {
  return <polygon points={`${x},${y - s * 0.6} ${x + s},${y} ${x},${y + s * 0.6}`} fill={stroke} stroke="none" />
}

/** 下向小箭头 */
function arrowDown(x: number, y: number, stroke: string, s = 5): ReactNode {
  return <polygon points={`${x - s * 0.6},${y} ${x + s * 0.6},${y} ${x},${y + s}`} fill={stroke} stroke="none" />
}

/** 符号内文字（F / LG / SV / M 等） */
function symText(x: number, y: number, t: string, stroke: string, size = 13): ReactNode {
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={600} fill={stroke} stroke="none" fontFamily="ui-sans-serif, system-ui, sans-serif">
      {t}
    </text>
  )
}

/** 空心/实心对顶三角阀芯（水平管线，中心 cx,cy，半宽 hw，半高 hh，solid=截止阀实心语义） */
function bowtie(cx: number, cy: number, hw: number, hh: number, stroke: string, fill: string, solid = false): ReactNode {
  const f = solid ? stroke : fill
  return (
    <g>
      <polygon points={`${cx - hw},${cy - hh} ${cx - hw},${cy + hh} ${cx - 1.5},${cy}`} fill={f} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      <polygon points={`${cx + hw},${cy - hh} ${cx + hw},${cy + hh} ${cx + 1.5},${cy}`} fill={f} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
    </g>
  )
}

export const STD_SYMBOLS: StdSymbol[] = [
  // ================= 仪表（HG/T 20519.4-92） =================
  {
    id: 'orifice-meter', label: '孔板流量计', group: 'instrument', standard: 'HG/T 20519.4-92',
    desc: '孔板节流取压测量流量，输出信号 F', sw: 48, sh: 44,
    render: ({ stroke }) => (
      <g>
        {pipe(36, stroke, 2, 46)}
        <line x1={22} y1={30} x2={22} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24.5} y1={30} x2={24.5} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={23.2} y1={30} x2={23.2} y2={20} stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={23.2} cy={12} r={8.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(23.2, 12.5, 'F', stroke, 11)}
      </g>
    ),
  },
  {
    id: 'rotameter', label: '转子流量计', group: 'instrument', standard: 'HG/T 20519.4-92',
    desc: '恒压降变面积流量测量，锥管内转子随流量升降', sw: 44, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={22} y1={2} x2={22} y2={12} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d={`M16,12 L28,12 L25,52 L19,52 Z`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points={`${22},26 ${19.4},33 ${24.6},33`} fill={stroke} stroke="none" />
        <line x1={22} y1={52} x2={22} y2={62} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(10, 16, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'magnetic-meter', label: '电磁流量计', group: 'instrument', standard: 'HG/T 20519.4-92',
    desc: '法拉第电磁感应原理测流量，无阻流件', sw: 64, sh: 48,
    render: ({ stroke }) => (
      <g>
        {pipe(30, stroke, 2, 20)}
        {pipe(30, stroke, 44, 62)}
        {arrowRight(14, 30, stroke, 4.5)}
        {arrowRight(48, 30, stroke, 4.5)}
        <circle cx={32} cy={30} r={12} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={32} cy={15.5} r={2.6} fill={stroke} stroke="none" />
        <circle cx={32} cy={44.5} r={2.6} fill={stroke} stroke="none" />
      </g>
    ),
  },
  {
    id: 'target-meter', label: '靶式流量计', group: 'instrument', standard: 'HG/T 20519.4-92',
    desc: '靶板受力测量流量，适用高粘度介质', sw: 64, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(30, stroke, 2, 22)}
        <rect x={22} y={22} width={20} height={16} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={28} y1={22} x2={28} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
        {pipe(30, stroke, 42, 62)}
        {arrowRight(48, 30, stroke, 4.5)}
      </g>
    ),
  },
  {
    id: 'venturi-meter', label: '文氏流量计', group: 'instrument', standard: 'HG/T 20519.4-92',
    desc: '文丘里管差压式流量测量，压损低', sw: 64, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(30, stroke, 2, 10)}
        <path d="M10,20 L28,26 L28,34 L10,40 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <path d="M36,26 L54,20 L54,40 L36,34 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        {pipe(30, stroke, 54, 62)}
        {arrowRight(46, 30, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'level-gauge', label: '液位计', group: 'instrument', standard: 'HG/T 20519.4-92',
    desc: '玻璃板/磁翻板液位计，就地液位指示 LG', sw: 64, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={5} y={10} width={18} height={44} rx={9} fill="none" stroke={stroke} strokeWidth={SW_THIN} strokeDasharray="4 3" />
        <line x1={23} y1={18} x2={34} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        {bowtie(37, 18, 3, 4.5, stroke, fill)}
        <line x1={40} y1={18} x2={46} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={23} y1={46} x2={34} y2={46} stroke={stroke} strokeWidth={SW_THIN} />
        {bowtie(37, 46, 3, 4.5, stroke, fill)}
        <line x1={40} y1={46} x2={46} y2={46} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={46} y1={8} x2={46} y2={56} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={46} cy={32} r={10} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(46, 32.5, 'LG', stroke, 9)}
      </g>
    ),
  },

  // ================= 阀门（HG/T 20519.4-92） =================
  {
    id: 'valve-globe', label: '截止阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '实心阀芯截止阀，截断与调节流通', sw: 64, sh: 36,
    render: ({ stroke }) => (
      <g>
        {pipe(20, stroke)}
        {bowtie(32, 20, 17, 11, stroke, '#fff', true)}
      </g>
    ),
  },
  {
    id: 'valve-gate', label: '闸阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '空心对顶三角闸阀，全开全关用', sw: 64, sh: 36,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(20, stroke)}
        {bowtie(32, 20, 17, 11, stroke, fill, false)}
      </g>
    ),
  },
  {
    id: 'valve-needle', label: '针型阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '实心针状阀芯，微调与小口径切断', sw: 64, sh: 36,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(20, stroke)}
        {bowtie(32, 20, 17, 11, stroke, fill, false)}
        <polygon points={`${32},3 ${26.5},14 ${37.5},14`} fill={stroke} stroke="none" />
        <line x1={32} y1={20} x2={32} y2={14} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'valve-ball', label: '球阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '球芯 90° 旋转启闭，低阻力快开', sw: 64, sh: 36,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(20, stroke)}
        {bowtie(32, 20, 17, 11, stroke, fill, false)}
        <circle cx={32} cy={20} r={5.2} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'valve-lift-check', label: '升降止回阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '阀盘垂直升降止回，只允许单向流动', sw: 64, sh: 40,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(30, stroke, 2, 25)}
        <rect x={25} y={14} width={14} height={16} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={25} y1={20} x2={39} y2={20} stroke={stroke} strokeWidth={SW_MAIN} />
        {pipe(30, stroke, 39, 62)}
        {arrowRight(47, 30, stroke, 4.5)}
      </g>
    ),
  },
  {
    id: 'valve-swing-check', label: '旋启止回阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '摇臂阀瓣旋启止回，水平管路常用', sw: 64, sh: 40,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(28, stroke, 2, 22)}
        <rect x={22} y={12} width={22} height={26} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={15} x2={40} y2={33} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={26} cy={15} r={2.2} fill={stroke} stroke="none" />
        {pipe(28, stroke, 44, 62)}
      </g>
    ),
  },
  {
    id: 'valve-angle', label: '角阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '90° 角接阀体，水平进垂直出', sw: 52, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={2} y1={26} x2={30} y2={26} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={2} y1={26} x2={30} y2={26} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points={`${10},14 ${10},38 ${28},26`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points={`${18},48 ${42},48 ${30},30`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={30} y1={26} x2={30} y2={4} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={4} x2={36} y2={4} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={30} y1={48} x2={30} y2={62} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={30} y1={48} x2={30} y2={62} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(30, 54, stroke, 4.5)}
      </g>
    ),
  },
  {
    id: 'valve-safety', label: '安全阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '弹簧安全阀 SV，超压自动起跳泄放', sw: 52, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={26} cy={10} r={8.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(26, 10.5, 'SV', stroke, 8.5)}
        <line x1={26} y1={18.5} x2={26} y2={30} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M17,25 L21,21 L26,25 L31,21 L35,25" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <polygon points={`${22},28 ${30},28 ${26},35`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={4} y1={44} x2={48} y2={44} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={44} x2={48} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={35} x2={26} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points={`${8},42 ${8},46 ${13},44`} fill={stroke} stroke="none" />
      </g>
    ),
  },
  {
    id: 'valve-three-way', label: '三通阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '三个流道汇合阀芯，混合或分流', sw: 64, sh: 52,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(32, stroke, 2, 16)}
        {pipe(32, stroke, 48, 62)}
        <line x1={32} y1={16} x2={32} y2={4} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={32} y1={16} x2={32} y2={4} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points={`${14},20 ${14},44 ${29.5},32`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points={`${50},20 ${50},44 ${34.5},32`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points={`${22},2 ${42},2 ${32},17.5`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: 'valve-four-way', label: '四通阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '四流道十字阀芯，换向切换用', sw: 64, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(32, stroke, 2, 16)}
        {pipe(32, stroke, 48, 62)}
        <line x1={32} y1={16} x2={32} y2={4} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={32} y1={16} x2={32} y2={4} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={32} y1={48} x2={32} y2={60} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={32} y1={48} x2={32} y2={60} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points={`${14},20 ${14},44 ${29.5},32`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points={`${50},20 ${50},44 ${34.5},32`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points={`${22},2 ${42},2 ${32},17.5`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points={`${22},62 ${42},62 ${32},46.5`} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: 'valve-reducing', label: '减压阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '膜片式减压阀，出口压力恒定控制', sw: 56, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={28} cy={9} r={8.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 9.5, 'SV', stroke, 8.5)}
        <line x1={28} y1={17.5} x2={28} y2={26} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={4} y1={44} x2={52} y2={44} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={44} x2={52} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <rect x={18} y={30} width={20} height={28} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={18} y1={30} x2={38} y2={58} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(43, 44, stroke, 4.5)}
      </g>
    ),
  },
  {
    id: 'valve-steam-trap', label: '疏水阀', group: 'valve', standard: 'HG/T 20519.4-92',
    desc: '蒸汽疏水阀（阻汽排水）SV', sw: 56, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={28} cy={9} r={8.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 9.5, 'SV', stroke, 8.5)}
        <line x1={28} y1={17.5} x2={28} y2={24} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={4} y1={44} x2={52} y2={44} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={44} x2={52} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={28} cy={44} r={13} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M15,44 A13,13 0 0 0 41,44 Z" fill={stroke} stroke="none" />
      </g>
    ),
  },

  // ================= 管件（HG/T 20519.4-92） =================
  {
    id: 'fit-elbow', label: '弯头', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '90° 弯头，改变管路走向', sw: 64, sh: 64,
    render: ({ stroke }) => (
      <g>
        <path d="M24,10 Q24,44 54,44" fill="none" stroke="transparent" strokeWidth={SW_PAD} />
        <path d="M24,10 Q24,44 54,44" fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={17} y1={10} x2={31} y2={10} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={54} y1={37} x2={54} y2={51} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'fit-tee', label: '三通', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: 'T 形三通管件，分支管路', sw: 64, sh: 48,
    render: ({ stroke }) => (
      <g>
        <path d="M8,32 H56 M32,32 V10" fill="none" stroke="transparent" strokeWidth={SW_PAD} />
        <path d="M8,32 H56 M32,32 V10" fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={8} y1={26} x2={8} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={56} y1={26} x2={56} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={10} x2={38} y2={10} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'fit-cross', label: '四通', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '十字四通管件，四向分支', sw: 64, sh: 64,
    render: ({ stroke }) => (
      <g>
        <path d="M32,10 V54 M10,32 H54" fill="none" stroke="transparent" strokeWidth={SW_PAD} />
        <path d="M32,10 V54 M10,32 H54" fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={10} x2={38} y2={10} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={54} x2={38} y2={54} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={26} x2={10} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={54} y1={26} x2={54} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'fit-blind-flange', label: '法兰盖', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '管端法兰盖（盲法兰），封堵管口', sw: 64, sh: 40,
    render: ({ stroke }) => (
      <g>
        {pipe(20, stroke, 4, 52)}
        <line x1={52} y1={8} x2={52} y2={32} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={57} y1={8} x2={57} y2={32} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'fit-blank', label: '盲板', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '8 字盲板插板，隔离/切断管段', sw: 64, sh: 40,
    render: ({ stroke }) => (
      <g>
        {pipe(20, stroke, 4, 30)}
        <line x1={34} y1={6} x2={34} y2={34} stroke={stroke} strokeWidth={SW_MAIN} />
        {pipe(20, stroke, 38, 60)}
      </g>
    ),
  },
  {
    id: 'fit-reducer', label: '异径管', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '大小头异径管，管径过渡', sw: 64, sh: 44,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(22, stroke, 2, 14)}
        <path d="M14,10 L50,17 L50,27 L14,34 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        {pipe(22, stroke, 50, 62)}
        {arrowRight(24, 22, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'fit-rain-cap', label: '防雨帽', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '放空管防雨帽，防雨水进入', sw: 64, sh: 64,
    render: ({ stroke }) => (
      <g>
        <line x1={32} y1={34} x2={32} y2={60} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={32} y1={34} x2={32} y2={60} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M14,32 L32,10 L50,32" fill="none" stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={20} y1={34} x2={44} y2={34} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'fit-pipe-cap', label: '管帽', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '管端封头帽，焊接封堵管口', sw: 64, sh: 40,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(20, stroke, 4, 40)}
        <path d="M40,6 A14,14 0 0 1 40,34 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: 'fit-open-funnel', label: '敞开漏斗', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '敞开式漏斗，常压接管加料', sw: 64, sh: 64,
    render: ({ stroke }) => (
      <g>
        {arrowDown(32, 10, stroke, 5)}
        <path d="M16,22 L30,40 L30,60 M48,22 L34,40 L34,60" fill="none" stroke={stroke} strokeWidth={SW_MAIN} strokeLinecap="round" />
      </g>
    ),
  },
  {
    id: 'fit-closed-funnel', label: '闭口漏斗', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '闭口漏斗带盖，避免介质挥发', sw: 64, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        {arrowDown(32, 10, stroke, 5)}
        <path d="M16,24 H48 L36,42 V60 H28 V42 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: 'fit-normally-open', label: '常开', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '常开状态标识（实心圆点）', sw: 48, sh: 64,
    render: ({ stroke }) => (
      <g>
        <circle cx={24} cy={10} r={5} fill={stroke} stroke="none" />
        <line x1={24} y1={15} x2={24} y2={52} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={24} y1={15} x2={24} y2={52} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={26} x2={38} y2={26} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={52} x2={38} y2={52} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={26} x2={10} y2={52} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={38} y1={26} x2={38} y2={52} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'fit-normally-closed', label: '常关', group: 'fitting', standard: 'HG/T 20519.4-92',
    desc: '常关状态标识（空心圆圈）', sw: 48, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={24} cy={10} r={5} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={15} x2={24} y2={52} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={24} y1={15} x2={24} y2={52} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={26} x2={38} y2={26} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={52} x2={38} y2={52} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={26} x2={10} y2={52} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={38} y1={26} x2={38} y2={52} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },

  // ================= 设备（HG/T 20519.31-92） =================
  {
    id: 'eq-packed-column', label: '填料塔', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '填料塔 T——塔内填料提供气液接触面', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M14,22 Q14,10 24,10 Q34,10 34,22 V76 Q34,88 24,88 Q14,88 14,76 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={10} x2={24} y2={3} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={88} x2={24} y2={94} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={14} y1={36} x2={34} y2={36} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={14} y1={64} x2={34} y2={64} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={15} y1={38} x2={33} y2={62} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={33} y1={38} x2={15} y2={62} stroke={stroke} strokeWidth={SW_THIN} />
        {arrowDown(24, 0.5, stroke, 2.6)}
      </g>
    ),
  },
  {
    id: 'eq-tray-column', label: '板式塔', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '板式塔 T——塔盘逐级传质', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M14,22 Q14,10 24,10 Q34,10 34,22 V76 Q34,88 24,88 Q14,88 14,76 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={10} x2={24} y2={3} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={88} x2={24} y2={94} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={15} y1={36} x2={33} y2={36} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={15} y1={50} x2={33} y2={50} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={15} y1={64} x2={33} y2={64} stroke={stroke} strokeWidth={SW_THIN} />
        {arrowDown(24, 0.5, stroke, 2.6)}
      </g>
    ),
  },
  {
    id: 'eq-spray-column', label: '喷淋塔', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '喷淋塔 T——顶部喷淋气液逆流接触', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M14,22 Q14,10 24,10 Q34,10 34,22 V76 Q34,88 24,88 Q14,88 14,76 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={10} x2={24} y2={3} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={88} x2={24} y2={94} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points={`${17},22 ${31},22 ${24},32`} fill={fill} stroke={stroke} strokeWidth={SW_THIN} strokeLinejoin="round" />
        {arrowDown(24, 40, stroke, 4)}
        {arrowDown(24, 54, stroke, 4)}
        {arrowDown(24, 0.5, stroke, 2.6)}
      </g>
    ),
  },
  {
    id: 'eq-fixed-bed-reactor', label: '固定床反应器', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '固定床反应器 R——催化剂床层静止装填', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M12,20 Q12,8 24,8 Q36,8 36,20 V78 Q36,90 24,90 Q12,90 12,78 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={8} x2={24} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={90} x2={24} y2={95} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={12} y1={6} x2={12} y2={12} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={36} y1={6} x2={36} y2={12} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={12} y1={34} x2={36} y2={34} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={12} y1={66} x2={36} y2={66} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={13} y1={36} x2={35} y2={64} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={35} y1={36} x2={13} y2={64} stroke={stroke} strokeWidth={SW_THIN} />
        {arrowDown(24, 0.5, stroke, 2.6)}
      </g>
    ),
  },
  {
    id: 'eq-fluidized-bed', label: '沸腾床反应器', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '沸腾（流化）床反应器 R——催化剂呈流化态', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M12,20 Q12,8 24,8 Q36,8 36,20 V78 Q36,90 24,90 Q12,90 12,78 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={8} x2={24} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={90} x2={24} y2={95} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={20} cy={42} r={3.6} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={29} cy={52} r={3.6} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={19} cy={60} r={3.6} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        {arrowDown(24, 0.5, stroke, 2.6)}
      </g>
    ),
  },
  {
    id: 'eq-stirred-reactor', label: '反应釜', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '机械搅拌反应釜 R——M 电机驱动搅拌桨', sw: 56, sh: 88,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M16,22 Q16,12 28,12 Q40,12 40,22 V70 Q40,80 28,80 Q16,80 16,70 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={28} cy={8} r={7} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 8.5, 'M', stroke, 10)}
        <line x1={28} y1={15} x2={28} y2={56} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={20} y1={62} x2={36} y2={56} stroke={stroke} strokeWidth={SW_MAIN} strokeLinecap="round" />
        <line x1={20} y1={56} x2={36} y2={62} stroke={stroke} strokeWidth={SW_MAIN} strokeLinecap="round" />
        <path d="M12,30 V66 Q12,84 28,84 Q44,84 44,66 V30" fill="none" stroke={stroke} strokeWidth={SW_THIN} strokeDasharray="5 3" />
      </g>
    ),
  },
  {
    id: 'eq-tubular-reactor', label: '列管式反应器', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '列管式反应器 R——管束内装填催化剂', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M12,20 Q12,8 24,8 Q36,8 36,20 V78 Q36,90 24,90 Q12,90 12,78 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={8} x2={24} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={90} x2={24} y2={95} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={17} y1={32} x2={17} y2={68} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={24} y1={32} x2={24} y2={68} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={31} y1={32} x2={31} y2={68} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={13} y1={32} x2={35} y2={32} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={13} y1={68} x2={35} y2={68} stroke={stroke} strokeWidth={SW_THIN} />
        {arrowDown(24, 0.5, stroke, 2.6)}
      </g>
    ),
  },
  {
    id: 'eq-fixed-sheet-exchanger', label: '固定管板换热器', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '固定管板换热器 E——管束两端固定', sw: 96, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={14} width={80} height={20} rx={10} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={14} x2={26} y2={6} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={70} y1={34} x2={70} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={8} y1={40} x2={8} y2={47} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={16} y1={14} x2={16} y2={34} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={80} y1={14} x2={80} y2={34} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={16} y1={21} x2={80} y2={21} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={16} y1={27} x2={80} y2={27} stroke={stroke} strokeWidth={SW_THIN} />
        {arrowRight(48, 10, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'eq-u-tube-exchanger', label: 'U 形管换热器', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: 'U 形管换热器 E——热补偿能力强', sw: 96, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={14} width={80} height={20} rx={10} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={14} x2={26} y2={6} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={70} y1={34} x2={70} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={8} y1={40} x2={8} y2={47} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={16} y1={14} x2={16} y2={34} stroke={stroke} strokeWidth={SW_THIN} />
        <path d="M20,18 V24 Q20,30 26,30 H66 Q72,30 72,24 V18" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        {arrowRight(48, 10, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'eq-floating-head-exchanger', label: '浮头换热器', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '浮头换热器 E——自由端补偿热膨胀', sw: 96, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={14} width={80} height={20} rx={10} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={14} x2={26} y2={6} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={70} y1={34} x2={70} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={8} y1={40} x2={8} y2={47} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={16} y1={14} x2={16} y2={34} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={66} y1={15} x2={66} y2={33} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={70} y1={15} x2={70} y2={33} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={16} y1={21} x2={66} y2={21} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={16} y1={27} x2={66} y2={27} stroke={stroke} strokeWidth={SW_THIN} />
        {arrowRight(44, 10, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'eq-double-pipe-exchanger', label: '套管换热器', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '套管换热器 E——内外套管逆流传热', sw: 96, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={14} width={80} height={20} rx={10} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={14} x2={26} y2={6} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={70} y1={34} x2={70} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={8} y1={40} x2={8} y2={47} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M16,20 H72 M16,28 H72" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <path d="M72,20 Q78,20 78,24 Q78,28 72,28" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={16} y1={14} x2={16} y2={34} stroke={stroke} strokeWidth={SW_THIN} />
        {arrowRight(48, 10, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'eq-storage-tank', label: '储罐', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '立式储罐 T——拱顶圆筒罐，液态物料储存', sw: 64, sh: 80,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M14,18 Q14,8 32,8 Q50,8 50,18 L50,66 L14,66 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={32} y1={8} x2={32} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={17} y1={30} x2={47} y2={30} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={10} y1={72} x2={54} y2={72} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={14} y1={66} x2={11} y2={72} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={50} y1={66} x2={53} y2={72} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-horiz-vessel', label: '卧式容器', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '卧式容器 V——双鞍座支承，气液分离/缓冲', sw: 84, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={12} width={68} height={26} rx={13} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={42} y1={12} x2={42} y2={4} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={20} y1={38} x2={18} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={64} y1={38} x2={66} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={12} y1={44} x2={72} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={25} x2={60} y2={25} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'eq-furnace', label: '加热炉', group: 'equipment', standard: 'HG/T 20519.31-92',
    desc: '加热炉 B——辐射段+对流段，顶部烟囱排烟', sw: 64, sh: 88,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={10} y={38} width={44} height={40} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={58} x2={54} y2={58} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={17} y1={64} x2={17} y2={76} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={25} y1={64} x2={25} y2={76} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={33} y1={64} x2={33} y2={76} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={41} y1={64} x2={41} y2={76} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={26} y1={38} x2={26} y2={10} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={38} y1={38} x2={38} y2={10} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={10} x2={38} y2={10} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={32} y1={10} x2={32} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={6} y1={78} x2={58} y2={78} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },

  // ================= 液体传输设备（HG/T 20519.31-92，泵/压缩机/风机类） =================
  {
    id: 'eq-centrifugal-pump', label: '离心泵', group: 'pump', standard: 'HG/T 20519.31-92',
    desc: '离心泵 P——叶轮旋转离心输送液体，轴向吸入径向排出', sw: 56, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={2} y1={20} x2={15} y2={20} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={2} y1={20} x2={15} y2={20} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(5, 20, stroke, 3.2)}
        <line x1={28} y1={7} x2={28} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={28} cy={20} r={13} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={21.5} y1={31.3} x2={15} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={34.5} y1={31.3} x2={41} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={44} x2={46} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-reciprocating-pump', label: '往复泵', group: 'pump', standard: 'HG/T 20519.31-92',
    desc: '往复泵 P——柱塞往复挤压输液（正位移泵）', sw: 48, sh: 60,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={2} y1={45} x2={18} y2={45} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={2} y1={45} x2={18} y2={45} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(8, 45, stroke, 3.2)}
        <line x1={30} y1={34} x2={46} y2={34} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(38, 34, stroke, 3.2)}
        <rect x={18} y={30} width={12} height={20} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={19.5} y1={38} x2={28.5} y2={38} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={24} y1={30} x2={24} y2={14} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={16} y1={14} x2={32} y2={14} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={18} y1={50} x2={15} y2={56} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={30} y1={50} x2={33} y2={56} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={11} y1={56} x2={37} y2={56} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-gear-pump', label: '齿轮泵', group: 'pump', standard: 'HG/T 20519.31-92',
    desc: '齿轮泵 P——双齿轮啮合挤压输液（正位移泵）', sw: 56, sh: 52,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={2} y1={29} x2={10} y2={29} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={46} y1={29} x2={54} y2={29} stroke={stroke} strokeWidth={SW_MAIN} />
        <rect x={10} y={16} width={36} height={26} rx={5} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={22} cy={29} r={6.5} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={34} cy={29} r={6.5} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={22} cy={29} r={1.4} fill={stroke} stroke="none" />
        <circle cx={34} cy={29} r={1.4} fill={stroke} stroke="none" />
        <line x1={16} y1={42} x2={13} y2={48} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={40} y1={42} x2={43} y2={48} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={9} y1={48} x2={47} y2={48} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-vacuum-pump', label: '真空泵', group: 'pump', standard: 'HG/T 20519.31-92',
    desc: '真空泵 P——偏心叶轮抽吸形成负压（水环式）', sw: 56, sh: 52,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={2} y1={22} x2={14} y2={22} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={28} y1={8} x2={28} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={28} cy={22} r={14} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={32.5} cy={22} r={6.5} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={32.5} y1={15.5} x2={32.5} y2={8.7} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={32.5} y1={28.5} x2={32.5} y2={35.3} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={20} y1={33.5} x2={15} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={36} y1={33.5} x2={41} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={44} x2={46} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-compressor', label: '压缩机', group: 'pump', standard: 'HG/T 20519.31-92',
    desc: '压缩机 C——梯形缸体，气体压缩升压输送', sw: 64, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={2} y1={24} x2={8} y2={24} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={52} y1={24} x2={62} y2={24} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points="8,10 52,19 52,29 8,38" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: 'eq-blower', label: '鼓风机', group: 'pump', standard: 'HG/T 20519.31-92',
    desc: '鼓风机 F——离心式叶片低压比送风，蜗壳切向排气', sw: 60, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={30} y1={41} x2={30} y2={50} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={30} cy={26} r={15} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M30,26 Q38,18 45,21" fill="none" stroke={stroke} strokeWidth={SW_THIN} strokeLinecap="round" />
        <path d="M30,26 Q22,34 15,31" fill="none" stroke={stroke} strokeWidth={SW_THIN} strokeLinecap="round" />
        <circle cx={30} cy={26} r={2.2} fill={stroke} stroke="none" />
        <polyline points="40.6,15.4 46,10 46,2" fill="none" stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: 'eq-fan', label: '风机', group: 'pump', standard: 'HG/T 20519.31-92',
    desc: '风机 F——轴流式四叶风轮，管道通风送风', sw: 52, sh: 52,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={26} cy={26} r={14} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={26} x2={35.9} y2={16.1} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={26} y1={26} x2={16.1} y2={16.1} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={26} y1={26} x2={16.1} y2={35.9} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={26} y1={26} x2={35.9} y2={35.9} stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={26} cy={26} r={2.5} fill={stroke} stroke="none" />
      </g>
    ),
  },
]

export const STD_SYMBOL_MAP: Record<string, StdSymbol> = Object.fromEntries(STD_SYMBOLS.map((s) => [s.id, s]))

export const STD_GROUP_LABEL: Record<StdSymbolGroup, string> = {
  instrument: '仪表', valve: '阀门', fitting: '管件', equipment: '设备', pump: '液体传输设备',
}
export const STD_GROUP_ORDER: StdSymbolGroup[] = ['equipment', 'pump', 'valve', 'instrument', 'fitting']

/** 缩放描边恒定（vector-effect 不继承，用 CSS 类统一作用；text 不受影响）+ 图元库分类展开动画 */
export function StdSymbolStyle() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html:
          '.pid-std :is(path,line,polyline,polygon,circle,ellipse,rect){vector-effect:non-scaling-stroke}' +
          '@keyframes libExpand{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}' +
          '.lib-expand{animation:libExpand .18s ease-out}',
      }}
    />
  )
}

/** 画布渲染：设计空间 → 实例包围盒缩放；未知 stdId 兜底虚线矩形（防数据异常不可见） */
export function StdSymbolShape({ id, x, y, w, h, stroke, fill }: {
  id?: string; x: number; y: number; w: number; h: number; stroke: string; fill: string
}) {
  const sym = id ? STD_SYMBOL_MAP[id] : undefined
  if (!sym) {
    return (
      <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke={stroke} strokeWidth={1.4} strokeDasharray="6 4" />
    )
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${w / sym.sw} ${h / sym.sh})`} className="pid-std">
      {sym.render({ stroke, fill })}
    </g>
  )
}

/** 缩略图（宫格/悬停卡复用）：viewBox=设计空间 */
export function StdSymbolThumb({ id, className, stroke = '#57534e' }: {
  id: string; className?: string; stroke?: string
}) {
  const sym = STD_SYMBOL_MAP[id]
  if (!sym) return null
  return (
    <svg viewBox={`0 0 ${sym.sw} ${sym.sh}`} className={className} aria-hidden="true">
      <g className="pid-std">
        {sym.render({ stroke, fill: '#fff' })}
      </g>
    </svg>
  )
}
