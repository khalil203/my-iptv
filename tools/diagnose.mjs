// Read-only health check. Prints a REDACTED summary: no names, emails, passwords, keys or server addresses.
// Run by .github/workflows/diagnose.yml, which downloads the app's saved settings and customers first.
import { readFileSync } from 'node:fs';
import { makeProxyToken } from '../public/core.js';

const load = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const s = load('/tmp/diag/settings.json') || {}; const customers = load('/tmp/diag/customers.json') || []; const log = load('/tmp/diag/log.json') || [];
const secrets = new Set();
const addSecret = (v) => { v = String(v ?? '').trim(); if (v.length >= 3) secrets.add(v); };
for (const c of customers) for (const k of ['username', 'name', 'email', 'phone', 'whatsapp', 'lineUsername', 'linePassword', 'id', 'dns']) addSecret(c[k]);
for (const o of [s.reseller || {}, s.email || {}, s.player || {}, s.security || {}, s.finance || {}]) for (const v of Object.values(o)) if (typeof v === 'string' && !/^(direct|proxy|auto|en|fr|ar|customer|GET|POST|true|false)$/i.test(v)) { addSecret(v); try { addSecret(new URL(v).hostname); } catch {} }
const scrub = (x) => { let t = String(x ?? ''); for (const v of [...secrets].sort((a, b) => b.length - a.length)) t = t.split(v).join('<x>'); return t; };
const mask = (x) => scrub(x).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>').replace(/https?:\/\/[^\s"'<>/]+/gi, (m) => m.split('://')[0] + '://<host>').replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>').replace(/\b[A-Za-z0-9_-]{16,}\b/g, '<token>').slice(0, 220);
const shape = (u) => { try { const x = new URL(u); return `${x.protocol}//<${/^\d+(\.\d+){3}$/.test(x.hostname) ? 'ip' : 'domain'}>${x.port ? ':' + x.port : ''}${x.pathname !== '/' ? x.pathname : ''}`; } catch { return u ? '(not a valid address)' : '(empty)'; } };
const tally = (list) => Object.entries(list.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`).join(' | ') || 'none';
const get = async (url, opt = {}) => { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 15000); try { const r = await fetch(url, { ...opt, signal: ac.signal, redirect: 'follow' }); const text = opt.head ? '' : await r.text(); return { status: r.status, type: r.headers.get('content-type') || '', text, len: text.length }; } catch (e) { return { status: 0, err: e.name === 'AbortError' ? 'timeout after 15s' : String(e.cause?.code || e.message) }; } finally { clearTimeout(tm); } };
const P = (...a) => console.log(...a);
// keep only the SHAPE of a template: placeholders and parameter names stay, every typed-in value becomes <v>
const tpl = (u) => scrub(String(u || '')).replace(/https?:\/\/[^\s/{?]+/gi, 'http://<host>').replace(/([=:]\s*"?)(?!\{)[^&\s"{},]+/g, '$1<v>').slice(0, 220);

P('===== SETTINGS =====');
const pl = s.player || {}; const rs = s.reseller || {};
P('streaming server:', shape(pl.serverUrl), '| playback mode:', pl.mode, '| useProxy:', pl.useProxy, '| relay:', shape(pl.relayUrl), '| user agent:', pl.userAgent);
P('reseller API on:', rs.enabled, '| base:', shape(rs.baseUrl), '| key set:', !!rs.apiKey, '| reseller user set:', !!rs.username, '| paths: id=', rs.idPath, 'credits=', rs.creditsPath, 'user=', rs.usernamePath, 'pass=', rs.passwordPath);
for (const [k, a] of Object.entries(rs.actions || {})) P(`  action ${k}: ${a.method} ${tpl(a.url)}${a.body ? ' | body: ' + tpl(a.body) : ''}`);
P('email: key set', !!(s.email || {}).resendKey, '| from set', !!(s.email || {}).from, '| owner email set', !!(s.email || {}).adminEmail, '| app link', shape((s.email || {}).appUrl), '| dns field', shape((s.email || {}).dns), '| language', (s.email || {}).lang);
P('trial: on', !!(s.trial || {}).enabled, '| hours', (s.trial || {}).hours, '| package', (s.trial || {}).package ? 'set' : 'empty', '| plans:', (s.plans || []).map((p) => `${p.days}d/pkg:${p.package ? 'set' : 'empty'}`).join(', '));

P('\n===== CUSTOMERS =====');
const now = Date.now();
P('total:', customers.length, '| active:', customers.filter((c) => c.expiresAt > now && c.status !== 'disabled').length, '| trials:', customers.filter((c) => c.isTrial).length, '| waiting for a line:', customers.filter((c) => c.pendingLine).length);
P('line details: same as login', customers.filter((c) => c.lineUsername && c.lineUsername === c.username).length, '| different', customers.filter((c) => c.lineUsername && c.lineUsername !== c.username).length, '| missing', customers.filter((c) => !c.lineUsername || !c.linePassword).length, '| own server saved', customers.filter((c) => c.dns).length);
P('login looks auto-made (t + 6 digits):', customers.filter((c) => /^t\d{6}$/.test(c.lineUsername || '')).length);
P('panel check results:', tally(customers.filter((c) => c.panel).map((c) => (c.panel.error ? 'ERR ' + mask(c.panel.error) : `auth=${c.panel.auth} status=${c.panel.status}`))));
P('line problems:', tally(customers.filter((c) => c.lineBad).map((c) => c.lineBad)));
P('errors reported by the app:', tally(customers.filter((c) => c.playErr).map((c) => `${c.playErr.action} code ${c.playErr.status} via ${c.playErr.route} (${mask(c.playErr.message).slice(0, 60)})`)));

P('\n===== RECENT ACTIVITY (problems only) =====');
for (const e of (Array.isArray(log) ? log : []).filter((e) => /panel|refus|failed|NOT sent|could not|server code|error/i.test(e.text || e.message || '')).slice(0, 25)) P(' -', new Date(e.at || e.t || 0).toISOString().slice(0, 16), mask(String(e.text || e.message || '')));

P('\n===== LIVE TESTS (from this checker, not from Cloudflare) =====');
const server = String(pl.serverUrl || '').replace(/\/+$/, '');
const ua = { 'User-Agent': pl.userAgent || 'IPTVSmartersPro' };
const sample = customers.filter((c) => c.expiresAt > now && c.status !== 'disabled' && !c.pendingLine && c.lineUsername && c.linePassword).sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0)).slice(0, 4);
if (!sample.length) P('no active customer with line details to test');
let n = 0;
for (const c of sample) {
  n++; const dns = String(c.dns || server).replace(/\/+$/, ''); const q = `username=${encodeURIComponent(c.lineUsername)}&password=${encodeURIComponent(c.linePassword)}`;
  P(`customer #${n} (${c.isTrial ? 'trial' : 'paid'}, server ${shape(dns)}${c.dns ? ' own' : ' general'}):`);
  const a = await get(`${dns}/player_api.php?${q}`, { headers: ua });
  let info = null; try { info = JSON.parse(a.text).user_info; } catch {}
  P('   sign-in to the TV server:', a.status || a.err, info ? `auth=${info.auth} status=${info.status} exp=${info.exp_date ? 'set' : 'none'} max=${info.max_connections} active=${info.active_cons}` : 'answer: ' + mask(a.text || '').slice(0, 100));
  if (!info || Number(info.auth) === 0) continue;
  for (const act of ['get_live_categories', 'get_vod_categories', 'get_series_categories']) { const r = await get(`${dns}/player_api.php?${q}&action=${act}`, { headers: ua }); let cnt = '?'; try { cnt = JSON.parse(r.text).length; } catch {} P(`   ${act}:`, r.status || r.err, 'items:', cnt, cnt === '?' ? 'answer: ' + mask(r.text || '').slice(0, 80) : ''); }
  const live = await get(`${dns}/player_api.php?${q}&action=get_live_streams`, { headers: ua }); let ch = []; try { ch = JSON.parse(live.text); } catch {}
  P('   get_live_streams:', live.status || live.err, 'channels:', Array.isArray(ch) ? ch.length : '?');
  if (Array.isArray(ch) && ch[0]) for (const ext of ['ts', 'm3u8']) { const r = await get(`${dns}/live/${encodeURIComponent(c.lineUsername)}/${encodeURIComponent(c.linePassword)}/${ch[0].stream_id}.${ext}`, { headers: { ...ua, Range: 'bytes=0-2000' }, head: true }); P(`   play first channel (.${ext}):`, r.status || r.err, r.type); }
  const vod = await get(`${dns}/player_api.php?${q}&action=get_vod_streams`, { headers: ua }); let mv = []; try { mv = JSON.parse(vod.text); } catch {}
  P('   get_vod_streams (all movies):', vod.status || vod.err, 'movies:', Array.isArray(mv) ? mv.length : '?', 'size:', Math.round((vod.len || 0) / 1024) + ' KB', Array.isArray(mv) ? '' : 'answer: ' + mask(vod.text || '').slice(0, 80));
  if (Array.isArray(mv) && mv[0]) { const r = await get(`${dns}/movie/${encodeURIComponent(c.lineUsername)}/${encodeURIComponent(c.linePassword)}/${mv[0].stream_id}.${mv[0].container_extension || 'mp4'}`, { headers: { ...ua, Range: 'bytes=0-2000' }, head: true }); P('   play first movie:', r.status || r.err, r.type); }
  if (pl.relayUrl && (s.security || {}).proxySecret) { const tk = await makeProxyToken(s.security.proxySecret, c.id, 1); const relay = String(pl.relayUrl).replace(/\/+$/, ''); const r = await get(`${relay}/x?u=${encodeURIComponent(`${dns}/player_api.php?${q}&action=get_vod_categories`)}&t=${encodeURIComponent(tk)}`); let cnt = '?'; try { cnt = JSON.parse(r.text).length; } catch {} P('   same movie list THROUGH THE RELAY:', r.status || r.err, 'items:', cnt, cnt === '?' ? 'answer: ' + mask(r.text || '').slice(0, 80) : ''); }
  if (n >= 2 && info) break;
}
if (rs.enabled && rs.baseUrl) {
  P('reseller API tests:');
  for (const k of ['credits']) { const a = (rs.actions || {})[k]; if (!a || !a.url) continue; const url = a.url.replace(/\{base\}/g, String(rs.baseUrl).replace(/\/+$/, '')).replace(/\{key\}/g, encodeURIComponent(rs.apiKey || '')).replace(/\{reseller_user\}/g, encodeURIComponent(rs.username || '')).replace(/\{reseller_pass\}/g, encodeURIComponent(rs.password || '')); const r = await get(url, { method: a.method || 'GET' }); P(`   ${k}:`, r.status || r.err, r.type, 'answer:', mask(r.text || '').replace(/\s+/g, ' ').slice(0, 160)); }
  const root = await get(String(rs.baseUrl).replace(/\/+$/, '') + '/', {}); P('   panel home page:', root.status || root.err, 'kind:', (String(root.text || '').match(/xui|xtream|1-stream|streamcreed|zapx|nxt|activecode|cloudflare|just a moment/gi) || ['unknown']).slice(0, 3).join(','));
}
P('\n===== END =====');
