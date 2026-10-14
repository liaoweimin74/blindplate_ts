// 冒烟：core/viewport 视口数学纯函数（Task 124）
// 运行：bunx tsx scripts/smoke-viewport.ts
import {
  zoomViewport, wheelZoomIntent, minimapNavigateWorld, panByScreen, WHEEL_ZOOM_STEP,
} from '../src/lib/configurator-core/viewport'

let pass = 0
let fail = 0
const eq = (name: string, got: unknown, want: unknown, tol = 1e-9) => {
  const ok =
    typeof want === 'object' && want !== null
      ? JSON.stringify(got) === JSON.stringify(want)
      : Math.abs((got as number) - (want as number)) <= tol
  if (ok) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`) }
}

// ── 1. zoomViewport：中心缩放（±按钮路径） ──
eq('center zoom 1.25', zoomViewport({ x: 0, y: 0, w: 1200, h: 700 }, 1.25, 300, 3000), { x: 120, y: 70, w: 960 })
eq('center zoom out', zoomViewport({ x: 120, y: 70, w: 960, h: 560 }, 1 / 1.25, 300, 3000), { x: 0, y: 0, w: 1200 })
// 锚点缩放：锚在原点 → 视口向右下扩展，原点不动
eq('anchor at origin', zoomViewport({ x: 0, y: 0, w: 1200, h: 700 }, 1.25, 300, 3000, 0, 0), { x: 0, y: 0, w: 960 })
// 锚点缩放：锚 (600,350) 中心 = 与中心缩放一致
eq('anchor center eq', zoomViewport({ x: 0, y: 0, w: 1200, h: 700 }, 1.25, 300, 3000, 600, 350), { x: 120, y: 70, w: 960 })
// clamp：已到 min 再放大不再变
eq('clamp minW', zoomViewport({ x: 0, y: 0, w: 300, h: 175 }, 1.25, 300, 3000), { x: 0, y: 0, w: 300 })
eq('clamp maxW', zoomViewport({ x: 0, y: 0, w: 3000, h: 1750 }, 1 / 1.25, 300, 3000), { x: 0, y: 0, w: 3000 })
// w=300 时 factor=0.8（缩小）→ w 增至 375 合法；中心不动 → x/y 负向扩展
eq('shrink from minW', zoomViewport({ x: 0, y: 0, w: 300, h: 175 }, 0.8, 300, 3000), { x: -37.5, y: -21.875, w: 375 })
// 防除零：factor=0 按恒等处理
eq('factor 0 guard', zoomViewport({ x: 10, y: 20, w: 1200, h: 700 }, 0, 300, 3000), { x: 10, y: 20, w: 1200 })

// ── 2. wheelZoomIntent：鼠标锚点换算（scale = 400px / 1200世界 = 1/3） ──
const rect = { left: 100, top: 50, width: 400, height: 233 }
const v = { x: 0, y: 0, w: 1200, h: 700 }
eq('wheel zoom in', wheelZoomIntent({ clientX: 300, clientY: 200, deltaY: -100 }, rect, v), { factor: WHEEL_ZOOM_STEP, ax: 600, ay: 450 })
eq('wheel zoom out', wheelZoomIntent({ clientX: 300, clientY: 200, deltaY: 100 }, rect, v)?.factor, 1 / WHEEL_ZOOM_STEP)
eq('wheel ax/ay', (() => { const r = wheelZoomIntent({ clientX: 100, clientY: 50, deltaY: -1 }, rect, v); return r ? [r.ax, r.ay] : null })(), [0, 0])
eq('wheel zero rect', wheelZoomIntent({ clientX: 0, clientY: 0, deltaY: -1 }, { left: 0, top: 0, width: 0, height: 0 }, v), null)

// ── 3. minimapNavigateWorld：letterbox 逆换算 ──
// m = minimapBoundsOf 形态（画布∪视口+留白）；缩略图 200x100，m 1300x800 → s=0.125, oy=0, ox=18.75
const m = { x: -50, y: -50, w: 1300, h: 800 }
const mrect = { left: 0, top: 0, width: 200, height: 100 }
eq('minimap center→world', minimapNavigateWorld(100, 50, mrect, m), { x: 600, y: 350 })
eq('minimap origin', minimapNavigateWorld(18.75, 0, mrect, m), { x: -50, y: -50 })
eq('minimap zero rect', minimapNavigateWorld(0, 0, { left: 0, top: 0, width: 0, height: 0 }, m), null)

// ── 4. panByScreen：屏幕位移 → viewBox 平移 ──
eq('pan right-up', panByScreen({ x: 100, y: 200, w: 1200, h: 700 }, 60, -30, 0.5), { x: -20, y: 260, w: 1200 })
eq('pan zero', panByScreen({ x: 5, y: 6, w: 100, h: 70 }, 0, 0, 1), { x: 5, y: 6, w: 100 })

console.log(`\nSMOKE ${pass} pass / ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
