import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProgression } from '../src/chords.js';
import { suggestTunings, chordCoverage, SCALES } from '../src/key.js';

const A = 9, minor = SCALES.minor.steps, major = SCALES.major.steps;

test('chord names: triads, sevenths, slash chords', () => {
  const { chords, errors } = parseProgression('Am F C G7 Bm7b5 D/F# Cmaj7 Esus4');
  assert.deepEqual(errors, []);
  assert.deepEqual(chords.map((c) => c.symbol), ['Am', 'F', 'C', 'G7', 'Bm7b5', 'D/F#', 'Cmaj7', 'Esus4']);
  assert.deepEqual([...chords[0].tones].sort((a, b) => a - b), [0, 4, 9]);                  // A C E
  assert.equal(chords[3].roles[5], '7th');                                                  // F is the 7th of G7
  assert.equal(chords[4].roles[5], '5th');                                                  // Bm7b5: F is the b5
});

test('roman numerals follow the key: i VI III VII in A minor is Am F C G', () => {
  const { chords, errors } = parseProgression('i VI III VII', { rootPc: A, steps: minor });
  assert.deepEqual(errors, []);
  assert.deepEqual(chords.map((c) => c.symbol), ['Am', 'F', 'C', 'G']);
  const maj = parseProgression('I V vi IV', { rootPc: 0, steps: major }).chords;
  assert.deepEqual(maj.map((c) => c.symbol), ['C', 'G', 'Am', 'F']);
  assert.deepEqual(parseProgression('ii7 V7 Imaj7', { rootPc: 0, steps: major }).chords.map((c) => c.symbol), ['Dm7', 'G7', 'Cmaj7']);
});

test('names get numerals when a key is set; numerals need a key; junk is reported', () => {
  const named = parseProgression('Am F C G', { rootPc: A, steps: minor }).chords.map((c) => c.numeral);
  assert.deepEqual(named, ['i', 'VI', 'III', 'VII']);
  assert.equal(parseProgression('i V').errors.length, 2);
  assert.deepEqual(parseProgression('Am xyz F').errors, ['xyz']);
});

test('coverage across Am F C G: C is in three chords, no note is in all four', () => {
  const cov = chordCoverage(parseProgression('Am F C G').chords);
  assert.equal(cov[0], 3); assert.equal(Math.max(...cov), 3);                              // C appears in Am, F, C
});

test('chords change the ranking: a note shared by more chords beats a lone root', () => {
  const chords = parseProgression('Am F C G').chords;
  const withChords = suggestTunings(200, { rootPc: A, scale: 'minor', role: 'snare', chords });
  assert.ok(withChords[0].fit.covered >= 2, `${withChords[0].note} covers ${withChords[0].fit.covered}`);
  assert.equal(withChords[0].fit.total, 4);
  assert.ok(withChords[0].fit.per.some(Boolean));
});

test('a progression alone, with no key, still gives suggestions from chord tones', () => {
  const c = suggestTunings(200, { rootPc: null, role: 'snare', chords: parseProgression('Am F C G').chords });
  assert.ok(c.length > 0 && c.every((x) => x.fit.covered >= 1));
});
