// ============ 内建图元 · 四、仪表与控制图元（17 符号，ISA-5.1 · HG/T 20519.4-92） ============
// 仪表气泡(4) / 常用回路(8) / 信号线(5)
// ISA-5.1：字母代号 = 首位字母（被测变量）+ 后续字母（功能），如 PIC-2105 = 压力指示控制器 2105 回路
import { SW_MAIN, SW_THIN, SW_PAD, vline, symText, bubble } from './primitives'
import type { StdSymbol } from './types'

/** 常用回路气泡（底部带过程接口短线） */
function loopBubble(id: string, label: string, text: string, desc: string): StdSymbol {
  return {
    id, label, major: 'instrument', sub: 'in-loop', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc, sw: 36, sh: 44,
    render: ({ stroke }) => (
      <g>
        {bubble(18, 16, 13, text, stroke, 'field', text.length > 2 ? 8.5 : 10)}
        <line x1={18} y1={29} x2={18} y2={40} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  }
}

export const INSTRUMENT_SYMBOLS: StdSymbol[] = [
  // ================= 仪表气泡（安装位置） =================
  {
    id: 'in-field', label: '现场仪表', major: 'instrument', sub: 'in-bubble', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc: '现场安装仪表——圆圈，就地安装（双击改位号）', sw: 32, sh: 32,
    render: ({ stroke }) => bubble(16, 16, 12, '', stroke, 'field'),
  },
  {
    id: 'in-panel', label: '盘装仪表', major: 'instrument', sub: 'in-bubble', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc: '盘面安装仪表——圆圈加横线，控制室盘装（双击改位号）', sw: 32, sh: 32,
    render: ({ stroke }) => bubble(16, 16, 12, '', stroke, 'panel'),
  },
  {
    id: 'in-dcs', label: 'DCS 功能', major: 'instrument', sub: 'in-bubble', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc: 'DCS 共享显示/共享控制——圆圈加虚线（双击改位号）', sw: 32, sh: 32,
    render: ({ stroke }) => bubble(16, 16, 12, '', stroke, 'dcs'),
  },
  {
    id: 'in-sis', label: 'SIS 系统', major: 'instrument', sub: 'in-bubble', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc: '安全仪表系统 SIS——方块内菱形，联锁/紧急切断（双击改位号）', sw: 36, sh: 36,
    render: ({ stroke }) => bubble(18, 18, 13, '', stroke, 'sis'),
  },

  // ================= 常用回路（首位字母=被测变量，后续字母=功能） =================
  loopBubble('in-fi', '流量指示 FI', 'FI', 'FI 流量指示——F 流量 + I 指示，就地流量显示'),
  loopBubble('in-ft', '流量变送 FT', 'FT', 'FT 流量变送——F 流量 + T 变送，输出流量信号'),
  loopBubble('in-pi', '压力指示 PI', 'PI', 'PI 压力指示——P 压力 + I 指示，就地压力显示'),
  loopBubble('in-pt', '压力变送 PT', 'PT', 'PT 压力变送——P 压力 + T 变送，输出压力信号'),
  loopBubble('in-ti', '温度指示 TI', 'TI', 'TI 温度指示——T 温度 + I 指示，就地温度显示'),
  loopBubble('in-tic', '温度调节 TIC', 'TIC', 'TIC 温度调节——T 温度 + I 指示 + C 控制，温度控制回路'),
  loopBubble('in-li', '液位指示 LI', 'LI', 'LI 液位指示——L 液位 + I 指示，就地液位显示'),
  loopBubble('in-lt', '液位变送 LT', 'LT', 'LT 液位变送——L 液位 + T 变送，输出液位信号'),

  // ================= 信号线 =================
  {
    id: 'in-sig-electric', label: '电信号', major: 'instrument', sub: 'in-signal', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc: '电信号线——虚线表示电动信号（4-20mA 等）', sw: 72, sh: 18,
    render: ({ stroke }) => (
      <g>
        <line x1={4} y1={9} x2={68} y2={9} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={9} x2={68} y2={9} stroke={stroke} strokeWidth={SW_MAIN} strokeDasharray="8 5" />
      </g>
    ),
  },
  {
    id: 'in-sig-pneumatic', label: '气信号', major: 'instrument', sub: 'in-signal', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc: '气信号线——双斜线表示气动信号（0.02-0.1MPa）', sw: 72, sh: 20,
    render: ({ stroke }) => (
      <g>
        <line x1={4} y1={12} x2={68} y2={12} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={12} x2={68} y2={12} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={4} x2={15} y2={12} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={14} y1={4} x2={19} y2={12} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={30} y1={4} x2={35} y2={12} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={34} y1={4} x2={39} y2={12} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={50} y1={4} x2={55} y2={12} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={54} y1={4} x2={59} y2={12} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'in-sig-capillary', label: '毛细管', major: 'instrument', sub: 'in-signal', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc: '毛细管线——× marks 温包毛细管传递', sw: 72, sh: 20,
    render: ({ stroke }) => (
      <g>
        <line x1={4} y1={12} x2={68} y2={12} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={12} x2={68} y2={12} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={12.5} y1={6} x2={19.5} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={19.5} y1={6} x2={12.5} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={32.5} y1={6} x2={39.5} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={39.5} y1={6} x2={32.5} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={52.5} y1={6} x2={59.5} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={59.5} y1={6} x2={52.5} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'in-sig-bus', label: '总线', major: 'instrument', sub: 'in-signal', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc: '总线/干线——粗线+分支接头，现场总线网络', sw: 72, sh: 26,
    render: ({ stroke }) => (
      <g>
        <line x1={4} y1={16} x2={68} y2={16} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={16} x2={68} y2={16} stroke={stroke} strokeWidth={3} />
        <line x1={18} y1={16} x2={18} y2={8} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={18} cy={5.5} r={2.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={36} y1={16} x2={36} y2={8} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={36} cy={5.5} r={2.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={54} y1={16} x2={54} y2={8} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={54} cy={5.5} r={2.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'in-sig-soft', label: '数据链', major: 'instrument', sub: 'in-signal', standard: 'ISA-5.1 · HG/T 20519.4-92',
    desc: '软件/数据链——圆圈串接线表示系统内部数据连接', sw: 72, sh: 20,
    render: ({ stroke }) => (
      <g>
        <line x1={4} y1={10} x2={68} y2={10} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={10} x2={68} y2={10} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={16} cy={10} r={3.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={36} cy={10} r={3.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={56} cy={10} r={3.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
]
