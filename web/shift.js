import SignalsmithStretch from './vendor/SignalsmithStretch.mjs';

/** Varispeed: resample by ratio (pitch and duration both change). Linear-interp on a Float32Array. */
export function varispeed(x, semitones) {
  const ratio = Math.pow(2, semitones / 12), n = Math.floor((x.length - 1) / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio, k = Math.floor(p), f = p - k;
    out[i] = x[k] * (1 - f) + x[k + 1] * f;
  }
  return out;
}

/**
 * Time-preserving pitch shift with Signalsmith Stretch, rendered offline.
 * channels: Float32Array[]; returns Float32Array[] of the same length.
 */
export async function stretchShift(channels, sr, semitones, { tonalityHz = 8000 } = {}) {
  const n = channels[0].length;
  const pad = Math.round(sr * 0.5); // let the stretcher flush its tail
  const ctx = new OfflineAudioContext(channels.length, n + pad, sr);
  const node = await SignalsmithStretch(ctx, { outputChannelCount: [channels.length] });
  node.connect(ctx.destination);
  await node.addBuffers(channels);
  node.schedule({ output: 0, active: true, input: 0, rate: 1, semitones, tonalityHz });
  const buf = await ctx.startRendering();
  return Array.from({ length: channels.length }, (_, c) => buf.getChannelData(c).slice(0, n));
}

/** Keep the first `ms` of the original B (its attack) and crossfade into the shifted body. */
export function keepTransient(original, shifted, sr, ms) {
  if (!ms) return shifted;
  const n = Math.min(original.length, shifted.length), a = Math.round((ms / 1000) * sr), xf = Math.max(1, Math.round(a * 0.5));
  const out = Float32Array.from(shifted.subarray(0, n));
  for (let i = 0; i < n; i++) {
    const w = i < a ? 1 : i < a + xf ? 1 - (i - a) / xf : 0;
    out[i] = original[i] * w + shifted[i] * (1 - w);
  }
  return out;
}

export function encodeWav(channels, sr) {
  const n = channels[0].length, nc = channels.length, buf = new ArrayBuffer(44 + n * nc * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true); v.setUint32(28, sr * nc * 2, true);
  v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    const s = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}
