// Synthetic drum hits for tests.
export const SR = 44100;
const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; })();

export function kick({ f0 = 50, sweepFrom = 160, sweepMs = 25, decay = 0.25, dur = 0.6 } = {}) {
  const n = Math.round(dur * SR), x = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 + (sweepFrom - f0) * Math.exp(-t / (sweepMs / 1000 / 3));
    phase += (2 * Math.PI * f) / SR;
    x[i] = Math.sin(phase) * Math.exp(-t / decay);
  }
  return x;
}

export function tom({ f0 = 120, dur = 0.6, decay = 0.2 } = {}) {
  const n = Math.round(dur * SR), x = new Float32Array(n);
  const modes = [[1, 1], [1.59, 0.45], [2.14, 0.25], [2.65, 0.12]];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const [r, a] of modes) v += a * Math.sin(2 * Math.PI * f0 * r * t) * Math.exp(-t / (decay / Math.sqrt(r)));
    x[i] = v;
  }
  return x;
}

export function snare({ f0 = 190, dur = 0.5 } = {}) {
  const n = Math.round(dur * SR), x = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = rnd(), hp = w - prev; prev = w * 0.6; // brighter noise (wires)
    const tone = Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t / 0.07) + 0.5 * Math.sin(2 * Math.PI * f0 * 1.6 * t) * Math.exp(-t / 0.05);
    x[i] = 0.8 * tone + 0.6 * hp * Math.exp(-t / 0.12);
  }
  return x;
}
