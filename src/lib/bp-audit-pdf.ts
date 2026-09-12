// 盲板管理系统 - 主数据体检 PDF 报告生成（Task 54）
// pdfkit + 系统字体 Noto Serif SC（沙箱 /usr/share/fonts/truetype/noto-serif-sc/）
// 报告结构：封面 → 概览统计 → 分级明细（ERROR → WARNING → INFO；疑似矛盾单列）→ 规则附录
import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'
import type { AuditViolation, AuditSummary, AuditDepth, AuditScope } from '@/lib/bp-master-validation'

const FONT_DIR = '/usr/share/fonts/truetype/noto-serif-sc'
const FONT_REG = path.join(FONT_DIR, 'NotoSerifSC-Regular.ttf')
const FONT_BOLD = path.join(FONT_DIR, 'NotoSerifSC-Bold.ttf')

export interface AuditReportMeta {
  reportId: string
  createdAt: string
  scopeText: string
  scope: AuditScope
  depth: AuditDepth
  stats: { units: number; equipments: number; pipelines: number; isoPoints: number }
  summary: AuditSummary
  durationMs: number
}

export interface AuditReportData extends AuditReportMeta {
  violations: AuditViolation[]
}

export interface ReportArchiveEntry extends AuditReportMeta {
  fileName: string
  pdfReady: boolean
}

const SEV_COLOR: Record<string, [number, number, number]> = {
  ERROR: [0xdc, 0x26, 0x26],
  WARNING: [0xd9, 0x77, 0x06],
  INFO: [0x64, 0x74, 0x8b],
}
const SEV_LABEL: Record<string, string> = { ERROR: '错误', WARNING: '警告', INFO: '提示' }
const SEV_ORDER: AuditViolation['severity'][] = ['ERROR', 'WARNING', 'INFO']

const ARCHIVE_DIR = path.join(process.cwd(), 'upload', 'master-audit')

export function ensureArchiveDir(): string {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
  return ARCHIVE_DIR
}

export function archivePath(reportId: string, ext: 'json' | 'pdf'): string {
  return path.join(ARCHIVE_DIR, `${reportId}.${ext}`)
}

export function saveReportArchive(data: AuditReportData): void {
  ensureArchiveDir()
  fs.writeFileSync(archivePath(data.reportId, 'json'), JSON.stringify(data), 'utf8')
}

export function listReportArchives(): ReportArchiveEntry[] {
  ensureArchiveDir()
  const out: ReportArchiveEntry[] = []
  for (const f of fs.readdirSync(ARCHIVE_DIR)) {
    if (!f.endsWith('.json')) continue
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8')) as AuditReportData
      out.push({
        reportId: raw.reportId,
        createdAt: raw.createdAt,
        scopeText: raw.scopeText,
        scope: raw.scope,
        depth: raw.depth,
        stats: raw.stats,
        summary: raw.summary,
        durationMs: raw.durationMs,
        fileName: f.replace(/\.json$/, ''),
        pdfReady: fs.existsSync(archivePath(f.replace(/\.json$/, ''), 'pdf')),
      })
    } catch {
      // 跳过损坏文件
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function loadReportArchive(reportId: string): AuditReportData | null {
  const p = archivePath(path.basename(reportId), 'json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as AuditReportData
  } catch {
    return null
  }
}

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 生成 PDF（Buffer）。报告同时落盘存档。 */
export async function renderAuditPdf(data: AuditReportData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `主数据体检报告 ${data.reportId}`, Creator: '盲板全流程管理系统' } })
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  const hasBold = fs.existsSync(FONT_BOLD)
  doc.registerFont('cn', FONT_REG)
  if (hasBold) doc.registerFont('cn-bold', FONT_BOLD)
  const B = hasBold ? 'cn-bold' : 'cn'
  const W = doc.page.width - 96
  let y = 0

  const ensureSpace = (need: number) => {
    if (y + need > doc.page.height - 60) {
      doc.addPage()
      y = 56
    }
  }

  const line = (text: string, size = 10, bold = false, color: [number, number, number] = [0x1f, 0x29, 0x37], indent = 0) => {
    doc.font(bold ? B : 'cn').fontSize(size).fillColor(color)
    const h = doc.heightOfString(text, { width: W - indent }) + 4
    ensureSpace(h)
    doc.text(text, 48 + indent, y, { width: W - indent, lineGap: 1 })
    y += h
  }

  const hr = () => {
    ensureSpace(14)
    doc.moveTo(48, y).lineTo(doc.page.width - 48, y).lineWidth(0.6).strokeColor([0xcb, 0xd5, 0xe1]).stroke()
    y += 12
  }

  // ===== 封面区 =====
  y = 84
  doc.font(B).fontSize(24).fillColor([0x0f, 0x17, 0x2a]).text('盲板全流程管理系统', 48, y, { width: W, align: 'center' })
  y += 36
  doc.font(B).fontSize(18).fillColor([0x0f, 0x17, 0x2a]).text('主数据体检报告', 48, y, { width: W, align: 'center' })
  y += 30
  hr()
  const metaRows: [string, string][] = [
    ['报告编号', data.reportId],
    ['生成时间', fmtTime(data.createdAt)],
    ['校验范围', data.scopeText],
    ['校验档位', data.depth === 'DEEP' ? '深度校验（规则引擎 + AI 语义复核）' : '快速校验（规则引擎）'],
    ['数据快照', `装置 ${data.stats.units} / 设备 ${data.stats.equipments} / 管线 ${data.stats.pipelines} / 隔离点 ${data.stats.isoPoints}`],
    ['校验耗时', `${(data.durationMs / 1000).toFixed(1)} 秒`],
  ]
  for (const [k, v] of metaRows) {
    line(`${k}：`, 11, true, [0x33, 0x41, 0x55], 0)
    // 同行值：回退 y 重画
    y -= 18
    doc.font('cn').fontSize(11).fillColor([0x1f, 0x29, 0x37]).text(v, 150, y, { width: W - 102 })
    y += 18
  }
  y += 6
  hr()

  // ===== 概览 =====
  line('一、体检结论概览', 13, true, [0x0f, 0x17, 0x2a])
  y += 4
  const s = data.summary
  const conclusion =
    s.error > 0
      ? `检出 ${s.error} 处硬矛盾（错误级），建议优先处置。`
      : s.warning > 0
        ? `未检出错误级硬矛盾，存在 ${s.warning} 处警告需人工确认。`
        : s.aiSuspect > 0
          ? '规则引擎未见矛盾，AI 语义复核发现疑似问题，建议人工确认。'
          : '未检出矛盾，主数据自洽。'
  line(conclusion, 11, false)
  line(`硬矛盾：错误 ${s.error} 处 / 警告 ${s.warning} 处 / 提示 ${s.info} 处${s.aiSuspect > 0 ? `；AI 疑似矛盾 ${s.aiSuspect} 处（需人工确认）` : ''}`, 11, false)
  y += 8
  hr()

  // ===== 分级明细 =====
  line('二、矛盾明细', 13, true, [0x0f, 0x17, 0x2a])
  y += 4
  let seq = 0
  const renderViolation = (v: AuditViolation) => {
    seq += 1
    ensureSpace(120)
    const color = SEV_COLOR[v.severity] ?? SEV_COLOR.INFO
    const badge = `[${v.severity === 'ERROR' ? '错误' : v.severity === 'WARNING' ? '警告' : '提示'}]`
    line(`${seq}. ${badge} ${v.ruleId} ${v.ruleName} · ${v.entityType === 'PIPELINE' ? '管线' : v.entityType === 'EQUIPMENT' ? '设备' : v.entityType === 'ISO_POINT' ? '隔离点' : '装置'} ${v.entityCode}${v.aiSuspect ? '（AI 疑似，需人工确认）' : ''}`, 11.5, true, color)
    line(v.title, 10.5, false, [0x1f, 0x29, 0x37], 14)
    y += 2
    line('证据：', 10, true, [0x47, 0x55, 0x69], 14)
    for (const e of v.evidence) line(`· ${e}`, 9.5, false, [0x47, 0x55, 0x69], 22)
    y += 2
    line(`处置建议：${v.suggestion}`, 9.5, false, [0x21, 0x65, 0x4d], 14)
    y += 8
  }

  const hard = data.violations.filter((v) => !v.aiSuspect)
  const suspect = data.violations.filter((v) => v.aiSuspect)
  for (const sev of SEV_ORDER) {
    const list = hard.filter((v) => v.severity === sev)
    if (list.length === 0) continue
    line(`${SEV_LABEL[sev]}级（${list.length} 处）`, 11.5, true, SEV_COLOR[sev])
    y += 4
    for (const v of list) renderViolation(v)
  }
  if (suspect.length > 0) {
    line(`AI 疑似矛盾（${suspect.length} 处，需人工确认，不构成硬结论）`, 11.5, true, [0x7c, 0x3a, 0xed])
    y += 4
    for (const v of suspect) renderViolation(v)
  }
  if (seq === 0) {
    line('未检出矛盾。', 10.5, false, [0x47, 0x55, 0x69])
  }

  // ===== 附录：规则说明 =====
  y += 8
  hr()
  line('附录：校验规则说明', 13, true, [0x0f, 0x17, 0x2a])
  y += 4
  const ruleDesc: [string, string][] = [
    ['R1 管线端点装置一致性', '管线两端设备均不在管线登记装置内——物理落点缺位，属完全错位型脏绑定'],
    ['R2 跨界管线形态确认', '单端设备跨装置（边界线形态）——可能是合法跨界线，需人工确认'],
    ['R3 管线名称与装置归属匹配', '管线名称自称的工艺单元与登记装置名称不一致'],
    ['R4 设备位号序列聚类', '同一位号数字序列段的设备分散在多个装置（工程惯例同序列段通常同装置）'],
    ['R5 隔离点位号引用校验', '隔离点编码/名称/位置中引用的位号在设备与管线台账中不存在'],
    ['R6 主数据完整性', '名称缺失（name=code）、介质/装置未登记等关键字段缺失'],
    ['R7 孤立设备检出', '设备未参与任何管线端点绑定'],
    ['R8 设备连线装置一致性', '设备的全部连线管线均登记于其他装置——疑似系统性归属错位'],
    ['S1-S3 AI 语义复核', '介质-设备相容性 / 名称-端点匹配性 / 位号语义-设备类型（AI 疑似结论，需人工确认）'],
  ]
  for (const [k, v] of ruleDesc) {
    line(`${k}：${v}`, 9.5, false, [0x47, 0x55, 0x69])
    y += 2
  }
  y += 6
  line('本报告由系统自动生成，矛盾修复须经人工确认后执行，系统不会自动修改主数据。', 9, false, [0x94, 0xa3, 0xb8])

  doc.end()
  const buf = await done
  ensureArchiveDir()
  fs.writeFileSync(archivePath(data.reportId, 'pdf'), buf)
  return buf
}
