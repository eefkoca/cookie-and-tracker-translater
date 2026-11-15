// Deterministic plain-language explanation templates.
// Used (1) by the backend "template" provider and (2) by the extension as an offline fallback
// when the backend is unreachable, so the user is never left with a blank screen.
const CATEGORY_TEXT = {
  advertising:    (c) => `${c} builds an advertising profile of you. It records which pages you visit so that ads can follow you to other websites.`,
  fingerprinting: (c) => `${c} identifies your device from technical details (screen, fonts, graphics card) instead of cookies. Deleting cookies does not stop it.`,
  session_replay: (c) => `${c} can record your mouse movements, clicks and scrolling, and sometimes what you type, so the site owner can replay your visit like a video.`,
  social:         (c) => `${c} tells its social network that you visited this page, even if you never click a share or like button.`,
  analytics:      (c) => `${c} counts visits and measures how people use the site (pages viewed, time spent). It is usually used for statistics.`,
  essential:      (c) => `${c} provides a function the site needs (cookie banner, security check, payment). It is generally low risk.`
};

const CONTEXT_PHRASE = {
  health: 'a health-related website', finance: 'a finance or banking website',
  children: 'a website aimed at children or education', shopping: 'a shopping website',
  news: 'a news website', general: 'this website'
};
const SENSITIVE = new Set(['health', 'finance', 'children']);
const DATA_SHARING = new Set(['advertising', 'social', 'fingerprinting', 'session_replay']);

export function templateExplain({ siteContext = 'general', trackers = [], score }) {
  const items = trackers.map(t => ({
    domain: t.domain,
    category: t.category,
    text: (CATEGORY_TEXT[t.category] || CATEGORY_TEXT.analytics)(t.company || t.domain) +
          (t.setsCookies ? ' It also stored a cookie in your browser.' : '')
  }));
  const sharing = trackers.filter(t => DATA_SHARING.has(t.category));
  const companies = [...new Set(trackers.map(t => t.company).filter(Boolean))];
  let summary;
  if (trackers.length === 0) {
    summary = `No known trackers were detected on ${CONTEXT_PHRASE[siteContext] || 'this website'}.`;
  } else {
    summary = `You are on ${CONTEXT_PHRASE[siteContext] || 'this website'}. ` +
      `${trackers.length} known tracker${trackers.length > 1 ? 's' : ''} from ${companies.length} compan${companies.length > 1 ? 'ies' : 'y'} ` +
      `(${companies.slice(0, 4).join(', ')}${companies.length > 4 ? ', …' : ''}) received information about your visit.`;
    if (score) summary += ` Privacy grade: ${score.grade} (${score.score}/100).`;
  }
  const warnings = [];
  if (SENSITIVE.has(siteContext) && sharing.length > 0) {
    warnings.push(`Contextual anomaly: this is ${CONTEXT_PHRASE[siteContext]}, yet ${sharing.length} advertising, social, recording or fingerprinting service${sharing.length > 1 ? 's are' : ' is'} present. ` +
      `Information about what you read here may be linked to your advertising profile. This is a serious privacy concern.`);
  }
  if (trackers.some(t => t.category === 'fingerprinting')) {
    warnings.push('Device fingerprinting detected: you can be recognised even in private browsing or after clearing cookies.');
  }
  return { summary, items, warnings };
}
