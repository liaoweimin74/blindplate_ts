// Preprocess split slides for reliable pptx conversion:
//  1) resolve <use href="#id"> into inline <g> clones
//  2) write explicit paint attributes (incl. fill="none") from live computed styles
//  3) replace EVERY visible inline SVG with a canvas-rasterized PNG <img>
//     (converter emits svg icons in an early pre-pass that lands BELOW parent
//      container shapes in pptx z-order; plain <img> elements follow document
//      order and stay on top)
//  4) .ai-hub: swap gradient bg for a canvas-drawn circle PNG (converter clamps
//     large border-radius so a 50%-radius div renders as a rounded square)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = '/home/z/my-project/download/slides';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const files = fs.readdirSync(DIR).filter(f => /^slide_\d+\.html$/.test(f)).sort();

  for (const f of files) {
    await page.goto('file://' + path.join(DIR, f), { waitUntil: 'networkidle' });

    const report = await page.evaluate(async () => {
      const SVGNS = 'http://www.w3.org/2000/svg';
      const out = { uses: 0, svg2png: 0, hub: false };

      // --- 1) resolve <use> ---
      document.querySelectorAll('svg use').forEach(use => {
        const href = use.getAttribute('href') || use.getAttribute('xlink:href');
        if (!href || !href.startsWith('#')) return;
        const sym = document.querySelector(href);
        if (!sym) return;
        const g = document.createElementNS(SVGNS, 'g');
        Array.from(sym.childNodes).forEach(n => g.appendChild(n.cloneNode(true)));
        use.replaceWith(g);
        out.uses++;
      });

      // --- 2) explicit paint attrs from computed style ---
      const norm = v => (v || '').replace(/px/g, '').replace(/,\s*/g, ' ').trim();
      const paint = svg => {
        [svg, ...svg.querySelectorAll('*')].forEach(n => {
          if (!(n instanceof SVGElement)) return;
          const cs = getComputedStyle(n);
          n.setAttribute('fill', cs.fill === 'none' ? 'none' : cs.fill);
          n.setAttribute('stroke', cs.stroke === 'none' ? 'none' : cs.stroke);
          if (cs.stroke && cs.stroke !== 'none') {
            n.setAttribute('stroke-width', norm(cs.strokeWidth) || '1');
            if (cs.strokeLinecap) n.setAttribute('stroke-linecap', cs.strokeLinecap);
            if (cs.strokeLinejoin) n.setAttribute('stroke-linejoin', cs.strokeLinejoin);
            const da = norm(cs.strokeDasharray);
            if (da && da !== 'none') n.setAttribute('stroke-dasharray', da);
          }
          if (cs.opacity && cs.opacity !== '1') n.setAttribute('opacity', cs.opacity);
          if (n.hasAttribute('pathLength')) {
            n.removeAttribute('pathLength');
            n.setAttribute('stroke-dasharray', 'none');
          }
        });
      };

      // --- 3) every visible svg -> PNG img (canvas, 3x for small, 2x for large) ---
      const svg2png = async (svg, scale) => {
        const rect = svg.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const clone = svg.cloneNode(true);
        if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVGNS);
        clone.setAttribute('width', String(Math.round(rect.width)));
        clone.setAttribute('height', String(Math.round(rect.height)));
        const svgStr = new XMLSerializer().serializeToString(clone);
        const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }));
        const img = new Image();
        const loaded = new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        img.src = url;
        try { await loaded; } catch (e) { URL.revokeObjectURL(url); return false; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(rect.width * scale));
        canvas.height = Math.max(1, Math.round(rect.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL('image/png');
        const cs = getComputedStyle(svg);
        const im = document.createElement('img');
        im.setAttribute('src', dataUrl);
        const st = ['display:' + (cs.display === 'inline' ? 'inline-block' : cs.display)];
        if (cs.position === 'absolute') st.push('position:absolute;inset:0;width:100%;height:100%');
        else { st.push('width:' + rect.width + 'px;height:' + rect.height + 'px'); }
        if (cs.verticalAlign && cs.verticalAlign !== 'baseline') st.push('vertical-align:' + cs.verticalAlign);
        im.setAttribute('style', st.join(';') + ';pointer-events:none');
        svg.replaceWith(im);
        return true;
      };

      const allSvgs = Array.from(document.querySelectorAll('body svg')).filter(s => s.getAttribute('width') !== '0');
      for (const svg of allSvgs) {
        // wrap direct text siblings: containers mixing raw text + icon get
        // flattened into a text frame by the converter, which silently drops
        // the icon img; element-only children ([img, span]) are emitted
        // separately and survive (empirically: .vr survived, .ri died)
        const parent = svg.parentElement;
        if (parent) {
          Array.from(parent.childNodes).forEach(n => {
            if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
              const span = document.createElement('span');
              parent.insertBefore(span, n);
              span.appendChild(n);
            }
          });
        }
        paint(svg);
        const r = svg.getBoundingClientRect();
        const ok = await svg2png(svg, r.width < 100 ? 3 : 2);
        if (ok) out.svg2png++;
      }

      // --- 4) .ai-hub circular gradient bg via canvas ---
      const hub = document.querySelector('.ai-hub');
      if (hub) {
        const w = 176, s = 2;
        const canvas = document.createElement('canvas');
        canvas.width = w * s; canvas.height = w * s;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, w * s, w * s);
        grad.addColorStop(0, '#a78bfa'); grad.addColorStop(0.45, '#8b5cf6'); grad.addColorStop(1, '#6d28d9');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(w * s / 2, w * s / 2, w * s / 2, 0, Math.PI * 2);
        ctx.fill();
        hub.style.background = 'url(' + canvas.toDataURL('image/png') + ') center/100% 100% no-repeat';
        hub.style.borderRadius = '0';
        hub.style.boxShadow = 'none';
        out.hub = true;
      }
      return out;
    });

    const html = await page.content();
    fs.writeFileSync(path.join(DIR, f), html, 'utf8');
    console.log(f, JSON.stringify(report));
  }

  await browser.close();
  console.log('preprocess done');
})().catch(e => { console.error(e); process.exit(1); });
