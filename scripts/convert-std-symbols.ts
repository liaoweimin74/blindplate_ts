// ============================================================
// 一次性代码生成：std TSX 图元库 → Shape IR 数据包（零框架）
// 运行：bun scripts/convert-std-symbols.ts
// 产物：src/lib/configurator-packs/std-shapes.ts（GENERATED，勿手改）
//
// 原理：std 符号 render({stroke,fill}) 是纯函数——用哨兵色各渲染一次，
//       逐元素遍历 React element 树（bun 原生支持 TSX），机械映射为
//       Shape 数据；哨兵色出现处写入 '{stroke}'/'{fill}' token，
//       渲染期由 paint 解析为实例色。视觉输出与原 TSX 渲染 1:1。
// ============================================================
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STD_SYMBOLS } from '../src/components/bp/std'
import type { Shape } from '../src/lib/configurator-core/shapes'

/** 哨兵色（控制字符包裹，确保不与真实颜色串混淆） */
const S = '\u0001S\u0001'
const F = '\u0001F\u0001'

interface JsxEl {
  type: unknown
  props: { [k: string]: unknown; children?: unknown }
}

const REACT_FRAGMENT = Symbol.for('react.fragment')

function isEl(v: unknown): v is JsxEl {
  return typeof v === 'object' && v !== null && 'type' in (v as object) && 'props' in (v as object)
}

/** 属性值哨兵 → token 模板（如 '{stroke}'、'{stroke}55'） */
function token(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  if (!v.includes(S) && !v.includes(F)) return v
  return v.replaceAll(S, '{stroke}').replaceAll(F, '{fill}')
}

function parsePoints(v: unknown): number[][] {
  return String(v)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => pair.split(',').map(Number))
}

/** 提取通用绘制属性（仅收集 std 库实际使用的子集） */
function common(el: JsxEl): Record<string, unknown> {
  const p = el.props
  const out: Record<string, unknown> = {}
  const st = token(p.stroke)
  if (st !== undefined) out.stroke = st
  const fi = token(p.fill)
  if (fi !== undefined) out.fill = fi
  if (typeof p.strokeWidth === 'number') out.strokeWidth = p.strokeWidth
  if (typeof p.strokeDasharray === 'string') out.dash = p.strokeDasharray
  if (p.strokeLinecap === 'round' || p.strokeLinecap === 'square') out.cap = p.strokeLinecap
  if (p.strokeLinejoin === 'round' || p.strokeLinejoin === 'bevel') out.join = p.strokeLinejoin
  if (typeof p.opacity === 'number') out.opacity = p.opacity
  return out
}

/** 收集 <text> 的字符串子节点 */
function textContent(v: unknown): string {
  if (v === null || v === undefined || typeof v === 'boolean') return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(textContent).join('')
  return ''
}

/** 单个 React element → Shape（未知标签跳过，当前库无 defs/use/marker/pattern/transform） */
function walk(v: unknown): Shape | null {
  if (!isEl(v)) return null
  const el: JsxEl = v
  const p = el.props
  const c = common(el)
  switch (el.type) {
    case 'path':
      return { kind: 'path', d: String(p.d), ...c } as Shape
    case 'circle':
      return { kind: 'circle', cx: Number(p.cx), cy: Number(p.cy), r: Number(p.r), ...c } as Shape
    case 'ellipse':
      return { kind: 'ellipse', cx: Number(p.cx), cy: Number(p.cy), rx: Number(p.rx), ry: Number(p.ry), ...c } as Shape
    case 'rect': {
      const r: Record<string, unknown> = { kind: 'rect', x: Number(p.x), y: Number(p.y), w: Number(p.width), h: Number(p.height), ...c }
      if (p.rx !== undefined) r.rx = Number(p.rx)
      return r as unknown as Shape
    }
    case 'line':
      return { kind: 'line', x1: Number(p.x1), y1: Number(p.y1), x2: Number(p.x2), y2: Number(p.y2), ...c } as Shape
    case 'polyline':
      return { kind: 'polyline', pts: parsePoints(p.points), ...c } as Shape
    case 'polygon':
      return { kind: 'polygon', pts: parsePoints(p.points), ...c } as Shape
    case 'text': {
      const t: Record<string, unknown> = { kind: 'text', x: Number(p.x), y: Number(p.y), text: textContent(p.children), ...c }
      if (p.fontSize !== undefined) t.size = p.fontSize
      if (p.fontWeight !== undefined) t.weight = p.fontWeight
      if (p.textAnchor !== undefined) t.anchor = p.textAnchor
      if (p.dominantBaseline !== undefined) t.baseline = p.dominantBaseline
      if (p.fontFamily !== undefined) t.family = p.fontFamily
      return t as unknown as Shape
    }
    case 'g':
      return { kind: 'group', children: flatten(p.children), ...c } as Shape
    default:
      return null
  }
}

/** 树摊平：数组 / Fragment 递归展开，null/boolean 剔除 */
function flatten(v: unknown): Shape[] {
  if (v === null || v === undefined || typeof v === 'boolean') return []
  if (Array.isArray(v)) return v.flatMap(flatten)
  if (isEl(v) && v.type === REACT_FRAGMENT) return flatten(v.props.children)
  const s = walk(v)
  return s ? [s] : []
}

// ============ 主流程 ============
const entries: string[] = []
const seen = new Set<string>()
let shapeCount = 0

for (const sym of STD_SYMBOLS) {
  if (seen.has(sym.id)) throw new Error(`重复符号 id: ${sym.id}`)
  seen.add(sym.id)
  const tree = sym.render({ stroke: S, fill: F })
  const shapes = flatten(tree)
  if (shapes.length === 0) throw new Error(`符号 ${sym.id} 未产出任何形状`)
  shapeCount += shapes.length
  entries.push(`  '${sym.id}': ${JSON.stringify({ sw: sym.sw, sh: sym.sh, shapes })},`)
}

const out = `// ============================================================
// GENERATED FILE — 由 scripts/convert-std-symbols.ts 生成，勿手改
// 源：src/components/bp/std/*.tsx（EN ISO 10628 / ISA-5.1 / HG/T 20519 / GB/T 4728 图元，Task 61 手绘）
// 形态：Shape IR（零框架）——React / Vue / 原生渲染同一份数据，视觉 1:1
// 重新生成：bun scripts/convert-std-symbols.ts
// ============================================================
import type { Shape } from '../configurator-core/shapes'

export interface StdShapeEntry {
  sw: number
  sh: number
  shapes: Shape[]
}

export const STD_SHAPE_DATA: Record<string, StdShapeEntry> = {
${entries.join('\n')}
}

export const STD_SHAPE_COUNT = ${seen.size}
`

const target = join(process.cwd(), 'src/lib/configurator-packs')
mkdirSync(target, { recursive: true })
writeFileSync(join(target, 'std-shapes.ts'), out, 'utf8')
console.log(`✓ ${seen.size} 符号 / ${shapeCount} 形状 → src/lib/configurator-packs/std-shapes.ts`)
