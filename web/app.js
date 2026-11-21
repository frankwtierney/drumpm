import { detectPitch, matchSemitones, describeHz, midiToHz, spectrum, toMono, findOnset } from '../src/detect.js';
import { analyzeAttack, applyAttackContour } from '../src/attack.js';
import { SCALES, ROOTS, ROLES, suggestTunings, guessRole, chordCoverage, parentSteps } from '../src/key.js';
import { parseProgression, DEFAULT_PROG } from '../src/chords.js';
import { createChordDialog, playChord, stopPads } from './chordui.js';
import { createKeyboard, semitoneBands, KB_RANGE } from './keyboard.js';
import { stretchShift, varispeed, keepTransient, encodeWav, zipStore } from './shift.js';

const $ = (id) => document.getElementById(id);
const ac = new (window.AudioContext || window.webkitAudioContext)();
const state = { A: null, B: null, matched: null, target: null };
const NS = 'http://www.w3.org/2000/svg';
const ICON = {
  up: '<svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  dn: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  ok: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
};
let pendingSlot = null;
const refHz = () => state.target?.hz ?? state.A?.hz;          // what B is matched to: a chosen key target, else sample A
const refName = () => (state.target ? state.target.name : 'A');

/* ---------- loading ---------- */
async function loadFile(slot, file) {
  $('status').classList.add('busy');
  try {
    const buf = await ac.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice());
    const det = detectPitch(channels, buf.sampleRate);
    state[slot] = { name: file.name, sr: buf.sampleRate, channels, det, hz: det.hz };
    manual = null;
    if (slot === 'A') state.target = null;                                           // a new reference sample means "match to A" again
    if (slot === 'B' && det.hz && !key.roleTouched) $('keyRole').value = guessRole(det.hz);
    render(slot);
    await update();
  } catch (e) {
    console.error(e);
    $('s' + slot).textContent = 'Could not read ' + file.name;
  } finally { $('status').classList.remove('busy'); }
}

/* ---------- per-sample view ---------- */
// Everything that depends on the current pitch (detected or set by hand).
function showPitch(slot) {
  const s = state[slot], d = s.det;
  $('p' + slot).textContent = d.hz ? d.note : 'N/A';
  $('cen' + slot).textContent = d.hz ? `${d.cents >= 0 ? '+' : ''}${d.cents} cents` : 'no pitch';
  $('hz' + slot).innerHTML = d.hz ? `${d.hz.toFixed(1)}<small>Hz</small>` : `&ndash;<small>Hz</small>`;
  $('conf' + slot).dataset.l = !d.hz ? 0 : d.confidence > 0.75 ? 3 : d.confidence > 0.45 ? 2 : 1;
  $('confT' + slot).textContent = !d.hz ? 'No pitch found' : d.confidence > 0.75 ? 'Confident' : d.confidence > 0.45 ? 'Fairly sure' : 'Unsure, pick a partial';
  const k = $('k' + slot); k.textContent = '';
  if ((d.peaks || []).length) {
    const l = document.createElement('span'); l.className = 'lbl'; l.textContent = 'Pitch candidates:'; l.title = 'Detected frequency peaks. Click one to use it as the pitch.'; k.appendChild(l);
  }
  for (const p of d.peaks || []) {
    const b = document.createElement('button'); b.className = s.hz != null && Math.abs(p.hz - s.hz) < 0.01 ? 'sel' : '';
    b.textContent = p.hz.toFixed(0) + ' Hz'; b.title = `${p.hz.toFixed(1)} Hz (${p.db.toFixed(0)} dB). Click to use this pitch.`;
    b.onclick = () => commitPitch(slot, p.hz);
    k.appendChild(b);
  }
  setKnob(slot, d.hz);
  ['A', 'B'].forEach((k2) => state[k2] && drawSpectrum(k2));
  if (slot === 'B') renderKey();
}

// Choose a different detected pitch (candidate chips). The light parts update at once;
// attack analysis and the re-render wait until the hand stops moving.
function commitPitch(slot, hz) {
  const s = state[slot]; if (!s) return;
  s.hz = Math.max(FMIN, Math.min(FMAX, hz));
  Object.assign(s.det, describeHz(s.hz), { hz: s.hz });
  showPitch(slot);
  clearTimeout(s.settle);
  s.settle = setTimeout(() => { s.attack = analyzeAttack(toMono(s.channels), s.sr, s.hz); s.spectro = null; showAttack(slot); if (s.view === 'spectro') drawSpectrum(slot); update(); }, 150);
}

function render(slot) {
  const s = state[slot];
  document.querySelector(`.zone[data-slot=${slot}]`).classList.add('has');
  $('s' + slot).textContent = s.name;
  s.attack = analyzeAttack(toMono(s.channels), s.sr, s.hz); s.spectro = null; s.rtaStatic = null;
  showAttack(slot);
  showPitch(slot);
  drawWave(slot);
  $('play' + slot).disabled = $('ear' + slot).disabled = false;
}

function sizeCanvas(cv) {
  const dpr = devicePixelRatio || 1, w = (cv.width = Math.max(1, cv.clientWidth * dpr)), h = (cv.height = Math.max(1, cv.clientHeight * dpr));
  return { g: cv.getContext('2d'), w, h, dpr };
}

// Min/max envelope of x across the canvas width. `total` is the sample count the full width represents.
function strokeWave(g, w, h, dpr, x, total, peak, color, alpha = 1) {
  const step = Math.max(1, Math.floor(total / w)), mid = h / 2, n = x.length;
  g.save(); g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = 1 * dpr; g.beginPath();
  for (let px = 0; px < w; px++) {
    let mn = 0, mx = 0; const i0 = Math.floor((px / w) * total);
    for (let i = i0; i < Math.min(n, i0 + step); i++) { if (x[i] < mn) mn = x[i]; if (x[i] > mx) mx = x[i]; }
    g.moveTo(px + .5, mid - (mx / peak) * mid * 0.86); g.lineTo(px + .5, mid - (mn / peak) * mid * 0.86 + 1);
  }
  g.stroke(); g.restore();
}
const peakOf = (x) => { let p = 1e-9; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; };

function drawWave(slot) {
  const s = state[slot]; if (!s) return;
  const { g, w, h, dpr } = sizeCanvas($('w' + slot)), x = toMono(s.channels), n = x.length, color = slot === 'A' ? '#ff8a1f' : '#4fe3f0';
  g.clearRect(0, 0, w, h);
  // analysis window (where the pitch is read from)
  const on = findOnset(x, 0.1), a0 = on + 0.025 * s.sr, a1 = on + 0.175 * s.sr;
  g.fillStyle = color + '22'; g.fillRect((a0 / n) * w, 0, ((a1 - a0) / n) * w, h);
  strokeWave(g, w, h, dpr, x, n, peakOf(x), color);
  g.strokeStyle = '#ffffff30'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
}

// The matched result, drawn over a faint ghost of the original B so you can see what changed.
function drawMatched() {
  const m = state.matched, B = state.B, cv = $('wM');
  const { g, w, h, dpr } = sizeCanvas(cv); g.clearRect(0, 0, w, h);
  if (!m || !B) return;
  const o = toMono(m.channels), b = toMono(B.channels), total = Math.max(o.length, b.length), peak = Math.max(peakOf(o), peakOf(b));
  strokeWave(g, w, h, dpr, b, total, peak, '#4fe3f0', 0.28);
  strokeWave(g, w, h, dpr, o, total, peak, '#c9ccff', 1);
  g.strokeStyle = '#ffffff30'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
}
function setExport(on) {
  const el = $('dragOut'); el.classList.toggle('has', on); el.classList.toggle('ready', on); el.setAttribute('aria-disabled', String(!on));
  if (!on) drawMatched();
}

/* ---------- RTA-style spectrum (log axis, bars, peak hold) ---------- */
const RTA = { N: 64, F0: 25, F1: 1200 };
const edge = (i) => RTA.F0 * Math.pow(RTA.F1 / RTA.F0, i / RTA.N);
const rtaX = (hz) => Math.log(hz / RTA.F0) / Math.log(RTA.F1 / RTA.F0);
const rta = { events: [], raf: 0, shown: new Set(), peaks: { A: new Float32Array(RTA.N), B: new Float32Array(RTA.N) }, lastMax: 0 };
window.__rta = rta;

// dB per FFT bin -> N log-spaced bar heights in 0..1 (lo..hi dB maps to 0..1)
function bands(db, binHz, lo, hi) {
  const out = new Float32Array(RTA.N);
  for (let i = 0; i < RTA.N; i++) {
    const f0 = edge(i), f1 = edge(i + 1), b0 = Math.floor(f0 / binHz), b1 = Math.floor(f1 / binHz);
    let v = -Infinity;
    if (b1 > b0) for (let b = b0; b <= b1 && b < db.length; b++) v = Math.max(v, db[b]);
    else { const p = Math.sqrt(f0 * f1) / binHz, k = Math.floor(p), fr = p - k; v = db[k] * (1 - fr) + db[k + 1] * fr; }
    out[i] = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  }
  return out;
}

function staticBands(slot) { // spectrum of the analysis window, normalised to its own peak
  const s = state[slot], x = toMono(s.channels), on = findOnset(x, 0.1);
  const seg = x.subarray(on + Math.round(0.025 * s.sr), on + Math.round(0.175 * s.sr));
  if (seg.length < 512) return new Float32Array(RTA.N);
  const { mag, binHz } = spectrum(seg, s.sr, 4);
  let mx = 0; for (let i = 0; i < mag.length; i++) mx = Math.max(mx, mag[i]);
  const db = Float32Array.from(mag, (m) => 20 * Math.log10(m / mx + 1e-9));
  return bands(db, binHz, -60, 0);
}

function drawSpectrum(slot, live = null, tag = '') {
  const s = state[slot]; if (!s) return;
  if (s.view === 'spectro') return drawSpectrogram(slot);
  const { g, w, h, dpr } = sizeCanvas($('c' + slot)), N = RTA.N, bw = w / N, ph = h - 14 * dpr;
  const color = slot === 'A' ? '#ff8a1f' : '#4fe3f0';
  g.clearRect(0, 0, w, h);
  g.font = `${9 * dpr}px Inter, sans-serif`; g.textAlign = 'center';
  for (const hz of [50, 100, 200, 500, 1000]) { // grid + labels
    const x = rtaX(hz) * w;
    g.strokeStyle = '#ffffff12'; g.lineWidth = dpr; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, ph); g.stroke();
    g.fillStyle = '#ffffff55'; g.fillText(hz >= 1000 ? '1k' : String(hz), x, h - 2 * dpr);
  }
  const bar = (vals, alpha, glow) => {
    g.save(); g.fillStyle = color; g.globalAlpha = alpha; if (glow) { g.shadowColor = color; g.shadowBlur = 8 * dpr; }
    for (let i = 0; i < N; i++) { const v = vals[i] * ph; if (v > 0.5) g.fillRect(i * bw + bw * 0.14, ph - v, bw * 0.72, v); }
    g.restore();
  };
  s.rtaStatic = s.rtaStatic || staticBands(slot);
  if (live) {
    bar(s.rtaStatic, 0.16, false); bar(live, 0.95, true);
    const pk = rta.peaks[slot]; g.fillStyle = '#ffffffcc';
    for (let i = 0; i < N; i++) { pk[i] = Math.max(live[i], pk[i] - 0.012); if (pk[i] > 0.03) g.fillRect(i * bw + bw * 0.14, ph - pk[i] * ph - 2 * dpr, bw * 0.72, 1.5 * dpr); }
  } else bar(s.rtaStatic, 0.6, false);
  const line = (hz, c, label) => {
    if (!hz || hz < RTA.F0 || hz > RTA.F1) return;
    const x = rtaX(hz) * w; g.save(); g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 1.5 * dpr; g.setLineDash([3 * dpr, 3 * dpr]);
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, ph); g.stroke(); g.setLineDash([]);
    g.textAlign = x > w - 20 * dpr ? 'right' : 'left'; g.font = `600 ${10 * dpr}px Inter, sans-serif`; g.fillText(label, x + (g.textAlign === 'left' ? 4 : -4) * dpr, 11 * dpr); g.restore();
  };
  if (tag === 'matched') line(refHz(), '#ff8a1f', refName());          // matched B should land on the target
  else { line(s.hz, '#ffffffcc', slot); if (slot === 'B') line(refHz(), '#ff8a1f', refName()); }
}

let analyser = null, fftBuf = null;
function getAnalyser() {
  if (!analyser) { analyser = ac.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0.72; analyser.minDecibels = -100; analyser.maxDecibels = -5; analyser.connect(ac.destination); fftBuf = new Float32Array(analyser.frequencyBinCount); }
  return analyser;
}
function rtaStart(slot, t0, dur, tag) {
  rta.events.push({ slot, t0, t1: t0 + dur + 0.45, tag });
  if (!rta.raf) rta.raf = requestAnimationFrame(rtaFrame);
}
function rtaFrame() {
  rta.raf = 0;
  const now = ac.currentTime;
  rta.events = rta.events.filter((e) => e.t1 > now);
  const act = [...rta.events].reverse().find((e) => now >= e.t0 && now <= e.t1);
  const nowShown = new Set(); let kbLive = null;
  if (act) {
    analyser.getFloatFrequencyData(fftBuf);
    const binHz = ac.sampleRate / analyser.fftSize;
    kbLive = { vals: semitoneBands(fftBuf, binHz, -80, -8), color: act.tag === 'matched' ? '#c9ccff' : act.slot === 'A' ? '#ff8a1f' : '#4fe3f0' };
    if (state[act.slot].view !== 'spectro') {
      const live = bands(fftBuf, binHz, -80, -8);
      rta.lastMax = Math.max(...live);
      if (!rta.shown.has(act.slot)) rta.peaks[act.slot].fill(0);
      drawSpectrum(act.slot, live, act.tag); nowShown.add(act.slot);
    }
  }
  for (const sl of rta.shown) if (!nowShown.has(sl)) drawSpectrum(sl); // back to the static view
  if (typeof kb !== 'undefined') { if (kbLive) kb.setLive(kbLive.vals, kbLive.color); else if (rta.kbWasLive) kb.setLive(null); rta.kbWasLive = !!kbLive; }
  rta.shown = nowShown;
  if (rta.events.length || nowShown.size) rta.raf = requestAnimationFrame(rtaFrame);
}

/* ---------- attack readout + spectrogram ---------- */
function showAttack(slot) {
  const a = state[slot].attack, el = $('atk' + slot);
  const ico = '<svg class="i" viewBox="0 0 24 24"><path d="M2 12h4l2-7 3 14 2-10 2 3h7"/></svg>';
  el.innerHTML = !a ? '' : a.hasSweep
    ? `${ico}<span>Attack <b>${a.startHz.toFixed(0)} Hz</b> \u2192 body <b>${a.bodyHz.toFixed(0)} Hz</b> in ~${Math.round(a.tauMs * 3)} ms</span>`
    : `${ico}<span>No pitch sweep in the attack</span>`;
}
function spectroData(slot) {
  const s = state[slot]; if (s.spectro) return s.spectro;
  const x = toMono(s.channels), on = findOnset(x, 0.1), W = Math.round(0.016 * s.sr), nF = 100, R = 72, hop = 0.002 * s.sr;
  const cells = []; let mx = 0;
  for (let f = 0; f < nF; f++) {
    const s0 = on + Math.round(f * hop) - (W >> 1) - Math.round(0.004 * s.sr), seg = new Float32Array(W);
    for (let i = 0; i < W; i++) { const j = s0 + i; if (j >= 0 && j < x.length) seg[i] = x[j]; }
    const { mag, binHz } = spectrum(seg, s.sr, 8), col = new Float32Array(R);
    for (let r = 0; r < R; r++) { const hz = RTA.F0 * Math.pow(RTA.F1 / RTA.F0, (r + 0.5) / R), k = hz / binHz, k0 = Math.floor(k); col[r] = mag[k0] * (1 - (k - k0)) + mag[k0 + 1] * (k - k0); mx = Math.max(mx, col[r]); }
    cells.push(col);
  }
  return (s.spectro = { cells, mx, nF, R });
}
function drawSpectrogram(slot) {
  const s = state[slot], { cells, mx, nF, R } = spectroData(slot), { g, w, h, dpr } = sizeCanvas($('c' + slot));
  const color = slot === 'A' ? [255, 138, 31] : [79, 227, 240], ph = h - 14 * dpr, cw = w / nF, ch = ph / R;
  g.clearRect(0, 0, w, h);
  for (let f = 0; f < nF; f++) for (let r = 0; r < R; r++) {
    const v = Math.pow(Math.max(0, Math.min(1, (20 * Math.log10(cells[f][r] / mx + 1e-9) + 34) / 34)), 1.8), a = Math.min(1, v * 1.4), wh = Math.max(0, v - 0.7) / 0.3;
    g.fillStyle = `rgb(${Math.round(20 + (color[0] - 20) * a + 235 * wh * 0.7)},${Math.round(22 + (color[1] - 22) * a + 235 * wh * 0.7)},${Math.round(38 + (color[2] - 38) * a + 235 * wh * 0.7)})`;
    g.fillRect(f * cw, ph - (r + 1) * ch, cw + 0.6, ch + 0.6);
  }
  const X = (ms) => ((ms + 4) / 2 / nF) * w, Y = (hz) => ph - rtaX(hz) * ph;
  g.font = `${9 * dpr}px Inter, sans-serif`; g.fillStyle = '#ffffff77'; g.textAlign = 'center';
  for (const ms of [50, 100, 150]) g.fillText(ms + ' ms', X(ms), h - 2 * dpr);
  g.textAlign = 'left'; for (const hz of [50, 100, 200, 500]) { g.fillStyle = '#ffffff66'; g.fillText(String(hz), 3 * dpr, Y(hz) + 3 * dpr); }
  const a = s.attack;
  if (a) {
    g.fillStyle = '#ffffffee'; for (const f of a.track) { if (f.hz > RTA.F0 && f.hz < RTA.F1) { g.beginPath(); g.arc(X(f.t), Y(f.hz), 2 * dpr, 0, 7); g.fill(); } }
    g.save(); g.strokeStyle = '#ffffffaa'; g.lineWidth = dpr; g.setLineDash([3 * dpr, 3 * dpr]); g.beginPath(); g.moveTo(0, Y(a.bodyHz)); g.lineTo(w, Y(a.bodyHz)); g.stroke(); g.restore();
    if (a.hasSweep) { g.fillStyle = '#fff'; g.font = `600 ${10 * dpr}px Inter, sans-serif`; g.fillText('attack', X(8) + 6 * dpr, Y(a.startHz) - 4 * dpr); }
  }
}
document.querySelectorAll('.vt').forEach((box) => box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  const slot = box.dataset.slot; if (!state[slot]) return;
  state[slot].view = b.dataset.view;
  box.querySelectorAll('button').forEach((o) => o.classList.toggle('on', o === b));
  drawSpectrum(slot);
})));

/* ---------- knobs ---------- */
const ARC = 358, FMIN = 30, FMAX = 800;
const frac = (hz) => Math.max(0, Math.min(1, Math.log(hz / FMIN) / Math.log(FMAX / FMIN)));
function setKnob(slot, hz) {
  const svg = document.querySelector(`[data-knob=${slot}]`), f = hz ? frac(hz) : 0;
  svg.querySelector('.arc').setAttribute('stroke-dasharray', `${f * ARC} 600`);
  svg.querySelector('.dotg').style.transform = `rotate(${-135 + 270 * f}deg)`;
}
function ticks(g, n = 54) {
  for (let i = 0; i <= n; i++) {
    const a = ((135 + (270 * i) / n) * Math.PI) / 180, major = i % (n / 6) === 0, r1 = 91, r2 = major ? 85 : 88;
    const l = document.createElementNS(NS, 'line'); l.setAttribute('class', 'tick');
    l.setAttribute('x1', 100 + r1 * Math.cos(a)); l.setAttribute('y1', 100 + r1 * Math.sin(a));
    l.setAttribute('x2', 100 + r2 * Math.cos(a)); l.setAttribute('y2', 100 + r2 * Math.sin(a)); g.appendChild(l);
  }
}
document.querySelectorAll('.ticks').forEach((g) => ticks(g));
const pol = (deg, r = 76) => [100 + r * Math.sin((deg * Math.PI) / 180), 100 - r * Math.cos((deg * Math.PI) / 180)];
$('mtrack').setAttribute('d', `M ${pol(-135)} A 76 76 0 1 1 ${pol(135)}`);
function setMatch(st) { // bipolar dial: -12..+12 st, 0 at 12 o'clock
  const f = st === null ? 0 : Math.max(-1, Math.min(1, st / 12)), deg = f * 135;
  $('marc').setAttribute('d', Math.abs(deg) < 0.4 ? '' : `M ${pol(0)} A 76 76 0 0 ${deg > 0 ? 1 : 0} ${pol(deg)}`);
  $('mdot').style.transform = `rotate(${deg}deg)`;
}
setMatch(null); setKnob('A', null); setKnob('B', null); setTuner(null);

/* ---------- matching ---------- */
function shiftAmount0() { return matchSemitones(refHz(), state.B.hz, { foldOctave: $('fold').checked }); }
function styleRanges() {
  const set = (id, s, e) => { $(id).style.setProperty('--s', s + '%'); $(id).style.setProperty('--e', e + '%'); };
  const pf = ((Number($('fine').value) + 100) / 200) * 100; set('fine', Math.min(50, pf), Math.max(50, pf));
  set('atk', 0, (Number($('atk').value) / 40) * 100);
}

let renderToken = 0, manual = null, renderTimer = null;
const totalShift = () => (manual ?? shiftAmount0()) + Number($('fine').value) / 100;

// Tuner bar: residual = (B after shift) - A, in semitones. Zero = matched.
function setTuner(res) {
  const t = $('tuner');
  if (res === null) { t.dataset.s = 'none'; t.classList.remove('off'); $('tnRead').textContent = '\u2013'; $('tnNeedle').style.left = '50%'; return; }
  const c = res * 100, a = Math.abs(c), sign = c > 0 ? '+' : '\u2212';
  t.dataset.s = a <= 5 ? 'tuned' : a <= 15 ? 'near' : 'far';
  t.classList.toggle('off', a > 50);
  $('tnNeedle').style.left = 50 + Math.max(-50, Math.min(50, c)) + '%';
  $('tnRead').innerHTML = a <= 5 ? `${ICON.ok}In tune` : a > 50 ? `${sign}${Math.abs(res).toFixed(2)} st` : `${sign}${a.toFixed(0)}\u00a2 ${c > 0 ? 'sharp' : 'flat'}`;
}

function setManual(v) { manual = v; update(150); }

async function update(delay = 0) {
  $('fineV').textContent = $('fine').value; $('atkV').textContent = $('atk').value; styleRanges();
  const { A, B } = state, ready = !!(refHz() && B?.hz), nm = refName();
  $('matchRef').textContent = `B to ${nm}`;
  $('mknob').classList.toggle('live', ready);
  $('autoBtn').hidden = !ready;
  $('autoBtn').classList.toggle('on', manual === null);
  $('autoT').textContent = manual === null ? 'Auto' : 'Manual \u00b7 reset';
  if (!ready) {
    $('shiftBig').textContent = '\u2013'; setMatch(null); setTuner(null); $('tnNote').textContent = '';
    $('distance').innerHTML = `<span class="hint">${!refHz() && !B ? 'Drop a reference (1) and a sample to retune (2), or pick a key below' : !refHz() ? 'Now drop the reference sample (1), or pick a key below' : 'Now drop the sample to retune (2)'}</span>`;
    $('playM').disabled = $('cmp').disabled = true; setExport(false); return;
  }
  const base = shiftAmount0(), st = totalShift();
  const dist = Math.abs(base), whole = Math.floor(dist + 1e-9), cts = Math.round((dist - whole) * 100);
  const [w2, c2] = cts === 100 ? [whole + 1, 0] : [whole, cts];
  $('shiftBig').textContent = (st >= 0 ? '+' : '\u2212') + Math.abs(st).toFixed(2);
  setMatch(st); setTuner(st - base);
  $('distance').innerHTML = dist < 0.005
    ? `<span class="ar ok">${ICON.ok}</span><span>B is already in tune with ${nm}</span>`
    : `<span class="ar ${base < 0 ? 'dn' : 'up'}">${base < 0 ? ICON.dn : ICON.up}</span><span>B is ${w2} st ${c2}\u00a2 ${base < 0 ? 'above' : 'below'} ${nm}<small>Needs a shift ${base < 0 ? 'down' : 'up'} of ${Math.abs(base).toFixed(2)} st</small></span>`;
  $('cmp').disabled = !A;
  $('status').classList.add('busy');
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAudio, delay);
}

async function renderAudio() {
  const { A, B } = state;
  if (!refHz() || !B?.hz) return;
  const st = totalShift(), token = ++renderToken;
  let out, fell = false;
  if ($('mode').value === 'stretch') {
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('stretch engine timed out')), 8000));
      out = await Promise.race([stretchShift(B.channels, B.sr, st), timeout]);
      if (!out[0].some((v) => Math.abs(v) > 1e-6)) throw new Error('stretch engine returned silence');
    } catch (e) { console.warn(e); fell = true; out = B.channels.map((c) => varispeed(c, st)); }
  } else out = B.channels.map((c) => varispeed(c, st));
  const wantAtk = $('matchAtk').checked && $('mode').value === 'stretch' && !fell;
  const canAtk = wantAtk && A?.attack && B.attack && (A.attack.hasSweep || B.attack.hasSweep);
  if (canAtk) out = out.map((c, i) => applyAttackContour(B.channels[i], c, B.sr, { attackA: A.attack, attackB: B.attack, bodyShiftSemis: st }));
  const atk = canAtk ? 0 : Number($('atk').value);
  if (atk) out = out.map((c, i) => keepTransient(B.channels[i], c, B.sr, atk));
  if (token !== renderToken) return;
  if (state.matched?.url) URL.revokeObjectURL(state.matched.url);
  const blob = encodeWav(out, B.sr);
  state.matched = { channels: out, sr: B.sr, blob, url: URL.createObjectURL(blob), name: B.name.replace(/\.[^.]+$/, '') + '_matched.wav' };
  const m = detectPitch(out, B.sr);
  $('tnNote').textContent = (wantAtk && !canAtk ? 'Match attack is on, but neither sample has a pitch sweep. ' : '') + (fell ? 'The keep-length engine could not run here, so this used varispeed. ' : '') + (m.hz ? `Rendered output measures ${m.hz.toFixed(1)} Hz (${refName() === 'A' ? 'A is' : 'target is'} ${refHz().toFixed(1)} Hz)` : '');
  $('playM').disabled = false; $('cmp').disabled = !A;
  setExport(true); $('sM').textContent = state.matched.name; drawMatched();
  $('status').classList.remove('busy');
  window.__renderDone = (window.__renderDone || 0) + 1;
}

// Dials: drag around the ring, scroll, or use the arrow keys. Clicks on the centre cap are ignored.
function dialDrag(el, ready, onDeg) {
  let drag = false;
  const geo = (e) => { const r = el.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); return { deg: Math.max(-135, Math.min(135, (Math.atan2(dx, -dy) * 180) / Math.PI)), rad: Math.hypot(dx, dy) / (r.width / 2) }; };
  el.addEventListener('pointerdown', (e) => { if (!ready()) return; const g = geo(e); if (g.rad < 0.55) return; drag = true; el.setPointerCapture(e.pointerId); onDeg(g.deg, e); });
  el.addEventListener('pointermove', (e) => { if (drag) onDeg(geo(e).deg, e); });
  for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, () => { drag = false; });
}
const KEYDIR = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

// Match dial: the total shift in semitones (-12..+12), including the fine trim.
(() => {
  const mk = $('mknob'), ready = () => !!(refHz() && state.B?.hz);
  dialDrag(mk, ready, (deg) => setManual(Math.round(((deg / 135) * 12 - Number($('fine').value) / 100) * 100) / 100));
  mk.addEventListener('dblclick', () => { if (ready()) setManual(null); });
  mk.addEventListener('keydown', (e) => {
    const d = KEYDIR[e.key]; if (!d || !ready()) return;
    e.preventDefault(); setManual(Math.round(((manual ?? shiftAmount0()) + d * (e.shiftKey ? 1 : 0.1)) * 100) / 100);
  });
  $('autoBtn').onclick = () => setManual(null);
})();

/* ---------- playback ---------- */
const playing = new Map(); // live sources -> their gain node, so a stop can fade instead of clicking
function play(channels, sr, when = 0, slot = null, tag = '') {
  ac.resume();
  const b = ac.createBuffer(channels.length, channels[0].length, sr);
  channels.forEach((c, i) => b.copyToChannel(c, i));
  const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = b; src.connect(g).connect(getAnalyser());
  playing.set(src, g); src.onended = () => playing.delete(src);
  src.start(ac.currentTime + when);
  if (slot) rtaStart(slot, ac.currentTime + when, b.duration, tag);
  return b.duration;
}

/* ---------- looping: keep the sample repeating so changes can be heard as you tune ---------- */
// Hits are scheduled a little ahead of time on the audio clock. Each one reads state.matched when it is
// scheduled, so a fresh render is picked up at the next repeat without a gap or a click.
const LOOP_GAP = 0.2, loop = { kind: null, next: 0, step: 0, timer: 0 };
window.__loop = { log: [] };
const PLAY_ICON = '<svg class="i" viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>', STOP_ICON = '<svg class="i" viewBox="0 0 24 24"><path d="M7 7h10v10H7z"/></svg>';
const AB_ICON = '<svg class="i" viewBox="0 0 24 24"><path d="M4 8h12M12 4l4 4-4 4M20 16H8M12 12l-4 4 4 4"/></svg>';
const loopOn = () => $('loopBtn').getAttribute('aria-pressed') === 'true';
function syncPlayButtons() {
  $('playM').innerHTML = loop.kind === 'matched' ? `${STOP_ICON}Stop` : `${PLAY_ICON}Play matched`;
  $('cmp').innerHTML = loop.kind === 'ab' ? `${STOP_ICON}Stop` : `${AB_ICON}A / B`;
  $('loopBtn').classList.toggle('on', loopOn());
}
function loopHit() {
  const A = state.A, M = state.matched, when = loop.next - ac.currentTime;
  if (loop.kind === 'ab' && loop.step % 2 === 0) { if (!A) return null; const d = play(A.channels, A.sr, when, 'A'); window.__loop.log.push('A'); return Math.min(d, 1.2) + 0.15; }
  if (!M) return null;
  const d = play(M.channels, M.sr, when, 'B', 'matched'); window.__loop.log.push(M.url);
  return d + LOOP_GAP;
}
function loopTick() {
  while (loop.kind && loop.next < ac.currentTime + 0.15) {
    const adv = loopHit();
    if (adv == null) { loop.next = ac.currentTime + 0.05; break; } // nothing to play yet, try again shortly
    loop.next += adv; loop.step++;
  }
}
function startLoop(kind) {
  if (typeof pp !== 'undefined' && pp.on) stopProg();
  stopLoop(); ac.resume();
  loop.kind = kind; loop.next = ac.currentTime + 0.05; loop.step = 0; loop.timer = setInterval(loopTick, 25);
  loopTick(); syncPlayButtons();
}
function stopLoop(now = true) {
  clearInterval(loop.timer); loop.kind = null;
  if (now) for (const [src, g] of playing) { g.gain.setTargetAtTime(0, ac.currentTime, 0.008); try { src.stop(ac.currentTime + 0.06); } catch { /* already stopped */ } }
  syncPlayButtons();
}
function earCheck(slot) {
  const s = state[slot], st = Number($('oct' + slot).value);
  if (!s?.hz) return;
  play(st ? s.channels.map((c) => varispeed(c, st)) : s.channels, s.sr, 0, slot);
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.frequency.value = s.hz * Math.pow(2, st / 12);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  o.connect(g).connect(getAnalyser()); o.start(t); o.stop(t + 1.6);
}
$('playA').onclick = () => play(state.A.channels, state.A.sr, 0, 'A');
$('playB').onclick = () => play(state.B.channels, state.B.sr, 0, 'B');
$('playM').onclick = () => { if (loopOn()) { loop.kind === 'matched' ? stopLoop() : startLoop('matched'); } else play(state.matched.channels, state.matched.sr, 0, 'B', 'matched'); };
$('cmp').onclick = () => {
  if (loopOn()) { loop.kind === 'ab' ? stopLoop() : startLoop('ab'); return; }
  const d = play(state.A.channels, state.A.sr, 0, 'A'); play(state.matched.channels, state.matched.sr, Math.min(d, 1.2) + 0.15, 'B', 'matched');
};
$('loopBtn').onclick = () => { $('loopBtn').setAttribute('aria-pressed', String(!loopOn())); if (!loopOn() && loop.kind) stopLoop(false); syncPlayButtons(); };
// Space starts and stops the matched sample (a loop when Loop is on), unless a control has focus.
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body && !$('playM').disabled) { e.preventDefault(); $('playM').click(); } });
$('earA').onclick = () => earCheck('A');
$('earB').onclick = () => earCheck('B');

/* ---------- export ---------- */
$('dragOut').onclick = async () => {
  const m = state.matched; if (!m || $('dragOut').getAttribute('aria-disabled') === 'true') return;
  // Inside the Artifact viewer, direct downloads are blocked: use its downloads capability (it accepts .zip, not .wav).
  try {
    const dl = window.claude?.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename: m.name.replace(/\.wav$/, '.zip'), data: zipStore(m.name, new Uint8Array(await m.blob.arrayBuffer())) }); return; }
  } catch (e) { if (e?.code === 'declined') return; console.warn(e); }
  const a = document.createElement('a'); a.href = m.url; a.download = m.name; a.click();
};
$('dragOut').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('dragOut').click(); } };
$('dragOut').addEventListener('dragstart', (e) => {
  if (!state.matched || $('dragOut').getAttribute('aria-disabled') === 'true') return e.preventDefault();
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('DownloadURL', `audio/wav:${state.matched.name}:${state.matched.url}`); // Chromium: drops as a file
  e.dataTransfer.setData('text/uri-list', state.matched.url);
});

/* ---------- drop zones ---------- */
document.querySelectorAll('.zone').forEach((el) => {
  const slot = el.dataset.slot;
  const browse = () => { pendingSlot = slot; $('file').click(); };
  el.onclick = browse;
  el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); } };
  el.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); };
  el.ondragleave = () => el.classList.remove('over');
  el.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(slot, e.dataTransfer.files[0]); };
});
// Dropping anywhere else: one file fills the first empty slot, two files fill A then B.
window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = [...e.dataTransfer.files].filter((x) => x.type.startsWith('audio') || /\.(wav|aif|aiff|mp3|flac|ogg)$/i.test(x.name));
  if (f.length >= 2) { loadFile('A', f[0]); loadFile('B', f[1]); } else if (f[0]) loadFile(!state.A ? 'A' : 'B', f[0]);
});
$('file').onchange = (e) => { if (e.target.files[0]) loadFile(pendingSlot, e.target.files[0]); e.target.value = ''; };

/* ---------- options ---------- */
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  $('mode').value = b.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((o) => o.classList.toggle('on', o === b));
  update();
}));
$('matchAtk').addEventListener('change', () => { $('atkL').classList.toggle('on', $('matchAtk').checked); $('atk').disabled = $('matchAtk').checked; $('atk').title = $('matchAtk').checked ? 'Replaced by Match attack' : ''; update(); });
$('fold').addEventListener('change', () => { $('foldL').classList.toggle('on', $('fold').checked); manual = null; update(); });
['fine', 'atk'].forEach((id) => $(id).addEventListener('input', () => update(150)));
window.addEventListener('resize', () => { ['A', 'B'].forEach((s) => { if (state[s]) { drawWave(s); drawSpectrum(s); } }); drawMatched(); });
styleRanges();
window.__state = state; // for tests

/* ---------- scroll wheel: hover a dial or slider and scroll ---------- */
// Wheel up raises the value. One notch = one step; Shift = bigger steps, Alt = finer. Trackpads accumulate small deltas.
function onWheel(el, apply) {
  let acc = 0;
  el.addEventListener('wheel', (e) => {
    const steps = (() => { acc += e.deltaMode === 1 ? e.deltaY * 100 : e.deltaY; const n = Math.trunc(acc / 100); acc -= n * 100; return -n; })();
    if (!apply) return;
    e.preventDefault();
    if (steps) apply(steps, e);
  }, { passive: false });
}
onWheel($('mknob'), (n, e) => { if (refHz() && state.B?.hz) setManual(Math.round(Math.max(-12, Math.min(12, (manual ?? shiftAmount0()) + n * (e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1))) * 100) / 100); });
for (const [id, step, big] of [['fine', 1, 10], ['atk', 1, 5]]) {
  onWheel($(id), (n, e) => {
    const el = $(id); if (el.disabled) return;
    el.value = String(Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + n * (e.shiftKey ? big : step))));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/* ---------- key + chords: which notes can B be tuned to? ---------- */
const key = { roleTouched: false, hover: null, list: [], cfg: null, chords: [], progIsDefault: false, progTouched: false };
const MINORISH = ['minor', 'dorian', 'phrygian', 'minorPent'];
const PRESETS = {
  major: [['Pop', 'I V vi IV'], ['Sensitive pop', 'vi IV I V'], ['50s', 'I vi IV V'], ['Three chords', 'I IV V'], ['Rock', 'I IV V IV'], ['Jazz cadence', 'ii V I'], ['Rhythm changes', 'I vi ii V'], ['Ballad climb', 'I iii IV V'], ['Canon', 'I V vi iii IV I IV V']],
  minor: [['Epic', 'i VI III VII'], ['Minor blues', 'i iv v'], ['Dark loop', 'i VII VI VII'], ['Andalusian', 'i VII VI V'], ['Moody', 'i iv VII III'], ['Jazz minor', 'ii\u00B0 V i']],
};
// The progression lives in the text box as a list of tokens (names or numerals). Cards, drag, and the picker all edit that list.
const keyParam = () => { const root = $('keyRoot').value, scale = $('keyScale').value; return { rootPc: root === '' ? null : Number(root), scale, steps: parentSteps(scale) }; };
const progTokens = () => $('prog').value.split(/[\s,|>\u2192\u00B7\u2022-]+/).filter(Boolean);
const fmtProg = (tokens) => tokens.join(' \u00b7 ');                       // chords read as  i \u00b7 VI \u00b7 III \u00b7 VII
function setProg(tokens) { $('prog').value = fmtProg(tokens); key.progIsDefault = false; key.progTouched = true; renderKey(); }
// Picking a key fills in a starting progression, unless you have already written or changed one.
function maybeDefaultProg() {
  const k = keyParam(); if (k.rootPc == null) return;
  if (key.progIsDefault || (!key.progTouched && !$('prog').value.trim())) { $('prog').value = fmtProg(DEFAULT_PROG[k.scale].split(' ')); key.progIsDefault = true; }
}
function buildPresets() {
  const k = keyParam(), list = MINORISH.includes(k.scale) ? PRESETS.minor : PRESETS.major;
  $('progPreset').innerHTML = '<option value="">Choose\u2026</option>' + list.map(([label, nums]) => {
    const names = k.rootPc == null ? '' : parseProgression(nums, k).chords.map((c) => c.symbol).join(' ');
    const dotted = nums.split(' ').join(' \u00b7 ');
    return `<option value="${nums}">${label}: ${names ? names.split(' ').join(' \u00b7 ') : dotted}${names ? `  (${dotted})` : ''}</option>`;
  }).join('');
}
(() => {
  $('keyRoot').innerHTML = '<option value="">Choose\u2026</option>' + ROOTS.map((r, i) => `<option value="${i}">${r}</option>`).join('');
  $('keyScale').innerHTML = Object.entries(SCALES).map(([k, v]) => `<option value="${k}"${k === 'minor' ? ' selected' : ''}>${v.label}</option>`).join('');
  $('keyRole').innerHTML = Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === 'snare' ? ' selected' : ''}>${v.label}</option>`).join('');
  $('keyRole').addEventListener('change', () => { key.roleTouched = true; });
  for (const id of ['keyRoot', 'keyScale']) $(id).addEventListener('change', () => { maybeDefaultProg(); buildPresets(); renderKey(); });
  $('keyRole').addEventListener('change', () => renderKey());
  $('prog').addEventListener('blur', () => { const t = progTokens(); if (t.length) $('prog').value = fmtProg(t); });   // tidy the separators when you leave the box
  $('prog').addEventListener('input', () => { key.progIsDefault = false; key.progTouched = true; clearTimeout(key.t); key.t = setTimeout(renderKey, 180); });
  $('progPreset').addEventListener('change', () => { if ($('progPreset').value) { $('prog').value = fmtProg($('progPreset').value.split(' ')); key.progIsDefault = false; key.progTouched = true; $('progPreset').value = ''; renderKey(); } });
  $('ktX').onclick = () => { state.target = null; manual = null; update(); renderKey(); };
  buildPresets();
})();

const midiOfHz = (hz) => Math.round(69 + 12 * Math.log2(hz / 440));
function staticSemis(sl) { // B's analysis-window spectrum on the keyboard's note axis (for the ghost bars)
  const x = toMono(sl.channels), on = findOnset(x, 0.1), seg = x.subarray(on + Math.round(0.025 * sl.sr), on + Math.round(0.175 * sl.sr));
  if (seg.length < 512) return null;
  const { mag, binHz } = spectrum(seg, sl.sr, 4); let mx = 0; for (let i = 0; i < mag.length; i++) mx = Math.max(mx, mag[i]);
  return semitoneBands(Float32Array.from(mag, (m) => 20 * Math.log10(m / mx + 1e-9)), binHz, -60, 0);
}

// What a key means for B: its note, the shift it needs, where it sits in the key, and how it fits each chord.
function describeKeyNote(m) {
  const B = state.B, cfg = key.cfg; if (!B?.hz || !cfg) return '';
  const hz = midiToHz(m), shift = 12 * Math.log2(hz / B.hz), pc = ((m % 12) + 12) % 12, r = ROLES[cfg.role];
  const parts = [`<b>${describeHz(hz).note}</b> <span class="mut">${hz.toFixed(1)} Hz</span> \u00b7 ${shift >= 0 ? 'shifts B up' : 'shifts B down'} ${Math.abs(shift).toFixed(2)} st`];
  if (cfg.rootPc != null) { const rel = (pc - cfg.rootPc + 12) % 12, inKey = SCALES[cfg.scale].steps.includes(rel); parts.push(inKey ? `${INTERVALS[rel]} of the key` : '<span class="mut">outside the key</span>'); }
  if (key.chords.length) {
    const per = key.chords.map((c) => (c.roles[pc] ? `${c.roles[pc]} of ${c.symbol}` : null)), n = per.filter(Boolean).length;
    parts.push(`<b>${n}/${key.chords.length}</b> chords${n ? ` <span class="mut">(${per.filter(Boolean).join(', ')})</span>` : ''}`);
  }
  if (hz < r.allowed[0] || hz > r.allowed[1]) parts.push(`<span class="mut">outside a ${r.label.toLowerCase()}\u2019s range</span>`);
  else if (hz < r.sweet[0] || hz > r.sweet[1]) parts.push('<span class="mut">edge of the range</span>');
  const rank = key.list.findIndex((c) => c.midi === m); if (rank >= 0) parts.push(`<b>#${rank + 1}</b> suggestion`);
  return parts.join(' \u00b7 ');
}
const INTERVALS = ['root', '\u266D2nd', '2nd', '\u266D3rd', '3rd', '4th', '\u266F4th', '5th', '\u266D6th', '6th', '\u266D7th', '7th'];

function renderKey() {
  const B = state.B, root = $('keyRoot').value, tgt = state.target;
  const cfg = key.cfg = { rootPc: root === '' ? null : Number(root), scale: $('keyScale').value, role: $('keyRole').value };
  const steps = SCALES[cfg.scale].steps, kpar = keyParam(), cards = [], errors = [];
  progTokens().forEach((tok, i) => { const r = parseProgression(tok, kpar); if (r.chords[0]) cards.push({ i, chord: r.chords[0] }); else errors.push(r.errors[0] ?? tok); });
  const chords = cards.map((c) => c.chord);
  key.chords = chords;
  $('progErr').hidden = !errors.length; if (errors.length) $('progErr').textContent = `Couldn\u2019t read: ${errors.join(', ')}`;
  renderChordCards(cards, cfg.rootPc != null || chords.length > 0);
  $('progPlay').hidden = !chords.length; if (!chords.length && pp.on) stopProg();
  const keyName = cfg.rootPc == null ? '' : `${ROOTS[cfg.rootPc].split('/')[0]} ${SCALES[cfg.scale].label.toLowerCase()}`;
  $('keyStat').textContent = tgt ? `Target ${tgt.name}` : [keyName, chords.length ? `${chords.length} chords` : '', cfg.rootPc != null || chords.length ? ROLES[cfg.role].label : ''].filter(Boolean).join(' \u00b7 ') || 'Off';
  $('keyTarget').hidden = !tgt;
  if (tgt) $('ktT').textContent = `Matching B to ${tgt.name} (${tgt.hz.toFixed(1)} Hz), not sample A`;

  key.list = B?.hz ? suggestTunings(B.hz, { ...cfg, chords }) : [];
  const r = ROLES[cfg.role], cands = new Map(key.list.map((c, i) => [c.midi, { rank: i + 1, c }]));
  kb.set({
    inKey: cfg.rootPc == null ? null : new Set(steps.map((x) => (cfg.rootPc + x) % 12)),
    cov: chords.length ? chordCoverage(chords) : null, nChords: chords.length, cands,
    target: tgt ? tgt.midi ?? midiOfHz(tgt.hz) : null,
    range: [Math.ceil(69 + 12 * Math.log2(r.allowed[0] / 440)), Math.floor(69 + 12 * Math.log2(r.allowed[1] / 440))],
    markers: [{ hz: B?.hz, label: 'B', color: '#4fe3f0' }, { hz: state.A?.hz, label: 'A', color: '#ff8a1f' }, ...(tgt ? [{ hz: tgt.hz, label: tgt.name, color: '#c9ccff' }] : [])],
    ghost: B ? staticSemis(B) : null,
  });
  showKbInfo();
  $('keyNote').textContent = !B?.hz ? 'Drop sample B to see which notes it can be tuned to.' : cfg.rootPc == null && !chords.length ? 'Pick a key, type a chord progression, or both. The keys light up for notes that fit.' : `Typical ${r.label.toLowerCase()} range ${r.sweet[0]}\u2013${r.sweet[1]} Hz (darker keys are out of range). Treat these as suggestions and check by ear with Loop.`;
}

const NOTE_PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function renderChordCards(cards, showAdd) {
  const strip = $('chordStrip'); strip.textContent = '';
  cards.forEach(({ i, chord }) => {
    const el = document.createElement('div'); el.className = 'chord'; el.draggable = true;
    el.innerHTML = `<b>${chord.symbol.split('/')[0]}</b><i>${chord.numeral || ''}</i><button class="x" title="Remove this chord"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    el.title = `${chord.symbol}: ${chord.tones.map((t) => NOTE_PC[t]).join(' ')}. Click to change it, drag to move it.`;
    el.onmouseenter = () => kb.set({ hoverTones: new Set(chord.tones) }); el.onmouseleave = () => kb.set({ hoverTones: null });
    el.querySelector('.x').onclick = (e) => { e.stopPropagation(); const t = progTokens(); t.splice(i, 1); setProg(t); };
    el.onclick = () => chordDlg.open({ index: i, chord });
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); strip.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isNaN(from) || from === i) return;
      const t = progTokens(), [m] = t.splice(from, 1); t.splice(i, 0, m); setProg(t);
    });
    strip.appendChild(el);
  });
  if (showAdd) { const add = document.createElement('button'); add.className = 'chord add'; add.textContent = '+'; add.title = 'Add a chord'; add.onclick = () => chordDlg.open({ index: null, chord: null }); strip.appendChild(add); }
}

const chordDlg = createChordDialog({
  ac, getKey: () => { const k = keyParam(); return { rootPc: k.rootPc, steps: k.steps, scale: k.scale }; },
  onApply: (token, st) => { const t = progTokens(); if (st.index == null || st.index >= t.length) { t.push(token); st.index = t.length - 1; } else t[st.index] = token; setProg(t); },
  onRemove: (st) => { if (st.index == null) return; const t = progTokens(); t.splice(st.index, 1); setProg(t); },
});

// Hear the progression: soft chord pads, with the matched sample hitting twice per chord.
const BAR = 1.6, pp = { on: false, i: 0, next: 0, timer: 0 };
function syncProgBtn() { $('progPlay').classList.toggle('on', pp.on); $('progPlay').innerHTML = pp.on ? `${STOP_ICON}<span>Stop</span>` : `${PLAY_ICON}<span>Hear it with the chords</span>`; }
function progTick() {
  while (pp.on && pp.next < ac.currentTime + 0.15) {
    const n = key.chords.length, idx = pp.i % n, when = pp.next - ac.currentTime, M = state.matched;
    playChord(ac, key.chords[idx], when, BAR * 0.98);
    if (M) { play(M.channels, M.sr, when, 'B', 'matched'); play(M.channels, M.sr, when + BAR / 2, 'B', 'matched'); }
    setTimeout(() => { document.querySelectorAll('#chordStrip .chord').forEach((el) => el.classList.remove('now')); document.querySelectorAll('#chordStrip .chord:not(.add)')[idx]?.classList.add('now'); }, Math.max(0, when * 1000));
    pp.next += BAR; pp.i++;
  }
}
function startProg() {
  if (!key.chords.length) return;
  stopLoop(true); stopProg(); ac.resume();
  pp.on = true; pp.i = 0; pp.next = ac.currentTime + 0.1; pp.timer = setInterval(progTick, 25); progTick(); syncProgBtn();
}
function stopProg() {
  if (!pp.on && !pp.timer) return;
  clearInterval(pp.timer); pp.on = false; pp.timer = 0; stopPads(ac); stopLoop(true);
  document.querySelectorAll('#chordStrip .chord').forEach((el) => el.classList.remove('now')); syncProgBtn();
}
$('progPlay').onclick = () => (pp.on ? stopProg() : startProg());

function showKbInfo() {
  const el = $('kbInfo'), tgt = state.target;
  if (key.hover != null) { el.innerHTML = describeKeyNote(key.hover); return; }
  if (tgt) { el.innerHTML = `Target: ${describeKeyNote(tgt.midi ?? midiOfHz(tgt.hz))}`; return; }
  const c = key.list[0];
  el.innerHTML = c ? `Best fit: ${describeKeyNote(c.midi)}` : '';
}

const kb = createKeyboard($('kbd'), {
  onHover: (m) => { key.hover = m; showKbInfo(); },
  onPick: (m) => { if (!state.B?.hz) return; const hz = midiToHz(m); state.target = { hz, name: describeHz(hz).note, midi: m }; manual = null; update(); renderKey(); },
});
$('keybar').addEventListener('toggle', () => kb.draw());
window.__kb = { centerOf: (m) => kb.centerOf(m), list: () => key.list.map((c) => ({ note: c.note, midi: c.midi, covered: c.fit.covered, total: c.fit.total })), chords: () => key.chords.map((c) => c.symbol) };
renderKey();
