// Local site-context classifier (no network). Uses hostname keywords; the user can override in the popup.
// Sensitive contexts trigger the contextual anomaly rule (Objective O4).
export const CONTEXTS = {
  health:   { label: 'Health',            sensitive: true,  keywords: ['health', 'saglik', 'hastane', 'hospital', 'clinic', 'klinik', 'doktor', 'doctor', 'medic', 'pharma', 'eczane', 'forum-health'] },
  finance:  { label: 'Finance / Banking', sensitive: true,  keywords: ['bank', 'banka', 'finans', 'finance', 'credit', 'kredi', 'loan', 'insurance', 'sigorta', 'invest', 'borsa'] },
  children: { label: 'Children / Education', sensitive: true, keywords: ['kids', 'cocuk', 'child', 'school', 'okul', 'edu'] },
  shopping: { label: 'Shopping',          sensitive: false, keywords: ['shop', 'store', 'magaza', 'market', 'cart', 'sepet', 'buy'] },
  news:     { label: 'News / Media',      sensitive: false, keywords: ['news', 'haber', 'gazete', 'times', 'post', 'daily'] },
  general:  { label: 'General',           sensitive: false, keywords: [] }
};

export function classifySite(host) {
  if (!host) return 'general';
  const h = host.toLowerCase();
  for (const [key, def] of Object.entries(CONTEXTS)) {
    if (def.keywords.some(k => h.includes(k))) return key;
  }
  return 'general';
}
