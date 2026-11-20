// Chord progression parsing: chord names (Am F C G, Cmaj7, G7, Bm7b5, D/F#) and Roman numerals (i VI III VII, ii7 V7 Imaj7)
// relative to a key. Each chord carries the pitch classes it contains and the role of each (root, 3rd, 5th, 7th, ext).

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set([5, 10, 3, 8, 1]); // F, Bb, Eb, Ab, Db read better with flats
export const noteName = (pc, keyPc = null) => (keyPc != null && FLAT_KEYS.has(keyPc) ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];

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
  9: [...with7(MAJ, 10), [2, 'ext']], maj9: [...with7(MAJ, 11), [2, 'ext']], m9: [...with7(MIN, 10), [2, 'ext']], add9: [...MAJ, [2, 'ext']],
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
  return build(rootPc, iv, noteName(rootPc, keyPc) + suffix, { numeral: tok });
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
  for (const tok of String(text || '').split(/[\s,|>→-]+/).filter(Boolean)) {
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
