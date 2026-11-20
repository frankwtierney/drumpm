import { midiToHz, hzToMidi, describeHz } from './detect.js';

export const SCALES = {
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  phrygian: { label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  minorPent: { label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  majorPent: { label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
};
export const ROOTS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
export const INTERVAL_NAMES = ['root', '♭2nd', '2nd', '♭3rd', '3rd', '4th', '♯4th', '5th', '♭6th', '6th', '♭7th', '7th'];

/**
 * Typical tuning ranges in Hz. `sweet` is where the drum sounds right, `allowed` is as far as a candidate may stray
 * (it is down-weighted between the two). The snare range follows E3 to B3 (about 165-247 Hz); the others are
 * approximate and meant to be adjusted by ear.
 */
export const ROLES = {
  kick: { label: 'Kick / 808', sweet: [38, 72], allowed: [28, 100] },
  snare: { label: 'Snare', sweet: [160, 250], allowed: [130, 320] },
  tom: { label: 'Tom', sweet: [95, 230], allowed: [70, 300] },
  any: { label: 'Any (no range limit)', sweet: [28, 1000], allowed: [25, 1500] },
};

// How well a note, by its interval above the key's root, suits each role (0..1). Index = semitones above the root.
const W = {
  //          root  b2   2nd  b3   3rd  4th  #4   5th  b6   6th  b7   7th
  kick:  [1.0, .15, .25, .3, .3, .45, .15, .9, .15, .3, .2, .2],
  snare: [.85, .25, .4, .95, .95, .5, .25, 1.0, .3, .45, .35, .35],
  tom:   [.8, .3, .45, .95, .95, .6, .3, 1.0, .35, .5, .4, .4],
  any:   [1.0, .3, .4, .8, .8, .55, .3, .9, .3, .4, .4, .4],
};

/** Best-guess role from the sample's detected pitch. */
export function guessRole(hz) { return hz < 80 ? 'kick' : hz < 135 ? 'tom' : 'snare'; }

const rangeFactor = (f, { sweet, allowed }) => {
  if (f >= sweet[0] && f <= sweet[1]) return 1;
  if (f < allowed[0] || f > allowed[1]) return 0;
  const edge = f < sweet[0] ? [allowed[0], sweet[0]] : [allowed[1], sweet[1]];
  return 0.45 + 0.55 * (1 - Math.abs(f - edge[1]) / Math.abs(edge[0] - edge[1]));
};
const shiftFactor = (st) => 1 / (1 + Math.pow(Math.abs(st) / 5, 2)); // big shifts cost character, so small ones rank higher

// How well a chord tone of each kind suits each role, and what a scale note outside the chord is worth.
const CW = {
  kick: { root: 1, '5th': .9, '3rd': .3, '7th': .2, ext: .15, none: .12 },
  snare: { root: .85, '5th': 1, '3rd': .95, '7th': .4, ext: .3, none: .15 },
  tom: { root: .8, '5th': 1, '3rd': .95, '7th': .4, ext: .3, none: .15 },
  any: { root: 1, '5th': .9, '3rd': .8, '7th': .45, ext: .3, none: .15 },
};

/**
 * Notes that suit `role`, ranked by fit and by how little `hz` has to move.
 * - With a key: scale tones, weighted by their degree.
 * - With chords (from parseProgression): each note is scored in every chord (root / 3rd / 5th / 7th / not a chord tone), combining the
 *   average with the worst chord, so a note that works across the whole progression beats one that only suits a single chord.
 * Returns [{ note, hz, midi, shift, interval, inKey, fit:{covered,total,per}, inSweet, bigShift, score }] best first.
 */
export function suggestTunings(hz, { rootPc, scale = 'minor', role = 'snare', chords = [] }, { limit = 8, maxShift = 12 } = {}) {
  const haveKey = rootPc != null, haveChords = chords.length > 0;
  if (!hz || (!haveKey && !haveChords)) return [];
  const steps = SCALES[scale].steps, r = ROLES[role], w = W[role], cw = CW[role], out = [];
  for (let m = Math.ceil(hzToMidi(r.allowed[0])); m <= Math.floor(hzToMidi(r.allowed[1])); m++) {
    const pc = ((m % 12) + 12) % 12, rel = haveKey ? (((pc - rootPc) % 12) + 12) % 12 : 0;
    const inKey = haveKey && steps.includes(rel), covered = haveChords ? chords.filter((c) => c.roles[pc]).length : 0;
    if (haveKey ? !(inKey || covered) : !covered) continue;           // outside the key and in no chord: not a candidate
    const f = midiToHz(m), shift = 12 * Math.log2(f / hz);
    if (Math.abs(shift) > maxShift) continue;
    let fitScore;
    const per = [];
    if (haveChords) {
      const ws = chords.map((c) => { const role2 = c.roles[pc]; per.push(role2 ? `${role2} of ${c.symbol}` : null); return role2 ? cw[role2] : inKey ? cw.none : 0; });
      const mean = ws.reduce((a, b) => a + b, 0) / ws.length, min = Math.min(...ws);
      fitScore = 0.65 * mean + 0.35 * min;
      if (haveKey) fitScore = 0.75 * fitScore + 0.25 * (inKey ? w[rel] : 0.1);
    } else fitScore = w[rel];
    const rf = rangeFactor(f, r), score = fitScore * rf * shiftFactor(shift);
    if (score <= 0) continue;
    out.push({ note: describeHz(f).note, hz: f, midi: m, shift, interval: haveKey ? INTERVAL_NAMES[rel] : null, inKey, fit: { covered, total: chords.length, per }, inSweet: f >= r.sweet[0] && f <= r.sweet[1], bigShift: Math.abs(shift) > 5, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Per pitch class (0..11): how many of the chords contain it, used to light the keyboard. */
export function chordCoverage(chords) {
  const cov = new Array(12).fill(0);
  for (const c of chords) for (const pc of c.tones) cov[pc]++;
  return cov;
}
