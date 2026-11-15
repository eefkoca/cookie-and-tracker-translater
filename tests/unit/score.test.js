import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeScore, grade } from '../../extension/lib/score.js';
import { CONTEXTS, classifySite } from '../../extension/lib/context.js';

const { categories } = JSON.parse(readFileSync(new URL('../../extension/data/trackers.json', import.meta.url)));
const T = (domain, category, setsCookies = false) => ({ domain, category, setsCookies });

test('U09 no trackers gives 100 / A', () => {
  const r = computeScore([], categories, CONTEXTS.general, 0);
  assert.deepEqual([r.score, r.grade], [100, 'A']);
});
test('U10 worked example from report: analytics + advertising(cookie) on general site', () => {
  // 100 - 5 - 12 - 3 = 80 -> B
  const r = computeScore([T('google-analytics.com', 'analytics'), T('doubleclick.net', 'advertising', true)], categories, CONTEXTS.general, 0);
  assert.deepEqual([r.score, r.grade], [80, 'B']);
});
test('U11 same trackers on a health site trigger contextual anomaly penalty', () => {
  // 100 - 5 - 12 - 3 - 10 = 70 -> C ; analytics alone is not an anomaly
  const r = computeScore([T('google-analytics.com', 'analytics'), T('doubleclick.net', 'advertising', true)], categories, CONTEXTS.health, 0);
  assert.deepEqual([r.score, r.grade, r.anomalies], [70, 'C', ['doubleclick.net']]);
});
test('U12 unknown third parties capped at 10 and score floored at 0', () => {
  assert.equal(computeScore([], categories, CONTEXTS.general, 50).score, 90);
  const many = Array.from({ length: 10 }, (_, i) => T(`fp${i}.example`, 'fingerprinting', true));
  assert.deepEqual([computeScore(many, categories, CONTEXTS.general, 0).score, computeScore(many, categories, CONTEXTS.general, 0).grade], [0, 'F']);
});
test('U13 grade boundaries', () => {
  assert.deepEqual([90, 89, 75, 74, 60, 59, 40, 39].map(grade), ['A', 'B', 'B', 'C', 'C', 'D', 'D', 'F']);
});
test('U14 score is deterministic (same input, same output)', () => {
  const input = [T('hotjar.com', 'session_replay', true), T('facebook.net', 'advertising')];
  assert.deepEqual(computeScore(input, categories, CONTEXTS.finance, 3), computeScore(input, categories, CONTEXTS.finance, 3));
});
test('U15 local site-context classifier', () => {
  assert.equal(classifySite('saglik-forum.test'), 'health');
  assert.equal(classifySite('www.mybank.com'), 'finance');
  assert.equal(classifySite('example.org'), 'general');
});
