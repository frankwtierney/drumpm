import { detectPitch, matchSemitones, describeHz, spectrum, toMono } from '../src/detect.js';
import { stretchShift, varispeed, keepTransient, encodeWav } from './shift.js';

const $ = (id) => document.getElementById(id);
const ac = new (window.AudioContext || window.webkitAudioContext)();
const state = { A: null, B: null, matched: null };
let pendingSlot = null;

async function loadFile(slot, file) {
  $('status').textContent = `Decoding ${file.name}...`;
  const buf = await ac.decodeAudioData(await file.arrayBuffer());
  const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice());
  const det = detectPitch(channels, buf.sampleRate);
  state[slot] = { name: file.name, sr: buf.sampleRate, channels, det, hz: det.hz, buf };
  render(slot);
  $('status').textContent = '';
  await update();
}

function render(slot) {
  const s = state[slot], d = s.det;
  $('p' + slot).textContent = d.hz ? `${d.note} ${d.cents >= 0 ? '+' : ''}${d.cents}c` : 'no pitch';
  $('s' + slot).textContent = d.hz ? `${s.name}: ${d.hz.toFixed(1)} Hz, confidence ${(d.confidence * 100).toFixed(0)}% (${d.method})${d.confidence < 0.5 ? ' - low confidence, pick a peak below' : ''}` : s.name;
  const k = $('k' + slot); k.textContent = '';
  for (const p of d.peaks || []) {
    const b = document.createElement('button'); b.className = 'ghost' + (Math.abs(p.hz - s.hz) < 0.01 ? ' sel' : '');
    b.textContent = `${p.hz.toFixed(1)} Hz (${p.db.toFixed(0)} dB)`;
    b.onclick = () => { s.hz = p.hz; Object.assign(s.det, describeHz(p.hz), { hz: p.hz }); render(slot); update(); };
    k.appendChild(b);
  }
  drawSpectrum($('c' + slot), s);
  $('play' + slot).disabled = false;
}

function drawSpectrum(cv, s) {
  const dpr = devicePixelRatio || 1, w = (cv.width = cv.clientWidth * dpr), h = (cv.height = cv.clientHeight * dpr);
  const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
  const x = toMono(s.channels), on = Math.max(0, x.findIndex((v) => Math.abs(v) > 0.1 * Math.max(...x.map(Math.abs).slice(0, 20000))));
  const seg = x.subarray(on + Math.round(0.025 * s.sr), on + Math.round(0.175 * s.sr));
  if (seg.length < 512) return;
  const { mag, binHz } = spectrum(seg, s.sr, 4), fmax = 1000, bins = Math.floor(fmax / binHz);
  let mx = 0; for (let i = 0; i < bins; i++) mx = Math.max(mx, mag[i]);
  const css = getComputedStyle(document.body);
  g.strokeStyle = css.getPropertyValue('--dim') || '#888'; g.beginPath();
  for (let i = 0; i < bins; i++) {
    const px = (i / bins) * w, py = h - Math.max(0, (20 * Math.log10(mag[i] / mx + 1e-6) + 60) / 60) * h;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();
  if (s.hz && s.hz < fmax) { g.strokeStyle = css.getPropertyValue('--accent'); g.lineWidth = 2 * dpr; const px = (s.hz / fmax) * w; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke(); }
}

function shiftAmount() {
  const { A, B } = state;
  if (!A?.hz || !B?.hz) return null;
  return matchSemitones(A.hz, B.hz, { foldOctave: $('fold').checked }) + Number($('fine').value) / 100;
}

let renderToken = 0;
async function update() {
  $('fineV').textContent = $('fine').value; $('atkV').textContent = $('atk').value;
  const st = shiftAmount();
  if (st === null) { $('shiftInfo').textContent = 'Load both samples'; $('playM').disabled = $('dl').disabled = true; return; }
  $('shiftInfo').textContent = `Shift B by ${st >= 0 ? '+' : ''}${st.toFixed(2)} semitones`;
  const token = ++renderToken, B = state.B;
  $('status').textContent = 'Rendering...';
  let out;
  if ($('mode').value === 'stretch') out = await stretchShift(B.channels, B.sr, st);
  else out = B.channels.map((c) => varispeed(c, st));
  const atk = Number($('atk').value);
  if (atk) out = out.map((c, i) => keepTransient(B.channels[i], c, B.sr, atk));
  if (token !== renderToken) return;
  state.matched = { channels: out, sr: B.sr };
  $('playM').disabled = $('dl').disabled = false;
  $('status').textContent = `Rendered (${(out[0].length / B.sr * 1000).toFixed(0)} ms).`;
  window.__renderDone = (window.__renderDone || 0) + 1;
}

function play(channels, sr) {
  ac.resume();
  const b = ac.createBuffer(channels.length, channels[0].length, sr);
  channels.forEach((c, i) => b.copyToChannel(c, i));
  const src = ac.createBufferSource(); src.buffer = b; src.connect(ac.destination); src.start();
}

document.querySelectorAll('.drop').forEach((el) => {
  const slot = el.dataset.slot;
  el.onclick = () => { pendingSlot = slot; $('file').click(); };
  el.ondragover = (e) => { e.preventDefault(); el.classList.add('over'); };
  el.ondragleave = () => el.classList.remove('over');
  el.ondrop = (e) => { e.preventDefault(); el.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(slot, e.dataTransfer.files[0]); };
});
$('file').onchange = (e) => { if (e.target.files[0]) loadFile(pendingSlot, e.target.files[0]); e.target.value = ''; };
$('playA').onclick = () => play(state.A.channels, state.A.sr);
$('playB').onclick = () => play(state.B.channels, state.B.sr);
$('playM').onclick = () => play(state.matched.channels, state.matched.sr);
$('dl').onclick = () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(encodeWav(state.matched.channels, state.matched.sr));
  a.download = state.B.name.replace(/\.[^.]+$/, '') + '_matched.wav'; a.click();
};
['mode', 'fine', 'atk', 'fold'].forEach((id) => $(id).addEventListener('input', update));
window.__state = state; // for tests
