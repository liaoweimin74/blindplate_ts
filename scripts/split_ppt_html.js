// One-off: split ppt/blind-plate-system-ppt.html into download/slides/*.html for pptx export
const fs = require('fs');
const path = require('path');

const SRC = '/home/z/my-project/ppt/blind-plate-system-ppt.html';
const OUT = '/home/z/my-project/download/slides';

const src = fs.readFileSync(SRC, 'utf8');
fs.mkdirSync(OUT, { recursive: true });

// 1) extract the single <style> block
const style = src.match(/<style>([\s\S]*?)<\/style>/)[1];

// 2) extract hidden SVG icon symbol defs
const defsMatch = src.match(/<svg width="0" height="0"[^>]*>\s*<defs>[\s\S]*?<\/defs>\s*<\/svg>/);
if (!defsMatch) throw new Error('icon defs svg not found');
const defs = defsMatch[0];

// 3) split the 10 <section class="slide..."> blocks
const re = /<section class="slide([^"]*)"([^>]*)>([\s\S]*?)<\/section>/g;
const slides = [];
let m;
while ((m = re.exec(src)) !== null) {
  const cls = m[1];
  const attrs = m[2] || '';
  const aria = (attrs.match(/aria-label="([^"]*)"/) || [])[1] || ('Slide ' + (slides.length + 1));
  slides.push({ cls, aria, body: m[3] });
}
if (slides.length !== 10) throw new Error('expected 10 slides, got ' + slides.length);

// 4) global.css = original css + static-export overrides (freeze animations to final state)
const overrides = `
/* ==== static-export overrides for pptx conversion ==== */
html,body{width:1280px;height:720px;overflow:hidden;margin:0;background:var(--bg)}
#nav,#pageno,#viewport,#stage{display:none!important}
.slide{position:relative!important;inset:auto!important;width:1280px!important;height:720px!important;border-radius:0!important;box-shadow:none!important;opacity:1!important;visibility:visible!important;transition:none!important}
.a{opacity:1!important;animation:none!important}
.stag>*{opacity:1!important;animation:none!important}
.s1-parts i{opacity:var(--o,.55)!important;animation:none!important}
.fl-rot,.ringA,.ringB,.s7-svg line,.ai-node,.tl-dot.d1::after{animation:none!important}
.fjoin i{animation:none!important;opacity:0!important}
.dr{stroke-dashoffset:0!important;animation:none!important}
.pid-canvas{background-image:none!important;background-color:#fcfcfa!important}
.ai-hub{border-radius:88px!important}
*{transition:none!important}
`;
fs.writeFileSync(path.join(OUT, 'global.css'), style + overrides, 'utf8');

// 5) one standalone html per slide
slides.forEach((s, i) => {
  const cls = s.cls.includes('active') ? s.cls : s.cls + ' active';
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${s.aria}</title>
<link rel="stylesheet" href="global.css">
</head>
<body>
${defs}
<section class="slide${cls}" role="group" aria-label="${s.aria}">${s.body}</section>
</body>
</html>
`;
  const name = `slide_${String(i + 1).padStart(2, '0')}.html`;
  fs.writeFileSync(path.join(OUT, name), html, 'utf8');
  console.log('wrote', name, '-', s.aria);
});
console.log('done:', slides.length, 'slides +', 'global.css');
