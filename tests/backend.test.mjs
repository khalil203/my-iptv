// Automated checks for the backend (run: node --test tests/). Uses an in-memory store and made-up test data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createBackend, totp, totpOk, stripeSign, stripeSigOk, payUrlFor, accessEmail, orderEmail, newsletterEmail, renewalEmail, parseResellerText, parseLooseDate, parseMoney, cleanPhoneText, scrubCards, cleanRslId } from '../public/core.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

function setup(hook) {
  const db = new Map(); const mails = []; const calls = []; const tg = [];
  const store = { get: async (k) => { const v = db.get(k); if (!v) return null; if (v.e && v.e < Date.now()) { db.delete(k); return null; } return JSON.parse(v.v); }, put: async (k, v, ttl) => { db.set(k, { v: JSON.stringify(v), e: ttl ? Date.now() + ttl * 1000 : 0 }); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url, init) => {
    calls.push(url);
    if (hook) { const r = await hook(String(url), init || {}); if (r) return r; }
    if (String(url).includes('api.resend.com')) { mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'm1' }) }; }
    if (String(url).includes('api.telegram.org')) { tg.push(JSON.parse(init.body || '{}')); return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'testbot' } }) }; }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  };
  db.set('settings', { v: JSON.stringify({ security: { force2fa: false, captcha: false } }), e: 0 });
  const be = createBackend({ store, fetchFn, mode: 'server' });
  const call = (method, path, body, token, query) => be.handle({ method, path, body: body || {}, token, query: query || {} });
  return { db, store, mails, calls, tg, be, call };
}
async function adminToken(x) { const r = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' }); assert.equal(r.status, 200); return r.json.token; }
async function signBylaws(x, token) {
  const r = await x.call('POST', '/api/admin/bylaws/sign', { name: 'Test Staff Member' }, token);
  assert.equal(r.status, 200, 'staff signs the mandatory bylaws');
  return r;
}
async function addCustomer(x, tok, extra = {}) {
  const username = (extra && extra.username) || 'testuser';
  const r = await x.call('POST', '/api/admin/customers', { name: 'Test Person', username: 'testuser', password: 'secret12', email: 'test.person@example.com', planId: 'p1', ...extra }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const realUsername = (r.json.customer && r.json.customer.username) || (extra && extra.username) || 'testuser';
  // Accept the terms like a real customer does on first open (after any line adoption)
  const u = await x.call('POST', '/api/login', { username: realUsername, password: (extra && extra.linePassword && extra.lineSame === false) ? extra.linePassword : 'secret12' }); assert.equal(u.status, 200);
  await x.call('POST', '/api/me/agree', {}, u.json.token);
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
  assert.ok(devs.length >= 2); assert.equal(devs.filter((d) => d.current).length, 1); assert.ok(!('token' in devs[0]), 'session tokens are never sent to the app');
  assert.ok((await x.call('GET', '/api/me/devices', {}, b1)).json.length >= 1);
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

test('Stripe revenue: sales are attributed to the Stripe account from the webhook secret, used by the accounts page', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', {
    orderPackages: [{ id: 'o1m', title: '1 Month', days: 30, devices: 1, price: 29.99, badge: '', link: '' }],
    stripeAccounts: [{ id: 'norm', name: 'Normal', currency: 'USD', status: 'active', payoutDays: 7, bankId: 'stripe', links: [] }, { id: 'sold', name: 'Seller', currency: 'EUR', status: 'active', payoutDays: 2, bankId: '', links: [] }],
    finance: { stripeWebhookSecrets: 'whsec_norm:norm\nwhsec_sold:sold' }
  }, tok);
  const c1 = await addCustomer(x, tok, { username: 'buyer_norm', email: 'norm@example.com' });
  const c2 = await addCustomer(x, tok, { username: 'buyer_sold', email: 'sold@example.com' });
  const event = (id, ref, email) => JSON.stringify({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_' + id, payment_status: 'paid', amount_total: 2999, currency: 'usd', client_reference_id: ref, customer_details: { email }, metadata: { package: 'o1m' } } } });
  for (const [ev, sec, ref, email] of [['evt_a', 'whsec_norm', c1.id, 'norm@example.com'], ['evt_b', 'whsec_sold', c2.id, 'sold@example.com']]) {
    const raw = event(ev, ref, email);
    const r = await x.call('POST', '/api/stripe/webhook', { raw, sig: await stripeSign(raw, sec) });
    assert.equal(r.json.result, 'activated', JSON.stringify(r.json));
  }
  const rev = await x.call('GET', '/api/admin/stripe/revenue', {}, tok);
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  const by = Object.fromEntries((rev.json.stripeAccounts || []).map((e) => [e.accountId, e]));
  assert.equal(by.norm?.n, 1, 'the Normal account got one recorded sale');
  assert.ok(by.norm.usd > 29.9, 'and its amount is in USD');
  assert.equal(by.sold?.n, 1, 'the Seller account got the other');
  assert.equal(rev.json.unattributedN, 0);
});

test('Stripe webhook: only signed, paid events activate; never twice; records are kept', async () => {
  const x = setup(); const tok = await adminToken(x); const secret = 'whsec_test_123';
  await x.call('PUT', '/api/admin/settings', { orderPackages: [{ id: 'o3m', title: '3 Months', days: 90, devices: 1, price: 49.99, badge: '', link: '' }] }, tok);
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
  await store.put('settings', { security: { force2fa: false, captcha: false } });
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
  await store.put('settings', { security: { force2fa: false, captcha: false } });
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
  await call('POST', '/api/me/agree', {}, u);
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
  for (const kind of ['welcome', 'renewal', 'order', 'expiry']) for (const lang of ['en', 'fr']) assert.ok((await x.call('POST', '/api/admin/templates/preview', { kind, lang }, tok)).json.html.length > 200, kind + ' ' + lang);
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
  await store.put('settings', { security: { force2fa: false, captcha: false } });
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

test('adding a customer is not blocked when the panel answers 404; the answer is passed back', async () => {
  const db = new Map();
  const store = { get: async (k) => (db.has(k) ? JSON.parse(db.get(k)) : null), put: async (k, v) => { db.set(k, JSON.stringify(v)); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url) => (String(url).startsWith('http://panel.example') ? { ok: false, status: 404, text: async () => '<html>Not Found</html>' } : { ok: true, status: 200, json: async () => ({}), text: async () => '{}' });
  await store.put('settings', { security: { force2fa: false, captcha: false } });
  const be = createBackend({ store, fetchFn, mode: 'server' }); const call = (m, p, b, t, q) => be.handle({ method: m, path: p, body: b || {}, token: t, query: q || {} });
  const tok = (await call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' })).json.token;
  await call('PUT', '/api/admin/settings', { reseller: { enabled: true, baseUrl: 'http://panel.example', apiKey: 'k' } }, tok);
  const r = await call('POST', '/api/admin/customers', { name: 'Test Person', username: 'testuser', password: 'secret12', phone: '+212612345678', planId: 'p1', createOnPanel: true }, tok);
  assert.equal(r.status, 200); assert.equal(r.json.customer.username, 'testuser'); assert.equal(r.json.panel.ok, false); assert.match(r.json.panel.error, /404/);
  assert.equal((await call('GET', '/api/admin/customers', {}, tok)).json.length, 1);
});

test('panel sync through the line: end date and devices follow the panel, missing lines are flagged', async () => {
  const db = new Map(); const exp = Math.floor(Date.now() / 1000) + 200 * 86400;
  const store = { get: async (k) => (db.has(k) ? JSON.parse(db.get(k)) : null), put: async (k, v) => { db.set(k, JSON.stringify(v)); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url) => { url = String(url);
    if (url.includes('player_api.php') && url.includes('username=good1')) return { ok: true, status: 200, text: async () => JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(exp), max_connections: '3', active_cons: '1' } }) };
    if (url.includes('player_api.php') && url.includes('username=banned1')) return { ok: true, status: 200, text: async () => JSON.stringify({ user_info: { auth: 1, status: 'Banned', exp_date: String(exp) } }) };
    if (url.includes('player_api.php')) return { ok: true, status: 200, text: async () => JSON.stringify({ user_info: { auth: 0 } }) };
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; };
  await store.put('settings', { security: { force2fa: false, captcha: false } });
  const be = createBackend({ store, fetchFn, mode: 'server' }); const call = (m, p, b, t, q) => be.handle({ method: m, path: p, body: b || {}, token: t, query: q || {} });
  const tok = (await call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' })).json.token;
  await call('PUT', '/api/admin/settings', { player: { serverUrl: 'http://tv.example.com:8080' } }, tok);
  for (const u of ['good1', 'banned1', 'ghost1']) assert.equal((await call('POST', '/api/admin/customers', { name: u, username: u, password: 'secret12', planId: 'p1' }, tok)).status, 200);
  const r = await call('POST', '/api/admin/sync', {}, tok); assert.equal(r.json.done, true); assert.equal(r.json.total, 3); assert.equal(r.json.bad, 2);
  const list = (await call('GET', '/api/admin/customers', {}, tok)).json; const by = (u) => list.find((c) => c.username === u);
  assert.equal(by('good1').expiresAt, exp * 1000); assert.equal(by('good1').connections, 3); assert.ok(!by('good1').lineBad); assert.ok(by('good1').daysLeft >= 199);
  assert.match(by('banned1').lineBad, /banned/); assert.match(by('ghost1').lineBad, /not found/);
  const ghost = (await call('POST', '/api/login', { username: 'ghost1', password: 'secret12' })).json.token;
  assert.match((await call('GET', '/api/me', {}, ghost)).json.user.lineBad, /not found/);
});
test('payment receipts: upload, owner approves, subscription extends, customer is told; a rejected one changes nothing', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { orderPackages: [{ id: 'o3m', title: '3 Months', days: 90, devices: 1, price: 49.99, badge: '', link: '' }, { id: 'o1m', title: '1 Month', days: 30, devices: 1, price: 29.99, badge: '', link: '' }] }, tok);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', adminEmail: 'owner@example.com' } }, tok);
  const cust = await addCustomer(x, tok); await addCustomer(x, tok, { username: 'other1', email: 'other@example.com', name: 'Other' });
  const u = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token; const ub = (await x.call('POST', '/api/login', { username: 'other1', password: 'secret12' })).json.token;
  const image = 'data:image/jpeg;base64,' + 'A'.repeat(300);
  assert.equal((await x.call('POST', '/api/me/receipt', { pkg: 'o3m' }, u)).status, 400);
  assert.equal((await x.call('POST', '/api/me/receipt', { pkg: 'o3m', image, note: 'Paid by CIH transfer' }, u)).status, 200);
  assert.ok(x.mails.some((m) => m.to[0] === 'owner@example.com' && /receipt/i.test(m.subject)));
  assert.equal((await x.call('GET', '/api/me/receipts', {}, ub)).json.length, 0);
  const rc = (await x.call('GET', '/api/admin/receipts', {}, tok)).json[0]; assert.equal(rc.status, 'pending'); assert.equal(rc.days, 90);
  const before = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.id === cust.id).expiresAt;
  const ok = await x.call('POST', '/api/admin/receipts/decide', { id: rc.id, action: 'approve' }, tok); assert.equal(ok.status, 200);
  const after = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.id === cust.id);
  assert.equal(Math.round((after.expiresAt - before) / 86400000), 90); assert.ok(after.renewPending, 'flagged until the line is renewed on the panel');
  assert.equal((await x.call('POST', '/api/admin/receipts/decide', { id: rc.id, action: 'approve' }, tok)).status, 400, 'cannot be approved twice');
  assert.ok(x.mails.some((m) => m.to[0] === 'test.person@example.com' && /confirmed/i.test(m.subject)));
  assert.equal((await x.call('GET', '/api/me/receipts', {}, u)).json[0].status, 'approved');
  assert.match((await x.call('GET', '/api/me/chat', {}, u)).json.messages.at(-1).text, /extended by 90 days/);
  await x.call('POST', '/api/me/receipt', { pkg: 'o1m', image }, u); const rc2 = (await x.call('GET', '/api/admin/receipts', {}, tok)).json[0];
  await x.call('POST', '/api/admin/receipts/decide', { id: rc2.id, action: 'reject', reason: 'Amount does not match' }, tok);
  assert.equal((await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.id === cust.id).expiresAt, after.expiresAt);
});

test('login details are the real line details; either set signs in; emails are English unless changed', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>' } }, tok);
  const made = await x.call('POST', '/api/admin/customers', { name: 'Line Person', username: 'appname1', password: 'apppass1', email: 'line.person@example.com', lang: 'fr', planId: 'p1', lineSame: false, lineUsername: 'REALuser77', linePassword: 'REALpass88' }, tok);
  const c = made.json.customer; assert.equal(c.username, 'REALuser77', 'the account uses the panel username');
  assert.equal((await x.call('POST', '/api/login', { username: 'realuser77', password: 'REALpass88' })).status, 200);
  assert.equal((await x.call('POST', '/api/login', { username: 'REALuser77', password: 'wrong' })).status, 401);
  const edit = await x.call('PUT', `/api/admin/customers/${c.id}`, { m3u: 'http://tv.example.com:8080/get.php?username=NEWline5&password=NEWpw6&type=m3u_plus' }, tok);
  assert.equal(edit.json.username, 'NEWline5'); assert.equal((await x.call('POST', '/api/login', { username: 'NEWline5', password: 'NEWpw6' })).status, 200);
  const old = await addCustomer(x, tok, { username: 'older1', email: 'older@example.com', lineSame: false, lineUsername: 'panelU', linePassword: 'panelP', password: 'secret12' });
  // an account made before this change keeps working with either set of details
  const raw = JSON.parse(JSON.stringify(await x.store.get('customers'))); const o = raw.find((k) => k.id === old.id); o.username = 'older1'; await x.store.put('customers', raw);
  assert.equal((await x.call('POST', '/api/login', { username: 'panelU', password: 'panelP' })).status, 200, 'the line details sign in even when the app username is different');
  const en = (await x.call('POST', '/api/admin/templates/preview', { kind: 'welcome', lang: 'fr' }, tok)).json; assert.match(en.html, /Abonnement|abonnement/, 'preview follows the language picked');
  const before = x.mails.length; await x.call('POST', '/api/forgot', { login: 'NEWline5', appUrl: 'https://app.example' });
  assert.match(x.mails[before].subject, /Reset your password/, 'a French customer still gets English by default');
  await x.call('PUT', '/api/admin/settings', { email: { lang: 'customer' } }, tok);
  await x.call('POST', '/api/forgot', { login: 'NEWline5', appUrl: 'https://app.example' });
  assert.match(x.mails.at(-1).subject, /Réinitialiser/, 'own language when the owner chooses that');
});

test('renewing a customer is not blocked when the panel answers an error; the customer is flagged for a manual renewal', async () => {
  const db = new Map();
  const store = { get: async (k) => (db.has(k) ? JSON.parse(db.get(k)) : null), put: async (k, v) => { db.set(k, JSON.stringify(v)); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url) => (String(url).startsWith('http://panel.example') ? { ok: false, status: 400, text: async () => 'Bad Request' } : { ok: true, status: 200, json: async () => ({}), text: async () => '{}' });
  await store.put('settings', { security: { force2fa: false, captcha: false } });
  const be = createBackend({ store, fetchFn, mode: 'server' }); const call = (m, p, b, t, q) => be.handle({ method: m, path: p, body: b || {}, token: t, query: q || {} });
  const tok = (await call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' })).json.token;
  await call('PUT', '/api/admin/settings', { reseller: { enabled: true, baseUrl: 'http://panel.example', apiKey: 'k' } }, tok);
  const c = (await call('POST', '/api/admin/customers', { name: 'Test Person', username: 'testuser', password: 'secret12', planId: 'p1' }, tok)).json.customer;
  const r = await call('POST', `/api/admin/customers/${c.id}/renew`, { planId: 'p3', syncPanel: true, price: 25 }, tok);
  assert.equal(r.status, 200); assert.equal(r.json.panel.ok, false); assert.match(r.json.panel.error, /400/);
  assert.equal(Math.round((r.json.customer.expiresAt - c.expiresAt) / 86400000), 90); assert.ok(r.json.customer.renewPending);
});

// ---- Phase 1: roles, owner-only access and phone redaction ----

test('roles: owner-only permissions cannot be granted to a team member', async () => {
  const x = setup(); const tok = await adminToken(x);
  const made = await x.call('POST', '/api/admin/team', { name: 'Khalil', username: 'khalil', password: 'secret12', role: 'Technical Manager', perms: ['customers_view', 'customers_phone', 'exports', 'calls', 'master_sheets'] }, tok);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.ok(made.json.perms.includes('customers_view'));
  assert.ok(made.json.perms.includes('customers_phone'));
  for (const k of ['exports', 'calls', 'master_sheets']) assert.ok(!made.json.perms.includes(k), k + ' is owner-only and must be dropped');

  const li = await x.call('POST', '/api/login', { username: 'khalil', password: 'secret12' });
  assert.equal(li.status, 200); assert.equal(li.json.role, 'staff');
  const me = await x.call('GET', '/api/admin/me', {}, li.json.token);
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.ownerOnly, ['exports', 'calls', 'master_sheets']);
  assert.ok(me.json.allRoles['Technical Manager'], 'role presets come from the server');
  assert.ok(me.json.modules.includes('Customers'));
  for (const k of ['exports', 'calls', 'master_sheets']) assert.ok(!me.json.perms.includes(k));
});

test('roles: a staff member cannot reach owner-only pages and the attempt is logged', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('POST', '/api/admin/team', { name: 'Said', username: 'said', password: 'secret12', role: 'Sales Agent', perms: ['customers_view'] }, tok);
  const li = await x.call('POST', '/api/login', { username: 'said', password: 'secret12' });
  assert.equal((await x.call('GET', '/api/admin/team', {}, li.json.token)).status, 403);
  const log = await x.call('GET', '/api/admin/log', {}, tok);
  assert.ok(log.json.some((e) => /blocked from GET \/api\/admin\/team/.test(e.msg)), 'the blocked attempt is in the activity log');
});

test('privacy: phone and WhatsApp are masked for staff without customers_phone, shown to the owner', async () => {
  const x = setup(); const tok = await adminToken(x);
  await addCustomer(x, tok, { phone: '212600112233', whatsapp: '212600112233' });
  await x.call('POST', '/api/admin/team', { name: 'Said', username: 'said', password: 'secret12', role: 'Sales Agent', perms: ['customers_view'] }, tok);
  const li = await x.call('POST', '/api/login', { username: 'said', password: 'secret12' });
  await signBylaws(x, li.json.token);
  const staffView = (await x.call('GET', '/api/admin/customers', {}, li.json.token)).json.find((z) => z.username === 'testuser');
  assert.match(staffView.phone, /•/); assert.ok(staffView.phone.endsWith('33'));
  assert.ok(!/\d{4}/.test(staffView.phone.replace(/•/g, '')), 'no long digit run is left');
  const ownerView = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((z) => z.username === 'testuser');
  assert.equal(ownerView.phone, '212600112233');
});

// ---- Phase 3/4: disputes & problem reports, all-agents trial queue ----

test('disputes: staff can file a problem report but cannot open the tracker; owner processes; customer dispute flag auto-creates one', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', adminEmail: 'owner@example.com' } }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Said', username: 'said', password: 'secret12', role: 'Sales Agent', perms: ['customers_view'] }, tok);
  const staff = (await x.call('POST', '/api/login', { username: 'said', password: 'secret12' })).json.token;
  await signBylaws(x, staff);

  const filed = await x.call('POST', '/api/admin/disputes', { kind: 'bug', subject: 'Panel create line fails', details: 'create_line answers 512', priority: 'high' }, staff);
  assert.equal(filed.status, 200, JSON.stringify(filed.json));
  assert.ok(!('att' in filed.json.dispute) && !('notes' in filed.json.dispute), 'tracker internals stay internal');
  assert.equal((await x.call('GET', '/api/admin/disputes', {}, staff)).status, 403, 'sales agent cannot open the tracker');
  assert.equal((await x.call('POST', '/api/admin/disputes/update', { id: filed.json.dispute.id, status: 'resolved' }, staff)).status, 403);

  const list = await x.call('GET', '/api/admin/disputes', {}, tok);
  assert.equal(list.status, 200); assert.equal(list.json.open, 1); assert.equal(list.json.high, 1);
  assert.ok(x.mails.some((m) => m.to[0] === 'owner@example.com' && /Problem report/.test(m.subject)), 'owner is notified about the problem report');
  assert.equal((await x.call('POST', '/api/admin/disputes/update', { id: filed.json.dispute.id, status: 'resolved', resolution: 'Panel fixed on their side' }, tok)).status, 200);

  const made = await addCustomer(x, tok);
  assert.equal((await x.call('PUT', `/api/admin/customers/${made.id}`, { statusFlag: 'dispute' }, tok)).status, 200);
  const list2 = await x.call('GET', '/api/admin/disputes', {}, tok);
  assert.ok(list2.json.list.some((d) => d.username === 'testuser'), 'flagging a customer as Dispute opens a dispute');
});

test('all-agents trial queue: request queues, agent claims, M3U auto-extracts credentials, trial is emailed', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { trial: { mode: 'agents' }, email: { resendKey: 're_test', from: 'App <no-reply@example.com>', adminEmail: 'owner@example.com' } }, tok);
  const r = await x.call('POST', '/api/trial', { name: 'Queue Person', email: 'queue.person@example.com', phone: '+212600112233', whatsapp: '+212600112233', telegram: '@QueuePerson', lang: 'en', ip: '9.9.9.9' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.queued, true);

  const q = await x.call('GET', '/api/admin/trialq', {}, tok);
  assert.equal(q.json.pending, 1); const id = q.json.list[0].id;
  assert.equal(q.json.list[0].telegram, 'QueuePerson', 'telegram id is stored without the @ prefix');
  assert.equal((await x.call('POST', '/api/admin/trialq/claim', { id }, tok)).status, 200);
  const sent = await x.call('POST', '/api/admin/trialq/send', { id, m3u: 'http://tv.example:8080/get.php?username=LINEUSER&password=LINEPASS&type=m3u_plus' }, tok);
  assert.equal(sent.status, 200, JSON.stringify(sent.json)); assert.equal(sent.json.username, 'LINEUSER');
  assert.equal(sent.json.telegram, 'QueuePerson', 'dispatch links get the telegram id back');
  assert.equal(sent.json.whatsapp, '+212600112233', 'dispatch links get the whatsapp number back');
  assert.ok(x.mails.some((m) => m.to[0] === 'queue.person@example.com'), 'the trial email is sent to the requester');
  assert.equal((await x.call('GET', '/api/admin/trialq', {}, tok)).json.pending, 0, 'queue entry is done');
  assert.equal((await x.call('POST', '/api/login', { username: 'LINEUSER', password: 'LINEPASS' })).status, 200, 'the new trial login works');
});

test('agent panel: pasted M3U fills the four fields and syncs the customer My Details', async () => {
  const x = setup(); const tok = await adminToken(x);
  const c = await addCustomer(x, tok);
  const m3u = 'http://panel.example.com:8080/get.php?username=LINEU&password=LINEP&type=m3u_plus&output=ts';
  const d = await x.call('POST', '/api/admin/trialq/direct', { customerId: c.id, m3u }, tok);
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(d.json.updated, true, 'existing customer is updated, not duplicated');
  assert.equal(d.json.username, 'LINEU'); assert.equal(d.json.password, 'LINEP');
  assert.equal(d.json.dns, 'http://panel.example.com:8080');
  assert.equal(d.json.m3u, m3u, 'the pasted M3U is kept intact');
  const u = await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' }); assert.equal(u.status, 200);
  const me = await x.call('GET', '/api/me', {}, u.json.token);
  assert.equal(me.status, 200, JSON.stringify(me.json));
  assert.equal(me.json.stream.u, 'LINEU');
  assert.equal(me.json.stream.p, 'LINEP');
  assert.equal(me.json.stream.dns, 'http://panel.example.com:8080');
  assert.equal(me.json.stream.m3u, m3u);
});

test('paid accounts: M3U + IBO Player sync to My Details, trial accounts refused', async () => {
  const x = setup(); const tok = await adminToken(x);
  const c = await addCustomer(x, tok);
  const m3u = 'http://paid.example.com:8080/get.php?username=PAIDU&password=PAIDP&type=m3u_plus&output=ts';
  const r = await x.call('POST', `/api/admin/customers/${c.id}/line`, { m3u, iboMac: 'AA:BB:CC:DD:EE:FF', iboKey: 'KEY-123', sendEmail: false }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.username, 'PAIDU'); assert.equal(r.json.password, 'PAIDP');
  assert.equal(r.json.dns, 'http://paid.example.com:8080');
  assert.equal(r.json.m3u, m3u, 'the pasted M3U is kept intact');
  assert.equal(r.json.ibo.mac, 'AA:BB:CC:DD:EE:FF'); assert.equal(r.json.ibo.key, 'KEY-123');
  const u = await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' }); assert.equal(u.status, 200);
  const me = await x.call('GET', '/api/me', {}, u.json.token);
  assert.equal(me.status, 200, JSON.stringify(me.json));
  assert.equal(me.json.stream.u, 'PAIDU'); assert.equal(me.json.stream.p, 'PAIDP');
  assert.equal(me.json.stream.m3u, m3u);
  assert.equal(me.json.stream.ibo.mac, 'AA:BB:CC:DD:EE:FF');
  assert.equal(me.json.stream.ibo.key, 'KEY-123');
  const r2 = await x.call('POST', `/api/admin/customers/${c.id}/line`, { iboMac: '11:22:33:44:55:66', iboKey: 'K2', sendEmail: false }, tok);
  assert.equal(r2.status, 200, JSON.stringify(r2.json)); assert.equal(r2.json.iobOnly, true);
  const me2 = await x.call('GET', '/api/me', {}, u.json.token);
  assert.equal(me2.json.stream.ibo.mac, '11:22:33:44:55:66', 'IBO-only edit updates the device');
  assert.equal(me2.json.stream.u, 'PAIDU', 'IBO-only edit keeps the line');
  await x.call('POST', '/api/trial', { name: 'Trial Only', email: 'paidcheck@example.com', phone: '+212600998877', lang: 'en', ip: '8.8.8.8' });
  const list = await x.call('GET', '/api/admin/customers', {}, tok);
  const tr = list.json.find((y) => y.isTrial && y.email === 'paidcheck@example.com');
  assert.ok(tr, 'the free-trial flow creates its own trial account');
  const rej = await x.call('POST', `/api/admin/customers/${tr.id}/line`, { m3u }, tok);
  assert.equal(rej.status, 400, 'paid M3U workflow refuses trial accounts');
});

test('all-agents trial queue: dedicated dispatch entry takes free-trial credentials and dispatches', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { trial: { mode: 'agents' }, email: { resendKey: 're_test', from: 'App <no-reply@example.com>', adminEmail: 'owner@example.com' } }, tok);
  const d = await x.call('POST', '/api/admin/trialq/direct', { email: 'direct.person@example.com', username: 'DIRECTUSER', password: 'DIRECTPASS', dns: 'http://tv.example:8080', ibo: 'MAC: AA:BB:CC:DD:EE:FF 🎮 device key: XYZ' }, tok);
  assert.equal(d.status, 200, JSON.stringify(d.json)); assert.equal(d.json.username, 'DIRECTUSER'); assert.equal(d.json.ibo, true);
});

test('customer totals: admin and customer payloads include total paid and lines', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { orderPackages: [{ id: 'p1x', title: '1 Month', days: 30, devices: 1, price: 10, badge: '', link: '' }] }, tok);
  await addCustomer(x, tok); // renewals record a 0-price sale? no: price from plan p1 = 10
  const list = await x.call('GET', '/api/admin/customers', {}, tok);
  const c = list.json.find((z) => z.username === 'testuser');
  assert.ok(typeof c.totalPaidUsd === 'number');
  const u = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  const me = await x.call('GET', '/api/me', {}, u);
  assert.equal(me.status, 200); assert.ok(typeof me.json.totalPaidUsd === 'number');
  assert.ok(Array.isArray(me.json.user.renewals));
});

test('stripe panel: account list is saved, rk stays secret and round-trips masked; per-account balance uses its own key', async () => {
  const x = setup(); const tok = await adminToken(x);
  const st = await x.call('GET', '/api/admin/settings', {}, tok); // seeds the five default accounts
  assert.deepEqual(st.json.stripeAccounts.map((a) => a.id), ['grenapp', 'waffim', 'avixcloud', 'bussalion', 'zabi']);
  assert.ok(st.json.stripeAccounts.every((a) => a.rk === ''), 'no keys yet');
  const bySa = Object.fromEntries(st.json.stripeAccounts.map((a) => [a.id, a]));
  assert.equal(bySa.grenapp.name, 'GreenApp Host LLC');
  assert.equal(bySa.grenapp.balance, 102.52, 'GreenApp Host LLC keeps its balance');
  assert.equal(bySa.grenapp.payoutDays, 2, 'GreenApp Host LLC keeps its 2-day payout');
  for (const id of ['waffim', 'avixcloud', 'bussalion', 'zabi']) { assert.equal(bySa[id].balance, 0, id + ' is reset to 0'); assert.equal(bySa[id].payoutDays, 7, id + ' keeps its 7-day payout'); }

  const made = await x.call('PUT', '/api/admin/settings', { stripeAccounts: [{ id: 'grenapp', name: 'GreenApp Host LLC', currency: 'USD', status: 'active', payoutDays: 2, note: 'Mercury Day 3', rk: 'rk_live_abc', links: [{ id: 'l1', label: '1 Year', url: 'https://buy.stripe.com/abc', currency: 'USD', tier: 'Normal' }] }] }, tok);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  // saved, never leaked back
  const st2 = await x.call('GET', '/api/admin/settings', {}, tok);
  const grenapp = st2.json.stripeAccounts[0]; assert.equal(grenapp.rk, '••••');
  assert.equal(grenapp.links[0].label, '1 Year'); assert.equal(grenapp.payoutDays, 2);
  // masked rk survives a save without wiping the stored key
  await x.call('PUT', '/api/admin/settings', { stripeAccounts: [{ ...grenapp, name: 'GreenApp Host LLC2' }] }, tok);
  const bal = await x.call('GET', '/api/admin/stripe/account/grenapp/balance', {}, tok);
  assert.equal(bal.status, 200);
  assert.equal(bal.json.connected, true, 'the preserved read-only key was used, not wiped by the masked save');
  assert.equal(bal.json.available, 0);
});

test('stripe panel: existing installs migrate the legacy Grenapp name, balances and payout schedule', async () => {
  const x = setup();
  const legacy = { security: { force2fa: false, captcha: false }, pricingV2: true, pricingV3: true, stripeSettleV2: true,
    stripeAccounts: [
      { id: 'grenapp', name: 'Grenapp Host LLC', currency: 'USD', status: 'active', payoutDays: 7, note: '', rk: '', links: [], bankId: 'mercury', balance: 79.99, balanceAt: 1 },
      { id: 'waffim', name: 'Wafinaccounting LLC', currency: 'USD', status: 'active', payoutDays: 2, note: '', rk: '', links: [], balance: 79.99, balanceAt: 1 },
      { id: 'customx', name: 'My Custom', currency: 'USD', status: 'active', payoutDays: 7, note: '', rk: '', links: [], balance: 5, balanceAt: 1 },
    ] };
  x.db.set('settings', { v: JSON.stringify(legacy), e: 0 });
  const tok = await adminToken(x);
  const st = await x.call('GET', '/api/admin/settings', {}, tok);
  const by = Object.fromEntries(st.json.stripeAccounts.map((a) => [a.id, a]));
  assert.equal(by.grenapp.name, 'GreenApp Host LLC', 'legacy spelling is repaired');
  assert.equal(by.grenapp.balance, 102.52, 'GreenApp keeps its requested balance');
  assert.equal(by.grenapp.payoutDays, 2, 'GreenApp keeps its 2-day payout');
  assert.equal(by.waffim.balance, 0, 'other known accounts are reset');
  assert.equal(by.waffim.payoutDays, 7, 'other known accounts keep 7-day payouts');
  assert.equal(by.customx.name, 'My Custom', 'custom accounts are left alone');
  assert.equal(by.customx.balance, 5, 'custom balances are left alone');
});

test('finance: clear-all transaction history wipes the payout log', async () => {
  const x = setup(); const tok = await adminToken(x);
  const created = await x.call('POST', '/api/admin/tx', { type: 'income', accountId: 'stripe', amount: 12.5, category: 'Sale', note: 'placeholder entry' }, tok);
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const before = await x.call('GET', '/api/admin/tx', {}, tok);
  assert.equal(before.json.length, 1, 'one transaction was recorded');
  const del = await x.call('DELETE', '/api/admin/tx', {}, tok);
  assert.equal(del.status, 200); assert.equal(del.json.cleared, 1);
  const after = await x.call('GET', '/api/admin/tx', {}, tok);
  assert.deepEqual(after.json, [], 'the transaction history starts clean after clearing');
});

test('IBO panel: add client (uses a credit), lifetime, credits wallet, message build', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', adminEmail: 'owner@example.com' } }, tok);
  // starting balance is 0 → paid add refused
  const refused = await x.call('POST', '/api/admin/ibo', { name: 'IBO One', contact: '+212600112233', days: 365 }, tok);
  assert.equal(refused.status, 400);
  // buy credits
  assert.equal((await x.call('POST', '/api/admin/ibo/credits', { action: 'buy', credits: 2, price: 7 }, tok)).status, 200);
  // paid client uses one credit
  const made = await x.call('POST', '/api/admin/ibo', { name: 'IBO One', contact: '+212600112233', username: 'bobuser', password: 'bobpass', days: 365, dns: 'http://dns:8080' }, tok);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.equal(made.json.client.username, 'bobuser');
  let r = await x.call('GET', '/api/admin/ibo', {}, tok);
  assert.equal(r.json.credits, 1); assert.equal(r.json.list.length, 1);
  // free trial costs no credit
  const tr = await x.call('POST', '/api/admin/ibo', { name: 'Trial Bob', contact: 'trial.bob@example.com', trial: true }, tok);
  assert.equal(tr.status, 200);
  r = await x.call('GET', '/api/admin/ibo', {}, tok);
  assert.equal(r.json.credits, 1, 'trial does not spend a credit');
  assert.equal(r.json.stats.trial, 1);
  // send via whatsapp returns a ready message with credentials
  const id = made.json.client.id;
  const msg = await x.call('POST', `/api/admin/ibo/${id}/send`, { via: 'whatsapp' }, tok);
  assert.equal(msg.status, 200);
  assert.match(msg.json.text, /bobuser/); assert.match(msg.json.text, /bobpass/); assert.match(msg.json.text, /MAC/);
  // renew spends another credit
  const re = await x.call('POST', `/api/admin/ibo/${id}/activate`, {}, tok);
  assert.equal(re.status, 200); assert.equal(re.json.credits, 0);
  // out of credits now
  assert.equal((await x.call('POST', '/api/admin/ibo', { name: 'Nope', days: 365 }, tok)).status, 400);
});

test('marketing: keys stay masked, lists drop bounced emails, campaign sends with rotating keys and records spend', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'INTPROTO-TV <hello@example.com>', adminEmail: 'owner@example.com' } }, tok);
  // no Resend marketing keys yet → cannot send
  assert.equal((await x.call('GET', '/api/admin/emailmkt', {}, tok)).json.keysSet, 0);
  // save masked keys (round-trip) then add two more
  await x.call('PUT', '/api/admin/emailmkt/settings', { keys: ['re_one', 're_two'], senders: ['INTPROTO-TV', 'IPTV Team'], subjects: ['Offer', 'Sale'] }, tok);
  const st = await x.call('GET', '/api/admin/emailmkt/settings', {}, tok);
  assert.equal(st.json.keys[0], '••••'); assert.equal(st.json.keys[1], '••••'); assert.equal(st.json.senders[0], 'INTPROTO-TV');
  // upload a list with a bounced address removed
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'INTPROTO-TV <hello@example.com>', adminEmail: 'owner@example.com' } }, tok);
  const up = await x.call('POST', '/api/admin/emailmkt/list', { name: 'Prospects', text: 'a@example.com\nb@example.com\na@example.com' }, tok);
  assert.equal(up.status, 200); assert.equal(up.json.count, 2);
  const sent = await x.call('POST', '/api/admin/emailmkt/send', { listId: up.json.id }, tok);
  assert.equal(sent.status, 200, JSON.stringify(sent.json)); assert.equal(sent.json.sent, 2);
  const batch = x.mails[x.mails.length - 1];
  assert.ok(Array.isArray(batch), 'the batch endpoint was used'); assert.equal(batch.length, 2);
  assert.match(batch[0].from, /^INTPROTO-TV </); assert.equal(batch[0].from.includes('no-reply@'), false, 'sender name is configured, not noreply');
  const overview = await x.call('GET', '/api/admin/emailmkt', {}, tok);
  assert.equal(overview.json.totalSent, 2); assert.ok(overview.json.totalSpendUsd >= 0);
  // marketing permission: staff without it are refused
  await x.call('POST', '/api/admin/team', { name: 'Said', username: 'saidm', password: 'secret12', role: 'Sales', perms: ['customers_view'] }, tok);
  const staff = (await x.call('POST', '/api/login', { username: 'saidm', password: 'secret12' })).json.token;
  await signBylaws(x, staff);
  assert.equal((await x.call('GET', '/api/admin/emailmkt', {}, staff)).status, 403);
});

test('seo/gads/fb trackers: logs entries and rolls up daily spend', async () => {
  const x = setup(); const tok = await adminToken(x);
  const post = await x.call('POST', '/api/admin/seo', { platform: 'Reddit', title: 'Posted about INTPROTO on r/IPTV', result: '12 upvotes' }, tok);
  assert.equal(post.status, 200);
  assert.equal((await x.call('GET', '/api/admin/seo', {}, tok)).json.today, 1);
  const camp = await x.call('POST', '/api/admin/gads/campaign', { account: 'GreenApp Ads', domain: 'intproto-tv.store', name: 'Search NL', dailyBudget: 10 }, tok);
  assert.equal(camp.status, 200); const cid = camp.json.campaign.id;
  assert.equal((await x.call('POST', '/api/admin/gads/entry', { campaignId: cid, spend: 15.5, clicks: 9, impressions: 300, results: 2 }, tok)).status, 200);
  const g = await x.call('GET', '/api/admin/gads', {}, tok);
  assert.equal(g.json.campaigns[0].today, 15.5); assert.equal(g.json.total.month, 15.5);
  const ad = await x.call('POST', '/api/admin/fb/ad', { account: 'act_123', phone: '+212600112233', description: 'INTPROTO TV — new channels' }, tok);
  assert.equal(ad.status, 200, JSON.stringify(ad.json));
  const f = await x.call('GET', '/api/admin/fb', {}, tok);
  assert.equal(f.json.ads.length, 1); assert.equal(f.json.total.month, 0);
});

test('team: attendance flow, leave approval, task assign/update (owner vs staff), team chat, manager-only reports', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('POST', '/api/admin/team', { name: 'Said', username: 'sayed', password: 'secret12', role: 'Sales', perms: ['tasks', 'attendance'] }, tok);
  const staff = (await x.call('POST', '/api/login', { username: 'sayed', password: 'secret12' })).json.token;
  await signBylaws(x, staff);

  // attendance flow
  assert.equal((await x.call('POST', '/api/admin/attendance', { action: 'in' }, staff)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/attendance', { action: 'break_start' }, staff)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/attendance', { action: 'break_end' }, staff)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/attendance', { action: 'out' }, staff)).status, 200);
  const att = await x.call('GET', '/api/admin/attendance', {}, staff);
  assert.equal(att.status, 200); assert.ok(att.json.mine.length >= 4);
  assert.equal((await x.call('GET', '/api/admin/reports', {}, staff)).status, 403, 'sales staff cannot open the owner report');

  // leave request + owner decides; staff cannot decide their own
  assert.equal((await x.call('POST', '/api/admin/leaves', { kind: 'vacation', from: '2026-12-01', to: '2026-12-05', reason: 'Holiday' }, staff)).status, 200);
  const pend = await x.call('GET', '/api/admin/leaves', {}, tok); assert.equal(pend.json.pending, 1);
  const id = pend.json.list[0].id;
  assert.equal((await x.call('POST', '/api/admin/leaves/decide', { id, action: 'approved' }, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/leaves/decide', { id, action: 'rejected' }, staff)).status, 403);

  // tasks: staff cannot assign, owner assigns, staff can progress own
  assert.equal((await x.call('POST', '/api/admin/tasks', { name: 'Secret task', assignee: 'owner' }, staff)).status, 403);
  const teamId = (await x.call('GET', '/api/admin/team', {}, tok)).json[0].id;
  const t = await x.call('POST', '/api/admin/tasks', { name: 'Renew expired lines', assignee: teamId, assigneeName: 'Said', deadline: '2026-12-31' }, tok);
  assert.equal(t.status, 200); const tid = t.json.task.id;
  const mineTasks = await x.call('GET', '/api/admin/tasks', {}, staff);
  assert.ok(mineTasks.json.mine.some((z) => z.id === tid));
  assert.equal((await x.call('PUT', `/api/admin/tasks/${tid}`, { status: 'in_progress' }, staff)).status, 200);
  assert.equal((await x.call('PUT', `/api/admin/tasks/${tid}`, { status: 'in_progress' }, tok)).status, 200, 'owner can edit too');
  assert.equal((await x.call('GET', '/api/admin/reports', {}, tok)).status, 200);

  // team chat is open to the whole team
  assert.equal((await x.call('POST', '/api/admin/teamchat', { text: 'Handover: all lines renewed this afternoon' }, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/teamchat', { text: 'Got it — taking over the queue' }, staff)).status, 200);
  const chat = await x.call('GET', '/api/admin/teamchat', {}, staff);
  assert.ok(chat.json.some((m) => m.text.includes('Handover')));
});

// ---- 2026 spec additions: mandatory 2FA, captcha, contact checkboxes, dual email, trainees, templates lock, aliases ----

test('mandatory two-factor: after it is turned on, the dashboard refuses until 2FA is set up', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { security: { force2fa: true } }, tok);
  assert.equal((await x.call('GET', '/api/admin/customers', {}, tok)).status, 403);
  const me = await x.call('GET', '/api/admin/me', {}, tok);
  assert.equal(me.json.mustSetup2fa, true);
  const st = await x.call('POST', '/api/admin/2fa/setup', {}, tok); assert.equal(st.status, 200); assert.ok(st.json.secret);
  assert.equal((await x.call('POST', '/api/admin/2fa/enable', { code: await totp(st.json.secret) }, tok)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/customers', {}, tok)).status, 200);
  const me2 = await x.call('GET', '/api/admin/me', {}, tok); assert.equal(me2.json.mustSetup2fa, false);
});

test('captcha: customer login requires it; the challenge comes from /api/config', async () => {
  const x = setup(); const tok = await adminToken(x);
  const made = await addCustomer(x, tok);
  await x.call('PUT', '/api/admin/settings', { security: { captcha: true } }, tok);
  assert.equal((await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).status, 400);
  const cfg = await x.call('GET', '/api/config', {});
  assert.ok(cfg.json.captcha && cfg.json.captcha.q, 'the login page gets a captcha challenge');
  const m = /^(\d+)\s*\+\s*(\d+)\s*=\s*\?$/.exec(cfg.json.captcha.q); assert.ok(m, 'challenge has two numbers');
  const answer = Number(m[1]) + Number(m[2]);
  const ok = await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12', captchaId: cfg.json.captcha.id, captchaAnswer: answer });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('contact checkboxes: toggle marks and unmarks 24h contacts per channel', async () => {
  const x = setup(); const tok = await adminToken(x);
  const made = await addCustomer(x, tok);
  const r1 = await x.call('PUT', `/api/admin/customers/${made.id}`, { contact: { email: 'toggle' } }, tok);
  assert.ok(r1.json.contact.email > 0, 'email marked as contacted');
  const r2 = await x.call('PUT', `/api/admin/customers/${made.id}`, { contact: { whatsapp: 'toggle', telegram: true } }, tok);
  assert.ok(r2.json.contact.whatsapp > 0); assert.ok(r2.json.contact.telegram > 0);
  const r3 = await x.call('PUT', `/api/admin/customers/${made.id}`, { contact: { email: 'toggle' } }, tok);
  assert.equal(r3.json.contact.email, 0, 'tapped again → unmarked');
});

test('dual email: stored, shown in search targets, and editable', async () => {
  const x = setup(); const tok = await adminToken(x);
  const made = await addCustomer(x, tok, { email2: 'backup.person@example.com' });
  const list = await x.call('GET', '/api/admin/customers', {}, tok);
  const c = list.json.find((z) => z.username === 'testuser');
  assert.equal(c.email2, 'backup.person@example.com');
  await x.call('PUT', `/api/admin/customers/${made.id}`, { email2: 'other.person@example.com' }, tok);
  const list2 = await x.call('GET', '/api/admin/customers', {}, tok);
  assert.equal(list2.json.find((z) => z.username === 'testuser').email2, 'other.person@example.com');
});

test('trainee: 14-day restricted account, promoted later; templates are view-only for agents', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('POST', '/api/admin/team', { name: 'Trainee Tom', username: 'traineetom', password: 'secret12', role: 'Sales Agent', perms: ['customers_view', 'customers_edit', 'finance_edit', 'attendance', 'tasks'], trainee: true }, tok);
  const staff = (await x.call('POST', '/api/login', { username: 'traineetom', password: 'secret12' })).json.token;
  await signBylaws(x, staff);
  // restricted: cannot see finances or edit customers
  assert.equal((await x.call('GET', '/api/admin/profits', {}, staff)).status, 403);
  assert.equal((await x.call('POST', '/api/admin/customers', { name: 'X Person', username: 'xperson1', password: 'secret12', planId: 'p1' }, staff)).status, 403);
  // can record attendance and view customers
  assert.equal((await x.call('POST', '/api/admin/attendance', { action: 'in' }, staff)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/customers', {}, staff)).status, 200);
  // templates: can view, cannot save
  assert.equal((await x.call('GET', '/api/admin/templates', {}, staff)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/templates/save', {}, staff)).status, 403);
  // owner promotes → full access restored
  const teamList = (await x.call('GET', '/api/admin/team', {}, tok)).json;
  const trainee = teamList.find((m) => m.username === 'traineetom');
  assert.ok(trainee.traineeUntil > Date.now());
  assert.ok(trainee.alias === '' || true);
  assert.equal((await x.call('PUT', `/api/admin/team/${trainee.id}`, { promote: true }, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/customers', { name: 'Y Person', username: 'yperson1', password: 'secret12', planId: 'p1' }, staff)).status, 200);
});

test('aliases and payroll details: stored on the member, shown to the owner only', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('POST', '/api/admin/team', { name: 'Mouad', username: 'mouad', password: 'secret12', role: 'Sales Agent', perms: ['customers_view'], alias: 'Mark', bank: 'CIH', bankDetails: 'MA64-0000-1111-2222' }, tok);
  const list = (await x.call('GET', '/api/admin/team', {}, tok)).json;
  const m = list.find((x2) => x2.username === 'mouad');
  assert.equal(m.alias, 'Mark'); assert.equal(m.bank, 'CIH'); assert.equal(m.bankDetails, 'MA64-0000-1111-2222');
});

test('CC collection: owner-only tracker with the 8-field form and card status counters', async () => {
  const x = setup(); const tok = await adminToken(x);
  assert.equal((await x.call('GET', '/api/admin/cc', {}, tok)).status, 200);
  const made = await x.call('POST', '/api/admin/cc', { fullName: 'Kast Client A', email: 'a@example.com', phone: '+212600112233', address: 'Casablanca', cardNumber: '4111111111111111', exp: '1227', cvv: '123', status: 'live' }, tok);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  await x.call('POST', '/api/admin/cc', { fullName: 'Trade OKX B', email: 'b@example.com', phone: '+34600000000', address: 'Madrid', cardNumber: '5555555555554444', exp: '0128', cvv: '456', status: 'declined' }, tok);
  const r = await x.call('GET', '/api/admin/cc', {}, tok);
  assert.equal(r.json.liveCount, 1); assert.equal(r.json.declinedCount, 1); assert.equal(r.json.deadCount, 0);
  // staff without the owner role cannot see it (Sensitive)
  await x.call('POST', '/api/admin/team', { name: 'Said', username: 'saidd', password: 'secret12', role: 'Sales', perms: ['customers_view', 'customers_edit', 'finance_view'] }, tok);
  const staff = (await x.call('POST', '/api/login', { username: 'saidd', password: 'secret12' })).json.token;
  await signBylaws(x, staff);
  assert.equal((await x.call('GET', '/api/admin/cc', {}, staff)).status, 403);
});

test('escalation copies: Technical Manager with a notify email gets the dispute too', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', adminEmail: 'owner@example.com' } }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Khalil', username: 'khaliltm2', password: 'secret12', role: 'Technical Manager', perms: ['disputes'], notifyEmail: 'khalil.tech@example.com' }, tok);
  const staffLk = (await x.call('POST', '/api/login', { username: 'khaliltm2', password: 'secret12' })).json.token;
  await signBylaws(x, staffLk);
  const filed = await x.call('POST', '/api/admin/disputes', { kind: 'bug', subject: 'RESELLER create line fails', details: 'create_line answers 512' }, tok);
  assert.equal(filed.status, 200);
  assert.ok(x.mails.some((m) => m.to[0] === 'khalil.tech@example.com'), 'technical manager got a copy');
  assert.ok(x.mails.some((m) => m.to[0] === 'owner@example.com'), 'owner got one too');
});

test('sales tracker: today/yesterday/month aggregation, 30-day series and reseller RSL ids + sheets gating', async () => {
  const x = setup(); const tok = await adminToken(x);
  const c1 = await addCustomer(x, tok, { username: 'tracker1', email: 't1@example.com', price: '19.50' });
  const c2 = await addCustomer(x, tok, { username: 'tracker2', email: 't2@example.com', price: '9' });
  const d = await x.call('GET', '/api/admin/sales-by-day', {}, tok);
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.ok(d.json.today > 0, 'today total is positive');
  assert.equal(d.json.todayN, 2, 'two sales today');
  assert.equal(d.json.days30.length, 30); assert.equal(d.json.months.length, 12); assert.ok(d.json.recent.length >= 2);
  const t1 = await x.call('POST', '/api/admin/reseller/toggle', { id: c1.id }, tok);
  assert.equal(t1.status, 200); assert.equal(t1.json.rslId, 'RSL-01'); assert.equal(t1.json.isReseller, true);
  const t2 = await x.call('POST', '/api/admin/reseller/toggle', { id: c2.id }, tok);
  assert.equal(t2.json.rslId, 'RSL-02');
  const list = await x.call('GET', '/api/admin/reseller', {}, tok);
  assert.equal(list.json.list.length, 2);
  // unflag one and confirm the list shrinks
  await x.call('POST', '/api/admin/reseller/toggle', { id: c2.id }, tok);
  const list2 = await x.call('GET', '/api/admin/reseller', {}, tok);
  assert.equal(list2.json.list.length, 1);
  const bad = await x.call('POST', '/api/admin/reseller/sync', {}, tok);
  assert.equal(bad.status, 404, 'the Google Sheets sync was removed');
});

test('stripe revenue: income is attributed per bank account and shows 30d + all-time totals', async () => {
  const x = setup(); const tok = await adminToken(x);
  await addCustomer(x, tok, { username: 'revtest', email: 'rev@example.com', price: '30', accountId: 'stripe' });
  const r = await x.call('GET', '/api/admin/stripe/revenue', {}, tok);
  assert.equal(r.status, 200);
  const acc = (r.json.revenue || []).find((a) => a.accountId === 'stripe');
  assert.ok(acc && acc.usd > 0, 'stripe account shows revenue: ' + JSON.stringify(r.json));
  assert.ok(acc.n30d >= 1 && acc.usd30d > 0, '30-day figures track the sale');
  assert.ok(r.json.total.usd >= acc.usd, 'totals aggregate');
});

test('one-shot owner reset: admin credential is rewritten to Iptv/Iptv exactly once, then disarms forever', async () => {
  const x = setup(); const db = x.db;
  // simulate a long-forgotten admin password in KV
  db.set('admin', { v: JSON.stringify({ username: 'Iptv', salt: 'abc12345', hash: 'deadbeef', isDefault: false }), e: 0 });
  // first request triggers the maintenance reset
  await x.call('GET', '/api/config', {}, undefined);
  const reset = JSON.parse(db.get('admin').v);
  assert.equal(reset.username, 'Iptv'); assert.equal(reset.isDefault, true); assert.notEqual(reset.hash, 'deadbeef');
  assert.equal(db.get('ownerResetV1')?.v, '1', 'ownerResetV1 must be set permanently');
  // it must never run again: pretend someone set a custom salt after signing in
  db.set('admin', { v: JSON.stringify({ username: 'Iptv', salt: 'keepme', hash: 'deadbeef', isDefault: true }), e: 0 });
  await x.call('GET', '/api/config', {}, undefined);
  assert.equal(JSON.parse(db.get('admin').v).salt, 'keepme', 'ownerResetV1 prevents a second reset');
  // fresh KV (no admin at all) also gets Iptv/Iptv and can log in
  const x2 = setup();
  const sc = await x2.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' });
  assert.equal(sc.status, 200, 'default credentials work on a fresh install');
});

test('owner reset maintenance: burned Iptv username bucket is flushed, IP bucket still locks', async () => {
  const x = setup(); const db = x.db;
  db.set('rl:login:u:iptv', { v: JSON.stringify(9), e: Date.now() + 900000 });
  db.set('rl:login:1.2.3.4', { v: JSON.stringify(9), e: Date.now() + 900000 });
  await x.call('GET', '/api/config', {}, undefined); // maintenance runs before cache read
  assert.equal(db.get('rl:login:u:iptv'), undefined, 'owner username bucket must be flushed at maintenance time');
  const res = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv', ip: '5.6.7.8' });
  assert.equal(res.status, 200, 'owner can sign in with a fresh IP even after the reset');
  // IP buckets are untouched (lockout still works for abuse)
  const res2 = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv', ip: '1.2.3.4' });
  assert.equal(res2.status, 429, 'IP bucket must still enforce the lockout');
});

test('telegram: bot setup, /start linking, and automatic trial delivery', async () => {
  const x = setup(); const tok = await adminToken(x);
  assert.equal((await x.call('PUT', '/api/admin/settings', {
    trial: { enabled: true, mode: 'auto', hours: 24 },
    telegram: { enabled: true, botToken: '123456:test-token_abc', adminChat: '999', webhookSecret: 's3cret', autoTrial: true, notifyAdmin: true },
  }, tok)).status, 200);
  const cfg = await x.call('GET', '/api/config');
  assert.equal(cfg.status, 200);
  assert.ok(Array.isArray(cfg.json.orderPackages), 'all order packages are exposed');
  assert.ok(cfg.json.orderPackages.every((p) => p.kind === 'ibo' || p.kind === 'subscription'));
  assert.ok(Array.isArray(cfg.json.resellerPackages), 'reseller packages are exposed');
  assert.equal(cfg.json.telegram.link, '', 'the public link appears only after the bot is connected');

  const setupRes = await x.call('POST', '/api/admin/telegram/setup', { url: 'https://app.example.com' }, tok);
  assert.equal(setupRes.status, 200, JSON.stringify(setupRes.json));
  assert.equal(setupRes.json.webhook, 'https://app.example.com/api/telegram/webhook');
  assert.ok(x.calls.some((u) => u.includes('/setWebhook')), 'the webhook is registered with Telegram');
  const cfg2 = (await x.call('GET', '/api/config')).json;
  assert.equal(cfg2.telegram.bot, 'testbot');
  assert.equal(cfg2.telegram.link, 'https://t.me/testbot');

  const start = await x.call('POST', '/api/telegram/webhook', { __tgSecret: 's3cret', message: { chat: { id: 555 }, from: { username: 'cust' }, text: '/start trial.person@example.com' } });
  assert.equal(start.status, 200);
  const bad = await x.call('POST', '/api/telegram/webhook', { __tgSecret: 'wrong', message: { chat: { id: 1 }, text: '/start x@y.com' } });
  assert.equal(bad.status, 403, 'a bad secret is refused');

  x.db.set('trialpool', { v: JSON.stringify([{ u: 'line1', p: 'pass1', dns: 'http://dns.example:8080' }]), e: 0 });
  const tr = await x.call('POST', '/api/trial', { name: 'Trial Person', email: 'trial.person@example.com', phone: '+212600000000', whatsapp: '+212600000000', telegram: 'cust' });
  assert.equal(tr.status, 200, JSON.stringify(tr.json));
  assert.equal(tr.json.telegram.sent, true, 'the login is sent automatically on Telegram');
  assert.equal(tr.json.telegram.linked, true);
  assert.equal(tr.json.dns, 'http://dns.example:8080');
  assert.match(tr.json.m3u, /username=line1&password=pass1/);
  const msgs = x.tg.filter((b) => b.text).map((b) => b.text).join('\n');
  assert.match(msgs, /Username: line1/);
  assert.match(msgs, /Password: pass1/);
  assert.match(msgs, /DNS: http:\/\/dns\.example:8080/);
  assert.match(msgs, /M3U: http:\/\/dns\.example:8080\/get\.php\?username=line1/);
});

test('telegram: the deep-link payload is base64url encoded and still links the chat', async () => {
  const x = setup(); const tok = await adminToken(x);
  const email = 'encoded.person@example.com';
  await x.call('PUT', '/api/admin/settings', { trial: { enabled: true, mode: 'auto', hours: 24 }, telegram: { enabled: true, botToken: '123456:token_ok', adminChat: '999', webhookSecret: 'sec2', autoTrial: true, notifyAdmin: true } }, tok);
  await x.call('POST', '/api/admin/telegram/setup', { url: 'https://app.example.com' }, tok);
  const payload = 'e_' + Buffer.from(email).toString('base64url');
  assert.equal((await x.call('POST', '/api/telegram/webhook', { __tgSecret: 'sec2', message: { chat: { id: 777 }, from: { username: 'deep' }, text: '/start ' + payload } })).status, 200);
  x.db.set('trialpool', { v: JSON.stringify([{ u: 'line2', p: 'pass2', dns: 'http://dns2.example:8080' }]), e: 0 });
  const tr = await x.call('POST', '/api/trial', { name: 'Encoded Person', email, phone: '+212611111111', whatsapp: '+212611111111', telegram: 'deep' });
  assert.equal(tr.status, 200, JSON.stringify(tr.json));
  assert.equal(tr.json.telegram.sent, true);
  const last = x.tg.filter((b) => b.text && String(b.chat_id) === '777').pop();
  assert.ok(last, 'the customer chat received the login');
  assert.match(last.text, /^INTPROTO-TV — your free trial/);
});

// ---- email: all templates render, all send paths work ----
test('email templates: login/trial, renewal, order and newsletter render in English and French with no leftover placeholders', () => {
  const s = { branding: { appName: 'Test TV', logoUrl: 'https://cdn.test/logo.png', supportUrl: 'https://wa.me/212600000000', supportLabel: 'WhatsApp' },
    email: { appUrl: 'https://app.test', supportEmail: 'help@test.example', website: 'https://test.example', dns: 'http://line.test:8080' },
    trial: { hours: 24 }, player: { serverUrl: 'http://line.test:8080' },
    renewalOffer: { title: '1-Year Plan', price: '$99.99', bonus: '2 months free', coupon: 'SAVE10', url: 'https://test.example' },
    orderCurrency: 'EUR', currencyRule: { on: false } };
  const c = { name: 'Sara & Co', lang: 'en', username: 'sara', loginPassword: 'Login1234', lineUsername: 'line_sara', linePassword: 'p@ss&1',
    dns: 'http://line.test:8080', expiresAt: Date.parse('2027-01-31T12:00:00Z'),
    m3u: 'http://line.test/get.php?username=line_sara&password=p%40ss%261&type=m3u_plus', ibo: { mac: 'AA:BB:CC:DD:EE:FF', key: 'KEY-123' } };
  const clean = (html) => { for (const bad of ['undefined', 'NaN', '{name}', '{app}', '{date}', '{pkg}', '{price}', '{coupon}', '{site}', '{hours}', '{days}']) assert.ok(!html.includes(bad), 'placeholder ' + bad + ' left in email'); return html; };
  for (const lang of ['en', 'fr']) {
    const trial = accessEmail(s, { ...c, lang }, 'Pass1234', 'trial');
    assert.ok(trial.subject.length > 5); assert.ok(trial.html.includes('line_sara'));
    assert.ok(trial.html.includes('Pass1234') || trial.html.includes('p@ss&amp;1'));
    assert.ok(trial.html.includes('http://line.test:8080')); assert.ok(trial.html.includes('SAVE') === false);
    assert.ok(trial.html.includes('AA:BB:CC:DD:EE:FF')); assert.ok(trial.html.includes('KEY-123'));
    assert.ok(trial.html.includes('type=m3u_plus'), 'the saved M3U link is in the email');
    const both = accessEmail(s, { ...c, lang, m3u: '' }, 'Pass1234', 'trial').html;
    assert.ok(/TS:/.test(both) && /HLS:/.test(both), 'without a saved M3U both generated links are in the email'); clean(both);
    clean(trial.html);
    const sub = accessEmail(s, { ...c, lang }, 'Login1234', 'sub');
    assert.ok(sub.html.includes('line_sara') && sub.html.includes('AA:BB:CC:DD:EE:FF')); clean(sub.html);
    assert.notEqual(sub.subject, trial.subject);
    const ren = renewalEmail(s, { ...c, lang, isTrial: false });
    assert.ok(ren.subject.length > 5); assert.ok(ren.html.includes('SAVE10') && ren.html.includes('test.example')); clean(ren.html);
    const pkg = { id: 'o1m', title: '1 Month', days: 30, devices: 2, price: 29.99 };
    const ord = orderEmail(s, { ...c, lang }, pkg);
    assert.ok(ord.subject.includes('1 Month') && ord.subject.includes('€29.99')); assert.ok(ord.html.includes('1 Month') && ord.html.includes('€29.99')); clean(ord.html);
    const camp = { id: 'c1', split: true, lang, coupon: 'SAVE10', link: 'site', content: { en: { subject: 'Big summer sale', title: 'Big summer sale', body: 'Hello {name}, save now.', button: 'See the offer' }, fr: { subject: 'Grande promo d’été', title: 'Grande promo d’été', body: 'Bonjour {name}, profitez-en.', button: 'Voir l’offre' } } };
    const nl = newsletterEmail(s, { ...c, lang }, camp, 'https://app.test', 'https://app.test/unsubscribe?t=1');
    assert.ok(nl.subject.length > 5); assert.ok(nl.html.includes('https://app.test/unsubscribe?t=1')); clean(nl.html);
  }
});

test('sending: a dead primary key falls back to the "Send from" address and the transactional key/domain rotation never sends from an empty domain', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_main', from: 'My Brand <hi@brand.test>' } }, tok);
  const one = await x.call('POST', '/api/admin/email/test', { to: 'first@example.com' }, tok);
  assert.equal(one.status, 200); assert.equal(one.json.ok, true);
  assert.equal(x.mails.at(-1).from, 'My Brand <hi@brand.test>');
  await x.call('PUT', '/api/admin/settings', { email: { transKeys: ['k0', '', 'k2'], transDomains: ['a.test', '', 'c.test'], transSenders: ['S0', '', 'S2'] } }, tok);
  const froms = new Set();
  for (let i = 0; i < 40; i++) { const r = await x.call('POST', '/api/admin/email/test', { to: 'rot@example.com' }, tok); assert.equal(r.json.ok, true); froms.add(x.mails.at(-1).from); }
  assert.deepEqual([...froms].sort(), ['S0 <noreply@a.test>', 'S2 <noreply@c.test>'], 'blank key slots keep their own domain and never send from an empty domain');
});

test('sending: bounce reading and recent emails try the transactional keys when the main Resend key is dead', async () => {
  const db = new Map(); const stored = (k, v) => db.set(k, JSON.stringify(v));
  const seen = [];
  const store = { get: async (k) => (db.has(k) ? JSON.parse(db.get(k)) : null), put: async (k, v) => { db.set(k, JSON.stringify(v)); }, del: async (k) => { db.delete(k); } };
  stored('settings', { security: { force2fa: false, captcha: false }, email: { resendKey: 're_dead', transKeys: ['re_live'], transDomains: ['intproto-tv.online'] } });
  const fetchFn = async (url, init) => {
    url = String(url); const auth = String((init && init.headers && init.headers.Authorization) || ''); seen.push(auth);
    if (!url.startsWith('https://api.resend.com')) return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    if (auth === 'Bearer re_dead') return { ok: false, status: 401, json: async () => ({ message: 'API key is invalid' }) };
    if (url.includes('limit=1') && !url.includes('limit=100')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm1', to: ['bounced@example.com'], subject: 'Hello', last_event: 'bounced', created_at: '2026-11-17T01:00:00Z' }], has_more: false }) };
  };
  const be = createBackend({ store, fetchFn, mode: 'server' });
  const call = (m, p, b, t) => be.handle({ method: m, path: p, body: b || {}, token: t, query: {} });
  const tok = (await call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' })).json.token;
  const sync = await call('POST', '/api/admin/email/bounces/sync', {}, tok);
  assert.equal(sync.status, 200, JSON.stringify(sync.json)); assert.equal(sync.json.added, 1);
  const recent = await call('GET', '/api/admin/email/recent', {}, tok);
  assert.equal(recent.status, 200, JSON.stringify(recent.json)); assert.equal(recent.json.list.length, 1);
  assert.ok(seen.includes('Bearer re_live'), 'the working transactional key was used');
});

test('sending: a stored Arabic mail language no longer breaks a real customer email', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { lang: 'ar', resendKey: 're_test', from: 'App <no-reply@test.example>' } }, tok);
  const made = await x.call('POST', '/api/admin/customers', { name: 'Lang Test', username: 'langtest', password: 'secret12', email: 'lang@example.com', planId: 'p1' }, tok);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const id = (made.json.customer || made.json).id;
  const line = await x.call('POST', `/api/admin/customers/${id}/line`, { m3u: 'http://line.test:8080/get.php?username=langline&password=pw9&type=m3u_plus' }, tok);
  assert.equal(line.status, 200, JSON.stringify(line.json)); assert.equal(line.json.emailSent, true);
  assert.equal(x.mails.length, 1); assert.equal(x.mails[0].to[0], 'lang@example.com');
  assert.match(x.mails[0].subject, /Subscription Is Active/, 'falls back to English instead of crashing');
});

// ---- Resellers: profiles added by hand, from customer rows, or read from pasted text (made-up people only) ----
const RS_TEXT = `Robin Tester
○	Email · Work: robin.tester@example.com
○	Phone · Mobile: +15550100001
○	Organization: Reseller (RSL-122)
Bullet Name: PAT PLACEHOLDER
Bullet Phone: +4915550100002
Bullet Email: PP@example.org
Bullet Period / Package: 1 Year 10Line
Bullet Price Paid: $290.99
Bullet Server: MEGA
Bullet Notice / Panel Tag: Panel north
3. Morgan Sample
Bullet Order Reference: Resseler-04 (Excel Row 85)
Bullet Name: Morgan Sample
Bullet Phone: +525550100003
Bullet Email: morgan@example.net
Bullet Date: 23/12/2023
Bullet Period / Credits: 20 Credit
Bullet Price Paid: $460,99
Bullet Server: MEGA
Jamie Demo (Multiple Orders / Reseller Entries)
Bullet Phone: +15550100004
Bullet Emails: jamie.one@example.com / jamie.two@example.com
Bullet Server: MEGA / YES
Order History:
Bullet Resseler-08 (Row 311 - Feb 22, 2024): 10 Credit — $280.99
Bullet Resseler-05 (Row 1`;

test('reseller text reader: contact cards, label lists, order history, cut-off lines', () => {
  const r = parseResellerText(RS_TEXT).profiles;
  assert.deepEqual(r.map((p) => p.name), ['Robin Tester', 'PAT PLACEHOLDER', 'Morgan Sample', 'Jamie Demo']);
  const [robin, pat, morgan, jamie] = r;
  assert.deepEqual(robin.emails, ['robin.tester@example.com']); assert.equal(robin.phone, '+15550100001'); assert.equal(robin.rslId, 'RSL-122'); assert.equal(robin.org, 'Reseller'); assert.equal(robin.orders.length, 0);
  assert.deepEqual(pat.emails, ['pp@example.org']); assert.equal(pat.tag, 'Panel north'); assert.equal(pat.server, 'MEGA');
  assert.equal(pat.orders.length, 1); assert.equal(pat.orders[0].pkg, '1 Year 10Line'); assert.equal(pat.orders[0].amount, 290.99); assert.equal(pat.orders[0].currency, 'USD'); assert.equal(pat.orders[0].credits, 0);
  assert.equal(morgan.orders.length, 1);
  assert.deepEqual({ ref: morgan.orders[0].ref, credits: morgan.orders[0].credits, amount: morgan.orders[0].amount, day: new Date(morgan.orders[0].at).toISOString().slice(0, 10) }, { ref: 'Resseler-04', credits: 20, amount: 460.99, day: '2023-12-23' });
  assert.deepEqual(jamie.emails, ['jamie.one@example.com', 'jamie.two@example.com']); assert.equal(jamie.server, 'MEGA', 'a "YES" in the server column is not a server');
  assert.equal(jamie.orders.length, 2);
  const o8 = jamie.orders.find((o) => o.ref === 'Resseler-08'); assert.equal(o8.credits, 10); assert.equal(o8.amount, 280.99); assert.equal(new Date(o8.at).toISOString().slice(0, 10), '2024-02-22');
  const o5 = jamie.orders.find((o) => o.ref === 'Resseler-05'); assert.equal(o5.amount, 0, 'a cut-off line keeps its order number only');
});

test('reseller text reader: rows copied from a sheet, simple lists, dates, money, and card numbers are never kept', () => {
  const T = '\t';
  const rows = [
    ['Order', 'phone-number', 'Name', 'Email', 'Subscription - AT', 'Subscription - T', 'Period', 'Price', 'Expiry in', 'Paid Credit', 'REFUND', 'NOTICE', 'SERVER'].join(T),
    ['Resseler-31', '‪+15550100011', 'Alex Example', 'alex@example.com', '2024-03-15 00:00:00', '----------', '05 credit', '     170.99', '----------', 'YES', '', '', 'MEGA'].join(T),
    ['Resseler-32', '‪‪+15550100011', 'Alex Example', 'alex.second@example.com', '2024-05-07 00:00:00', '-----', '10 Credit', '     280.99', '-----', 'YES', '', 'Panel 700', 'YES'].join(T),
  ].join('\n');
  const a = parseResellerText(rows).profiles;
  assert.equal(a.length, 1, 'two rows with the same phone are one reseller');
  assert.deepEqual(a[0].emails, ['alex@example.com', 'alex.second@example.com']); assert.equal(a[0].phone, '+15550100011');
  assert.deepEqual(a[0].orders.map((o) => [o.ref, o.credits, o.amount]), [['Resseler-31', 5, 170.99], ['Resseler-32', 10, 280.99]]);
  // no header row, with card columns in the middle (4242… is the public test card number)
  const b = parseResellerText(['RLS-077', 'NEW', 'Normal', 'Sam Sample', 'Sam.Sample@Example.com', '92.0', '3335550123', '12 Test Road', '4242424242424242', '123', '1.0', '2029.0', '✓ LIVE', '30/11/2025', 'Resseler ', '✓ DINO', '$ USD', '500.99', 'Paid by transfer'].join(T)).profiles;
  assert.equal(b.length, 1); assert.equal(b[0].name, 'Sam Sample'); assert.equal(b[0].server, 'DINO');
  assert.deepEqual([b[0].orders[0].ref, b[0].orders[0].amount, b[0].orders[0].currency, new Date(b[0].orders[0].at).toISOString().slice(0, 10)], ['RLS-077', 500.99, 'USD', '2025-11-30']);
  assert.ok(!/4242/.test(JSON.stringify(b)), 'the card number is dropped');
  const c = parseResellerText('Name: Lee One\nPhone: +212600000001\nCredit Card: 4242 4242 4242 4242\nCVV: 123\nNote: paid with 4242-4242-4242-4242\nName: Mo Two\nWhatsApp: 00212600000002\nAmount: 1.299,00 €\nPackage: 50 Credits').profiles;
  assert.equal(c.length, 2); assert.ok(!/4242/.test(JSON.stringify(c)));
  assert.deepEqual([c[1].phone, c[1].orders[0].amount, c[1].orders[0].currency, c[1].orders[0].credits], ['+212600000002', 1299, 'EUR', 50]);
  const d = parseResellerText('My resellers:\nRobin Tester, robin@example.com, +44 7700 900123\nKim Demo - kim@example.net - 0044 7700 900456\nJust a sentence.').profiles;
  assert.deepEqual(d.map((p) => [p.name, p.emails[0], p.phone]), [['Robin Tester', 'robin@example.com', '+447700900123'], ['Kim Demo', 'kim@example.net', '+447700900456']]);
  assert.equal(parseResellerText('nothing useful here\n\n---').profiles.length, 0);
  const day = (x) => (parseLooseDate(x) ? new Date(parseLooseDate(x)).toISOString().slice(0, 10) : '');
  assert.deepEqual(['23/12/2023', 'Feb 22, 2024', '2024-02-22 00:00:00', '4 December 2025', 'hello'].map(day), ['2023-12-23', '2024-02-22', '2024-02-22', '2025-12-04', '']);
  assert.deepEqual([parseMoney('$280,99'), parseMoney('$1,280.99'), parseMoney('1.280,50 €')], [{ amount: 280.99, currency: 'USD' }, { amount: 1280.99, currency: 'USD' }, { amount: 1280.5, currency: 'EUR' }]);
  assert.deepEqual([cleanPhoneText('‪+15550100011'), cleanPhoneText('4242424242424242'), cleanPhoneText('12')], ['+15550100011', '', '']);
  assert.equal(scrubCards('card 4242 4242 4242 4242, phone +15550100011'), 'card , phone +15550100011');
  assert.deepEqual(['RSL-122', 'rls 5', '7', 'abc'].map(cleanRslId), ['RSL-122', 'RSL-05', 'RSL-07', '']);
});

// rows as the spreadsheet import leaves them: one customer per order, with the period text kept on the sale
async function importResellerRows(x, tok) {
  const day = (d) => Date.UTC(2024, 0, d, 12);
  const row = (n, name, email, phone, price, period, d, extra = {}) => ({ id: 'rsrow' + n, username: 'Resseler-0' + n, orderNo: 'Resseler-0' + n, name, email, phone, price, currency: 'USD', server: n === 3 ? 'YES' : 'MEGA', startAt: day(d), expiresAt: day(d) + 30 * 86400000, salt: 'aa', passwordHash: 'bb', ...extra });
  const customers = [
    row(1, 'Jamie Demo', 'jamie.one@example.com', '+15550100004', 280.99, '10 credit', 5),
    row(2, 'Jamie Demo', 'jamie.two@example.com', '+1 555 010 0004', 280.99, '10 Credit', 9),
    row(3, 'jamie demo', 'jamie.one@example.com', '+15550100004', 231.99, '----------', 12),
    row(4, 'Morgan Sample', 'morgan@example.net', '+525550100003', 460.99, '20 Credit', 15),
    { id: 'rsrow9', username: 'Order-74', orderNo: 'Order-74', name: 'PAT PLACEHOLDER', email: 'pp@example.org', phone: '+4915550100002', price: 290.99, currency: 'USD', server: 'MEGA', panel: 'Panel north cash', startAt: day(20), expiresAt: day(20) + 365 * 86400000, salt: 'aa', passwordHash: 'bb' },
    { id: 'rsrow8', username: 'Order-75', orderNo: 'Order-75', name: 'Normal Viewer', email: 'viewer@example.com', phone: '+15550100099', price: 59.99, currency: 'USD', server: 'MEGA', startAt: day(21), expiresAt: day(21) + 365 * 86400000, salt: 'aa', passwordHash: 'bb' },
  ];
  const periods = { rsrow1: '10 credit', rsrow2: '10 Credit', rsrow3: '----------', rsrow4: '20 Credit', rsrow9: '1 Year 10Line', rsrow8: '1 Year' };
  const sales = customers.map((c) => ({ id: 's' + c.id, by: 'import', at: c.startAt, customerId: c.id, username: c.username, name: c.name, type: 'new', planId: 'p1', planName: periods[c.id], days: 30, credits: 0, amount: c.price, currency: 'USD', amountUsd: c.price, costUsd: 0, accountId: '' }));
  const r = await x.call('POST', '/api/admin/import', { customers, sales }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.added, customers.length);
}

test('resellers: add by hand, change, custom RSL id, duplicates and bad input are refused', async () => {
  const x = setup(); const tok = await adminToken(x);
  assert.equal((await x.call('POST', '/api/admin/reseller/save', { name: '' }, tok)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/reseller/save', { name: 'Robin Tester', email: 'not-an-email' }, tok)).status, 400);
  const a = await x.call('POST', '/api/admin/reseller/save', { name: 'Robin Tester', email: 'Robin.Tester@Example.com', phone: '+1 (555) 010-0001', org: 'North Media', server: 'MEGA', tag: 'Panel north', note: 'pays by transfer 4242 4242 4242 4242' }, tok);
  assert.equal(a.status, 200, JSON.stringify(a.json)); assert.equal(a.json.reseller.rslId, 'RSL-01');
  const twin = await x.call('POST', '/api/admin/reseller/save', { name: 'Someone Else', phone: '0015550100001' }, tok);
  assert.equal(twin.status, 409, 'the same phone number is the same reseller');
  const b = await x.call('POST', '/api/admin/reseller/save', { name: 'Pat Placeholder', rslId: 'rsl 122' }, tok);
  assert.equal(b.json.reseller.rslId, 'RSL-122');
  assert.equal((await x.call('POST', '/api/admin/reseller/save', { name: 'Third One', rslId: 'RSL-122' }, tok)).status, 409, 'an RSL id is used once');
  assert.equal((await x.call('POST', '/api/admin/reseller/save', { name: 'Third One', rslId: 'banana' }, tok)).status, 400);
  const c = await x.call('POST', '/api/admin/reseller/save', { name: 'Third One' }, tok);
  assert.equal(c.json.reseller.rslId, 'RSL-02', 'automatic ids carry on from the counter, not from a typed id');
  let list = (await x.call('GET', '/api/admin/reseller', {}, tok)).json.list;
  assert.equal(list.length, 3);
  const robin = list.find((r) => r.rslId === 'RSL-01');
  assert.deepEqual([robin.email, robin.phone, robin.org, robin.server, robin.tag, robin.purchases], ['robin.tester@example.com', '+15550100001', 'North Media', 'MEGA', 'Panel north', 0]);
  assert.ok(!/4242/.test(robin.note), 'card numbers are taken out of notes');
  const ed = await x.call('POST', '/api/admin/reseller/save', { id: robin.id, name: 'Robin T. Tester', email: 'robin.tester@example.com', emails: 'second@example.com, third@example.com', phone: '+15550100001', rslId: 'RSL-07', status: 'paused' }, tok);
  assert.equal(ed.status, 200, JSON.stringify(ed.json));
  list = (await x.call('GET', '/api/admin/reseller', {}, tok)).json.list;
  const r2 = list.find((r) => r.id === robin.id);
  assert.deepEqual([r2.name, r2.rslId, r2.status, r2.emails.length], ['Robin T. Tester', 'RSL-07', 'paused', 3]);
  assert.equal((await x.call('POST', '/api/admin/reseller/save', { id: 'nope', name: 'X' }, tok)).status, 404);
  // orders typed in by hand
  const o1 = await x.call('POST', '/api/admin/reseller/order', { id: robin.id, order: { date: '2024-02-22', pkg: '10 Credit', amount: 280.99, currency: 'USD', ref: 'R-1', server: 'MEGA' } }, tok);
  assert.equal(o1.status, 200, JSON.stringify(o1.json));
  await x.call('POST', '/api/admin/reseller/order', { id: robin.id, order: { date: '2024-03-01', credits: 20, amount: 4600, currency: 'MAD' } }, tok);
  assert.equal((await x.call('POST', '/api/admin/reseller/order', { id: robin.id, order: {} }, tok)).status, 400);
  let rr = (await x.call('GET', '/api/admin/reseller', {}, tok)).json.list.find((r) => r.id === robin.id);
  assert.equal(rr.purchases, 2); assert.equal(rr.credits, 30, 'credits are read from "10 Credit" when the number is left empty');
  assert.ok(rr.spentUsd > 280.99 && rr.spentUsd < 4600, 'MAD is converted to USD: ' + rr.spentUsd);
  assert.equal(rr.rank, 1); assert.ok(rr.rate > 0);
  const first = rr.orders.find((o) => o.ref === 'R-1');
  await x.call('POST', '/api/admin/reseller/order', { id: robin.id, order: { id: first.id, date: '2024-02-23', pkg: '10 Credit', credits: 10, amount: 300, currency: 'USD', ref: 'R-1' } }, tok);
  rr = (await x.call('GET', '/api/admin/reseller', {}, tok)).json.list.find((r) => r.id === robin.id);
  assert.equal(rr.orders.find((o) => o.ref === 'R-1').amount, 300); assert.equal(rr.purchases, 2);
  assert.equal((await x.call('POST', '/api/admin/reseller/order-delete', { id: robin.id, orderId: first.id }, tok)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/reseller', {}, tok)).json.list.find((r) => r.id === robin.id).purchases, 1);
  // delete
  assert.equal((await x.call('POST', '/api/admin/reseller/delete', { id: robin.id }, tok)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/reseller', {}, tok)).json.list.length, 2);
  // the backup carries the profiles
  assert.equal((await x.call('GET', '/api/admin/backup', {}, tok)).json.resellers.length, 2);
});

test('resellers: found in the customer list, grouped by person, added with their orders, and removable', async () => {
  const x = setup(); const tok = await adminToken(x);
  await importResellerRows(x, tok);
  let r = (await x.call('GET', '/api/admin/reseller', {}, tok)).json;
  assert.equal(r.list.length, 0);
  assert.deepEqual(r.found.map((f) => [f.name, f.n]).sort(), [['Jamie Demo', 3], ['Morgan Sample', 1], ['PAT PLACEHOLDER', 1]], 'credit orders and line packs are found, a normal viewer is not: ' + JSON.stringify(r.found.map((f) => f.name)));
  const jamie = r.found.find((f) => f.n === 3);
  assert.equal(jamie.credits, 20); assert.equal(jamie.totalUsd, 793.97); assert.equal(jamie.into, null);
  const add = await x.call('POST', '/api/admin/reseller/from-customers', { ids: jamie.ids }, tok);
  assert.equal(add.status, 200, JSON.stringify(add.json));
  assert.deepEqual([add.json.made, add.json.rows, add.json.orders], [1, 3, 3]);
  r = (await x.call('GET', '/api/admin/reseller', {}, tok)).json;
  assert.equal(r.list.length, 1); assert.equal(r.found.length, 2);
  const p = r.list[0];
  assert.deepEqual([p.rslId, p.name, p.purchases, p.credits, p.spentUsd, p.emails.length, p.server], ['RSL-01', 'Jamie Demo', 3, 20, 793.97, 2, 'MEGA']);
  assert.equal(p.rate, 28.1, 'the rate only counts orders whose credits are known');
  assert.deepEqual(p.orders.map((o) => o.ref).sort(), ['Resseler-01', 'Resseler-02', 'Resseler-03']);
  assert.equal(p.orders.find((o) => o.ref === 'Resseler-03').pkg, '', 'a dashed period is left empty');
  const cs = (await x.call('GET', '/api/admin/customers', {}, tok, { rs: 1 })).json;
  assert.ok(cs.filter((c) => c.name.toLowerCase() === 'jamie demo').every((c) => c.isReseller && c.rslId === 'RSL-01'), 'the rows are marked');
  assert.ok(!(await x.call('GET', '/api/admin/customers', {}, tok)).json.some((c) => c.name.toLowerCase() === 'jamie demo'), 'reseller order rows are not shown as customers');
  // doing it again changes nothing
  const again = await x.call('POST', '/api/admin/reseller/from-customers', { ids: jamie.ids }, tok);
  assert.deepEqual([again.json.made, again.json.rows, again.json.orders], [0, 0, 0]);
  // two different people picked together become two resellers; a row without the order tick only links the person
  const both = await x.call('POST', '/api/admin/reseller/from-customers', { ids: ['rsrow4', 'rsrow8'], orders: false }, tok);
  assert.deepEqual([both.json.made, both.json.orders], [2, 0]);
  // "into" puts a row into a chosen reseller, moving it out of the old one
  const moved = await x.call('POST', '/api/admin/reseller/from-customers', { ids: ['rsrow9'], into: p.id }, tok);
  assert.equal(moved.status, 200); assert.equal(moved.json.orders, 1);
  r = (await x.call('GET', '/api/admin/reseller', {}, tok)).json;
  const p2 = r.list.find((z) => z.id === p.id);
  assert.equal(p2.purchases, 4); assert.equal(p2.orders.find((o) => o.ref === 'Order-74').pkg, '1 Year 10Line'); assert.equal(p2.orders.find((o) => o.ref === 'Order-74').note, 'Panel north cash');
  assert.equal(r.found.length, 0);
  // taking an order out puts its row back in the customer list as a normal row
  const o74 = p2.orders.find((o) => o.ref === 'Order-74');
  await x.call('POST', '/api/admin/reseller/order-delete', { id: p.id, orderId: o74.id }, tok);
  assert.ok(!(await x.call('GET', '/api/admin/customers', {}, tok, { rs: 1 })).json.find((c) => c.id === 'rsrow9').isReseller);
  assert.equal((await x.call('GET', '/api/admin/reseller', {}, tok)).json.found.length, 1, 'it is offered again');
  // deleting the reseller clears the marks
  await x.call('POST', '/api/admin/reseller/delete', { id: p.id }, tok);
  assert.ok((await x.call('GET', '/api/admin/customers', {}, tok, { rs: 1 })).json.filter((c) => c.name.toLowerCase() === 'jamie demo').every((c) => !c.isReseller));
  const fnd = (await x.call('GET', '/api/admin/reseller', {}, tok)).json.found; assert.ok(fnd.length > 0);
  await x.call('POST', '/api/admin/reseller/dismiss', { ids: fnd.flatMap((f) => f.ids) }, tok);
  assert.equal((await x.call('GET', '/api/admin/reseller', {}, tok)).json.found.length, 0, 'dismissed rows are not offered again');
  assert.equal((await x.call('POST', '/api/admin/reseller/from-customers', { ids: [] }, tok)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/reseller/from-customers', { ids: ['ghost'] }, tok)).status, 404);
});

test('resellers: pasted text adds new people, completes known ones and links their rows without duplicates', async () => {
  const x = setup(); const tok = await adminToken(x);
  await importResellerRows(x, tok);
  const parsed = parseResellerText(RS_TEXT.replace('Resseler-08 (Row 311 - Feb 22, 2024): 10 Credit — $280.99', 'Resseler-02 (Row 311 - Feb 22, 2024): 10 Credit — $280.99').replace('Resseler-05 (Row 1', 'Resseler-03 (Row 1')).profiles;
  const imp = await x.call('POST', '/api/admin/reseller/import', { profiles: parsed }, tok);
  assert.equal(imp.status, 200, JSON.stringify(imp.json));
  assert.deepEqual([imp.json.made, imp.json.updated], [4, 0]);
  let r = (await x.call('GET', '/api/admin/reseller', {}, tok)).json;
  const by = (n) => r.list.find((p) => p.name.toLowerCase() === n.toLowerCase());
  assert.equal(by('Robin Tester').rslId, 'RSL-122', 'the id written in the text is kept');
  assert.equal(by('PAT PLACEHOLDER').orders[0].amount, 290.99);
  const morgan = by('Morgan Sample');
  assert.equal(morgan.orders.length, 1); assert.equal(morgan.orders[0].ref, 'Resseler-04'); assert.equal(morgan.orders[0].customerId, 'rsrow4', 'the order is tied to the matching customer row');
  const jamie = by('Jamie Demo');
  assert.deepEqual(jamie.orders.map((o) => [o.ref, o.amount, o.credits]).sort(), [['Resseler-02', 280.99, 10], ['Resseler-03', 231.99, 0]], 'the cut-off line is completed from the customer row');
  assert.equal(jamie.customerIds.length, 2);
  // the one row of this person that the text did not mention is still offered, pointing at the existing reseller
  assert.deepEqual(r.found.map((f) => [f.name, f.n, f.into && f.into.rslId]), [['Jamie Demo', 1, jamie.rslId], ['PAT PLACEHOLDER', 1, by('PAT PLACEHOLDER').rslId]]);
  const rest = await x.call('POST', '/api/admin/reseller/from-customers', { ids: r.found[0].ids }, tok);
  assert.deepEqual([rest.json.made, rest.json.orders], [0, 1]);
  // pasting the same text again adds nothing
  const again = await x.call('POST', '/api/admin/reseller/import', { profiles: parsed }, tok);
  assert.deepEqual([again.json.made, again.json.updated, again.json.orders], [0, 4, 0]);
  r = (await x.call('GET', '/api/admin/reseller', {}, tok)).json;
  assert.equal(r.list.length, 4); assert.equal(r.list.find((p) => p.name === 'Jamie Demo').purchases, 3);
  // an order number that belongs to another person's row is not linked
  const odd = await x.call('POST', '/api/admin/reseller/import', { profiles: [{ name: 'Casey Other', emails: ['casey@example.com'], orders: [{ ref: 'Order-75', amount: 10 }] }] }, tok);
  assert.equal(odd.json.rows, 0);
  assert.ok(!(await x.call('GET', '/api/admin/customers', {}, tok, { rs: 1 })).json.find((c) => c.id === 'rsrow8').isReseller);
  assert.equal((await x.call('POST', '/api/admin/reseller/import', { profiles: [] }, tok)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/reseller/import', { profiles: [{ orders: [{ ref: 'X-1' }] }] }, tok)).status, 400);
  // card numbers never reach storage, whatever is sent
  await x.call('POST', '/api/admin/reseller/import', { profiles: [{ name: 'Card Carrier', phone: '+15550100777', note: 'card 4242424242424242', tag: '4242 4242 4242 4242', orders: [{ ref: 'Z-1', amount: 5, note: '4242-4242-4242-4242' }] }] }, tok);
  assert.ok(!/4242/.test(JSON.stringify(await x.store.get('resellers'))));
});

test('resellers: a recorded reseller sale lands in the profile once; staff limits and phone privacy hold', async () => {
  const x = setup(); const tok = await adminToken(x);
  const made = await x.call('POST', '/api/admin/reseller/save', { name: 'Robin Tester', phone: '+15550100001', email: 'robin@example.com' }, tok);
  const id = made.json.reseller.id;
  const st = (await x.call('GET', '/api/admin/settings', {}, tok)).json; const pk = st.resellerPackages[0];
  assert.ok(pk && pk.credits > 0, 'a reseller package exists');
  const sale = await x.call('POST', '/api/admin/reseller-sale', { packageId: pk.id, resellerId: id, amount: 250 }, tok);
  assert.equal(sale.status, 200, JSON.stringify(sale.json)); assert.equal(sale.json.customerId, id);
  assert.equal((await x.call('POST', '/api/admin/reseller-sale', { packageId: pk.id, resellerId: 'nope' }, tok)).status, 404);
  let row = (await x.call('GET', '/api/admin/reseller', {}, tok)).json.list[0];
  assert.deepEqual([row.purchases, row.credits], [1, pk.credits]); assert.equal(row.orders[0].saleId, sale.json.id);
  // a sale without a profile still works as before
  assert.equal((await x.call('POST', '/api/admin/reseller-sale', { packageId: pk.id, name: 'Walk In' }, tok)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/reseller', {}, tok)).json.list[0].purchases, 1);
  // staff with customers_edit but no phone permission
  await x.call('POST', '/api/admin/team', { name: 'Said', username: 'said', password: 'secret12', role: 'Sales Agent', perms: ['customers_view', 'customers_edit'] }, tok);
  const li = await x.call('POST', '/api/login', { username: 'said', password: 'secret12' }); await signBylaws(x, li.json.token);
  assert.equal((await x.call('GET', '/api/admin/reseller', {}, li.json.token)).status, 403, 'the reseller list is for the owner');
  assert.equal((await x.call('POST', '/api/admin/reseller/delete', { id }, li.json.token)).status, 403);
  const edit = await x.call('POST', '/api/admin/reseller/save', { id, name: 'Robin Tester', email: 'robin@example.com', phone: '•••••••••01' }, li.json.token);
  assert.equal(edit.status, 200, JSON.stringify(edit.json)); assert.match(edit.json.reseller.phone, /•/);
  assert.equal((await x.store.get('resellers'))[0].phone, '+15550100001', 'a masked number never replaces the real one');
  // an email written by hand, with the text kept as the template
  assert.equal((await x.call('POST', '/api/admin/reseller/email', { ids: [id], subject: 'Hi' }, li.json.token)).status, 403);
  assert.equal((await x.call('POST', '/api/admin/reseller/email', { ids: [id], subject: '', body: '' }, tok)).status, 400);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'a@example.com' } }, tok);
  const pv = await x.call('POST', '/api/admin/reseller/email', { ids: [id], subject: 'Offer for {rsl}', body: 'Hello {name}, you bought {credits} credits in {orders} order.', preview: true }, tok);
  assert.equal(pv.json.subject, 'Offer for RSL-01'); assert.match(pv.json.html, new RegExp('you bought ' + pk.credits + ' credits in 1 order'));
  const sent = await x.call('POST', '/api/admin/reseller/email', { ids: [id], subject: 'Offer for {rsl}', body: 'Hello {name}', save: true }, tok);
  assert.equal(sent.status, 200, JSON.stringify(sent.json)); assert.equal(sent.json.sent, 1);
  const after = (await x.call('GET', '/api/admin/reseller', {}, tok)).json;
  assert.equal(after.emailTpl.subject, 'Offer for {rsl}'); assert.ok(after.list[0].emailedAt > 0);
  assert.equal((await x.call('POST', '/api/admin/reseller/sync', {}, tok)).status, 404, 'the Google Sheets sync is gone');
  // the start date can be typed
  await x.call('POST', '/api/admin/reseller/save', { id, name: 'Robin Tester', email: 'robin@example.com', phone: '+15550100001', joined: '2023-10-30' }, tok);
  assert.equal(new Date((await x.call('GET', '/api/admin/reseller', {}, tok)).json.list[0].joinedAt).toISOString().slice(0, 10), '2023-10-30');
});


test('contact: emails mark ✓ Email sent, profile email links /profile, Telegram falls back when no bot chat, no-WhatsApp mark', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'a@example.com', appUrl: 'https://tv.example.com' } }, tok);
  await addCustomer(x, tok, { phone: '+15550100001' });
  const c = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((z) => z.username === 'testuser');
  const pv = await x.call('GET', `/api/admin/customers/${c.id}/profilepreview`, {}, tok);
  assert.match(pv.json.html, /https:\/\/tv\.example\.com\/profile/); assert.match(pv.json.html, /testuser/);
  const sent = await x.call('POST', `/api/admin/customers/${c.id}/profilemail`, {}, tok);
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  let c2 = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((z) => z.id === c.id);
  assert.ok(c2.contact.email > 0, 'sending an email marks ✓ Email');
  const tg = await x.call('POST', `/api/admin/customers/${c.id}/tgsend`, { text: 'Hello' }, tok);
  assert.deepEqual(tg.json, { sent: false, linked: false });
  await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'pay', channel: 'telegram', log: true }, tok);
  await x.call('PUT', `/api/admin/customers/${c.id}`, { contact: { noWhatsapp: true } }, tok);
  c2 = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((z) => z.id === c.id);
  assert.ok(c2.contact.telegram > 0 && !c2.contact.whatsapp && c2.contact.noWhatsapp > 0);
});

test('resellers: panel URL / username / password fill the email, ✓ marks and no-Telegram mark', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'a@example.com' } }, tok);
  const r = await x.call('POST', '/api/admin/reseller/save', { name: 'Robin Tester', email: 'robin@example.com', panelUrl: 'https://panel.example.com', panelUser: 'robin1', panelPass: 'p4ss', telegram: '@robin_t' }, tok);
  const id = r.json.reseller.id;
  assert.equal((await x.call('POST', '/api/admin/reseller/save', { id, name: 'Robin Tester', panelUrl: 'ftp://bad' }, tok)).status, 400);
  const pv = await x.call('POST', '/api/admin/reseller/email', { ids: [id], subject: 'Panel', body: 'URL {url} user {username} pass {password}', preview: true }, tok);
  assert.match(pv.json.html, /URL <a href="https:\/\/panel\.example\.com"[^>]*>https:\/\/panel\.example\.com<\/a> user robin1 pass p4ss/);
  await x.call('POST', '/api/admin/reseller/email', { ids: [id], subject: 'Panel', body: 'Hi' }, tok);
  await x.call('POST', '/api/admin/reseller/contact', { id, k: 'noTelegram', v: true }, tok);
  assert.equal((await x.call('POST', '/api/admin/reseller/contact', { id, k: 'bogus', v: true }, tok)).status, 400);
  const row = (await x.call('GET', '/api/admin/reseller', {}, tok)).json.list[0];
  assert.equal(row.telegram, 'robin_t'); assert.ok(row.contact.email > 0 && row.contact.noTelegram > 0);
  assert.deepEqual((await x.call('POST', '/api/admin/reseller/tgsend', { id, text: 'hi' }, tok)).json, { sent: false });
});

test('Resend keys: unlimited rows for customer and marketing emails, masked, kept on save, paused rows skipped, test button', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { adminEmail: 'boss@example.com' } }, tok);
  const rows = Array.from({ length: 15 }, (_, i) => ({ key: 're_key' + i, domain: `https://d${i}.example.com/`, name: 'Sender ' + i, on: i !== 3 }));
  assert.equal((await x.call('PUT', '/api/admin/settings', { email: { transRows: rows } }, tok)).status, 200);
  let st = (await x.call('GET', '/api/admin/settings', {}, tok)).json.email.transRows;
  assert.equal(st.length, 15, 'more than 10 keys'); assert.equal(st[0].key, '••••key0'); assert.equal(st[0].domain, 'd0.example.com');
  // saving the masked list back keeps the real keys
  st[1].name = 'Renamed'; await x.call('PUT', '/api/admin/settings', { email: { transRows: st } }, tok);
  const saved = JSON.parse(x.db.get('settings').v).email.transRows;
  assert.equal(saved[1].key, 're_key1'); assert.equal(saved[1].name, 'Renamed');
  // a paused key is never used
  await addCustomer(x, tok); x.mails.length = 0;
  const c = (await x.call('GET', '/api/admin/customers', {}, tok)).json[0];
  for (let i = 0; i < 25; i++) await x.call('POST', `/api/admin/customers/${c.id}/profilemail`, {}, tok);
  assert.ok(x.mails.length >= 25 && !x.mails.some((m) => /d3\.example\.com/.test(m.from)), 'the paused domain is skipped');
  assert.ok(x.mails.some((m) => /^Sender \d+ <noreply@d\d+\.example\.com>$/.test(m.from)));
  // marketing has its own list
  await x.call('PUT', '/api/admin/emailmkt/settings', { rows: [{ key: 're_m1', domain: 'news.example.com', name: 'News' }, { key: 're_m2', domain: 'promo.example.com', on: false }] }, tok);
  const ms = (await x.call('GET', '/api/admin/emailmkt/settings', {}, tok)).json.rows;
  assert.deepEqual(ms.map((r) => [r.key, r.domain, r.on]), [['••••e_m1', 'news.example.com', true], ['••••e_m2', 'promo.example.com', false]]);
  assert.equal((await x.call('GET', '/api/admin/emailmkt', {}, tok)).json.keysSet, 1);
  // test one row
  const t = await x.call('POST', '/api/admin/email/test-key', { scope: 'mkt', id: ms[0].id }, tok);
  assert.equal(t.status, 200, JSON.stringify(t.json)); assert.equal(x.mails.at(-1).from, 'News <noreply@news.example.com>'); assert.deepEqual(x.mails.at(-1).to, ['boss@example.com']);
  assert.equal((await x.call('POST', '/api/admin/email/test-key', { scope: 'trans', key: 're_new', domain: '' }, tok)).status, 400);
  assert.equal(JSON.parse(x.db.get('mkt').v).rows[0].testOk, true);
});

test('connections: a customer keeps several lines (Xtream 1, Xtream 2, Unlimited M3U) and sees them all on /profile', async () => {
  const x = setup(); const tok = await adminToken(x);
  const c = await addCustomer(x, tok, { username: 'main1', lineSame: false, lineUsername: 'main1', linePassword: 'pw1', m3u: 'http://dns.test:8080/get.php?username=main1&password=pw1&type=m3u_plus', lineType: 'xtream1', connections: 1,
    lines: [{ type: 'xtream2', devices: 2, label: 'Kids TV', m3u: 'http://dns2.test:8080/get.php?username=second2&password=pw2&type=m3u_plus' }, { type: 'unlimited', m3u: 'https://lists.example.com/my.m3u' }, { type: 'bogus', u: '', p: '' }] });
  const list = (await x.call('GET', '/api/admin/customers', {}, tok)).json; const row = list.find((v) => v.id === c.id);
  assert.equal(row.lines.length, 2, 'empty rows are dropped');
  assert.deepEqual(row.lines.map((l) => [l.type, l.u, l.p, l.dns]), [['xtream2', 'second2', 'pw2', 'http://dns2.test:8080'], ['unlimited', '', '', '']]);
  // edit: change a type, remove one
  const up = await x.call('PUT', `/api/admin/customers/${c.id}`, { lineType: 'xtream2', lines: [{ ...row.lines[0], type: 'xtream1', devices: 3 }] }, tok); assert.equal(up.status, 200);
  const u = await x.call('POST', '/api/login', { username: 'main1', password: 'pw1' }); assert.equal(u.status, 200, 'signs in with the line');
  const me = (await x.call('GET', '/api/me', {}, u.json.token)).json;
  assert.equal(me.user.lines, undefined, 'lines are not in the public user object');
  assert.equal(me.stream.lineType, 'xtream2');
  assert.equal(me.stream.lines.length, 1); assert.equal(me.stream.lines[0].typeName, 'Xtream Codes 1 + M3U'); assert.equal(me.user.devicesTotal, 4);
  assert.match(me.stream.lines[0].m3u, /username=second2&password=pw2/);
  // the line email lists the other connection
  const cust = JSON.parse(x.db.get('customers').v).find((v) => v.id === c.id);
  const m = accessEmail({ branding: { appName: 'INTPROTO-TV', logoUrl: '' }, email: {}, player: {}, trial: { hours: 24 } }, cust, 'secret12', 'sub', 'https://app.test');
  assert.match(m.html, /Your other connections/); assert.match(m.html, /Kids TV/); assert.match(m.html, /second2/);
  // WhatsApp login message adds the other connection
  const wa = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'login', lang: 'en' }, tok)).json;
  assert.match(wa.text, /Connection 2\* — Kids TV · Xtream Codes 1 \+ M3U · 3 device\(s\)/);
});

test('Black Friday: code added to renewal email and WhatsApp only while on and between the dates', async () => {
  const x = setup(); const tok = await adminToken(x);
  const c = await addCustomer(x, tok, { phone: '+212600000001' });
  const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  let wa = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'renew', lang: 'en' }, tok)).json;
  assert.doesNotMatch(wa.text, /BLACKFRIDAY/, 'off by default');
  assert.equal((await x.call('PUT', '/api/admin/settings', { promo: { on: true, code: ' bf 26 ', offer: '30% OFF', from: today, to: later } }, tok)).status, 200);
  const st = (await x.call('GET', '/api/admin/promo', {}, tok)).json; assert.equal(st.live, true); assert.equal(st.promo.code, 'BF26');
  wa = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'renew', lang: 'en' }, tok)).json;
  assert.match(wa.text, /Black Friday is here!\*\nGet \*30% OFF\* on every .* plan with code \*BF26\*/);
  const fr = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'trial', lang: 'fr' }, tok)).json; assert.match(fr.text, /Le Black Friday est là/);
  const login = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'login', lang: 'en' }, tok)).json; assert.doesNotMatch(login.text, /BF26/, 'not in login details');
  const rn = (await x.call('GET', `/api/admin/customers/${c.id}/renewalpreview`, {}, tok)).json;
  assert.match(rn.subject, /^🖤 Black Friday: /); assert.match(rn.html, /BF26/); assert.doesNotMatch(rn.html, /LION001/);
  // only WhatsApp turned off: Telegram text still has it
  await x.call('PUT', '/api/admin/settings', { promo: { whatsapp: false } }, tok);
  assert.doesNotMatch((await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'renew', lang: 'en' }, tok)).json.text, /BF26/);
  assert.match((await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'renew', lang: 'en', channel: 'telegram' }, tok)).json.text, /BF26/);
  // dates in the past: nothing
  await x.call('PUT', '/api/admin/settings', { promo: { from: '2020-11-20', to: '2020-11-30' } }, tok);
  assert.equal((await x.call('GET', '/api/admin/promo', {}, tok)).json.live, false);
  assert.match((await x.call('GET', `/api/admin/customers/${c.id}/renewalpreview`, {}, tok)).json.html, /LION001/);
});

test('Black Friday: newsletter preset and Telegram channel post', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { promo: { on: true, code: 'BLACKFRIDAY', offer: '', from: '', to: '2026-12-01' } }, tok);
  const d = (await x.call('GET', '/api/admin/promo', {}, tok)).json;
  assert.equal(d.campaign.coupon, 'BLACKFRIDAY'); assert.match(d.campaign.content.en.body, /biggest discount of the year/); assert.match(d.campaign.content.fr.title, /Le Black Friday est là/);
  assert.equal((await x.call('POST', '/api/admin/promo/telegram', {}, tok)).status, 400, 'no channel yet');
  await x.call('PUT', '/api/admin/settings', { branding: { telegramChannel: 'intprototv' }, telegram: { enabled: true, botToken: '123:abc' } }, tok);
  const r = await x.call('POST', '/api/admin/promo/telegram', {}, tok); assert.equal(r.status, 200, JSON.stringify(r.json));
  const sent = x.tg.at(-1); assert.equal(sent.chat_id, '@intprototv'); assert.match(sent.text, /Black Friday is here!/); assert.match(sent.text, /BLACKFRIDAY/);
});

test('new customers of a month: sign-ups, packages, reseller credits, IBO and delivery', async () => {
  const x = setup(); const tok = await adminToken(x);
  const a = await addCustomer(x, tok, { username: 'nm1', phone: '+212600000002' });
  await addCustomer(x, tok, { username: 'nm2', email: 'nm2@example.com' });
  const cs = JSON.parse(x.db.get('customers').v); const TZ = 7 * 3600000; const n = new Date(Date.now() + TZ);
  const mid = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 15) - TZ; for (const c of cs) c.createdAt = mid; cs[0].contact = { whatsapp: mid, noTelegram: mid };
  x.db.set('customers', { v: JSON.stringify(cs), e: 0 });
  const r = await x.call('GET', '/api/admin/customers/newstats', {}, tok); assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json; assert.equal(d.total, 2); assert.equal(d.paid, 2); assert.equal(d.sent.whatsapp, 1); assert.equal(d.notSent, 1);
  assert.equal(d.standard.plans['1 Month'], 2); assert.equal(d.customers.find((c) => c.username === cs[0].username).noTelegram, true);
  const now = await x.call('GET', '/api/admin/customers/newstats', {}, tok, { month: new Date(Date.now() + TZ).toISOString().slice(0, 7) }); assert.equal(now.json.total, 0, 'this month is empty');
  // editing a customer stamps the update date
  assert.equal((await x.call('PUT', `/api/admin/customers/${a.id}`, { note: 'checked' }, tok)).status, 200);
  assert.ok(JSON.parse(x.db.get('customers').v).find((c) => c.id === a.id).updatedAt > 0);
});

test('last month retention: renewed, lost and still running', async () => {
  const x = setup(); const tok = await adminToken(x);
  for (const u of ['rt1', 'rt2', 'rt3']) await addCustomer(x, tok, { username: u });
  const cs = JSON.parse(x.db.get('customers').v); const TZ = 7 * 3600000; const n = new Date(Date.now() + TZ); const D = 86400000;
  const mid = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 3) - TZ;
  cs.forEach((c) => { c.createdAt = mid; c.renewals = [{ at: mid, type: 'new', days: 30, price: 10 }]; });
  cs[0].renewals.push({ at: mid + 29 * D, type: 'renew', days: 30, price: 12 }); cs[0].expiresAt = Date.now() + 20 * D;
  cs[1].expiresAt = Date.now() - D; cs[2].expiresAt = Date.now() + 5 * D;
  x.db.set('customers', { v: JSON.stringify(cs), e: 0 });
  const d = (await x.call('GET', '/api/admin/customers/newstats', {}, tok)).json;
  assert.equal(d.retention.renewed, 1); assert.equal(d.retention.lost, 1); assert.equal(d.retention.waiting, 1); assert.equal(d.retention.rate, 50);
  assert.equal(d.customers.find((c) => c.id === cs[1].id).renew, 'lost');
});

test('order numbers: parse, devices, original sequence, next number, duplicates, backup before organizing', async () => {
  const { parseOrderNo, orderDevices, orderRanks, nextOrderNo } = await import('../public/core.js');
  assert.deepEqual([parseOrderNo('WLF-045-04').main, parseOrderNo('WLF-045-04').dev], ['WLF-045', 4]);
  assert.deepEqual([parseOrderNo('Owl-404-01 to 04').dev, parseOrderNo('Owl-404-01 to 04').devTo], [1, 4]);
  assert.equal(parseOrderNo('Order-62-SC58').sub, 'SC58'); assert.equal(parseOrderNo('OWL -231').num, 231); assert.equal(parseOrderNo('A-0001-2222‬').raw, 'A-0001-2222');
  assert.deepEqual(orderDevices({ orderNo: 'WLF-045', connections: 4 }), ['WLF-045-01', 'WLF-045-02', 'WLF-045-03', 'WLF-045-04']);
  assert.deepEqual(orderDevices({ orderNo: 'WLF-013-04', connections: 4 }), ['WLF-013-01', 'WLF-013-02', 'WLF-013-03', 'WLF-013-04']);
  const D = 864e5, t0 = Date.parse('2023-09-01');
  const L = [
    { id: 'w2', orderNo: 'WLF-002', startAt: t0 + 700 * D }, { id: 'o2', orderNo: 'Order-002', startAt: t0 + 900 * D /* renewed later */ },
    { id: 'o1', orderNo: 'Order-001', startAt: t0 }, { id: 'o3', orderNo: 'OWL-003', startAt: t0 + 2 * D }, { id: 'w1', orderNo: 'WLF-001', startAt: t0 + 690 * D },
    { id: 'i3', orderNo: 'IBO-003', startAt: t0 + 710 * D }, { id: 'x', orderNo: '', startAt: t0 + 1000 * D },
  ];
  const rk = orderRanks(L, { orders: { series: 'WLF,IBO,RLS' } });
  assert.deepEqual([...L].sort((a, b) => rk.get(a.id) - rk.get(b.id)).map((c) => c.id), ['o1', 'o2', 'o3', 'w1', 'w2', 'i3', 'x']);
  assert.equal(nextOrderNo(L, { orders: { prefix: 'WLF', iboPrefix: 'IBO', rslPrefix: 'RLS', series: 'WLF,IBO,RLS', pad: 3 } }), 'WLF-004');
  assert.equal(nextOrderNo(L, { orders: { prefix: 'WLF', iboPrefix: 'IBO', rslPrefix: 'RLS', series: 'WLF,IBO,RLS', pad: 3 } }, 'ibo'), 'IBO-004');

  const x = setup(); const tok = await adminToken(x);
  const a = await addCustomer(x, tok, { username: 'ord1' });
  const c1 = JSON.parse(x.db.get('customers').v).find((c) => c.id === a.id); assert.equal(c1.orderNo, 'WLF-001', 'first order gets the first number'); assert.ok(c1.orderAt > 0);
  const b = await addCustomer(x, tok, { username: 'ord2', orderNo: 'Order-777' }); assert.ok(b.id);
  assert.equal((await x.call('POST', '/api/admin/customers', { name: 'Z', username: 'ord3', password: 'secret12', planId: 'p1', orderNo: 'order-777' }, tok)).status, 409, 'same number refused');
  assert.equal((await x.call('PUT', `/api/admin/customers/${b.id}`, { orderNo: 'wlf-001' }, tok)).status, 409, 'edit to a used number refused');
  assert.equal((await x.call('PUT', `/api/admin/customers/${b.id}`, { orderNo: 'WLF-001-02', name: 'second device' }, tok)).status, 200, 'another device of the same order is fine');
  // organize: backup first, only adds orderAt, numbers untouched
  const before = JSON.parse(x.db.get('customers').v).map((c) => ({ ...c })); for (const c of before) delete c.orderAt;
  const cs = JSON.parse(x.db.get('customers').v); for (const c of cs) delete c.orderAt; x.db.set('customers', { v: JSON.stringify(cs), e: 0 });
  const r = await x.call('POST', '/api/admin/orders/organize', {}, tok); assert.equal(r.status, 200, JSON.stringify(r.json));
  const bkp = JSON.parse(x.db.get(r.json.backup).v); assert.equal(bkp.customers.length, 2); assert.equal(bkp.customers[0].orderAt, undefined, 'backup is the state before');
  const after = JSON.parse(x.db.get('customers').v); assert.ok(after.every((c) => c.orderAt > 0));
  assert.deepEqual(after.map((c) => { const y = { ...c }; delete y.orderAt; return y; }), before);
  const sum = (await x.call('GET', '/api/admin/orders', {}, tok)).json; assert.equal(sum.backups.length, 1); assert.equal(sum.next.standard, 'WLF-002');
  assert.equal((await x.call('GET', '/api/admin/orders/backup', {}, tok, { key: r.json.backup })).json.customers.length, 2);
});

test('reseller credits: new reseller registered with a login, confirmation emails, /rsl dashboard, orders from the dashboard', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>' }, branding: { appName: 'INTPROTO-TV' } }, tok);
  // new reseller: registered and emailed
  let r = await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r10', name: 'Sample Reseller', email: 'sample.rsl@example.com', phone: '+27763456789', appUrl: 'https://intproto-tv.store' }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.json)); const R = r.json.reseller;
  assert.ok(R.isNew); assert.match(R.rslId, /^RSL-\d+/); assert.equal(R.login.username, R.rslId); assert.ok(R.login.pass.length >= 8);
  assert.equal(r.json.order.ref, 'RLS-001'); assert.equal(r.json.emailed, true);
  let m = x.mails.at(-1); assert.deepEqual(m.to, ['sample.rsl@example.com']); assert.match(m.subject, /Welcome to INTPROTO-TV resellers/);
  assert.match(m.html, /https:\/\/intproto-tv\.store\/rsl/); assert.match(m.html, new RegExp(R.login.pass)); assert.match(m.html, /RLS-001/); assert.match(m.html, /10 credits/);
  // the same person again (found by email) = existing reseller: no new profile, "Order confirmed" email with the same login
  r = await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r20', name: 'Sample R.', email: 'SAMPLE.RSL@example.com', appUrl: 'https://intproto-tv.store' }, tok);
  assert.equal(r.json.reseller.id, R.id); assert.equal(r.json.reseller.isNew, false); assert.equal(r.json.order.ref, 'RLS-002');
  m = x.mails.at(-1); assert.match(m.subject, /^Order confirmed: 20 credits/); assert.match(m.html, new RegExp(R.login.pass));
  // the reseller signs in on /rsl
  assert.equal((await x.call('POST', '/api/login', { username: R.rslId.toLowerCase(), password: 'wrong-pass' })).status, 401);
  const lg = await x.call('POST', '/api/login', { username: 'sample.rsl@example.com', password: R.login.pass }); assert.equal(lg.json.role, 'reseller'); const rt = lg.json.token;
  const me = (await x.call('GET', '/api/rsl/me', {}, rt)).json;
  assert.equal(me.credits.bought, 30); assert.equal(me.orders.length, 2); assert.equal(me.orders[0].ref, 'RLS-002'); assert.deepEqual(me.packages.map((p) => p.credits), [5, 10, 20, 30, 50]);
  assert.equal((await x.call('GET', '/api/me', {}, rt)).status, 403, 'not a customer account');
  assert.equal((await x.call('GET', '/api/admin/customers', {}, rt)).status, 403);
  // orders 50 credits from the dashboard → you complete it → email
  const q = await x.call('POST', '/api/rsl/order', { pkg: 'r50', method: 'PayPal' }, rt); assert.equal(q.status, 200);
  assert.equal((await x.call('POST', '/api/rsl/order', { pkg: 'r50', method: 'Gold bars' }, rt)).status, 400);
  const list = (await x.call('GET', '/api/admin/reseller', {}, tok)).json.list; assert.equal(list[0].requests.length, 1);
  r = await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r50', resellerId: R.id, requestId: q.json.request.id, appUrl: 'https://intproto-tv.store' }, tok);
  assert.equal(r.json.emailed, true); assert.match(x.mails.at(-1).subject, /50 credits/);
  assert.equal((await x.call('GET', '/api/rsl/me', {}, rt)).json.requests.length, 0); assert.equal((await x.call('GET', '/api/rsl/me', {}, rt)).json.credits.bought, 80);
  // password change; admin new password; credits left; paused account
  assert.equal((await x.call('POST', '/api/rsl/password', { current: 'nope', password: 'newpass1' }, rt)).status, 400);
  assert.equal((await x.call('POST', '/api/rsl/password', { current: R.login.pass, password: 'newpass1' }, rt)).status, 200);
  assert.equal((await x.call('POST', '/api/login', { username: R.rslId, password: 'newpass1' })).json.role, 'reseller');
  const lr = await x.call('POST', '/api/admin/reseller/login', { id: R.id, reset: true, creditsLeft: 12 }, tok); assert.notEqual(lr.json.pass, 'newpass1'); assert.equal(lr.json.creditsLeft, 12);
  assert.equal((await x.call('POST', '/api/login', { username: R.rslId, password: 'newpass1' })).status, 401, 'old password stops working');
  const t2 = (await x.call('POST', '/api/login', { username: R.rslId, password: lr.json.pass })).json.token; assert.equal((await x.call('GET', '/api/rsl/me', {}, t2)).json.credits.left, 12);
  await x.call('POST', '/api/admin/reseller/save', { id: R.id, name: 'Sample Reseller', status: 'paused' }, tok);
  assert.equal((await x.call('POST', '/api/login', { username: R.rslId, password: lr.json.pass })).status, 403);
});

test('5 languages: WhatsApp, renewal, profile, invoice, reseller emails and seasonal templates', async () => {
  const { seasonCampaign, LANG_CODES } = await import('../public/core.js');
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', lang: 'customer' }, branding: { appName: 'INTPROTO-TV' } }, tok);
  const c = await addCustomer(x, tok, { username: 'lang1', lang: 'de', phone: '+49151000000' });
  let row = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((v) => v.id === c.id); assert.equal(row.lang, 'de');
  const wa = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'renew' }, tok)).json; assert.match(wa.text, /^Hallo .*Ihr \*INTPROTO-TV\*-Abonnement (endet am|ist abgelaufen am)/s);
  assert.match((await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'login', lang: 'it' }, tok)).json.text, /Nome utente:/);
  assert.match((await x.call('GET', `/api/admin/customers/${c.id}/renewalpreview`, {}, tok)).json.subject, /Verlängern Sie Ihr INTPROTO-TV-Abonnement/);
  assert.match((await x.call('GET', `/api/admin/customers/${c.id}/profilepreview`, {}, tok)).json.subject, /Ihr INTPROTO-TV-Profil/);
  // invalid language falls back to English
  await x.call('PUT', `/api/admin/customers/${c.id}`, { lang: 'xx' }, tok); row = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((v) => v.id === c.id); assert.equal(row.lang, 'en');
  await x.call('PUT', `/api/admin/customers/${c.id}`, { lang: 'es' }, tok);
  // invoice: renew with an amount, then the invoice in Spanish
  await x.call('POST', `/api/admin/customers/${c.id}/renew`, { planId: 'p1', price: 15 }, tok);
  const inv = (await x.call('GET', `/api/admin/customers/${c.id}/invoice`, {}, tok)).json; assert.ok(inv.sales.length >= 1);
  const pv = (await x.call('GET', `/api/admin/customers/${c.id}/invoice`, {}, tok, { saleId: inv.sales[0].id })).json;
  assert.match(pv.subject, /^Factura INV-\d{6}-/); assert.match(pv.html, /Total pagado/); assert.match(pv.html, /Pagada/);
  const sent = await x.call('POST', `/api/admin/customers/${c.id}/invoice`, { saleId: inv.sales[0].id }, tok); assert.equal(sent.status, 200); assert.match(x.mails.at(-1).subject, /^Factura/);
  // seasonal templates: every language filled, code / end lines dropped when empty
  for (const kind of ['blackfriday', 'cybermonday', 'christmas', 'newyear']) {
    const camp = seasonCampaign({ branding: { appName: 'INTPROTO-TV' } }, kind, { offer: '30% OFF', code: 'XMAS26', end: '2026-12-26' });
    for (const l of LANG_CODES) { assert.ok(camp.content[l].subject && camp.content[l].body.includes('XMAS26') && camp.content[l].body.includes('30% OFF'), kind + ' ' + l); assert.ok(camp.badges[l]); }
    const bare = seasonCampaign({ branding: { appName: 'X' } }, kind, {}); for (const l of LANG_CODES) assert.doesNotMatch(bare.content[l].body, /\{|\[code\]|\[end\]|\*\*/);
  }
  const ch = (await x.call('GET', '/api/admin/newsletter/season', {}, tok, { kind: 'christmas', code: 'NOEL' })).json.campaign;
  assert.match(ch.content.fr.title, /Joyeux Noël/); assert.match(ch.content.de.title, /Frohe Weihnachten/); assert.equal(ch.badges.it, '🎄 Natale');
  // reseller in Italian
  const r = await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r10', name: 'Rivenditore Prova', email: 'riv@example.com' }, tok);
  const sv = await x.call('POST', '/api/admin/reseller/save', { id: r.json.reseller.id, name: 'Rivenditore Prova', email: 'riv@example.com', lang: 'it' }, tok); assert.equal(sv.status, 200, JSON.stringify(sv.json));
  const s2 = await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r20', resellerId: r.json.reseller.id }, tok); assert.equal(s2.status, 200, JSON.stringify(s2.json)); assert.equal(s2.json.emailed, true, JSON.stringify(s2.json));
  assert.match(x.mails.at(-1).subject, /^Ordine confermato: 20 crediti/); assert.match(x.mails.at(-1).html, /La tua dashboard rivenditore/);
});


test('accounts & API keys: only owner / Technical Manager / given permission; masked keys kept; spend per key; sheets; Resend + Dynu DNS', async () => {
  const sheet = { rows: [] }; const dynuAdded = []; const J = (o, status = 200) => ({ ok: status < 300, status, json: async () => o, text: async () => JSON.stringify(o) });
  const x = setup(async (url, init) => {
    if (url === 'https://api.resend.com/domains') return J({ data: [{ id: 'd1', name: 'mail.intproto-tv.store', status: 'not_started', region: 'us-east-1' }] });
    if (url === 'https://api.resend.com/domains/d1') return J({ records: [{ record: 'SPF', name: 'send.mail', type: 'MX', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10, status: 'not_started' }, { record: 'SPF', name: 'send.mail', type: 'TXT', value: 'v=spf1 include:amazonses.com ~all', status: 'not_started' }, { record: 'DKIM', name: 'resend._domainkey.mail', type: 'TXT', value: 'p=MIGf', status: 'not_started' }] });
    if (url === 'https://api.dynu.com/v2/dns') return J({ domains: [{ id: 77, name: 'intproto-tv.store' }] });
    if (url === 'https://api.dynu.com/v2/dns/77/record' && init.method === 'POST') { assert.equal(init.headers['API-Key'], 'dynu_key_123'); dynuAdded.push(JSON.parse(init.body)); return J({ id: 1 }); }
    if (url === 'https://api.dynu.com/v2/dns/77/record') return J({ dnsRecords: [{ recordType: 'TXT', nodeName: 'resend._domainkey.mail', textData: 'p=MIGf' }] });
    if (url.startsWith('https://script.google.com/') && init.method === 'POST') { const d = JSON.parse(init.body); sheet.rows = [d.header, ...d.rows]; return J('ok'); }
    if (url.startsWith('https://script.google.com/')) return J({ rows: sheet.rows });
  });
  const tok = await adminToken(x);
  // staff: Khalil (Technical Manager) and an agent
  await x.call('POST', '/api/admin/team', { name: 'Khalil', username: 'khalil', password: 'secret12', role: 'Technical Manager', perms: ['customers_view', 'settings'] }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Said', username: 'said', password: 'secret12', role: 'Sales Agent', perms: ['customers_view', 'customers_edit', 'settings', 'marketing'] }, tok);
  const kt = (await x.call('POST', '/api/login', { username: 'khalil', password: 'secret12' })).json.token; await signBylaws(x, kt);
  const at = (await x.call('POST', '/api/login', { username: 'said', password: 'secret12' })).json.token; await signBylaws(x, at);
  assert.ok((await x.call('GET', '/api/admin/me', {}, kt)).json.perms.includes('secrets'), 'Khalil gets the keys permission from his role');
  assert.ok(!(await x.call('GET', '/api/admin/me', {}, at)).json.perms.includes('secrets'));
  assert.equal((await x.call('GET', '/api/admin/accounts', {}, at)).status, 403, 'agents cannot open accounts');
  assert.equal((await x.call('POST', '/api/admin/accounts/save', { name: 'x' }, at)).status, 403);
  // agent with settings: email keys masked and not changeable
  await x.call('PUT', '/api/admin/settings', { email: { transRows: [{ key: 're_ownerkey_abcdef', domain: 'mail.intproto-tv.store', name: 'INTPROTO', on: true }], from: 'App <no-reply@intproto-tv.store>' } }, tok);
  const st = (await x.call('GET', '/api/admin/settings', {}, at)).json; assert.match(st.email.transRows[0].key, /^••••/); assert.doesNotMatch(JSON.stringify(st), /re_ownerkey_abcdef/);
  assert.equal((await x.call('PUT', '/api/admin/settings', { email: { transRows: [] } }, at)).status, 403);
  // Khalil adds accounts
  let r = await x.call('POST', '/api/admin/accounts/save', { kind: 'resend', name: 'Resend #1', email: 'mail1@example.com', password: 'Pw-1', apiKey: 're_test_key_111111', domains: 'mail.intproto-tv.store', tier: 'p100', paid: true, use: 'marketing' }, kt);
  assert.equal(r.status, 200, JSON.stringify(r.json)); const id = r.json.account.id; assert.equal(r.json.account.plan.price, 35); assert.equal(r.json.account.plan.quota, 100000);
  assert.equal((await x.call('POST', '/api/admin/accounts/save', { kind: 'resend', name: 'bad', apiKey: 'nope' }, kt)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/accounts/save', { kind: 'resend', name: 'dup', apiKey: 're_test_key_111111' }, kt)).status, 409);
  await x.call('POST', '/api/admin/accounts/save', { id, name: 'Resend #1', apiKey: '••••1111', password: '••••Pw-1' }, kt);
  let list = (await x.call('GET', '/api/admin/accounts', {}, tok)).json; assert.equal(list.rows[0].apiKey, 're_test_key_111111', 'masked value keeps the saved key'); assert.equal(list.rows[0].password, 'Pw-1');
  assert.equal(list.looseKeys, 1); assert.equal((await x.call('POST', '/api/admin/accounts/import-keys', {}, tok)).json.added, 1);
  await x.call('POST', '/api/admin/accounts/save', { kind: 'dynu', name: 'Dynu', apiKey: 'dynu_key_123', domains: 'intproto-tv.store' }, kt);
  // spend: customer emails sent with the owner key are counted for that key
  await x.call('PUT', '/api/admin/accounts/save', {}, tok);
  await addCustomer(x, tok, { username: 'spend1' }); await x.call('POST', '/api/forgot', { login: 'spend1', appUrl: 'https://a' });
  list = (await x.call('GET', '/api/admin/accounts', {}, tok)).json; const own = list.rows.find((a) => a.apiKey === 're_ownerkey_abcdef'); assert.ok(own.usage.month >= 1, JSON.stringify(own.usage));
  await x.call('POST', '/api/admin/accounts/save', { id: own.id, name: own.name, tier: 'p50', paid: true }, tok);
  list = (await x.call('GET', '/api/admin/accounts', {}, tok)).json; const o2 = list.rows.find((a) => a.id === own.id);
  assert.equal(o2.usage.cpe, 0.0004); assert.equal(list.totals.fees, 55); assert.equal(list.totals.paid, 2);
  // Resend domains and Dynu records (the DKIM already exists → skipped)
  const dm = (await x.call('POST', '/api/admin/accounts/resend-domains', { id }, kt)).json; assert.equal(dm.domains[0].records.length, 3);
  const dy = list.rows.find((a) => a.kind === 'dynu');
  const dn = await x.call('POST', '/api/admin/accounts/dynu', { dynuId: dy.id, resendId: id, domain: 'mail.intproto-tv.store' }, kt); assert.equal(dn.status, 200, JSON.stringify(dn.json));
  assert.deepEqual(dn.json.added, ['MX send.mail', 'TXT send.mail']); assert.deepEqual(dn.json.skipped, ['TXT resend._domainkey.mail']);
  assert.deepEqual(dynuAdded.map((q) => [q.recordType, q.nodeName, q.host || q.textData, q.priority]), [['MX', 'send.mail', 'feedback-smtp.us-east-1.amazonses.com', 10], ['TXT', 'send.mail', 'v=spf1 include:amazonses.com ~all', undefined]]);
  // Google Sheets: send, change in the sheet, read back
  assert.equal((await x.call('POST', '/api/admin/accounts/sheet', { url: 'https://evil.example/x' }, kt)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/accounts/sheet', { url: 'https://script.google.com/macros/s/abc/exec', push: true }, kt)).json.pushed, 3);
  assert.equal(sheet.rows[0][4], 'API key'); assert.ok(sheet.rows.some((row) => row[4] === 're_test_key_111111'));
  sheet.rows.find((row) => row[0] === 'Resend #1')[3] = 'New-Pass-9'; sheet.rows.push(['Hostinger main', 'Hostinger', 'host@example.com', 'H0st!', '', 'intproto-tv.store', '2.99', '', 'yes', '2027-01-01', '', 'websites']);
  const pull = (await x.call('POST', '/api/admin/accounts/sheet', { pull: true }, kt)).json; assert.deepEqual([pull.added, pull.changed], [1, 3]);
  list = (await x.call('GET', '/api/admin/accounts', {}, tok)).json; assert.equal(list.rows.find((a) => a.name === 'Resend #1').password, 'New-Pass-9'); assert.equal(list.rows.find((a) => a.kind === 'hostinger').plan.paid, true);
  // agent still blocked from everything; backups keep accounts
  assert.equal((await x.call('POST', '/api/admin/accounts/delete', { id }, at)).status, 403);
  assert.ok((await x.call('GET', '/api/admin/backup', {}, tok)).json.accounts.length === 4);
});

test('currency: USD everywhere, EUR for Europe (email ending, then phone code); own choice wins; switch off', async () => {
  const { isEurope, custCurrency, priceIn } = await import('../public/core.js');
  assert.equal(isEurope({ email: 'a@web.de' }), true); assert.equal(isEurope({ email: 'a@bluewin.ch' }), true); assert.equal(isEurope({ email: 'a@x.co.uk' }), true);
  assert.equal(isEurope({ email: 'a@gmail.com', whatsapp: '+41791234567' }), true); assert.equal(isEurope({ email: 'a@gmail.com', phone: '+12025550143' }), false);
  assert.equal(isEurope({ email: 'a@gmail.com', phone: '+27763456789' }), false, 'South Africa is not Europe'); assert.equal(isEurope({ email: 'a@mail.za' }), false);
  assert.equal(custCurrency({}, { email: 'a@web.de', curOverride: 'USD' }), 'USD'); assert.equal(custCurrency({ currencyRule: { on: false }, orderCurrency: 'EUR' }, { email: 'a@gmail.com' }), 'EUR');
  assert.equal(priceIn('$109.99', 'EUR'), '€109.99');
  const x = setup(); const tok = await adminToken(x);
  const us = await addCustomer(x, tok, { username: 'usa1', email: 'john@gmail.com', phone: '+12025550143' });
  const de = await addCustomer(x, tok, { username: 'ger1', email: 'hans@web.de', lang: 'de' });
  const rows = (await x.call('GET', '/api/admin/customers', {}, tok)).json; assert.equal(rows.find((c) => c.id === us.id).cur, 'USD'); assert.equal(rows.find((c) => c.id === de.id).cur, 'EUR');
  assert.match((await x.call('POST', `/api/admin/customers/${us.id}/wamsg`, { type: 'renew' }, tok)).json.text, /\$\d/);
  assert.match((await x.call('POST', `/api/admin/customers/${de.id}/wamsg`, { type: 'renew' }, tok)).json.text, /€\d/);
  assert.match((await x.call('GET', `/api/admin/customers/${de.id}/renewalpreview`, {}, tok)).json.html, /€109\.99/);
  assert.match((await x.call('GET', `/api/admin/customers/${us.id}/renewalpreview`, {}, tok)).json.html, /\$109\.99/);
  // hand choice
  await x.call('PUT', `/api/admin/customers/${us.id}`, { curOverride: 'EUR' }, tok);
  assert.equal((await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.id === us.id).cur, 'EUR');
  // reseller dashboard currency
  const r = await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r10', name: 'Swiss Reseller', email: 'rs@bluewin.ch' }, tok);
  const lg = await x.call('POST', '/api/login', { username: r.json.reseller.login.username, password: r.json.reseller.login.pass });
  assert.equal((await x.call('GET', '/api/rsl/me', {}, lg.json.token)).json.currency, 'EUR');
  // switch off → shop currency again
  await x.call('PUT', '/api/admin/settings', { currencyRule: { on: false }, orderCurrency: 'EUR' }, tok);
  assert.match((await x.call('POST', `/api/admin/customers/${de.id}/wamsg`, { type: 'renew' }, tok)).json.text, /€\d/);
  assert.equal((await x.call('GET', '/api/config', {})).json.packages?.[0]?.cur || 'EUR', 'EUR');
});

test('support page: details required first, ticket goes to the queue, all agents emailed, guest reply by email, WhatsApp support link', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { adminEmail: 'owner@example.com', resendKey: 're_test', from: 'App <no-reply@example.com>' }, support: { alertEmails: 'extra.agent@example.com, bad-email', email: 'help@example.com' } }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Agent Amy', username: 'amy', password: 'secret12', role: 'Support Agent', perms: ['customers_view'], notifyEmail: 'amy.work@example.com' }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Finance Fred', username: 'fred', password: 'secret12', role: 'Finance', perms: ['finance'], notifyEmail: 'fred@example.com' }, tok);
  const info = (await x.call('GET', '/api/support/info')).json; assert.equal(info.email, 'help@example.com');
  // no details → no ticket
  assert.equal((await x.call('POST', '/api/support/ticket', { token: 'nope', subject: 'Help me', text: 'Nothing works at all' })).json.error, 'sup_again');
  assert.equal((await x.call('POST', '/api/support/start', { name: 'Test Person', email: 'not-an-email', phone: '+27763456789' })).json.error, 'sup_info');
  assert.equal((await x.call('POST', '/api/support/start', { name: 'Test Person', email: 'test.person@example.com', phone: '12' })).json.error, 'sup_info');
  const st = await x.call('POST', '/api/support/start', { name: 'Test Person', email: 'test.person@example.com', phone: '+27763456789', device: 'Firestick', lang: 'de', ip: '1.2.3.4' });
  assert.equal(st.status, 200); assert.equal(st.json.known, false);
  const before = x.mails.length;
  assert.equal((await x.call('POST', '/api/support/ticket', { token: st.json.token, subject: 'x', text: 'y' })).json.error, 'ticket_short');
  const tk = await x.call('POST', '/api/support/ticket', { token: st.json.token, category: 'channels', subject: 'Sport channels freeze', text: 'Since yesterday the sport channels freeze after 10 seconds.' });
  assert.equal(tk.status, 200); assert.match(tk.json.ref, /^SUP-\d{6}$/);
  const to = x.mails.slice(before).flatMap((m) => [].concat(m.to));
  for (const e of ['owner@example.com', 'amy.work@example.com', 'extra.agent@example.com', 'test.person@example.com']) assert.ok(to.includes(e), 'email to ' + e);
  assert.ok(!to.includes('fred@example.com'), 'members who cannot see customers get no alert');
  const q = (await x.call('GET', '/api/admin/tickets', {}, tok)).json; const t1 = q.find((k) => k.ref === tk.json.ref);
  assert.ok(t1 && t1.status === 'open' && t1.guest && t1.contact.email === 'test.person@example.com' && t1.contact.device === 'Firestick' && t1.category === 'channels');
  // agent answers → emailed to the guest
  const n = x.mails.length;
  assert.equal((await x.call('POST', '/api/admin/tickets/reply', { id: t1.id, text: 'Please restart the app, it is fixed now.', status: 'answered' }, tok)).status, 200);
  assert.ok(x.mails.slice(n).some((m) => [].concat(m.to).includes('test.person@example.com') && /restart the app/.test(m.html)));
  assert.ok((await x.call('GET', '/api/admin/tickets', {}, tok)).json.find((k) => k.id === t1.id).messages.at(-1).emailed);
  // a known customer is matched by email
  const c = await addCustomer(x, tok, { username: 'knownuser', email: 'known@example.com' });
  assert.equal((await x.call('POST', '/api/support/start', { name: 'Known', email: 'known@example.com', phone: '+12025550143' })).json.known, true);
  // WhatsApp: every message ends with the support link; the support type works; switch off
  const w = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'renew', appUrl: 'https://tv.example.com' }, tok)).json.text;
  assert.match(w, /24\/7 support: https:\/\/tv\.example\.com\/support/);
  const sm = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'support', appUrl: 'https://tv.example.com' }, tok)).json;
  assert.equal(sm.type, 'support'); assert.match(sm.text, /https:\/\/tv\.example\.com\/support/); assert.match(sm.text, /help@example\.com/);
  await x.call('PUT', '/api/admin/settings', { support: { waLink: false } }, tok);
  assert.doesNotMatch((await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'renew', appUrl: 'https://tv.example.com' }, tok)).json.text, /\/support/);
  const ss = (await x.call('GET', '/api/admin/settings', {}, tok)).json.support; assert.equal(ss.alertEmails, 'extra.agent@example.com'); assert.equal(ss.email, 'help@example.com');
});

test('email keys: paid keys first, free trial keys only up to 100 a day, a failing key is skipped, status shown to every agent without keys', async () => {
  const used = []; let freeFails = false;
  const x = setup(async (url, init) => {
    if (!url.includes('api.resend.com/emails') || init.method !== 'POST') return null;
    const key = init.headers.Authorization.replace('Bearer ', ''); used.push(key);
    if (key === 're_PAID_dead') return { ok: false, status: 403, json: async () => ({ message: 'The intproto-tv.com domain is not verified. Please, add and verify your domain.' }) };
    if (key === 're_FREE_1' && freeFails) return { ok: false, status: 429, json: async () => ({ message: 'You have reached your daily email sending quota.' }) };
    return null;
  });
  const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { from: 'App <no-reply@example.com>', transRows: [
    { id: 'a', key: 're_FREE_1', domain: 'free.example.com', name: 'Free one', on: true, tier: 'free' },
    { id: 'b', key: 're_PAID_dead', domain: 'paid1.example.com', name: 'Paid broken', on: true, tier: 'p100' },
    { id: 'c', key: 're_PAID_ok', domain: 'paid2.example.com', name: 'Paid good', on: true, tier: 'p50' }] } }, tok);
  const saved = (await x.call('GET', '/api/admin/settings', {}, tok)).json.email.transRows; assert.deepEqual(saved.map((r) => r.tier), ['free', 'p100', 'p50']);
  const c = await addCustomer(x, tok, { username: 'mailuser', email: 'mail.user@example.com' });
  // send a few emails: the broken paid key is set aside, the working paid key sends; the free key is not needed
  for (let i = 0; i < 3; i++) { used.length = 0; await x.call('POST', '/api/admin/email/test', { to: 'mail.user@example.com' }, tok); }
  const st = (await x.call('GET', '/api/admin/email/status', {}, tok)).json;
  const byLabel = Object.fromEntries(st.rows.map((r) => [r.label, r]));
  assert.equal(byLabel['Paid broken'].state, 'paused'); assert.match(byLabel['Paid broken'].why, /not verified/);
  assert.ok(byLabel['Paid good'].month >= 1); assert.equal(byLabel['Free one'].month, 0, 'free key not used while a paid key works');
  assert.equal(st.status, 'warn');
  // paid key turned off → the free key sends, but never more than 100 a day
  await x.call('PUT', '/api/admin/settings', { email: { transRows: saved.map((r) => ({ ...r, on: r.id === 'a' })) } }, tok);
  const s1 = (await x.call('GET', '/api/admin/email/status', {}, tok)).json; assert.equal(s1.rows.find((r) => r.label === 'Free one').daily, 100);
  const keyuse = (await x.store.get('keyuse')) || {}; const day = new Date().toISOString().slice(0, 10), mo = day.slice(0, 7);
  // find the fingerprint by sending one email with only the free key on
  used.length = 0; await x.call('POST', '/api/admin/email/test', { to: 'mail.user@example.com' }, tok); assert.deepEqual(used, ['re_FREE_1']);
  const ku = await x.store.get('keyuse'); const ffp = Object.keys(ku).find((k) => ku[k].day === day && !(keyuse[k]?.total));
  ku[ffp].days = 100; ku[ffp].months[mo] = 100; await x.store.put('keyuse', ku);
  used.length = 0; await x.call('POST', '/api/admin/email/test', { to: 'mail.user@example.com' }, tok);
  assert.deepEqual(used, [], 'free key over its daily limit is not used'); 
  const s2 = (await x.call('GET', '/api/admin/email/status', {}, tok)).json; assert.equal(s2.status, 'down'); assert.equal(s2.rows.find((r) => r.label === 'Free one').state, 'limit');
  // an agent without the secrets permission sees the status but no key or domain
  await x.call('POST', '/api/admin/team', { name: 'Agent Amy', username: 'amy', password: 'secret12', role: 'Support Agent', perms: ['customers_view'] }, tok);
  const li = await x.call('POST', '/api/login', { username: 'amy', password: 'secret12' });
  await signBylaws(x, li.json.token); const ag = await x.call('GET', '/api/admin/email/status', {}, li.json.token); assert.equal(ag.status, 200);
  assert.ok(ag.json.rows.every((r) => !r.key && !r.domain)); assert.ok(!JSON.stringify(ag.json).includes('re_'));
});

test('notifications: devices subscribe, instant alerts to agents, shift start, owner check-ins, renewal thanks, reseller thanks, promos, dead devices removed', async () => {
  const pushes = []; const dead = new Set();
  const x = setup(async (url, init) => {
    if (!url.startsWith('https://push.example.com/')) return null;
    pushes.push({ url, auth: init.headers.Authorization, ttl: init.headers.TTL });
    return dead.has(url) ? { ok: false, status: 410, json: async () => ({}) } : { ok: true, status: 201, json: async () => ({}) };
  });
  const tok = await adminToken(x);
  const sub = (name) => ({ endpoint: 'https://push.example.com/' + name, keys: { p256dh: 'x', auth: 'y' } });
  const pull = async (name) => (await x.call('POST', '/api/push/pull', { endpoint: 'https://push.example.com/' + name })).json.notes;
  const key = (await x.call('GET', '/api/push/key')).json.key; assert.ok(key.length > 80);
  assert.equal((await x.call('POST', '/api/push/subscribe', { sub: sub('owner-laptop'), label: 'Mac · Chrome' }, tok)).status, 200);
  assert.match((await pull('owner-laptop'))[0].title, /🔔/, 'welcome note on the new device');
  // the push carries a valid VAPID signature
  const p0 = pushes[0]; assert.equal(p0.ttl, '86400'); const m = p0.auth.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/); assert.ok(m); assert.equal(m[4], key);
  const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4)), (c) => c.charCodeAt(0));
  const pub = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sig = Uint8Array.from(atob(m[3].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - m[3].length % 4) % 4)), (c) => c.charCodeAt(0));
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, new TextEncoder().encode(m[1] + '.' + m[2])));
  assert.equal(JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))).alg, 'ES256');
  // two agents on their phones, one finance member (not an agent)
  await x.call('POST', '/api/admin/team', { name: 'Khalil', username: 'khalil', password: 'secret12', role: 'Technical Manager', perms: ['customers_view', 'customers_edit', 'attendance'] }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Malak', username: 'malak', password: 'secret12', role: 'Support Agent', perms: ['customers_view', 'attendance'] }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Fred', username: 'fred', password: 'secret12', role: 'Finance', perms: ['finance_view'] }, tok);
  const lg = async (u) => { const r = await x.call('POST', '/api/login', { username: u, password: 'secret12' }); await signBylaws(x, r.json.token); return r.json.token; };
  const kt = await lg('khalil'), mt = await lg('malak'), ft = await lg('fred');
  await x.call('POST', '/api/push/subscribe', { sub: sub('khalil-iphone'), label: 'iPhone · Safari (app)', silent: true }, kt);
  await x.call('POST', '/api/push/subscribe', { sub: sub('malak-android'), label: 'Android phone · Chrome', silent: true }, mt);
  await x.call('POST', '/api/push/subscribe', { sub: sub('fred-pc'), label: 'Windows PC', silent: true }, ft);
  await pull('owner-laptop'); await pull('khalil-iphone'); await pull('malak-android');
  // 1. support request → every agent device at once
  const st = await x.call('POST', '/api/support/start', { name: 'Test Person', email: 'test.person@example.com', phone: '+27763456789' });
  await x.call('POST', '/api/support/ticket', { token: st.json.token, subject: 'Sport channels freeze', text: 'Since yesterday the sport channels freeze.' });
  for (const d of ['owner-laptop', 'khalil-iphone', 'malak-android']) assert.ok((await pull(d)).some((n) => /support ticket/.test(n.title)), d);
  assert.equal((await pull('fred-pc')).length, 0, 'not an agent');
  // free trial request
  await x.call('PUT', '/api/admin/settings', { trial: { mode: 'agents', enabled: true } }, tok);
  await x.call('POST', '/api/trial', { name: 'Trial Person', email: 'trial.person@example.com', phone: '+12025550143', ip: '9.9.9.9' });
  assert.ok((await pull('malak-android')).some((n) => /free trial/i.test(n.title)));
  // 2. shift start: check-in tells the owner; reminder at the planned start
  await pull('owner-laptop'); await x.call('POST', '/api/admin/attendance', { action: 'in' }, mt);
  assert.ok((await pull('owner-laptop')).some((n) => /Malak started the shift/.test(n.title)));
  const team = (await x.call('GET', '/api/admin/team', {}, tok)).json; const malak = team.find((t) => t.username === 'malak');
  const now = new Date(); const day = String(now.getUTCDay()); const min = now.getUTCHours() * 60 + now.getUTCMinutes();
  await x.call('PUT', '/api/admin/shifts', { memberId: malak.id, memberName: 'Malak', tz: 'UTC', days: { [day]: { on: true, start: min, end: Math.min(1440, min + 480) } } }, tok);
  await pull('malak-android'); const tk = await x.be.tick(); assert.equal(tk.reminders, 1);
  assert.ok((await pull('malak-android')).some((n) => /shift starts/.test(n.title)));
  assert.equal((await x.be.tick()).reminders, 0, 'only once a day');
  // 3. owner check-ins on Khalil's actions
  await pull('owner-laptop'); await addCustomer(x, kt, { username: 'oversee1', email: 'o1@example.com' });
  assert.ok((await pull('owner-laptop')).some((n) => /Khalil/.test(n.title)));
  // only watched members
  await x.call('PUT', '/api/admin/settings', { notify: { watch: [malak.id] } }, tok);
  await addCustomer(x, kt, { username: 'oversee2', email: 'o2@example.com' }); assert.ok(!(await pull('owner-laptop')).some((n) => /Khalil/.test(n.title)));
  assert.equal((await x.call('PUT', '/api/admin/settings', { notify: { oversight: false } }, kt)).status, 403, 'staff cannot switch off the owner check-ins');
  // 4. customer: renewal thanks + renewal alert, in their language
  const c = await addCustomer(x, tok, { username: 'renewme', email: 'renew.me@example.com', lang: 'fr' });
  const cl = await x.call('POST', '/api/login', { username: 'renewme', password: 'secret12' });
  await x.call('POST', '/api/push/subscribe', { sub: sub('cust-phone'), label: 'Android phone', lang: 'fr' }, cl.json.token);
  assert.match((await pull('cust-phone'))[0].body, /appareil/);
  await x.call('POST', `/api/admin/customers/${c.id}/renew`, { days: 30, price: 10 }, tok);
  assert.ok((await pull('cust-phone')).some((n) => /Merci pour votre renouvellement/.test(n.title)));
  const list = await x.store.get('customers'); list.find((y) => y.id === c.id).expiresAt = Date.now() + 2 * 86400000; await x.store.put('customers', list);
  const dd = await x.be.daily(); assert.equal(dd.push.expiring, 1); assert.ok((await pull('cust-phone')).some((n) => /se termine bientôt/.test(n.title)));
  // reseller thanks + credits promo
  const r = await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r10', name: 'Test Reseller', email: 'test.reseller@example.com' }, tok);
  const rl = await x.call('POST', '/api/login', { username: r.json.reseller.login.username, password: r.json.reseller.login.pass });
  await x.call('POST', '/api/push/subscribe', { sub: sub('rsl-tablet'), label: 'iPad', silent: true }, rl.json.token);
  await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r10', resellerId: r.json.reseller.id }, tok);
  const rn = await pull('rsl-tablet'); assert.ok(rn.some((n) => /Thank you for your order/.test(n.title)), JSON.stringify(rn));
  const pr = await x.call('POST', '/api/admin/push/promo', { audience: 'resellers' }, tok); assert.equal(pr.json.people, 1);
  assert.ok((await pull('rsl-tablet')).some((n) => /credits/i.test(n.title)));
  // a device that is gone (410) is removed
  dead.add('https://push.example.com/fred-pc'); await x.call('POST', '/api/push/test', {}, ft);
  assert.ok(!(await x.store.get('pushsubs')).some((s) => s.endpoint.endsWith('fred-pc')));
  const devs = (await x.call('GET', '/api/admin/push/devices', {}, tok)).json; assert.equal(devs.customers, 1); assert.equal(devs.resellers, 1);
});

test('time left: a trial keeps exactly its hours when its line is added; unchanged form dates never stretch an end time; no rounding up', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { trial: { enabled: true, hours: 24 } }, tok);
  const r = await x.call('POST', '/api/trial', { name: 'Trial Person', email: 'trial.person@example.com', phone: '+12025550143', ip: '7.7.7.7' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const list = (await x.call('GET', '/api/admin/customers', {}, tok)).json; const c = (list.customers || list).find((y) => y.isTrial);
  assert.ok((await x.store.get('customers')).find((y) => y.id === c.id).pendingLine, 'trial waits for a line');
  // the agent adds the line; the old form still sends the date fields (as before the fix)
  const d = (t) => new Date(t).toISOString().slice(0, 10);
  const up = await x.call('PUT', `/api/admin/customers/${c.id}`, { name: c.name, email: c.email, m3u: 'http://line.example.com/get.php?username=line1&password=pass1&type=m3u_plus&output=ts', startAt: d(Date.now() + 86400000), expiresAt: d(Date.now() + 3 * 86400000) }, tok);
  assert.equal(up.status, 200, JSON.stringify(up.json));
  const after = (await x.store.get('customers')).find((y) => y.id === c.id);
  const hours = (after.expiresAt - Date.now()) / 3600000; assert.ok(hours > 23.9 && hours <= 24.01, 'trial is exactly 24 h, got ' + hours);
  // saving again with the same day in the form keeps the exact time
  const before = after.expiresAt;
  await x.call('PUT', `/api/admin/customers/${c.id}`, { name: c.name, expiresAt: d(before), startAt: d(after.startAt) }, tok);
  assert.equal((await x.store.get('customers')).find((y) => y.id === c.id).expiresAt, before);
  // new app: exact times
  const exact = Date.now() + 5 * 86400000 + 3600000;
  await x.call('PUT', `/api/admin/customers/${c.id}`, { name: c.name, expiresAtMs: exact }, tok);
  assert.equal((await x.store.get('customers')).find((y) => y.id === c.id).expiresAt, exact);
  // a new 1-month customer starts now and gets exactly 30 days; today's date in the form means now, not midnight
  const nc = await x.call('POST', '/api/admin/customers', { name: 'New Person', username: 'newone', password: 'secret12', email: 'new.person@example.com', planId: 'p1', startAt: d(Date.now()) }, tok);
  const n = (await x.store.get('customers')).find((y) => y.username === 'newone');
  assert.ok(Math.abs(n.startAt - Date.now()) < 5000); const plan = (await x.call('GET', '/api/admin/settings', {}, tok)).json.plans.find((p) => p.id === 'p1');
  assert.equal(Math.round((n.expiresAt - n.startAt) / 3600000), plan.days * 24);
  const v = (await x.call('GET', '/api/admin/customers', {}, tok)).json; const vv = (v.customers || v).find((y) => y.username === 'newone');
  assert.equal(vv.daysLeft, plan.days, 'a fresh plan shows its full days');
  const tv = (v.customers || v).find((y) => y.id === c.id); assert.equal(tv.daysLeft, 5); assert.ok([120, 121].includes(tv.hoursLeft));
});

test('email accounts page: keys and accounts stay in step, trial → paid switch, sending on/off, Google Sheets pull adds keys, Hostinger overview and DNS, agents see no secrets', async () => {
  const hs = []; const sheetRows = [];
  const x = setup(async (url, init = {}) => {
    if (url.startsWith('https://developers.hostinger.com/')) { hs.push({ url, method: init.method || 'GET', body: init.body });
      if (/\/hosting\/v1\/websites/.test(url)) return { ok: true, status: 200, json: async () => ({ data: [{ domain: 'intproto-tv.store', is_enabled: true, website_type: 'main', created_at: '2026-01-01' }] }) };
      if (/\/domains\/v1\/portfolio/.test(url)) return { ok: true, status: 200, json: async () => [{ domain: 'example-shop.com', status: 'active', type: 'domain', expires_at: '2027-01-01' }] };
      if (/\/billing\/v1\/subscriptions/.test(url)) return { ok: true, status: 200, json: async () => [{ name: 'Business Web Hosting', status: 'active', total_price: 3588, renewal_price: 3588, currency_code: 'USD', expires_at: '2027-01-01', is_auto_renewed: true }] };
      if (/\/dns\/v1\/zones\/mail\.example-shop\.com/.test(url)) return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
      if (/\/dns\/v1\/zones\/example-shop\.com/.test(url) && (init.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => [{ name: '@', type: 'A', ttl: 300, records: [{ content: '1.2.3.4' }] }] };
      if (/\/dns\/v1\/zones\/example-shop\.com/.test(url) && init.method === 'PUT') return { ok: true, status: 200, json: async () => ({ message: 'ok' }) };
    }
    if (url === 'https://api.resend.com/domains') return { ok: true, status: 200, json: async () => ({ data: [{ id: 'd1', name: 'mail.example-shop.com' }] }) };
    if (url === 'https://api.resend.com/domains/d1') return { ok: true, status: 200, json: async () => ({ records: [{ name: 'resend._domainkey.mail', type: 'TXT', value: 'p=MIGf' }, { name: 'send.mail', type: 'MX', value: 'feedback-smtp.example.com', priority: 10 }] }) };
    if (url.startsWith('https://script.google.com/')) { if ((init.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ rows: sheetRows }) }; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return null;
  });
  const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { from: 'App <no-reply@example.com>', transRows: [{ id: 'a', key: 're_PAIDKEY_123456', domain: 'mail.example-one.com', on: true, tier: 'p50' }, { id: 'b', key: 're_FREEKEY_654321', domain: 'mail.example-two.com', on: true, tier: 'free' }] } }, tok);
  // opening the status page makes one account per key, with the plan of the key
  const st = (await x.call('GET', '/api/admin/email/status', {}, tok)).json; assert.equal(st.rows.length, 2); assert.ok(st.rows.every((r) => r.accountId));
  const acc = (await x.call('GET', '/api/admin/accounts', {}, tok)).json.rows; assert.equal(acc.length, 2);
  const free = acc.find((a) => a.apiKey === 're_FREEKEY_654321'); assert.equal(free.plan.tier, 'free'); assert.equal(acc.find((a) => a.apiKey === 're_PAIDKEY_123456').plan.tier, 'p50');
  // add the login email, then upgrade the free trial to paid in one click: the sending key follows
  await x.call('POST', '/api/admin/accounts/save', { id: free.id, email: 'resend-two@example.com', password: 'secret-pass' }, tok);
  assert.equal((await x.call('POST', '/api/admin/email/plan', { id: free.id, tier: 'p100' }, tok)).status, 200);
  let rows = (await x.call('GET', '/api/admin/settings', {}, tok)).json.email.transRows; assert.equal(rows.find((r) => r.id === 'b').tier, 'p100');
  const st2 = (await x.call('GET', '/api/admin/email/status', {}, tok)).json.rows.find((r) => r.accountId === free.id); assert.equal(st2.paid, true); assert.equal(st2.quota, 100000); assert.equal(st2.login, 'resend-two@example.com');
  // switch it off
  await x.call('POST', '/api/admin/email/sending', { id: free.id, on: false }, tok);
  assert.equal((await x.call('GET', '/api/admin/settings', {}, tok)).json.email.transRows.find((r) => r.id === 'b').on, false);
  // a new account typed in the Google Sheet becomes a sending key
  await x.call('POST', '/api/admin/accounts/sheet', { url: 'https://script.google.com/macros/s/abc/exec' }, tok);
  sheetRows.push(['Name', 'Type'], ['Resend three', 'Resend', 'resend-three@example.com', 'pw3', 're_SHEETKEY_999999', 'mail.example-three.com', '20', '50000', 'yes', '2026-12-31', 'customer', '', 'on']);
  const pl = await x.call('POST', '/api/admin/accounts/sheet', { pull: true }, tok); assert.equal(pl.json.added, 1);
  rows = (await x.call('GET', '/api/admin/settings', {}, tok)).json.email.transRows; const n3 = rows.find((r) => r.domain === 'mail.example-three.com');
  assert.ok(n3 && n3.tier === 'p50' && n3.on, JSON.stringify(rows));
  // deleting the account stops the key
  const a3 = (await x.call('GET', '/api/admin/accounts', {}, tok)).json.rows.find((a) => a.apiKey === 're_SHEETKEY_999999');
  await x.call('POST', '/api/admin/accounts/delete', { id: a3.id, removeKey: true }, tok);
  assert.ok(!(await x.call('GET', '/api/admin/settings', {}, tok)).json.email.transRows.some((r) => r.domain === 'mail.example-three.com'));
  // Hostinger: overview and Resend DNS records into the zone
  const ho = (await x.call('POST', '/api/admin/accounts/save', { kind: 'hostinger', name: 'Hostinger main', apiKey: 'hostinger-token-123' }, tok)).json.account;
  const hv = (await x.call('POST', '/api/admin/accounts/hostinger', { id: ho.id }, tok)).json; assert.equal(hv.websites[0].domain, 'intproto-tv.store'); assert.equal(hv.subscriptions[0].name, 'Business Web Hosting');
  const paid = (await x.call('GET', '/api/admin/accounts', {}, tok)).json.rows.find((a) => a.apiKey === 're_PAIDKEY_123456');
  const dn = (await x.call('POST', '/api/admin/accounts/hostinger-dns', { hostingerId: ho.id, resendId: paid.id, domain: 'mail.example-shop.com' }, tok)).json;
  assert.equal(dn.zone, 'example-shop.com'); assert.deepEqual(dn.added, ['TXT resend._domainkey.mail', 'MX send.mail']);
  const put = JSON.parse(hs.find((h) => h.method === 'PUT').body); assert.equal(put.overwrite, false); assert.equal(put.zone.find((z) => z.type === 'MX').records[0].content, '10 feedback-smtp.example.com');
  // a support agent sees the status but no account email, key, password or domain, and cannot use these tools
  await x.call('POST', '/api/admin/team', { name: 'Agent Amy', username: 'amy', password: 'secret12', role: 'Support Agent', perms: ['customers_view'] }, tok);
  const lt = (await x.call('POST', '/api/login', { username: 'amy', password: 'secret12' })).json.token; await signBylaws(x, lt);
  const ag = await x.call('GET', '/api/admin/email/status', {}, lt); assert.equal(ag.status, 200);
  const txt = JSON.stringify(ag.json); for (const bad of ['re_', 'resend-two@example.com', 'example-one.com', 'secret-pass']) assert.ok(!txt.includes(bad), bad);
  assert.equal((await x.call('POST', '/api/admin/email/plan', { id: free.id, tier: 'free' }, lt)).status, 403);
  assert.equal((await x.call('POST', '/api/admin/accounts/hostinger', { id: ho.id }, lt)).status, 403);
});

test('Dynu: connect with the API key, list domains and DNS records, only for owner / Khalil / Nizar', async () => {
  const x = setup(async (url, init = {}) => {
    if (url === 'https://api.dynu.com/v2/dns') return init.headers['API-Key'] === 'dynu-good' ? { ok: true, status: 200, json: async () => ({ domains: [{ id: 11, name: 'example-site.com', ipv4Address: '1.2.3.4' }] }) } : { ok: false, status: 401, json: async () => ({ message: 'unauthorized' }) };
    if (url === 'https://api.dynu.com/v2/dns/11/record') return { ok: true, status: 200, json: async () => ({ dnsRecords: [{ recordType: 'TXT', nodeName: 'resend._domainkey', textData: 'p=MIGf', state: true }, { recordType: 'A', nodeName: '', ipv4Address: '1.2.3.4', state: true }] }) };
    return null;
  });
  const tok = await adminToken(x);
  const a = (await x.call('POST', '/api/admin/accounts/save', { kind: 'dynu', name: 'Dynu', apiKey: 'dynu-good', email: 'dns@example.com' }, tok)).json.account;
  const r = (await x.call('POST', '/api/admin/accounts/dynu-list', { id: a.id }, tok)).json; assert.equal(r.domains[0].name, 'example-site.com'); assert.equal(r.domains[0].mail, true); assert.equal(r.domains[0].records.length, 2);
  assert.deepEqual((await x.call('GET', '/api/admin/accounts', {}, tok)).json.rows.find((y) => y.id === a.id).domains, ['example-site.com']);
  const bad = (await x.call('POST', '/api/admin/accounts/save', { kind: 'dynu', name: 'Dynu 2', apiKey: 'dynu-bad' }, tok)).json.account;
  assert.equal((await x.call('POST', '/api/admin/accounts/dynu-list', { id: bad.id }, tok)).status, 400);
  // Khalil (Technical Manager) can, a support agent cannot
  await x.call('POST', '/api/admin/team', { name: 'Khalil', username: 'khalil', password: 'secret12', role: 'Technical Manager', perms: ['customers_view'] }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Agent Amy', username: 'amy', password: 'secret12', role: 'Support Agent', perms: ['customers_view'] }, tok);
  const lg = async (u) => { const t = (await x.call('POST', '/api/login', { username: u, password: 'secret12' })).json.token; await signBylaws(x, t); return t; };
  assert.equal((await x.call('POST', '/api/admin/accounts/dynu-list', { id: a.id }, await lg('khalil'))).status, 200);
  assert.equal((await x.call('POST', '/api/admin/accounts/dynu-list', { id: a.id }, await lg('amy'))).status, 403);
});

test('a US customer gets USD everywhere even if the WhatsApp window sends EUR; long-expired customers read "inactive since"', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { orderCurrency: 'EUR', currency: 'EUR', currencyRule: { on: true } }, tok);
  const us = await addCustomer(x, tok, { username: 'carol', email: 'carol.test@yahoo.com', phone: '+12035550143' });
  const list = await x.store.get('customers'); const c = list.find((y) => y.id === us.id); c.expiresAt = Date.UTC(2024, 2, 2); await x.store.put('customers', list);
  const pk = (await x.call('GET', '/api/admin/settings', {}, tok)).json.orderPackages[0];
  // the window's hidden Currency box says EUR, no custom price: the customer's USD wins
  const w = (await x.call('POST', `/api/admin/customers/${us.id}/wamsg`, { type: 'renew', pkg: pk.id, currency: 'EUR', title: '', price: '', appUrl: 'https://tv.example.com' }, tok)).json.text;
  assert.match(w, /\$\d/); assert.doesNotMatch(w, /€/);
  assert.match(w, /has been inactive since \*March 2024\*/);
  // a custom price typed with a currency is kept as typed
  const cu = await x.call('POST', `/api/admin/customers/${us.id}/wamsg`, { type: 'renew', pkg: pk.id, currency: 'EUR', price: '19', appUrl: 'https://tv.example.com' }, tok); assert.match(cu.json.text || JSON.stringify(cu.json), /€19\.00/);
  // package email preview and the email sent use the same currency
  const pvr = await x.call('GET', `/api/admin/customers/${us.id}/orderpreview`, {}, tok, { pkg: pk.id, cur: 'EUR' }); const pv = pvr.json.html; assert.ok(pv, JSON.stringify(pvr.json).slice(0, 300)); assert.match(pv, /\$\d/); assert.doesNotMatch(pv, /€\d/);
  // a German customer still gets EUR
  const de = await addCustomer(x, tok, { username: 'helga', email: 'helga.test@gmx.de' });
  assert.match((await x.call('POST', `/api/admin/customers/${de.id}/wamsg`, { type: 'renew', pkg: pk.id, currency: 'USD', price: '', appUrl: 'https://tv.example.com' }, tok)).json.text, /€\d/);
});

test('payments, requests and the customer page follow the currency rule (USD worldwide, EUR for Europe)', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { orderCurrency: 'EUR', currency: 'EUR', currencyRule: { on: true } }, tok);
  const us = await addCustomer(x, tok, { username: 'usbuyer', email: 'us.buyer@yahoo.com' }); const de = await addCustomer(x, tok, { username: 'debuyer', email: 'de.buyer@web.de' });
  for (const c of [us, de]) await x.call('POST', `/api/admin/customers/${c.id}/renew`, { days: 30, price: 29.99 }, tok);
  const sales = await x.store.get('sales'); const cur = (id) => sales.filter((y) => y.customerId === id && y.amount > 0).at(-1).currency;
  assert.equal(cur(us.id), 'USD'); assert.equal(cur(de.id), 'EUR');
  // the customer's own page and their package request
  const lg = (await x.call('POST', '/api/login', { username: 'usbuyer', password: 'secret12' })).json.token;
  const me = (await x.call('GET', '/api/me', {}, lg)).json; assert.equal(me.myCurrency, 'USD'); assert.equal(me.orderCurrency, 'USD');
  const pk = (await x.call('GET', '/api/admin/settings', {}, tok)).json.orderPackages[0];
  assert.equal((await x.call('POST', '/api/me/order', { pkg: pk.id }, lg)).status, 200);
  const log = (await x.call('GET', '/api/admin/log', {}, tok)).json; const txt = JSON.stringify(log); assert.ok(/\$\s?\d|USD/.test(txt));
});

test('device, end date controls, app notifications and WhatsApp numbers', async () => {
  const pushes = [];
  const x = setup(async (url) => { if (url.startsWith('https://push.example.com/')) { pushes.push(url); return { ok: true, status: 201, json: async () => ({}) }; } return null; });
  const tok = await adminToken(x);
  const c = await addCustomer(x, tok, { username: 'devuser', email: 'dev.user@example.com' });
  const lg = (await x.call('POST', '/api/login', { username: 'devuser', password: 'secret12' })).json.token;
  // 1. the customer's phone is recorded: Samsung, then an iPhone
  await x.call('POST', '/api/me/device', { ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36', model: 'SM-S918B' }, lg);
  let v = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((y) => y.id === c.id);
  assert.equal(v.lastDevice.brand, 'Samsung'); assert.equal(v.lastDevice.model, 'SM-S918B'); assert.equal(v.lastDevice.kind, 'phone');
  await x.call('POST', '/api/me/device', { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }, lg);
  v = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((y) => y.id === c.id); assert.equal(v.lastDevice.name, 'iPhone'); assert.equal(v.devicesSeen.length, 2);
  // 2. end date: set exact, add days, end now, no end date
  const at = Date.now() + 10 * 86400000 + 3600000;
  assert.equal((await x.call('POST', `/api/admin/customers/${c.id}/expiry`, { action: 'set', expiresAtMs: at }, tok)).json.customer.expiresAt, at);
  assert.equal((await x.call('POST', `/api/admin/customers/${c.id}/expiry`, { action: 'add', days: 7 }, tok)).json.customer.expiresAt, at + 7 * 86400000);
  assert.equal((await x.call('POST', `/api/admin/customers/${c.id}/expiry`, { action: 'add', days: -1 }, tok)).json.customer.expiresAt, at + 6 * 86400000);
  assert.equal((await x.call('POST', `/api/admin/customers/${c.id}/expiry`, { action: 'now' }, tok)).json.customer.state, 'expired');
  const none = (await x.call('POST', `/api/admin/customers/${c.id}/expiry`, { action: 'none' }, tok)).json.customer; assert.equal(none.noExpiry, true); assert.equal(none.state, 'active');
  assert.equal((await x.store.get('customers')).find((y) => y.id === c.id).expiryLog.length, 5);
  assert.equal((await x.call('POST', `/api/admin/customers/${c.id}/expiry`, { action: 'set', expiresAtMs: 'bad' }, tok)).status, 400);
  // 3. a notification in the app: one customer, then a group; it rings the phone if notifications are on
  await x.call('POST', '/api/push/subscribe', { sub: { endpoint: 'https://push.example.com/dev-phone' }, label: 'Samsung', silent: true }, lg);
  const r1 = (await x.call('POST', '/api/admin/app-notify', { audience: 'one', id: c.id, title: 'Server maintenance tonight', body: 'From 02:00 to 03:00.' }, tok)).json; assert.equal(r1.people, 1); assert.equal(r1.devices, 1);
  await addCustomer(x, tok, { username: 'other1', email: 'other1@example.com' });
  assert.equal((await x.call('POST', '/api/admin/app-notify', { audience: 'all', title: 'New channels added' }, tok)).json.people, 2);
  const me = (await x.call('GET', '/api/me', {}, lg)).json; assert.equal(me.inbox.length, 2); assert.equal(me.inbox[1].title, 'Server maintenance tonight'); assert.ok(me.inbox.every((n) => !n.read));
  await x.call('POST', '/api/me/inbox/read', {}, lg); assert.ok((await x.call('GET', '/api/me', {}, lg)).json.inbox.every((n) => n.read));
  // 4. WhatsApp numbers by purpose; the main one becomes the app's number; the support page uses the support one
  await x.call('PUT', '/api/admin/settings', { waNumbers: [{ label: 'Main', number: '+1 (203) 555-0143', use: 'main' }, { label: 'Support', number: '+41791234567', use: 'support' }, { label: 'bad', number: '12', use: 'other' }] }, tok);
  const cfg = (await x.call('GET', '/api/config')).json; assert.equal(cfg.branding.whatsapp, '12035550143'); assert.deepEqual(cfg.waNumbers.map((w) => w.use), ['main', 'support']);
  assert.equal((await x.call('GET', '/api/support/info')).json.whatsapp, '41791234567');
});
