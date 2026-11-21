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

import { diatonicChords, chordSymbol, chordToken, describeChord, DEFAULT_PROG } from '../src/chords.js';
import { parentSteps } from '../src/key.js';

test('diatonic chords: C major and A minor', () => {
  const c = diatonicChords(0, major);
  assert.deepEqual(c.map((x) => x.name), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  assert.deepEqual(c.map((x) => x.numeral), ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  assert.deepEqual(c.map((x) => x.seventh), ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5']);
  assert.deepEqual(diatonicChords(A, minor).map((x) => x.name), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  assert.deepEqual(diatonicChords(5, major).map((x) => x.name).slice(0, 4), ['F', 'Gm', 'Am', 'Bb']);     // flat keys spell with flats
  assert.deepEqual(diatonicChords(0, minor).map((x) => x.name), ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb']);   // C minor has three flats
  assert.deepEqual(diatonicChords(0, major).map((x) => x.name)[1], 'Dm'); // C major stays natural
});

test('every default progression reads without errors in its scale', () => {
  for (const [scale, text] of Object.entries(DEFAULT_PROG)) {
    const r = parseProgression(text, { rootPc: A, steps: parentSteps(scale) });
    assert.deepEqual(r.errors, [], scale); assert.ok(r.chords.length >= 2, scale);
  }
});

test('chord symbols and tokens round-trip through the parser', () => {
  const key = { rootPc: A, steps: minor };
  assert.equal(chordSymbol(5, '', 'triad', { flats: false }), 'F'); assert.equal(chordSymbol(10, '', 'triad', { flats: true }), 'Bb');
  assert.equal(chordSymbol(2, 'm', '7th', { diatonic: diatonicChords(A, minor)[3] }), 'Dm7');
  assert.equal(chordSymbol(7, '', 'sus4'), 'Gsus4');
  assert.equal(chordToken('F', key), 'VI');
  assert.equal(chordToken('G7', key), 'VII7');
  assert.equal(chordToken('Am', { rootPc: null }), 'Am');
  for (const sym of ['Bb', 'F#m', 'Bm7b5', 'Dm7', 'Gsus4', 'Cadd9', 'Edim7', 'Gaug']) {
    const tok = chordToken(sym, key), a = parseProgression(sym, key).chords[0], b = parseProgression(tok, key).chords[0];
    assert.ok(b && a.rootPc === b.rootPc && JSON.stringify(Object.entries(a.roles).sort()) === JSON.stringify(Object.entries(b.roles).sort()), `${sym} -> ${tok}`);
  }
  assert.deepEqual(describeChord(parseProgression('Bm7b5').chords[0]), { rootPc: 11, quality: 'dim', ext: '7th' });
  assert.deepEqual(describeChord(parseProgression('Am').chords[0]), { rootPc: 9, quality: 'm', ext: 'triad' });
});

test('dots and other separators between chords all work', () => {
  for (const text of ['Am \u00b7 F \u00b7 C \u00b7 G', 'Am\u00b7F\u00b7C\u00b7G', 'Am F C G', 'Am, F, C, G', 'Am | F | C | G', 'Am \u2022 F \u2022 C \u2022 G']) {
    assert.deepEqual(parseProgression(text).chords.map((c) => c.symbol), ['Am', 'F', 'C', 'G'], text);
  }
});
