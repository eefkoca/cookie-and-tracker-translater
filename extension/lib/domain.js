// Domain utilities: hostname extraction and a lightweight registrable-domain (eTLD+1) heuristic.
// A full Public Suffix List is not bundled (size/licence); the multi-label suffixes below cover
// the markets targeted by the project (TR, UK, generic). Limitation documented in Report #2 §06.
const MULTI_LABEL_SUFFIXES = new Set([
  'com.tr', 'org.tr', 'net.tr', 'gov.tr', 'edu.tr', 'gen.tr', 'bel.tr', 'k12.tr',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'co.jp', 'com.br', 'co.in'
]);

export function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); }
  catch { return null; }
}

export function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

export function registrableDomain(host) {
  if (!host) return null;
  if (isIp(host) || host === 'localhost') return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

export function isThirdParty(requestHost, pageHost) {
  if (!requestHost || !pageHost) return false;
  return registrableDomain(requestHost) !== registrableDomain(pageHost);
}
