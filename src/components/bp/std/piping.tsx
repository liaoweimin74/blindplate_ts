// ============ 内建图元 · 二、管道与管件图元（26 符号，EN ISO 10628 · HG/T 20519.4-92） ============
// 管道类型(6) / 连接与管件(10) / 管道附件(8) / 标注信息(2)
import { SW_MAIN, SW_THIN, SW_PAD, pipe, vline, arrowRight, arrowDown, symText } from './primitives'
import type { StdSymbol } from './types'

export const PIPING_SYMBOLS: StdSymbol[] = [
  // ================= 管道类型 =================
  {
    id: 'pp-line-proc', label: '工艺主管线', major: 'piping', sub: 'pp-line', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '工艺物料主管线——粗实线表示主要工艺管道', sw: 72, sh: 22,
    render: ({ stroke }) => pipe(12, stroke, 4, 68, 2.4),
  },
  {
    id: 'pp-line-utility', label: '公用工程管线', major: 'piping', sub: 'pp-line', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '公用工程管线——虚线表示蒸汽/氮气/水等辅助管道', sw: 72, sh: 22,
    render: ({ stroke }) => (
      <g>
        <line x1={4} y1={12} x2={68} y2={12} stroke="transparent" strokeWidth={SW_PAD} />
        <line x1={4} y1={12} x2={68} y2={12} stroke={stroke} strokeWidth={2.2} strokeDasharray="9 5" />
      </g>
    ),
  },
  {
    id: 'pp-line-trace', label: '伴热管', major: 'piping', sub: 'pp-line', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '伴热管——主管伴随蒸汽/电伴热管并绑扎保温', sw: 72, sh: 26,
    render: ({ stroke }) => (
      <g>
        {pipe(18, stroke, 4, 68, 2.2)}
        <line x1={4} y1={8} x2={68} y2={8} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={14} y1={8} x2={14} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={28} y1={8} x2={28} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={42} y1={8} x2={42} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={56} y1={8} x2={56} y2={18} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'pp-line-jacket', label: '夹套管', major: 'piping', sub: 'pp-line', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '夹套管——外套管蒸汽伴热，端部封闭', sw: 72, sh: 26,
    render: ({ stroke }) => (
      <g>
        {pipe(13, stroke, 6, 66, 2.2)}
        <line x1={6} y1={5} x2={66} y2={5} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={6} y1={21} x2={66} y2={21} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={6} y1={5} x2={6} y2={21} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={66} y1={5} x2={66} y2={21} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'pp-line-insul', label: '保温管', major: 'piping', sub: 'pp-line', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '保温管——管外保温层，斜线剖面表示保温材料', sw: 72, sh: 26,
    render: ({ stroke }) => (
      <g>
        {pipe(18, stroke, 4, 68, 2.2)}
        <line x1={4} y1={8} x2={68} y2={8} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={8} y1={16} x2={13} y2={10} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={18} y1={16} x2={23} y2={10} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={28} y1={16} x2={33} y2={10} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={38} y1={16} x2={43} y2={10} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={48} y1={16} x2={53} y2={10} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={58} y1={16} x2={63} y2={10} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'pp-line-hose', label: '软管', major: 'piping', sub: 'pp-line', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '软管——波纹挠性连接（临时/移动工位）', sw: 72, sh: 22,
    render: ({ stroke }) => (
      <g>
        <path d="M4,12 Q9,3 14,12 T24,12 T34,12 T44,12 T54,12 T64,12" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
        <line x1={4} y1={12} x2={64} y2={12} stroke="transparent" strokeWidth={SW_PAD} />
      </g>
    ),
  },

  // ================= 连接与管件 =================
  {
    id: 'pp-flange', label: '法兰', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '法兰连接——双横线表示可拆卸法兰对', sw: 64, sh: 32,
    render: ({ stroke }) => (
      <g>
        {pipe(16, stroke, 4, 60)}
        <line x1={30} y1={6} x2={30} y2={26} stroke={stroke} strokeWidth={2.2} />
        <line x1={34} y1={6} x2={34} y2={26} stroke={stroke} strokeWidth={2.2} />
      </g>
    ),
  },
  {
    id: 'pp-thread', label: '螺纹连接', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '螺纹连接——单横线表示螺纹/活接头', sw: 64, sh: 32,
    render: ({ stroke }) => (
      <g>
        {pipe(16, stroke, 4, 60)}
        <line x1={32} y1={8} x2={32} y2={24} stroke={stroke} strokeWidth={2.2} />
      </g>
    ),
  },
  {
    id: 'pp-weld', label: '焊接连接', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '焊接连接——实心圆点表示焊缝', sw: 64, sh: 32,
    render: ({ stroke }) => (
      <g>
        {pipe(16, stroke, 4, 60)}
        <circle cx={32} cy={16} r={3} fill={stroke} stroke="none" />
      </g>
    ),
  },
  {
    id: 'pp-elbow', label: '弯头', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
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
    id: 'pp-tee', label: '三通', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
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
    id: 'pp-cross', label: '四通', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
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
    id: 'pp-reducer', label: '异径管', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
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
    id: 'pp-cap', label: '管帽', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '管端封头帽，焊接封堵管口', sw: 64, sh: 40,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(20, stroke, 4, 40)}
        <path d="M40,6 A14,14 0 0 1 40,34 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: 'pp-blind', label: '盲板', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '8 字盲板插板（运行位）——隔离/切断管段', sw: 64, sh: 40,
    render: ({ stroke }) => (
      <g>
        {pipe(20, stroke, 4, 26)}
        <line x1={32} y1={6} x2={32} y2={34} stroke={stroke} strokeWidth={3} />
        {pipe(20, stroke, 38, 60)}
      </g>
    ),
  },
  {
    id: 'pp-spectacle', label: '8字盲板', major: 'piping', sub: 'pp-joint', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '8 字盲板——实心侧切断，空心侧导通，翻转切换', sw: 72, sh: 44,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(22, stroke, 2, 18)}
        <circle cx={28} cy={22} r={9} fill={stroke} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={44} cy={22} r={9} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        {pipe(22, stroke, 54, 70)}
      </g>
    ),
  },

  // ================= 管道附件 =================
  {
    id: 'pp-sightglass', label: '视镜', major: 'piping', sub: 'pp-accessory', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '管道视镜——透明观察窗目视监视管内流动', sw: 72, sh: 36,
    render: ({ stroke }) => (
      <g>
        {pipe(18, stroke, 4, 24)}
        {pipe(18, stroke, 48, 68)}
        <line x1={24} y1={8} x2={24} y2={28} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={48} y1={8} x2={48} y2={28} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={36} cy={18} r={9} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M31,13 Q29,18 31,23" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'pp-y-strainer', label: 'Y型过滤器', major: 'piping', sub: 'pp-accessory', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: 'Y 型过滤器——Y 支腿滤网拦截管道杂质', sw: 72, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(14, stroke, 4, 68)}
        <line x1={32} y1={18} x2={46} y2={36} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M42,32 L58,32 L50,46 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={46} y1={36} x2={54} y2={36} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={48} y1={40} x2={53} y2={40} stroke={stroke} strokeWidth={SW_THIN} />
        {arrowRight(58, 14, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'pp-flame-arrest', label: '阻火器', major: 'piping', sub: 'pp-accessory', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '阻火器——波纹板阻火芯阻止火焰传播', sw: 72, sh: 40,
    render: ({ stroke }) => (
      <g>
        {pipe(20, stroke, 4, 18)}
        <rect x={18} y={8} width={36} height={24} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={12} x2={26} y2={28} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={32} y1={12} x2={32} y2={28} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={38} y1={12} x2={38} y2={28} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={44} y1={12} x2={44} y2={28} stroke={stroke} strokeWidth={SW_THIN} />
        {pipe(20, stroke, 54, 68)}
      </g>
    ),
  },
  {
    id: 'pp-ro', label: '限流孔板', major: 'piping', sub: 'pp-accessory', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '限流孔板 RO——锐孔节流限制流量/降均压', sw: 64, sh: 40,
    render: ({ stroke }) => (
      <g>
        {pipe(24, stroke, 4, 60)}
        {symText(32, 8, 'RO', stroke, 7.5)}
        <line x1={30} y1={13} x2={30} y2={35} stroke={stroke} strokeWidth={2.4} />
        <line x1={34} y1={13} x2={34} y2={35} stroke={stroke} strokeWidth={2.4} />
      </g>
    ),
  },
  {
    id: 'pp-mixer', label: '静态混合器', major: 'piping', sub: 'pp-accessory', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '静态混合器 SM——管内导流叶片混合介质', sw: 72, sh: 36,
    render: ({ stroke }) => (
      <g>
        {pipe(18, stroke, 4, 18)}
        <rect x={18} y={6} width={36} height={24} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M22,28 L32,8 M28,28 L38,8 M34,28 L44,8 M40,28 L50,8" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        {pipe(18, stroke, 54, 68)}
        {arrowRight(58, 18, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'pp-expansion', label: '补偿器', major: 'piping', sub: 'pp-accessory', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '波纹补偿器 EJ——吸收管道热位移', sw: 72, sh: 48,
    render: ({ stroke }) => (
      <g>
        {pipe(24, stroke, 4, 16)}
        <path d="M16,24 L21,13 L27,35 L33,13 L39,35 L45,13 L51,35 L56,24" fill="none" stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        {pipe(24, stroke, 56, 68)}
      </g>
    ),
  },
  {
    id: 'pp-sample', label: '取样口', major: 'piping', sub: 'pp-accessory', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '取样口——取样阀接取样冷却器/样瓶', sw: 64, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        {pipe(14, stroke, 4, 60)}
        {arrowRight(50, 14, stroke, 4)}
        <line x1={40} y1={18} x2={40} y2={24} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points="34,24 46,24 40,30" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points="34,36 46,36 40,30" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={40} y1={36} x2={40} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M40,47 C37,51 37,54 40,55 C43,54 43,51 40,47" fill={stroke} stroke="none" />
      </g>
    ),
  },
  {
    id: 'pp-vent', label: '放空/排凝', major: 'piping', sub: 'pp-accessory', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '放空/排凝口——导淋阀排放积液或放空', sw: 64, sh: 60,
    render: ({ stroke, fill }) => (
      <g>
        <line x1={32} y1={4} x2={32} y2={16} stroke={stroke} strokeWidth={SW_MAIN} />
        <polygon points="26,16 38,16 32,24" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <polygon points="26,32 38,32 32,24" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={32} y1={32} x2={32} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(32, 48, stroke, 4)}
        <path d="M27,56 C25,59 25,61 27,62 C29,61 29,59 27,56" fill={stroke} stroke="none" />
        <path d="M37,54 C35,57 35,59 37,60 C39,59 39,57 37,54" fill={stroke} stroke="none" />
      </g>
    ),
  },

  // ================= 标注信息 =================
  {
    id: 'pp-flow-arrow', label: '流向箭头', major: 'piping', sub: 'pp-annotation', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '介质流向箭头——标注管线内介质流动方向', sw: 72, sh: 28,
    render: ({ stroke }) => (
      <g>
        {pipe(14, stroke, 4, 68, 2)}
        <polygon points="30,6 50,14 30,22" fill={stroke} stroke="none" />
        <line x1={20} y1={14} x2={30} y2={14} stroke={stroke} strokeWidth={2.4} />
      </g>
    ),
  },
  {
    id: 'pp-line-tag', label: '管道编号', major: 'piping', sub: 'pp-annotation', standard: 'EN ISO 10628 · HG/T 20519.4-92',
    desc: '管道编号标注——管径-介质-序号-等级-保温（放置后双击改文字）', sw: 96, sh: 36,
    render: ({ stroke }) => (
      <g>
        <rect x={6} y={8} width={84} height={20} rx={4} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(48, 18, '6"-PL-1001-A1A', stroke, 9, 500)}
      </g>
    ),
  },
]
