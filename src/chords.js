// Chord progression parsing: chord names (Am F C G, Cmaj7, G7, Bm7b5, D/F#) and Roman numerals (i VI III VII, ii7 V7 Imaj7)
// relative to a key. Each chord carries the pitch classes it contains and the role of each (root, 3rd, 5th, 7th, ext).

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Flats for keys whose signature has flats (F, Bb, Eb, Ab, Db major and their relative minors, so C minor reads Ab Eb Bb). */
export const prefersFlats = (keyPc, steps) => keyPc != null && [5, 10, 3, 8, 1].includes((keyPc + (steps && steps[2] === 3 ? 3 : 0)) % 12);
export const noteName = (pc, flats = false) => (flats ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];

const tri = (third, fifth) => [[0, 'root'], [third, '3rd'], [fifth, '5th']];
const MAJ = tri(4, 7), MIN = tri(3, 7), DIM = tri(3, 6), AUG = tri(4, 8);
const with7 = (base, s) => [...base, [s, '7th']];
// chord-symbol suffix -> intervals
const SUFFIX = {
  '': MAJ, maj: MAJ, M: MAJ, m: MIN, min: MIN, dim: DIM, '°': DIM, aug: AUG, '+': AUG,
  sus2: [[0, 'root'], [2, 'ext'], [7, '5th']], sus4: [[0, 'root'], [5, 'ext'], [7, '5th']], sus: [[0, 'root'], [5, 'ext'], [7, '5th']],
  5: [[0, 'root'], [7, '5th']], 6: [...MAJ, [9, 'ext']], m6: [...MIN, [9, 'ext']],
  7: with7(MAJ, 10), maj7: with7(MAJ, 11), M7: with7(MAJ, 11), 'Δ': with7(MAJ, 11), 'Δ7': with7(MAJ, 11),
  m7: with7(MIN, 10), min7: with7(MIN, 10), mmaj7: with7(MIN, 11), m7b5: with7(DIM, 10), 'ø': with7(DIM, 10), 'ø7': with7(DIM, 10), dim7: with7(DIM, 9),
  madd9: [...MIN, [2, 'ext']], 9: [...with7(MAJ, 10), [2, 'ext']], maj9: [...with7(MAJ, 11), [2, 'ext']], m9: [...with7(MIN, 10), [2, 'ext']], add9: [...MAJ, [2, 'ext']],
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

function build(rootPc, intervals, symbol, extra = {}) {
  const roles = {};
  for (const [semi, role] of intervals) { const pc = (rootPc + semi) % 12; if (!roles[pc] || role === 'root') roles[pc] = role; }
  return { symbol, rootPc, roles, tones: Object.keys(roles).map(Number), ...extra };
}

function parseSymbol(tok) {
  const m = tok.match(/^([A-G])([#b♯♭]?)([^/]*)(?:\/[A-G][#b♯♭]?)?$/);
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const rootPc = (LETTER[m[1]] + acc + 12) % 12;
  const iv = SUFFIX[m[3]] ?? SUFFIX[m[3].toLowerCase()];
  if (!iv) return null;
  return build(rootPc, iv, tok);
}

function parseRoman(tok, keyPc, steps) {
  const m = tok.match(/^([b#♭♯]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(°|dim|\+|aug)?(maj7|M7|Δ|m7b5|ø|7|9|6|sus4|sus2|add9)?$/);
  if (!m) return null;
  const deg = ROMAN.indexOf(m[2].toUpperCase()), upper = m[2] === m[2].toUpperCase();
  const scale = steps.length === 7 ? steps : MAJOR_STEPS;
  const acc = m[1] === '#' || m[1] === '♯' ? 1 : m[1] === 'b' || m[1] === '♭' ? -1 : 0;
  const rootPc = (keyPc + scale[deg] + acc + 12) % 12;
  let base = m[3] === '+' || m[3] === 'aug' ? AUG : m[3] ? DIM : upper ? MAJ : MIN, suffix = m[3] ? '°' : upper ? '' : 'm';
  const ext = m[4]; let iv = base;
  if (ext === '7') { iv = with7(base, base === DIM && m[3] && !upper ? 9 : 10); suffix += '7'; }
  else if (ext === 'maj7' || ext === 'M7' || ext === 'Δ') { iv = with7(base, 11); suffix += 'maj7'; }
  else if (ext === 'm7b5' || ext === 'ø') { iv = with7(DIM, 10); suffix = 'm7b5'; }
  else if (ext === '9') { iv = [...with7(base, 10), [2, 'ext']]; suffix += '9'; }
  else if (ext === '6') { iv = [...base, [9, 'ext']]; suffix += '6'; }
  else if (ext === 'sus4' || ext === 'sus2') { iv = SUFFIX[ext]; suffix = ext; }
  else if (ext === 'add9') { iv = [...base, [2, 'ext']]; suffix += 'add9'; }
  return build(rootPc, iv, noteName(rootPc, prefersFlats(keyPc, steps)) + suffix, { numeral: tok });
}

/** Roman numeral for a chord root within a key, e.g. Am in C major -> "vi". */
export function numeralFor(chord, keyPc, steps) {
  if (keyPc == null) return null;
  const scale = steps.length === 7 ? steps : MAJOR_STEPS, rel = (((chord.rootPc - keyPc) % 12) + 12) % 12, minor = chord.roles[(chord.rootPc + 3) % 12] === '3rd';
  const pick = (r) => scale.indexOf(r);
  let i = pick(rel), pre = '';
  if (i < 0) { i = pick((rel + 1) % 12); pre = '♭'; }
  if (i < 0) { i = pick((rel + 11) % 12); pre = '♯'; }
  if (i < 0) return null;
  const r = ROMAN[i], dim = chord.roles[(chord.rootPc + 6) % 12] === '5th', sev = chord.symbol.match(/(maj7|M7|7|9|6|sus[24]|add9)$/);
  return pre + (minor ? r.toLowerCase() : r) + (dim ? '°' : '') + (sev ? sev[1].replace('M7', 'maj7') : '');
}

/**
 * Parse a progression. `key` = { rootPc, steps } (steps of the chosen scale) is needed for Roman numerals and enables numerals on names.
 * Returns { chords, errors } where errors lists the tokens that could not be read.
 */
export function parseProgression(text, key = {}) {
  const chords = [], errors = [], steps = key.steps || MAJOR_STEPS;
  for (const tok of String(text || '').split(/[\s,|>\u2192\u00B7\u2022-]+/).filter(Boolean)) {
    let c = parseSymbol(tok);
    if (!c) {
      if (/^[b#♭♯]?[IiVv]/.test(tok)) {
        if (key.rootPc == null) { errors.push(`${tok} (pick a key to use numerals)`); continue; }
        c = parseRoman(tok, key.rootPc, steps);
      }
    }
    if (!c) { errors.push(tok); continue; }
    if (!c.numeral && key.rootPc != null) c.numeral = numeralFor(c, key.rootPc, steps);
    chords.push(c);
  }
  return { chords, errors };
}

/** Starting progressions by scale, as Roman numerals. */
export const DEFAULT_PROG = {
  major: 'I V vi IV', minor: 'i VI III VII', dorian: 'i IV VII IV', mixolydian: 'I VII IV I', phrygian: 'i II VII i',
  lydian: 'I II I V', minorPent: 'i VI III VII', majorPent: 'I V vi IV',
};

/** The seven chords built on each degree of a 7-note scale: [{ degree, rootPc, quality, seventh, numeral, name }]. */
export function diatonicChords(keyPc, steps) {
  const mod = (v) => ((v % 12) + 12) % 12;
  return steps.map((s, i) => {
    const at = (k) => mod(steps[(i + k) % 7] - s), third = at(2), fifth = at(4), sev = at(6);
    const quality = third === 4 && fifth === 7 ? '' : third === 3 && fifth === 7 ? 'm' : third === 3 && fifth === 6 ? 'dim' : third === 4 && fifth === 8 ? 'aug' : '';
    const seventh = quality === '' ? (sev === 11 ? 'maj7' : '7') : quality === 'm' ? (sev === 11 ? 'mmaj7' : 'm7') : quality === 'dim' ? (sev === 9 ? 'dim7' : 'm7b5') : '7';
    const rootPc = mod(keyPc + s), up = quality === '' || quality === 'aug';
    return {
      degree: i, rootPc, quality, seventh,
      numeral: (up ? ROMAN[i] : ROMAN[i].toLowerCase()) + (quality === 'dim' ? '\u00B0' : quality === 'aug' ? '+' : ''),
      name: noteName(rootPc, prefersFlats(keyPc, steps)) + (quality === 'm' ? 'm' : quality === 'dim' ? 'dim' : quality === 'aug' ? 'aug' : ''),
    };
  });
}

/** Build a chord symbol from a root, quality ('' | 'm' | 'dim' | 'aug') and colour ('triad' | '7th' | 'sus2' | 'sus4' | 'add9'). */
export function chordSymbol(rootPc, quality, ext, { flats = false, diatonic = null } = {}) {
  const base = noteName(rootPc, flats);
  if (ext === 'sus2' || ext === 'sus4') return base + ext;
  if (ext === 'add9') return base + (quality === 'm' ? 'madd9' : 'add9');
  if (ext === '7th') return base + (diatonic?.seventh ?? { '': '7', m: 'm7', dim: 'm7b5', aug: '7' }[quality]);
  return base + { '': '', m: 'm', dim: 'dim', aug: 'aug' }[quality];
}

/** The form to store a chord in: a Roman numeral when a key is set and it reads back identically, otherwise the chord name. */
export function chordToken(symbol, key = {}) {
  if (key.rootPc == null) return symbol;
  const c = parseProgression(symbol, key).chords[0];
  if (!c || !c.numeral) return symbol;
  const back = parseProgression(c.numeral, key).chords[0];
  const same = back && back.rootPc === c.rootPc && JSON.stringify(Object.entries(back.roles).sort()) === JSON.stringify(Object.entries(c.roles).sort());
  return same ? c.numeral : symbol;
}

/** Root, quality and colour of a parsed chord, to seed the chord picker. */
export function describeChord(c) {
  const r = (semi) => c.roles[(c.rootPc + semi) % 12];
  const quality = r(3) === '3rd' ? (r(6) === '5th' ? 'dim' : 'm') : r(8) === '5th' ? 'aug' : '';
  const ext = /sus2$/.test(c.symbol) ? 'sus2' : /sus(4)?$/.test(c.symbol) ? 'sus4' : /add9$/.test(c.symbol) ? 'add9' : Object.values(c.roles).includes('7th') ? '7th' : 'triad';
  return { rootPc: c.rootPc, quality, ext };
}
