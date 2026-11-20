// Headless-Chromium end-to-end check: load A and B, match, verify output pitch and length.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const { kick } = await import('./synth.mjs');
  const { encodeWavNode } = { encodeWavNode: (x, sr) => {
    const b = Buffer.alloc(44 + x.length * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
    x.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2)); return b; } };
  const dir = process.env.OUT || '/tmp';
  const fa = path.join(dir, 'A_kick50.wav'), fb = path.join(dir, 'B_kick65.wav');
  fs.writeFileSync(fa, encodeWavNode(kick({ f0: 50 }), 44100));
  fs.writeFileSync(fb, encodeWavNode(kick({ f0: 65, decay: 0.3 }), 44100));
  const srv = spawn('node', [path.join(__dirname, '..', 'serve.mjs')], { env: { ...process.env, PORT: '8099' } });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[page]', m.text())); page.on('response', (r) => r.status() >= 400 && console.log('[http]', r.status(), r.url()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8099/web/index.html');
  for (const [slot, f] of [['A', fa], ['B', fb]]) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(`.drop[data-slot=${slot}]`)]);
    await chooser.setFiles(f);
    await page.waitForFunction((s) => window.__state[s], slot);
  }
  await page.waitForFunction(() => window.__renderDone >= 1 && !document.getElementById('playM').disabled, null, { timeout: 30000 });
  const res = await page.evaluate(async () => {
    const m = await import('/src/detect.js');
    const { A, B, matched } = window.__state;
    const out = m.detectPitch(matched.channels, matched.sr);
    return { hzA: A.hz, hzB: B.hz, hzOut: out.hz, lenB: B.channels[0].length, lenOut: matched.channels[0].length, info: document.getElementById('shiftBig').textContent,
      peak: Math.max(...matched.channels[0].map(Math.abs)) };
  });
  console.log(JSON.stringify(res, null, 1));
  // tuner: auto-matched should read in tune; dragging the dial off should leave the zone
  const tuned = await page.evaluate(() => document.getElementById('tuner').dataset.s);
  const box = await page.locator('#mknob').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = box.width * 0.4, deg = -55 * Math.PI / 180;
  await page.mouse.move(cx, cy - r); await page.mouse.down(); await page.mouse.move(cx + r * Math.sin(deg), cy - r * Math.cos(deg), { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(400);
  const off = await page.evaluate(() => ({ s: document.getElementById('tuner').dataset.s, read: document.getElementById('tnRead').textContent, big: document.getElementById('shiftBig').textContent }));
  console.log('tuner auto:', tuned, '| after drag:', JSON.stringify(off));
  await page.click('#autoBtn'); await page.waitForTimeout(400);
  const back = await page.evaluate(() => document.getElementById('tuner').dataset.s);
  console.log('tuner after auto:', back);
  if (tuned !== 'tuned' || off.s === 'tuned' || back !== 'tuned') { console.log('FAIL tuner'); process.exit(1); }
  const cents = 1200 * Math.log2(res.hzOut / res.hzA);
  console.log('output vs A error (cents):', cents.toFixed(1));
  await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true });
  // RTA: playing the matched sample should drive live bars
  await page.click('#playM'); await page.waitForTimeout(160);
  const live = await page.evaluate(() => ({ max: window.__rta.lastMax, ev: window.__rta.events.length }));
  await page.screenshot({ path: path.join(dir, 'rta.png'), fullPage: true });
  console.log('rta live:', JSON.stringify(live));
  if (!(live.max > 0.05)) { console.log('FAIL rta'); await browser.close(); srv.kill(); process.exit(1); }
  await browser.close(); srv.kill();
  if (Math.abs(cents) > 40 || res.lenOut !== res.lenB || res.peak < 0.1) { console.log('FAIL'); process.exit(1); }
  console.log('PASS');
})().catch((e) => { console.error(e); process.exit(1); });
