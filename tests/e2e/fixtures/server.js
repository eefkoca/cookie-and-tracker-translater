import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { SITES, COOKIE_DOMAINS, pageHtml } from './sites.js';

const dir = new URL('.', import.meta.url).pathname;
export function ensureCert() {
  if (!existsSync(`${dir}key.pem`)) execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}key.pem -out ${dir}cert.pem -days 30 -subj /CN=fixture.test`, { stdio: 'ignore' });
  return { key: readFileSync(`${dir}key.pem`), cert: readFileSync(`${dir}cert.pem`) };
}
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export function handler(req, res) {
  const host = (req.headers.host || '').split(':')[0];
  const hits = (handler.hits ||= []); hits.push(`${host}${req.url}`);
  if (SITES[host] && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'first_party_session=1; Path=/' });
    return res.end(pageHtml(host));
  }
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  if (COOKIE_DOMAINS.some(d => host === d || host.endsWith('.' + d))) headers['Set-Cookie'] = `uid=${Math.random().toString(36).slice(2)}; Path=/; SameSite=None; Secure`;
  if (req.url.endsWith('.js')) { res.writeHead(200, { ...headers, 'Content-Type': 'application/javascript' }); return res.end('/* fixture tracker */'); }
  if (req.url.endsWith('.css')) { res.writeHead(200, { ...headers, 'Content-Type': 'text/css' }); return res.end(''); }
  res.writeHead(200, { ...headers, 'Content-Type': 'image/gif' }); res.end(GIF);
}

export async function startFixtureServer() {
  const tls = ensureCert();
  const a = http.createServer(handler), b = https.createServer(tls, handler);
  await Promise.all([new Promise(r => a.listen(80, '127.0.0.1', r)), new Promise(r => b.listen(443, '127.0.0.1', r))]);
  return { close: () => { a.close(); b.close(); }, hits: () => handler.hits || [] };
}
