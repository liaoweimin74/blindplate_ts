// 盲板管理系统 - 主数据体检引擎（Task 54）
// 设计来源：Task 53 对 PL-305 脏绑定的实战人工校验逻辑产品化。
// 两层结构：本文件 = 确定性规则引擎（R1-R8，纯内存计算，硬矛盾，可直接作为修复依据）；
//           bp-master-validate-ai.ts = LLM 语义复核（深度档，疑似矛盾，需人工确认）。
// 原则：只发现矛盾并输出字段级证据，绝不自动修改主数据。
import { db } from '@/lib/db'
import { normalizeTag } from '@/lib/bp-equipment-scope'

// ============ 类型 ============

export type AuditSeverity = 'ERROR' | 'WARNING' | 'INFO'
export type AuditEntityType = 'UNIT' | 'EQUIPMENT' | 'PIPELINE' | 'ISO_POINT'
export type AuditDepth = 'FAST' | 'DEEP'
export type AuditScope =
  | { type: 'ALL' }
  | { type: 'UNIT'; code: string }
  | { type: 'EQUIPMENT'; code: string }
  | { type: 'PIPELINE'; code: string }

export interface AuditViolation {
  ruleId: string
  ruleName: string
  severity: AuditSeverity
  entityType: AuditEntityType
  entityCode: string
  entityName: string
  /** 矛盾一句话描述 */
  title: string
  /** 字段级证据（原始值逐条列出，与推断严格分离） */
  evidence: string[]
  /** 修复建议（供人工拍板，非自动执行） */
  suggestion: string
  /** true=确定性规则硬矛盾；false=LLM 语义复核疑似矛盾（需人工确认） */
  aiSuspect: boolean
}

export interface AuditSummary {
  error: number
  warning: number
  info: number
  aiSuspect: number
}

const unitInclude = { id: true, code: true, name: true } as const
const endpointInclude = { id: true, code: true, name: true, type: true, unitId: true } as const

/** 主数据快照（全量或邻接子图均可承载；手写契约，避免 Prisma payload 类型体操） */
export interface MasterSnapshot {
  units: { id: number; code: string; name: string }[]
  equipments: { id: number; code: string; name: string; type: string; unitId: number | null; remark: string | null; unit: { id: number; code: string; name: string } | null }[]
  pipelines: {
    id: number
    code: string
    name: string
    unitId: number | null
    medium: string | null
    pressure: string | null
    startEquipmentId: number | null
    endEquipmentId: number | null
    unit: { id: number; code: string; name: string } | null
    startEquipment: { id: number; code: string; name: string; type: string; unitId: number | null } | null
    endEquipment: { id: number; code: string; name: string; type: string; unitId: number | null } | null
  }[]
  isoPoints: { id: number; code: string; name: string; location: string | null; pipelineId: number | null; pipeline: { id: number; code: string; name: string } | null }[]
}

// ============ 快照构建 ============

export async function buildMasterSnapshot(): Promise<MasterSnapshot> {
  const [units, equipments, pipelines, isoPoints] = await Promise.all([
    db.unit.findMany({ where: { active: true }, select: unitInclude, orderBy: { id: 'asc' } }),
    db.equipment.findMany({
      select: { id: true, code: true, name: true, type: true, unitId: true, remark: true, unit: { select: unitInclude } },
      orderBy: { code: 'asc' },
    }),
    db.pipeline.findMany({
      select: {
        id: true, code: true, name: true, unitId: true, medium: true, pressure: true,
        startEquipmentId: true, endEquipmentId: true,
        unit: { select: unitInclude },
        startEquipment: { select: endpointInclude },
        endEquipment: { select: endpointInclude },
      },
      orderBy: { code: 'asc' },
    }),
    db.isoPointMaster.findMany({
      select: { id: true, code: true, name: true, location: true, pipelineId: true, pipeline: { select: unitInclude } },
      orderBy: { code: 'asc' },
    }),
  ])
  return { units, equipments, pipelines, isoPoints }
}

/** 从全量快照切出单实体邻接子图（设备/管线 + 直接连线 + 对端设备 + 挂载隔离点 + 同位号序列兄弟设备） */
export function sliceSnapshotForEntity(full: MasterSnapshot, type: 'EQUIPMENT' | 'PIPELINE', code: string): MasterSnapshot | null {
  const norm = normalizeTag(code)
  if (type === 'EQUIPMENT') {
    const eq = full.equipments.find((e) => normalizeTag(e.code) === norm)
    if (!eq) return null
    const linkedPipes = full.pipelines.filter((p) => p.startEquipmentId === eq.id || p.endEquipmentId === eq.id)
    const peerIds = new Set<number>([eq.id])
    for (const p of linkedPipes) {
      if (p.startEquipmentId != null) peerIds.add(p.startEquipmentId)
      if (p.endEquipmentId != null) peerIds.add(p.endEquipmentId)
    }
    // 二级扩展：对端设备的全部连线一并纳入——R1/R8 需要完整连线视角，
    // 否则对端设备的部分连线在切片中缺失会导致「全部连线均为外装置」误判
    const pipeIds = new Set(linkedPipes.map((p) => p.id))
    for (const p of full.pipelines) {
      if ((p.startEquipmentId != null && peerIds.has(p.startEquipmentId)) || (p.endEquipmentId != null && peerIds.has(p.endEquipmentId))) pipeIds.add(p.id)
    }
    for (const p of full.pipelines.filter((p) => pipeIds.has(p.id))) {
      if (p.startEquipmentId != null) peerIds.add(p.startEquipmentId)
      if (p.endEquipmentId != null) peerIds.add(p.endEquipmentId)
    }
    // 同位号序列（数字部分相同）的兄弟设备——序列聚类矛盾取证必需
    const seqNum = equipmentSeqNum(eq.code)
    const seqPeers = seqNum != null ? full.equipments.filter((e) => equipmentSeqNum(e.code) === seqNum) : []
    for (const e of seqPeers) peerIds.add(e.id)
    const unitIds = new Set<number>()
    for (const e of full.equipments.filter((e) => peerIds.has(e.id))) if (e.unitId != null) unitIds.add(e.unitId)
    for (const p of full.pipelines.filter((p) => pipeIds.has(p.id))) if (p.unitId != null) unitIds.add(p.unitId)
    return {
      units: full.units.filter((u) => unitIds.has(u.id)),
      equipments: full.equipments.filter((e) => peerIds.has(e.id)),
      pipelines: full.pipelines.filter((p) => pipeIds.has(p.id)),
      isoPoints: full.isoPoints.filter((pt) => pt.pipelineId != null && pipeIds.has(pt.pipelineId)),
    }
  }
  // PIPELINE
  const pipe = full.pipelines.find((p) => normalizeTag(p.code) === norm)
  if (!pipe) return null
  const endIds = new Set<number>()
  if (pipe.startEquipmentId != null) endIds.add(pipe.startEquipmentId)
  if (pipe.endEquipmentId != null) endIds.add(pipe.endEquipmentId)
  // 两端设备的其他连线一并纳入（设备连线一致性 R8 需要全连线视角）
  const pipeIds = new Set<number>([pipe.id])
  for (const p of full.pipelines) {
    if ((p.startEquipmentId != null && endIds.has(p.startEquipmentId)) || (p.endEquipmentId != null && endIds.has(p.endEquipmentId))) pipeIds.add(p.id)
  }
  // 邻接管线的对端设备
  for (const p of full.pipelines.filter((p) => pipeIds.has(p.id))) {
    if (p.startEquipmentId != null) endIds.add(p.startEquipmentId)
    if (p.endEquipmentId != null) endIds.add(p.endEquipmentId)
  }
  const unitIds = new Set<number>()
  if (pipe.unitId != null) unitIds.add(pipe.unitId)
  for (const e of full.equipments.filter((e) => endIds.has(e.id))) if (e.unitId != null) unitIds.add(e.unitId)
  for (const p of full.pipelines.filter((p) => pipeIds.has(p.id))) if (p.unitId != null) unitIds.add(p.unitId)
  return {
    units: full.units.filter((u) => unitIds.has(u.id)),
    equipments: full.equipments.filter((e) => endIds.has(e.id)),
    pipelines: full.pipelines.filter((p) => pipeIds.has(p.id)),
    isoPoints: full.isoPoints.filter((pt) => pt.pipelineId != null && pipeIds.has(pt.pipelineId)),
  }
}

/**
 * 从全量快照切出单装置邻接子图（Task 67 按装置体检）：
 * 装置登记的设备/管线 + 装置内设备的全部连线（R8 需要全连线视角，跨界线必须纳入）
 * + 上述管线的跨界对端设备（R1/R2 需要其装置归属做对比）+ 挂载隔离点 + 涉及装置。
 * 匹配纪律：装置 code 含中文/全角字符（如「QA试验装置」「浙江工业大学—Flying Team」），
 * normalizeTag 会剥掉非 A-Z0-9 字符导致纯中文 code 变空串、全半角连字符撞车——
 * 因此仅做原始 code/name 精确匹配，绝不做归一化匹配。
 */
export function sliceSnapshotForUnit(full: MasterSnapshot, code: string): MasterSnapshot | null {
  const raw = code.trim()
  if (!raw) return null
  const unit = full.units.find((u) => u.code === raw) ?? full.units.find((u) => u.name === raw)
  if (!unit) return null
  const eqIds = new Set<number>(full.equipments.filter((e) => e.unitId === unit.id).map((e) => e.id))
  // 管线 = 装置登记 ∪ 装置内设备的全部连线（含跨界登记在外装置的连线）
  const pipeIds = new Set<number>(full.pipelines.filter((p) => p.unitId === unit.id).map((p) => p.id))
  for (const p of full.pipelines) {
    if ((p.startEquipmentId != null && eqIds.has(p.startEquipmentId)) || (p.endEquipmentId != null && eqIds.has(p.endEquipmentId))) pipeIds.add(p.id)
  }
  // 设备再扩展：上述管线的对端设备（跨界对端，保留原 unitId 供 R1/R2 对比）
  for (const p of full.pipelines.filter((p) => pipeIds.has(p.id))) {
    if (p.startEquipmentId != null) eqIds.add(p.startEquipmentId)
    if (p.endEquipmentId != null) eqIds.add(p.endEquipmentId)
  }
  const unitIds = new Set<number>([unit.id])
  for (const e of full.equipments.filter((e) => eqIds.has(e.id))) if (e.unitId != null) unitIds.add(e.unitId)
  for (const p of full.pipelines.filter((p) => pipeIds.has(p.id))) if (p.unitId != null) unitIds.add(p.unitId)
  return {
    units: full.units.filter((u) => unitIds.has(u.id)),
    equipments: full.equipments.filter((e) => eqIds.has(e.id)),
    pipelines: full.pipelines.filter((p) => pipeIds.has(p.id)),
    isoPoints: full.isoPoints.filter((pt) => pt.pipelineId != null && pipeIds.has(pt.pipelineId)),
  }
}

// ============ 工具 ============

/** 提取设备位号的数字序列部分（F-301 → 301；P-101A → 101）；无数字返回 null */
function equipmentSeqNum(code: string): number | null {
  const m = code.match(/(\d{2,4})/g)
  if (!m) return null
  return parseInt(m[m.length - 1], 10)
}

/** 从文本提取候选位号 token（大写字母段+数字，如 R301 / E-101A），归一化后返回 */
export function extractTagTokens(text: string | null | undefined): string[] {
  if (!text) return []
  const upper = text.toUpperCase()
  const matches = upper.match(/[A-Z]{1,3}-?\d{1,4}[A-Z]?/g) ?? []
  const out = new Set<string>()
  for (const m of matches) {
    const n = normalizeTag(m)
    if (n.length >= 3 && /\d/.test(n) && /[A-Z]/.test(n)) out.add(n)
  }
  return [...out]
}

const unitName = (snap: MasterSnapshot, unitId: number | null | undefined): string =>
  snap.units.find((u) => u.id === unitId)?.name ?? (unitId != null ? `#${unitId}` : '未登记')

function mkViolation(v: Omit<AuditViolation, 'aiSuspect'>): AuditViolation {
  return { ...v, aiSuspect: false }
}

// ============ 确定性规则 R1-R8 ============

/** 管线名称 → 自称工艺单元关键词（最长优先匹配） */
const PROCESS_UNIT_KEYWORDS: { kw: string; expect: string }[] = [
  { kw: '常减压蒸馏', expect: '常减压蒸馏' },
  { kw: '常减压', expect: '常减压' },
  { kw: '催化裂化', expect: '催化裂化' },
  { kw: '连续重整', expect: '连续重整' },
  { kw: '渣油加氢', expect: '渣油加氢' },
  { kw: '加氢裂化', expect: '加氢裂化' },
  { kw: '加氢精制', expect: '加氢精制' },
  { kw: '催化', expect: '催化' },
  { kw: '重整', expect: '重整' },
  { kw: '加氢', expect: '加氢' },
]

export interface RuleEngineOptions {
  /** 邻接子图切片中的目标实体（单实体校验时用于报告定位；ALL 时为空） */
  focus?: { type: 'EQUIPMENT' | 'PIPELINE'; code: string }
}

export function runRuleEngine(snap: MasterSnapshot, opts: RuleEngineOptions = {}): AuditViolation[] {
  const out: AuditViolation[] = []
  const unitById = new Map(snap.units.map((u) => [u.id, u]))
  const eqNormSet = new Set(snap.equipments.map((e) => normalizeTag(e.code)))
  const pipeNormSet = new Set(snap.pipelines.map((p) => normalizeTag(p.code)))

  // ---- R1/R2：管线端点装置与管线装置一致性 ----
  for (const p of snap.pipelines) {
    if (p.unitId == null) continue
    const se = p.startEquipment
    const ee = p.endEquipment
    if (!se && !ee) continue
    const startMis = se?.unitId != null && se.unitId !== p.unitId
    const endMis = ee?.unitId != null && ee.unitId !== p.unitId
    const uName = unitName(snap, p.unitId)
    if (startMis && endMis) {
      out.push(mkViolation({
        ruleId: 'R1', ruleName: '管线端点装置一致性', severity: 'ERROR',
        entityType: 'PIPELINE', entityCode: p.code, entityName: p.name,
        title: `管线两端设备均不在管线登记装置内，物理落点缺位`,
        evidence: [
          `管线 ${p.code}「${p.name}」登记装置 = ${uName}`,
          `起点设备 ${se!.code}「${se!.name}」登记装置 = ${unitName(snap, se!.unitId)}（与管线装置不一致）`,
          `终点设备 ${ee!.code}「${ee!.name}」登记装置 = ${unitName(snap, ee!.unitId)}（与管线装置不一致）`,
        ],
        suggestion: `核实该管线真实归属：若确属 ${uName}，应清理起止设备绑定（绑定被外来连线污染）；若实际连接上述两端设备，应修正管线装置归属。修改前需人工确认`,
      }))
    } else if (startMis || endMis) {
      const mis = startMis ? se! : ee!
      const side = startMis ? '起点' : '终点'
      out.push(mkViolation({
        ruleId: 'R2', ruleName: '跨界管线形态确认', severity: 'WARNING',
        entityType: 'PIPELINE', entityCode: p.code, entityName: p.name,
        title: `${side}设备跨装置（边界线形态，需人工确认是否合法跨界）`,
        evidence: [
          `管线 ${p.code}「${p.name}」登记装置 = ${uName}`,
          `${side}设备 ${mis.code}「${mis.name}」登记装置 = ${unitName(snap, mis.unitId)}（与管线装置不一致）`,
        ],
        suggestion: `合法跨界管线（装置间边界线）属正常形态，但应满足：名称/介质反映输送任务、有明确边界管理。请人工确认该线是否为合法跨界；若否，清理 ${side}设备绑定`,
      }))
    }
  }

  // ---- R3：管线名称自称工艺单元 与 所属装置 不一致 ----
  for (const p of snap.pipelines) {
    if (!p.unitId || !p.name) continue
    const u = unitById.get(p.unitId)
    if (!u) continue
    const hit = PROCESS_UNIT_KEYWORDS.find((k) => p.name.toUpperCase().includes(k.kw.toUpperCase()))
    if (!hit) continue
    const selfOk = u.name.toUpperCase().includes(hit.expect.toUpperCase())
    if (selfOk) continue
    const r1 = out.find((v) => v.ruleId === 'R1' && v.entityCode === p.code)
    out.push(mkViolation({
      ruleId: 'R3', ruleName: '管线名称与装置归属匹配', severity: r1 ? 'ERROR' : 'WARNING',
      entityType: 'PIPELINE', entityCode: p.code, entityName: p.name,
      title: `管线名称自称「${hit.kw}」工艺单元，但登记装置为「${u.name}」`,
      evidence: [
        `管线名称 = 「${p.name}」（名称中工艺单元关键词：「${hit.kw}」）`,
        `登记装置 = 「${u.name}」（装置代码 ${u.code}）`,
        ...(r1 ? ['该管线同时命中 R1（两端设备均不在登记装置）——名称、装置、端点三者互相矛盾'] : []),
      ],
      suggestion: r1
        ? '名称、所属装置、端点绑定三者互相矛盾，必须人工核对工艺档案后统一修正（三者至少有一处为假）'
        : '管线可能为跨界线（名称反映来源/去向工艺单元）——请人工确认；若名称有误应更正管线名称',
    }))
  }

  // ---- R4：设备位号序列聚类跨装置（同一数字序列段分布于多个装置） ----
  const seqGroups = new Map<number, typeof snap.equipments>()
  for (const e of snap.equipments) {
    const n = equipmentSeqNum(e.code)
    if (n == null) continue
    const arr = seqGroups.get(n) ?? []
    arr.push(e)
    seqGroups.set(n, arr)
  }
  for (const [seq, arr] of seqGroups) {
    if (arr.length < 2) continue
    const dist = new Map<number, string[]>()
    for (const e of arr) {
      if (e.unitId == null) continue
      const list = dist.get(e.unitId) ?? []
      list.push(`${e.code}「${e.name}」`)
      dist.set(e.unitId, list)
    }
    if (dist.size < 2) continue
    const parts = [...dist.entries()].map(([uid, list]) => `${unitName(snap, uid)}: ${list.join('、')}`)
    out.push(mkViolation({
      ruleId: 'R4', ruleName: '设备位号序列聚类', severity: 'WARNING',
      entityType: 'EQUIPMENT', entityCode: `${seq} 系列`, entityName: `位号序列 ${seq}`,
      title: `同一位号序列（${seq}）的设备分散登记在 ${dist.size} 个装置（工程惯例同一序列段通常同装置）`,
      evidence: parts.map((s) => s),
      suggestion: '按装置编号惯例（同序列段同装置）人工核对其余设备的装置归属；若个别设备归属有误应修正其 unitId',
    }))
  }

  // ---- R5：隔离点位号引用可解析性 ----
  for (const pt of snap.isoPoints) {
    const tokens = [...new Set([...extractTagTokens(pt.code.replace(/^IP-/i, '')), ...extractTagTokens(pt.name), ...extractTagTokens(pt.location)])]
    if (tokens.length === 0) continue
    const missing = tokens.filter((t) => !eqNormSet.has(t) && !pipeNormSet.has(t))
    if (missing.length === 0) continue
    const pipeOfPoint = pt.pipeline ? snap.pipelines.find((p) => p.id === pt.pipeline!.id) : undefined
    out.push(mkViolation({
      ruleId: 'R5', ruleName: '隔离点位号引用校验', severity: 'WARNING',
      entityType: 'ISO_POINT', entityCode: pt.code, entityName: pt.name,
      title: `隔离点编码/名称/位置引用的位号在设备与管线台账中均不存在`,
      evidence: [
        `隔离点 ${pt.code}「${pt.name}」，位置「${pt.location ?? '未填'}」`,
        `所属管线 = ${pt.pipeline ? `${pt.pipeline.code}「${pt.pipeline.name}」` : '未关联'}`,
        `提取引用位号 = [${tokens.join('、')}]；其中无主数据对应 = [${missing.join('、')}]`,
        `所属管线登记端点 = ${pipeOfPoint ? (pipeOfPoint.startEquipment?.code ?? '?') + ' → ' + (pipeOfPoint.endEquipment?.code ?? '?') : '—'}`,
      ],
      suggestion: '核对引用位号是否存在笔误（如 R301 与实际端点不符）；若引用设备确不存在于台账，需确认是漏登记还是编码错误',
    }))
  }

  // ---- R6：主数据完整性（名称/装置/介质缺失） ----
  for (const p of snap.pipelines) {
    if (!p.name || p.name === p.code) {
      out.push(mkViolation({
        ruleId: 'R6', ruleName: '主数据完整性', severity: 'WARNING',
        entityType: 'PIPELINE', entityCode: p.code, entityName: p.name,
        title: '管线名称缺失（名称与代号相同，无业务名称）',
        evidence: [`管线 ${p.code} 的 name 字段 = 「${p.name}」`],
        suggestion: '补录管线业务名称（如「加氢裂化循环氢线」），名称是 AI 检索与人工核对的关键维度',
      }))
    }
    if (!p.medium) {
      out.push(mkViolation({
        ruleId: 'R6', ruleName: '主数据完整性', severity: 'WARNING',
        entityType: 'PIPELINE', entityCode: p.code, entityName: p.name,
        title: '管线介质未登记',
        evidence: [`管线 ${p.code}「${p.name}」的 medium 字段 = 空`],
        suggestion: '补录介质——介质缺失会影响盲板选型与工艺处置方案编制',
      }))
    }
    if (p.unitId == null) {
      out.push(mkViolation({
        ruleId: 'R6', ruleName: '主数据完整性', severity: 'WARNING',
        entityType: 'PIPELINE', entityCode: p.code, entityName: p.name,
        title: '管线所属装置未登记',
        evidence: [`管线 ${p.code}「${p.name}」的 unitId 字段 = 空`],
        suggestion: '补录所属装置——装置归属是隔离点检索范围界定的关键维度',
      }))
    }
  }
  for (const e of snap.equipments) {
    if (e.unitId == null) {
      out.push(mkViolation({
        ruleId: 'R6', ruleName: '主数据完整性', severity: 'WARNING',
        entityType: 'EQUIPMENT', entityCode: e.code, entityName: e.name,
        title: '设备所属装置未登记',
        evidence: [`设备 ${e.code}「${e.name}」的 unitId 字段 = 空`],
        suggestion: '补录设备装置归属',
      }))
    }
    if (!e.name || e.name === e.code) {
      out.push(mkViolation({
        ruleId: 'R6', ruleName: '主数据完整性', severity: 'INFO',
        entityType: 'EQUIPMENT', entityCode: e.code, entityName: e.name,
        title: '设备名称缺失（名称与位号相同）',
        evidence: [`设备 ${e.code} 的 name 字段 = 「${e.name}」`],
        suggestion: '补录设备业务名称（如「循环氢压缩机」）',
      }))
    }
  }
  for (const pt of snap.isoPoints) {
    if (!pt.location) {
      out.push(mkViolation({
        ruleId: 'R6', ruleName: '主数据完整性', severity: 'INFO',
        entityType: 'ISO_POINT', entityCode: pt.code, entityName: pt.name,
        title: '隔离点具体位置未登记',
        evidence: [`隔离点 ${pt.code}「${pt.name}」的 location 字段 = 空`],
        suggestion: '补录具体位置（法兰/阀门位号），供方案编制与 PID 挂点使用',
      }))
    }
  }

  // ---- R7：孤立设备（无任何管线连接） ----
  const connected = new Set<number>()
  for (const p of snap.pipelines) {
    if (p.startEquipmentId != null) connected.add(p.startEquipmentId)
    if (p.endEquipmentId != null) connected.add(p.endEquipmentId)
  }
  for (const e of snap.equipments) {
    if (!connected.has(e.id)) {
      out.push(mkViolation({
        ruleId: 'R7', ruleName: '孤立设备检出', severity: 'INFO',
        entityType: 'EQUIPMENT', entityCode: e.code, entityName: e.name,
        title: '设备未参与任何管线端点绑定（无进/出连线）',
        evidence: [`设备 ${e.code}「${e.name}」@${unitName(snap, e.unitId)}；无任何管线以其为起点或终点`],
        suggestion: '确认是否为待绑定新设备、或历史残留数据（如是后者建议清理）',
      }))
    }
  }

  // ---- R8：设备连线装置系统性错位（设备视角） ----
  for (const e of snap.equipments) {
    if (e.unitId == null) continue
    const links = snap.pipelines.filter((p) => p.startEquipmentId === e.id || p.endEquipmentId === e.id)
    if (links.length === 0) continue
    const allForeign = links.every((p) => p.unitId != null && p.unitId !== e.unitId)
    if (!allForeign) continue
    const foreignUnits = [...new Set(links.map((p) => unitName(snap, p.unitId)))]
    out.push(mkViolation({
      ruleId: 'R8', ruleName: '设备连线装置一致性', severity: 'WARNING',
      entityType: 'EQUIPMENT', entityCode: e.code, entityName: e.name,
      title: `设备登记于「${unitName(snap, e.unitId)}」，但其全部 ${links.length} 条连线管线均登记于其他装置（${foreignUnits.join('、')}）——疑似系统性归属错位`,
      evidence: [
        `设备 ${e.code}「${e.name}」登记装置 = ${unitName(snap, e.unitId)}`,
        ...links.map((p) => `连线 ${p.code}「${p.name}」登记装置 = ${unitName(snap, p.unitId)}（${p.startEquipment?.code ?? '?'} → ${p.endEquipment?.code ?? '?'}）`),
      ],
      suggestion: '该设备的所有对外连线均指向其他装置的管线：要么设备装置归属错误，要么全部连线登记错误。结合 R1/R4 证据人工综合判定',
    }))
  }

  return out
}

// ============ 全流程编排（快速档） ============

export interface FastAuditResult {
  stats: { units: number; equipments: number; pipelines: number; isoPoints: number }
  summary: AuditSummary
  violations: AuditViolation[]
  scopeText: string
  /** 本次体检实际使用的快照（全量或邻接子图），供深度档 LLM 复核复用，避免重复查询 */
  snapshot: MasterSnapshot
}

export function summarize(violations: AuditViolation[]): AuditSummary {
  return {
    error: violations.filter((v) => v.severity === 'ERROR').length,
    warning: violations.filter((v) => v.severity === 'WARNING').length,
    info: violations.filter((v) => v.severity === 'INFO').length,
    aiSuspect: violations.filter((v) => v.aiSuspect).length,
  }
}

export function scopeToText(scope: AuditScope): string {
  if (scope.type === 'ALL') return '全部主数据（装置/设备/管线/隔离点）'
  if (scope.type === 'UNIT') return `装置 ${scope.code} 及其全部设备/管线/隔离点`
  if (scope.type === 'EQUIPMENT') return `单设备 ${scope.code} 及其邻接数据`
  return `单管线 ${scope.code} 及其邻接数据`
}

/** 快速档：构建快照（全量/装置/单实体切片）→ 规则引擎 → 汇总 */
export async function runFastAudit(scope: AuditScope): Promise<FastAuditResult> {
  const full = await buildMasterSnapshot()
  let snap = full
  let scopeText = scopeToText(scope)
  let focus: RuleEngineOptions['focus'] = undefined
  if (scope.type === 'UNIT') {
    const slice = sliceSnapshotForUnit(full, scope.code)
    if (!slice) throw new Error(`未找到装置 ${scope.code}`)
    snap = slice
    const u = slice.units.find((x) => x.code === scope.code.trim() || x.name === scope.code.trim())
    if (u) scopeText = `装置「${u.name}」（${u.code}）及其全部设备/管线/隔离点`
  } else if (scope.type === 'EQUIPMENT' || scope.type === 'PIPELINE') {
    const slice = sliceSnapshotForEntity(full, scope.type, scope.code)
    if (!slice) throw new Error(`未找到${scope.type === 'EQUIPMENT' ? '设备' : '管线'} ${scope.code}`)
    snap = slice
    focus = { type: scope.type, code: scope.code }
  }
  const violations = runRuleEngine(snap, focus ? { focus } : {})
  return {
    stats: { units: snap.units.length, equipments: snap.equipments.length, pipelines: snap.pipelines.length, isoPoints: snap.isoPoints.length },
    summary: summarize(violations),
    violations,
    scopeText,
    snapshot: snap,
  }
}
