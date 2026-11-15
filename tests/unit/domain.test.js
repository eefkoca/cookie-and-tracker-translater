import test from 'node:test';
import assert from 'node:assert/strict';
import { hostnameOf, registrableDomain, isThirdParty } from '../../extension/lib/domain.js';

test('U01 hostnameOf extracts lowercase host and rejects garbage', () => {
  assert.equal(hostnameOf('https://WWW.Example.COM/a?b=1'), 'www.example.com');
  assert.equal(hostnameOf('not a url'), null);
});
test('U02 registrableDomain handles generic and Turkish multi-label suffixes', () => {
  assert.equal(registrableDomain('stats.g.doubleclick.net'), 'doubleclick.net');
  assert.equal(registrableDomain('www.hepsiburada.com.tr'), 'hepsiburada.com.tr');
  assert.equal(registrableDomain('a.b.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(registrableDomain('localhost'), 'localhost');
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
});
test('U03 isThirdParty distinguishes first- and third-party requests', () => {
  assert.equal(isThirdParty('cdn.shop.com.tr', 'www.shop.com.tr'), false);
  assert.equal(isThirdParty('www.google-analytics.com', 'www.shop.com.tr'), true);
});
