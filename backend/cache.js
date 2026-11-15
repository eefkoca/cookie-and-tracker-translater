import { createHash } from 'node:crypto';
// In-memory LRU cache with TTL. Identical tracker sets produce identical explanations,
// so repeated popups (and repeated LLM calls) are avoided. Nothing is written to disk.
export class LruCache {
  constructor({ max = 500, ttlMs = 24 * 3600 * 1000, now = () => Date.now() } = {}) {
    this.max = max; this.ttlMs = ttlMs; this.now = now; this.map = new Map(); this.hits = 0; this.misses = 0;
  }
  get(k) {
    const e = this.map.get(k);
    if (!e || e.exp < this.now()) { if (e) this.map.delete(k); this.misses++; return undefined; }
    this.map.delete(k); this.map.set(k, e); this.hits++; return e.v;
  }
  set(k, v) {
    this.map.delete(k); this.map.set(k, { v, exp: this.now() + this.ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get size() { return this.map.size; }
}

export function cacheKey(req) {
  const norm = {
    c: req.siteContext, l: req.locale || 'en', g: req.score?.grade || null,
    t: [...req.trackers].map(t => `${t.domain}|${t.category}|${t.setsCookies ? 1 : 0}`).sort()
  };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}
