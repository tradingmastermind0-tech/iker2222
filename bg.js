// =============================================================
// Ambient background: a dark wireframe wave of small dots in
// perspective (JARVIS-style), plus an occasional subtle glitch on
// one section title. Loaded by topbar.js on every page.
//
// Kept light on purpose:
//   - one <canvas>, ≤ 30 fps, device-pixel-ratio capped at 1.5
//   - pauses while the tab is hidden
//   - drops to fewer dots if frames take too long
//   - prefers-reduced-motion: draws one still frame, no glitch
//   - low alpha so text and cards stay readable
// =============================================================
(function () {
  'use strict';
  if (window.__dashBg) return;
  window.__dashBg = true;
  try { if (window.self !== window.top) return; } catch (e) { return; }

  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLOR = '80, 200, 255';     // JARVIS cyan
  const FPS = 30;
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  // ---------------- Wave ----------------
  let canvas, ctx, W = 0, H = 0;
  let cols = 38, rows = 22;           // reduced automatically on slow devices

  function mount() {
    // The pages paint backgrounds on both <html> and <body>; a body
    // background would cover a layer behind the content. Move it to
    // <html> (looks identical) so the canvas can sit between them.
    const bs = getComputedStyle(document.body);
    const root = document.documentElement;
    if (bs.backgroundImage !== 'none' || bs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      root.style.backgroundColor = bs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? bs.backgroundColor : getComputedStyle(root).backgroundColor;
      if (bs.backgroundImage !== 'none') root.style.backgroundImage = bs.backgroundImage;
      root.style.backgroundAttachment = 'fixed';
      document.body.style.background = 'transparent';
    }

    canvas = document.createElement('canvas');
    canvas.id = 'dashBg';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha: true });
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (reduceMotion) draw(0);
  }

  // Grid in world space: x ∈ [-1, 1] across, z ∈ [near, far] into the
  // screen; y is the wave height. Projected with a simple perspective.
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const horizon = H * 0.42;
    const camH = H * 0.55;            // camera height above the wave plane
    const spreadX = W * 1.25;
    const near = 1, far = 7;
    const amp = 0.16;                 // wave height (world units)
    const time = t / 1000;

    for (let r = 0; r < rows; r++) {
      const z = near + (far - near) * (r / (rows - 1));
      const depth = 1 - (z - near) / (far - near);           // 1 near → 0 far
      const alpha = 0.05 + 0.32 * depth * depth;
      const size = 0.7 + 1.1 * depth;
      const pts = [];
      for (let c = 0; c < cols; c++) {
        const x = -1 + 2 * (c / (cols - 1));
        const y = amp * (Math.sin(x * 3.1 + time * 0.9 + z * 0.55) * 0.6
                       + Math.cos(z * 1.3 - time * 0.6 + x * 1.7) * 0.4);
        const sx = W / 2 + (x * spreadX) / z;
        const sy = horizon + (camH * (1 - y)) / z;
        pts.push(sx, sy);
      }
      // faint wireframe line along the row
      ctx.strokeStyle = 'rgba(' + COLOR + ',' + (alpha * 0.22).toFixed(3) + ')';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i], pts[i + 1]);
      ctx.stroke();
      // dots
      ctx.fillStyle = 'rgba(' + COLOR + ',' + alpha.toFixed(3) + ')';
      for (let i = 0; i < pts.length; i += 2) {
        const px = pts[i], py = pts[i + 1];
        if (px < -4 || px > W + 4 || py > H + 4) continue;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
    }
  }

  // Frosted-glass cards (backdrop-filter) re-blur whatever moves behind
  // them every frame, which is costly on phones — animate slower there.
  let fps = FPS;
  function pickFps() {
    const glass = Array.from(document.querySelectorAll('.card, .wt-card, .po-card')).slice(0, 5)
      .some(el => { const cs = getComputedStyle(el); return (cs.backdropFilter || cs.webkitBackdropFilter || 'none') !== 'none'; });
    fps = glass ? 20 : FPS;
  }

  let last = 0, slowFrames = 0, raf = 0;
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (ts - last < 1000 / fps) return;
    last = ts;
    const t0 = performance.now();
    draw(ts);
    // Adaptive: if drawing keeps costing > 8 ms, thin the grid out.
    if (performance.now() - t0 > 8) {
      if (++slowFrames > 20 && cols > 18) { cols = Math.round(cols * 0.7); rows = Math.round(rows * 0.75); slowFrames = 0; }
    } else slowFrames = 0;
  }
  function start() { if (!raf && !reduceMotion) { last = 0; raf = requestAnimationFrame(loop); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  // ---------------- Title glitch ----------------
  const TITLE_SEL = '.section-title-text, .section-title, .po-sub-title, .po-title, .dash-title, .wt-divider span, .nw-chart-label';
  const glitchCss = `
@keyframes dash-glitch {
  0%   { transform: translate(0, 0);       text-shadow: none; clip-path: none; }
  15%  { transform: translate(-1px, 0);    text-shadow: 1px 0 rgba(80,200,255,0.55), -1px 0 rgba(255,60,140,0.45); clip-path: inset(0 0 45% 0); }
  30%  { transform: translate(1px, 0);     text-shadow: -1px 0 rgba(80,200,255,0.55), 1px 0 rgba(255,60,140,0.45); clip-path: inset(40% 0 0 0); }
  45%  { transform: translate(0, 0);       text-shadow: 1px 0 rgba(80,200,255,0.4); clip-path: none; }
  60%  { transform: translate(-0.5px, 0);  text-shadow: none; }
  100% { transform: translate(0, 0);       text-shadow: none; clip-path: none; }
}
.dash-glitch { animation: dash-glitch 380ms steps(1, end) 1; }
@media (prefers-reduced-motion: reduce) { .dash-glitch { animation: none; } }
`;
  function glitchSoon() {
    setTimeout(() => {
      if (!document.hidden) {
        const els = Array.from(document.querySelectorAll(TITLE_SEL)).filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight; // on screen
        });
        const el = els[Math.floor(Math.random() * els.length)];
        if (el) {
          el.classList.remove('dash-glitch'); void el.offsetWidth;
          el.classList.add('dash-glitch');
          setTimeout(() => el.classList.remove('dash-glitch'), 450);
        }
      }
      glitchSoon();
    }, 5000 + Math.random() * 7000);
  }

  window.dashBg = { fps: () => fps, size: () => [cols, rows], draw };
  function boot() {
    mount();
    if (reduceMotion) { draw(0); return; }
    const st = document.createElement('style');
    st.textContent = glitchCss;
    document.head.appendChild(st);
    pickFps();
    start();
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    glitchSoon();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
