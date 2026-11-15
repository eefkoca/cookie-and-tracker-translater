// End-to-end test harness: real Chrome (Chrome for Testing) + unpacked extension + local fixture sites.
// Usage: node tests/e2e/run-e2e.mjs   (needs root or CAP_NET_BIND_SERVICE for ports 80/443)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startFixtureServer } from './fixtures/server.js';
import { SITES } from './fixtures/sites.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'evidence');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const results = []; const log = (...a) => { console.log(...a); };
const record = (id, name, expected, actual, pass, note = '') => { results.push({ id, name, expected, actual, pass, note }); log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} | expected: ${expected} | actual: ${actual}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

const commonArgs = ['--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost', '--ignore-certificate-errors', '--no-first-run', '--lang=en-US', '--no-proxy-server'];
async function launch(withExtension) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pt-e2e-'));
  const args = [...commonArgs, '--headless=new'];
  if (withExtension) args.push(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);
  return chromium.launchPersistentContext(dir, { executablePath: CHROME, headless: false, args, viewport: { width: 1280, height: 800 } });
}

function startBackend() {
  const p = spawn(process.execPath, [path.join(ROOT, 'backend/server.js')], { env: { ...process.env, LLM_API_KEY: '' } });
  let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  return { proc: p, output: () => out };
}

const fixtures = await startFixtureServer();
// Fail fast if a stale backend from a previous run still owns the port (would invalidate E11).
if (await fetch('http://127.0.0.1:8787/health').then(() => true, () => false)) { console.error('Port 8787 busy: stop the old backend first.'); process.exit(2); }
let backend = startBackend();
process.on('exit', () => { try { backend.proc.kill(); } catch {} });
await sleep(500);
const ctx = await launch(true);
const browserVersion = ctx.browser()?.version?.() ?? 'n/a';
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
log(`Chrome ${browserVersion}, extension id ${extId}`);

// ---------- E01: extension loads with no manifest/runtime errors; MV3 service worker active ----------
const ext = await ctx.newPage();
await ext.goto('chrome://extensions');
const info = await ext.evaluate(async (id) => {
  await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
  const i = await chrome.developerPrivate.getExtensionInfo(id);
  return { name: i.name, version: i.version, manifestErrors: i.manifestErrors.length, runtimeErrors: i.runtimeErrors.length, state: i.state,
           permissions: i.permissions?.simplePermissions?.map(p => p.message) };
}, extId);
await sleep(800);
await ext.screenshot({ path: path.join(OUT, 'fig-extensions-page.png') });
const manifest = await (await ctx.newPage()).goto(`chrome-extension://${extId}/manifest.json`).then(r => r.json());
record('E01', 'Extension loads in Chrome as Manifest V3 with a background service worker and no errors',
  'state ENABLED, MV3, SW active, 0 manifest errors, 0 runtime errors',
  `state ${info.state}, MV${manifest.manifest_version}, SW ${sw.url().endsWith('background.js') ? 'active' : 'missing'}, ${info.manifestErrors} manifest errors, ${info.runtimeErrors} runtime errors`,
  info.state === 'ENABLED' && manifest.manifest_version === 3 && info.manifestErrors === 0 && info.runtimeErrors === 0);

// helper: open a fixture site, then query the report through the real popup messaging path
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 400, height: 600 });
async function visit(host) {
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(`https://${host}/`, { waitUntil: 'load' });
  await sleep(1200);
  const tabId = await sw.evaluate(async (h) => (await chrome.tabs.query({})).find(t => t.url?.includes(h))?.id, host);
  return { page, tabId, ms: Date.now() - t0 };
}
async function report(tabId) {
  await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
  await popup.waitForSelector('#main:not(.hidden), #empty:not(.hidden)');
  return popup.evaluate((id) => chrome.runtime.sendMessage({ type: 'getReport', tabId: id }), tabId);
}

// ---------- E02-E05: per-site detection and scoring ----------
const siteResults = {};
const ids = { 'clean-blog.test': 'E02', 'news-daily.test': 'E03', 'saglik-forum.test': 'E04', 'fingerprint-shop.test': 'E05' };
for (const [host, id] of Object.entries(ids)) {
  const exp = SITES[host].expected;
  const v = await visit(host);
  const r = await report(v.tabId);
  siteResults[host] = { tabId: v.tabId, page: v.page, report: r };
  const actual = `${r.trackers.length} trackers, ${r.unknownThirdParties} unknown, context ${r.context}, score ${r.score.score} (${r.score.grade})` + (exp.anomalies !== undefined ? `, ${r.score.anomalies.length} anomalies` : '');
  const pass = r.trackers.length === exp.trackers && r.unknownThirdParties === exp.unknown && r.score.score === exp.score && r.score.grade === exp.grade &&
               r.context === SITES[host].context && (exp.anomalies === undefined || r.score.anomalies.length === exp.anomalies);
  record(id, `Detection + score on ${host} (${SITES[host].title})`,
    `${exp.trackers} trackers, ${exp.unknown} unknown, context ${SITES[host].context}, score ${exp.score} (${exp.grade})` + (exp.anomalies !== undefined ? `, ${exp.anomalies} anomalies` : ''), actual, pass);
}
const health = siteResults['saglik-forum.test'];
const cookieSetters = health.report.trackers.filter(t => t.setsCookies).map(t => t.domain).sort();
record('E06', 'Third-party Set-Cookie detection (webRequest extraHeaders)', 'criteo.com, doubleclick.net, hotjar.com',
  cookieSetters.join(', '), cookieSetters.join(',') === 'criteo.com,doubleclick.net,hotjar.com');

// Popup screenshot (health site) + composite page/popup figure
await report(health.tabId);
await sleep(300);
await popup.screenshot({ path: path.join(OUT, 'fig-popup-health.png'), fullPage: true });
await health.page.bringToFront();
await health.page.screenshot({ path: path.join(OUT, 'fig-page-health.png') });

// ---------- E07: detection accuracy on the 30-host mixed fixture ----------
{
  const v = await visit('mixed-accuracy.test');
  const r = await report(v.tabId);
  const known = SITES['mixed-accuracy.test'].resources.slice(0, 20).map(u => new URL(u).hostname);
  const detectedHosts = new Set(r.trackers.flatMap(t => t.hosts));
  const tp = known.filter(h => detectedHosts.has(h)).length;
  const fp = [...detectedHosts].filter(h => !known.includes(h)).length;
  const fn = known.length - tp;
  const precision = tp / (tp + fp), recall = tp / (tp + fn);
  siteResults.mixed = { tp, fp, fn, precision, recall, unknown: r.unknownThirdParties };
  record('E07', 'Detection accuracy: 20 known tracker hosts + 10 benign/look-alike hosts', 'recall ≥ 0.95, precision = 1.00 (0 false positives)',
    `TP ${tp}, FP ${fp}, FN ${fn}, recall ${recall.toFixed(2)}, precision ${precision.toFixed(2)}, ${r.unknownThirdParties} benign hosts classified as unknown`,
    recall >= 0.95 && fp === 0);
  await v.page.close();
}

// ---------- E08: user overrides site context -> score recalculated ----------
{
  const r = await popup.evaluate((id) => chrome.runtime.sendMessage({ type: 'setContext', tabId: id, context: 'health' }), siteResults['news-daily.test'].tabId);
  // analytics only -> no anomaly, score unchanged at 89
  const r2 = await popup.evaluate((id) => chrome.runtime.sendMessage({ type: 'setContext', tabId: id, context: 'health' }), siteResults['fingerprint-shop.test'].tabId);
  // fingerprinting on a health site -> +10 anomaly -> 64-10 = 54 (D)
  record('E08', 'Manual site-type override recalculates the contextual anomaly penalty',
    'news(analytics only)->health: 89 B unchanged; shop(fingerprinting)->health: 54 D', `news: ${r.score.score} ${r.score.grade}; shop: ${r2.score.score} ${r2.score.grade}`,
    r.score.score === 89 && r2.score.score === 54 && r2.score.grade === 'D');
}

// ---------- E09-E10: AI explanation via backend, cache, privacy of payload ----------
await report(health.tabId);
await popup.click('#explainBtn');
await popup.waitForSelector('#explanation:not(.hidden)');
const ex1 = await popup.evaluate((id) => chrome.runtime.sendMessage({ type: 'explain', tabId: id }), health.tabId); // 2nd call -> cached
await sleep(200);
await popup.screenshot({ path: path.join(OUT, 'fig-popup-explanation.png'), fullPage: true });
const firstSrc = await popup.textContent('#explanation .src');
const payloadStr = JSON.stringify(ex1.payloadSent);
const leaks = ['saglik-forum', 'https://', 'http://', '/analytics.js', 'first_party_session'].filter(s => payloadStr.includes(s));
record('E09', 'Plain-language explanation from backend; repeated request served from cache',
  'first: source=template, not cached; second: cached=true; summary + anomaly warning present',
  `first: "${firstSrc}"; second: source=${ex1.source}, cached=${ex1.cached}, ${ex1.latencyMs} ms; warnings=${ex1.explanation.warnings.length}`,
  /template/.test(firstSrc) && !/cached/.test(firstSrc) && ex1.cached === true && ex1.explanation.warnings.length >= 1);
record('E10', 'Data minimisation: payload sent to backend contains no URL, page hostname, path or cookie value',
  'fields = schemaVersion, siteContext, score, trackers{domain,company,category,setsCookies}, locale; 0 leaks',
  `fields = ${Object.keys(ex1.payloadSent).join(', ')}; leaks = ${leaks.length ? leaks.join(', ') : 'none'}`, leaks.length === 0);
writeFileSync(path.join(OUT, 'explain-payload-sample.json'), JSON.stringify(ex1.payloadSent, null, 2));
writeFileSync(path.join(OUT, 'explain-response-sample.json'), JSON.stringify({ source: ex1.source, cached: ex1.cached, explanation: ex1.explanation }, null, 2));

// ---------- E11: backend unavailable -> offline fallback, no crash ----------
backend.proc.kill(); await sleep(400);
const backendLog = backend.output();
const ex2 = await popup.evaluate((id) => chrome.runtime.sendMessage({ type: 'explain', tabId: id }), health.tabId);
record('E11', 'Backend stopped: extension shows offline template explanation instead of an error',
  'source=offline-fallback, non-empty summary, latency < 2000 ms', `source=${ex2.source}, error="${ex2.error}", summary length ${ex2.explanation.summary.length}, ${ex2.latencyMs} ms`,
  ex2.source === 'offline-fallback' && ex2.explanation.summary.length > 0 && ex2.latencyMs < 2000);
backend = startBackend(); await sleep(400);

// ---------- E12: Tracker Shield blocks advertising category ----------
{
  await report(health.tabId);
  await popup.check('input[data-cat="advertising"]');
  await sleep(500);
  const hitsBefore = fixtures.hits().length;
  await health.page.reload({ waitUntil: 'load' }); await sleep(1500);
  const r = await report(health.tabId);
  await sleep(300);
  await popup.screenshot({ path: path.join(OUT, 'fig-popup-shield.png'), fullPage: true });
  const adv = r.trackers.filter(t => t.category === 'advertising');
  const hitsAfter = fixtures.hits().slice(hitsBefore).filter(h => /^([a-z0-9.-]+\.)?(doubleclick\.net|criteo\.com|facebook\.net|adnxs\.com)\//.test(h)).length;
  const hitsNonAdv = fixtures.hits().slice(hitsBefore).filter(h => /hotjar|google-analytics/.test(h)).length;
  siteResults.shieldHits = { advertising: hitsAfter, nonAdvertising: hitsNonAdv };
  siteResults.shield = { adv: adv.map(t => ({ d: t.domain, req: t.requests, blocked: t.blocked })), score: r.score, unshielded: r.unshieldedScore };
  record('E12', 'Tracker Shield: enabling "Advertising" blocks ad requests (declarativeNetRequest) and improves the score',
    'all advertising requests blocked (ERR_BLOCKED_BY_CLIENT), 0 reached server; score 0 F -> 67 C',
    `${adv.length} advertising trackers (${hitsNonAdv} non-ad requests still allowed), blocked ${adv.reduce((a, t) => a + t.blocked, 0)}/${adv.reduce((a, t) => a + t.requests, 0)} requests, ${hitsAfter} reached fixture server; score ${r.unshieldedScore.score} ${r.unshieldedScore.grade} -> ${r.score.score} ${r.score.grade}`,
    adv.every(t => t.blocked >= t.requests) && hitsAfter === 0 && r.score.score === 67);
  await popup.uncheck('input[data-cat="advertising"]'); await sleep(300);
}

// ---------- E13: page-load overhead with vs without extension ----------
async function loadTimes(context, n) {
  const p = await context.newPage(); const times = [];
  for (let i = 0; i < n; i++) {
    await p.goto('https://saglik-forum.test/', { waitUntil: 'load' });
    times.push(await p.evaluate(() => { const e = performance.getEntriesByType('navigation')[0]; return e.loadEventEnd - e.startTime; }));
  }
  await p.close(); return times;
}
const withExt = await loadTimes(ctx, 15);
const swLogs = await sw.evaluate(() => globalThis.__ptLogs);
writeFileSync(path.join(OUT, 'sw-console.log'), swLogs.join('\n'));
await ctx.close();
const ctx2 = await launch(false);
const withoutExt = await loadTimes(ctx2, 15);
await ctx2.close();
const mW = median(withExt), mWo = median(withoutExt);
record('E13', 'Performance: median page-load time on the 8-tracker health fixture, with vs without extension (n = 15 each)',
  'overhead ≤ 50 ms median', `with ${mW.toFixed(1)} ms, without ${mWo.toFixed(1)} ms, overhead ${(mW - mWo).toFixed(1)} ms`, (mW - mWo) <= 50);

backend.proc.kill(); fixtures.close();
const summary = { date: new Date().toISOString(), chrome: browserVersion, node: process.version, platform: `${process.platform} ${process.arch}`, extensionId: extId,
  extensionVersion: manifest.version, passed: results.filter(r => r.pass).length, total: results.length, results, siteResults: { mixed: siteResults.mixed, shield: siteResults.shield },
  timings: { withExt, withoutExt }, backendLog };
writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(summary, null, 2));
log(`\n${summary.passed}/${summary.total} E2E checks passed (Chrome ${browserVersion}, ${summary.platform})`);
process.exit(summary.passed === summary.total ? 0 : 1);
