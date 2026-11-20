// Key + chords: with only B loaded, set a key and progression, check the suggestions, click a piano key, and B is retuned to it.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
(async () => {
  const dir = process.env.OUT || '/tmp';
  const srv = spawn('node', [path.join(__dirname, '..', 'serve.mjs')], { env: { ...process.env, PORT: '8095' } }); await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await browser.newPage({ viewport: { width: 1280, height: 1250 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8095/web/index.html');
  const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click('.drop[data-slot=B]')]); await c.setFiles(path.join(dir, 'B_kick65.wav'));
  await page.waitForFunction(() => window.__state.B);
  const role = await page.evaluate(() => document.getElementById('keyRole').value);               // guessed from B's pitch
  await page.selectOption('#keyRoot', '9'); await page.selectOption('#keyScale', 'minor');           // A minor
  await page.fill('#prog', 'i VI III VII'); await page.waitForTimeout(400);                          // numerals -> Am F C G
  const chords = await page.evaluate(() => window.__kb.chords());
  const chips = await page.$$eval('.chord', (els) => els.map((e) => e.querySelector('b').textContent + ' ' + e.querySelector('i').textContent));
  const list = await page.evaluate(() => window.__kb.list());
  // clicking the best-ranked key on the piano retunes B to it
  const top = list[0], n0 = await page.evaluate(() => window.__renderDone || 0);
  const pt = await page.evaluate((m) => window.__kb.centerOf(m), top.midi);
  await page.mouse.move(pt.x, pt.y); const hoverInfo = await page.evaluate(() => document.getElementById('kbInfo').textContent);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction((n) => window.__renderDone > n, n0, { timeout: 20000 });
  const r = await page.evaluate(async () => {
    const m = await import('/src/detect.js'); const st = window.__state, o = st.matched;
    return { target: st.target, hzOut: m.detectPitch(o.channels, o.sr).hz, tuner: document.getElementById('tuner').dataset.s, title: document.getElementById('matchRef').textContent, abOff: document.getElementById('cmp').disabled };
  });
  // live bars: playing the matched sample should light the keyboard strip
  await page.click('#playM'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(dir, 'key.png'), fullPage: true });
  console.log(JSON.stringify({ role, chords, chips, top, hoverInfo, ...r }));
  await browser.close(); srv.kill();
  const hz = r.target.hz, cents = Math.abs(1200 * Math.log2(r.hzOut / hz));
  const ok = role === 'kick' && chords.join(' ') === 'Am F C G' && chips.join('|') === 'Am i|F VI|C III|G VII' && top.total === 4 && top.covered >= 2
    && cents < 45 && r.tuner === 'tuned' && r.abOff && /chords/.test(hoverInfo);
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
