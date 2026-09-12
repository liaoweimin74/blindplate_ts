import { db } from '@/lib/db'

/**
 * 站内通知推送 helper（服务端专用）
 * - targetRoles: 按角色广播（为这些角色各创建一条广播通知）
 * - userIds:     精确推送到人
 * 推送失败不抛错（打日志），保证不阻断业务主流程。
 * type: APPROVAL审批提醒 | STATUS进度 | ALERT预警 | EXECUTE执行反馈 | REMINDER催办 | SYSTEM系统
 */
export async function pushNotifications(opts: {
  targetRoles?: string[]
  userIds?: string[]
  type: 'APPROVAL' | 'STATUS' | 'ALERT' | 'EXECUTE' | 'REMINDER' | 'SYSTEM'
  title: string
  content: string
  bizType?: string
  bizId?: number
  bizCode?: string
  linkModule?: string
  linkTab?: string
}) {
  // 剥离数组字段，避免 spread 进 Prisma 行数据导致 Unknown argument
  const { targetRoles, userIds, ...base } = opts
  const rows = [
    ...(targetRoles ?? []).map((targetRole) => ({ ...base, targetRole, userId: null as string | null })),
    ...(userIds ?? []).map((userId) => ({ ...base, userId, targetRole: null as string | null })),
  ]
  if (!rows.length) return
  try {
    await db.notification.createMany({ data: rows })
  } catch (e) {
    console.error('[pushNotifications] 通知推送失败（不阻断业务）:', e)
  }
}
