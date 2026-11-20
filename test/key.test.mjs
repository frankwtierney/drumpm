import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestTunings, guessRole, ROLES } from '../src/key.js';

const A = 9; // pitch class of A

test('a 65 Hz kick in A minor: root A1 is the top pick, 55 Hz, about 3 semitones down', () => {
  const c = suggestTunings(65.3, { rootPc: A, scale: 'minor', role: 'kick' });
  assert.equal(c[0].note, 'A1'); assert.equal(c[0].interval, 'root');
  assert.ok(Math.abs(c[0].shift - 12 * Math.log2(55 / 65.3)) < 0.01, `shift ${c[0].shift}`);
});

test('every candidate is in the scale and inside the role range', () => {
  const minor = [0, 2, 3, 5, 7, 8, 10];
  for (const role of ['kick', 'snare', 'tom']) {
    for (const c of suggestTunings(180, { rootPc: A, scale: 'minor', role }, { limit: 50 })) {
      assert.ok(minor.includes((((c.midi - A) % 12) + 12) % 12), `${role} ${c.note} not in A minor`);
      assert.ok(c.hz >= ROLES[role].allowed[0] && c.hz <= ROLES[role].allowed[1], `${role} ${c.note} ${c.hz}`);
    }
  }
});

test('snare prefers fifth/third/root and stays in its E3-B3 neighbourhood', () => {
  const c = suggestTunings(200, { rootPc: 0, scale: 'major', role: 'snare' }); // C major
  assert.ok(['5th', '3rd', 'root'].includes(c[0].interval), c[0].interval);
  assert.ok(c[0].hz >= 160 && c[0].hz <= 250, `${c[0].note} ${c[0].hz}`);
});

test('small shifts outrank big ones when the fit is equal', () => {
  const near = suggestTunings(110, { rootPc: A, scale: 'minor', role: 'tom' })[0];
  assert.ok(Math.abs(near.shift) < 4, `${near.note} ${near.shift}`);
});

test('no key chosen gives no suggestions; role guess follows pitch', () => {
  assert.deepEqual(suggestTunings(100, { rootPc: null, scale: 'minor', role: 'snare' }), []);
  assert.equal(guessRole(50), 'kick'); assert.equal(guessRole(110), 'tom'); assert.equal(guessRole(200), 'snare');
});
