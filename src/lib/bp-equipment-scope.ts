// 盲板管理系统 - 设备关联管线作用域解析（勘察 AI 推举等场景共享；仅后端使用）
// 背景：作业位置常以设备位号描述（如「T-301 分馏塔入口法兰」），该设备进/出口相连管线上的
// 隔离点与本次作业直接相关。管线主数据通过 startEquipmentId/endEquipmentId 与设备绑定
// （PID 图连线自动回写或管线台账手动维护），本库负责「作业文本 → 作业设备 → 相连管线」解析。
import { db } from '@/lib/db'

export interface MatchedEquipment {
  id: number
  code: string
  name: string
}

export interface EquipmentPipeLink {
  pipelineId: number
  pipelineCode: string
  pipelineName: string
  equipmentId: number
  equipmentCode: string
  direction: 'START' | 'END' // START=该设备是管线起点（设备出口侧）；END=终点（设备入口侧）
}

export interface EquipmentScope {
  matched: MatchedEquipment[]
  links: EquipmentPipeLink[]
}

/** 位号归一化：大写并去除非字母数字（E-301/E301、P-101A/P101A 互认；中文等分隔符被剥离利于位号子串匹配） */
export function normalizeTag(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const includesNorm = (haystacks: string[], needle: string): boolean => {
  const n = normalizeTag(needle)
  return n.length >= 2 && haystacks.some((h) => normalizeTag(h).includes(n))
}

/**
 * 从作业文本（位置/标题/原因）中识别设备，并解析其进/出口相连管线。
 * 匹配规则：①位号归一化包含（E101 ↔ E-101）②设备名（≥2字）被子串包含（「分馏塔」↔「催化分馏塔」）。
 * 优先在本装置设备中匹配；无命中时回退全库（兼容设备主数据装置归属不全的历史数据）。
 * 相连管线仅纳入需求同装置的管线：跨装置的设备↔管线绑定（PID 连线回写串装置等脏数据）
 * 会把其它装置的隔离点带入候选（如 unit10 设备误绑 unit4 管线），与作业位置无关，一律排除。
 */
export async function resolveEquipmentScope(unitId: number, texts: (string | null | undefined)[]): Promise<EquipmentScope> {
  const hay = texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
  if (!hay.length) return { matched: [], links: [] }

  const pick = (list: { id: number; code: string; name: string }[]) =>
    list.filter((eq) => includesNorm(hay, eq.code) || (eq.name.trim().length >= 2 && hay.some((t) => t.includes(eq.name.trim()))))

  let matched = pick(await db.equipment.findMany({ where: { unitId }, select: { id: true, code: true, name: true } }))
  if (!matched.length) {
    matched = pick(await db.equipment.findMany({ select: { id: true, code: true, name: true } }))
  }
  if (!matched.length) return { matched: [], links: [] }

  const ids = matched.map((m) => m.id)
  const byId = new Map(matched.map((m) => [m.id, m]))
  const pipes = await db.pipeline.findMany({
    where: { unitId, OR: [{ startEquipmentId: { in: ids } }, { endEquipmentId: { in: ids } }] },
    select: { id: true, code: true, name: true, startEquipmentId: true, endEquipmentId: true },
    orderBy: { id: 'asc' },
  })
  const links: EquipmentPipeLink[] = []
  for (const p of pipes) {
    if (p.startEquipmentId != null && byId.has(p.startEquipmentId)) {
      const eq = byId.get(p.startEquipmentId)!
      links.push({ pipelineId: p.id, pipelineCode: p.code, pipelineName: p.name, equipmentId: eq.id, equipmentCode: eq.code, direction: 'START' })
    }
    if (p.endEquipmentId != null && byId.has(p.endEquipmentId)) {
      const eq = byId.get(p.endEquipmentId)!
      links.push({ pipelineId: p.id, pipelineCode: p.code, pipelineName: p.name, equipmentId: eq.id, equipmentCode: eq.code, direction: 'END' })
    }
  }
  return { matched, links }
}

/** 设备关联来源标签（候选点标注用）：「E-301 出口侧」/「E-301 入口侧」 */
export function linkSourceLabel(link: EquipmentPipeLink): string {
  return `${link.equipmentCode} ${link.direction === 'START' ? '出口侧' : '入口侧'}`
}

/** 设备关联摘要（注入 AI 上下文/前端提示共用）：「T-301 分馏塔：相连管线 PL-304（出口侧）、PL-305（入口侧）」 */
export function summarizeEquipmentScope(scope: EquipmentScope): string {
  return scope.matched
    .map((eq) => {
      const ls = scope.links.filter((l) => l.equipmentId === eq.id)
      return `${eq.code} ${eq.name}${ls.length ? `：相连管线 ${ls.map((l) => `${l.pipelineCode}（${linkSourceLabel(l).split(' ')[1]}）`).join('、')}` : '（暂无相连管线绑定）'}`
    })
    .join('；')
}
