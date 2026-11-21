// Focused backend checks for the referral programme, gifts, fixed Lifetime pricing and owner-planning sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createBackend, DEFAULT_SETTINGS, REFERRAL_REWARD_ROWS, referralRewardDays, visibleGifts, ownerPlanMonths, stripeSign } from '../public/core.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

function setup() {
  const db = new Map(); const mails = []; const calls = [];
  const store = { get: async (k) => { const v = db.get(k); if (!v) return null; if (v.e && v.e < Date.now()) { db.delete(k); return null; } return JSON.parse(v.v); }, put: async (k, v, ttl) => { db.set(k, { v: JSON.stringify(v), e: ttl ? Date.now() + ttl * 1000 : 0 }); }, del: async (k) => { db.delete(k); } };
  const fetchFn = async (url, init) => {
    calls.push(url);
    if (String(url).includes('api.resend.com')) { mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'm1' }) }; }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  };
  db.set('settings', { v: JSON.stringify({ security: { force2fa: false, captcha: false, requireCheckIn: false } }), e: 0 });
  const be = createBackend({ store, fetchFn, mode: 'server' });
  const call = (method, path, body, token, query) => be.handle({ method, path, body: body || {}, token, query: query || {} });
  return { db, store, mails, calls, be, call };
}
async function adminToken(x) { const r = await x.call('POST', '/api/login', { username: 'Iptv', password: 'Iptv' }); assert.equal(r.status, 200); return r.json.token; }
async function login(x, username) { const r = await x.call('POST', '/api/login', { username, password: 'secret12' }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.token; }
async function signBylaws(x, token) { const r = await x.call('POST', '/api/admin/bylaws/sign', { name: 'Test Staff Member' }, token); assert.equal(r.status, 200); }
async function addCustomer(x, tok, o) {
  const r = await x.call('POST', '/api/admin/customers', { name: o.name || o.username, password: 'secret12', email: o.email, planId: 'p1', ...o }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customer;
}
async function codeFor(x, tok, id) {
  return (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.id === id).refCode;
}
async function earnedBy(x, username) {
  const t = await login(x, username);
  return (await x.call('GET', '/api/me/referral', {}, t)).json.earned;
}

test('referral helpers: reward table, 1/2/4-device annual plans, 3 devices and Lifetime earn nothing', () => {
  assert.deepEqual(REFERRAL_REWARD_ROWS.map((r) => r.days), [30, 90, 180]);
  assert.equal(referralRewardDays({ id: 'p12', days: 365, devices: 1 }), 30);
  assert.equal(referralRewardDays({ id: 'p12d2', days: 365, devices: 2 }), 90);
  assert.equal(referralRewardDays({ id: 'p12d4', days: 365, devices: 4 }), 180);
  assert.equal(referralRewardDays({ id: 'p12d3', days: 365, devices: 3 }), 0);
  assert.equal(referralRewardDays({ id: 'life4', days: 36500, devices: 4 }), 0);
  assert.equal(referralRewardDays({ id: 'p12', days: 365, devices: 1 }, { y1: 7 }), 7);
});

test('gifts and planning helpers: role-filtered gift data and months through December 2027', () => {
  const s = DEFAULT_SETTINGS();
  const customer = visibleGifts(s, 'customer');
  assert.deepEqual(customer.map((g) => g.id), ['free1', 'free3', 'free6', 'discount10', 'discount20']);
  assert.deepEqual(customer.map((g) => g.days), [30, 90, 180, 0, 0]);
  assert.deepEqual(customer.map((g) => g.months), [1, 3, 6, 0, 0]);
  assert.deepEqual(customer.map((g) => g.pct), [0, 0, 0, 10, 20]);
  assert.ok(customer.every((g) => g.label && g.days >= 0 && g.months >= 0 && g.pct >= 0));
  const reseller = visibleGifts(s, 'reseller');
  assert.deepEqual(reseller.map((g) => g.id), ['discount10', 'discount20']);
  assert.ok(reseller.every((g) => g.days === 0 && g.months === 0 && g.pct > 0));
  const range = ownerPlanMonths('2026-11-20');
  assert.equal(range.first, '2026-11-01');
  assert.equal(range.last, '2027-12-31');
  assert.ok(range.months.includes('2027-12'));
});

test('referral codes: generated, applied once, and exposed with the reward table in the customer panel', async () => {
  const x = setup(); const tok = await adminToken(x);
  const ref = await addCustomer(x, tok, { username: 'shareowner', email: 'share@example.com', planId: 'p12' });
  const other = await addCustomer(x, tok, { username: 'othercode', email: 'other@example.com', planId: 'p1' });
  const buyer = await addCustomer(x, tok, { username: 'codebuyer', email: 'buyer@example.com', planId: 'p12' });
  const rows = (await x.call('GET', '/api/admin/customers', {}, tok)).json;
  const code = rows.find((c) => c.id === ref.id).refCode;
  const otherCode = rows.find((c) => c.id === other.id).refCode;
  assert.match(code, /^[A-HJ-NP-Z2-9]{6,8}$/);
  const refTok = await login(x, 'shareowner'); const buyerTok = await login(x, 'codebuyer');
  const info = (await x.call('GET', '/api/me/referral', {}, refTok)).json;
  assert.equal(info.code, code);
  assert.deepEqual(info.rewardTable.map((r) => r.days), [30, 90, 180]);
  assert.equal(info.earned, 0);
  assert.equal(info.config.maxFreeDays, 365);
  assert.ok(info.link.includes(code));
  assert.equal((await x.call('POST', '/api/me/referral/apply', { code }, buyerTok)).status, 200);
  assert.equal((await x.call('POST', '/api/me/referral/apply', { code: code.toLowerCase() }, buyerTok)).json.already, true);
  assert.equal((await x.call('POST', '/api/me/referral/apply', { code: otherCode }, buyerTok)).status, 409);
  assert.equal((await x.call('POST', '/api/me/referral/apply', { code }, refTok)).status, 400);
  const after = (await x.call('GET', '/api/me/referral', {}, refTok)).json;
  assert.equal(after.referred, 1);
  assert.equal(after.earned, 0);
  assert.equal((await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.id === buyer.id).referredBy, ref.id);
});

test('admin referral settings and manual awards are validated, capped and idempotent', async () => {
  const x = setup(); const tok = await adminToken(x);
  const ref = await addCustomer(x, tok, { username: 'refboss', email: 'boss@example.com', planId: 'p12' });
  const code = (await x.call('GET', '/api/admin/customers', {}, tok)).json.find((c) => c.id === ref.id).refCode;
  const buyer = await addCustomer(x, tok, { username: 'buyerboss', email: 'buyerboss@example.com', planId: 'p12d4', ref: code });
  const cfg = (await x.call('GET', '/api/admin/referral', {}, tok)).json;
  assert.deepEqual(cfg.rewardTable.map((r) => r.days), [30, 90, 180]);
  assert.equal(cfg.stats.referred, 1);
  assert.equal((await x.call('PUT', '/api/admin/referral', { maxFreeDays: 366 }, tok)).status, 400);
  assert.equal((await x.call('PUT', '/api/admin/referral', { rewards: { y1d4: 400 } }, tok)).status, 400);
  assert.equal((await x.call('PUT', '/api/admin/referral', { rewards: { y1d4: 90 }, maxFreeDays: 120 }, tok)).status, 200);
  const award = await x.call('POST', '/api/admin/referral/award', { referredId: buyer.id, pkgId: 'p12d4' }, tok);
  assert.equal(award.status, 200, JSON.stringify(award.json));
  assert.equal(award.json.days, 90);
  assert.equal(award.json.code, code);
  assert.equal((await x.call('POST', '/api/admin/referral/award', { referredId: buyer.id, pkgId: 'p12d4' }, tok)).status, 409);
  const refTok = await login(x, 'refboss');
  const after = (await x.call('GET', '/api/me/referral', {}, refTok)).json;
  assert.equal(after.earned, 90);
  assert.equal(after.remainingDays, 30);
  assert.ok(after.awards.some((a) => a.referredId === buyer.id && a.pkgId === 'p12d4'));
  const buyer2 = await addCustomer(x, tok, { username: 'buyercap', email: 'cap@example.com', planId: 'p12d4', ref: code });
  await x.call('PUT', '/api/admin/referral', { maxFreeDays: 50 }, tok);
  const capped = await x.call('POST', '/api/admin/referral/award', { referredId: buyer2.id, pkgId: 'p12d4' }, tok);
  assert.equal(capped.status, 400);
  assert.match(capped.json.error, /limit/i);
  assert.equal((await x.call('GET', '/api/me/referral', {}, refTok)).json.earned, 90);
});

test('gifts, Lifetime prices and owner-planning sync are role-filtered and sanitised', async () => {
  const x = setup(); const tok = await adminToken(x);
  x.db.set('ownerplan', { v: JSON.stringify({ tz: 'Asia/Bangkok', updatedAt: 123, blocks: [{ id: 'renewal', v: [{ from: '2026-01-01', title: 'Review re_ABCDEFGHIJKLMNOPQRST', icon: '📌', rule: 'weekly', days: [1], dom: 1, note: 'Private owner note' }] }], checkoffs: { '2026-11-20': { renewal: true } } }), e: 0 });
  await x.call('POST', '/api/admin/team', { name: 'Agent Amy', username: 'amy', password: 'secret12', role: 'Support Agent', perms: ['customers_view'] }, tok);
  const staffTok = await login(x, 'amy'); await signBylaws(x, staffTok);
  const gifts = (await x.call('GET', '/api/config/gifts')).json;
  assert.deepEqual(gifts.customer.map((g) => g.id), ['free1', 'free3', 'free6', 'discount10', 'discount20']);
  assert.ok(gifts.reseller.every((g) => g.days === 0 && g.months === 0 && g.pct > 0));
  const cust = await addCustomer(x, tok, { username: 'giftbuyer', email: 'gift@example.com', planId: 'p12' });
  const me = (await x.call('GET', '/api/me', {}, await login(x, cust.username))).json;
  assert.equal(me.gifts.length, 5);
  const cfg = (await x.call('GET', '/api/config')).json;
  const life = cfg.orderPackages.find((p) => p.id === 'life4');
  assert.equal(life.title, 'Lifetime VIP · 4 Devices');
  assert.equal(life.price, 999.95);
  assert.equal(life.badge, '🏆 Lifetime');
  assert.equal(life.kind, 'lifetime');
  const sync = await x.call('GET', '/api/admin/ownerplan/sync', {}, staffTok);
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
  const body = JSON.stringify(sync.json);
  assert.ok(sync.json.result.months.includes('2027-12'));
  assert.equal(sync.json.result.last, '2027-12-31');
  assert.equal(sync.json.result.plan[0].id, 'renewal');
  assert.ok(sync.json.result.agents.some((a) => a.username === 'amy'));
  assert.ok(!body.includes('re_'));
  assert.ok(!body.includes('checkoffs'));
  assert.ok(!body.includes('Private owner note'));
  assert.equal((await x.call('POST', '/api/admin/ownerplan/notify-agents', {}, staffTok)).status, 403);
  const notify = await x.call('POST', '/api/admin/ownerplan/notify-agents', {}, tok);
  assert.equal(notify.status, 200, JSON.stringify(notify.json));
  assert.equal(notify.json.sent, 2);
});

test('auto referral: paid Stripe annual payment rewards the referrer once; duplicate events do not', async () => {
  const x = setup(); const tok = await adminToken(x);
  const ref = await addCustomer(x, tok, { username: 'refstripe', email: 'refstripe@example.com', planId: 'p1' });
  const code = await codeFor(x, tok, ref.id);
  const buyer = await addCustomer(x, tok, { username: 'stripebuyer', email: 'stripebuyer@example.com', planId: 'p1', ref: code });
  assert.ok(buyer.id);
  const secret = 'whsec_ref_test';
  await x.call('PUT', '/api/admin/settings', { finance: { stripeWebhookSecrets: secret } }, tok);
  const event = (ev, cs) => JSON.stringify({ id: ev, type: 'checkout.session.completed', data: { object: {
    id: cs, payment_status: 'paid', amount_total: 10999, currency: 'usd',
    client_reference_id: buyer.id, customer_details: { email: 'stripebuyer@example.com' }, metadata: { package: 's1y2d' },
  } } });
  const raw = event('evt_ref_a', 'cs_ref_a');
  const r = await x.call('POST', '/api/stripe/webhook', { raw, sig: await stripeSign(raw, secret) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.result, 'activated');
  assert.equal(await earnedBy(x, 'refstripe'), 90);
  const again = event('evt_ref_b', 'cs_ref_a'); // same payment, new Stripe event id
  const r2 = await x.call('POST', '/api/stripe/webhook', { raw: again, sig: await stripeSign(again, secret) });
  assert.equal(r2.json.result, 'duplicate');
  assert.equal(await earnedBy(x, 'refstripe'), 90);
});

test('auto referral: receipt approval rewards annual tiers; Lifetime, non-referred and re-approval do not', async () => {
  const x = setup(); const tok = await adminToken(x);
  const ref = await addCustomer(x, tok, { username: 'refreceipt', email: 'refreceipt@example.com', planId: 'p1' });
  const code = await codeFor(x, tok, ref.id);
  await addCustomer(x, tok, { username: 'receiptbuyer', email: 'receiptbuyer@example.com', planId: 'p1', ref: code });
  const u = await login(x, 'receiptbuyer');
  await x.call('POST', '/api/me/agree', {}, u);
  const image = 'data:image/jpeg;base64,' + 'A'.repeat(300);
  assert.equal((await x.call('POST', '/api/me/receipt', { pkg: 's1y4d', image }, u)).status, 200);
  const rc = (await x.call('GET', '/api/admin/receipts', {}, tok)).json[0];
  const ok = await x.call('POST', '/api/admin/receipts/decide', { id: rc.id, action: 'approve' }, tok);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(await earnedBy(x, 'refreceipt'), 180);
  assert.equal((await x.call('POST', '/api/admin/receipts/decide', { id: rc.id, action: 'approve' }, tok)).status, 400);
  assert.equal(await earnedBy(x, 'refreceipt'), 180);

  await addCustomer(x, tok, { username: 'lifebuyer', email: 'lifebuyer@example.com', planId: 'p1', ref: code });
  const lu = await login(x, 'lifebuyer');
  await x.call('POST', '/api/me/agree', {}, lu);
  assert.equal((await x.call('POST', '/api/me/receipt', { pkg: 'life4', image }, lu)).status, 200);
  const lifeRc = (await x.call('GET', '/api/admin/receipts', {}, tok)).json[0];
  assert.equal((await x.call('POST', '/api/admin/receipts/decide', { id: lifeRc.id, action: 'approve' }, tok)).status, 200);
  assert.equal(await earnedBy(x, 'refreceipt'), 180, 'Lifetime packages never earn referral days');

  await addCustomer(x, tok, { username: 'plainbuyer', email: 'plainbuyer@example.com', planId: 'p1' });
  const pu = await login(x, 'plainbuyer');
  await x.call('POST', '/api/me/agree', {}, pu);
  assert.equal((await x.call('POST', '/api/me/receipt', { pkg: 's1y', image }, pu)).status, 200);
  const plainRc = (await x.call('GET', '/api/admin/receipts', {}, tok)).json[0];
  assert.equal((await x.call('POST', '/api/admin/receipts/decide', { id: plainRc.id, action: 'approve' }, tok)).status, 200);
  assert.equal(await earnedBy(x, 'refreceipt'), 180, 'a buyer without a code earns nothing');
});

test('auto referral: paid admin new/renewal annual plans award once and block manual duplicates', async () => {
  const x = setup(); const tok = await adminToken(x);
  const ref = await addCustomer(x, tok, { username: 'refadmin', email: 'refadmin@example.com', planId: 'p1' });
  const code = await codeFor(x, tok, ref.id);
  const first = await addCustomer(x, tok, { username: 'newannual', email: 'newannual@example.com', planId: 'p12', price: 69.99, ref: code });
  assert.equal(await earnedBy(x, 'refadmin'), 30);
  const second = await addCustomer(x, tok, { username: 'renewannual', email: 'renewannual@example.com', planId: 'p1', ref: code });
  const rn = await x.call('POST', `/api/admin/customers/${second.id}/renew`, { planId: 'p12d2', price: 109.99 }, tok);
  assert.equal(rn.status, 200, JSON.stringify(rn.json));
  assert.equal(await earnedBy(x, 'refadmin'), 120);
  assert.equal((await x.call('POST', '/api/admin/referral/award', { referredId: first.id, pkgId: 'p12' }, tok)).status, 409, 'auto and manual awards share the same dedupe record');
});
