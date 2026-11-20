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

/**
 * Notes in `rootPc` + `scale` that suit `role`, ranked by fit and by how little `hz` has to move.
 * Returns [{ note, hz, midi, shift, interval, inSweet, bigShift, score }] best first.
 */
export function suggestTunings(hz, { rootPc, scale = 'minor', role = 'snare' }, { limit = 8, maxShift = 12 } = {}) {
  if (!hz || rootPc == null) return [];
  const steps = SCALES[scale].steps, r = ROLES[role], w = W[role], out = [];
  for (let m = Math.ceil(hzToMidi(r.allowed[0])); m <= Math.floor(hzToMidi(r.allowed[1])); m++) {
    const pc = (((m - rootPc) % 12) + 12) % 12;
    if (!steps.includes(pc)) continue;
    const f = midiToHz(m), shift = 12 * Math.log2(f / hz);
    if (Math.abs(shift) > maxShift) continue;
    const rf = rangeFactor(f, r), score = w[pc] * rf * shiftFactor(shift);
    if (score <= 0) continue;
    out.push({ note: describeHz(f).note, hz: f, midi: m, shift, interval: INTERVAL_NAMES[pc], inSweet: f >= r.sweet[0] && f <= r.sweet[1], bigShift: Math.abs(shift) > 5, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
