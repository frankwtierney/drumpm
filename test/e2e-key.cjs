// Key mode: with only B loaded, pick a key, click a suggestion, and the sample is retuned to that note.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const dir = process.env.OUT || '/tmp';
  const srv = spawn('node', [path.join(__dirname, '..', 'serve.mjs')], { env: { ...process.env, PORT: '8095' } }); await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8095/web/index.html');
  const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click('.drop[data-slot=B]')]); await c.setFiles(path.join(dir, 'B_kick65.wav'));
  await page.waitForFunction(() => window.__state.B);
  const hint = await page.evaluate(() => document.getElementById('distance').textContent);
  await page.click('#keybar summary');
  const role = await page.evaluate(() => document.getElementById('keyRole').value);        // auto-guessed from B's pitch
  await page.selectOption('#keyRoot', '9'); await page.selectOption('#keyScale', 'minor');   // A minor
  const cands = await page.$$eval('.cand', (els) => els.map((e) => e.querySelector('.cn').textContent + ' ' + e.querySelector('.cd').textContent));
  const n0 = await page.evaluate(() => window.__renderDone || 0);
  await page.click('.cand >> nth=0');
  await page.waitForFunction((n) => window.__renderDone > n, n0, { timeout: 20000 });
  const r = await page.evaluate(async () => {
    const m = await import('/src/detect.js'); const st = window.__state, o = st.matched;
    return { target: st.target, hzOut: m.detectPitch(o.channels, o.sr).hz, big: document.getElementById('shiftBig').textContent, tuner: document.getElementById('tuner').dataset.s,
      verdict: document.getElementById('distance').textContent, title: document.getElementById('matchRef').textContent, abOff: document.getElementById('cmp').disabled, sel: document.querySelectorAll('.cand.sel').length };
  });
  await page.screenshot({ path: path.join(dir, 'key.png'), fullPage: true });
  // loading a sample A takes over again
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.drop[data-slot=A]')]); await c2.setFiles(path.join(dir, 'A_kick50.wav'));
  await page.waitForFunction(() => window.__state.A); const cleared = await page.evaluate(() => window.__state.target === null);
  console.log(JSON.stringify({ hint, role, cands, ...r, cleared }));
  await browser.close(); srv.kill();
  const cents = Math.abs(1200 * Math.log2(r.hzOut / 55));
  const ok = role === 'kick' && cands[0].startsWith('A1 root') && r.target.name === 'A1' && cents < 45 && r.tuner === 'tuned' && r.title === 'B to A1' && r.abOff && r.sel === 1 && cleared && /key/i.test(hint);
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
