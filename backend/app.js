import { validateExplainRequest } from './validate.js';
import { LruCache, cacheKey } from './cache.js';
import { templateProvider } from './providers.js';

export const MAX_BODY_BYTES = 32 * 1024;

export function createApp({ provider = templateProvider, fallback = templateProvider, cache = new LruCache(), logger = console,
                            rateLimit = { windowMs: 60000, max: 60 } } = {}) {
  const hitsByIp = new Map();
  const stats = { requests: 0, errors: 0, fallbacks: 0 };

  function json(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }
  function cors(req, res) {
    const origin = req.headers.origin || '';
    // Only browser-extension origins (and no-origin tools such as curl) may call the API.
    if (origin.startsWith('chrome-extension://')) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return origin === '' || origin.startsWith('chrome-extension://');
  }
  function limited(ip) {
    const now = Date.now();
    const arr = (hitsByIp.get(ip) || []).filter(t => now - t < rateLimit.windowMs);
    arr.push(now); hitsByIp.set(ip, arr);
    return arr.length > rateLimit.max;
  }

  return async function handler(req, res) {
    const started = process.hrtime.bigint();
    const allowedOrigin = cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { status: 'ok', provider: provider.name, cacheSize: cache.size, cacheHits: cache.hits, cacheMisses: cache.misses, ...stats });
    }
    if (req.url !== '/api/v1/explain') return json(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    if (!allowedOrigin) return json(res, 403, { error: 'origin not allowed' });
    if (limited(req.socket.remoteAddress)) return json(res, 429, { error: 'rate limit exceeded' });
    stats.requests++;

    let raw = '';
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { stats.errors++; return json(res, 413, { error: 'payload too large' }); }
      raw += chunk;
    }
    let body;
    try { body = JSON.parse(raw); } catch { stats.errors++; return json(res, 400, { error: 'invalid JSON' }); }
    const v = validateExplainRequest(body);
    if (!v.ok) { stats.errors++; return json(res, 422, { error: 'validation failed', details: v.errors }); }

    const k = cacheKey(body);
    const hit = cache.get(k);
    if (hit) return json(res, 200, { source: hit.source, cached: true, explanation: hit.explanation, serverMs: ms(started) });

    let source = provider.name, explanation;
    try { explanation = await provider.explain(body); }
    catch (err) {
      stats.fallbacks++;
      logger.warn?.(`[backend] provider ${provider.name} failed: ${err.message}; using ${fallback.name}`);
      explanation = await fallback.explain(body); source = `${fallback.name} (fallback)`;
    }
    cache.set(k, { source, explanation });
    // Log only aggregate, non-identifying information.
    logger.log?.(`[backend] explain ok: ${body.trackers.length} trackers, context=${body.siteContext}, source=${source}, ${ms(started)} ms`);
    return json(res, 200, { source, cached: false, explanation, serverMs: ms(started) });
  };
}
const ms = (start) => Number((process.hrtime.bigint() - start) / 1000n) / 1000;
