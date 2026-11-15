import { CONTEXTS } from './lib/context.js';

export const CATEGORY_COLORS = {
  advertising: '#d73027', fingerprinting: '#7b3294', session_replay: '#f46d43',
  social: '#4575b4', analytics: '#fdae61', essential: '#66bd63'
};
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function resolveTabId() {
  // ?tabId= allows the popup to be opened as a normal page by the automated E2E test harness.
  const q = new URLSearchParams(location.search).get('tabId');
  if (q) return Number(q);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function drawPie(canvas, counts, categories) {
  const ctx = canvas.getContext('2d');
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const cx = canvas.width / 2, cy = canvas.height / 2, r = Math.min(cx, cy) - 4;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!total) { ctx.fillStyle = '#e3e8ee'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill(); return; }
  let a0 = -Math.PI / 2;
  for (const [cat, n] of entries) {
    const a1 = a0 + (n / total) * 2 * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
    ctx.fillStyle = CATEGORY_COLORS[cat] || '#999'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    a0 = a1;
  }
  ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(cx, cy, r * 0.5, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = '#1b2a3a'; ctx.font = 'bold 18px Segoe UI, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(total), cx, cy);
}

function render(r) {
  if (!r?.ok) { $('empty').classList.remove('hidden'); $('main').classList.add('hidden'); return; }
  $('empty').classList.add('hidden'); $('main').classList.remove('hidden');
  $('site').textContent = r.pageHost;
  const g = $('grade'); g.textContent = r.score.grade; g.className = `grade ${r.score.grade}`;
  $('score').textContent = r.score.score;
  const b = r.score.breakdown;
  $('scoreNote').textContent = `Penalties: categories −${b.category}, cookies −${b.cookies}, context −${b.anomaly}, unknown −${b.unknown}` +
    (r.unshieldedScore.score !== r.score.score ? ` · without Shield: ${r.unshieldedScore.score}` : '');

  const sel = $('context');
  sel.innerHTML = Object.entries(CONTEXTS).map(([k, v]) => `<option value="${k}" ${k === r.context ? 'selected' : ''}>${esc(v.label)}</option>`).join('');

  const anomaly = $('anomaly');
  if (r.score.anomalies.length) {
    anomaly.innerHTML = `<b>Contextual anomaly:</b> this looks like a <b>${esc(r.contextLabel.toLowerCase())}</b> site, but ` +
      `${r.score.anomalies.length} advertising/social/recording/fingerprinting service(s) receive data from it.`;
    anomaly.classList.remove('hidden');
  } else anomaly.classList.add('hidden');

  drawPie($('pie'), r.counts, r.categories);
  $('legend').innerHTML = Object.entries(r.counts).map(([c, n]) =>
    `<li><span class="sw" style="background:${CATEGORY_COLORS[c]}"></span>${esc(r.categories[c].label)} <b>${n}</b></li>`).join('') ||
    '<li class="muted">No known trackers</li>';

  $('count').textContent = `(${r.trackers.length} known · ${r.unknownThirdParties} other third-party)`;
  $('trackers').innerHTML = r.trackers.map(t => `
    <li><div><div class="tname">${esc(t.company)}${t.setsCookies ? ' 🍪' : ''}${t.blocked ? ' 🛡️' : ''}</div>
      <div class="tdom">${esc(t.hosts.join(', '))} · ${t.requests} req${t.blocked ? ` · ${t.blocked} blocked` : ''}</div></div>
      <span class="chip" style="background:${CATEGORY_COLORS[t.category]}">${esc(r.categories[t.category].label)}</span></li>`).join('') ||
    '<li class="muted">None detected</li>';

  $('shield').innerHTML = ['advertising', 'fingerprinting', 'session_replay', 'social', 'analytics'].map(c => `
    <label><span>Block ${esc(r.categories[c].label)}</span>
      <input type="checkbox" data-cat="${c}" ${r.shield[c] ? 'checked' : ''}></label>`).join('');
  $('footer').textContent = `Dataset v${r.datasetVersion} · Score formula v${r.score.version} · ${r.totalRequests} requests observed`;
}

function renderExplanation(res) {
  const box = $('explanation');
  const e = res.explanation;
  box.innerHTML = `<p>${esc(e.summary)}</p>` +
    (e.warnings?.length ? `<p><b>⚠ ${e.warnings.map(esc).join('</b></p><p><b>⚠ ')}</b></p>` : '') +
    `<ul>${e.items.map(i => `<li>${esc(i.text)}</li>`).join('')}</ul>` +
    `<div class="src">Source: ${esc(res.source)}${res.cached ? ' (cached)' : ''} · ${res.latencyMs} ms</div>`;
  box.classList.remove('hidden');
}

async function main() {
  const tabId = await resolveTabId();
  let report = await send({ type: 'getReport', tabId });
  render(report);
  $('context').addEventListener('change', async (ev) => { report = await send({ type: 'setContext', tabId, context: ev.target.value }); render(report); });
  $('explainBtn').addEventListener('click', async () => {
    const btn = $('explainBtn'); btn.disabled = true; btn.textContent = 'Translating…';
    try { renderExplanation(await send({ type: 'explain', tabId })); }
    finally { btn.disabled = false; btn.textContent = 'Translate into plain language'; }
  });
  $('shield').addEventListener('change', async (ev) => {
    const cat = ev.target.dataset.cat; if (!cat) return;
    await send({ type: 'setShield', category: cat, enabled: ev.target.checked });
    render(await send({ type: 'getReport', tabId }));
  });
}
main();
