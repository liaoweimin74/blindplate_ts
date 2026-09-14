'use client'

// 作业需求全流程档案打印/导出（A4 纵向），复用 scheme-print 的「Dialog 预览 + 运行时注入打印隔离样式」模式
// - WrPrintSheet：A4 档案本体（头部 → 基本信息 → 勘察/JSA/隔离/处置/确认/票/任务/验收 → 审批留痕 → 页脚），可独立嵌入
// - WrPrintDialog（默认导出）：shadcn Dialog 内嵌 A4 预览 + 打印按钮；open 时注入 #bp-wr-print-style，关闭即清理；
//   详情自带 approvals 直接使用，缺失时补拉一次 /api/approvals?recordLimit=500 按本需求方案/票过滤
// - exportWrArchiveCsv：档案 CSV 导出（分区多行结构：基本信息 → 各环节关键数据 → 审批记录），复用 bp-export.exportCsv
import { useEffect, useState } from 'react'
import { apiGet, fmtDate, fmtDateTime } from '@/lib/bp-api'
import {
  STATUS_MAP, URGENCY_MAP, WORK_TYPE_MAP, SCHEME_STATUS_MAP, DISPOSAL_METHOD_MAP,
  POINT_ACTION_MAP, TICKET_STATUS_MAP, TASK_STATUS_MAP, APPROVE_ACTION_MAP, CONCLUSION_MAP,
} from '@/lib/bp-types'
import { exportCsv } from '@/lib/bp-export'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Loader2, Printer } from 'lucide-react'

// ============ 类型（与 GET /api/work-requests/[id] 返回结构对齐，宽松可选便于复用） ============
export interface WrPrintApproval {
  id: number
  bizType: string
  bizId?: number
  bizCode?: string | null
  action: string
  operator: string
  comment?: string | null
  createdAt: string
}

export interface WrPrintData {
  code: string
  title: string
  workType: string
  location: string
  pipelineName?: string | null
  medium?: string | null
  pressure?: string | null
  temperature?: string | null
  reason?: string
  urgency: string
  status: string
  applicantName: string
  plannedStart?: string | null
  plannedEnd?: string | null
  createdAt: string
  unit?: { name?: string | null } | null
  survey?: {
    surveyor: string; surveyDate: string; siteCondition: string
    pipelineVerify?: string | null; hazardPoints?: string | null; isSafe: boolean; suggestion?: string | null
  } | null
  jsa?: {
    leader: string; members?: string | null; analysisDate: string; riskLevel: string
    residualRisk?: string | null; steps: { seq: number; step: string; hazard: string; measure: string }[]
  } | null
  isolationScheme?: {
    id?: number
    code: string; preparedBy: string; status: string
    comment?: string | null; reviewedBy?: string | null; preparedAt?: string | null; reviewedAt?: string | null
    points: {
      seq: number; location: string; medium?: string | null; pressure?: string | null
      blindSpec: string; blindType: string; action: string; done?: boolean; doneAt?: string | null; operator?: string | null
    }[]
  } | null
  disposalScheme?: {
    id?: number
    code: string; preparedBy: string; status: string
    comment?: string | null; reviewedBy?: string | null; preparedAt?: string | null; reviewedAt?: string | null
    steps: { seq: number; method: string; detail: string; standard?: string | null; completed?: boolean }[]
  } | null
  disposalConfirmation?: {
    confirmer: string; confirmedAt: string
    flammableResult?: string | null; oxygenResult?: string | null; toxicResult?: string | null
    analysisQualified: boolean; remarks?: string | null; result: string
  } | null
  ticket?: {
    id?: number
    code: string; guardian: string; workers: string; issuer: string; safetyMeasures: string; status: string
    comment?: string | null
    plannedStart?: string | null; plannedEnd?: string | null
    createdAt?: string | null; approvedBy?: string | null; approvedAt?: string | null
    startedAt?: string | null; finishedAt?: string | null; closedAt?: string | null
  } | null
  tickets?: {
    code: string; status: string
    pointId?: number | null; pointCode?: string | null; pointLocation?: string | null
    blindSpec?: string | null; blindType?: string | null; action?: string | null
    guardian: string; workers: string; issuer: string
    comment?: string | null
    plannedStart?: string | null; plannedEnd?: string | null
    createdAt?: string | null; approvedBy?: string | null; approvedAt?: string | null
    startedAt?: string | null; finishedAt?: string | null; closedAt?: string | null
  }[] | null
  task?: { code: string; status: string } | null
  acceptance?: {
    acceptor: string; acceptedAt: string
    leakCheck: boolean; restoreCheck: boolean; ledgerCheck: boolean
    conclusion: string; problems?: string | null; remarks?: string | null
  } | null
  approvals?: WrPrintApproval[] | null
}

const BIZ_LABEL: Record<string, string> = { ISOLATION: '隔离方案', DISPOSAL: '处置方案', TICKET: '作业票' }
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']
const cnNum = (n: number) => CN_NUM[n - 1] ?? String(n)
const riskLabel = (v: string) => (v === 'LOW' ? '低' : v === 'HIGH' ? '高' : '中')

type SecKey = 'base' | 'survey' | 'jsa' | 'iso' | 'disp' | 'confirm' | 'ticket' | 'task' | 'accept' | 'approvals'

/** 按数据存在性预编排节号（一/二/三…），保证打印目录编号连续 */
function buildSectionNumbers(d: WrPrintData): Partial<Record<SecKey, number>> {
  const no: Partial<Record<SecKey, number>> = {}
  let n = 1
  no.base = n++
  if (d.survey) no.survey = n++
  if (d.jsa) no.jsa = n++
  if (d.isolationScheme) no.iso = n++
  if (d.disposalScheme) no.disp = n++
  if (d.disposalConfirmation) no.confirm = n++
  if (d.ticket || (d.tickets && d.tickets.length)) no.ticket = n++
  if (d.task) no.task = n++
  if (d.acceptance) no.accept = n++
  no.approvals = n
  return no
}

// ============ A4 档案本体 ============
export function WrPrintSheet({ data, approvals, printerName }: {
  data: WrPrintData
  approvals: WrPrintApproval[]
  printerName: string
}) {
  const no = buildSectionNumbers(data)
  const statusLabel = STATUS_MAP[data.status]?.label ?? data.status
  // 打印时间以打开单据那一刻为准，避免重渲染时跳动
  const [printedAt] = useState(() => fmtDateTime(new Date()))
  const fmt = (v?: string | Date | null) => (v ? fmtDateTime(v as string) : '-')

  return (
    <div id="bp-wr-print-sheet"
      className="max-w-[794px] mx-auto bg-white text-stone-900 shadow-2xl rounded-sm p-8 space-y-4 origin-top">
      <style>{`
        #bp-wr-print-sheet { font-family: "Songti SC","SimSun",serif; }
        #bp-wr-print-sheet table { border-collapse: collapse; }
        #bp-wr-print-sheet td, #bp-wr-print-sheet th { border: 1px solid #d6d3d1; padding: 5px 8px; vertical-align: top; word-break: break-word; }
        #bp-wr-print-sheet tr { page-break-inside: avoid; }
        #bp-wr-print-sheet .sec { break-inside: avoid; }
      `}</style>

      {/* 头部：公司名 + 档案标题 + 需求编号大字 + 状态戳（黑白友好：边框+文字） */}
      <div className="flex items-start justify-between gap-4 border-b-2 border-stone-800 pb-3">
        <div>
          <div className="text-[11px] tracking-[0.3em] text-stone-500">XX石化 · BLIND PLATE WORK ARCHIVE</div>
          <h1 className="text-2xl font-bold tracking-widest mt-0.5">盲板抽堵作业全流程档案</h1>
          <div className="text-xs text-stone-500 mt-1">依据 GB 30871《危险化学品企业特殊作业安全规范》编制归档 · 全流程留痕</div>
        </div>
        <div className="text-right space-y-1 shrink-0">
          <div className="text-[10px] text-stone-400">档案编号</div>
          <div className="font-mono text-xl font-bold leading-tight">{data.code}</div>
          <div className="text-[11px] px-2 py-0.5 border border-stone-500 inline-block">{statusLabel}</div>
        </div>
      </div>

      {/* 一、作业需求基本信息 */}
      <div className="sec">
        <div className="text-xs font-bold mb-1.5">{cnNum(no.base!)}、作业需求基本信息</div>
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="bg-stone-100 font-medium w-[13%]">需求标题</td>
              <td colSpan={5}>{data.title}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 font-medium">所属装置</td>
              <td className="w-[20%]">{data.unit?.name ?? '-'}</td>
              <td className="bg-stone-100 font-medium w-[13%]">作业类型</td>
              <td className="w-[20%]">{WORK_TYPE_MAP[data.workType] ?? data.workType}</td>
              <td className="bg-stone-100 font-medium w-[13%]">紧急程度</td>
              <td>{URGENCY_MAP[data.urgency]?.label ?? data.urgency}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 font-medium">作业位置</td>
              <td colSpan={3}>{data.location}</td>
              <td className="bg-stone-100 font-medium">管线名称</td>
              <td>{data.pipelineName ?? '-'}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 font-medium">介质</td>
              <td>{data.medium ?? '-'}</td>
              <td className="bg-stone-100 font-medium">管线压力</td>
              <td>{data.pressure ?? '-'}</td>
              <td className="bg-stone-100 font-medium">管线温度</td>
              <td>{data.temperature ?? '-'}</td>
            </tr>
            <tr>
              <td className="bg-stone-100 font-medium">申请人</td>
              <td>{data.applicantName}</td>
              <td className="bg-stone-100 font-medium">申请时间</td>
              <td>{fmt(data.createdAt)}</td>
              {(data.plannedStart || data.plannedEnd) ? (
                <>
                  <td className="bg-stone-100 font-medium">计划工期</td>
                  <td>{fmtDate(data.plannedStart)} ~ {fmtDate(data.plannedEnd)}</td>
                </>
              ) : (
                <>
                  <td className="bg-stone-100 font-medium">作业原因</td>
                  <td>{data.reason ?? '-'}</td>
                </>
              )}
            </tr>
            {(data.plannedStart || data.plannedEnd) && (
              <tr>
                <td className="bg-stone-100 font-medium">作业原因</td>
                <td colSpan={5}>{data.reason ?? '-'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 现场勘察 */}
      {data.survey && no.survey && (
        <div className="sec">
          <div className="text-xs font-bold mb-1.5">{cnNum(no.survey)}、现场勘察</div>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="bg-stone-100 font-medium w-[13%]">勘察人</td>
                <td className="w-[20%]">{data.survey.surveyor}</td>
                <td className="bg-stone-100 font-medium w-[13%]">勘察时间</td>
                <td className="w-[20%]">{fmt(data.survey.surveyDate)}</td>
                <td className="bg-stone-100 font-medium w-[13%]">具备作业条件</td>
                <td>{data.survey.isSafe ? '是' : '否'}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">现场条件（结论）</td>
                <td colSpan={5}>{data.survey.siteCondition}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">管线参数核实</td>
                <td colSpan={2}>{data.survey.pipelineVerify ?? '-'}</td>
                <td className="bg-stone-100 font-medium">现场风险点</td>
                <td colSpan={2}>{data.survey.hazardPoints ?? '-'}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">勘察建议</td>
                <td colSpan={5}>{data.survey.suggestion ?? '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* JSA 分析 */}
      {data.jsa && no.jsa && (
        <div className="sec">
          <div className="text-xs font-bold mb-1.5">{cnNum(no.jsa)}、JSA 作业安全分析</div>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="bg-stone-100 font-medium w-[13%]">分析组长</td>
                <td className="w-[20%]">{data.jsa.leader}</td>
                <td className="bg-stone-100 font-medium w-[13%]">参与人员</td>
                <td className="w-[20%]">{data.jsa.members ?? '-'}</td>
                <td className="bg-stone-100 font-medium w-[13%]">分析日期</td>
                <td>{fmtDate(data.jsa.analysisDate)}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">综合风险等级</td>
                <td>{riskLabel(data.jsa.riskLevel)}</td>
                <td className="bg-stone-100 font-medium">剩余风险与应急措施</td>
                <td colSpan={3}>{data.jsa.residualRisk ?? '-'}</td>
              </tr>
            </tbody>
          </table>
          <table className="w-full text-[12px] mt-1.5">
            <thead>
              <tr className="bg-stone-100">
                <th className="w-10 text-center font-medium">序号</th>
                <th className="text-left font-medium">作业步骤</th>
                <th className="text-left font-medium">危害因素</th>
                <th className="text-left font-medium">控制措施</th>
              </tr>
            </thead>
            <tbody>
              {data.jsa.steps.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-stone-400 py-2">无分析步骤</td></tr>
              ) : data.jsa.steps.map((s, i) => (
                <tr key={s.seq} className={cn(i % 2 === 1 && 'bg-stone-50')}>
                  <td className="text-center">{s.seq}</td>
                  <td>{s.step}</td>
                  <td>{s.hazard}</td>
                  <td>{s.measure}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 隔离方案 */}
      {data.isolationScheme && no.iso && (
        <div className="sec">
          <div className="text-xs font-bold mb-1.5">{cnNum(no.iso)}、隔离方案</div>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="bg-stone-100 font-medium w-[13%]">方案编号</td>
                <td className="font-mono w-[20%]">{data.isolationScheme.code}</td>
                <td className="bg-stone-100 font-medium w-[13%]">方案状态</td>
                <td>{SCHEME_STATUS_MAP[data.isolationScheme.status]?.label ?? data.isolationScheme.status}</td>
                <td className="bg-stone-100 font-medium w-[13%]">编制人</td>
                <td>{data.isolationScheme.preparedBy}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">审核人</td>
                <td>{data.isolationScheme.reviewedBy ?? '待审核'}</td>
                <td className="bg-stone-100 font-medium">审核时间</td>
                <td>{fmt(data.isolationScheme.reviewedAt)}</td>
                <td className="bg-stone-100 font-medium">编制时间</td>
                <td>{fmt(data.isolationScheme.preparedAt)}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">审核意见</td>
                <td colSpan={5}>{data.isolationScheme.comment ?? (data.isolationScheme.status === 'APPROVED' ? '—' : '待审核')}</td>
              </tr>
            </tbody>
          </table>
          <table className="w-full text-[12px] mt-1.5">
            <thead>
              <tr className="bg-stone-100">
                <th className="w-10 text-center font-medium">序号</th>
                <th className="text-left font-medium">隔离位置</th>
                <th className="text-left font-medium w-16">介质</th>
                <th className="text-left font-medium w-16">压力</th>
                <th className="text-left font-medium w-20">盲板规格</th>
                <th className="text-left font-medium w-24">盲板类型</th>
                <th className="text-center font-medium w-20">动作</th>
                <th className="text-center font-medium w-36">执行状态</th>
              </tr>
            </thead>
            <tbody>
              {data.isolationScheme.points.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-stone-400 py-2">无隔离点数据</td></tr>
              ) : data.isolationScheme.points.map((p, i) => (
                <tr key={p.seq} className={cn(i % 2 === 1 && 'bg-stone-50')}>
                  <td className="text-center">{p.seq}</td>
                  <td>{p.location}</td>
                  <td>{p.medium ?? '-'}</td>
                  <td>{p.pressure ?? '-'}</td>
                  <td>{p.blindSpec}</td>
                  <td>{p.blindType}</td>
                  <td className="text-center">{POINT_ACTION_MAP[p.action] ?? p.action}</td>
                  <td className="text-center">{p.done ? `已执行（${p.operator ?? '-'} ${fmtDate(p.doneAt)}）` : '待执行'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 工艺处置方案 */}
      {data.disposalScheme && no.disp && (
        <div className="sec">
          <div className="text-xs font-bold mb-1.5">{cnNum(no.disp)}、工艺处置方案</div>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="bg-stone-100 font-medium w-[13%]">方案编号</td>
                <td className="font-mono w-[20%]">{data.disposalScheme.code}</td>
                <td className="bg-stone-100 font-medium w-[13%]">方案状态</td>
                <td>{SCHEME_STATUS_MAP[data.disposalScheme.status]?.label ?? data.disposalScheme.status}</td>
                <td className="bg-stone-100 font-medium w-[13%]">编制人</td>
                <td>{data.disposalScheme.preparedBy}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">审核人</td>
                <td>{data.disposalScheme.reviewedBy ?? '待审核'}</td>
                <td className="bg-stone-100 font-medium">审核时间</td>
                <td>{fmt(data.disposalScheme.reviewedAt)}</td>
                <td className="bg-stone-100 font-medium">审核意见</td>
                <td>{data.disposalScheme.comment ?? (data.disposalScheme.status === 'APPROVED' ? '—' : '待审核')}</td>
              </tr>
            </tbody>
          </table>
          <table className="w-full text-[12px] mt-1.5">
            <thead>
              <tr className="bg-stone-100">
                <th className="w-10 text-center font-medium">序号</th>
                <th className="text-left font-medium w-24">处置方式</th>
                <th className="text-left font-medium">处置内容</th>
                <th className="text-left font-medium w-40">合格标准</th>
                <th className="text-center font-medium w-16">完成状态</th>
              </tr>
            </thead>
            <tbody>
              {data.disposalScheme.steps.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-stone-400 py-2">无处置步骤</td></tr>
              ) : data.disposalScheme.steps.map((s, i) => (
                <tr key={s.seq} className={cn(i % 2 === 1 && 'bg-stone-50')}>
                  <td className="text-center">{s.seq}</td>
                  <td>{DISPOSAL_METHOD_MAP[s.method] ?? s.method}</td>
                  <td>{s.detail}</td>
                  <td>{s.standard ?? '-'}</td>
                  <td className="text-center">{s.completed ? '已完成' : '待执行'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 工艺处置确认 */}
      {data.disposalConfirmation && no.confirm && (
        <div className="sec">
          <div className="text-xs font-bold mb-1.5">{cnNum(no.confirm)}、工艺处置确认</div>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="bg-stone-100 font-medium w-[13%]">确认人</td>
                <td className="w-[20%]">{data.disposalConfirmation.confirmer}</td>
                <td className="bg-stone-100 font-medium w-[13%]">确认时间</td>
                <td>{fmt(data.disposalConfirmation.confirmedAt)}</td>
                <td className="bg-stone-100 font-medium w-[13%]">确认结论</td>
                <td>{data.disposalConfirmation.result === 'QUALIFIED' ? '合格' : '不合格'}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">可燃气体(LEL)</td>
                <td>{data.disposalConfirmation.flammableResult ?? '-'}</td>
                <td className="bg-stone-100 font-medium">氧含量</td>
                <td>{data.disposalConfirmation.oxygenResult ?? '-'}</td>
                <td className="bg-stone-100 font-medium">有毒气体</td>
                <td>{data.disposalConfirmation.toxicResult ?? '-'}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">气体分析合格</td>
                <td>{data.disposalConfirmation.analysisQualified ? '是' : '否'}</td>
                <td className="bg-stone-100 font-medium">备注</td>
                <td colSpan={3}>{data.disposalConfirmation.remarks ?? '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 作业票（一票一板：多票列表；存量合并票走单票渲染） */}
      {no.ticket && (data.tickets?.length || data.ticket) ? (
        <div className="sec">
          <div className="text-xs font-bold mb-1.5">{cnNum(no.ticket)}、盲板抽堵安全作业票{data.tickets && data.tickets.length > 1 ? `（一票一板 · 共 ${data.tickets.length} 张）` : ''}</div>
          {data.tickets && data.tickets.length > 0 && (
            <table className="w-full text-xs mb-1.5">
              <thead>
                <tr className="bg-stone-100">
                  <th className="px-2 py-1 text-left font-medium w-[15%]">票号</th>
                  <th className="px-2 py-1 text-left font-medium w-[12%]">隔离点</th>
                  <th className="px-2 py-1 text-left font-medium">作业位置</th>
                  <th className="px-2 py-1 text-left font-medium w-[16%]">盲板规格/类型</th>
                  <th className="px-2 py-1 text-left font-medium w-[10%]">状态</th>
                  <th className="px-2 py-1 text-left font-medium w-[12%]">批准人</th>
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((t, i) => (
                  <tr key={i} className="border-t border-stone-200">
                    <td className="px-2 py-1 font-mono">{t.code}</td>
                    <td className="px-2 py-1 font-mono">{t.pointCode ?? '-'}</td>
                    <td className="px-2 py-1">{t.pointLocation ?? '-'}</td>
                    <td className="px-2 py-1">{[t.blindSpec, t.blindType].filter(Boolean).join(' / ') || '-'}</td>
                    <td className="px-2 py-1">{TICKET_STATUS_MAP[t.status]?.label ?? t.status}</td>
                    <td className="px-2 py-1">{t.approvedBy ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(!data.tickets || data.tickets.length === 0) && data.ticket && (
          <>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="bg-stone-100 font-medium w-[13%]">票号</td>
                <td className="font-mono w-[20%]">{data.ticket.code}</td>
                <td className="bg-stone-100 font-medium w-[13%]">票状态</td>
                <td>{TICKET_STATUS_MAP[data.ticket.status]?.label ?? data.ticket.status}</td>
                <td className="bg-stone-100 font-medium w-[13%]">签发人</td>
                <td>{data.ticket.issuer}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">监护人</td>
                <td>{data.ticket.guardian}</td>
                <td className="bg-stone-100 font-medium">批准人</td>
                <td>{data.ticket.approvedBy ?? '-'}</td>
                <td className="bg-stone-100 font-medium">作业人员</td>
                <td>{data.ticket.workers ?? '-'}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">计划开始</td>
                <td>{fmt(data.ticket.plannedStart)}</td>
                <td className="bg-stone-100 font-medium">计划结束</td>
                <td>{fmt(data.ticket.plannedEnd)}</td>
                <td className="bg-stone-100 font-medium">审批意见</td>
                <td>{data.ticket.comment ?? '-'}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">签发时间</td>
                <td>{fmt(data.ticket.createdAt)}</td>
                <td className="bg-stone-100 font-medium">批准时间</td>
                <td>{fmt(data.ticket.approvedAt)}</td>
                <td className="bg-stone-100 font-medium">开工时间</td>
                <td>{fmt(data.ticket.startedAt)}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">完工时间</td>
                <td>{fmt(data.ticket.finishedAt)}</td>
                <td className="bg-stone-100 font-medium">关票时间</td>
                <td colSpan={3}>{fmt(data.ticket.closedAt)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-1.5">
            <div className="text-[11px] font-bold mb-1">安全措施</div>
            <div className="border border-stone-700 px-3 py-2 text-xs leading-relaxed whitespace-pre-line min-h-[40px]">
              {data.ticket.safetyMeasures || '（无）'}
            </div>
          </div>
          </>
        )}
        </div>
        ) : null}

      {/* 作业任务 */}
      {data.task && no.task && (
        <div className="sec">
          <div className="text-xs font-bold mb-1.5">{cnNum(no.task)}、作业任务</div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-stone-100">
                <th className="text-left font-medium">任务编号</th>
                <th className="text-center font-medium w-28">任务状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-mono">{data.task.code}</td>
                <td className="text-center">{TASK_STATUS_MAP[data.task.status]?.label ?? data.task.status}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 验收结论 */}
      {data.acceptance && no.accept && (
        <div className="sec">
          <div className="text-xs font-bold mb-1.5">{cnNum(no.accept)}、作业验收结论</div>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="bg-stone-100 font-medium w-[13%]">验收人</td>
                <td className="w-[20%]">{data.acceptance.acceptor}</td>
                <td className="bg-stone-100 font-medium w-[13%]">验收时间</td>
                <td>{fmt(data.acceptance.acceptedAt)}</td>
                <td className="bg-stone-100 font-medium w-[13%]">验收结论</td>
                <td>{CONCLUSION_MAP[data.acceptance.conclusion]?.label ?? data.acceptance.conclusion}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">无泄漏确认</td>
                <td>{data.acceptance.leakCheck ? '通过' : '未通过'}</td>
                <td className="bg-stone-100 font-medium">现场恢复确认</td>
                <td>{data.acceptance.restoreCheck ? '通过' : '未通过'}</td>
                <td className="bg-stone-100 font-medium">台账更新确认</td>
                <td>{data.acceptance.ledgerCheck ? '已确认' : '未确认'}</td>
              </tr>
              <tr>
                <td className="bg-stone-100 font-medium">发现问题</td>
                <td colSpan={2}>{data.acceptance.problems ?? '-'}</td>
                <td className="bg-stone-100 font-medium">验收意见</td>
                <td colSpan={2}>{data.acceptance.remarks ?? '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 审批留痕 */}
      <div className="sec">
        <div className="text-xs font-bold mb-1.5">{cnNum(no.approvals!)}、审批留痕</div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-stone-100">
              <th className="text-center font-medium w-20">环节</th>
              <th className="text-left font-medium w-32">单据编号</th>
              <th className="text-center font-medium w-20">动作</th>
              <th className="text-center font-medium w-20">操作人</th>
              <th className="text-left font-medium">意见</th>
              <th className="text-center font-medium w-28">时间</th>
            </tr>
          </thead>
          <tbody>
            {approvals.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-stone-400 py-2">该需求暂无审批记录</td></tr>
            ) : approvals.map((a, i) => (
              <tr key={a.id} className={cn(i % 2 === 1 && 'bg-stone-50')}>
                <td className="text-center">{BIZ_LABEL[a.bizType] ?? a.bizType}</td>
                <td className="font-mono">{a.bizCode ?? '-'}</td>
                <td className="text-center">{APPROVE_ACTION_MAP[a.action] ?? a.action}</td>
                <td className="text-center">{a.operator}</td>
                <td>{a.comment ?? '-'}</td>
                <td className="text-center">{fmt(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 页脚 */}
      <div className="border-t border-stone-300 pt-2 flex items-center justify-between text-[10px] text-stone-500">
        <span>打印时间:{printedAt} · 打印人:{printerName}</span>
        <span>本档案由盲板管理系统自动生成</span>
      </div>
    </div>
  )
}

// ============ 触发式打印弹窗（Dialog 内嵌 A4 预览） ============
export default function WrPrintDialog({ open, onOpenChange, detail, printerName }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: WrPrintData | null
  printerName: string
}) {
  const [fallback, setFallback] = useState<{ key: string; list: WrPrintApproval[] } | null>(null)
  // 详情自带 approvals（数组）直接使用；缺失时用 fallback（补拉 /api/approvals 过滤结果）
  const localApprovals = detail && Array.isArray(detail.approvals) ? detail.approvals : null
  const approvals = localApprovals ?? (detail && fallback?.key === detail.code ? fallback.list : null)

  // 审批留痕缺失时补拉一次 /api/approvals?recordLimit=500，按本需求方案/票的 id/编号过滤（异步回调内 setState，避免同步刷状态）
  useEffect(() => {
    if (!open || !detail) return
    if (Array.isArray(detail.approvals)) return
    const key = detail.code
    const isoId = detail.isolationScheme?.id
    const isoCode = detail.isolationScheme?.code
    const dispId = detail.disposalScheme?.id
    const dispCode = detail.disposalScheme?.code
    const ticketId = detail.ticket?.id
    const ticketCode = detail.ticket?.code
    let alive = true
    apiGet<{ records?: WrPrintApproval[] }>('/api/approvals?recordLimit=500')
      .then((d) => {
        if (!alive) return
        const recs = (d.records ?? []).filter((r) => {
          if (r.bizType === 'ISOLATION' && isoCode) return r.bizId === isoId || r.bizCode === isoCode
          if (r.bizType === 'DISPOSAL' && dispCode) return r.bizId === dispId || r.bizCode === dispCode
          if (r.bizType === 'TICKET' && ticketCode) return r.bizId === ticketId || r.bizCode === ticketCode
          return false
        })
        setFallback({ key, list: recs })
      })
      .catch(() => { if (alive) setFallback({ key, list: [] }) })
    return () => { alive = false }
  }, [open, detail])

  // 打印样式隔离：打印时隐藏应用其余内容，仅输出 A4 档案（复用 scheme-print 模式）
  useEffect(() => {
    if (!open) return
    const style = document.createElement('style')
    style.id = 'bp-wr-print-style'
    style.textContent = `
      @media print {
        /* Tailwind 4 居中类编译为独立 translate 属性（非 transform）——不清除会使 DialogContent
           仍是 absolute 后代的包含块，档案整体左/上移出页面（打印只剩右边一部分） */
        body, body * { translate: none !important; rotate: none !important; scale: none !important; }
        body > *:not([data-slot='dialog-content']) { display: none !important; }
        body > [data-slot='dialog-content'] { position: static !important; inset: auto !important;
          width: auto !important; max-width: none !important; border: 0 !important; padding: 0 !important;
          background: #fff !important; box-shadow: none !important; gap: 0 !important; }
        body * { visibility: hidden !important; position: static !important;
          overflow: visible !important; max-height: none !important; transform: none !important; }
        #bp-wr-print-sheet, #bp-wr-print-sheet * { visibility: visible !important; }
        #bp-wr-print-sheet { position: absolute !important; top: 0 !important; left: 0 !important;
          width: 194mm !important; max-width: none !important; margin: 0 !important; padding: 12mm !important;
          box-shadow: none !important; border-radius: 0 !important; }
        .no-print { display: none !important; }
        @page { size: A4 portrait; margin: 8mm; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('bp-wr-print-style')?.remove() }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">作业需求档案打印预览 · 全流程</DialogTitle>
          <DialogDescription className="text-xs">
            {detail
              ? `${detail.code} · A4 纵向 · 点击"打印 / 导出 PDF"后可在系统打印对话框中选择"另存为 PDF"`
              : '正在准备打印数据…'}
          </DialogDescription>
        </DialogHeader>
        {detail && (
          <>
            <div className="no-print flex items-center justify-between gap-2">
              <span className="text-[11px] text-stone-400">
                {approvals === null ? (
                  <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />审批留痕加载中…</span>
                ) : '打印时将自动隐藏系统界面，仅输出 A4 档案内容'}
              </span>
              <Button size="sm" onClick={() => window.print()} className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5">
                <Printer className="w-3.5 h-3.5" />打印 / 导出 PDF
              </Button>
            </div>
            <WrPrintSheet data={detail} approvals={approvals ?? []} printerName={printerName} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============ 档案 CSV 导出（分区多行结构） ============
export function exportWrArchiveCsv(detail: WrPrintData, printerName: string) {
  const rows: unknown[][] = []
  let n = 0
  const sec = (title: string) => { n += 1; rows.push([]); rows.push([`${cnNum(n)}、${title}`]) }
  const kv = (label: string, v: unknown) => rows.push([label, v ?? '-'])

  const statusLabel = STATUS_MAP[detail.status]?.label ?? detail.status

  // 一、基本信息
  sec(`作业需求基本信息（状态：${statusLabel}）`)
  kv('需求编号', detail.code)
  kv('需求标题', detail.title)
  kv('所属装置', detail.unit?.name ?? '-')
  kv('作业类型', WORK_TYPE_MAP[detail.workType] ?? detail.workType)
  kv('紧急程度', URGENCY_MAP[detail.urgency]?.label ?? detail.urgency)
  kv('作业位置', detail.location)
  kv('管线名称', detail.pipelineName ?? '-')
  kv('介质', detail.medium ?? '-')
  kv('管线压力', detail.pressure ?? '-')
  kv('管线温度', detail.temperature ?? '-')
  kv('申请人', detail.applicantName)
  kv('申请时间', fmtDateTime(detail.createdAt))
  if (detail.plannedStart || detail.plannedEnd) {
    kv('计划工期', `${fmtDate(detail.plannedStart)} ~ ${fmtDate(detail.plannedEnd)}`)
  }
  kv('作业原因', detail.reason ?? '-')

  if (detail.survey) {
    sec('现场勘察')
    kv('勘察人', detail.survey.surveyor)
    kv('勘察时间', fmtDateTime(detail.survey.surveyDate))
    kv('具备作业条件', detail.survey.isSafe ? '是' : '否')
    kv('现场条件', detail.survey.siteCondition)
    kv('管线参数核实', detail.survey.pipelineVerify ?? '-')
    kv('现场风险点', detail.survey.hazardPoints ?? '-')
    kv('勘察建议', detail.survey.suggestion ?? '-')
  }

  if (detail.jsa) {
    sec('JSA 作业安全分析')
    kv('分析组长', detail.jsa.leader)
    kv('参与人员', detail.jsa.members ?? '-')
    kv('分析日期', fmtDate(detail.jsa.analysisDate))
    kv('综合风险等级', riskLabel(detail.jsa.riskLevel))
    kv('剩余风险与应急措施', detail.jsa.residualRisk ?? '-')
    rows.push(['序号', '作业步骤', '危害因素', '控制措施'])
    for (const s of detail.jsa.steps) rows.push([s.seq, s.step, s.hazard, s.measure])
  }

  if (detail.isolationScheme) {
    sec('隔离方案')
    kv('方案编号', detail.isolationScheme.code)
    kv('方案状态', SCHEME_STATUS_MAP[detail.isolationScheme.status]?.label ?? detail.isolationScheme.status)
    kv('编制人', detail.isolationScheme.preparedBy)
    kv('审核人', detail.isolationScheme.reviewedBy ?? '待审核')
    kv('审核时间', fmtDateTime(detail.isolationScheme.reviewedAt))
    kv('审核意见', detail.isolationScheme.comment ?? (detail.isolationScheme.status === 'APPROVED' ? '—' : '待审核'))
    rows.push(['序号', '隔离位置', '介质', '压力', '盲板规格', '盲板类型', '动作', '执行状态'])
    for (const p of detail.isolationScheme.points) {
      rows.push([
        p.seq, p.location, p.medium ?? '-', p.pressure ?? '-', p.blindSpec, p.blindType,
        POINT_ACTION_MAP[p.action] ?? p.action,
        p.done ? `已执行（${p.operator ?? '-'} ${fmtDate(p.doneAt)}）` : '待执行',
      ])
    }
  }

  if (detail.disposalScheme) {
    sec('工艺处置方案')
    kv('方案编号', detail.disposalScheme.code)
    kv('方案状态', SCHEME_STATUS_MAP[detail.disposalScheme.status]?.label ?? detail.disposalScheme.status)
    kv('编制人', detail.disposalScheme.preparedBy)
    kv('审核人', detail.disposalScheme.reviewedBy ?? '待审核')
    kv('审核时间', fmtDateTime(detail.disposalScheme.reviewedAt))
    kv('审核意见', detail.disposalScheme.comment ?? (detail.disposalScheme.status === 'APPROVED' ? '—' : '待审核'))
    rows.push(['序号', '处置方式', '处置内容', '合格标准', '完成状态'])
    for (const s of detail.disposalScheme.steps) {
      rows.push([s.seq, DISPOSAL_METHOD_MAP[s.method] ?? s.method, s.detail, s.standard ?? '-', s.completed ? '已完成' : '待执行'])
    }
  }

  if (detail.disposalConfirmation) {
    sec('工艺处置确认')
    kv('确认人', detail.disposalConfirmation.confirmer)
    kv('确认时间', fmtDateTime(detail.disposalConfirmation.confirmedAt))
    kv('可燃气体(LEL)', detail.disposalConfirmation.flammableResult ?? '-')
    kv('氧含量', detail.disposalConfirmation.oxygenResult ?? '-')
    kv('有毒气体', detail.disposalConfirmation.toxicResult ?? '-')
    kv('气体分析合格', detail.disposalConfirmation.analysisQualified ? '是' : '否')
    kv('确认结论', detail.disposalConfirmation.result === 'QUALIFIED' ? '合格' : '不合格')
    kv('备注', detail.disposalConfirmation.remarks ?? '-')
  }

  if (detail.ticket) {
    sec('盲板抽堵安全作业票')
    kv('票号', detail.ticket.code)
    kv('票状态', TICKET_STATUS_MAP[detail.ticket.status]?.label ?? detail.ticket.status)
    kv('签发人', detail.ticket.issuer)
    kv('批准人', detail.ticket.approvedBy ?? '-')
    kv('监护人', detail.ticket.guardian)
    kv('作业人员', detail.ticket.workers ?? '-')
    kv('计划开始', fmtDateTime(detail.ticket.plannedStart))
    kv('计划结束', fmtDateTime(detail.ticket.plannedEnd))
    kv('签发时间', fmtDateTime(detail.ticket.createdAt))
    kv('批准时间', fmtDateTime(detail.ticket.approvedAt))
    kv('开工时间', fmtDateTime(detail.ticket.startedAt))
    kv('完工时间', fmtDateTime(detail.ticket.finishedAt))
    kv('关票时间', fmtDateTime(detail.ticket.closedAt))
    kv('审批意见', detail.ticket.comment ?? '-')
    kv('安全措施', detail.ticket.safetyMeasures ?? '-')
  }

  if (detail.task) {
    sec('作业任务')
    kv('任务编号', detail.task.code)
    kv('任务状态', TASK_STATUS_MAP[detail.task.status]?.label ?? detail.task.status)
  }

  if (detail.acceptance) {
    sec('作业验收结论')
    kv('验收人', detail.acceptance.acceptor)
    kv('验收时间', fmtDateTime(detail.acceptance.acceptedAt))
    kv('无泄漏确认', detail.acceptance.leakCheck ? '通过' : '未通过')
    kv('现场恢复确认', detail.acceptance.restoreCheck ? '通过' : '未通过')
    kv('台账更新确认', detail.acceptance.ledgerCheck ? '已确认' : '未确认')
    kv('验收结论', CONCLUSION_MAP[detail.acceptance.conclusion]?.label ?? detail.acceptance.conclusion)
    kv('发现问题', detail.acceptance.problems ?? '-')
    kv('验收意见', detail.acceptance.remarks ?? '-')
  }

  sec('审批记录')
  rows.push(['时间', '环节', '单据编号', '动作', '操作人', '意见'])
  for (const a of detail.approvals ?? []) {
    rows.push([fmtDateTime(a.createdAt), BIZ_LABEL[a.bizType] ?? a.bizType, a.bizCode ?? '-', APPROVE_ACTION_MAP[a.action] ?? a.action, a.operator, a.comment ?? '-'])
  }

  rows.push([])
  rows.push([`本档案由盲板管理系统自动生成 · 导出人：${printerName} · 导出时间：${fmtDateTime(new Date())}`])

  exportCsv(`作业需求档案_${detail.code}`, ['盲板抽堵作业全流程档案', detail.code, `状态：${statusLabel}`], rows)
}
