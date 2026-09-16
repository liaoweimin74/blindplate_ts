import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { distToSegment, layoutPolylineOf, type MountShape } from '@/lib/bp-pid-mount'
import { jsonError, parseId } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/pid-diagrams/[id]/generate-master —— 由 PID 图生成主数据（Task 73 需求 2）
 *
 * 规则（按图元和标识自动对应，全部幂等：编码已存在直接复用不重建）：
 * 1. 设备：工艺类图元（设备类型 / eq-* 标准符号 / 自定义图元）从 label 提取位号（如 T-101/P-201A），
 *    幂等建 Equipment 并回填 shape.equipmentId；已绑定 / 无位号 / 阀门管件仪表等内联符号跳过；
 * 2. 管线：两端图元均已绑定设备的连线 → 管线号 = 「起点位号-终点位号-序号」（序号从 1 递增，
 *    旧式无序号编码存在时视其为 1 号从 -2 起步；起点=终点自环管线照常生成但带 ⚠ 提示标记），
 *    幂等建 Pipeline（起止设备回填）并回填 connection.pipelineId；已绑定 / 端点缺设备的连线跳过；
 *    悬空自愈：图 JSON 可能残留已删除管线的旧 id（如图从旧图复制），重置为未绑定重新生成，
 *    否则隔离点归属阶段会拿悬空 id 建 IsoPointMaster → 外键约束崩溃（图 24 实证）；
 * 3. 隔离点：挂标 code → 幂等建 IsoPointMaster（所属管线按挂标到各管线折线的最近距离推导），
 *    并回填 mark.masterPointId；已绑定 / 编码为空的挂标跳过；已绑定但主数据缺管线归属的补归属；
 *    设备引用同理悬空自愈（重置后按 label 位号重新生成/关联，图 20/22/23/24 实证）。
 * 全程事务；回填后的 content 写回组态图，前端刷新后图元/连线/挂标与主数据一一对应。
 *
 * body: { apply?: boolean } —— 预览确认模式（用户要求：先预览、确认后再生成）：
 * - apply=false（默认）预览：完整推导变更计划但不写库，将新建项用负数临时 id 标记；
 * - apply=true 才真正生成入库、回填绑定并保存组态图。
 */

interface GenShape {
  id: string
  type: string
  stdId?: string
  x: number
  y: number
  w: number
  h: number
  label?: string
  rotation?: number
  equipmentId?: number | null
}
interface GenConn {
  id: string
  fromShape: string
  fromAnchor: 'top' | 'right' | 'bottom' | 'left'
  toShape: string
  toAnchor: 'top' | 'right' | 'bottom' | 'left'
  pipelineId?: number | null
  direction?: string
}
interface GenMark { id: string; code: string; name?: string; x: number; y: number; masterPointId?: number | null }

interface GenItem { code: string; id: number | null; created: boolean; note?: string }
interface GenGroup { created: number; linked: number; skipped: number; items: GenItem[] }

/** 图元 label → 位号提取：首个空白分隔 token 匹配位号模式（T-101 / P201A / E-301 等）；
 *  A/B 备用对写法（如 P101A/B 脱苯塔底泵）取斜杠前主机位号 P101A */
function tagOf(label: string | undefined): string | null {
  if (!label) return null
  const first = label.trim().split(/\s+/)[0] ?? ''
  if (/^[A-Za-z]{1,4}-?\d{1,4}[A-Za-z]?$/.test(first)) return first.toUpperCase()
  const slashIdx = first.indexOf('/')
  if (slashIdx > 0) {
    const head = first.slice(0, slashIdx)
    if (/^[A-Za-z]{1,4}-?\d{1,4}[A-Za-z]?$/.test(head)) return head.toUpperCase()
  }
  return null
}

/** 工艺设备图元判定（阀门/管件/仪表等内联符号与基础图形不算设备） */
function isEquipmentLike(s: GenShape): boolean {
  if (['exchanger', 'reactor', 'column', 'pump', 'tank'].includes(s.type)) return true
  if (s.type === 'std' && typeof s.stdId === 'string' && s.stdId.startsWith('eq-')) return true
  if (s.type === 'symbol') return true // 自定义图元按设备对待（用户组合的设备符号）
  return false
}

/** 图元 → Equipment.type 映射 */
function equipTypeOf(s: GenShape): string {
  const direct: Record<string, string> = { column: 'COLUMN', reactor: 'REACTOR', exchanger: 'EXCHANGER', pump: 'PUMP', tank: 'TANK' }
  if (direct[s.type]) return direct[s.type]
  const sid = s.stdId ?? ''
  if (/fixed-bed|fluid-bed|reactor/.test(sid)) return 'REACTOR'
  if (/col/.test(sid)) return 'COLUMN'
  if (/bhe|phe|condens|cool|airfin|exchang/.test(sid)) return 'EXCHANGER'
  if (/furnace|heater/.test(sid)) return 'FURNACE'
  if (/pump|blower|fan/.test(sid)) return 'PUMP'
  if (/compressor/.test(sid)) return 'COMPRESSOR'
  if (/vtank|gasholder|sphere/.test(sid)) return 'TANK'
  if (/htank|drum|vessel|buffer/.test(sid)) return 'VESSEL'
  return 'OTHER'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const did = parseId(id)
    if (!did) return jsonError('无效的 PID 图 ID')
    let body: { apply?: boolean } = {}
    try { body = await req.json() } catch { /* 缺省预览模式 */ }
    const apply = body.apply === true
    const diagram = await db.pidDiagram.findUnique({ where: { id: did } })
    if (!diagram) return jsonError('PID 图不存在', 404)

    let parsed: { shapes?: GenShape[]; connections?: GenConn[]; marks?: GenMark[] }
    try {
      parsed = JSON.parse(diagram.content || '{}')
    } catch {
      return jsonError('组态图 content 解析失败，请先在编辑器保存一次')
    }
    const shapes = Array.isArray(parsed.shapes) ? parsed.shapes : []
    const connections = Array.isArray(parsed.connections) ? parsed.connections : []
    const marks = Array.isArray(parsed.marks) ? parsed.marks : []
    if (shapes.length === 0 && marks.length === 0) {
      return jsonError('图上没有可生成主数据的图元/标注')
    }

    const result = await db.$transaction(async (tx) => {
      const shapeById = new Map(shapes.map((s) => [s.id, s]))

      // ---- 1. 设备 ----
      const equipments: GenGroup = { created: 0, linked: 0, skipped: 0, items: [] }
      // 悬空设备引用自愈：图元绑定的设备 id 若已不存在（历史删除/跨图复制），重置为未绑定，
      // 再按 label 位号重新生成/关联；否则设备阶段误计 skipped，管线端点校验静默失败
      const existingEquipIds = new Set((await tx.equipment.findMany({ select: { id: true } })).map((e) => e.id))
      // 预览模式虚拟设备：负数临时 id → 位号（供管线阶段解析端点编码，不落库）
      const virtualEquipCode = new Map<number, string>()
      let fakeEquipSeq = 0
      for (const s of shapes) {
        if (s.equipmentId != null && !existingEquipIds.has(s.equipmentId)) s.equipmentId = null
        if (s.equipmentId != null) { equipments.skipped++; continue }
        if (!isEquipmentLike(s)) { continue } // 内联符号/基础图形静默跳过（不计 skipped）
        const tag = tagOf(s.label)
        if (!tag) {
          equipments.skipped++
          equipments.items.push({ code: s.label?.slice(0, 20) || '(无位号)', id: null, created: false, note: 'label 首词不是位号格式' })
          continue
        }
        const exists = await tx.equipment.findUnique({ where: { code: tag } })
        if (exists) {
          s.equipmentId = exists.id
          equipments.linked++
          equipments.items.push({ code: tag, id: exists.id, created: false, note: apply ? '已存在，已关联到图元' : '编码已存在，将关联到图元' })
          continue
        }
        const name = (s.label ?? '').trim().slice(0, 60)
        if (apply) {
          const created = await tx.equipment.create({
            data: {
              code: tag,
              name: name || tag,
              type: equipTypeOf(s),
              unitId: diagram.unitId,
              remark: 'PID 图生成主数据自动创建',
            },
          })
          s.equipmentId = created.id
          equipments.created++
          equipments.items.push({ code: tag, id: created.id, created: true })
        } else {
          fakeEquipSeq -= 1
          s.equipmentId = fakeEquipSeq
          virtualEquipCode.set(fakeEquipSeq, tag)
          equipments.created++
          equipments.items.push({ code: tag, id: fakeEquipSeq, created: true, note: '将新建' })
        }
      }

      // ---- 2. 管线 ----
      const pipelines: GenGroup = { created: 0, linked: 0, skipped: 0, items: [] }
      // 需求21(二)：编号 = 「起点位号-终点位号-序号」（序号始终存在，从 1 递增）；
      // 兼容旧数据：若裸「起点-终点」编码已存在则视其为 1 号，新编码从 -2 起步。
      // pipeCodeUsed 按设备对缓存已占用序号集合（首次从 DB 探测，后续内存递增），预览/生成两模式口径一致防同批冲突
      const pipeCodeUsed = new Map<string, Set<string>>()
      const nextPipeCode = async (base: string): Promise<string> => {
        let used = pipeCodeUsed.get(base)
        if (!used) {
          used = new Set<string>()
          const bare = await tx.pipeline.findUnique({ where: { code: base } })
          if (bare) used.add('bare')
          const rows = await tx.pipeline.findMany({
            where: { code: { startsWith: `${base}-` } },
            select: { code: true },
          })
          for (const r of rows) {
            const tail = r.code.slice(base.length + 1)
            if (/^\d+$/.test(tail)) used.add(tail)
          }
          pipeCodeUsed.set(base, used)
        }
        let n = used.has('bare') ? 2 : 1
        while (used.has(String(n))) n++
        used.add(String(n))
        return `${base}-${n}`
      }
      const plannedPipes: Array<[number, string]> = [] // 预览模式计划新建的管线（临时 id → 编码）
      let fakePipeSeq = 0
      // 端点设备编码解析：预览模式优先取虚拟设备位号，实存设备查库
      const equipCodeOf = async (eqId: number): Promise<string> => {
        const v = virtualEquipCode.get(eqId)
        if (v != null) return v
        return (await tx.equipment.findUnique({ where: { id: eqId } }))?.code ?? ''
      }
      // DB 实存管线 id 集合：图 JSON 里指向已删除管线的悬空 id 先自愈重置为未绑定（静默），
      // 使这些连线重新走正常生成流程；后续隔离点归属也以此 + 新建 id 为准，杜绝外键崩溃
      const existingPipeIds = new Set((await tx.pipeline.findMany({ select: { id: true } })).map((p) => p.id))
      for (const c of connections) {
        if (c.pipelineId != null && !existingPipeIds.has(c.pipelineId)) c.pipelineId = null
        if (c.pipelineId != null) { pipelines.skipped++; continue }
        const fromEq = shapeById.get(c.fromShape)?.equipmentId ?? null
        const toEq = shapeById.get(c.toShape)?.equipmentId ?? null
        if (!fromEq || !toEq) {
          pipelines.skipped++
          pipelines.items.push({ code: '(端点未绑定设备)', id: null, created: false, note: '两端图元需先生成/绑定设备' })
          continue
        }
        const fromCode = await equipCodeOf(fromEq)
        const toCode = await equipCodeOf(toEq)
        if (!fromCode || !toCode) { pipelines.skipped++; continue }
        // 需求21(二)：起点与终点同一设备 → 自环管线，仍允许生成但加提示标记供人工确认
        const selfLoop = fromEq === toEq
        const loopNote = selfLoop ? '⚠ 起点与终点为同一设备（自环管线），请人工确认' : undefined
        // 管线号 = 起点位号-终点位号-序号（同对设备多条连线序号递增）
        const base = `${fromCode}-${toCode}`
        const code = await nextPipeCode(base)
        const exists = await tx.pipeline.findUnique({ where: { code } })
        if (exists) {
          c.pipelineId = exists.id
          pipelines.linked++
          pipelines.items.push({ code, id: exists.id, created: false, note: loopNote ?? (apply ? '已存在，已关联到连线' : '编码已存在，将关联到连线') })
          continue
        }
        if (apply) {
          const created = await tx.pipeline.create({
            data: {
              code,
              name: code,
              unitId: diagram.unitId,
              startEquipmentId: fromEq,
              endEquipmentId: toEq,
              remark: selfLoop ? 'PID 图生成主数据自动创建（自环管线，请人工确认）' : 'PID 图生成主数据自动创建',
            },
          })
          c.pipelineId = created.id
          existingPipeIds.add(created.id)
          pipelines.created++
          pipelines.items.push({ code, id: created.id, created: true, note: loopNote })
        } else {
          fakePipeSeq -= 1
          c.pipelineId = fakePipeSeq
          existingPipeIds.add(fakePipeSeq) // 让后续折线过滤/归属按计划口径工作
          plannedPipes.push([fakePipeSeq, code])
          pipelines.created++
          pipelines.items.push({ code, id: fakePipeSeq, created: true, note: loopNote ?? '将新建' })
        }
      }

      // ---- 3. 隔离点（所属管线按挂标到各管线折线最近距离推导） ----
      const isoPoints: GenGroup = { created: 0, linked: 0, skipped: 0, items: [] }
      if (marks.length > 0) {
        const pipeCodeById = new Map((await tx.pipeline.findMany({ select: { id: true, code: true } })).map((p) => [p.id, p.code]))
        // 预览模式：本轮计划新建的管线（负数临时 id）并入编码表，供折线过滤与归属备注使用
        for (const [fakeId, code] of plannedPipes) pipeCodeById.set(fakeId, code)
        let fakeMarkSeq = 0
        // 各连线折线（mount 几何库的简化正交路由，与导入端同源）
        const polyOf = layoutPolylineOf((sid) => shapeById.get(sid) as MountShape | undefined)
        const connPolys = connections
          .filter((c) => c.pipelineId != null && pipeCodeById.has(c.pipelineId))
          .map((c) => ({ pipelineId: c.pipelineId as number, pts: polyOf(c) }))
          .filter((e) => e.pts && e.pts.length >= 2)
        for (const m of marks) {
          if (!m.code) { isoPoints.skipped++; continue }
          // 最近管线折线推导（≤120 SVG 单位内有效）
          let nearestPipeId: number | null = null
          let bestD = Infinity
          for (const cp of connPolys) {
            let d = Infinity
            const pts = cp.pts!
            for (let i = 0; i < pts.length - 1; i++) {
              d = Math.min(d, distToSegment(m.x, m.y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
            }
            if (d < bestD) { bestD = d; nearestPipeId = cp.pipelineId }
          }
          if (bestD > 120) nearestPipeId = null
          if (m.masterPointId != null) {
            // 已绑定挂标：主数据缺管线归属时按位置补归属（悬空自愈/管线重建后常见）；
            // 绑定指向已删除主数据时清空，落到下方 exists/create 路径重建关联
            const bound = await tx.isoPointMaster.findUnique({ where: { id: m.masterPointId } })
            if (bound) {
              if (bound.pipelineId == null && nearestPipeId) {
                if (apply) await tx.isoPointMaster.update({ where: { id: bound.id }, data: { pipelineId: nearestPipeId } })
                isoPoints.linked++
                isoPoints.items.push({ code: m.code, id: bound.id, created: false, note: `${apply ? '补归属管线' : '将补归属管线'} ${pipeCodeById.get(nearestPipeId) ?? ''}` })
              } else {
                isoPoints.skipped++
              }
              continue
            }
            m.masterPointId = null
          }
          const exists = await tx.isoPointMaster.findUnique({ where: { code: m.code } })
          if (exists) {
            m.masterPointId = exists.id
            isoPoints.linked++
            if (exists.pipelineId == null && nearestPipeId) {
              if (apply) await tx.isoPointMaster.update({ where: { id: exists.id }, data: { pipelineId: nearestPipeId } })
              isoPoints.items.push({ code: m.code, id: exists.id, created: false, note: `${apply ? '已关联，并补归属管线' : '编码已存在，将关联并补归属管线'} ${pipeCodeById.get(nearestPipeId) ?? ''}` })
            } else {
              isoPoints.items.push({ code: m.code, id: exists.id, created: false, note: apply ? '已存在，已关联到挂标' : '编码已存在，将关联到挂标' })
            }
            continue
          }
          const note = nearestPipeId ? `所属管线 ${pipeCodeById.get(nearestPipeId) ?? ''}` : '未识别到所属管线（位置距管线较远）'
          if (apply) {
            const created = await tx.isoPointMaster.create({
              data: {
                code: m.code,
                name: (m.name ?? '').trim() || m.code,
                pipelineId: nearestPipeId,
                remark: 'PID 图生成主数据自动创建',
              },
            })
            m.masterPointId = created.id
            isoPoints.created++
            isoPoints.items.push({ code: m.code, id: created.id, created: true, note })
          } else {
            fakeMarkSeq -= 1
            m.masterPointId = fakeMarkSeq
            isoPoints.created++
            isoPoints.items.push({ code: m.code, id: fakeMarkSeq, created: true, note: `将建档，${note}` })
          }
        }
      }

      // ---- 4. 回填 content 并保存（仅 apply；预览模式不写库） ----
      if (apply) {
        const normalized = JSON.stringify({ shapes, connections, marks })
        await tx.pidDiagram.update({ where: { id: did }, data: { content: normalized } })
      }

      return { applied: apply, equipments, pipelines, isoPoints }
    })

    return NextResponse.json(result)
  } catch (e) {
    console.error('[POST /api/pid-diagrams/[id]/generate-master]', e)
    return jsonError(e instanceof Error ? e.message : '生成主数据失败', 500)
  }
}
