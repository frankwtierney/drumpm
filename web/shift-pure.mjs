// Pure helpers shared with shift.js; kept free of browser-only imports so node tests can load them.
export function varispeed(x, semitones) {
  const ratio = Math.pow(2, semitones / 12), n = Math.floor((x.length - 1) / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * ratio, k = Math.floor(p), f = p - k; out[i] = x[k] * (1 - f) + x[k + 1] * f; }
  return out;
}
