// Strict request validation. Rejects anything that looks like browsing data beyond the agreed schema.
const CATEGORIES = new Set(['advertising', 'fingerprinting', 'session_replay', 'social', 'analytics', 'essential']);
const CONTEXTS = new Set(['health', 'finance', 'children', 'shopping', 'news', 'general']);
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const ALLOWED_TOP = new Set(['schemaVersion', 'siteContext', 'score', 'trackers', 'locale']);
const ALLOWED_TRACKER = new Set(['domain', 'company', 'category', 'setsCookies']);
export const MAX_TRACKERS = 100;

export function validateExplainRequest(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['body must be a JSON object'] };
  for (const k of Object.keys(body)) if (!ALLOWED_TOP.has(k)) errors.push(`unexpected field "${k}"`);
  if (body.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!CONTEXTS.has(body.siteContext)) errors.push('siteContext invalid');
  if (!Array.isArray(body.trackers)) errors.push('trackers must be an array');
  else {
    if (body.trackers.length > MAX_TRACKERS) errors.push(`at most ${MAX_TRACKERS} trackers`);
    body.trackers.forEach((t, i) => {
      if (!t || typeof t !== 'object') { errors.push(`trackers[${i}] must be an object`); return; }
      for (const k of Object.keys(t)) if (!ALLOWED_TRACKER.has(k)) errors.push(`trackers[${i}].${k} not allowed`);
      if (typeof t.domain !== 'string' || !DOMAIN_RE.test(t.domain)) errors.push(`trackers[${i}].domain invalid`);
      if (!CATEGORIES.has(t.category)) errors.push(`trackers[${i}].category invalid`);
      if (t.company !== undefined && (typeof t.company !== 'string' || t.company.length > 80)) errors.push(`trackers[${i}].company invalid`);
      if (t.setsCookies !== undefined && typeof t.setsCookies !== 'boolean') errors.push(`trackers[${i}].setsCookies must be boolean`);
    });
  }
  if (body.score !== undefined) {
    const s = body.score;
    if (typeof s !== 'object' || typeof s.score !== 'number' || s.score < 0 || s.score > 100 || !/^[ABCDF]$/.test(s.grade)) errors.push('score invalid');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
