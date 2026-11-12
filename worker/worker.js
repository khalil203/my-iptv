// Cloudflare Worker: serves the app, the /api backend (data in KV) and the /proxy stream relay.
import { createBackend, verifyProxyToken, rewriteM3U8 } from '../public/core.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

function kvStore(kv) {
  return {
    get: async (k) => { const v = await kv.get(k); return v ? JSON.parse(v) : null; },
    put: (k, v, ttl) => kv.put(k, JSON.stringify(v), ttl ? { expirationTtl: Math.max(60, Math.floor(ttl)) } : undefined),
    del: (k) => kv.delete(k),
  };
}

let backend = null;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!backend) backend = createBackend({ store: kvStore(env.DB), fetchFn: (u, i) => fetch(u, i), cacheMs: 30000, mode: 'server' });

    if (url.pathname.startsWith('/api/')) {
      let body = {};
      if (!['GET', 'HEAD'].includes(request.method)) { try { body = await request.json(); } catch { body = {}; } }
      if (url.pathname === '/api/trial') body.ip = request.headers.get('cf-connecting-ip') || '';
      if (url.pathname === '/api/trial' && body && typeof body === 'object' && !body.appUrl) body.appUrl = url.origin;
      const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const r = await backend.handle({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, token });
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
    }

    if (url.pathname === '/proxy') return proxy(request, url);
    // Short links for TVs (type in the "Downloader" app): /tv or /apk → Android app
    if (url.pathname === '/tv' || url.pathname === '/apk') return Response.redirect(url.origin + '/apk/INTPROTO-TV.apk', 302);

    return env.ASSETS.fetch(request);
  },
  // Runs once a day (see wrangler.toml): low-credit alerts + expiry reminder emails.
  async scheduled(event, env, ctx) {
    if (!backend) backend = createBackend({ store: kvStore(env.DB), fetchFn: (u, i) => fetch(u, i), cacheMs: 30000, mode: 'server' });
    ctx.waitUntil(backend.daily());
  },
};

async function proxy(request, url) {
  const s = await backend.getSettings();
  const t = url.searchParams.get('t');
  const target = url.searchParams.get('u');
  if (!target || !(await verifyProxyToken(s.security.proxySecret, t))) return new Response('Forbidden', { status: 403, headers: CORS });
  let tu;
  try { tu = new URL(target); } catch { return new Response('Bad URL', { status: 400, headers: CORS }); }
  if (!/^https?:$/.test(tu.protocol)) return new Response('Bad URL', { status: 400, headers: CORS });

  const headers = new Headers({ 'User-Agent': 'Mozilla/5.0 (IPTV Player)' });
  const range = request.headers.get('range');
  if (range) headers.set('range', range);

  let res;
  try { res = await fetch(tu.toString(), { headers, redirect: 'follow' }); }
  catch (e) { return new Response('Upstream error: ' + e.message, { status: 502, headers: CORS }); }

  const ct = res.headers.get('content-type') || '';
  const finalPath = new URL(res.url || tu.toString()).pathname;
  if (res.ok && (/mpegurl/i.test(ct) || /\.m3u8?$/i.test(finalPath))) {
    const text = await res.text();
    const wrap = (abs) => `/proxy?u=${encodeURIComponent(abs)}&t=${encodeURIComponent(t)}`;
    return new Response(rewriteM3U8(text, res.url || tu.toString(), wrap), {
      headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store', ...CORS },
    });
  }
  const out = new Headers(CORS);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}
