// ============ 内建图元 · 五、电气与安全图元（15 符号，GB/T 4728 · IEC 60617） ============
// 电气设备(6) / 安全消防(5) / 防护标识(4)
import { SW_MAIN, SW_THIN, vline, symText, spring, flame } from './primitives'
import type { StdSymbol } from './types'

export const ELECTRIC_SYMBOLS: StdSymbol[] = [
  // ================= 电气设备 =================
  {
    id: 'el-motor', label: '电机', major: 'electric', sub: 'el-power', standard: 'GB/T 4728 · IEC 60617',
    desc: '电动机 M——泵/风机等旋转设备驱动', sw: 48, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={24} cy={22} r={13} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(24, 22.5, 'M', stroke, 12)}
        <line x1={37} y1={22} x2={45} y2={22} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={18} y1={34} x2={15} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={30} y1={34} x2={33} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={42} x2={38} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'el-mcc', label: 'MCC 控制中心', major: 'electric', sub: 'el-power', standard: 'GB/T 4728 · IEC 60617',
    desc: 'MCC 马达控制中心——电机回路集中配电与保护', sw: 56, sh: 40,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={6} y={8} width={44} height={24} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 20, 'MCC', stroke, 11)}
        <line x1={16} y1={32} x2={16} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={28} y1={32} x2={28} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={40} y1={32} x2={40} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'el-vfd', label: '变频器', major: 'electric', sub: 'el-power', standard: 'GB/T 4728 · IEC 60617',
    desc: '变频器 VFD——交流→直流→变频调速', sw: 56, sh: 44,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={8} width={40} height={26} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(20, 16, '~', stroke, 12)}
        {symText(36, 27, '=', stroke, 12)}
        <line x1={23} y1={26} x2={33} y2={15} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={20} y1={34} x2={20} y2={40} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={36} y1={34} x2={36} y2={40} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'el-heater', label: '电加热器', major: 'electric', sub: 'el-power', standard: 'GB/T 4728 · IEC 60617',
    desc: '电加热器 EH——电阻元件加热管内介质', sw: 56, sh: 44,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={10} width={40} height={24} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {spring(14, 22, 42, 22, 3.6, 8, stroke)}
        <line x1={20} y1={34} x2={20} y2={40} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={36} y1={34} x2={36} y2={40} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'el-ups', label: 'UPS 电源', major: 'electric', sub: 'el-power', standard: 'GB/T 4728 · IEC 60617',
    desc: 'UPS 不间断电源——仪表/控制系统保安电源', sw: 56, sh: 40,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={6} y={8} width={44} height={24} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 20, 'UPS', stroke, 10.5)}
        <line x1={16} y1={32} x2={16} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={40} y1={32} x2={40} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'el-ground', label: '接地', major: 'electric', sub: 'el-power', standard: 'GB/T 4728 · IEC 60617',
    desc: '接地符号 PE——设备/管道静电接地', sw: 40, sh: 44,
    render: ({ stroke }) => (
      <g>
        <line x1={20} y1={4} x2={20} y2={24} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={8} y1={24} x2={32} y2={24} stroke={stroke} strokeWidth={2.4} />
        <line x1={12} y1={30} x2={28} y2={30} stroke={stroke} strokeWidth={2.2} />
        <line x1={16} y1={36} x2={24} y2={36} stroke={stroke} strokeWidth={2} />
      </g>
    ),
  },

  // ================= 安全消防 =================
  {
    id: 'el-gas-det', label: '可燃气体检测器', major: 'electric', sub: 'el-fire', standard: 'GB/T 4728 · 常用安全图例',
    desc: '可燃气体检测器 GD——泄漏监测报警联锁', sw: 56, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={10} y={22} width={36} height={22} rx={4} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 33, 'GD', stroke, 10.5)}
        <path d="M18,16 Q24,8 30,16" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <path d="M23,11 Q27,6 31,11" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'el-flame-det', label: '火焰检测器', major: 'electric', sub: 'el-fire', standard: 'GB/T 4728 · 常用安全图例',
    desc: '火焰检测器 FD——火情监测报警联锁', sw: 56, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={10} y={26} width={36} height={20} rx={4} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 36, 'FD', stroke, 10.5)}
        {flame(28, 16, 8, stroke)}
      </g>
    ),
  },
  {
    id: 'el-hydrant', label: '消火栓', major: 'electric', sub: 'el-fire', standard: 'GB/T 4728 · 常用安全图例',
    desc: '消火栓 FH——消防水系统取水点', sw: 56, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={12} y={14} width={32} height={34} rx={3} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 32, '消', stroke, 18)}
      </g>
    ),
  },
  {
    id: 'el-foam', label: '泡沫灭火', major: 'electric', sub: 'el-fire', standard: 'GB/T 4728 · 常用安全图例',
    desc: '泡沫灭火系统——泡沫液储罐/发生器', sw: 56, sh: 44,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={10} width={40} height={24} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 22, '泡沫', stroke, 12)}
      </g>
    ),
  },
  {
    id: 'el-dcp', label: '干粉灭火', major: 'electric', sub: 'el-fire', standard: 'GB/T 4728 · 常用安全图例',
    desc: '干粉灭火系统——干粉储罐/释放装置', sw: 56, sh: 44,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={10} width={40} height={24} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 22, '干粉', stroke, 12)}
      </g>
    ),
  },

  // ================= 防护标识 =================
  {
    id: 'el-ex-mark', label: '防爆等级', major: 'electric', sub: 'el-protect', standard: 'GB/T 4728 · 常用安全图例',
    desc: '防爆等级标注 Ex——爆炸危险区域设备选型（放置后双击改文字）', sw: 52, sh: 56,
    render: ({ stroke }) => (
      <g>
        <rect x={9} y={12} width={34} height={34} rx={6} fill="none" stroke={stroke} strokeWidth={SW_MAIN} strokeDasharray="5 3" />
        {symText(26, 29, 'Ex', stroke, 13)}
      </g>
    ),
  },
  {
    id: 'el-ip-mark', label: '防护等级', major: 'electric', sub: 'el-protect', standard: 'GB/T 4728 · 常用安全图例',
    desc: '防护等级标注 IP——外壳防尘防水等级（放置后双击改文字）', sw: 56, sh: 40,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={8} width={40} height={24} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 20, 'IP65', stroke, 11)}
      </g>
    ),
  },
  {
    id: 'el-warning', label: '安全警示', major: 'electric', sub: 'el-protect', standard: 'GB/T 2894 · 安全标志',
    desc: '安全警示标识——当心火灾/爆炸/坠落等危险提示', sw: 48, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        <polygon points="24,7 43,39 5,39" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        {symText(24, 31, '!', stroke, 14, 700)}
      </g>
    ),
  },
  {
    id: 'el-eyewash', label: '洗眼器', major: 'electric', sub: 'el-protect', standard: 'GB/T 3814.4 · 安全设施',
    desc: '洗眼器 EW——紧急喷淋洗眼安全设施', sw: 56, sh: 64,
    render: ({ stroke }) => (
      <g>
        <line x1={28} y1={4} x2={28} y2={16} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={14} y1={16} x2={42} y2={16} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={18} y1={16} x2={18} y2={26} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={38} y1={16} x2={38} y2={26} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M12,26 Q18,34 24,26" fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M32,26 Q38,34 44,26" fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M10,44 Q28,56 46,44" fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={28} y1={50} x2={28} y2={58} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
]
