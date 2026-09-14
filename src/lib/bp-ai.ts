// 盲板管理系统 - AI 能力共享库（仅后端使用；z-ai-web-dev-sdk 禁止进入客户端代码）
import ZAI from 'z-ai-web-dev-sdk'
import { BP_ENTRY_CATALOG } from './bp-types'

// ============ 业务知识（system prompt 共享底座） ============
export const BP_BUSINESS_KNOWLEDGE = `【系统背景】这是「石化盲板管理系统」(BPMS)，依据 GB 30871《危险化学品企业特殊作业安全规范》对石化企业盲板抽堵作业进行全流程数字化管控。
【业务流程九环节】作业需求受理 → 现场勘察 → JSA 作业安全分析 → 隔离方案(编制/审核) → 工艺处置方案(编制/审核) → 工艺处置确认 → 开作业票(分管领导批准) → 作业执行(现场逐点抽堵确认) → 作业验收；全程台账留痕。
【角色职责】系统管理员(ADMIN)：全局配置与数据维护；工艺工程师(ENGINEER)：现场勘察、JSA 分析、双方案编制、工艺处置确认；方案审核人(REVIEWER)：审核两案；分管领导(MANAGER)：批准作业票、监督验收；作业人员(OPERATOR)：现场预留/抽堵盲板；监护人(GUARDIAN)：现场安全监护；验收人(ACCEPTOR)：三项检查与验收结论。
【系统模块】首页看板 / 审批中心 / 作业需求(受理、现场勘察、JSA分析) / 方案编制(隔离方案、工艺处置方案) / 作业任务(开作业票、作业任务跟踪) / 台账管理(盲板台账、盲板状态PID图、变动记录、盲板库存、PID组态) / 统计分析 / 基础数据管理(装置、数据字典、管线台账、设备管理、隔离点主数据) / 系统管理 / 移动端预览。
【关键业务概念】
- 隔离点主数据(IsoPointMaster)：按管线维护的标准隔离点位(编码 IP-xxx)，PID 图挂标与业务环节精确引用的基准。
- 隔离方案：确定在哪里加/拆盲板(IsolationPoint：位置/介质/压力/温度/盲板规格/类型/动作ADD加装|REMOVE拆除/预留库存盲板)。
- 工艺处置方案：抽堵前的处理步骤，方法枚举：VENT泄压降压/DRAIN排净/REPLACE置换/PURGE吹扫/STEAM蒸煮/GAS_TEST气体检测/ISOLATE切断加盲板/OTHER其他，每步有处置内容与合格标准。
- JSA 分析：作业步骤-危害因素-控制措施三元组逐项分析，给出综合风险等级(LOW/MEDIUM/HIGH)与剩余风险应急措施。
- 盲板类型常见：8字盲板、插板、垫环等；规格如 DN50/DN100/DN150 等。
- 介质常见：原油、干气、油气、蒸汽、酸性气、氮气、循环水等（介质含易燃易爆有毒特性时必须强调工艺处置与气体检测合格后方可作业）。
- 设备与管线绑定：管线台账维护起点/终点设备（PID 图连线可自动回写）。现场勘察 AI 推举隔离点位时，除需求管线外还会识别作业位置中的设备位号，并纳入其进/出口相连管线上的隔离点候选（设备检修隔离需在设备周边多条管线建立盲板边界）。
【作业票合规要点（GB 30871-2022 强制标准）】①一张盲板抽堵安全作业票只能对应一块盲板的一个作业（一票一板）；②同一盲板的抽、堵作业应分别办理作业票（抽堵分票）；③严禁在同一管道上同时进行两处及以上盲板抽堵作业，多点抽堵应按隔离方案顺序逐个进行。
【管线作业互斥（系统强制校验）】本系统已实施安全硬约束：一条管线同一时间只允许一张「生效中」的盲板作业票（生效中=已开票且未验收完成/未取消，涵盖待批准/已批准/作业中/待验收）。开票、批准、开工三个环节系统自动校验管线占用（含需求直接引用管线与其隔离点主数据所属管线），发现冲突直接拒绝并提示占用方票号与需求；占用在作业票关闭（验收完成）或需求取消后自动释放。目的是防止并发盲板操作引发事故（与 GB 30871「严禁同一管道两处同时抽堵」配套）。用户咨询该规则时：说明规则内容、生效/释放时机、系统在哪三个环节阻断，并建议冲突时协调作业排程或等前票关闭。
【本系统作业票现状说明】系统已严格执行「一票一板」（GB 30871-2022）：每个隔离点独立办理作业票——开票时按隔离方案点位勾选批量生成多张票（每张票只对应一个隔离点的一个盲板作业），逐张审批、逐票开工/完工/关闭；同一盲板的抽、堵作业分别办票；严禁同一管道两处同时抽堵（开工环节按管线顺序互斥，需按隔离方案顺序逐点作业）。用户咨询作业票与隔离点对应关系时：说明一张票只对应一个隔离点的一个盲板作业，多点位隔离方案将拆分为多张票。`

// ============ SDK 单例（进程内复用） ============
type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>
let zaiPromise: Promise<ZaiClient> | null = null
export function getZai(): Promise<ZaiClient> {
  if (!zaiPromise) zaiPromise = ZAI.create().catch((e) => { zaiPromise = null; throw e })
  return zaiPromise
}

// ============ LLM Provider：私有化 OpenAI 兼容网关 / 内置 SDK（双通道，.env 随时切换） ============
/**
 * 通道选择（每次调用实时读 .env，改配置无需改代码；dev 下改 .env 会自动重载）：
 * - LLM_PROVIDER=private  → 强制私有化网关（未配 key 直接报错，不静默回退，避免误判在用哪一方）
 * - LLM_PROVIDER=deepseek → 同 private（历史别名，向后兼容旧配置）
 * - LLM_PROVIDER=builtin  → 强制内置 z-ai-web-dev-sdk（.z-ai-config）
 * - LLM_PROVIDER=auto/未设 → 有 LLM_API_KEY（旧名 DEEPSEEK_API_KEY 亦认）走私有网关，否则内置
 *
 * 私有化网关 = 任意 OpenAI 兼容 /chat/completions 服务（公司自建 vLLM / SGLang / Ollama / DashScope 兼容模式均可）：
 * - LLM_BASE_URL        网关根地址（填到 /v1 这一级，如 http://10.0.0.5:8000/v1）
 * - LLM_API_KEY         鉴权 key（网关无鉴权时填任意非空占位串）
 * - LLM_MODEL           文本模型名（如 qwen3.8-27b）
 * - VLM_MODEL           视觉模型名（未配默认复用 LLM_MODEL；若该模型不支持图像输入需另配 VL 模型）
 * - LLM_ENABLE_THINKING 显式 =false/0/off 时注入 chat_template_kwargs.enable_thinking=false
 *                       （vLLM/SGLang 部署 Qwen3 建议关闭思考链：输出更稳更快、不占 token 预算；
 *                        不设置则不传该字段，保持部署端默认行为；若网关对未知字段报 4xx 请去掉）
 * - LLM_MAX_TOKENS      可选：私有通道 max_tokens 硬上限（部署端上下文较小时防 4xx）
 * 历史兼容：未配新变量时回读 DEEPSEEK_BASE_URL/DEEPSEEK_API_KEY/DEEPSEEK_MODEL/DEEPSEEK_VISION_MODEL。
 * Qwen3 思考链说明：开思考时 vLLM/SGLang 把思考内容放 message.reasoning_content（不占 content），
 * 本层只取 content 天然兼容；若思考耗尽 max_tokens 会得到空 content——下方空响应报错已覆盖该场景。
 */
function privateConfig() {
  const apiKey = (process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim()
  const baseUrl = (process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || '').trim() || 'https://api.deepseek.com'
  const model = (process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || '').trim() || 'deepseek-chat'
  // 视觉模型未单独配置时默认复用文本模型（公司常见「一个多模态模型全包」部署）；不支持图像时另配 VLM_MODEL
  const visionModel = (process.env.VLM_MODEL || process.env.DEEPSEEK_VISION_MODEL || '').trim() || model
  return { apiKey, baseUrl, model, visionModel }
}

function resolveProvider(): 'private' | 'builtin' {
  const cfg = privateConfig()
  const p = (process.env.LLM_PROVIDER || 'auto').trim().toLowerCase()
  if (p === 'builtin') return 'builtin'
  if (p === 'private' || p === 'deepseek') {
    if (!cfg.apiKey) {
      throw new Error('LLM_PROVIDER=private 但未配置 LLM_API_KEY——请在 .env 填写公司网关地址与 key 后保存（dev 会自动重载）或改为 LLM_PROVIDER=builtin/auto')
    }
    return 'private'
  }
  return cfg.apiKey ? 'private' : 'builtin'
}

/** Qwen3 等思考链开关：LLM_ENABLE_THINKING 显式 false 时注入 chat_template_kwargs（vLLM/SGLang 识别） */
function thinkingOffPatch(): Record<string, unknown> {
  const v = (process.env.LLM_ENABLE_THINKING || '').trim().toLowerCase()
  if (v === 'false' || v === '0' || v === 'off') return { chat_template_kwargs: { enable_thinking: false } }
  return {}
}

/** 私有通道 max_tokens 上限（LLM_MAX_TOKENS 可选覆盖，防部署端上下文不足报 4xx） */
function tokenCap(fallback: number): number {
  const n = Number(process.env.LLM_MAX_TOKENS)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** OpenAI 兼容 /chat/completions 共用请求（返回文本；私有化网关与 DeepSeek 均走此格式） */
async function openaiCompatFetch(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300)
      throw new Error(`私有化网关 ${res.status}: ${errText}`)
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>
      usage?: { completion_tokens_details?: { reasoning_tokens?: number } }
    }
    const choice = data.choices?.[0]
    const content = choice?.message?.content ?? ''
    if (!content) {
      // HTTP 200 但正文为空：思考链模型（DeepSeek-R1 / Qwen3 开思考）的 max_tokens 是「思维链+答案」总预算，
      // 思维链未写完预算即耗尽 → finish_reason=length + content=""（实测）。必须报错而非静默返回空串。
      const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens ?? choice?.message?.reasoning_content?.length
      throw new Error(
        `模型 ${body.model} 返回空响应（finish_reason=${choice?.finish_reason ?? '未知'}，思考 tokens=${reasoning ?? '未知'}）——多为思考链耗尽 token 预算，建议 .env 设 LLM_ENABLE_THINKING=false 或调大 LLM_MAX_TOKENS 后重试`,
      )
    }
    return content
  } finally {
    clearTimeout(timer)
  }
}

// ============ 消息清洗 ============
export interface AiChatMessage { role: 'user' | 'assistant'; content: string }

/** 文本补全（私有网关通道）：system 置顶，OpenAI 兼容 */
async function privateComplete(
  systemPrompt: string,
  messages: AiChatMessage[],
  opts?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  const { apiKey, baseUrl, model } = privateConfig()
  // max_tokens 透传业务值（默认 8192），受 LLM_MAX_TOKENS 硬上限约束；思考链预算不足时由空响应报错兜底提示
  return openaiCompatFetch(baseUrl, apiKey, {
    model,
    stream: false,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    max_tokens: Math.min(opts?.maxTokens ?? 8192, tokenCap(32768)),
    ...thinkingOffPatch(),
    ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
  }, 120_000)
}

/**
 * 图像理解统一出口（双通道）：
 * - DeepSeek：system 纯文本 + user 消息携带 image_url（data URL，官方限制：图片仅允许出现在 user 消息）
 * - 回退内置 SDK createVision（非标 /chat/completions/vision，systemPrompt 与图同置 user 消息）
 * imageDataUrl 必须是 data:image/...;base64,... 形式
 */
export async function bpVisionComplete(systemPrompt: string, imageDataUrl: string): Promise<string> {
  const cfg = privateConfig()
  if (resolveProvider() === 'private') {
    return openaiCompatFetch(cfg.baseUrl, cfg.apiKey, {
      model: cfg.visionModel,
      stream: false,
      max_tokens: tokenCap(16384),
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请仔细识别这张图片，严格按 system 指令输出。' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      ...thinkingOffPatch(),
    }, 180_000)
  }
  const zai = await getZai()
  type VisionParam = Parameters<Awaited<ReturnType<typeof getZai>>['chat']['completions']['createVision']>[0]
  const completion = await zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: systemPrompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  } as unknown as VisionParam)
  return completion.choices[0]?.message?.content ?? ''
}

/**
 * 多图理解统一出口（照片位置核对等场景）：system 纯文本 + user 消息按顺序携带多张 image_url。
 * - DeepSeek：官方限制 image_url 仅允许出现在 user 消息（多块并列允许）
 * - 内置 SDK：createVision 同样支持 user 消息内多 image_url 块
 * imageDataUrls 顺序即语义顺序（调用方负责在 system prompt 里说明每张图的角色）
 */
export async function bpVisionCompleteMulti(systemPrompt: string, imageDataUrls: string[]): Promise<string> {
  if (!imageDataUrls.length) throw new Error('未提供任何图片')
  const imageBlocks = imageDataUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } }))
  const cfg = privateConfig()
  if (resolveProvider() === 'private') {
    return openaiCompatFetch(cfg.baseUrl, cfg.apiKey, {
      model: cfg.visionModel,
      stream: false,
      max_tokens: tokenCap(16384),
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: `共 ${imageDataUrls.length} 张图片，请严格按 system 指令依次识别并输出。` },
            ...imageBlocks,
          ],
        },
      ],
      ...thinkingOffPatch(),
    }, 180_000)
  }
  const zai = await getZai()
  type VisionParam = Parameters<Awaited<ReturnType<typeof getZai>>['chat']['completions']['createVision']>[0]
  const completion = await zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: systemPrompt }, ...imageBlocks],
      },
    ],
    thinking: { type: 'disabled' },
  } as unknown as VisionParam)
  return completion.choices[0]?.message?.content ?? ''
}

/** 清洗对话消息：仅保留 user/assistant、字符串化、裁剪条数与单条长度 */
export function sanitizeChatMessages(raw: unknown, maxCount = 20, maxLen = 4000): AiChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: AiChatMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof content !== 'string') continue
    const text = content.slice(0, maxLen).trim()
    if (!text) continue
    out.push({ role, content: text })
  }
  return out.slice(-maxCount)
}

export interface AiContext {
  userName?: string
  userRole?: string
  moduleKey?: string
  moduleTitle?: string
}

/** 助手 system prompt（业务知识 + 当前上下文 + 回答口径 + 应用入口目录） */
export function buildAssistantSystemPrompt(ctx: AiContext): string {
  const roleZh: Record<string, string> = {
    ADMIN: '系统管理员', MANAGER: '分管领导', ENGINEER: '工艺工程师', REVIEWER: '方案审核人',
    OPERATOR: '作业人员', GUARDIAN: '监护人', ACCEPTOR: '验收人',
  }
  const userLine = ctx.userName
    ? `当前登录用户：${ctx.userName}${ctx.userRole ? `（${roleZh[ctx.userRole] ?? ctx.userRole}）` : ''}。`
    : ''
  const moduleLine = ctx.moduleTitle ? `用户当前所在模块：「${ctx.moduleTitle}」。` : ''
  const entryLines = BP_ENTRY_CATALOG.map((e) => `- [入口:${e.key}|${e.label}] ${e.desc}`).join('\n')
  return `你是「石化盲板管理系统」内置 AI 助手「小安」，面向石化企业盲板抽堵作业相关人员提供业务咨询与操作指引。
${BP_BUSINESS_KNOWLEDGE}
${userLine}${moduleLine}
【回答要求】
1. 使用简体中文，简洁专业，适当分点，单次回答一般不超过 400 字；
2. 涉及具体业务数据（某张票、某块盲板状态、某个方案）时不得编造，引导用户到对应模块查看；
3. 涉及现场作业时主动提示安全注意事项（如介质置换、气体检测、监护要求）；
4. 超出系统功能与石化盲板业务范围的问题，礼貌说明并引导回业务场景；
5. 语气专业友好，可以使用少量 emoji（如 ⚠️ ✅）。
【应用入口直达】回答涉及系统操作时，在对应内容之后插入入口标记（严格格式：[入口:key|显示文字]），用户点击可直接跳转。可用入口（key 只能从此目录逐字引用，严禁编造）：
${entryLines}
入口使用规则：①每条回答最多 3 个，只放与回答内容最相关的；②插入位置在首次提到的相关内容之后（如「应先编制隔离方案 [入口:isolation-scheme|去编制隔离方案]」），或在回答末尾单独一行「相关入口：」后列出；③动作类入口（新建/导入）用于引导用户发起操作；④纯知识问答（如规范条款解释）可不插入。`
}

/** 从 LLM 返回文本中提取 JSON（容忍 ```json 围栏与前后杂文） */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null
  let s = text.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)
  if (fence) s = fence[1].trim()
  // 直接解析
  try { return JSON.parse(s) as T } catch { /* 继续尝试截取 */ }
  // 截取首个 { 或 [ 到最后一个 } 或 ]
  const start = Math.min(...['{', '['].map((c) => { const i = s.indexOf(c); return i < 0 ? Number.MAX_SAFE_INTEGER : i }))
  if (start === Number.MAX_SAFE_INTEGER) return null
  const endBrace = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'))
  if (endBrace <= start) return null
  try { return JSON.parse(s.slice(start, endBrace + 1)) as T } catch { return null }
}

/** 统一的补全调用：附带业务知识 system、关闭思考链，返回文本（.env 的 LLM_PROVIDER 实时决定通道） */
export async function bpComplete(
  systemPrompt: string,
  messages: AiChatMessage[],
  opts?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  if (resolveProvider() === 'private') return privateComplete(systemPrompt, messages, opts)
  const zai = await getZai()
  const completion = await zai.chat.completions.create({
    messages: [{ role: 'assistant', content: systemPrompt }, ...messages],
    thinking: { type: 'disabled' },
    ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
  } as Parameters<ZaiClient['chat']['completions']['create']>[0])
  return completion.choices[0]?.message?.content ?? ''
}
