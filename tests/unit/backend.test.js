import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp, MAX_BODY_BYTES } from '../../backend/app.js';
import { validateExplainRequest } from '../../backend/validate.js';
import { LruCache, cacheKey } from '../../backend/cache.js';
import { makeLlmProvider } from '../../backend/providers.js';

const quiet = { log() {}, warn() {} };
const good = { schemaVersion: 1, siteContext: 'health', score: { score: 70, grade: 'C' },
  trackers: [{ domain: 'doubleclick.net', company: 'Google', category: 'advertising', setsCookies: true },
             { domain: 'google-analytics.com', company: 'Google', category: 'analytics', setsCookies: false }] };

async function withServer(app, fn) {
  const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}
const post = (base, body, headers = {}) => fetch(`${base}/api/v1/explain`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('B01 valid request returns plain-language explanation with anomaly warning', async () => {
  await withServer(createApp({ logger: quiet }), async (base) => {
    const res = await post(base, good); const j = await res.json();
    assert.equal(res.status, 200); assert.equal(j.source, 'template'); assert.equal(j.cached, false);
    assert.equal(j.explanation.items.length, 2);
    assert.match(j.explanation.warnings[0], /Contextual anomaly/);
  });
});
test('B02 second identical request is served from cache', async () => {
  await withServer(createApp({ logger: quiet }), async (base) => {
    await post(base, good); const j = await (await post(base, good)).json();
    assert.equal(j.cached, true);
  });
});
test('B03 privacy guard: page URL or unknown fields are rejected (422)', async () => {
  await withServer(createApp({ logger: quiet }), async (base) => {
    const res = await post(base, { ...good, pageUrl: 'https://health.example/diagnosis?id=42' });
    assert.equal(res.status, 422);
    const j = await res.json(); assert.ok(j.details.some(d => d.includes('pageUrl')));
    const res2 = await post(base, { ...good, trackers: [{ ...good.trackers[0], path: '/x' }] });
    assert.equal(res2.status, 422);
  });
});
test('B04 malformed JSON (400), oversize body (413), wrong method (405), unknown route (404)', async () => {
  await withServer(createApp({ logger: quiet }), async (base) => {
    assert.equal((await post(base, '{bad')).status, 400);
    assert.equal((await post(base, 'x'.repeat(MAX_BODY_BYTES + 10))).status, 413);
    assert.equal((await fetch(`${base}/api/v1/explain`)).status, 405);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});
test('B05 web-page origins are refused (403); extension origin allowed', async () => {
  await withServer(createApp({ logger: quiet }), async (base) => {
    assert.equal((await post(base, good, { Origin: 'https://evil.example' })).status, 403);
    const ok = await post(base, good, { Origin: 'chrome-extension://abcdefghijklmnop' });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnop');
  });
});
test('B06 rate limit returns 429 after the configured maximum', async () => {
  await withServer(createApp({ logger: quiet, rateLimit: { windowMs: 60000, max: 3 } }), async (base) => {
    const codes = []; for (let i = 0; i < 5; i++) codes.push((await post(base, good)).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  });
});
test('B07 provider failure falls back to templates (no error shown to user)', async () => {
  const failing = { name: 'llm:test', explain: async () => { throw new Error('quota exceeded'); } };
  await withServer(createApp({ provider: failing, logger: quiet }), async (base) => {
    const j = await (await post(base, good)).json();
    assert.equal(j.source, 'template (fallback)'); assert.ok(j.explanation.summary.length > 0);
  });
});
test('B08 LLM provider: request shape, schema check and hallucination filter (mocked HTTP)', async () => {
  let captured;
  const fakeFetch = async (url, init) => { captured = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 's',
      items: [{ domain: 'doubleclick.net', category: 'advertising', text: 'ok' }, { domain: 'invented.example', category: 'advertising', text: 'hallucinated' }],
      warnings: [] }) } }] }) }; };
  const p = makeLlmProvider({ apiKey: 'test-key', baseUrl: 'https://llm.example/v1', model: 'm', fetchImpl: fakeFetch });
  const out = await p.explain(good);
  assert.equal(captured.url, 'https://llm.example/v1/chat/completions');
  assert.equal(captured.auth, 'Bearer test-key');
  assert.ok(!JSON.stringify(captured.body).includes('http'), 'no URLs in prompt');
  assert.deepEqual(out.items.map(i => i.domain), ['doubleclick.net']);
});
test('B09 validator and cache key are order-independent', () => {
  assert.equal(validateExplainRequest(good).ok, true);
  assert.equal(validateExplainRequest({ ...good, siteContext: 'casino' }).ok, false);
  const rev = { ...good, trackers: [...good.trackers].reverse() };
  assert.equal(cacheKey(good), cacheKey(rev));
  let t = 0; const c = new LruCache({ max: 2, ttlMs: 10, now: () => t });
  c.set('a', 1); c.set('b', 2); c.set('c', 3); assert.equal(c.get('a'), undefined); assert.equal(c.get('c'), 3);
  t = 11; assert.equal(c.get('c'), undefined);
});
