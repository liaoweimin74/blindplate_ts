// ============ 内建图元 · 一、设备图元（40 符号，EN ISO 10628 · HG/T 20519.31-92） ============
// 容器与储罐(7) / 塔器与反应器(6) / 换热设备(7) / 流体输送设备(7) / 分离与过滤设备(6) / 固体处理设备(7)
import {
  SW_MAIN, SW_THIN, SW_PAD, pipe, vline, arrowRight, arrowDown, arrowUp, arrowLeft, symText, packing, drumH, drumV, flame,
} from './primitives'
import type { StdSymbol } from './types'

export const EQUIP_SYMBOLS: StdSymbol[] = [
  // ================= 容器与储罐 =================
  {
    id: 'eq-vtank', label: '立式储罐', major: 'equipment', sub: 'eq-vessel', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '立式拱顶储罐 TK——常压/低压液态物料储存', sw: 64, sh: 80,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M14,18 Q14,8 32,8 Q50,8 50,18 L50,66 L14,66 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={17} y1={28} x2={47} y2={28} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={10} y1={72} x2={54} y2={72} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={14} y1={66} x2={11} y2={72} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={50} y1={66} x2={53} y2={72} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-htank', label: '卧式储罐', major: 'equipment', sub: 'eq-vessel', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '卧式储罐 TK——双鞍座支承，大规模液料储存', sw: 84, sh: 52,
    render: ({ stroke, fill }) => (
      <g>
        {drumH(8, 10, 68, 26, stroke, fill)}
        <line x1={42} y1={10} x2={42} y2={4} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M20,36 L16,46 L32,46 L28,36" fill="none" stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <path d="M56,36 L52,46 L68,46 L64,36" fill="none" stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={12} y1={46} x2={72} y2={46} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={20} y1={23} x2={64} y2={23} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },
  {
    id: 'eq-pvessel', label: '压力容器', major: 'equipment', sub: 'eq-vessel', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '压力容器 V——椭圆封头卧式受压罐，气液缓冲', sw: 84, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        {drumH(10, 12, 64, 24, stroke, fill)}
        <path d="M18,12 Q13,24 18,36" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <path d="M66,12 Q71,24 66,36" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={42} y1={12} x2={42} y2={5} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={36} x2={22} y2={43} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={60} y1={36} x2={62} y2={43} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-sphere', label: '球罐', major: 'equipment', sub: 'eq-vessel', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '球罐 TK——支柱支承球形压力储罐（LPG 等）', sw: 64, sh: 72,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={32} cy={26} r={20} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={13.5} y1={32} x2={50.5} y2={32} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={24} y1={44.6} x2={19} y2={64} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={40} y1={44.6} x2={45} y2={64} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={14} y1={64} x2={50} y2={64} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={32} y1={6} x2={32} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-buffer-drum', label: '缓冲罐', major: 'equipment', sub: 'eq-vessel', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '缓冲罐 V——立式小容积罐，稳压/气液缓冲', sw: 56, sh: 72,
    render: ({ stroke, fill }) => (
      <g>
        {drumV(28, 8, 20, 48, stroke, fill)}
        <line x1={28} y1={8} x2={28} y2={3} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={38} y1={30} x2={48} y2={30} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(43, 30, stroke, 3.2)}
        <line x1={22} y1={56} x2={20} y2={64} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={34} y1={56} x2={36} y2={64} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={16} y1={64} x2={40} y2={64} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-reflux-drum', label: '回流罐', major: 'equipment', sub: 'eq-vessel', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '回流罐 V——塔顶馏出液收集，回流与采出分配', sw: 80, sh: 44,
    render: ({ stroke, fill }) => (
      <g>
        {drumH(10, 14, 60, 20, stroke, fill)}
        <line x1={28} y1={14} x2={28} y2={7} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(28, 10.5, stroke, 2.8)}
        <line x1={70} y1={24} x2={78} y2={24} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(74, 24, stroke, 3.2)}
        <line x1={40} y1={34} x2={40} y2={40} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-gasholder', label: '气柜', major: 'equipment', sub: 'eq-vessel', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '湿式气柜——浮顶钟罩在水槽内升降储存气体', sw: 64, sh: 84,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M12,36 L12,76 L52,76 L52,36" fill="none" stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={12} y1={42} x2={52} y2={42} stroke={stroke} strokeWidth={SW_THIN} />
        <path d="M18,36 L18,16 Q18,8 32,8 Q46,8 46,16 L46,36" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={7} y1={14} x2={7} y2={76} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={57} y1={14} x2={57} y2={76} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={7} y1={14} x2={18} y2={14} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={46} y1={14} x2={57} y2={14} stroke={stroke} strokeWidth={SW_THIN} />
      </g>
    ),
  },

  // ================= 塔器与反应器 =================
  {
    id: 'eq-tray-col', label: '板式塔', major: 'equipment', sub: 'eq-column', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '板式塔 T——塔盘逐级传质分离（精馏/吸收）', sw: 48, sh: 96,
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
    id: 'eq-packed-col', label: '填料塔', major: 'equipment', sub: 'eq-column', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '填料塔 T——塔内填料提供气液接触面', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M14,22 Q14,10 24,10 Q34,10 34,22 V76 Q34,88 24,88 Q14,88 14,76 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={10} x2={24} y2={3} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={88} x2={24} y2={94} stroke={stroke} strokeWidth={SW_MAIN} />
        {packing(15, 33, 36, 64, stroke)}
        {arrowDown(24, 0.5, stroke, 2.6)}
      </g>
    ),
  },
  {
    id: 'eq-fixed-bed', label: '固定床反应器', major: 'equipment', sub: 'eq-column', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '固定床反应器 R——催化剂床层静止装填', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M12,20 Q12,8 24,8 Q36,8 36,20 V78 Q36,90 24,90 Q12,90 12,78 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={8} x2={24} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={90} x2={24} y2={95} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={12} y1={6} x2={12} y2={12} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={36} y1={6} x2={36} y2={12} stroke={stroke} strokeWidth={SW_MAIN} />
        {packing(13, 35, 34, 66, stroke)}
        {arrowDown(24, 0.5, stroke, 2.6)}
      </g>
    ),
  },
  {
    id: 'eq-fluid-bed', label: '流化床反应器', major: 'equipment', sub: 'eq-column', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '流化床反应器 R——气流使固体颗粒呈流化态', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M12,20 Q12,8 24,8 Q36,8 36,20 V78 Q36,90 24,90 Q12,90 12,78 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={8} x2={24} y2={2} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={90} x2={24} y2={95} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={13} y1={38} x2={35} y2={38} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={13} y1={68} x2={35} y2={68} stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={20} cy={46} r={3.4} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={29} cy={54} r={3.4} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={19} cy={61} r={3.4} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        {arrowDown(24, 0.5, stroke, 2.6)}
      </g>
    ),
  },
  {
    id: 'eq-stirred-re', label: '搅拌反应釜', major: 'equipment', sub: 'eq-column', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '机械搅拌反应釜 R——M 电机驱动搅拌桨，可带夹套', sw: 56, sh: 88,
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
    id: 'eq-scrubber', label: '洗涤塔', major: 'equipment', sub: 'eq-column', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '洗涤塔 T——顶部喷淋洗涤净化气体', sw: 48, sh: 96,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M14,22 Q14,10 24,10 Q34,10 34,22 V76 Q34,88 24,88 Q14,88 14,76 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={10} x2={24} y2={3} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={88} x2={24} y2={94} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={15} y1={26} x2={33} y2={26} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={24} y1={26} x2={24} y2={34} stroke={stroke} strokeWidth={SW_THIN} />
        <polygon points="17,36 31,36 24,50" fill="none" stroke={stroke} strokeWidth={SW_THIN} strokeLinejoin="round" />
        {arrowDown(24, 56, stroke, 3.4)}
        {arrowDown(24, 66, stroke, 3.4)}
        <line x1={15} y1={78} x2={33} y2={78} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={34} y1={44} x2={42} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },

  // ================= 换热设备 =================
  {
    id: 'eq-bhe', label: '管壳式换热器', major: 'equipment', sub: 'eq-thermal', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '管壳式换热器 E——管束内外介质间接换热（列管式）', sw: 96, sh: 48,
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
    id: 'eq-phe', label: '板式换热器', major: 'equipment', sub: 'eq-thermal', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '板式换热器 E——板束波纹流道，高效紧凑换热', sw: 48, sh: 72,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={16} y={10} width={16} height={52} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M18,16 L30,22 M18,26 L30,32 M18,36 L30,42 M18,46 L30,52 M18,56 L30,60" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={20} y1={10} x2={20} y2={4} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={28} y1={62} x2={28} y2={68} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={16} y1={20} x2={9} y2={20} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={32} y1={52} x2={39} y2={52} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-airfin', label: '空冷器', major: 'equipment', sub: 'eq-thermal', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '空气冷却器 E——风机强制通风冷却管束内介质', sw: 88, sh: 64,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={10} y={32} width={68} height={16} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M16,32 L24,48 M28,32 L36,48 M40,32 L48,48 M52,32 L60,48 M64,32 L72,48" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={30} cy={16} r={9} fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={16} x2={36} y2={16} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={30} y1={10} x2={30} y2={22} stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={58} cy={16} r={9} fill="none" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={52} y1={16} x2={64} y2={16} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={58} y1={10} x2={58} y2={22} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={16} y1={48} x2={12} y2={58} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={72} y1={48} x2={76} y2={58} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={8} y1={58} x2={80} y2={58} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-reboiler', label: '再沸器', major: 'equipment', sub: 'eq-thermal', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '釜式再沸器 E——塔釜液循环加热汽化返回塔内', sw: 84, sh: 60,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={14} width={56} height={28} rx={14} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M14,22 H44 Q54,22 54,28 Q54,34 44,34 H14" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={64} y1={20} x2={80} y2={20} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(70, 20, stroke, 4)}
        <line x1={2} y1={36} x2={8} y2={36} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={30} y1={42} x2={30} y2={50} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(30, 46, stroke, 3.2)}
      </g>
    ),
  },
  {
    id: 'eq-condenser', label: '冷凝器', major: 'equipment', sub: 'eq-thermal', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '冷凝器 E——气相介质冷凝为液相（壳程冷凝）', sw: 96, sh: 48,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={8} y={14} width={80} height={20} rx={10} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M14,24 L22,17 L32,31 L42,17 L52,31 L62,17 L72,31 L82,24" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        {pipe(24, stroke, 2, 8)}
        {arrowRight(4.5, 24, stroke, 3)}
        <line x1={26} y1={14} x2={26} y2={6} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(26, 10, stroke, 3)}
        <line x1={70} y1={34} x2={70} y2={42} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(70, 38, stroke, 3)}
        {pipe(24, stroke, 88, 94)}
        {arrowRight(91, 24, stroke, 3)}
      </g>
    ),
  },
  {
    id: 'eq-cooler', label: '冷却器', major: 'equipment', sub: 'eq-thermal', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '冷却器 E——波纹符号线性冷却器（循环水冷却）', sw: 64, sh: 40,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={32} cy={20} r={13} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M21,20 Q24,14 28,20 Q32,26 36,20 Q39,15 43,20" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        {pipe(20, stroke, 2, 19)}
        {pipe(20, stroke, 45, 62)}
      </g>
    ),
  },
  {
    id: 'eq-furnace', label: '加热炉', major: 'equipment', sub: 'eq-thermal', standard: 'EN ISO 10628 · HG/T 20519.31-92',
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

  // ================= 流体输送设备 =================
  {
    id: 'eq-pump-c', label: '离心泵', major: 'equipment', sub: 'eq-transfer', standard: 'EN ISO 10628 · HG/T 20519.31-92',
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
    id: 'eq-pump-r', label: '往复泵', major: 'equipment', sub: 'eq-transfer', standard: 'EN ISO 10628 · HG/T 20519.31-92',
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
    id: 'eq-pump-g', label: '齿轮泵', major: 'equipment', sub: 'eq-transfer', standard: 'EN ISO 10628 · HG/T 20519.31-92',
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
    id: 'eq-vacuum-pump', label: '真空泵', major: 'equipment', sub: 'eq-transfer', standard: 'EN ISO 10628 · HG/T 20519.31-92',
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
    id: 'eq-compressor', label: '压缩机', major: 'equipment', sub: 'eq-transfer', standard: 'EN ISO 10628 · HG/T 20519.31-92',
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
    id: 'eq-blower', label: '鼓风机', major: 'equipment', sub: 'eq-transfer', standard: 'EN ISO 10628 · HG/T 20519.31-92',
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
    id: 'eq-fan', label: '风机', major: 'equipment', sub: 'eq-transfer', standard: 'EN ISO 10628 · HG/T 20519.31-92',
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

  // ================= 分离与过滤设备 =================
  {
    id: 'eq-filter', label: '过滤器', major: 'equipment', sub: 'eq-separation', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '过滤器——罐内滤芯/滤层截留固体杂质', sw: 56, sh: 80,
    render: ({ stroke, fill }) => (
      <g>
        <path d="M18,16 Q18,8 28,8 Q38,8 38,16 L38,62 L18,62 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        {packing(19, 37, 30, 46, stroke)}
        <line x1={28} y1={2} x2={28} y2={8} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(28, 5, stroke, 2.8)}
        <line x1={28} y1={62} x2={28} y2={72} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(28, 68, stroke, 2.8)}
      </g>
    ),
  },
  {
    id: 'eq-centrifuge', label: '离心机', major: 'equipment', sub: 'eq-separation', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '离心机 S——高速旋转转鼓离心分离固液', sw: 56, sh: 80,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={20} y={18} width={16} height={40} rx={8} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={25} x2={24} y2={51} stroke={stroke} strokeWidth={SW_THIN} strokeDasharray="3 2" />
        <line x1={32} y1={25} x2={32} y2={51} stroke={stroke} strokeWidth={SW_THIN} strokeDasharray="3 2" />
        <circle cx={28} cy={8} r={6} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(28, 8.5, 'M', stroke, 8)}
        <line x1={28} y1={14} x2={28} y2={18} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={28} y1={58} x2={28} y2={68} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(28, 63, stroke, 3.2)}
      </g>
    ),
  },
  {
    id: 'eq-cyclone', label: '旋风分离器', major: 'equipment', sub: 'eq-separation', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '旋风分离器 S——切向进气离心除尘，顶部排气底部排灰', sw: 56, sh: 84,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={16} y={12} width={24} height={26} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M16,38 L40,38 L28,64 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        {pipe(16, stroke, 40, 52)}
        {arrowLeft(47, 16, stroke, 3.4)}
        <line x1={28} y1={14} x2={28} y2={58} stroke={stroke} strokeWidth={SW_THIN} strokeDasharray="4 3" />
        <line x1={28} y1={4} x2={28} y2={12} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowUp(28, 7, stroke, 3.2)}
        <line x1={28} y1={64} x2={28} y2={76} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(28, 72, stroke, 3.2)}
      </g>
    ),
  },
  {
    id: 'eq-3phase-sep', label: '三相分离器', major: 'equipment', sub: 'eq-separation', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '三相分离器 V——卧罐内隔板分出油/气/水三相', sw: 92, sh: 60,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={6} y={18} width={72} height={26} rx={13} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={30} y1={18} x2={30} y2={44} stroke={stroke} strokeWidth={SW_THIN} strokeDasharray="4 3" />
        <line x1={52} y1={18} x2={52} y2={44} stroke={stroke} strokeWidth={SW_THIN} strokeDasharray="4 3" />
        {pipe(31, stroke, 2, 6)}
        <line x1={42} y1={18} x2={42} y2={8} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowUp(42, 12, stroke, 3.2)}
        <line x1={78} y1={28} x2={88} y2={28} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(83, 28, stroke, 3.2)}
        <line x1={62} y1={44} x2={62} y2={54} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(62, 49, stroke, 3.2)}
      </g>
    ),
  },
  {
    id: 'eq-membrane', label: '膜组件', major: 'equipment', sub: 'eq-separation', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '膜分离器 S——膜元件渗透分离（微滤/超滤/反渗透）', sw: 56, sh: 80,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={20} y={10} width={16} height={56} rx={8} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M28,14 Q21,20 28,26 Q35,32 28,38 Q21,44 28,50 Q35,56 28,62" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={28} y1={2} x2={28} y2={10} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(28, 6, stroke, 2.8)}
        <line x1={36} y1={38} x2={50} y2={38} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(44, 38, stroke, 3)}
        <line x1={28} y1={66} x2={28} y2={76} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(28, 72, stroke, 2.8)}
      </g>
    ),
  },
  {
    id: 'eq-dryer', label: '干燥器', major: 'equipment', sub: 'eq-separation', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '干燥器 D——热气流加热蒸发脱除物料水分', sw: 88, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={14} y={16} width={56} height={22} rx={11} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={26} y1={16} x2={26} y2={38} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={58} y1={16} x2={58} y2={38} stroke={stroke} strokeWidth={SW_THIN} />
        <path d="M20,27 H64" fill="none" stroke={stroke} strokeWidth={SW_THIN} strokeDasharray="5 3" />
        {flame(16, 47, 6, stroke)}
        {arrowUp(16, 42, stroke, 3.6)}
        <line x1={62} y1={16} x2={62} y2={8} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowUp(62, 11, stroke, 3.2)}
        <line x1={26} y1={38} x2={26} y2={50} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={58} y1={38} x2={58} y2={50} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={10} y1={50} x2={78} y2={50} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },

  // ================= 固体处理设备 =================
  {
    id: 'eq-belt-conveyor', label: '皮带输送机', major: 'equipment', sub: 'eq-solid', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '皮带输送机——双滚筒环带连续输送固体物料', sw: 96, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={16} cy={36} r={8} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={80} cy={36} r={8} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={16} y1={28} x2={80} y2={28} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={16} y1={44} x2={80} y2={44} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowRight(40, 23, stroke, 4)}
        {arrowRight(58, 23, stroke, 4)}
        <line x1={32} y1={44} x2={32} y2={52} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={64} y1={44} x2={64} y2={52} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={24} y1={52} x2={72} y2={52} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-screw-conveyor', label: '螺旋输送机', major: 'equipment', sub: 'eq-solid', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '螺旋输送机——螺杆旋转槽内推送物料', sw: 96, sh: 40,
    render: ({ stroke, fill }) => (
      <g>
        <rect x={10} y={12} width={64} height={18} rx={9} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <path d="M16,26 L24,16 M28,26 L36,16 M40,26 L48,16 M52,26 L60,16 M64,26 L68,19" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={74} y1={21} x2={77} y2={21} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={84} cy={21} r={8} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(84, 21.5, 'M', stroke, 9)}
      </g>
    ),
  },
  {
    id: 'eq-bucket-lift', label: '斗式提升机', major: 'equipment', sub: 'eq-solid', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '斗式提升机——环链料斗垂直提升固体物料', sw: 64, sh: 88,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={32} cy={16} r={7} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={32} cy={72} r={7} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={22} y1={18} x2={22} y2={70} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={42} y1={18} x2={42} y2={70} stroke={stroke} strokeWidth={SW_MAIN} />
        <rect x={16} y={30} width={10} height={8} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <rect x={38} y={44} width={10} height={8} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <rect x={16} y={56} width={10} height={8} fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        {arrowRight(52, 12, stroke, 4)}
      </g>
    ),
  },
  {
    id: 'eq-crusher', label: '破碎机', major: 'equipment', sub: 'eq-solid', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '破碎机——颚板挤压破碎大块固体物料', sw: 64, sh: 80,
    render: ({ stroke, fill }) => (
      <g>
        {arrowDown(32, 5, stroke, 4)}
        <path d="M14,10 L50,10 L38,32 L26,32 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={26} y1={32} x2={30} y2={56} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={38} y1={32} x2={34} y2={56} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={50} cy={48} r={7} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(50, 48.5, 'M', stroke, 9)}
        <line x1={35} y1={50} x2={43} y2={49} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={32} y1={56} x2={32} y2={68} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(32, 63, stroke, 3.2)}
      </g>
    ),
  },
  {
    id: 'eq-mill', label: '磨机', major: 'equipment', sub: 'eq-solid', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '磨机——筒体旋转研磨固体至细粉', sw: 88, sh: 60,
    render: ({ stroke, fill }) => (
      <g>
        <circle cx={36} cy={28} r={18} fill={fill} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={30} cy={22} r={1.5} fill={stroke} stroke="none" />
        <circle cx={42} cy={24} r={1.5} fill={stroke} stroke="none" />
        <circle cx={34} cy={32} r={1.5} fill={stroke} stroke="none" />
        <circle cx={43} cy={34} r={1.5} fill={stroke} stroke="none" />
        <circle cx={26} cy={33} r={1.5} fill={stroke} stroke="none" />
        <line x1={54} y1={28} x2={58} y2={28} stroke={stroke} strokeWidth={SW_MAIN} />
        <circle cx={62} cy={28} r={4} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={48} y1={40} x2={60} y2={44} stroke={stroke} strokeWidth={SW_THIN} />
        <circle cx={66} cy={46} r={7} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        {symText(66, 46.5, 'M', stroke, 9)}
        <line x1={24} y1={46} x2={24} y2={54} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={48} y1={46} x2={48} y2={54} stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={16} y1={54} x2={72} y2={54} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-screener', label: '筛分机', major: 'equipment', sub: 'eq-solid', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '筛分机——振动筛网按粒径分级固体物料', sw: 88, sh: 56,
    render: ({ stroke, fill }) => (
      <g>
        {arrowDown(20, 8, stroke, 4)}
        <path d="M14,14 L74,14 L82,38 L22,38 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <line x1={17} y1={22} x2={76} y2={22} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={19} y1={30} x2={79} y2={30} stroke={stroke} strokeWidth={SW_THIN} />
        {vline(34, 38, 48, stroke)}
        {vline(62, 38, 48, stroke)}
        <path d="M30,42 L34,44 L30,46 M58,42 L62,44 L58,46" fill="none" stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={26} y1={48} x2={70} y2={48} stroke={stroke} strokeWidth={SW_MAIN} />
      </g>
    ),
  },
  {
    id: 'eq-feeder', label: '给料器', major: 'equipment', sub: 'eq-solid', standard: 'EN ISO 10628 · HG/T 20519.31-92',
    desc: '给料器——料仓下星型给料阀定量给料', sw: 56, sh: 80,
    render: ({ stroke, fill }) => (
      <g>
        {arrowDown(28, 5, stroke, 4)}
        <path d="M12,10 L44,10 L32,34 L24,34 Z" fill={fill} stroke={stroke} strokeWidth={SW_MAIN} strokeLinejoin="round" />
        <circle cx={28} cy={46} r={10} fill="#fff" stroke={stroke} strokeWidth={SW_MAIN} />
        <line x1={20} y1={46} x2={36} y2={46} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={28} y1={38} x2={28} y2={54} stroke={stroke} strokeWidth={SW_THIN} />
        <line x1={28} y1={56} x2={28} y2={68} stroke={stroke} strokeWidth={SW_MAIN} />
        {arrowDown(28, 63, stroke, 3.2)}
      </g>
    ),
  },
]
