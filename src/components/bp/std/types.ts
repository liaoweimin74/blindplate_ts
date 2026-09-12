// ============ PID 内建图元库——分类体系与类型定义（Task 61 全量重建） ============
// 分类框架由用户指定：五大分类 + 每大分类下子分类（参考 EN ISO 10628 / ISA-5.1 / HG/T 20519 / GB/T 4728）：
//   equipment 设备 · piping 管道与管件 · valve 阀门 · instrument 仪表与控制 · electric 电气与安全
// 侧栏按「大分类手风琴 → 子分类手风琴 → 符号宫格」两级展示。
// 约定：每个符号在各自设计空间 (0,0)-(sw,sh) 内绘制；描边统一 non-scaling-stroke（缩放不失真）；
// stroke/fill 跟随画布图元属性（属性面板可自定义配色）。旧图元 ID 不做兼容（用户确认全部删除重画）。
import type { ReactNode } from 'react'

export type StdMajor = 'equipment' | 'piping' | 'valve' | 'instrument' | 'electric'

export interface StdSubDef {
  id: string // 子分类 ID（全局唯一，前缀 = 大分类缩写）
  label: string
}

export interface StdSymbol {
  id: string
  label: string
  major: StdMajor      // 所属大分类
  sub: string          // 所属子分类 ID（STD_SUBGROUPS 中定义）
  standard: string     // 标准依据
  desc: string         // 悬停说明
  sw: number           // 设计空间宽
  sh: number           // 设计空间高
  render: (p: { stroke: string; fill: string }) => ReactNode
}

export const STD_MAJOR_ORDER: StdMajor[] = ['equipment', 'piping', 'valve', 'instrument', 'electric']

export const STD_MAJOR_LABEL: Record<StdMajor, string> = {
  equipment: '设备',
  piping: '管道与管件',
  valve: '阀门',
  instrument: '仪表与控制',
  electric: '电气与安全',
}

/** 子分类定义（数组顺序即侧栏展示顺序） */
export const STD_SUBGROUPS: Record<StdMajor, StdSubDef[]> = {
  equipment: [
    { id: 'eq-vessel', label: '容器与储罐' },
    { id: 'eq-column', label: '塔器与反应器' },
    { id: 'eq-thermal', label: '换热设备' },
    { id: 'eq-transfer', label: '流体输送设备' },
    { id: 'eq-separation', label: '分离与过滤设备' },
    { id: 'eq-solid', label: '固体处理设备' },
  ],
  piping: [
    { id: 'pp-line', label: '管道类型' },
    { id: 'pp-joint', label: '连接与管件' },
    { id: 'pp-accessory', label: '管道附件' },
    { id: 'pp-annotation', label: '标注信息' },
  ],
  valve: [
    { id: 'vl-shutoff', label: '截断阀' },
    { id: 'vl-check', label: '止回阀' },
    { id: 'vl-control', label: '调节阀' },
    { id: 'vl-relief', label: '安全泄放阀' },
    { id: 'vl-special', label: '特殊阀' },
    { id: 'vl-actuator', label: '执行机构' },
  ],
  instrument: [
    { id: 'in-bubble', label: '仪表气泡' },
    { id: 'in-loop', label: '常用回路' },
    { id: 'in-signal', label: '信号线' },
  ],
  electric: [
    { id: 'el-power', label: '电气设备' },
    { id: 'el-fire', label: '安全消防' },
    { id: 'el-protect', label: '防护标识' },
  ],
}

/** 子分类 ID → 名称（扁平派生表，悬停卡/搜索用） */
export const STD_SUB_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(STD_SUBGROUPS).flat().map((s) => [s.id, s.label]),
)
