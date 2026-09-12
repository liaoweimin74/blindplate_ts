// 盲板管理系统 - 密码哈希工具（Node crypto 内建 scrypt，零依赖）
// 存储格式：scrypt:<salt-hex>:<hash-hex>
// 兼容性：存量明文密码（不含 scrypt: 前缀）由登录/改密链路透明升级为哈希
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const KEY_LEN = 64

/** 生成 scrypt 哈希（随机盐，抗彩虹表） */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(plain, salt, KEY_LEN).toString('hex')
  return `scrypt:${salt}:${hash}`
}

/** 是否已是 scrypt 哈希格式 */
export function isHashed(stored: string): boolean {
  return stored.startsWith('scrypt:')
}

/**
 * 新密码强度策略：≥8 位且必须同时包含字母和数字（特殊字符可选、作强度加分）
 * 仅约束「新设置」的密码（改密/建用户/重置），存量演示密码（123456）登录不受影响
 */
export function validatePasswordStrength(pw: string): { ok: boolean; message: string } {
  const s = String(pw ?? '')
  if (s.length < 8) return { ok: false, message: '新密码长度至少 8 位' }
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) {
    return { ok: false, message: '新密码必须同时包含字母和数字' }
  }
  if (/^(?:([A-Za-z0-9])\1{3,})/.test(s)) {
    return { ok: false, message: '新密码不能包含 4 位以上连续重复字符' }
  }
  return { ok: true, message: '' }
}

/**
 * 校验密码：
 * - scrypt 格式 → 恒定时间比对
 * - 明文（存量） → 直接比对，返回 { ok, needsUpgrade } 供调用方透明升级
 */
export function verifyPassword(plain: string, stored: string): { ok: boolean; needsUpgrade: boolean } {
  if (isHashed(stored)) {
    const [, salt, hash] = stored.split(':')
    if (!salt || !hash) return { ok: false, needsUpgrade: false }
    const candidate = scryptSync(plain, salt, KEY_LEN)
    const expected = Buffer.from(hash, 'hex')
    return {
      ok: candidate.length === expected.length && timingSafeEqual(candidate, expected),
      needsUpgrade: false,
    }
  }
  // 存量明文兼容
  return { ok: plain === stored, needsUpgrade: true }
}
