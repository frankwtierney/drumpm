// Browser check for attack analysis + attack matching. A sweeps 220 -> 50 Hz; B is a flat 65 Hz kick.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const wav = (x, sr) => { const b = Buffer.alloc(44 + x.length * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40); x.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2)); return b; };
(async () => {
  const { kick } = await import('./synth.mjs'); const dir = process.env.OUT || '/tmp';
  const fa = path.join(dir, 'A_sweep.wav'), fb = path.join(dir, 'B_flat.wav');
  fs.writeFileSync(fa, wav(kick({ f0: 50, sweepFrom: 220, sweepMs: 30 }), 44100)); fs.writeFileSync(fb, wav(kick({ f0: 65, sweepFrom: 65, decay: 0.3 }), 44100));
  const srv = spawn('node', [path.join(__dirname, '..', 'serve.mjs')], { env: { ...process.env, PORT: '8098' } }); await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message)); page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
  await page.goto('http://localhost:8098/web/index.html');
  for (const [slot, f] of [['A', fa], ['B', fb]]) { const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click(`.drop[data-slot=${slot}]`)]); await c.setFiles(f); await page.waitForFunction((s) => window.__state[s], slot); }
  await page.waitForFunction(() => window.__renderDone >= 1 && !document.getElementById('dragOut').disabled);
  const early = () => page.evaluate(async () => { const m = await import('/src/attack.js'); const o = window.__state.matched; const t = m.pitchTrack(o.channels[0], o.sr).filter((f) => f.t >= 4 && f.t <= 14).map((f) => f.hz).sort((a, b) => a - b); return { early: t[t.length >> 1], body: (await import('/src/detect.js')).detectPitch(o.channels, o.sr).hz }; });
  const info = await page.evaluate(() => ({ A: window.__state.A.attack.hasSweep, B: window.__state.B.attack.hasSweep, aStart: window.__state.A.attack.startHz, txtA: document.getElementById('atkA').textContent, txtB: document.getElementById('atkB').textContent }));
  const off = await early();
  const n0 = await page.evaluate(() => window.__renderDone);
  await page.click('#atkL'); await page.waitForFunction((n) => window.__renderDone > n, n0, { timeout: 20000 });
  const on = await early();
  for (const s of ['A', 'B']) await page.click(`.vt[data-slot=${s}] button[data-view=spectro]`);
  await page.waitForTimeout(300); await page.screenshot({ path: path.join(dir, 'attack.png'), fullPage: true });
  console.log(JSON.stringify({ info, off, on }, null, 1));
  await browser.close(); srv.kill();
  const ok = info.A && !info.B && on.early > 1.4 * off.early && Math.abs(1200 * Math.log2(on.body / 50)) < 60;
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
