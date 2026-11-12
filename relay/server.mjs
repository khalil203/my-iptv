// INTPROTO-TV stream relay — runs on a non-Cloudflare host (e.g. Render free plan).
// It lets iPhones, iPads and web browsers play http IPTV streams inside the app (https + CORS).
// Only signed-in customers can use it: every request carries a token that the main app checks.
import http from 'node:http';
import https from 'node:https';

const PORT = process.env.PORT || 10000;
const APP_URL = (process.env.APP_URL || 'https://my-iptv.mrkhalil-ben-salah.workers.dev').replace(/\/+$/, '');
const tokenCache = new Map(); // token -> { ok, ua, until }
const imgCache = new Map();   // logo url -> { type, buf, at }  (small in-memory cache)
const deadHosts = new Map();  // host -> until  (logo servers that are down)
const isImg = (u) => /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u);

async function checkToken(t) {
  const c = tokenCache.get(t);
  if (c && c.until > Date.now()) return c;
  try {
    const r = await fetch(`${APP_URL}/api/relay-check?t=${encodeURIComponent(t)}`);
    const d = await r.json();
    const v = { ok: !!d.ok, ua: d.ua || 'IPTVSmartersPro', until: Date.now() + (d.ok ? 10 * 60000 : 60000) };
    tokenCache.set(t, v);
    if (tokenCache.size > 5000) tokenCache.clear();
    return v;
  } catch { return { ok: false }; }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range, Content-Type', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' };

function get(url, headers, hops = 0, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers, timeout }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, headers, hops + 1, timeout));
      }
      res.finalUrl = url;
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function rewrite(text, base, wrap) {
  return text.split(/\r?\n/).map((line) => {
    const l = line.trim();
    if (!l) return line;
    if (l.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(new URL(u, base).href)}"`);
    return wrap(new URL(l, base).href);
  }).join('\n');
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (url.pathname === '/' || url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain', ...CORS }); return res.end('INTPROTO-TV relay OK'); }
  if (url.pathname !== '/x') { res.writeHead(404, CORS); return res.end(); }
  const t = url.searchParams.get('t') || '';
  const target = url.searchParams.get('u') || '';
  if (!/^https?:\/\//.test(target)) { res.writeHead(400, CORS); return res.end('bad url'); }
  const tok = await checkToken(t);
  if (!tok.ok) { res.writeHead(403, CORS); return res.end('forbidden'); }
  const headers = { 'User-Agent': tok.ua, Accept: '*/*' };
  if (req.headers.range) headers.Range = req.headers.range;
  // Logos: serve from memory, fail fast for logo servers that are down
  if (isImg(target)) {
    const host = new URL(target).host;
    const hit = imgCache.get(target);
    if (hit) { res.writeHead(200, { 'content-type': hit.type, 'cache-control': 'public, max-age=604800', ...CORS }); return res.end(hit.buf); }
    if ((deadHosts.get(host) || 0) > Date.now()) { res.writeHead(504, CORS); return res.end(); }
    try {
      const up = await get(target, { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' }, 0, 6000);
      const chunks = []; for await (const ch of up) chunks.push(ch);
      const buf = Buffer.concat(chunks); const type = String(up.headers['content-type'] || 'image/png');
      if (up.statusCode >= 400 || !type.startsWith('image')) { res.writeHead(404, CORS); return res.end(); }
      if (buf.length < 400000) { imgCache.set(target, { type, buf }); if (imgCache.size > 3000) imgCache.delete(imgCache.keys().next().value); }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=604800', ...CORS }); return res.end(buf);
    } catch { deadHosts.set(host, Date.now() + 10 * 60000); res.writeHead(504, CORS); return res.end(); }
  }
  let up;
  try { up = await get(target, headers); } catch (e) { res.writeHead(502, CORS); return res.end('upstream error: ' + e.message); }
  const ct = String(up.headers['content-type'] || '');
  const isList = /mpegurl/i.test(ct) || /\.m3u8?$/i.test(new URL(up.finalUrl).pathname);
  if (isList && up.statusCode < 400) {
    let body = '';
    up.setEncoding('utf8');
    up.on('data', (d) => { body += d; });
    up.on('end', () => {
      const self = `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers.host}`;
      const wrap = (abs) => `${self}/x?u=${encodeURIComponent(abs)}&t=${encodeURIComponent(t)}`;
      res.writeHead(up.statusCode, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store', ...CORS });
      res.end(rewrite(body, up.finalUrl, wrap));
    });
    return;
  }
  const out = { ...CORS };
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (up.headers[h]) out[h] = up.headers[h];
  res.writeHead(up.statusCode, out);
  up.pipe(res);
  req.on('close', () => up.destroy());
}).listen(PORT, () => console.log('relay on', PORT, '→ checks tokens with', APP_URL));
