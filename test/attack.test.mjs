import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAttack, pitchTrack, applyAttackContour } from '../src/attack.js';
import { varispeed } from '../web/shift-pure.mjs';
import { detectPitch } from '../src/detect.js';
import { kick, SR } from './synth.mjs';

const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const early = (x) => med(pitchTrack(x, SR).filter((f) => f.t >= 4 && f.t <= 14).map((f) => f.hz));

test('sweeping kick has a detectable attack above its body', () => {
  const a = analyzeAttack(kick({ f0: 50, sweepFrom: 220, sweepMs: 30 }), SR, 50);
  assert.ok(a.hasSweep, JSON.stringify({ s: a.startHz, st: a.sweepSemis }));
  assert.ok(a.startHz > 90, `start ${a.startHz}`);
});

test('flat kick has no sweep', () => {
  const a = analyzeAttack(kick({ f0: 65, sweepFrom: 65 }), SR, 65);
  assert.equal(a.hasSweep, false, JSON.stringify({ s: a.startHz, st: a.sweepSemis }));
});

test('matching attack makes a flat kick sweep like A, with the body pitch unchanged', () => {
  const A = kick({ f0: 50, sweepFrom: 220, sweepMs: 30 }), B = kick({ f0: 65, sweepFrom: 65, decay: 0.3 });
  const aA = analyzeAttack(A, SR, 50), aB = analyzeAttack(B, SR, 65);
  const st = 12 * Math.log2(50 / 65), body = varispeed(B, st); // stand-in for the time-preserved body
  const out = applyAttackContour(B, body, SR, { attackA: aA, attackB: aB, bodyShiftSemis: st });
  assert.ok(early(out) > 1.4 * early(body), `attack ${early(out)} vs plain ${early(body)}`);
  const hz = detectPitch(out, SR).hz;
  assert.ok(Math.abs(1200 * Math.log2(hz / 50)) < 60, `body ${hz}`);
});
