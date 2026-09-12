// 盲板管理系统 - AI 语义检索编排（作业需求全字段分析 → 检索要素提取 → 动态查询构造 → 受限候选）
// 设计口径（Task 51，替代 Task 50 的「固定三字段正则匹配」）：
// ①不硬编码「看哪些字段、按什么规则查」——先由 LLM 通读作业需求全部字段（标题/位置/原因/
//   介质/压力/温度/勘察已填内容等）语义分析，提取检索要素（设备位号/设备名称/管线代号）与判断依据；
//   如位置描述「分馏塔连接管线的所有隔离点位」本身就限定了检索范围=分馏塔及其连接管线；
// ②系统按要素动态构造查询：位号/名称 → 设备主数据 → 本装置绑定管线（跨装置脏绑定已过滤）；
//   管线代号 → 管线主数据（文本明确提及的代号是用户意图，尊重之，不限装置）；
//   再并入需求单已关联的管线；
// ③皆空时回退同装置全部管线——候选永不跨装置（此前 draft/isolation 未关联管线时全库候选，
//   会把无关装置的隔离点送给 AI 推举，是「IP-PL301-01 误选」类问题的根因）；
// ④LLM 只做「受限范围内推举」：候选带上限、响应经 masterCode 白名单校验（各 route 内执行），防幻觉。
import { db } from '@/lib/db'
import { bpComplete, extractJson } from '@/lib/bp-ai'
import { normalizeTag, linkSourceLabel, summarizeEquipmentScope, EquipmentScope } from '@/lib/bp-equipment-scope'
import { Prisma } from '@prisma/client'

const masterInclude = { pipeline: { select: { name: true, medium: true, pressure: true } } } satisfies Prisma.IsoPointMasterInclude
export type MasterWithPipe = Prisma.IsoPointMasterGetPayload<{ include: typeof masterInclude }>

/** LLM 从作业需求全字段提取的检索要素 */
export interface RetrievalIntent {
  equipmentTags: string[]
  equipmentNames: string[]
  pipelineCodes: string[]
  rationale: string
}

export interface RetrievalInput {
  code: string
  title: string
  workTypeText: string
  unitName: string
  location: string
  pipelineName: string | null
  medium: string | null
  pressure: string | null
  temperature: string | null
  reason: string | null
  /** 附加上下文（勘察已填内容等） */
  extra?: string
}

export interface AiCandidateScope {
  intent: RetrievalIntent
  scope: EquipmentScope
  masters: MasterWithPipe[]
  sourceTag: Map<number, string>
  scopeText: string
  /** 是否回退同装置（需求无管线要素且未识别到设备相连管线） */
  fallbackUsed: boolean
}

const s = (v: string[]) => v.map((x) => String(x ?? '').trim()).filter((x) => x.length > 0 && x.length <= 30).slice(0, 8)

/** LLM 通读作业需求全字段，提取检索要素（temperature 0 保证稳定） */
export async function analyzeRetrievalIntent(input: RetrievalInput): Promise<RetrievalIntent> {
  const context = `【作业需求（全字段）】
编号：${input.code}；标题：${input.title}
作业类型：${input.workTypeText}
所属装置：${input.unitName}
作业位置：${input.location || '（未填）'}
关联管线：${input.pipelineName ?? '未关联'}；介质：${input.medium ?? '未知'}；压力：${input.pressure ?? '未知'}；温度：${input.temperature ?? '未知'}
作业原因：${input.reason || '（未填）'}${input.extra ? `\n${input.extra}` : ''}`

  const raw = await bpComplete(
    `你是石化工艺工程师助手。请通读下方盲板抽堵作业需求的全部字段，语义分析并提取用于检索「相关隔离点位主数据」的要素。
【提取要求】
1. equipmentTags：文本中明确出现的设备位号（如 T-301、P-101A、E-201，忽略连接符差异，原样提取）；
2. equipmentNames：位置/标题/原因中出现的设备名称或名称核心词（如 分馏塔、进料泵、换热器、反应器）；
3. pipelineCodes：文本中明确出现的管线代号（如 PL-301）；
4. rationale：一句话说明提取依据——这些要素与本次作业的关联逻辑（如「位置描述『分馏塔连接管线的所有隔离点位』已限定检索范围为分馏塔及其连接管线，故提取设备分馏塔」）。
【纪律】
- 只提取文本中实际出现或有明确指代的要素，严禁臆造不存在的位号/代号/名称；
- 「XX设备的（所有/各）连接管线的隔离点位」这类表述：提取该设备即可，其连接管线由系统按设备绑定关系自动展开，不要把「所有」「连接管线」当提取要素；
- 某维度无要素时输出空数组；文本完全没有可提取要素时全部留空并在 rationale 说明。
只输出 JSON：{"equipmentTags":["..."],"equipmentNames":["..."],"pipelineCodes":["..."],"rationale":"..."}，不要输出 JSON 以外文字。`,
    [{ role: 'user', content: context }],
    { temperature: 0 },
  )
  const j = extractJson<Partial<RetrievalIntent>>(raw)
  return {
    equipmentTags: s(Array.isArray(j?.equipmentTags) ? j.equipmentTags as string[] : []),
    equipmentNames: s(Array.isArray(j?.equipmentNames) ? j.equipmentNames as string[] : []),
    pipelineCodes: s(Array.isArray(j?.pipelineCodes) ? j.pipelineCodes as string[] : []),
    rationale: String(j?.rationale ?? '').slice(0, 120),
  }
}

/** 位号双向归一化包含（T301 ↔ T-301 ↔ XT-301A） */
const tagMatch = (code: string, tags: string[]): boolean => {
  const c = normalizeTag(code)
  return tags.some((t) => {
    const n = normalizeTag(t)
    return n.length >= 2 && (c.includes(n) || n.includes(c))
  })
}
/** 名称双向包含（「分馏塔」↔「催化分馏塔」） */
const nameMatch = (name: string, names: string[]): boolean => {
  const a = name.trim()
  if (a.length < 2) return false
  return names.some((k) => {
    const b = k.trim()
    return b.length >= 2 && (a.includes(b) || b.includes(a))
  })
}

/**
 * 检索要素 → 动态查询 → 统一候选构造（勘察推举/要点清单/方案草案三链路共享）。
 * 候选管线集合 = 需求已关联管线 + 位置文本提及管线（AI 提取代号，不限装置）+ 识别设备本装置绑定管线。
 */
export async function buildAiCandidates(params: {
  unitId: number
  wrPipelineId: number | null
  wrPipelineName: string | null
  input: RetrievalInput
  take?: number
}): Promise<AiCandidateScope> {
  const { unitId, wrPipelineId, wrPipelineName, input } = params
  const take = params.take ?? 18

  const intent = await analyzeRetrievalIntent(input)

  // ① 设备匹配：本装置优先，无命中回退全库（兼容设备装置归属不全的历史数据）
  const pickEq = (list: { id: number; code: string; name: string }[]) =>
    list.filter((eq) => tagMatch(eq.code, intent.equipmentTags) || nameMatch(eq.name, intent.equipmentNames))
  let matched = pickEq(await db.equipment.findMany({ where: { unitId }, select: { id: true, code: true, name: true } }))
  if (!matched.length && (intent.equipmentTags.length || intent.equipmentNames.length)) {
    matched = pickEq(await db.equipment.findMany({ select: { id: true, code: true, name: true } }))
  }

  // ② 设备本装置绑定管线（跨装置的设备↔管线脏绑定不纳入）
  const ids = matched.map((m) => m.id)
  const byId = new Map(matched.map((m) => [m.id, m]))
  const boundPipes = ids.length
    ? await db.pipeline.findMany({
        where: { unitId, OR: [{ startEquipmentId: { in: ids } }, { endEquipmentId: { in: ids } }] },
        select: { id: true, code: true, name: true, startEquipmentId: true, endEquipmentId: true },
        orderBy: { id: 'asc' },
      })
    : []
  const links: EquipmentScope['links'] = []
  for (const p of boundPipes) {
    if (p.startEquipmentId != null && byId.has(p.startEquipmentId)) {
      const eq = byId.get(p.startEquipmentId)!
      links.push({ pipelineId: p.id, pipelineCode: p.code, pipelineName: p.name, equipmentId: eq.id, equipmentCode: eq.code, direction: 'START' })
    }
    if (p.endEquipmentId != null && byId.has(p.endEquipmentId)) {
      const eq = byId.get(p.endEquipmentId)!
      links.push({ pipelineId: p.id, pipelineCode: p.code, pipelineName: p.name, equipmentId: eq.id, equipmentCode: eq.code, direction: 'END' })
    }
  }
  const scope: EquipmentScope = { matched, links }

  // ③ 位置文本提及的管线代号（用户明确意图，尊重之，不限装置）
  const allPipes = intent.pipelineCodes.length
    ? await db.pipeline.findMany({ select: { id: true, code: true, name: true } })
    : []
  const mentioned = allPipes.filter((p) => tagMatch(p.code, intent.pipelineCodes))

  // ④ 候选管线集合（去重）与来源标注
  const pipeIds = new Set<number>()
  if (wrPipelineId) pipeIds.add(wrPipelineId)
  for (const p of mentioned) pipeIds.add(p.id)
  for (const l of links) pipeIds.add(l.pipelineId)
  const mentionedIds = new Set(mentioned.map((p) => p.id))
  const linkByPipe = new Map(links.map((l) => [l.pipelineId, l]))

  const sourceTag = new Map<number, string>()
  let masters: MasterWithPipe[] = []
  let fallbackUsed = false

  if (pipeIds.size) {
    masters = await db.isoPointMaster.findMany({
      where: { pipelineId: { in: [...pipeIds] } },
      include: masterInclude,
      take,
      orderBy: [{ pipelineId: 'asc' }, { id: 'asc' }],
    })
    for (const m of masters) {
      if (wrPipelineId && m.pipelineId === wrPipelineId) sourceTag.set(m.id, '需求管线')
      else if (m.pipelineId != null && mentionedIds.has(m.pipelineId)) sourceTag.set(m.id, '作业位置提及管线')
      else {
        const link = m.pipelineId != null ? linkByPipe.get(m.pipelineId) : undefined
        sourceTag.set(m.id, link ? `设备关联管线（${linkSourceLabel(link)}）` : '设备关联管线')
      }
    }
  } else {
    // ⑤ 回退：全字段无任何检索要素命中 → 同装置全部管线主数据（候选永不跨装置）
    fallbackUsed = true
    const unitPipes = await db.pipeline.findMany({ where: { unitId }, select: { id: true } })
    masters = unitPipes.length
      ? await db.isoPointMaster.findMany({
          where: { pipelineId: { in: unitPipes.map((p) => p.id) } },
          include: masterInclude,
          take,
          orderBy: [{ pipelineId: 'asc' }, { id: 'asc' }],
        })
      : []
  }

  const parts: string[] = []
  if (wrPipelineId) parts.push(`需求关联管线「${wrPipelineName ?? ''}」`)
  if (mentioned.length) parts.push(`位置提及管线（${mentioned.map((p) => p.code).join('、')}）`)
  if (links.length) parts.push('作业设备进/出口相连管线')
  const scopeText = fallbackUsed
    ? '需求所属装置下各管线的隔离点主数据（全字段未提取到设备/管线要素，按同装置口径兜底）'
    : `${parts.join(' + ')} 的隔离点主数据`

  return { intent, scope, masters, sourceTag, scopeText, fallbackUsed }
}

export { summarizeEquipmentScope, linkSourceLabel }
