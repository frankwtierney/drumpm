import { fft, nextPow2 } from './fft.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function hzToMidi(hz) { return 69 + 12 * Math.log2(hz / 440); }
export function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
export function describeHz(hz) {
  const m = hzToMidi(hz);
  const r = Math.round(m);
  return {
    midi: m,
    note: NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1),
    cents: Math.round((m - r) * 100),
  };
}

/** Mix to mono (accepts Float32Array or array of channels). */
export function toMono(channels) {
  if (channels instanceof Float32Array) return channels;
  if (channels.length === 1) return channels[0];
  const n = channels[0].length, out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** First sample where |x| crosses a fraction of the peak. */
export function findOnset(x, frac = 0.1) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const th = peak * frac;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= th) return i;
  return 0;
}

/** Simple 2nd-order low-pass (biquad, RBJ) applied forward, to suppress noise/wires above the tonal range. */
function lowpass(x, sr, fc) {
  const w0 = (2 * Math.PI * fc) / sr, cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * 0.7071);
  const b0 = (1 - cos) / 2, b1 = 1 - cos, b2 = b0, a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/**
 * Magnitude spectrum of a Hann-windowed segment, zero-padded for finer peak interpolation.
 * Returns {mag (linear), binHz}.
 */
export function spectrum(seg, sr, pad = 4) {
  const n = seg.length, size = nextPow2(n * pad);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = seg[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const half = size / 2, mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return { mag, binHz: sr / size };
}

/** Local maxima in [fmin,fmax] with parabolic (log-magnitude) interpolation. */
export function findPeaks(mag, binHz, fmin, fmax) {
  const lo = Math.max(2, Math.floor(fmin / binHz)), hi = Math.min(mag.length - 2, Math.ceil(fmax / binHz));
  const peaks = [];
  for (let i = lo; i <= hi; i++) {
    if (mag[i] > mag[i - 1] && mag[i] >= mag[i + 1] && mag[i] > 0) {
      const a = Math.log(mag[i - 1] + 1e-12), b = Math.log(mag[i] + 1e-12), c = Math.log(mag[i + 1] + 1e-12);
      const d = a - 2 * b + c;
      const off = d === 0 ? 0 : (0.5 * (a - c)) / d;
      peaks.push({ hz: (i + off) * binHz, mag: Math.exp(b - 0.25 * (a - c) * off) });
    }
  }
  return peaks;
}

/**
 * YIN (de Cheveigne & Kawahara 2002) on a single frame. Returns {hz, clarity} (clarity = 1 - d').
 */
export function yin(frame, sr, fmin = 25, fmax = 1000, threshold = 0.15) {
  const tauMax = Math.min(Math.floor(sr / fmin), Math.floor(frame.length / 2) - 1);
  const tauMin = Math.max(2, Math.floor(sr / fmax));
  const W = Math.floor(frame.length / 2);
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = frame[i] - frame[i + tau]; s += v * v; }
    d[tau] = s;
  }
  const cm = new Float64Array(tauMax + 1);
  cm[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = run ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cm[t] < threshold) { while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++; tau = t; break; }
  }
  if (tau < 0) { // fall back to global minimum
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (cm[t] < cm[best]) best = t;
    tau = best;
  }
  let t0 = tau;
  if (tau > 1 && tau < tauMax) {
    const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1], den = a - 2 * b + c;
    if (den !== 0) t0 = tau + (0.5 * (a - c)) / den;
  }
  return { hz: sr / t0, clarity: Math.max(0, 1 - cm[tau]) };
}

/** Analyse one window starting `start` samples in. Returns spectral peaks + a YIN estimate. */
function analyseWindow(x, sr, start, len, fmin, fmax) {
  len = Math.min(len, x.length - start);
  if (len < 512) return null;
  const seg = x.subarray(start, start + len);
  const { mag, binHz } = spectrum(seg, sr, 4);
  const all = findPeaks(mag, binHz, fmin, fmax);
  if (!all.length) return null;
  const maxMag = Math.max(...all.map((p) => p.mag));
  const peaks = all.map((p) => ({ ...p, db: 20 * Math.log10(p.mag / maxMag) })).sort((a, b) => b.mag - a.mag);
  const y = yin(seg.subarray(0, Math.min(seg.length, 4096)), sr, fmin, fmax);
  return { peaks, yin: y };
}

/**
 * Detect the dominant tonal pitch of a drum hit.
 * Strategy: low-pass to the tonal range, analyse a window after the attack (past the click and
 * pitch sweep), choose the lowest strong spectral peak, and cross-check with YIN. Drum modes are
 * inharmonic, so several candidate peaks are returned so a caller/user can override the choice.
 * Kick-style pitch sweeps are handled by comparing an early and a later window and keeping the
 * later (settled) one when they differ.
 */
export function detectPitch(input, sr, opts = {}) {
  const { fmin = 30, fmax = 800, skipMs = 25, laterMs = 70, windowMs = 150, peakFloorDb = -24 } = opts;
  const x0 = toMono(input);
  const fc = Math.min(fmax * 1.5, sr / 2.2);
  const x = lowpass(lowpass(x0, sr, fc), sr, fc);
  const onset = findOnset(x0, 0.1);
  const ms = (m) => Math.round((m / 1000) * sr);

  const early = analyseWindow(x, sr, onset + ms(skipMs), ms(windowMs), fmin, fmax);
  if (!early) return { hz: null, confidence: 0, peaks: [], reason: 'sample too short or no tonal content' };
  const later = analyseWindow(x, sr, onset + ms(laterMs), ms(windowMs), fmin, fmax);

  const pick = (w) => {
    const strong = w.peaks.filter((p) => p.db >= -12).sort((a, b) => a.hz - b.hz);
    return strong[0];
  };
  let win = early, spec = pick(early), settled = true;
  if (later) {
    const sl = pick(later);
    // Pitch still moving between windows (kick sweep): trust the later, settled window.
    if (Math.abs(Math.log2(sl.hz / spec.hz)) > 0.02 && later.peaks[0].db === 0) { win = later; spec = sl; settled = false; }
  }

  // YIN is only trusted if the spectrum actually has a peak there (avoids sub-octave errors
  // that YIN makes on inharmonic partials).
  const y = win.yin;
  const nearPeak = win.peaks.find((p) => Math.abs(Math.log2(p.hz / y.hz)) < 0.03 && p.db > -20);
  let hz = spec.hz, confidence, method = 'spectral';
  if (Math.abs(Math.log2(y.hz / spec.hz)) < 0.05) {
    confidence = Math.min(1, 0.6 + 0.4 * y.clarity);
    method = 'spectral+yin';
    hz = y.clarity > 0.9 ? (y.hz + spec.hz) / 2 : spec.hz;
  } else if (nearPeak && y.clarity > 0.9) {
    hz = y.hz; method = 'yin'; confidence = 0.6 * y.clarity;
  } else {
    confidence = 0.35 * (spec.db >= -3 ? 1 : 0.7); // inharmonic / noisy: flag as uncertain
  }
  const peaks = win.peaks.filter((p) => p.db >= -18).slice(0, 6);
  return { hz, confidence, method, peaks, sweeping: !settled, ...describeHz(hz), yin: y };
}

/** Semitones to shift B so its pitch equals A's. */
export function matchSemitones(hzA, hzB, { foldOctave = false } = {}) {
  let st = 12 * Math.log2(hzA / hzB);
  if (foldOctave) st = ((((st + 6) % 12) + 12) % 12) - 6;
  return st;
}
