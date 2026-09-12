// 盲板管理系统 - 共享类型与值映射

export interface BpUser {
  id: string
  username: string
  name: string
  role: string
  department?: string | null
  phone?: string | null
  active?: boolean
  password?: string
}

/** 模块组件统一 Props */
export interface ModuleProps {
  currentUser: BpUser
  /** 侧边栏子菜单跳转时指定的初始页签 */
  initialTab?: string
  /** 跳转辅助: 例如打开某需求详情 */
  focusId?: number
  /** 跨模块导航（看板待办/审批中心联动等），key 为模块 key，tab 为子页签；focusId 可选携带，用于打开对应记录详情 */
  onNavigate?: (key: string, tab?: string, focusId?: number) => void
}

// ============ 角色 ============
export const ROLE_MAP: Record<string, { label: string; className: string }> = {
  ADMIN: { label: '系统管理员', className: 'bg-stone-100 text-stone-700 border-stone-200' },
  MANAGER: { label: '分管领导', className: 'bg-violet-100 text-violet-700 border-violet-200' },
  ENGINEER: { label: '工艺工程师', className: 'bg-teal-100 text-teal-700 border-teal-200' },
  REVIEWER: { label: '方案审核人', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  OPERATOR: { label: '作业人员', className: 'bg-lime-100 text-lime-700 border-lime-200' },
  GUARDIAN: { label: '监护人', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  ACCEPTOR: { label: '验收人', className: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' },
}

// ============ 作业需求状态机 ============
export const STATUS_MAP: Record<string, { label: string; className: string; dot: string }> = {
  DRAFT: { label: '草稿', className: 'bg-stone-100 text-stone-700 border-stone-200', dot: 'bg-stone-400' },
  PENDING_SURVEY: { label: '待现场勘察', className: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  SURVEYED: { label: '已勘察待JSA', className: 'bg-lime-100 text-lime-800 border-lime-200', dot: 'bg-lime-500' },
  JSA_DONE: { label: 'JSA完成待方案', className: 'bg-teal-100 text-teal-800 border-teal-200', dot: 'bg-teal-500' },
  ISOLATION_PREPARING: { label: '隔离方案编制中', className: 'bg-violet-100 text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  ISOLATION_PENDING_REVIEW: { label: '隔离方案待审核', className: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
  ISOLATION_REJECTED: { label: '隔离方案已驳回', className: 'bg-rose-100 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  ISOLATION_APPROVED: { label: '隔离方案已审核', className: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  DISPOSAL_PREPARING: { label: '处置方案编制中', className: 'bg-violet-100 text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  DISPOSAL_PENDING_REVIEW: { label: '处置方案待审核', className: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
  DISPOSAL_REJECTED: { label: '处置方案已驳回', className: 'bg-rose-100 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  DISPOSAL_APPROVED: { label: '处置方案已审核', className: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  PENDING_CONFIRM: { label: '待工艺处置确认', className: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200', dot: 'bg-fuchsia-500' },
  CONFIRMED: { label: '处置确认·待开票', className: 'bg-teal-100 text-teal-800 border-teal-200', dot: 'bg-teal-600' },
  TICKET_ISSUED: { label: '作业票待批准', className: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  TICKET_APPROVED: { label: '作业票已批准', className: 'bg-lime-100 text-lime-800 border-lime-200', dot: 'bg-lime-600' },
  IN_PROGRESS: { label: '作业中', className: 'bg-violet-600 text-white border-violet-600', dot: 'bg-violet-600' },
  PENDING_ACCEPTANCE: { label: '待验收', className: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-600' },
  COMPLETED: { label: '已完成', className: 'bg-emerald-600 text-white border-emerald-600', dot: 'bg-emerald-600' },
  CANCELLED: { label: '已取消', className: 'bg-stone-200 text-stone-500 border-stone-300', dot: 'bg-stone-400' },
}

/** 流程主环节(进度条) */
export const FLOW_STEPS: { key: string; label: string; states: string[] }[] = [
  { key: 'req', label: '作业需求', states: ['DRAFT', 'PENDING_SURVEY'] },
  { key: 'survey', label: '现场勘察', states: ['SURVEYED'] },
  { key: 'jsa', label: 'JSA分析', states: ['JSA_DONE'] },
  { key: 'iso', label: '隔离方案', states: ['ISOLATION_PREPARING', 'ISOLATION_PENDING_REVIEW', 'ISOLATION_REJECTED', 'ISOLATION_APPROVED'] },
  { key: 'disp', label: '工艺处置', states: ['DISPOSAL_PREPARING', 'DISPOSAL_PENDING_REVIEW', 'DISPOSAL_REJECTED', 'DISPOSAL_APPROVED', 'PENDING_CONFIRM', 'CONFIRMED'] },
  { key: 'ticket', label: '作业票', states: ['TICKET_ISSUED', 'TICKET_APPROVED'] },
  { key: 'exec', label: '作业执行', states: ['IN_PROGRESS'] },
  { key: 'accept', label: '作业验收', states: ['PENDING_ACCEPTANCE'] },
]

export function flowStepIndex(status: string): number {
  if (status === 'COMPLETED') return FLOW_STEPS.length
  if (status === 'CANCELLED') return -1
  const idx = FLOW_STEPS.findIndex((s) => s.states.includes(status))
  return idx < 0 ? 0 : idx
}

// ============ 盲板 ============
export const PLATE_STATUS_MAP: Record<string, { label: string; className: string }> = {
  IN_STOCK: { label: '在库', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  RESERVED: { label: '已预留', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  INSTALLED: { label: '已安装', className: 'bg-violet-100 text-violet-800 border-violet-200' },
  SCRAPPED: { label: '已报废', className: 'bg-stone-200 text-stone-500 border-stone-300' },
}

export const WORK_TYPE_MAP: Record<string, string> = {
  ADD: '装盲板',
  REMOVE: '抽盲板',
  BOTH: '抽装盲板',
}

export const URGENCY_MAP: Record<string, { label: string; className: string }> = {
  LOW: { label: '低', className: 'bg-stone-100 text-stone-600 border-stone-200' },
  MEDIUM: { label: '中', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  HIGH: { label: '高', className: 'bg-rose-100 text-rose-700 border-rose-200' },
}

export const POINT_ACTION_MAP: Record<string, string> = { ADD: '加装盲板', REMOVE: '拆除盲板' }
export const CHANGE_ACTION_MAP: Record<string, string> = {
  RESERVE: '预留领用',
  INSTALL: '安装',
  REMOVE: '拆除',
  RETURN: '归还入库',
  SCRAP: '报废',
  PURCHASE: '采购入库',
}

// ============ 方案 / 票 / 任务 ============
export const SCHEME_STATUS_MAP: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '草稿', className: 'bg-stone-100 text-stone-700 border-stone-200' },
  PENDING_REVIEW: { label: '待审核', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  APPROVED: { label: '已审核', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  REJECTED: { label: '已驳回', className: 'bg-rose-100 text-rose-700 border-rose-200' },
}

export const DISPOSAL_METHOD_MAP: Record<string, string> = {
  VENT: '泄压降压',
  DRAIN: '排净',
  REPLACE: '置换',
  PURGE: '吹扫',
  STEAM: '蒸煮',
  GAS_TEST: '气体检测',
  ISOLATE: '切断加盲板',
  OTHER: '其他',
}

export const TICKET_STATUS_MAP: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '待签发', className: 'bg-stone-100 text-stone-700 border-stone-200' },
  PENDING_REVIEW: { label: '待批准', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  APPROVED: { label: '已批准', className: 'bg-lime-100 text-lime-800 border-lime-200' },
  IN_PROGRESS: { label: '作业中', className: 'bg-violet-600 text-white border-violet-600' },
  FINISHED: { label: '已完工', className: 'bg-teal-100 text-teal-800 border-teal-200' },
  CLOSED: { label: '已关闭', className: 'bg-stone-200 text-stone-500 border-stone-300' },
  VOID: { label: '已作废', className: 'bg-rose-100 text-rose-700 border-rose-200' },
}

export const TASK_STATUS_MAP: Record<string, { label: string; className: string }> = {
  PENDING: { label: '待执行', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  IN_PROGRESS: { label: '执行中', className: 'bg-violet-100 text-violet-800 border-violet-200' },
  DONE: { label: '已完成', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
}

export const APPROVE_ACTION_MAP: Record<string, string> = {
  SUBMIT: '提交审核',
  APPROVE: '审核通过',
  REJECT: '审核驳回',
}

export const CONCLUSION_MAP: Record<string, { label: string; className: string }> = {
  PASS: { label: '验收通过', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  RECTIFY: { label: '整改后复验', className: 'bg-rose-100 text-rose-700 border-rose-200' },
}

/** 九大业务环节(全流程展示用) */
export const BUSINESS_STEPS = [
  '作业需求',
  '现场勘察',
  'JSA分析',
  '隔离方案',
  '工艺处置方案',
  '处置确认',
  '开作业票',
  '作业执行',
  '作业验收',
]

// ============ PID 组态（管线/隔离点主数据联动，Task 23-a） ============

/** PID 画布设备图形 */
export interface PidShape {
  id: string
  type: string // reactor反应器 | exchanger换热器 | column塔器 | pump泵 | tank罐 | valve阀等（前端自定义渲染）
  equipmentId?: number | null // 绑定的设备主数据（保存图后自动回写关联管线起止设备）
  x: number
  y: number
  w: number
  h: number
  label: string
}

/** PID 画布连线 */
export type PidConnDirection = 'forward' | 'reverse' | 'none'

export interface PidConnection {
  id: string
  fromShape: string
  fromAnchor: string // top/right/bottom/left
  toShape: string
  toAnchor: string
  direction?: PidConnDirection // 流向：forward 起点→终点（缺省）/ reverse 终点→起点 / none 无向
  pipelineId?: number | null // 绑定的管线主数据（保存图后按连线起终点自动回写管线起止设备）
  labelT?: number // 管线号标注沿折线的位置参数（0..1 归一化弧长，缺省 0.5 中点；拖动标注时写入，图元移动后按比例跟随）
  midOverride?: number // 中段布线手动覆盖：H-H 路由的 midX / V-V 路由的 midY（拖拽中段写入；缺省自动取两端中点，改接端点后清零重排）
}

/** 设备类型 → 中文名/类型徽章色（base-data 设备管理与 PID 图元绑定共用） */
export const EQUIP_TYPE_MAP: Record<string, { label: string; className: string }> = {
  COLUMN: { label: '塔器', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  REACTOR: { label: '反应器', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  EXCHANGER: { label: '换热器', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  FURNACE: { label: '加热炉', className: 'border-stone-200 bg-stone-100 text-stone-700' },
  PUMP: { label: '泵', className: 'border-teal-200 bg-teal-50 text-teal-700' },
  COMPRESSOR: { label: '压缩机', className: 'border-violet-200 bg-violet-50 text-violet-700' },
  TANK: { label: '储罐', className: 'border-stone-200 bg-stone-50 text-stone-600' },
  VESSEL: { label: '容器', className: 'border-stone-200 bg-stone-50 text-stone-600' },
  OTHER: { label: '其他', className: 'border-stone-200 bg-stone-50 text-stone-500' },
}

/** PID 隔离点挂标（code 关联隔离点主数据 IsoPointMaster.code） */
export interface PidMark {
  id: string
  code: string
  name: string
  x: number
  y: number
  masterPointId?: number | null
}

/** PID 组态内容结构（PidDiagram.content JSON 反序列化结果） */
export interface PidContent {
  shapes: PidShape[]
  connections: PidConnection[]
  marks: PidMark[]
}

/** 安全解析 PID 组态 JSON 字符串（非法/为空时返回空组态，不抛错） */
export function parsePidContent(raw: string | null | undefined): PidContent {
  const empty: PidContent = { shapes: [], connections: [], marks: [] }
  if (!raw) return empty
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object') return empty
    return {
      shapes: Array.isArray(v.shapes) ? v.shapes : [],
      connections: Array.isArray(v.connections) ? v.connections : [],
      marks: Array.isArray(v.marks) ? v.marks : [],
    }
  } catch {
    return empty
  }
}

/** 规范化保存的 PID content：字符串须为合法 JSON 对象 / 对象直接序列化；非法返回 null */
export function normalizePidContent(v: unknown): string | null {
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === 'object' ? v : null
    } catch {
      return null
    }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    try {
      return JSON.stringify(v)
    } catch {
      return null
    }
  }
  return null
}

// ============ PID 挂点六态实时状态 ============

/** 六态：常通/已计划/已审核待执行/作业执行中/盲板已装/盲板已拆 */
export type PidPointState = 'idle' | 'planned' | 'approved' | 'working' | 'blinded' | 'opened'

/** 六态展示映射（label 供 API stateLabel 与前端徽章共用） */
export const PID_POINT_STATE_MAP: Record<PidPointState, { label: string; className: string; dot: string }> = {
  idle: { label: '常通', className: 'bg-stone-100 text-stone-600 border-stone-200', dot: 'bg-stone-400' },
  planned: { label: '已计划', className: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  approved: { label: '已审核待执行', className: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
  working: { label: '作业执行中', className: 'bg-violet-100 text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  blinded: { label: '盲板已装', className: 'bg-rose-100 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  opened: { label: '盲板已拆', className: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
}

/** 处于「已计划」态的作业需求状态集合（隔离方案待审/已审 → 处置 → 确认 → 开票阶段） */
export const PID_PLANNED_REQUEST_STATUSES: readonly string[] = [
  'ISOLATION_PENDING_REVIEW',
  'ISOLATION_APPROVED',
  'DISPOSAL_PREPARING',
  'DISPOSAL_PENDING_REVIEW',
  'DISPOSAL_APPROVED',
  'PENDING_CONFIRM',
  'CONFIRMED',
  'TICKET_ISSUED',
  'TICKET_APPROVED',
]

/**
 * PID 挂点六态判定（按优先级自上而下，服务端 status 接口与前端共用）：
 * 无匹配/未进入计划/已取消/回退 → idle；COMPLETED → opened；IN_PROGRESS → blinded；
 * 隔离方案已审核 → 任务执行中 working，否则 approved；计划环节 → planned
 */
export function resolvePidPointState(
  requestStatus: string | null | undefined,
  schemeStatus: string | null | undefined,
  taskStatus: string | null | undefined
): PidPointState {
  if (!requestStatus) return 'idle'
  if (requestStatus === 'COMPLETED') return 'opened'
  if (requestStatus === 'IN_PROGRESS') return 'blinded'
  if (schemeStatus === 'APPROVED') return taskStatus === 'IN_PROGRESS' ? 'working' : 'approved'
  if (PID_PLANNED_REQUEST_STATUSES.includes(requestStatus)) return 'planned'
  return 'idle'
}

// ============ AI 助手应用入口（回答内嵌直达链接，前端解析 + 后端 prompt 共用一份目录） ============

export interface BpEntryMeta { key: string; label: string; desc: string }

/** 入口目录：key = 模块 key（跳模块）/ 模块:子页签（跳 tab）/ 模块:new|import（跳转后触发动作） */
export const BP_ENTRY_CATALOG: BpEntryMeta[] = [
  { key: 'dashboard', label: '首页看板', desc: '全流程总览、待办提醒与 AI 运行简报' },
  { key: 'approval-center', label: '审批中心', desc: '隔离方案/处置方案/作业票集中审批' },
  { key: 'work-requests', label: '作业需求', desc: '作业需求列表受理' },
  { key: 'work-requests:survey', label: '现场勘察', desc: '勘察工作台（AI 要点清单/起草记录/引用隔离点位）' },
  { key: 'work-requests:jsa', label: 'JSA分析', desc: 'JSA 作业安全分析工作台' },
  { key: 'work-requests:new', label: '新建作业需求', desc: '发起盲板抽堵作业申请（动作）' },
  { key: 'isolation-scheme', label: '隔离方案', desc: '隔离方案编制/审核工作台' },
  { key: 'isolation-scheme:new', label: '新建隔离方案', desc: '发起编制隔离方案（动作）' },
  { key: 'disposal-scheme', label: '工艺处置方案', desc: '工艺处置方案编制/审核工作台' },
  { key: 'disposal-scheme:new', label: '新建工艺处置方案', desc: '发起编制工艺处置方案（动作）' },
  { key: 'ticket-mgmt', label: '开作业票', desc: '盲板抽堵安全作业票签发与批准' },
  { key: 'task-track', label: '作业任务跟踪', desc: '现场作业任务执行与逐点确认' },
  { key: 'ledger:plates', label: '盲板台账', desc: '盲板档案与台账查询' },
  { key: 'blind-status', label: '盲板状态', desc: 'PID 图上隔离点实时通/盲状态查看' },
  { key: 'ledger:records', label: '变动记录', desc: '盲板抽堵变动留痕' },
  { key: 'ledger:inventory', label: '盲板库存', desc: '库存与采购预警' },
  { key: 'pid-config', label: 'PID 组态', desc: 'PID 图绘制与组态编辑' },
  { key: 'pid-config:import', label: 'AI 识别导入 PID', desc: '上传 PID 图纸 AI 识别生成组态图与基础数据（动作）' },
  { key: 'stats', label: '统计分析', desc: '作业量/状态分布/装置排名统计' },
  { key: 'pipeline-master', label: '管线台账', desc: '管线主数据维护' },
  { key: 'equipment-master', label: '设备管理', desc: '设备台账维护' },
  { key: 'iso-point-master', label: '隔离点主数据', desc: '隔离点主数据维护' },
  { key: 'mobile-preview', label: '移动端预览', desc: '移动端核心流程演示' },
]

export type BpEntryResolved =
  | { type: 'module'; key: string }
  | { type: 'tab'; key: string; tab: string }
  | { type: 'action'; key: string; action: string }

/** 解析 AI 回答中的入口 key（白名单校验，目录外返回 null 防幻觉） */
export function resolveEntry(key: string): BpEntryResolved | null {
  if (!key) return null
  const meta = BP_ENTRY_CATALOG.find((e) => e.key === key)
  if (!meta) return null
  const [mod, sub] = key.split(':')
  if (sub) {
    if (sub === 'new' || sub === 'import') return { type: 'action', key: mod, action: sub }
    return { type: 'tab', key: mod, tab: sub }
  }
  return { type: 'module', key: mod }
}

/** 入口动作事件名：模块挂载后监听以响应「新建/导入」类直达动作 */
export function entryActionEventName(moduleKey: string): string {
  return `bp-entry:${moduleKey}`
}

/** AI 助手点击动作类入口时派发事件（先 navigate 再延迟派发，确保目标模块已挂载） */
export function dispatchEntryAction(moduleKey: string, action: string): void {
  window.dispatchEvent(new CustomEvent(entryActionEventName(moduleKey), { detail: { action } }))
}

// ============ 勘察/JSA pointRefs JSON 解析（跨组件共用口径） ============

/** 勘察/JSA 引用的隔离点位（pointRefs JSON 反序列化结构） */
export interface PointRefData { masterPointId: number; code: string; name: string; pipelineName?: string | null; reason?: string }

/** 安全解析 SiteSurvey/JsaAnalysis.pointRefs（JSON 字符串；白名单字段过滤，缺主数据引用的条目丢弃） */
export function parsePointRefsJson(raw?: string | null): PointRefData[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && x.masterPointId != null && !!x.code)
      .map((x) => ({
        masterPointId: Number(x.masterPointId),
        code: String(x.code),
        name: String(x.name ?? ''),
        pipelineName: typeof x.pipelineName === 'string' ? x.pipelineName : null,
      }))
  } catch { return [] }
}
