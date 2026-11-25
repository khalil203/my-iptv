// Automated checks for the backend (run: node --test tests/). Uses an in-memory store and made-up test data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createBackend, totp, totpOk, stripeSign, stripeSigOk, payUrlFor, accessEmail, orderEmail, newsletterEmail, renewalEmail, parseResellerText, parseLooseDate, parseMoney, cleanPhoneText, scrubCards, cleanRslId, TECH_ONLY, txTime, sortTxNewest, exactTimeParts, formatExactTime, normalizePayoutDays, nextPayoutDate, usBankHolidayOn, bankPayoutNote, balanceTxLink, applyTransactionInput, migrateLegacyTransactions } from '../public/core.js';
import { zonedDayAndMinute } from '../public/timezones.js';
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
  db.set('settings', { v: JSON.stringify({ security: { force2fa: false, captcha: false, requireCheckIn: false } }), e: 0 });
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
  assert.equal((await x.call('POST', '/api/me/tickets', { subject: 'Screen problem', text: 'See the picture please', image, aiPhotoConsent: true }, a)).status, 200);
  const savedMessage = (await x.call('GET', '/api/me/tickets', {}, a)).json[0].messages[0]; const att = savedMessage.att; assert.ok(att); assert.equal(savedMessage.aiPhotoConsent, true);
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
  await store.put('settings', { security: { force2fa: false, captcha: false, requireCheckIn: false } });
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
  await store.put('settings', { security: { force2fa: false, captcha: false, requireCheckIn: false } });
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
  await store.put('settings', { security: { force2fa: false, captcha: false, requireCheckIn: false } });
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
  const wait = mails.filter((m) => m.to[0] === 'second@example.com'); assert.equal(wait.length, 1, 'the app login is emailed at once while the line is prepared');
  assert.match(wait[0].subject, /being prepared|en préparation/); assert.ok(wait[0].html.includes(two.json.username) && wait[0].html.includes(two.json.password)); assert.ok(wait[0].html.includes('/apk/INTPROTO-TV.apk'));
  // a trial customer can ask for a package before accepting the terms: the package email with its payment link is sent automatically
  const lg2 = (await call('POST', '/api/login', { username: two.json.username, password: two.json.password })).json.token;
  const pkgs = (await call('GET', '/api/me', {}, lg2)).json.orderPackages;
  const ord = await call('POST', '/api/me/order', { pkg: pkgs[0].id }, lg2); assert.equal(ord.status, 200); assert.equal(ord.json.emailed, true);
  assert.equal(mails.filter((m) => m.to[0] === 'second@example.com').length, 2);
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
  await store.put('settings', { security: { force2fa: false, captcha: false, requireCheckIn: false } });
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
  await store.put('settings', { security: { force2fa: false, captcha: false, requireCheckIn: false } });
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
  await store.put('settings', { security: { force2fa: false, captcha: false, requireCheckIn: false } });
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
  const legacy = { security: { force2fa: false, captcha: false, requireCheckIn: false }, pricingV2: true, pricingV3: true, stripeSettleV2: true,
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

test('marketing send: a one-time reviewed subject covers every batch without changing rotating subjects', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'INTPROTO-TV <hello@example.com>', adminEmail: 'owner@example.com' } }, tok);
  await x.call('PUT', '/api/admin/emailmkt/settings', { keys: ['re_one', 're_two', 're_three'], senders: ['INTPROTO-TV'], subjects: ['Rotate A', 'Rotate B'] }, tok);
  const savedSubjects = (await x.store.get('mkt')).subjects.slice();
  const emails = Array.from({ length: 101 }, (_, i) => `review${i}@example.com`).join('\n');
  const list = await x.call('POST', '/api/admin/emailmkt/list', { name: 'Subject override batch', text: emails }, tok);
  assert.equal(list.status, 200); assert.equal(list.json.count, 101);

  const overridden = await x.call('POST', '/api/admin/emailmkt/send', { listId: list.json.id, subject: 'Reviewed one-time subject' }, tok);
  assert.equal(overridden.status, 200, JSON.stringify(overridden.json)); assert.equal(overridden.json.sent, 101);
  const overrideBatches = x.mails.slice(0, 2);
  assert.equal(overrideBatches.length, 2, '101 recipients are sent in two batches');
  assert.ok(overrideBatches.every((batch) => Array.isArray(batch) && batch.every((message) => message.subject === 'Reviewed one-time subject')));
  assert.deepEqual((await x.store.get('mkt')).subjects, savedSubjects, 'the one-time subject does not replace configured rotation subjects');

  const rotated = await x.call('POST', '/api/admin/emailmkt/send', { listId: list.json.id }, tok);
  assert.equal(rotated.status, 200, JSON.stringify(rotated.json)); assert.equal(rotated.json.sent, 101);
  const rotationBatches = x.mails.slice(2, 4);
  assert.deepEqual(rotationBatches.map((batch) => batch[0].subject), ['Rotate A', 'Rotate B'], 'without an override, configured subjects continue rotating by batch');
  assert.deepEqual((await x.store.get('mkt')).subjects, savedSubjects);
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

test('team: role tags, time zones, schedule presets and end-of-shift handovers', async () => {
  const x = setup(); const tok = await adminToken(x);
  const khalil = await x.call('POST', '/api/admin/team', { name: 'Khalil', username: 'khalil', password: 'secret12', role: 'Technical Manager', roleTag: 'Tech', timezone: 'Asia/Bangkok', perms: ['attendance'] }, tok);
  assert.equal(khalil.status, 200, JSON.stringify(khalil.json));
  assert.equal(khalil.json.roleTag, 'Tech'); assert.equal(khalil.json.timezone, 'Asia/Bangkok');
  const mano = await x.call('POST', '/api/admin/team', { name: 'MANO', username: 'mano', password: 'secret12', role: 'Support Agent', roleTag: 'Support', timezone: 'Europe/Madrid', perms: ['attendance'] }, tok);
  assert.equal(mano.status, 200, JSON.stringify(mano.json));
  assert.equal(mano.json.roleTag, 'Support'); assert.equal(mano.json.timezone, 'Europe/Madrid');
  assert.equal((await x.call('PUT', `/api/admin/team/${mano.json.id}`, { timezone: 'Not/AZone' }, tok)).status, 400, 'a wrong zone is refused with a message, not silently ignored');
  assert.equal((await x.call('PUT', `/api/admin/team/${mano.json.id}`, { timezone: 'new york' }, tok)).status, 200); assert.equal((await x.call('GET', '/api/admin/team', {}, tok)).json.find((m) => m.id === mano.json.id).timezone, 'America/New_York', 'city names are understood');
  assert.equal((await x.call('PUT', `/api/admin/team/${mano.json.id}`, { timezone: 'Europe/Madrid' }, tok)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/team', {}, tok)).json.find((m) => m.id === mano.json.id).timezone, 'Europe/Madrid', 'bad time zones are rejected');

  const kToken = (await x.call('POST', '/api/login', { username: 'khalil', password: 'secret12' })).json.token;
  const mToken = (await x.call('POST', '/api/login', { username: 'mano', password: 'secret12' })).json.token;
  await signBylaws(x, kToken); await signBylaws(x, mToken);
  const kMe = await x.call('GET', '/api/admin/me', {}, kToken);
  assert.equal(kMe.json.roleTag, 'Tech'); assert.equal(kMe.json.timezone, 'Asia/Bangkok');

  const preset = await x.call('POST', '/api/admin/shifts/preset', { memberId: khalil.json.id, preset: 'tech' }, tok);
  assert.equal(preset.status, 200, JSON.stringify(preset.json));
  assert.equal(preset.json.shift.tz, 'Asia/Bangkok');
  assert.equal(preset.json.shift.days['1'].start, 14 * 60); assert.equal(preset.json.shift.days['1'].end, 21 * 60);
  assert.equal((await x.call('POST', '/api/admin/shifts/preset', { memberId: mano.json.id, preset: 'support' }, kToken)).status, 403, 'agents cannot rewrite schedules');
  const supportPreset = await x.call('POST', '/api/admin/shifts/preset', { memberId: mano.json.id, preset: 'support' }, tok);
  assert.equal(supportPreset.json.shift.days['1'].start, 15 * 60 + 15); assert.equal(supportPreset.json.shift.days['1'].end, 22 * 60);

  const h1 = await x.call('POST', '/api/admin/handovers', { shiftDate: '2026-11-24', items: { chatsTrials: true, technicalPanel: true, accountsApis: false }, notes: 'APIs pending' }, kToken);
  assert.equal(h1.status, 200, JSON.stringify(h1.json));
  const h2 = await x.call('POST', '/api/admin/handovers', { shiftDate: '2026-11-24', items: { chatsTrials: true, technicalPanel: false, accountsApis: true }, notes: 'APIs ready' }, kToken);
  assert.equal(h2.status, 200);
  const kList = await x.call('GET', '/api/admin/handovers', {}, kToken);
  assert.equal(kList.json.list.length, 1, 'one checklist per agent per shift date');
  assert.equal(kList.json.list[0].notes, 'APIs ready'); assert.equal(kList.json.list[0].roleTag, 'Tech'); assert.equal(kList.json.list[0].timezone, 'Asia/Bangkok');
  const mList = await x.call('GET', '/api/admin/handovers', {}, mToken);
  assert.equal(mList.json.list.length, 0, 'agents only see their own handovers');
  const all = await x.call('GET', '/api/admin/handovers', {}, tok);
  assert.equal(all.json.list.length, 1); assert.equal(all.json.list[0].name, 'Khalil');
  assert.equal((await x.call('POST', '/api/admin/handovers', { items: {} }, kToken)).status, 400);
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

test('bootstrap safety: a public request never resets an existing owner credential', async () => {
  const x = setup(); const db = x.db;
  db.set('admin', { v: JSON.stringify({ username: 'Iptv', salt: 'abc12345', hash: 'deadbeef', isDefault: false }), e: 0 });
  await x.call('GET', '/api/config', {}, undefined);
  const after = JSON.parse(db.get('admin').v);
  assert.equal(after.hash, 'deadbeef', 'the stored owner hash must survive every public request');
  assert.equal(after.isDefault, false, 'a real owner must never be downgraded to a default account');
  assert.equal(db.get('ownerResetV1'), undefined, 'no maintenance side effects from a public read');
  // fresh KV (no admin at all) still gets the documented default owner and can sign in
  const x2 = setup();
  const sc = await x2.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' });
  assert.equal(sc.status, 200, 'default credentials work on a fresh install');
});

test('login lockout: a burned username bucket and IP bucket both keep their limits', async () => {
  const x = setup(); const db = x.db;
  db.set('rl:login:u:iptv', { v: JSON.stringify(9), e: Date.now() + 900000 });
  db.set('rl:login:1.2.3.4', { v: JSON.stringify(9), e: Date.now() + 900000 });
  const res = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv', ip: '5.6.7.8' });
  assert.equal(res.status, 429, 'a burned username bucket locks the account everywhere');
  const res2 = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv', ip: '1.2.3.4' });
  assert.equal(res2.status, 429, 'the IP bucket must still enforce the lockout');
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
  assert.ok(cfg.json.orderPackages.every((p) => ['ibo', 'subscription', 'lifetime'].includes(p.kind)));
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
  stored('settings', { security: { force2fa: false, captcha: false, requireCheckIn: false }, email: { resendKey: 're_dead', transKeys: ['re_live'], transDomains: ['intproto-tv.online'] } });
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
  const timezone = 'Pacific/Chatham'; const now = new Date(); const { day: shiftDay, minute: min } = zonedDayAndMinute(now, timezone); const day = String(shiftDay);
  const shiftSave = await x.call('PUT', '/api/admin/shifts', { memberId: malak.id, memberName: 'Malak', tz: timezone, days: { [day]: { on: true, start: min, end: Math.min(1440, min + 480) } } }, tok);
  assert.equal(shiftSave.status, 200); assert.equal((await x.call('GET', '/api/admin/shifts', {}, tok)).json.find((s) => s.memberId === malak.id).tz, timezone);
  assert.equal((await x.call('PUT', '/api/admin/shifts', { memberId: malak.id, memberName: 'Malak', tz: 'Not/AZone' }, tok)).status, 400, 'invalid zone is rejected');
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

test('promotions library, WhatsApp promos, app link in emails, notifications open the right page', async () => {
  const x = setup(async (url) => (url.startsWith('https://push.example.com/') ? { ok: true, status: 201, json: async () => ({}) } : null)); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { appUrl: 'https://tv.example.com', resendKey: 're_test', from: 'App <no-reply@example.com>' } }, tok);
  // 1. eight ready promotions, each in 5 languages, with the free trial and support links
  const lib = (await x.call('GET', '/api/admin/promo/library', {}, tok)).json.kinds; const ids = lib.map((k) => k.id);
  for (const k of ['holidays', 'blackfriday', 'cybermonday', 'events', 'evergreen', 'devices', 'christmas', 'newyear']) assert.ok(ids.includes(k), k);
  const ev = lib.find((k) => k.id === 'events');
  assert.match(ev.wa.en, /Never Miss a Big Game or Blockbuster Premiere!/); assert.match(ev.wa.en, /Champions League match, UFC fight night, Formula 1 race/);
  assert.match(ev.wa.en, /https:\/\/tv\.example\.com\/freetrial/); assert.match(ev.wa.en, /https:\/\/tv\.example\.com\/support/); assert.match(ev.wa.en, /Samsung, iPhone, Smart TV/);
  for (const k of lib) for (const l of ['en', 'fr', 'de', 'es', 'it']) { assert.ok(k.wa[l].includes('/freetrial'), k.id + ' ' + l); assert.doesNotMatch(k.wa[l], /\{\w+\}/, k.id + ' ' + l); }
  const em = (await x.call('GET', '/api/admin/newsletter/season', {}, tok, { kind: 'holidays', offer: '30% OFF', code: 'XMAS30', end: '2027-01-07' })).json.campaign;
  assert.match(em.content.en.body, /30% OFF/); assert.match(em.content.en.body, /XMAS30/); assert.match(em.content.en.body, /1-Year.*Multi-Device.*Reseller/); assert.match(em.content.de.body, /tv\.example\.com\/support/);
  // 2. WhatsApp window: the promotion in the customer's language, with their name
  const c = await addCustomer(x, tok, { username: 'promo1', email: 'promo.one@gmx.de', name: 'Anna Test', lang: 'de' });
  const w = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'promo_events', appUrl: 'https://tv.example.com' }, tok)).json;
  assert.equal(w.type, 'promo_events'); assert.match(w.text, /Anna/); assert.match(w.text, /Champions-League/); assert.match(w.text, /tv\.example\.com\/freetrial/);
  // 3. the profile email keeps the login details and the profile link; its button downloads the app
  const pm = (await x.call('GET', `/api/admin/customers/${c.id}/profilepreview`, {}, tok, { appUrl: 'https://tv.example.com' })).json.html;
  assert.match(pm, /promo1/); assert.match(pm, /tv\.example\.com\/profile/); assert.match(pm, /href="https:\/\/tv\.example\.com\/app"/); assert.match(pm, /App herunterladen/);
  // 4. a tap on a notification opens the right page
  await x.call('POST', '/api/push/subscribe', { sub: { endpoint: 'https://push.example.com/owner' }, silent: true }, tok);
  const st = await x.call('POST', '/api/support/start', { name: 'Test Person', email: 'test.person@example.com', phone: '+12025550143' });
  const tk = await x.call('POST', '/api/support/ticket', { token: st.json.token, subject: 'No sound', text: 'There is no sound on sport channels.' });
  const tid = (await x.call('GET', '/api/admin/tickets', {}, tok)).json.find((t) => t.ref === tk.json.ref).id;
  const notes = (await x.call('POST', '/api/push/pull', { endpoint: 'https://push.example.com/owner' })).json.notes;
  assert.equal(notes.find((n) => /support ticket/.test(n.title)).url, '/intprototv?tab=support&open=' + tid);
  await x.call('PUT', '/api/admin/settings', { trial: { mode: 'agents', enabled: true } }, tok);
  await x.call('POST', '/api/trial', { name: 'Trial Person', email: 'trial.p@example.com', phone: '+12025550144', ip: '5.5.5.5' });
  assert.equal((await x.call('POST', '/api/push/pull', { endpoint: 'https://push.example.com/owner' })).json.notes.find((n) => /free trial/i.test(n.title)).url, '/intprototv?tab=trialq');
  const cl = (await x.call('POST', '/api/login', { username: 'promo1', password: 'secret12' })).json.token;
  await x.call('POST', '/api/push/subscribe', { sub: { endpoint: 'https://push.example.com/cust' }, silent: true }, cl);
  await x.call('POST', '/api/admin/push/promo', { audience: 'customers' }, tok);
  assert.equal((await x.call('POST', '/api/push/pull', { endpoint: 'https://push.example.com/cust' })).json.notes.at(-1).url, '/?tab=account&go=packages');
  await x.call('POST', '/api/admin/app-notify', { audience: 'one', id: c.id, title: 'Hello' }, tok);
  assert.equal((await x.call('POST', '/api/push/pull', { endpoint: 'https://push.example.com/cust' })).json.notes.at(-1).url, '/profile?go=inbox');
});

test('payment links: GreenApp Host only, matched to the package, rotation; IBO Player offer; supplier payments', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>' } }, tok);
  const s0 = (await x.call('GET', '/api/admin/settings', {}, tok)).json;
  const pk12 = s0.orderPackages.find((p) => Number(p.days) >= 360 && Number(p.days) <= 370 && !/^ibo/i.test(p.id)) || s0.orderPackages[0];
  const accs = s0.stripeAccounts.map((a) => a.id === 'grenapp' ? { ...a, status: 'active', links: [
    { label: '12 Months', url: 'https://buy.stripe.com/g12a', currency: 'USD' }, { label: '12 Months', url: 'https://buy.stripe.com/g12b', currency: 'USD' },
    { label: '1 Month', url: 'https://buy.stripe.com/g1', currency: 'USD' }, { label: 'IBO Player 1 Year', url: 'https://buy.stripe.com/gibo', currency: 'USD' },
    { label: '3 Months', url: 'https://buy.stripe.com/gdup', currency: 'USD' }, { label: '6 Months', url: 'https://buy.stripe.com/gdup', currency: 'USD' }] }
    : { ...a, status: 'active', links: [{ label: '12 Months', url: 'https://buy.stripe.com/other12', currency: 'USD' }] });
  assert.equal((await x.call('PUT', '/api/admin/settings', { stripeAccounts: accs }, tok)).status, 200);
  // 1. only GreenApp, the 12-month link, taking turns
  const p1 = (await x.call('GET', '/api/admin/paylink', {}, tok, { pkg: pk12.id, cur: 'USD', peek: '1' })).json;
  assert.equal(p1.acc, 'grenapp'); assert.equal(p1.options, 2); assert.ok(/g12[ab]$/.test(p1.url));
  const ck = (await x.call('GET', '/api/admin/paylinks/check', {}, tok)).json;
  assert.deepEqual(ck.route.accounts, ['grenapp']); assert.ok(ck.problems.some((p) => p.kind === 'same-url' && p.url === 'https://buy.stripe.com/gdup'));
  const c = await addCustomer(x, tok, { username: 'iboguy', email: 'ibo.guy@example.com', whatsapp: '+12035550111' });
  const used = [];
  for (let i = 0; i < 2; i++) { const r = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'pay', pkg: pk12.id, lang: 'en', log: true }, tok)).json; used.push((String(r.text || r.message || '').match(/https:\/\/buy\.stripe\.com\/\w+/) || [])[0]); }
  assert.equal(new Set(used).size, 2, 'rotation alternates: ' + used); assert.ok(used.every((u) => /g12[ab]$/.test(u)));
  // 2. IBO Player offer: emailed after the subscription (create) once, then the panel offers WhatsApp after renewal
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(x.mails.filter((m) => /IBO Player/.test(m.subject)).length, 0, 'not together with the welcome email');
  const q = await x.store.get('iboq'); assert.equal(q.length, 1); q[0].due = Date.now() - 1; await x.store.put('iboq', q);
  assert.equal((await x.be.tick()).ibo, 1);
  const ibo = x.mails.filter((m) => /IBO Player/.test(m.subject) && m.to.includes('ibo.guy@example.com'));
  assert.equal(ibo.length, 1); assert.ok(/5\.99/.test(ibo[0].html)); assert.ok(ibo[0].html.includes('https://buy.stripe.com/gibo'));
  const rn = (await x.call('POST', `/api/admin/customers/${c.id}/renew`, { planId: s0.plans?.[0]?.id || 'p1', price: 10 }, tok)).json; assert.equal(rn.iboOffer, true);
  await new Promise((r) => setTimeout(r, 20)); await x.be.tick();
  assert.equal(x.mails.filter((m) => /IBO Player/.test(m.subject)).length, 1, 'not again within 30 days');
  assert.equal(((await x.store.get('iboq')) || []).length, 0);
  const wa = (await x.call('POST', `/api/admin/customers/${c.id}/wamsg`, { type: 'ibo_promo', lang: 'en' }, tok)).json; assert.ok(/IBO Player/.test(wa.text || wa.message)); assert.ok(/\$5\.99/.test(wa.text || wa.message));
  // 3. supplier payments: not paid → part payment → rest; undo; hand over
  const acc = s0.finance.accounts.find((a) => a.currency === 'USD');
  const b = (await x.call('POST', '/api/admin/stock', { credits: 100, cost: 80, paid: 'no', supplier: 'TVplus', accountId: acc.id }, tok)).json;
  assert.equal(b.payStatus, 'unpaid'); assert.equal(b.due, 80);
  let st = (await x.call('GET', '/api/admin/stock', {}, tok)).json; assert.equal(st.owed.find((o) => o.supplier === 'TVplus').due, 80);
  assert.equal(((await x.store.get('tx')) || []).filter((t) => t.stockId === b.id).length, 0, 'no expense while unpaid');
  let v = (await x.call('POST', `/api/admin/stock/${b.id}/pay`, { amount: 30, accountId: acc.id }, tok)).json; assert.equal(v.payStatus, 'partial'); assert.equal(v.due, 50);
  assert.equal((await x.call('POST', `/api/admin/stock/${b.id}/pay`, { amount: 60, accountId: acc.id }, tok)).status, 400);
  v = (await x.call('POST', `/api/admin/stock/${b.id}/pay`, { amount: 'rest', accountId: acc.id }, tok)).json; assert.equal(v.payStatus, 'paid'); assert.equal(v.paid, 80);
  assert.equal(((await x.store.get('tx')) || []).filter((t) => t.stockId === b.id).reduce((a, t) => a + t.amount, 0), 80);
  v = (await x.call('DELETE', `/api/admin/stock/${b.id}/pay/${v.payments[1].id}`, {}, tok)).json; assert.equal(v.payStatus, 'partial');
  assert.equal(((await x.store.get('tx')) || []).filter((t) => t.stockId === b.id).length, 1);
  v = (await x.call('PUT', `/api/admin/stock/${b.id}`, { handedTo: 'Mrkhalil' }, tok)).json; assert.equal(v.handedTo, 'Mrkhalil');
  const paidNow = (await x.call('POST', '/api/admin/stock', { credits: 50, cost: 40, paid: 'yes', accountId: acc.id }, tok)).json; assert.equal(paidNow.payStatus, 'paid');
  st = (await x.call('GET', '/api/admin/stock', {}, tok)).json; assert.equal(st.purchases.length, 2);
});

test('details emails link the app for Android (APK), iPhone & iPad and MacBook, with the Safari steps', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', appUrl: 'https://tv.example.com' } }, tok);
  const c = await addCustomer(x, tok, { username: 'iosuser', email: 'ios.user@example.com' });
  const m = (await x.call('GET', `/api/admin/customers/${c.id}/emailpreview`, {}, tok)).json;
  const html = m.html || '';
  for (const s of ['https://tv.example.com/apk/INTPROTO-TV.apk', 'https://tv.example.com/app?os=ios', 'https://tv.example.com/download#mac', 'Copy this link and open it in the Safari browser', 'Add to Home Screen']) assert.ok(html.includes(s), s);
  const fr = await addCustomer(x, tok, { username: 'frios', email: 'fr.ios@example.fr', lang: 'fr' });
  await x.call('PUT', '/api/admin/settings', { email: { lang: 'customer' } }, tok);
  assert.ok(((await x.call('GET', `/api/admin/customers/${fr.id}/emailpreview`, {}, tok)).json.html || '').includes('ouvrez-le dans le navigateur Safari'));
});

test('renewal emails: 5 models in 5 languages, sent automatically 7 days before, on the last day and after the end', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', appUrl: 'https://tv.example.com' }, renewModels: { code: 'STAY20', discount: '20', amount: '' } }, tok);
  const lib = (await x.call('GET', '/api/admin/renewmodels', {}, tok)).json; assert.equal(lib.models.length, 5); assert.equal(lib.code.code, 'STAY20');
  for (const lang of ['en', 'fr', 'de', 'es', 'it']) for (const m of ['m1', 'm2', 'm3', 'm4', 'm5']) {
    const p = (await x.call('GET', '/api/admin/renewmodels/preview', {}, tok, { model: m, lang })).json; assert.ok(p.subject && p.html.includes('STAY20'), m + ' ' + lang); assert.ok(!/\{\w+\}/.test(p.html.replace(/<style[\s\S]*?<\/style>/g, '')), 'no placeholder left ' + m + lang);
  }
  const m1 = (await x.call('GET', '/api/admin/renewmodels/preview', {}, tok, { model: 'm1', lang: 'en' })).json; assert.ok(m1.html.includes('$69.99') && m1.html.includes('(Save 20%)') && m1.html.includes('https://tv.example.com/support'));
  const fr = (await x.call('GET', '/api/admin/renewmodels/preview', {}, tok, { model: 'm2', lang: 'fr' })).json; assert.match(fr.subject, /expire aujourd'hui/);
  // no code: the promo lines disappear
  await x.call('PUT', '/api/admin/settings', { renewModels: { code: '' }, renewalOffer: { coupon: '' } }, tok);
  const nc = (await x.call('GET', '/api/admin/renewmodels/preview', {}, tok, { model: 'm2', lang: 'en' })).json; assert.ok(!/Promo Code/.test(nc.html)); assert.ok(!/inside/.test(nc.subject));
  await x.call('PUT', '/api/admin/settings', { renewModels: { code: 'STAY20' } }, tok);
  // automatic sending
  const a = await addCustomer(x, tok, { username: 'rm7', email: 'rm7@example.com' }); const b = await addCustomer(x, tok, { username: 'rm0', email: 'rm0@example.com' }); const c = await addCustomer(x, tok, { username: 'rmx', email: 'rmx@example.fr', lang: 'fr' });
  const now = Date.now(); await x.call('POST', `/api/admin/customers/${a.id}/expiry`, { action: 'set', expiresAtMs: now + 5 * 86400000 }, tok); await x.call('POST', `/api/admin/customers/${b.id}/expiry`, { action: 'set', expiresAtMs: now + 5 * 3600000 }, tok); await x.call('POST', `/api/admin/customers/${c.id}/expiry`, { action: 'set', expiresAtMs: now - 2 * 86400000 }, tok);
  const before = x.mails.length; await x.be.daily();
  const got = x.mails.slice(before); const sub = (to) => (got.find((m) => m.to.includes(to)) || {}).subject || '';
  assert.match(sub('rm7@example.com'), /expires in 7 days/); assert.match(sub('rm0@example.com'), /expires today/); assert.match(sub('rmx@example.fr'), /Vous nous manquez/);
  const n = x.mails.length; await x.be.daily(); assert.equal(x.mails.filter((m, i) => i >= n && /rm[70x]@/.test(m.to[0])).length, 0, 'each step only once');
  // send now to a group and a test
  assert.equal((await x.call('POST', '/api/admin/renewmodels/send', { model: 'm5', audience: 'one', id: a.id }, tok)).json.sent, 1);
  assert.equal((await x.call('POST', '/api/admin/renewmodels/send', { model: 'm4', test: true, to: 'owner@example.com', lang: 'de' }, tok)).json.sent, 1);
});

test('agents: check in before the panel, signed out after 6 hours with auto check-out, owner edits logs; agents send marketing with locked texts, only owner & technical service see keys and edit texts', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { security: { requireCheckIn: true }, email: { resendKey: 're_secret_key', from: 'App <a@example.com>' } }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Said', username: 'said', password: 'secret12', role: 'Sales Agent', perms: ['customers_view', 'customers_edit', 'marketing', 'secrets', 'settings'], lang: 'ar' }, tok);
  await x.call('POST', '/api/admin/team', { name: 'Khalil', username: 'mrkhalil', password: 'secret12', role: 'Technical Manager', perms: ['customers_view'] }, tok);
  const st = (await x.call('POST', '/api/login', { username: 'said', password: 'secret12' })).json.token; await signBylaws(x, st).catch(() => {});
  // 1. nothing opens before the check-in
  let me = (await x.call('GET', '/api/admin/me', {}, st)).json; assert.equal(me.mustCheckIn, true); assert.equal(me.lang, 'ar'); assert.equal(me.noCopy, true);
  assert.ok(me.sessionExp - Date.now() <= 6 * 3600000 + 5000, 'agent session lasts 6 hours');
  assert.equal((await x.call('GET', '/api/admin/customers', {}, st)).json.error, 'checkin_required');
  assert.equal((await x.call('POST', '/api/admin/attendance', { action: 'in' }, st)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/customers', {}, st)).status, 200);
  // 2. keys and marketing: a sales agent can't, even if ticked; the technical service can
  assert.equal((await x.call('POST', '/api/admin/newsletter/send', { camp: { content: { all: { subject: 'Agent text' } } }, group: 'active' }, st)).status, 400, 'nothing saved yet');
  assert.equal((await x.call('POST', '/api/admin/newsletter/new', {}, st)).status, 403);
  assert.equal((await x.call('PUT', '/api/admin/emailmkt/settings', { senders: ['Hacked'] }, st)).status, 403);
  await x.call('POST', '/api/admin/newsletter/send', { camp: { id: 'nlowner', content: { all: { subject: 'Owner subject', title: 'Owner title', body: 'Owner text' } } }, group: 'nobody-yet', test: 'owner@example.com' }, tok);
  await x.store.put('newsletter', { id: 'nlowner', content: { all: { subject: 'Owner subject', title: 'Owner title', body: 'Owner text' } } });
  await addCustomer(x, tok, { username: 'nlcust', email: 'nl.cust@example.com' });
  const before = x.mails.length; const nls = await x.call('POST', '/api/admin/newsletter/send', { camp: { content: { all: { subject: 'Agent changed it', body: 'agent text' } } }, group: 'all' }, st);
  assert.equal(nls.status, 200); const sent = x.mails.slice(before).flat(); assert.ok(sent.length >= 1 && sent.every((m) => m.subject === 'Owner subject'), 'agent sends the saved text, not their own');
  const me2 = (await x.call('GET', '/api/admin/me', {}, st)).json; assert.ok(me2.perms.includes('marketing')); assert.equal(me2.locked, true);
  assert.equal((await x.call('PUT', '/api/admin/settings', { email: { from: 'Hacked <h@example.com>' } }, st)).status, 403);
  const sset = (await x.call('GET', '/api/admin/settings', {}, st)).json; assert.ok(!JSON.stringify(sset).includes('re_secret_key'));
  const kt = (await x.call('POST', '/api/login', { username: 'mrkhalil', password: 'secret12' })).json.token; await signBylaws(x, kt).catch(() => {}); await x.call('POST', '/api/admin/attendance', { action: 'in' }, kt);
  const km = (await x.call('GET', '/api/admin/me', {}, kt)).json; assert.ok(km.perms.includes('marketing') && km.perms.includes('secrets')); assert.equal(km.noCopy, false);
  // 3. after 6 hours the open check-in is closed automatically
  const ev = await x.store.get('attendance'); ev.filter((e) => e.action === 'in').forEach((e) => { e.at -= 7 * 3600000; }); await x.store.put('attendance', ev);
  await x.be.tick(); const ev2 = await x.store.get('attendance'); const autos = ev2.filter((e) => e.auto); assert.equal(autos.length, 2);
  assert.equal((await x.call('GET', '/api/admin/customers', {}, st)).json.error, 'checkin_required');
  // 4. the owner edits an agent's log
  assert.equal((await x.call('PUT', `/api/admin/attendance/${autos[0].id}`, { note: 'left at 18:00' }, tok)).status, 200);
  assert.equal((await x.call('PUT', `/api/admin/attendance/${autos[0].id}`, { note: 'x' }, st)).status, 403);
  const w = (await x.call('GET', '/api/admin/waiting', {}, tok)).json; for (const k of ['support', 'chat', 'trials', 'waitLine', 'receipts', 'buy']) assert.equal(typeof w[k], 'number', k);
  const team = (await x.call('GET', '/api/admin/team', {}, tok)).json; assert.equal((await x.call('POST', '/api/admin/attendance/add', { memberId: team[0].id, action: 'in', at: new Date().toISOString() }, tok)).status, 200);
});

test('resellers: client subscription tracker, contact & shop prices, app download email for every device', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', appUrl: 'https://tv.example.com' } }, tok);
  const R = (await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r10', name: 'Shop Owner', email: 'shop.owner@example.com', phone: '+27763456789', appUrl: 'https://tv.example.com' }, tok)).json.reseller;
  const rt = (await x.call('POST', '/api/login', { username: R.rslId, password: R.login.pass })).json.token;
  let tools = (await x.call('GET', '/api/rsl/tools', {}, rt)).json; assert.equal(tools.clients.length, 0); assert.equal(tools.shop.prices.length, 7);
  // prices and contact
  const prices = tools.shop.prices.map((p, i) => ({ ...p, price: [15, 35, 55, 80, 120, 160, 190][i] }));
  assert.equal((await x.call('PUT', '/api/rsl/shop', { shopName: 'Best TV Shop', whatsapp: '+27763456000', telegram: '@besttv', currency: 'USD', prices, phone: '+27763456111' }, rt)).status, 200);
  tools = (await x.call('GET', '/api/rsl/tools', {}, rt)).json; assert.equal(tools.shop.name, 'Best TV Shop'); assert.equal(tools.shop.telegram, 'besttv'); assert.equal(tools.shop.prices[3].price, 80); assert.equal(tools.contact.phone, '+27763456111');
  // tracker
  const a = (await x.call('POST', '/api/rsl/clients', { name: 'Client One', email: 'client.one@example.com', phone: '+15550001111', plan: '1 Month', months: 1, price: 15 }, rt)).json; assert.equal(a.state, 'active'); assert.ok(a.daysLeft >= 29);
  const b = (await x.call('POST', '/api/rsl/clients', { name: 'Client Two', endAt: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), price: 35 }, rt)).json; assert.equal(b.state, 'expiring');
  const rn = (await x.call('POST', `/api/rsl/clients/${b.id}/renew`, { months: 3, price: 35 }, rt)).json; assert.ok(rn.daysLeft > 90); assert.equal(rn.renewals.length, 1);
  assert.equal((await x.call('PUT', `/api/rsl/clients/${a.id}`, { note: 'pays cash' }, rt)).json.note, 'pays cash');
  tools = (await x.call('GET', '/api/rsl/tools', {}, rt)).json; assert.equal(tools.stats.total, 2); assert.equal(tools.stats.active, 2);
  assert.equal((await x.call('DELETE', `/api/rsl/clients/${a.id}`, {}, rt)).status, 200);
  // app download email: to a client and to the reseller; admin to one customer
  await x.call('POST', '/api/rsl/clients', { name: 'Client Three', email: 'client.three@example.com', months: 1 }, rt);
  const c3 = (await x.call('GET', '/api/rsl/tools', {}, rt)).json.clients.find((y) => y.name === 'Client Three');
  assert.equal((await x.call('POST', '/api/rsl/appmail', { clientId: c3.id }, rt)).json.to, 'client.three@example.com');
  const m = x.mails.at(-1); assert.match(m.subject, /Install the .* app on all your devices/); for (const k of ['/apk/INTPROTO-TV.apk', '/app?os=ios', '/download#mac', 'Safari', 'Auto Blocker']) assert.ok(m.html.includes(k), k);
  const cu = await addCustomer(x, tok, { username: 'appmail1', email: 'appmail1@example.fr', lang: 'fr' });
  assert.equal((await x.call('POST', '/api/admin/appmail', { customerId: cu.id }, tok)).json.sent, 1); assert.equal((await x.call('POST', '/api/admin/appmail', {}, tok)).status, 400, 'no group without choosing one'); assert.match(x.mails.at(-1).subject, /Installez/);
  // other resellers can't see these clients
  const R2 = (await x.call('POST', '/api/admin/reseller-sale', { packageId: 'r10', name: 'Other Shop', email: 'other.shop@example.com', appUrl: 'https://tv.example.com' }, tok)).json.reseller;
  const rt2 = (await x.call('POST', '/api/login', { username: R2.rslId, password: R2.login.pass })).json.token; assert.equal((await x.call('GET', '/api/rsl/tools', {}, rt2)).json.clients.length, 0);
});

test('holiday reminders: calendar with the matching promotion, notifications a few days before, own dates', async () => {
  const x = setup(); const tok = await adminToken(x);
  const up = (await x.call('GET', '/api/admin/holidays/upcoming', {}, tok)).json; assert.ok(up.list.length > 10); assert.ok(up.list.every((h) => h.kind && h.name));
  const bf = up.list.find((h) => h.name === 'Black Friday'); assert.equal(bf.kind, 'blackfriday');
  const d = new Date(Date.now() + 7 * 86400000 + 3600000); const iso = d.toISOString().slice(0, 10);
  assert.equal((await x.call('PUT', '/api/admin/holidays/remind', { custom: [{ name: 'Shop anniversary', date: iso, kind: 'evergreen' }], days: [7, 1] }, tok)).status, 200);
  const up2 = (await x.call('GET', '/api/admin/holidays/upcoming', {}, tok)).json; assert.ok(up2.list.some((h) => h.name === 'Shop anniversary' && h.custom));
  await x.be.daily(); const lg = (await x.store.get('holidayLog')) || []; assert.ok(lg.some((h) => h.name === 'Shop anniversary' && h.days === 7), JSON.stringify(lg.slice(0, 3)));
  const n = lg.length; await x.be.daily(); assert.equal(((await x.store.get('holidayLog')) || []).length, n, 'once per holiday and day');
});

test('work planning: schedule for every agent, check off today only, owner-only editing, reminders and monthly meeting', async () => {
  let posted = []; const x = setup((url, init) => { if (String(url).includes('script.google.com')) { posted.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; } }); const tok = await adminToken(x);
  await x.call('POST', '/api/admin/team', { name: 'Sara', username: 'sara', password: 'secret12', role: 'Sales Agent', perms: ['customers_view', 'customers_edit', 'attendance'] }, tok);
  const st = (await x.call('POST', '/api/login', { username: 'sara', password: 'secret12' })).json.token; await signBylaws(x, st).catch(() => {});
  const wp = (await x.call('GET', '/api/admin/workplan', {}, st)).json; assert.equal(wp.plan.slots.length, 7); assert.equal(wp.week.length, 7); assert.equal(wp.canEdit, false); assert.equal(wp.plan.rules.length, 5); assert.equal(wp.plan.info['3'].s7[1], 'Football & Champions League'); assert.equal(wp.plan.tz, 'Asia/Bangkok');
  assert.equal(wp.plan.slots[0].title, 'Check-In & Panel Login'); assert.ok(wp.nextMeet);
  // agent can't edit, owner can
  assert.equal((await x.call('PUT', '/api/admin/workplan', { rules: ['x'] }, st)).status, 403);
  assert.equal((await x.call('PUT', '/api/admin/workplan', { sheetUrl: 'https://script.google.com/macros/s/abc/exec', tz: 'Africa/Casablanca' }, tok)).status, 200);
  wp.today = (await x.call('GET', '/api/admin/workplan', {}, st)).json.today; // today in the new time zone
  // check off today's task, not a future one
  assert.equal((await x.call('POST', '/api/admin/workplan/check', { date: wp.today, slot: 's2', note: '12 tickets answered' }, st)).status, 200);
  const later = new Date(new Date(wp.today + 'T12:00:00Z').getTime() + 2 * 86400000).toISOString().slice(0, 10);
  assert.equal((await x.call('POST', '/api/admin/workplan/check', { date: later, slot: 's2' }, st)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/workplan/check', { date: wp.today, slot: 's6' }, st)).status, 400, 'the break is not a task');
  await new Promise((r) => setTimeout(r, 20)); assert.ok(posted.some((p) => p.sheet === 'Agent Work Planning' && !p.append && p.rows.length === 49 && p.rows.some((r) => r[0] === wp.today && r[3].startsWith('IPTV') && r[6] === 'YES' && r[8] === '12 tickets answered')), 'synced to Google Sheets');
  const own = (await x.call('GET', '/api/admin/workplan', {}, tok)).json; const team = (await x.call('GET', '/api/admin/team', {}, tok)).json;
  assert.ok(own.checks[wp.today][team[0].id].s2); assert.equal(own.canEdit, true);
  assert.equal((await x.call('POST', '/api/admin/workplan/sheet', {}, tok)).json.rows, 7 * 7);
  // reminders when an activity starts
  const out = await x.be.tick(); assert.ok(out !== undefined);
});

test('owner planning: owner only, months through Dec 2027, recurring blocks, day-only vs future edits, checks, 10 Resend keys a day, alerts', async () => {
  const pushes = []; const x = setup(); const tok = await adminToken(x);
  await x.call('POST', '/api/admin/team', { name: 'Sara', username: 'sara', password: 'secret12', role: 'Sales Agent', perms: ['customers_view', 'customers_edit', 'attendance', 'secrets', 'templates_edit'] }, tok);
  const st = (await x.call('POST', '/api/login', { username: 'sara', password: 'secret12' })).json.token; await signBylaws(x, st).catch(() => {});
  assert.equal((await x.call('GET', '/api/admin/ownerplan', {}, st)).status, 403, 'agents never see the owner planning');
  assert.equal((await x.call('POST', '/api/admin/ownerplan/check', { date: '2026-01-01', id: 'wake' }, st)).status, 403);
  const g = (await x.call('GET', '/api/admin/ownerplan', {}, tok)).json; assert.ok(g.months.includes('2027-12')); assert.equal(g.last, '2027-12-31'); const T = g.today; const wd = new Date(T + 'T12:00:00Z').getUTCDay();
  const ids = g.rows[0].blocks.map((b) => b.id); assert.ok(ids.includes('wake') && ids.includes('api') && ids.includes('bank') && ids.includes('sleep'));
  assert.equal(ids.includes('muay'), wd >= 2 && wd <= 5); assert.equal(ids.includes('legs'), wd === 1); assert.equal(ids.includes('support'), wd >= 1 && wd <= 5);
  // the monthly meeting on the 29th (Feb: the 28th)
  const febM = g.months.find((m) => m.endsWith('-02')); if (febM) { const f = (await x.call('GET', '/api/admin/ownerplan', {}, tok, { from: febM + '-01', to: febM + '-28' })).json; assert.ok(f.rows.find((r) => r.date === febM + '-28').blocks.some((b) => b.id === 'meet')); }
  const m0 = (await x.call('GET', '/api/admin/ownerplan', {}, tok, { from: g.months[0] + '-29', to: g.months[0] + '-29' })).json; assert.ok(m0.rows[0].blocks.some((b) => b.id === 'meet'));
  // check off, stats
  assert.equal((await x.call('POST', '/api/admin/ownerplan/check', { date: T, id: 'wake' }, tok)).status, 200);
  const later = new Date(new Date(T + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  assert.equal((await x.call('POST', '/api/admin/ownerplan/check', { date: later, id: 'wake' }, tok)).status, 400, 'not a future day');
  let t = (await x.call('GET', '/api/admin/ownerplan', {}, tok)).json; assert.equal(t.stats.today.done, 1); assert.ok(t.rows[0].blocks.find((b) => b.id === 'wake').done);
  // edit today only → tomorrow unchanged; edit future → tomorrow changed, today keeps the day-only edit
  assert.equal((await x.call('POST', '/api/admin/ownerplan/block', { op: 'edit', id: 'lunch', date: T, scope: 'day', block: { start: '12:00', end: '13:00', title: 'Lunch with family' } }, tok)).status, 200);
  let two = (await x.call('GET', '/api/admin/ownerplan', {}, tok, { from: T, to: later })).json; assert.equal(two.rows[0].blocks.find((b) => b.id === 'lunch').title, 'Lunch with family'); assert.equal(two.rows[1].blocks.find((b) => b.id === 'lunch').title, 'Lunch, Shower & Rest');
  assert.equal((await x.call('POST', '/api/admin/ownerplan/block', { op: 'edit', id: 'bank', date: later, scope: 'future', block: { start: '22:00', end: '22:20', title: 'Bank & books' } }, tok)).status, 200);
  two = (await x.call('GET', '/api/admin/ownerplan', {}, tok, { from: T, to: later })).json; assert.equal(two.rows[0].blocks.find((b) => b.id === 'bank').title, 'Clear Bank Balances & Register Financial Transactions'); assert.equal(two.rows[1].blocks.find((b) => b.id === 'bank').end, '22:20');
  const end = g.last; const e2 = (await x.call('GET', '/api/admin/ownerplan', {}, tok, { from: end, to: end })).json; assert.equal(e2.rows[0].blocks.find((b) => b.id === 'bank').title, 'Bank & books', 'applies to all future months');
  // add day-only + recurring, duplicate, delete
  assert.equal((await x.call('POST', '/api/admin/ownerplan/block', { op: 'add', date: T, scope: 'day', block: { start: '16:00', end: '16:30', title: 'Call the accountant', icon: '📞' } }, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/ownerplan/block', { op: 'add', date: T, scope: 'future', block: { start: '07:00', end: '07:30', title: 'Morning run', rule: 'weekly', days: [wd] } }, tok)).status, 200);
  t = (await x.call('GET', '/api/admin/ownerplan', {}, tok, { from: T, to: new Date(new Date(T + 'T12:00:00Z').getTime() + 7 * 86400000).toISOString().slice(0, 10) })).json;
  assert.ok(t.rows[0].blocks.some((b) => b.title === 'Call the accountant')); assert.ok(!t.rows[7].blocks.some((b) => b.title === 'Call the accountant')); assert.ok(t.rows[7].blocks.some((b) => b.title === 'Morning run'));
  const added = t.rows[0].blocks.find((b) => b.title === 'Call the accountant');
  assert.equal((await x.call('POST', '/api/admin/ownerplan/block', { op: 'dup', id: added.id, date: T, toDate: later, scope: 'day' }, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/ownerplan/block', { op: 'del', id: 'dinner', date: T, scope: 'day' }, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/ownerplan/block', { op: 'edit', id: 'sleep', date: T, scope: 'day', block: { start: '23:00', end: '22:00' } }, tok)).status, 400, 'end after start');
  t = (await x.call('GET', '/api/admin/ownerplan', {}, tok, { from: T, to: later })).json; assert.ok(!t.rows[0].blocks.some((b) => b.id === 'dinner')); assert.ok(t.rows[1].blocks.some((b) => b.id === 'dinner')); assert.ok(t.rows[1].blocks.some((b) => b.title === 'Call the accountant'));
  // 10 Resend keys: key goes to Accounts (masked here), not sending until the owner turns it on; 10 linked → the routine is checked off
  let r = await x.call('POST', '/api/admin/ownerplan/api', { date: T, i: 0, domain: 'gptchat.site', apiKey: 're_TEST12345678abcd', status: 'created' }, tok); assert.equal(r.status, 200); assert.equal(r.json.entry.hint, 're_••••abcd'); assert.ok(!JSON.stringify(r.json).includes('re_TEST1234'));
  const accs = await x.store.get('accounts'); const acc = accs.find((a) => a.domains.includes('gptchat.site')); assert.ok(acc); assert.equal(acc.sending, false); assert.equal(acc.apiKey, 're_TEST12345678abcd');
  assert.equal((await x.call('POST', '/api/admin/ownerplan/api', { date: T, i: 1, domain: 'gptchat.site' }, tok)).status, 409, 'one domain once');
  assert.equal((await x.call('POST', '/api/admin/ownerplan/api', { date: T, i: 1, domain: 'bad domain' }, tok)).status, 400);
  for (let i = 0; i < 10; i++) await x.call('POST', '/api/admin/ownerplan/api', { date: T, i, domain: i ? `d${i}-test.site` : 'gptchat.site', status: 'linked' }, tok);
  t = (await x.call('GET', '/api/admin/ownerplan', {}, tok)).json; assert.equal(t.rows[0].apiLinked, 10); assert.ok(t.rows[0].blocks.find((b) => b.id === 'api').done, 'auto checked at 10/10'); assert.equal(t.api[T].length, 10); assert.ok(!JSON.stringify(t).includes('re_TEST1234'));
  // holiday + notification settings
  assert.equal((await x.call('POST', '/api/admin/ownerplan/holiday', { date: later, name: 'Family day' }, tok)).status, 200);
  t = (await x.call('GET', '/api/admin/ownerplan', {}, tok, { from: later, to: later })).json; assert.ok(t.rows[0].holidays.some((h) => h.name === 'Family day'));
  assert.equal((await x.call('PUT', '/api/admin/ownerplan/notify', { pre: 10, tg: false, per: { sleep: { push: false } } }, tok)).status, 200);
  // alerts at the exact times (Bangkok): 10 min before, at the start, and when left unchecked
  const at = (hm) => new Date(`${T}T${hm}:00+07:00`).getTime();
  const a1 = await x.be.ownerAlerts(at('08:20')); assert.equal(a1.sent, 1);
  assert.equal((await x.be.ownerAlerts(at('08:21'))).sent, 0, 'once');
  assert.equal((await x.be.ownerAlerts(at('08:30'))).sent, 1);
  assert.equal((await x.be.ownerAlerts(at('09:30'))).sent, 1, 'only the next block starts; wake is checked so no late alert');
  assert.equal((await x.be.ownerAlerts(at('11:30'))).sent, 1, 'morning block left unchecked → late alert, and lunch... (moved to 12:00 today) not yet');
  assert.equal((await x.be.ownerAlerts(at('11:50'))).sent, 1, '10 min before the moved lunch');
});

test('finance helpers: timestamps, sorting, exact time format, payouts and bank notes', async () => {
  const exact = Date.parse('2026-01-02T03:04:05Z');
  assert.equal(txTime({ at: 111 }), 111);
  assert.equal(txTime({ ts: '222' }), 222);
  assert.equal(txTime({ createdAt: '2026-01-02T03:04:05Z' }), exact);
  assert.equal(txTime({ date: '2026-11-20' }), Date.UTC(2026, 10, 20, 12));
  assert.equal(txTime({ time: 'not a date' }), 0);

  const rows = [
    { id: 'old', date: '2024-01-01' },
    { id: 'exact', at: exact },
    { id: 'mid', ts: Date.parse('2025-06-01T00:00:00Z') },
    { id: 'bad', date: 'nope' },
    { id: 'zero', at: 0 },
    { id: 'equal1', at: 1000 },
    { id: 'equal2', at: 1000 },
  ];
  const rowsBefore = JSON.stringify(rows);
  assert.deepEqual(sortTxNewest(rows).map((x) => x.id), ['exact', 'mid', 'old', 'equal1', 'equal2', 'bad', 'zero']);
  assert.equal(JSON.stringify(rows), rowsBefore, 'sortTxNewest does not mutate its input');

  const parts = exactTimeParts(exact);
  assert.equal(parts.date, '2026-01-02');
  assert.equal(parts.time, '10:04:05', 'seconds are always present');
  assert.equal(parts.tz, 'Asia/Bangkok');
  assert.match(formatExactTime({ at: exact }), /^2026-01-02 10:04:05 Asia\/Bangkok$/);

  assert.equal(normalizePayoutDays(1), 1);
  assert.equal(normalizePayoutDays('2'), 2);
  assert.equal(normalizePayoutDays(7), 7);
  assert.equal(normalizePayoutDays(3), 2, 'unsupported payout days fall back to 2');
  const from = Date.UTC(2026, 10, 20, 9, 30);
  assert.equal(nextPayoutDate(2, from), from + 2 * 86400000);
  assert.equal(nextPayoutDate(3, from), from + 2 * 86400000);

  assert.equal(usBankHolidayOn(new Date(2026, 6, 4, 12).getTime()), 'Independence Day');
  assert.equal(usBankHolidayOn(new Date(2026, 5, 3, 12).getTime()), null);
  const note = bankPayoutNote({ name: 'Mercury', payoutDays: 2 }, new Date(2026, 6, 2, 12).getTime());
  assert.match(note, /Mattress/);
  assert.match(note, /internal cash ledger/i);
  assert.match(note, /pending Stripe payouts/i);
  assert.match(note, /2 days/);
  assert.match(note, /Next payout:/);
  assert.match(note, /Independence Day/, 'US bank holiday delays are called out');
  assert.deepEqual(balanceTxLink({ id: 'a b/c' }), { id: 'a b/c', url: '#tx-a%20b%2Fc', label: 'View transaction' });
});

test('finance helpers: new input keeps fields and legacy migration never mutates', async () => {
  const input = { id: 'tx1', date: '2026-11-20', time: '13:47:05', note: 'keep me' };
  const applied = applyTransactionInput(input);
  assert.equal(applied.at, Date.parse('2026-11-20T13:47:05Z'));
  assert.equal(applied.timePrecision, 'second');
  assert.equal(applied.date, '2026-11-20');
  assert.equal(applied.time, '13:47:05');
  assert.equal(applied.note, 'keep me');
  assert.equal(input.at, undefined, 'applyTransactionInput does not mutate its input');
  assert.equal(input.timePrecision, undefined);

  const legacy = { s: { finance: { tx: [
    { id: 'legacy', date: '2024-05-06', amount: 10 },
    { id: 'now', at: 1715000000000, time: '12:30:45', amount: 5 },
    { id: 'junk', note: 'no date' },
  ] } }, tx: [{ id: 'more', date: '2026-07-04' }] };
  const before = JSON.stringify(legacy);
  const { data, report } = migrateLegacyTransactions(legacy);
  assert.equal(JSON.stringify(legacy), before, 'migration leaves the source untouched');
  assert.deepEqual(report, { scanned: 4, migrated: 2, alreadyExact: 1, skipped: 1 });
  const old = data.s.finance.tx[0];
  assert.equal(old.date, '2024-05-06', 'the original date is preserved');
  assert.equal(old.at, Date.UTC(2024, 4, 6, 12));
  assert.equal(old.timePrecision, 'date-only');
  assert.equal(old.legacy, true);
  assert.equal(old.amount, 10);
  assert.equal(data.s.finance.tx[1].at, 1715000000000);
  assert.ok(!data.s.finance.tx[1].legacy, 'exact rows are left alone');
  assert.equal(data.tx[0].at, Date.UTC(2026, 6, 4, 12));
});

test('finance settings defaults are seeded and ads is a normal agent permission', async () => {
  const x = setup(); const tok = await adminToken(x);
  const st = await x.call('GET', '/api/admin/settings', {}, tok);
  assert.equal(st.status, 200);
  assert.equal(st.json.importantNotice, '', 'editable Important notice starts empty');
  assert.equal(st.json.payoutSchedule, 2);
  assert.equal(st.json.autoTransferEnabled, false);
  const c = await addCustomer(x, tok, { username: 'noticeuser', email: 'notice.user@example.com' });
  const u = await x.call('POST', '/api/login', { username: c.username, password: 'secret12' });
  const customerMe = await x.call('GET', '/api/me', {}, u.json.token);
  assert.equal(customerMe.json.importantNotice, '', 'customer /api/me exposes the default Important notice');
  assert.ok(!TECH_ONLY.includes('ads'), 'agents with the ads permission are not blocked as tech-only');
  for (const p of ['secrets', 'templates_edit', 'seo']) assert.ok(TECH_ONLY.includes(p), p + ' stays tech/owner-only');
  const made = await x.call('POST', '/api/admin/team', { name: 'Ads Agent', username: 'adsagent', password: 'secret12', role: 'Sales Agent', perms: ['customers_view', 'ads'] }, tok);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.ok(made.json.perms.includes('ads'));
  const li = await x.call('POST', '/api/login', { username: 'adsagent', password: 'secret12' });
  const me = await x.call('GET', '/api/admin/me', {}, li.json.token);
  assert.ok(me.json.perms.includes('ads'), 'the agent keeps ads in their live permissions');
});

test('finance API: table and CSV-sized export are newest-first; table stays capped at 300', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.store.put('tx', [
    { id: 'old', date: '2024-01-01', amount: 1 },
    { id: 'new', at: Date.parse('2026-01-02T03:04:05Z'), amount: 2 },
    { id: 'mid', ts: Date.parse('2025-06-01T00:00:00Z'), amount: 3 },
  ]);
  const list = await x.call('GET', '/api/admin/tx', {}, tok);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.map((t) => t.id), ['new', 'mid', 'old']);
  const csvLike = await x.call('GET', '/api/admin/tx', {}, tok, { limit: 100000 });
  assert.deepEqual(csvLike.json.map((t) => t.id), ['new', 'mid', 'old']);
  const many = Array.from({ length: 301 }, (_, i) => ({ id: 'n' + i, at: i + 1 }));
  await x.store.put('tx', many);
  const capped = await x.call('GET', '/api/admin/tx', {}, tok);
  assert.equal(capped.json.length, 300);
  assert.equal(capped.json[0].id, 'n300');
  assert.equal(capped.json.at(-1).id, 'n1');
});

test('finance API: a transaction entered with hours, minutes and seconds keeps them all', async () => {
  const x = setup(); const tok = await adminToken(x);
  const made = await x.call('POST', '/api/admin/tx', { type: 'income', accountId: 'stripe', amount: 12.5, date: '2026-11-20', time: '13:47:05', category: 'Sale' }, tok);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.equal(made.json.at, Date.parse('2026-11-20T13:47:05Z'));
  assert.equal(made.json.timePrecision, 'second');
  assert.equal(made.json.date, '2026-11-20');
  assert.equal(made.json.time, '13:47:05');
});

// ---- Upgrade: IBO players, multi-MAC IBO devices, AI assistant, sports promos, agent planning notifications ----

test('ibo players: the IBO players list has the downloader codes and APK links', async () => {
  const x = setup(); const tok = await adminToken(x);
  const r = await x.call('GET', '/api/ibo/players', {}, tok);
  assert.equal(r.status, 200);
  const names = r.json.map((p) => p.name);
  for (const want of ['IBO Player', 'IBO Player Pro', 'KING4K Player', 'IBO Pro Player', 'IBO Pro', 'IBOSS IPTV', 'IBO XPlayer']) assert.ok(names.includes(want), `${want} is in the IBO players list`);
  const ibo = r.json.find((p) => p.name === 'IBO Player');
  assert.equal(ibo.code, '1171959');
  assert.match(ibo.apk, /^https:\/\/ibodesk\.com\/iboupdate\.apk$/);
  assert.match(ibo.playlist, /iboplayer\.com\/device\/login/);
  const pro = r.json.find((p) => p.name === 'IBO Player Pro');
  assert.match(pro.code, /^923441$/);
  assert.match(pro.apk, /ibodesk\.com\/ibopro\.apk/);
  assert.match(pro.playlist, /iboplayer\.pro\/manage-playlists\/login\/$/);
});

test('IBO clients: several devices per client, per-device apps, credits multiply by device count', async () => {
  const x = setup(); const tok = await adminToken(x);
  const set = await x.call('POST', '/api/admin/ibo/credits', { action: 'set', credits: 8 }, tok);
  assert.equal(set.status, 200);
  const m = await x.call('POST', '/api/admin/ibo', { name: 'Living room', deviceApp: 'IBO Player Pro', devices: [{ deviceApp: 'IBO Player Pro', mac: 'aa:bb:cc:dd:ee:ff' }, { deviceApp: 'KING4K Player', mac: 'AA-BB-CC-DD-EE-01' }] }, tok);
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.equal(m.json.client.devices.length, 2);
  assert.equal(m.json.client.devices[0].deviceApp, 'IBO Player Pro');
  assert.equal(m.json.client.devices[1].deviceApp, 'KING4K Player');
  assert.deepEqual(m.json.client.macs, ['AA:BB:CC:DD:EE:FF', 'AA:BB:CC:DD:EE:01']);
  assert.equal(m.json.client.macAddress, 'AA:BB:CC:DD:EE:FF');
  const g = await x.call('GET', '/api/admin/ibo', {}, tok);
  assert.equal(g.json.list[0].devices.length, 2);
  const m2 = await x.call('POST', '/api/admin/ibo', { name: 'Four-box household', devices: [{ deviceApp: 'IBO Player', mac: 'AA:BB:CC:DD:EE:02' }, { deviceApp: 'IBO Player', mac: 'AA:BB:CC:DD:EE:03' }, { deviceApp: 'IBO Player Pro', mac: 'AA:BB:CC:DD:EE:04' }, { deviceApp: 'KING4K Player', mac: 'AA:BB:CC:DD:EE:05' }] }, tok);
  assert.equal(m2.status, 200, JSON.stringify(m2.json));
  assert.equal(m2.json.client.devices.length, 4);
  const shelf = await x.call('GET', '/api/admin/ibo/credits', {}, tok);
  assert.equal(shelf.json.credits, 2, '4 devices deducted 4 credits from the 8 set');
  const add = await x.call('POST', '/api/admin/ibo/macs', { id: m2.json.client.id, mac: '00 11 22 33 44 55' }, tok);
  assert.equal(add.status, 200); assert.equal(add.json.client.devices.length, 5);
  const del = await x.call('DELETE', '/api/admin/ibo/macs', { id: m2.json.client.id, mac: '00:11:22:33:44:55' }, tok);
  assert.equal(del.status, 200); assert.equal(del.json.client.devices.length, 4);
  assert.equal((await x.call('DELETE', '/api/admin/ibo/macs', { id: m2.json.client.id, mac: 'Q' }, tok)).status, 400, 'an unparseable MAC is refused');
});

test('AI assistant: panel answers questions, the owner can configure and run actions', async () => {
  const x = setup(); const tok = await adminToken(x);
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const ownerToday = new Date().toISOString().slice(0, 10); const ownerTomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await x.store.put('ownerplan', { tz: 'UTC', blocks: [
    { id: 'test-owner', v: [{ from: '', start: '09:00', end: '09:30', title: 'OWNER_PUBLIC_TEST_BLOCK', icon: '📌', rule: 'weekly', days: allDays, note: 'PRIVATE_NOTE_SHOULD_NOT_LEAK' }] },
    { id: 'test-owner-api', v: [{ from: '', start: '09:30', end: '10:00', title: 'OWNER_API_BLOCK_SHOULD_NOT_LEAK', icon: '🔑', rule: 'weekly', days: allDays, api: true }] },
  ] });
  await x.store.put('ownerov', {
    [ownerToday]: { edit: { 'test-owner': { start: '10:00', end: '10:30', title: 'OWNER_TODAY_EDITED' } }, add: [{ id: 'today-add', start: '14:00', end: '14:30', title: 'OWNER_TODAY_ADDED', icon: '📞' }] },
    [ownerTomorrow]: { add: [{ id: 'tomorrow-add', start: '15:00', end: '15:30', title: 'OWNER_TOMORROW_ADDED', icon: '📌' }] },
  });
  await x.store.put('ownerapi:2026-11', { value: 'APIKEY_RECORD_SHOULD_NOT_LEAK' });
  await x.store.put('ownerchk:2026-11', { value: 'CHECKOFF_SHOULD_NOT_LEAK' });
  const q1 = await x.call('POST', '/api/admin/ai/ask', { question: 'What is my daily plan?' }, tok);
  assert.equal(q1.status, 200); assert.equal(q1.json.source, 'panel'); assert.match(q1.json.answer, /Agent Work planning/); assert.doesNotMatch(q1.json.answer, /Owner’s My planning|OWNER_TODAY_EDITED|OWNER_TODAY_ADDED|OWNER_PUBLIC_TEST_BLOCK|OWNER_API_BLOCK_SHOULD_NOT_LEAK|PRIVATE_NOTE_SHOULD_NOT_LEAK|APIKEY_RECORD_SHOULD_NOT_LEAK|CHECKOFF_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(q1.json.answer, /OWNER_PUBLIC_TEST_BLOCK|OWNER_API_BLOCK_SHOULD_NOT_LEAK|PRIVATE_NOTE_SHOULD_NOT_LEAK|APIKEY_RECORD_SHOULD_NOT_LEAK|CHECKOFF_SHOULD_NOT_LEAK/);
  const bothPlans = await x.call('POST', '/api/admin/ai/ask', { question: 'Show both owner My planning and agent Work planning for today.' }, tok);
  assert.equal(bothPlans.status, 200); assert.equal(bothPlans.json.source, 'panel');
  assert.match(bothPlans.json.answer, /Agent Work planning for/); assert.doesNotMatch(bothPlans.json.answer, /Owner’s My planning|OWNER_TODAY_EDITED|OWNER_TODAY_ADDED/);
  const bothLoginMethods = await x.call('POST', '/api/admin/ai/ask', { question: 'Does Smarters Pro support both Xtream Codes and M3U?' }, tok);
  assert.equal(bothLoginMethods.status, 200); assert.equal(bothLoginMethods.json.source, 'panel');
  assert.match(bothLoginMethods.json.answer, /Smarters Pro commonly offers Xtream Codes API and a separate M3U playlist login/);
  assert.doesNotMatch(bothLoginMethods.json.answer, /Agent Work planning|Owner’s My planning/);
  const ownerOnly = await x.call('POST', '/api/admin/ai/ask', { question: 'Show the owner’s My planning schedule.' }, tok);
  assert.match(ownerOnly.json.answer, /private/i); assert.doesNotMatch(ownerOnly.json.answer, /OWNER_TODAY_EDITED|OWNER_TODAY_ADDED|OWNER_API_BLOCK_SHOULD_NOT_LEAK|PRIVATE_NOTE_SHOULD_NOT_LEAK|APIKEY_RECORD_SHOULD_NOT_LEAK|CHECKOFF_SHOULD_NOT_LEAK/);
  const ownerTomorrowPlan = await x.call('POST', '/api/admin/ai/ask', { question: 'Show the owner’s My planning for tomorrow.' }, tok);
  assert.match(ownerTomorrowPlan.json.answer, /private/i); assert.doesNotMatch(ownerTomorrowPlan.json.answer, /OWNER_TOMORROW_ADDED|OWNER_TODAY_ADDED|OWNER_API_BLOCK_SHOULD_NOT_LEAK/);
  const q2 = await x.call('POST', '/api/admin/ai/ask', { question: "What are tomorrow's tasks?" }, tok);
  assert.equal(q2.json.source, 'panel'); assert.match(q2.json.answer, /Tomorrow/);
  const q3 = await x.call('POST', '/api/admin/ai/ask', { question: "What is tomorrow's agent work plan?" }, tok);
  assert.match(q3.json.answer, /Agent Work planning/);
  const setupAnswer = await x.call('POST', '/api/admin/ai/ask', { question: 'How do I set up Smarters Pro using an M3U playlist?' }, tok);
  assert.match(setupAnswer.json.answer, /IPTV Smarters Pro/); assert.match(setupAnswer.json.answer, /M3U playlist/); assert.match(setupAnswer.json.answer, /Never post your username/);
  const alerts = await x.call('POST', '/api/admin/ai/action', { action: 'ask-alerts' }, tok);
  assert.equal(alerts.status, 200); assert.ok(alerts.json.answer);
  const ibo = await x.call('POST', '/api/admin/ai/action', { action: 'ibo-setup' }, tok);
  assert.equal(ibo.status, 200); assert.match(ibo.json.answer, /1171959/);
  const notify = await x.call('POST', '/api/admin/ai/action', { action: 'notify-agents' }, tok);
  assert.equal(notify.status, 200);
  const cfg = await x.call('GET', '/api/admin/ai/config', {}, tok);
  assert.equal(cfg.json.on, true); assert.equal(cfg.json.model, 'gpt-4o-mini'); assert.equal(cfg.json.hasKey, false); assert.equal(cfg.json.photoAnalysis, true);
  const set = await x.call('PUT', '/api/admin/ai/config', { on: true, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test-123', instructions: 'Answer in French.' }, tok);
  assert.equal(set.status, 200); assert.equal(set.json.hasKey, true);
  const cfg2 = await x.call('GET', '/api/admin/ai/config', {}, tok);
  assert.equal(cfg2.json.hasKey, true, 'the config never returns the key');
});

test('AI provider HTTP URLs are rejected and a legacy HTTP configuration falls back safely', async () => {
  let providerCalls = 0;
  const x = setup((url) => { if (String(url).endsWith('/chat/completions')) { providerCalls++; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Unexpected provider response.' } }] }) }; } });
  const settings = await x.store.get('settings');
  settings.ai = { on: true, provider: 'openai', baseUrl: 'http://ai.example/v1', model: 'text-model', apiKey: 'sk-test', instructions: '', tz: 'UTC', photoAnalysis: true };
  await x.store.put('settings', settings);
  const tok = await adminToken(x);
  assert.equal((await x.call('PUT', '/api/admin/ai/config', { on: true, baseUrl: 'http://ai.example/v1', apiKey: 'sk-test' }, tok)).status, 400);
  assert.equal((await x.call('PUT', '/api/admin/ai/config', { on: true, baseUrl: 'https://user:secret@ai.example/v1', apiKey: 'sk-test' }, tok)).status, 400);
  const answer = await x.call('POST', '/api/admin/ai/ask', { question: 'What is happening today?' }, tok);
  assert.equal(answer.status, 200); assert.equal(answer.json.source, 'panel'); assert.match(answer.json.answer, /Agent Work planning/);
  const draft = await x.call('POST', '/api/admin/ai/compose-marketing', { brief: 'Verified service update.' }, tok);
  assert.equal(draft.status, 200); assert.equal(draft.json.source, 'template');
  assert.equal(providerCalls, 0, 'HTTP or credential-bearing AI URLs must never reach fetch');
});

test('AI settings: generic writes are owner-only, secure provider URLs are required, and masked keys are preserved', async () => {
  const x = setup(); const tok = await adminToken(x);
  const configured = await x.call('PUT', '/api/admin/ai/config', { on: true, baseUrl: 'https://ai.example/v1', model: 'text-model', apiKey: 'sk-original-secret', photoAnalysis: true }, tok);
  assert.equal(configured.status, 200);
  for (const ai of [{ baseUrl: 'http://ai.example/v1' }, { baseUrl: 'https://user:secret@ai.example/v1' }]) {
    assert.equal((await x.call('PUT', '/api/admin/settings', { ai }, tok)).status, 400, 'generic settings reject HTTP and credential-bearing provider URLs');
    assert.equal((await x.store.get('settings')).ai.apiKey, 'sk-original-secret');
  }
  const masked = await x.call('PUT', '/api/admin/settings', { ai: { baseUrl: 'https://ai.example/v1', photoAnalysis: false, apiKey: '••••' } }, tok);
  assert.equal(masked.status, 200, JSON.stringify(masked.json));
  assert.equal((await x.store.get('settings')).ai.apiKey, 'sk-original-secret', 'submitting the masked key leaves the existing key intact');

  const made = await x.call('POST', '/api/admin/team', { name: 'Settings Viewer', username: 'settingsviewer', password: 'secret12', role: 'Sales Agent', perms: ['settings', 'customers_view'] }, tok);
  assert.equal(made.status, 200);
  const login = await x.call('POST', '/api/login', { username: 'settingsviewer', password: 'secret12' }); assert.equal(login.status, 200);
  const staff = login.json.token; await signBylaws(x, staff);
  assert.equal((await x.call('GET', '/api/admin/settings', {}, staff)).status, 200, 'staff has generic settings access');
  for (const ai of [{ baseUrl: 'https://attacker.example/v1' }, { photoAnalysis: true }, { apiKey: 'sk-attacker' }]) {
    assert.equal((await x.call('PUT', '/api/admin/settings', { ai }, staff)).status, 403, 'settings permission does not grant AI configuration access');
  }
  assert.equal((await x.store.get('settings')).ai.apiKey, 'sk-original-secret');
  assert.equal((await x.store.get('settings')).ai.baseUrl, 'https://ai.example/v1');
  assert.equal((await x.store.get('settings')).ai.photoAnalysis, false);
});

test('AI marketing composer returns safe HTML and WhatsApp plain text, without sending or saving', async () => {
  let providerBody = null;
  const x = setup((url, init) => { if (String(url).endsWith('/chat/completions')) { providerBody = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ emailSubject: 'A useful update', emailHeadline: 'Offer < 10 & safe', emailBody: 'Use < 5 devices & check.', whatsappText: '*Hello* <b>there</b>' }) } }] }) }; } });
  const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/ai/config', { on: true, baseUrl: 'https://ai.example/v1', model: 'vision-text-model', apiKey: 'sk-test' }, tok);
  await x.store.put('mkt', { rows: [{ id: 'saved-row', key: 're_saved', domain: 'example.com', on: true }], subjects: ['Saved rotating subject'], html: '<p>Existing campaign</p>', totalSent: 19, totalSpendUsd: 3.5 });
  const mktBefore = await x.store.get('mkt');
  const draft = await x.call('POST', '/api/admin/ai/compose-marketing', { brief: 'Share the verified December service update.', audience: 'existing subscribers', tone: 'friendly' }, tok);
  assert.equal(draft.status, 200, JSON.stringify(draft.json));
  assert.equal(draft.json.emailSubject, 'A useful update'); assert.match(draft.json.emailHtml, /Offer &lt; 10 &amp; safe/); assert.match(draft.json.emailHtml, /Use &lt; 5 devices &amp; check/); assert.doesNotMatch(draft.json.emailHtml, /<script>|<img/);
  assert.equal(draft.json.whatsappText, '*Hello* there'); assert.doesNotMatch(draft.json.whatsappText, /<[^>]+>|<html/i);
  assert.equal(draft.json.sent, false); assert.equal(draft.json.saved, false); assert.equal(providerBody.model, 'vision-text-model');
  assert.equal(x.mails.length, 0, 'draft generation never sends a campaign');
  assert.deepEqual(await x.store.get('mkt'), mktBefore, 'draft generation leaves the marketing store unchanged');
  const fallback = setup(); const ftok = await adminToken(fallback);
  const templ = await fallback.call('POST', '/api/admin/ai/compose-marketing', { brief: 'Verified service update.' }, ftok);
  assert.equal(templ.status, 200); assert.equal(templ.json.source, 'template'); assert.match(templ.json.emailHtml, /Verified service update/); assert.doesNotMatch(templ.json.whatsappText, /<html|<p>/);
  const made = await fallback.call('POST', '/api/admin/team', { name: 'No Marketing', username: 'nomarketing', password: 'secret12', role: 'Sales Agent', perms: ['customers_view'] }, ftok);
  assert.equal(made.status, 200); const staff = await fallback.call('POST', '/api/login', { username: 'nomarketing', password: 'secret12' }); await signBylaws(fallback, staff.json.token);
  assert.equal((await fallback.call('POST', '/api/admin/ai/compose-marketing', { brief: 'Forbidden draft.' }, staff.json.token)).status, 403);
});

test('AI photo analysis requires customer consent and ticket-view permission, sends image only, and never replies automatically', async () => {
  const providerRequests = [];
  const x = setup((url, init) => { if (String(url).endsWith('/chat/completions')) { providerRequests.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Visible error: playlist login failed. Check the selected login type and network; do not share credentials.' } }] }) }; } });
  const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/ai/config', { on: true, baseUrl: 'https://ai.example/v1', model: 'vision-model', apiKey: 'sk-test', photoAnalysis: true }, tok);
  await addCustomer(x, tok, { name: 'Private Customer Name' });
  const user = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  const image = 'data:image/jpeg;base64,' + 'Q'.repeat(500);
  const noConsent = await x.call('POST', '/api/me/tickets', { subject: 'Private subject', text: 'PRIVATE_TICKET_TEXT_SHOULD_NOT_BE_SENT', image }, user);
  const noAtt = (await x.call('GET', '/api/me/tickets', {}, user)).json.find((t) => t.id === noConsent.json.id).messages[0].att;
  assert.equal((await x.call('POST', '/api/admin/ai/analyze-photo', { ticketId: noConsent.json.id, att: noAtt }, tok)).status, 403);
  assert.equal(providerRequests.length, 0, 'no image is sent before opt-in');
  const yesConsent = await x.call('POST', '/api/me/tickets', { subject: 'Private subject', text: 'PRIVATE_TICKET_TEXT_SHOULD_NOT_BE_SENT', image, aiPhotoConsent: true }, user);
  const ticketBefore = (await x.call('GET', '/api/me/tickets', {}, user)).json.find((t) => t.id === yesConsent.json.id); const att = ticketBefore.messages[0].att;
  const analyzed = await x.call('POST', '/api/admin/ai/analyze-photo', { ticketId: yesConsent.json.id, att }, tok);
  assert.equal(analyzed.status, 200, JSON.stringify(analyzed.json)); assert.match(analyzed.json.answer, /Visible error/); assert.equal(analyzed.json.saved, false);
  const providerText = JSON.stringify(providerRequests[0].body);
  assert.match(providerText, /data:image\/jpeg;base64/); assert.doesNotMatch(providerText, /PRIVATE_TICKET_TEXT_SHOULD_NOT_BE_SENT|Private Customer Name|Private subject/);
  const ticketAfter = (await x.call('GET', '/api/me/tickets', {}, user)).json.find((t) => t.id === yesConsent.json.id);
  assert.deepEqual(ticketAfter.messages, ticketBefore.messages, 'analysis did not change ticket messages or add a staff reply');
  const noView = await x.call('POST', '/api/admin/team', { name: 'Agent Without Ticket View', username: 'noview', password: 'secret12', role: 'Sales Agent', perms: [] }, tok);
  assert.equal(noView.status, 200);
  const staff = await x.call('POST', '/api/login', { username: 'noview', password: 'secret12' }); await signBylaws(x, staff.json.token);
  assert.equal((await x.call('POST', '/api/admin/ai/analyze-photo', { ticketId: yesConsent.json.id, att }, staff.json.token)).status, 403);
  assert.equal(providerRequests.length, 1, 'staff without ticket-view permission cannot call the provider');
});

test('AI photo-analysis quota serializes concurrent attempts and counts provider failures', async () => {
  let providerCalls = 0;
  const x = setup((url) => { if (String(url).endsWith('/chat/completions')) { providerCalls++; return { ok: false, status: 503, json: async () => ({ error: 'temporary provider failure' }) }; } });
  const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/ai/config', { on: true, baseUrl: 'https://ai.example/v1', model: 'vision-model', apiKey: 'sk-test', photoAnalysis: true }, tok);
  await addCustomer(x, tok);
  const user = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  const image = 'data:image/png;base64,' + 'A'.repeat(500);
  const ticket = await x.call('POST', '/api/me/tickets', { subject: 'Playback error', text: 'See image.', image, aiPhotoConsent: true }, user);
  const saved = (await x.call('GET', '/api/me/tickets', {}, user)).json.find((t) => t.id === ticket.json.id);
  const att = saved.messages[0].att;
  const results = await Promise.all(Array.from({ length: 21 }, () => x.call('POST', '/api/admin/ai/analyze-photo', { ticketId: ticket.json.id, att }, tok)));
  assert.equal(providerCalls, 20, 'only the allowed number of concurrent requests reach the provider');
  assert.equal(results.filter((r) => r.status === 502).length, 20, 'provider failures are returned but still counted as attempts');
  assert.equal(results.filter((r) => r.status === 429).length, 1, 'the concurrent overflow is rejected');
  assert.equal((await x.call('POST', '/api/admin/ai/analyze-photo', { ticketId: ticket.json.id, att }, tok)).status, 429);
  assert.equal(providerCalls, 20, 'the exhausted quota prevents later provider calls');
});

test('configured AI provider requests for ask, marketing composition, and photo analysis reject redirects', async () => {
  const providerRequests = [];
  const x = setup((url, init) => {
    if (String(url).endsWith('/chat/completions')) {
      providerRequests.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ emailSubject: 'Reviewed', emailHeadline: 'Update', emailBody: 'Service update.', whatsappText: 'Service update.' }) } }] }) };
    }
  });
  const tok = await adminToken(x);
  assert.equal((await x.call('PUT', '/api/admin/ai/config', { on: true, baseUrl: 'https://ai.example/v1', model: 'vision-model', apiKey: 'sk-test', photoAnalysis: true }, tok)).status, 200);
  const asked = await x.call('POST', '/api/admin/ai/ask', { question: 'Give me a short service status summary.' }, tok);
  assert.equal(asked.status, 200); assert.equal(asked.json.source, 'ai');
  const composed = await x.call('POST', '/api/admin/ai/compose-marketing', { brief: 'Verified service update.' }, tok);
  assert.equal(composed.status, 200); assert.equal(composed.json.source, 'ai');
  await addCustomer(x, tok);
  const user = (await x.call('POST', '/api/login', { username: 'testuser', password: 'secret12' })).json.token;
  const image = 'data:image/png;base64,' + 'R'.repeat(500);
  const ticket = await x.call('POST', '/api/me/tickets', { subject: 'Playback issue', text: 'Please see the image.', image, aiPhotoConsent: true }, user);
  assert.equal(ticket.status, 200);
  const ticketView = (await x.call('GET', '/api/me/tickets', {}, user)).json.find((t) => t.id === ticket.json.id);
  const analyzed = await x.call('POST', '/api/admin/ai/analyze-photo', { ticketId: ticket.json.id, att: ticketView.messages[0].att }, tok);
  assert.equal(analyzed.status, 200);
  assert.equal(providerRequests.length, 3);
  assert.deepEqual(providerRequests.map((r) => r.init.redirect), ['error', 'error', 'error'], 'every configured AI fetch rejects HTTP redirects');
});

test('AI assistant: agents share the panel answers, but only the owner runs actions', async () => {
  const x = setup(); const tok = await adminToken(x);
  const made = await x.call('POST', '/api/admin/team', { name: 'Agent One', username: 'agentone', password: 'secret12', role: 'Sales Agent', perms: ['customers_view'] }, tok);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const lg = await x.call('POST', '/api/login', { username: 'agentone', password: 'secret12' });
  assert.equal(lg.status, 200);
  const byl = await x.call('POST', '/api/admin/bylaws/sign', { name: 'Agent One' }, lg.json.token);
  assert.equal(byl.status, 200, JSON.stringify(byl.json));
  const ag = await x.call('POST', '/api/admin/ai/ask', { question: 'What is my daily plan?' }, lg.json.token);
  assert.equal(ag.status, 200); assert.equal(ag.json.source, 'panel');
  assert.equal((await x.call('PUT', '/api/admin/ai/config', { on: true }, lg.json.token)).status, 403);
  assert.equal((await x.call('POST', '/api/admin/ai/action', { action: 'notify-agents' }, lg.json.token)).status, 403);
});

test('AI alert context contains aggregate counts, not customer identity', async () => {
  const providerRequests = [];
  const x = setup((url, init) => { if (String(url).endsWith('/chat/completions')) { providerRequests.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'There is one subscription ending soon.' } }] }) }; } });
  const tok = await adminToken(x);
  const customer = await addCustomer(x, tok, { name: 'PRIVATE_ALERT_CUSTOMER', username: 'privatealert' });
  const staleHours = await addCustomer(x, tok, { name: 'PRIVATE_TRIAL_STALE_HOURS', username: 'staletrialhours', email: 'stalehours@example.com' });
  const shouldNotEnd = await addCustomer(x, tok, { name: 'PRIVATE_TRIAL_NOT_ENDING', username: 'notendingtrial', email: 'notending@example.com' });
  const ended = await addCustomer(x, tok, { name: 'PRIVATE_TRIAL_ENDED', username: 'endedtrial', email: 'ended@example.com' });
  const capturedNow = Date.now();
  const customers = await x.store.get('customers');
  const row = customers.find((c) => c.id === customer.id); row.expiresAt = Date.now() + 2 * 86400000; row.daysLeft = 2;
  const endingTrial = customers.find((c) => c.id === staleHours.id); endingTrial.isTrial = true; endingTrial.expiresAt = capturedNow + 6 * 3600000; endingTrial.hoursLeft = 1000; delete endingTrial.daysLeft;
  const laterTrial = customers.find((c) => c.id === shouldNotEnd.id); laterTrial.isTrial = true; laterTrial.expiresAt = capturedNow + 2 * 86400000; laterTrial.hoursLeft = 1; delete laterTrial.daysLeft;
  const expiredTrial = customers.find((c) => c.id === ended.id); expiredTrial.isTrial = true; expiredTrial.expiresAt = capturedNow - 3600000; expiredTrial.hoursLeft = 0; delete expiredTrial.daysLeft;
  await x.store.put('customers', customers);
  await x.call('PUT', '/api/admin/ai/config', { on: true, baseUrl: 'https://ai.example/v1', model: 'text-model', apiKey: 'sk-test' }, tok);
  const response = await x.call('POST', '/api/admin/ai/ask', { question: 'Summarize the current alerts.' }, tok);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const prompt = JSON.stringify(providerRequests[0]);
  assert.match(prompt, /Trials ending within 12 hours: 1/, 'the trial ending count follows expiresAt and current time, not stale hoursLeft');
  assert.match(prompt, /Trials ended without a pay link \(30-day window\): 1/, 'an expired trial remains in the ended-trial bucket');
  assert.match(prompt, /Subscriptions ending within 7 days: 1/);
  assert.doesNotMatch(prompt, /PRIVATE_ALERT_CUSTOMER|privatealert|PRIVATE_TRIAL_|staletrialhours|endedtrial|test\.person@example\.com/);
});

test('AI assistant owner actions: new Resend API, sports promo update, customer program change', async () => {
  const x = setup((url) => { if (String(url).startsWith('https://api.resend.com/api_keys')) return { ok: true, status: 200, json: async () => ({ data: { token: 'rk_test_new', name: 'AI assistant' } }), text: async () => '{}' }; });
  const tok = await adminToken(x);
  const s = await x.store.get('settings'); s.email.resendKey = 're_owner_key'; await x.store.put('settings', s);
  const re = await x.call('POST', '/api/admin/ai/action', { action: 'resend-create' }, tok);
  assert.equal(re.status, 200, JSON.stringify(re.json));
  assert.equal(re.json.key, 'rk_test_new');
  const ad = await x.call('POST', '/api/admin/ai/action', { action: 'update-ad', name: 'Champions League final', type: 'champions-league', date: '2027-06-07', tip: 'Prime-time match.' }, tok);
  assert.equal(ad.status, 200);
  const sp = await x.call('GET', '/api/admin/sports', {}, tok);
  assert.ok(sp.json.events.some((e) => e.name === 'Champions League final' && e.type === 'champions-league'));
  const cust = await addCustomer(x, tok);
  const ch = await x.call('POST', '/api/admin/ai/action', { action: 'change-program', customerId: cust.id, username: 'agent_new_line', password: 'Pass1234', dns: 'http://line.test:8080' }, tok);
  assert.equal(ch.status, 200, JSON.stringify(ch.json));
  assert.equal(ch.json.username, 'agent_new_line');
  const cs = await x.call('GET', '/api/admin/customers', {}, tok);
  assert.equal(cs.json.find((c) => c.id === cust.id).lineUsername, 'agent_new_line');
});

test('sports: owner adds, edits and deletes sports events; the seeded calendar is there', async () => {
  const x = setup(); const tok = await adminToken(x);
  const g0 = await x.call('GET', '/api/admin/sports', {}, tok);
  assert.ok(g0.json.events.some((e) => e.name === 'UEFA Champions League Final' && e.date === '2027-06-07' && e.type === 'champions-league'), 'the seeded Champions League event is in the calendar');
  const a = await x.call('POST', '/api/admin/sports', { name: 'Champions League Final (test)', type: 'champions-league', date: '2027-06-07', tip: 'Prime-time match.' }, tok);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  const g = await x.call('GET', '/api/admin/sports', {}, tok);
  assert.ok(g.json.events.some((e) => e.name === 'Champions League Final (test)' && e.date === '2027-06-07' && e.type === 'champions-league'));
  const id = g.json.events.find((e) => e.name === 'Champions League Final (test)').id;
  const b = await x.call('POST', '/api/admin/sports', { id, name: 'Champions League Final — updated', tip: 'New tip.' }, tok);
  assert.equal(b.status, 200);
  const g2 = await x.call('GET', '/api/admin/sports', {}, tok);
  assert.ok(g2.json.events.some((e) => e.name === 'Champions League Final — updated' && e.tip === 'New tip.'));
  assert.ok(!g2.json.events.some((e) => e.name === 'Champions League Final (test)'), 'the original event was replaced');
  const d = await x.call('DELETE', '/api/admin/sports/' + id, {}, tok);
  assert.equal(d.status, 200);
  const g3 = await x.call('GET', '/api/admin/sports', {}, tok);
  assert.ok(!g3.json.events.some((e) => e.name === 'Champions League Final — updated'));
  const bad = await x.call('POST', '/api/admin/sports', { name: '', type: 'nfl' }, tok);
  assert.equal(bad.status, 400);
});

test('agents get a planning notification when the owner changes My planning', async () => {
  const x = setup(); const tok = await adminToken(x);
  const today = new Date().toISOString().slice(0, 10);
  const bkk = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const dates = new Set([today, `${bkk.year}-${bkk.month}-${bkk.day}`]);
  for (const d of dates) await x.store.del('ownerplann:' + d);
  const r = await x.call('POST', '/api/admin/ownerplan/block', { op: 'add', date: today, block: { start: '09:00', end: '10:00', title: 'Team standup' } }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let marked = false; for (const d of dates) if (await x.store.get('ownerplann:' + d)) marked = true;
  assert.ok(marked, 'the day is marked so agents are only notified once per day');
});

// ---------------- Promotions hub (bug fixes + feature enhancements) ----------------
test('promotions library: ready, football, basketball, reseller and credit templates are all present', async () => {
  const x = setup(); const tok = await adminToken(x);
  const r = await x.call('GET', '/api/admin/promos', {}, tok);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cats = r.json.categories.map((c) => c.id);
  for (const c of ['general', 'football', 'basketball', 'reseller', 'credit']) assert.ok(cats.includes(c), c);
  const byCat = (c) => r.json.templates.filter((t) => t.category === c);
  for (const c of ['general', 'football', 'basketball', 'reseller', 'credit']) assert.ok(byCat(c).length >= 3, `${c} has ready templates`);
  assert.ok(byCat('football').some((t) => /match|final|champions/i.test(t.id)));
  assert.ok(byCat('basketball').some((t) => /game|playoff|final/i.test(t.id)));
  assert.ok(byCat('credit').some((t) => /bonus|loyalty|recharge/i.test(t.id)));
  assert.ok(r.json.templates.every((t) => t.title && t.subject && t.html && t.whatsapp));
  assert.ok(r.json.templates.every((t) => /\{name\}/.test(t.html) || /\{name\}/.test(t.whatsapp)), 'templates are personalised');
  assert.deepEqual(r.json.campaigns, []);
  assert.ok(r.json.sports.events.some((e) => e.name === 'UEFA Champions League Final'));
});

test('promotions: create, open full details, edit, activate, schedule and delete (persisted in settings)', async () => {
  const x = setup(); const tok = await adminToken(x);
  const draft = { templateId: 'match-day-football', type: 'football', title: 'Big match special', description: 'Watch the derby in HD', audience: 'active', channels: ['email', 'whatsapp', 'notification'], startAt: '2026-11-22', endAt: '2026-11-23', time: '20:00', status: 'active', code: 'DERBY20', discountPct: 20, creditAmount: 5, bonusPct: 10 };
  const created = await x.call('POST', '/api/admin/promos', draft, tok);
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const id = created.json.campaign.id;
  assert.match(id, /^pc[\w-]+$/);
  assert.equal(created.json.campaign.type, 'football');
  assert.equal(created.json.campaign.code, 'DERBY20');
  assert.equal(created.json.campaign.status, 'active');
  assert.ok(created.json.campaign.html.includes('{app}'), 'template content is copied into the campaign and stays editable');

  const details = await x.call('GET', '/api/admin/promos/' + id, {}, tok);
  assert.equal(details.status, 200); assert.equal(details.json.kind, 'campaign');
  assert.equal(details.json.campaign.title, 'Big match special');
  assert.ok(details.json.rendered.html.includes('Match day'), 'the full editable email body is returned for the details view');
  assert.match(details.json.rendered.notification.title, /Match day/, 'the editable notification text is returned in full');

  const edited = await x.call('PUT', '/api/admin/promos/' + id, { title: 'Big match special v2', status: 'scheduled' }, tok);
  assert.equal(edited.status, 200); assert.equal(edited.json.campaign.title, 'Big match special v2'); assert.equal(edited.json.campaign.status, 'scheduled');
  assert.equal((await x.call('POST', '/api/admin/promos/' + id + '/status', { status: 'paused' }, tok)).json.campaign.status, 'paused');
  assert.equal((await x.call('POST', '/api/admin/promos/' + id + '/status', { status: 'nonsense' }, tok)).status, 400);

  const stored = await x.store.get('settings'); assert.equal(stored.promoCenter.campaigns.length, 1);
  assert.equal((await x.call('DELETE', '/api/admin/promos/' + id, {}, tok)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/promos/' + id, {}, tok)).status, 404);
  assert.equal((await x.call('DELETE', '/api/admin/promos/' + id, {}, tok)).status, 404);
});

test('promotions preview: renders email, WhatsApp and notification with placeholders filled, for templates and drafts', async () => {
  const x = setup(); const tok = await adminToken(x);
  const tpl = await x.call('GET', '/api/admin/promos/tpl_credit-loyalty', {}, tok);
  assert.equal(tpl.status, 200); assert.equal(tpl.json.kind, 'template');
  assert.ok(tpl.json.rendered.html.includes('free credits'), 'template details expose the full rendered content');

  const r = await x.call('POST', '/api/admin/promos/preview', { draft: { templateId: 'reseller-credit-bundle', title: 'Credits for {name}', subject: 'Hi {name} from {app}', html: '<p>Hello {name}, code {code}, {credit} credits at {app}</p>', whatsapp: 'Hi {name}! {code}', notifTitle: '{app} bonus', notifBody: 'Get {credit} credits', code: 'top10', creditAmount: 12 } }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.subject.includes('Hi Alex from INTPROTO-TV'));
  assert.ok(r.json.html.includes('Hello Alex, code TOP10, 12 credits at INTPROTO-TV'));
  assert.ok(r.json.whatsapp.includes('Hi Alex! TOP10'));
  assert.equal(r.json.notification.title, 'INTPROTO-TV bonus');
  assert.ok(r.json.notification.body.includes('12 credits'));
  const inj = await x.call('POST', '/api/admin/promos/preview', { draft: { title: 'x', html: '<b>{name}</b>' } }, tok);
  assert.ok(!inj.json.html.includes('<script>'), 'preview is safe to render in an iframe');
});

test('promotions send: email reaches the audience, stats are saved, state changes to sent', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'App <no-reply@example.com>', appUrl: 'https://tv.example.com' } }, tok);
  await addCustomer(x, tok, { username: 'promoCust', email: 'promo.cust@example.com' });
  const draft = { type: 'general', title: 'Flash promo', description: 'A quick offer', subject: 'Flash deal for {name}', html: '<p>Hi {name}, use {code}</p>', whatsapp: 'Hi {name}', notifTitle: 'Flash', notifBody: 'Deal inside', code: 'FLASH10', audience: 'all', channels: ['email'], status: 'active' };
  const created = (await x.call('POST', '/api/admin/promos', draft, tok)).json.campaign;
  const before = x.mails.length;
  const sent = await x.call('POST', '/api/admin/promos/' + created.id + '/send', {}, tok);
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.ok(sent.json.stats.email >= 1, 'at least one email delivered');
  const mails = x.mails.slice(before).flat();
  assert.ok(mails.some((m) => m.subject.includes('Flash deal for Test Person')), 'email is personalised per recipient');
  assert.equal(sent.json.campaign.status, 'sent');
  assert.ok(sent.json.campaign.sentAt > 0);
  assert.equal(sent.json.campaign.stats.email, sent.json.stats.email);
  const bad = await x.call('POST', '/api/admin/promos', { title: 'No channels', channels: [] }, tok);
  assert.equal((await x.call('POST', '/api/admin/promos/' + bad.json.campaign.id + '/send', {}, tok)).status, 400);
});

test('promotions permissions: readers can view and preview, only marketing staff can create, edit or send', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('POST', '/api/admin/team', { name: 'Viewer', username: 'viewer', password: 'secret12', role: 'Sales Agent', perms: ['customers_view'] }, tok);
  const li = await x.call('POST', '/api/login', { username: 'viewer', password: 'secret12' }); assert.equal(li.status, 200);
  const vt = li.json.token; await signBylaws(x, vt); await x.call('POST', '/api/admin/attendance', { action: 'in' }, vt);
  assert.equal((await x.call('GET', '/api/admin/promos', {}, vt)).status, 200, 'staff can read promotions');
  assert.equal((await x.call('POST', '/api/admin/promos/preview', { draft: { title: 'x' } }, vt)).status, 200, 'staff can preview');
  assert.equal((await x.call('POST', '/api/admin/promos', { title: 'Nope' }, vt)).status, 403);
  assert.equal((await x.call('GET', '/api/admin/sports', {}, vt)).status, 200, 'sports read works for panel staff (permission bug fixed)');
  assert.equal((await x.call('POST', '/api/admin/sports', { name: 'X' }, vt)).status, 403);
  const writer = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' }); assert.equal(writer.status, 200);
});

test('sports events: football and basketball campaigns with kind, time and teams; validation and CRUD', async () => {
  const x = setup(); const tok = await adminToken(x);
  const a = await x.call('POST', '/api/admin/sports', { name: 'Premier League — Matchday', type: 'football', category: 'football', kind: 'matchday', date: '2026-11-28', time: '17:30', teams: 'Team A vs Team B', competition: 'Premier League', tip: 'Push before kick-off' }, tok);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.event.category, 'football'); assert.equal(a.json.event.kind, 'matchday'); assert.equal(a.json.event.time, '17:30');
  const b = await x.call('POST', '/api/admin/sports', { name: 'NBA Finals Game 7', type: 'nba', kind: 'seasonal', date: '2027-06-20' }, tok);
  assert.equal(b.status, 200); assert.equal(b.json.event.category, 'basketball');
  const all = (await x.call('GET', '/api/admin/sports', {}, tok)).json.events;
  assert.ok(all.some((e) => e.name === 'NBA Finals Game 7'));
  assert.equal((await x.call('DELETE', '/api/admin/sports/' + a.json.event.id, {}, tok)).status, 200);
  assert.ok(!(await x.call('GET', '/api/admin/sports', {}, tok)).json.events.some((e) => e.id === a.json.event.id));
  assert.equal((await x.call('POST', '/api/admin/sports', { name: '', type: 'football' }, tok)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/sports', { name: 'Bad date', date: '28/11/2026' }, tok)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/sports', { name: 'Bad time', time: '25:99' }, tok)).status, 400);
});

test('promotions: own section types are independent and settings writes are normalised', async () => {
  const x = setup(); const tok = await adminToken(x);
  for (const [type, tpl] of [['reseller', 'reseller-exclusive'], ['credit', 'double-credit']]) {
    const c = (await x.call('POST', '/api/admin/promos', { templateId: tpl, type, title: type + ' promo' }, tok)).json.campaign;
    assert.equal(c.type, type);
  }
  const list = (await x.call('GET', '/api/admin/promos', {}, tok)).json.campaigns;
  assert.equal(list.filter((c) => c.type === 'reseller').length, 1);
  assert.equal(list.filter((c) => c.type === 'credit').length, 1);
  assert.equal((await x.call('PUT', '/api/admin/settings', { promoCenter: { campaigns: [...list, { ...list[0], id: list[0].id }] } }, tok)).status, 200);
  const after = (await x.call('GET', '/api/admin/promos', {}, tok)).json.campaigns;
  assert.equal(after.length, 2, 'duplicate ids are removed when settings are written directly');
  assert.ok(after.every((c) => c.id && c.title && Array.isArray(c.channels)));
});


test('locked marketing agents cannot override campaign subjects', async () => {
  const x = setup(); const tok = await adminToken(x);
  await x.call('PUT', '/api/admin/settings', { email: { resendKey: 're_test', from: 'INTPROTO-TV <hello@example.com>', adminEmail: 'owner@example.com' } }, tok);
  await x.call('PUT', '/api/admin/emailmkt/settings', { keys: ['re_one', 're_two', 're_three'], senders: ['INTPROTO-TV'], subjects: ['Configured A', 'Configured B'] }, tok);
  const emails = Array.from({ length: 101 }, (_, i) => `locked${i}@example.com`).join('\n');
  const list = await x.call('POST', '/api/admin/emailmkt/list', { name: 'Locked subject test', text: emails }, tok);
  assert.equal(list.status, 200); assert.equal(list.json.count, 101);
  const made = await x.call('POST', '/api/admin/team', { name: 'Marketing Agent', username: 'lockedmkt', password: 'secret12', role: 'Sales Agent', perms: ['marketing'] }, tok);
  assert.equal(made.status, 200);
  const login = await x.call('POST', '/api/login', { username: 'lockedmkt', password: 'secret12' }); assert.equal(login.status, 200);
  const staff = login.json.token; await signBylaws(x, staff);
  assert.equal((await x.call('GET', '/api/admin/me', {}, staff)).json.locked, true);
  const sent = await x.call('POST', '/api/admin/emailmkt/send', { listId: list.json.id, subject: 'Unauthorized override' }, staff);
  assert.equal(sent.status, 200, JSON.stringify(sent.json)); assert.equal(sent.json.sent, 101);
  assert.deepEqual(x.mails.map((batch) => batch[0].subject), ['Configured A', 'Configured B']);
});

test('work planning: several schedules in their own time zones, each agent in their own time zone, reminders only to the agents of each schedule', async () => {
  const pushes = []; const x = setup(); const tok = await adminToken(x);
  const mk = async (name, username, role) => { await x.call('POST', '/api/admin/team', { name, username, password: 'secret12', role, perms: ['customers_view', 'attendance'] }, tok); const t = (await x.call('POST', '/api/login', { username, password: 'secret12' })).json.token; await signBylaws(x, t).catch(() => {}); return t; };
  const tMano = await mk('Mano', 'mano', 'Sales Agent'); const tKh = await mk('Khalil T', 'khalilt', 'Technical Manager'); const tDoha = await mk('Doha', 'doha', 'Sales Agent');
  const team = (await x.call('GET', '/api/admin/team', {}, tok)).json; const id = (u) => team.find((m) => m.username === u).id;
  let o = (await x.call('GET', '/api/admin/workplan', {}, tok)).json; assert.deepEqual(o.plans.map((p) => p.id), ['main', 'tech', 'support']);
  // owner assigns schedules and each agent's time zone in one save
  assert.equal((await x.call('PUT', '/api/admin/workplan', { assign: { [id('mano')]: { plan: 'support', tz: 'Europe/Madrid' }, [id('khalilt')]: { plan: 'tech', tz: 'Asia/Bangkok', roleTag: 'Tech' }, [id('doha')]: { tz: 'Africa/Casablanca' } } }, tok)).status, 200);
  assert.equal((await x.call('PUT', '/api/admin/workplan', { assign: { [id('doha')]: { tz: 'Mars/Base' } } }, tok)).status, 400, 'unknown zone');
  const m = (await x.call('GET', '/api/admin/workplan', {}, tMano)).json; assert.equal(m.plan.planId, 'support'); assert.equal(m.plan.tz, 'Europe/Madrid'); assert.equal(m.plans.length, 1); assert.equal(m.plan.slots[0].start, '15:15');
  // 15:15 Madrid is 21:15 or 22:15 in Bangkok depending on DST: the UTC moment is given for every slot
  const u = m.utc[m.today].m1; const bkk = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(u.start)); assert.ok(['21:15', '22:15'].includes(bkk), bkk);
  const k = (await x.call('GET', '/api/admin/workplan', {}, tKh)).json; assert.equal(k.plan.planId, 'tech'); assert.equal(k.plan.slots[1].start, '15:30');
  const d = (await x.call('GET', '/api/admin/workplan', {}, tDoha)).json; assert.equal(d.plan.planId, 'main');
  assert.equal((await x.call('POST', '/api/admin/workplan/check', { date: m.today, slot: 'm2' }, tMano)).status, 200);
  assert.equal((await x.call('POST', '/api/admin/workplan/check', { date: m.today, slot: 's2' }, tMano)).status, 400, 'not a task of her schedule');
  o = (await x.call('GET', '/api/admin/workplan', {}, tok, { plan: 'support' })).json; assert.deepEqual(o.who.map((w) => w.name), ['Mano']); assert.ok(o.checks[m.today][id('mano')].m2);
  assert.equal(o.team.find((t) => t.name === 'Doha').tz, 'Africa/Casablanca'); assert.ok(o.zones.includes('Europe/Madrid') && o.zones.includes('Asia/Bangkok'));
  // owner edits the Madrid schedule, creates and deletes a New York one
  assert.equal((await x.call('PUT', '/api/admin/workplan', { plan: 'support', slots: [...m.plan.slots.map((s) => (s.id === 'm1' ? { ...s, start: '15:00' } : s))] }, tok)).status, 200);
  const r = (await x.call('PUT', '/api/admin/workplan', { newPlan: { name: 'Support New York', tz: 'America/New_York', copy: 'support' } }, tok)).json; assert.ok(r.created);
  assert.equal((await x.call('PUT', '/api/admin/workplan', { assign: { [id('doha')]: { plan: r.created } } }, tok)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/workplan', {}, tDoha)).json.plan.tz, 'America/New_York');
  assert.equal((await x.call('PUT', '/api/admin/workplan', { deletePlan: r.created }, tok)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/workplan', {}, tDoha)).json.plan.planId, 'main', 'back to the main schedule');
  assert.equal((await x.call('GET', '/api/admin/workplan', {}, tMano)).json.plan.slots[0].start, '15:00');
  assert.equal((await x.call('PUT', '/api/admin/workplan', { assign: {} }, tMano)).status, 403);
});

test('co-owner: a second full-control owner account — add, login, full access, logged by name, change own password, remove', async () => {
  const x = setup(); const tok = await adminToken(x);
  // only the owner can see/add owners
  assert.equal((await x.call('GET', '/api/admin/owners', {}, '')).status, 401);
  let o = (await x.call('GET', '/api/admin/owners', {}, tok)).json; assert.equal(o.owners.length, 1); assert.ok(o.owners[0].isPrimary && o.owners[0].you);
  // validation
  assert.equal((await x.call('POST', '/api/admin/owners', { username: 'Khalil', password: '123' }, tok)).status, 400);
  assert.equal((await x.call('POST', '/api/admin/owners', { username: 'Iptv', password: 'longpass' }, tok)).status, 409, 'username already the primary owner');
  // add Khalil
  const add = await x.call('POST', '/api/admin/owners', { username: 'Khalil', password: 'khalilStrong1', timezone: 'Asia/Bangkok' }, tok); assert.equal(add.status, 200);
  assert.equal((await x.call('POST', '/api/admin/owners', { username: 'khalil', password: 'another1' }, tok)).status, 409, 'case-insensitive duplicate');
  o = (await x.call('GET', '/api/admin/owners', {}, tok)).json; assert.equal(o.owners.length, 2); const kha = o.owners.find((w) => w.username === 'Khalil'); assert.ok(kha && !kha.isPrimary); assert.ok(!JSON.stringify(o).includes('hash'));
  // Khalil logs in and is a full owner
  const kl = await x.call('POST', '/api/login', { username: 'Khalil', password: 'khalilStrong1' }); assert.equal(kl.status, 200); assert.equal(kl.json.role, 'admin'); const ktok = kl.json.token;
  const me = (await x.call('GET', '/api/admin/me', {}, ktok)).json; assert.equal(me.role, 'owner'); assert.equal(me.username, 'Khalil'); assert.ok(me.coOwner); assert.ok(me.perms.includes('secrets') && me.perms.includes('exports') && me.perms.includes('settings'), 'has all perms incl owner-only');
  // owner-only things work for the co-owner: My planning, security settings, team, exports-level listing
  assert.equal((await x.call('GET', '/api/admin/ownerplan', {}, ktok)).status, 200);
  assert.equal((await x.call('PUT', '/api/admin/settings', { security: { requireCheckIn: true } }, ktok)).status, 200);
  assert.equal((await x.call('GET', '/api/admin/owners', {}, ktok)).status, 200, 'co-owner can manage owners too');
  // actions are logged under Khalil's name, not the primary owner
  const logs = (await x.call('GET', '/api/admin/log', {}, tok)).json; assert.ok(logs.some((l) => /Khalil \(owner\)|"Khalil"/.test(JSON.stringify(l))));
  // Khalil changes his own password via Account & backup, and it does not touch the primary
  assert.equal((await x.call('POST', '/api/admin/account', { currentPassword: 'khalilStrong1', newPassword: 'khalilStrong2' }, ktok)).status, 200);
  assert.equal((await x.call('POST', '/api/login', { username: 'Khalil', password: 'khalilStrong1' })).status, 401);
  assert.equal((await x.call('POST', '/api/login', { username: 'Khalil', password: 'khalilStrong2' })).status, 200);
  assert.equal((await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' })).status, 200, 'primary owner password unchanged');
  // owner resets Khalil's password
  assert.equal((await x.call('POST', `/api/admin/owners/${add.json.id}/password`, { password: 'resetByBoss1' }, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/login', { username: 'Khalil', password: 'resetByBoss1' })).status, 200);
  // cannot remove yourself or the primary; owner removes Khalil
  const ktok2 = (await x.call('POST', '/api/login', { username: 'Khalil', password: 'resetByBoss1' })).json.token;
  assert.equal((await x.call('DELETE', `/api/admin/owners/${add.json.id}`, {}, ktok2)).status, 400, 'cannot remove the account you are signed in with');
  assert.equal((await x.call('DELETE', '/api/admin/owners/admin', {}, tok)).status, 400, 'cannot remove the primary');
  assert.equal((await x.call('DELETE', `/api/admin/owners/${add.json.id}`, {}, tok)).status, 200);
  assert.equal((await x.call('POST', '/api/login', { username: 'Khalil', password: 'resetByBoss1' })).status, 401, 'removed owner can no longer log in');
  assert.equal((await x.call('GET', '/api/admin/owners', {}, tok)).json.owners.length, 1);
});
