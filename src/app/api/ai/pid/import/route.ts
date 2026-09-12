import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildPidLayout } from '@/lib/bp-pid-layout'
import { normalizePidContent } from '@/lib/bp-types'
import { jsonError, num, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 设备类型白名单（与 bp-types EQUIP_TYPE_MAP 一致） */
const EQUIP_TYPES = ['COLUMN', 'REACTOR', 'EXCHANGER', 'FURNACE', 'PUMP', 'COMPRESSOR', 'TANK', 'VESSEL', 'OTHER']

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
        const created = await tx.isoPointMaster.create({
          data: {
            code: pt.code,
            name: pt.name || pt.code,
            pipelineId: pt.pipelineCode ? pipelineIdByCode.get(pt.pipelineCode) ?? null : null,
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

      const content = buildPidLayout(layoutEquips, layoutPipes, layoutPoints)
      const normalized = normalizePidContent(content)
      if (!normalized) throw new Error('组态图 content 生成异常')

      // 未连线管线数：起止设备任一缺失，布局器无法画线（需人工在组态图补线）
      const unconnectedPipes = layoutPipes.filter((p) => !p.fromEquipment || !p.toEquipment).length

      const diagram = await tx.pidDiagram.create({
        data: { name: diagramName, unitId: theUnitId, content: normalized, createdBy: createdBy || null },
      })

      return { unit, equipmentResults, pipelineResults, pointResults, diagram, unconnectedPipes }
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
        },
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('[POST /api/ai/pid/import]', e)
    return jsonError(e instanceof Error ? e.message : 'PID 识别结果导入失败', 500)
  }
}
