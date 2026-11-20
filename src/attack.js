import { spectrum, findPeaks, toMono, findOnset } from './detect.js';

const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Short-window pitch track after the onset: the strongest spectral peak per frame.
 * t is milliseconds after the onset. Frames below floorDb (relative to the loudest frame) are dropped.
 * Short windows blur low pitches, so treat the values as the attack's rough pitch trajectory.
 */
export function pitchTrack(input, sr, { fmin = 30, fmax = 1200, winMs = 16, hopMs = 2, spanMs = 200, floorDb = -30 } = {}) {
  const x = toMono(input), on = findOnset(x, 0.1), W = Math.round((winMs * sr) / 1000);
  const frames = []; let ref = 0;
  for (let c = 0; c <= spanMs; c += hopMs) {
    const s0 = on + Math.round((c * sr) / 1000) - (W >> 1), seg = new Float32Array(W);
    for (let i = 0; i < W; i++) { const j = s0 + i; if (j >= 0 && j < x.length) seg[i] = x[j]; }
    const { mag, binHz } = spectrum(seg, sr, 8);
    const peaks = findPeaks(mag, binHz, fmin, fmax);
    if (!peaks.length) continue;
    const best = peaks.reduce((a, b) => (b.mag > a.mag ? b : a));
    frames.push({ t: c, hz: best.hz, mag: best.mag }); ref = Math.max(ref, best.mag);
  }
  return frames.map((f) => ({ ...f, db: 20 * Math.log10(f.mag / ref) })).filter((f) => f.db >= floorDb);
}

/**
 * Describe the attack: pitch at the very start vs the settled body, and how fast it settles.
 * Model: f(t) = body + (start - body) * exp(-(t - T0) / tau), with t in ms after the onset.
 */
export const T0 = 8;
export function analyzeAttack(input, sr, bodyHz) {
  if (!bodyHz) return null;
  const track = pitchTrack(input, sr);
  const early = track.filter((f) => f.t >= 4 && f.t <= 14 && f.db > -20);
  if (early.length < 2) return { startHz: bodyHz, bodyHz, tauMs: 15, sweepSemis: 0, hasSweep: false, track };
  const startHz = median(early.map((f) => f.hz)), mad = median(early.map((f) => Math.abs(f.hz - startHz)));
  const sweepSemis = 12 * Math.log2(startHz / bodyHz), consistent = mad / startHz < 0.2;
  // time for the deviation to fall to 1/e of its starting value
  const target = bodyHz + (startHz - bodyHz) / Math.E; let tau = 15;
  const after = track.filter((f) => f.t > T0);
  const cross = after.find((f) => (startHz > bodyHz ? f.hz <= target : f.hz >= target));
  if (cross) tau = Math.max(4, Math.min(60, cross.t - T0));
  return { startHz, bodyHz, tauMs: tau, sweepSemis, hasSweep: consistent && Math.abs(sweepSemis) >= 1.5, track };
}

/** Modelled pitch (Hz) of an analysed attack at tMs after the onset. */
export function contourHz(a, tMs) {
  if (!a || !a.hasSweep) return a ? a.bodyHz : 0;
  return a.bodyHz + (a.startHz - a.bodyHz) * Math.exp(-Math.max(0, tMs - T0) / a.tauMs);
}

/**
 * Make B's attack follow A's pitch contour. The body is already shifted (`body`, time-preserved).
 * The first part of the sound is re-read from the original B with a time-varying speed so its pitch
 * glides like A's, then crossfaded into the shifted body. Pitch is preserved after the crossfade.
 *   ratio(t) = targetPitch(t) / currentPitch(t), targetPitch = A's contour scaled to B's final body pitch.
 */
export function applyAttackContour(src, body, sr, { attackA, attackB, bodyShiftSemis, xfadeMs = 10 }) {
  const onSrc = findOnset(src, 0.1), onOut = findOnset(body, 0.1);
  const bodyTarget = attackB.bodyHz * Math.pow(2, bodyShiftSemis / 12);
  const ratioAt = (tMs) => (bodyTarget * (contourHz(attackA, tMs) / attackA.bodyHz)) / contourHz(attackB, tMs);
  const lenMs = Math.max(20, Math.min(100, 2.5 * Math.max(attackA.hasSweep ? attackA.tauMs : 0, attackB.hasSweep ? attackB.tauMs : 0) + T0));
  const len = Math.round((lenMs * sr) / 1000), xf = Math.max(1, Math.round((xfadeMs * sr) / 1000)), out = Float32Array.from(body);
  let p = onSrc;
  for (let u = 0; u < len + xf; u++) {
    const k = Math.floor(p), f = p - k;
    if (k + 1 >= src.length || onOut + u >= out.length) break;
    const s = src[k] * (1 - f) + src[k + 1] * f, w = u < len ? 1 : 1 - (u - len) / xf;
    out[onOut + u] = body[onOut + u] * (1 - w) + s * w;
    p += ratioAt((u / sr) * 1000);
  }
  return out;
}
