import { midiToHz } from '../src/detect.js';
import { noteName, prefersFlats, diatonicChords, chordSymbol, chordToken, describeChord, parseProgression } from '../src/chords.js';

const $ = (id) => document.getElementById(id);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pads = new Set();

/** A soft pad for a chord: a bass note plus the chord tones above it. Goes straight to the output. */
export function playChord(ac, chord, when = 0, dur = 1.5) {
  ac.resume();
  const t = ac.currentTime + when, rootMid = 48 + chord.rootPc > 54 ? 36 + chord.rootPc : 48 + chord.rootPc;
  const tones = Object.keys(chord.roles).map(Number).map((pc) => rootMid + ((pc - chord.rootPc + 12) % 12)).sort((a, b) => a - b);
  const notes = [rootMid - 12, ...tones];
  const out = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1900; out.gain.value = 0.9; lp.connect(out); out.connect(ac.destination);
  for (const m of notes) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = midiToHz(m);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14 / Math.sqrt(notes.length), t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(lp); o.start(t); o.stop(t + dur + 0.1);
  }
  pads.add(out); setTimeout(() => pads.delete(out), (when + dur + 0.3) * 1000);
}
export function stopPads(ac) { for (const o of pads) { o.gain.cancelScheduledValues(ac.currentTime); o.gain.setTargetAtTime(0, ac.currentTime, 0.03); } pads.clear(); }

const slotPc = (k, inner) => (inner ? (k * 7 + 9) % 12 : (k * 7) % 12); // circle of fifths: majors outside, relative minors inside
const sector = (r0, r1, k) => {
  const a0 = ((-90 + 30 * k - 15) * Math.PI) / 180, a1 = a0 + (30 * Math.PI) / 180, p = (r, a) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
};

/**
 * The chord picker: a circle of fifths with the key's chords lit, a palette of those chords, and colour options.
 * Every change applies at once (onApply) and plays the chord, so you hear what you pick.
 */
export function createChordDialog({ ac, getKey, onApply, onRemove }) {
  const dlg = $('chordDlg'); let st = null;
  const kp = () => { const k = getKey(); return { rootPc: k.rootPc, steps: k.steps }; };
  const diatonicMap = () => { const k = getKey(); return k.rootPc == null ? new Map() : new Map(diatonicChords(k.rootPc, k.steps).map((c) => [`${c.rootPc}|${c.quality}`, c])); };

  function symbol() { const dm = diatonicMap(), k = getKey(); return chordSymbol(st.root, st.quality, st.ext, { flats: prefersFlats(k.rootPc, k.steps), diatonic: dm.get(`${st.root}|${st.quality}`) }); }
  function apply() { const sym = symbol(), chord = parseProgression(sym).chords[0]; if (!chord) return; onApply(chordToken(sym, kp()), st); playChord(ac, chord); render(); }

  function render() {
    const k = getKey(), dm = diatonicMap(), keyPc = k.rootPc, sym = symbol(), chord = parseProgression(sym, kp()).chords[0];
    $('dlgTitle').textContent = st.isNew && st.index == null ? 'Add a chord' : `Chord ${st.index + 1}`;
    $('dlgSub').textContent = chord ? `${sym}${chord.numeral ? ' · ' + chord.numeral : ''}` : sym;
    $('dlgNotes').textContent = chord ? chord.tones.slice().sort((a, b) => ((a - st.root + 12) % 12) - ((b - st.root + 12) % 12)).map((t) => NOTE_NAMES[t]).join('  ') : '';
    // circle of fifths
    const svg = $('cof'); svg.textContent = '';
    const ns = 'http://www.w3.org/2000/svg', el = (n, a, tx) => { const e = document.createElementNS(ns, n); for (const [kk, v] of Object.entries(a)) e.setAttribute(kk, v); if (tx != null) e.textContent = tx; return e; };
    for (const inner of [false, true]) for (let i = 0; i < 12; i++) {
      const pc = slotPc(i, inner), [r0, r1] = inner ? [46, 78] : [80, 124];
      const dq = inner ? (dm.has(`${pc}|m`) ? 'm' : dm.has(`${pc}|dim`) ? 'dim' : null) : (dm.has(`${pc}|`) ? '' : dm.has(`${pc}|aug`) ? 'aug' : null);
      const dc = dq == null ? null : dm.get(`${pc}|${dq}`), weight = dc ? (dc.degree === 0 ? 0.9 : dc.degree === 3 || dc.degree === 4 ? 0.6 : 0.38) : 0;
      const sel = st.root === pc && (inner ? st.quality === 'm' || st.quality === 'dim' : st.quality === '' || st.quality === 'aug');
      const g = el('g', { class: 'wedge' + (sel ? ' sel' : '') });
      g.appendChild(el('path', { d: sector(r0, r1, i), fill: dc ? `rgba(201,204,255,${weight})` : 'rgba(255,255,255,0.05)', stroke: sel ? '#4fe3f0' : 'rgba(255,255,255,0.14)', 'stroke-width': sel ? 3 : 1, 'stroke-dasharray': dq === 'dim' ? '3 3' : '' }));
      const a = ((-90 + 30 * i) * Math.PI) / 180, rm = (r0 + r1) / 2;
      const label = noteName(pc, prefersFlats(keyPc, k.steps)) + (inner ? (dq === 'dim' ? '°' : 'm') : '');
      g.appendChild(el('text', { x: (rm * Math.cos(a)).toFixed(1), y: (rm * Math.sin(a) + 4).toFixed(1), 'text-anchor': 'middle', class: dc && weight > 0.5 ? 'dk' : 'lt', 'font-size': inner ? 11 : 13 }, label));
      g.addEventListener('click', () => { st.root = pc; st.quality = inner ? (dq === 'dim' ? 'dim' : 'm') : (dq === 'aug' ? 'aug' : ''); apply(); });
      g.appendChild(el('title', {}, dc ? `${dc.name} · ${dc.numeral} in this key` : `${label} (outside the key)`));
      svg.appendChild(g);
    }
    svg.appendChild(el('text', { x: 0, y: -2, 'text-anchor': 'middle', class: 'cofc', 'font-size': 17 }, sym.split('/')[0]));
    svg.appendChild(el('text', { x: 0, y: 14, 'text-anchor': 'middle', class: 'cofs', 'font-size': 9 }, chord?.numeral || ''));
    // palette of the key's own chords
    const pal = $('dlgPal'); pal.textContent = '';
    if (!dm.size) { pal.innerHTML = '<span class="mut">Pick a key to see the chords that belong to it.</span>'; }
    for (const c of dm.values()) {
      const b = document.createElement('button'); b.className = 'pbtn' + (st.root === c.rootPc && st.quality === c.quality ? ' on' : '');
      b.innerHTML = `<b>${c.name}</b><i>${c.numeral}</i>`; b.onclick = () => { st.root = c.rootPc; st.quality = c.quality; apply(); }; pal.appendChild(b);
    }
    // colour
    $('dlgExt').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.ext === st.ext));
  }

  $('dlgExt').querySelectorAll('button').forEach((b) => { b.onclick = () => { st.ext = b.dataset.ext; apply(); }; });
  $('dlgHear').onclick = () => { const c = parseProgression(symbol()).chords[0]; if (c) playChord(ac, c); };
  $('dlgDone').onclick = () => dlg.close();
  $('dlgClose').onclick = () => dlg.close();
  $('dlgRemove').onclick = () => { if (!st.isNew || st.index != null) onRemove(st); dlg.close(); };
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // click the backdrop to close

  return {
    /** index: the card being edited (null for a new chord); chord: its parsed chord, if any */
    open({ index, chord }) {
      const d = chord ? describeChord(chord) : { rootPc: getKey().rootPc ?? 0, quality: '', ext: 'triad' };
      st = { index, isNew: !chord, root: d.rootPc, quality: d.quality, ext: d.ext };
      $('dlgRemove').hidden = !chord;
      render(); if (!dlg.open) dlg.showModal();
    },
    close: () => dlg.close(),
  };
}
