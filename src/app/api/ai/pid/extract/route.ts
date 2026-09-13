import { NextRequest, NextResponse } from 'next/server'
import { bpVisionComplete, extractJson } from '@/lib/bp-ai'
import { jsonError, readBody, str } from '@/lib/bp-server-utils'

export const dynamic = 'force-dynamic'

/** 设备类型白名单（与 bp-types EQUIP_TYPE_MAP 一致） */
const EQUIP_TYPES = ['COLUMN', 'REACTOR', 'EXCHANGER', 'FURNACE', 'PUMP', 'COMPRESSOR', 'TANK', 'VESSEL', 'OTHER']

/** 常见中文/别名设备类型 → 白名单映射（VLM 输出兜底归一） */
const TYPE_ALIAS: Record<string, string> = {
  塔: 'COLUMN', 塔器: 'COLUMN', 精馏塔: 'COLUMN', 常压塔: 'COLUMN', 减压塔: 'COLUMN',
  反应器: 'REACTOR', 反应釜: 'REACTOR',
  换热器: 'EXCHANGER', 换热: 'EXCHANGER', 冷却器: 'EXCHANGER', 加热器: 'EXCHANGER', 再沸器: 'EXCHANGER',
  炉: 'FURNACE', 加热炉: 'FURNACE',
  泵: 'PUMP', 离心泵: 'PUMP', 屏蔽泵: 'PUMP', 齿轮泵: 'PUMP',
  压缩机: 'COMPRESSOR', 风机: 'COMPRESSOR',
  罐: 'TANK', 储罐: 'TANK', 球罐: 'TANK',
  容器: 'VESSEL', 分液罐: 'VESSEL', 回流罐: 'VESSEL', 缓冲罐: 'VESSEL', 气液分离器: 'VESSEL', 分离器: 'VESSEL',
}

const LIMITS = { equipments: 24, pipelines: 30, isoPoints: 24, inlineSymbols: 24 } as const

const SYSTEM_PROMPT = `你是石化工艺 PID（管道仪表流程图）图纸识别专家。请仔细读图，提取图纸中的设备、管线连接关系与隔离点信息，输出严格的 JSON 对象（不要输出任何 JSON 以外的文字）。

输出格式：
{
  "diagramName": "图纸标题/图名（图签或顶部标题，读不到给空字符串）",
  "unitName": "装置/车间名称（图签中，读不到给空字符串）",
  "equipments": [{ "code": "设备位号(如 T-101/P-201/E-301/V-101，必须照图原样)", "name": "设备中文名称(读不到给空字符串)", "type": "设备类型", "x": 12.5, "y": 30, "w": 6, "h": 18 }],
  "pipelines": [{ "code": "管线号(图上管线标注，如 PL-101/PG-0101，照图原样；该管线上没有编号标注时给空字符串)", "name": "管线名称(读不到给空字符串)", "medium": "管内介质(图上标注，读不到给空字符串)", "spec": "管径规格(如 DN200，读不到给空字符串)", "fromEquipment": "起点设备位号(必须与 equipments 中某设备位号一致)", "toEquipment": "终点设备位号(同上)" }],
  "isoPoints": [{ "code": "隔离点编号(图上盲板/隔离点标注，没有编号给空字符串)", "name": "隔离点名称/位置描述(如 泵出口法兰)", "pipelineCode": "所属管线号(必须与 pipelines 中某管线号一致，不确定给空字符串)", "location": "具体位置描述(读不到给空字符串)" }],
  "inlineSymbols": [{ "kind": "valve|fitting|instrument|pump", "pipelineCode": "符号所在管线号(必须与 pipelines 中某管线号一致，不确定给空字符串)", "x": 45.5, "y": 30, "label": "符号旁标注文字(读不到给空字符串)" }]
}

设备 type 只能从以下枚举选择：COLUMN(塔器) | REACTOR(反应器) | EXCHANGER(换热器) | FURNACE(加热炉) | PUMP(泵) | COMPRESSOR(压缩机) | TANK(储罐) | VESSEL(容器/回流罐/分液罐) | OTHER(其他)。

位置与尺寸（导入后按原图排版的关键依据，必须给出）：
- x/y = 设备符号中心点的归一化坐标：x 向右、y 向下，均为 0~100 的数（相对整图宽高的百分比）。左上角 (0,0)，右下角 (100,100)。例：塔在图面左上方则 x≈12, y≈30；
- w/h = 设备符号本身占整图宽/高的百分比（0~100 的数）。例：一座塔高约图高 1/5 则 h≈20，宽约图宽 1/16 则 w≈6；
- 按图面实际位置与大小估计，允许误差，但同一图内多台设备的相对位置关系（谁在左/右/上/下）必须准确。

管线追踪（最重要的职责，必须逐条执行）：
1. 图上设备之间的每一条连接线（粗实线、细实线、虚线、带箭头线）都是一条管线，必须逐条输出为 pipelines 记录；没有管线号标注的管线也要输出（code 给空字符串），严禁只输出有编号的管线；
2. fromEquipment/toEquipment 是后续自动画连线的唯一依据：请沿着每条管线的线条走向追踪两端连接到哪台设备（就近的设备位号）；箭头指向的一端是 toEquipment，另一端是 fromEquipment；无箭头时按工艺常识判断（如泵排出→换热器→塔进料）；
3. 只要线条在图上连续可见，就必须给出 fromEquipment/toEquipment；仅当线条在图上中断/被遮挡无法追踪时才给空字符串；
4. 文字信息（管线号/介质/规格）看不清时给空字符串即可，但连接关系必须尽力给全。

管线内联符号识别（导入后会自动挂接到所在管线上并断开管线）：
1. 画在管线线条上的串联符号必须逐个识别为 inlineSymbols：kind 枚举 valve(阀门：闸阀/截止阀/球阀/止回阀/调节阀/安全阀等) | fitting(管件：法兰/三通/过滤器/视镜/膨胀节/盲板等) | instrument(在线仪表：流量计/压力表/温度计/液位计等圆圈符号) | pump(画在管线上的小型管道泵符号)；
2. pipelineCode = 该符号所在的管线号（沿线条就近归属）；x/y = 符号中心归一化坐标（同设备规则，必须给出）；
3. 大型独立设备（有壳体尺寸的泵/压缩机等，由管线连接而非串在管线上）不属内联符号，仍输出到 equipments；

识别纪律（必须遵守）：
1. 只提取图上真实可见的信息，严禁编造或推测不存在的位号；看不清的字段给空字符串；
2. 位号(code)照图原样抄写，不要改写除大小写以外的内容；
3. 图上没有隔离点/盲板标注时 isoPoints 给空数组；
4. 设备一般 4~20 台、管线 3~25 条，超出时优先保留主要工艺设备与主线；输出前自查：每台设备至少有一条管线与之相连（除非它确实是孤立设备）；每台设备的 x/y/w/h 均为数字，禁止字符串、禁止缺省；
5. 管线追踪优先于一切速度考量：宁可输出慢、不可漏管线；严禁为减少输出量而省略任何可见管线。`

// ============ 异步任务存储（识别任务化，治本解决外层代理埋断 30s+ 长请求导致的 502） ============
// POST 只负责提交任务并秒回 taskId，LLM 调用在后台 fire-and-forget；前端 GET 轮询结果。
// 所有 HTTP 请求都短平快（毫秒级），不再受任何中间代理/网关超时限制。
// 存储挂 globalThis 跨 dev HMR 存活；进程重启即清空 → 轮询得 404，前端提示重新上传。

interface ExtractTask {
  id: string
  status: 'running' | 'done' | 'error'
  createdAt: number
  result?: ReturnType<typeof normalizeResult>
  error?: string
}

const TASK_TTL_MS = 15 * 60_000
const TASK_MAX = 40

function taskStore(): Map<string, ExtractTask> {
  const g = globalThis as unknown as { __pidExtractTasks?: Map<string, ExtractTask> }
  if (!g.__pidExtractTasks) g.__pidExtractTasks = new Map()
  return g.__pidExtractTasks
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

/** 后台执行识别：全部异常都写进任务状态，绝不静默丢任务 */
async function runTask(id: string, imageDataUrl: string) {
  const task = taskStore().get(id)
  if (!task) return
  try {
    const text = await bpVisionComplete(SYSTEM_PROMPT, imageDataUrl)
    const raw = extractJson<Record<string, unknown>>(text)
    if (!raw || typeof raw !== 'object') {
      task.status = 'error'
      task.error = 'AI 未能从图纸解析出结构化结果，请上传更清晰的图纸后重试'
      return
    }
    const result = normalizeResult(raw)
    if (result.equipments.length === 0) {
      task.status = 'error'
      task.error = '未识别出任何设备位号——请确认图片为 PID 图纸且位号文字清晰可辨'
      return
    }
    task.status = 'done'
    task.result = result
  } catch (e) {
    task.status = 'error'
    task.error = e instanceof Error ? e.message : 'PID 图纸识别失败'
  }
}

/** 清洗位号/编码：去首尾空白与换行，截断 40 字 */
function cleanCode(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[\r\n]+/g, ' ').trim().slice(0, 40) : ''
}

/** 归一化坐标清洗：接受数字或数字字符串，clamp 0~100，无效置 null */
function normPos(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null
}

/** 归一化尺寸清洗：同 normPos，另要求 > 0（0/负值视为未识别） */
function normSize(v: unknown): number | null {
  const n = normPos(v)
  return n !== null && n > 0 ? n : null
}

/** 设备类型归一：大写 → 别名映射 → 白名单校验 → OTHER */
function normType(s: unknown): string {
  const v = cleanCode(s)
  if (!v) return 'OTHER'
  const up = v.toUpperCase()
  if (EQUIP_TYPES.includes(up)) return up
  if (TYPE_ALIAS[v]) return TYPE_ALIAS[v]
  // 包含关键词匹配（如 "常压塔T101"）
  for (const [k, t] of Object.entries(TYPE_ALIAS)) {
    if (v.includes(k)) return t
  }
  return 'OTHER'
}

interface RawItem { [k: string]: unknown }

/** 提取 + 归一化 + 防幻觉清洗（不在集合内的引用一律置空） */
function normalizeResult(raw: Record<string, unknown>) {
  const diagramName = cleanCode(raw.diagramName).slice(0, 60)
  const unitName = cleanCode(raw.unitName).slice(0, 60)

  // 设备：按 code 去重；坐标/尺寸归一化清洗（0~100 数值，无效置 null → 布局器回退网格）
  const equipments: { code: string; name: string; type: string; x: number | null; y: number | null; w: number | null; h: number | null }[] = []
  const seenEq = new Set<string>()
  for (const item of Array.isArray(raw.equipments) ? (raw.equipments as RawItem[]) : []) {
    const code = cleanCode(item.code)
    if (!code || seenEq.has(code)) continue
    seenEq.add(code)
    equipments.push({
      code,
      name: cleanCode(item.name).slice(0, 60),
      type: normType(item.type),
      x: normPos(item.x),
      y: normPos(item.y),
      w: normSize(item.w),
      h: normSize(item.h),
    })
    if (equipments.length >= LIMITS.equipments) break
  }

  // 管线：按 code 去重；from/to 必须在设备位号集合内；无编号管线自动占位（AUTO-P01…，预览可改）
  const pipelines: { code: string; name: string; medium: string; spec: string; fromEquipment: string; toEquipment: string }[] = []
  const seenPipe = new Set<string>()
  let autoPipeIdx = 0
  for (const item of Array.isArray(raw.pipelines) ? (raw.pipelines as RawItem[]) : []) {
    const code = cleanCode(item.code) || `AUTO-P${String(++autoPipeIdx).padStart(2, '0')}`
    if (seenPipe.has(code)) continue
    const from = cleanCode(item.fromEquipment)
    const to = cleanCode(item.toEquipment)
    seenPipe.add(code)
    pipelines.push({
      code,
      name: cleanCode(item.name).slice(0, 60),
      medium: cleanCode(item.medium).slice(0, 30),
      spec: cleanCode(item.spec).slice(0, 30),
      fromEquipment: seenEq.has(from) ? from : '',
      toEquipment: seenEq.has(to) && to !== from ? to : '',
    })
    if (pipelines.length >= LIMITS.pipelines) break
  }

  // 隔离点：按 code 去重（code 允许为空但去重时给占位）；pipelineCode 必须在管线集合内
  const isoPoints: { code: string; name: string; pipelineCode: string; location: string }[] = []
  const seenPoint = new Set<string>()
  for (const item of Array.isArray(raw.isoPoints) ? (raw.isoPoints as RawItem[]) : []) {
    const code = cleanCode(item.code)
    const name = cleanCode(item.name).slice(0, 60)
    if (!code && !name) continue
    const key = code || `__${name}`
    if (seenPoint.has(key)) continue
    const pc = cleanCode(item.pipelineCode)
    seenPoint.add(key)
    isoPoints.push({
      code,
      name,
      pipelineCode: seenPipe.has(pc) ? pc : '',
      location: cleanCode(item.location).slice(0, 60),
    })
    if (isoPoints.length >= LIMITS.isoPoints) break
  }

  return { diagramName, unitName, equipments, pipelines, isoPoints, inlineSymbols: normInline(raw, seenPipe) }
}

/** 内联符号清洗（管线上的阀门/管件/仪表/泵）：kind 白名单 + pipelineCode 防幻觉 + 位置归一化 */
const INLINE_KINDS = ['valve', 'fitting', 'instrument', 'pump'] as const
function normInline(raw: Record<string, unknown>, seenPipe: Set<string>) {
  const inlineSymbols: { kind: string; pipelineCode: string; x: number | null; y: number | null; label: string }[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw.inlineSymbols) ? (raw.inlineSymbols as RawItem[]) : []) {
    const kind = cleanCode(item.kind)
    if (!(INLINE_KINDS as readonly string[]).includes(kind)) continue
    const x = normPos(item.x)
    const y = normPos(item.y)
    const key = `${kind}@${Math.round(x ?? -1)},${Math.round(y ?? -1)}`
    if (seen.has(key)) continue
    seen.add(key)
    const pc = cleanCode(item.pipelineCode)
    inlineSymbols.push({
      kind,
      pipelineCode: seenPipe.has(pc) ? pc : '',
      x,
      y,
      label: cleanCode(item.label).slice(0, 30),
    })
    if (inlineSymbols.length >= LIMITS.inlineSymbols) break
  }
  return inlineSymbols
}

/**
 * POST /api/ai/pid/extract — 提交 VLM 识别任务（秒回 taskId，不等待 LLM）
 * body: { imageBase64: string(dataURL 或裸 base64), mimeType? }
 * → { taskId }
 * 背景：LLM 识别耗时 20~120s 且波动大，同步等待会被外层代理/网关探断返回 502；
 * 改为异步任务后所有请求都是短请求，前端轮询 GET ?taskId= 拿结果。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req)
    let img = str(body.imageBase64)
    if (!img) return jsonError('缺少图片数据（imageBase64）')

    // 兼容 dataURL 前缀
    let mimeType = str(body.mimeType) || 'image/png'
    const m = /^data:(image\/[a-z+]+);base64,([\s\S]+)$/i.exec(img)
    if (m) {
      mimeType = m[1].toLowerCase()
      img = m[2]
    }
    if (!/^image\/(png|jpeg|jpg|webp|gif|bmp)$/.test(mimeType)) mimeType = 'image/png'
    if (img.length > 11_000_000) return jsonError('图片过大，请压缩到 8MB 以内后重试', 413)

    gcTasks()
    const id = crypto.randomUUID()
    taskStore().set(id, { id, status: 'running', createdAt: Date.now() })

    // fire-and-forget：响应已返回，LLM 调用在后台继续（Node 进程存活期间不受 route 生命周期影响）
    void runTask(id, `data:${mimeType};base64,${img}`)

    return NextResponse.json({ taskId: id })
  } catch (e) {
    console.error('[POST /api/ai/pid/extract]', e)
    return jsonError(e instanceof Error ? e.message : 'PID 图纸识别任务提交失败', 500)
  }
}

/**
 * GET /api/ai/pid/extract?taskId=xxx — 轮询识别任务结果
 * → running: { status: 'running' } | done: { status: 'done', result } | error: { status: 'error', error }
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('taskId') || ''
  const task = taskStore().get(id)
  if (!task) {
    return jsonError('识别任务不存在或已过期（服务可能已重启），请重新上传识别', 404)
  }
  if (task.status === 'running') return NextResponse.json({ status: 'running' })
  if (task.status === 'error') return NextResponse.json({ status: 'error', error: task.error })
  return NextResponse.json({ status: 'done', result: task.result })
}
