import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { currentYm, extractActor, jsonError, logAudit, num, readBody } from '@/lib/bp-server-utils'
import { pushNotifications } from '@/lib/bp-notify'

export const dynamic = 'force-dynamic'

/** 采购建议单备注前缀（GET 分组依据：action='PURCHASE' AND note 以此开头） */
const NOTE_PREFIX = '采购建议单'

interface SuggestItem {
  inventoryId: number
  spec: string
  type: string
  material: string
  gap: number
  suggestQty: number
}

/**
 * POST /api/purchase-requests
 * body: { items: [{ inventoryId, spec, type, material, gap, suggestQty }], __actorId, __actorName }
 * 轻量实现（不新增 Prisma 模型）：每项生成一条 ChangeRecord(action='PURCHASE',
 * fromStatus='LOW_STOCK' → toStatus='ORDERED', note='采购建议单 PR-xxx：建议补货 N 件')，
 * 并向 MANAGER/ADMIN 广播 ALERT 通知；编号规则 PR-YYYYMM-XXX（当月前缀内自增）。
 */
export async function POST(req: NextRequest) {
  try {
    const raw = await readBody(req)
    const { actorId, actorName } = extractActor(raw)
    const list = Array.isArray(raw.items) ? raw.items : []
    if (list.length === 0) return jsonError('请至少选择一项低库存物料')
    if (list.length > 50) return jsonError('单张采购建议单最多包含 50 个明细项')

    // 校验并规范化明细（spec/type/material 以数据库为准，避免前端脏数据）
    const items: SuggestItem[] = []
    const seen = new Set<number>()
    for (const it of list) {
      const inventoryId = num(it?.inventoryId)
      const suggestQty = num(it?.suggestQty)
      if (inventoryId === null || !Number.isInteger(inventoryId) || inventoryId <= 0) {
        return jsonError('明细缺少有效的库存项 ID')
      }
      if (suggestQty === null || !Number.isInteger(suggestQty) || suggestQty < 1) {
        return jsonError('建议补货量必须为不小于 1 的整数')
      }
      if (seen.has(inventoryId)) return jsonError('明细中存在重复的库存项，请检查选择')
      seen.add(inventoryId)
      const inv = await db.inventoryItem.findUnique({ where: { id: inventoryId } })
      if (!inv) return jsonError(`库存项 #${inventoryId} 不存在，请刷新后重试`)
      const bodyGap = num(it?.gap)
      const gap =
        bodyGap !== null && Number.isInteger(bodyGap) && bodyGap >= 0
          ? bodyGap
          : Math.max(inv.minQuantity - inv.quantity, 0)
      items.push({ inventoryId, spec: inv.spec, type: inv.type, material: inv.material, gap, suggestQty })
    }

    // 编号 PR-YYYYMM-XXX：从既有建议单记录推导当月最大序号（可用量小，内存推导足够）
    const ym = currentYm()
    const existing = await db.changeRecord.findMany({
      where: { action: 'PURCHASE', note: { contains: `PR-${ym}-` } },
      select: { note: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    let maxSeq = 0
    for (const row of existing) {
      const m = row.note?.match(new RegExp(`PR-${ym}-(\\d+)`))
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]))
    }
    const code = `PR-${ym}-${String(maxSeq + 1).padStart(3, '0')}`
    const totalQty = items.reduce((s, i) => s + i.suggestQty, 0)

    // 每项一条 PURCHASE 变动记录：低库存 → 已下单（真实到货入库走既有「调整库存」正数 delta）
    await db.changeRecord.createMany({
      data: items.map((i) => ({
        blindPlateId: null,
        blindCode: `${i.spec}/${i.type}/${i.material}`,
        action: 'PURCHASE',
        workCode: null,
        location: null,
        fromStatus: 'LOW_STOCK',
        toStatus: 'ORDERED',
        operator: actorName,
        note: `${NOTE_PREFIX} ${code}：建议补货 ${i.suggestQty} 件`,
      })),
    })

    // 联动：向 MANAGER/ADMIN 广播提醒（title 含编号，content 含合计数量）
    await pushNotifications({
      targetRoles: ['MANAGER', 'ADMIN'],
      type: 'ALERT',
      title: `采购建议单 ${code}`,
      content: `${actorName} 提交采购建议单 ${code}：共 ${items.length} 项规格、合计建议补货 ${totalQty} 件，请安排采购审批与到货入库。`,
      bizType: 'INVENTORY',
      bizCode: code,
      linkModule: 'ledger',
      linkTab: 'inventory',
    })

    // 审计留痕：采购建议单生成
    await logAudit({
      actorId,
      actorName,
      action: 'CREATE',
      entity: 'INVENTORY',
      entityId: null,
      entityCode: code,
      detail: `${code}：低库存 → 建议采购（生成采购建议单：${items.length} 项规格 / 合计建议补货 ${totalQty} 件）`,
    })

    return NextResponse.json({
      code,
      totalQty,
      operator: actorName,
      createdAt: new Date().toISOString(),
      items,
    })
  } catch (e) {
    console.error('[POST /api/purchase-requests]', e)
    return jsonError(e instanceof Error ? e.message : '生成采购建议单失败', 500)
  }
}

/** GET /api/purchase-requests → 采购建议历史（按 PR 编号分组聚合，倒序） */
export async function GET() {
  try {
    const records = await db.changeRecord.findMany({
      where: { action: 'PURCHASE', note: { startsWith: `${NOTE_PREFIX} PR-` } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    // 内存分组：note 形如「采购建议单 PR-202609-001：建议补货 5 件」
    interface GroupItem {
      blindCode: string
      spec: string
      type: string
      material: string
      suggestQty: number
    }
    interface Group {
      code: string
      createdAt: string
      operator: string
      items: GroupItem[]
      totalQty: number
    }
    const map = new Map<string, Group>()
    for (const r of records) {
      const code = r.note?.match(/采购建议单 (PR-\d{6}-\d{3})/)?.[1]
      if (!code) continue
      const suggestQty = Number(r.note?.match(/建议补货 (\d+) 件/)?.[1] ?? 0)
      const [spec = '', type = '', material = ''] = r.blindCode.split('/')
      let g = map.get(code)
      if (!g) {
        g = { code, createdAt: r.createdAt.toISOString(), operator: r.operator, items: [], totalQty: 0 }
        map.set(code, g)
      }
      g.items.push({ blindCode: r.blindCode, spec, type, material, suggestQty })
      g.totalQty += suggestQty
    }

    // 附加当前库存快照（按 spec/type/material 组合键匹配，便于历史对比）
    const invs = await db.inventoryItem.findMany()
    const invMap = new Map(invs.map((i) => [`${i.spec}/${i.type}/${i.material}`, i]))
    const groups = [...map.values()].map((g) => ({
      ...g,
      items: g.items.map((it) => {
        const inv = invMap.get(it.blindCode)
        return { ...it, quantity: inv?.quantity ?? null, minQuantity: inv?.minQuantity ?? null }
      }),
    }))

    return NextResponse.json(groups)
  } catch (e) {
    console.error('[GET /api/purchase-requests]', e)
    return jsonError(e instanceof Error ? e.message : '获取采购建议历史失败', 500)
  }
}
