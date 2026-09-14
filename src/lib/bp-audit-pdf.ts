// 盲板管理系统 - 主数据体检 PDF 报告生成（Task 54；Task 71 纯系统字体：仓库不捆绑任何字体文件）
// 字体来源：系统 CJK 字体（Windows 雅黑/宋体/黑体/等线 · macOS 苹方/宋体 · Linux Noto/文泉驿 + fontconfig 兜底）
// .ttf / .otf / .ttc 集合均支持——.ttc 须经 fontkit 取出单字体对象再交 pdfkit（.ttc 路径直传集合对象会崩，Task 70/71 实测）
// 报告结构：封面 → 概览统计 → 分级明细（ERROR → WARNING → INFO；疑似矛盾单列）→ 规则附录
import PDFDocument from 'pdfkit'
import { create as fontkitCreate } from 'fontkit'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { AuditViolation, AuditSummary, AuditDepth, AuditScope } from '@/lib/bp-master-validation'

type FontKind = 'regular' | 'bold'

/**
 * 字体解析优先级（Task 71：纯系统字体，仓库不捆绑字体文件）：
 * ① 环境变量 PDF_FONT_DIR（显式指定字体目录，任何平台优先）
 * ② 项目 assets/fonts/（可选手工放置目录，已 gitignore 不入库）
 * ③ 系统 CJK 字体目录（按平台；.ttf/.otf/.ttc 均可）
 * ④ Linux fontconfig 动态探测（fc-match；返回的 .ttc 同样可用）
 *
 * 【TTC 支持说明】pdfkit 0.20 不能直接吃 .ttc 路径：fontkit.create(缓冲) 不带 postscriptName
 * 时对 .ttc 返回 TrueTypeCollection 集合对象（无 layout/createSubset），pdfkit EmbeddedFont
 * 构造时调 createSubset 即崩（"createSubset is not a function"，Task 70 实测）。
 * 正确姿势（Task 71 实测 PASS）：fontkit.create(缓冲) → 集合 → getFont(字面)/fonts[0] 取单字体
 * → doc.registerFont(名, 字体对象)（PDFFontFactory 第三通道直接接受 fontkit 字体对象）。
 */
function fontCandidateDirs(): string[] {
  const dirs: string[] = []
  if (process.env.PDF_FONT_DIR) dirs.push(process.env.PDF_FONT_DIR)
  dirs.push(path.join(process.cwd(), 'assets', 'fonts'))
  if (process.platform === 'win32') {
    dirs.push(process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts')
  } else if (process.platform === 'darwin') {
    dirs.push('/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts')
  } else {
    dirs.push(
      '/usr/share/fonts/truetype/noto-serif-sc', // 自装 Noto Serif SC（单体 TTF）
      '/usr/share/fonts/opentype/noto',          // apt fonts-noto-cjk（.ttc 集合）
      '/usr/share/fonts/truetype/noto',
      '/usr/share/fonts/truetype/wqy',           // apt fonts-wqy-zenhei/microhei（.ttc 集合）
      '/usr/share/fonts/truetype/arphic',
      '/usr/share/fonts/truetype/droid',
      '/usr/share/fonts',
    )
  }
  return dirs
}

// 候选文件名（.ttc 集合一等公民）：Windows 雅黑/宋体优先（系统必装概率最高）
const FONT_FILE_CANDIDATES: Record<FontKind, string[]> = {
  regular: [
    'NotoSerifSC-Regular.ttf', // 手工放置/自装 Noto Serif SC（单体 TTF）
    // Windows 系统自带（msyh/simsun 为 .ttc 集合；simhei/Deng/simkai/simfang 为单体 TTF）
    'msyh.ttc', 'msyh.ttf', 'simsun.ttc', 'simhei.ttf', 'Deng.ttf', 'simkai.ttf', 'simfang.ttf',
    // Linux（noto-cjk/文泉驿为 .ttc 集合；Droid 为单体 TTF）
    'NotoSerifCJK-Regular.ttc', 'NotoSansCJK-Regular.ttc', 'wqy-zenhei.ttc', 'wqy-microhei.ttc', 'DroidSansFallbackFull.ttf',
    'NotoSerifCJKsc-Regular.otf', 'NotoSansCJKsc-Regular.otf', 'ARPLUMing.otf', 'uming.ttc',
    // macOS（苹方/宋体为 .ttc 集合）
    'PingFang.ttc', 'Songti.ttc', 'Hiragino Sans GB.ttc',
  ],
  bold: [
    'NotoSerifSC-Bold.ttf',
    // Windows：雅黑 Bold（集合/单体）；黑体无独立 Bold 用原文件兜底；等线 Bold
    'msyhbd.ttc', 'msyhbd.ttf', 'DengB.ttf', 'simhei.ttf',
    'NotoSerifCJK-Bold.ttc', 'NotoSansCJK-Bold.ttc',
    'Songti.ttc', 'PingFang.ttc',
  ],
}

// .ttc 集合内优先选中的字面（postscriptName，如 noto-cjk 按 SC 取）；未命中回退集合第一个字体
const TTC_PREFERRED_NAMES: Record<string, string[]> = {
  'regular:NotoSerifCJK-Regular.ttc': ['NotoSerifCJKsc-Regular'],
  'regular:NotoSansCJK-Regular.ttc': ['NotoSansCJKsc-Regular'],
  'bold:NotoSerifCJK-Bold.ttc': ['NotoSerifCJKsc-Bold'],
  'bold:NotoSansCJK-Bold.ttc': ['NotoSansCJKsc-Bold'],
  'regular:PingFang.ttc': ['PingFangSC-Regular'],
  'bold:PingFang.ttc': ['PingFangSC-Semibold'],
  'regular:Songti.ttc': ['STSongti-SC-Regular', 'SongtiSC-Regular'],
  'bold:Songti.ttc': ['STSongti-SC-Bold', 'SongtiSC-Bold'],
  'regular:Hiragino Sans GB.ttc': ['HiraginoSansGB-W3'],
}

interface FontkitFontLike {
  postscriptName?: string
  layout: (text: string) => unknown
}

const isFontLike = (f: unknown): f is FontkitFontLike =>
  typeof f === 'object' && f !== null && typeof (f as { layout?: unknown }).layout === 'function'

/** 打开字体文件并归一化为「单字体」对象：单体 TTF/OTF 直接返回；.ttc 集合按首选字面取出单字体（回退集合第一个）。失败返回 null */
function openFontObject(p: string, kind: FontKind): FontkitFontLike | null {
  try {
    const opened: unknown = fontkitCreate(fs.readFileSync(p))
    if (isFontLike(opened)) return opened
    const coll = opened as { getFont?: (n: string) => unknown; fonts?: unknown[] }
    for (const psName of TTC_PREFERRED_NAMES[`${kind}:${path.basename(p)}`] ?? []) {
      try {
        const f = coll.getFont?.(psName)
        if (isFontLike(f)) return f
      } catch { /* 字面不存在 → 试下一个 */ }
    }
    const first = coll.fonts?.[0]
    return isFontLike(first) ? first : null
  } catch {
    return null // 文件损坏/非字体 → 下一候选
  }
}

/** Linux fontconfig 兜底：候选文件名全部落空时按语言+字重动态探测（.ttc 集合同样可用） */
function fcMatchFont(kind: FontKind): string | null {
  try {
    const pattern = kind === 'bold' ? 'sans:lang=zh-cn:weight=bold' : 'sans:lang=zh-cn'
    const out = execSync(`fc-match -f '%{file}' '${pattern}'`, { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
    return out || null
  } catch {
    return null // 无 fontconfig 环境（如精简容器）→ 返回 null 走指引性报错
  }
}

/** 存在性探测候选目录×文件名，返回命中路径（不打开文件；导出仅为诊断脚本/测试使用） */
export function resolveFontFile(kind: FontKind): string | null {
  for (const dir of fontCandidateDirs()) {
    for (const name of FONT_FILE_CANDIDATES[kind]) {
      const p = path.join(dir, name)
      try {
        if (fs.existsSync(p)) return p
      } catch { /* 目录不可读 → 下一候选 */ }
    }
  }
  if (process.platform !== 'win32' && process.platform !== 'darwin') return fcMatchFont(kind)
  return null
}

/** 注册第一个可用中文字体：预开 fontkit 验证（.ttc 自动取单字体）→ registerFont + 探针实开（失败降级下一候选）；返回命中路径 */
function registerCnFont(doc: InstanceType<typeof PDFDocument>, name: string, kind: FontKind): string | null {
  const candidates: string[] = []
  for (const dir of fontCandidateDirs()) {
    for (const fileName of FONT_FILE_CANDIDATES[kind]) {
      const p = path.join(dir, fileName)
      try {
        if (fs.existsSync(p)) candidates.push(p)
      } catch { /* 目录不可读 → 跳过 */ }
    }
  }
  if (candidates.length === 0 && process.platform !== 'win32' && process.platform !== 'darwin') {
    const fc = fcMatchFont(kind)
    if (fc) candidates.push(fc)
  }
  for (const p of candidates) {
    const fontObj = openFontObject(p, kind)
    if (!fontObj) {
      console.warn(`[bp-audit-pdf] 字体打开失败（跳过）: ${p}`)
      continue
    }
    try {
      // pdfkit PDFFontFactory 第三通道：直接接受 fontkit 字体对象（.ttc 路径直传会崩，必须先取单字体）
      doc.registerFont(name, fontObj as unknown as Buffer)
      // 探针：registerFont 仅登记，字体实开发生在首次 font() 调用——立即触发以暴露问题并降级
      doc.font(name).fontSize(8).text(' ', 0, 0, { width: 20, lineBreak: false })
      console.log(`[bp-audit-pdf] PDF ${kind} 字体命中: ${p}${p.toLowerCase().endsWith('.ttc') ? '（.ttc 集合 → 单字体对象）' : ''}`)
      return p
    } catch (err) {
      console.warn(`[bp-audit-pdf] 字体注册失败（跳过）: ${p} → ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return null
}

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

  const fontReg = registerCnFont(doc, 'cn', 'regular')
  if (!fontReg) {
    throw new Error(
      'PDF 中文字体缺失：系统与候选目录均未找到可用中文字体（.ttf/.otf/.ttc 均可）。请任选其一：①Linux 服务器执行 apt install fonts-noto-cjk（或 fonts-wqy-zenhei）后重试；②将任意中文字体文件放入项目 assets/fonts/ 目录（该目录不入库）；③设置环境变量 PDF_FONT_DIR 指向含中文字体的目录。Windows/macOS 一般自带中文字体，出现此错误通常意味着系统字体被精简'
    )
  }
  const fontBold = registerCnFont(doc, 'cn-bold', 'bold')
  const B = fontBold ? 'cn-bold' : 'cn'
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
