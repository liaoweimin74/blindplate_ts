import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/bp-server-utils'

/**
 * 扫码核对服务端强校验（需求 12/16 服务端加固）
 *
 * 背景：移动端开工/完工/验收前均需扫现场隔离点二维码核对（IsoScanSheet gate），
 * 但此前比对只发生在前端，绕过前端直调 API 即可跳过位置核对。
 * 本模块把「核对」下沉到服务端：客户端必须提交 scannedPointCode（移动端扫码头取值 /
 * 桌面端人工核对输入），与票面/需求点位编码比对，不匹配一律 403 拒绝并留审计；
 * 匹配亦留痕（SCAN_VERIFY），形成完整核对审计链。
 *
 * 兼容策略：票面无点位编码（历史票/无主数据票）时不设卡（skipped），
 * 仅在审计中标注该票未关联隔离点编码。
 */

export type ScanVerifyInput = {
  /** 期望的隔离点编码（票面 pointCode / 需求生效票集合） */
  expected: string | null | undefined
  /** 客户端提交的核对编码（扫码结果或人工输入），可空 */
  scanned: unknown
  /** 操作人（用于审计） */
  actorId?: string | null
  actorName?: string
  /** 审计实体 */
  entity: 'WORK_TICKET' | 'WORK_REQUEST'
  entityId?: string | number | null
  entityCode?: string | null
  /** 场景文案，如「开工」「完工」「验收」 */
  scene: string
}

export type ScanVerifyResult =
  | { ok: true; skipped: boolean }

/** 编码宽容比较：trim + 忽略大小写（二维码内容为大写，宽容手输大小写误差） */
export function pointCodeMatches(a: unknown, b: unknown): boolean {
  const x = String(a ?? '').trim().toUpperCase()
  const y = String(b ?? '').trim().toUpperCase()
  return x.length > 0 && x === y
}

/**
 * 执行扫码核对强校验。
 * - 期望编码为空 → 跳过（不设卡），ok + skipped
 * - 提交编码缺失/不匹配 → 记 SCAN_REJECT 审计并返回 403 NextResponse
 * - 匹配 → 记 SCAN_VERIFY 审计，ok
 */
export async function verifyPointScan(input: ScanVerifyInput): Promise<ScanVerifyResult | NextResponse> {
  const expected = String(input.expected ?? '').trim()
  const scannedRaw = String(input.scanned ?? '').trim()

  // 票面无点位编码：历史数据兼容，不设卡
  if (!expected) return { ok: true, skipped: true }

  if (!pointCodeMatches(expected, scannedRaw)) {
    // 失败留痕：谁在何时提交了什么码
    await logAudit({
      actorId: input.actorId ?? null,
      actorName: input.actorName,
      action: 'SCAN_REJECT',
      entity: input.entity,
      entityId: input.entityId ?? null,
      entityCode: input.entityCode ?? null,
      detail: `【扫码核对未通过·${input.scene}】期望隔离点编码 ${expected}，${scannedRaw ? `提交为 ${scannedRaw}` : '未提交核对编码'}——服务端拒绝操作`,
    })
    return NextResponse.json(
      {
        error: scannedRaw
          ? `${input.scene}被拒绝：核对编码 ${scannedRaw} 与本单隔离点编码 ${expected} 不一致，请核对现场二维码标签`
          : `${input.scene}被拒绝：缺少扫码核对编码——请先扫描现场隔离点二维码（或人工核对编码后提交）`,
        scanVerifyRequired: true,
        expectedPointCode: expected,
      },
      { status: 403 }
    )
  }

  // 成功留痕：核对链完整可回查
  await logAudit({
    actorId: input.actorId ?? null,
    actorName: input.actorName,
    action: 'SCAN_VERIFY',
    entity: input.entity,
    entityId: input.entityId ?? null,
    entityCode: input.entityCode ?? null,
    detail: `【扫码核对通过·${input.scene}】隔离点编码 ${expected} 与提交核对编码一致`,
  })
  return { ok: true, skipped: false }
}

/** 结果收窄：是 ScanVerifyResult 则放行，是 NextResponse（403）则直接返回 */
export function isScanReject(r: ScanVerifyResult | NextResponse): r is NextResponse {
  return r instanceof NextResponse
}
