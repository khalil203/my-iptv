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
