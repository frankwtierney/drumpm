import { midiToHz, hzToMidi } from '../src/detect.js';

// A piano keyboard drawn on a canvas, with a spectrum strip above it on the same note axis (C1 to C5).
export const KB_RANGE = [24, 72];
const BLACK = new Set([1, 3, 6, 8, 10]);
const pcOf = (m) => ((m % 12) + 12) % 12;

/** dB per FFT bin -> one 0..1 value per semitone key (lo..hi dB maps to 0..1). */
export function semitoneBands(db, binHz, lo, hi, [m0, m1] = KB_RANGE) {
  const out = new Float32Array(m1 - m0 + 1);
  for (let m = m0; m <= m1; m++) {
    const f0 = midiToHz(m - 0.5), f1 = midiToHz(m + 0.5), b0 = Math.floor(f0 / binHz), b1 = Math.floor(f1 / binHz);
    let v = -Infinity;
    if (b1 > b0) for (let b = b0; b <= b1 && b < db.length; b++) v = Math.max(v, db[b]);
    else { const p = midiToHz(m) / binHz, k = Math.floor(p), fr = p - k; v = db[k] * (1 - fr) + db[k + 1] * fr; }
    out[m - m0] = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  }
  return out;
}

export function createKeyboard(canvas, { onPick, onHover } = {}) {
  const st = { inKey: null, cov: null, nChords: 0, cands: new Map(), target: null, markers: [], ghost: null, live: null, liveColor: '#4fe3f0', range: null, hoverTones: null, hover: null };
  let keys = [], g = null; const dims = { rtaH: 74, gap: 8, keyH: 64, labelH: 16 };

  function layout(wCss) {
    const [m0, m1] = KB_RANGE, whites = []; for (let m = m0; m <= m1; m++) if (!BLACK.has(pcOf(m))) whites.push(m);
    const ww = wCss / whites.length, bw = ww * 0.62; keys = [];
    whites.forEach((m, i) => keys.push({ m, x: i * ww, w: ww, black: false, cx: i * ww + ww / 2 }));
    for (let m = m0; m <= m1; m++) if (BLACK.has(pcOf(m))) { const left = keys.find((k) => k.m === m - 1); if (left) keys.push({ m, x: left.x + ww - bw / 2, w: bw, black: true, cx: left.x + ww }); }
    keys.sort((a, b) => a.m - b.m);
    return { ww, bw };
  }
  const byMidi = (m) => keys[m - KB_RANGE[0]];
  const xOfMidi = (mf) => { const i = Math.max(0, Math.min(keys.length - 2, Math.floor(mf - KB_RANGE[0]))), t = mf - KB_RANGE[0] - i; return keys[i].cx + (keys[i + 1].cx - keys[i].cx) * t; };

  function draw() {
    const dpr = devicePixelRatio || 1, wCss = canvas.clientWidth, hCss = dims.rtaH + dims.gap + dims.keyH + dims.labelH;
    if (!wCss) return;
    canvas.width = Math.round(wCss * dpr); canvas.height = Math.round(hCss * dpr); canvas.style.height = hCss + 'px';
    g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, wCss, hCss);
    const { ww, bw } = layout(wCss), keysTop = dims.rtaH + dims.gap, blackH = dims.keyH * 0.62, [m0, m1] = KB_RANGE;

    // spectrum strip: the drum's allowed range, then B's static spectrum (ghost), then live bars
    if (st.range) { const a = byMidi(Math.max(m0, st.range[0])).cx - ww / 2, b = byMidi(Math.min(m1, st.range[1])).cx + ww / 2; g.fillStyle = '#c9ccff10'; g.fillRect(a, 0, b - a, dims.rtaH); }
    g.strokeStyle = '#ffffff18'; g.beginPath(); g.moveTo(0, dims.rtaH + .5); g.lineTo(wCss, dims.rtaH + .5); g.stroke();
    const bar = (vals, color, alpha, glow) => {
      g.save(); g.fillStyle = color; g.globalAlpha = alpha; if (glow) { g.shadowColor = color; g.shadowBlur = 8; }
      for (let m = m0; m <= m1; m++) { const h = vals[m - m0] * (dims.rtaH - 6); if (h > 0.5) { const k = byMidi(m); g.fillRect(k.cx - ww * 0.17, dims.rtaH - h, ww * 0.34, h); } }
      g.restore();
    };
    if (st.ghost) bar(st.ghost, '#4fe3f0', st.live ? 0.14 : 0.3, false);
    if (st.live) bar(st.live, st.liveColor, 0.95, true);

    // keys
    const inRange = (m) => !st.range || (m >= st.range[0] && m <= st.range[1]);
    const paint = (k) => {
      const pc = pcOf(k.m), inKey = st.inKey && st.inKey.has(pc), cov = st.cov ? st.cov[pc] : 0, top = keysTop, h = k.black ? blackH : dims.keyH;
      g.fillStyle = k.black ? (inKey ? '#5a5fa8' : '#1b1d2e') : (inKey ? '#b9bdf8' : '#dfe1f0');
      g.beginPath(); g.roundRect(k.x + .5, top, k.w - 1, h, [0, 0, 4, 4]); g.fill();
      if (st.nChords && cov > 0) { g.fillStyle = '#34d58a'; g.globalAlpha = 0.2 + 0.75 * (cov / st.nChords); g.beginPath(); g.roundRect(k.x + .5, top, k.w - 1, h, [0, 0, 4, 4]); g.fill(); g.globalAlpha = 1; }
      if (!inRange(k.m)) { g.fillStyle = '#12142c'; g.globalAlpha = 0.5; g.beginPath(); g.roundRect(k.x + .5, top, k.w - 1, h, [0, 0, 4, 4]); g.fill(); g.globalAlpha = 1; }
      if (st.hoverTones && st.hoverTones.has(pc)) { g.fillStyle = '#ffb347'; g.beginPath(); g.arc(k.cx, top + 9, 4, 0, 7); g.fill(); }
      if (k.m === st.target) { g.save(); g.strokeStyle = '#c9ccff'; g.lineWidth = 2; g.shadowColor = '#c9ccff'; g.shadowBlur = 10; g.beginPath(); g.roundRect(k.x + 1.5, top + 1, k.w - 3, h - 2, [0, 0, 4, 4]); g.stroke(); g.restore(); }
      if (k.m === st.hover) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(k.x + 1, top + 1, k.w - 2, h - 2, [0, 0, 4, 4]); g.stroke(); }
    };
    keys.filter((k) => !k.black).forEach(paint); keys.filter((k) => k.black).forEach(paint);

    // candidate rank badges
    g.font = '600 10px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [m, c] of st.cands) {
      const k = byMidi(m), y = k.black ? keysTop + blackH - 11 : keysTop + dims.keyH - 13, first = c.rank === 1;
      g.fillStyle = first ? '#6ff2a8' : '#12142cdd'; g.beginPath(); g.arc(k.cx, y, 8, 0, 7); g.fill();
      if (!first) { g.strokeStyle = '#6ff2a8aa'; g.lineWidth = 1; g.stroke(); }
      g.fillStyle = first ? '#0e1a14' : '#e9eaff'; g.fillText(String(c.rank), k.cx, y + .5);
    }
    // octave labels
    g.fillStyle = '#ffffff77'; g.font = '500 10px Inter, sans-serif'; g.textBaseline = 'alphabetic';
    for (const k of keys) if (!k.black && pcOf(k.m) === 0) g.fillText('C' + (Math.floor(k.m / 12) - 1), k.cx, keysTop + dims.keyH + 12);

    // pitch markers (B, A, target) through both strips
    g.textAlign = 'left';
    for (const mk of st.markers) {
      if (!mk.hz) continue; const mf = hzToMidi(mk.hz); if (mf < m0 || mf > m1) continue;
      const x = xOfMidi(mf); g.save(); g.strokeStyle = mk.color; g.fillStyle = mk.color; g.lineWidth = 1.5; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, keysTop + dims.keyH); g.stroke(); g.setLineDash([]);
      g.font = '700 10px Inter, sans-serif'; const tw = g.measureText(mk.label).width, lx = x + tw + 12 > wCss ? x - tw - 8 : x + 4;
      g.fillText(mk.label, lx, 11); g.restore();
    }
  }

  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function midiAt(x, y) {
    if (!keys.length) return null; const keysTop = dims.rtaH + dims.gap;
    if (y >= keysTop && y <= keysTop + dims.keyH) {
      const blackH = dims.keyH * 0.62;
      if (y <= keysTop + blackH) { const b = keys.find((k) => k.black && x >= k.x && x <= k.x + k.w); if (b) return b.m; }
      const w = keys.find((k) => !k.black && x >= k.x && x <= k.x + k.w); return w ? w.m : null;
    }
    if (y < dims.rtaH) { let best = null, d = 1e9; for (const k of keys) { const dd = Math.abs(k.cx - x); if (dd < d) { d = dd; best = k.m; } } return best; }
    return null;
  }
  canvas.addEventListener('pointermove', (e) => { const p = pos(e), m = midiAt(p.x, p.y); if (m !== st.hover) { st.hover = m; draw(); onHover && onHover(m); } });
  canvas.addEventListener('pointerleave', () => { if (st.hover != null) { st.hover = null; draw(); onHover && onHover(null); } });
  canvas.addEventListener('click', (e) => { const p = pos(e), m = midiAt(p.x, p.y); if (m != null && onPick) onPick(m); });
  new ResizeObserver(() => draw()).observe(canvas);

  return {
    set(patch) { Object.assign(st, patch); draw(); },
    setLive(vals, color) { st.live = vals; if (color) st.liveColor = color; draw(); },
    draw,
    /** CSS-pixel centre of a key on the page, for tests */
    centerOf(m) { const r = canvas.getBoundingClientRect(), k = byMidi(m), keysTop = dims.rtaH + dims.gap; return { x: r.left + k.cx, y: r.top + (k.black ? keysTop + dims.keyH * 0.25 : keysTop + dims.keyH * 0.6) }; },
  };
}
