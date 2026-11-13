// Automated checks for the backend (run: node --test tests/). Uses an in-memory store and made-up test data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, totp, totpOk, stripeSign, stripeSigOk, payUrlFor } from '../public/core.js';

function setup() {
  const db = new Map(); const mails = []; const calls = [];
  const store = { get: async (k) => { const v = db.get(k); if (!v) return null; if (v.e && v.e < Date.now()) { db.delete(k); return null; } return JSON.parse(v.v); }, put: async (k, v, ttl) => { db.set(k, { v: JSON.stringify(v), e: ttl ? Date.now() + ttl * 1000 : 0 }); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url, init) => { calls.push(url); if (String(url).includes('api.resend.com')) { mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'm1' }) }; } return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; };
  const be = createBackend({ store, fetchFn, mode: 'server' });
  const call = (method, path, body, token, query) => be.handle({ method, path, body: body || {}, token, query: query || {} });
  return { db, store, mails, calls, be, call };
}
async function adminToken(x) { const r = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' }); assert.equal(r.status, 200); return r.json.token; }
async function addCustomer(x, tok, extra = {}) {
  const r = await x.call('POST', '/api/admin/customers', { name: 'Test Person', username: 'testuser', password: 'secret12', email: 'test.person@example.com', planId: 'p1', ...extra }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customer || r.json;
}

test('login: wrong password is refused and 8 wrong tries lock the username', async () => {
  const x = setup(); await adminToken(x);
  for (let i = 0; i < 8; i++) assert.equal((await x.call('POST', '/api/login', { username: 'Iptv', password: 'nope', ip: '1.2.3.4' })).status, 401);
  const locked = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv', ip: '1.2.3.4' });
  assert.equal(locked.status, 429);
  const other = await x.call('POST', '/api/login', { username: 'someoneelse', password: 'x', ip: '9.9.9.9' });
  assert.equal(other.status, 401, 'another network and username is not locked');
});

test('two-factor login: setup, enable, required at sign-in, disable', async () => {
  const x = setup(); const tok = await adminToken(x);
  const st = await x.call('POST', '/api/admin/2fa/setup', {}, tok); assert.equal(st.status, 200); assert.match(st.json.secret, /^[A-Z2-7]{32}$/);
  assert.equal((await x.call('POST', '/api/admin/2fa/enable', { code: '000000' }, tok)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/2fa/enable', { code: await totp(st.json.secret) }, tok)).status, 200);
  const noCode = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' }); assert.equal(noCode.status, 401); assert.equal(noCode.json.need2fa, true);
  assert.equal((await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv', code: '123456' })).status, 401);
  assert.equal((await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv', code: await totp(st.json.secret) })).status, 200);
  assert.equal((await x.call('GET', '/api/admin/me', {}, tok)).json.twoFactor, true);
  assert.equal((await x.call('POST', '/api/admin/2fa/disable', { password: 'bad' }, tok)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/2fa/disable', { password: 'Iptv' }, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' })).status, 200);
});

test('TOTP matches the RFC 6238 test vector', async () => {
  // secret "12345678901234567890" in base32, time 59s → 287082 (SHA-1, 6 digits)
  assert.equal(await totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082');
  assert.equal(await totpOk('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 59000), true);
});

test('devices: listed per customer, removable, and customers only see their own', async () => {
  const x = setup(); const tok = await adminToken(x);
  await addCustomer(x, tok); await addCustomer(x, tok, { username: 'other1', email: 'other@example.com', name: 'Other' });
  const a1 = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12', ua: 'Mozilla/5.0 (Linux; Android 14) Chrome' })).json.token;
  const a2 = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12', ua: 'Mozilla/5.0 (iPhone)' })).json.token;
  const b1 = (await x.call('POST', '/api/login', { username: 'other1', password: 'secret12' })).json.token;
  const devs = (await x.call('GET', '/api/me/devices', {}, a2)).json;
  assert.equal(devs.length, 2); assert.equal(devs.filter((d) => d.current).length, 1); assert.ok(!('token' in devs[0]), 'session tokens are never sent to the app');
  assert.equal((await x.call('GET', '/api/me/devices', {}, b1)).json.length, 1);
  const first = devs.find((d) => !d.current);
  assert.equal((await x.call('POST', '/api/me/devices/remove', { did: first.did }, b1)).status, 404, 'cannot remove another customer\'s device');
  assert.equal((await x.call('POST', '/api/me/devices/remove', { did: first.did }, a2)).status, 200);
  assert.equal((await x.call('GET', '/api/me', {}, a1)).status, 401, 'removed device is signed out');
  assert.equal((await x.call('GET', '/api/me', {}, a2)).status, 200);
});

test('support tickets: create, reply both ways, isolation, daily limit, permissions', async () => {
  const x = setup(); const tok = await adminToken(x);
  await addCustomer(x, tok); await addCustomer(x, tok, { username: 'other1', email: 'other@example.com', name: 'Other' });
  const a = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  const b = (await x.call('POST', '/api/login', { username: 'other1', password: 'secret12' })).json.token;
  assert.equal((await x.call('POST', '/api/me/tickets', { subject: 'x', text: 'y' }, a)).status, 400);
  const made = await x.call('POST', '/api/me/tickets', { subject: 'Channel not working', text: 'Channel 5 shows a black screen.' }, a); assert.equal(made.status, 200);
  assert.equal((await x.call('GET', '/api/me/tickets', {}, b)).json.length, 0);
  assert.equal((await x.call('POST', '/api/me/tickets/reply', { id: made.json.id, text: 'hello' }, b)).status, 404);
  assert.notEqual((await x.call('GET', '/api/admin/tickets', {}, a)).status, 200, 'customers cannot open admin pages');
  const rep = await x.call('POST', '/api/admin/tickets/reply', { id: made.json.id, text: 'Please try again now.' }, tok); assert.equal(rep.status, 200);
  const mine = (await x.call('GET', '/api/me/tickets', {}, a)).json; assert.equal(mine[0].status, 'answered'); assert.equal(mine[0].messages.length, 2); assert.ok(!('customerId' in mine[0]));
  assert.equal((await x.call('POST', '/api/me/tickets/reply', { id: made.json.id, text: 'Works, thanks' }, a)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/tickets/reply', { id: made.json.id, status: 'closed' }, tok)).json.ticket.status, 'closed');
  await x.call('POST', '/api/me/tickets', { subject: 'Second one', text: 'Another question here' }, a);
  await x.call('POST', '/api/me/tickets', { subject: 'Third one', text: 'Another question here' }, a);
  assert.equal((await x.call('POST', '/api/me/tickets', { subject: 'Fourth one', text: 'Another question here' }, a)).status, 429);
});

test('password reset by email: link works once, old sessions end, unknown accounts get the same answer', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>' } }, tok);
  await addCustomer(x, tok);
  const old = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  assert.deepEqual((await x.call('POST', '/api/forgot', { login: 'nobody', appUrl: 'https://app.example' })).json, { ok: true });
  assert.equal(x.mails.length, 0);
  assert.deepEqual((await x.call('POST', '/api/forgot', { login: 'testuser', appUrl: 'https://app.example' })).json, { ok: true });
  assert.equal(x.mails.length, 1); assert.deepEqual(x.mails[0].to, ['test.person@example.com']);
  const tk = x.mails[0].html.match(/#reset=([0-9a-f]+)/)[1];
  assert.equal((await x.call('POST', '/api/reset', { t: 'deadbeefdeadbeefdeadbeef', password: 'newpass99' })).status, 400);
  assert.equal((await x.call('POST', '/api/reset', { t: tk, password: '123' })).status, 400);
  assert.equal((await x.call('POST', '/api/reset', { t: tk, password: 'newpass99' })).status, 200);
  assert.equal((await x.call('POST', '/api/reset', { t: tk, password: 'again12345' })).status, 400, 'link works only once');
  assert.equal((await x.call('GET', '/api/me', {}, old)).status, 401);
  assert.equal((await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).status, 401);
  assert.equal((await x.call('POST', '/api/login', { username: 'testuser', password: 'newpass99' })).status, 200);
});

test('Stripe webhook: only signed, paid events activate; never twice; records are kept', async () => {
  const x = setup(); const tok = await adminToken(x); const secret = 'whsec_test_123';
  const cust = await addCustomer(x, tok);
  const before = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.username === 'testuser').expiresAt;
  const event = (id, obj) => JSON.stringify({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_' + id, payment_status: 'paid', amount_total: 4999, currency: 'eur', client_reference_id: cust.id, customer_details: { email: 'test.person@example.com' }, metadata: { package: 'o3m' }, ...obj } } });
  const raw = event('evt_1', {});
  assert.equal((await x.call('POST', '/api/stripe/webhook', { raw, sig: await stripeSign(raw, secret) })).status, 400, 'refused until a signing secret is saved');
  await x.call('PUT', '/api/admin/settings', { finance: { stripeWebhookSecrets: secret } }, tok);
  assert.equal((await x.call('POST', '/api/stripe/webhook', { raw, sig: await stripeSign(raw, 'whsec_wrong') })).status, 400);
  assert.equal((await x.call('POST', '/api/stripe/webhook', { raw: raw.replace('4999', '1'), sig: await stripeSign(raw, secret) })).status, 400, 'changed body is refused');
  assert.equal((await x.call('POST', '/api/stripe/webhook', { raw, sig: await stripeSign(raw, secret, Math.floor(Date.now() / 1000) - 3600) })).status, 400, 'old signature is refused');
  const unpaid = event('evt_0', { payment_status: 'unpaid' });
  assert.equal((await x.call('POST', '/api/stripe/webhook', { raw: unpaid, sig: await stripeSign(unpaid, secret) })).json.ignored, 'not paid yet');
  const good = await x.call('POST', '/api/stripe/webhook', { raw, sig: await stripeSign(raw, secret) });
  assert.equal(good.status, 200); assert.equal(good.json.result, 'activated');
  const after = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.username === 'testuser').expiresAt;
  assert.equal(Math.round((after - before) / 86400000), 90, '3-month package adds 90 days');
  assert.equal((await x.call('POST', '/api/stripe/webhook', { raw, sig: await stripeSign(raw, secret) })).json.duplicate, true);
  const again = event('evt_2', {}).replace('cs_evt_2', 'cs_evt_1'); // Stripe re-sends the same payment under a new event id
  assert.equal((await x.call('POST', '/api/stripe/webhook', { raw: again, sig: await stripeSign(again, secret) })).json.result, 'duplicate');
  assert.equal((await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.username === 'testuser').expiresAt, after, 'not extended twice');
  const stranger = event('evt_3', { client_reference_id: null, customer_details: { email: 'unknown@example.com' } });
  assert.equal((await x.call('POST', '/api/stripe/webhook', { raw: stranger, sig: await stripeSign(stranger, secret) })).json.result, 'unmatched');
  const pays = (await x.call('GET', '/api/admin/payments', {}, tok)).json; assert.equal(pays.configured, true); assert.equal(pays.list.length, 2);
  const u = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  const mine = (await x.call('GET', '/api/me/payments', {}, u)).json; assert.ok(mine.some((p) => p.days === 90));
  const st = (await x.call('GET', '/api/admin/settings', {}, tok)).json; assert.ok(st.finance.stripeWebhookSecrets);
});

test('helpers: signature check and customer pay link', async () => {
  const raw = '{"a":1}'; const sig = await stripeSign(raw, 'whsec_a');
  assert.equal(await stripeSigOk(raw, sig, 'whsec_a'), true); assert.equal(await stripeSigOk(raw, sig, 'whsec_b'), false); assert.equal(await stripeSigOk(raw, '', 'whsec_a'), false);
  assert.equal(payUrlFor('https://buy.stripe.com/abc', { id: 'c1', email: 'A@b.co' }), 'https://buy.stripe.com/abc?client_reference_id=c1&prefilled_email=a%40b.co');
  assert.equal(payUrlFor('https://example.com/pay', { id: 'c1' }), 'https://example.com/pay');
});

// ---- own playlists ----
import { parseM3U, m3uAnswer } from '../public/m3u.js';
test('M3U playlists: names, groups, logos, movies, and messy files', () => {
  const text = ['#EXTM3U url-tvg="http://epg.example/x.xml"', '', '#EXTINF:-1 tvg-id="one.fr" tvg-name="One" tvg-logo="https://img.example/one.png" group-title="News, World",One, the first HD',
    'http://tv.example/live/u/p/1.ts', '#EXTINF:-1,Plain', '#EXTVLCOPT:http-user-agent=X', 'http://tv.example/live/u/p/2.m3u8', '#EXTINF:0 group-title="Films",A Film (2020)', 'http://tv.example/movie/u/p/9.mkv',
    'garbage line', '#EXTINF:-1,No address follows', '#EXTINF:-1 tvg-logo="notaurl",Last', '#EXTGRP:Sport', 'https://tv.example/last/stream', 'http://tv.example/bare/file.ts'].join('\r\n');
  const items = parseM3U(text);
  assert.equal(items.length, 5);
  assert.deepEqual({ ...items[0] }, { name: 'One, the first HD', logo: 'https://img.example/one.png', group: 'News, World', tid: 'one.fr', url: 'http://tv.example/live/u/p/1.ts', vod: false });
  assert.equal(items[1].name, 'Plain'); assert.equal(items[2].vod, true);
  assert.equal(items[3].name, 'Last'); assert.equal(items[3].group, 'Sport'); assert.equal(items[3].logo, '');
  assert.equal(items[4].name, 'file');
  assert.deepEqual(m3uAnswer(items, 'get_live_categories').map((c) => c.category_name), ['News, World', '—', 'Sport']);
  assert.equal(m3uAnswer(items, 'get_live_streams', { category_id: 'Sport' })[0].stream_id, 3);
  assert.equal(m3uAnswer(items, 'get_vod_streams')[0].container_extension, 'mkv');
  assert.deepEqual(m3uAnswer(items, 'get_series'), []);
  assert.deepEqual(parseM3U('<html>not a playlist</html>'), []);
  assert.equal(parseM3U(text, 2).length, 2);
});

test('customer two-step sign-in: on, required, secrets never sent, support can turn it off', async () => {
  const x = setup(); const tok = await adminToken(x); const cust = await addCustomer(x, tok);
  const u = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  const st = await x.call('POST', '/api/me/2fa/setup', {}, u); assert.equal(st.status, 200);
  assert.equal((await x.call('POST', '/api/me/2fa/enable', { code: '000000' }, u)).status, 400);
  assert.equal((await x.call('POST', '/api/me/2fa/enable', { code: await totp(st.json.secret) }, u)).status, 200);
  const me = (await x.call('GET', '/api/me', {}, u)).json; assert.equal(me.user.twoFactor, true); assert.ok(!JSON.stringify(me).includes(st.json.secret), 'the key is not sent back to the app');
  assert.ok(!JSON.stringify((await x.call('GET', '/api/admin/customers', {}, tok)).json).includes(st.json.secret), 'nor to the admin list');
  const no = await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' }); assert.equal(no.status, 401); assert.equal(no.json.need2fa, true);
  assert.equal((await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12', code: await totp(st.json.secret) })).status, 200);
  assert.equal((await x.call('POST', `/api/admin/customers/${cust.id}/tfaoff`, {}, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).status, 200);
});

test('email check: code by email, wrong codes refused, verified flag follows the address', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>' } }, tok);
  const cust = await addCustomer(x, tok); const sent = x.mails.length;
  const u = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  assert.equal((await x.call('GET', '/api/me', {}, u)).json.user.emailVerified, false);
  assert.equal((await x.call('POST', '/api/me/email/send', {}, u)).status, 200); assert.equal(x.mails.length, sent + 1);
  const code = x.mails.at(-1).html.match(/>(\d{6})</)[1];
  assert.equal((await x.call('POST', '/api/me/email/verify', { code: code === '111111' ? '222222' : '111111' }, u)).status, 400);
  assert.equal((await x.call('POST', '/api/me/email/verify', { code }, u)).status, 200);
  assert.equal((await x.call('GET', '/api/me', {}, u)).json.user.emailVerified, true);
  assert.equal((await x.call('POST', '/api/me/email/verify', { code }, u)).status, 400, 'a code works once');
  await x.call('PUT', `/api/admin/customers/${cust.id}`, { email: 'new.address@example.com' }, tok);
  assert.equal((await x.call('GET', '/api/me', {}, u)).json.user.emailVerified, false, 'a changed address must be checked again');
});

test('support pictures: stored with the message, only readable by the owner and staff, bad files refused', async () => {
  const x = setup(); const tok = await adminToken(x);
  await addCustomer(x, tok); await addCustomer(x, tok, { username: 'other1', email: 'other@example.com', name: 'Other' });
  const a = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  const b = (await x.call('POST', '/api/login', { username: 'other1', password: 'secret12' })).json.token;
  const image = 'data:image/jpeg;base64,' + 'A'.repeat(400);
  assert.equal((await x.call('POST', '/api/me/tickets', { subject: 'Screen problem', text: 'See the picture please', image: 'data:text/html;base64,AAAA' }, a)).status, 400);
  assert.equal((await x.call('POST', '/api/me/tickets', { subject: 'Screen problem', text: 'See the picture please', image: 'data:image/jpeg;base64,' + 'A'.repeat(700000) }, a)).status, 400);
  assert.equal((await x.call('POST', '/api/me/tickets', { subject: 'Screen problem', text: 'See the picture please', image }, a)).status, 200);
  const att = (await x.call('GET', '/api/me/tickets', {}, a)).json[0].messages[0].att; assert.ok(att);
  assert.equal((await x.call('GET', '/api/me/tickets/att', {}, a, { id: att })).json.data, image);
  assert.equal((await x.call('GET', '/api/me/tickets/att', {}, b, { id: att })).status, 404, 'another customer cannot open it');
  assert.equal((await x.call('GET', '/api/admin/tickets/att', {}, tok, { id: att })).json.data, image);
});

// ---- panel credits and bounced emails ----
import { findCredits, emailTypo } from '../public/core.js';
test('panel credits are found in the usual answer shapes', () => {
  assert.equal(findCredits({ credits: 120 }, 'credits'), 120);
  assert.equal(findCredits({ credits: '87.50' }, 'credits'), 87.5);
  assert.equal(findCredits({ status: 'success', data: { balance: '45' } }, 'credits'), 45, 'falls back when the configured path is missing');
  assert.equal(findCredits({ result: true, user: { Credits: 12 } }, ''), 12);
  assert.equal(findCredits([{ id: 1, credit: '3' }], 'credits'), 3);
  assert.equal(findCredits('250', 'credits'), 250);
  assert.equal(findCredits({ message: 'ok' }, 'credits'), null);
  assert.equal(findCredits({ a: { b: { credits: 7 } } }, 'a.b.credits'), 7);
});
test('panel credits: refused by the panel -> retried through the relay; last good value is kept; errors are explained', async () => {
  const x = setup(); const tok = await adminToken(x); let mode = 'blocked';
  const realFetch = x.be; const calls = [];
  // rebuild a backend whose panel refuses direct calls
  const db = new Map(); const store = { get: async (k) => (db.has(k) ? JSON.parse(db.get(k)) : null), put: async (k, v) => { db.set(k, JSON.stringify(v)); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url) => { calls.push(String(url));
    if (String(url).startsWith('https://relay.example/x')) return mode === 'down' ? { ok: false, status: 502, text: async () => 'upstream error' } : { ok: true, status: 200, text: async () => '{"status":"success","data":{"credits":"64"}}' };
    if (String(url).startsWith('http://panel.example')) return { ok: false, status: 403, text: async () => '<html>Access denied</html>' };
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; };
  const be = createBackend({ store, fetchFn, mode: 'server' }); const call = (m, p, b, t, q) => be.handle({ method: m, path: p, body: b || {}, token: t, query: q || {} });
  const t2 = (await call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' })).json.token;
  await call('PUT', '/api/admin/settings', { reseller: { enabled: true, baseUrl: 'http://panel.example', apiKey: 'k' }, player: { relayUrl: 'https://relay.example' } }, t2);
  const good = (await call('GET', '/api/admin/panel/credits', {}, t2)).json;
  assert.equal(good.ok, true); assert.equal(good.credits, 64); assert.ok(calls.some((u) => u.startsWith('https://relay.example/x?u=')));
  mode = 'down';
  const bad = (await call('GET', '/api/admin/panel/credits', {}, t2)).json;
  assert.equal(bad.ok, false); assert.equal(bad.last.v, 64, 'the last good number is still shown'); assert.match(bad.error, /403|refused/);
});
test('bounced emails: typos are caught, bounces are pulled from Resend, paused addresses are skipped until allowed', async () => {
  assert.equal(emailTypo('someone@gmial.com'), 'someone@gmail.com'); assert.equal(emailTypo('someone@gmail.com'), '');
  const db = new Map(); const mails = []; let listed = [{ id: 'e1', to: ['test.person@example.com'], last_event: 'bounced', created_at: '2026-11-12T10:00:00Z' }, { id: 'e2', to: ['fine@example.com'], last_event: 'delivered', created_at: '2026-11-12T10:00:00Z' }];
  const store = { get: async (k) => (db.has(k) ? JSON.parse(db.get(k)) : null), put: async (k, v) => { db.set(k, JSON.stringify(v)); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url, init) => { url = String(url);
    if (url.startsWith('https://api.resend.com/emails?')) return { ok: true, status: 200, json: async () => ({ data: listed, has_more: false }) };
    if (url.startsWith('https://api.resend.com/emails')) { mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'm' }) }; }
    if (url.startsWith('https://cloudflare-dns.com')) return { ok: true, status: 200, json: async () => ({ Status: url.includes('nosuchdomain') ? 3 : 0 }) };
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; };
  const be = createBackend({ store, fetchFn, mode: 'server' }); const call = (m, p, b, t, q) => be.handle({ method: m, path: p, body: b || {}, token: t, query: q || {} });
  const tok = (await call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' })).json.token;
  await call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>' }, trial: { enabled: true } }, tok);
  const mk = (extra) => call('POST', '/api/admin/customers', { name: 'Test Person', username: 'testuser', password: 'secret12', email: 'test.person@example.com', planId: 'p1', ...extra }, tok);
  assert.match((await mk({ email: 'a@gmial.com' })).json.error, /Did you mean a@gmail.com/);
  assert.match((await mk({ email: 'a@nosuchdomain.example' })).json.error, /does not exist/);
  assert.equal((await mk()).status, 200);
  const typo = await call('POST', '/api/trial', { name: 'New Person', email: 'new@hotmial.com', phone: '+212612345678' }); assert.equal(typo.status, 400); assert.equal(typo.json.suggest, 'new@hotmail.com');
  const sync = await call('POST', '/api/admin/email/bounces/sync', {}, tok); assert.equal(sync.json.added, 1); assert.equal(sync.json.checked, 2);
  assert.equal((await call('POST', '/api/admin/email/bounces/sync', {}, tok)).json.added, 0, 'not added twice');
  const list = (await call('GET', '/api/admin/email/bounces', {}, tok)).json.list; assert.equal(list.length, 1); assert.equal(list[0].customers[0].username, 'testuser');
  assert.equal((await call('GET', '/api/admin/customers', {}, tok)).json[0].emailBad, 'bounced');
  const before = mails.length;
  const u = (await call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  assert.equal((await call('POST', '/api/me/email/send', {}, u)).status, 502, 'nothing is sent to a paused address'); assert.equal(mails.length, before);
  await call('POST', '/api/admin/email/bounces/clear', { email: 'test.person@example.com' }, tok);
  assert.equal((await call('POST', '/api/admin/email/bounces/sync', {}, tok)).json.added, 0, 'an allowed address is not paused again by the same old bounce');
  assert.equal((await call('POST', '/api/me/email/send', {}, u)).status, 200); assert.equal(mails.length, before + 1);
});

test('templates: the owner can reword emails and WhatsApp, preview unsaved text, add messages, and go back to the original', async () => {
  const x = setup(); const tok = await adminToken(x);
  const t0 = (await x.call('GET', '/api/admin/templates', {}, tok)).json;
  assert.ok(t0.defaults.AM.en.trialTitle); assert.deepEqual(t0.custom, {});
  const pv = await x.call('POST', '/api/admin/templates/preview', { kind: 'trial', lang: 'en', mailTexts: { AM: { en: { trialTitle: 'MY OWN TRIAL TITLE' } } } }, tok);
  assert.match(pv.json.html, /MY OWN TRIAL TITLE/); assert.match(pv.json.subject, /MY OWN TRIAL TITLE/);
  assert.doesNotMatch((await x.call('POST', '/api/admin/templates/preview', { kind: 'trial', lang: 'en' }, tok)).json.html, /MY OWN TRIAL TITLE/, 'a preview does not save anything');
  await x.call('PUT', '/api/admin/settings', { mailTexts: { AM: { en: { trialTitle: 'Saved title', nope: 'x', dir: 'rtl' } }, RM: { fr: { title: t0.defaults.RM.fr.title } } }, waTemplates: { pay: { en: 'Pay here {link}' } }, waCustom: [{ name: 'Welcome back', text: { en: 'Hi {name}, welcome back to {app}!' } }] }, tok);
  const t1 = (await x.call('GET', '/api/admin/templates', {}, tok)).json;
  assert.deepEqual(t1.custom, { AM: { en: { trialTitle: 'Saved title' } } }, 'unknown keys, layout keys and unchanged texts are not stored');
  assert.equal(t1.wa.pay.en, 'Pay here {link}'); assert.equal(t1.waCustom.length, 1);
  assert.match((await x.call('POST', '/api/admin/templates/preview', { kind: 'trial', lang: 'en', mailTexts: t1.custom }, tok)).json.html, /Saved title/);
  for (const kind of ['welcome', 'renewal', 'order', 'expiry']) for (const lang of ['en', 'fr', 'ar']) assert.ok((await x.call('POST', '/api/admin/templates/preview', { kind, lang }, tok)).json.html.length > 200, kind + ' ' + lang);
  const cust = await addCustomer(x, tok, { phone: '212600000001' });
  const own = await x.call('POST', `/api/admin/customers/${cust.id}/wamsg`, { type: 'c:' + t1.waCustom[0].id, lang: 'en' }, tok);
  assert.match(own.json.text, /Hi Test, welcome back to/);
  await x.call('PUT', '/api/admin/settings', { mailTexts: {}, waTemplates: {} }, tok);
  const t2 = (await x.call('GET', '/api/admin/templates', {}, tok)).json; assert.deepEqual(t2.custom, {}); assert.deepEqual(t2.wa, {});
  assert.doesNotMatch((await x.call('POST', '/api/admin/templates/preview', { kind: 'trial', lang: 'en' }, tok)).json.html, /Saved title/, 'the original wording is back');
});

import { parseLineLink } from '../public/core.js';
test('line links from the panel are read correctly', () => {
  assert.deepEqual(parseLineLink('http://tv.example.com:8080/get.php?username=abc12&password=xy_99&type=m3u_plus&output=ts'), { dns: 'http://tv.example.com:8080', u: 'abc12', p: 'xy_99' });
  assert.deepEqual(parseLineLink('  m3u: https://tv.example.com/live/abc12/xy_99/55.ts '), { dns: 'https://tv.example.com', u: 'abc12', p: 'xy_99' });
  assert.deepEqual(parseLineLink('http://tv.example.com/player_api.php?username=u1&password=p1'), { dns: 'http://tv.example.com', u: 'u1', p: 'p1' });
  assert.equal(parseLineLink('http://tv.example.com/get.php'), null); assert.equal(parseLineLink('hello'), null);
});
test('free trial: never blocked by the panel; uses a ready line, else waits; phone needs a country code; admin can activate by pasting a link', async () => {
  const db = new Map(); const mails = [];
  const store = { get: async (k) => (db.has(k) ? JSON.parse(db.get(k)) : null), put: async (k, v) => { db.set(k, JSON.stringify(v)); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url, init) => { url = String(url);
    if (url.startsWith('https://api.resend.com/emails')) { mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'm' }) }; }
    if (url.startsWith('http://panel.example')) return { ok: false, status: 500, text: async () => '{"status":"error","message":"Not enough credits"}' };
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; };
  const be = createBackend({ store, fetchFn, mode: 'server' }); const call = (m, p, b, t, q) => be.handle({ method: m, path: p, body: b || {}, token: t, query: q || {} });
  const tok = (await call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' })).json.token;
  await call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', adminEmail: 'owner@example.com' }, trial: { enabled: true }, reseller: { enabled: true, baseUrl: 'http://panel.example', apiKey: 'k' }, player: { serverUrl: 'http://tv.example.com:8080' } }, tok);
  assert.equal((await call('POST', '/api/trial', { name: 'No Code', email: 'a@example.com', phone: '0612345678' })).json.error, 'trial_phone');
  const add = await call('POST', '/api/admin/trialpool', { add: 'http://tv.example.com:8080/get.php?username=ready1&password=pw1&type=m3u_plus\nnot a link\nhttp://tv.example.com:8080/get.php?username=ready1&password=pw1' }, tok);
  assert.equal(add.json.added, 1); assert.equal(add.json.skipped, 2);
  const one = await call('POST', '/api/trial', { name: 'First Person', email: 'first@example.com', phone: '+212612345678', ip: '1.1.1.1' });
  assert.equal(one.status, 200); assert.equal(one.json.username, 'ready1'); assert.equal(one.json.password, 'pw1'); assert.equal(one.json.pending, false); assert.match(one.json.m3u, /username=ready1/); assert.equal(one.json.emailed, true);
  assert.ok(mails.some((m) => m.to[0] === 'first@example.com')); assert.ok(mails.some((m) => m.to[0] === 'owner@example.com' && /ready trial line/.test(m.subject)), 'owner is told the pool is running low');
  assert.equal((await call('POST', '/api/login', { username: 'ready1', password: 'pw1' })).status, 200, 'the customer can sign in at once');
  const two = await call('POST', '/api/trial', { name: 'Second Person', email: 'second@example.com', phone: '+33698765432', ip: '2.2.2.2' });
  assert.equal(two.status, 200); assert.equal(two.json.pending, true); assert.ok(two.json.username && two.json.password);
  const note = mails.find((m) => m.to[0] === 'owner@example.com' && /waiting/i.test(m.subject)); assert.ok(note); assert.match(note.html, /Not enough credits/, 'the owner sees what the panel answered');
  assert.ok(!mails.some((m) => m.to[0] === 'second@example.com'), 'no login email before the line exists');
  const u2 = (await call('POST', '/api/login', { username: two.json.username, password: two.json.password })).json.token;
  const me = (await call('GET', '/api/me', {}, u2)).json; assert.ok(me.user.pendingLine); assert.equal(me.stream, null);
  const waiting = (await call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.email === 'second@example.com');
  assert.match((await call('PUT', `/api/admin/customers/${waiting.id}`, { m3u: 'nonsense' }, tok)).json.error, /line link/);
  const act = await call('PUT', `/api/admin/customers/${waiting.id}`, { m3u: 'http://tv.example.com:8080/get.php?username=manual7&password=mpw&type=m3u_plus' }, tok);
  assert.equal(act.json.activated, true); assert.equal(act.json.emailed, true); assert.equal(act.json.username, 'manual7'); assert.ok(!act.json.pendingLine);
  assert.ok(mails.some((m) => m.to[0] === 'second@example.com'));
  const u3 = (await call('POST', '/api/login', { username: 'manual7', password: 'mpw' })).json.token;
  assert.equal((await call('GET', '/api/me', {}, u3)).json.stream.u, 'manual7');
  const made = await call('POST', '/api/admin/customers', { name: 'Pasted Only', m3u: 'http://tv.example.com:8080/get.php?username=paste1&password=ppw99', planId: 'p1' }, tok);
  assert.equal(made.status, 200); assert.equal((made.json.customer || made.json).username, 'paste1');
});

test('live chat: both sides see the messages, unread counts work, customers cannot read other chats', async () => {
  const x = setup(); const tok = await adminToken(x);
  const a = await addCustomer(x, tok); await addCustomer(x, tok, { username: 'other1', email: 'other@example.com', name: 'Other' });
  const ua = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  const ub = (await x.call('POST', '/api/login', { username: 'other1', password: 'secret12' })).json.token;
  assert.equal((await x.call('POST', '/api/me/chat', { text: '   ' }, ua)).status, 400);
  assert.equal((await x.call('POST', '/api/me/chat', { text: 'Hello, my channel list is empty' }, ua)).json.messages.length, 1);
  const idx = (await x.call('GET', '/api/admin/chats', {}, tok)).json; assert.equal(idx.length, 1); assert.equal(idx[0].ua, 1); assert.equal(idx[0].username, 'testuser');
  assert.equal((await x.call('GET', '/api/admin/chat', {}, tok, { id: a.id })).json.messages[0].text, 'Hello, my channel list is empty');
  assert.equal((await x.call('GET', '/api/admin/chats', {}, tok)).json[0].ua, 0, 'opening the chat marks it read');
  assert.equal((await x.call('POST', '/api/admin/chat', { id: a.id, text: 'Please sign out and in again.' }, tok)).json.messages.length, 2);
  assert.equal((await x.call('GET', '/api/me', {}, ua)).json.chatUnread, 1);
  const mine = (await x.call('GET', '/api/me/chat', {}, ua)).json.messages; assert.equal(mine.length, 2); assert.equal(mine[1].from, 's'); assert.ok(!('by' in mine[1]), 'staff names are not sent to customers');
  assert.equal((await x.call('GET', '/api/me', {}, ua)).json.chatUnread, 0);
  assert.equal((await x.call('GET', '/api/me/chat', {}, ub)).json.messages.length, 0, 'another customer sees only their own chat');
  assert.notEqual((await x.call('GET', '/api/admin/chats', {}, ua)).status, 200);
});
