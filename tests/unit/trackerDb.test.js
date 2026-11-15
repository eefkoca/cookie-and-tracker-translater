import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TrackerDb } from '../../extension/lib/trackerDb.js';

const data = JSON.parse(readFileSync(new URL('../../extension/data/trackers.json', import.meta.url)));
const db = new TrackerDb(data);

test('U04 dataset loads, every entry has a valid category, no duplicate domains', () => {
  assert.equal(db.size, data.trackers.length);
  assert.ok(db.size >= 60);
});
test('U05 subdomain suffix matching', () => {
  assert.equal(db.match('www.google-analytics.com').company, 'Google');
  assert.equal(db.match('static.hotjar.com').category, 'session_replay');
  assert.equal(db.match('connect.facebook.net').category, 'advertising');
});
test('U06 most specific rule wins', () => {
  assert.equal(db.match('analytics.tiktok.com').category, 'advertising');
  assert.equal(db.match('www.tiktok.com').category, 'social');
});
test('U07 no false match on look-alike domains', () => {
  assert.equal(db.match('notdoubleclick.net'), null);
  assert.equal(db.match('doubleclick.net.evil.example'), null);
  assert.equal(db.match('example.com'), null);
});
test('U08 lookup performance: 100k lookups average under 5 microseconds', () => {
  const hosts = ['www.google-analytics.com', 'a.b.c.example.org', 'static.hotjar.com', 'cdn.shop.com.tr'];
  const n = 100000; const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) db.match(hosts[i % hosts.length]);
  const avgUs = Number(process.hrtime.bigint() - t0) / n / 1000;
  console.log(`# avg lookup ${avgUs.toFixed(3)} µs over ${n} lookups`);
  assert.ok(avgUs < 5, `avg ${avgUs} µs`);
});
