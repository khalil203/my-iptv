import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_SETTINGS,
  REFERRAL_REWARD_TABLE,
  referralRewardDays,
  visibleGifts,
  ownerPlanMonths,
  OWNERPLAN_END_MONTH,
  LIFETIME_PACKAGE_IDS,
} from '../public/core.js';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('referral reward tiers match the 20 Nov 2026 brief', () => {
  assert.deepEqual(REFERRAL_REWARD_TABLE, { y1: 30, y1d2: 90, y1d4: 180 });
  assert.equal(referralRewardDays({ id: 'p12', days: 365, devices: 1 }), 30);
  assert.equal(referralRewardDays({ id: 'p12d2', days: 365, devices: 2 }), 90);
  assert.equal(referralRewardDays({ id: 'p12d4', days: 365, devices: 4 }), 180);
  assert.equal(referralRewardDays({ id: 's1y2d', price: 109.99, days: 365, devices: 2 }), 90);
  assert.equal(referralRewardDays({ id: 's1y4d', price: 139.99, days: 365, devices: 4 }), 180);
  assert.equal(referralRewardDays({ id: 'life1', days: 36500, devices: 1 }), 0);
  assert.equal(referralRewardDays({ id: 'life4', days: 36500, devices: 4 }), 0);
});

test('lifetime fixed prices exist in default plans and order packages', () => {
  const s = DEFAULT_SETTINGS();
  assert.deepEqual(LIFETIME_PACKAGE_IDS, ['life1', 'life4']);
  const p1 = s.plans.find((p) => p.id === 'life1');
  const p4 = s.plans.find((p) => p.id === 'life4');
  assert.ok(p1 && p4, 'lifetime plans present');
  assert.equal(p1.price, 499.95);
  assert.equal(p1.connections, 1);
  assert.equal(p4.price, 999.95);
  assert.equal(p4.connections, 4);
  assert.equal(p1.lifetime, true);
  assert.equal(p4.lifetime, true);
  const o1 = s.orderPackages.find((p) => p.id === 'life1');
  const o4 = s.orderPackages.find((p) => p.id === 'life4');
  assert.ok(o1 && o4, 'lifetime order packages present');
  assert.equal(o1.price, 499.95);
  assert.equal(o1.devices, 1);
  assert.equal(o4.price, 999.95);
  assert.equal(o4.devices, 4);
});

test('default referral config and gift visibility filtering', () => {
  const s = DEFAULT_SETTINGS();
  assert.equal(s.referral.on, true);
  assert.deepEqual(s.referral.rewards, { y1: 30, y1d2: 90, y1d4: 180 });
  assert.equal(s.referral.maxFreeDays, 365);

  const cg = visibleGifts(s, 'customer');
  assert.ok(cg.some((g) => Number(g.months) >= 1), 'customers can see free months');
  assert.ok(cg.some((g) => Number(g.discountPct) >= 10), 'customers can see a discount');

  const rg = visibleGifts(s, 'reseller');
  assert.ok(rg.length > 0, 'resellers see offers');
  for (const g of rg) {
    assert.equal(Number(g.months), 0, 'resellers must never see free months');
    assert.ok(Number(g.discountPct) > 0, 'reseller offers should be discounts');
  }
  // visibleGifts must never leak a customer-only free-month entry into reseller view
  const mixed = visibleGifts({ gifts: { reseller: [{ id: 'x', title: 'X', months: 3, discountPct: 0 }] } }, 'reseller');
  assert.equal(mixed[0].months, 0);
});

test('owner planning is scheduled through December 2027', () => {
  assert.equal(OWNERPLAN_END_MONTH, '2027-12');
  const m = ownerPlanMonths('2026-11-20');
  assert.equal(m.months[0], '2026-11');
  assert.equal(m.months[m.months.length - 1], '2027-12');
  assert.equal(m.last, '2027-12-31');
  const late = ownerPlanMonths('2028-05-01');
  assert.equal(late.months[late.months.length - 1], '2027-12');
});

test('marketing drafts are cleared on session changes and late responses are ignored', () => {
  const app = read('public/app.js');
  const session = app.match(/function setSession\(token, role\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(session, 'setSession handler exists');
  assert.match(session, /sessionGeneration \+= 1/);
  assert.match(session, /state\.admin\.mktDraft = null; state\.admin\.mktComposer = null;/);

  const apiAction = app.match(/async function api\(method, path, body\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(apiAction, 'API helper exists');
  assert.match(apiAction, /const requestToken = state\.token/);
  assert.match(apiAction, /state\.token === requestToken && requestSession === sessionGeneration/);

  const draftAction = app.match(/async 'mkt-ai'\(f\) \{([\s\S]*?)\n  \},/)?.[1];
  assert.ok(draftAction, 'marketing AI action exists');
  assert.match(draftAction, /const requestSession = sessionGeneration/);
  assert.match(draftAction, /const requestId = \+\+marketingDraftRequestId/);
  const staleGuard = draftAction.indexOf('if (requestSession !== sessionGeneration || requestId !== marketingDraftRequestId) return;');
  const draftWrite = draftAction.indexOf('state.admin.mktDraft = r;');
  assert.ok(staleGuard >= 0 && staleGuard < draftWrite, 'stale and superseded responses are rejected before the draft is restored');
});

test('docs mention the new referral, lifetime and planning rules', () => {
  const admin = read('docs/admin-guide.md');
  const user = read('docs/user-guide.md');
  const readme = read('README.md');
  const brief = read('docs/developer-brief.md');
  const plan = read('docs/upgrade-plan.md');
  for (const [name, text] of Object.entries({ admin, readme, brief, plan })) {
    assert.match(text, /499\.95/, `${name} should mention lifetime 1-device price`);
    assert.match(text, /999\.95/, `${name} should mention lifetime 4-device price`);
  }
  for (const [name, text] of Object.entries({ admin, readme, brief })) {
    assert.match(text, /December 2027/i, `${name} should mention planning through December 2027`);
  }
  assert.match(plan, /Dec 2027|2027-12/, 'upgrade plan should track planning through Dec 2027');
  assert.match(admin, /90 days/i, 'admin guide should mention 90-day referral reward');
  assert.match(admin, /180 days/i, 'admin guide should mention 180-day referral reward');
  assert.match(user, /2-device 1-year/i, 'user guide should mention 2-device 1-year referral tier');
  assert.match(brief, /## New upgrade — 20 Nov 2026/, 'developer brief should have the new upgrade section');
  assert.match(plan, /Phase E/, 'upgrade plan should track Phase E');
});
