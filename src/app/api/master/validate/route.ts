import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/bp-server-utils'
import { runFastAudit, type AuditScope, type AuditDepth, type AuditViolation } from '@/lib/bp-master-validation'
import { runDeepReview, applyReviews } from '@/lib/bp-master-validate-ai'
import { saveReportArchive, type AuditReportData } from '@/lib/bp-audit-pdf'

export const dynamic = 'force-dynamic'

function parseScope(raw: unknown): AuditScope {
  if (!raw || typeof raw !== 'object') return { type: 'ALL' }
  const o = raw as Record<string, unknown>
  // 装置 code 含中文/全角字符，只 trim 不做大小写归一（装置匹配靠原始精确比对，见 sliceSnapshotForUnit）
  if (o.type === 'UNIT' && typeof o.code === 'string' && o.code.trim()) return { type: 'UNIT', code: o.code.trim() }
  if (o.type === 'EQUIPMENT' && typeof o.code === 'string' && o.code.trim()) return { type: 'EQUIPMENT', code: o.code.trim().toUpperCase() }
  if (o.type === 'PIPELINE' && typeof o.code === 'string' && o.code.trim()) return { type: 'PIPELINE', code: o.code.trim().toUpperCase() }
  return { type: 'ALL' }
}

// ============ 异步任务存储（体检任务化，治本解决外层代理掐断 30s+ 长请求导致的 502） ============
// 深度档 LLM 语义复核耗时 30~120s 且上游波动大（曾 47s 抛错），同步等待会被代理掐断；
// POST 只提交任务并秒回 taskId，体检在后台执行，前端 GET 轮询结果。
// 纪律（用户拍板）：DEEP 档 AI 复核失败 = 明确报错，不自动降级为纯规则引擎结果——
// 避免出现「名义深度档、实际无 AI 内容」的误导性报告，改跑快速档由用户自己决定。
// 存储挂 globalThis 跨 dev HMR 存活；进程重启即清空 → 轮询得 404，前端提示重试。

interface ValidateTask {
  id: string
  status: 'running' | 'done' | 'error'
  createdAt: number
  report?: AuditReportData
  error?: string
}

const TASK_TTL_MS = 15 * 60_000
const TASK_MAX = 20

function taskStore(): Map<string, ValidateTask> {
  const g = globalThis as unknown as { __masterValidateTasks?: Map<string, ValidateTask> }
  if (!g.__masterValidateTasks) g.__masterValidateTasks = new Map()
  return g.__masterValidateTasks
}

/** 清理过期任务（TTL 15min）与超量任务（保留最近 TASK_MAX 个） */
function gcTasks() {
  const store = taskStore()
  const now = Date.now()
  for (const [id, t] of store) {
    if (now - t.createdAt > TASK_TTL_MS) store.delete(id)
  }
  while (store.size > TASK_MAX) {
    const oldest = [...store.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!oldest) break
    store.delete(oldest.id)
  }
}

/** 后台执行体检：FAST=规则引擎；DEEP=规则引擎+AI 语义复核（AI 失败整体报错，不降级） */
async function runTask(id: string, scope: AuditScope, depth: AuditDepth) {
  const task = taskStore().get(id)
  if (!task) return
  try {
    const t0 = Date.now()
    const fast = await runFastAudit(scope)
    let violations: AuditViolation[] = fast.violations
    if (depth === 'DEEP') {
      // 深度档：复用快速档快照（全量或邻接子图）做 LLM 复核——硬矛盾附注意见（不删除），新发现标疑似
      // 失败不降级：抛错 → task.error 透传真实原因（含 LLM 上游错误详情），由用户决定重试或改快速档
      const deep = await runDeepReview(fast.snapshot, violations)
      violations = [...applyReviews(violations, deep.reviews), ...deep.newFindings]
    }
    const reportId = `AUDIT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).toUpperCase()}`
    const report: AuditReportData = {
      reportId,
      createdAt: new Date().toISOString(),
      scope,
      scopeText: fast.scopeText,
      depth,
      stats: fast.stats,
      summary: {
        error: violations.filter((v) => v.severity === 'ERROR' && !v.aiSuspect).length,
        warning: violations.filter((v) => v.severity === 'WARNING' && !v.aiSuspect).length,
        info: violations.filter((v) => v.severity === 'INFO' && !v.aiSuspect).length,
        aiSuspect: violations.filter((v) => v.aiSuspect).length,
      },
      violations,
      durationMs: Date.now() - t0,
    }
    saveReportArchive(report)
    task.status = 'done'
    task.report = report
  } catch (e) {
    console.error('[validate task]', e)
    task.status = 'error'
    task.error = e instanceof Error ? e.message : '体检执行失败'
  }
}

/**
 * POST /api/master/validate { scope, depth } — 提交体检任务（秒回 taskId，不等待规则引擎/LLM）
 * → { taskId }；结果存档 upload/master-audit/ 在后台任务完成后写入
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const scope = parseScope(body.scope)
    const depth: AuditDepth = body.depth === 'DEEP' ? 'DEEP' : 'FAST'

    gcTasks()
    const id = crypto.randomUUID()
    taskStore().set(id, { id, status: 'running', createdAt: Date.now() })

    // fire-and-forget：响应已返回，体检在后台继续（Node 进程存活期间不受 route 生命周期影响）
    void runTask(id, scope, depth)

    return NextResponse.json({ taskId: id })
  } catch (e) {
    console.error('[POST /api/master/validate]', e)
    return jsonError(e instanceof Error ? e.message : '体检任务提交失败', 500)
  }
}

/**
 * GET /api/master/validate?taskId=xxx — 轮询体检任务结果
 * → running: { status: 'running' } | done: { status: 'done', report } | error: { status: 'error', error }
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('taskId') || ''
  const task = taskStore().get(id)
  if (!task) {
    return jsonError('体检任务不存在或已过期（服务可能已重启），请重新发起体检', 404)
  }
  if (task.status === 'running') return NextResponse.json({ status: 'running' })
  if (task.status === 'error') return NextResponse.json({ status: 'error', error: task.error })
  return NextResponse.json({ status: 'done', report: task.report })
}
