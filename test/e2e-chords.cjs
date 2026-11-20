// Chord workflow: key auto-fills a progression, presets, drag to reorder, the chord picker overlay, remove/add, hear it with the chords.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
(async () => {
  const dir = process.env.OUT || '/tmp';
  const srv = spawn('node', [path.join(__dirname, '..', 'serve.mjs')], { env: { ...process.env, PORT: '8093' } }); await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await browser.newPage({ viewport: { width: 1280, height: 1250 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8093/web/index.html');
  const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click('.drop[data-slot=B]')]); await c.setFiles(path.join(dir, 'B_kick65.wav')); await page.waitForFunction(() => window.__state.B);
  const cards = () => page.$$eval('#chordStrip .chord:not(.add)', (els) => els.map((e) => e.querySelector('b').textContent + '/' + e.querySelector('i').textContent));
  const prog = () => page.inputValue('#prog');
  const out = {};
  out.before = await prog();
  await page.selectOption('#keyRoot', '9');                                   // A, minor is the default scale
  out.filled = await prog(); out.cards = await cards();                         // starting progression appears
  await page.selectOption('#keyRoot', '0');                                   // changing key re-fills while the progression is still the default
  out.cMinor = await cards();
  await page.selectOption('#keyScale', 'major');
  out.cMajor = await cards();
  // presets
  const presetLabels = await page.$$eval('#progPreset option', (o) => o.map((x) => x.textContent));
  await page.selectOption('#progPreset', { index: 3 });                        // third preset in the major list
  out.preset = await cards();
  // drag the first chord onto the third
  await page.dragAndDrop('#chordStrip .chord:nth-child(1)', '#chordStrip .chord:nth-child(3)');
  out.afterDrag = await cards();
  // open the picker, choose the IV chord from the palette
  await page.click('#chordStrip .chord:nth-child(2)');
  out.dialogOpen = await page.evaluate(() => document.getElementById('chordDlg').open);
  out.wedges = await page.$$eval('#cof .wedge', (w) => w.length);
  out.palette = await page.$$eval('#dlgPal .pbtn', (b) => b.map((x) => x.textContent));
  await page.click('#dlgPal .pbtn:nth-child(4)');                              // IV = F in C major
  out.afterPick = await cards();
  await page.click('#dlgExt button[data-ext="7th"]'); out.seventh = await cards();   // colour: 7th
  await page.click('#dlgDone');
  // remove one, add one
  await page.hover('#chordStrip .chord:nth-child(1)'); await page.click('#chordStrip .chord:nth-child(1) .x'); out.afterRemove = await cards();
  await page.click('#chordStrip .chord.add'); await page.click('#cof .wedge >> nth=0'); await page.click('#dlgDone'); out.afterAdd = await cards();
  // hear it with the chords
  await page.click('#progPlay'); await page.waitForTimeout(500);
  out.now = await page.evaluate(() => document.querySelectorAll('#chordStrip .chord.now').length); out.btn = (await page.textContent('#progPlay')).trim();
  await page.screenshot({ path: path.join(dir, 'chords.png'), fullPage: true });
  await page.click('#progPlay'); out.stopped = (await page.textContent('#progPlay')).trim();
  out.presetLabels = presetLabels.slice(0, 3);
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.kill();
  const ok = out.before === '' && out.filled === 'i VI III VII' && out.cards.join(' ') === 'Am/i F/VI C/III G/VII'
    && out.cMinor.join(' ') === 'Cm/i Ab/VI Eb/III Bb/VII' && out.cMajor.join(' ') === 'C/I G/V Am/vi F/IV'
    && out.preset.join(' ') === 'C/I Am/vi F/IV G/V' && out.afterDrag.join(' ') === 'Am/vi F/IV C/I G/V'
    && out.dialogOpen && out.wedges === 24 && out.palette.length === 7 && out.afterPick.some((x) => x.startsWith('F/'))
    && out.seventh.some((x) => /^Fmaj7/.test(x)) && out.afterRemove.length === 3 && out.afterAdd.length === 4
    && out.now === 1 && out.btn === 'Stop' && /Hear/.test(out.stopped);
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
