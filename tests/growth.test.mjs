import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMOS,
  promoEligibility,
  applyPromoToReseller,
  sampleImage,
  adsTemplates,
  adsPanelHtml,
  resellerSampleData,
  resellerSampleHtml,
  domainAccountFields,
  domainAccountHtml,
  agentPermissionPreset,
} from '../public/growth.js';

const BF_NOW = Date.parse('2026-11-25T12:00:00.000Z');

test('all promos are proposed defaults with the required fields', () => {
  assert.deepEqual(Object.keys(PROMOS).sort(), ['blackFriday', 'fourForFive', 'manager']);
  for (const p of Object.values(PROMOS)) {
    assert.equal(p.status, 'proposed-default');
    for (const key of ['id', 'title', 'terms', 'start', 'end', 'bonusCredits', 'bonusDays', 'discountPct']) {
      assert.ok(Object.hasOwn(p, key), `missing ${key}`);
    }
  }
  assert.equal(PROMOS.fourForFive.bonusCredits, 1);
  assert.equal(PROMOS.blackFriday.bonusDays, 30);
  assert.equal(PROMOS.manager.discountPct, 10);
});

test('fourForFive passes at 4 purchases and fails at 3', () => {
  const ok = promoEligibility({ role: 'reseller', purchaseCount: 4, credits: 4, promoId: 'fourForFive', now: BF_NOW });
  assert.equal(ok.ok, true);
  assert.equal(ok.bonusCredits, 1);
  const low = promoEligibility({ role: 'reseller', purchaseCount: 3, credits: 3, promoId: 'fourForFive', now: BF_NOW });
  assert.equal(low.ok, false);
  assert.match(low.reason, /4 completed credit purchases/);
  assert.equal(promoEligibility({ role: 'customer', purchaseCount: 9, credits: 9, promoId: 'fourForFive', now: BF_NOW }).ok, false);
});

test('redeemed promo cannot be reused and inputs are not mutated', () => {
  const redeemed = ['fourForFive'];
  const before = JSON.stringify(redeemed);
  const r = promoEligibility({ role: 'reseller', purchaseCount: 4, credits: 4, promoId: 'fourForFive', redeemed, now: BF_NOW });
  assert.equal(r.ok, false);
  assert.match(r.reason, /already redeemed/i);
  assert.equal(JSON.stringify(redeemed), before);
});

test('blackFriday fails outside its window', () => {
  const before = Date.parse('2026-11-19T23:59:59.999Z');
  const after = Date.parse('2026-12-03T00:00:00.000Z');
  assert.equal(promoEligibility({ role: 'owner', credits: 10, promoId: 'blackFriday', now: before }).ok, false);
  assert.equal(promoEligibility({ role: 'manager', credits: 10, promoId: 'blackFriday', now: after }).ok, false);
  assert.equal(promoEligibility({ role: 'manager', credits: 10, promoId: 'blackFriday', now: BF_NOW }).ok, true);
  assert.equal(promoEligibility({ role: 'reseller', credits: 10, promoId: 'blackFriday', now: BF_NOW }).ok, false);
});

test('applyPromoToReseller does not mutate and adds a ledger entry', () => {
  const reseller = { role: 'reseller', credits: 4, purchaseCount: 4, redeemedPromos: [], ledger: [], planExpiresAt: 0 };
  const snapshot = JSON.stringify(reseller);
  const out = applyPromoToReseller(reseller, 'fourForFive', BF_NOW);
  assert.equal(out.ok, true);
  assert.equal(JSON.stringify(reseller), snapshot, 'input mutated');
  assert.equal(out.reseller.credits, 5);
  assert.deepEqual(out.reseller.redeemedPromos, ['fourForFive']);
  assert.equal(out.reseller.ledger.length, 1);
  assert.equal(out.reseller.ledger[0].at, BF_NOW);
  assert.equal(out.reseller.ledger[0].type, 'promo');
  assert.equal(out.reseller.ledger[0].promoId, 'fourForFive');
  assert.match(out.reseller.ledger[0].note, /\+1 credits/);
  assert.equal(applyPromoToReseller(out.reseller, 'fourForFive', BF_NOW).ok, false);
  const expiry = applyPromoToReseller({ role: 'manager', credits: 10, purchaseCount: 2, planExpiresAt: BF_NOW }, 'blackFriday', BF_NOW);
  assert.equal(expiry.ok, true);
  assert.equal(expiry.reseller.planExpiresAt, BF_NOW + 30 * 86400000);
  const discount = applyPromoToReseller({ role: 'owner', credits: 10, purchaseCount: 2 }, 'manager', BF_NOW);
  assert.equal(discount.reseller.discountPct, 10);
  assert.equal(applyPromoToReseller(reseller, 'unknown', BF_NOW).ok, false);
});

test('sampleImage produces a self-contained inline SVG data URI', () => {
  const uri = sampleImage('Test label', '#abcdef');
  assert.match(uri, /^data:image\/svg\+xml/);
  assert.doesNotMatch(uri, /https?:\/\//);
  assert.match(decodeURIComponent(uri), /Test label/);
});

test('adsTemplates has at least 10 examples covering all five platforms', () => {
  const all = adsTemplates();
  assert.ok(all.length >= 10, `only ${all.length} templates`);
  for (const p of ['Google Ads', 'Facebook Ads', 'Reddit', 'Quora', 'Facebook Groups']) {
    assert.ok(all.some((t) => t.platform === p), `missing ${p}`);
  }
  for (const t of all) {
    for (const key of ['id', 'platform', 'title', 'body', 'cta', 'image']) assert.ok(t[key], `${t.id}: missing ${key}`);
    assert.match(t.image, /^data:image\/svg\+xml/);
    assert.match(t.body, /INTPROTO-TV/);
    assert.doesNotMatch(t.body + t.image, /(sk_live|rk_live|api[_-]?key\s*=)/i);
  }
});

test('rendered HTML escapes <script> in values', () => {
  const payload = '<script>alert(1)</script>';
  const ad = adsTemplates()[0];
  assert.match(adsPanelHtml(), /data-act="ad-copy"/);
  assert.match(adsPanelHtml(), /class="ads-grid"/);
  assert.match(adsPanelHtml(), /<img src="data:image\/svg\+xml/);
  assert.match(adsPanelHtml(), /role="tablist"/);
  const sample = resellerSampleData();
  assert.ok(sample.credits > sample.usedCredits);
  const sampleHtml = resellerSampleHtml();
  assert.match(sampleHtml, /class="sample-app"/);
  assert.match(sampleHtml, /Credits available/);
  assert.doesNotMatch(sampleHtml, /<script>/);
  const safeSample = resellerSampleHtml();
  assert.ok(safeSample.includes('42'));
  const domainHtml = domainAccountHtml({ name: payload, email: payload, domain: payload, taxId: payload });
  assert.match(domainHtml, /class="domain-grid"/);
  assert.match(domainHtml, /data-act="domain-save"/);
  assert.match(domainHtml, /data-act="domain-pay"/);
  assert.match(domainHtml, /Provider and price pending confirmation/);
  assert.doesNotMatch(domainHtml, /<script>/);
  assert.match(domainHtml, /&lt;script&gt;/);
  for (const method of ['stripe', 'balance', 'manual']) assert.match(domainHtml, new RegExp(`value="${method}"`));
});

test('domainAccountFields and agentPermissionPreset expose required fields/permissions', () => {
  assert.deepEqual(domainAccountFields().map((f) => f.name), ['name', 'company', 'email', 'phone', 'domain', 'taxId']);
  for (const f of domainAccountFields()) {
    for (const key of ['label', 'type', 'required', 'autocomplete']) assert.ok(Object.hasOwn(f, key));
  }
  const fields = domainAccountFields();
  fields[0].name = 'mutated';
  assert.equal(domainAccountFields()[0].name, 'name', 'field descriptors leaked');
  const preset = agentPermissionPreset();
  assert.ok(preset.includes('marketing'));
  assert.ok(preset.includes('ads'));
  assert.deepEqual(preset, ['customers_view', 'customers_edit', 'marketing', 'ads', 'finance_view']);
});
