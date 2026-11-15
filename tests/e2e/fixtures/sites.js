// Synthetic fixture websites. Each page embeds third-party resources whose hostnames are resolved
// to 127.0.0.1 by Chrome's --host-resolver-rules, so the test is offline and fully reproducible.
// "expected" values are computed by hand from Privacy Score v1 (see Report #2 §06).
export const COOKIE_DOMAINS = ['doubleclick.net', 'criteo.com', 'hotjar.com', 'fpjs.io'];

const res = (host, path = '/t.js') => `https://${host}${path}`;

export const SITES = {
  'clean-blog.test': {
    title: 'Clean Blog (no third parties)', context: 'general',
    resources: [res('clean-blog.test', '/style.css'), res('static.clean-blog.test', '/logo.gif')],
    expected: { trackers: 0, unknown: 0, score: 100, grade: 'A' }
  },
  'news-daily.test': {
    title: 'Daily News (analytics only)', context: 'news',
    resources: [res('www.google-analytics.com', '/analytics.js'), res('www.googletagmanager.com', '/gtm.js'), res('fonts.somecdn.test', '/font.css')],
    // 100 - 5 - 5 - 1(unknown) = 89 -> B
    expected: { trackers: 2, unknown: 1, score: 89, grade: 'B' }
  },
  'saglik-forum.test': {
    title: 'Health Forum (ads on a sensitive site)', context: 'health',
    resources: [res('www.google-analytics.com', '/analytics.js'), res('stats.g.doubleclick.net', '/pixel.gif'),
      res('connect.facebook.net', '/fbevents.js'), res('static.criteo.com', '/ld.js'), res('dis.criteo.com', '/sync.gif'),
      res('static.hotjar.com', '/hotjar.js'), res('ib.adnxs.com', '/getuid'),
      res('a-very-long-subdomain-name-used-for-popup-layout-testing.insights.hotjar.com', '/c.gif')],
    // categories 5+12+12+12+12+15 = 68 ; cookies 3x3 = 9 (doubleclick, criteo, hotjar) ; anomaly 5x10 = 50 -> 100-127 -> 0 F
    expected: { trackers: 6, unknown: 0, score: 0, grade: 'F', anomalies: 5 }
  },
  'fingerprint-shop.test': {
    title: 'Shop with fingerprinting', context: 'shopping',
    resources: [res('fpnpmcdn.fpjs.io', '/agent.js'), res('www.google-analytics.com', '/analytics.js'),
      res('img.cdn-a.test', '/1.jpg'), res('img.cdn-b.test', '/2.jpg'), res('api.payments-x.test', '/v1')],
    // 100 - 25 - 3(cookie) - 5 - 3(unknown) = 64 -> C
    expected: { trackers: 2, unknown: 3, score: 64, grade: 'C' }
  },
  'mixed-accuracy.test': {
    title: 'Detection accuracy fixture (20 known trackers + 10 benign third parties)', context: 'general',
    resources: [
      // 20 known tracker hostnames (various subdomains)
      ...['www.google-analytics.com', 'www.googletagmanager.com', 'stats.g.doubleclick.net', 'pagead2.googlesyndication.com',
        'connect.facebook.net', 'static.hotjar.com', 'www.clarity.ms', 'edge.fullstory.com', 'fpnpmcdn.fpjs.io', 'bat.bing.com',
        'static.criteo.net', 'cdn.taboola.com', 'widgets.outbrain.com', 'ib.adnxs.com', 'c.amazon-adsystem.com',
        'analytics.tiktok.com', 'static.ads-twitter.com', 'cdn.mxpnl.mixpanel.com', 'sb.scorecardresearch.com', 'js.hs-analytics.net'
      ].map(h => res(h)),
      // 10 benign / look-alike third parties that must NOT be flagged
      ...['notdoubleclick.net', 'doubleclick.net.cdn-mirror.test', 'google-analytics.com.fake.test', 'cdn.jsdelivr-like.test',
        'fonts.typeface.test', 'img.picsum.test', 'api.weather.test', 'facebook-fans.test', 'my-hotjar-review.test', 'static.example.org'
      ].map(h => res(h))
    ],
    expected: { trackers: 20, unknown: 10 }
  }
};

export function pageHtml(host) {
  const s = SITES[host];
  const tags = s.resources.map(u => u.endsWith('.js') ? `<script src="${u}" async></script>` : `<img src="${u}" width="1" height="1" alt="">`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${s.title}</title>
<style>body{font-family:Georgia,serif;max-width:640px;margin:40px auto;color:#222}h1{font-size:26px}.box{background:#f4f4f4;padding:12px;border-radius:6px}</style></head>
<body><h1>${s.title}</h1><p class="box">Synthetic test page served from <b>${host}</b> by the E2E fixture server.
It embeds ${s.resources.length} third-party or first-party resources.</p>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus.</p>
${tags}</body></html>`;
}
