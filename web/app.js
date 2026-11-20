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
  $('p' + slot).textContent = d.hz ? d.note : 'N/A';
  $('cen' + slot).textContent = d.hz ? `${d.cents >= 0 ? '+' : ''}${d.cents} cents` : 'no pitch';
  $('hz' + slot).textContent = d.hz ? `${d.hz.toFixed(1)} Hz` : '- Hz';
  $('s' + slot).textContent = d.hz ? `${s.name} / ${(d.confidence * 100).toFixed(0)}% confidence${d.confidence < 0.5 ? ' / low: try another peak' : ''}` : s.name;
  setKnob(slot, d.hz);
  const k = $('k' + slot); k.textContent = '';
  for (const p of d.peaks || []) {
    const b = document.createElement('button'); b.className = Math.abs(p.hz - s.hz) < 0.01 ? 'sel' : '';
    b.textContent = `${p.hz.toFixed(1)} Hz (${p.db.toFixed(0)} dB)`;
    b.onclick = () => { s.hz = p.hz; Object.assign(s.det, describeHz(p.hz), { hz: p.hz }); render(slot); update(); };
    k.appendChild(b);
  }
  drawSpectrum($('c' + slot), s);
  $('play' + slot).disabled = $('ear' + slot).disabled = false;
}

function drawSpectrum(cv, s, slot) {
  slot = slot || (s === state.A ? 'A' : 'B');
  const dpr = devicePixelRatio || 1, w = (cv.width = cv.clientWidth * dpr), h = (cv.height = cv.clientHeight * dpr);
  const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
  const x = toMono(s.channels), on = Math.max(0, x.findIndex((v) => Math.abs(v) > 0.1 * Math.max(...x.map(Math.abs).slice(0, 20000))));
  const seg = x.subarray(on + Math.round(0.025 * s.sr), on + Math.round(0.175 * s.sr));
  if (seg.length < 512) return;
  const { mag, binHz } = spectrum(seg, s.sr, 4), fmax = 1000, bins = Math.floor(fmax / binHz);
  let mx = 0; for (let i = 0; i < bins; i++) mx = Math.max(mx, mag[i]);
  const css = getComputedStyle(document.body);
  g.strokeStyle = slot === 'A' ? '#ff8a1f' : '#4fe3f0'; g.lineWidth = 1.5 * dpr; g.beginPath();
  for (let i = 0; i < bins; i++) {
    const px = (i / bins) * w, py = h - Math.max(0, (20 * Math.log10(mag[i] / mx + 1e-6) + 60) / 60) * h;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();
  if (s.hz && s.hz < fmax) { g.strokeStyle = '#ffffffcc'; g.lineWidth = 1.5 * dpr; const px = (s.hz / fmax) * w; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke(); }
}

function shiftAmount0() {
  const { A, B } = state;
  return matchSemitones(A.hz, B.hz, { foldOctave: $('fold').checked });
}
function shiftAmount() {
  const { A, B } = state;
  if (!A?.hz || !B?.hz) return null;
  return shiftAmount0() + Number($('fine').value) / 100;
}

let renderToken = 0;
async function update() {
  $('fineV').textContent = $('fine').value; $('atkV').textContent = $('atk').value; styleRanges();
  const st = shiftAmount();
  if (st === null) { $('distance').textContent = 'Load both samples'; $('shiftInfo').textContent = ''; $('playM').disabled = $('dl').disabled = true; return; }
  const base = shiftAmount0(), dist = Math.abs(base), whole = Math.floor(dist + 1e-9), cts = Math.round((dist - whole) * 100);
  const [w2, c2] = cts === 100 ? [whole + 1, 0] : [whole, cts];
  $('distance').innerHTML = Math.abs(base) < 0.005 ? 'B is in tune with A'
    : `B is <em>${w2} st ${c2} cents</em><br>${base < 0 ? 'above' : 'below'} A &middot; shift <span class="${base < 0 ? 'dn' : ''}">${base < 0 ? 'down' : 'up'}</span>`;
  $('shiftInfo').textContent = `SHIFT B BY ${st >= 0 ? '+' : ''}${st.toFixed(2)} semitones`;
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
  $('status').textContent = `RENDERED ${(out[0].length / B.sr * 1000).toFixed(0)} MS`;
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

// Ear check: play the sample (optionally pitched down) together with a sine at the detected pitch.
function earCheck(slot) {
  const s = state[slot], st = Number($('oct' + slot).value);
  if (!s?.hz) return;
  ac.resume();
  const ch = st ? s.channels.map((c) => varispeed(c, st)) : s.channels;
  play(ch, s.sr);
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.frequency.value = s.hz * Math.pow(2, st / 12);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 1.6);
}
$('earA').onclick = () => earCheck('A');
$('earB').onclick = () => earCheck('B');

// ---- knob visuals ----
const ARC = 358, FMIN = 30, FMAX = 800; // arc length in svg units for 270 degrees at r=76
function frac(hz) { return Math.max(0, Math.min(1, Math.log(hz / FMIN) / Math.log(FMAX / FMIN))); }
function setKnob(slot, hz) {
  const svg = document.querySelector(`[data-knob=${slot}]`), f = hz ? frac(hz) : 0;
  svg.querySelector('.arc').setAttribute('stroke-dasharray', `${f * ARC} 600`);
  svg.querySelector('.dot').style.transform = `rotate(${-135 + 270 * f}deg)`;
}
document.querySelectorAll('.ticks').forEach((g) => {
  for (let i = 0; i <= 54; i++) {
    const a = ((135 + (270 * i) / 54) * Math.PI) / 180, major = i % 9 === 0, r1 = 90, r2 = major ? 84 : 87;
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('class', 'tick'); l.setAttribute('x1', 100 + r1 * Math.cos(a)); l.setAttribute('y1', 100 + r1 * Math.sin(a));
    l.setAttribute('x2', 100 + r2 * Math.cos(a)); l.setAttribute('y2', 100 + r2 * Math.sin(a)); g.appendChild(l);
  }
});
function styleRanges() {
  for (const id of ['fine', 'atk']) {
    const el = $(id), p = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--a', p + '%');
  }
  $('fine').style.background = (() => { const p = (($('fine').value - -100) / 200) * 100, c = '#ff8a1f', d = '#14162299';
    return p >= 50 ? `linear-gradient(90deg,${d} 50%,${c} 50%,${c} ${p}%,${d} ${p}%)` : `linear-gradient(90deg,${d} ${p}%,${c} ${p}%,${c} 50%,${d} 50%)`; })();
}
styleRanges();
