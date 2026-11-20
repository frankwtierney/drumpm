import SignalsmithStretch from './vendor/SignalsmithStretch.mjs';

import { varispeed } from './shift-pure.mjs';
export { varispeed };

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
  // Messages to the worklet are async: without a round trip, the offline render can start before it has
  // received the schedule and come out silent. Port messages are ordered, so awaiting this one is a barrier.
  await node.dropBuffers(0);
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

/** Minimal store-only ZIP with a single file. Used where only archive downloads are allowed. */
export function zipStore(name, bytes) {
  const enc = new TextEncoder().encode(name), n = bytes.length;
  const table = zipStore.t || (zipStore.t = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
  let crc = 0xffffffff; for (let i = 0; i < n; i++) crc = table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8); crc = (crc ^ 0xffffffff) >>> 0;
  const out = new Uint8Array(30 + enc.length + n + 46 + enc.length + 22), v = new DataView(out.buffer);
  let o = 0; const u16 = (x) => { v.setUint16(o, x, true); o += 2; }, u32 = (x) => { v.setUint32(o, x, true); o += 4; };
  u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(0); u16(0x21); u32(crc); u32(n); u32(n); u16(enc.length); u16(0); out.set(enc, o); o += enc.length; out.set(bytes, o); o += n;
  const cd = o;
  u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(0); u16(0x21); u32(crc); u32(n); u32(n); u16(enc.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(0); out.set(enc, o); o += enc.length;
  const cdLen = o - cd;
  u32(0x06054b50); u16(0); u16(0); u16(1); u16(1); u32(cdLen); u32(cd); u16(0);
  return out;
}
