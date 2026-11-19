import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, matchSemitones } from '../src/detect.js';
import { kick, tom, snare, SR } from './synth.mjs';

const cents = (a, b) => 1200 * Math.log2(a / b);

for (const f0 of [41.2, 50, 65, 80]) {
  test(`kick ${f0} Hz (with pitch sweep)`, () => {
    const r = detectPitch(kick({ f0 }), SR);
    assert.ok(Math.abs(cents(r.hz, f0)) < 40, `got ${r.hz} (${r.note}) want ${f0}; ${JSON.stringify({m: r.method})}`);
  });
}

test('tom 120 Hz with inharmonic overtones', () => {
  const r = detectPitch(tom({ f0: 120 }), SR);
  assert.ok(Math.abs(cents(r.hz, 120)) < 40, `got ${r.hz}`);
});

test('snare 190 Hz tone under noise', () => {
  const r = detectPitch(snare({ f0: 190 }), SR);
  assert.ok(Math.abs(cents(r.hz, 190)) < 60, `got ${r.hz} peaks=${r.peaks.map(p=>p.hz.toFixed(0))}`);
});

test('match semitones', () => {
  assert.ok(Math.abs(matchSemitones(100, 50) - 12) < 1e-9);
  assert.ok(Math.abs(matchSemitones(50, 60) + 3.1564) < 1e-3);
  assert.ok(Math.abs(matchSemitones(100, 51, { foldOctave: true }) - (12 * Math.log2(100 / 51) - 12)) < 1e-9);
});
