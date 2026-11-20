// Loop: hits keep coming, a re-render is picked up on a later repeat, and stopping stops them.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const dir = process.env.OUT || '/tmp';
  const srv = spawn('node', [path.join(__dirname, '..', 'serve.mjs')], { env: { ...process.env, PORT: '8096' } }); await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8096/web/index.html');
  for (const [slot, f] of [['A', path.join(dir, 'A_kick50.wav')], ['B', path.join(dir, 'B_kick65.wav')]]) { const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click(`.drop[data-slot=${slot}]`)]); await c.setFiles(f); await page.waitForFunction((s) => window.__state[s], slot); }
  await page.waitForFunction(() => window.__renderDone >= 1 && !document.getElementById('playM').disabled);
  const log = () => page.evaluate(() => window.__loop.log.slice());
  await page.click('#loopBtn'); await page.click('#playM');
  const label = await page.evaluate(() => document.getElementById('playM').textContent.trim());
  await page.waitForTimeout(2200); const first = await log();
  // change the shift while it loops: a new render must be what later repeats play
  await page.hover('#fine'); for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await page.waitForTimeout(2600); const second = await log();
  await page.click('#playM'); await page.waitForTimeout(300); const stopped = (await log()).length; await page.waitForTimeout(1500); const after = (await log()).length;
  // A / B loop alternates A and the matched sample
  await page.click('#cmp'); await page.waitForTimeout(2600); const ab = (await log()).slice(after); await page.click('#cmp');
  console.log(JSON.stringify({ label, hitsFirst: first.length, hitsSecond: second.length, newRender: new Set(second).size, stopped, after, ab: ab.map((x) => (x === 'A' ? 'A' : 'B')).join('') }));
  await browser.close(); srv.kill();
  const ok = label === 'Stop' && first.length >= 2 && second.length > first.length && new Set(second).size >= 2 && after === stopped && /^ABAB?|^A?BA/.test(ab.map((x) => (x === 'A' ? 'A' : 'B')).join(''));
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
