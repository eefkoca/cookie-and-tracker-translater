// Cookie and Tracker Translator — Manifest V3 background service worker.
// Observes (does not block) network requests with chrome.webRequest, matches request hostnames
// against the local tracker dataset, records Set-Cookie responses, computes the privacy score,
// and serves results to the popup. Blocking ("Tracker Shield") is done with declarativeNetRequest.
import { hostnameOf, registrableDomain, isThirdParty } from './lib/domain.js';
import { TrackerDb } from './lib/trackerDb.js';
import { computeScore, categoryCounts } from './lib/score.js';
import { classifySite, CONTEXTS } from './lib/context.js';
import { templateExplain } from './lib/explain.js';
import { CONFIG } from './config.js';

const log = (...a) => console.log(CONFIG.logPrefix, ...a);
let db = null;
const dbReady = fetch(chrome.runtime.getURL('data/trackers.json'))
  .then(r => r.json())
  .then(data => { db = new TrackerDb(data); log(`tracker dataset v${db.version} loaded: ${db.size} domains`); });

// ---------- per-tab state (memory + chrome.storage.session so it survives SW restarts) ----------
const tabs = new Map();
const key = (tabId) => `tab:${tabId}`;

function newTabState(pageUrl) {
  const pageHost = hostnameOf(pageUrl);
  return { pageUrl, pageHost, context: classifySite(pageHost), contextSource: 'auto',
           trackers: {}, unknown: {}, firstPartyRequests: 0, totalRequests: 0, startedAt: Date.now() };
}
async function getTab(tabId) {
  if (tabs.has(tabId)) return tabs.get(tabId);
  const stored = (await chrome.storage.session.get(key(tabId)))[key(tabId)];
  if (stored) tabs.set(tabId, stored);
  return stored || null;
}
const pendingSave = new Set();
function save(tabId) {
  if (pendingSave.has(tabId)) return;
  pendingSave.add(tabId);
  setTimeout(() => {
    pendingSave.delete(tabId);
    const s = tabs.get(tabId);
    if (s) chrome.storage.session.set({ [key(tabId)]: s });
    updateBadge(tabId);
  }, 250);
}

// ---------- request observation ----------
chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (details.tabId < 0) return; // requests not tied to a tab (e.g. the extension itself)
  handleRequest(details);
}, { urls: ['<all_urls>'] });

async function handleRequest(details) {
  await dbReady;
  if (details.type === 'main_frame') {
    tabs.set(details.tabId, newTabState(details.url));
    log(`tab ${details.tabId}: navigation to ${hostnameOf(details.url)} — state reset`);
    save(details.tabId);
    return;
  }
  const state = await getTab(details.tabId);
  if (!state) return;
  const host = hostnameOf(details.url);
  if (!host || !/^https?:/.test(details.url)) return;
  state.totalRequests++;
  if (!isThirdParty(host, state.pageHost)) { state.firstPartyRequests++; save(details.tabId); return; }
  const hit = db.match(host);
  if (hit) {
    const t = state.trackers[hit.domain] ||= { domain: hit.domain, company: hit.company, category: hit.category,
      hosts: [], requests: 0, setsCookies: false, blocked: 0, types: [] };
    t.requests++;
    if (!t.hosts.includes(host)) t.hosts.push(host);
    if (!t.types.includes(details.type)) t.types.push(details.type);
    log(`tab ${details.tabId}: tracker ${host} -> ${hit.company} [${hit.category}] (${details.type})`);
  } else {
    const rd = registrableDomain(host);
    state.unknown[rd] = (state.unknown[rd] || 0) + 1;
  }
  save(details.tabId);
}

// Set-Cookie headers are only exposed to webRequest when "extraHeaders" is requested.
chrome.webRequest.onHeadersReceived.addListener(async (details) => {
  if (details.tabId < 0 || details.type === 'main_frame') return;
  const hasCookie = (details.responseHeaders || []).some(h => h.name.toLowerCase() === 'set-cookie');
  if (!hasCookie) return;
  await dbReady;
  const state = await getTab(details.tabId);
  const hit = db.match(hostnameOf(details.url));
  if (state && hit && state.trackers[hit.domain]) {
    state.trackers[hit.domain].setsCookies = true;
    log(`tab ${details.tabId}: ${hit.domain} set a third-party cookie`);
    save(details.tabId);
  }
}, { urls: ['<all_urls>'] }, ['responseHeaders', 'extraHeaders']);

// Requests cancelled by the Tracker Shield surface here with ERR_BLOCKED_BY_CLIENT.
chrome.webRequest.onErrorOccurred.addListener(async (details) => {
  if (details.tabId < 0 || details.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;
  await dbReady;
  const state = await getTab(details.tabId);
  const hit = db.match(hostnameOf(details.url));
  if (state && hit && state.trackers[hit.domain]) { state.trackers[hit.domain].blocked++; save(details.tabId); }
}, { urls: ['<all_urls>'] });

chrome.tabs.onRemoved.addListener((tabId) => { tabs.delete(tabId); chrome.storage.session.remove(key(tabId)); });

// ---------- report ----------
async function buildReport(tabId) {
  await dbReady;
  const state = await getTab(tabId);
  if (!state) return { ok: false, reason: 'no-data' };
  const shield = await getShield();
  const all = Object.values(state.trackers);
  const active = all.filter(t => !(shield[t.category] && t.blocked > 0 && t.blocked >= t.requests));
  const ctx = CONTEXTS[state.context] || CONTEXTS.general;
  const unknownCount = Object.keys(state.unknown).length;
  const score = computeScore(active, db.categories, ctx, unknownCount);
  const unshielded = computeScore(all, db.categories, ctx, unknownCount);
  return {
    ok: true, tabId, pageHost: state.pageHost, context: state.context, contextSource: state.contextSource,
    contextLabel: ctx.label, sensitive: ctx.sensitive,
    trackers: all, unknownThirdParties: unknownCount, totalRequests: state.totalRequests,
    firstPartyRequests: state.firstPartyRequests, counts: categoryCounts(all),
    score, unshieldedScore: unshielded, categories: db.categories, datasetVersion: db.version, shield
  };
}

const BADGE_COLORS = { A: '#1a9850', B: '#66bd63', C: '#fdae61', D: '#f46d43', F: '#d73027' };
async function updateBadge(tabId) {
  const r = await buildReport(tabId);
  if (!r.ok) return;
  chrome.action.setBadgeText({ tabId, text: r.score.grade }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLORS[r.score.grade] }).catch(() => {});
}

// ---------- AI explanation (explicit user action only) ----------
// Data minimisation: only registrable tracker domains, company, category, cookie flag, site
// context label and score are sent. The page URL, hostname, path, query string and cookies are NOT sent.
export function buildExplainPayload(report) {
  return {
    schemaVersion: 1,
    siteContext: report.context,
    score: { score: report.score.score, grade: report.score.grade },
    trackers: report.trackers.map(t => ({ domain: t.domain, company: t.company, category: t.category, setsCookies: !!t.setsCookies })),
    locale: 'en'
  };
}

async function explain(tabId) {
  const report = await buildReport(tabId);
  if (!report.ok) return report;
  const payload = buildExplainPayload(report);
  const started = performance.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.backendTimeoutMs);
    const res = await fetch(CONFIG.backendUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`backend HTTP ${res.status}`);
    const body = await res.json();
    log(`explain: backend responded in ${Math.round(performance.now() - started)} ms (source=${body.source}, cached=${body.cached})`);
    return { ok: true, ...body, latencyMs: Math.round(performance.now() - started), payloadSent: payload };
  } catch (err) {
    log(`explain: backend unavailable (${err.message}) — using offline templates`);
    return { ok: true, source: 'offline-fallback', cached: false, explanation: templateExplain(payload),
             error: err.message, latencyMs: Math.round(performance.now() - started), payloadSent: payload };
  }
}

// ---------- Tracker Shield (declarativeNetRequest dynamic rules) ----------
async function getShield() { return (await chrome.storage.local.get('shield')).shield || {}; }
const RULE_BASE = { advertising: 1000, fingerprinting: 2000, session_replay: 3000, social: 4000, analytics: 5000 };

async function setShield(category, enabled) {
  await dbReady;
  if (!(category in RULE_BASE)) return { ok: false, reason: 'category not blockable' };
  const shield = await getShield();
  shield[category] = enabled;
  await chrome.storage.local.set({ shield });
  const domains = [...db.index.values()].filter(t => t.category === category).map(t => t.domain);
  const ruleId = RULE_BASE[category];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: enabled ? [{ id: ruleId, priority: 1, action: { type: 'block' },
      condition: { requestDomains: domains, domainType: 'thirdParty' } }] : []
  });
  log(`shield: ${category} ${enabled ? 'ENABLED' : 'disabled'} (${domains.length} domains)`);
  return { ok: true, shield };
}

// ---------- messaging ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'getReport': return buildReport(msg.tabId);
      case 'setContext': {
        const s = await getTab(msg.tabId);
        if (s && CONTEXTS[msg.context]) { s.context = msg.context; s.contextSource = 'user'; save(msg.tabId); }
        return buildReport(msg.tabId);
      }
      case 'explain': return explain(msg.tabId);
      case 'setShield': return setShield(msg.category, msg.enabled);
      default: return { ok: false, reason: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, reason: String(e) }));
  return true; // async response
});

log('service worker started');
