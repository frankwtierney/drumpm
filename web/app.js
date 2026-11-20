import { detectPitch, matchSemitones, describeHz, spectrum, toMono, findOnset } from '../src/detect.js';
import { stretchShift, varispeed, keepTransient, encodeWav } from './shift.js';

const $ = (id) => document.getElementById(id);
const ac = new (window.AudioContext || window.webkitAudioContext)();
const state = { A: null, B: null, matched: null };
const NS = 'http://www.w3.org/2000/svg';
const ICON = {
  up: '<svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  dn: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  ok: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
};
let pendingSlot = null;

/* ---------- loading ---------- */
async function loadFile(slot, file) {
  $('status').classList.add('busy');
  try {
    const buf = await ac.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice());
    const det = detectPitch(channels, buf.sampleRate);
    state[slot] = { name: file.name, sr: buf.sampleRate, channels, det, hz: det.hz };
    manual = null;
    render(slot);
    await update();
  } catch (e) {
    console.error(e);
    $('s' + slot).textContent = 'Could not read ' + file.name;
  } finally { $('status').classList.remove('busy'); }
}

/* ---------- per-sample view ---------- */
function render(slot) {
  const s = state[slot], d = s.det;
  document.querySelector(`.zone[data-slot=${slot}]`).classList.add('has');
  $('p' + slot).textContent = d.hz ? d.note : 'N/A';
  $('cen' + slot).textContent = d.hz ? `${d.cents >= 0 ? '+' : ''}${d.cents} cents` : 'no pitch';
  $('hz' + slot).innerHTML = d.hz ? `${d.hz.toFixed(1)}<small>Hz</small>` : `&ndash;<small>Hz</small>`;
  $('s' + slot).textContent = s.name;
  $('conf' + slot).dataset.l = !d.hz ? 0 : d.confidence > 0.75 ? 3 : d.confidence > 0.45 ? 2 : 1;
  $('confT' + slot).textContent = !d.hz ? 'No pitch found' : d.confidence > 0.75 ? 'Confident' : d.confidence > 0.45 ? 'Fairly sure' : 'Unsure, pick a partial';
  const k = $('k' + slot); k.textContent = '';
  if ((d.peaks || []).length) {
    const l = document.createElement('span'); l.className = 'lbl'; l.textContent = 'Pitch candidates:'; l.title = 'Detected frequency peaks. Click one to use it as the pitch.'; k.appendChild(l);
  }
  for (const p of d.peaks || []) {
    const b = document.createElement('button'); b.className = Math.abs(p.hz - s.hz) < 0.01 ? 'sel' : '';
    b.textContent = p.hz.toFixed(0) + ' Hz'; b.title = `${p.hz.toFixed(1)} Hz (${p.db.toFixed(0)} dB). Click to use this pitch.`;
    b.onclick = () => { s.hz = p.hz; Object.assign(s.det, describeHz(p.hz), { hz: p.hz }); render(slot); update(); };
    k.appendChild(b);
  }
  setKnob(slot, d.hz);
  drawSpectrum(slot);
  drawWave(slot);
  $('play' + slot).disabled = $('ear' + slot).disabled = false;
}

function sizeCanvas(cv) {
  const dpr = devicePixelRatio || 1, w = (cv.width = Math.max(1, cv.clientWidth * dpr)), h = (cv.height = Math.max(1, cv.clientHeight * dpr));
  return { g: cv.getContext('2d'), w, h, dpr };
}

function drawWave(slot) {
  const s = state[slot]; if (!s) return;
  const { g, w, h, dpr } = sizeCanvas($('w' + slot)), x = toMono(s.channels), n = x.length, color = slot === 'A' ? '#ff8a1f' : '#4fe3f0';
  g.clearRect(0, 0, w, h);
  // analysis window (where the pitch is read from)
  const on = findOnset(x, 0.1), a0 = on + 0.025 * s.sr, a1 = on + 0.175 * s.sr;
  g.fillStyle = color + '22'; g.fillRect((a0 / n) * w, 0, ((a1 - a0) / n) * w, h);
  g.strokeStyle = color; g.lineWidth = 1 * dpr;
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
  const step = Math.max(1, Math.floor(n / w)), mid = h / 2;
  g.beginPath();
  for (let px = 0; px < w; px++) {
    let mn = 0, mx = 0; const i0 = Math.floor((px / w) * n);
    for (let i = i0; i < Math.min(n, i0 + step); i++) { if (x[i] < mn) mn = x[i]; if (x[i] > mx) mx = x[i]; }
    g.moveTo(px + .5, mid - (mx / peak) * mid * 0.86); g.lineTo(px + .5, mid - (mn / peak) * mid * 0.86 + 1);
  }
  g.stroke();
  g.strokeStyle = '#ffffff30'; g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
}

function drawSpectrum(slot) {
  const s = state[slot]; if (!s) return;
  const { g, w, h, dpr } = sizeCanvas($('c' + slot)), x = toMono(s.channels), on = findOnset(x, 0.1);
  g.clearRect(0, 0, w, h);
  const seg = x.subarray(on + Math.round(0.025 * s.sr), on + Math.round(0.175 * s.sr));
  if (seg.length < 512) return;
  const { mag, binHz } = spectrum(seg, s.sr, 4), fmax = 1000, bins = Math.floor(fmax / binHz);
  let mx = 0; for (let i = 0; i < bins; i++) mx = Math.max(mx, mag[i]);
  const color = slot === 'A' ? '#ff8a1f' : '#4fe3f0';
  g.strokeStyle = color; g.lineWidth = 1.4 * dpr; g.beginPath();
  for (let i = 0; i < bins; i++) {
    const px = (i / bins) * w, py = h - 4 * dpr - Math.max(0, (20 * Math.log10(mag[i] / mx + 1e-6) + 60) / 60) * (h - 8 * dpr);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();
  if (s.hz && s.hz < fmax) { g.strokeStyle = '#ffffffaa'; g.setLineDash([3 * dpr, 4 * dpr]); const px = (s.hz / fmax) * w; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke(); g.setLineDash([]); }
}

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
function shiftAmount0() { return matchSemitones(state.A.hz, state.B.hz, { foldOctave: $('fold').checked }); }
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
  const { A, B } = state, ready = !!(A?.hz && B?.hz);
  $('mknob').classList.toggle('live', ready);
  $('autoBtn').hidden = !ready;
  $('autoBtn').classList.toggle('on', manual === null);
  $('autoT').textContent = manual === null ? 'Auto' : 'Manual \u00b7 reset';
  if (!ready) {
    $('shiftBig').textContent = '\u2013'; setMatch(null); setTuner(null); $('tnNote').textContent = '';
    $('distance').innerHTML = `<span class="hint">${!A && !B ? 'Drop a reference (1) and a sample to retune (2)' : !A ? 'Now drop the reference sample (1)' : 'Now drop the sample to retune (2)'}</span>`;
    $('playM').disabled = $('cmp').disabled = $('dl').disabled = $('dragOut').disabled = true; return;
  }
  const base = shiftAmount0(), st = totalShift();
  const dist = Math.abs(base), whole = Math.floor(dist + 1e-9), cts = Math.round((dist - whole) * 100);
  const [w2, c2] = cts === 100 ? [whole + 1, 0] : [whole, cts];
  $('shiftBig').textContent = (st >= 0 ? '+' : '\u2212') + Math.abs(st).toFixed(2);
  setMatch(st); setTuner(st - base);
  $('distance').innerHTML = dist < 0.005
    ? `<span class="ar ok">${ICON.ok}</span><span>B is already in tune with A</span>`
    : `<span class="ar ${base < 0 ? 'dn' : 'up'}">${base < 0 ? ICON.dn : ICON.up}</span><span>B is ${w2} st ${c2}\u00a2 ${base < 0 ? 'above' : 'below'} A<small>Needs a shift ${base < 0 ? 'down' : 'up'} of ${Math.abs(base).toFixed(2)} st</small></span>`;
  $('status').classList.add('busy');
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAudio, delay);
}

async function renderAudio() {
  const { A, B } = state;
  if (!A?.hz || !B?.hz) return;
  const st = totalShift(), token = ++renderToken;
  let out;
  if ($('mode').value === 'stretch') out = await stretchShift(B.channels, B.sr, st);
  else out = B.channels.map((c) => varispeed(c, st));
  const atk = Number($('atk').value);
  if (atk) out = out.map((c, i) => keepTransient(B.channels[i], c, B.sr, atk));
  if (token !== renderToken) return;
  if (state.matched?.url) URL.revokeObjectURL(state.matched.url);
  const blob = encodeWav(out, B.sr);
  state.matched = { channels: out, sr: B.sr, blob, url: URL.createObjectURL(blob), name: B.name.replace(/\.[^.]+$/, '') + '_matched.wav' };
  const m = detectPitch(out, B.sr);
  $('tnNote').textContent = m.hz ? `Rendered output measures ${m.hz.toFixed(1)} Hz (A is ${A.hz.toFixed(1)} Hz)` : '';
  $('playM').disabled = $('cmp').disabled = $('dl').disabled = $('dragOut').disabled = false;
  $('dragOut').classList.add('ready');
  $('status').classList.remove('busy');
  window.__renderDone = (window.__renderDone || 0) + 1;
}

// Dial interaction: drag to set the shift by hand, arrows to nudge, double-click for auto.
(() => {
  const mk = $('mknob'); let dragging = false;
  const ready = () => !!(state.A?.hz && state.B?.hz);
  const fromEvent = (e) => {
    const r = mk.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const deg = Math.max(-135, Math.min(135, (Math.atan2(dx, -dy) * 180) / Math.PI));
    return Math.round((deg / 135) * 120) / 10;
  };
  mk.addEventListener('pointerdown', (e) => { if (!ready()) return; dragging = true; mk.setPointerCapture(e.pointerId); setManual(fromEvent(e)); });
  mk.addEventListener('pointermove', (e) => { if (dragging) setManual(fromEvent(e)); });
  mk.addEventListener('pointerup', () => { dragging = false; });
  mk.addEventListener('dblclick', () => { if (ready()) setManual(null); });
  mk.addEventListener('keydown', (e) => {
    if (!ready()) return;
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!d) return;
    e.preventDefault(); setManual(Math.round(((manual ?? shiftAmount0()) + d * (e.shiftKey ? 1 : 0.1)) * 100) / 100);
  });
  $('autoBtn').onclick = () => setManual(null);
})();

/* ---------- playback ---------- */
function play(channels, sr, when = 0) {
  ac.resume();
  const b = ac.createBuffer(channels.length, channels[0].length, sr);
  channels.forEach((c, i) => b.copyToChannel(c, i));
  const src = ac.createBufferSource(); src.buffer = b; src.connect(ac.destination); src.start(ac.currentTime + when);
  return b.duration;
}
function earCheck(slot) {
  const s = state[slot], st = Number($('oct' + slot).value);
  if (!s?.hz) return;
  play(st ? s.channels.map((c) => varispeed(c, st)) : s.channels, s.sr);
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.frequency.value = s.hz * Math.pow(2, st / 12);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 1.6);
}
$('playA').onclick = () => play(state.A.channels, state.A.sr);
$('playB').onclick = () => play(state.B.channels, state.B.sr);
$('playM').onclick = () => play(state.matched.channels, state.matched.sr);
$('cmp').onclick = () => { const d = play(state.A.channels, state.A.sr); play(state.matched.channels, state.matched.sr, Math.min(d, 1.2) + 0.15); };
$('earA').onclick = () => earCheck('A');
$('earB').onclick = () => earCheck('B');

/* ---------- export ---------- */
$('dl').onclick = () => { const a = document.createElement('a'); a.href = state.matched.url; a.download = state.matched.name; a.click(); };
$('dragOut').addEventListener('dragstart', (e) => {
  if (!state.matched) return e.preventDefault();
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
$('fold').addEventListener('change', () => { $('foldL').classList.toggle('on', $('fold').checked); manual = null; update(); });
['fine', 'atk'].forEach((id) => $(id).addEventListener('input', () => update(150)));
window.addEventListener('resize', () => ['A', 'B'].forEach((s) => { if (state[s]) { drawWave(s); drawSpectrum(s); } }));
styleRanges();
window.__state = state; // for tests
