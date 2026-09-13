// 盲板管理系统 - 附件服务端助手（仅后端使用）
import { db } from '@/lib/db'

export interface AttachmentRow {
  id: string
  bizType: string
  bizId: number | null
  bizCode: string | null
  pointCode: string | null
  kind: string
  fileName: string
  mimeType: string
  size: number
  storageKey: string
  label: string | null
  uploadedBy: string
  uploadedById: string | null
  createdAt: Date
}

/** 将 attachments 表行映射为精简 DTO（去掉 storageKey 等内部字段） */
export function toAttachmentDto(a: AttachmentRow) {
  return {
    id: a.id, bizType: a.bizType, bizId: a.bizId, bizCode: a.bizCode, pointCode: a.pointCode,
    kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, size: a.size, label: a.label,
    uploadedBy: a.uploadedBy, uploadedById: a.uploadedById, createdAt: a.createdAt,
    url: `/api/attachments/${a.id}/raw`,
  }
}

/** 读取附件文件并转为 data URL（VLM 输入用）；失败（丢失/路径异常）的文件跳过并在 map 中记 null */
export async function attachmentDataUrls(ids: string[]): Promise<(string | null)[]> {
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const out: (string | null)[] = []
  for (const id of ids) {
    const att = await db.attachment.findUnique({ where: { id } })
    if (!att || att.kind !== 'PHOTO') { out.push(null); continue }
    if (!att.storageKey || att.storageKey.includes('/') || att.storageKey.includes('..')) { out.push(null); continue }
    try {
      const buf = await readFile(path.join(process.cwd(), 'uploads', att.storageKey))
      out.push(`data:${att.mimeType || 'image/jpeg'};base64,${buf.toString('base64')}`)
    } catch {
      out.push(null)
    }
  }
  return out
}

/** 把附件批量绑定到业务记录（上传时先挂 bizType 占位，业务记录创建后回填 bizId） */
export async function bindAttachments(ids: string[], bizType: string, bizId: number, bizCode?: string | null, pointCode?: string | null) {
  if (!ids.length) return
  await db.attachment.updateMany({
    where: { id: { in: ids } },
    data: { bizType, bizId, ...(bizCode !== undefined ? { bizCode: bizCode || null } : {}), ...(pointCode !== undefined ? { pointCode: pointCode || null } : {}) },
  })
}
