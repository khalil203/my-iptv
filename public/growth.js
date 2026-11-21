export const PROMOS = Object.freeze({
  fourForFive: Object.freeze({
    id: 'fourForFive',
    title: '4 for 5 reseller credits',
    terms: 'Pay for 4 credits and get +1 bonus credit. Once per reseller, after 4 completed credit purchases.',
    start: '2026-01-01',
    end: '2027-12-31',
    bonusCredits: 1,
    bonusDays: 0,
    discountPct: 0,
    status: 'proposed-default',
  }),
  blackFriday: Object.freeze({
    id: 'blackFriday',
    title: 'Black Friday manager gift',
    terms: 'During the promo window, active managers and owners get +1 month of manager subscription. Once per account.',
    start: '2026-11-20',
    end: '2026-12-02',
    bonusCredits: 0,
    bonusDays: 30,
    discountPct: 0,
    status: 'proposed-default',
  }),
  manager: Object.freeze({
    id: 'manager',
    title: 'Manager subscription launch discount',
    terms: 'Managers and owners get 10% off the manager subscription. Once per account.',
    start: '2026-01-01',
    end: '2027-12-31',
    bonusCredits: 0,
    bonusDays: 0,
    discountPct: 10,
    status: 'proposed-default',
  }),
});

// 20 Nov 2026 upgrades: rewards are free days for the referrer, never a price change for the buyer.
export const REFERRAL_TIERS = Object.freeze({
  y1: Object.freeze({ id: 'y1', days: 30, label: '30 days · 1-year plan', plan: '1-year · 1 device', devices: 1, price: 0, note: 'One month free for the referrer when a friend takes a 1-year plan.' }),
  y1d2: Object.freeze({ id: 'y1d2', days: 90, label: '90 days · 2-device 1-year ($109.99)', plan: '2-device 1-year', devices: 2, price: 109.99, note: 'Three months free for the referrer on the 2-device 1-year plan.' }),
  y1d4: Object.freeze({ id: 'y1d4', days: 180, label: '180 days · 4-device 1-year ($139.99)', plan: '4-device 1-year', devices: 4, price: 139.99, note: 'Six months free for the referrer on the 4-device 1-year plan.' }),
});

export const CUSTOMER_OFFERS = Object.freeze([
  Object.freeze({ id: 'free1', days: 30, months: 1, discountPct: 0, label: '1 month free', title: '1 month free', note: 'A free month on an eligible annual plan.' }),
  Object.freeze({ id: 'free3', days: 90, months: 3, discountPct: 0, label: '3 months free', title: '3 months free', note: 'Three free months on an eligible annual plan.' }),
  Object.freeze({ id: 'free6', days: 180, months: 6, discountPct: 0, label: '6 months free', title: '6 months free', note: 'Six free months on an eligible annual plan.' }),
  Object.freeze({ id: 'discount10', days: 0, months: 0, discountPct: 10, label: '10% discount', title: '10% discount', note: '10% off an eligible plan.' }),
  Object.freeze({ id: 'discount20', days: 0, months: 0, discountPct: 20, label: '20% discount', title: '20% discount', note: '20% off an eligible plan.' }),
]);

export const RESELLER_OFFERS = Object.freeze([
  Object.freeze({ id: 'discount10', days: 0, months: 0, discountPct: 10, label: '10% discount', title: '10% discount on credit packs', note: 'Reseller credit packs only.' }),
  Object.freeze({ id: 'discount20', days: 0, months: 0, discountPct: 20, label: '20% discount', title: '20% discount on credit packs', note: 'Reseller credit packs only.' }),
]);

export const LIFETIME_PLANS = Object.freeze([
  Object.freeze({ id: 'life1', name: 'Lifetime Standard', title: 'Lifetime Standard · 1 Device', devices: 1, price: 499.95, badge: '🏆 Lifetime', fixed: true }),
  Object.freeze({ id: 'life4', name: 'Lifetime VIP', title: 'Lifetime VIP · 4 Devices', devices: 4, price: 999.95, badge: '🏆 Lifetime', fixed: true }),
]);

export function isLifetimePackage(pkg) {
  const p = pkg && typeof pkg === 'object' ? pkg : {};
  const id = String(typeof pkg === 'string' ? pkg : (p.id || p.packageId || p.pkg || '')).trim().toLowerCase();
  return id === 'life1' || id === 'life4' || p.lifetime === true || p.kind === 'lifetime';
}

const REFERRAL_PACKAGE_KEYS = Object.freeze({
  y1: 'y1', y1d1: 'y1', s1y: 'y1', p12: 'y1', p12d1: 'y1',
  y1d2: 'y1d2', s1y2d: 'y1d2', p12d2: 'y1d2',
  y1d4: 'y1d4', s1y4d: 'y1d4', p12d4: 'y1d4',
});
const REFERRAL_DEVICE_KEYS = Object.freeze({ 1: 'y1', 2: 'y1d2', 4: 'y1d4' });
export function referralTierForPackage(pkg) {
  if (isLifetimePackage(pkg)) return null;
  const p = pkg && typeof pkg === 'object' ? pkg : {};
  const id = String(typeof pkg === 'string' ? pkg : (p.id || p.packageId || p.pkg || '')).trim().toLowerCase();
  let key = REFERRAL_PACKAGE_KEYS[id] || '';
  const annual = Number(p.days) === 365 || Number(p.days) === 366 || /1\s*(?:year|yr)|12\s*months/i.test(String(p.title || p.name || ''));
  if (!key && annual) key = REFERRAL_DEVICE_KEYS[Number(p.devices || p.connections || 1)] || '';
  if (!key && annual && id) key = REFERRAL_DEVICE_KEYS[Number(id.match(/d([1-4])$/)?.[1] || id.match(/([1-4])d$/)?.[1] || 0)] || '';
  return REFERRAL_TIERS[key] || null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLES = new Set(['reseller', 'manager', 'owner', 'customer', 'user', 'admin']);

function promoWindow(promo, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const start = Date.parse(`${promo.start}T00:00:00.000Z`);
  const end = Date.parse(`${promo.end}T23:59:59.999Z`);
  return t >= start && t <= end;
}

export function promoEligibility({
  role = '',
  credits = 0,
  purchaseCount = 0,
  promoId = '',
  redeemed = [],
  now = Date.now(),
} = {}) {
  const promo = PROMOS[promoId];
  const result = {
    ok: false,
    bonusCredits: 0,
    bonusDays: 0,
    discountPct: 0,
    reason: '',
    terms: promo ? promo.terms : '',
  };
  if (!promo) {
    result.reason = 'Unknown promotion';
    return result;
  }
  const normalizedRole = String(role || '').toLowerCase();
  if (!ROLES.has(normalizedRole)) {
    result.reason = 'Unknown account role';
    return result;
  }
  if (!Number.isFinite(purchaseCount) || purchaseCount < 0) {
    result.reason = 'Invalid purchase count';
    return result;
  }
  if (!Number.isFinite(credits) || credits < 0) {
    result.reason = 'Invalid credit balance';
    return result;
  }
  if (Array.isArray(redeemed) && redeemed.includes(promoId)) {
    result.reason = 'Promotion already redeemed';
    return result;
  }
  if (!promoWindow(promo, now)) {
    result.reason = 'Promotion is outside its active window';
    return result;
  }
  const isPaying = purchaseCount > 0 || credits > 0;
  if (promoId === 'fourForFive') {
    if (normalizedRole !== 'reseller') {
      result.reason = 'Reseller account required';
      return result;
    }
    if (purchaseCount < 4) {
      result.reason = '4 completed credit purchases required';
      return result;
    }
  } else if (promoId === 'manager') {
    if (!['manager', 'owner'].includes(normalizedRole)) {
      result.reason = 'Manager or owner account required';
      return result;
    }
    if (!isPaying) {
      result.reason = 'An active paid subscription is required';
      return result;
    }
  } else if (promoId === 'blackFriday') {
    if (!['manager', 'owner'].includes(normalizedRole)) {
      result.reason = 'Manager or owner account required';
      return result;
    }
    if (!isPaying) {
      result.reason = 'An active paid account is required';
      return result;
    }
  }
  result.ok = true;
  result.bonusCredits = promo.bonusCredits;
  result.bonusDays = promo.bonusDays;
  result.discountPct = promo.discountPct;
  return result;
}

export function applyPromoToReseller(reseller, promoId, now = Date.now()) {
  const source = reseller && typeof reseller === 'object' ? reseller : {};
  const redeemed = Array.isArray(source.redeemedPromos) ? [...source.redeemedPromos] : [];
  const elig = promoEligibility({
    role: source.role || 'reseller',
    credits: source.credits || 0,
    purchaseCount: source.purchaseCount || 0,
    promoId,
    redeemed,
    now,
  });
  if (!elig.ok) return { ok: false, reseller: source, reason: elig.reason };

  const next = { ...source };
  const ledger = Array.isArray(source.ledger) ? [...source.ledger] : [];
  const promo = PROMOS[promoId];
  if (elig.bonusCredits) next.credits = (Number(source.credits) || 0) + elig.bonusCredits;
  if (elig.bonusDays) {
    const base = Number(source.planExpiresAt);
    const start = Number.isFinite(base) && base > now ? base : now;
    next.planExpiresAt = start + elig.bonusDays * DAY_MS;
  }
  if (elig.discountPct) next.discountPct = elig.discountPct;
  next.redeemedPromos = [...redeemed, promoId];
  ledger.push({
    at: now,
    type: 'promo',
    promoId,
    note: `${promo.title}: ${elig.bonusCredits ? `+${elig.bonusCredits} credits; ` : ''}${elig.bonusDays ? `+${elig.bonusDays} days; ` : ''}${elig.discountPct ? `${elig.discountPct}% discount` : ''}`.replace(/; $/, '') || promo.title,
  });
  next.ledger = ledger;
  return { ok: true, reseller: next, reason: '' };
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function sampleImage(label, color = '#22D3EE') {
  const text = esc(label).slice(0, 80);
  const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#22D3EE';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${text}"><rect width="640" height="360" rx="24" fill="#07131e"/><rect x="18" y="18" width="604" height="324" rx="18" fill="none" stroke="${safeColor}" stroke-width="3"/><circle cx="110" cy="180" r="52" fill="${safeColor}" opacity="0.28"/><path d="M96 150l42 30-42 30z" fill="${safeColor}"/><text x="190" y="170" fill="#f8fafc" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="700">INTPROTO-TV</text><text x="190" y="212" fill="${safeColor}" font-family="Arial,Helvetica,sans-serif" font-size="24">${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function adsTemplates() {
  const make = (id, platform, title, body, cta, imageLabel, color) => ({
    id,
    platform,
    title,
    body,
    cta,
    image: sampleImage(imageLabel, color),
  });
  return [
    make('g-search-live', 'Google Ads', 'Live TV in seconds', 'Stream live international channels on any device with INTPROTO-TV. No dish, no long contract, no buffering. Start watching in under two minutes with a free trial.', 'Start free trial', 'Live TV in seconds', '#22D3EE'),
    make('g-search-sports', 'Google Ads', 'Every match, every screen', 'Never miss kickoff. INTPROTO-TV brings live sports and premium channels to your phone, tablet, TV and browser. One subscription, all your screens.', 'See channels', 'Live sports', '#34D399'),
    make('g-display-value', 'Google Ads', 'Cut the cable bill', 'Replace the cable box with INTPROTO-TV. Thousands of channels, on-demand shows and an electronic guide for one simple monthly price.', 'Compare plans', 'Cut the cable bill', '#FBBF24'),
    make('fb-feed-family', 'Facebook Ads', 'TV everyone can watch', 'Give the whole household its own screen. INTPROTO-TV works on smart TVs, phones and tablets at the same time, with parental controls and an easy guide.', 'Try it free', 'TV for everyone', '#F472B6'),
    make('fb-feed-trial', 'Facebook Ads', 'Two minutes to your first channel', 'No technician, no installation. Pick a plan, open the app and start streaming live TV with INTPROTO-TV today. Cancel any time.', 'Get the app', '2-minute setup', '#60A5FA'),
    make('fb-reels-sports', 'Facebook Ads', 'Match day, sorted', 'From local derbies to global leagues, INTPROTO-TV puts live sports in your pocket. Share the big game on the biggest screen when you get home.', 'Watch live now', 'Match day sorted', '#A78BFA'),
    make('reddit-review', 'Reddit', 'Honest setup review: INTPROTO-TV', 'I tested INTPROTO-TV for a week across a smart TV, a phone and a laptop. Channel switching was quick, the guide was accurate and the picture stayed sharp. Here is the full breakdown of the plans and setup.', 'Read the breakdown', 'Setup review', '#FB923C'),
    make('reddit-comparison', 'Reddit', 'Cable vs IPTV: what I actually saved', 'I replaced my cable package with INTPROTO-TV and kept the channels I watch most. No equipment rental, no appointment and I can pause my subscription when I travel.', 'See my cost breakdown', 'Cable vs IPTV', '#4ADE80'),
    make('quora-best', 'Quora', 'What is the easiest way to stream live TV?', 'A good option is INTPROTO-TV: it offers live channels, an on-demand library and a guide in one app. It runs on most smart TVs and mobile devices, so setup takes minutes rather than days.', 'Explore INTPROTO-TV', 'Easiest live TV', '#38BDF8'),
    make('quora-value', 'Quora', 'Is IPTV worth it in 2026?', 'If you want more channels without extra hardware, INTPROTO-TV is worth comparing. Check the channel list for your region, then try the free trial on your own connection before committing.', 'Check availability', 'Is IPTV worth it?', '#FACC15'),
    make('fb-group-deals', 'Facebook Groups', 'Deal for the group: free trial', 'Hi everyone — INTPROTO-TV is offering a free trial for new users this week. Hundreds of live channels, on-demand titles and multi-device streaming. Happy to answer questions about setup.', 'Claim free trial', 'Group free trial', '#F472B6'),
    make('fb-group-tip', 'Facebook Groups', 'Weekend viewing guide', 'Here is a simple weekend tip: load the INTPROTO-TV guide on Friday, add your favourite channels to favourites and you are ready for sports, movies and news all weekend with no extra setup.', 'Open the guide', 'Weekend guide', '#818CF8'),
  ];
}

export function adsPanelHtml() {
  const templates = adsTemplates();
  const platforms = [...new Set(templates.map((t) => t.platform))];
  const tabs = platforms
    .map((p, i) => `<button type="button" class="ads-tab" role="tab" id="ads-tab-${i}" aria-selected="${i === 0 ? 'true' : 'false'}" aria-controls="ads-panel-${i}" data-platform="${esc(p)}">${esc(p)}</button>`)
    .join('');
  const panels = platforms
    .map((p, i) => {
      const cards = templates
        .filter((t) => t.platform === p)
        .map((t) => `<article class="ad-card" data-id="${esc(t.id)}"><img src="${esc(t.image)}" alt="" loading="lazy" width="640" height="360"><h4>${esc(t.title)}</h4><p>${esc(t.body)}</p><p class="ad-cta">${esc(t.cta)}</p><button type="button" data-act="ad-copy" data-id="${esc(t.id)}">Copy ${esc(t.platform)} example</button></article>`)
        .join('');
      return `<section class="ads-panel" role="tabpanel" id="ads-panel-${i}" aria-labelledby="ads-tab-${i}"${i === 0 ? '' : ' hidden'}>${cards}</section>`;
    })
    .join('');
  return `<section class="ads-panel-wrap" aria-label="Advertising examples"><h3>Ad examples &amp; templates</h3><div class="ads-tabs" role="tablist" aria-label="Ad platforms">${tabs}</div><div class="ads-grid">${panels}</div></section>`;
}

export function resellerSampleData() {
  return {
    credits: 42,
    usedCredits: 18,
    orders: 37,
    customers: 24,
    expiry: '2027-11-20',
    revenue: 1284.5,
  };
}

export function resellerSampleHtml() {
  const s = resellerSampleData();
  const remaining = s.credits - s.usedCredits;
  return `<section class="sample-app" aria-label="Reseller sample app"><h3>Reseller sample — business snapshot</h3><div class="sample-metrics"><p>Credits available: <strong>${esc(remaining)}</strong> of ${esc(s.credits)}</p><p>Credits used: <strong>${esc(s.usedCredits)}</strong></p><p>Orders: <strong>${esc(s.orders)}</strong></p><p>Customers: <strong>${esc(s.customers)}</strong></p><p>Plan expires: <strong>${esc(s.expiry)}</strong></p><p>Revenue: <strong>$${esc(s.revenue.toFixed(2))}</strong></p></div><p>Demo data only — replace with live reseller figures when the API is connected.</p></section>`;
}

const DOMAIN_FIELDS = [
  { name: 'name', label: 'Full name', type: 'text', required: true, autocomplete: 'name' },
  { name: 'company', label: 'Company', type: 'text', required: false, autocomplete: 'organization' },
  { name: 'email', label: 'Email address', type: 'email', required: true, autocomplete: 'email' },
  { name: 'phone', label: 'Phone number', type: 'tel', required: false, autocomplete: 'tel' },
  { name: 'domain', label: 'Domain', type: 'text', required: false, autocomplete: 'url' },
  { name: 'taxId', label: 'Tax ID / VAT', type: 'text', required: false, autocomplete: 'off' },
];

export function domainAccountFields() {
  return DOMAIN_FIELDS.map((f) => ({ ...f }));
}

export function domainAccountHtml(values = {}) {
  const v = values && typeof values === 'object' ? values : {};
  const fields = domainAccountFields()
    .map((f) => `<label for="domain-${esc(f.name)}">${esc(f.label)}</label><input id="domain-${esc(f.name)}" name="${esc(f.name)}" type="${esc(f.type)}" autocomplete="${esc(f.autocomplete)}" value="${esc(v[f.name] ?? '')}"${f.required ? ' required' : ''}>`)
    .join('');
  const payment = `<label for="domain-payment">Payment method</label><select id="domain-payment" name="paymentMethod"><option value="stripe">Stripe</option><option value="balance">Balance</option><option value="manual">Manual</option></select>`;
  return `<form class="domain-grid" aria-label="Domain and account settings">${fields}${payment}<p class="domain-note">Provider and price pending confirmation</p><button type="button" data-act="domain-save">Save details</button><button type="button" data-act="domain-pay">Pay</button></form>`;
}

export function agentPermissionPreset() {
  return ['customers_view', 'customers_edit', 'marketing', 'ads', 'finance_view'];
}
