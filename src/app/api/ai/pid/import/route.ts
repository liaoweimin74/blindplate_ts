import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildPidLayout } from '@/lib/bp-pid-layout'
import { autoMountInlineShapes, findMountTarget, layoutPolylineOf, mountShapeOnConn, type MountContent, type MountShape } from '@/lib/bp-pid-mount'
import { normalizePidContent } from '@/lib/bp-types'
import { jsonError, num, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 设备类型白名单（与 bp-types EQUIP_TYPE_MAP 一致） */
const EQUIP_TYPES = ['COLUMN', 'REACTOR', 'EXCHANGER', 'FURNACE', 'PUMP', 'COMPRESSOR', 'TANK', 'VESSEL', 'OTHER']

/** 内联符号规格（Task 73 需求 3）：VLM 识别的管线串联符号 → 内建库 std 图元（挂接时自动旋转） */
const INLINE_SPEC: Record<string, { stdId: string; w: number; h: number; label: string }> = {
  valve: { stdId: 'vl-gate', w: 44, h: 20, label: '阀' },
  fitting: { stdId: 'pp-flange', w: 30, h: 26, label: '管件' },
  instrument: { stdId: 'in-field', w: 28, h: 26, label: '仪表' },
  pump: { stdId: 'eq-pump-c', w: 40, h: 40, label: '泵' },
}
/** 与 bp-pid-layout 画布尺寸保持一致（server 端不 import client 组件） */
const CANVAS_W = 1200
const CANVAS_H = 700

/** 归一化坐标/尺寸清洗：数字或数字字符串 → clamp 0~100；另要求 >0（尺寸为 0 无意义）；无效置 null */
function normPos(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  if (!Number.isFinite(n)) return null
  const c = Math.min(100, Math.max(0, n))
  return c > 0 ? c : null
}

interface ImportEquip { code: string; name: string; type: string; x: number | null; y: number | null; w: number | null; h: number | null }
interface ImportPipe { code: string; name: string; medium: string; spec: string; fromEquipment: string; toEquipment: string }
interface ImportPoint { code: string; name: string; pipelineCode: string; location: string }

interface ImportItemResult { code: string; id: number | null; created: boolean; note?: string }

/**
 * POST /api/ai/pid/import — AI 识别结果确认导入
 * body: {
 *   unitId?: number|null, unitName?: string,     // 关联现有装置；无则按 unitName 创建（幂等：同名复用）
 *   diagramName: string, createdBy?: string,
 *   equipments: ImportEquip[], pipelines: ImportPipe[], isoPoints: ImportPoint[]
 * }
 * 幂等：主数据按编码查重，已存在直接复用（created:false），不重复建。
 * 组态图：按导入成功的主数据自动布局生成 content（与 pid-config 编辑器结构一致），创建 PidDiagram。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)

    // ---- 参数清洗 ----
    const unitIdInput = body.unitId === undefined || body.unitId === null || str(body.unitId) === '' ? null : num(body.unitId)
    const unitName = str(body.unitName).slice(0, 60).trim()
    const diagramName = str(body.diagramName).slice(0, 60).trim() || `AI 识别 PID ${new Date().toISOString().slice(0, 10)}`
    const createdBy = str(body.createdBy).slice(0, 40)
    const equipments = (Array.isArray(body.equipments) ? body.equipments : []).map((e: Record<string, unknown>) => ({
      code: str(e.code).trim().slice(0, 40),
      name: str(e.name).trim().slice(0, 60),
      type: EQUIP_TYPES.includes(str(e.type).toUpperCase()) ? str(e.type).toUpperCase() : 'OTHER',
      // 原图归一化坐标/尺寸（0~100）：extract 已清洗，此处二次防御（无效置 null → 布局器回退）
      x: normPos(e.x),
      y: normPos(e.y),
      w: normPos(e.w),
      h: normPos(e.h),
    }))
    const pipelines = (Array.isArray(body.pipelines) ? body.pipelines : []).map((p: Record<string, unknown>) => ({
      code: str(p.code).trim().slice(0, 40),
      name: str(p.name).trim().slice(0, 60),
      medium: str(p.medium).trim().slice(0, 30),
      spec: str(p.spec).trim().slice(0, 30),
      fromEquipment: str(p.fromEquipment).trim().slice(0, 40),
      toEquipment: str(p.toEquipment).trim().slice(0, 40),
    }))
    const isoPoints = (Array.isArray(body.isoPoints) ? body.isoPoints : []).map((p: Record<string, unknown>) => ({
      code: str(p.code).trim().slice(0, 40),
      name: str(p.name).trim().slice(0, 60),
      pipelineCode: str(p.pipelineCode).trim().slice(0, 40),
      location: str(p.location).trim().slice(0, 60),
    }))
    // 内联符号（管线上的阀门/管件/在线仪表/泵）：不建主数据，作为 std 图元挂接断开（extract 已白名单清洗，此处二次防御）
    const inlineSymbols = (Array.isArray(body.inlineSymbols) ? body.inlineSymbols : [])
      .map((s: Record<string, unknown>) => ({
        kind: str(s.kind).trim(),
        pipelineCode: str(s.pipelineCode).trim().slice(0, 40),
        x: normPos(s.x),
        y: normPos(s.y),
        label: str(s.label).trim().slice(0, 30),
      }))
      .filter((s: { kind: string }) => INLINE_SPEC[s.kind])

    if (equipments.length === 0 && pipelines.length === 0 && isoPoints.length === 0) {
      return jsonError('没有可导入的数据（设备/管线/隔离点均为空）')
    }

    const result = await db.$transaction(async (tx) => {
      // ---- 1. 装置解析（复用 > 同名复用 > 新建） ----
      let unit: { id: number; name: string; created: boolean } | null = null
      if (unitIdInput !== null) {
        const found = await tx.unit.findUnique({ where: { id: unitIdInput } })
        if (!found) throw new Error('关联装置不存在')
        unit = { id: found.id, name: found.name, created: false }
      } else if (unitName) {
        const byName = await tx.unit.findFirst({ where: { name: unitName } })
        if (byName) {
          unit = { id: byName.id, name: byName.name, created: false }
        } else {
          // 编码：优先用装置名本身，冲突则时间戳兜底
          const codeExists = await tx.unit.findUnique({ where: { code: unitName } })
          const code = codeExists ? `PID-${Date.now().toString(36).toUpperCase()}` : unitName
          const created = await tx.unit.create({
            data: { code, name: unitName, remark: 'AI 识别 PID 导入自动创建' },
          })
          unit = { id: created.id, name: created.name, created: true }
        }
      }
      const theUnitId = unit?.id ?? null

      // ---- 2. 设备（幂等复用） ----
      const equipmentResults: ImportItemResult[] = []
      const equipmentIdByCode = new Map<string, number>()
      for (const e of equipments) {
        if (!e.code) {
          equipmentResults.push({ code: '(位号为空)', id: null, created: false, note: '位号为空，无法导入' })
          continue
        }
        const exists = await tx.equipment.findUnique({ where: { code: e.code } })
        if (exists) {
          equipmentIdByCode.set(e.code, exists.id)
          equipmentResults.push({ code: e.code, id: exists.id, created: false, note: '已存在，直接复用' })
          continue
        }
        const created = await tx.equipment.create({
          data: { code: e.code, name: e.name || e.code, type: e.type, unitId: theUnitId, remark: 'AI 识别 PID 导入' },
        })
        equipmentIdByCode.set(e.code, created.id)
        equipmentResults.push({ code: e.code, id: created.id, created: true })
      }

      // ---- 3. 管线（起止设备按位号解析；幂等复用） ----
      const pipelineResults: ImportItemResult[] = []
      const pipelineIdByCode = new Map<string, number>()
      for (const p of pipelines) {
        if (!p.code) {
          pipelineResults.push({ code: '(编码为空)', id: null, created: false, note: '编码为空，无法导入' })
          continue
        }
        const exists = await tx.pipeline.findUnique({ where: { code: p.code } })
        if (exists) {
          pipelineIdByCode.set(p.code, exists.id)
          pipelineResults.push({ code: p.code, id: exists.id, created: false, note: '已存在，直接复用' })
          continue
        }
        const startId = p.fromEquipment ? equipmentIdByCode.get(p.fromEquipment) ?? null : null
        const endId = p.toEquipment ? equipmentIdByCode.get(p.toEquipment) ?? null : null
        const created = await tx.pipeline.create({
          data: {
            code: p.code,
            name: p.name || p.code,
            unitId: theUnitId,
            medium: p.medium || null,
            spec: p.spec || null,
            startEquipmentId: startId,
            endEquipmentId: endId,
            remark: 'AI 识别 PID 导入',
          },
        })
        pipelineIdByCode.set(p.code, created.id)
        pipelineResults.push({ code: p.code, id: created.id, created: true })
      }

      // ---- 4. 隔离点主数据（幂等复用） ----
      const pointResults: ImportItemResult[] = []
      const pointIdByCode = new Map<string, number>()
      for (const pt of isoPoints) {
        if (!pt.code) {
          pointResults.push({ code: '(编号为空)', id: null, created: false, note: '编号为空，无法导入' })
          continue
        }
        const exists = await tx.isoPointMaster.findUnique({ where: { code: pt.code } })
        if (exists) {
          pointIdByCode.set(pt.code, exists.id)
          pointResults.push({ code: pt.code, id: exists.id, created: false, note: '已存在，直接复用' })
          continue
        }
        // 需求19：隔离点关联的管线一并导入——AI 结果给出 pipelineCode 但管线清单缺失/未导入时，自动补建该管线，
        // 避免隔离点管线归属静默丢失（pipelineId 下游被占用检查/PID 归属推导依赖）
        let pipeId: number | null = null
        if (pt.pipelineCode) {
          pipeId = pipelineIdByCode.get(pt.pipelineCode) ?? null
          if (pipeId == null) {
            const autoPipe = await tx.pipeline.create({
              data: {
                code: pt.pipelineCode,
                name: pt.pipelineCode,
                unitId: theUnitId,
                remark: 'AI 识别 PID 导入·隔离点关联管线自动补建',
              },
            })
            pipelineIdByCode.set(pt.pipelineCode, autoPipe.id)
            pipelineResults.push({ code: pt.pipelineCode, id: autoPipe.id, created: true, note: '随隔离点自动补建' })
            pipeId = autoPipe.id
          }
        }
        const created = await tx.isoPointMaster.create({
          data: {
            code: pt.code,
            name: pt.name || pt.code,
            pipelineId: pipeId,
            location: pt.location || null,
            remark: 'AI 识别 PID 导入',
          },
        })
        pointIdByCode.set(pt.code, created.id)
        pointResults.push({ code: pt.code, id: created.id, created: true })
      }

      // ---- 5. 自动布局生成组态图 content ----
      const layoutEquips = equipments
        .filter((e) => e.code && equipmentIdByCode.has(e.code))
        .map((e) => ({ id: equipmentIdByCode.get(e.code)!, code: e.code, name: e.name, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h }))
      const layoutPipes = pipelines
        .filter((p) => p.code && pipelineIdByCode.has(p.code))
        .map((p) => ({ id: pipelineIdByCode.get(p.code)!, code: p.code, name: p.name, fromEquipment: p.fromEquipment || null, toEquipment: p.toEquipment || null }))
      const layoutPoints = isoPoints
        .filter((pt) => pt.code && pointIdByCode.has(pt.code))
        .map((pt) => ({ id: pointIdByCode.get(pt.code)!, code: pt.code, name: pt.name, pipelineCode: pt.pipelineCode || null }))

      // 内联符号将追加为可旋转图元（LayoutShape 无 rotation），放宽为 MountContent 结构处理
      const content = buildPidLayout(layoutEquips, layoutPipes, layoutPoints) as unknown as MountContent & {
        marks: ReturnType<typeof buildPidLayout>['marks']
      }

      // ---- 5b. 内联符号挂接（Task 73 需求 3）：管线上的阀门/管件/仪表/泵自动挂接断开 ----
      let inlineMounted = 0
      let inlineSeq = 0
      if (inlineSymbols.length > 0) {
        const polyOf = layoutPolylineOf((id) => content.shapes.find((s) => s.id === id))
        const inlineIds: { id: string; pipelineCode: string }[] = []
        for (const sym of inlineSymbols) {
          const spec = INLINE_SPEC[sym.kind]
          const pipeId = sym.pipelineCode ? pipelineIdByCode.get(sym.pipelineCode) ?? null : null
          const targetConn = pipeId != null ? content.connections.find((c) => c.pipelineId === pipeId) : undefined
          // 位置：VLM 归一化坐标 → 画布；无坐标且有目标管线 → 该管线折线中段；无目标 → 画布中部待几何兜底
          let cx = sym.x != null ? (sym.x / 100) * CANVAS_W : targetConn ? NaN : CANVAS_W / 2
          let cy = sym.y != null ? (sym.y / 100) * CANVAS_H : targetConn ? NaN : CANVAS_H / 2 - 40
          if (Number.isNaN(cx) || Number.isNaN(cy)) {
            const pts = targetConn ? polyOf(targetConn) : null
            if (pts && pts.length >= 2) {
              const mid = pts[Math.floor(pts.length / 2)]
              cx = (pts[0][0] + mid[0]) / 2
              cy = (pts[0][1] + mid[1]) / 2
            } else {
              cx = CANVAS_W / 2
              cy = CANVAS_H / 2 - 40
            }
          }
          const sid = `s-i${++inlineSeq}`
          content.shapes.push({
            id: sid, type: 'std', stdId: spec.stdId,
            x: Math.round(cx - spec.w / 2), y: Math.round(cy - spec.h / 2),
            w: spec.w, h: spec.h,
            label: sym.label || `${spec.label}-${inlineSeq}`,
          } as MountShape)
          inlineIds.push({ id: sid, pipelineCode: sym.pipelineCode })
        }
        // 定向挂接：给了所属管线的符号，中心投影到该管线各段最近点后断开粘合（逐个处理，段随挂接演化）
        for (const { id: sid, pipelineCode } of inlineIds) {
          if (!pipelineCode) continue
          const pipeId = pipelineIdByCode.get(pipelineCode)
          if (pipeId == null) continue
          const shape = content.shapes.find((s) => s.id === sid)
          if (!shape) continue
          const cx = shape.x + shape.w / 2
          const cy = shape.y + shape.h / 2
          let bestPt: { x: number; y: number } | null = null
          let bestD = Infinity
          for (const c of content.connections) {
            if (c.pipelineId !== pipeId) continue
            const pts = polyOf(c)
            if (!pts || pts.length < 2) continue
            for (let i = 0; i < pts.length - 1; i++) {
              const [x1, y1] = pts[i]
              const [x2, y2] = pts[i + 1]
              const dx = x2 - x1
              const dy = y2 - y1
              const L2 = dx * dx + dy * dy
              const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / L2))
              const px = x1 + t * dx
              const py = y1 + t * dy
              const d = Math.hypot(cx - px, cy - py)
              if (d < bestD) {
                bestD = d
                bestPt = { x: Math.round(px), y: Math.round(py) }
              }
            }
          }
          if (!bestPt) continue
          shape.x = bestPt.x - Math.round(shape.w / 2)
          shape.y = bestPt.y - Math.round(shape.h / 2)
          const hit = findMountTarget(content, sid, polyOf)
          if (hit) {
            const r = mountShapeOnConn(content, sid, hit, () => `c-i${++inlineSeq}`)
            content.shapes = r.shapes
            content.connections = r.connections
            inlineMounted++
          }
        }
        // 几何兜底：未给所属管线但位置贴线的符号自动吸附（挂接数 = 新增旋转图元数）
        const rotatedBefore = content.shapes.filter((s) => (s as { rotation?: number }).rotation != null).length
        const rest = autoMountInlineShapes(content, polyOf, () => `c-i${++inlineSeq}`)
        content.shapes = rest.shapes
        content.connections = rest.connections
        const rotatedAfter = content.shapes.filter((s) => (s as { rotation?: number }).rotation != null).length
        inlineMounted += rotatedAfter - rotatedBefore
      }
      const inlineTotal = inlineSymbols.length

      const normalized = normalizePidContent(content)
      if (!normalized) throw new Error('组态图 content 生成异常')

      // 未连线管线数：起止设备任一缺失，布局器无法画线（需人工在组态图补线）
      const unconnectedPipes = layoutPipes.filter((p) => !p.fromEquipment || !p.toEquipment).length

      const diagram = await tx.pidDiagram.create({
        data: { name: diagramName, unitId: theUnitId, content: normalized, createdBy: createdBy || null },
      })

      return { unit, equipmentResults, pipelineResults, pointResults, diagram, unconnectedPipes, inlineTotal, inlineMounted }
    })

    return NextResponse.json(
      {
        unit: result.unit,
        equipments: result.equipmentResults,
        pipelines: result.pipelineResults,
        isoPoints: result.pointResults,
        diagram: {
          id: result.diagram.id,
          name: result.diagram.name,
          shapeCount: result.diagram.content ? JSON.parse(result.diagram.content).shapes.length : 0,
          connCount: result.diagram.content ? JSON.parse(result.diagram.content).connections.length : 0,
          markCount: result.diagram.content ? JSON.parse(result.diagram.content).marks.length : 0,
          unconnectedPipes: result.unconnectedPipes,
          inlineSymbols: result.inlineTotal,
          inlineMounted: result.inlineMounted,
        },
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('[POST /api/ai/pid/import]', e)
    return jsonError(e instanceof Error ? e.message : 'PID 识别结果导入失败', 500)
  }
}
