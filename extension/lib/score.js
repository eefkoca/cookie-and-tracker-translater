// Privacy Score v1 — documented, deterministic, reproducible (Report #2 §06, Objective O3).
//
//   S = max(0, 100 - Σ_d w(c_d) - Σ_d k·cookie_d - Σ_d a(ctx,c_d) - u·min(U, 10))
//
//   d          : each unique tracker registrable domain observed on the page
//   w(c)       : category weight (fingerprinting 25, session_replay 15, advertising 12,
//                social 8, analytics 5, essential 0) — from trackers.json
//   k = 3      : extra penalty if that tracker set a cookie (Set-Cookie observed)
//   a(ctx,c)   : contextual anomaly penalty = 10 when the site context is sensitive
//                (health/finance/children) AND c ∈ {advertising, social, fingerprinting, session_replay}
//   U, u = 1   : unknown third-party domains (not in the dataset), capped at 10
//
//   Grade: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F < 40
export const SCORE_VERSION = '1.0';
export const COOKIE_PENALTY = 3;
export const ANOMALY_PENALTY = 10;
export const UNKNOWN_PENALTY = 1;
export const UNKNOWN_CAP = 10;
const SENSITIVE_DATA_CATEGORIES = new Set(['advertising', 'social', 'fingerprinting', 'session_replay']);

export function grade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * @param {Array<{domain:string, category:string, setsCookies:boolean}>} trackers unique per domain
 * @param {Object} categories weights from dataset
 * @param {{sensitive:boolean}} context
 * @param {number} unknownThirdParties
 */
export function computeScore(trackers, categories, context, unknownThirdParties = 0) {
  const breakdown = { category: 0, cookies: 0, anomaly: 0, unknown: 0 };
  const anomalies = [];
  for (const t of trackers) {
    breakdown.category += categories[t.category]?.weight ?? 0;
    if (t.setsCookies) breakdown.cookies += COOKIE_PENALTY;
    if (context?.sensitive && SENSITIVE_DATA_CATEGORIES.has(t.category)) {
      breakdown.anomaly += ANOMALY_PENALTY;
      anomalies.push(t.domain);
    }
  }
  breakdown.unknown = UNKNOWN_PENALTY * Math.min(unknownThirdParties, UNKNOWN_CAP);
  const total = breakdown.category + breakdown.cookies + breakdown.anomaly + breakdown.unknown;
  const score = Math.max(0, 100 - total);
  return { version: SCORE_VERSION, score, grade: grade(score), breakdown, anomalies };
}

export function categoryCounts(trackers) {
  const counts = {};
  for (const t of trackers) counts[t.category] = (counts[t.category] || 0) + 1;
  return counts;
}
