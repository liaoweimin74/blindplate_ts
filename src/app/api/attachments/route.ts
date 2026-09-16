import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** 允许的业务附件类型（防乱挂）：作业人员验资材料（身份证/资质证书）为 TICKET_CREW */
const BIZ_TYPES = ['SITE_SURVEY', 'DISPOSAL_CONFIRM', 'BRIEFING', 'EXECUTION', 'ACCEPTANCE', 'TICKET_CREW'] as const
/** 允许的附件种类 */
const KINDS = ['PHOTO', 'AUDIO'] as const
/** 单文件上限：照片 10MB / 录音 25MB */
const MAX_SIZE: Record<string, number> = { PHOTO: 10 * 1024 * 1024, AUDIO: 25 * 1024 * 1024 }

/** GET /api/attachments?bizType=&bizId=&pointCode=&kind= 附件列表（按创建时间升序） */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const bizType = sp.get('bizType') || undefined
    const bizIdStr = sp.get('bizId')
    const pointCode = sp.get('pointCode') || undefined
    const kind = sp.get('kind') || undefined
    const where: Record<string, unknown> = {}
    if (bizType) where.bizType = bizType
    if (bizIdStr) where.bizId = Number(bizIdStr)
    if (pointCode) where.pointCode = pointCode
    if (kind) where.kind = kind
    const list = await db.attachment.findMany({ where, orderBy: { createdAt: 'asc' } })
    return NextResponse.json(list)
  } catch (e) {
    console.error('[GET /api/attachments]', e)
    return jsonError(e instanceof Error ? e.message : '查询附件失败', 500)
  }
}

/**
 * POST /api/attachments（multipart/form-data）
 * 字段：file(必填) bizType(必填) bizId bizCode pointCode kind label uploadedBy uploadedById
 * 文件落盘 uploads/<时间戳-随机>.<ext>，元数据入库；返回附件记录
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) return jsonError('缺少上传文件 file')
    const bizType = String(form.get('bizType') || '')
    if (!BIZ_TYPES.includes(bizType as (typeof BIZ_TYPES)[number])) {
      return jsonError(`bizType 无效（允许：${BIZ_TYPES.join('/')}）`)
    }
    const kindRaw = String(form.get('kind') || 'PHOTO')
    if (!KINDS.includes(kindRaw as (typeof KINDS)[number])) return jsonError('kind 无效（PHOTO/AUDIO）')
    const max = MAX_SIZE[kindRaw]
    if (file.size > max) return jsonError(`文件过大（上限 ${Math.round(max / 1024 / 1024)}MB）`)

    const bizIdStr = String(form.get('bizId') || '')
    const bizId = bizIdStr ? Number(bizIdStr) : null
    if (bizIdStr && (!bizId || Number.isNaN(bizId))) return jsonError('bizId 无效')

    // 落盘文件名：时间戳+随机数+扩展名（原始名仅入库留痕，杜绝路径注入）
    const ext = extractExt(file.name, kindRaw)
    const storageKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`
    const { writeFile, mkdir } = await import('node:fs/promises')
    const path = await import('node:path')
    const dir = path.join(process.cwd(), 'uploads')
    await mkdir(dir, { recursive: true })
    const buf = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(dir, storageKey), buf)

    const attachment = await db.attachment.create({
      data: {
        bizType,
        bizId,
        bizCode: strOrNull(form.get('bizCode')),
        pointCode: strOrNull(form.get('pointCode')),
        kind: kindRaw,
        fileName: file.name || `${kindRaw.toLowerCase()}${ext}`,
        mimeType: file.type || (kindRaw === 'AUDIO' ? 'audio/webm' : 'image/jpeg'),
        size: file.size,
        storageKey,
        label: strOrNull(form.get('label')),
        uploadedBy: String(form.get('uploadedBy') || '未知'),
        uploadedById: strOrNull(form.get('uploadedById')),
      },
    })
    return NextResponse.json(attachment, { status: 201 })
  } catch (e) {
    console.error('[POST /api/attachments]', e)
    return jsonError(e instanceof Error ? e.message : '上传附件失败', 500)
  }
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim()
  return s || null
}

/** 提取安全扩展名（白名单按种类；无匹配回退默认） */
function extractExt(name: string, kind: string): string {
  const m = /\.[a-zA-Z0-9]{1,8}$/.exec(name || '')
  const raw = m ? m[0].toLowerCase() : ''
  const allow = kind === 'AUDIO'
    ? ['.webm', '.mp3', '.wav', '.ogg', '.m4a', '.aac']
    : ['.jpg', '.jpeg', '.png', '.webp', '.gif']
  return allow.includes(raw) ? raw : kind === 'AUDIO' ? '.webm' : '.jpg'
}
