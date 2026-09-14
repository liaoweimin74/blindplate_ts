// 盲板管理系统 - 主数据体检 LLM 语义复核层（Task 54，深度档）
// 定位：确定性规则引擎（bp-master-validation.ts）之上的第二道语义扫描。
//  ①复核硬矛盾：LLM 逐条给出 CONFIRM / DOWNGRADE 意见——仅作为「附注」保留在原矛盾上，不自动删除（人工拍板原则）；
//  ②盲区新发现（S1 介质-设备相容 / S2 名称-端点匹配 / S3 位号语义），一律标 aiSuspect=true（疑似矛盾，需人工确认）。
// 原则：LLM 只产出判定依据，不产生硬结论、不修改任何主数据。
import { extractJson } from '@/lib/bp-ai'
import { bpComplete } from '@/lib/bp-ai'
import type { MasterSnapshot, AuditViolation, AuditEntityType } from '@/lib/bp-master-validation'

export interface AiReviewItem {
  ruleId: string
  entityCode: string
  verdict: 'CONFIRM' | 'DOWNGRADE'
  reason: string
}

export interface AiNewFinding {
  ruleId: 'S1' | 'S2' | 'S3'
  entityType: AuditEntityType
  entityCode: string
  entityName: string
  title: string
  evidence: string[]
  suggestion: string
}

export interface DeepAuditResult {
  reviews: AiReviewItem[]
  newFindings: AuditViolation[]
}

const S_RULES_DESC = `S1 介质-设备工艺相容性：管线登记的介质与压力等级，是否与其起点/终点设备类型在工艺上相容（例：12MPa 氢气进分馏塔不相容——分馏塔进料为反应油气；循环氢去储罐需核实）。仅报明显工艺冲突，不确定不报。
S2 管线名称-端点匹配性：管线名称所描述的输送任务/流向，与两端设备（名称+类型）是否匹配（例：「循环氢线」却「加热炉→分馏塔」不匹配——炉到塔通常是塔进料油气线）。
S3 位号语义-设备类型匹配：设备位号首字母与登记类型是否匹配（F=加热炉/炉、T=塔、V=容器/罐、E=换热器、P=泵、C=压缩机、R=反应器、TK=储罐）。仅报明显不符。`

/** 快照 → 紧凑行文本（控制 token：每实体一行） */
function snapshotToText(snap: MasterSnapshot): string {
  const uName = (id: number | null | undefined) => snap.units.find((u) => u.id === id)?.name ?? (id != null ? `#${id}` : '未登记')
  const eqById = new Map(snap.equipments.map((e) => [e.id, e]))
  const lines: string[] = []
  lines.push('【装置】')
  for (const u of snap.units) lines.push(`${u.code} | ${u.name}`)
  lines.push('【设备】位号|名称|类型|装置')
  for (const e of snap.equipments) lines.push(`${e.code} | ${e.name} | ${e.type} | ${e.unit ? e.unit.name : '未登记'}`)
  lines.push('【管线】代号|名称|装置|介质|压力|起点设备|终点设备')
  for (const p of snap.pipelines) {
    lines.push(`${p.code} | ${p.name} | ${p.unit ? p.unit.name : '未登记'} | ${p.medium ?? '—'} | ${p.pressure ?? '—'} | ${p.startEquipment ? `${p.startEquipment.code}(${eqById.get(p.startEquipment.id)?.unit?.name ?? '?'})` : '—'} | ${p.endEquipment ? `${p.endEquipment.code}(${eqById.get(p.endEquipment.id)?.unit?.name ?? '?'})` : '—'}`)
  }
  lines.push('【隔离点】编码|名称|位置|所属管线')
  for (const pt of snap.isoPoints) {
    lines.push(`${pt.code} | ${pt.name} | ${pt.location ?? '—'} | ${pt.pipeline ? pt.pipeline.code : '未关联'}`)
  }
  return lines.join('\n')
}

export async function runDeepReview(snap: MasterSnapshot, violations: AuditViolation[]): Promise<DeepAuditResult> {
  const hardList = violations.filter((v) => !v.aiSuspect)
  const system = `你是石化企业盲板管理系统的主数据质量审核专家，精通炼油工艺（常减压/催化裂化/加氢/重整等装置的流程逻辑）。给你一份主数据快照与规则引擎已发现的矛盾清单，执行两项任务：
一、逐条复核清单中的矛盾是否成立：
- CONFIRM = 证据与工艺常识支持该矛盾成立；
- DOWNGRADE = 证据不足以成立或存在合理解释（如合法跨界管线、位号命名特例）。给出理由。
二、扫描规则引擎的盲区，发现新的矛盾（仅限以下三类）：
${S_RULES_DESC}
严格输出 JSON（不要 markdown 代码块），结构：
{"reviews":[{"ruleId":"R1","entityCode":"PL-305","verdict":"CONFIRM","reason":"不超过60字的理由"}],"newFindings":[{"ruleId":"S1","entityType":"PIPELINE","entityCode":"...","entityName":"...","title":"一句话矛盾描述","evidence":["原始字段值逐字引用"],"suggestion":"人工核实建议"}]}
硬性要求：
1. reviews 必须覆盖清单中每一条，reason ≤60 字；
2. newFindings 只收录「确实存在矛盾」的实体——检查后匹配/相容/无问题的实体绝不要输出（例：位号首字母与类型匹配的设备不得出现在 newFindings）；
3. newFindings 可以为空数组，宁缺毋滥；
4. evidence 必须逐字引用快照中的原始字段值，不得编造或改写。`

  const user = `【主数据快照】
${snapshotToText(snap)}

【规则引擎已发现的矛盾（请逐条复核）】
${hardList.map((v, i) => `${i + 1}. [${v.ruleId}/${v.severity}] ${v.entityType} ${v.entityCode}: ${v.title}`).join('\n') || '（无）'}`

  // maxTokens 8000：全量体检硬矛盾可达数十条，每条 review 约 40 tokens——原 3000 会截断 JSON 导致解析失败（体检 DEEP 档 500 的真实根因）
  const text = await bpComplete(system, [{ role: 'user', content: user }], { maxTokens: 8000, temperature: 0.1 })
  const parsed = extractJson<{ reviews?: unknown; newFindings?: unknown }>(text)
  if (!parsed) {
    // 诊断信息：响应长度与首尾片段（空响应=推理预算耗尽/上游异常；非空截断的 JSON 尾部无闭合括号是典型特征）
    const head = text.slice(0, 120).replace(/\s+/g, ' ')
    const tail = text.slice(-80).replace(/\s+/g, ' ')
    const hint = text.length === 0
      ? 'AI 通道返回空响应（多为推理预算被思维链耗尽或上游负载），请重试'
      : '多为输出被截断，请重试'
    throw new Error(`AI 语义复核返回无法解析（响应 ${text.length} 字符，开头「${head}」结尾「${tail}」）——${hint}；若反复失败可缩小体检范围或改用快速档`)
  }

  const reviews: AiReviewItem[] = []
  if (Array.isArray(parsed.reviews)) {
    for (const r of parsed.reviews) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      const verdict = o.verdict === 'DOWNGRADE' ? 'DOWNGRADE' : 'CONFIRM'
      reviews.push({
        ruleId: String(o.ruleId ?? '?'),
        entityCode: String(o.entityCode ?? '?'),
        verdict,
        reason: String(o.reason ?? '').slice(0, 300),
      })
    }
  }

  const allowedTypes = new Set<AuditEntityType>(['UNIT', 'EQUIPMENT', 'PIPELINE', 'ISO_POINT'])
  const knownCodes = new Set([
    ...snap.units.map((u) => u.code),
    ...snap.equipments.map((e) => e.code),
    ...snap.pipelines.map((p) => p.code),
    ...snap.isoPoints.map((p) => p.code),
  ])
  // S3 硬闸栏：位号首字母与设备类型的映射是确定性知识，由代码复核 LLM 的 S3 结论，拦截幻觉误报
  // （实测 LLM 会把「E-301→换热器」这类明显匹配报成不匹配）
  const TAG_TYPE_MAP: Record<string, string> = {
    F: 'FURNACE', T: 'COLUMN', V: 'VESSEL', E: 'EXCHANGER', P: 'PUMP', C: 'COMPRESSOR', R: 'REACTOR', TK: 'TANK', B: 'TANK',
  }
  const newFindings: AuditViolation[] = []
  if (Array.isArray(parsed.newFindings)) {
    for (const f of parsed.newFindings) {
      if (!f || typeof f !== 'object') continue
      const o = f as Record<string, unknown>
      const ruleId = o.ruleId === 'S1' || o.ruleId === 'S2' || o.ruleId === 'S3' ? o.ruleId : null
      const entityType = allowedTypes.has(o.entityType as AuditEntityType) ? (o.entityType as AuditEntityType) : null
      const entityCode = String(o.entityCode ?? '')
      if (!ruleId || !entityType || !knownCodes.has(entityCode)) continue // 白名单校验：实体必须存在于快照，防幻觉
      if (ruleId === 'S3' && entityType === 'EQUIPMENT') {
        const eq = snap.equipments.find((e) => e.code === entityCode)
        if (!eq) continue
        const m = entityCode.match(/^([A-Z]{1,2})/)
        const expected = m ? TAG_TYPE_MAP[m[1]] : undefined
        // 位号首字母映射与登记类型一致 → 该「不匹配」结论为幻觉，丢弃
        if (expected && eq.type === expected) continue
      }
      const evidence = Array.isArray(o.evidence) ? o.evidence.map((x) => String(x).slice(0, 200)).slice(0, 6) : []
      newFindings.push({
        ruleId,
        ruleName: 'AI 语义复核',
        severity: 'INFO',
        entityType,
        entityCode,
        entityName: String(o.entityName ?? entityCode),
        title: String(o.title ?? '').slice(0, 200),
        evidence,
        suggestion: String(o.suggestion ?? '请人工核实').slice(0, 300),
        aiSuspect: true,
      })
    }
  }
  return { reviews, newFindings }
}

/** 把 LLM 复核意见附注到硬矛盾上（不删除、不降级——人工拍板原则） */
export function applyReviews(violations: AuditViolation[], reviews: AiReviewItem[]): AuditViolation[] {
  const key = (r: string, c: string) => `${r}::${c}`
  const map = new Map(reviews.map((r) => [key(r.ruleId, r.entityCode), r]))
  return violations.map((v) => {
    if (v.aiSuspect) return v
    const r = map.get(key(v.ruleId, v.entityCode))
    if (!r) return v
    return {
      ...v,
      evidence: [...v.evidence, `【AI 复核·${r.verdict === 'CONFIRM' ? '确认成立' : '建议降级'}】${r.reason}`],
    }
  })
}
