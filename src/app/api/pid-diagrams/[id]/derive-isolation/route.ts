import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, parseId } from '@/lib/bp-server-utils'
import { bpComplete, extractJson } from '@/lib/bp-ai'
import {
  deriveIsolationCandidates, isEquipmentLike,
  type DerivedCandidate, type DeriveConn, type DeriveMark, type DeriveShape,
} from '@/lib/bp-pid-derive'

export const dynamic = 'force-dynamic'

/**
 * POST /api/pid-diagrams/[id]/derive-isolation —— 自动标注隔离点（Task 81，用户批准）
 *
 * 流程：
 * 1. 图遍历（bp-pid-derive 纯函数）：整图主要设备各自作为隔离包络，按「隔离包络边界」规则
 *    对每条对外连接推导候选隔离点（截断阀包络侧法兰 → 设备接口法兰 → 管线盲端三级回退）
 * 2. 去重：与已有挂标 30 单位内视为已标注（跳过）；候选同位重复按管线区分（同管线跳过/异管线偏移保留）
 * 3. LLM 语义分析（一次调用，无效自动重试一次，仍无效降级为确定性命名——透明标注 llmDegraded）：
 *    每个候选产出 {建议编码, 位置名称, 与现有隔离点主数据的匹配判定, 风险提示}；
 *    匹配判定仅当语义上明显为同一物理位置时给出（宁可漏配不可错配）
 * 4. apply=true 时写入挂标（不改主数据）：
 *    - 命中现有主数据 → 挂标绑定 masterPointId（已入主数据图标）；该主数据在本图已有标注则跳过
 *    - 未命中 → 候选挂标（编码可后续经「生成主数据」按编码建档/关联）
 * body: { apply?: boolean }（apply=false 为预览模式，不写库）
 */

interface LlmItem { i: number; code: string; name: string; matchedMasterId: number | null; risk: string | null }

interface DeriveAdded {
  code: string
  name: string
  x: number
  y: number
  bound: boolean
  masterCode?: string | null
  risk?: string | null
}
interface DeriveSkipped { reason: string; equipLabel: string; pathDesc: string; x: number; y: number }

const hyp = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by)

const VALVE_KIND_LABEL: Record<string, string> = {
  shutoff: '截断阀', check: '止回阀', control: '调节阀', relief: '泄放阀', special: '特殊阀', actuator: '执行机构', base: '阀门',
}

/** LLM 输出校验（Task 80 教训：输出格式会漂移——宽容解析 + 逐字段严格校验） */
function parseLlmItems(raw: unknown, candCount: number, masterIds: Set<number>): LlmItem[] | null {
  if (!raw || typeof raw !== 'object') return null
  const items = (raw as { items?: unknown }).items
  if (!Array.isArray(items) || items.length === 0) return null
  const out: LlmItem[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const i = Number(o.i)
    if (!Number.isInteger(i) || i < 0 || i >= candCount) continue
    const code = String(o.code ?? '').trim().toUpperCase()
    const name = String(o.name ?? '').trim()
    if (!code || !name) continue
    let matched: number | null = null
    const mid = o.matchedMasterId
    if (mid != null && mid !== '' && mid !== 'null') {
      const n = Number(mid)
      if (Number.isInteger(n) && masterIds.has(n)) matched = n
    }
    const risk = o.risk == null ? null : String(o.risk).trim().slice(0, 60) || null
    out.push({ i, code: code.slice(0, 24), name: name.slice(0, 24), matchedMasterId: matched, risk })
  }
  return out.length > 0 ? out : null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const did = parseId(id)
    if (!did) return jsonError('无效的 PID 图 ID')
    const diagram = await db.pidDiagram.findUnique({ where: { id: did } })
    if (!diagram) return jsonError('PID 图不存在', 404)

    let body: { apply?: boolean } = {}
    try { body = await req.json() } catch { /* 缺省 apply=true */ }
    const apply = body.apply !== false

    let parsed: { shapes?: DeriveShape[]; connections?: DeriveConn[]; marks?: DeriveMark[] }
    try {
      parsed = JSON.parse(diagram.content || '{}')
    } catch {
      return jsonError('组态图 content 解析失败，请先在编辑器保存一次')
    }
    const shapes = Array.isArray(parsed.shapes) ? parsed.shapes : []
    const connections = Array.isArray(parsed.connections) ? parsed.connections : []
    const marks = Array.isArray(parsed.marks) ? parsed.marks : []
    if (!shapes.some((s) => s && isEquipmentLike(s))) {
      return jsonError('图上没有可作为隔离包络的设备图元（需先放置设备并保存）')
    }

    // ---- 1. 图遍历推导候选 ----
    const all = deriveIsolationCandidates(shapes, connections)
    if (all.length === 0) return jsonError('未能从图中推导出任何对外连接（请检查设备与连线）')

    // ---- 2. 去重：已有挂标 30 单位内视为已标注；候选同位按管线区分 ----
    const skipped: DeriveSkipped[] = []
    const kept: Array<DerivedCandidate & { dx: number }> = []
    for (const c of all) {
      const nearMark = marks.some((m) => m && hyp(c.x, c.y, m.x, m.y) <= 30)
      if (nearMark) {
        skipped.push({ reason: '附近已有隔离点标注', equipLabel: c.equipLabel, pathDesc: c.pathDesc, x: c.x, y: c.y })
        continue
      }
      const twin = kept.find((k) => Math.abs(c.x - (k.x + k.dx)) < 18 && Math.abs(c.y - k.y) < 18)
      if (twin) {
        if (c.pipelineId != null && twin.pipelineId != null && c.pipelineId !== twin.pipelineId) {
          kept.push({ ...c, dx: 18 }) // 同位异管线（平行线）：偏移保留
        } else {
          skipped.push({ reason: '同点位重复候选', equipLabel: c.equipLabel, pathDesc: c.pathDesc, x: c.x, y: c.y })
        }
        continue
      }
      kept.push({ ...c, dx: 0 })
    }
    if (kept.length === 0) {
      return NextResponse.json({ total: all.length, analyzed: 0, added: [], skipped, llmDegraded: false, applied: false, note: '所有候选位置均已有标注' })
    }

    // ---- 3. LLM 语义分析（命名/编码/匹配/风险；一次重试，失败降级确定性命名） ----
    const [pipelines, masters] = await Promise.all([
      db.pipeline.findMany({ select: { id: true, code: true, medium: true, pressure: true } }),
      db.isoPointMaster.findMany({ select: { id: true, code: true, name: true, location: true, pipelineId: true }, take: 300 }),
    ])
    const pipeById = new Map(pipelines.map((p) => [p.id, p]))
    const masterIds = new Set(masters.map((m) => m.id))
    const candPayload = kept.map((c, i) => ({
      i,
      equipTag: c.equipTag,
      equipLabel: c.equipLabel,
      otherTag: c.otherTag,
      otherLabel: c.otherLabel,
      pipelineCode: c.pipelineId != null ? (pipeById.get(c.pipelineId)?.code ?? null) : null,
      mode: c.mode === 'valve' ? '截断阀包络侧法兰' : c.mode === 'nozzle' ? '设备接口法兰' : '管线盲端',
      valveLabel: c.valveLabel,
      valveKind: c.valveKind ? (VALVE_KIND_LABEL[c.valveKind] ?? c.valveKind) : null,
      pathDesc: c.pathDesc,
    }))
    const masterPayload = masters.map((m) => ({
      id: m.id, code: m.code, name: m.name, location: m.location,
      pipelineCode: m.pipelineId != null ? (pipeById.get(m.pipelineId)?.code ?? null) : null,
    }))

    const system = [
      '你是石化盲板管理系统的工艺安全专家。任务：对 PID 图拓扑推导出的候选隔离点做语义分析，',
      '为每个候选产出建议编码、位置名称、与现有隔离点主数据的匹配判定、风险提示。',
      '',
      '业务规则（GB 30871 盲板抽堵惯例）：',
      '- 盲板加在切断阀靠检修对象侧法兰；无切断阀时在设备接口法兰；管线盲端在末端',
      '- 止回阀/调节阀/安全阀不可靠隔离，不应作为隔离边界（若候选路径仅靠这些阀门隔离需提示风险）',
      '- 候选的 mode/valveKind 字段由图算法给出，供你校核：若阀门位号语义与阀门类型矛盾（如 FV- 前缀通常是流量调节阀却标为截断阀），在 risk 中提示复核',
      '',
      '输出要求：仅输出严格 JSON，不输出任何其他文字：',
      '{"items":[{"i":<候选序号>,"code":"<建议编码>","name":"<位置名称>","matchedMasterId":<number|null>,"risk":<string|null>}]}',
      '- code：与现有主数据编码风格一致（如 IP-E101-01），即 IP-<设备位号或管线标识>-<两位序号>；全部候选编码不得重复',
      '- name：≤14 字中文位置描述（如「E101入口法兰」「P101A出口阀后」）',
      '- matchedMasterId：仅当候选与某条现有主数据明显为同一物理位置（同设备同接口/同阀门同侧）时填其 id，否则 null；宁可漏配不可错配',
      '- risk：一条简短风险/注意提示或 null',
    ].join('\n')
    const user = `【候选隔离点】\n${JSON.stringify(candPayload)}\n\n【现有隔离点主数据】\n${JSON.stringify(masterPayload)}\n\n【管线主数据】\n${JSON.stringify(pipelines.map((p) => ({ id: p.id, code: p.code, medium: p.medium, pressure: p.pressure })))}`

    let llmItems: LlmItem[] | null = null
    let llmDegraded = false
    for (let attempt = 0; attempt < 2 && !llmItems; attempt++) {
      try {
        const text = await bpComplete(system, [{ role: 'user', content: attempt === 0 ? user : user + '\n\n（上一次输出无法解析，请严格按 JSON 格式重新输出）' }], { maxTokens: 3000, temperature: 0.2 })
        llmItems = parseLlmItems(extractJson(text), kept.length, masterIds)
      } catch {
        llmItems = null
      }
    }
    if (!llmItems) llmDegraded = true

    // 确定性降级命名 + 编码唯一性保障（LLM 命名同样查重，冲突自动加序号）
    const usedCodes = new Set<string>([
      ...masters.map((m) => m.code.toUpperCase()),
      ...marks.map((m) => String(m.code ?? '').trim().toUpperCase()).filter(Boolean),
    ])
    const byIdx = new Map<number, LlmItem>((llmItems ?? []).map((it) => [it.i, it]))
    const freshCode = (base: string): string => {
      let code = base
      if (usedCodes.has(code)) {
        let n = 2
        while (n < 100 && usedCodes.has(`${code}-${n}`)) n++
        code = `${code}-${n}`
      }
      usedCodes.add(code)
      return code
    }
    const analyzeOf = (idx: number, c: DerivedCandidate & { dx: number }): LlmItem => {
      const it = byIdx.get(idx)
      if (it) return { ...it, code: freshCode(it.code) }
      const name = c.mode === 'valve'
        ? `${c.valveLabel || '切断阀'}靠${c.equipTag || c.equipLabel}侧`
        : c.mode === 'dead-end' ? `${c.equipTag || c.equipLabel}侧管线盲端` : `${c.equipTag || c.equipLabel}接口法兰`
      return {
        i: idx, code: freshCode(`IP-${c.equipTag || 'PID'}`), name: name.slice(0, 24), matchedMasterId: null,
        risk: c.mode === 'nozzle' ? '该连接未识别到切断阀，隔离点为设备接口法兰' : c.mode === 'dead-end' ? '管线盲端，隔离点在末端' : null,
      }
    }

    // ---- 4. 生成挂标（apply 才写库） ----
    const added: DeriveAdded[] = []
    const claimedMasters = new Set<number>()
    const newMarks: DeriveMark[] = []
    kept.forEach((c, idx) => {
      const a = analyzeOf(idx, c)
      const master = a.matchedMasterId != null ? masters.find((m) => m.id === a.matchedMasterId) ?? null : null
      if (master) {
        if (claimedMasters.has(master.id) || marks.some((m) => m.masterPointId === master.id) || newMarks.some((m) => m.masterPointId === master.id)) {
          skipped.push({ reason: `主数据 ${master.code} 在本图已有标注`, equipLabel: c.equipLabel, pathDesc: c.pathDesc, x: c.x, y: c.y })
          return
        }
        claimedMasters.add(master.id)
        newMarks.push({ id: `m-${Date.now().toString(36)}-${idx}`, code: master.code, name: master.name, x: c.x + c.dx, y: c.y, masterPointId: master.id })
        added.push({ code: master.code, name: master.name, x: c.x + c.dx, y: c.y, bound: true, masterCode: master.code, risk: a.risk })
        return
      }
      newMarks.push({ id: `m-${Date.now().toString(36)}-${idx}`, code: a.code, name: a.name, x: c.x + c.dx, y: c.y })
      added.push({ code: a.code, name: a.name, x: c.x + c.dx, y: c.y, bound: false, risk: a.risk })
    })

    if (apply && newMarks.length > 0) {
      const content = JSON.stringify({ shapes, connections, marks: [...marks, ...newMarks] })
      await db.pidDiagram.update({ where: { id: did }, data: { content } })
    }

    return NextResponse.json({
      total: all.length,
      analyzed: kept.length,
      added,
      skipped,
      llmDegraded,
      applied: apply && newMarks.length > 0,
    })
  } catch (e) {
    console.error('[POST /api/pid-diagrams/[id]/derive-isolation]', e)
    return jsonError(e instanceof Error ? e.message : '自动标注隔离点失败', 500)
  }
}


