'use client'

// 作业需求详情 · 全流程时间线
// 以九大业务环节为骨架的纵向里程碑视图：已完成节点带时间/经办人，审批留痕
// （ApprovalRecord）与作业票生命周期事件作为子事件挂到对应节点下。
import { fmtDateTime, fmtDate } from '@/lib/bp-api'
import { cn } from '@/lib/utils'
import {
  ClipboardList, MapPin, FileText, ShieldCheck, Stamp, Ticket as TicketIcon,
  Hammer, CheckCircle2, Check, Clock, History, AlertTriangle,
} from 'lucide-react'

// ============ 结构化输入（与 work-requests.tsx Detail 兼容的最小结构） ============
export interface TimelineApproval {
  id: number
  bizType: string
  bizCode?: string | null
  action: string // SUBMIT | APPROVE | REJECT
  operator: string
  comment?: string | null
  createdAt: string
}

export interface FlowTimelineDetail {
  status: string
  createdAt: string
  applicantName: string
  survey: { surveyor: string; surveyDate: string; isSafe: boolean } | null
  jsa: { leader: string; analysisDate: string; riskLevel: string } | null
  isolationScheme: { code: string; preparedBy: string; status: string; comment?: string | null; reviewedBy?: string | null; preparedAt?: string | null; reviewedAt?: string | null; points?: { done: boolean }[] } | null
  disposalScheme: { code: string; preparedBy: string; status: string; comment?: string | null; reviewedBy?: string | null; preparedAt?: string | null; reviewedAt?: string | null } | null
  disposalConfirmation: { confirmer: string; confirmedAt: string; result: string } | null
  ticket: {
    code: string; issuer: string; status: string
    createdAt?: string | null; approvedAt?: string | null; approvedBy?: string | null
    startedAt?: string | null; finishedAt?: string | null; closedAt?: string | null
  } | null
  acceptance: { acceptor: string; acceptedAt: string; conclusion: string; problems?: string | null } | null
  approvals: TimelineApproval[]
}

// ============ 节点定义 ============
type NodeState = 'done' | 'active' | 'pending'

interface SubEvent {
  key: string
  label: string
  time?: string | null
  actor?: string | null
  tone: 'ok' | 'warn' | 'bad' | 'muted'
}

interface StageNode {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  doneAt?: string | null
  actor?: string | null
  note?: string | null
  /** 该需求状态落在该环节时视为 active */
  activeStates: string[]
  subEvents: SubEvent[]
  done: boolean
  active: boolean
}

const IN_FLIGHT = new Set([
  'ISOLATION_PREPARING', 'ISOLATION_PENDING_REVIEW', 'ISOLATION_REJECTED', 'ISOLATION_APPROVED',
  'DISPOSAL_PREPARING', 'DISPOSAL_PENDING_REVIEW', 'DISPOSAL_REJECTED', 'DISPOSAL_APPROVED',
  'PENDING_CONFIRM', 'CONFIRMED', 'TICKET_ISSUED', 'TICKET_APPROVED', 'IN_PROGRESS',
])

const APPROVE_LABEL: Record<string, string> = { SUBMIT: '提交审核', APPROVE: '审核通过', REJECT: '审核驳回' }

function buildStages(d: FlowTimelineDetail): StageNode[] {
  const iso = d.isolationScheme
  const disp = d.disposalScheme
  const ticket = d.ticket
  const cancelled = d.status === 'CANCELLED'
  const schemeSubs = (
    scheme: FlowTimelineDetail['isolationScheme'],
    bizType: string,
    kindLabel: string
  ): SubEvent[] => {
    if (!scheme) return []
    const records = d.approvals.filter((a) => a.bizType === bizType)
    const subs: SubEvent[] = records.map((a) => ({
      key: `${bizType}-${a.id}`,
      label: `${APPROVE_LABEL[a.action] ?? a.action} · ${kindLabel}${a.bizCode ? ` ${a.bizCode}` : ''}`,
      time: a.createdAt,
      actor: a.operator,
      tone: a.action === 'APPROVE' ? 'ok' : a.action === 'REJECT' ? 'bad' : 'muted',
      ...(a.comment ? {} : {}),
    }))
    return subs
  }

  const isoDone = !!iso && iso.status === 'APPROVED'
  const dispDone = !!disp && disp.status === 'APPROVED'
  const confirmDone = !!d.disposalConfirmation
  const ticketApproved = !!ticket && ['APPROVED', 'IN_PROGRESS', 'FINISHED', 'CLOSED'].includes(ticket.status)
  const ticketFinished = !!ticket && ['FINISHED', 'CLOSED'].includes(ticket.status)
  const ticketClosed = !!ticket && ticket.status === 'CLOSED'
  const acceptDone = !!d.acceptance && d.acceptance.conclusion === 'PASS'

  const stages: Omit<StageNode, 'done' | 'active'>[] = [
    {
      key: 'req', label: '作业需求受理', icon: ClipboardList,
      doneAt: d.createdAt, actor: d.applicantName, note: null,
      activeStates: ['DRAFT', 'PENDING_SURVEY'],
      subEvents: [],
    },
    {
      key: 'survey', label: '现场勘察', icon: MapPin,
      doneAt: d.survey?.surveyDate ?? null, actor: d.survey?.surveyor ?? null,
      note: d.survey ? (d.survey.isSafe ? '确认具备作业条件' : '现场暂不具备作业条件') : null,
      activeStates: ['SURVEYED'],
      subEvents: [],
    },
    {
      key: 'jsa', label: 'JSA 安全分析', icon: FileText,
      doneAt: d.jsa?.analysisDate ?? null, actor: d.jsa?.leader ?? null,
      note: d.jsa ? `风险等级 ${d.jsa.riskLevel}` : null,
      activeStates: ['JSA_DONE'],
      subEvents: [],
    },
    {
      key: 'iso', label: '隔离方案编制与审核', icon: ShieldCheck,
      doneAt: isoDone ? iso?.reviewedAt ?? null : null,
      actor: isoDone ? (iso?.reviewedBy || iso?.preparedBy) : (iso?.preparedBy ?? null),
      note: iso ? `${iso.code} · ${iso.points?.length ?? 0} 个隔离点` : null,
      activeStates: ['ISOLATION_PREPARING', 'ISOLATION_PENDING_REVIEW', 'ISOLATION_REJECTED'],
      subEvents: schemeSubs(iso, 'ISOLATION', '隔离方案'),
    },
    {
      key: 'disp', label: '工艺处置方案编制与审核', icon: FileText,
      doneAt: dispDone ? disp?.reviewedAt ?? null : null,
      actor: dispDone ? (disp?.reviewedBy || disp?.preparedBy) : (disp?.preparedBy ?? null),
      note: disp ? `${disp.code}` : null,
      activeStates: ['DISPOSAL_PREPARING', 'DISPOSAL_PENDING_REVIEW', 'DISPOSAL_REJECTED'],
      subEvents: schemeSubs(disp, 'DISPOSAL', '处置方案'),
    },
    {
      key: 'confirm', label: '工艺处置确认', icon: Stamp,
      doneAt: confirmDone ? d.disposalConfirmation?.confirmedAt ?? null : null,
      actor: d.disposalConfirmation?.confirmer ?? null,
      note: d.disposalConfirmation ? (d.disposalConfirmation.result === 'QUALIFIED' ? '气体检测合格，具备作业条件' : '检测结果不合格') : null,
      activeStates: ['PENDING_CONFIRM'],
      subEvents: [],
    },
    {
      key: 'ticket', label: '作业票签发与批准', icon: TicketIcon,
      doneAt: ticketApproved ? ticket?.approvedAt ?? null : null,
      actor: ticketApproved ? (ticket?.approvedBy || ticket?.issuer) : (ticket?.issuer ?? null),
      note: ticket ? `${ticket.code}` : null,
      activeStates: ['CONFIRMED', 'TICKET_ISSUED'],
      subEvents: [
        ...(ticket ? [{ key: 'tk-issue', label: `签发作业票${ticket.code ? ` ${ticket.code}` : ''}`, time: ticket.createdAt, actor: ticket.issuer, tone: 'muted' as const }] : []),
        ...d.approvals.filter((a) => a.bizType === 'TICKET').map((a) => ({
          key: `tk-${a.id}`,
          label: `${APPROVE_LABEL[a.action] ?? a.action} · 作业票${a.bizCode ? ` ${a.bizCode}` : ''}`,
          time: a.createdAt,
          actor: a.operator,
          tone: (a.action === 'APPROVE' ? 'ok' : a.action === 'REJECT' ? 'bad' : 'muted') as SubEvent['tone'],
        })),
      ],
    },
    {
      key: 'exec', label: '现场作业执行', icon: Hammer,
      doneAt: ticketFinished ? ticket?.finishedAt ?? null : null,
      actor: null,
      note: iso?.points?.length
        ? `隔离点 ${iso.points.filter((p) => p.done).length}/${iso.points.length} 已执行`
        : null,
      activeStates: ['TICKET_APPROVED', 'IN_PROGRESS'],
      subEvents: [
        ...(ticket?.startedAt ? [{ key: 'tk-start', label: '开始作业', time: ticket.startedAt, tone: 'ok' as const }] : []),
        ...(ticketClosed ? [{ key: 'tk-close', label: '作业票关闭', time: ticket.closedAt, tone: 'ok' as const }] : []),
      ],
    },
    {
      key: 'accept', label: '作业验收', icon: CheckCircle2,
      doneAt: acceptDone ? d.acceptance?.acceptedAt ?? null : null,
      actor: d.acceptance?.acceptor ?? null,
      note: d.acceptance
        ? (acceptDone
          ? '三项检查全部通过，流程闭环'
          : `整改后复验${d.acceptance.problems ? `：${d.acceptance.problems}` : ''}`)
        : null,
      activeStates: ['PENDING_ACCEPTANCE'],
      subEvents: [],
    },
  ]

  return stages.map((s) => {
    const done = !!s.doneAt && !cancelled || !!s.doneAt
    const active = !cancelled && !done && (s.activeStates.includes(d.status) || (!done && s.activeStates.length > 0 && isActiveStage(d.status, s.key)))
    return { ...s, done, active }
  })
}

/** 状态 → 环节 key（比 activeStates 更精确的“当前停留”判定） */
function isActiveStage(status: string, key: string): boolean {
  const map: Record<string, string> = {
    DRAFT: 'req', PENDING_SURVEY: 'survey', SURVEYED: 'jsa', JSA_DONE: 'iso',
    ISOLATION_PREPARING: 'iso', ISOLATION_PENDING_REVIEW: 'iso', ISOLATION_REJECTED: 'iso', ISOLATION_APPROVED: 'disp',
    DISPOSAL_PREPARING: 'disp', DISPOSAL_PENDING_REVIEW: 'disp', DISPOSAL_REJECTED: 'disp', DISPOSAL_APPROVED: 'confirm',
    PENDING_CONFIRM: 'confirm', CONFIRMED: 'ticket', TICKET_ISSUED: 'ticket',
    TICKET_APPROVED: 'exec', IN_PROGRESS: 'exec',
    PENDING_ACCEPTANCE: 'accept',
  }
  return map[status] === key
}

const TONE_CLASS: Record<SubEvent['tone'], { dot: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-700' },
  bad: { dot: 'bg-rose-500', text: 'text-rose-700' },
  muted: { dot: 'bg-stone-400', text: 'text-stone-600' },
}

export default function FlowTimeline({ detail }: { detail: FlowTimelineDetail }) {
  const stages = buildStages(detail)
  const cancelled = detail.status === 'CANCELLED'
  const completedCount = stages.filter((s) => s.done).length

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', cancelled ? 'bg-stone-200 text-stone-500' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')}>
          {cancelled ? '流程已终止' : `${completedCount}/${stages.length} 环节完成`}
        </span>
        {!cancelled && completedCount < stages.length && (
          <span className="text-[11px] text-stone-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            当前停留在「{stages.find((s) => s.active)?.label ?? '—'}」
          </span>
        )}
        {cancelled && <span className="text-[11px] text-stone-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />已取消的需求不再流转</span>}
      </div>

      <div className="relative">
        {stages.map((s, i) => {
          const Icon = s.icon
          const isLast = i === stages.length - 1
          const state: NodeState = s.done ? 'done' : s.active ? 'active' : 'pending'
          return (
            <div key={s.key} className="relative flex gap-3 bp-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
              {/* 左侧轨道 */}
              <div className="flex flex-col items-center shrink-0">
                <div className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors',
                  state === 'done' && 'bg-emerald-600 border-emerald-600 text-white',
                  state === 'active' && 'bg-white border-emerald-500 text-emerald-600 ring-4 ring-emerald-100',
                  state === 'pending' && 'bg-stone-100 border-stone-200 text-stone-300',
                )}>
                  {state === 'done' ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                  {state === 'active' && <span className="absolute w-7 h-7 rounded-full bp-pulse-ring" />}
                </div>
                {!isLast && (
                  <div className={cn('w-0.5 flex-1 min-h-[26px] my-0.5 rounded-full', s.done ? 'bg-emerald-300' : 'bg-stone-200')} />
                )}
              </div>

              {/* 右侧内容 */}
              <div className={cn('flex-1 min-w-0 pb-4', isLast && 'pb-1')}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('text-[13px] font-medium',
                    state === 'done' ? 'text-stone-800' : state === 'active' ? 'text-emerald-800' : 'text-stone-400')}>
                    {s.label}
                  </span>
                  {state === 'active' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white font-medium">进行中</span>
                  )}
                  {state === 'pending' && <span className="text-[10px] text-stone-300 flex items-center gap-0.5"><Clock className="w-3 h-3" />未开始</span>}
                  {s.doneAt && <span className="text-[11px] text-stone-400 font-mono">{fmtDateTime(s.doneAt)}</span>}
                  {s.actor && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 border border-stone-200">
                      {s.actor}
                    </span>
                  )}
                </div>
                {s.note && <div className="text-[11px] text-stone-500 mt-0.5">{s.note}</div>}

                {/* 子事件（审批留痕 / 票生命周期） */}
                {s.subEvents.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {s.subEvents.map((e) => {
                      const tone = TONE_CLASS[e.tone]
                      return (
                        <div key={e.key} className="flex items-center gap-1.5 text-[11px] rounded-md bg-stone-50 border border-stone-100 px-2 py-1 w-fit max-w-full">
                          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', tone.dot)} />
                          <span className={cn('font-medium', tone.text)}>{e.label}</span>
                          {e.actor && <span className="text-stone-400">· {e.actor}</span>}
                          {e.time && <span className="text-stone-400 font-mono ml-1">{fmtDateTime(e.time)}</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部小结 */}
      {!cancelled && completedCount === stages.length && (
        <div className="mt-1 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 flex items-center gap-2 bp-fade-up">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span className="text-xs text-emerald-800 font-medium">全流程已闭环</span>
          <span className="text-[11px] text-emerald-600">
            {detail.acceptance ? `验收通过于 ${fmtDate(detail.acceptance.acceptedAt)}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}

/** 时间线区头（供详情页复用样式） */
export function FlowTimelineCardHeader() {
  return (
    <div className="flex items-center gap-2">
      <History className="w-4 h-4 text-emerald-700" />
      <span className="text-sm font-semibold">流程时间线</span>
    </div>
  )
}

export const _IN_FLIGHT = IN_FLIGHT
