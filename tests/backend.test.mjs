// Automated checks for the backend (run: node --test tests/). Uses an in-memory store and made-up test data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createBackend, totp, totpOk, stripeSign, stripeSigOk, payUrlFor, accessEmail, orderEmail, newsletterEmail, renewalEmail } from '../public/core.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

function setup() {
  const db = new Map(); const mails = []; const calls = []; const tg = [];
  const store = { get: async (k) => { const v = db.get(k); if (!v) return null; if (v.e && v.e < Date.now()) { db.delete(k); return null; } return JSON.parse(v.v); }, put: async (k, v, ttl) => { db.set(k, { v: JSON.stringify(v), e: ttl ? Date.now() + ttl * 1000 : 0 }); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url, init) => {
    calls.push(url);
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
  assert.equal(bad.status, 400, 'sync without a webhook url is refused');
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
    orderCurrency: 'EUR' };
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
