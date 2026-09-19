/**
 * 隔离点二维码协议（与盲板标签 BPMS|BLIND-PLATE|{编号} 同风格，Task 96 需求 10/12）
 * - 现场在隔离点上张贴二维码标签，移动端勘察「扫码加入」、交底/开工/完工/验收「扫码核对位置」
 * - payload：BPMS|ISO-POINT|{masterPointId}|{masterCode}
 * - 兼容直接输入编码（parseIsoQr 返回 null 时调用方可按编码匹配）
 */

export const ISO_QR_PREFIX = 'BPMS|ISO-POINT|'

/** 生成隔离点二维码内容 */
export function isoQrPayload(id: number, code: string): string {
  return `${ISO_QR_PREFIX}${id}|${code}`
}

/** 解析隔离点二维码内容；非本系统隔离点码返回 null */
export function parseIsoQr(raw: string): { id: number; code: string } | null {
  const parts = raw.trim().split('|')
  if (parts.length === 4 && parts[0] === 'BPMS' && parts[1] === 'ISO-POINT' && parts[2] && parts[3]) {
    const id = Number(parts[2])
    // id=0：作业票快照点位（无主数据 id）场景，仅按 code 匹配
    if (Number.isFinite(id) && id >= 0) return { id, code: parts[3] }
  }
  return null
}
