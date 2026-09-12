// 盲板管理系统 - 服务端通用工具
import { NextResponse } from 'next/server'
import type { Unit } from '@prisma/client'
import { db } from '@/lib/db'
import { SCHEME_STATUS_MAP, STATUS_MAP, TASK_STATUS_MAP, TICKET_STATUS_MAP } from '@/lib/bp-types'

/** 统一错误响应 { error: string } */
export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** 路径参数解析为正整数 id，非法返回 null */
export function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 任意值转字符串（去首尾空格），null/undefined 返回 '' */
export function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

/** 任意值转数字，空/非法返回 null */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** ISO 时间字符串转 Date，空/非法返回 null */
export function toDate(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 读取请求 JSON body，空/非法 body 返回 {} */
export async function readBody(req: Request): Promise<Record<string, any>> {
  try {
    const data = await req.json()
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/** 当月 YYYYMM 字符串，如 202506 */
export function currentYm(now = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 生成业务编号 PREFIX-YYYYMM-XXX（如 WR-202506-011）
 * findLast: 按当月前缀（如 "WR-202506-"）查询已有最大编号，返回编号或 null
 */
export async function generateCode(
  prefix: string,
  findLast: (like: string) => Promise<string | null>
): Promise<string> {
  const like = `${prefix}-${currentYm()}-`
  const last = await findLast(like)
  const m = last ? last.match(/(\d+)$/) : null
  const seq = m ? Number(m[1]) + 1 : 1
  return `${like}${String(seq).padStart(3, '0')}`
}

/** 去除用户对象中的密码字段 */
export function omitPassword<T extends { password?: string }>(user: T): Omit<T, 'password'> {
  const { password: _pwd, ...rest } = user
  return rest
}

/** 为带 unitId 的记录列表批量附加 unit 对象（WorkRequest 与 Unit 无 Prisma 关系，需手工关联） */
export async function withUnit<T extends { unitId: number | null }>(
  rows: T[]
): Promise<(T & { unit: Unit | null })[]> {
  const ids = [
    ...new Set(rows.map((r) => r.unitId).filter((x): x is number => typeof x === 'number')),
  ]
  const units = ids.length ? await db.unit.findMany({ where: { id: { in: ids } } }) : []
  const map = new Map(units.map((u) => [u.id, u]))
  return rows.map((r) => ({
    ...r,
    unit: r.unitId != null ? (map.get(r.unitId) ?? null) : null,
  }))
}

// ============ 审计日志 ============
/** 审计日志动作中文名 */
export const AUDIT_ACTION_MAP: Record<string, string> = {
  CREATE: '创建', UPDATE: '更新', DELETE: '删除',
  PASSWORD_CHANGE: '修改密码', PUBLISH: '发布公告', WITHDRAW: '撤回公告', LOGIN: '登录',
  // 业务流转动作（状态推进留痕）
  SUBMIT: '提交', APPROVE: '审批通过', REJECT: '审批驳回', STATUS_CHANGE: '状态流转',
  START: '开始作业', COMPLETE: '完成', CANCEL: '取消',
}
/** 审计日志对象模块中文名 */
export const AUDIT_ENTITY_MAP: Record<string, string> = {
  USER: '用户管理', UNIT: '装置管理', DICT: '数据字典',
  ANNOUNCEMENT: '系统公告', AUTH: '认证安全', INVENTORY: '盲板库存',
  // 业务实体（九大环节状态流转留痕）
  WORK_REQUEST: '作业需求', ISOLATION_SCHEME: '隔离方案', DISPOSAL_SCHEME: '工艺处置方案',
  WORK_TICKET: '作业票', WORK_TASK: '作业任务', JSA: 'JSA分析', ACCEPTANCE: '作业验收',
}

/**
 * 业务状态中英文标签统一查询（需求/方案/票/任务状态机合并查询，未命中返回原值）
 * 仅作服务端审计 detail 文案用，与前端 bp-types.ts 的映射保持一致
 */
export function bizStatusLabel(status: string): string {
  return (
    STATUS_MAP[status]?.label ??
    SCHEME_STATUS_MAP[status]?.label ??
    TICKET_STATUS_MAP[status]?.label ??
    TASK_STATUS_MAP[status]?.label ??
    status
  )
}

/**
 * 业务流转审计 detail 统一格式：{编号}：{状态A} → {状态B}（{操作摘要}）
 * @param from 起始状态（创建类动作传 null 显示 —）
 */
export function auditFlowDetail(code: string, from: string | null, to: string, summary: string): string {
  const a = from ? bizStatusLabel(from) : '—'
  return `${code}：${a} → ${bizStatusLabel(to)}（${summary}）`
}

/**
 * 业务流转埋点操作人解析：优先前端透传 __actor（extractActor 结果），
 * 其次取业务单据上已知责任人（审核人/编制人/验收人等快照）兜底
 */
export function resolveActor(
  extracted: { actorId: string | null; actorName: string },
  fallbackName?: string | null,
  fallbackId?: string | null
): { actorId: string | null; actorName: string } {
  if (extracted.actorName && extracted.actorName !== '未知用户') {
    return { actorId: extracted.actorId, actorName: extracted.actorName }
  }
  return { actorId: fallbackId ?? null, actorName: fallbackName || '未知用户' }
}

/**
 * 记录审计日志（静默失败：审计异常不阻塞主业务）
 * @param data.action/entity 参见 AUDIT_ACTION_MAP / AUDIT_ENTITY_MAP
 */
export async function logAudit(data: {
  actorId?: string | null
  actorName?: string
  action: string
  entity: string
  entityId?: string | number | null
  entityCode?: string | null
  detail?: string | null
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: data.actorId ?? null,
        actorName: data.actorName || '未知用户',
        action: data.action,
        entity: data.entity,
        entityId: data.entityId != null ? String(data.entityId) : null,
        entityCode: data.entityCode ?? null,
        detail: data.detail ?? null,
      },
    })
  } catch (e) {
    console.error('[logAudit] 审计日志写入失败（不影响主流程）', e)
  }
}

/**
 * 从请求 body 中提取并剥离操作者标识字段（前端写操作统一附加）
 * 约定字段：__actorId / __actorName —— 提取后从 body 移除，避免写入业务表
 */
export function extractActor(body: Record<string, any>): { actorId: string | null; actorName: string; body: Record<string, any> } {
  const actorId = str(body.__actorId) || null
  const actorName = str(body.__actorName) || '未知用户'
  const rest = { ...body }
  delete rest.__actorId
  delete rest.__actorName
  return { actorId, actorName, body: rest }
}
