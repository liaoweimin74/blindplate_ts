// ============ 内建图元 · 三、阀门图元（28 符号，EN ISO 10628 · HG/T 20519.4-92） ============
// 截断阀(7) / 止回阀(3) / 调节阀(3) / 安全泄放阀(4) / 特殊阀(5) / 执行机构(6)
import {
  SW_MAIN, SW_THIN, SW_PAD, pipe, vline, arrowRight, arrowLeft, symText, bowtie, spring,
  actDiaphragm, actMotor, actSolenoid, actHandwheel, actPiston, actLever,
} from './primitives'
import type { StdSymbol } from './types'

export const VALVE_SYMBOLS: StdSymbol[] = [
  // ================= 截断阀 =================
  {
    id: 'vl-gate', label: '闸阀', major: 'valve', sub: 'vl-shutoff', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '闸阀 Z——空心对顶三角，全开全关低阻力', sw: 64, sh: 36,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(20, stroke)}
        {bowtie(32, 20, 15, 9.5, stroke, fill, false)}
      </g>
    ),
  },
  {
    id: 'vl-globe', label: '截止阀', major: 'valve', sub: 'vl-shutoff', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '截止阀 J——实心对顶三角，截断与调节流通', sw: 64, sh: 36,
    render: ({ stroke }) => (
      <g>
        {pipe(20, stroke)}
        {bowtie(32, 20, 15, 9.5, stroke, '#fff', true)}
      </g>
    ),
  },
  {
    id: 'vl-ball', label: '球阀', major: 'valve', sub: 'vl-shutoff', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '球阀 Q——球芯 90° 旋转启闭，低阻力快开', sw: 64, sh: 36,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(20, stroke)}
        {bowtie(32, 20, 15, 9.5, stroke, fill, false)}
        <circle cx={32} cy={20} r={5.2} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'vl-butterfly', label: '蝶阀', major: 'valve', sub: 'vl-shutoff', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '蝶阀 D——蝶板 90° 旋转，大口径低阻力截断', sw: 64, sh: 32,
    render: ({ stroke }) => (
      <g>
        {pipe(16, stroke)}
        <line x1={26} y1={8} x2={26} y2={24} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={38} y1={8} x2={38} y2={24} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={8} x2={38} y2={24} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'vl-plug', label: '旋塞阀', major: 'valve', sub: 'vl-shutoff', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '旋塞阀 X——锥形塞 90° 旋转启闭，快开', sw: 64, sh: 36,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(20, stroke)}
        {bowtie(32, 20, 15, 9.5, stroke, fill, false)}
        <circle cx={32} cy={20} r={3.4} fill={stroke} stroke="none" />
        <line x1={32} y1={10.5} x2={32} y2={5} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'vl-needle', label: '针型阀', major: 'valve', sub: 'vl-shutoff', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '针阀——实心针状阀芯，微调与小口径切断', sw: 64, sh: 36,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(20, stroke)}
        {bowtie(32, 20, 15, 9.5, stroke, fill, false)}
        <polygon points="32,3 26.5,14 37.5,14" fill={stroke} stroke="none" />
        <line x1={32} y1={20} x2={32} y2={14} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'vl-diaphragm', label: '隔膜阀', major: 'valve', sub: 'vl-shutoff', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '隔膜阀 G——柔性膜片密封，适用腐蚀/含固介质', sw: 64, sh: 44,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(30, stroke)}
        <path d="M24,30 Q24,14 32,14 Q40,14 40,30" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={26} y1={22} x2={38} y2={22} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },

  // ================= 止回阀 =================
  {
    id: 'vl-check-lift', label: '升降式止回阀', major: 'valve', sub: 'vl-check', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '升降式止回阀 H——阀盘垂直升降，只允许单向流动', sw: 64, sh: 40,
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
    id: 'vl-check-swing', label: '旋启式止回阀', major: 'valve', sub: 'vl-check', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '旋启式止回阀 H——摇臂阀瓣旋启止回，水平管路常用', sw: 64, sh: 40,
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
    id: 'vl-check-wafer', label: '对夹式止回阀', major: 'valve', sub: 'vl-check', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '对夹式止回阀 H——薄型阀瓣夹装于两法兰间', sw: 64, sh: 32,
    render: ({ stroke }) => (
      <g>
        {pipe(16, stroke)}
        <line x1={26} y1={10} x2={26} y2={22} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={38} y1={10} x2={38} y2={22} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={32} y1={16} x2={23} y2={7} stroke={stroke} strokeWidth={SW_MAIN} strokeLinecap="round" />
        <circle cx={32} cy={16} r={1.8} fill={stroke} stroke="none" />
        {arrowRight(48, 16, stroke, 4.2)}
      </g>
    ),
  },

  // ================= 调节阀 =================
  {
    id: 'vl-control-pneu', label: '气动调节阀', major: 'valve', sub: 'vl-control', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '气动薄膜调节阀——膜头执行器接收气信号连续调节', sw: 64, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(38, stroke)}
        {bowtie(32, 38, 15, 9.5, stroke, fill, false)}
        {actDiaphragm(32, 28.5, stroke)}
      </g>
    ),
  },
  {
    id: 'vl-control-motor', label: '电动调节阀', major: 'valve', sub: 'vl-control', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '电动调节阀——M 电动执行器接收电信号连续调节', sw: 64, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(38, stroke)}
        {bowtie(32, 38, 15, 9.5, stroke, fill, false)}
        {actMotor(32, 28.5, stroke)}
      </g>
    ),
  },
  {
    id: 'vl-control-self', label: '自力式调节阀', major: 'valve', sub: 'vl-control', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '自力式调节阀——介质自身压力驱动，无需外部能源', sw: 64, sh: 62,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(38, stroke)}
        {bowtie(32, 38, 15, 9.5, stroke, fill, false)}
        {actDiaphragm(32, 28.5, stroke)}
        <path d="M58,38 V22 Q58,17 53,17 H42" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },

  // ================= 安全泄放阀 =================
  {
    id: 'vl-safety', label: '安全阀', major: 'valve', sub: 'vl-relief', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '弹簧安全阀 SV——超压自动起跳泄放保护设备', sw: 52, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={26} cy={10} r={8.5} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(26, 10.5, 'SV', stroke, 8.5)}
        <line x1={26} y1={18.5} x2={26} y2={30} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M17,25 L21,21 L26,25 L31,21 L35,25" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <polygon points="22,28 30,28 26,35" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={4} y1={44} x2={48} y2={44} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={44} x2={48} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={35} x2={26} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points="8,42 8,46 13,44" fill={stroke} stroke="none" />
      </g>
    ),
  },
  {
    id: 'vl-rupture', label: '爆破片', major: 'valve', sub: 'vl-relief', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '爆破片 PE——一次性爆破膜片超压泄放', sw: 64, sh: 40,
    render: ({ stroke }) => (
      <g>
        {pipe(20, stroke, 4, 26)}
        {pipe(20, stroke, 38, 60)}
        <line x1={26} y1={10} x2={26} y2={30} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={38} y1={10} x2={38} y2={30} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M26,22 Q32,12 38,22" fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'vl-breather', label: '呼吸阀', major: 'valve', sub: 'vl-relief', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '呼吸阀——罐顶压力/真空双向呼吸保护', sw: 56, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={28} y1={58} x2={28} y2={46} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={28} y1={58} x2={28} y2={46} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points="20,38 36,38 28,30" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points="20,22 36,22 28,30" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={28} y1={22} x2={28} y2={16} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M21,16 Q28,8 35,16" fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={36} y1={26} x2={46} y2={26} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(42, 26, stroke, 3.4)}
        <line x1={20} y1={34} x2={10} y2={34} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowLeft(15, 34, stroke, 3.4)}
      </g>
    ),
  },
  {
    id: 'vl-prv', label: '泄压阀', major: 'valve', sub: 'vl-relief', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '泄压阀 PRV——弹簧整定压力开启，侧向泄放', sw: 56, sh: 60,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(44, stroke, 4, 52)}
        <line x1={28} y1={44} x2={28} y2={40} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points="20,32 36,32 28,40" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points="20,24 36,24 28,32" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        {spring(28, 22, 28, 10, 3, 5, stroke, SW_MAIN)}
        <line x1={21} y1={10} x2={35} y2={10} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={36} y1={28} x2={48} y2={28} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(43, 28, stroke, 3.4)}
      </g>
    ),
  },

  // ================= 特殊阀 =================
  {
    id: 'vl-trap', label: '疏水阀', major: 'valve', sub: 'vl-special', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '蒸汽疏水阀 T——阻汽排水，自动排凝水', sw: 56, sh: 64,
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
  {
    id: 'vl-reducing', label: '减压阀', major: 'valve', sub: 'vl-special', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '减压阀——膜片式减压，出口压力恒定控制', sw: 56, sh: 64,
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
    id: 'vl-diverter', label: '换向阀', major: 'valve', sub: 'vl-special', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '换向阀——摆动阀瓣切换两路出口流向', sw: 64, sh: 56,
    render: ({ stroke }) => (
      <g>
        <line x1={32} y1={52} x2={32} y2={40} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={32} y1={52} x2={32} y2={40} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={32} cy={40} r={2} fill={stroke} stroke="none" />
        <line x1={32} y1={40} x2={18} y2={24} stroke={stroke} strokeWidth={SW_MAIN} strokeLinecap="round" />
        <line x1={32} y1={40} x2={46} y2={24} stroke={stroke} strokeWidth={SW_MAIN} strokeLinecap="round" />
        <line x1={18} y1={24} x2={18} y2={14} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={46} y1={24} x2={46} y2={14} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={30} x2={40} y2={36} stroke={stroke} strokeWidth={SW_THIN} />
        {vline(46, 24, 14, stroke)}
        {arrowRight(52, 19, stroke, 3.2)}
      </g>
    ),
  },
  {
    id: 'vl-three-way', label: '三通阀', major: 'valve', sub: 'vl-special', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '三通阀——三个流道汇合阀芯，混合或分流', sw: 64, sh: 52,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(32, stroke, 2, 16)}
        {pipe(32, stroke, 48, 62)}
        <line x1={32} y1={16} x2={32} y2={4} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={32} y1={16} x2={32} y2={4} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points="14,20 14,44 29.5,32" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points="50,20 50,44 34.5,32" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points="22,2 42,2 32,17.5" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: 'vl-four-way', label: '四通阀', major: 'valve', sub: 'vl-special', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '四通阀——四流道十字阀芯，换向切换用', sw: 64, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(32, stroke, 2, 16)}
        {pipe(32, stroke, 48, 62)}
        <line x1={32} y1={16} x2={32} y2={4} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={32} y1={16} x2={32} y2={4} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={32} y1={48} x2={32} y2={60} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={32} y1={48} x2={32} y2={60} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points="14,20 14,44 29.5,32" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points="50,20 50,44 34.5,32" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points="22,2 42,2 32,17.5" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points="22,62 42,62 32,46.5" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      </g>
    ),
  },

  // ================= 执行机构（可叠加在阀门上方单独放置） =================
  {
    id: 'vl-act-handwheel', label: '手轮机构', major: 'valve', sub: 'vl-actuator', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '手轮执行机构——手动操作阀门启闭/开度', sw: 44, sh: 52,
    render: ({ stroke }) => (
      <g>
        {pipe(44, stroke, 10, 34)}
        {actHandwheel(22, 44, stroke)}
      </g>
    ),
  },
  {
    id: 'vl-act-diaphragm', label: '气动薄膜机构', major: 'valve', sub: 'vl-actuator', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '气动薄膜执行机构——膜头气压驱动，故障安全位可标注', sw: 44, sh: 52,
    render: ({ stroke }) => (
      <g>
        {pipe(44, stroke, 10, 34)}
        {actDiaphragm(22, 44, stroke)}
      </g>
    ),
  },
  {
    id: 'vl-act-motor', label: '电动机构', major: 'valve', sub: 'vl-actuator', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '电动执行机构——M 电机驱动阀门连续调节', sw: 44, sh: 52,
    render: ({ stroke }) => (
      <g>
        {pipe(44, stroke, 10, 34)}
        {actMotor(22, 44, stroke)}
      </g>
    ),
  },
  {
    id: 'vl-act-solenoid', label: '电磁线圈', major: 'valve', sub: 'vl-actuator', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '电磁执行机构——通电励磁快开快关（两位式）', sw: 44, sh: 52,
    render: ({ stroke }) => (
      <g>
        {pipe(44, stroke, 10, 34)}
        {actSolenoid(22, 44, stroke)}
      </g>
    ),
  },
  {
    id: 'vl-act-piston', label: '活塞机构', major: 'valve', sub: 'vl-actuator', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '活塞执行机构——气缸活塞推力大，两位式切断阀常用', sw: 44, sh: 52,
    render: ({ stroke }) => (
      <g>
        {pipe(44, stroke, 10, 34)}
        {actPiston(22, 44, stroke)}
      </g>
    ),
  },
  {
    id: 'vl-act-lever', label: '弹簧杠杆', major: 'valve', sub: 'vl-actuator', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '弹簧杠杆执行机构——弹簧复位，失气/失电自动回位', sw: 44, sh: 52,
    render: ({ stroke }) => (
      <g>
        {pipe(44, stroke, 10, 34)}
        {actLever(22, 44, stroke)}
      </g>
    ),
  },
]
