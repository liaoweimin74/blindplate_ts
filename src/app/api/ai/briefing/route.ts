import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bpComplete, BP_BUSINESS_KNOWLEDGE } from '@/lib/bp-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STATUS_ZH: Record<string, string> = {
  DRAFT: '草稿', PENDING_SURVEY: '待现场勘察', SURVEYED: '已勘察待JSA', JSA_DONE: 'JSA完成待方案',
  ISOLATION_PREPARING: '隔离方案编制中', ISOLATION_PENDING_REVIEW: '隔离方案待审核', ISOLATION_REJECTED: '隔离方案已驳回', ISOLATION_APPROVED: '隔离方案已审核',
  DISPOSAL_PREPARING: '处置方案编制中', DISPOSAL_PENDING_REVIEW: '处置方案待审核', DISPOSAL_REJECTED: '处置方案已驳回', DISPOSAL_APPROVED: '处置方案已审核',
  PENDING_CONFIRM: '待工艺处置确认', CONFIRMED: '处置已确认待开票', TICKET_ISSUED: '作业票待批准', TICKET_APPROVED: '作业票已批准',
  IN_PROGRESS: '作业中', PENDING_ACCEPTANCE: '待验收', COMPLETED: '已完成', CANCELLED: '已取消',
}
const PLATE_STATUS_ZH: Record<string, string> = {
  IN_STOCK: '在库', RESERVED: '已预留', INSTALLED: '已安装', REMOVED: '已拆除', SCRAPPED: '已报废',
}

/** POST /api/ai/briefing → { content }（首页看板 AI 运行简报：聚合全库统计后由 LLM 生成文字简报） */
export async function POST() {
  try {
    const [workGroups, plateGroups, unitGroups, inventoryItems, recentChanges, inProgressReqs] = await Promise.all([
      db.workRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      db.blindPlate.groupBy({ by: ['status'], _count: { _all: true } }),
      db.workRequest.groupBy({ by: ['unitId'], _count: { _all: true } }),
      db.inventoryItem.findMany(),
      db.changeRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      db.workRequest.findMany({
        where: { status: { in: ['IN_PROGRESS', 'PENDING_ACCEPTANCE', 'TICKET_APPROVED'] } },
        select: { code: true, title: true, status: true, location: true, medium: true },
        take: 8,
      }),
    ])
    const unitIds = unitGroups.map((g) => g.unitId)
    const units = unitIds.length ? await db.unit.findMany({ where: { id: { in: unitIds } } }) : []
    const unitMap = new Map(units.map((u) => [u.id, u]))

    const statusLines = workGroups
      .map((g) => `- ${STATUS_ZH[g.status] ?? g.status}: ${g._count._all}`)
      .join('\n')
    const plateLines = plateGroups
      .map((g) => `- ${PLATE_STATUS_ZH[g.status] ?? g.status}: ${g._count._all}`)
      .join('\n')
    const unitLines = unitGroups
      .map((g) => ({ name: unitMap.get(g.unitId)?.name ?? `装置#${g.unitId}`, count: g._count._all }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((u) => `- ${u.name}: ${u.count}`)
      .join('\n')
    const alerts = inventoryItems.filter((i) => i.quantity <= i.minQuantity)
    const alertLines = alerts.length
      ? alerts.slice(0, 6).map((i) => `- ${i.spec} ${i.type} ${i.material}：库存 ${i.quantity} / 最低储备 ${i.minQuantity}（缺口 ${i.minQuantity - i.quantity}）`).join('\n') + `\n（预警共 ${alerts.length} 项，仅列出缺口最大的前 ${Math.min(6, alerts.length)} 项）`
      : '（无任何库存低于最低储备，库存健康）'
    const changeLines = recentChanges.length
      ? recentChanges.map((c) => `- [${c.createdAt.toISOString().slice(5, 16).replace('T', ' ')}] ${c.action} ${c.blindCode}${c.location ? ` @${c.location}` : ''}（${c.operator}）`).join('\n')
      : '（暂无）'
    const activeLines = inProgressReqs.length
      ? inProgressReqs.map((r) => `- ${r.code} ${r.title}（${STATUS_ZH[r.status] ?? r.status}${r.location ? ` · ${r.location}` : ''}${r.medium ? ` · ${r.medium}` : ''}）`).join('\n')
      : '（当前无作业中/待验收/待执行的作业）'

    const today = new Date()
    const dataBlock = `【统计数据】
统计时间：${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}
一、作业需求状态分布：
${statusLines}
二、盲板实体状态分布：
${plateLines}
三、装置作业量 TOP5：
${unitLines}
四、库存预警（判定口径：库存量 ≤ 最低储备即为预警，即使缺口为 0 也是预警）：
${alertLines}
五、最近盲板变动记录：
${changeLines}
六、重点在办作业（已批准/作业中/待验收）：
${activeLines}`

    const content = await bpComplete(
      `你是「石化盲板管理系统」的 AI 运行分析师。请基于下方真实统计数据，为管理层撰写一份简明的《盲板作业运行简报》。
${BP_BUSINESS_KNOWLEDGE}
【写作要求】
1. 简体中文，300 字以内，面向分管领导快速阅读；
2. 结构固定为四段，每段以加粗小标题开头（用 **标题** 形式）：
   **总体态势** 一句话概括当前作业量与阶段分布重点；
   **重点关注** 指出待办压力最大或需要决策的环节（如待审核方案多、库存缺口、作业中风险作业），给出具体数字；
   **库存与物资** 必须明确给出库存预警项数：若预警数>0，点出缺口最大的 1-2 项规格并给出补库建议；仅当预警数为 0 时才可表述为库存健康；
   **工作建议** 给出 1-2 条具体可执行的建议。
3. 只使用数据中出现的真实数字，禁止编造；数字要与数据一致；
4. 不要输出标题以外的客套话、不要罗列原始数据表。`,
      [{ role: 'user', content: dataBlock }],
    )
    if (!content.trim()) {
      return NextResponse.json({ error: 'AI 未返回内容，请稍后重试' }, { status: 502 })
    }
    return NextResponse.json({ content, generatedAt: new Date().toISOString() })
  } catch (e) {
    console.error('[ai/briefing]', e)
    return NextResponse.json({ error: 'AI 服务暂时不可用，请稍后重试' }, { status: 500 })
  }
}
