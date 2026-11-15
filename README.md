# Cookie and Tracker Translator (Privacy Translator)

SE 401 Graduation Project — Efe Koca (220706037), Maltepe University, 2026–2027 Fall.
Advisor: Prof. Dr. Asaf Varol.

A Chrome (Manifest V3) extension that observes the third-party requests a website makes, identifies known
trackers and the cookies they set, grades the site's privacy from A to F with a documented formula, flags
contextual anomalies (e.g. advertising trackers on a health site), shows a category pie chart, explains
everything in plain language, and lets the user block whole tracker categories with one click.

## Layout
```
extension/            Chrome MV3 extension (load unpacked from this folder)
  manifest.json       MV3 manifest (service worker, webRequest, declarativeNetRequest, storage)
  background.js       service worker: request observation, matching, Set-Cookie, score, shield, messaging
  popup.html/.css/.js popup UI (grade, pie chart, tracker list, explanation, shield)
  lib/                domain.js, trackerDb.js, score.js, context.js, explain.js (pure, unit-tested)
  data/trackers.json  curated tracker dataset (62 domains, 6 categories)
backend/              zero-dependency Node.js explanation API (POST /api/v1/explain, GET /health)
tests/unit/           node:test unit tests (24)
tests/e2e/            Playwright + Chrome end-to-end harness with offline fixture websites (13 checks)
evidence/             test outputs, logs and screenshots referenced in the progress reports
```

## Run
```bash
# 1) backend (Node >= 20, no npm install needed)
npm run backend                 # http://127.0.0.1:8787  (optional: LLM_API_KEY, LLM_MODEL, LLM_BASE_URL)
# 2) extension: chrome://extensions -> Developer mode -> Load unpacked -> select ./extension
# 3) tests
npm test                        # unit tests
npm run test:e2e                # needs: npm i -D playwright, Chrome for Testing, ports 80/443
```

## Privacy design
* Detection, matching and scoring run locally in the browser.
* Only when the user presses **Translate**, the extension sends: site type label, score, and for each
  tracker its registrable domain, company, category and a cookie flag. Page URL, hostname, path,
  query string and cookie values are never sent. The backend rejects any other field (HTTP 422).
* The backend binds to 127.0.0.1, keeps an in-memory cache only, and logs aggregate counts only.
