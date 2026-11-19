// core.js — shared backend logic.
// Runs inside the Cloudflare Worker (real mode) and inside the browser (demo mode).

const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const uid = (n = 16) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); };
const DAY = 86400000;

export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 5000 }, key, 256);
  return hex(bits);
}

const keyCache = new Map();
async function hmac(secret, msg) {
  let k = keyCache.get(secret);
  if (!k) {
    k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(secret, k);
  }
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg))).slice(0, 32);
}
export async function makeProxyToken(secret, id, hours = 12) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  return `${id}.${exp}.${await hmac(secret, id + '.' + exp)}`;
}
export async function verifyProxyToken(secret, t) {
  const [id, exp, sig] = String(t || '').split('.');
  if (!id || !exp || !sig || +exp < Date.now() / 1000) return false;
  return (await hmac(secret, id + '.' + exp)) === sig;
}

// Rewrites every URL inside an HLS playlist so segments also go through the proxy.
export function rewriteM3U8(text, base, wrap) {
  return text.split(/\r?\n/).map((line) => {
    const l = line.trim();
    if (!l) return line;
    if (l.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(new URL(u, base).href)}"`);
    return wrap(new URL(l, base).href);
  }).join('\n');
}

export const DEFAULT_SETTINGS = () => ({
  branding: {
    appName: 'INTPROTO-TV',
    tagline: 'Live TV · Movies · Series',
    logoUrl: 'logo.png',
    primary: '#FF6B42',
    accent: '#19D5B1',
    background: '#0B0B0F',
    loginTitle: 'Welcome back',
    loginSubtitle: 'Sign in with the login details you received.',
    loginBgUrl: '',
    supportLabel: 'Contact support',
    supportUrl: '',
    whatsapp: '', // WhatsApp number with country code, digits only (shows the green WhatsApp button)
    telegram: '', // private support Telegram handle, without @ (support and payment links go here in a private chat)
    telegramChannel: '', // public Telegram channel used only for marketing, promos and announcements (no payments)
    footerText: '',
  },
  userDashboard: {
    live: true, movies: true, series: true, epg: true, search: true, favorites: true, ownPlaylists: true,
    showSubscription: true, allowPasswordChange: true, expiryWarningDays: 7,
    announcement: '', announcementType: 'info',
    maintenance: false, maintenanceMessage: 'We are updating the service. Please come back soon.',
  },
  player: { serverUrl: '', useProxy: true, userAgent: 'IPTVSmartersPro', mode: 'proxy', relayUrl: '' },
  reseller: {
    enabled: false, autoSync: true,
    baseUrl: '', apiKey: '', username: '', password: '',
    idPath: 'id', creditsPath: 'credits', usernamePath: '', passwordPath: '', dnsPath: '',
    actions: {
      create: { method: 'GET', url: '{base}/api.php?api_key={key}&action=create_line&username={username}&password={password}&package={package}&max_connections={connections}', body: '', headers: '' },
      renew: { method: 'GET', url: '{base}/api.php?api_key={key}&action=extend_line&id={line_id}&package={package}', body: '', headers: '' },
      enable: { method: 'GET', url: '{base}/api.php?api_key={key}&action=enable_line&id={line_id}', body: '', headers: '' },
      disable: { method: 'GET', url: '{base}/api.php?api_key={key}&action=disable_line&id={line_id}', body: '', headers: '' },
      delete: { method: 'GET', url: '{base}/api.php?api_key={key}&action=delete_line&id={line_id}', body: '', headers: '' },
      credits: { method: 'GET', url: '{base}/api.php?api_key={key}&action=get_credits', body: '', headers: '' },
      trial: { method: 'GET', url: '{base}/api.php?api_key={key}&action=create_line&username={username}&password={password}&package={package}&max_connections=1&trial=1', body: '', headers: '' },
    },
  },
  plans: [
    { id: 'p1', name: '1 Month', days: 30, price: 29.99, connections: 1, package: '1', credits: 1 },
    { id: 'p3', name: '3 Months', days: 90, price: 49.99, connections: 1, package: '2', credits: 3 },
    { id: 'p6', name: '6 Months', days: 180, price: 59.99, connections: 1, package: '3', credits: 6 },
    { id: 'p12', name: '1 Year', days: 365, price: 69.99, connections: 1, package: '1', credits: 12 },
    { id: 'p24', name: '2 Years', days: 730, price: 99.99, connections: 1, package: '4', credits: 24 },
    { id: 'p12d2', name: '2 Devices · 1 Year', days: 365, price: 109.99, connections: 2, package: '3', credits: 24 },
    { id: 'p12d3', name: '3 Devices · 1 Year', days: 365, price: 129.99, connections: 3, package: '4', credits: 36 },
    { id: 'p12d4', name: '4 Devices · 1 Year', days: 365, price: 139.99, connections: 4, package: '4', credits: 48 },
  ],
  currency: 'USD',
  resellerPackages: [
    { id: 'r5', name: 'Starter', credits: 5, price: 149.99 },
    { id: 'r10', name: 'Basic', credits: 10, price: 280.99 },
    { id: 'r20', name: 'Standard', credits: 20, price: 499.99 },
    { id: 'r30', name: 'Premium', credits: 30, price: 630.99 },
    { id: 'r50', name: 'VIP', credits: 50, price: 999.99 },
  ],
  resellerCurrency: 'EUR',
  // How resellers can pay (shown on intproto-tv.store/rsl when they order credits). The payment link / details are sent after the order.
  resellerPayMethods: ['PayPal', 'Card (payment link)', 'USDT (crypto)', 'Bank transfer'],
  // Storefront packages (spec §3): IBO Player activations + multi-device yearly plans.
  orderPackages: [
    { id: 's1m', title: '1 Month', days: 30, devices: 1, price: 29.99, badge: '', link: '' },
    { id: 's3m', title: '3 Months', days: 90, devices: 1, price: 49.99, badge: '', link: '' },
    { id: 's6m', title: '6 Months', days: 180, devices: 1, price: 59.99, badge: '', link: '' },
    { id: 's1y', title: '1 Year', days: 365, devices: 1, price: 69.99, badge: '⭐ Best Seller', link: '' },
    { id: 's2y', title: '2 Years', days: 730, devices: 1, price: 99.99, badge: '', link: '' },
    { id: 's1y2d', title: '2 Devices · 1 Year', days: 365, devices: 2, price: 109.99, badge: '⭐ Best Value', link: '' },
    { id: 's1y3d', title: '3 Devices · 1 Year', days: 365, devices: 3, price: 129.99, badge: '', link: '' },
    { id: 's1y4d', title: '4 Devices · 1 Year', days: 365, devices: 4, price: 139.99, badge: '', link: '' },
    { id: 'ibo1y', title: 'IBO Player · 1 Year', days: 365, devices: 1, price: 5.99, badge: '', link: '' },
    { id: 'ibolife', title: 'IBO Player · Lifetime', days: 36500, devices: 1, price: 11.98, badge: '⭐ Lifetime activation', link: '' },
  ],
  orderCurrency: 'EUR',
  waTemplates: {}, // custom WhatsApp templates: { pay: { en, fr, ar }, login: {...}, renew: {...} }
  // Seasonal promotion (Black Friday). When it is on and today is between the dates, the code is added to renewal emails,
  // WhatsApp / Telegram messages for renewals, trials and orders, and it is ready as a newsletter and a Telegram channel post.
  // Order numbers: next number = highest number used in the series + 1 (one shared counter, like the Google Sheet: WLF-139, IBO-142 → next 143).
  orders: { prefix: 'WLF', iboPrefix: 'IBO', rslPrefix: 'RLS', series: 'WLF,IBO,RLS', pad: 3, devPad: 2 },
  currencyRule: { on: true },
  // Public support page intproto-tv.store/support: details first, then the ticket. Agents with a work email get an alert at once.
  support: { email: 'contact@intproto-tv.com', waLink: true, alertEmails: '' }, // USD everywhere, EUR for Europe (email ending, then phone code)
  promo: { on: false, name: 'Black Friday', code: 'BLACKFRIDAY', offer: '', from: '2026-11-17', to: '2026-12-01', email: true, whatsapp: true, telegram: true },
  renewalOffer: { title: '2-Device, 1-Year Subscription', price: '$109.99', bonus: 'Including 2 FREE Months', coupon: 'LION001', url: 'https://intproto-tv.com', auto: true, autoDays: 3, dailyLimit: 90 },
  trial: { enabled: true, hours: 24, credits: 0, package: '', connections: 1, showCredentialsOnScreen: false, mode: 'auto', notifyAdmin: true },
  // Free-trial Telegram dispatch: the customer presses Start in the bot, then the trial login can be sent to the chat automatically.
  telegram: { enabled: false, botToken: '', botUsername: '', adminChat: '', autoTrial: true, notifyAdmin: true, webhookSecret: '' },
  email: { lang: 'en', resendKey: '', from: '', adminEmail: '', appUrl: '', expiryReminders: true, reminderDays: 3, lowCreditAlerts: true, dns: '', supportEmail: '', website: '' },
  finance: {
    autoRates: true, ratesUpdatedAt: 0,
    rates: { USD: 1, USDT: 1, MAD: 9.3, EUR: 0.86, THB: 32.5 },
    accounts: [
      { id: 'cih', name: 'CIH Bank', currency: 'MAD', opening: 0, color: '#e4572e' },
      { id: 'mercury', name: 'Mercury', currency: 'USD', opening: 0, color: '#5b6cff' },
      { id: 'cashplus', name: 'Cash Plus', currency: 'MAD', opening: 0, color: '#f4b400' },
      { id: 'okx', name: 'OKX', currency: 'USDT', opening: 0, color: '#9aa0b8' },
      { id: 'binance', name: 'Binance', currency: 'USDT', opening: 0, color: '#f0b90b' },
      { id: 'relay', name: 'Relay', currency: 'USD', opening: 0, color: '#22c55e' },
      { id: 'wise', name: 'Wise', currency: 'USD', opening: 0, color: '#9fe870' },
      { id: 'redotpay', name: 'RedotPay', currency: 'USDT', opening: 0, color: '#ef4444' },
      { id: 'stripe', name: 'Stripe', currency: 'USD', opening: 0, color: '#635bff' },
    ],
    stripeKey: '', stripeAccountId: 'stripe', stripeWebhookSecrets: '', // one signing secret (whsec_…) per Stripe account, one per line
  },
  // Multi-account Stripe control panel (spec §6): status, payout schedule, package links, optional read-only key for live balances.
    stripeAccounts: [
      { id: 'grenapp', name: 'GreenApp Host LLC', currency: 'USD', status: 'active', payoutDays: 2, note: '2-day payout · funds to Mercury on Day 3, 20:38 Thailand time', rk: '', links: [], bankId: 'mercury', balance: 102.52, balanceAt: Date.now() },
    { id: 'waffim', name: 'Wafinaccounting LLC', currency: 'USD', status: 'active', payoutDays: 7, note: '', rk: '', links: [], balance: 0, balanceAt: Date.now() },
    { id: 'avixcloud', name: 'Avixcloud LLC', currency: 'USD', status: 'active', payoutDays: 7, note: '', rk: '', links: [], balance: 0, balanceAt: Date.now() },
    { id: 'bussalion', name: 'Bussalion LLC', currency: 'USD', status: 'active', payoutDays: 7, note: '', rk: '', links: [], balance: 0, balanceAt: Date.now() },
    { id: 'zabi', name: 'Zabi', currency: 'USD', status: 'active', payoutDays: 7, note: '', rk: '', links: [], balance: 0, balanceAt: Date.now() },
  ],
  stock: { packCredits: 120, packPrice: 90, lowCreditsAlert: 20 },
  alerts: { expiringDays: 7, expiredDays: 30, trialHours: 12, hide: {} }, // customer alerts page
  mailTexts: {}, // owner's own wording for emails: { MAIL|AM|RM|OM: { en|fr|ar: { key: text } } }
  waCustom: [], // extra WhatsApp messages the owner added: { id, name, text: { en, fr, ar } }
  security: { sessionHours: 72, proxySecret: '' },
});

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
export function deepMerge(a, b) {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = isObj(a[k]) && isObj(b[k]) ? deepMerge(a[k], b[k]) : b[k];
  return out;
}
export const getPath = (o, p) => String(p || '').split('.').filter(Boolean).reduce((x, k) => (x == null ? x : x[k]), o);
const fill = (tpl, vars, encode) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => {
  const v = vars[k] == null ? '' : String(vars[k]);
  return encode && k !== 'base' ? encodeURIComponent(v) : v;
});
const trimSlash = (u) => String(u || '').trim().replace(/\/+$/, '');

// Math captcha for customer/reseller sign-in (spec §2) — no external keys needed.
async function captchaChallenge(s) {
  const a = 1 + Math.floor(Math.random() * 8), b = 2 + Math.floor(Math.random() * 8);
  const id = `${a}.${b}.${Date.now() + 300000}`;
  const sig = (await hmac(s.security.proxySecret, 'cap:' + id)).slice(0, 24);
  return { id: `${id}.${sig}`, q: `${a} + ${b} = ?` };
}
async function captchaVerify(s, body) {
  if (s.security.captcha === false) return true;
  const m = String(body.captchaId || '').match(/^(\d+)\.(\d+)\.(\d+)\.([a-f0-9]+)$/);
  if (!m) return false;
  const [, a, b, exp, sig] = m;
  if (Number(exp) < Date.now()) return false;
  if ((await hmac(s.security.proxySecret, `cap:${a}.${b}.${exp}`)).slice(0, 24) !== sig) return false;
  return Number(body.captchaAnswer) === Number(a) + Number(b);
}

const XTREAM_ACTIONS = new Set([
  'get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_vod_info',
  'get_series_categories', 'get_series', 'get_series_info', 'get_short_epg',
]);

// Permission registry: [key, label, module]. The module is only for grouping in the UI.
export const PERMS = [
  ['customers_view', 'See customers & subscriptions', 'Customers'],
  ['customers_edit', 'Add, edit, renew, enable/disable customers', 'Customers'],
  ['customers_delete', 'Delete customers', 'Customers'],
  ['customers_phone', 'See customer phone & WhatsApp numbers', 'Customers'],
  ['disputes', 'Disputes & escalations tracker', 'Customers'],
  ['finance_view', 'See banks & balances', 'Finance'],
  ['finance_edit', 'Add income, expenses, transfers', 'Finance'],
  ['profits', 'See revenue & profits', 'Finance'],
  ['stripe', 'Stripe accounts, payout schedules & payment links', 'Finance'],
  ['stock', 'Credits stock (see & buy)', 'Finance'],
  ['plans', 'Edit plans & prices', 'Finance'],
  ['ibo', 'IBO Player panel & credits', 'Products'],
  ['marketing', 'Email marketing, lists & campaigns', 'Marketing'],
  ['templates_edit', 'Create & edit email/WhatsApp templates (Marketing)', 'Marketing'],
  ['seo', 'SEO & social media tasks', 'Marketing'],
  ['ads', 'Google Ads & Facebook Ads dashboards', 'Marketing'],
  ['tasks', 'Task list & weekly planning', 'Team'],
  ['attendance', 'Own attendance, shifts & leave', 'Team'],
  ['attendance_all', 'See the whole team attendance & reports', 'Team'],
  ['settings', 'App settings (API, branding, trial, email, user dashboard)', 'System'],
  ['activity', 'See activity log', 'System'],
  ['secrets', 'API keys, email accounts (Resend), hosting (Hostinger) & domains (Dynu) — see and edit', 'System'],
  // Owner-only modules: they can never be granted to a team member.
  ['exports', 'Export or download any data (Excel, CSV, JSON)', 'System'],
  ['calls', 'Call management & call logs', 'System'],
  ['master_sheets', 'Master Google Sheets dashboard', 'System'],
];
export const PERM_MODULES = [...new Set(PERMS.map((p) => p[2]))];
// Nothing in here can be handed to staff, whatever the owner ticks in the UI.
export const OWNER_ONLY = ['exports', 'calls', 'master_sheets'];
const PERM_KEYS = PERMS.map((p) => p[0]);
const GRANTABLE_KEYS = PERM_KEYS.filter((k) => !OWNER_ONLY.includes(k));
const isOwnerOnly = (p) => OWNER_ONLY.includes(p);
// Only the owner and the Technical Service (role "Technical Manager") get these: API keys (Resend…), editing message texts, senders, subjects and links (templates), SEO and ads.
// Agents can SEND email marketing, newsletters, promotions and renewal emails, but always with the saved texts and the automatic payment links.
export const TECH_ONLY = ['secrets', 'templates_edit', 'seo', 'ads'];
export const isTechRole = (role) => /technical|technique|panel manager/i.test(String(role || ''));

// Ready-made roles. 'Full access' means every grantable permission (owner-only stays with the owner).
export const ROLE_PRESETS = {
  'Technical Manager': ['customers_view', 'customers_edit', 'customers_phone', 'disputes', 'tasks', 'attendance', 'activity', 'ibo', 'marketing', 'templates_edit', 'secrets'],
  'Sales Agent': ['customers_view', 'customers_edit', 'customers_phone', 'marketing', 'tasks', 'attendance'],
  'Support Agent': ['customers_view', 'customers_edit', 'customers_phone', 'marketing', 'tasks', 'attendance'],
  Accountant: ['finance_view', 'finance_edit', 'profits', 'stock', 'stripe', 'tasks', 'attendance'],
  Manager: ['customers_view', 'customers_edit', 'customers_delete', 'customers_phone', 'disputes', 'finance_view', 'finance_edit', 'profits', 'stock', 'plans', 'tasks', 'attendance', 'activity'],
  'Full access': GRANTABLE_KEYS,
};
function permFor(method, path, body) {
  if (['/api/admin/me', '/api/admin/email/status', '/api/admin/stats', '/api/admin/panel/credits', '/api/admin/me/password'].includes(path) || path.startsWith('/api/admin/2fa')) return null;
  if (path.startsWith('/api/admin/tickets') || path.startsWith('/api/admin/chat') || path.startsWith('/api/admin/receipts') || path === '/api/admin/sync') return method === 'GET' ? 'customers_view' : 'customers_edit';
  // Anyone on the team can file a problem report; only disputes-permitted staff can view and process the tracker.
  if (path === '/api/admin/disputes' && method === 'POST') return null;
  if (path.startsWith('/api/admin/disputes')) return 'disputes';
  if (path.startsWith('/api/admin/trialq')) return method === 'GET' ? 'customers_view' : 'customers_edit';
  if (path === '/api/admin/payments') return 'finance_view';
  if (path === '/api/admin/settings') {
    if (method === 'GET') return null;
    const k = Object.keys(body || {});
    if (k.length && k.every((x) => x === 'stripeAccounts')) return 'stripe';
    if (k.length && k.every((x) => ['plans', 'currency', 'resellerPackages', 'resellerCurrency', 'renewalOffer', 'orderPackages', 'orderCurrency', 'orderAccounts', 'waTemplates'].includes(x))) return 'plans';
    if (k.includes('notify') || k.includes('security')) return 'owner';
    if (k.some((x) => ['email', 'promo', 'renewModels', 'iboPromo', 'mailTexts', 'renewalOffer', 'waTemplates', 'telegram', 'waNumbers', 'branding'].includes(x))) return 'templates_edit'; // sender names, subjects, links, texts, WhatsApp numbers: owner & technical service
    if (k.length && k.every((x) => x === 'payRoute' || x === 'stripeAccounts')) return 'stripe';
    if (k.length && k.every((x) => x === 'stock')) return 'stock';
    if (k.length && k.every((x) => x === 'finance')) return 'finance_edit';
    return 'settings';
  }
  if (path === '/api/admin/reseller-sale') return 'customers_edit';
  if (path === '/api/admin/renewal/send') return 'marketing'; // bulk emails: owner & technical service only
  if (path === '/api/admin/order/send') return 'marketing';
  if (path === '/api/admin/order/custom') return 'customers_edit';
  if (path.startsWith('/api/admin/newsletter')) return 'marketing';
  if (path.startsWith('/api/admin/accounts') || path === '/api/admin/email/plan' || path === '/api/admin/email/sending') return 'secrets';
  if (path === '/api/admin/push/promo') return 'marketing';
  if (path === '/api/admin/app-notify') return 'customers_edit';
  if (path === '/api/admin/paylink' || path === '/api/admin/paylinks/check') return 'customers_view';
  if (path.startsWith('/api/admin/renewmodels')) return 'marketing';
  if (path === '/api/admin/appmail') return 'customers_edit';
  if (path === '/api/admin/push/devices') return 'customers_view';
  if (path.startsWith('/api/admin/orders')) return method === 'GET' && !path.endsWith('/backup') ? 'customers_view' : 'owner';
  if (path.startsWith('/api/admin/promo')) return method === 'GET' ? 'customers_view' : 'marketing';
  if (path === '/api/admin/renewal/status') return 'customers_view';
  if (path === '/api/admin/duplicates') return 'customers_view';
  if (path === '/api/admin/reseller-sales') return 'customers_view';
  if (path.startsWith('/api/admin/customers')) return method === 'GET' ? 'customers_view' : method === 'DELETE' ? 'customers_delete' : 'customers_edit';
  if (path === '/api/admin/finance' || (path === '/api/admin/tx' && method === 'GET')) return 'finance_view';
  if (path === '/api/admin/stripe/balance') return 'finance_view';
  if (path.startsWith('/api/admin/stripe/account/')) return 'stripe';
  if (path.startsWith('/api/admin/ibo')) return 'ibo';
  if (path === '/api/admin/attendance') return null; // every agent checks in / out (needed before the panel opens)
  if (path.startsWith('/api/admin/attendance')) return 'attendance';
  if (path === '/api/admin/guide') return null;
  if (path === '/api/admin/waiting') return 'customers_view';
  if (path.startsWith('/api/admin/holidays/')) return 'customers_view';
  if (path.startsWith('/api/admin/workplan')) return null; // everyone on the team (agents check off, owner edits)
  if (path.startsWith('/api/admin/shifts')) return method === 'GET' ? 'attendance' : 'attendance_all';
  if (path.startsWith('/api/admin/leaves')) return method === 'POST' && (path === '/api/admin/leaves' || path.startsWith('/api/admin/leaves/submit')) ? 'attendance' : 'attendance_all';
  if (path.startsWith('/api/admin/tasks')) return 'tasks';
  if (path.startsWith('/api/admin/reports')) return 'attendance_all';
  if (path.startsWith('/api/admin/teamchat')) return null;
  if (path.startsWith('/api/admin/cc')) return 'owner';
  if (path.startsWith('/api/admin/bylaws')) return null; // every admin can read and sign their own copy
  if (path === '/api/admin/emailmkt/settings' && method === 'PUT') return 'templates_edit'; // keys, domains, senders, subjects, campaign text
  if (path.startsWith('/api/admin/emailmkt')) return 'marketing';
  if (path.startsWith('/api/admin/seo')) return 'seo';
  if (path.startsWith('/api/admin/gads') || path.startsWith('/api/admin/fb')) return 'ads';
  if (path.startsWith('/api/admin/tx') || path === '/api/admin/rates/refresh' || path === '/api/admin/stripe/match') return 'finance_edit';
  if (path.startsWith('/api/admin/stock')) return 'stock';
  if (path === '/api/admin/profits') return 'profits';
  if (path === '/api/admin/sales-by-day') return 'profits';
  if (path === '/api/admin/stripe/revenue') return 'profits';
  if (path === '/api/admin/reseller/email') return 'owner';
  if (path === '/api/admin/reseller/delete') return 'customers_delete';
  if (path.startsWith('/api/admin/reseller/')) return 'customers_edit';
  if (path === '/api/admin/log') return 'activity';
  if (path === '/api/admin/panel/test' || path === '/api/admin/email/test' || path === '/api/admin/email/test-key') return 'settings';
  if (path.startsWith('/api/admin/email/bounces')) return method === 'GET' ? 'customers_view' : 'customers_edit';
  if (path === '/api/admin/email/recent') return 'customers_view';
  if (path.startsWith('/api/admin/trialpool')) return 'settings';
  if (path.startsWith('/api/admin/templates')) return method === 'GET' ? null : 'templates_edit'; // everyone views & inputs, only TM/owner/full-access edits (spec §1)
  return 'owner';
}

// ================= Resellers: reading reseller details out of pasted text =================
// Understands contact cards ("Email · Work: …"), "Label: value" lists, order lines
// ("REF-08 (Row 311 - Feb 22, 2024): 10 Credit — $280.99"), simple "Name, email, phone" lines and rows copied
// from a spreadsheet (tab-separated, with or without a header row). Card numbers are never kept.
const RS_MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function parseLooseDate(x) {
  const t = String(x ?? '').trim(); let m;
  const mk = (y, mo, d) => (y > 1990 && y < 2100 && mo >= 0 && mo < 12 && d >= 1 && d <= 31 ? Date.UTC(y, mo, d, 12) : 0);
  if ((m = t.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) return mk(+m[1], +m[2] - 1, +m[3]);
  if ((m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/))) { let d = +m[1], mo = +m[2], y = +m[3]; if (y < 100) y += 2000; if (mo > 12 && d <= 12) [d, mo] = [mo, d]; return mk(y, mo - 1, d); }
  for (const a of t.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) { const mo = RS_MON[a[1].slice(0, 3).toLowerCase()]; if (mo != null) return mk(+a[3], mo, +a[2]); }
  for (const a of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) { const mo = RS_MON[a[2].slice(0, 3).toLowerCase()]; if (mo != null) return mk(+a[3], mo, +a[1]); }
  return 0;
}
// "$280,99" -> 280.99 USD · "1.280,50 €" -> 1280.5 EUR · "460.99" -> 460.99 (no currency)
export function parseMoney(x) {
  const t = String(x ?? '');
  const currency = /€|\beur\b|euro/i.test(t) ? 'EUR' : /usdt|₮/i.test(t) ? 'USDT' : /\$|\busd\b|dollar/i.test(t) ? 'USD' : /\bmad\b|\bdhs?\b|dirham/i.test(t) ? 'MAD' : /\bthb\b|฿|baht/i.test(t) ? 'THB' : /£|\bgbp\b/i.test(t) ? 'GBP' : '';
  const m = t.match(/\d[\d.,]*\d|\d/); if (!m) return { amount: 0, currency };
  let n = m[0]; const last = Math.max(n.lastIndexOf('.'), n.lastIndexOf(','));
  n = last >= 0 && n.length - last - 1 <= 2 ? n.slice(0, last).replace(/[.,]/g, '') + '.' + n.slice(last + 1) : n.replace(/[.,]/g, '');
  const v = Math.round(parseFloat(n) * 100) / 100;
  return { amount: isFinite(v) && v >= 0 && v < 1e9 ? v : 0, currency };
}
// The price inside a longer text ("10 Credit — $280.99"): a number next to a currency, else a number with two decimals.
function rsFindPrice(x) {
  const t = String(x ?? '');
  let m = t.match(/[$€£₮฿]\s*\d[\d.,]*/) || t.match(/\d[\d.,]*\s*(?:usdt|usd|eur|euros?|mad|dhs?|thb|gbp|€|\$)(?![a-z])/i);
  if (m) return parseMoney(m[0]);
  m = t.match(/(?:^|[^\d.,])(\d{1,7}[.,]\d{2})(?![\d.,])/);
  return m ? parseMoney(m[1]) : { amount: 0, currency: '' };
}
const rsLuhn = (d) => { let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; };
// Removes anything that looks like a payment card number from a text. Card details are never stored.
export const scrubCards = (t) => String(t ?? '').replace(/\d(?:[ -]?\d){12,18}/g, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && rsLuhn(d) ? '' : m; });
const RS_INVIS = /[​-‏‪-‮⁦-⁩﻿]/g;
const rsClean = (x, n = 120) => scrubCards(String(x ?? '').replace(RS_INVIS, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()).trim().slice(0, n);
const rsDashes = (x) => /^[-–—_.=*\s]*$/.test(String(x ?? ''));
export function cleanPhoneText(x) {
  const t = String(x ?? '').replace(RS_INVIS, ''); const m = t.match(/(?:\+|00)?\d[\d\s().-]{5,}\d/); if (!m) return '';
  const raw = m[0].trim(); const d = raw.replace(/\D/g, '');
  if (d.length < 7 || d.length > 15 || (d.length >= 13 && rsLuhn(d))) return '';
  return raw.startsWith('+') ? '+' + d : raw.startsWith('00') ? '+' + d.slice(2) : d;
}
const rsEmails = (x) => [...new Set(String(x ?? '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/g) || [])];
const rsCredits = (x) => { const m = String(x ?? '').match(/(\d{1,5})\s*(?:x\s*)?credits?\b/i); return m ? Number(m[1]) : 0; };
export const cleanRslId = (x) => { const m = String(x ?? '').match(/\b(?:RSL|RLS)\s*[-_#:]?\s*(\d{1,6})\b/i) || String(x ?? '').trim().match(/^#?(\d{1,6})$/); return m ? 'RSL-' + (m[1].length < 2 ? '0' + m[1] : m[1]) : ''; };
const rsServer = (x) => [...new Set(String(x ?? '').split(/[/,;|]+/).map((v) => rsClean(v, 30).replace(/^[✓✔\s]+/, '')).filter((v) => v && !rsDashes(v) && !/^(yes|no|n\/a|none|ok)$/i.test(v)))].join(' / ').slice(0, 40);
const rsNormName = (x) => String(x ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9؀-ۿ]/g, '');
const RS_REF = /^([A-Za-z]{2,12}\s?[-_#]\s?\d{1,6}(?:-\d{1,3})?)(?![\w])/; // an order number such as ABC-12 or Order_7-02
const RS_STOP = /^(yes|no|new|renew|normal|live|paid|usd|eur|mad|usdt|thb|n\/a|none|ok|✓.*|not .*)$/i;
// What a label means ("Email · Work", "Period / Credits", "Notice / Panel Tag", vCard "TEL;TYPE=CELL" …)
function rsLabel(l) {
  const k = String(l || '').toLowerCase().replace(RS_INVIS, '').trim();
  if (!k || k.length > 42) return '';
  if (/card|cvv|cvc|\bexp|iban|account n|password|\bpass\b/.test(k)) return 'skip';
  if (/^(end|version|n|prodid|rev|uid|photo|adr|url|x-[\w-]+)(;|$)/.test(k)) return 'other';
  if (/e-?mails?\b|\bmail\b/.test(k)) return 'emails';
  if (/order|reference|\bref\b|invoice/.test(k)) return 'ref';
  if (/phone|mobile|whats\s?app|\btel\b|\bgsm\b/.test(k)) return 'phone';
  if (/organi[sz]ation|company|\borg\b|business/.test(k)) return 'org';
  if (/\brsl\b|reseller (?:id|no|number|code)/.test(k)) return 'rsl';
  if (/price|amount|total|cost|\bpaid\b|payment/.test(k)) return 'price';
  if (/\bdate\b|purchased|bought/.test(k)) return 'date';
  if (/period|package|credits?|\bplan\b|product|quantity|\bqty\b/.test(k)) return 'pkg';
  if (/server|\bhost\b/.test(k)) return 'server';
  if (/notice|\bnotes?\b|\btag\b|panel|comment|remark/.test(k)) return 'tag';
  if (/\bname\b|^fn$|reseller|customer|client|contact/.test(k)) return 'name';
  if (/country|address|city|username|\buser\b|statu|telegram|promotion|\bcode\b/.test(k)) return 'other';
  return '';
}
const rsHeadingName = (line) => rsClean(String(line).replace(/\s*\([^)]*\)?\s*$/, '').replace(/[:：]\s*$/, ''), 80);
const rsNewBlock = (name, explicit) => ({ name: name || '', explicit: !!explicit, emails: [], phone: '', org: '', rslId: '', server: '', tag: '', cur: {}, orders: [] });
function rsCloseOrder(b) { // the one order described by the block's own fields (reference, date, package, price)
  const o = b.cur; b.cur = {};
  if (!o.ref && !o.amount && !o.pkg && !o.at) return;
  b.orders.push({ ref: o.ref || '', at: o.at || 0, pkg: o.pkg || '', credits: o.credits || 0, amount: o.amount || 0, currency: o.currency || '', server: '', note: [o.row, o.note].filter(Boolean).join(' · ') });
}
function rsOrderLine(line) { // "REF-08 (Row 311 - Feb 22, 2024): 10 Credit — $280.99"
  const m = line.match(RS_REF); if (!m) return null;
  let rest = line.slice(m[0].length).trim(); let paren = '';
  const pm = rest.match(/^\(([^)]*)\)?/); if (pm) { paren = pm[1]; rest = rest.slice(pm[0].length).trim(); }
  rest = rest.replace(/^[:：\-–—]+\s*/, '');
  const price = rsFindPrice(rest); const row = (paren.match(/\brow\s*(\d+)/i) || [])[1];
  const pkg = rest.split(/\s+[—–-]\s+|\s*[|;]\s*/).map((x) => rsClean(x, 60)).find((x) => x && !rsDashes(x) && !/^[$€£₮฿]?\s*\d[\d.,]*\s*(usdt|usd|eur|mad|dhs?|thb|gbp|€|\$)?$/i.test(x) && !parseLooseDate(x)) || '';
  return { ref: rsClean(m[1], 40).replace(/\s/g, ''), at: parseLooseDate(paren) || parseLooseDate(rest), pkg, credits: rsCredits(rest), amount: price.amount, currency: price.currency, server: '', note: row ? 'row ' + row : '' };
}
// A row copied from a spreadsheet. `map` is what each column means, from a header row, when there is one.
function rsSheetRow(cells, map) {
  const b = rsNewBlock('', true); const o = {}; const left = [];
  cells.forEach((raw, i) => {
    const v = String(raw ?? '').replace(RS_INVIS, '').trim(); if (!v || rsDashes(v)) return;
    const kind = (map && map[i]) || '';
    if (kind === 'skip' || kind === 'other') return;
    const em = rsEmails(v); if (em.length) { b.emails.push(...em); return; }
    const isDate = /^\d{4}-\d{1,2}-\d{1,2}(?:[ T][\d:.]+)?$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v) && parseLooseDate(v);
    if (isDate && kind !== 'ref' && kind !== 'phone') { o.at = o.at || isDate; return; }
    if (kind === 'name') { b.name = b.name || rsClean(v, 80); return; }
    if (kind === 'ref') { o.ref = o.ref || rsClean(v, 40).replace(/\s/g, ''); return; }
    if (kind === 'date') { o.at = o.at || parseLooseDate(v); return; }
    if (kind === 'price') { const p = rsFindPrice(v).amount ? rsFindPrice(v) : parseMoney(v); if (p.amount && !o.amount) o.amount = p.amount; if (p.currency) o.currency = o.currency || p.currency; return; }
    if (kind === 'pkg') { o.pkg = o.pkg || rsClean(v, 60); o.credits = o.credits || rsCredits(v); return; }
    if (kind === 'server') { b.server = b.server || rsServer(v); return; }
    if (kind === 'tag') { b.tag = b.tag || rsClean(v, 80); o.note = o.note || rsClean(v, 120); return; }
    if (kind === 'org') { b.org = b.org || rsClean(v.replace(/\(?\s*(RSL|RLS)\s*[-_#:]?\s*\d+\s*\)?/i, ''), 80); b.rslId = b.rslId || cleanRslId(v); return; }
    if (kind === 'rsl') { b.rslId = b.rslId || cleanRslId(v); return; }
    if (kind === 'phone') { b.phone = b.phone || cleanPhoneText(v); return; }
    // no header for this column: work it out from what the cell looks like
    if (!o.ref && RS_REF.test(v) && v.length <= 24) { o.ref = rsClean(v, 40).replace(/\s/g, ''); return; }
    if (/^[+\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 8 && cleanPhoneText(v)) { b.phone = b.phone || cleanPhoneText(v); return; }
    if (/credit|\bmonths?\b|\byears?\b|\d\s*lines?\b/i.test(v) && v.length <= 40) { o.pkg = o.pkg || rsClean(v, 60); o.credits = o.credits || rsCredits(v); return; }
    if (/^[$€£₮฿]?\s*\d{1,7}[.,]\d{2}\s*(?:usd|eur|mad|usdt|thb|[$€])?$/i.test(v) || /^[$€£₮฿]\s*\d{1,7}$|^\d{1,7}\s*(?:usd|eur|mad|usdt|thb|[$€])$/i.test(v)) { const p = parseMoney(v); if (!o.amount) { o.amount = p.amount; o.currency = p.currency || o.currency || ''; } return; }
    if (/^[$€£]?\s*(usd|eur|gbp|mad|usdt|thb)$/i.test(v)) { o.currency = o.currency || parseMoney(v).currency; return; }
    if (/^[\d\s.,-]+$/.test(v)) return; // a bare number we cannot place
    left.push(v);
  });
  if (!b.name) { const nm = left.find((v) => /[A-Za-z؀-ۿ]{2,}/.test(v) && !/\d{3,}/.test(v) && v.length <= 60 && !RS_STOP.test(v)); if (nm) b.name = rsClean(nm, 80); }
  if (!b.server) { const sv = left.map((v) => v.replace(/^[✓✔\s]+/, '')).find((v) => /^[A-Z][A-Z0-9]{2,11}$/.test(v) && !RS_STOP.test(v)); if (sv) b.server = sv; }
  b.cur = o; rsCloseOrder(b);
  return b;
}
export function parseResellerText(text) {
  const lines = String(text ?? '').slice(0, 200000).split(/\r?\n/);
  const blocks = []; let b = null; let inHistory = false; let header = null;
  const start = (name, explicit) => { if (b) rsCloseOrder(b); b = rsNewBlock(name, explicit); blocks.push(b); inHistory = false; return b; };
  for (const rawLine of lines) {
    // rows copied from a spreadsheet keep their tabs
    const cells = rawLine.replace(/^\s*(?:[○●•◦▪■□*·>]+|bullet\b)\s*/i, '').split('\t');
    if (cells.filter((c) => c.trim() && !rsDashes(c)).length >= 3) {
      const kinds = cells.map((c) => (c.trim().length <= 30 && !/@|\d{3,}/.test(c) ? rsLabel(c) : ''));
      if (kinds.filter(Boolean).length >= 3) { header = kinds; continue; }
      if (b) rsCloseOrder(b); b = null; inHistory = false;
      const row = rsSheetRow(cells, header); if (row.name || row.emails.length || row.phone) blocks.push(row);
      continue;
    }
    const line = rawLine.replace(RS_INVIS, '').replace(/^\s*(?:[○●•◦▪■□*·>\-–—]+|bullet\b|\d{1,3}[.)](?=\s))\s*/i, '').trim();
    if (!line || rsDashes(line)) continue;
    if (/^(order|purchase)s?\s*(history|list)?\s*[:：]?$|^history\s*[:：]?$/i.test(line)) { if (b) rsCloseOrder(b); inHistory = true; continue; }
    if (/^(?:RSL|RLS)\s*[-_#]?\s*\d{1,6}$/i.test(line) && b && !b.rslId) { b.rslId = cleanRslId(line); continue; }
    const ol = rsOrderLine(line);
    if (ol) { if (!b) start('', false); else rsCloseOrder(b); b.orders.push(ol); continue; }
    const fm = line.match(/^([^:：]{1,42}?)\s*[:：]\s*(.*)$/);
    if (fm && /^begin$/i.test(fm[1].trim())) { start('', false); continue; }
    const kind = fm && !/^https?$/i.test(fm[1].trim()) ? rsLabel(fm[1]) : '';
    if (kind) {
      const v = fm[2].trim();
      if (kind === 'name') {
        const nm = rsHeadingName(v); if (!nm) continue;
        if (!b) start(nm, true);
        else if (rsNormName(b.name) === rsNormName(nm)) b.explicit = true;
        else if (b.explicit || b.emails.length || b.phone) start(nm, true);
        else { b.name = nm; b.explicit = true; }
        continue;
      }
      if (kind === 'skip' || kind === 'other') continue;
      if (!b) start('', false);
      if (kind === 'emails') b.emails.push(...rsEmails(v));
      else if (kind === 'phone') b.phone = b.phone || cleanPhoneText(v);
      else if (kind === 'org') { b.org = b.org || rsClean(v.replace(/\(?\s*(RSL|RLS)\s*[-_#:]?\s*\d+\s*\)?/i, ''), 80); b.rslId = b.rslId || cleanRslId(v); }
      else if (kind === 'rsl') b.rslId = b.rslId || cleanRslId(v);
      else if (kind === 'server') b.server = b.server || rsServer(v);
      else if (kind === 'tag') { if (!rsDashes(v)) { b.tag = b.tag || rsClean(v, 80); b.cur.note = b.cur.note || rsClean(v, 120); } }
      else if (kind === 'ref') { if (b.cur.ref) rsCloseOrder(b); const rm = v.match(RS_REF); b.cur.ref = rsClean(rm ? rm[1] : v.replace(/\(.*$/, ''), 40).replace(/\s/g, ''); const row = (v.match(/\brow\s*(\d+)/i) || [])[1]; if (row) b.cur.row = 'row ' + row; }
      else if (kind === 'date') b.cur.at = parseLooseDate(v) || b.cur.at || 0;
      else if (kind === 'pkg') { if (!rsDashes(v)) { b.cur.pkg = rsClean(v, 60); b.cur.credits = rsCredits(v); } }
      else if (kind === 'price') { const p = rsFindPrice(v).amount ? rsFindPrice(v) : parseMoney(v); b.cur.amount = p.amount; if (p.currency) b.cur.currency = p.currency; }
      continue;
    }
    // a free line: contact details ("Name, email, phone") or the next reseller's name
    const em = rsEmails(line); const ph = /(?:\+|00)\d[\d\s().-]{6,}\d|\b\d[\d\s().-]{8,}\d\b/.test(line) ? cleanPhoneText(line.replace(/[a-z0-9._%+-]+@\S+/gi, ' ')) : '';
    if (em.length || ph) {
      const nm = rsHeadingName(line.split(/[,;|]| [-–—] |\s(?=\S+@)|\s(?=\+?\d[\d\s().-]{6,})/)[0]);
      if (nm && /[A-Za-z؀-ۿ]{2,}/.test(nm) && !/@|\d{3,}/.test(nm) && nm.length <= 60) start(nm, true); else if (!b) start('', false);
      b.emails.push(...em); b.phone = b.phone || ph;
      continue;
    }
    const nm = rsHeadingName(line);
    if (!nm || nm.length < 2 || nm.length > 70 || !/[A-Za-z؀-ۿ]{2,}/.test(nm) || /https?:/i.test(nm)) continue;
    start(nm, false);
  }
  if (b) rsCloseOrder(b);
  // one profile per person: blocks that share a phone or an email are joined (or a name, when one of them has no contact details)
  const out = [];
  for (const k of blocks) {
    k.emails = [...new Set(k.emails)].slice(0, 6);
    if (!k.name && !k.emails.length && !k.phone) continue;
    if (!(k.emails.length || k.phone || k.orders.length || k.rslId)) continue;
    const ph = k.phone.replace(/\D/g, '').slice(-9); const nm = rsNormName(k.name); const bare = !(k.emails.length || k.phone);
    let p = out.find((x) => (ph.length >= 7 && x.phone.replace(/\D/g, '').slice(-9) === ph) || x.emails.some((e) => k.emails.includes(e)));
    if (!p && nm.length >= 4) p = out.find((x) => rsNormName(x.name) === nm && (bare || !(x.emails.length || x.phone)));
    if (!p) { p = { name: k.name, emails: [], phone: '', org: '', rslId: '', server: '', tag: '', note: '', orders: [] }; out.push(p); }
    p.name = p.name || k.name; p.phone = p.phone || k.phone; p.org = p.org || k.org; p.rslId = p.rslId || k.rslId; p.tag = p.tag || k.tag;
    p.server = [...new Set([p.server, k.server].filter(Boolean).join(' / ').split(' / ').filter(Boolean))].join(' / ').slice(0, 40);
    p.emails = [...new Set([...p.emails, ...k.emails])].slice(0, 6);
    for (const o of k.orders) {
      o.server = o.server || k.server || '';
      const dup = p.orders.find((x) => (o.ref && x.ref && x.ref.toLowerCase() === o.ref.toLowerCase()) || (!o.ref && !x.ref && x.at === o.at && x.amount === o.amount && x.pkg === o.pkg));
      if (dup) { for (const f of ['at', 'pkg', 'credits', 'amount', 'currency', 'server', 'note']) if (!dup[f] && o[f]) dup[f] = o[f]; } else p.orders.push(o);
    }
  }
  for (const p of out) { if (!p.name) p.name = (p.emails[0] || '').split('@')[0] || p.phone; p.orders.sort((a, c) => (a.at || 0) - (c.at || 0)); }
  return { profiles: out.slice(0, 200) };
}

// Returns a clean, valid email address, or '' if the text isn't one ("name@site.com," -> "name@site.com")
export function cleanEmail(x) {
  const m = String(x || '').toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}/);
  return m ? m[0] : '';
}
// Language of emails: one language for everyone (English unless changed in Trial & email setup), or each customer's own.
// ---- Currency: US dollars for everyone, euros for customers in Europe ----
// Europe is found from the email ending (.de, .ch, .fr, .co.uk …), then from the phone country code (+41, +49 …).
const EU_TLD = new Set('eu ad al at ba be bg by ch cy cz de dk ee es fi fo fr gb gg gi gr hr hu ie im is it je li lt lu lv mc md mk mt nl no pl pt ro rs se si sk sm ua uk va xk'.split(' '));
const EU_DIAL = ['30', '31', '32', '33', '34', '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '36', '370', '371', '372', '373', '375', '376', '377', '378', '379', '380', '381', '382', '383', '385', '386', '387', '389', '39', '40', '41', '420', '421', '423', '43', '44', '45', '46', '47', '48', '49'];
export function isEurope(c) {
  const dom = String(c?.email || '').trim().toLowerCase().split('@')[1] || ''; const tld = dom.split('.').pop();
  if (dom && EU_TLD.has(tld)) return true;
  const ph = String(c?.whatsapp || c?.phone || '').replace(/[^\d+]/g, ''); if (!ph.startsWith('+') && !/^00/.test(ph) && ph.length < 11) return false;
  const d = ph.replace(/^\+|^00/, ''); return EU_DIAL.some((x) => d.startsWith(x));
}
export const CUR_SYMBOL = { EUR: '€', USD: '$', USDT: '₮', MAD: 'MAD ', THB: '฿', GBP: '£' };
export const fmtCur = (n, cur) => (CUR_SYMBOL[cur] && cur !== 'MAD' ? CUR_SYMBOL[cur] + Number(n || 0).toFixed(2) : Number(n || 0).toFixed(2) + ' ' + cur);
// The currency a customer (or reseller) sees: their own choice, else USD / EUR by the rule (when it is on), else the shop currency.
// Which phone / tablet / TV a customer uses (from the browser): Samsung, iPhone, iPad, Android, Smart TV, Fire TV, computer.
export function deviceFrom(ua, hint = {}) {
  const u = String(ua || ''); let model = String(hint.model || '').trim().slice(0, 40);
  let brand = '', name = '', os = '', kind = 'phone';
  const ver = (re) => ((u.match(re) || [])[1] || '').replace(/_/g, '.');
  if (/iPhone/.test(u)) { brand = 'Apple'; name = 'iPhone'; os = 'iOS ' + ver(/OS (\d+[_.]\d+)/); }
  else if (/iPad/.test(u) || (/Macintosh/.test(u) && hint.touch)) { brand = 'Apple'; name = 'iPad'; kind = 'tablet'; os = 'iPadOS ' + ver(/OS (\d+[_.]\d+)/); }
  else if (/Tizen/i.test(u)) { brand = 'Samsung'; name = 'Samsung Smart TV'; kind = 'tv'; os = 'Tizen ' + ver(/Tizen ([\d.]+)/); }
  else if (/Web0S|webOS/i.test(u)) { brand = 'LG'; name = 'LG Smart TV'; kind = 'tv'; os = 'webOS'; }
  else if (/AFT[A-Z]|Fire TV|AmazonWebAppPlatform/i.test(u)) { brand = 'Amazon'; name = 'Fire TV Stick'; kind = 'tv'; os = 'Fire OS'; }
  else if (/Android/i.test(u)) {
    os = 'Android ' + ver(/Android (\d+(?:\.\d+)?)/);
    if (!model || model === 'K') model = ((u.match(/Android [\d.]+;(?: [a-z]{2}[-_][a-z]{2};)? ([^;)]+?)(?: Build[/;]|\))/i) || [])[1] || '').trim();
    if (model === 'K') model = ''; model = model.replace(/^SAMSUNG[ -]/i, '');
    const tv = /Android TV|GoogleTV|BRAVIA|SMART-TV|AFT|MiBOX|Chromecast/i.test(u + ' ' + model);
    if (/^SM-|SAMSUNG|Galaxy/i.test(model) || /SamsungBrowser/i.test(u)) { brand = 'Samsung'; name = 'Samsung Galaxy' + (/^SM-[TXP]/i.test(model) ? ' Tab' : ''); }
    else if (/Pixel/i.test(model)) { brand = 'Google'; name = model; }
    else if (/Redmi|Xiaomi|POCO|^M2\d{3}|^2\d{3}[A-Z0-9]{4}/i.test(model)) { brand = 'Xiaomi'; name = 'Xiaomi'; }
    else if (/OnePlus|^CPH\d|^RMX\d|^V2\d{3}|HUAWEI|^(ELE|VOG|ANE|MAR)-|moto|Nokia|TECNO|Infinix|itel/i.test(model)) { brand = (model.match(/OnePlus|HUAWEI|moto|Nokia|TECNO|Infinix|itel/i) || [''])[0] || (/^CPH/.test(model) ? 'Oppo' : /^RMX/.test(model) ? 'Realme' : /^V2/.test(model) ? 'Vivo' : 'Huawei'); name = brand; }
    else name = 'Android';
    kind = tv ? 'tv' : /Mobile/i.test(u) ? 'phone' : 'tablet'; if (tv && !brand) name = 'Android TV box';
  }
  else if (/Windows/i.test(u)) { name = 'Windows PC'; kind = 'computer'; os = 'Windows'; }
  else if (/Macintosh|Mac OS X/i.test(u)) { brand = 'Apple'; name = 'Mac'; kind = 'computer'; os = 'macOS'; }
  else if (/CrOS/i.test(u)) { name = 'Chromebook'; kind = 'computer'; os = 'ChromeOS'; }
  else if (/Linux/i.test(u)) { name = 'Linux computer'; kind = 'computer'; os = 'Linux'; }
  else name = 'Unknown device';
  return { brand, name, model, os: os.trim(), kind, app: !!hint.app };
}
export function custCurrency(s, c) {
  const own = String(c?.curOverride || '').toUpperCase(); if (['USD', 'EUR'].includes(own)) return own; // set by hand in the customer form (the imported 'currency' column is only history)
  if (s.currencyRule?.on !== false) return isEurope(c) ? 'EUR' : 'USD';
  return s.orderCurrency && s.orderCurrency !== 'ALL' ? s.orderCurrency : s.currency || 'EUR';
}
// A typed price like "$109.99" or "109,99 €" shown in the customer's currency (same number).
export const priceIn = (txt, cur) => { const m = String(txt || '').replace(',', '.').match(/(\d+(?:\.\d+)?)/); return m ? fmtCur(Number(m[1]), cur) : String(txt || ''); };

// ---- Languages: English, French, German, Spanish, Italian ----
export const LANG_CODES = ['en', 'fr', 'de', 'es', 'it'];
export const LANG_NAMES = { en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', it: 'Italiano' };
export const okLang = (l, d = 'en') => (LANG_CODES.includes(l) ? l : d);
export const langLocale = (l) => ({ fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT' }[l] || 'en-GB');
// Short texts used inside emails and messages
const TX = {
  en: { supLine: '🛟 24/7 support: {link}', supMsg: 'Hello {name} 👋\n\nNeed help with *{app}*? Our support is open 24/7.\n\n🛟 Open a support request here:\n{link}\n\n✉️ Or email us: {email}\n\nWe answer as fast as we can 😊', conn: 'Connection', devs: 'device(s)', user: 'Username', pass: 'Password', otherConns: 'Your other connections', otherSub: 'Each connection has its own login details. Use one per device.',
    profBody: 'Here are your details to sign in to {app} and see your profile (subscription, end date and your contact details).', profEmail: 'Email', profUser: 'Username', profPass: 'Password', profChosen: '(the one you chose)', profLink: 'Your profile', profTap: 'Tap the button or open the link above to see your profile.',
    profN: 'You have *{n} connections*. The login details and M3U link of each one are on your profile.', profSubj: 'Your {app} profile', profTitle: 'Your profile', profBtn: 'Open my profile',
    mac: 'Using a MAC-address device (Smart TV, STB, Formuler…)? Send your MAC address to support on WhatsApp or Telegram and we will activate it for you.',
    endsOn: 'ends on', endedOn: 'ended on', paidT: 'Payment confirmed ✅', paidB: 'Thank you! Your subscription has been extended by {days} days.',
    promoWa: '🖤 *{name} is here!*\n{lead} with code *{code}*{site}.{end}', promoLeadO: 'Get *{offer}* on every {app} plan', promoLead: 'Get our biggest discount of the year on every {app} plan', promoAt: ' at {site}', promoEnd: '\n⏳ Offer ends {end}, don\'t miss it.',
    banner: '{lead} with code {code}', bannerO: '{offer} on every plan', bannerN: 'Our biggest discount of the year', until: 'Until' },
  fr: { supLine: '🛟 Support 24h/24, 7j/7 : {link}', supMsg: 'Bonjour {name} 👋\n\nBesoin d’aide avec *{app}* ? Notre support est ouvert 24h/24, 7j/7.\n\n🛟 Ouvrez une demande ici :\n{link}\n\n✉️ Ou écrivez-nous : {email}\n\nNous répondons au plus vite 😊', conn: 'Connexion', devs: 'appareil(s)', user: 'Identifiant', pass: 'Mot de passe', otherConns: 'Vos autres connexions', otherSub: 'Chaque connexion a ses propres identifiants. Utilisez-en une par appareil.',
    profBody: 'Voici vos identifiants pour vous connecter à {app} et voir votre profil (abonnement, date de fin, vos coordonnées).', profEmail: 'Email ', profUser: "Nom d'utilisateur ", profPass: 'Mot de passe ', profChosen: '(celui que vous avez choisi)', profLink: 'Votre profil ', profTap: 'Appuyez sur le bouton ou ouvrez le lien ci-dessus pour voir votre profil.',
    profN: 'Vous avez *{n} connexions*. Les identifiants et le lien M3U de chacune sont sur votre profil.', profSubj: 'Votre profil {app}', profTitle: 'Votre profil', profBtn: 'Ouvrir mon profil',
    mac: 'Vous utilisez un appareil basé sur une adresse MAC (TV connectée, STB…) ? Envoyez votre adresse MAC au support sur WhatsApp ou Telegram et nous activerons votre compte.',
    endsOn: 'se termine le', endedOn: 's\'est terminé le', paidT: 'Paiement confirmé ✅', paidB: 'Merci ! Votre abonnement est prolongé de {days} jours.',
    promoWa: '🖤 *Le {name} est là !*\n{lead} avec le code *{code}*{site}.{end}', promoLeadO: 'Profitez de *{offer}* sur toutes les formules {app}', promoLead: "Profitez de notre plus grosse réduction de l'année sur toutes les formules {app}", promoAt: ' sur {site}', promoEnd: "\n⏳ Offre valable jusqu'au {end} seulement.",
    banner: '{lead} avec le code {code}', bannerO: '{offer} sur toutes les formules', bannerN: 'Notre plus grosse réduction de l’année', until: 'Jusqu’au' },
  de: { supLine: '🛟 Support rund um die Uhr: {link}', supMsg: 'Hallo {name} 👋\n\nBrauchen Sie Hilfe mit *{app}*? Unser Support ist rund um die Uhr für Sie da.\n\n🛟 Hier eine Support-Anfrage öffnen:\n{link}\n\n✉️ Oder schreiben Sie uns: {email}\n\nWir antworten so schnell wie möglich 😊', conn: 'Verbindung', devs: 'Gerät(e)', user: 'Benutzername', pass: 'Passwort', otherConns: 'Ihre weiteren Verbindungen', otherSub: 'Jede Verbindung hat eigene Zugangsdaten. Nutzen Sie eine pro Gerät.',
    profBody: 'Hier sind Ihre Daten, um sich bei {app} anzumelden und Ihr Profil zu sehen (Abonnement, Enddatum und Ihre Kontaktdaten).', profEmail: 'E-Mail', profUser: 'Benutzername', profPass: 'Passwort', profChosen: '(das von Ihnen gewählte)', profLink: 'Ihr Profil', profTap: 'Tippen Sie auf den Button oder öffnen Sie den Link oben, um Ihr Profil zu sehen.',
    profN: 'Sie haben *{n} Verbindungen*. Die Zugangsdaten und der M3U-Link jeder Verbindung stehen in Ihrem Profil.', profSubj: 'Ihr {app}-Profil', profTitle: 'Ihr Profil', profBtn: 'Mein Profil öffnen',
    mac: 'Sie nutzen ein Gerät mit MAC-Adresse (Smart-TV, STB, Formuler…)? Senden Sie Ihre MAC-Adresse per WhatsApp oder Telegram an den Support, wir aktivieren es für Sie.',
    endsOn: 'endet am', endedOn: 'ist abgelaufen am', paidT: 'Zahlung bestätigt ✅', paidB: 'Vielen Dank! Ihr Abonnement wurde um {days} Tage verlängert.',
    promoWa: '🖤 *{name} ist da!*\n{lead} mit dem Code *{code}*{site}.{end}', promoLeadO: 'Erhalten Sie *{offer}* auf jedes {app}-Paket', promoLead: 'Erhalten Sie unseren größten Rabatt des Jahres auf jedes {app}-Paket', promoAt: ' auf {site}', promoEnd: '\n⏳ Angebot gilt nur bis {end}.',
    banner: '{lead} mit dem Code {code}', bannerO: '{offer} auf jedes Paket', bannerN: 'Unser größter Rabatt des Jahres', until: 'Bis' },
  es: { supLine: '🛟 Soporte 24/7: {link}', supMsg: 'Hola {name} 👋\n\n¿Necesitas ayuda con *{app}*? Nuestro soporte está abierto 24/7.\n\n🛟 Abre una solicitud de soporte aquí:\n{link}\n\n✉️ O escríbenos: {email}\n\nTe respondemos lo antes posible 😊', conn: 'Conexión', devs: 'dispositivo(s)', user: 'Usuario', pass: 'Contraseña', otherConns: 'Tus otras conexiones', otherSub: 'Cada conexión tiene sus propios datos de acceso. Usa una por dispositivo.',
    profBody: 'Aquí tienes tus datos para entrar en {app} y ver tu perfil (suscripción, fecha de fin y tus datos de contacto).', profEmail: 'Email', profUser: 'Usuario', profPass: 'Contraseña', profChosen: '(la que elegiste)', profLink: 'Tu perfil', profTap: 'Pulsa el botón o abre el enlace de arriba para ver tu perfil.',
    profN: 'Tienes *{n} conexiones*. Los datos de acceso y el enlace M3U de cada una están en tu perfil.', profSubj: 'Tu perfil de {app}', profTitle: 'Tu perfil', profBtn: 'Abrir mi perfil',
    mac: '¿Usas un dispositivo con dirección MAC (Smart TV, STB, Formuler…)? Envía tu dirección MAC al soporte por WhatsApp o Telegram y lo activamos por ti.',
    endsOn: 'termina el', endedOn: 'terminó el', paidT: 'Pago confirmado ✅', paidB: '¡Gracias! Tu suscripción se ha ampliado {days} días.',
    promoWa: '🖤 *¡Llegó el {name}!*\n{lead} con el código *{code}*{site}.{end}', promoLeadO: 'Consigue *{offer}* en todos los planes de {app}', promoLead: 'Consigue nuestro mayor descuento del año en todos los planes de {app}', promoAt: ' en {site}', promoEnd: '\n⏳ La oferta termina el {end}, ¡no te la pierdas!',
    banner: '{lead} con el código {code}', bannerO: '{offer} en todos los planes', bannerN: 'Nuestro mayor descuento del año', until: 'Hasta el' },
  it: { supLine: '🛟 Supporto 24/7: {link}', supMsg: 'Ciao {name} 👋\n\nTi serve aiuto con *{app}*? Il nostro supporto è attivo 24/7.\n\n🛟 Apri una richiesta di supporto qui:\n{link}\n\n✉️ Oppure scrivici: {email}\n\nRispondiamo il prima possibile 😊', conn: 'Connessione', devs: 'dispositivo/i', user: 'Nome utente', pass: 'Password', otherConns: 'Le tue altre connessioni', otherSub: 'Ogni connessione ha i propri dati di accesso. Usane una per dispositivo.',
    profBody: 'Ecco i tuoi dati per accedere a {app} e vedere il tuo profilo (abbonamento, data di scadenza e i tuoi contatti).', profEmail: 'Email', profUser: 'Nome utente', profPass: 'Password', profChosen: '(quella che hai scelto)', profLink: 'Il tuo profilo', profTap: 'Tocca il pulsante o apri il link qui sopra per vedere il tuo profilo.',
    profN: 'Hai *{n} connessioni*. I dati di accesso e il link M3U di ciascuna sono nel tuo profilo.', profSubj: 'Il tuo profilo {app}', profTitle: 'Il tuo profilo', profBtn: 'Apri il mio profilo',
    mac: 'Usi un dispositivo con indirizzo MAC (Smart TV, STB, Formuler…)? Invia il tuo indirizzo MAC al supporto su WhatsApp o Telegram e lo attiviamo per te.',
    endsOn: 'scade il', endedOn: 'è scaduto il', paidT: 'Pagamento confermato ✅', paidB: 'Grazie! Il tuo abbonamento è stato esteso di {days} giorni.',
    promoWa: '🖤 *È arrivato il {name}!*\n{lead} con il codice *{code}*{site}.{end}', promoLeadO: 'Ottieni *{offer}* su tutti i piani {app}', promoLead: "Ottieni il nostro sconto più grande dell'anno su tutti i piani {app}", promoAt: ' su {site}', promoEnd: "\n⏳ L'offerta termina il {end}, non perderla.",
    banner: '{lead} con il codice {code}', bannerO: '{offer} su tutti i piani', bannerN: "Il nostro sconto più grande dell'anno", until: 'Fino al' },
};
for (const [l, v] of Object.entries({
  en: { profAppL: 'App', profAppBtn: '📲 Download the app', profAppTap: 'Tap the button to install the {app} app on your phone, tablet or TV and allow notifications: you will be told when your subscription ends, when we answer you, and about special offers. Your profile stays at the link above.' },
  fr: { profAppL: 'Application', profAppBtn: "📲 Télécharger l'application", profAppTap: "Touchez le bouton pour installer l'application {app} sur votre téléphone, tablette ou TV et autoriser les notifications : vous serez prévenu quand votre abonnement se termine, quand nous vous répondons, et des offres spéciales. Votre profil reste au lien ci-dessus." },
  de: { profAppL: 'App', profAppBtn: '📲 App herunterladen', profAppTap: 'Tippen Sie auf die Schaltfläche, um die {app}-App auf Handy, Tablet oder TV zu installieren und Benachrichtigungen zu erlauben: Sie erfahren, wann Ihr Abo endet, wann wir antworten und von Sonderangeboten. Ihr Profil bleibt unter dem Link oben.' },
  es: { profAppL: 'App', profAppBtn: '📲 Descargar la app', profAppTap: 'Toca el botón para instalar la app de {app} en tu móvil, tablet o TV y permitir las notificaciones: te avisaremos cuando termine tu suscripción, cuando te respondamos y de las ofertas especiales. Tu perfil sigue en el enlace de arriba.' },
  it: { profAppL: 'App', profAppBtn: "📲 Scarica l'app", profAppTap: "Tocca il pulsante per installare l'app {app} su telefono, tablet o TV e consentire le notifiche: ti avviseremo quando scade l'abbonamento, quando ti rispondiamo e delle offerte speciali. Il tuo profilo resta al link qui sopra." } })) Object.assign(TX[l], v); // profile email: app download
// App links for every device in the emails: Android (APK), iPhone / iPad and MacBook, with the Safari steps
for (const [l, v] of Object.entries({
  en: { dlAndroid: 'Android (APK)', dlIphone: 'iPhone & iPad', dlMac: 'MacBook', dlPick: 'Choose your device:', safariT: 'iPhone, iPad or MacBook: use Safari', safariCopy: 'Copy this link and open it in the Safari browser:', safariIos: 'iPhone / iPad: in Safari tap Share (square with arrow) → Add to Home Screen → Add.', safariMac: 'MacBook: in Safari choose File → Add to Dock, or download the Mac app.', safariNote: 'Links opened inside Gmail, Outlook or WhatsApp do not install the app: copy the link into Safari first.' },
  fr: { dlAndroid: 'Android (APK)', dlIphone: 'iPhone & iPad', dlMac: 'MacBook', dlPick: 'Choisissez votre appareil :', safariT: 'iPhone, iPad ou MacBook : utilisez Safari', safariCopy: 'Copiez ce lien et ouvrez-le dans le navigateur Safari :', safariIos: 'iPhone / iPad : dans Safari, touchez Partager (carré avec flèche) → Sur l’écran d’accueil → Ajouter.', safariMac: 'MacBook : dans Safari, choisissez Fichier → Ajouter au Dock, ou téléchargez l’app Mac.', safariNote: 'Un lien ouvert dans Gmail, Outlook ou WhatsApp n’installe pas l’app : copiez d’abord le lien dans Safari.' },
  de: { dlAndroid: 'Android (APK)', dlIphone: 'iPhone & iPad', dlMac: 'MacBook', dlPick: 'Wählen Sie Ihr Gerät:', safariT: 'iPhone, iPad oder MacBook: Safari verwenden', safariCopy: 'Kopieren Sie diesen Link und öffnen Sie ihn im Safari-Browser:', safariIos: 'iPhone / iPad: In Safari auf Teilen (Quadrat mit Pfeil) → Zum Home-Bildschirm → Hinzufügen tippen.', safariMac: 'MacBook: In Safari Ablage → Zum Dock hinzufügen wählen oder die Mac-App laden.', safariNote: 'In Gmail, Outlook oder WhatsApp geöffnete Links installieren die App nicht: Link zuerst in Safari kopieren.' },
  es: { dlAndroid: 'Android (APK)', dlIphone: 'iPhone y iPad', dlMac: 'MacBook', dlPick: 'Elige tu dispositivo:', safariT: 'iPhone, iPad o MacBook: usa Safari', safariCopy: 'Copia este enlace y ábrelo en el navegador Safari:', safariIos: 'iPhone / iPad: en Safari toca Compartir (cuadrado con flecha) → Añadir a pantalla de inicio → Añadir.', safariMac: 'MacBook: en Safari elige Archivo → Añadir al Dock, o descarga la app para Mac.', safariNote: 'Los enlaces abiertos en Gmail, Outlook o WhatsApp no instalan la app: copia primero el enlace en Safari.' },
  it: { dlAndroid: 'Android (APK)', dlIphone: 'iPhone e iPad', dlMac: 'MacBook', dlPick: 'Scegli il tuo dispositivo:', safariT: 'iPhone, iPad o MacBook: usa Safari', safariCopy: 'Copia questo link e aprilo nel browser Safari:', safariIos: 'iPhone / iPad: in Safari tocca Condividi (quadrato con freccia) → Aggiungi alla schermata Home → Aggiungi.', safariMac: 'MacBook: in Safari scegli File → Aggiungi al Dock, oppure scarica l’app per Mac.', safariNote: 'I link aperti in Gmail, Outlook o WhatsApp non installano l’app: copia prima il link in Safari.' } })) Object.assign(TX[l], v);
for (const [l, v] of Object.entries({
  en: 'Android: if you see “Unknown app blocked”, open Settings → Security and privacy → Auto Blocker, turn it off, open INTPROTO-TV.apk again and tap Install (you can turn it back on after). Or open {site}/app in Chrome → ⋮ → Install app.',
  fr: 'Android : si « Application inconnue bloquée » s’affiche, ouvrez Paramètres → Sécurité et confidentialité → Bloqueur automatique, désactivez-le, rouvrez INTPROTO-TV.apk et touchez Installer (vous pourrez le réactiver ensuite). Ou ouvrez {site}/app dans Chrome → ⋮ → Installer l’application.',
  de: 'Android: Bei „Unbekannte App blockiert“ Einstellungen → Sicherheit und Datenschutz → Auto Blocker ausschalten, INTPROTO-TV.apk erneut öffnen und Installieren tippen (danach wieder einschalten möglich). Oder {site}/app in Chrome öffnen → ⋮ → App installieren.',
  es: 'Android: si ves «App desconocida bloqueada», abre Ajustes → Seguridad y privacidad → Bloqueador automático, desactívalo, vuelve a abrir INTPROTO-TV.apk y toca Instalar (luego puedes reactivarlo). O abre {site}/app en Chrome → ⋮ → Instalar app.',
  it: 'Android: se vedi «App sconosciuta bloccata», apri Impostazioni → Sicurezza e privacy → Blocco automatico, disattivalo, riapri INTPROTO-TV.apk e tocca Installa (poi puoi riattivarlo). Oppure apri {site}/app in Chrome → ⋮ → Installa app.' })) TX[l].dlAbHelp = v;
for (const [l, v] of Object.entries({
  en: { s: '📲 Install the {app} app on all your devices', t: 'Your app, on every device', b: 'Here is how to install the {app} app on your phone, tablet, computer and TV. Sign in with your usual username and password, then allow notifications: we tell you before your subscription ends and when support answers you.' , btn: '📲 Open the download page' },
  fr: { s: '📲 Installez l’application {app} sur tous vos appareils', t: 'Votre app, sur chaque appareil', b: 'Voici comment installer l’application {app} sur votre téléphone, tablette, ordinateur et TV. Connectez-vous avec vos identifiants habituels, puis autorisez les notifications : nous vous prévenons avant la fin de l’abonnement et quand le support vous répond.', btn: '📲 Ouvrir la page de téléchargement' },
  de: { s: '📲 Installieren Sie die {app}-App auf all Ihren Geräten', t: 'Ihre App auf jedem Gerät', b: 'So installieren Sie die {app}-App auf Handy, Tablet, Computer und TV. Melden Sie sich mit Ihren üblichen Zugangsdaten an und erlauben Sie Benachrichtigungen: Wir informieren Sie vor Ablauf des Abos und wenn der Support antwortet.', btn: '📲 Download-Seite öffnen' },
  es: { s: '📲 Instala la app de {app} en todos tus dispositivos', t: 'Tu app, en cada dispositivo', b: 'Así puedes instalar la app de {app} en tu móvil, tableta, ordenador y TV. Inicia sesión con tu usuario y contraseña de siempre y permite las notificaciones: te avisamos antes de que termine tu suscripción y cuando soporte te responda.', btn: '📲 Abrir la página de descarga' },
  it: { s: '📲 Installa l’app {app} su tutti i tuoi dispositivi', t: 'La tua app, su ogni dispositivo', b: 'Ecco come installare l’app {app} su telefono, tablet, computer e TV. Accedi con il tuo nome utente e password di sempre, poi consenti le notifiche: ti avvisiamo prima della scadenza e quando il supporto risponde.', btn: '📲 Apri la pagina di download' } })) TX[l].appMail = v;
export function appDownloadEmail(s, c, appUrl) {
  const lang = okLang(c.lang); const M = TX[lang].appMail || TX.en.appMail; const site = String(s.email.appUrl || appUrl || 'https://intproto-tv.store').replace(/\/+$/, ''); const app = s.branding.appName || 'INTPROTO-TV';
  const f = (x) => x.replace(/\{app\}/g, app);
  const camp = { split: false, lang, badge: '📲 ' + app, content: { all: { subject: f(M.s), title: M.t, body: f(M.b) + '\n\n' + appLinksText(site, lang) + '\n\n📺 ' + site + '/download', button: M.btn } }, link: site + '/app' };
  return newsletterEmail(s, c, camp, appUrl, '');
}
export const APP_DL = { apk: '/apk/INTPROTO-TV.apk', macArm: 'https://github.com/khalil203/my-iptv/releases/download/desktop/INTPROTO-TV-Mac-arm64.dmg' };
// HTML block for emails: one button per device + the "open in Safari" box
export function appLinksHtml(base, lang, dark) {
  const e = escHtml; const T = (k) => e(tx(lang, k)); const site = String(base || 'https://intproto-tv.store').replace(/\/+$/, ''); const appPage = site + '/app';
  const btn = (href, label, bg, fg) => `<a href="${e(href)}" style="display:inline-block;background:${bg};color:${fg};font-weight:700;padding:10px 14px;border-radius:10px;text-decoration:none;margin:4px;font-size:14px">${label}</a>`;
  const c = dark ? '#e0f2fe' : '#475569';
  return `<p style="margin:4px 0 6px;font-size:13px;color:${c}">${T('dlPick')}</p>${btn(site + APP_DL.apk, '🤖 ' + T('dlAndroid'), '#22c55e', '#fff')}${btn(appPage + '?os=ios', '📱 ' + T('dlIphone'), '#fff', '#0369a1')}${btn(site + '/download#mac', '💻 ' + T('dlMac'), '#fff', '#0369a1')}
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:14px;background:#fff;border-radius:10px;text-align:left"><tr><td style="padding:14px 16px;font-size:13px;line-height:1.55;color:#334155"><b style="color:#0f172a">🧭 ${T('safariT')}</b><br>${T('safariCopy')}<div dir="ltr" style="margin:8px 0;background:#f1f5f9;border:1px dashed #94a3b8;border-radius:8px;padding:9px 10px;font-family:'Courier New',monospace;font-size:14px;font-weight:700;color:#0369a1;word-break:break-all">${e(appPage)}</div>📱 ${T('safariIos')}<br>💻 ${T('safariMac')}<br><span style="color:#b45309">⚠️ ${T('safariNote')}</span></td></tr></table><table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;background:#fff;border-radius:10px;text-align:left"><tr><td style="padding:12px 16px;font-size:13px;line-height:1.55;color:#334155">🛡️ ${e(tx(lang, 'dlAbHelp').replace('{site}', site))}</td></tr></table>`;
}
// Plain-text version (profile email, WhatsApp)
export function appLinksText(base, lang) {
  const site = String(base || 'https://intproto-tv.store').replace(/\/+$/, ''); const T = (k) => tx(lang, k);
  return `🤖 *${T('dlAndroid')}:* ${site}${APP_DL.apk}\n📱 *${T('dlIphone')}:* ${site}/app?os=ios\n💻 *${T('dlMac')}:* ${site}/download#mac\n\n🧭 *${T('safariT')}*\n${T('safariCopy')} ${site}/app\n${T('safariIos')}\n${T('safariMac')}\n⚠️ ${T('safariNote')}\n\n🛡️ ${T('dlAbHelp').replace('{site}', site)}`;
}
for (const [l, v] of Object.entries({ en: 'has been inactive since', fr: 'est inactif depuis', de: 'ist inaktiv seit', es: 'está inactiva desde', it: 'è inattivo da' })) TX[l].inactiveSince = v; // long-expired customers
for (const [l, v] of Object.entries({"en": {"pushOn": "Notifications are on for this device ✓", "pushTest": "This is a test notification. It works ✓", "pushRenewT": "Thank you for renewing 🎉", "pushRenewB": "Your {app} subscription is active until {date}. Enjoy!", "pushRslT": "Thank you for your order 🎉", "pushRslB": "{n} credits were added to your reseller account ({ref}).", "pushExpT": "Your subscription ends soon ⏰", "pushExpB": "Your {app} subscription ends on {date}. Renew now to keep watching.", "pushExpiredT": "Your subscription has ended", "pushExpiredB": "Renew your {app} subscription to watch again. Tap to see the packages.", "pushPkgT": "Special offer on {app} packages 📺", "pushPkgB": "Choose your package and keep watching. Tap to see the prices.", "pushCredT": "Reseller credits available 🤝", "pushCredB": "Top up your credits now. Tap to order a credit package.", "pushReplyT": "New answer from support 💬", "pushReplyB": "Tap to read it."}, "fr": {"pushOn": "Les notifications sont activées sur cet appareil ✓", "pushTest": "Ceci est une notification de test. Ça marche ✓", "pushRenewT": "Merci pour votre renouvellement 🎉", "pushRenewB": "Votre abonnement {app} est actif jusqu’au {date}. Bon visionnage !", "pushRslT": "Merci pour votre commande 🎉", "pushRslB": "{n} crédits ont été ajoutés à votre compte revendeur ({ref}).", "pushExpT": "Votre abonnement se termine bientôt ⏰", "pushExpB": "Votre abonnement {app} se termine le {date}. Renouvelez maintenant pour continuer à regarder.", "pushExpiredT": "Votre abonnement est terminé", "pushExpiredB": "Renouvelez votre abonnement {app} pour regarder à nouveau. Touchez pour voir les offres.", "pushPkgT": "Offre spéciale sur les abonnements {app} 📺", "pushPkgB": "Choisissez votre abonnement et continuez à regarder. Touchez pour voir les prix.", "pushCredT": "Crédits revendeur disponibles 🤝", "pushCredB": "Rechargez vos crédits maintenant. Touchez pour commander un pack.", "pushReplyT": "Nouvelle réponse du support 💬", "pushReplyB": "Touchez pour la lire."}, "de": {"pushOn": "Benachrichtigungen sind auf diesem Gerät an ✓", "pushTest": "Dies ist eine Test-Benachrichtigung. Es funktioniert ✓", "pushRenewT": "Danke für Ihre Verlängerung 🎉", "pushRenewB": "Ihr {app}-Abonnement ist bis {date} aktiv. Viel Spaß!", "pushRslT": "Danke für Ihre Bestellung 🎉", "pushRslB": "{n} Credits wurden Ihrem Reseller-Konto gutgeschrieben ({ref}).", "pushExpT": "Ihr Abonnement endet bald ⏰", "pushExpB": "Ihr {app}-Abonnement endet am {date}. Jetzt verlängern und weiter schauen.", "pushExpiredT": "Ihr Abonnement ist abgelaufen", "pushExpiredB": "Verlängern Sie Ihr {app}-Abonnement, um wieder zu schauen. Tippen Sie für die Pakete.", "pushPkgT": "Sonderangebot für {app}-Pakete 📺", "pushPkgB": "Wählen Sie Ihr Paket und schauen Sie weiter. Tippen Sie für die Preise.", "pushCredT": "Reseller-Credits verfügbar 🤝", "pushCredB": "Laden Sie jetzt Ihre Credits auf. Tippen Sie, um ein Paket zu bestellen.", "pushReplyT": "Neue Antwort vom Support 💬", "pushReplyB": "Tippen Sie, um sie zu lesen."}, "es": {"pushOn": "Las notificaciones están activadas en este dispositivo ✓", "pushTest": "Esta es una notificación de prueba. Funciona ✓", "pushRenewT": "Gracias por renovar 🎉", "pushRenewB": "Tu suscripción a {app} está activa hasta el {date}. ¡Disfruta!", "pushRslT": "Gracias por tu pedido 🎉", "pushRslB": "Se han añadido {n} créditos a tu cuenta de revendedor ({ref}).", "pushExpT": "Tu suscripción termina pronto ⏰", "pushExpB": "Tu suscripción a {app} termina el {date}. Renueva ahora para seguir viendo.", "pushExpiredT": "Tu suscripción ha terminado", "pushExpiredB": "Renueva tu suscripción a {app} para volver a ver. Toca para ver los paquetes.", "pushPkgT": "Oferta especial en paquetes de {app} 📺", "pushPkgB": "Elige tu paquete y sigue viendo. Toca para ver los precios.", "pushCredT": "Créditos de revendedor disponibles 🤝", "pushCredB": "Recarga tus créditos ahora. Toca para pedir un paquete.", "pushReplyT": "Nueva respuesta del soporte 💬", "pushReplyB": "Toca para leerla."}, "it": {"pushOn": "Le notifiche sono attive su questo dispositivo ✓", "pushTest": "Questa è una notifica di prova. Funziona ✓", "pushRenewT": "Grazie per il rinnovo 🎉", "pushRenewB": "Il tuo abbonamento {app} è attivo fino al {date}. Buona visione!", "pushRslT": "Grazie per il tuo ordine 🎉", "pushRslB": "{n} crediti sono stati aggiunti al tuo account rivenditore ({ref}).", "pushExpT": "Il tuo abbonamento scade presto ⏰", "pushExpB": "Il tuo abbonamento {app} scade il {date}. Rinnova ora per continuare a guardare.", "pushExpiredT": "Il tuo abbonamento è scaduto", "pushExpiredB": "Rinnova il tuo abbonamento {app} per guardare di nuovo. Tocca per vedere i pacchetti.", "pushPkgT": "Offerta speciale sui pacchetti {app} 📺", "pushPkgB": "Scegli il tuo pacchetto e continua a guardare. Tocca per vedere i prezzi.", "pushCredT": "Crediti rivenditore disponibili 🤝", "pushCredB": "Ricarica ora i tuoi crediti. Tocca per ordinare un pacchetto.", "pushReplyT": "Nuova risposta dal supporto 💬", "pushReplyB": "Tocca per leggerla."}})) Object.assign(TX[l], v); // notifications

export const supportUrl = (s, appUrl) => String(s.email?.appUrl || appUrl || 'https://intproto-tv.store').replace(/\/+$/, '') + '/support';
export const supportMail = (s) => cleanEmailX(s.support?.email || s.email?.supportEmail) || 'contact@intproto-tv.com';
const cleanEmailX = (v) => (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : '');
export const tx = (lang, k, v = {}) => String((TX[lang] || TX.en)[k] ?? TX.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');

let MAIL_LANG = 'en';
export const setMailLang = (v) => { MAIL_LANG = [...LANG_CODES, 'customer'].includes(v) ? v : 'en'; };
const ml = (c) => (MAIL_LANG !== 'customer' ? MAIL_LANG : okLang(c && c.lang));
// Reads the server, username and password out of a line link copied from the panel (get.php, player_api.php or /live/user/pass/…).
export function parseLineLink(link) {
  const m = String(link || '').trim().match(/https?:\/\/[^\s"'<>]+/i); if (!m) return null;
  let u; try { u = new URL(m[0]); } catch { return null; }
  let user = u.searchParams.get('username') || '', pass = u.searchParams.get('password') || '';
  if (!user || !pass) { const parts = u.pathname.split('/').filter(Boolean); const i = ['live', 'movie', 'series'].includes(parts[0]) ? 1 : 0; if (parts.length >= i + 2) { user = decodeURIComponent(parts[i]); pass = decodeURIComponent(parts[i + 1]); } }
  if (!user || !pass || /\.(php|m3u8?|ts)$/i.test(user)) return null;
  return { dns: u.origin, u: user, p: pass };
}
// ---- Order numbers (kept exactly as typed; these helpers only read them) ----
// "WLF-045-04" → main WLF-045, device 04 · "Owl-404-01 to 04" → devices 1..4 · "Order-62-SC58" → sub SC58
const INVIS = /[​-‏‪-‮⁠﻿]/g;
export function parseOrderNo(o) {
  const raw = String(o || '').replace(INVIS, '').trim();
  const m = raw.match(/^([A-Za-z]+)\s*-\s*(\d+)(.*)$/);
  if (!m) return { raw, prefix: '', num: null, main: raw, dev: null, devTo: null, sub: '' };
  const rest = m[3].trim(); let dev = null, devTo = null, sub = '', r;
  if ((r = rest.match(/^-\s*0*(\d{1,2})\s*(?:to|-|–)\s*0*(\d{1,2})$/i))) { dev = +r[1]; devTo = +r[2]; }
  else if ((r = rest.match(/^-\s*0*(\d{1,2})$/))) dev = +r[1];
  else if (rest) sub = rest.replace(/^-\s*/, '');
  return { raw, prefix: m[1], num: Number(m[2]), main: `${m[1]}-${m[2]}`, dev, devTo, sub };
}
export const orderKey = (o) => String(o || '').replace(INVIS, '').replace(/\s+/g, '').toLowerCase();
// When the order was placed: the date it was imported with (kept in orderAt), else creation / start date.
export const orderAt = (c) => Number(c.orderAt) || Number(c.createdAt) || Number(c.startAt) || 0;
// Oldest → newest: order date, then order number (Order-001 before Order-002), then device.
export function orderCompare(a, b) {
  const d = orderAt(a) - orderAt(b); if (Math.abs(d) >= 60000) return d;
  const x = parseOrderNo(a.orderNo), y = parseOrderNo(b.orderNo);
  if (x.num !== null && y.num !== null && x.num !== y.num) return x.num - y.num;
  return (x.dev || 0) - (y.dev || 0) || String(x.raw).localeCompare(String(y.raw), undefined, { numeric: true }) || d;
}
// Original sequence of the whole list. Inside one counter the NUMBER decides (Order-001, Order-002, … even if a row's date
// moved because of a renewal); the counters are then merged by date. Counters: your series (WLF/IBO/RLS share one), the old
// sheet (Order, OWL, CAR, XTR… shared one), resellers (Resseler-01…) and trials (T-…). Records without a number go by date.
export function orderRanks(list, s) {
  const series = s ? orderSeries(s) : ['WLF', 'IBO', 'RLS'];
  const grp = (p) => { const P = p.toUpperCase(); return series.includes(P) ? 'S' : P === 'T' ? 'T' : /^(RES+EL+ERS?|RESELLER|RSL|RLS)$/.test(P) ? 'R' + P : 'L'; };
  const groups = new Map(); const eff = new Map(); const pos = new Map();
  for (const c of list) { const o = parseOrderNo(c.orderNo); if (o.num === null) { eff.set(c, orderAt(c) || Infinity); continue; } const g = grp(o.prefix); (groups.get(g) || groups.set(g, []).get(g)).push([c, o]); }
  for (const arr of groups.values()) {
    arr.sort((a, b) => a[1].num - b[1].num || (a[1].dev || 0) - (b[1].dev || 0) || String(a[1].sub).localeCompare(String(b[1].sub), undefined, { numeric: true }) || orderAt(a[0]) - orderAt(b[0]));
    let m = Infinity; for (let i = arr.length - 1; i >= 0; i--) { const t = orderAt(arr[i][0]); if (t) m = Math.min(m, t); eff.set(arr[i][0], m); pos.set(arr[i][0], i); }
  }
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0); // safe with Infinity (records without any date go last)
  const out = [...list].sort((a, b) => cmp(eff.get(a), eff.get(b)) || cmp(pos.get(a) ?? 1e9, pos.get(b) ?? 1e9) || cmp(orderAt(a) || Infinity, orderAt(b) || Infinity));
  const rank = new Map(); out.forEach((c, i) => rank.set(c.id, i)); return rank;
}
// Device references of one order: WLF-045-01 … WLF-045-04
export function orderDevices(c) {
  const o = parseOrderNo(c.orderNo); if (!o.raw) return [];
  const n = Math.max(1, connDevicesSafe(c), o.devTo || 0); const w = 2;
  if (o.num === null || o.sub) return n > 1 ? Array.from({ length: n }, (_, i) => `${o.raw}-${String(i + 1).padStart(w, '0')}`) : [o.raw];
  if (n <= 1 && !o.dev) return [o.raw];
  return Array.from({ length: Math.max(n, o.dev || 0) }, (_, i) => `${o.main}-${String(i + 1).padStart(w, '0')}`);
}
const connDevicesSafe = (c) => { try { return connDevices(c); } catch { return Number(c.connections) || 1; } };
export function orderSeries(s) { const o = (s && s.orders) || {}; const l = String(o.series || [o.prefix, o.iboPrefix, o.rslPrefix].filter(Boolean).join(',')).split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean); return l.length ? l : ['WLF', 'IBO', 'RLS']; }
// Next number for a new order: one counter shared by the series prefixes (WLF / IBO / RLS).
export function nextOrderNo(list, s, kind = 'standard') {
  const o = s.orders || {}; const series = orderSeries(s); let max = 0;
  for (const c of list) { const p = parseOrderNo(c.orderNo); if (p.num !== null && series.includes(p.prefix.toUpperCase())) max = Math.max(max, p.num); }
  const prefix = String((kind === 'ibo' ? o.iboPrefix : kind === 'reseller' ? o.rslPrefix : o.prefix) || o.prefix || 'WLF').trim();
  let n = max + 1, ref;
  do { ref = `${prefix}-${String(n).padStart(Math.max(1, Math.min(6, Number(o.pad) || 3)), '0')}`; n++; } while (orderTaken(list, ref));
  return ref;
}
export const orderTaken = (list, ref, self) => {
  const k = orderKey(ref); if (!k) return null; const exact = list.find((c) => c !== self && orderKey(c.orderNo) === k); if (exact) return exact;
  const o = parseOrderNo(ref); if (o.num === null || o.dev || o.sub) return null; // WLF-045-02 may join order WLF-045 (another device)
  return list.find((c) => c !== self && parseOrderNo(c.orderNo).main.toLowerCase() === o.main.toLowerCase() && parseOrderNo(c.orderNo).num === o.num) || null;
};

// ---- Connections: one customer can have several lines (devices), each with its own type and M3U ----
export const CONN_TYPES = { xtream1: 'Xtream Codes 1 + M3U', xtream2: 'Xtream Codes 2 + M3U', unlimited: 'Unlimited M3U' };
export function connM3u(x) {
  const m = String(x.m3u || '').trim(); if (m) return m;
  const dns = String(x.dns || '').replace(/\/+$/, '');
  return dns && x.u ? `${dns}/get.php?username=${encodeURIComponent(x.u)}&password=${encodeURIComponent(x.p || '')}&type=m3u_plus&output=ts` : '';
}
// Cleans the extra connections typed in the dashboard. A pasted M3U link fills username, password and DNS.
export function cleanConns(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 20).map((r) => {
    r = r || {}; const type = CONN_TYPES[r.type] ? r.type : 'xtream1';
    let u = String(r.u ?? r.username ?? '').trim().slice(0, 80), p = String(r.p ?? r.password ?? '').trim().slice(0, 80);
    let dns = String(r.dns || '').trim().replace(/\/+$/, '').slice(0, 200); const m3u = String(r.m3u || '').trim().slice(0, 1500);
    if (m3u && (!u || !p || !dns)) { const ln = parseLineLink(m3u); if (ln) { u = u || ln.u; p = p || ln.p; dns = dns || ln.dns; } }
    if (dns && !/^https?:\/\//i.test(dns)) dns = 'http://' + dns;
    return { id: /^[\w-]{1,24}$/.test(String(r.id || '')) ? String(r.id) : uid(5), type, u, p, dns, m3u, devices: Math.max(1, Math.min(50, Math.round(Number(r.devices) || 1))), label: String(r.label || '').trim().slice(0, 40) };
  }).filter((x) => x.m3u || (x.u && x.p));
}
// Every connection of a customer, the main line first: what the profile page, emails and messages show.
export function customerConns(c, s) {
  const dns = String(c.dns || s?.email?.dns || s?.player?.serverUrl || '').replace(/\/+$/, '');
  const main = { id: 'main', main: true, type: CONN_TYPES[c.lineType] ? c.lineType : 'xtream1', u: c.lineUsername || '', p: c.linePassword || '', dns, m3u: String(c.m3u || '').trim(), devices: Math.max(1, Number(c.connections) || 1), label: '' };
  const out = (main.u || main.m3u) ? [main] : [];
  for (const x of cleanConns(c.lines)) out.push({ ...x, main: false });
  return out.map((x) => ({ ...x, typeName: CONN_TYPES[x.type], m3u: connM3u(x) }));
}
export const connDevices = (c) => customerConns(c).reduce((a, x) => a + x.devices, 0) || Math.max(1, Number(c.connections) || 1);
// Plain-text list of the extra connections (for WhatsApp / Telegram).
function connsText(c, s, lang) {
  const extra = customerConns(c, s).filter((x) => !x.main); if (!extra.length) return '';
  return extra.map((x, i) => `📡 *${tx(lang, 'conn')} ${i + 2}* — ${x.label ? x.label + ' · ' : ''}${x.typeName} · ${x.devices} ${tx(lang, 'devs')}${x.u ? `\n👤 ${tx(lang, 'user')}: ${x.u}\n🔑 ${tx(lang, 'pass')}: ${x.p}` : ''}${x.dns && x.u ? `\n🌐 DNS: ${x.dns}` : ''}${x.m3u ? `\n📋 M3U:\n${x.m3u}` : ''}`).join('\n\n');
}
// ---- Seasonal promotion (Black Friday) ----
const dayStart = (d) => { const t = Date.parse(String(d || '') + 'T00:00:00Z'); return isNaN(t) ? null : t; };
export function promoLive(s, channel, now = Date.now()) {
  const p = s.promo || {}; if (!p.on || !String(p.code || '').trim()) return null;
  if (channel && p[channel] === false) return null;
  const a = dayStart(p.from), b = dayStart(p.to);
  if (a !== null && now < a) return null; if (b !== null && now >= b + 86400000) return null;
  return p;
}
const promoEnd = (p, lang) => { const b = dayStart(p.to); return b === null ? '' : new Date(b).toLocaleDateString(langLocale(lang), { day: 'numeric', month: 'long', timeZone: 'UTC' }); };
// The promotion paragraph added to WhatsApp / Telegram messages, in the customer's language.
export function promoText(s, lang, p) {
  p = p || s.promo || {}; const app = s.branding?.appName || 'IPTV'; const code = String(p.code || '').trim(); const name = String(p.name || 'Black Friday').trim();
  const offer = String(p.offer || '').trim(); const end = promoEnd(p, lang); const site = String(s.renewalOffer?.url || s.email?.website || '').replace(/\/+$/, '');
  const lead = offer ? tx(lang, 'promoLeadO', { offer, app }) : tx(lang, 'promoLead', { app });
  return tx(lang, 'promoWa', { name, lead, code, site: site ? tx(lang, 'promoAt', { site }) : '', end: end ? tx(lang, 'promoEnd', { end }) : '' });
}
// Ready-made Black Friday newsletter (all languages) for the newsletter tool.
export function promoCampaign(s) { const p = s.promo || {}; return seasonCampaign(s, 'blackfriday', { offer: p.offer, code: p.code, end: p.to }); }
const promoBanner = (lang, p) => { const offer = String(p.offer || '').trim(); const code = String(p.code || '').trim();
  return tx(lang, 'banner', { lead: offer ? tx(lang, 'bannerO', { offer }) : tx(lang, 'bannerN'), code }); };
// Email to a reseller after an order (or when the login is sent): confirmation, order details, dashboard login (/rsl) and IPTV panel.
export function resellerOrderEmail(s, p, order, login, appUrl, opts = {}) {
  const lang = okLang(p.lang); const M = RSM[lang]; const f = (k, v = {}) => String(M[k]).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
  const base = String(s.email.appUrl || appUrl || 'https://intproto-tv.store').replace(/\/+$/, ''); const app = s.branding.appName || 'IPTV';
  const dash = base + '/rsl'; const first = String(p.name || '').trim().split(/\s+/)[0] || M.there;
  const day = (t) => new Date(t || Date.now()).toLocaleDateString(langLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [];
  if (order) {
    lines.push(opts.isNew ? f('welcome', { app }) : f('thanks', { credits: order.credits }));
    lines.push(`*${M.order}:* ${order.ref || '—'}\n*${M.pkg}:* ${order.pkg || M.credits}${order.credits && !/credit/i.test(order.pkg || '') ? ` · ${order.credits} ${M.credits}` : ''}\n*${M.amount}:* ${order.amount ? `${Number(order.amount).toFixed(2)} ${order.currency || ''}` : '—'}\n*${M.date}:* ${day(order.at)}\n*${M.rid}:* ${p.rslId}`);
  } else lines.push(f('loginOnly', { app }));
  lines.push(`*${M.dash}*\n*${M.link}:* ${dash}\n*${M.user}:* ${login.username}\n*${M.pass}:* ${login.pass || M.chosen}`);
  if (p.panelUrl || p.panelUser) lines.push(`*${M.panel}*\n${p.panelUrl ? `*${M.link}:* ${p.panelUrl}\n` : ''}${p.panelUser ? `*${M.user}:* ${p.panelUser}\n` : ''}${p.panelPass ? `*${M.pass}:* ${p.panelPass}` : ''}`.trim());
  lines.push(M.about); lines.push(f('help', { wa: s.branding.whatsapp ? M.wa : '' }));
  const subject = order ? (opts.isNew ? f('sNew', { app }) : f('sOrder', { credits: order.credits, app })) : f('sLogin', { app });
  const camp = { split: false, lang, badge: order ? M.badgeOrder : M.badgeLogin, content: { all: { subject, title: f(order ? (opts.isNew ? 'tNew' : 'tOrder') : 'tLogin', { name: first }).replace(/,\s*!/, '!').replace(/\s+!/, ' !'), body: lines.join('\n\n'), button: M.btn } }, link: dash };
  return newsletterEmail(s, { name: p.name, lang }, camp, appUrl, '');
}
// Post for the public Telegram channel.
export function promoChannelPost(s) {
  const p = s.promo || {}; const app = s.branding?.appName || 'IPTV'; const site = String(s.renewalOffer?.url || s.email?.website || '').replace(/\/+$/, '');
  return `${promoText(s, 'en', p).replace(/\*/g, '')}\n\n📺 Live TV, movies and series on all your devices: Smart TV, phone, tablet, Firestick and more.\n${site ? `👉 ${site}\n` : ''}💬 Questions? Message us anytime.\n\n#${String(p.name || 'BlackFriday').replace(/\W+/g, '')} #${app.replace(/\W+/g, '')}`;
}
// Finds the credit balance in a panel answer: the path from API settings first, then the usual field names.
const CREDIT_KEYS = ['credits', 'credit', 'balance', 'credit_balance', 'available_credits', 'reseller_credits', 'points'];
const toNum = (v) => { if (typeof v === 'number' && isFinite(v)) return v; if (typeof v === 'string') { const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/); if (m && v.length < 40) return Number(m[0]); } return null; };
export function findCredits(data, path) {
  const direct = path ? toNum(path.split('.').reduce((o, k) => (o == null ? o : o[k]), data)) : null;
  if (direct !== null) return direct;
  if (typeof data === 'string' || typeof data === 'number') return toNum(data);
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 3) return null;
    for (const k of Object.keys(o)) if (CREDIT_KEYS.includes(k.toLowerCase())) { const n = toNum(o[k]); if (n !== null) return n; }
    for (const k of Object.keys(o)) { const n = walk(o[k], depth + 1); if (n !== null) return n; }
    return null;
  };
  return walk(data, 0);
}
// Email addresses that can never receive mail: common typing mistakes in well-known domains.
const DOMAIN_FIX = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.fr': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmaill.com': 'hotmail.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.con': 'outlook.com', 'outlook.co': 'outlook.com', 'icloud.con': 'icloud.com', 'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'live.con': 'live.com' };
export function emailTypo(email) { const e = cleanEmail(email); const d = e.split('@')[1] || ''; return DOMAIN_FIX[d] ? e.split('@')[0] + '@' + DOMAIN_FIX[d] : ''; }
// Full HMAC (hex) with SHA-256 or SHA-1 — used for Stripe webhook signatures and two-factor codes.
async function hmacRaw(keyBytes, msgBytes, hash = 'SHA-256') {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, msgBytes));
}
const sha256 = async (t) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(t)))));
const sameText = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
// Checks a Stripe "Stripe-Signature" header against the raw request body. Returns true only for a fresh, correctly signed event.
export async function stripeSigOk(raw, header, secret, now = Date.now(), toleranceSec = 300) {
  const parts = String(header || '').split(',').map((x) => x.trim().split('='));
  const ts = (parts.find((x) => x[0] === 't') || [])[1];
  const sigs = parts.filter((x) => x[0] === 'v1').map((x) => x[1]);
  if (!ts || !sigs.length || !secret || Math.abs(now / 1000 - Number(ts)) > toleranceSec) return false;
  const want = hex(await hmacRaw(enc.encode(secret), enc.encode(`${ts}.${raw}`)));
  return sigs.some((g) => sameText(g, want));
}
export async function stripeSign(raw, secret, ts = Math.floor(Date.now() / 1000)) { return `t=${ts},v1=${hex(await hmacRaw(enc.encode(secret), enc.encode(`${ts}.${raw}`)))}`; }
// Two-factor codes (TOTP, RFC 6238): 6 digits, 30 seconds — works with Google Authenticator, Authy, 1Password…
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(bytes) { let bits = 0, val = 0, out = ''; for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; }
export function b32decode(str) { let bits = 0, val = 0; const out = []; for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
export async function totp(secret, at = Date.now(), step = 0) {
  let c = Math.floor(at / 30000) + step; const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const h = await hmacRaw(b32decode(secret), msg, 'SHA-1'); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
}
export async function totpOk(secret, code, at = Date.now()) {
  code = String(code || '').replace(/\D/g, ''); if (code.length !== 6 || !secret) return false;
  for (const st of [0, -1, 1]) if (sameText(await totp(secret, at, st), code)) return true;
  return false;
}
// Stripe pay links: tell Stripe which customer is paying, so the payment can activate the right account.
export function payUrlFor(url, c) {
  if (!c || !/^https:\/\/(buy|checkout)\.stripe\.com\//.test(String(url || ''))) return url;
  const u = new URL(url); u.searchParams.set('client_reference_id', c.id);
  const em = cleanEmail(c.email); if (em) u.searchParams.set('prefilled_email', em);
  return u.toString();
}
export const toUsd = (amount, cur, rates) => (Number(amount) || 0) / (Number((rates || {})[cur]) || 1);
export const fromUsd = (usd, cur, rates) => (Number(usd) || 0) * (Number((rates || {})[cur]) || 1);
const DAYMS = 86400000;
const planCredits = (p) => (p && p.credits != null && p.credits !== '' ? Number(p.credits) : p ? Math.max(1, Math.round((p.days || 30) / 30)) : 1);
const escHtml = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Email texts in English and French
const MAIL = {
  en: { trialSubject: 'Your free {hours}h trial is ready', welcomeSubject: 'Your account is ready', hello: 'Hello {name},', trialBody: 'Your free trial is active for {hours} hours. Sign in with these details:', welcomeBody: 'Your subscription is active. Sign in with these details:', user: 'Username', pass: 'Password', expires: 'Expires', open: 'Open the app', install: 'Tip: add the app to your home screen to use it like a normal app.', expirySubject: 'Your subscription ends in {days} days', expiryBody: 'Your subscription ends on {date}. Contact us to renew and keep watching.', thanks: 'Thank you!' },
  fr: { trialSubject: 'Votre essai gratuit de {hours}h est prêt', welcomeSubject: 'Votre compte est prêt', hello: 'Bonjour {name},', trialBody: 'Votre essai gratuit est actif pendant {hours} heures. Connectez-vous avec ces informations :', welcomeBody: 'Votre abonnement est actif. Connectez-vous avec ces informations :', user: "Nom d'utilisateur", pass: 'Mot de passe', expires: 'Expire le', open: "Ouvrir l'application", install: "Astuce : ajoutez l'application à votre écran d'accueil.", expirySubject: 'Votre abonnement se termine dans {days} jours', expiryBody: 'Votre abonnement se termine le {date}. Contactez-nous pour le renouveler.', thanks: 'Merci !' },

};
const mt = (lang, k, v = {}) => String((MAIL[lang] || MAIL.en)[k] || MAIL.en[k]).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
function mailHtml(s, lang, rows, intro, name) {
  const b = s.branding; const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const url = s.email.appUrl;
  return `<div dir="${dir}" style="font-family:Arial,Tahoma,sans-serif;background:#0b0d17;padding:24px"><div style="max-width:480px;margin:auto;background:#141726;border-radius:16px;padding:24px;color:#eef0fa">
  <h2 style="margin:0 0 4px;color:#fff">${escHtml(b.appName)}</h2><p style="color:#9aa0b8;margin:0 0 18px">${escHtml(b.tagline)}</p>
  <p>${escHtml(mt(lang, 'hello', { name }))}</p><p>${escHtml(intro)}</p>
  <table style="width:100%;border-collapse:collapse;margin:14px 0">${rows.map(([k, v]) => `<tr><td style="padding:8px;color:#9aa0b8;border-bottom:1px solid #2a2e45">${escHtml(k)}</td><td style="padding:8px;font-weight:bold;border-bottom:1px solid #2a2e45">${escHtml(v)}</td></tr>`).join('')}</table>
  ${url ? `<p><a href="${escHtml(url)}" style="display:inline-block;background:${escHtml(b.primary)};color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${escHtml(mt(lang, 'open'))}</a></p>` : ''}
  <p style="color:#9aa0b8;font-size:13px">${escHtml(mt(lang, 'install'))}</p>
  ${b.supportUrl ? `<p style="font-size:13px"><a href="${escHtml(b.supportUrl)}" style="color:${escHtml(b.accent)}">${escHtml(b.supportLabel)}</a></p>` : ''}
  <p>${escHtml(mt(lang, 'thanks'))}</p></div></div>`;
}

// ---- Customer access email (your INTPROTO-TV template), in English, French and Arabic ----
const AM = {
  en: { dir: 'ltr', trialTitle: 'Your Free Trial Is Ready 🎉', subTitle: 'Your Subscription Is Active ✅', trialSub: 'Instant activation complete. Start streaming now.', subSub: 'Your line is active. Start streaming now.',
    dear: 'Dear {name},', trialIntro: 'Thank you for choosing <b>{app}</b>. We’re pleased to let you know that your free trial is ready to use.', subIntro: 'Thank you for choosing <b>{app}</b>. Your subscription is active and ready to use.',
    trialNote: '<b>⏳ Please note:</b> Your free trial expires after <b>{hours} hours</b>.', subNote: '<b>📅 Valid until:</b> {date}',
    details: '📺 Access Details', detailsIntro: 'Watch in our app, or use any compatible IPTV player with these details:', user: 'Username', pass: 'Password', dns: 'DNS / Portal', m3u: 'M3U Line URLs',
    appTitle: '📲 Watch in the {app} app', appText: 'Works on Android, Android TV, iPhone, iPad, Windows and Mac. It updates by itself.', openApp: 'Open the app', getApp: 'Download the app',
    setup: '⚙️ Setup instructions for other IPTV players', s1: 'Download and install a compatible IPTV player (e.g. IPTV Smarters Pro, XCIPTV or TiviMate).', s2: 'Open it and choose <b>Login with Xtream Codes API</b> or <b>M3U Playlist URL</b>.', s3: 'Enter the <b>Username</b>, <b>Password</b> and <b>DNS URL</b> above.', s4: 'Tap <b>Connect</b> or <b>Add User</b>, wait for channels to load, and enjoy!',
    help: '📞 Need assistance?', helpText: 'If you have any questions or need help with setup, our customer support team is here for you.', support: 'Customer support', email: 'Email', website: 'Website', whatsapp: 'WhatsApp',
    closing: 'We sincerely appreciate your interest in <b>{app}</b> and hope you enjoy your experience.', regards: 'Warm regards,', team: 'Customer Support Team',
    footer: 'Thank you for your trust and support. If you have any questions, please contact our support team — we are here to make your IPTV experience exceptional.' },
  fr: { dir: 'ltr', trialTitle: 'Votre essai gratuit est prêt 🎉', subTitle: 'Votre abonnement est actif ✅', trialSub: 'Activation instantanée terminée. Commencez à regarder.', subSub: 'Votre ligne est active. Commencez à regarder.',
    dear: 'Cher/Chère {name},', trialIntro: "Merci d'avoir choisi <b>{app}</b>. Nous avons le plaisir de vous informer que votre essai gratuit est prêt.", subIntro: "Merci d'avoir choisi <b>{app}</b>. Votre abonnement est actif et prêt à l'emploi.",
    trialNote: '<b>⏳ À noter :</b> votre essai gratuit expire après <b>{hours} heures</b>.', subNote: "<b>📅 Valable jusqu'au :</b> {date}",
    details: "📺 Informations d'accès", detailsIntro: "Regardez dans notre application, ou utilisez un lecteur IPTV compatible avec ces informations :", user: "Nom d'utilisateur", pass: 'Mot de passe', dns: 'DNS / Portail', m3u: 'Liens M3U',
    appTitle: "📲 Regardez dans l'application {app}", appText: "Fonctionne sur Android, Android TV, iPhone, iPad, Windows et Mac. Mise à jour automatique.", openApp: "Ouvrir l'application", getApp: "Télécharger l'application",
    setup: "⚙️ Configuration pour d'autres lecteurs IPTV", s1: 'Installez un lecteur IPTV compatible (ex. IPTV Smarters Pro, XCIPTV ou TiviMate).', s2: 'Ouvrez-le et choisissez <b>Login with Xtream Codes API</b> ou <b>M3U Playlist URL</b>.', s3: "Saisissez le <b>nom d'utilisateur</b>, le <b>mot de passe</b> et l'<b>URL DNS</b> ci-dessus.", s4: 'Appuyez sur <b>Connect</b> ou <b>Add User</b>, attendez le chargement des chaînes et profitez !',
    help: "📞 Besoin d'aide ?", helpText: "Pour toute question ou aide à l'installation, notre service client est là pour vous.", support: 'Service client', email: 'E-mail', website: 'Site web', whatsapp: 'WhatsApp',
    closing: "Nous vous remercions de votre intérêt pour <b>{app}</b> et espérons que vous apprécierez l'expérience.", regards: 'Cordialement,', team: 'Service client',
    footer: "Merci pour votre confiance. Pour toute question, contactez notre service client — nous sommes là pour vous offrir la meilleure expérience IPTV." },

};
// The owner can reword every email. The built-in wording is kept as the default; their changes are laid on top.
const tplDicts = () => ({ MAIL, AM, RM, OM });
let tplSnap = null; // taken once, before any of the owner's wording is applied
export const tplDefaults = () => (tplSnap ||= JSON.parse(JSON.stringify(tplDicts())));
export function cleanMailTexts(custom) {
  const out = {};
  for (const d of Object.keys(tplDicts())) for (const lang of Object.keys(tplDefaults()[d])) for (const k of Object.keys(tplDefaults()[d][lang])) {
    if (k === 'dir') continue;
    const v = custom && custom[d] && custom[d][lang] ? custom[d][lang][k] : undefined;
    if (typeof v === 'string' && v.trim() && v !== tplDefaults()[d][lang][k]) ((out[d] ||= {})[lang] ||= {})[k] = v.slice(0, 4000);
  }
  return out;
}
export function applyMailTexts(custom) {
  for (const d of Object.keys(tplDicts())) for (const lang of Object.keys(tplDefaults()[d])) for (const k of Object.keys(tplDefaults()[d][lang])) {
    const v = custom && custom[d] && custom[d][lang] ? custom[d][lang][k] : undefined;
    tplDicts()[d][lang][k] = k !== 'dir' && typeof v === 'string' && v.trim() ? v : tplDefaults()[d][lang][k];
  }
}
// "My profile" email: the app sign-in (username + password) and a button to the customer's /profile page
export function profileEmail(s, c, appUrl) {
  const base = String(s.email.appUrl || appUrl || '').replace(/\/+$/, ''); const lang = okLang(c.lang); const app = s.branding.appName || 'IPTV';
  const pass = c.loginPassword || (c.ownPassword ? '' : c.linePassword) || '';
  const profile = (base || 'https://intproto-tv.store') + '/profile'; const mail = cleanEmail(c.email); const T = (k, v) => tx(lang, k, v);
  const appPage = (base || 'https://intproto-tv.store') + '/app';
  // login details stay in the email, with the profile link; the button now installs the app (with notifications)
  const body = `${T('profBody', { app })}\n\n*${T('profEmail')}:* ${mail || '—'}\n*${T('profUser')}:* ${c.username}\n*${T('profPass')}:* ${pass || T('profChosen')}\n*${T('profLink')}:* ${profile}\n*📲 ${T('profAppL')}:* ${appPage}\n\n${T('profAppTap', { app })}\n\n${appLinksText(base || 'https://intproto-tv.store', lang)}`;
  const n = customerConns(c, s).length;
  const extraTxt = n > 1 ? '\n\n' + T('profN', { n }) : '';
  const camp = { split: false, lang, content: { all: { subject: T('profSubj', { app }), title: T('profTitle'), body: body + extraTxt, button: T('profAppBtn') } }, link: appPage };
  return newsletterEmail(s, c, camp, appUrl, '');
}
// ---- Renewal emails: 5 ready models in 5 languages (7 days before, last day, expired win-back, multi-device upgrade, short code) ----
export const RENEW_DEF = { auto: true, code: '', discount: '', amount: '', d7: 'm1', today: 'm2', expired: 'm3', expiredDays: 30 };
const RNL = {
  en: { m: (n) => n === 12 ? '1 Year' : n === 1 ? '1 Month' : n + ' Months', dev: (n) => n + ' Devices (1 Year)', devs: 'Devices', save: 'Save', off: '{d} OFF', offNone: 'a discount on', renew: 'Renew now', valid48: '(Valid for the next 48 hours!)' },
  fr: { m: (n) => n === 12 ? '1 an' : n + ' mois', dev: (n) => n + ' appareils (1 an)', devs: 'appareils', save: 'Économisez', off: '{d} de réduction sur', offNone: 'une réduction sur', renew: 'Renouveler', valid48: '(Valable 48 heures !)' },
  de: { m: (n) => n === 12 ? '1 Jahr' : n === 1 ? '1 Monat' : n + ' Monate', dev: (n) => n + ' Geräte (1 Jahr)', devs: 'Geräte', save: 'Sparen Sie', off: '{d} Rabatt auf', offNone: 'einen Rabatt auf', renew: 'Jetzt verlängern', valid48: '(48 Stunden gültig!)' },
  es: { m: (n) => n === 12 ? '1 año' : n === 1 ? '1 mes' : n + ' meses', dev: (n) => n + ' dispositivos (1 año)', devs: 'dispositivos', save: 'Ahorra', off: '{d} de descuento en', offNone: 'un descuento en', renew: 'Renovar ahora', valid48: '(¡Válido 48 horas!)' },
  it: { m: (n) => n === 12 ? '1 anno' : n === 1 ? '1 mese' : n + ' mesi', dev: (n) => n + ' dispositivi (1 anno)', devs: 'dispositivi', save: 'Risparmia', off: '{d} di sconto su', offNone: 'uno sconto su', renew: 'Rinnova ora', valid48: '(Valido per 48 ore!)' } };
export const RENEW_MODELS = {
  m1: { icon: '⏰', name: '7 days before (plans + code)', en: { s: '⏰ Your {app} subscription expires in 7 days', t: 'Renew early, keep watching', b: 'Your {app} subscription is set to expire in 7 days on *{date}*.\n\nRenew early today so you don\'t experience any interruption to your favorite live channels, sports, movies, and series! As a thank-you for staying with us, use your exclusive promo code at checkout:\n\n🎁 *Promo Code: {code}*{save}\n\n*Our Plans:*\n{plans}\n• Multi-Device (1 Year): {multi}\n\n👉 *Renew Now:* {link}\n\nNeed help with your renewal? Reach our 24/7 support team anytime at {support}.' },
    fr: { s: '⏰ Votre abonnement {app} expire dans 7 jours', t: 'Renouvelez tôt, continuez à regarder', b: 'Votre abonnement {app} expire dans 7 jours, le *{date}*.\n\nRenouvelez dès aujourd\'hui pour ne pas interrompre vos chaînes, sports, films et séries préférés ! Pour vous remercier de votre fidélité, utilisez votre code promo exclusif au paiement :\n\n🎁 *Code promo : {code}*{save}\n\n*Nos offres :*\n{plans}\n• Multi-écrans (1 an) : {multi}\n\n👉 *Renouveler maintenant :* {link}\n\nBesoin d\'aide pour renouveler ? Notre support est disponible 24h/24 : {support}.' },
    de: { s: '⏰ Ihr {app}-Abo endet in 7 Tagen', t: 'Früh verlängern, weiter schauen', b: 'Ihr {app}-Abonnement endet in 7 Tagen, am *{date}*.\n\nVerlängern Sie noch heute, damit Ihre Lieblingssender, Sport, Filme und Serien ohne Unterbrechung weiterlaufen! Als Dankeschön für Ihre Treue nutzen Sie Ihren exklusiven Gutscheincode beim Bezahlen:\n\n🎁 *Gutscheincode: {code}*{save}\n\n*Unsere Tarife:*\n{plans}\n• Multi-Gerät (1 Jahr): {multi}\n\n👉 *Jetzt verlängern:* {link}\n\nHilfe bei der Verlängerung? Unser Support ist rund um die Uhr erreichbar: {support}.' },
    es: { s: '⏰ Tu suscripción a {app} vence en 7 días', t: 'Renueva antes y sigue viendo', b: 'Tu suscripción a {app} vence en 7 días, el *{date}*.\n\n¡Renueva hoy para no interrumpir tus canales, deportes, películas y series favoritos! Como agradecimiento por seguir con nosotros, usa tu código promocional exclusivo al pagar:\n\n🎁 *Código promocional: {code}*{save}\n\n*Nuestros planes:*\n{plans}\n• Multidispositivo (1 año): {multi}\n\n👉 *Renovar ahora:* {link}\n\n¿Necesitas ayuda? Nuestro soporte 24/7 está aquí: {support}.' },
    it: { s: '⏰ Il tuo abbonamento {app} scade tra 7 giorni', t: 'Rinnova prima, continua a guardare', b: 'Il tuo abbonamento {app} scade tra 7 giorni, il *{date}*.\n\nRinnova oggi per non interrompere i tuoi canali, sport, film e serie preferiti! Per ringraziarti della fedeltà, usa il tuo codice promo esclusivo al pagamento:\n\n🎁 *Codice promo: {code}*{save}\n\n*I nostri piani:*\n{plans}\n• Multi-dispositivo (1 anno): {multi}\n\n👉 *Rinnova ora:* {link}\n\nHai bisogno di aiuto? Il nostro supporto 24/7 è qui: {support}.' } },
  m2: { icon: '⚠️', name: 'Last day (urgent + IBO tip)', en: { s: '⚠️ Action Required: Your {app} expires today! (Promo code inside)', t: 'Your access expires today', b: 'This is a quick reminder that your {app} access expires today, *{date}*.\n\nTo keep your account active without losing your playlists or settings, renew right now and claim an instant discount with your personal code:\n\n🔥 *Promo Code: {code}*\n\n👉 *Click Here to Extend Your Subscription:* {link}\n\n*Tip for Seamless Streaming:* Pair your renewed subscription with IBO Player ({ibo} for 1 year) to skip free app glitches and enjoy built-in VPN security and ultra-smooth 4K playback.\n\nQuestions? Contact us at {support} or reply directly to this email.' },
    fr: { s: '⚠️ Action requise : votre {app} expire aujourd\'hui ! (code promo inclus)', t: 'Votre accès expire aujourd\'hui', b: 'Petit rappel : votre accès {app} expire aujourd\'hui, le *{date}*.\n\nPour garder votre compte actif sans perdre vos listes ni vos réglages, renouvelez maintenant et profitez d\'une réduction immédiate avec votre code personnel :\n\n🔥 *Code promo : {code}*\n\n👉 *Cliquez ici pour prolonger votre abonnement :* {link}\n\n*Astuce pour un streaming sans coupure :* associez votre abonnement à IBO Player ({ibo} pour 1 an) pour éviter les bugs des applis gratuites, avec VPN sécurisé intégré et lecture 4K ultra fluide.\n\nDes questions ? Contactez-nous sur {support} ou répondez simplement à cet e-mail.' },
    de: { s: '⚠️ Handlungsbedarf: Ihr {app} endet heute! (Gutscheincode inklusive)', t: 'Ihr Zugang endet heute', b: 'Kurze Erinnerung: Ihr {app}-Zugang endet heute, am *{date}*.\n\nDamit Ihr Konto aktiv bleibt und Sie keine Playlists oder Einstellungen verlieren, verlängern Sie jetzt und sichern Sie sich mit Ihrem persönlichen Code einen Sofortrabatt:\n\n🔥 *Gutscheincode: {code}*\n\n👉 *Hier klicken, um Ihr Abo zu verlängern:* {link}\n\n*Tipp für ruckelfreies Streaming:* Kombinieren Sie Ihr Abo mit IBO Player ({ibo} für 1 Jahr) – keine Fehler kostenloser Apps, integriertes sicheres VPN und flüssige 4K-Wiedergabe.\n\nFragen? Kontaktieren Sie uns unter {support} oder antworten Sie einfach auf diese E-Mail.' },
    es: { s: '⚠️ Acción necesaria: ¡tu {app} vence hoy! (código promocional dentro)', t: 'Tu acceso vence hoy', b: 'Te recordamos que tu acceso a {app} vence hoy, *{date}*.\n\nPara mantener tu cuenta activa sin perder tus listas ni ajustes, renueva ahora y consigue un descuento inmediato con tu código personal:\n\n🔥 *Código promocional: {code}*\n\n👉 *Haz clic aquí para ampliar tu suscripción:* {link}\n\n*Consejo para un streaming sin cortes:* combina tu suscripción con IBO Player ({ibo} por 1 año) y olvídate de los fallos de las apps gratuitas, con VPN segura incluida y reproducción 4K muy fluida.\n\n¿Preguntas? Escríbenos en {support} o responde a este correo.' },
    it: { s: '⚠️ Azione richiesta: il tuo {app} scade oggi! (codice promo incluso)', t: 'Il tuo accesso scade oggi', b: 'Un breve promemoria: il tuo accesso {app} scade oggi, *{date}*.\n\nPer mantenere attivo l\'account senza perdere playlist e impostazioni, rinnova subito e ottieni uno sconto immediato con il tuo codice personale:\n\n🔥 *Codice promo: {code}*\n\n👉 *Clicca qui per prolungare l\'abbonamento:* {link}\n\n*Consiglio per uno streaming senza intoppi:* abbina l\'abbonamento a IBO Player ({ibo} per 1 anno) per evitare i problemi delle app gratuite, con VPN sicura inclusa e riproduzione 4K fluidissima.\n\nDomande? Contattaci su {support} o rispondi a questa email.' } },
  m3: { icon: '🎁', name: 'Expired win-back (48 h code)', en: { s: 'We miss you! Come back to {app} with an exclusive discount 🎁', t: 'We\'d love to have you back', b: 'We noticed your {app} subscription expired on *{date}*, and we\'d love to have you back!\n\nBig sports matches, blockbuster cinema premieres, and brand-new series are streaming right now in Ultra HD. Reactivate your account in seconds with a special comeback discount:\n\n🎟️ *Comeback Promo Code: {code}* {valid48}\n\n👉 *Reactivate Your Account Now:* {link}\n\nAll your login details remain ready for instant activation across Smart TV, Samsung, iPhone, Android, and MacBook.\n\nNeed assistance getting back online? Our team is here 24/7: {support}' },
    fr: { s: 'Vous nous manquez ! Revenez sur {app} avec une réduction exclusive 🎁', t: 'Nous serions ravis de vous retrouver', b: 'Votre abonnement {app} a expiré le *{date}* et nous serions ravis de vous retrouver !\n\nGrands matchs, avant-premières cinéma et nouvelles séries sont diffusés en ce moment en Ultra HD. Réactivez votre compte en quelques secondes avec une réduction de retour spéciale :\n\n🎟️ *Code promo retour : {code}* {valid48}\n\n👉 *Réactiver mon compte :* {link}\n\nTous vos identifiants restent prêts pour une activation immédiate sur Smart TV, Samsung, iPhone, Android et MacBook.\n\nBesoin d\'aide pour revenir ? Notre équipe est là 24h/24 : {support}' },
    de: { s: 'Wir vermissen Sie! Kommen Sie mit einem exklusiven Rabatt zu {app} zurück 🎁', t: 'Wir würden uns freuen, Sie zurückzuhaben', b: 'Ihr {app}-Abonnement ist am *{date}* abgelaufen – wir würden uns freuen, Sie wieder dabeizuhaben!\n\nGroße Sportspiele, Kinopremieren und brandneue Serien laufen gerade in Ultra HD. Reaktivieren Sie Ihr Konto in Sekunden mit einem besonderen Willkommen-zurück-Rabatt:\n\n🎟️ *Comeback-Code: {code}* {valid48}\n\n👉 *Konto jetzt reaktivieren:* {link}\n\nIhre Zugangsdaten bleiben für die sofortige Aktivierung auf Smart TV, Samsung, iPhone, Android und MacBook bereit.\n\nHilfe beim Wiedereinstieg? Unser Team ist rund um die Uhr da: {support}' },
    es: { s: '¡Te echamos de menos! Vuelve a {app} con un descuento exclusivo 🎁', t: 'Nos encantaría tenerte de vuelta', b: 'Vimos que tu suscripción a {app} venció el *{date}* ¡y nos encantaría tenerte de vuelta!\n\nGrandes partidos, estrenos de cine y series nuevas se están emitiendo ahora mismo en Ultra HD. Reactiva tu cuenta en segundos con un descuento especial de regreso:\n\n🎟️ *Código de regreso: {code}* {valid48}\n\n👉 *Reactivar mi cuenta:* {link}\n\nTus datos de acceso siguen listos para activarse al instante en Smart TV, Samsung, iPhone, Android y MacBook.\n\n¿Necesitas ayuda para volver? Nuestro equipo está 24/7: {support}' },
    it: { s: 'Ci manchi! Torna su {app} con uno sconto esclusivo 🎁', t: 'Ci piacerebbe riaverti con noi', b: 'Il tuo abbonamento {app} è scaduto il *{date}* e ci piacerebbe riaverti con noi!\n\nGrandi partite, prime visioni al cinema e serie nuovissime sono in onda ora in Ultra HD. Riattiva l\'account in pochi secondi con uno sconto speciale di ritorno:\n\n🎟️ *Codice di ritorno: {code}* {valid48}\n\n👉 *Riattiva ora l\'account:* {link}\n\nI tuoi dati di accesso restano pronti per l\'attivazione immediata su Smart TV, Samsung, iPhone, Android e MacBook.\n\nServe aiuto per tornare online? Il nostro team è qui 24/7: {support}' } },
  m4: { icon: '⭐', name: 'VIP multi-device upgrade', en: { s: 'Upgrade to Multi-Device & Save! Special renewal offer for {fullname} 📺', t: 'Watch on more screens', b: 'Your {app} renewal is coming up on *{date}*!\n\nWant to watch live sports in the living room while family members stream movies in another room? Upgrade to a 1-Year Multi-Device Plan during your renewal and save extra with your VIP promo code:\n\n⭐ *VIP Promo Code: {code}*\n\n{multiList}\n_(before promo discount)_\n\n👉 *Renew & Upgrade Here:* {link}\n\nFor any questions or custom setups, visit {support}.' },
    fr: { s: 'Passez au multi-écrans et économisez ! Offre de renouvellement pour {fullname} 📺', t: 'Regardez sur plus d\'écrans', b: 'Votre renouvellement {app} arrive le *{date}* !\n\nEnvie de regarder le sport au salon pendant que la famille regarde un film dans une autre pièce ? Passez à une offre multi-écrans 1 an lors du renouvellement et économisez encore plus avec votre code VIP :\n\n⭐ *Code VIP : {code}*\n\n{multiList}\n_(avant réduction)_\n\n👉 *Renouveler et passer au multi-écrans :* {link}\n\nPour toute question ou installation sur mesure : {support}.' },
    de: { s: 'Upgrade auf Multi-Gerät & sparen! Sonderangebot für {fullname} 📺', t: 'Auf mehr Bildschirmen schauen', b: 'Ihre {app}-Verlängerung steht am *{date}* an!\n\nSport im Wohnzimmer, während die Familie im anderen Zimmer Filme schaut? Wechseln Sie bei der Verlängerung auf einen 1-Jahres-Multi-Gerät-Tarif und sparen Sie extra mit Ihrem VIP-Code:\n\n⭐ *VIP-Code: {code}*\n\n{multiList}\n_(vor Rabatt)_\n\n👉 *Verlängern & upgraden:* {link}\n\nFragen oder individuelle Einrichtung: {support}.' },
    es: { s: '¡Pásate a Multidispositivo y ahorra! Oferta de renovación para {fullname} 📺', t: 'Mira en más pantallas', b: '¡Tu renovación de {app} llega el *{date}*!\n\n¿Quieres ver deportes en el salón mientras tu familia ve películas en otra habitación? Pásate a un plan Multidispositivo de 1 año al renovar y ahorra aún más con tu código VIP:\n\n⭐ *Código VIP: {code}*\n\n{multiList}\n_(antes del descuento)_\n\n👉 *Renovar y mejorar aquí:* {link}\n\nPara cualquier duda o instalación personalizada: {support}.' },
    it: { s: 'Passa al Multi-dispositivo e risparmia! Offerta di rinnovo per {fullname} 📺', t: 'Guarda su più schermi', b: 'Il rinnovo di {app} è previsto il *{date}*!\n\nVuoi guardare lo sport in salotto mentre la famiglia guarda film in un\'altra stanza? Passa a un piano Multi-dispositivo da 1 anno al rinnovo e risparmia ancora di più con il tuo codice VIP:\n\n⭐ *Codice VIP: {code}*\n\n{multiList}\n_(prima dello sconto)_\n\n👉 *Rinnova e passa al multi-schermo:* {link}\n\nPer domande o configurazioni personalizzate: {support}.' } },
  m5: { icon: '⚡', name: 'Short & direct (code)', en: { s: 'Your {app} Renewal Code: {code} ⚡', t: 'Keep streaming', b: 'Keep your {app} streaming active without interruption! Your current plan renews/expires on *{date}*.\n\nUse promo code *{code}* at checkout to get {off} your next 3-Month, 6-Month, or 1-Year subscription.\n\n👉 *Renew in 1 Click:* {link}\n\nDownload the {app} App for instant notifications and easy access across your devices: {applink}\n24/7 Support: {support}' },
    fr: { s: 'Votre code de renouvellement {app} : {code} ⚡', t: 'Continuez à regarder', b: 'Gardez votre streaming {app} actif sans interruption ! Votre offre actuelle se renouvelle/expire le *{date}*.\n\nUtilisez le code *{code}* au paiement pour obtenir {off} votre prochain abonnement de 3 mois, 6 mois ou 1 an.\n\n👉 *Renouveler en 1 clic :* {link}\n\nTéléchargez l\'app {app} pour des notifications instantanées et un accès facile sur tous vos appareils : {applink}\nSupport 24h/24 : {support}' },
    de: { s: 'Ihr {app}-Verlängerungscode: {code} ⚡', t: 'Weiter streamen', b: 'Halten Sie Ihr {app}-Streaming ohne Unterbrechung aktiv! Ihr aktueller Tarif verlängert sich/endet am *{date}*.\n\nMit dem Code *{code}* beim Bezahlen erhalten Sie {off} Ihr nächstes 3-Monats-, 6-Monats- oder 1-Jahres-Abo.\n\n👉 *Mit 1 Klick verlängern:* {link}\n\nLaden Sie die {app}-App für sofortige Benachrichtigungen und einfachen Zugang auf all Ihren Geräten: {applink}\nSupport rund um die Uhr: {support}' },
    es: { s: 'Tu código de renovación de {app}: {code} ⚡', t: 'Sigue viendo', b: '¡Mantén tu streaming de {app} activo sin interrupciones! Tu plan actual se renueva/vence el *{date}*.\n\nUsa el código *{code}* al pagar y obtén {off} tu próxima suscripción de 3 meses, 6 meses o 1 año.\n\n👉 *Renueva en 1 clic:* {link}\n\nDescarga la app de {app} para recibir avisos al instante y acceder fácilmente desde todos tus dispositivos: {applink}\nSoporte 24/7: {support}' },
    it: { s: 'Il tuo codice di rinnovo {app}: {code} ⚡', t: 'Continua a guardare', b: 'Mantieni attivo il tuo streaming {app} senza interruzioni! Il tuo piano attuale si rinnova/scade il *{date}*.\n\nUsa il codice *{code}* al pagamento per ottenere {off} il tuo prossimo abbonamento da 3 mesi, 6 mesi o 1 anno.\n\n👉 *Rinnova con 1 clic:* {link}\n\nScarica l\'app {app} per notifiche immediate e accesso facile su tutti i tuoi dispositivi: {applink}\nSupporto 24/7: {support}' } } };
export const renewCfg = (s) => ({ ...RENEW_DEF, ...(s.renewModels || {}) });
// The promo code / discount used in renewal emails: the renewal settings first, then a live promotion, then the renewal offer coupon
export function renewCode(s) { const r = renewCfg(s); const pr = promoLive(s, 'email'); return { code: String(r.code || pr?.code || s.renewalOffer?.coupon || '').trim(), discount: String(r.discount || '').trim(), amount: String(r.amount || '').trim() }; }
export function renewModelEmail(s, c, model, link, appUrl) {
  const M = RENEW_MODELS[model] || RENEW_MODELS.m1; const lang = okLang(c.lang); const T = M[lang] || M.en; const N = RNL[lang] || RNL.en;
  const site = String(s.email.appUrl || appUrl || 'https://intproto-tv.store').replace(/\/+$/, ''); const app = s.branding.appName || 'INTPROTO-TV';
  const cur = s.currencyRule?.on !== false ? custCurrency(s, c) : s.orderCurrency || 'USD'; const money = (v) => (CUR_SIGN[cur] || '') + Number(v).toFixed(2) + (CUR_SIGN[cur] ? '' : ' ' + cur);
  const pk = (s.orderPackages || []).filter((p) => !/^ibo/i.test(p.id || '') && !/^ibo/i.test(p.title || ''));
  const single = [1, 3, 6, 12].map((m) => pk.find((p) => (Number(p.devices) || 1) === 1 && Math.abs((Number(p.days) || 0) - (m === 12 ? 365 : m * 30)) <= (m === 12 ? 6 : 3))).filter(Boolean);
  const multi = [2, 3, 4].map((d) => pk.find((p) => Number(p.devices) === d && Math.abs((Number(p.days) || 0) - 365) <= 6)).filter(Boolean);
  const mLabel = (p) => N.m(Math.round((Number(p.days) || 30) / 30) >= 12 ? 12 : Math.round((Number(p.days) || 30) / 30));
  const { code, discount, amount } = renewCode(s); const disc = discount ? (/%$/.test(discount) ? discount : discount + '%') : '';
  const iboP = (s.iboPromo && s.iboPromo.price) || 5.99;
  const date = new Date(c.expiresAt).toLocaleDateString(langLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' });
  const v = { app, fullname: c.name || c.username || '', date, code, link: link || site + '/?tab=account&go=packages', support: site + '/support', applink: site + '/app', ibo: money(iboP),
    save: disc || amount ? ` (${N.save} ${[disc, amount ? (/^[\d.,]+$/.test(amount) ? money(amount) : amount) : ''].filter(Boolean).join(' / ')})` : '',
    plans: single.map((p) => `• ${mLabel(p)}: ${money(p.price)}`).join('\n'), multi: multi.map((p) => `${p.devices} ${N.devs} (${money(p.price)})`).join(' | '),
    multiList: multi.map((p) => `• ${N.dev(p.devices)}: ${money(p.price)}`).join('\n'), off: disc ? N.off.replace('{d}', disc) : N.offNone, valid48: N.valid48 };
  let body = T.b; if (!code) body = body.split('\n').filter((l) => !/\{code\}/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n'); // no promo code: the code lines are left out
  if (!multi.length) body = body.split('\n').filter((l) => !/\{multi(List)?\}/.test(l)).join('\n');
  const fill = (t) => t.replace(/\{(\w+)\}/g, (m0, k) => k === 'name' ? m0 : v[k] !== undefined ? v[k] : m0);
  let subj = fill(T.s); if (!code) subj = subj.replace(/[:：]\s*$/, '').replace(/\s*\((Promo code inside|code promo inclus|Gutscheincode inklusive|código promocional dentro|codice promo incluso)\)/i, '').replace(/[:：]\s*⚡/, ' ⚡');
  const camp = { split: false, lang, badge: M.icon + ' ' + app, content: { all: { subject: subj, title: T.t, body: fill(body).replace(/_\((.+?)\)_/g, '($1)'), button: (M.icon === '🎁' ? '🎟️ ' : '👉 ') + N.renew } }, link: v.link };
  return newsletterEmail(s, c, camp, appUrl, '');
}
// ---- Agent work planning: the daily schedule (Monday–Sunday), tasks to check off, rules; owner edits, agents check off ----
export const WORKPLAN_DEF = {
  tz: 'Europe/Paris',
  slots: [
    { id: 's1', start: '08:30', end: '09:30', title: 'Check-In & Panel Login', icon: '🟢', tab: 'attendance' },
    { id: 's2', start: '09:30', end: '11:30', title: 'IPTV Customer Support & Order Checks', icon: '🛟', tab: 'support' },
    { id: 's3', start: '11:30', end: '13:00', title: 'Renewal Emails & Client Follow-Ups', icon: '🔁', tab: 'promos' },
    { id: 's4', start: '13:00', end: '15:00', title: 'WhatsApp & Telegram Customer Messaging', icon: '💬', tab: 'customers' },
    { id: 's5', start: '15:00', end: '18:00', title: 'US Morning Outreach (Emails, Newsletters & Promotions)', icon: '📧', tab: 'promos' },
    { id: 's6', start: '18:00', end: '19:00', title: 'Break / Shift Handover', icon: '☕', tab: 'teamchat', noCheck: true },
    { id: 's7', start: '19:00', end: '22:00', title: 'US Peak Outreach (WhatsApp & Telegram Promotions / Live Support)', icon: '🚀', tab: 'promos' },
  ],
  // what to post / send in the outreach slots, day by day (1 = Monday … 0 = Sunday)
  days: {
    1: { s5: '[FB] Anti-buffering tips / Emails', s7: '[TG] Weekly programme & service audit' },
    2: { s5: '[FB] TiviMate app tutorial / Emails', s7: '[TG] Tonight’s matches focus' },
    3: { s5: '[FB] VOD favourite (cinema & series 4K) / Emails', s7: '[TG] Champions League night' },
    4: { s5: '[FB] Referral programme (1 month free per referral) / Emails', s7: '[TG] Weekend match poll' },
    5: { s5: '[FB] Weekend flash offer (12 months) / Emails', s7: '[TG] Weekend schedule & pre-weekend note' },
    6: { s5: '[FB] Flash promos / Express activations', s7: '[TG] Live matches / Live support' },
    0: { s5: 'Week preparation & planning (calendar, visuals)', s7: '[TG] Weekend review & VOD teasing' },
  },
  rules: [
    '100% task completion: every scheduled activity is done and checked off in the work planner (synced to Google Sheets).',
    'View-only schedule & data: only the owner edits the schedule, message templates, links and WhatsApp numbers. Agents upload/paste data to send messages and check off their tasks.',
    'Messaging & marketing: sales and support agents send renewal emails, WhatsApp/Telegram messages, newsletters and promotions. Domains are visible, API keys stay hidden.',
    'Language & translator: Arabic is on for every agent, with the built-in translator for all languages.',
    'Reminders & meetings: follow the automatic reminders for shift check-ins and holidays, and join the Management Meet Party once a month.',
  ],
  meet: { on: true, weekday: 6, nth: 1, time: '20:00', title: 'Management Meet Party' },
  sheetUrl: '',
};
export const workPlanOf = (s) => { const w = s.workPlan || {}; return { ...WORKPLAN_DEF, ...w, meet: { ...WORKPLAN_DEF.meet, ...(w.meet || {}) }, slots: w.slots && w.slots.length ? w.slots : WORKPLAN_DEF.slots, days: w.days || WORKPLAN_DEF.days, rules: w.rules && w.rules.length ? w.rules : WORKPLAN_DEF.rules }; };
export function meetDate(meet, y, m) { const d = new Date(Date.UTC(y, m, 1)); const wd = Number(meet.weekday); d.setUTCDate(1 + ((wd - d.getUTCDay() + 7) % 7) + (Math.max(1, Number(meet.nth) || 1) - 1) * 7); return d.toISOString().slice(0, 10); }
// ---- Holiday calendar (shared by the panel and the reminders): marketing / payout planning, with the matching promotion ----
const EASTER = (y) => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); };
const ISLAMIC = { 2025: [[2, 1], [2, 30], [5, 6]], 2026: [[1, 18], [2, 20], [4, 27]], 2027: [[1, 8], [2, 10], [4, 17]], 2028: [[0, 28], [1, 27], [4, 5]], 2029: [[0, 16], [1, 15], [3, 24]] }; // Ramadan, Eid al-Fitr, Eid al-Adha (approx., month 0-based)
export function holidayCalendar(nowMs = Date.now(), custom = []) {
  const now = new Date(nowMs); const y0 = now.getFullYear(); const out = [];
  const add = (d, id, name, region, tip, kind = 'evergreen') => out.push({ id: id + '-' + d.getFullYear(), at: d.getTime(), name, region, tip, kind });
  const nth = (y, mo, wd, n) => { const d = new Date(y, mo, 1); d.setDate(1 + ((wd - d.getDay() + 7) % 7) + (n - 1) * 7); return d; };
  const last = (y, mo, wd) => { const d = new Date(y, mo + 1, 0); d.setDate(d.getDate() - ((d.getDay() - wd + 7) % 7)); return d; };
  for (const y of [y0, y0 + 1]) {
    add(new Date(y, 0, 1), 'newyear', "New Year's Day", 'Intl', 'Big renew promos — "new year, new setup".', 'newyear');
    add(nth(y, 0, 1, 3), 'mlk', 'Martin Luther King Jr. Day', 'US', 'US soft launch weekend, Reddit/Quora SEO push.');
    add(nth(y, 1, 0, 2), 'superbowl', 'Super Bowl (US)', 'US', 'Huge streaming peak — check line capacity, prime promos for multi-device.', 'events');
    add(new Date(y, 1, 14), 'valentine', 'Valentine’s Day', 'US / EU', 'Couple packages (2 devices).', 'devices');
    add(new Date(y, 2, 17), 'stpatrick', 'St. Patrick’s Day', 'US / IE / UK', 'Small promo — renewals.');
    add(EASTER(y), 'easter', 'Easter Sunday', 'US / EU', 'Family plans (3–4 devices).', 'devices');
    add(new Date(y, 4, 1), 'labour', 'Labour Day', 'EU', 'Europe promo weekend.');
    add(nth(y, 4, 0, 2), 'mothers', 'Mother’s Day (US)', 'US', 'Gift a subscription — multi-device.', 'devices');
    add(last(y, 4, 1), 'memorial', 'Memorial Day', 'US', 'US holiday — Stripe payouts may be delayed.');
    add(last(y, 4, 6), 'uclfinal', 'Champions League final (approx.)', 'Intl', 'Sports peak — push the sports & events promotion.', 'events');
    add(nth(y, 5, 0, 3), 'fathers', 'Father’s Day (US)', 'US', 'Sports-lover gift promo.', 'events');
    add(new Date(y, 6, 4), 'july4', 'Independence Day', 'US', 'US Stripe payouts 1–2 days late; renew promos.');
    add(new Date(y, 6, 14), 'bastille', 'Bastille Day', 'FR', 'Fr-speaking EU promos.');
    add(nth(y, 8, 1, 1), 'laborus', 'Labor Day', 'US', 'US holiday — Stripe payouts may be delayed.');
    add(new Date(y, 8, 1), 'backtoschool', 'Back to school / football season', 'US / EU', 'New season of football, series and shows.', 'events');
    add(new Date(y, 9, 3), 'deunity', 'German Unity Day', 'DE', 'Germany-focused promos.');
    add(new Date(y, 9, 12), 'esday', 'Spanish National Day', 'ES', 'Spain promos.');
    add(new Date(y, 9, 31), 'halloween', 'Halloween', 'US', 'Themed creative for Facebook ads.');
    const tg = nth(y, 10, 4, 4);
    add(tg, 'thanksgiving', 'Thanksgiving', 'US', 'Big US weekend — pre-load credits, Stripe payouts may be delayed; Black Friday next day.', 'blackfriday');
    add(new Date(tg.getTime() + DAYMS), 'blackfriday', 'Black Friday', 'US / Intl', 'Peak sales day — caps on tickets: send trials in batches.', 'blackfriday');
    add(new Date(tg.getTime() + 4 * DAYMS), 'cybermonday', 'Cyber Monday', 'US / Intl', 'Last big online sales day — app & multi-device offers.', 'cybermonday');
    add(new Date(y, 11, 24), 'xmaseve', 'Christmas Eve', 'EU', 'Gift cards go fast — resellers restock.', 'christmas');
    add(new Date(y, 11, 25), 'christmas', 'Christmas', 'US / EU', 'Stripe payouts delayed; minimal staffing — use the all-agents trial queue.', 'christmas');
    add(new Date(y, 11, 26), 'boxing', 'Boxing Day / St. Stephen’s', 'EU / UK', 'EU post-Christmas promos.', 'holidays');
    add(new Date(y, 11, 31), 'nye', "New Year's Eve", 'Intl', 'Countdown promos, last renewal push of the year.', 'newyear');
    const isl = ISLAMIC[y]; if (isl) { add(new Date(y, isl[0][0], isl[0][1]), 'ramadan', 'Ramadan begins (approx.)', 'Intl', 'Night-owl viewing peaks — push night-shift coverage.', 'evergreen'); add(new Date(y, isl[1][0], isl[1][1]), 'eidfitr', 'Eid al-Fitr (approx.)', 'Intl', 'Multi-device gift promos.', 'devices'); add(new Date(y, isl[2][0], isl[2][1]), 'eidadha', 'Eid al-Adha (approx.)', 'Intl', 'Family device plans.', 'devices'); }
  }
  for (const c of custom || []) { const at = new Date(c.date).getTime(); if (isFinite(at)) out.push({ id: 'c-' + c.id, at, name: c.name, region: c.region || 'Own', tip: c.tip || '', kind: c.kind || 'evergreen', custom: true }); }
  return out.filter((x) => x.at >= nowMs - 2 * DAYMS).sort((a, b) => a.at - b.at);
}
export const HOLIDAY_REMIND_DEF = { on: true, days: [7, 1], custom: [] };
// Trial waiting for a line: the customer gets their app login at once, and the line details by email as soon as it is ready
const TW = {
  en: { s: '🎁 Your free trial is being prepared', t: 'Your free trial request is received ✅', b: 'Hi {name},\n\nThanks for trying {app}! Your {hours}-hour free trial is being activated: we are preparing your line now and you will get a second email with the TV details within a few minutes (usually under 30 minutes). Your 24 hours start when the line is ready.\n\nYou can already sign in to the app:\n\n*Username:* {user}\n*Password:* {pass}\n*Profile:* {profile}', btn: '📲 Download the app' },
  fr: { s: '🎁 Votre essai gratuit est en préparation', t: 'Votre demande d’essai est bien reçue ✅', b: 'Bonjour {name},\n\nMerci d’essayer {app} ! Votre essai gratuit de {hours} heures est en cours d’activation : nous préparons votre ligne et vous recevrez un second e-mail avec les accès TV dans quelques minutes (en général moins de 30 minutes). Vos 24 heures commencent quand la ligne est prête.\n\nVous pouvez déjà vous connecter à l’application :\n\n*Identifiant :* {user}\n*Mot de passe :* {pass}\n*Profil :* {profile}', btn: "📲 Télécharger l'application" },
  de: { s: '🎁 Ihr kostenloser Test wird vorbereitet', t: 'Ihre Testanfrage ist eingegangen ✅', b: 'Hallo {name},\n\ndanke, dass Sie {app} testen! Ihr {hours}-Stunden-Test wird aktiviert: Wir bereiten Ihre Leitung vor, und Sie erhalten in wenigen Minuten (meist unter 30 Minuten) eine zweite E-Mail mit den TV-Daten. Die 24 Stunden beginnen, sobald die Leitung bereit ist.\n\nSie können sich schon in der App anmelden:\n\n*Benutzername:* {user}\n*Passwort:* {pass}\n*Profil:* {profile}', btn: '📲 App herunterladen' },
  es: { s: '🎁 Estamos preparando tu prueba gratis', t: 'Hemos recibido tu solicitud de prueba ✅', b: 'Hola {name}:\n\n¡Gracias por probar {app}! Tu prueba gratis de {hours} horas se está activando: estamos preparando tu línea y recibirás un segundo correo con los datos de TV en pocos minutos (normalmente menos de 30). Tus 24 horas empiezan cuando la línea esté lista.\n\nYa puedes iniciar sesión en la app:\n\n*Usuario:* {user}\n*Contraseña:* {pass}\n*Perfil:* {profile}', btn: '📲 Descargar la app' },
  it: { s: '🎁 Stiamo preparando la tua prova gratuita', t: 'Richiesta di prova ricevuta ✅', b: 'Ciao {name},\n\ngrazie per provare {app}! La tua prova gratuita di {hours} ore è in attivazione: stiamo preparando la tua linea e riceverai una seconda email con i dati TV entro pochi minuti (di solito meno di 30). Le 24 ore partono quando la linea è pronta.\n\nPuoi già accedere all’app:\n\n*Nome utente:* {user}\n*Password:* {pass}\n*Profilo:* {profile}', btn: "📲 Scarica l'app" } };
export function trialWaitEmail(s, c, password, appUrl) {
  const lang = okLang(c.lang); const L = TW[lang] || TW.en; const site = String(s.email.appUrl || appUrl || 'https://intproto-tv.store').replace(/\/+$/, '');
  const f = (x) => x.replace(/\{(\w+)\}/g, (_, k) => ({ name: c.name || '', app: s.branding.appName || 'INTPROTO-TV', hours: s.trial.hours || 24, user: c.username, pass: password, profile: site + '/profile' })[k] ?? '');
  const camp = { split: false, lang, badge: '🎁 Free trial', content: { all: { subject: f(L.s), title: L.t, body: f(L.b) + '\n\n' + appLinksText(site, lang), button: L.btn } }, link: site + '/app' };
  return newsletterEmail(s, c, camp, appUrl, '');
}
export function accessEmail(s, c, password, kind, appUrl) {
  const lang = ml(c); const L = AM[lang] || AM.en; const e = escHtml;
  const app = s.branding.appName || 'IPTV';
  const v = (k, x = {}) => String(L[k]).replace(/\{(\w+)\}/g, (_, n) => (n === 'app' ? e(app) : e(x[n] ?? '')));
  const base = String(s.email.appUrl || appUrl || '').replace(/\/+$/, '');
  const logo = /^https?:/.test(s.branding.logoUrl) ? s.branding.logoUrl : base ? `${base}/${String(s.branding.logoUrl || 'logo.png').replace(/^\//, '')}` : '';
  const dns = String(c.dns || s.email.dns || s.player.serverUrl || '').replace(/\/+$/, '');
  const u = c.lineUsername || c.username, p = c.linePassword || password;
  const q = `username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
  const m3u = String(c.m3u || '').trim() ? [String(c.m3u).trim()] : (dns ? [`${dns}/get.php?${q}&type=m3u_plus&output=ts`, `${dns}/get.php?${q}&type=m3u_plus&output=m3u8`] : []);
  const date = new Date(c.expiresAt).toLocaleString(langLocale(lang), { dateStyle: 'long', timeStyle: 'short' });
  const trial = kind === 'trial';
  const others = customerConns(c, s).filter((x) => !x.main);
  const extraHtml = () => others.length ? `<tr><td class="mobile-pad" style="padding:0 40px 24px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden"><tr><td style="padding:20px 24px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;text-align:${align}"><h2 style="margin:0;font-size:17px;font-weight:700;color:#0f172a">📡 ${tx(lang, 'otherConns')}</h2><p style="margin:6px 0 0;font-size:13px;color:#475569;line-height:1.5">${tx(lang, 'otherSub')}</p></td></tr>${others.map((x, i) => `<tr><td style="padding:16px 24px;border-bottom:1px solid #e2e8f0;text-align:${align}"><div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:6px">${tx(lang, 'conn')} ${i + 2}${x.label ? ' · ' + e(x.label) : ''} <span style="display:inline-block;background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:700;padding:2px 8px;border-radius:50px">${e(x.typeName)}</span> <span style="font-size:12px;color:#64748b;font-weight:600">${x.devices} ${tx(lang, 'devs')}</span></div><table border="0" cellpadding="0" cellspacing="0" width="100%">${x.u ? row(L.user, e(x.u)) + row(L.pass, e(x.p)) : ''}${x.dns && x.u ? row(L.dns, `<a href="${e(x.dns)}" style="color:${P};text-decoration:none;font-size:14px">${e(x.dns)}</a>`) : ''}</table>${x.m3u ? `<div dir="ltr" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-top:10px;font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.5;color:#0369a1;word-break:break-all;text-align:left"><b style="color:#64748b">M3U</b><br><a href="${e(x.m3u)}" style="color:#0369a1;text-decoration:none">${e(x.m3u)}</a></div>` : ''}</td></tr>`).join('')}</table></td></tr>` : '';
  const macNote = tx(lang, 'mac');
  const P = '#0284c7', align = L.dir === 'rtl' ? 'right' : 'left';
  const row = (k, val, mono = true) => `<tr><td class="cred-label" width="120" style="padding:10px 0;font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e2e8f0;text-align:${align}">${k}</td><td class="cred-val" style="padding:10px 0;${mono ? "font-family:'Courier New',Courier,monospace;" : ''}font-size:15px;font-weight:700;color:${P};border-bottom:1px solid #e2e8f0;word-break:break-all;text-align:${align}" dir="ltr">${val}</td></tr>`;
  const step = (n, t) => `<tr><td width="24" style="vertical-align:top;font-weight:700;padding-bottom:10px;color:#15803d">${n}.</td><td style="padding-bottom:10px;color:#166534">${t}</td></tr>`;
  const sup = [s.email.supportEmail && `<tr><td style="padding:4px 0"><b style="color:#64748b">${L.email}:</b> <a href="mailto:${e(s.email.supportEmail)}" style="color:${P};text-decoration:none">${e(s.email.supportEmail)}</a></td></tr>`,
    s.email.website && `<tr><td style="padding:4px 0"><b style="color:#64748b">${L.website}:</b> <a href="${e(s.email.website)}" style="color:${P};text-decoration:none">${e(String(s.email.website).replace(/^https?:\/\//, ''))}</a></td></tr>`,
    s.branding.supportUrl && `<tr><td style="padding:4px 0"><b style="color:#64748b">${L.whatsapp}:</b> <a href="${e(s.branding.supportUrl)}" style="color:${P};text-decoration:none">${e(s.branding.supportLabel || s.branding.supportUrl)}</a></td></tr>`].filter(Boolean).join('');
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${L.dir}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${v(trial ? 'trialTitle' : 'subTitle')}</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}img{border:0;height:auto;outline:none;text-decoration:none}body{margin:0!important;padding:0!important;width:100%!important;background:#f4f7fa;font-family:'Segoe UI',Roboto,Helvetica,Arial,Tahoma,sans-serif;color:#334155}
@media screen and (max-width:620px){.container{width:100%!important;border-radius:0!important}.mobile-pad{padding:24px 20px!important}.header-title{font-size:22px!important}.cred-label,.cred-val{display:block!important;width:100%!important}.cred-label{padding-bottom:2px!important;border-bottom:none!important}.cred-val{padding-top:0!important}}</style></head>
<body dir="${L.dir}" style="background:#f4f7fa;margin:0;padding:0"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7fa;padding:30px 10px"><tr><td align="center">
<table border="0" cellpadding="0" cellspacing="0" width="600" class="container" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,.05)">
<tr><td height="6" style="background:linear-gradient(90deg,#0284c7 0%,#0ea5e9 50%,#38bdf8 100%);font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td align="center" class="mobile-pad" style="padding:40px 40px 30px;background:linear-gradient(180deg,#f8fafc 0%,#fff 100%);border-bottom:1px solid #f1f5f9">
${logo ? `<img src="${e(logo)}" alt="${e(app)}" width="96" style="display:block;border-radius:50%;border:3px solid #0ea5e9;box-shadow:0 4px 12px rgba(14,165,233,.2);margin:0 auto 20px">` : ''}
<div style="display:inline-block;background:#e0f2fe;border:1px solid #bae6fd;color:#0369a1;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:6px 14px;border-radius:50px;margin-bottom:14px">${e(app)}</div>
<h1 class="header-title" style="margin:0;font-size:26px;font-weight:800;color:#0f172a;line-height:1.3">${v(trial ? 'trialTitle' : 'subTitle')}</h1>
<p style="margin:8px 0 0;font-size:14px;color:#64748b">${v(trial ? 'trialSub' : 'subSub')}</p></td></tr>
<tr><td class="mobile-pad" style="padding:32px 40px 16px;text-align:${align}"><p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#0f172a">${v('dear', { name: c.name })}</p><p style="margin:0;font-size:15px;line-height:1.65">${v(trial ? 'trialIntro' : 'subIntro')}</p></td></tr>
<tr><td class="mobile-pad" style="padding:4px 40px 20px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#eff6ff;border-${align}:4px solid #3b82f6;border-radius:6px"><tr><td style="padding:12px 16px;font-size:13px;color:#1e40af;line-height:1.5;text-align:${align}">📺 ${e(macNote)}</td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:10px 40px 20px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#fef3c7;border-${align}:4px solid #f59e0b;border-radius:6px"><tr><td style="padding:12px 16px;font-size:14px;color:#b45309;line-height:1.5;text-align:${align}">${trial ? v('trialNote', { hours: s.trial.hours }) : v('subNote', { date })}</td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 24px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
<tr><td style="padding:20px 24px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;text-align:${align}"><h2 style="margin:0;font-size:17px;font-weight:700;color:#0f172a">${L.details}</h2><p style="margin:6px 0 0;font-size:13px;color:#475569;line-height:1.5">${L.detailsIntro}</p></td></tr>
<tr><td style="padding:20px 24px"><table border="0" cellpadding="0" cellspacing="0" width="100%">${row(L.user, e(u))}${row(L.pass, e(p))}${dns ? row(L.dns, `<a href="${e(dns)}" style="color:${P};text-decoration:none;font-size:14px">${e(dns)}</a>`) : ''}
${m3u.length ? `<tr><td colspan="2" style="padding-top:16px;text-align:${align}"><div style="font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">${L.m3u}</div>${m3u.map((x, i) => `<div dir="ltr" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-bottom:10px;font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.5;color:#0369a1;word-break:break-all;text-align:left"><b style="color:#64748b">${i ? 'HLS' : 'TS'}:</b> ${e(x)}</div>`).join('')}</td></tr>` : ''}${c.ibo && c.ibo.mac ? row('Device MAC Address', e(c.ibo.mac)) : ''}${c.ibo && c.ibo.key ? row('Device Key', e(c.ibo.key)) : ''}
</table></td></tr></table></td></tr>
${extraHtml()}${base ? `<tr><td class="mobile-pad" align="center" style="padding:0 40px 28px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(135deg,#0c4a6e,#0284c7);border-radius:12px"><tr><td align="center" style="padding:24px;color:#fff"><h3 style="margin:0 0 6px;font-size:17px;color:#fff">${v('appTitle')}</h3><p style="margin:0 0 16px;font-size:13px;color:#e0f2fe">${L.appText}</p>
<a href="${e(base)}/app" style="display:inline-block;background:#fff;color:#0369a1;font-weight:800;padding:13px 22px;border-radius:12px;text-decoration:none;margin:4px;font-size:16px">📲 ${L.getApp}</a>${appLinksHtml(base, okLang(lang), true)}<p style="margin:12px 0 0;font-size:13px;color:#e0f2fe">👤 ${e(tx(lang, 'profTitle'))}: <a href="${e(base)}/profile" style="color:#fff;font-weight:700">${e(base.replace(/^https?:\/\//, ''))}/profile</a></p></td></tr></table></td></tr>` : ''}
<tr><td class="mobile-pad" style="padding:0 40px 30px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px"><tr><td style="padding:24px;text-align:${align}"><h3 style="margin:0 0 14px;font-size:16px;font-weight:700;color:#166534">${L.setup}</h3>
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;line-height:1.6">${step(1, L.s1)}${step(2, L.s2)}${step(3, L.s3)}${step(4, L.s4)}</table></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 32px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0"><tr><td style="padding:24px;text-align:${align}"><h3 style="margin:0 0 8px;font-size:16px;font-weight:700;color:#0f172a">${L.help}</h3><p style="margin:0 0 16px;font-size:14px;line-height:1.6">${L.helpText}</p>
${sup ? `<div style="font-size:13px;font-weight:700;color:${P};text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">📞 ${L.support}</div><table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px">${sup}</table>` : ''}</td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 36px;border-bottom:1px solid #f1f5f9;text-align:${align}"><p style="margin:0 0 20px;font-size:14px;line-height:1.65">${v('closing')}</p><p style="margin:0;font-size:14px;line-height:1.6;color:#64748b">${L.regards}<br><b style="color:#0f172a;font-size:15px">${e(app)}</b><br><span style="color:${P}">${L.team}</span></p></td></tr>
<tr><td align="center" class="mobile-pad" style="padding:28px 40px;background:#f8fafc;text-align:center"><p style="margin:0 0 16px;font-size:12px;line-height:1.7;color:#64748b">${L.footer}</p>${s.email.website ? `<a href="${e(s.email.website)}" style="font-size:13px;font-weight:700;color:${P};text-decoration:none;letter-spacing:.5px">${e(String(s.email.website).replace(/^https?:\/\//, ''))}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: v(trial ? 'trialTitle' : 'subTitle') + ` | ${app}`, html };
}

// ---- Renewal email (your "subscription expired" template), English / French / Arabic ----
const RM = {
  en: { dir: 'ltr', badgeSub: 'Subscription ended • Renewal reminder', badgeTrial: 'Free trial ended • Special offer', title: 'Renew Your {app} Subscription Today!', dear: 'Dear {name},',
    introTrial: 'Thank you for Choosing <b>{app}</b>! We hope you enjoyed your recent trial and had a great streaming experience.', introSub: 'Thank you for Choosing <b>{app}</b>! We hope you enjoyed your subscription and had a great streaming experience.',
    intro2Trial: 'Your trial period has now ended, but you can continue enjoying our service by renewing your subscription today.', intro2Sub: 'Your subscription ended on <b>{date}</b>, but you can continue enjoying our service by renewing your subscription today.',
    offerLabel: 'Special Welcome-Back Package', coupon: '🎁 Exclusive Coupon Code', cta: 'Renew Subscription Now →',
    how: 'How to Renew Your Subscription', h1: 'Visit {site}.', h2: 'Browse our available subscription plans.', h2b: 'Select the package that best suits your needs.', h3: 'Enter the coupon code {coupon} at checkout, if applicable.', h4: 'Complete your payment through the available checkout process.', h5: 'Once your order is confirmed, contact our support team if you need assistance with activation.',
    helpTitle: 'Need Help?', help: 'If you have any questions or need assistance with your renewal, please contact our support team:', emailL: 'Email:', webL: 'Website:', thanks: 'Thank you for choosing <b>{app}</b>. We appreciate your support and look forward to welcoming you back!', regards: 'Best regards,', team: 'Customer Support Team', subject: 'Renew Your {app} Subscription Today!' },
  fr: { dir: 'ltr', badgeSub: 'Abonnement expiré • Rappel de renouvellement', badgeTrial: 'Essai terminé • Offre spéciale', title: 'Renouvelez votre abonnement {app} 🎉', dear: 'Cher/Chère {name},',
    introTrial: "🌼 Nous espérons que vous avez apprécié votre essai avec <b>{app}</b>. Merci d'avoir essayé notre service.", introSub: '🌼 Merci de regarder avec <b>{app}</b>. Votre abonnement a pris fin le <b>{date}</b>.',
    intro2Trial: "Votre période d'essai est terminée, mais vous pouvez continuer à profiter de notre service en renouvelant votre abonnement dès aujourd'hui.", intro2Sub: "Votre abonnement a pris fin le <b>{date}</b>, mais vous pouvez continuer à profiter de notre service en le renouvelant dès aujourd'hui.",
    helpTitle: "Besoin d'aide ?", emailL: 'Email :', webL: 'Site web :', h2b: 'Choisissez la formule qui vous convient le mieux.', offerLabel: 'Offre spéciale de retour', coupon: '🎁 Code promo exclusif', cta: "Renouveler maintenant →",
    how: 'Comment renouveler', h1: 'Rendez-vous sur {site}.', h2: 'Parcourez nos formules disponibles.', h3: 'Saisissez le code {coupon} lors du paiement, si applicable.', h4: 'Finalisez votre paiement en toute sécurité.', h5: "Une fois la commande confirmée, contactez notre support si vous avez besoin d'aide pour l'activation.",
    help: "Pour toute question ou aide au renouvellement, notre équipe support est là pour vous.", thanks: "Merci d'avoir choisi <b>{app}</b>. Nous serons heureux de vous servir à nouveau.", regards: 'Cordialement,', team: 'Service client', subject: 'Renouvelez votre abonnement {app} — offre spéciale 🎉' },

};
const OM = {
  en: { dir: 'ltr', badge: '{app} Order Checkout', title: 'Thank You for Choosing {app} 🎉', sub: 'Please place your order for your selected package below.', dear: 'Dear {name},', dearAny: 'Dear Valued Customer,',
    intro: 'Your <strong>{pkg}</strong> subscription package is ready for checkout. Click the secure Stripe payment button below to complete your order and receive instant activation.',
    introMulti: 'Your <strong>{pkg}</strong> subscription package is ready for checkout. Stream simultaneously on {n} devices. Click below to complete your order via Stripe.',
    access: '{d} Days Access', dev1: '📺 1 Device Connection', devN: '📺 {n} Devices Simultaneous Connection', cta: '🔒 Order {pkg} ({price}) →', ctaContact: '💬 Contact us to order', contactNote: 'Message us and we send you your personal payment link.', secure: '100% Secure Stripe Payment • Instant Email Delivery',
    help: '📞 Need Assistance?', regards: 'Warm regards,', team: 'Customer Support Team', subject: '{pkg} — {price} | {app} order' },
  fr: { dir: 'ltr', badge: 'Commande {app}', title: "Merci d'avoir choisi {app} 🎉", sub: 'Passez votre commande pour la formule choisie ci-dessous.', dear: 'Bonjour {name},', dearAny: 'Cher client,',
    intro: 'Votre abonnement <strong>{pkg}</strong> est prêt. Cliquez sur le bouton de paiement sécurisé Stripe ci-dessous pour finaliser votre commande et recevoir une activation immédiate.',
    introMulti: 'Votre abonnement <strong>{pkg}</strong> est prêt. Regardez en même temps sur {n} appareils. Cliquez ci-dessous pour payer via Stripe.',
    access: 'Accès {d} jours', dev1: '📺 1 appareil', devN: '📺 {n} appareils en même temps', cta: '🔒 Commander {pkg} ({price}) →', ctaContact: '💬 Contactez-nous pour commander', contactNote: 'Écrivez-nous et nous vous envoyons votre lien de paiement personnel.', secure: 'Paiement Stripe 100 % sécurisé • Livraison immédiate par email',
    help: "📞 Besoin d'aide ?", regards: 'Cordialement,', team: 'Service client', subject: '{pkg} — {price} | commande {app}' },

};
const CUR_SIGN = { EUR: '€', USD: '$', USDT: '₮', MAD: 'MAD ' };
// Random pay link for a package: from enabled Stripe accounts, in the email currency
// ---- Payment links: the Stripe link that really sells this package (duration, devices, IBO, credits), from the allowed accounts only ----
// What a link sells, read from its name: "12 Months Subscription - 1 Devices", "1 YEAR 3 DEVICES IBO PLAYER", "1O CREDIT BASIC"…
export function linkSpec(label) {
  const t = String(label || '').toLowerCase().replace(/\b(\d)o\b/g, '$10');
  const cr = t.match(/(\d+)\s*credit/); if (cr) return { credits: Number(cr[1]), ibo: false, dev: 1, days: 0 };
  const ibo = /\bibo\b/.test(t); const dev = Number((t.match(/(\d)\s*devices?/) || [])[1] || 1);
  let days = 0; if (/lifetime|life time|forever/.test(t)) days = 36500;
  else { const m = t.match(/(\d+)\s*(day|week|month|year)/); if (m) { const n = Number(m[1]); days = m[2] === 'day' ? n : m[2] === 'week' ? n * 7 : m[2] === 'month' ? n * 30 : n >= 5 ? n * 30 /* "6 Year" written for 6 months */ : n * 365; } }
  return { credits: 0, ibo, dev, days };
}
const pkgSpecOf = (p) => ({ credits: Number(p.credits) || 0, ibo: p.kind === 'ibo' || /^ibo/i.test(String(p.id || '')), dev: Number(p.devices) || 1, days: Number(p.days) || 0 });
const specMatch = (a, b) => (a.credits || b.credits ? a.credits === b.credits : a.ibo === b.ibo && a.dev === b.dev && a.days > 0 && (a.days >= 36000 ? b.days >= 36000 : Math.abs(a.days - b.days) <= Math.max(6, b.days * 0.04)));
export const PAY_ROUTE_DEF = { accounts: ['grenapp'], rotate: true };
export function payRoute(s) { const r = { ...PAY_ROUTE_DEF, ...(s.payRoute || {}) }; const act = (s.stripeAccounts || []).filter((a) => a.status === 'active'); r.accounts = (r.accounts || []).filter((id) => act.some((a) => a.id === id)); if (!r.accounts.length && act.length) r.accounts = [act.find((a) => /green|grenapp/i.test(a.id + a.name))?.id || act[0].id]; return r; }
// Links that cannot be trusted: the same Stripe URL is used for two different packages
export function payLinkProblems(s) {
  const out = [];
  for (const a of s.stripeAccounts || []) { const byUrl = new Map();
    for (const l of a.links || []) { if (!l.url) continue; const sp = linkSpec(l.label); const k = l.url.trim(); const o = byUrl.get(k); if (o && !specMatch(linkSpec(o.label), sp)) out.push({ acc: a.id, accName: a.name, kind: 'same-url', a: o.label, b: l.label, currency: l.currency, url: k }); else if (!o) byUrl.set(k, l); }
    for (const l of a.links || []) { if (/\b[2-9]\s*years?\b/i.test(l.label) && /\b[5-9]\s*years?\b/i.test(l.label)) out.push({ acc: a.id, accName: a.name, kind: 'label', a: l.label, currency: l.currency, hint: 'probably "months", not "year"' }); }
  }
  return out;
}
export function payCandidates(s, pkg, cur) {
  const r = payRoute(s); const want = pkgSpecOf(pkg); const bad = new Set(payLinkProblems(s).filter((x) => x.kind === 'same-url').map((x) => x.url));
  const all = []; for (const id of r.accounts) { const a = (s.stripeAccounts || []).find((x) => x.id === id); for (const l of a?.links || []) if (l.url && !bad.has(l.url.trim()) && specMatch(linkSpec(l.label), want)) all.push({ url: l.url.trim(), acc: a.id, accName: a.name, label: l.label, cur: l.currency || cur }); }
  const same = all.filter((x) => !cur || x.cur === cur); return { list: same.length ? same : all, otherCurrency: !same.length && all.length > 0 };
}
// ---- IBO Player offer after every new subscription and renewal (email automatically, WhatsApp from the panel) ----
export const IBO_PROMO_DEF = { on: true, email: true, whatsapp: true, price: 5.99, pkg: 'ibo1y', everyDays: 30, delayMin: 60 }; // the email goes out an hour after the welcome / renewal email
const IBO_TX = {
  en: { s: '📺 Upgrade to IBO Player for {price}', t: 'Skip free app issues and problems', b: 'Skip free app issues and problems: upgrade with *IBO Player for {price}*!\n\nEnjoy high streaming quality, easy setup, and an included secure VPN.', btn: 'Get IBO Player', hi: 'Hi {name} 👋' },
  fr: { s: '📺 Passez à IBO Player pour {price}', t: 'Fini les soucis des applis gratuites', b: 'Fini les soucis et les bugs des applications gratuites : passez à *IBO Player pour {price}* !\n\nProfitez d’une haute qualité de streaming, d’une installation facile et d’un VPN sécurisé inclus.', btn: 'Obtenir IBO Player', hi: 'Bonjour {name} 👋' },
  de: { s: '📺 Jetzt IBO Player für {price}', t: 'Schluss mit Problemen kostenloser Apps', b: 'Schluss mit den Problemen kostenloser Apps: Steigen Sie auf *IBO Player für {price}* um!\n\nGenießen Sie hohe Streaming-Qualität, einfache Einrichtung und ein sicheres VPN inklusive.', btn: 'IBO Player holen', hi: 'Hallo {name} 👋' },
  es: { s: '📺 Pásate a IBO Player por {price}', t: 'Olvídate de los problemas de las apps gratis', b: 'Olvídate de los fallos y problemas de las apps gratuitas: ¡pásate a *IBO Player por {price}*!\n\nDisfruta de una gran calidad de streaming, instalación fácil y una VPN segura incluida.', btn: 'Conseguir IBO Player', hi: 'Hola {name} 👋' },
  it: { s: '📺 Passa a IBO Player per {price}', t: 'Basta problemi con le app gratuite', b: 'Basta problemi e malfunzionamenti delle app gratuite: passa a *IBO Player per {price}*!\n\nGoditi un’alta qualità di streaming, un’installazione facile e una VPN sicura inclusa.', btn: 'Ottieni IBO Player', hi: 'Ciao {name} 👋' } };
export function iboPromoText(l, price) { const L = IBO_TX[l] || IBO_TX.en; return L.b.replace(/\{price\}/g, price); }
export function iboPromoEmail(s, c, appUrl, link, price) {
  const lang = okLang(c.lang); const L = IBO_TX[lang] || IBO_TX.en; const site = String(s.email.appUrl || appUrl || 'https://intproto-tv.store').replace(/\/+$/, '');
  const camp = { split: false, lang, badge: '📺 IBO Player', content: { all: { subject: L.s.replace('{price}', price), title: L.t, body: L.b.replace(/\{price\}/g, price) + '\n\n' + PROMO_FOOT[lang].replace('{trial}', site + '/freetrial').replace('{support}', site + '/support'), button: L.btn } }, link: link || site + '/support' };
  return newsletterEmail(s, c, camp, appUrl, '');
}
export function pickPayLink(s, pkg) { // only a link the admin types for one order (no stored Stripe links)
  return pkg?.link ? { url: pkg.link, acc: '' } : null;
}
export function orderEmail(s, c, pkg, appUrl, chosen, curParam) {
  const lang = ml(c); const L = OM[lang] || OM.en; const e = escHtml;
  const app = s.branding.appName || 'IPTV'; const pl = chosen || pickPayLink(s, pkg);
  const cur = curParam || (s.currencyRule?.on !== false ? custCurrency(s, c) : s.orderCurrency === 'ALL' ? pl?.cur || 'EUR' : s.orderCurrency || 'EUR');
  const price = (CUR_SIGN[cur] || '') + Number(pkg.price).toFixed(2) + (CUR_SIGN[cur] ? '' : ' ' + cur);
  const n = Math.max(1, Number(pkg.devices) || 1);
  const v = (k, x = {}) => String(L[k]).replace(/\{(\w+)\}/g, (_, m) => (m === 'app' ? e(app) : m === 'pkg' ? e(pkg.title) : m === 'price' ? e(price) : m === 'n' ? n : m === 'd' ? pkg.days : e(x[m] ?? '')));
  const base = String(s.email.appUrl || appUrl || '').replace(/\/+$/, '');
  const logo = /^https?:/.test(s.branding.logoUrl) ? s.branding.logoUrl : base ? `${base}/${String(s.branding.logoUrl || 'logo.png').replace(/^\//, '')}` : '';
  const site = String(s.email.website || s.renewalOffer?.url || '').replace(/\/+$/, ''); const siteTxt = site.replace(/^https?:\/\//, '');
  const contact = s.branding.supportUrl || (s.email.supportEmail ? 'mailto:' + s.email.supportEmail : '') || site;
  const link = (pl?.url ? payUrlFor(pl.url, c) : '') || contact; const al = L.dir === 'rtl' ? 'right' : 'left';
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${L.dir}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${v('subject')}</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}img{border:0;height:auto;outline:none;text-decoration:none}body{margin:0!important;padding:0!important;width:100%!important;background:#f4f7fa;font-family:'Segoe UI',Roboto,Helvetica,Arial,Tahoma,sans-serif;color:#334155}
@media screen and (max-width:620px){.container{width:100%!important;border-radius:0!important}.mobile-pad{padding:24px 20px!important}.header-title{font-size:22px!important}.cta-btn{display:block!important;width:100%!important;box-sizing:border-box!important}}</style></head>
<body dir="${L.dir}" style="background:#f4f7fa;margin:0;padding:0"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7fa;padding:30px 10px"><tr><td align="center">
<table border="0" cellpadding="0" cellspacing="0" width="600" class="container" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,.05)">
<tr><td height="6" style="background:linear-gradient(90deg,#0284c7 0%,#0ea5e9 50%,#38bdf8 100%);font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td align="center" class="mobile-pad" style="padding:40px 40px 30px;background:linear-gradient(180deg,#f8fafc 0%,#fff 100%);border-bottom:1px solid #f1f5f9">
${logo ? `<img src="${e(logo)}" alt="${e(app)}" width="95" style="display:block;border-radius:50%;border:3px solid #0ea5e9;box-shadow:0 4px 12px rgba(14,165,233,.2);margin:0 auto 18px">` : ''}
<div dir="auto" style="display:inline-block;background:${pkg.badge ? '#0369a1' : '#e0f2fe'};border:1px solid #bae6fd;color:${pkg.badge ? '#fff' : '#0369a1'};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:50px;margin-bottom:14px">${pkg.badge ? e(pkg.badge) : v('badge')}</div>
<h1 class="header-title" style="margin:0;font-size:26px;font-weight:800;color:#0f172a;line-height:1.3">${v('title')}</h1><p style="margin:8px 0 0;font-size:15px;color:#64748b">${L.sub}</p></td></tr>
<tr><td class="mobile-pad" style="padding:32px 40px 20px;text-align:${al}"><p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#0f172a">${c?.name ? v('dear', { name: c.name }) : L.dearAny}</p><p style="margin:0;font-size:15px;line-height:1.65">${v(n > 1 ? 'introMulti' : 'intro')}</p>${c?.note ? `<p dir="auto" style="margin:14px 0 0;font-size:15px;line-height:1.65;background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;color:#713f12">${e(c.note).replace(/\n/g, '<br>')}</p>` : ''}</td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 28px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%);border:2px solid #7dd3fc;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:28px 24px;text-align:center">
<div style="display:inline-block;background:#fff;border:1px solid #bae6fd;color:#0369a1;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:4px 12px;border-radius:50px;margin-bottom:10px">${v('access')}</div>
<div dir="auto" style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:6px">${e(pkg.title)}</div>
<div style="font-size:14px;font-weight:600;color:#475569;margin-bottom:14px">${v(n > 1 ? 'devN' : 'dev1')}</div>
<div dir="ltr" style="font-size:36px;font-weight:900;color:#0284c7;margin-bottom:18px">${e(price)} <span style="font-size:14px;font-weight:600;color:#64748b">${e(cur)}</span></div>
${link ? `<a href="${e(link)}" class="cta-btn" style="display:inline-block;background:${pl?.url ? '#0284c7' : '#25d366'};color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:15px 36px;border-radius:8px;box-shadow:0 4px 14px rgba(2,132,199,.3)">${pl?.url ? v('cta') : v('ctaContact')}</a>` : ''}
<div style="margin-top:12px;font-size:12px;color:#64748b">${pl?.url ? L.secure : v('contactNote')}</div></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 32px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0"><tr><td style="padding:20px 24px;text-align:${al}"><div style="font-size:15px;font-weight:700;color:#166534;margin-bottom:6px">${L.help}</div><div style="font-size:14px;color:#166534">
${s.email.supportEmail ? `📧 <a href="mailto:${e(s.email.supportEmail)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.email.supportEmail)}</a>` : ''}${s.email.supportEmail && site ? ' &nbsp;|&nbsp; ' : ''}${site ? `🌐 <a href="${e(site)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(siteTxt)}</a>` : ''}${s.branding.supportUrl ? ` &nbsp;|&nbsp; 💬 <a href="${e(s.branding.supportUrl)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.branding.supportLabel || 'WhatsApp')}</a>` : ''}</div></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 32px;border-bottom:1px solid #f1f5f9;text-align:${al}"><p style="margin:0;font-size:14px;line-height:1.6;color:#64748b">${L.regards}<br><b style="color:#0f172a;font-size:15px">${e(app)}</b><br><span style="color:#0284c7;font-weight:600">${L.team}</span></p></td></tr>
<tr><td align="center" class="mobile-pad" style="padding:22px 40px;background:#f8fafc;text-align:center">${site ? `<a href="${e(site)}" style="font-size:13px;font-weight:700;color:#0284c7;text-decoration:none">${e(siteTxt)}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: v('subject').replace(/<[^>]+>/g, ''), html, payAcc: pl?.acc || '' };
}
// Newsletter / promotion email. camp = { id, content: { en: { subject, title, body, button }, fr, ar }, image, badge, coupon, link: 'site' | 'pkg:<id>' | url }
const NL = { en: { dear: 'Hello {name},', dearAny: 'Hello,', coupon: '🎁 Your coupon code', help: '📞 Need assistance?', regards: 'Warm regards,', team: 'Customer Support Team', unsub: "Don't want these emails?", unsubLink: 'Unsubscribe', btn: 'See the offer →' },
  fr: { dear: 'Bonjour {name},', dearAny: 'Bonjour,', coupon: '🎁 Votre code promo', help: "📞 Besoin d'aide ?", regards: 'Cordialement,', team: 'Service client', unsub: 'Vous ne souhaitez plus recevoir ces emails ?', unsubLink: 'Se désabonner', btn: "Voir l'offre →" } };
export function newsletterEmail(s, c, camp, appUrl, unsubUrl) {
  const pick = (l) => { const x = camp.content?.[l] || {}; return x.subject || x.title || x.body ? x : null; };
  const lang = (camp.split && pick(c?.lang) ? c.lang : (camp.split ? (pick('en') ? 'en' : LANG_CODES.find(pick) || 'en') : okLang(camp.lang)));
  const C = (camp.split ? pick(lang) : camp.content?.all || camp.content?.[lang]) || {}; const L = NL[camp.split ? lang : (camp.lang || 'en')] || NL.en;
  const dir = (camp.split ? lang : camp.lang) === 'ar' ? 'rtl' : 'ltr'; const al = dir === 'rtl' ? 'right' : 'left'; const e = escHtml;
  const app = s.branding.appName || 'IPTV'; const first = (c?.name || '').split(' ')[0];
  const fillTxt = (t) => String(t || '').replace(/\{name\}/g, first || '').replace(/\{app\}/g, app);
  const linkify = (h) => h.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" style="color:#0284c7;font-weight:600">${u}</a>`).replace(/(^|[\s>(])([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi, (m0, pre, m) => `${pre}<a href="mailto:${m}" style="color:#0284c7;font-weight:600">${m}</a>`);
  const para = (t) => linkify(e(fillTxt(t))).replace(/\*(.+?)\*/g, '<b>$1</b>').split(/\n{2,}/).map((p) => `<p dir="auto" style="margin:0 0 14px;font-size:15px;line-height:1.65">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const base = String(s.email.appUrl || appUrl || '').replace(/\/+$/, '');
  const logo = /^https?:/.test(s.branding.logoUrl) ? s.branding.logoUrl : base ? `${base}/${String(s.branding.logoUrl || 'logo.png').replace(/^\//, '')}` : '';
  const site = String(s.email.website || s.renewalOffer?.url || '').replace(/\/+$/, ''); const siteTxt = site.replace(/^https?:\/\//, '');
  let link = ''; let payAcc = '';
  if (camp.link === 'site') link = site;
  else if (camp.link === 'app') link = base;
  else if (camp.link === 'contact' || String(camp.link || '').startsWith('pkg:')) link = s.branding.supportUrl || (s.email.supportEmail ? 'mailto:' + s.email.supportEmail : '') || site;
  else if (false) { const pk = (s.orderPackages || []).find((p) => p.id === camp.link.slice(4)); const pl = pk && pickPayLink(s, pk); link = pl?.url || site; payAcc = pl?.acc || ''; }
  else if (/^https?:\/\/\S+$/.test(String(camp.link || ''))) link = camp.link;
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(fillTxt(C.subject || C.title))}</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}img{border:0;height:auto;outline:none;text-decoration:none}body{margin:0!important;padding:0!important;width:100%!important;background:#f4f7fa;font-family:'Segoe UI',Roboto,Helvetica,Arial,Tahoma,sans-serif;color:#334155}
@media screen and (max-width:620px){.container{width:100%!important;border-radius:0!important}.mobile-pad{padding:24px 20px!important}.header-title{font-size:22px!important}.cta-btn{display:block!important;width:100%!important;box-sizing:border-box!important}}</style></head>
<body dir="${dir}" style="background:#f4f7fa;margin:0;padding:0"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7fa;padding:30px 10px"><tr><td align="center">
<table border="0" cellpadding="0" cellspacing="0" width="600" class="container" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,.05)">
<tr><td height="6" style="background:linear-gradient(90deg,#0284c7 0%,#0ea5e9 50%,#38bdf8 100%);font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td align="center" class="mobile-pad" style="padding:36px 40px 26px;background:linear-gradient(180deg,#f8fafc 0%,#fff 100%);border-bottom:1px solid #f1f5f9">
${logo ? `<img src="${e(logo)}" alt="${e(app)}" width="90" style="display:block;border-radius:50%;border:3px solid #0ea5e9;box-shadow:0 4px 12px rgba(14,165,233,.2);margin:0 auto 16px">` : ''}
${camp.badges?.[lang] || camp.badge ? `<div dir="auto" style="display:inline-block;background:#0369a1;color:#fff;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:50px;margin-bottom:14px">${e(fillTxt(camp.badges?.[lang] || camp.badge))}</div>` : ''}
${C.title ? `<h1 class="header-title" dir="auto" style="margin:0;font-size:26px;font-weight:800;color:#0f172a;line-height:1.3">${e(fillTxt(C.title))}</h1>` : ''}</td></tr>
${camp.image ? `<tr><td style="padding:0"><img src="${e(camp.image)}" alt="" width="600" style="display:block;width:100%;max-width:600px"></td></tr>` : ''}
<tr><td class="mobile-pad" style="padding:30px 40px 10px;text-align:${al}"><p style="margin:0 0 14px;font-size:16px;font-weight:600;color:#0f172a">${first ? e(L.dear.replace('{name}', first)) : L.dearAny}</p>${para(C.body)}</td></tr>
${camp.coupon ? `<tr><td class="mobile-pad" style="padding:0 40px 18px" align="center"><div style="background:#f0f9ff;border:2px dashed #38bdf8;border-radius:12px;padding:14px 20px;text-align:center"><div style="font-size:13px;font-weight:700;color:#475569;margin-bottom:6px">${L.coupon}</div><div style="font-family:'Courier New',monospace;font-size:24px;font-weight:800;color:#0284c7;letter-spacing:2px">${e(camp.coupon)}</div></div></td></tr>` : ''}
${link ? `<tr><td align="center" class="mobile-pad" style="padding:6px 40px 30px"><a href="${e(link)}" class="cta-btn" style="display:inline-block;background:#0284c7;color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:15px 36px;border-radius:8px;box-shadow:0 4px 14px rgba(2,132,199,.3)">${e(fillTxt(C.button) || L.btn)}</a></td></tr>` : ''}
<tr><td class="mobile-pad" style="padding:0 40px 28px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0"><tr><td style="padding:18px 22px;text-align:${al}"><div style="font-size:15px;font-weight:700;color:#166534;margin-bottom:6px">${L.help}</div><div style="font-size:14px;color:#166534">
${s.email.supportEmail ? `📧 <a href="mailto:${e(s.email.supportEmail)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.email.supportEmail)}</a>` : ''}${s.email.supportEmail && site ? ' &nbsp;|&nbsp; ' : ''}${site ? `🌐 <a href="${e(site)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(siteTxt)}</a>` : ''}${s.branding.supportUrl ? ` &nbsp;|&nbsp; 💬 <a href="${e(s.branding.supportUrl)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.branding.supportLabel || 'WhatsApp')}</a>` : ''}</div></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 28px;border-bottom:1px solid #f1f5f9;text-align:${al}"><p style="margin:0;font-size:14px;line-height:1.6;color:#64748b">${L.regards}<br><b style="color:#0f172a;font-size:15px">${e(app)}</b><br><span style="color:#0284c7;font-weight:600">${L.team}</span></p></td></tr>
<tr><td align="center" class="mobile-pad" style="padding:20px 40px;background:#f8fafc;text-align:center;font-size:12px;color:#94a3b8">${site ? `<a href="${e(site)}" style="font-size:13px;font-weight:700;color:#0284c7;text-decoration:none">${e(siteTxt)}</a><br>` : ''}${unsubUrl ? `<span style="display:inline-block;margin-top:8px">${L.unsub} <a href="${e(unsubUrl)}" style="color:#64748b">${L.unsubLink}</a></span>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: fillTxt(C.subject || C.title || app), html, payAcc, lang };
}
// WhatsApp message templates. {placeholders} are filled per customer. Admin can override them in settings.waTemplates
export const WA_TPL = {
  pay: {
    en: 'Hello {name} 👋\n\nThank you for choosing *{app}* 🎉\nHere is your package:\n\n📺 *{package}*\n⏳ {days} days · {devices} device(s)\n💶 *{price}*\n\n🔒 Pay securely here:\n{link}\n\nYou get instant activation after payment. Any question? Just reply here 😊',
    fr: 'Bonjour {name} 👋\n\nMerci d\'avoir choisi *{app}* 🎉\nVoici votre formule :\n\n📺 *{package}*\n⏳ {days} jours · {devices} appareil(s)\n💶 *{price}*\n\n🔒 Payez en toute sécurité ici :\n{link}\n\nActivation immédiate après le paiement. Une question ? Répondez ici 😊',
  },
  trial: {
    en: 'Hello {name} 👋\n\nYour free *{app}* trial is ready 🎁\n\n👤 Username: {username}\n🔑 Password: {password}\n🌐 DNS: {dns}\n⏳ Valid until: {expires}\n\n📋 M3U link:\n{m3u}\n\n📲 Watch in our app: {appUrl}\n\nEnjoy, and tell us what you think! When you are ready, we will send you the best offer.',
    fr: 'Bonjour {name} 👋\n\nVotre essai gratuit *{app}* est prêt 🎁\n\n👤 Identifiant : {username}\n🔑 Mot de passe : {password}\n🌐 DNS : {dns}\n⏳ Valable jusqu’au : {expires}\n\n📋 Lien M3U :\n{m3u}\n\n📲 Regardez dans notre application : {appUrl}\n\nBon visionnage, et dites-nous ce que vous en pensez ! Quand vous serez prêt, nous vous enverrons la meilleure offre.',
  },
  thanks: {
    en: 'Hello {name} 👋\n\nThank you for your purchase 🎉 Your *{app}* subscription is active.\n\n📺 {package}\n📅 Valid until: {expires}\n\n👤 Username: {username}\n🔑 Password: {password}\n🌐 DNS: {dns}\n\n📲 Watch in our app: {appUrl}\n\nNeed anything? Just reply to this message.',
    fr: 'Bonjour {name} 👋\n\nMerci pour votre achat 🎉 Votre abonnement *{app}* est actif.\n\n📺 {package}\n📅 Valable jusqu’au : {expires}\n\n👤 Identifiant : {username}\n🔑 Mot de passe : {password}\n🌐 DNS : {dns}\n\n📲 Regardez dans notre application : {appUrl}\n\nBesoin d’aide ? Répondez simplement à ce message.',
  },
  login: {
    en: 'Hello {name} 👋\n\nYour *{app}* subscription is ready ✅\n\n👤 Username: {username}\n🔑 Password: {password}\n🌐 DNS: {dns}\n📅 Expires: {expires}\n\n📋 M3U link:\n{m3u}\n\n📲 Watch in our app: {appUrl}\nEnjoy! 🍿',
    fr: 'Bonjour {name} 👋\n\nVotre abonnement *{app}* est prêt ✅\n\n👤 Identifiant : {username}\n🔑 Mot de passe : {password}\n🌐 DNS : {dns}\n📅 Expire le : {expires}\n\n📋 Lien M3U :\n{m3u}\n\n📲 Regardez dans notre application : {appUrl}\nBon visionnage ! 🍿',
  },
  renew: {
    en: 'Hello {name} 👋\n\nYour *{app}* subscription {ends} *{expires}* ⏰\nRenew now and keep watching 📺\n\n*{package}* — *{price}*\n🔒 Pay here: {link}\n\nNeed help? Just reply here 😊',
    fr: 'Bonjour {name} 👋\n\nVotre abonnement *{app}* {ends} *{expires}* ⏰\nRenouvelez maintenant pour continuer à regarder 📺\n\n*{package}* — *{price}*\n🔒 Payez ici : {link}\n\nBesoin d\'aide ? Répondez ici 😊',
  },
};

// German, Spanish and Italian versions of the emails and WhatsApp messages
Object.assign(MAIL, { de: {"trialSubject": "Ihr kostenloser {hours}-Stunden-Test ist bereit", "welcomeSubject": "Ihr Konto ist bereit", "hello": "Hallo {name},", "trialBody": "Ihr kostenloser Test ist {hours} Stunden lang aktiv. Melden Sie sich mit diesen Daten an:", "welcomeBody": "Ihr Abonnement ist aktiv. Melden Sie sich mit diesen Daten an:", "user": "Benutzername", "pass": "Passwort", "expires": "Läuft ab", "open": "App öffnen", "install": "Tipp: Fügen Sie die App zu Ihrem Startbildschirm hinzu, um sie wie eine normale App zu nutzen.", "expirySubject": "Ihr Abonnement endet in {days} Tagen", "expiryBody": "Ihr Abonnement endet am {date}. Kontaktieren Sie uns zur Verlängerung, damit Sie weiter schauen können.", "thanks": "Vielen Dank!"}, es: {"trialSubject": "Tu prueba gratuita de {hours} h está lista", "welcomeSubject": "Tu cuenta está lista", "hello": "Hola {name}:", "trialBody": "Tu prueba gratuita está activa durante {hours} horas. Inicia sesión con estos datos:", "welcomeBody": "Tu suscripción está activa. Inicia sesión con estos datos:", "user": "Usuario", "pass": "Contraseña", "expires": "Caduca", "open": "Abrir la app", "install": "Consejo: añade la app a tu pantalla de inicio para usarla como una app normal.", "expirySubject": "Tu suscripción termina en {days} días", "expiryBody": "Tu suscripción termina el {date}. Contáctanos para renovarla y seguir viendo.", "thanks": "¡Gracias!"}, it: {"trialSubject": "La tua prova gratuita di {hours} ore è pronta", "welcomeSubject": "Il tuo account è pronto", "hello": "Ciao {name},", "trialBody": "La tua prova gratuita è attiva per {hours} ore. Accedi con questi dati:", "welcomeBody": "Il tuo abbonamento è attivo. Accedi con questi dati:", "user": "Nome utente", "pass": "Password", "expires": "Scade", "open": "Apri l’app", "install": "Suggerimento: aggiungi l’app alla schermata Home per usarla come una normale app.", "expirySubject": "Il tuo abbonamento scade tra {days} giorni", "expiryBody": "Il tuo abbonamento scade il {date}. Contattaci per rinnovarlo e continuare a guardare.", "thanks": "Grazie!"} });
Object.assign(AM, { de: {"dir": "ltr", "trialTitle": "Ihr kostenloser Test ist bereit 🎉", "subTitle": "Ihr Abonnement ist aktiv ✅", "trialSub": "Sofort aktiviert. Starten Sie jetzt mit dem Streaming.", "subSub": "Ihre Leitung ist aktiv. Starten Sie jetzt mit dem Streaming.", "dear": "Liebe/r {name},", "trialIntro": "Vielen Dank, dass Sie sich für <b>{app}</b> entschieden haben. Wir freuen uns, Ihnen mitzuteilen, dass Ihr kostenloser Test bereit ist.", "subIntro": "Vielen Dank, dass Sie sich für <b>{app}</b> entschieden haben. Ihr Abonnement ist aktiv und einsatzbereit.", "trialNote": "<b>⏳ Bitte beachten:</b> Ihr kostenloser Test endet nach <b>{hours} Stunden</b>.", "subNote": "<b>📅 Gültig bis:</b> {date}", "details": "📺 Zugangsdaten", "detailsIntro": "Schauen Sie in unserer App oder in einem kompatiblen IPTV-Player mit diesen Daten:", "user": "Benutzername", "pass": "Passwort", "dns": "DNS / Portal", "m3u": "M3U-Links", "appTitle": "📲 In der {app}-App schauen", "appText": "Funktioniert auf Android, Android TV, iPhone, iPad, Windows und Mac. Sie aktualisiert sich selbst.", "openApp": "App öffnen", "getApp": "App herunterladen", "setup": "⚙️ Einrichtung für andere IPTV-Player", "s1": "Laden Sie einen kompatiblen IPTV-Player herunter und installieren Sie ihn (z. B. IPTV Smarters Pro, XCIPTV oder TiviMate).", "s2": "Öffnen Sie ihn und wählen Sie <b>Login with Xtream Codes API</b> oder <b>M3U Playlist URL</b>.", "s3": "Geben Sie oben stehenden <b>Benutzernamen</b>, das <b>Passwort</b> und die <b>DNS-URL</b> ein.", "s4": "Tippen Sie auf <b>Connect</b> oder <b>Add User</b>, warten Sie, bis die Sender geladen sind, und viel Spaß!", "help": "📞 Brauchen Sie Hilfe?", "helpText": "Wenn Sie Fragen haben oder Hilfe bei der Einrichtung brauchen, ist unser Kundenservice für Sie da.", "support": "Kundenservice", "email": "E-Mail", "website": "Webseite", "whatsapp": "WhatsApp", "closing": "Wir danken Ihnen herzlich für Ihr Interesse an <b>{app}</b> und wünschen Ihnen viel Freude.", "regards": "Herzliche Grüße,", "team": "Ihr Kundenservice-Team", "footer": "Vielen Dank für Ihr Vertrauen. Bei Fragen wenden Sie sich bitte an unser Support-Team — wir sorgen dafür, dass Ihr IPTV-Erlebnis hervorragend ist."}, es: {"dir": "ltr", "trialTitle": "Tu prueba gratuita está lista 🎉", "subTitle": "Tu suscripción está activa ✅", "trialSub": "Activación inmediata completada. Empieza a ver ahora.", "subSub": "Tu línea está activa. Empieza a ver ahora.", "dear": "Hola {name}:", "trialIntro": "Gracias por elegir <b>{app}</b>. Nos alegra informarte de que tu prueba gratuita ya está lista.", "subIntro": "Gracias por elegir <b>{app}</b>. Tu suscripción está activa y lista para usar.", "trialNote": "<b>⏳ Ten en cuenta:</b> tu prueba gratuita caduca tras <b>{hours} horas</b>.", "subNote": "<b>📅 Válida hasta:</b> {date}", "details": "📺 Datos de acceso", "detailsIntro": "Mira en nuestra app o en cualquier reproductor IPTV compatible con estos datos:", "user": "Usuario", "pass": "Contraseña", "dns": "DNS / Portal", "m3u": "Enlaces M3U", "appTitle": "📲 Mira en la app de {app}", "appText": "Funciona en Android, Android TV, iPhone, iPad, Windows y Mac. Se actualiza sola.", "openApp": "Abrir la app", "getApp": "Descargar la app", "setup": "⚙️ Instrucciones para otros reproductores IPTV", "s1": "Descarga e instala un reproductor IPTV compatible (por ejemplo IPTV Smarters Pro, XCIPTV o TiviMate).", "s2": "Ábrelo y elige <b>Login with Xtream Codes API</b> o <b>M3U Playlist URL</b>.", "s3": "Introduce el <b>usuario</b>, la <b>contraseña</b> y la <b>URL DNS</b> de arriba.", "s4": "Pulsa <b>Connect</b> o <b>Add User</b>, espera a que carguen los canales y ¡a disfrutar!", "help": "📞 ¿Necesitas ayuda?", "helpText": "Si tienes preguntas o necesitas ayuda con la instalación, nuestro equipo de atención al cliente está aquí para ti.", "support": "Atención al cliente", "email": "Email", "website": "Web", "whatsapp": "WhatsApp", "closing": "Te agradecemos sinceramente tu interés en <b>{app}</b> y esperamos que disfrutes de la experiencia.", "regards": "Un cordial saludo,", "team": "Equipo de atención al cliente", "footer": "Gracias por tu confianza. Si tienes cualquier pregunta, contacta con nuestro equipo de soporte: estamos aquí para que tu experiencia IPTV sea excelente."}, it: {"dir": "ltr", "trialTitle": "La tua prova gratuita è pronta 🎉", "subTitle": "Il tuo abbonamento è attivo ✅", "trialSub": "Attivazione immediata completata. Inizia subito a guardare.", "subSub": "La tua linea è attiva. Inizia subito a guardare.", "dear": "Gentile {name},", "trialIntro": "Grazie per aver scelto <b>{app}</b>. Siamo lieti di comunicarti che la tua prova gratuita è pronta.", "subIntro": "Grazie per aver scelto <b>{app}</b>. Il tuo abbonamento è attivo e pronto all’uso.", "trialNote": "<b>⏳ Nota:</b> la tua prova gratuita scade dopo <b>{hours} ore</b>.", "subNote": "<b>📅 Valido fino al:</b> {date}", "details": "📺 Dati di accesso", "detailsIntro": "Guarda nella nostra app o con qualsiasi lettore IPTV compatibile usando questi dati:", "user": "Nome utente", "pass": "Password", "dns": "DNS / Portale", "m3u": "Link M3U", "appTitle": "📲 Guarda nell’app {app}", "appText": "Funziona su Android, Android TV, iPhone, iPad, Windows e Mac. Si aggiorna da sola.", "openApp": "Apri l’app", "getApp": "Scarica l’app", "setup": "⚙️ Istruzioni per altri lettori IPTV", "s1": "Scarica e installa un lettore IPTV compatibile (ad es. IPTV Smarters Pro, XCIPTV o TiviMate).", "s2": "Aprilo e scegli <b>Login with Xtream Codes API</b> o <b>M3U Playlist URL</b>.", "s3": "Inserisci il <b>nome utente</b>, la <b>password</b> e l’<b>URL DNS</b> qui sopra.", "s4": "Tocca <b>Connect</b> o <b>Add User</b>, attendi il caricamento dei canali e buona visione!", "help": "📞 Hai bisogno di aiuto?", "helpText": "Se hai domande o ti serve aiuto con la configurazione, il nostro servizio clienti è qui per te.", "support": "Servizio clienti", "email": "Email", "website": "Sito web", "whatsapp": "WhatsApp", "closing": "Ti ringraziamo sinceramente per l’interesse verso <b>{app}</b> e ti auguriamo una buona esperienza.", "regards": "Cordiali saluti,", "team": "Il team del servizio clienti", "footer": "Grazie per la fiducia. Per qualsiasi domanda contatta il nostro supporto: siamo qui per rendere eccellente la tua esperienza IPTV."} });
Object.assign(RM, { de: {"dir": "ltr", "badgeSub": "Abonnement beendet • Verlängerungserinnerung", "badgeTrial": "Test beendet • Sonderangebot", "title": "Verlängern Sie Ihr {app}-Abonnement noch heute!", "dear": "Liebe/r {name},", "introTrial": "Vielen Dank, dass Sie sich für <b>{app}</b> entschieden haben! Wir hoffen, Ihr Test hat Ihnen gefallen und Sie hatten ein tolles Streaming-Erlebnis.", "introSub": "Vielen Dank, dass Sie sich für <b>{app}</b> entschieden haben! Wir hoffen, Ihr Abonnement hat Ihnen gefallen und Sie hatten ein tolles Streaming-Erlebnis.", "intro2Trial": "Ihr Testzeitraum ist nun beendet, aber Sie können unseren Dienst weiter genießen, indem Sie Ihr Abonnement noch heute verlängern.", "intro2Sub": "Ihr Abonnement ist am <b>{date}</b> abgelaufen, aber Sie können unseren Dienst weiter genießen, indem Sie es noch heute verlängern.", "offerLabel": "Willkommen-zurück-Paket", "coupon": "🎁 Exklusiver Gutscheincode", "cta": "Jetzt Abonnement verlängern →", "how": "So verlängern Sie Ihr Abonnement", "h1": "Besuchen Sie {site}.", "h2": "Sehen Sie sich unsere verfügbaren Abonnements an.", "h2b": "Wählen Sie das Paket, das am besten zu Ihnen passt.", "h3": "Geben Sie beim Bezahlen den Gutscheincode {coupon} ein, falls zutreffend.", "h4": "Schließen Sie die Zahlung über den angebotenen Bezahlvorgang ab.", "h5": "Sobald Ihre Bestellung bestätigt ist, kontaktieren Sie unser Support-Team, falls Sie Hilfe bei der Aktivierung brauchen.", "helpTitle": "Brauchen Sie Hilfe?", "help": "Wenn Sie Fragen haben oder Hilfe bei der Verlängerung brauchen, kontaktieren Sie bitte unser Support-Team:", "emailL": "E-Mail:", "webL": "Webseite:", "thanks": "Vielen Dank, dass Sie sich für <b>{app}</b> entschieden haben. Wir schätzen Ihre Unterstützung und freuen uns darauf, Sie wieder begrüßen zu dürfen!", "regards": "Mit freundlichen Grüßen,", "team": "Ihr Kundenservice-Team", "subject": "Verlängern Sie Ihr {app}-Abonnement noch heute!"}, es: {"dir": "ltr", "badgeSub": "Suscripción terminada • Recordatorio de renovación", "badgeTrial": "Prueba terminada • Oferta especial", "title": "¡Renueva hoy tu suscripción a {app}!", "dear": "Hola {name}:", "introTrial": "¡Gracias por elegir <b>{app}</b>! Esperamos que hayas disfrutado de tu prueba y de una gran experiencia de streaming.", "introSub": "¡Gracias por elegir <b>{app}</b>! Esperamos que hayas disfrutado de tu suscripción y de una gran experiencia de streaming.", "intro2Trial": "Tu periodo de prueba ha terminado, pero puedes seguir disfrutando de nuestro servicio renovando tu suscripción hoy.", "intro2Sub": "Tu suscripción terminó el <b>{date}</b>, pero puedes seguir disfrutando de nuestro servicio renovándola hoy.", "offerLabel": "Paquete especial de bienvenida", "coupon": "🎁 Código de cupón exclusivo", "cta": "Renovar mi suscripción →", "how": "Cómo renovar tu suscripción", "h1": "Visita {site}.", "h2": "Consulta nuestros planes de suscripción disponibles.", "h2b": "Elige el paquete que mejor se adapte a ti.", "h3": "Introduce el código de cupón {coupon} al pagar, si corresponde.", "h4": "Completa el pago con el proceso de compra disponible.", "h5": "Cuando tu pedido esté confirmado, contacta con nuestro equipo de soporte si necesitas ayuda con la activación.", "helpTitle": "¿Necesitas ayuda?", "help": "Si tienes preguntas o necesitas ayuda con la renovación, contacta con nuestro equipo de soporte:", "emailL": "Email:", "webL": "Web:", "thanks": "Gracias por elegir <b>{app}</b>. Agradecemos tu apoyo y ¡esperamos volver a darte la bienvenida pronto!", "regards": "Saludos cordiales,", "team": "Equipo de atención al cliente", "subject": "¡Renueva hoy tu suscripción a {app}!"}, it: {"dir": "ltr", "badgeSub": "Abbonamento scaduto • Promemoria di rinnovo", "badgeTrial": "Prova terminata • Offerta speciale", "title": "Rinnova oggi il tuo abbonamento {app}!", "dear": "Gentile {name},", "introTrial": "Grazie per aver scelto <b>{app}</b>! Speriamo che la prova ti sia piaciuta e che tu abbia vissuto un’ottima esperienza di streaming.", "introSub": "Grazie per aver scelto <b>{app}</b>! Speriamo che l’abbonamento ti sia piaciuto e che tu abbia vissuto un’ottima esperienza di streaming.", "intro2Trial": "Il periodo di prova è terminato, ma puoi continuare a goderti il nostro servizio rinnovando oggi il tuo abbonamento.", "intro2Sub": "Il tuo abbonamento è scaduto il <b>{date}</b>, ma puoi continuare a goderti il nostro servizio rinnovandolo oggi.", "offerLabel": "Pacchetto speciale di bentornato", "coupon": "🎁 Codice coupon esclusivo", "cta": "Rinnova ora l’abbonamento →", "how": "Come rinnovare il tuo abbonamento", "h1": "Visita {site}.", "h2": "Scopri i nostri piani di abbonamento disponibili.", "h2b": "Scegli il pacchetto più adatto a te.", "h3": "Inserisci il codice coupon {coupon} al momento del pagamento, se previsto.", "h4": "Completa il pagamento con la procedura disponibile.", "h5": "Una volta confermato l’ordine, contatta il nostro supporto se ti serve aiuto con l’attivazione.", "helpTitle": "Hai bisogno di aiuto?", "help": "Se hai domande o ti serve aiuto con il rinnovo, contatta il nostro team di supporto:", "emailL": "Email:", "webL": "Sito web:", "thanks": "Grazie per aver scelto <b>{app}</b>. Apprezziamo il tuo supporto e non vediamo l’ora di darti di nuovo il benvenuto!", "regards": "Cordiali saluti,", "team": "Il team del servizio clienti", "subject": "Rinnova oggi il tuo abbonamento {app}!"} });
Object.assign(OM, { de: {"dir": "ltr", "badge": "{app} Bestellung", "title": "Danke, dass Sie {app} gewählt haben 🎉", "sub": "Bitte schließen Sie unten die Bestellung für Ihr gewähltes Paket ab.", "dear": "Liebe/r {name},", "dearAny": "Liebe Kundin, lieber Kunde,", "intro": "Ihr Paket <strong>{pkg}</strong> ist bereit zur Bestellung. Klicken Sie unten auf den sicheren Stripe-Zahlungsbutton, um Ihre Bestellung abzuschließen und sofort freigeschaltet zu werden.", "introMulti": "Ihr Paket <strong>{pkg}</strong> ist bereit zur Bestellung. Schauen Sie gleichzeitig auf {n} Geräten. Klicken Sie unten, um Ihre Bestellung über Stripe abzuschließen.", "access": "{d} Tage Zugang", "dev1": "📺 1 Gerät", "devN": "📺 {n} Geräte gleichzeitig", "cta": "🔒 {pkg} bestellen ({price}) →", "ctaContact": "💬 Kontaktieren Sie uns zur Bestellung", "contactNote": "Schreiben Sie uns und wir senden Ihnen Ihren persönlichen Zahlungslink.", "secure": "100 % sichere Stripe-Zahlung • Sofortige Zustellung per E-Mail", "help": "📞 Brauchen Sie Hilfe?", "regards": "Herzliche Grüße,", "team": "Ihr Kundenservice-Team", "subject": "{pkg} — {price} | {app} Bestellung"}, es: {"dir": "ltr", "badge": "Pedido {app}", "title": "Gracias por elegir {app} 🎉", "sub": "Realiza a continuación el pedido del paquete que has elegido.", "dear": "Hola {name}:", "dearAny": "Estimado cliente:", "intro": "Tu paquete <strong>{pkg}</strong> está listo para el pago. Pulsa el botón de pago seguro de Stripe para completar tu pedido y recibir la activación inmediata.", "introMulti": "Tu paquete <strong>{pkg}</strong> está listo para el pago. Mira a la vez en {n} dispositivos. Pulsa abajo para completar tu pedido con Stripe.", "access": "{d} días de acceso", "dev1": "📺 1 dispositivo", "devN": "📺 {n} dispositivos a la vez", "cta": "🔒 Pedir {pkg} ({price}) →", "ctaContact": "💬 Contáctanos para pedir", "contactNote": "Escríbenos y te enviamos tu enlace de pago personal.", "secure": "Pago 100 % seguro con Stripe • Envío inmediato por email", "help": "📞 ¿Necesitas ayuda?", "regards": "Un cordial saludo,", "team": "Equipo de atención al cliente", "subject": "{pkg} — {price} | pedido {app}"}, it: {"dir": "ltr", "badge": "Ordine {app}", "title": "Grazie per aver scelto {app} 🎉", "sub": "Completa qui sotto l’ordine per il pacchetto scelto.", "dear": "Gentile {name},", "dearAny": "Gentile cliente,", "intro": "Il tuo pacchetto <strong>{pkg}</strong> è pronto per il pagamento. Clicca sul pulsante di pagamento sicuro Stripe qui sotto per completare l’ordine e ricevere l’attivazione immediata.", "introMulti": "Il tuo pacchetto <strong>{pkg}</strong> è pronto per il pagamento. Guarda contemporaneamente su {n} dispositivi. Clicca qui sotto per completare l’ordine con Stripe.", "access": "{d} giorni di accesso", "dev1": "📺 1 dispositivo", "devN": "📺 {n} dispositivi in contemporanea", "cta": "🔒 Ordina {pkg} ({price}) →", "ctaContact": "💬 Contattaci per ordinare", "contactNote": "Scrivici e ti inviamo il tuo link di pagamento personale.", "secure": "Pagamento Stripe sicuro al 100% • Consegna immediata via email", "help": "📞 Hai bisogno di aiuto?", "regards": "Cordiali saluti,", "team": "Il team del servizio clienti", "subject": "{pkg} — {price} | ordine {app}"} });
Object.assign(NL, { de: {"dear": "Hallo {name},", "dearAny": "Hallo,", "coupon": "🎁 Ihr Gutscheincode", "help": "📞 Brauchen Sie Hilfe?", "regards": "Herzliche Grüße,", "team": "Ihr Kundenservice-Team", "unsub": "Sie möchten diese E-Mails nicht mehr erhalten?", "unsubLink": "Abmelden", "btn": "Zum Angebot →"}, es: {"dear": "Hola {name}:", "dearAny": "Hola:", "coupon": "🎁 Tu código de cupón", "help": "📞 ¿Necesitas ayuda?", "regards": "Un cordial saludo,", "team": "Equipo de atención al cliente", "unsub": "¿No quieres recibir estos emails?", "unsubLink": "Darse de baja", "btn": "Ver la oferta →"}, it: {"dear": "Ciao {name},", "dearAny": "Ciao,", "coupon": "🎁 Il tuo codice coupon", "help": "📞 Hai bisogno di aiuto?", "regards": "Cordiali saluti,", "team": "Il team del servizio clienti", "unsub": "Non vuoi più ricevere queste email?", "unsubLink": "Annulla l’iscrizione", "btn": "Vedi l’offerta →"} });
for (const [k, v] of Object.entries({ de: {"pay": "Hallo {name} 👋\n\nDanke, dass Sie sich für *{app}* entschieden haben 🎉\nHier ist Ihr Paket:\n\n📺 *{package}*\n⏳ {days} Tage · {devices} Gerät(e)\n💶 *{price}*\n\n🔒 Hier sicher bezahlen:\n{link}\n\nNach der Zahlung wird alles sofort aktiviert. Fragen? Antworten Sie einfach hier 😊", "trial": "Hallo {name} 👋\n\nIhr kostenloser *{app}*-Test ist bereit 🎁\n\n👤 Benutzername: {username}\n🔑 Passwort: {password}\n🌐 DNS: {dns}\n⏳ Gültig bis: {expires}\n\n📋 M3U-Link:\n{m3u}\n\n📲 In unserer App schauen: {appUrl}\n\nViel Spaß, und sagen Sie uns Ihre Meinung! Wenn Sie bereit sind, senden wir Ihnen unser bestes Angebot.", "thanks": "Hallo {name} 👋\n\nVielen Dank für Ihren Kauf 🎉 Ihr *{app}*-Abonnement ist aktiv.\n\n📺 {package}\n📅 Gültig bis: {expires}\n\n👤 Benutzername: {username}\n🔑 Passwort: {password}\n🌐 DNS: {dns}\n\n📲 In unserer App schauen: {appUrl}\n\nBrauchen Sie etwas? Antworten Sie einfach auf diese Nachricht.", "login": "Hallo {name} 👋\n\nIhr *{app}*-Abonnement ist bereit ✅\n\n👤 Benutzername: {username}\n🔑 Passwort: {password}\n🌐 DNS: {dns}\n📅 Läuft ab: {expires}\n\n📋 M3U-Link:\n{m3u}\n\n📲 In unserer App schauen: {appUrl}\nViel Spaß! 🍿", "renew": "Hallo {name} 👋\n\nIhr *{app}*-Abonnement {ends} *{expires}* ⏰\nJetzt verlängern und weiter schauen 📺\n\n*{package}* — *{price}*\n🔒 Hier bezahlen: {link}\n\nBrauchen Sie Hilfe? Antworten Sie einfach hier 😊"}, es: {"pay": "Hola {name} 👋\n\nGracias por elegir *{app}* 🎉\nAquí tienes tu paquete:\n\n📺 *{package}*\n⏳ {days} días · {devices} dispositivo(s)\n💶 *{price}*\n\n🔒 Paga de forma segura aquí:\n{link}\n\nLa activación es inmediata tras el pago. ¿Alguna pregunta? Responde aquí 😊", "trial": "Hola {name} 👋\n\nTu prueba gratuita de *{app}* está lista 🎁\n\n👤 Usuario: {username}\n🔑 Contraseña: {password}\n🌐 DNS: {dns}\n⏳ Válida hasta: {expires}\n\n📋 Enlace M3U:\n{m3u}\n\n📲 Mira en nuestra app: {appUrl}\n\n¡Disfrútala y dinos qué te parece! Cuando quieras, te enviamos nuestra mejor oferta.", "thanks": "Hola {name} 👋\n\nGracias por tu compra 🎉 Tu suscripción a *{app}* está activa.\n\n📺 {package}\n📅 Válida hasta: {expires}\n\n👤 Usuario: {username}\n🔑 Contraseña: {password}\n🌐 DNS: {dns}\n\n📲 Mira en nuestra app: {appUrl}\n\n¿Necesitas algo? Responde a este mensaje.", "login": "Hola {name} 👋\n\nTu suscripción a *{app}* está lista ✅\n\n👤 Usuario: {username}\n🔑 Contraseña: {password}\n🌐 DNS: {dns}\n📅 Caduca: {expires}\n\n📋 Enlace M3U:\n{m3u}\n\n📲 Mira en nuestra app: {appUrl}\n¡Disfruta! 🍿", "renew": "Hola {name} 👋\n\nTu suscripción a *{app}* {ends} *{expires}* ⏰\nRenueva ahora y sigue viendo 📺\n\n*{package}* — *{price}*\n🔒 Paga aquí: {link}\n\n¿Necesitas ayuda? Responde aquí 😊"}, it: {"pay": "Ciao {name} 👋\n\nGrazie per aver scelto *{app}* 🎉\nEcco il tuo pacchetto:\n\n📺 *{package}*\n⏳ {days} giorni · {devices} dispositivo/i\n💶 *{price}*\n\n🔒 Paga in sicurezza qui:\n{link}\n\nAttivazione immediata dopo il pagamento. Domande? Rispondi pure qui 😊", "trial": "Ciao {name} 👋\n\nLa tua prova gratuita di *{app}* è pronta 🎁\n\n👤 Nome utente: {username}\n🔑 Password: {password}\n🌐 DNS: {dns}\n⏳ Valida fino al: {expires}\n\n📋 Link M3U:\n{m3u}\n\n📲 Guarda nella nostra app: {appUrl}\n\nBuona visione, e facci sapere cosa ne pensi! Quando vuoi, ti inviamo la nostra offerta migliore.", "thanks": "Ciao {name} 👋\n\nGrazie per l’acquisto 🎉 Il tuo abbonamento *{app}* è attivo.\n\n📺 {package}\n📅 Valido fino al: {expires}\n\n👤 Nome utente: {username}\n🔑 Password: {password}\n🌐 DNS: {dns}\n\n📲 Guarda nella nostra app: {appUrl}\n\nTi serve qualcosa? Rispondi pure a questo messaggio.", "login": "Ciao {name} 👋\n\nIl tuo abbonamento *{app}* è pronto ✅\n\n👤 Nome utente: {username}\n🔑 Password: {password}\n🌐 DNS: {dns}\n📅 Scade: {expires}\n\n📋 Link M3U:\n{m3u}\n\n📲 Guarda nella nostra app: {appUrl}\nBuona visione! 🍿", "renew": "Ciao {name} 👋\n\nIl tuo abbonamento *{app}* {ends} *{expires}* ⏰\nRinnova ora e continua a guardare 📺\n\n*{package}* — *{price}*\n🔒 Paga qui: {link}\n\nHai bisogno di aiuto? Rispondi pure qui 😊"} })) for (const [t, txt] of Object.entries(v)) if (WA_TPL[t]) WA_TPL[t][k] = txt;
// The 24/7 support message (its own WhatsApp type, editable like the others).
WA_TPL.support = Object.fromEntries(LANG_CODES.map((l) => [l, tx(l, 'supMsg', { name: '{name}', app: '{app}', link: '{support}', email: '{supportEmail}' })]));
// ---- Seasonal email templates (newsletter tool), 5 languages ----
// {app} {offer} {code} {end}; lines with an empty {code} / {end} are dropped.
const SEASON = {
  blackfriday: { icon: '🖤', names: { en: 'Black Friday', fr: 'Black Friday', de: 'Black Friday', es: 'Black Friday', it: 'Black Friday' },
    en: { s: '🖤 Black Friday: {offerOr} on {app}', t: 'Black Friday is here!', b: 'Our Black Friday sale has started, and it is the best time of the year to get or renew your {app} subscription.\n\n{lead}, from 1 month to 2 years, and for 1 to 4 devices.\n\n[code]Use the code *{code}* at checkout.\n\n[end]The offer ends on *{end}*, so don\'t wait too long.\n\nAny question? Just reply to this email or message us on WhatsApp, we are happy to help.', btn: 'Get the offer', or: 'our biggest discount of the year', leadO: 'Get *{offer}* on every plan', lead: 'Get our *biggest discount of the year* on every plan' },
    fr: { s: '🖤 Black Friday : {offerOr} sur {app}', t: 'Le Black Friday est là !', b: "Notre offre Black Friday a commencé : c'est le meilleur moment de l'année pour prendre ou renouveler votre abonnement {app}.\n\n{lead}, de 1 mois à 2 ans, pour 1 à 4 appareils.\n\n[code]Utilisez le code *{code}* lors du paiement.\n\n[end]L'offre se termine le *{end}*, ne tardez pas.\n\nUne question ? Répondez simplement à cet email ou écrivez-nous sur WhatsApp, nous sommes là pour vous aider.", btn: "Profiter de l'offre", or: 'notre plus grosse réduction de l’année', leadO: 'Profitez de *{offer}* sur toutes les formules', lead: 'Profitez de *notre plus grosse réduction de l’année* sur toutes les formules' },
    de: { s: '🖤 Black Friday: {offerOr} bei {app}', t: 'Der Black Friday ist da!', b: 'Unser Black-Friday-Sale hat begonnen – die beste Zeit des Jahres, um Ihr {app}-Abonnement abzuschließen oder zu verlängern.\n\n{lead}, von 1 Monat bis 2 Jahre und für 1 bis 4 Geräte.\n\n[code]Geben Sie beim Bezahlen den Code *{code}* ein.\n\n[end]Das Angebot endet am *{end}* – warten Sie nicht zu lange.\n\nFragen? Antworten Sie einfach auf diese E-Mail oder schreiben Sie uns auf WhatsApp, wir helfen gern.', btn: 'Zum Angebot', or: 'unser größter Rabatt des Jahres', leadO: 'Sichern Sie sich *{offer}* auf jedes Paket', lead: 'Sichern Sie sich *unseren größten Rabatt des Jahres* auf jedes Paket' },
    es: { s: '🖤 Black Friday: {offerOr} en {app}', t: '¡Llegó el Black Friday!', b: 'Nuestras ofertas de Black Friday ya han empezado: es el mejor momento del año para contratar o renovar tu suscripción a {app}.\n\n{lead}, de 1 mes a 2 años y para 1 a 4 dispositivos.\n\n[code]Usa el código *{code}* al pagar.\n\n[end]La oferta termina el *{end}*, así que no esperes demasiado.\n\n¿Alguna pregunta? Responde a este email o escríbenos por WhatsApp, estaremos encantados de ayudarte.', btn: 'Ver la oferta', or: 'nuestro mayor descuento del año', leadO: 'Consigue *{offer}* en todos los planes', lead: 'Consigue *nuestro mayor descuento del año* en todos los planes' },
    it: { s: '🖤 Black Friday: {offerOr} su {app}', t: 'È arrivato il Black Friday!', b: "Il nostro Black Friday è iniziato: è il momento migliore dell'anno per attivare o rinnovare il tuo abbonamento {app}.\n\n{lead}, da 1 mese a 2 anni e per 1-4 dispositivi.\n\n[code]Usa il codice *{code}* al momento del pagamento.\n\n[end]L'offerta termina il *{end}*, non aspettare troppo.\n\nDomande? Rispondi a questa email o scrivici su WhatsApp, siamo felici di aiutarti.", btn: "Approfitta dell'offerta", or: "il nostro sconto più grande dell'anno", leadO: 'Ottieni *{offer}* su tutti i piani', lead: "Ottieni *il nostro sconto più grande dell'anno* su tutti i piani" } },
  cybermonday: { icon: '💻', names: { en: 'Cyber Monday', fr: 'Cyber Monday', de: 'Cyber Monday', es: 'Cyber Monday', it: 'Cyber Monday' },
    en: { s: '💻 Cyber Monday: last chance for {offerOr} on {app}', t: 'Cyber Monday: last chance!', b: 'Missed Black Friday? Cyber Monday is your last chance to get {app} at our best price of the year.\n\n{lead}, on every plan and for 1 to 4 devices.\n\n[code]Use the code *{code}* at checkout.\n\n[end]It ends on *{end}* at midnight.\n\nQuestions? Just reply to this email, we answer fast.', btn: 'Get the deal', or: 'our best price', leadO: 'Get *{offer}*', lead: 'Get *our lowest price of the year*' },
    fr: { s: '💻 Cyber Monday : dernière chance pour {offerOr} sur {app}', t: 'Cyber Monday : dernière chance !', b: "Vous avez raté le Black Friday ? Le Cyber Monday est votre dernière chance d'avoir {app} à notre meilleur prix de l'année.\n\n{lead}, sur toutes les formules et pour 1 à 4 appareils.\n\n[code]Utilisez le code *{code}* lors du paiement.\n\n[end]L'offre se termine le *{end}* à minuit.\n\nUne question ? Répondez simplement à cet email, nous répondons vite.", btn: "J'en profite", or: 'notre meilleur prix', leadO: 'Profitez de *{offer}*', lead: 'Profitez de *notre prix le plus bas de l’année*' },
    de: { s: '💻 Cyber Monday: letzte Chance auf {offerOr} bei {app}', t: 'Cyber Monday: letzte Chance!', b: 'Black Friday verpasst? Am Cyber Monday bekommen Sie {app} ein letztes Mal zum besten Preis des Jahres.\n\n{lead}, auf jedes Paket und für 1 bis 4 Geräte.\n\n[code]Geben Sie beim Bezahlen den Code *{code}* ein.\n\n[end]Das Angebot endet am *{end}* um Mitternacht.\n\nFragen? Antworten Sie einfach auf diese E-Mail, wir antworten schnell.', btn: 'Angebot sichern', or: 'unseren besten Preis', leadO: 'Sichern Sie sich *{offer}*', lead: 'Sichern Sie sich *unseren niedrigsten Preis des Jahres*' },
    es: { s: '💻 Cyber Monday: última oportunidad para {offerOr} en {app}', t: 'Cyber Monday: ¡última oportunidad!', b: '¿Te perdiste el Black Friday? El Cyber Monday es tu última oportunidad de tener {app} a nuestro mejor precio del año.\n\n{lead}, en todos los planes y para 1 a 4 dispositivos.\n\n[code]Usa el código *{code}* al pagar.\n\n[end]Termina el *{end}* a medianoche.\n\n¿Preguntas? Responde a este email, contestamos rápido.', btn: 'Aprovechar la oferta', or: 'nuestro mejor precio', leadO: 'Consigue *{offer}*', lead: 'Consigue *nuestro precio más bajo del año*' },
    it: { s: '💻 Cyber Monday: ultima occasione per {offerOr} su {app}', t: 'Cyber Monday: ultima occasione!', b: "Hai perso il Black Friday? Il Cyber Monday è la tua ultima occasione per avere {app} al miglior prezzo dell'anno.\n\n{lead}, su tutti i piani e per 1-4 dispositivi.\n\n[code]Usa il codice *{code}* al momento del pagamento.\n\n[end]Termina il *{end}* a mezzanotte.\n\nDomande? Rispondi a questa email, rispondiamo in fretta.", btn: "Approfitta dell'offerta", or: 'il nostro miglior prezzo', leadO: 'Ottieni *{offer}*', lead: "Ottieni *il nostro prezzo più basso dell'anno*" } },
  christmas: { icon: '🎄', names: { en: 'Christmas', fr: 'Noël', de: 'Weihnachten', es: 'Navidad', it: 'Natale' },
    en: { s: '🎄 Our Christmas gift for you: {offerOr} on {app}', t: 'Merry Christmas from {app}!', b: 'The holidays are here, and there is nothing better than movies, series and live sport with the people you love.\n\nTo say thank you, we have a Christmas gift for you: {lead}.\n\n[code]Use the code *{code}* at checkout.\n\n[end]Valid until *{end}*.\n\nA {app} subscription is also a great gift for family and friends. Just reply to this email and we will set it up for them.\n\nMerry Christmas and happy holidays!', btn: 'Open my gift', or: 'a special holiday price', leadO: '*{offer}* on every plan', lead: 'a *special holiday price* on every plan' },
    fr: { s: '🎄 Notre cadeau de Noël : {offerOr} sur {app}', t: 'Joyeux Noël de la part de {app} !', b: "Les fêtes sont là, et rien de mieux que des films, des séries et du sport en direct avec ceux qu'on aime.\n\nPour vous remercier, nous avons un cadeau de Noël pour vous : {lead}.\n\n[code]Utilisez le code *{code}* lors du paiement.\n\n[end]Valable jusqu'au *{end}*.\n\nUn abonnement {app} est aussi un très beau cadeau pour la famille et les amis. Répondez à cet email et nous le préparons pour eux.\n\nJoyeux Noël et bonnes fêtes !", btn: 'Ouvrir mon cadeau', or: 'un prix spécial fêtes', leadO: '*{offer}* sur toutes les formules', lead: 'un *prix spécial fêtes* sur toutes les formules' },
    de: { s: '🎄 Unser Weihnachtsgeschenk für Sie: {offerOr} bei {app}', t: 'Frohe Weihnachten von {app}!', b: 'Die Feiertage sind da – und es gibt nichts Schöneres als Filme, Serien und Live-Sport mit den Menschen, die man liebt.\n\nAls Dankeschön haben wir ein Weihnachtsgeschenk für Sie: {lead}.\n\n[code]Geben Sie beim Bezahlen den Code *{code}* ein.\n\n[end]Gültig bis *{end}*.\n\nEin {app}-Abonnement ist auch ein tolles Geschenk für Familie und Freunde. Antworten Sie einfach auf diese E-Mail, wir richten es für sie ein.\n\nFrohe Weihnachten und schöne Feiertage!', btn: 'Geschenk öffnen', or: 'einen Feiertagspreis', leadO: '*{offer}* auf jedes Paket', lead: 'ein *besonderer Feiertagspreis* auf jedes Paket' },
    es: { s: '🎄 Nuestro regalo de Navidad: {offerOr} en {app}', t: '¡Feliz Navidad de parte de {app}!', b: 'Llegan las fiestas, y no hay nada mejor que películas, series y deporte en directo con las personas que quieres.\n\nPara darte las gracias, tenemos un regalo de Navidad para ti: {lead}.\n\n[code]Usa el código *{code}* al pagar.\n\n[end]Válido hasta el *{end}*.\n\nUna suscripción a {app} también es un gran regalo para familia y amigos. Responde a este email y la preparamos para ellos.\n\n¡Feliz Navidad y felices fiestas!', btn: 'Abrir mi regalo', or: 'un precio especial de fiestas', leadO: '*{offer}* en todos los planes', lead: 'un *precio especial de fiestas* en todos los planes' },
    it: { s: '🎄 Il nostro regalo di Natale: {offerOr} su {app}', t: 'Buon Natale da {app}!', b: 'Sono arrivate le feste, e non c’è niente di meglio di film, serie e sport in diretta con le persone che ami.\n\nPer ringraziarti abbiamo un regalo di Natale per te: {lead}.\n\n[code]Usa il codice *{code}* al momento del pagamento.\n\n[end]Valido fino al *{end}*.\n\nUn abbonamento {app} è anche un bellissimo regalo per famiglia e amici. Rispondi a questa email e lo prepariamo per loro.\n\nBuon Natale e buone feste!', btn: 'Apri il mio regalo', or: 'un prezzo speciale per le feste', leadO: '*{offer}* su tutti i piani', lead: 'un *prezzo speciale per le feste* su tutti i piani' } },
  newyear: { icon: '🎆', names: { en: 'New Year', fr: 'Nouvel An', de: 'Neujahr', es: 'Año Nuevo', it: 'Capodanno' },
    en: { s: '🎆 Happy New Year! Start the year with {offerOr} on {app}', t: 'Happy New Year!', b: 'Thank you for being with us this year. We wish you a happy, healthy new year!\n\nStart it well with {lead}, on every plan and for 1 to 4 devices.\n\n[code]Use the code *{code}* at checkout.\n\n[end]The offer is valid until *{end}*.\n\nSee you on the big screen in the new year!', btn: 'Start the year', or: 'a New Year offer', leadO: '*{offer}*', lead: 'our *New Year offer*' },
    fr: { s: '🎆 Bonne année ! Commencez l’année avec {offerOr} sur {app}', t: 'Bonne année !', b: "Merci d'avoir été avec nous cette année. Nous vous souhaitons une belle et heureuse nouvelle année !\n\nCommencez-la bien avec {lead}, sur toutes les formules et pour 1 à 4 appareils.\n\n[code]Utilisez le code *{code}* lors du paiement.\n\n[end]Offre valable jusqu'au *{end}*.\n\nÀ très vite sur grand écran !", btn: "Bien commencer l'année", or: 'une offre du Nouvel An', leadO: '*{offer}*', lead: 'notre *offre du Nouvel An*' },
    de: { s: '🎆 Frohes neues Jahr! Starten Sie mit {offerOr} bei {app}', t: 'Frohes neues Jahr!', b: 'Danke, dass Sie dieses Jahr bei uns waren. Wir wünschen Ihnen ein glückliches und gesundes neues Jahr!\n\nStarten Sie gut mit {lead}, auf jedes Paket und für 1 bis 4 Geräte.\n\n[code]Geben Sie beim Bezahlen den Code *{code}* ein.\n\n[end]Das Angebot gilt bis *{end}*.\n\nWir sehen uns im neuen Jahr auf dem großen Bildschirm!', btn: 'Gut ins Jahr starten', or: 'einem Neujahrsangebot', leadO: '*{offer}*', lead: 'unserem *Neujahrsangebot*' },
    es: { s: '🎆 ¡Feliz Año Nuevo! Empieza el año con {offerOr} en {app}', t: '¡Feliz Año Nuevo!', b: 'Gracias por estar con nosotros este año. ¡Te deseamos un feliz y próspero año nuevo!\n\nEmpiézalo bien con {lead}, en todos los planes y para 1 a 4 dispositivos.\n\n[code]Usa el código *{code}* al pagar.\n\n[end]La oferta es válida hasta el *{end}*.\n\n¡Nos vemos en la pantalla grande en el nuevo año!', btn: 'Empezar el año', or: 'una oferta de Año Nuevo', leadO: '*{offer}*', lead: 'nuestra *oferta de Año Nuevo*' },
    it: { s: '🎆 Buon anno! Inizia l’anno con {offerOr} su {app}', t: 'Buon anno!', b: "Grazie per essere stato con noi quest'anno. Ti auguriamo un nuovo anno felice e sereno!\n\nInizialo al meglio con {lead}, su tutti i piani e per 1-4 dispositivi.\n\n[code]Usa il codice *{code}* al momento del pagamento.\n\n[end]L'offerta è valida fino al *{end}*.\n\nCi vediamo sul grande schermo nel nuovo anno!", btn: "Inizia bene l'anno", or: "un'offerta di Capodanno", leadO: '*{offer}*', lead: 'la nostra *offerta di Capodanno*' } },
};
// All-year promotions: Christmas & New Year together, sports/cinema/streaming events, an evergreen offer, and devices (Samsung, iPhone, Smart TV)
Object.assign(SEASON, {"holidays": {"icon": "🎁", "names": {"en": "Christmas & New Year", "fr": "Noël & Nouvel An", "de": "Weihnachten & Neujahr", "es": "Navidad y Año Nuevo", "it": "Natale e Capodanno"}, "en": {"s": "🎁 Christmas & New Year: {offerOr} on {app}", "t": "Happy holidays from {app}!", "b": "Celebrate Christmas and the New Year with every big match, the new movies and your favourite series, live in Ultra HD.\n\n{lead} on our *1-Year*, *Multi-Device* and *Reseller* plans.\n\n[code]Use the code *{code}* at checkout.\n\n[end]The holiday offer ends on *{end}*.\n\n⚡ Instant activation on Samsung, iPhone, Smart TV & more.\n🎁 Test it free today: {trial}\n🛠️ Need help? {support}", "btn": "Get the holiday offer", "or": "our holiday price", "leadO": "Get *{offer}*", "lead": "Get our *special holiday price*"}, "fr": {"s": "🎁 Noël & Nouvel An : {offerOr} sur {app}", "t": "Joyeuses fêtes de la part de {app} !", "b": "Fêtez Noël et le Nouvel An avec tous les grands matchs, les nouveaux films et vos séries préférées, en direct en Ultra HD.\n\n{lead} sur nos abonnements *1 an*, *multi-appareils* et *revendeur*.\n\n[code]Utilisez le code *{code}* lors du paiement.\n\n[end]L'offre des fêtes se termine le *{end}*.\n\n⚡ Activation immédiate sur Samsung, iPhone, Smart TV et plus.\n🎁 Testez gratuitement aujourd'hui : {trial}\n🛠️ Besoin d'aide ? {support}", "btn": "Profiter de l'offre", "or": "notre prix des fêtes", "leadO": "Profitez de *{offer}*", "lead": "Profitez de notre *prix spécial des fêtes*"}, "de": {"s": "🎁 Weihnachten & Neujahr: {offerOr} bei {app}", "t": "Frohe Feiertage von {app}!", "b": "Feiern Sie Weihnachten und Neujahr mit allen großen Spielen, den neuen Filmen und Ihren Lieblingsserien – live in Ultra HD.\n\n{lead} für unsere Abos *1 Jahr*, *Mehrere Geräte* und *Reseller*.\n\n[code]Geben Sie beim Bezahlen den Code *{code}* ein.\n\n[end]Das Feiertagsangebot endet am *{end}*.\n\n⚡ Sofortige Aktivierung auf Samsung, iPhone, Smart-TV und mehr.\n🎁 Heute kostenlos testen: {trial}\n🛠️ Hilfe nötig? {support}", "btn": "Zum Angebot", "or": "unser Feiertagspreis", "leadO": "Sichern Sie sich *{offer}*", "lead": "Sichern Sie sich unseren *Feiertags-Sonderpreis*"}, "es": {"s": "🎁 Navidad y Año Nuevo: {offerOr} en {app}", "t": "¡Felices fiestas de parte de {app}!", "b": "Celebra la Navidad y el Año Nuevo con todos los grandes partidos, las nuevas películas y tus series favoritas, en directo en Ultra HD.\n\n{lead} en nuestros planes de *1 año*, *varios dispositivos* y *revendedor*.\n\n[code]Usa el código *{code}* al pagar.\n\n[end]La oferta de fiestas termina el *{end}*.\n\n⚡ Activación inmediata en Samsung, iPhone, Smart TV y más.\n🎁 Pruébalo gratis hoy: {trial}\n🛠️ ¿Necesitas ayuda? {support}", "btn": "Ver la oferta", "or": "nuestro precio de fiestas", "leadO": "Consigue *{offer}*", "lead": "Consigue nuestro *precio especial de fiestas*"}, "it": {"s": "🎁 Natale e Capodanno: {offerOr} su {app}", "t": "Buone feste da {app}!", "b": "Festeggia Natale e Capodanno con tutte le grandi partite, i nuovi film e le tue serie preferite, in diretta in Ultra HD.\n\n{lead} sui piani *1 anno*, *multi-dispositivo* e *rivenditore*.\n\n[code]Usa il codice *{code}* al pagamento.\n\n[end]L'offerta delle feste termina il *{end}*.\n\n⚡ Attivazione immediata su Samsung, iPhone, Smart TV e altro.\n🎁 Provalo gratis oggi: {trial}\n🛠️ Serve aiuto? {support}", "btn": "Scopri l'offerta", "or": "il nostro prezzo delle feste", "leadO": "Approfitta di *{offer}*", "lead": "Approfitta del nostro *prezzo speciale delle feste*"}}, "events": {"icon": "🏆", "names": {"en": "Sports, cinema & streaming", "fr": "Sport, cinéma & streaming", "de": "Sport, Kino & Streaming", "es": "Deporte, cine y streaming", "it": "Sport, cinema e streaming"}, "en": {"s": "🏆🎬 Never miss a big game or premiere on {app}", "t": "Never Miss a Big Game or Blockbuster Premiere!", "b": "Catch every major Champions League match, UFC fight night, Formula 1 race, and the latest cinema & streaming releases live in Ultra HD!\n\n{lead}\n\n[code]Use the code *{code}* at checkout.\n\n[end]Offer valid until *{end}*.\n\n⚡ Instant activation on Samsung, iPhone, Smart TV & more.\n🎁 Test it live today: {trial}\n🛠️ Need help? {support}", "btn": "Watch it live", "or": "the best seat in the house", "leadO": "Get *{offer}* and watch it all.", "lead": "Every sport, every premiere, one subscription."}, "fr": {"s": "🏆🎬 Ne ratez aucun grand match ni aucune avant-première sur {app}", "t": "Ne ratez plus aucun grand match ni aucun film événement !", "b": "Suivez tous les grands matchs de Ligue des champions, les soirées UFC, les Grands Prix de Formule 1 et les dernières sorties cinéma & streaming, en direct en Ultra HD !\n\n{lead}\n\n[code]Utilisez le code *{code}* lors du paiement.\n\n[end]Offre valable jusqu'au *{end}*.\n\n⚡ Activation immédiate sur Samsung, iPhone, Smart TV et plus.\n🎁 Testez en direct aujourd'hui : {trial}\n🛠️ Besoin d'aide ? {support}", "btn": "Regarder en direct", "or": "la meilleure place", "leadO": "Profitez de *{offer}* et regardez tout.", "lead": "Tout le sport, toutes les sorties, un seul abonnement."}, "de": {"s": "🏆🎬 Kein großes Spiel und keine Premiere mehr verpassen – mit {app}", "t": "Verpassen Sie kein großes Spiel und keine Kino-Premiere!", "b": "Sehen Sie jedes große Champions-League-Spiel, jede UFC-Fight-Night, jedes Formel-1-Rennen und die neuesten Kino- & Streaming-Highlights live in Ultra HD!\n\n{lead}\n\n[code]Geben Sie beim Bezahlen den Code *{code}* ein.\n\n[end]Angebot gültig bis *{end}*.\n\n⚡ Sofortige Aktivierung auf Samsung, iPhone, Smart-TV und mehr.\n🎁 Heute live testen: {trial}\n🛠️ Hilfe nötig? {support}", "btn": "Live ansehen", "or": "der beste Platz", "leadO": "Sichern Sie sich *{offer}* und sehen Sie alles.", "lead": "Jeder Sport, jede Premiere, ein Abo."}, "es": {"s": "🏆🎬 No te pierdas ningún gran partido ni estreno en {app}", "t": "¡No te pierdas ningún gran partido ni estreno de cine!", "b": "Disfruta de cada gran partido de la Champions League, cada velada de UFC, cada carrera de Fórmula 1 y los últimos estrenos de cine y streaming, en directo en Ultra HD.\n\n{lead}\n\n[code]Usa el código *{code}* al pagar.\n\n[end]Oferta válida hasta el *{end}*.\n\n⚡ Activación inmediata en Samsung, iPhone, Smart TV y más.\n🎁 Pruébalo en directo hoy: {trial}\n🛠️ ¿Necesitas ayuda? {support}", "btn": "Verlo en directo", "or": "el mejor asiento", "leadO": "Consigue *{offer}* y míralo todo.", "lead": "Todo el deporte, todos los estrenos, una sola suscripción."}, "it": {"s": "🏆🎬 Non perdere nessuna grande partita o prima visione su {app}", "t": "Non perdere nessuna grande partita o prima al cinema!", "b": "Segui ogni grande partita di Champions League, ogni serata UFC, ogni gara di Formula 1 e le ultime uscite di cinema e streaming, in diretta in Ultra HD!\n\n{lead}\n\n[code]Usa il codice *{code}* al pagamento.\n\n[end]Offerta valida fino al *{end}*.\n\n⚡ Attivazione immediata su Samsung, iPhone, Smart TV e altro.\n🎁 Provalo in diretta oggi: {trial}\n🛠️ Serve aiuto? {support}", "btn": "Guarda in diretta", "or": "il posto migliore", "leadO": "Approfitta di *{offer}* e guarda tutto.", "lead": "Tutto lo sport, tutte le prime, un solo abbonamento."}}, "evergreen": {"icon": "⭐", "names": {"en": "All-year offer", "fr": "Offre toute l'année", "de": "Ganzjahresangebot", "es": "Oferta todo el año", "it": "Offerta tutto l'anno"}, "en": {"s": "⭐ {app}: {offerOr}", "t": "Your TV, your way, all year long", "b": "Live TV, sports, movies and series in one subscription, on all your devices.\n\n{lead}, from 1 month to 2 years, for 1 to 4 devices.\n\n[code]Use the code *{code}* at checkout.\n\n[end]Offer valid until *{end}*.\n\n⚡ Instant activation on Samsung, iPhone, Smart TV & more.\n🎁 Try it free first: {trial}\n🛠️ Need help? {support}", "btn": "See the plans", "or": "plans from 1 month", "leadO": "Get *{offer}*", "lead": "Choose the plan that suits you"}, "fr": {"s": "⭐ {app} : {offerOr}", "t": "Votre télé, comme vous voulez, toute l'année", "b": "TV en direct, sport, films et séries dans un seul abonnement, sur tous vos appareils.\n\n{lead}, de 1 mois à 2 ans, pour 1 à 4 appareils.\n\n[code]Utilisez le code *{code}* lors du paiement.\n\n[end]Offre valable jusqu'au *{end}*.\n\n⚡ Activation immédiate sur Samsung, iPhone, Smart TV et plus.\n🎁 Essayez d'abord gratuitement : {trial}\n🛠️ Besoin d'aide ? {support}", "btn": "Voir les offres", "or": "des abonnements dès 1 mois", "leadO": "Profitez de *{offer}*", "lead": "Choisissez l'abonnement qui vous convient"}, "de": {"s": "⭐ {app}: {offerOr}", "t": "Ihr Fernsehen, wie Sie es wollen – das ganze Jahr", "b": "Live-TV, Sport, Filme und Serien in einem Abo, auf all Ihren Geräten.\n\n{lead}, von 1 Monat bis 2 Jahre, für 1 bis 4 Geräte.\n\n[code]Geben Sie beim Bezahlen den Code *{code}* ein.\n\n[end]Angebot gültig bis *{end}*.\n\n⚡ Sofortige Aktivierung auf Samsung, iPhone, Smart-TV und mehr.\n🎁 Zuerst kostenlos testen: {trial}\n🛠️ Hilfe nötig? {support}", "btn": "Abos ansehen", "or": "Abos ab 1 Monat", "leadO": "Sichern Sie sich *{offer}*", "lead": "Wählen Sie das passende Abo"}, "es": {"s": "⭐ {app}: {offerOr}", "t": "Tu tele, a tu manera, todo el año", "b": "TV en directo, deportes, películas y series en una sola suscripción, en todos tus dispositivos.\n\n{lead}, de 1 mes a 2 años, para 1 a 4 dispositivos.\n\n[code]Usa el código *{code}* al pagar.\n\n[end]Oferta válida hasta el *{end}*.\n\n⚡ Activación inmediata en Samsung, iPhone, Smart TV y más.\n🎁 Pruébalo gratis primero: {trial}\n🛠️ ¿Necesitas ayuda? {support}", "btn": "Ver los planes", "or": "planes desde 1 mes", "leadO": "Consigue *{offer}*", "lead": "Elige el plan que mejor te va"}, "it": {"s": "⭐ {app}: {offerOr}", "t": "La tua TV, come vuoi tu, tutto l'anno", "b": "TV in diretta, sport, film e serie in un solo abbonamento, su tutti i tuoi dispositivi.\n\n{lead}, da 1 mese a 2 anni, per 1-4 dispositivi.\n\n[code]Usa il codice *{code}* al pagamento.\n\n[end]Offerta valida fino al *{end}*.\n\n⚡ Attivazione immediata su Samsung, iPhone, Smart TV e altro.\n🎁 Provalo prima gratis: {trial}\n🛠️ Serve aiuto? {support}", "btn": "Vedi i piani", "or": "piani da 1 mese", "leadO": "Approfitta di *{offer}*", "lead": "Scegli il piano adatto a te"}}, "devices": {"icon": "📱", "names": {"en": "Works on every device", "fr": "Sur tous les appareils", "de": "Auf jedem Gerät", "es": "En todos los dispositivos", "it": "Su ogni dispositivo"}, "en": {"s": "📱📺 {app} on your Samsung, iPhone and Smart TV", "t": "One subscription, every screen", "b": "Watch {app} on your Samsung phone or TV, iPhone, iPad, Android, Fire TV Stick, LG Smart TV or computer, with up to 4 screens at the same time.\n\n{lead}\n\n[code]Use the code *{code}* at checkout.\n\n[end]Offer valid until *{end}*.\n\n⚡ Instant activation, set up in minutes.\n🎁 Test it on your device today: {trial}\n🛠️ Need help setting it up? {support}", "btn": "Start watching", "or": "every screen", "leadO": "Get *{offer}* on Multi-Device plans.", "lead": "Add more screens with our Multi-Device plans."}, "fr": {"s": "📱📺 {app} sur votre Samsung, iPhone et Smart TV", "t": "Un abonnement, tous vos écrans", "b": "Regardez {app} sur votre téléphone ou TV Samsung, iPhone, iPad, Android, Fire TV Stick, Smart TV LG ou ordinateur, jusqu'à 4 écrans en même temps.\n\n{lead}\n\n[code]Utilisez le code *{code}* lors du paiement.\n\n[end]Offre valable jusqu'au *{end}*.\n\n⚡ Activation immédiate, installation en quelques minutes.\n🎁 Testez sur votre appareil aujourd'hui : {trial}\n🛠️ Besoin d'aide pour l'installation ? {support}", "btn": "Commencer", "or": "tous vos écrans", "leadO": "Profitez de *{offer}* sur les abonnements multi-appareils.", "lead": "Ajoutez des écrans avec nos abonnements multi-appareils."}, "de": {"s": "📱📺 {app} auf Ihrem Samsung, iPhone und Smart-TV", "t": "Ein Abo, jeder Bildschirm", "b": "Sehen Sie {app} auf Ihrem Samsung-Handy oder -TV, iPhone, iPad, Android, Fire TV Stick, LG Smart-TV oder Computer – bis zu 4 Bildschirme gleichzeitig.\n\n{lead}\n\n[code]Geben Sie beim Bezahlen den Code *{code}* ein.\n\n[end]Angebot gültig bis *{end}*.\n\n⚡ Sofortige Aktivierung, in Minuten eingerichtet.\n🎁 Heute auf Ihrem Gerät testen: {trial}\n🛠️ Hilfe bei der Einrichtung? {support}", "btn": "Jetzt schauen", "or": "jeder Bildschirm", "leadO": "Sichern Sie sich *{offer}* auf Mehrgeräte-Abos.", "lead": "Mehr Bildschirme mit unseren Mehrgeräte-Abos."}, "es": {"s": "📱📺 {app} en tu Samsung, iPhone y Smart TV", "t": "Una suscripción, todas tus pantallas", "b": "Mira {app} en tu móvil o TV Samsung, iPhone, iPad, Android, Fire TV Stick, Smart TV LG u ordenador, hasta 4 pantallas a la vez.\n\n{lead}\n\n[code]Usa el código *{code}* al pagar.\n\n[end]Oferta válida hasta el *{end}*.\n\n⚡ Activación inmediata, listo en minutos.\n🎁 Pruébalo en tu dispositivo hoy: {trial}\n🛠️ ¿Necesitas ayuda para instalarlo? {support}", "btn": "Empezar a ver", "or": "todas tus pantallas", "leadO": "Consigue *{offer}* en los planes de varios dispositivos.", "lead": "Añade pantallas con nuestros planes de varios dispositivos."}, "it": {"s": "📱📺 {app} sul tuo Samsung, iPhone e Smart TV", "t": "Un abbonamento, tutti gli schermi", "b": "Guarda {app} sul tuo telefono o TV Samsung, iPhone, iPad, Android, Fire TV Stick, Smart TV LG o computer, fino a 4 schermi contemporaneamente.\n\n{lead}\n\n[code]Usa il codice *{code}* al pagamento.\n\n[end]Offerta valida fino al *{end}*.\n\n⚡ Attivazione immediata, pronto in pochi minuti.\n🎁 Provalo oggi sul tuo dispositivo: {trial}\n🛠️ Serve aiuto per l'installazione? {support}", "btn": "Inizia a guardare", "or": "tutti gli schermi", "leadO": "Approfitta di *{offer}* sui piani multi-dispositivo.", "lead": "Aggiungi schermi con i nostri piani multi-dispositivo."}}});
// The lines every promotion ends with: devices, free trial, support (added to templates that do not have them yet)
const PROMO_FOOT = { en: '⚡ Instant activation on Samsung, iPhone, Smart TV & more.\n🎁 Test it free today: {trial}\n🛠️ Need help? {support}', fr: "⚡ Activation immédiate sur Samsung, iPhone, Smart TV et plus.\n🎁 Testez gratuitement aujourd'hui : {trial}\n🛠️ Besoin d'aide ? {support}", de: '⚡ Sofortige Aktivierung auf Samsung, iPhone, Smart-TV und mehr.\n🎁 Heute kostenlos testen: {trial}\n🛠️ Hilfe nötig? {support}', es: '⚡ Activación inmediata en Samsung, iPhone, Smart TV y más.\n🎁 Pruébalo gratis hoy: {trial}\n🛠️ ¿Necesitas ayuda? {support}', it: '⚡ Attivazione immediata su Samsung, iPhone, Smart TV e altro.\n🎁 Provalo gratis oggi: {trial}\n🛠️ Serve aiuto? {support}' };
for (const k of Object.keys(SEASON)) for (const l of LANG_CODES) { const L = SEASON[k][l]; if (L && !L.b.includes('{trial}')) L.b = L.b.replace(/\n\n([^\n]*)$/, '\n\n' + PROMO_FOOT[l] + '\n\n$1'); }
// The same promotions for WhatsApp ({name}, {app}, {trial}, {support} are filled for each customer)
export function seasonWa(kind, l, o = {}) {
  const S = SEASON[kind]; if (!S) return ''; const L = S[l] || S.en; const offer = String(o.offer || '').trim(), code = String(o.code || '').trim(), end = String(o.end || '').trim();
  const body = L.b.replace(/\{lead\}/g, offer ? L.leadO : L.lead).replace(/\{offerOr\}/g, offer || L.or).replace(/\{offer\}/g, offer).replace(/\{code\}/g, code).replace(/\{end\}/g, end)
    .split('\n\n').filter((p) => !(p.startsWith('[code]') && !code) && !(p.startsWith('[end]') && !end)).map((p) => p.replace(/^\[(code|end)\]/, '')).filter((p) => !/reply to this email|répondez simplement|antworten sie einfach|responde a este correo|rispondi a questa email/i.test(p)).join('\n\n');
  return `${S.icon} *${L.t}*\n\n${body}`;
}
WA_TPL.ibo_promo = Object.fromEntries(LANG_CODES.map((l) => [l, IBO_TX[l].hi + '\n\n📺 *IBO Player · {iboPrice}*\n\n' + IBO_TX[l].b.replace(/\{price\}/g, '{iboPrice}') + '\n\n👉 {link}\n🛠️ {support}']));
for (const k of Object.keys(SEASON)) WA_TPL['promo_' + k] = Object.fromEntries(LANG_CODES.map((l) => [l, ({ en: 'Hi {name} 👋', fr: 'Bonjour {name} 👋', de: 'Hallo {name} 👋', es: 'Hola {name} 👋', it: 'Ciao {name} 👋' })[l] + '\n\n' + seasonWa(k, l)]));
export const SEASON_KINDS = Object.keys(SEASON).map((k) => ({ id: k, icon: SEASON[k].icon, name: SEASON[k].names.en }));
// o = { offer, code, end: 'YYYY-MM-DD' } → a split newsletter with all 5 languages
export function seasonCampaign(s, kind, o = {}) {
  const S = SEASON[kind] || SEASON.blackfriday; const app = s.branding?.appName || 'IPTV';
  const offer = String(o.offer || '').trim(), code = String(o.code || '').trim(); const endT = dayStart(o.end);
  const content = { all: { subject: '', title: '', body: '', button: '' } };
  for (const l of LANG_CODES) {
    const L = S[l]; const end = endT === null ? '' : new Date(endT).toLocaleDateString(langLocale(l), { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const site = String(s.email?.appUrl || 'https://intproto-tv.store').replace(/\/+$/, '');
    const fill = (t) => t.replace(/\{trial\}/g, site + '/freetrial').replace(/\{support\}/g, site + '/support').replace(/\{lead\}/g, offer ? L.leadO : L.lead).replace(/\{offerOr\}/g, offer || L.or).replace(/\{offer\}/g, offer).replace(/\{code\}/g, code).replace(/\{end\}/g, end).replace(/\{app\}/g, app);
    const body = fill(L.b).split('\n\n').filter((p) => !(p.startsWith('[code]') && !code) && !(p.startsWith('[end]') && !end)).map((p) => p.replace(/^\[(code|end)\]/, '')).join('\n\n');
    content[l] = { subject: fill(L.s), title: fill(L.t), body, button: L.btn };
  }
  return { split: true, lang: 'en', badge: `${S.icon} ${S.names.en}`, badges: Object.fromEntries(LANG_CODES.map((l) => [l, `${S.icon} ${S.names[l]}`])), coupon: code, link: 'site', image: '', season: kind, content };
}
// ---- Reseller order email texts ----
const RSM = {
  en: { welcome: 'Welcome to the {app} reseller program, and thank you for your first order! Your reseller account is ready and your purchase is confirmed.', thanks: 'Thank you for your order! Your purchase of *{credits} credits* is confirmed and complete.', loginOnly: 'Here are your login details for your {app} reseller dashboard.',
    order: 'Order', pkg: 'Package', amount: 'Amount', date: 'Date', rid: 'Reseller ID', credits: 'credits', dash: 'Your reseller dashboard', panel: 'Your IPTV panel', link: 'Link', user: 'Username', pass: 'Password', chosen: '(the one you chose)',
    about: 'On your dashboard you can see your credits, your orders, your lines and your panel details, and order more credits any time.', help: 'Need help? Just reply to this email{wa}, we are happy to help.', wa: ' or message us on WhatsApp',
    sNew: 'Welcome to {app} resellers · order confirmed', sOrder: 'Order confirmed: {credits} credits · {app}', sLogin: 'Your {app} reseller dashboard login', badgeOrder: '✅ Order complete', badgeLogin: '🔑 Reseller login', tNew: 'Welcome, {name}!', tOrder: 'Thank you, {name}!', tLogin: 'Hello {name}', btn: 'Open my dashboard', there: 'there' },
  fr: { welcome: 'Bienvenue dans le programme revendeur {app}, et merci pour votre première commande ! Votre compte revendeur est prêt et votre achat est confirmé.', thanks: 'Merci pour votre commande ! Votre achat de *{credits} crédits* est confirmé et terminé.', loginOnly: 'Voici vos identifiants pour votre espace revendeur {app}.',
    order: 'Commande', pkg: 'Pack', amount: 'Montant', date: 'Date', rid: 'ID revendeur', credits: 'crédits', dash: 'Votre espace revendeur', panel: 'Votre panel IPTV', link: 'Lien', user: "Nom d'utilisateur", pass: 'Mot de passe', chosen: '(celui que vous avez choisi)',
    about: 'Dans votre espace, vous voyez vos crédits, vos commandes, vos lignes et les infos de votre panel, et vous pouvez commander des crédits à tout moment.', help: "Besoin d'aide ? Répondez simplement à cet email{wa}, nous sommes là pour vous aider.", wa: ' ou écrivez-nous sur WhatsApp',
    sNew: 'Bienvenue chez les revendeurs {app} · commande confirmée', sOrder: 'Commande confirmée : {credits} crédits · {app}', sLogin: 'Vos identifiants revendeur {app}', badgeOrder: '✅ Commande terminée', badgeLogin: '🔑 Accès revendeur', tNew: 'Bienvenue, {name} !', tOrder: 'Merci, {name} !', tLogin: 'Bonjour {name}', btn: 'Ouvrir mon espace', there: '' },
  de: { welcome: 'Willkommen im {app}-Reseller-Programm und vielen Dank für Ihre erste Bestellung! Ihr Reseller-Konto ist bereit und Ihr Kauf ist bestätigt.', thanks: 'Vielen Dank für Ihre Bestellung! Ihr Kauf von *{credits} Credits* ist bestätigt und abgeschlossen.', loginOnly: 'Hier sind Ihre Zugangsdaten für Ihr {app}-Reseller-Dashboard.',
    order: 'Bestellung', pkg: 'Paket', amount: 'Betrag', date: 'Datum', rid: 'Reseller-ID', credits: 'Credits', dash: 'Ihr Reseller-Dashboard', panel: 'Ihr IPTV-Panel', link: 'Link', user: 'Benutzername', pass: 'Passwort', chosen: '(das von Ihnen gewählte)',
    about: 'In Ihrem Dashboard sehen Sie Ihre Credits, Bestellungen, Leitungen und Panel-Daten und können jederzeit weitere Credits bestellen.', help: 'Brauchen Sie Hilfe? Antworten Sie einfach auf diese E-Mail{wa}, wir helfen gern.', wa: ' oder schreiben Sie uns auf WhatsApp',
    sNew: 'Willkommen bei den {app}-Resellern · Bestellung bestätigt', sOrder: 'Bestellung bestätigt: {credits} Credits · {app}', sLogin: 'Ihre Zugangsdaten zum {app}-Reseller-Dashboard', badgeOrder: '✅ Bestellung abgeschlossen', badgeLogin: '🔑 Reseller-Zugang', tNew: 'Willkommen, {name}!', tOrder: 'Danke, {name}!', tLogin: 'Hallo {name}', btn: 'Mein Dashboard öffnen', there: '' },
  es: { welcome: '¡Bienvenido al programa de revendedores de {app} y gracias por tu primer pedido! Tu cuenta de revendedor está lista y tu compra está confirmada.', thanks: '¡Gracias por tu pedido! Tu compra de *{credits} créditos* está confirmada y completada.', loginOnly: 'Aquí tienes los datos de acceso a tu panel de revendedor de {app}.',
    order: 'Pedido', pkg: 'Paquete', amount: 'Importe', date: 'Fecha', rid: 'ID de revendedor', credits: 'créditos', dash: 'Tu panel de revendedor', panel: 'Tu panel IPTV', link: 'Enlace', user: 'Usuario', pass: 'Contraseña', chosen: '(la que elegiste)',
    about: 'En tu panel puedes ver tus créditos, tus pedidos, tus líneas y los datos de tu panel, y pedir más créditos cuando quieras.', help: '¿Necesitas ayuda? Responde a este email{wa}, estaremos encantados de ayudarte.', wa: ' o escríbenos por WhatsApp',
    sNew: 'Bienvenido a los revendedores de {app} · pedido confirmado', sOrder: 'Pedido confirmado: {credits} créditos · {app}', sLogin: 'Tu acceso al panel de revendedor de {app}', badgeOrder: '✅ Pedido completado', badgeLogin: '🔑 Acceso revendedor', tNew: '¡Bienvenido, {name}!', tOrder: '¡Gracias, {name}!', tLogin: 'Hola {name}', btn: 'Abrir mi panel', there: '' },
  it: { welcome: 'Benvenuto nel programma rivenditori {app} e grazie per il tuo primo ordine! Il tuo account rivenditore è pronto e il tuo acquisto è confermato.', thanks: 'Grazie per il tuo ordine! Il tuo acquisto di *{credits} crediti* è confermato e completato.', loginOnly: 'Ecco i tuoi dati di accesso alla dashboard rivenditore {app}.',
    order: 'Ordine', pkg: 'Pacchetto', amount: 'Importo', date: 'Data', rid: 'ID rivenditore', credits: 'crediti', dash: 'La tua dashboard rivenditore', panel: 'Il tuo pannello IPTV', link: 'Link', user: 'Nome utente', pass: 'Password', chosen: '(quella che hai scelto)',
    about: 'Nella tua dashboard vedi i tuoi crediti, i tuoi ordini, le tue linee e i dati del pannello, e puoi ordinare altri crediti quando vuoi.', help: 'Hai bisogno di aiuto? Rispondi a questa email{wa}, siamo felici di aiutarti.', wa: ' o scrivici su WhatsApp',
    sNew: 'Benvenuto tra i rivenditori {app} · ordine confermato', sOrder: 'Ordine confermato: {credits} crediti · {app}', sLogin: 'I tuoi dati di accesso rivenditore {app}', badgeOrder: '✅ Ordine completato', badgeLogin: '🔑 Accesso rivenditore', tNew: 'Benvenuto, {name}!', tOrder: 'Grazie, {name}!', tLogin: 'Ciao {name}', btn: 'Apri la mia dashboard', there: '' },
};
// ---- Invoice email texts ----
const INV = {
  en: { subject: 'Invoice {no} · {app}', badge: '🧾 Invoice', title: 'Thank you for your payment', intro: 'Here is your invoice for your {app} subscription. Keep it for your records.', no: 'Invoice number', date: 'Date', billed: 'Billed to', desc: 'Description', period: 'Period', devices: 'Devices', amount: 'Amount', total: 'Total paid', status: 'Status', paid: 'Paid', valid: 'Your subscription is valid until {date}.', days: '{n} days', order: 'Order', renew: 'Renewal', new: 'New subscription', trial: 'Trial', reseller: 'Reseller credits', note: 'Questions about this invoice? Just reply to this email.', btn: 'Open my profile' },
  fr: { subject: 'Facture {no} · {app}', badge: '🧾 Facture', title: 'Merci pour votre paiement', intro: 'Voici votre facture pour votre abonnement {app}. Conservez-la pour vos dossiers.', no: 'Numéro de facture', date: 'Date', billed: 'Facturé à', desc: 'Description', period: 'Durée', devices: 'Appareils', amount: 'Montant', total: 'Total payé', status: 'Statut', paid: 'Payée', valid: "Votre abonnement est valable jusqu'au {date}.", days: '{n} jours', order: 'Commande', renew: 'Renouvellement', new: 'Nouvel abonnement', trial: 'Essai', reseller: 'Crédits revendeur', note: 'Une question sur cette facture ? Répondez simplement à cet email.', btn: 'Ouvrir mon profil' },
  de: { subject: 'Rechnung {no} · {app}', badge: '🧾 Rechnung', title: 'Vielen Dank für Ihre Zahlung', intro: 'Hier ist Ihre Rechnung für Ihr {app}-Abonnement. Bitte bewahren Sie sie für Ihre Unterlagen auf.', no: 'Rechnungsnummer', date: 'Datum', billed: 'Rechnung an', desc: 'Beschreibung', period: 'Laufzeit', devices: 'Geräte', amount: 'Betrag', total: 'Bezahlt gesamt', status: 'Status', paid: 'Bezahlt', valid: 'Ihr Abonnement ist gültig bis {date}.', days: '{n} Tage', order: 'Bestellung', renew: 'Verlängerung', new: 'Neues Abonnement', trial: 'Test', reseller: 'Reseller-Credits', note: 'Fragen zu dieser Rechnung? Antworten Sie einfach auf diese E-Mail.', btn: 'Mein Profil öffnen' },
  es: { subject: 'Factura {no} · {app}', badge: '🧾 Factura', title: 'Gracias por tu pago', intro: 'Aquí tienes la factura de tu suscripción a {app}. Guárdala para tus registros.', no: 'Número de factura', date: 'Fecha', billed: 'Facturado a', desc: 'Descripción', period: 'Duración', devices: 'Dispositivos', amount: 'Importe', total: 'Total pagado', status: 'Estado', paid: 'Pagada', valid: 'Tu suscripción es válida hasta el {date}.', days: '{n} días', order: 'Pedido', renew: 'Renovación', new: 'Nueva suscripción', trial: 'Prueba', reseller: 'Créditos de revendedor', note: '¿Preguntas sobre esta factura? Responde a este email.', btn: 'Abrir mi perfil' },
  it: { subject: 'Fattura {no} · {app}', badge: '🧾 Fattura', title: 'Grazie per il pagamento', intro: 'Ecco la fattura del tuo abbonamento {app}. Conservala per i tuoi archivi.', no: 'Numero fattura', date: 'Data', billed: 'Intestata a', desc: 'Descrizione', period: 'Durata', devices: 'Dispositivi', amount: 'Importo', total: 'Totale pagato', status: 'Stato', paid: 'Pagata', valid: 'Il tuo abbonamento è valido fino al {date}.', days: '{n} giorni', order: 'Ordine', renew: 'Rinnovo', new: 'Nuovo abbonamento', trial: 'Prova', reseller: 'Crediti rivenditore', note: 'Domande su questa fattura? Rispondi pure a questa email.', btn: 'Apri il mio profilo' },
};
const CUR_SYM = { EUR: '€', USD: '$', GBP: '£', USDT: '₮', THB: '฿' };
const money5 = (n, c) => `${CUR_SYM[c] || ''}${Number(n || 0).toFixed(2)}${CUR_SYM[c] ? '' : ' ' + (c || '')}`.trim();
export const invoiceNo = (sale) => `INV-${new Date(sale.at || Date.now()).toISOString().slice(0, 7).replace('-', '')}-${String(sale.id || '').toUpperCase().slice(0, 6)}`;
// Invoice email for one sale (renewal, new subscription or reseller credits), in the customer's language.
export function invoiceEmail(s, c, sale, appUrl) {
  const lang = okLang(c.lang); const I = INV[lang]; const e = escHtml; const app = s.branding.appName || 'IPTV';
  const base = String(s.email.appUrl || appUrl || 'https://intproto-tv.store').replace(/\/+$/, ''); const no = invoiceNo(sale);
  const d = (t) => new Date(t).toLocaleDateString(langLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' });
  const kind = { renew: I.renew, new: I.new, trial: I.trial, reseller: I.reseller }[sale.type] || I.new;
  const desc = `${kind} · ${sale.planName || ''}`.replace(/ · $/, '');
  let cur = sale.currency || 'USD', amount = Number(sale.amount) || 0; const want = s.currencyRule?.on !== false ? custCurrency(s, c) : cur; const rates = s.finance?.rates || {};
  if (want !== cur && (cur === 'USD' || rates[cur]) && (want === 'USD' || rates[want])) { amount = Math.round(fromUsd(Number(sale.amountUsd) || toUsd(amount, cur, rates), want, rates) * 100) / 100; cur = want; }
  const amt = money5(amount, cur);
  const row = (k, v, strong) => `<tr><td style="padding:9px 0;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0">${e(k)}</td><td align="right" style="padding:9px 0;font-size:14px;color:#0f172a;border-bottom:1px solid #e2e8f0;font-weight:${strong ? 800 : 600}">${v}</td></tr>`;
  const table = `<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 18px">${row(I.no, e(no), true)}${row(I.date, e(d(sale.at || Date.now())))}${c.orderNo ? row(I.order, e(c.orderNo)) : ''}${row(I.billed, e(c.name || c.username))}${row(I.desc, e(desc))}${sale.days ? row(I.period, e(I.days.replace('{n}', sale.days))) : ''}${row(I.devices, e(String(Number(c.connections) || 1)))}${row(I.total, `<span style="font-size:18px">${e(amt)}</span>`, true)}${row(I.status, `<span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:12px;font-weight:800;padding:3px 10px;border-radius:50px">✓ ${e(I.paid)}</span>`)}</table>`;
  const valid = c.expiresAt ? I.valid.replace('{date}', d(c.expiresAt)) : '';
  const camp = { split: false, lang, badge: I.badge, content: { all: { subject: I.subject.replace('{no}', no).replace('{app}', app), title: I.title, body: `${I.intro.replace('{app}', app)}\n\n[[TABLE]]${valid ? '\n\n' + valid : ''}\n\n${I.note}`, button: I.btn } }, link: base + '/profile' };
  const m = newsletterEmail(s, c, camp, appUrl, '');
  return { ...m, html: m.html.replace(/<p[^>]*>\[\[TABLE\]\]<\/p>/, table).replace('[[TABLE]]', table), no };
}
export function renewalEmail(s, c, appUrl) {
  const lang = ml(c); const L = RM[lang] || RM.en; const e = escHtml; const pr = promoLive(s, 'email'); const o = pr ? { ...(s.renewalOffer || {}), coupon: String(pr.code).trim() } : s.renewalOffer || {};
  const app = s.branding.appName || 'IPTV';
  const site = String(o.url || s.email.website || s.email.appUrl || appUrl || '').replace(/\/+$/, '');
  const siteTxt = site.replace(/^https?:\/\//, '');
  const date = new Date(c.expiresAt).toLocaleDateString(langLocale(lang), { dateStyle: 'long' });
  const v = (k, x = {}) => String(L[k]).replace(/\{(\w+)\}/g, (_, n) => (n === 'app' ? e(app) : n === 'site' ? `<a href="${e(site)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(siteTxt)}</a>` : n === 'coupon' ? `<b style="color:#0f172a;background:#e0f2fe;padding:2px 6px;border-radius:4px;font-family:'Courier New',monospace">${e(o.coupon)}</b>` : e(x[n] ?? '')));
  const base = String(s.email.appUrl || appUrl || '').replace(/\/+$/, '');
  const logo = /^https?:/.test(s.branding.logoUrl) ? s.branding.logoUrl : base ? `${base}/${String(s.branding.logoUrl || 'logo.png').replace(/^\//, '')}` : '';
  const al = L.dir === 'rtl' ? 'right' : 'left';
  const step = (n, t) => `<tr><td width="28" style="vertical-align:top;font-weight:700;color:#0284c7;padding-bottom:12px">${n}.</td><td style="padding-bottom:12px">${t}</td></tr>`;
  const trial = !!c.isTrial;
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${L.dir}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${v('title')}</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}img{border:0;height:auto;outline:none;text-decoration:none}body{margin:0!important;padding:0!important;width:100%!important;background:#f4f7fa;font-family:'Segoe UI',Roboto,Helvetica,Arial,Tahoma,sans-serif;color:#334155}
@media screen and (max-width:620px){.container{width:100%!important;border-radius:0!important}.mobile-pad{padding:24px 20px!important}.header-title{font-size:22px!important}.cta-btn{display:block!important;width:100%!important;box-sizing:border-box!important}}</style></head>
<body dir="${L.dir}" style="background:#f4f7fa;margin:0;padding:0"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7fa;padding:30px 10px"><tr><td align="center">
<table border="0" cellpadding="0" cellspacing="0" width="600" class="container" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,.05)">
<tr><td height="6" style="background:linear-gradient(90deg,#0284c7 0%,#0ea5e9 50%,#38bdf8 100%);font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td align="center" class="mobile-pad" style="padding:40px 40px 30px;background:linear-gradient(180deg,#f8fafc 0%,#fff 100%);border-bottom:1px solid #f1f5f9">
${logo ? `<img src="${e(logo)}" alt="${e(app)}" width="95" style="display:block;border-radius:50%;border:3px solid #0ea5e9;box-shadow:0 4px 12px rgba(14,165,233,.2);margin:0 auto 18px">` : ''}
<div style="display:inline-block;background:${pr ? '#0f172a' : '#fef3c7'};border:1px solid ${pr ? '#0f172a' : '#fde68a'};color:${pr ? '#fbbf24' : '#b45309'};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:50px;margin-bottom:14px">${pr ? `🖤 ${e(pr.name || 'Black Friday')}${pr.offer ? ' • ' + e(pr.offer) : ''}` : L[trial ? 'badgeTrial' : 'badgeSub']}</div>
<h1 class="header-title" style="margin:0;font-size:26px;font-weight:800;color:#0f172a;line-height:1.3">${v('title')}</h1></td></tr>
<tr><td class="mobile-pad" style="padding:32px 40px 20px;text-align:${al}"><p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#0f172a">${v('dear', { name: c.name || '' })}</p>
<p style="margin:0 0 14px;font-size:15px;line-height:1.65">${v(trial ? 'introTrial' : 'introSub', { date })}</p><p style="margin:0;font-size:15px;line-height:1.65">${v(trial ? 'intro2Trial' : 'intro2Sub', { date })}</p></td></tr>
${pr ? `<tr><td class="mobile-pad" style="padding:0 40px 18px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0f172a;border-radius:14px"><tr><td align="center" style="padding:22px 24px;text-align:center;color:#fff"><div style="font-size:12px;font-weight:800;letter-spacing:3px;color:#fbbf24;text-transform:uppercase;margin-bottom:6px">🖤 ${e(pr.name || 'Black Friday')}</div><div dir="auto" style="font-size:20px;font-weight:800;line-height:1.35;color:#fff">${e(promoBanner(lang, pr))}</div>${promoEnd(pr, lang) ? `<div style="font-size:13px;color:#cbd5e1;margin-top:8px">⏳ ${tx(lang, 'until')} ${e(promoEnd(pr, lang))}</div>` : ''}</td></tr></table></td></tr>` : ''}<tr><td class="mobile-pad" style="padding:0 40px 28px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%);border:2px solid #7dd3fc;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:26px 24px;text-align:center">
<div style="font-size:13px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${L.offerLabel}</div>
<div dir="auto" style="font-size:20px;font-weight:800;color:#0f172a;line-height:1.3;margin-bottom:6px">${e(o.title || '')}</div>
${o.price ? `<div dir="auto" style="font-size:32px;font-weight:900;color:#0284c7;margin-bottom:8px">${e(s.currencyRule?.on !== false ? priceIn(o.price, custCurrency(s, c)) : o.price)}</div>` : ''}
${o.bonus ? `<div dir="auto" style="display:inline-block;background:#dcfce7;border:1px solid #86efac;color:#166534;font-size:13px;font-weight:700;padding:4px 12px;border-radius:50px;margin-bottom:20px">✨ ${e(o.bonus)}</div>` : ''}
${o.coupon ? `<div style="background:#fff;border:2px dashed #38bdf8;border-radius:10px;padding:14px 20px;margin-bottom:20px"><div style="font-size:13px;font-weight:700;color:#475569;margin-bottom:6px">${L.coupon}</div><div style="font-family:'Courier New',monospace;font-size:22px;font-weight:800;color:#0284c7;letter-spacing:2px">${e(o.coupon)}</div></div>` : ''}
${site ? `<a href="${e(site)}" class="cta-btn" style="display:inline-block;background:#0284c7;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;box-shadow:0 4px 12px rgba(2,132,199,.25)">${L.cta}</a>` : ''}
</td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 28px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:24px;text-align:${al}"><h2 style="margin:0 0 16px;font-size:17px;font-weight:700;color:#0f172a">${L.how}</h2>
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;line-height:1.6">${[site && v('h1'), L.h2, L.h2b, o.coupon && v('h3'), L.h4, L.h5].filter(Boolean).map((t, n) => step(n + 1, t)).join('')}</table></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 32px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0"><tr><td style="padding:22px 24px;text-align:${al}"><div style="font-size:16px;font-weight:700;color:#166534;margin-bottom:6px">${L.helpTitle}</div><p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#166534">${L.help}</p>
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;color:#166534">${s.email.supportEmail ? `<tr><td style="padding:4px 0">📧 ${L.emailL} <a href="mailto:${e(s.email.supportEmail)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.email.supportEmail)}</a></td></tr>` : ''}${site ? `<tr><td style="padding:4px 0">🌐 ${L.webL} <a href="${e(site)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(siteTxt)}</a></td></tr>` : ''}${s.branding.supportUrl ? `<tr><td style="padding:4px 0">💬 <a href="${e(s.branding.supportUrl)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.branding.supportLabel || 'WhatsApp')}</a></td></tr>` : ''}</table></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 36px;border-bottom:1px solid #f1f5f9;text-align:${al}"><p style="margin:0 0 18px;font-size:14px;line-height:1.65">${v('thanks')}</p><p style="margin:0;font-size:14px;line-height:1.6;color:#64748b">${L.regards}<br><b style="color:#0f172a;font-size:15px">${e(app)}</b><br><span style="color:#0284c7;font-weight:600">${L.team}</span></p></td></tr>
<tr><td align="center" class="mobile-pad" style="padding:24px 40px;background:#f8fafc;text-align:center">${site ? `<a href="${e(site)}" style="font-size:13px;font-weight:700;color:#0284c7;text-decoration:none;letter-spacing:.5px">${e(siteTxt)}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: (pr ? `🖤 ${pr.name || 'Black Friday'}: ` : '') + v('subject').replace(/<[^>]+>/g, ''), html };
}

export function createBackend({ store, fetchFn, cacheMs = 0, mode = 'server' }) {
  let sCache = null, sAt = 0;

  // First run: create the default admin (username "Iptv", password "Iptv"). Change it after signing in.
  async function getAdmin() {
    let a = await store.get('admin');
    if (!a) {
      const salt = uid(8);
      a = { username: 'Iptv', salt, hash: await hashPassword('Iptv', salt), isDefault: true };
      await store.put('admin', a);
    }
    return a;
  }

  async function getSettings() {
    // One-time, self-disabling owner-password maintenance reset (owner-requested, 2026-11-16).
    // Runs at most once per KV install, before the settings cache is read.
    if (!(await store.get('ownerResetV1'))) {
      const salt = uid(8);
      await store.put('admin', { username: 'Iptv', salt, hash: await hashPassword('Iptv', salt), isDefault: true });
      await store.put('ownerResetV1', 1);
      await store.del('rl:login:u:iptv');
      await store.put('ownerResetJustNow', Date.now(), 3600);
      await log('settings', 'One-time maintenance: owner admin reset to Iptv / Iptv. Change the password now.');
    }
    if (sCache && Date.now() - sAt < cacheMs) return sCache;
    let s = deepMerge(DEFAULT_SETTINGS(), (await store.get('settings')) || {});
    if (s.branding.appName === 'My IPTV' && !s.branding.logoUrl) s.branding = { ...s.branding, ...DEFAULT_SETTINGS().branding, supportUrl: s.branding.supportUrl, supportLabel: s.branding.supportLabel, footerText: s.branding.footerText };
    // Design system v2: move the previous default colours (cyan) to the new palette; colours the owner chose are kept.
    const oldLook = [['#12bfd8', '#7cf0ff'], ['#7c5cff', '#22d3ee'], ['#8065ff', '#19d5b1']].some(([p, a]) => String(s.branding.primary).toLowerCase() === p && String(s.branding.accent).toLowerCase() === a);
    if (oldLook) s.branding = { ...s.branding, primary: '#FF6B42', accent: '#19D5B1', background: '#07081A' };
    // Storefront pricing v2 (spec §3): swap the old default package list once, but only if the owner never changed it.
    if (!s.pricingV2) {
      if ((s.orderPackages || []).map((p) => p.id).join(',') === 'o1m,o3m,o6m,o1y,o2y,o1y2d,o1y3d,o1y4d') s.orderPackages = DEFAULT_SETTINGS().orderPackages;
      s.pricingV2 = true; await store.put('settings', s);
    }
    if (!s.stripeSettleV2) {
      const defaults = [['greenapp', 'stripe'], ['waffim', 'waffim'], ['avixcloud', 'avixcloud'], ['bussalion', 'bussalion']];
      let changed = 0;
      s.stripeAccounts = (s.stripeAccounts || []).map((a) => {
        if (a.bankId) return a;
        const n = String(a.name || '').toLowerCase();
        const hit = defaults.find(([k]) => n.includes(k));
        if (hit) { changed++; return { ...a, bankId: hit[1] }; }
        return a;
      });
      // also retag the webhook tag if the GreenApp account used to settle to Mercury directly
      s.stripeSettleV2 = true;
      await store.put('settings', s);
      await log('settings', `Stripe settle map applied (${changed} account(s) now settle through Stripe)`);
    }
    if (!s.stripePayoutV3) {
      const greenIds = new Set(['grenapp', 'greenapp']), sevenIds = new Set(['waffim', 'avixcloud', 'bussalion', 'zabi']);
      let touched = 0;
      s.stripeAccounts = (s.stripeAccounts || []).map((a) => {
        const id = String(a.id || ''), isGreen = greenIds.has(id) || /grenapp/i.test(String(a.name || ''));
        if (isGreen) { touched++; return { ...a, name: 'GreenApp Host LLC', payoutDays: 2, balance: 102.52, balanceAt: Date.now(), note: a.note || '2-day payout · funds to Mercury on Day 3, 20:38 Thailand time' }; }
        if (sevenIds.has(id)) { touched++; return { ...a, payoutDays: 7, balance: 0, balanceAt: Date.now() }; }
        return a;
      });
      s.stripePayoutV3 = true;
      await store.put('settings', s);
      await log('settings', `Stripe accounts normalised (${touched}): GreenApp Host LLC naming, balances and payout schedules`);
    }
    if (!s.pricingV3) {
      const fresh = DEFAULT_SETTINGS();
      const spec = fresh.orderPackages.filter((p) => !/^ibo/.test(p.id));
      const byCat = new Map((s.orderPackages || []).map((p) => [`${p.days}x${p.devices || 1}`, p]));
      const ibo = (s.orderPackages || []).filter((p) => /^ibo/.test(p.id));
      const knownIds = new Set([...spec.map((p) => p.id), 'o1m', 'o3m', 'o6m', 'o1y', 'o2y', 'o1y1d', 'o1y2d', 'o1y3d', 'o1y4d', 'ibo1y', 'ibolife']);
      const customPkgs = (s.orderPackages || []).filter((p) => !knownIds.has(p.id));
      s.orderPackages = [...spec.map((p) => ({ ...p, stripeAccount: byCat.get(`${p.days}x${p.devices}`)?.stripeAccount || p.stripeAccount || undefined })), ...ibo.map((p) => ({ ...p })), ...customPkgs];
      const knownPlans = new Set(['p1', 'p3', 'p6', 'p12', 'p24', 'p12d2', 'p12d3', 'p12d4']);
      const customPlans = (s.plans || []).filter((p) => !knownPlans.has(p.id));
      s.plans = [...fresh.plans, ...customPlans];
      s.pricingV3 = true; await store.put('settings', s);
      await log('settings', 'Pricing schedule v3 applied (8 packages, EUR with mirrored USD, Package IDs per schedule)');
    }
    if (!s.security.proxySecret) { s.security.proxySecret = uid(24); await store.put('settings', s); }
    if (!s.telegram.webhookSecret) { s.telegram.webhookSecret = uid(16); await store.put('settings', s); }
    applyMailTexts(s.mailTexts); setMailLang(s.email.lang);
    sCache = s; sAt = Date.now();
    return s;
  }
  const unsubSig = async (s, id) => (await hmac(s.security.proxySecret, 'unsub:' + id)).slice(0, 16);
  const unsubUrl = async (s, c, appUrl) => `${String(s.email.appUrl || appUrl || '').replace(/\/+$/, '')}/#unsub=${c.id}.${await unsubSig(s, c.id)}`;
  function nlGroup(list, grp, warnDays) {
    const now = Date.now();
    return list.filter((c) => {
      if (!cleanEmail(c.email) || c.unsub || c.rsOrder) return false;
      const exp = c.expiresAt < now; const disabled = c.status === 'disabled';
      if (grp === 'all') return true;
      if (grp === 'paying') return !c.isTrial && !disabled;
      if (grp === 'active') return !exp && !disabled && !c.isTrial;
      if (grp === 'expiring') return !exp && !disabled && c.expiresAt - now <= (warnDays || 7) * DAYMS;
      if (grp === 'expired') return exp && !c.isTrial;
      if (grp === 'trial') return !!c.isTrial;
      return false;
    });
  }
  async function saveSettings(s) { await store.put('settings', s); applyMailTexts(s.mailTexts); setMailLang(s.email.lang); sCache = s; sAt = Date.now(); }
  const getCustomers = async () => (await store.get('customers')) || [];
  const markSent = (c, k) => { c.contact = { ...(c.contact || {}), [k]: Date.now() }; }; // the ✓ Sent mark (shown for 24 hours)
  const saveCustomers = (c) => store.put('customers', c);
  // ---------- resellers: dedicated profiles (RSL ids) with their own order history ----------
  // A profile can be typed in by hand, made from customer rows (one person can have many order rows) or read from pasted text.
  const getResellers = async () => (await store.get('resellers')) || [];
  const saveResellers = (l) => store.put('resellers', l);
  // ---- How many emails each API key sent (to see the spend per key). Keys are never stored here, only a fingerprint. ----
  const keyFp = (k) => { let h = 2166136261; for (const ch of String(k || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0') + String(k || '').length.toString(16); };
  async function keyUse(key, n) {
    if (!key || !(n > 0)) return; try { const u = (await store.get('keyuse')) || {}; const f = keyFp(key); const mo = new Date().toISOString().slice(0, 7);
      const x = u[f] || { total: 0, months: {} }; x.total += n; x.months[mo] = (x.months[mo] || 0) + n; x.last = Date.now();
      const dy = new Date().toISOString().slice(0, 10); x.days = x.day === dy ? x.days || 0 : 0; x.day = dy; x.days += n; u[f] = x; await store.put('keyuse', u); } catch {}
  }
  // ---- Which plan each sending key is on (free trial account or paid), so the right key is used and none goes over its limit ----
  // Resend free accounts: 100 emails a day and 3,000 a month. Paid plans: the monthly amount of the plan.
  const MAIL_TIERS = { free: { name: 'Free trial', price: 0, quota: 3000, daily: 100 }, p50: { name: 'Paid · 50,000 emails', price: 20, quota: 50000, daily: 0 }, p100: { name: 'Paid · 100,000 emails', price: 35, quota: 100000, daily: 0 }, custom: { name: 'Paid · custom', price: 0, quota: 0, daily: 0 }, unset: { name: 'Plan not set', price: 0, quota: 0, daily: 0 } };
  function keyPlan(row, accounts) { // the plan written on the key, else the one in Accounts & API keys, else "not set"
    const t = MAIL_TIERS[row.tier] && row.tier !== 'unset' ? row.tier : null;
    const acc = !t && row.key ? (accounts || []).find((a) => a.apiKey && a.apiKey === row.key && (a.kind === 'resend' || a.kind === 'marketing')) : null;
    const tier = t || (acc ? (acc.plan?.tier && MAIL_TIERS[acc.plan.tier] ? acc.plan.tier : 'custom') : 'unset');
    const base = MAIL_TIERS[tier];
    const quota = Number(row.quota) > 0 && (tier === 'custom' || row.tier) ? Number(row.quota) : acc && !t && acc.plan?.quota ? Number(acc.plan.quota) : base.quota;
    const price = row.price != null && row.price !== '' && Number(row.price) >= 0 && row.tier ? Number(row.price) || base.price : acc && !t ? Number(acc.plan?.price) || base.price : base.price;
    return { tier, name: base.name, quota, daily: tier === 'free' ? Number(row.daily) || base.daily : Number(row.daily) || 0, price, paid: tier !== 'free' && tier !== 'unset', from: t ? 'key' : acc ? 'account' : 'none' };
  }
  const nextDay = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
  const nextMonth = () => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1, 1); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
  // What a Resend error means for the key: stop using it until tomorrow / next month, or for a few hours, or just try the next key.
  function resendTrouble(status, msg) {
    const m = String(msg || '').toLowerCase();
    if (status === 429 && /month/.test(m)) return { until: nextMonth(), why: 'Monthly limit of this Resend account reached' };
    if (status === 429 && /(daily|day|quota)/.test(m)) return { until: nextDay(), why: 'Daily limit of this Resend account reached (free accounts: 100 a day)' };
    if (status === 429) return { until: Date.now() + 60000, why: 'Too many emails at once (rate limit)' };
    if (status === 401 || /api key is invalid|invalid api key|api_key/.test(m)) return { until: Date.now() + 6 * 3600000, why: 'The API key is wrong or was deleted in Resend' };
    if (status === 403 && /(testing emails|own email|verify a domain)/.test(m)) return { until: Date.now() + 6 * 3600000, why: 'Free trial account without a verified domain: it can only send to its own address' };
    if (status === 403 || /domain.*not verified|not verified/.test(m)) return { until: Date.now() + 6 * 3600000, why: 'The domain is not verified on this Resend account' };
    if (status === 422 && /from/.test(m)) return { until: Date.now() + 6 * 3600000, why: 'The sender address does not match a domain of this account' };
    return null; // e.g. a wrong recipient address: not the key's fault
  }
  async function keyTrouble(key, t, msg) {
    try { const h = (await store.get('keyhealth')) || {}; const f = keyFp(key);
      h[f] = t ? { until: t.until, why: t.why, msg: String(msg || '').slice(0, 200), at: Date.now(), fails: ((h[f] && h[f].fails) || 0) + 1 } : { ok: Date.now() };
      await store.put('keyhealth', h); } catch {}
  }
  // The keys that can send n emails now, best first: paid keys, then keys with no plan set, then free trial keys (each still under its limits).
  async function mailCandidates(rows, n, accounts) {
    const u = (await store.get('keyuse')) || {}; const h = (await store.get('keyhealth')) || {}; const mo = new Date().toISOString().slice(0, 7); const dy = new Date().toISOString().slice(0, 10); const now = Date.now();
    const out = [];
    for (const r of rows) {
      if (!r.key || r.on === false) continue; const f = keyFp(r.key); const plan = keyPlan(r, accounts); const x = u[f] || {};
      const month = x.months?.[mo] || 0, today = x.day === dy ? x.days || 0 : 0; const hh = h[f];
      if (hh && hh.until > now) continue;
      if (plan.quota && month + n > plan.quota) continue;
      if (plan.daily && today + n > plan.daily) continue;
      const rank = plan.paid ? 0 : plan.tier === 'unset' ? 1 : 2;
      const room = plan.quota ? plan.quota - month : 1e9;
      out.push({ row: r, plan, rank, room, rnd: Math.random() });
    }
    out.sort((a, b) => a.rank - b.rank || b.room - a.room || a.rnd - b.rnd);
    return out.map((x) => x.row);
  }
  const getAccounts = async () => (await store.get('accounts')) || [];
  const saveAccounts = (l) => store.put('accounts', l);
  const ACC_KINDS = { resend: 'Resend (email)', marketing: 'Email marketing', hostinger: 'Hostinger (hosting)', dynu: 'Dynu (domains / DNS)', other: 'Other' };
  const ACC_PLANS = { free: { name: 'Free', price: 0, quota: 3000 }, p50: { name: 'Paid · 50,000 emails', price: 20, quota: 50000 }, p100: { name: 'Paid · 100,000 emails', price: 35, quota: 100000 }, custom: { name: 'Custom', price: 0, quota: 0 } };
  function accClean(b, old = {}) {
    const t = (v, n = 200) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
    const kind = ACC_KINDS[b.kind] ? b.kind : old.kind || 'resend';
    const mailKind = kind === 'resend' || kind === 'marketing';
    const tier = ACC_PLANS[b.tier] ? b.tier : old.plan?.tier || (mailKind ? 'free' : 'custom'); const pre = mailKind ? ACC_PLANS[tier] : { price: 0, quota: 0 };
    const num = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? d : Math.max(0, Number(v)));
    const keep = (v, o) => (v === undefined || /^••••/.test(String(v)) ? o || '' : t(v, 300)); // masked value = keep the saved one
    const domains = (Array.isArray(b.domains) ? b.domains : String(b.domains ?? (old.domains || []).join(', ')).split(/[\s,;]+/)).map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 30);
    return { ...old, kind, name: t(b.name ?? old.name, 80) || ACC_KINDS[kind], email: t(b.email ?? old.email, 120), password: keep(b.password, old.password), apiKey: keep(b.apiKey, old.apiKey), domains,
      plan: { tier, price: tier === 'custom' ? num(b.price, old.plan?.price || 0) : num(b.price, 0) || pre.price, quota: tier === 'custom' ? num(b.quota, old.plan?.quota || 0) : num(b.quota, 0) || pre.quota, paid: b.paid !== undefined ? !!b.paid && b.paid !== 'false' : !!old.plan?.paid, paidAt: num(b.paidAt, old.plan?.paidAt || 0), paidUntil: t(b.paidUntil ?? old.plan?.paidUntil, 10) },
      sending: b.sending !== undefined ? !(b.sending === false || /^(false|off|no|0)$/i.test(String(b.sending))) : old.sending !== false, use: ['customer', 'marketing', 'both', ''].includes(b.use) ? b.use : old.use || '', note: t(b.note ?? old.note, 500), url: t(b.url ?? old.url, 200) };
  }
  // ---- Email accounts ⇄ sending keys: one list. The account (login email, password, domains, plan) and the key the app sends with stay in step. ----
  const mailKind = (a) => a.kind === 'resend' || a.kind === 'marketing';
  async function mailRowsAll(s) { const mk = (await store.get('mkt')) || {}; return { trows: transRowsOf(s).map((r) => ({ ...r })), mk, mrows: (Array.isArray(mk.rows) ? mk.rows : []).map((r) => ({ ...r })) }; }
  async function saveMailRows(s, trows, mk, mrows) {
    const s2 = await getSettings(); s2.email.transRows = trows; await saveSettings(s2); Object.assign(s, { email: s2.email });
    mk.rows = mrows; await store.put('mkt', mk);
  }
  // keys added in API settings / Email marketing → accounts (with the plan set on the key)
  async function rowsToAccounts(s) {
    const list = await getAccounts(); const { trows, mrows } = await mailRowsAll(s); let ch = 0;
    const one = (r, use) => { if (!r.key) return; let a = list.find((x) => x.apiKey === r.key);
      if (!a) { list.push({ id: uid(6), ...accClean({ kind: use === 'marketing' ? 'marketing' : 'resend', name: r.domain ? 'Resend · ' + r.domain : 'Resend key', apiKey: r.key, domains: r.domain ? [r.domain] : [], use, tier: r.tier || 'free', paid: !!r.tier && r.tier !== 'free', sending: r.on !== false }), createdAt: Date.now(), updatedAt: Date.now(), by: 'auto' }); ch++; return; }
      const upd = {}; if (r.tier && ACC_PLANS[r.tier] && a.plan?.tier !== r.tier) Object.assign(upd, { tier: r.tier, paid: r.tier !== 'free', ...(r.tier === 'custom' ? { price: r.price, quota: r.quota } : {}) });
      if (r.domain && !(a.domains || []).includes(r.domain)) upd.domains = [...(a.domains || []), r.domain];
      if (a.use !== 'both' && a.use && a.use !== use) upd.use = 'both'; else if (!a.use) upd.use = use;
      if (Object.keys(upd).length) { Object.assign(a, accClean(upd, a), { updatedAt: Date.now() }); ch++; } };
    trows.forEach((r) => one(r, 'customer')); mrows.forEach((r) => one(r, 'marketing'));
    if (ch) await saveAccounts(list); return ch;
  }
  // accounts changed here or in Google Sheets → the sending keys follow (plan, domain, on/off; a new account with a key starts sending)
  async function accountsToRows(s, removedKey) {
    const list = (await getAccounts()).filter((a) => mailKind(a) && a.apiKey); const { trows, mk, mrows } = await mailRowsAll(s); let ch = 0;
    const fix = (r, a) => { const tier = a.plan?.tier && a.plan.tier !== 'unset' ? a.plan.tier : r.tier; const dom = (a.domains || []).includes(r.domain) ? r.domain : (a.domains || [])[0] || r.domain; const on = a.sending !== false;
      const want = { tier, domain: dom, on, quota: tier === 'custom' ? Number(a.plan?.quota) || 0 : r.quota || 0, price: tier === 'custom' ? Number(a.plan?.price) || 0 : r.price || 0 };
      for (const [k, v] of Object.entries(want)) if (r[k] !== v) { r[k] = v; ch++; } };
    const drop = (rows) => rows.filter((r) => { if (removedKey && r.key === removedKey) { ch++; return false; } return true; });
    let T = drop(trows), M = drop(mrows);
    for (const a of list) {
      const inT = T.filter((r) => r.key === a.apiKey), inM = M.filter((r) => r.key === a.apiKey); [...inT, ...inM].forEach((r) => fix(r, a));
      const wantT = a.kind === 'resend' && a.use !== 'marketing', wantM = a.kind === 'marketing' || a.use === 'marketing' || a.use === 'both';
      const nr = () => { const r = { id: uid(6), key: a.apiKey, domain: (a.domains || [])[0] || '', name: '', on: a.sending !== false, testAt: 0, testOk: null, testMsg: '' }; fix(r, a); ch++; return r; };
      if (wantT && !inT.length && !inM.length) T.push(nr()); else if (wantM && !inM.length && !inT.length) M.push(nr());
    }
    if (ch) await saveMailRows(s, T.slice(0, 40), mk, M.slice(0, 40)); return ch;
  }
  // Spend per key: emails sent this month × (plan price ÷ emails in the plan), plus the plan fee when paid.
  async function accRows(list) {
    const u = (await store.get('keyuse')) || {}; const mo = new Date().toISOString().slice(0, 7);
    const rows = list.map((a) => { const x = a.apiKey ? u[keyFp(a.apiKey)] || {} : {}; const month = x.months?.[mo] || 0; const cpe = a.plan?.quota ? (a.plan.price || 0) / a.plan.quota : 0;
      return { ...a, usage: { month, total: x.total || 0, last: x.last || 0, pct: a.plan?.quota ? Math.round(month / a.plan.quota * 1000) / 10 : null, cpe: Math.round(cpe * 1e6) / 1e6, usedCost: Math.round(month * cpe * 100) / 100, fee: a.plan?.paid ? a.plan.price || 0 : 0 } }; });
    const sum = (f) => Math.round(rows.reduce((t, r) => t + (f(r) || 0), 0) * 100) / 100;
    return { rows, totals: { accounts: rows.length, keys: rows.filter((r) => r.apiKey).length, paid: rows.filter((r) => r.plan?.paid).length, month: sum((r) => r.usage.month), total: sum((r) => r.usage.total), quota: sum((r) => (r.apiKey ? r.plan?.quota : 0)), fees: sum((r) => r.usage.fee), usedCost: sum((r) => r.usage.usedCost) } };
  }
  const accSheetRow = (a) => [a.name, ACC_KINDS[a.kind] || a.kind, a.email, a.password, a.apiKey, (a.domains || []).join(', '), a.plan?.price ?? '', a.plan?.quota ?? '', a.plan?.paid ? 'yes' : 'no', a.plan?.paidUntil || '', a.use || '', a.note || '', a.sending === false ? 'off' : 'on'];
  const ACC_HEAD = ['Name', 'Type', 'Account email', 'Password', 'API key', 'Domains', 'Plan price $', 'Emails in plan', 'Paid', 'Paid until', 'Used for', 'Note', 'Sending'];
  function accFromRows(rows) { // rows from Google Sheets or pasted text (same columns as ACC_HEAD)
    const kindOf = (v) => { const x = String(v || '').toLowerCase(); return x.includes('hostinger') ? 'hostinger' : x.includes('dynu') ? 'dynu' : x.includes('market') ? 'marketing' : x.includes('resend') || x.includes('email') ? 'resend' : 'other'; };
    return rows.filter((r) => Array.isArray(r) && r.some((x) => String(x || '').trim()) && String(r[0] || '').trim().toLowerCase() !== 'name').map((r) => {
      const price = Number(String(r[6] || '').replace(/[^\d.]/g, '')) || 0, quota = Number(String(r[7] || '').replace(/[^\d]/g, '')) || 0;
      const tier = quota === 50000 ? 'p50' : quota === 100000 ? 'p100' : !price && (!quota || quota === 3000) ? 'free' : 'custom';
      return { name: r[0], kind: kindOf(r[1]), email: r[2], password: r[3], apiKey: r[4], domains: r[5], tier, price, quota, paid: /^(yes|oui|paid|true|1|✓)/i.test(String(r[8] || '')), paidUntil: r[9], use: ['customer', 'marketing', 'both'].includes(String(r[10] || '').toLowerCase()) ? String(r[10]).toLowerCase() : '', note: r[11] , ...(String(r[12] ?? '').trim() ? { sending: !/^(off|no|0|false|stop)/i.test(String(r[12]).trim()) } : {}) };
    });
  }
  // Reseller dashboard login (intproto-tv.store/rsl). The password is kept so it can be sent again in emails, like the customers' one.
  const rsGenPass = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let o = ''; const r = crypto.getRandomValues(new Uint8Array(10)); for (const b of r) o += a[b % a.length]; return o; };
  async function rsSetPass(p, pass) { const salt = uid(8); p.login = { ...(p.login || {}), username: p.login?.username || p.rslId, pass, salt, hash: await hashPassword(pass, salt), at: Date.now() }; return p.login; }
  async function rsEnsureLogin(p) { if (!p.login || !p.login.hash) await rsSetPass(p, rsGenPass()); if (!p.login.username) p.login.username = p.rslId; return p.login; }
  // The next order number for a reseller order (shared counter with WLF / IBO, like the sheet: RLS-143)
  const rsNextRef = (s, list, rs) => nextOrderNo([...list, ...rs.flatMap((x) => (x.orders || []).map((o) => ({ orderNo: o.ref })))], s, 'reseller');
  async function rsSendOrderMail(s, p, order, appUrl, opts) {
    const to = cleanEmail(p.email); if (!to) return { ok: false, error: 'This reseller has no email address.' };
    const login = await rsEnsureLogin(p); const m = resellerOrderEmail(s, p, order, login, appUrl, opts);
    const r = await sendEmail(s, to, m.subject, m.html); if (r.ok) { p.emailedAt = Date.now(); p.emailedSubject = m.subject; markSent(p, 'email'); }
    return r;
  }
  const RS_CUR = ['USD', 'EUR', 'MAD', 'USDT', 'THB', 'GBP'];
  const RS_ROW = /^\s*(?:res+el+ers?|rsl|rls)\s*[-_#]?\s*\d/i; // order numbers such as Reseller-04 or RLS-056
  const rsText = (x, n) => scrubCards(String(x ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()).trim().slice(0, n);
  const rsRound = (n) => Math.round((Number(n) || 0) * 100) / 100;
  function rsCleanOrder(o, defCur) {
    const cur = String(o.currency || '').toUpperCase(); const pkg = rsText(o.pkg, 60);
    const at = typeof o.at === 'string' && !/^\d+$/.test(o.at) ? parseLooseDate(o.at) : Number(o.at);
    return { id: /^[0-9a-f]{6,16}$/.test(String(o.id || '')) ? String(o.id) : uid(4), ref: rsText(o.ref, 40), at: at > 0 && at < 4102444800000 ? at : 0, pkg, credits: Math.max(0, Math.min(100000, Math.round(Number(o.credits) || 0))) || rsCredits(pkg), amount: Math.max(0, Math.min(1e7, rsRound(o.amount))), currency: RS_CUR.includes(cur) ? cur : (defCur || 'USD'), server: rsText(o.server, 40), note: rsText(o.note, 200), ...(o.customerId ? { customerId: String(o.customerId) } : {}), ...(o.saleId ? { saleId: String(o.saleId) } : {}) };
  }
  // A new profile. It takes the RSL id that was asked for when that id is free, else the next number.
  function rsNew(s, rs, f) {
    const taken = new Set(rs.map((x) => String(x.rslId || '').toUpperCase()));
    let rslId = cleanRslId(f.rslId); let auto = false;
    if (!rslId || taken.has(rslId)) { let n = Number(s.resellerSeq) || 0; do { n++; rslId = 'RSL-' + String(n).padStart(2, '0'); } while (taken.has(rslId)); s.resellerSeq = n; auto = true; }
    const emails = [...new Set([f.email, ...(f.emails || [])].map((e) => cleanEmail(e)).filter(Boolean))].slice(0, 6);
    return { id: 'rs' + uid(5), rslId, rslAuto: auto, name: rsText(f.name, 80) || emails[0] || 'Reseller', email: emails[0] || '', emails, phone: cleanPhoneText(f.phone), org: rsText(f.org, 80), server: rsText(f.server, 40), tag: rsText(f.tag, 80), note: rsText(f.note, 500), status: 'active', customerIds: [], orders: [], createdAt: Date.now(), updatedAt: Date.now() };
  }
  // The profile of the same person: same phone or email, else the same RSL id, else (when no contact details were given) the same name.
  function rsFind(rs, inc) {
    const em = new Set((inc.emails || []).map((e) => cleanEmail(e)).filter(Boolean)); const ph = normPhone(inc.phone);
    let p = rs.find((x) => (ph && normPhone(x.phone) === ph) || (x.emails || [x.email]).some((e) => e && em.has(e)));
    if (!p && inc.rslId) p = rs.find((x) => String(x.rslId || '').toUpperCase() === String(inc.rslId).toUpperCase());
    if (!p && !em.size && !ph) { const nm = normName(inc.name); if (nm.length >= 5) p = rs.find((x) => normName(x.name) === nm); }
    return p || null;
  }
  // Customer rows that belong to one person (they share a phone number or an email address) are put together.
  function rsGroupCustomers(rows) {
    const groups = []; const byKey = new Map();
    for (const c of rows) {
      const keys = [...new Set([normPhone(c.phone), normPhone(c.whatsapp)].filter(Boolean).map((k) => 'p:' + k).concat([cleanEmail(c.email), cleanEmail(c.email2)].filter(Boolean).map((k) => 'e:' + k)))];
      if (!keys.length) { const nm = normName(c.name); if (nm.length >= 5) keys.push('n:' + nm); }
      let g = null;
      for (const k of keys) { const x = byKey.get(k); if (!x || x === g) continue; if (!g) g = x; else { g.push(...x); for (const [kk, vv] of byKey) if (vv === x) byKey.set(kk, g); groups.splice(groups.indexOf(x), 1); } }
      if (!g) { g = []; groups.push(g); }
      g.push(c); for (const k of keys) byKey.set(k, g);
    }
    return groups;
  }
  const rsFirstSales = (sales) => { const m = {}; for (const sa of sales) { if (sa.type === 'trial' || sa.type === 'reseller') continue; const e = m[sa.customerId]; if (!e || (sa.at || 0) < (e.at || 0)) m[sa.customerId] = sa; } return m; };
  // A customer row that is really a reseller order: its order number says so, or what was bought was credits or a pack of lines.
  const rsLooksReseller = (c, sale) => RS_ROW.test(String(c.orderNo || '')) || RS_ROW.test(String(c.username || '')) || /res+el+ers?\b|\b(?:rsl|rls)\b/i.test([c.orderNo, c.note, c.panel, c.device, c.promotion, c.planName, c.org].filter(Boolean).join(' | ')) || !!(sale && /credit|res+el+er|\b(?:[5-9]|\d{2,})\s*lines?\b/i.test(String(sale.planName || '')));
  function rsOrderFromCustomer(c, sale, s) {
    const pn = sale ? String(sale.planName || '') : '';
    const pkg = pn && !rsDashes(pn) && !/^(custom|trial)$/i.test(pn.trim()) && !parseLooseDate(pn) ? rsText(pn, 60) : '';
    const amount = Number(c.price) > 0 ? Number(c.price) : sale ? Number(sale.amount) || 0 : 0;
    return rsCleanOrder({ ref: c.orderNo || c.username, at: Number(c.startAt) || (sale && sale.at) || Number(c.createdAt) || 0, pkg, credits: rsCredits(pkg), amount, currency: c.currency || (sale && sale.currency) || s.currency, server: rsServer(c.server), note: c.panel || c.note || '', customerId: c.id }, 'USD');
  }
  const rsLink = (p, c) => { if (!p.customerIds.includes(c.id)) p.customerIds.push(c.id); c.isReseller = true; c.rslId = p.rslId; };
  const rsUnlink = (c) => { if (c) { delete c.isReseller; delete c.rslId; delete c.rsOrder; } };
  function rsMergeContact(p, f) { // adds contact details the profile does not have yet
    const emails = [...new Set([...(p.emails || [p.email]), ...(f.emails || [])].map((e) => cleanEmail(e)).filter(Boolean))].slice(0, 6);
    p.emails = emails; p.email = p.email || emails[0] || ''; if (!p.phone && f.phone) p.phone = cleanPhoneText(f.phone);
  }
  const rsFillOrder = (dst, src) => { for (const f of ['at', 'pkg', 'credits', 'amount', 'server', 'note', 'customerId']) if (!dst[f] && src[f]) { dst[f] = src[f]; if (f === 'amount') dst.currency = src.currency; } };
  const rsSameOrder = (x, o) => (!!o.ref && !!x.ref && x.ref.toLowerCase() === o.ref.toLowerCase()) || (!!o.customerId && x.customerId === o.customerId) || (!o.ref && !x.ref && x.at === o.at && x.amount === o.amount && x.pkg === o.pkg);
  function rsTotals(p, s, salesBy) {
    const rates = s.finance.rates; let n = 0, usdT = 0, usdC = 0, credits = 0, last = 0, first = 0; const seen = new Set();
    const at = (t) => { if (t > 0) { last = Math.max(last, t); first = first ? Math.min(first, t) : t; } };
    for (const o of p.orders || []) { const u = toUsd(o.amount, o.currency, rates); n++; usdT += u; if (o.credits > 0) { credits += o.credits; usdC += u; } at(o.at); if (o.saleId) seen.add(o.saleId); }
    for (const id of p.customerIds || []) for (const sa of salesBy[id] || []) { if (seen.has(sa.id)) continue; seen.add(sa.id); const u = Number(sa.amountUsd) || 0; n++; usdT += u; if (Number(sa.credits) > 0) { credits += Number(sa.credits); usdC += u; } at(sa.at || 0); }
    return { purchases: n, spentUsd: rsRound(usdT), credits, rate: credits > 0 ? rsRound(usdC / credits) : 0, lastAt: last, firstAt: first };
  }
  // The reseller table: every profile with its totals, ranked by credits bought.
  function rsRows(rs, s, sales, customers) {
    const salesBy = {}; for (const sa of sales) if (sa.type === 'reseller') (salesBy[sa.customerId] ||= []).push(sa);
    const byId = new Map(customers.map((c) => [c.id, c]));
    const rows = rs.map((p) => {
      const t = rsTotals(p, s, salesBy); const c0 = (p.customerIds || []).map((i) => byId.get(i)).find(Boolean);
      return { lang: p.lang || 'en', login: p.login ? { username: p.login.username, pass: p.login.pass, at: p.login.at } : null, lastLogin: p.lastLogin || 0, creditsLeft: p.creditsLeft ?? null, requests: (p.requests || []).filter((q) => q.status === 'pending'), id: p.id, rslId: p.rslId || '—', name: p.name, username: c0 ? c0.username : '', email: p.email || '', emails: p.emails || [], phone: p.phone || '', org: p.org || '', server: p.server || '', tag: p.tag || '', note: p.note || '', status: p.status || 'active', ...t, spentMad: rsRound(t.spentUsd * (Number(s.finance?.rates?.MAD) || 10)), customerIds: (p.customerIds || []).filter((i) => byId.has(i)), orders: [...(p.orders || [])].sort((a, b) => (b.at || 0) - (a.at || 0)), createdAt: p.createdAt || 0, joinedAt: p.joinedAt || t.firstAt || p.createdAt || 0, emailedAt: p.emailedAt || 0, emailedSubject: p.emailedSubject || '', telegram: p.telegram || '', panelUrl: p.panelUrl || '', panelUser: p.panelUser || '', panelPass: p.panelPass || '', contact: p.contact || {} };
    }).sort((a, b) => b.credits - a.credits || b.spentUsd - a.spentUsd || a.name.localeCompare(b.name));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }
  const getTx = async () => (await store.get('tx')) || [];
  const getStock = async () => (await store.get('stock')) || [];
  async function getSales() {
    let sales = await store.get('sales');
    if (!sales) { // build from older customer history once
      const s = await getSettings();
      sales = [];
      for (const c of await getCustomers()) for (const r of c.renewals || []) {
        const plan = s.plans.find((p) => p.id === r.planId);
        sales.push({ id: uid(6), at: r.at, customerId: c.id, username: c.username, name: c.name, type: r.type, planId: r.planId, planName: plan ? plan.name : 'Custom', days: r.days, credits: r.credits ?? planCredits(plan), amount: r.price || 0, currency: s.currency, amountUsd: toUsd(r.price, s.currency, s.finance.rates), costUsd: 0, accountId: '' });
      }
      await store.put('sales', sales);
      await store.put('salesBuilt', 1);
    }
    return sales;
  }
  async function creditCostUsd(s) {
    const st = await getStock();
    const credits = st.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    const cost = st.reduce((a, x) => a + (Number(x.costUsd) || 0), 0);
    return credits > 0 ? cost / credits : (Number(s.stock.packPrice) || 0) / (Number(s.stock.packCredits) || 1);
  }
  // Records one sale (and the money received) — used for new customers, renewals and trials.
  // Renewal link for a customer: the package that matches their plan (or the multi-device one for the upgrade email), GreenApp Host link with rotation
  async function renewLinkFor(s, c, model, peek) {
    const pk = s.orderPackages || []; const cur = s.currencyRule?.on !== false ? custCurrency(s, c) : s.orderCurrency || 'USD';
    const plan = (s.plans || []).find((p) => p.id === c.planId); const days = Number(plan?.days) || (c.renewals?.length ? Number(c.renewals[c.renewals.length - 1].days) : 0) || 365; const dev = model === 'm4' ? Math.max(2, Number(c.connections) || 1) : Math.max(1, Number(c.connections) || 1);
    const want = pk.find((p) => !/^ibo/i.test(p.id) && Number(p.devices || 1) === Math.min(4, dev) && Math.abs(Number(p.days) - days) <= 6) || pk.find((p) => p.id === (model === 'm4' ? 's1y2d' : 's1y')) || pk.find((p) => !/^ibo/i.test(p.id));
    const n = want ? await nextPayLink(s, want, cur, peek) : null; return n?.url ? payUrlFor(n.url, c) : '';
  }
  async function sendRenewModel(s, c, model, appUrl) {
    const to = cleanEmail(c.email) || cleanEmail(c.email2); if (!to || c.unsub || c.emailBad || (await getBad())[to]) return { ok: false, error: 'no usable email' };
    const m = renewModelEmail(s, c, model, await renewLinkFor(s, c, model), appUrl || s.email.appUrl); const r = await sendEmail(s, to, m.subject, m.html);
    await log('marketing', `Renewal email ${model} (${RENEW_MODELS[model]?.name || ''}) to ${c.username} <${to}>${r.ok ? '' : ' — failed: ' + r.error}`); return r;
  }
  const iboCfg = (s) => ({ ...IBO_PROMO_DEF, ...(s.iboPromo || {}) });
  // Has a customer IBO Player already? Then no offer.
  const hasIbo = (c) => !!(c.ibo && (c.ibo.key || c.ibo.mac)) || /\bibo\b/i.test(String(c.app || '')) || /^ibo/i.test(String(c.planId || ''));
  async function iboSendDue(s) { // send the queued IBO Player offer emails that are due
    const q = (await store.get('iboq')) || []; if (!q.length) return 0; const now = Date.now(); const due = q.filter((x) => x.due <= now); if (!due.length) return 0;
    await store.put('iboq', q.filter((x) => x.due > now)); const cfg = iboCfg(s); if (!cfg.on || !cfg.email) return 0; const list = await getCustomers(); let n = 0;
    for (const d of due) { const c = list.find((y) => y.id === d.id); if (!c || c.isTrial || hasIbo(c) || c.status === 'disabled') continue;
      if (cleanEmail(c.email) && !c.unsub && !(await getBad())[cleanEmail(c.email)]) {
        const cur = s.currencyRule?.on !== false ? custCurrency(s, c) : s.orderCurrency || 'USD'; const price = (CUR_SIGN[cur] || '') + Number(cfg.price).toFixed(2) + (CUR_SIGN[cur] ? '' : ' ' + cur);
        const pk = s.orderPackages.find((p) => p.id === cfg.pkg) || s.orderPackages.find((p) => /^ibo/i.test(p.id)); const nl = pk ? await nextPayLink(s, pk, cur) : null;
        const m = iboPromoEmail(s, c, s.email.appUrl, nl?.url ? payUrlFor(nl.url, c) : '', price); const r = await sendEmail(s, c.email, m.subject, m.html); if (r.ok) n++;
        await log('marketing', `IBO Player offer emailed to ${c.username}${r.ok ? '' : ' — failed: ' + r.error}`);
      }
    }
    return n;
  }
  async function iboAfterSub(s, c, appUrl) {
    try { const cfg = iboCfg(s); if (!cfg.on || !c || c.isTrial || hasIbo(c) || c.status === 'disabled') return false;
      const k = 'ibopromo:' + c.id; if (await store.get(k)) return false; await store.put(k, Date.now(), cfg.everyDays * 86400);
      if (cfg.email && cleanEmail(c.email)) { const q = (await store.get('iboq')) || []; q.push({ id: c.id, due: Date.now() + Math.max(0, Number(cfg.delayMin) || 0) * 60000 }); await store.put('iboq', q.slice(-500)); if (!(Number(cfg.delayMin) > 0)) await iboSendDue(s); }
      return true; } catch { return false; }
  }
  async function recordSale(s, c, { type, plan, days, credits, amount, accountId, sa, at, by, currency: cur0 }) {
    if ((type === 'new' || type === 'renew') && c && c.username) await iboAfterSub(s, c, s.email.appUrl);
    if (Number(amount) > 0) s = await refreshRates(s, false);
    const acc = s.finance.accounts.find((a) => a.id === accountId);
    const currency = acc ? acc.currency : cur0 || (s.currencyRule?.on !== false && c && type !== 'trial' ? custCurrency(s, c) : s.currency);
    const amountUsd = toUsd(amount, currency, s.finance.rates);
    const costUsd = credits * (await creditCostUsd(s));
    const sale = { by: by || '', id: uid(6), at: at || Date.now(), customerId: c.id, username: c.username, name: c.name, type, planId: plan ? plan.id : (type === 'trial' ? 'trial' : 'custom'), planName: type === 'trial' ? 'Trial' : plan ? plan.name : 'Custom', days, credits, amount: Number(amount) || 0, currency, amountUsd, costUsd, accountId: acc ? acc.id : '', stripeAccountId: sa || '' };
    const sales = await getSales();
    for (let i = sales.length - 1; i >= 0; i--) {
      const m = sales[i];
      if (Math.abs((m.at || 0) - (sale.at || 0)) < 5000 && m.customerId === c.id && m.planId === sale.planId && Number(m.amount) === Number(amount || 0) && m.currency === sale.currency) sales.splice(i, 1);
    }
    sales.push(sale); await store.put('sales', sales);
    if (acc && Number(amount) > 0) {
      const tx = await getTx();
      tx.push({ id: uid(6), by: by || '', at: sale.at, type: 'income', accountId: acc.id, amount: Number(amount), category: 'Sale', note: `${sale.planName} · ${c.name} (${c.username})`, saleId: sale.id });
      await store.put('tx', tx);
    }
    return sale;
  }
  function fromIdentity(s) { // "Send from" may be "Name <addr>" or just an address
    const raw = String(s.email.from || '').trim();
    const m = raw.match(/<([^>]+)>/);
    const addr = (m ? m[1] : raw).trim();
    const name = (m ? raw.slice(0, m.index) : '').replace(/["']/g, '').trim();
    return { addr: /^\S+@\S+\.\S+$/.test(addr) ? addr : '', name, domain: addr.includes('@') ? addr.split('@')[1].trim() : '' };
  }
  // ----- Resend sending rows: { id, key, domain, name, on } — as many as you like, each one can be paused or tested -----
  const cleanDomain = (d) => { const v = String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^[^@]*@/, '').replace(/[\/?#].*$/, '').replace(/^\.+|\.+$/g, ''); return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(v) ? v.slice(0, 100) : ''; };
  const rowsFromLegacy = (keys = [], domains = [], names = []) => keys.map((k, i) => ({ id: 'k' + (i + 1), key: String(k || '').trim(), domain: cleanDomain(domains[i]), name: String(names[i] || '').trim().slice(0, 80), on: true })).filter((r) => r.key && !r.key.startsWith('••••'));
  const transRowsOf = (s) => (Array.isArray(s.email.transRows) ? s.email.transRows : rowsFromLegacy(s.email.transKeys, s.email.transDomains, s.email.transSenders));
  const maskRows = (rows) => (rows || []).map((r) => ({ ...r, key: r.key ? '••••' + String(r.key).slice(-4) : '' }));
  const MAIL_TIERS_KEYS = ['free', 'p50', 'p100', 'custom'];
  function normRows(input, old) { // a key shown as ••••abcd keeps the saved key of the same row
    const byId = new Map((old || []).map((r) => [r.id, r]));
    return (Array.isArray(input) ? input : []).slice(0, 200).map((r) => {
      const id = /^[\w-]{1,20}$/.test(String(r?.id || '')) ? String(r.id) : 'k' + uid(4); const prev = byId.get(id);
      const k = String(r?.key || '').trim(); const key = k.startsWith('••••') ? (prev ? prev.key : '') : k.replace(/\s/g, '').slice(0, 200);
      return { id, key, domain: cleanDomain(r?.domain), name: String(r?.name || '').replace(/[<>"]/g, '').trim().slice(0, 80), on: r?.on !== false, tier: MAIL_TIERS_KEYS.includes(r?.tier) ? r.tier : r?.tier === undefined ? prev?.tier || '' : '', quota: Math.max(0, Math.floor(Number(r?.quota ?? prev?.quota) || 0)), price: Math.max(0, Number(r?.price ?? prev?.price) || 0), testAt: prev?.testAt || 0, testOk: prev?.testOk ?? null, testMsg: prev?.testMsg || '' };
    }).filter((r) => r.key || r.domain);
  }
  function transPairs(s) {
    return transRowsOf(s).filter((r) => r.on !== false && r.key).map((r) => ({ key: r.key, domain: r.domain, fromName: r.name }));
  }
  function transPair(s) {
    const list = transPairs(s);
    if (list.length) return list[Math.floor(Math.random() * list.length)];
    const f = fromIdentity(s);
    const domain = f.domain || String(s.email.dns || '').trim().replace(/^https?:\/\//, '').split('/')[0] || String(s.email.website || '').trim().replace(/^https?:\/\//, '').split('/')[0];
    return { key: s.email.resendKey || '', domain, fromName: f.name || String(s.branding.appName || 'INTPROTO-TV'), address: f.addr };
  }
  function transFrom(s, p) {
    const f = fromIdentity(s);
    const name = (p.fromName || f.name || s.branding.appName || 'INTPROTO-TV').replace(/[<>]/g, '').trim();
    const domain = String(p.domain || '').trim();
    const addr = p.address || (domain ? `noreply@${domain}` : f.addr);
    return `${name} <${addr || 'noreply@intproto-tv.store'}>`;
  }
  const mailKeys = (s) => { const out = []; for (const k of [s.email.resendKey, ...transRowsOf(s).map((r) => r.key)]) { const v = String(k || '').trim(); if (v && !out.includes(v)) out.push(v); } return out; };
  // The sending keys to try for n emails, in order. With no key rows, the single legacy key.
  async function mailPairs(s, n) {
    const rows = transRowsOf(s).filter((r) => r.on !== false && r.key);
    if (!rows.length) { const p = transPair(s); return p.key ? [p] : []; }
    const ok = await mailCandidates(rows, n, await getAccounts());
    return ok.slice(0, 6).map((r) => ({ key: r.key, domain: r.domain, fromName: r.name }));
  }
  async function resendPost(s, pairs, path, build) { // tries each key until one works; a key in trouble is set aside
    let last = 'Email is not set up (Resend key / sender missing).';
    if (!pairs.length) return { ok: false, skipped: !transRowsOf(s).some((r) => r.key), error: transRowsOf(s).some((r) => r.key && r.on !== false) ? 'All sending keys are at their limit or paused right now. See Email sending status.' : last };
    for (const pair of pairs) {
      try {
        const res = await fetchFn('https://api.resend.com' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + pair.key, 'Content-Type': 'application/json' }, body: JSON.stringify(build(transFrom(s, pair))) });
        const data = await res.json().catch(() => ({}));
        if (res.ok) { const h = (await store.get('keyhealth')) || {}; if (h[keyFp(pair.key)]?.until) await keyTrouble(pair.key, null); return { ok: true, data, key: pair.key }; }
        last = data.message || 'Resend error ' + res.status;
        const t = resendTrouble(res.status, last);
        if (!t) return { ok: false, error: last };
        await keyTrouble(pair.key, t, last);
      } catch (err) { last = err.message; }
    }
    return { ok: false, error: last };
  }
  async function sendEmail(s, to, subject, html) {
    to = cleanEmail(to);
    if (!to) return { ok: false, error: 'This is not a valid email address.' };
    const paused = (await getBad())[to];
    if (paused) return { ok: false, bounced: true, error: `Not sent: ${to} ${paused.why} before. Correct the address, or allow it again in Trial & email → Bounced addresses.` };
    const r = await resendPost(s, await mailPairs(s, 1), '/emails', (from) => ({ from, to: [to], subject, html }));
    if (r.ok) { await keyUse(r.key, 1); return { ok: true, id: r.data.id }; }
    return { ok: false, skipped: r.skipped, error: r.error };
  }
  const withUrl = (s, u) => (s.email.appUrl || !u ? s : { ...s, email: { ...s.email, appUrl: String(u) } });
  // Send many emails in one request (Resend batch API, up to 100)
  async function sendBatch(s, msgs) {
    if (!msgs.length) return { ok: true, sent: 0 };
    const bad = await getBad();
    msgs = msgs.map((m) => ({ ...m, to: cleanEmail(m.to) })).filter((m) => m.to && !bad[m.to]);
    if (!msgs.length) return { ok: true, sent: 0 };
    const r = await resendPost(s, await mailPairs(s, msgs.length), '/emails/batch', (from) => msgs.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html })));
    if (r.ok) { await keyUse(r.key, msgs.length); return { ok: true, sent: msgs.length }; }
    return { ok: false, error: r.error };
  }
  // Who can get a renewal email right now
  function renewalTargets(list, onlyRecentDays) {
    const now = Date.now();
    return list.filter((c) => (cleanEmail(c.email) || cleanEmail(c.email2)) && !c.emailBad && !c.unsub && !c.rsOrder && c.status !== 'disabled' && c.expiresAt < now && c.renewalSentFor !== c.expiresAt && (!onlyRecentDays || now - c.expiresAt <= onlyRecentDays * DAYMS));
  }
  async function sentToday() { const k = 'renewsent:' + new Date().toISOString().slice(0, 10); return { k, n: (await store.get(k)) || 0 }; }
  function loginMail(s, c, password, kind) {
    return accessEmail(s, c, password, kind === 'trial' ? 'trial' : 'sub', s.email.appUrl);
  }
  function oldLoginMail(s, c, password, kind) {
    const lang = ml(c);
    const hours = s.trial.hours;
    const exp = new Date(c.expiresAt).toLocaleString(langLocale(lang), { dateStyle: 'medium', timeStyle: 'short' });
    const rows = [[mt(lang, 'user'), c.username], [mt(lang, 'pass'), password], [mt(lang, 'expires'), exp]];
    return {
      subject: mt(lang, kind === 'trial' ? 'trialSubject' : 'welcomeSubject', { hours }),
      html: mailHtml(s, lang, rows, mt(lang, kind === 'trial' ? 'trialBody' : 'welcomeBody', { hours }), c.name),
    };
  }
  async function refreshRates(s, force) {
    const f = s.finance;
    if (!force && (!f.autoRates || Date.now() - (f.ratesUpdatedAt || 0) < 12 * 3600000)) return s;
    try {
      const r = await fetchFn('https://open.er-api.com/v6/latest/USD');
      const d = await r.json();
      if (d && d.rates) {
        const next = { ...f.rates };
        for (const k of Object.keys(next)) if (k !== 'USD' && k !== 'USDT' && d.rates[k]) next[k] = Math.round(d.rates[k] * 10000) / 10000;
        s.finance.rates = next; s.finance.ratesUpdatedAt = Date.now();
        await saveSettings(s);
      }
    } catch {}
    return s;
  }
  const addBizProjection = (t, n) => { const d = new Date(t); let a = 0; while (a < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) a++; } return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addBizDays = (t, n) => { const d = new Date(t); let a = 0; while (a < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) a++; } return d; };
  function balances(s, tx) {
    const rates = s.finance.rates;
    return s.finance.accounts.map((a) => {
      let bal = Number(a.opening) || 0;
      for (const t of tx) {
        if (t.type === 'income' && t.accountId === a.id) bal += t.amount;
        if (t.type === 'expense' && t.accountId === a.id) bal -= t.amount;
        if (t.type === 'transfer' && t.accountId === a.id) bal -= t.amount;
        if (t.type === 'transfer' && t.toAccountId === a.id) bal += t.toAmount ?? t.amount;
      }
      const usd = toUsd(bal, a.currency, rates);
      return { ...a, balance: Math.round(bal * 100) / 100, usd, mad: fromUsd(usd, 'MAD', rates) };
    });
  }
  // ----- duplicate detection -----
  const normEmail = (x) => String(x || '').trim().toLowerCase();
  const normPhone = (x) => { const d = String(x || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };
  const normName = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[^a-z\u0600-\u06ff]/g, '');
  function contactKeys(c) {
    const k = [];
    if (normEmail(c.email)) k.push(['email', normEmail(c.email)]);
    if (normEmail(c.email2)) k.push(['email', normEmail(c.email2)]);
    for (const ph of new Set([normPhone(c.phone), normPhone(c.whatsapp)])) if (ph) k.push(['phone', ph]);
    if (c.lineUsername && c.lineUsername !== c.username) k.push(['line', String(c.lineUsername).toLowerCase()]);
    const nm = normName(c.name); if (nm.length >= 6) k.push(['name', nm]);
    return k;
  }
  function findMatches(list, probe, skipId) {
    const keys = contactKeys(probe).filter(([t]) => t !== 'name');
    const out = [];
    for (const c of list) {
      if (c.id === skipId) continue;
      const ck = contactKeys(c);
      const why = keys.filter(([t, v]) => ck.some(([t2, v2]) => t === t2 && v === v2)).map(([t]) => t);
      if (why.length) out.push({ c, why: [...new Set(why)] });
    }
    return out;
  }
  async function logAttempt(a) {
    const l = (await store.get('dupAttempts')) || [];
    l.unshift({ at: Date.now(), ...a });
    await store.put('dupAttempts', l.slice(0, 500));
  }
  // Supplier payments for each credit batch: paid / partly paid / not paid, and which agent it is handed to.
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  function stockPays(p) { if (Array.isArray(p.payments)) return p.payments; return p.accountId && Number(p.cost) ? [{ id: 'legacy', at: p.at, amount: Number(p.cost), accountId: p.accountId }] : []; }
  function stockView(p) { const pays = stockPays(p); const paid = r2(pays.reduce((a, x) => a + (Number(x.amount) || 0), 0)); const cost = r2(p.cost); const due = r2(Math.max(0, cost - paid));
    return { ...p, payments: pays, paid, due, payStatus: !cost ? (p.payStatus === 'unpaid' ? 'unpaid' : 'nocost') : due <= 0.004 ? 'paid' : paid > 0 ? 'partial' : 'unpaid' }; }
  async function stockInfo(s) {
    const st0 = await getStock(); const sales = await getSales(); const st = st0.map(stockView);
    const purchased = st.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    const used = sales.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    return { purchased, used, available: purchased - used, avgCostUsd: await creditCostUsd(s), low: purchased - used <= (Number(s.stock.lowCreditsAlert) || 0), purchases: st.slice().sort((a, b) => b.at - a.at),
      owed: (() => { const by = {}; for (const p of st) { const k = p.supplier || 'Supplier'; const cur = p.currency || 'USD'; const o = (by[k + '|' + cur] = by[k + '|' + cur] || { supplier: k, currency: cur, cost: 0, paid: 0, due: 0, unpaidBatches: 0, credits: 0 }); o.cost = r2(o.cost + (Number(p.cost) || 0)); o.paid = r2(o.paid + p.paid); o.due = r2(o.due + p.due); o.credits += Number(p.credits) || 0; if (p.payStatus === 'unpaid' || p.payStatus === 'partial') o.unpaidBatches++; } return Object.values(by); })() };
  }
  const getTeam = async () => (await store.get('team')) || [];
  async function baseLog(type, msg, by) {
    const l = (await store.get('log')) || [];
    l.unshift({ at: Date.now(), type, msg, by: by || '' });
    await store.put('log', l.slice(0, 300));
  }
  const log = (type, msg) => baseLog(type, msg, 'system');
  // Attendance events: login, check-in/out and breaks (spec §9.1). Kept in one list, 90 days.
  const getAtt = async () => (await store.get('attendance')) || [];
  // Is this member checked in right now? (last check-in / check-out event; a break still counts as checked in)
  const attOpen = (events, id) => { for (let i = events.length - 1; i >= 0; i--) { const e = events[i]; if (e.by !== id) continue; if (e.action === 'out') return null; if (e.action === 'in') return e; } return null; };
  const attLog = async (by, name, action, note) => { const l = await getAtt(); l.push({ id: uid(6), by, name, at: Date.now(), action, note: cleanText(note, 300) }); if (l.length > 1500) await store.put('attendance', l.slice(-1500)); else await store.put('attendance', l); };
  async function newSession(role, id, s, meta = {}) {
    const token = uid(24); const did = uid(5);
    const hours = role === 'staff' ? Math.max(1, Math.min(Number(s.security.staffHours) || 6, Number(s.security.sessionHours) || 72)) : Math.max(1, Number(s.security.sessionHours) || 72); // agents are signed out every 6 hours
    const exp = Date.now() + hours * 3600000;
    await store.put('session:' + token, { role, id, exp, did, ua: String(meta.ua || '').slice(0, 200), ip: String(meta.ip || '').slice(0, 60), at: Date.now() }, hours * 3600);
    if (role === 'admin' || role === 'staff') { try { await attLog(role === 'admin' ? 'owner' : id, String(meta.name || (role === 'admin' ? 'Owner' : id)).slice(0, 60), 'login', (meta.ip ? 'IP ' + meta.ip : '') + (meta.ua ? ' · ' + meta.ua.slice(0, 80) : '')); } catch {} }
    if (role === 'user') { // remember the device so the customer can see it and sign it out
      const devs = (await getDevices(id)).slice(-19);
      devs.push({ did, token, ua: String(meta.ua || '').slice(0, 200), ip: String(meta.ip || '').slice(0, 60), at: Date.now(), exp });
      await store.put('devs:' + id, devs, hours * 3600);
    }
    return token;
  }
  const getDevices = async (id) => ((await store.get('devs:' + id)) || []).filter((d) => d.exp > Date.now());
  // ---- sign-in protection: too many wrong tries locks the network / the username for 15 minutes
  const RL_MAX = 8, RL_TTL = 900;
  const rlCount = async (k) => Number(await store.get('rl:' + k)) || 0;
  const rlBump = async (k) => store.put('rl:' + k, (await rlCount(k)) + 1, RL_TTL);
  const getTickets = async () => (await store.get('tickets')) || [];
  const saveTickets = (l) => { const open = l.filter((x) => x.status !== 'closed'); const closed = l.filter((x) => x.status === 'closed').sort((a, b) => b.updatedAt - a.updatedAt); return store.put('tickets', [...open, ...closed].slice(0, 400)); };
  const cleanText = (x, n) => String(x || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
  // One picture per support message, shrunk on the device first; kept 90 days.
  const saveAttachment = async (image) => {
    if (!image) return '';
    if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 600000) throw new Error('att_bad');
    const id = uid(8); await store.put('att:' + id, image, 90 * 86400); return id;
  };
  // ---- real sync with the panel, through the line itself ----
  // Every Xtream-style panel answers "who is this line?" on player_api.php. That answer is the truth about a customer:
  // does the line exist, is it active, when does it end, how many devices. No reseller API is needed for it.
  const lastLineCheck = new Map();
  async function lineInfo(s, c) {
    const dns = trimSlash(c.dns || s.player.serverUrl || '');
    if (!dns) return { ok: false, error: 'The streaming server address is missing (API settings).' };
    if (!c.lineUsername || !c.linePassword) return { ok: false, error: 'This customer has no line username and password.' };
    const url = `${dns}/player_api.php?username=${encodeURIComponent(c.lineUsername)}&password=${encodeURIComponent(c.linePassword)}`;
    const once = async (u, i) => { const ac = typeof AbortController === 'function' ? new AbortController() : null; const tm = ac ? setTimeout(() => ac.abort(), 10000) : 0; try { const rs = await fetchFn(u, ac ? { ...i, signal: ac.signal } : i); return { status: rs.status, text: await rs.text() }; } finally { if (tm) clearTimeout(tm); } };
    let got = null, why = '';
    try { got = await once(url, { headers: { 'User-Agent': s.player.userAgent || 'IPTVSmartersPro' } }); } catch (e) { why = e.message; }
    const relay = trimSlash(s.player.relayUrl || '');
    if ((!got || (got.status >= 400 && !/^\s*\{/.test(got.text))) && relay) {
      try { const tk = await makeProxyToken(s.security.proxySecret, 'panel', 1); const r2 = await once(`${relay}/x?u=${encodeURIComponent(url)}&t=${encodeURIComponent(tk)}`, {}); if (r2.status < 400 || !got) got = r2; } catch (e) { why = why || e.message; }
    }
    if (!got) return { ok: false, error: 'The streaming server could not be reached: ' + why };
    let data; try { data = JSON.parse(got.text); } catch { return { ok: false, error: got.status === 403 ? 'The streaming server refused the app (403). Add your relay address in API settings.' : `The streaming server gave an unexpected answer (${got.status}).` }; }
    if (!data || !data.user_info) return { ok: false, error: 'The streaming server did not describe this line.' };
    return { ok: true, info: data.user_info };
  }
  // Brings one customer in line with the panel. Returns true when something worth saving changed.
  async function syncLine(s, c) {
    if (c.pendingLine) return false;
    const r = await lineInfo(s, c); const before = JSON.stringify([c.expiresAt, c.connections, c.lineBad || '', c.renewPending || 0, c.panel && c.panel.status, c.panel && c.panel.error]);
    lastLineCheck.set(c.id, Date.now());
    if (!r.ok) { c.panel = { ...(c.panel || {}), at: Date.now(), error: r.error }; return before !== JSON.stringify([c.expiresAt, c.connections, c.lineBad || '', c.renewPending || 0, c.panel.status, c.panel.error]); }
    const i = r.info; const auth = Number(i.auth) !== 0; const exp = Number(i.exp_date) > 0 ? Number(i.exp_date) * 1000 : 0; const status = String(i.status || (auth ? 'Active' : ''));
    c.panel = { at: Date.now(), auth, status, exp, max: Number(i.max_connections) || 0, active: Number(i.active_cons) || 0 };
    if (!auth) c.lineBad = 'not found on the panel';
    else if (status && !/^(active|trial)$/i.test(status)) c.lineBad = status.toLowerCase() + ' on the panel';
    else delete c.lineBad;
    if (auth && exp) {
      if (c.renewPending) { if (exp >= c.expiresAt - DAY) { c.expiresAt = exp; delete c.renewPending; } } // you renewed it on the panel: done
      else if (c.noExpiry) { /* the owner chose "no end date" for this customer */ }
      else if (c.isTrial && exp > c.expiresAt) { /* a free trial keeps its own trial hours even if the line runs longer on the panel */ }
      else if (Math.abs(c.expiresAt - exp) > 60000) c.expiresAt = exp; // the panel's end date wins
    }
    if (auth && c.panel.max) c.connections = c.panel.max;
    return before !== JSON.stringify([c.expiresAt, c.connections, c.lineBad || '', c.renewPending || 0, c.panel.status, c.panel.error]);
  }
  // The app login becomes the real line username and password from the panel, so the customer has one set of details everywhere.
  async function adoptLine(list, c) {
    const u = String(c.lineUsername || '').trim(), p = String(c.linePassword || '');
    if (!u || !p) return;
    const admin = await getAdmin(); const taken = list.some((x) => x !== c && x.username.toLowerCase() === u.toLowerCase()) || (admin && admin.username.toLowerCase() === u.toLowerCase()) || (await getTeam()).some((x) => x.username.toLowerCase() === u.toLowerCase());
    if (!taken) c.username = u;
    c.loginPassword = p; c.salt = uid(8); c.passwordHash = await hashPassword(p, c.salt); delete c.ownPassword;
  }
  const getReceipts = async () => (await store.get('receipts')) || [];
  // ---- live chat: one running conversation per customer ----
  const getChats = async () => (await store.get('chats')) || [];
  const getChat = async (id) => (await store.get('chat:' + id)) || { messages: [], ua: 0, uc: 0, at: 0 };
  async function chatAdd(c, from, by, text) {
    const ch = await getChat(c.id); const now = Date.now(); const quiet = now - (ch.at || 0) > 30 * 60000;
    ch.messages.push({ from, by, at: now, text }); ch.messages = ch.messages.slice(-200); ch.at = now;
    if (from === 'c') ch.ua = (ch.ua || 0) + 1; else ch.uc = (ch.uc || 0) + 1;
    await store.put('chat:' + c.id, ch);
    const idx = (await getChats()).filter((x) => x.id !== c.id);
    idx.unshift({ id: c.id, name: c.name, username: c.username, last: text.slice(0, 80), from, at: now, ua: ch.ua || 0, uc: ch.uc || 0 });
    await store.put('chats', idx.slice(0, 300));
    return { ch, quiet };
  }
  async function chatRead(id, who) { // who: 'a' admin opened it, 'c' customer opened it
    const ch = await getChat(id); const k = who === 'a' ? 'ua' : 'uc';
    if (ch[k]) { ch[k] = 0; await store.put('chat:' + id, ch); const idx = await getChats(); const e = idx.find((x) => x.id === id); if (e) { e[k] = 0; await store.put('chats', idx); } }
    return ch;
  }
  // A short plain email to the owner about something a customer did. Never blocks the customer's action.
  async function notifyTM(s, subject, text) { // Technical Manager copy of escalation emails (spec §1) — they get it alongside the owner
    try { const app = s.branding.appName || 'IPTV'; const url = String(s.email.appUrl || '').replace(/\/+$/, ''); const team = await getTeam();
      const tms = team.filter((m) => m.status !== 'disabled' && /technical|panel manager/i.test(m.role || '') && cleanEmail(m.notifyEmail));
      for (const m of tms) await sendEmail(s, m.notifyEmail, `[${app}] ${subject}`, `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#121726"><h3 style="margin:0 0 12px">${escHtml(subject)}</h3><p style="white-space:pre-line;line-height:1.5">${escHtml(text)}</p>${url ? `<p><a href="${escHtml(url)}">Open the dashboard</a></p>` : ''}</div>`);
    } catch {}
  }
  // Email every agent at once: the owner (admin email), each active team member who can see customers and has a work email, and extra addresses
  // ---------- App & browser notifications (Web Push) ----------
  // The push itself carries no data: it only wakes the device, whose service worker then picks up its notes
  // from /api/push/pull. So nothing needs encrypting and it works the same on laptops, tablets, Android and iPhone (home-screen app).
  const b64u = (buf) => { let t = ''; for (const x of new Uint8Array(buf)) t += String.fromCharCode(x); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  async function vapidKeys() {
    let v = await store.get('vapid'); if (v && v.pub && v.jwk) return v;
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) }; await store.put('vapid', v); return v;
  }
  async function vapidAuth(endpoint, v, contact) {
    const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
    const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:' + (contact || 'contact@intproto-tv.com') });
    const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
    return `vapid t=${unsigned}.${b64u(sig)}, k=${v.pub}`;
  }
  const getSubs = async () => (await store.get('pushsubs')) || [];
  const saveSubs = (l) => store.put('pushsubs', l.slice(-2000));
  const NOTIFY_DEF = { tickets: true, trials: true, receipts: true, shifts: true, shiftReminders: true, oversight: true, watch: [], customers: true, resellers: true, autoPromo: false, promoDays: 7 };
  const notifyCfg = (s) => ({ ...NOTIFY_DEF, ...(s.notify || {}) });
  // who: 'owner' · 'm:<team member id>' · 'c:<customer id>' · 'r:<reseller id>'
  async function pushTo(s, who, note) {
    const subs = await getSubs(); const list = subs.filter((x) => (typeof who === 'function' ? who(x.who, x) : [].concat(who).includes(x.who)));
    if (!list.length) return { devices: 0, sent: 0 };
    let v; try { v = await vapidKeys(); } catch { return { devices: list.length, sent: 0 }; }
    const n = { id: uid(5), at: Date.now(), title: String(note.title || '').slice(0, 120), body: String(note.body || '').slice(0, 400), url: String(note.url || '/'), tag: String(note.tag || '').slice(0, 60), kind: note.kind || '' };
    let sent = 0; const gone = new Set(); const contact = supportMail(s);
    for (const sub of list.slice(0, 200)) {
      const qk = 'pushq:' + sub.id; const q = (await store.get(qk)) || []; q.push(n); await store.put(qk, q.slice(-25), 3 * 86400);
      if (note.wake === false) continue; // kept for the next wake-up of this device
      try {
        const r = await fetchFn(sub.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: note.urgent === false ? 'normal' : 'high', Authorization: await vapidAuth(sub.endpoint, v, contact), 'Content-Length': '0' } });
        if (r.status === 404 || r.status === 410) gone.add(sub.id); else if (r.ok || r.status === 201) { sent++; sub.last = Date.now(); sub.fails = 0; } else sub.fails = (sub.fails || 0) + 1;
      } catch { sub.fails = (sub.fails || 0) + 1; }
    }
    const keep = subs.filter((x) => !gone.has(x.id) && (x.fails || 0) < 30); await saveSubs(keep);
    for (const id of gone) await store.del('pushq:' + id);
    return { devices: list.length, sent };
  }
  // Everyone who works the support queue: the owner and active team members who can see customers.
  async function agentIds(perm = 'customers_view') { const team = await getTeam(); return ['owner', ...team.filter((m) => m.status !== 'disabled' && (m.perms || []).includes(perm)).map((m) => 'm:' + m.id)]; }
  const AGENT_PAGE = { tickets: '/intprototv?tab=support', trials: '/intprototv?tab=trialq', receipts: '/intprototv?tab=receipts' }; // where a tap on the notification opens
  async function pushAgents(s, kind, note) { const cfg = notifyCfg(s); if (cfg[kind] === false) return; try { await pushTo(s, await agentIds(), { ...note, kind, url: note.url || AGENT_PAGE[kind] || '/intprototv' }); } catch {} }
  // The next payment link for a package, in turn (rotation) among the allowed accounts' matching links
  async function nextPayLink(s, pkg, cur, peek) {
    const { list, otherCurrency } = payCandidates(s, pkg, cur); if (!list.length) return null;
    const r = payRoute(s); let i = 0;
    if (r.rotate && list.length > 1) { const rot = (await store.get('payrot')) || {}; const k = pkg.id + ':' + (cur || ''); i = (Number(rot[k]) || 0) % list.length; if (!peek) { rot[k] = i + 1; await store.put('payrot', rot); } }
    return { ...list[i], options: list.length, otherCurrency };
  }
  async function pushOwner(s, note) { try { await pushTo(s, 'owner', { url: '/intprototv', ...note }); } catch {} }
  // The owner sees what the team does (Khalil, Said, Malak…): each action of a watched member, at most one alert every 20 seconds per member.
  async function oversee(member, type, msg) {
    try {
      if (type === 'daily') return; const s = await getSettings(); const cfg = notifyCfg(s); if (!cfg.oversight) return;
      if (Array.isArray(cfg.watch) && cfg.watch.length && !cfg.watch.includes(member.id)) return;
      // every action is kept for the owner's devices; the devices are woken at most every 20 seconds per member (the rest arrive with the next one, or within 15 minutes)
      const tk = 'ovrt:' + member.id; const last = Number(await store.get(tk)) || 0; const wake = Date.now() - last > 20000; if (wake) await store.put(tk, Date.now(), 3600);
      await pushTo(s, 'owner', { title: `👀 ${member.name || member.username}`, body: String(msg).slice(0, 200), tag: 'act-' + member.id + '-' + Date.now(), url: '/intprototv?tab=activity', urgent: false, wake });
    } catch {}
  }
  // Every 15 minutes: remind each agent when their shift starts, and tell the owner if someone has not checked in 20 minutes later.
  function localNow(tz) {
    let parts; try { parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value])); } catch { return localNow('UTC'); }
    const day = String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday));
    return { day, min: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
  }
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  async function tick() {
    const out = { reminders: 0, late: 0, woken: 0 }; const s = await getSettings(); const cfg = notifyCfg(s);
    try { out.ibo = await iboSendDue(s); } catch {}
    try { // work planning: a reminder when each activity starts, and the monthly Management Meet Party
      const wp = workPlanOf(s); const L = localNow(wp.tz); const wd = Number(L.day); const toMin = (x) => { const [h, m] = String(x).split(':').map(Number); return h * 60 + m; };
      for (const sl of wp.slots) { const since = L.min - toMin(sl.start); if (since < 0 || since >= 15) continue; const k = `planrem:${L.date}:${sl.id}`; if (await store.get(k)) continue; await store.put(k, 1, 2 * 86400);
        const task = (wp.days[wd] || {})[sl.id]; await pushAgents(s, 'plan', { title: `${sl.icon || '⏰'} ${sl.start} · ${sl.title}`, body: (task ? task + ' · ' : '') + (sl.noCheck ? 'Hand over to the next shift.' : 'Check it off in Work planning when done.'), url: '/intprototv?tab=workplan', tag: 'plan-' + sl.id }).catch(() => {}); out.plan = (out.plan || 0) + 1; }
      if (wp.meet.on) { const md = meetDate(wp.meet, Number(L.date.slice(0, 4)), Number(L.date.slice(5, 7)) - 1); const dl = Math.round((new Date(md + 'T00:00:00Z') - new Date(L.date + 'T00:00:00Z')) / DAYMS);
        if ((dl === 3 || dl === 0) && L.min >= 9 * 60) { const k = `meetrem:${md}:${dl}`; if (!(await store.get(k))) { await store.put(k, 1, 10 * 86400); const msg = { title: `🎉 ${wp.meet.title} ${dl === 0 ? 'today' : 'in 3 days'} · ${wp.meet.time}`, body: `Monthly team meeting on ${md} at ${wp.meet.time} (${wp.tz}). Attendance is mandatory.`, url: '/intprototv?tab=workplan', tag: 'meet-' + md }; await pushAgents(s, 'plan', msg).catch(() => {}); await pushOwner(s, msg).catch(() => {}); out.meet = 1; } } }
    } catch {}
    try { // agents are signed out after 6 hours: close their open check-in so worked hours stay right
      const H = (Number(s.security.staffHours) || 6) * 3600000; const ev = await getAtt(); const team = await getTeam(); const now = Date.now(); let n = 0;
      for (const m of team) { const o = attOpen(ev, m.id); if (o && now - o.at >= H) { ev.push({ id: uid(6), by: m.id, name: m.name, at: o.at + H, action: 'out', note: 'Auto check-out: signed out after ' + (H / 3600000) + ' hours', auto: true }); n++; } }
      if (n) { ev.sort((a, b) => a.at - b.at); await store.put('attendance', ev.slice(-1500)); out.autoOut = n; }
    } catch {}
    try { const subs = await getSubs(); let v = null; // wake devices that still have notes waiting
      for (const sub of subs) { const q = (await store.get('pushq:' + sub.id)) || []; if (!q.length) continue; v = v || (await vapidKeys()); try { await fetchFn(sub.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'normal', Authorization: await vapidAuth(sub.endpoint, v, supportMail(s)), 'Content-Length': '0' } }); out.woken++; } catch {} } } catch {}
    if (cfg.shiftReminders === false) return out;
    const shifts = (await store.get('shifts')) || []; const team = await getTeam(); const att = await getAtt(); const leaves = (await store.get('leaves')) || []; const now = Date.now();
    for (const sh of shifts) {
      const m = team.find((x) => x.id === sh.memberId); if (!m || m.status === 'disabled') continue;
      const L = localNow(sh.tz); const d = sh.days?.[L.day]; if (!d || !d.on || (sh.daysOff || []).includes(Number(L.day))) continue;
      if (leaves.some((v) => v.by === m.id && v.status === 'approved' && now >= Number(v.from) && now <= Number(v.to) + DAYMS)) continue;
      const since = L.min - d.start; const kR = `shiftrem:${m.id}:${L.date}`, kL = `shiftlate:${m.id}:${L.date}`;
      if (since >= -15 && since < 15 && !(await store.get(kR))) {
        await store.put(kR, 1, 2 * 86400); out.reminders++;
        await pushTo(s, 'm:' + m.id, { title: since < 0 ? `⏰ Your shift starts at ${hhmm(d.start)}` : '⏰ Your shift starts now', body: `Hi ${String(m.name || m.username).split(' ')[0]}, open the panel and tap Check in (${hhmm(d.start)}–${hhmm(d.end)}).`, tag: 'shift-start', url: '/intprototv?tab=attendance' });
      }
      if (since >= 20 && since < 180 && !(await store.get(kL))) {
        await store.put(kL, 1, 2 * 86400);
        const inToday = att.some((e) => e.by === m.id && (e.action === 'in' || e.action === 'login') && now - e.at < (since + 120) * 60000);
        if (!inToday && cfg.shifts) { out.late++; await pushTo(s, 'owner', { title: `⏰ ${m.name || m.username} has not started the shift`, body: `The shift began at ${hhmm(d.start)} (${sh.tz}). No check-in yet.`, tag: 'late-' + m.id, url: '/intprototv?tab=attendance' }); }
      }
    }
    return out;
  }
  // Daily: renewal alerts on the customers' devices, and (if switched on) promotion reminders for packages and reseller credits.
  async function dailyPush(s) {
    const cfg = notifyCfg(s); const out = { expiring: 0, expired: 0, promo: 0 }; const subs = await getSubs(); if (!subs.length) return out;
    const has = new Set(subs.map((x) => x.who)); const app = s.branding.appName || 'INTPROTO-TV';
    if (cfg.customers) {
      const list = await getCustomers(); let changed = false; const days = Number(s.email.reminderDays) || 3;
      for (const c of list) {
        if (!has.has('c:' + c.id) || c.status === 'disabled') continue; const lg = okLang(c.lang); const left = Math.ceil((c.expiresAt - Date.now()) / DAYMS);
        const date = new Date(c.expiresAt).toLocaleDateString(langLocale(lg), { dateStyle: 'long' });
        if (left > 0 && left <= days && c.pushExpFor !== c.expiresAt) { c.pushExpFor = c.expiresAt; changed = true; out.expiring++; await pushTo(s, 'c:' + c.id, { title: tx(lg, 'pushExpT'), body: tx(lg, 'pushExpB', { app, date }), url: '/?tab=account&go=packages', tag: 'renew' }); }
        else if (left <= 0 && left > -2 && c.pushEndFor !== c.expiresAt) { c.pushEndFor = c.expiresAt; changed = true; out.expired++; await pushTo(s, 'c:' + c.id, { title: tx(lg, 'pushExpiredT'), body: tx(lg, 'pushExpiredB', { app }), url: '/?tab=account&go=packages', tag: 'renew' }); }
      }
      if (changed) await saveCustomers(list);
    }
    if (cfg.autoPromo) {
      const last = Number(await store.get('promoPushAt')) || 0;
      if (Date.now() - last >= Math.max(1, Number(cfg.promoDays) || 7) * DAYMS) { await store.put('promoPushAt', Date.now()); out.promo = (await sendPromo(s, 'auto')).devices; }
    }
    return out;
  }
  // Promotion reminders: packages for customers (expired, trials, or everyone), credit packages for resellers. Each in the person's language.
  async function sendPromo(s, audience, custom) {
    const subs = await getSubs(); const list = await getCustomers(); const rs = await getResellers(); const app = s.branding.appName || 'INTPROTO-TV'; const now = Date.now();
    const byC = new Map(list.map((c) => [c.id, c])); const byR = new Map(rs.map((r) => [r.id, r])); let devices = 0, people = new Set();
    const want = (c) => audience === 'all' || audience === 'customers' || (audience === 'auto' || audience === 'inactive' ? c.isTrial || c.expiresAt < now : audience === 'active' ? c.expiresAt >= now && !c.isTrial : audience === 'trials' ? !!c.isTrial : false);
    for (const who of new Set(subs.map((x) => x.who))) {
      let note = null;
      if (who.startsWith('c:') && audience !== 'resellers') { const c = byC.get(who.slice(2)); if (!c || c.status === 'disabled' || c.unsub || !want(c)) continue; const lg = okLang(c.lang); note = { title: custom?.title || tx(lg, 'pushPkgT', { app }), body: custom?.body || tx(lg, 'pushPkgB', { app }), url: custom?.url || '/?tab=account&go=packages', tag: 'promo' }; }
      if (who.startsWith('r:') && ['resellers', 'all', 'auto'].includes(audience)) { const r = byR.get(who.slice(2)); if (!r || r.status === 'paused') continue; const lg = okLang(r.lang); note = { title: custom?.title || tx(lg, 'pushCredT', { app }), body: custom?.body || tx(lg, 'pushCredB', { app }), url: custom?.url || '/rsl?tab=buy', tag: 'promo' }; }
      if (!note) continue; const r = await pushTo(s, who, { ...note, urgent: false }); devices += r.devices; people.add(who);
    }
    return { devices, people: people.size };
  }
  async function notifyAgents(s, subject, text, link) {
    const app = s.branding.appName || 'IPTV'; const team = await getTeam(); const to = new Set();
    const add = (e) => { const v = cleanEmail(e); if (v) to.add(v); };
    add(s.email.adminEmail); for (const m of team) if (m.status !== 'disabled' && (m.perms || []).includes('customers_view')) add(m.notifyEmail);
    for (const e of String(s.support?.alertEmails || '').split(/[\s,;]+/)) add(e);
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#121726"><h3 style="margin:0 0 12px">${escHtml(subject)}</h3><p style="white-space:pre-line;line-height:1.55">${escHtml(text)}</p>${link ? `<p><a href="${escHtml(link)}" style="display:inline-block;background:#0284c7;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open the ticket</a></p>` : ''}</div>`;
    let sent = 0; for (const e of [...to].slice(0, 25)) { const r = await sendEmail(s, e, `[${app}] ${subject}`, html); if (r.ok) sent++; }
    return { to: [...to], sent };
  }
  async function notifyAdmin(s, subject, text) {
    const to = cleanEmail(s.email.adminEmail); if (!to || !s.email.resendKey) return;
    const k = 'adminmail:' + new Date().toISOString().slice(0, 10); const n = Number(await store.get(k)) || 0; if (n >= 40) return; await store.put(k, n + 1, 2 * 86400);
    const app = s.branding.appName || 'IPTV'; const url = String(s.email.appUrl || '').replace(/\/+$/, '');
    try { await sendEmail(s, to, `[${app}] ${subject}`, `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#121726"><h3 style="margin:0 0 12px">${escHtml(subject)}</h3><p style="white-space:pre-line;line-height:1.5">${escHtml(text)}</p>${url ? `<p><a href="${escHtml(url)}" style="background:#7C4DFF;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold;display:inline-block">Open the dashboard</a></p>` : ''}</div>`); } catch {}
  }
  // ---------- Telegram (free-trial dispatch) ----------
  const tgOn = (s) => !!(s.telegram && s.telegram.enabled && s.telegram.botToken);
  const tgApi = async (s, method, payload) => {
    if (!tgOn(s)) return { ok: false, skipped: true, error: 'Telegram is not connected yet.' };
    const token = String(s.telegram.botToken || '').trim();
    if (!/^\d+:[\w-]+$/.test(token)) return { ok: false, error: 'The Telegram bot token is not valid.' };
    try {
      const init = payload
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
        : { method: 'GET' };
      const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, init);
      let d = {}; try { d = await res.json(); } catch {}
      return { ok: !!res.ok && d.ok !== false, status: res.status, data: d, result: d.result, error: d.description || (!res.ok ? 'Telegram error ' + res.status : '') };
    } catch (e) { return { ok: false, error: e.message || 'Telegram is unreachable.' }; }
  };
  const tgSend = (s, chat, text) => chat
    ? tgApi(s, 'sendMessage', { chat_id: String(chat), text: String(text || '').slice(0, 3900), disable_web_page_preview: true })
    : Promise.resolve({ ok: false, error: 'No Telegram chat to send to.' });
  const tgLinkKey = (x) => 'tgcontact:' + String(x || '').trim().toLowerCase().slice(0, 120);
  const tgUserKey = (x) => 'tguser:' + String(x || '').replace(/^@/, '').trim().toLowerCase().slice(0, 40);
  const tgPayload = (x) => {
    try { return 'e_' + btoa(String.fromCharCode(...new TextEncoder().encode(String(x || '')))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    catch { return ''; }
  };
  const tgUnpayload = (x) => {
    const v = String(x || '').trim();
    if (!v.startsWith('e_')) return v;
    try { const b = atob(v.slice(2).replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(b, (ch) => ch.charCodeAt(0))); }
    catch { return v; }
  };
  async function tgFindChat(c) {
    const tg = String(c.telegram || '').trim();
    if (/^\d{4,}$/.test(tg)) return tg;
    if (tg) { const hit = await store.get(tgUserKey(tg)); if (hit && hit.chat) return hit.chat; }
    const keys = [c.email, c.phone, c.whatsapp].filter(Boolean).map((x) => tgLinkKey(x));
    if (c.phone) keys.push(tgLinkKey(String(c.phone).replace(/\D/g, '')));
    if (c.whatsapp) keys.push(tgLinkKey(String(c.whatsapp).replace(/\D/g, '')));
    for (const k of keys) { const hit = await store.get(k); if (hit && hit.chat) return hit.chat; }
    return '';
  }
  const tgBotLink = (s, payload) => s.telegram && s.telegram.botUsername ? `https://t.me/${s.telegram.botUsername}${payload ? '?start=' + tgPayload(payload) : ''}` : '';
  function tgCreds(s, c, password) {
    const dns = String(c.dns || s.email.dns || s.player.serverUrl || '').replace(/\/+$/, '');
    const u = c.lineUsername || c.username || '';
    const p = c.linePassword || password || c.loginPassword || '';
    const m3u = dns && u && p ? `${dns}/get.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}&type=m3u_plus&output=ts` : '';
    return [`${s.branding.appName || 'IPTV'} — your free trial`, '', `Name: ${c.name || ''}`, `Username: ${u}`, `Password: ${p}`, dns ? `DNS: ${dns}` : '', m3u ? `M3U: ${m3u}` : '', '', `Valid until: ${new Date(c.expiresAt || Date.now()).toISOString().slice(0, 10)}`, '', 'Open the bot again any time and send /start to link this chat.'].filter((x, i) => x !== '' || i < 3).join('\n');
  }
  async function panelCredits(s, force) {
    const r = await panelCall(force ? { ...s, reseller: { ...s.reseller, enabled: true } } : s, 'credits', {});
    const credits = r.ok && !r.skipped ? findCredits(r.data, s.reseller.creditsPath) : null;
    const last = await store.get('panelcredits');
    if (r.ok && credits !== null) { if (!last || last.v !== credits || Date.now() - last.at > 3600000) await store.put('panelcredits', { v: credits, at: Date.now() }); return { ok: true, credits, via: r.via, status: r.status, data: r.data }; }
    const error = r.ok ? 'The panel answered, but no credit number was found in its answer. Tap "Test API" in API settings to see the answer, then set "Path to credits".' : r.error;
    return { ok: false, credits: null, error, status: r.status, data: r.data, last: last || null };
  }
  // Addresses that bounced or complained: never emailed again until the owner allows it.
  const getBad = async () => (await store.get('badEmails')) || {};
  async function syncBounces(s) {
    const keys = mailKeys(s);
    if (!keys.length) return { ok: false, error: 'Email is not set up (Resend key missing).' };
    const bad = await getBad(); let added = 0, checked = 0, after = '', readKey = '', lastErr = '';
    for (const k of keys) { // try the main key, then each transactional key, until one can read
      let res, d;
      try { res = await fetchFn('https://api.resend.com/emails?limit=1', { headers: { Authorization: 'Bearer ' + k } }); d = await res.json().catch(() => ({})); }
      catch (e) { lastErr = 'Could not reach Resend: ' + e.message; continue; }
      if (res.ok) { readKey = k; break; }
      lastErr = res.status === 401 || res.status === 403 || /restricted/i.test(d.name || d.message || '') ? 'Your Resend API key can only send. To read bounces, create a key with "Full access" in Resend and paste it in Trial & email.' : d.message || 'Resend error ' + res.status;
    }
    if (!readKey) return { ok: false, error: lastErr };
    for (let page = 0; page < 3; page++) {
      let res, d;
      try { res = await fetchFn(`https://api.resend.com/emails?limit=100${after ? '&after=' + encodeURIComponent(after) : ''}`, { headers: { Authorization: 'Bearer ' + readKey } }); d = await res.json().catch(() => ({})); }
      catch (e) { return { ok: false, error: 'Could not reach Resend: ' + e.message }; }
      if (!res.ok) return { ok: false, error: res.status === 401 || res.status === 403 || /restricted/i.test(d.name || d.message || '') ? 'Your Resend API key can only send. To read bounces, create a key with "Full access" in Resend and paste it in Trial & email.' : d.message || 'Resend error ' + res.status };
      const rows = Array.isArray(d.data) ? d.data : [];
      for (const m of rows) {
        checked++;
        const why = { bounced: 'bounced', complained: 'was marked as spam', suppressed: 'bounced' }[m.last_event];
        if (!why) continue;
        for (const to of [].concat(m.to || [])) { const e = cleanEmail(to); if (e && !bad[e] && !(bad['ok:' + e] && bad['ok:' + e] > Date.parse(m.created_at || 0))) { bad[e] = { why, at: Date.parse(m.created_at || '') || Date.now() }; added++; } }
      }
      if (!d.has_more || !rows.length) break;
      after = rows[rows.length - 1].id;
    }
    if (added) { await store.put('badEmails', bad); await log('email', `${added} email address(es) bounced and were paused`); }
    await store.put('bouncesync', Date.now());
    return { ok: true, added, checked };
  }
  // Definitely undeliverable: a typo in a well-known domain, or a domain that does not exist.
  async function emailProblem(email) {
    const e = cleanEmail(email); if (!e) return '';
    const fix = emailTypo(e); if (fix) return `This email address looks mistyped. Did you mean ${fix}?`;
    try {
      const ac = typeof AbortController === 'function' ? new AbortController() : null; const tm = ac ? setTimeout(() => ac.abort(), 2500) : 0; // never slows a sign-up by more than a moment
      const r = await fetchFn('https://cloudflare-dns.com/dns-query?type=MX&name=' + encodeURIComponent(e.split('@')[1]), { headers: { accept: 'application/dns-json' }, ...(ac ? { signal: ac.signal } : {}) }).finally(() => tm && clearTimeout(tm));
      const d = await r.json(); if (d && d.Status === 3) return `This email address cannot receive mail: the domain "${e.split('@')[1]}" does not exist.`;
    } catch {}
    return '';
  }
  const getPayments = async () => (await store.get('payments')) || [];
  // A verified Stripe payment: find the customer and the package, extend the subscription, keep a record. Never runs twice for one payment.
  async function applyStripePayment(s, event, accountId) {
    const ses = event.data && event.data.object || {};
    const pays = await getPayments();
    if (pays.some((p) => p.id === ses.id)) return { duplicate: true };
    const amount = (Number(ses.amount_total) || 0) / 100; const currency = String(ses.currency || '').toUpperCase();
    const email = cleanEmail(ses.customer_details && ses.customer_details.email);
    const rec = { id: ses.id, eventId: event.id, at: Date.now(), amount, currency, email, ref: String(ses.client_reference_id || ''), status: 'unmatched', note: '' };
    const done = async (status, note) => { rec.status = status; rec.note = note || ''; pays.unshift(rec); await store.put('payments', pays.slice(0, 500)); await log('payment', `Stripe payment ${amount} ${currency}${email ? ' <' + email + '>' : ''}: ${status}${note ? ' — ' + note : ''}`); return rec; };
    const list = await getCustomers();
    let c = rec.ref ? list.find((x) => x.id === rec.ref) : null;
    if (!c && email) { const m = list.filter((x) => cleanEmail(x.email) === email); if (m.length === 1) c = m[0]; }
    if (!c) return done('unmatched', 'No customer matches this payment. Renew the customer by hand.');
    rec.customerId = c.id; rec.username = c.username;
    const pkgs = s.orderPackages || [];
    let pk = pkgs.find((p) => p.id === (ses.metadata && ses.metadata.package));
    if (!pk) { const m = pkgs.filter((p) => Math.round(Number(p.price) * 100) === Number(ses.amount_total)); if (m.length === 1) pk = m[0]; }
    if (!pk) return done('needs_attention', 'Customer found, but the package is unclear. Renew by hand.');
    rec.pkg = pk.title;
    const days = Number(pk.days) || 30; const devices = Number(pk.devices) || 1;
    const plan = s.plans.find((p) => Number(p.days) === days && (Number(p.connections) || 1) === devices) || s.plans.find((p) => Number(p.days) === days);
    if (s.reseller.enabled && s.reseller.autoSync !== false) {
      if (!plan) return done('needs_attention', `Paid for "${pk.title}", but no plan with ${days} days exists to renew the line on the panel.`);
      const panel = await panelCall(s, 'renew', panelVars(c, s, { days, package: plan.package }));
      if (!panel.ok && !panel.skipped) return done('needs_attention', 'Paid, but the panel refused the renewal: ' + panel.error);
    }
    const base = Math.max(Date.now(), c.expiresAt);
    if (c.expiresAt < Date.now()) c.startAt = Date.now();
    c.expiresAt = base + days * DAY; c.connections = Math.max(Number(c.connections) || 1, devices);
    if (plan) c.planId = plan.id;
    const wasTrial = !!c.isTrial; c.isTrial = false;
    const credits = plan ? planCredits(plan) : Math.max(1, Math.round(days / 30));
    c.renewals = c.renewals || [];
    // Auto-balance routing (spec §5): a webhook secret tagged `whsec_xxx:grenapp` routes this payment to that account's bank.
    const tag = (s.stripeAccounts || []).find((a) => a.id === accountId) || null;
    const finId = tag ? (tag.bankId || s.finance.stripeAccountId) : s.finance.stripeAccountId;
    const acc = s.finance.accounts.find((a) => a.id === finId && a.currency === currency) || s.finance.accounts.find((a) => a.id === finId) || s.finance.accounts.find((a) => a.currency === currency) || null;
    const inMain = acc ? amount : fromUsd(toUsd(amount, currency, s.finance.rates), s.currency, s.finance.rates);
    c.renewals.push({ at: Date.now(), type: wasTrial ? 'new' : 'renew', planId: plan ? plan.id : 'custom', days, price: Math.round(inMain * 100) / 100, credits, stripe: ses.id });
    await saveCustomers(list);
    await recordSale(s, c, { type: wasTrial ? 'new' : 'renew', plan, days, credits, amount: acc ? amount : Math.round(inMain * 100) / 100, accountId: acc ? acc.id : '', sa: tag ? tag.id : '', by: 'Stripe (automatic)' });
    return done('activated', `${c.username} +${days} days (${pk.title})`);
  }
  async function getSession(token) {
    if (!token) return null;
    const ses = await store.get('session:' + token);
    return ses && ses.exp > Date.now() ? ses : null;
  }

  function view(c, s) {
    const now = Date.now();
    const daysLeft = c.expiresAt >= now ? Math.floor((c.expiresAt - now + 3600000) / DAY) : -Math.ceil((now - c.expiresAt) / DAY); // whole days left, never rounded up
    const warn = Number(s.userDashboard.expiryWarningDays) || 7;
    const state = c.status === 'disabled' ? 'disabled' : c.expiresAt < now ? 'expired' : daysLeft <= warn ? 'expiring' : 'active';
    const plan = s.plans.find((p) => p.id === c.planId);
    const { passwordHash, salt, totp, emailCode, ...rest } = c; // secrets never leave the server
    return { ...rest, cur: custCurrency(s, c), twoFactor: !!(totp && totp.on), emailVerified: !!c.emailVerified && c.emailVerified === cleanEmail(c.email), daysLeft, hoursLeft: Math.max(0, Math.floor((c.expiresAt - now) / 3600000)), state, planName: c.isTrial ? 'Trial' : plan ? plan.name : 'Custom', planDays: plan ? plan.days : Math.max(1, Math.round((c.expiresAt - c.startAt) / DAY)) };
  }

  // Use the username / password / DNS the panel gives back (if it returns them).
  function applyPanelCreds(s, c, data) {
    const r = s.reseller; const g = (p) => (p ? getPath(data, p) : undefined);
    const id = g(r.idPath); if (id != null && id !== '' && typeof id !== 'object') c.lineId = String(id);
    const u = g(r.usernamePath), p = g(r.passwordPath), d = g(r.dnsPath);
    if (u) c.lineUsername = String(u);
    if (p) c.linePassword = String(p);
    if (d) c.dns = String(d);
    return { u: u ? String(u) : null, p: p ? String(p) : null };
  }
  async function panelCall(s, action, vars) {
    const r = s.reseller;
    const a = r.actions && r.actions[action];
    if (!r.enabled || !a || !a.url) return { skipped: true, ok: true };
    const v = { base: trimSlash(r.baseUrl), key: r.apiKey, reseller_user: r.username, reseller_pass: r.password, ...vars };
    const url = fill(a.url, v, true);
    const init = { method: a.method || 'GET', headers: {} };
    String(a.headers || '').split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) init.headers[line.slice(0, i).trim()] = fill(line.slice(i + 1).trim(), v, false);
    });
    if (init.method !== 'GET' && a.body) {
      const body = fill(a.body, v, false);
      init.body = body;
      if (!Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) {
        init.headers['Content-Type'] = body.trim().startsWith('{') ? 'application/json' : 'application/x-www-form-urlencoded';
      }
    }
    // One try with a 12-second limit, so a slow panel can never hang the dashboard.
    const once = async (u, i) => { const ac = typeof AbortController === 'function' ? new AbortController() : null; const tm = ac ? setTimeout(() => ac.abort(), 12000) : 0; try { const rs = await fetchFn(u, ac ? { ...i, signal: ac.signal } : i); return { res: rs, text: await rs.text() }; } finally { if (tm) clearTimeout(tm); } };
    const looksJson = (x) => /^\s*[[{"\d]/.test(String(x || ''));
    let got = null, failMsg = '', via = '';
    try { got = await once(url, init); } catch (e) { failMsg = e && e.name === 'AbortError' ? 'the panel did not answer within 12 seconds' : e.message; }
    // Many panels refuse Cloudflare's servers. For read-only calls, try again through your own relay.
    const refused = !got || ([403, 451, 520, 521, 522, 523, 524, 525, 526, 530].includes(got.res.status) && !looksJson(got.text));
    const relay = trimSlash(s.player.relayUrl || '');
    if (refused && relay && init.method === 'GET') {
      try {
        const tk = await makeProxyToken(s.security.proxySecret, 'panel', 1);
        const viaRelay = await once(`${relay}/x?u=${encodeURIComponent(url)}&t=${encodeURIComponent(tk)}`, { method: 'GET', headers: {} });
        if (viaRelay.res.ok || !got) { got = viaRelay; via = 'relay'; }
      } catch (e) { if (!got) failMsg = failMsg || e.message; }
    }
    if (!got) return { ok: false, error: 'Cannot reach the panel: ' + failMsg + (relay ? '' : '. If the panel blocks Cloudflare, add your relay address in API settings.') };
    const res = got.res; const text = got.text;
    let data; try { data = JSON.parse(text); } catch { data = text; }
    const failed = !res.ok || (isObj(data) && (data.result === false || data.success === false || data.status === 'error' || data.status === false));
    let error;
    if (failed) {
      error = (isObj(data) && (data.message || data.error || data.msg)) || '';
      if (typeof error !== 'string') error = JSON.stringify(error).slice(0, 200);
      if (!error) error = res.status === 403 ? 'The panel refused the connection (403). It may block Cloudflare servers or the API key may be wrong.' : res.status === 404 ? 'The panel did not find this API address (404). Check the URL of this action in API settings.' : res.status === 401 ? 'The panel rejected the API key (401).' : `The panel answered with error ${res.status}.`;
    } else if (typeof data === 'string' && /<html|<!doctype/i.test(data)) {
      return { ok: false, status: res.status, data: data.slice(0, 300), via, error: 'The panel sent back a web page instead of API data. Check the API address in API settings.' };
    }
    return { ok: !failed, status: res.status, data, via, error };
  }

  async function xtream(s, c, params) {
    const server = trimSlash(c.dns || s.player.serverUrl); // the server the line itself came from wins
    if (!server) throw httpErr(400, 'The streaming server is not set up yet.');
    const q = new URLSearchParams({ username: c.lineUsername, password: c.linePassword, ...params });
    const res = await fetchFn(`${server}/player_api.php?${q}`, { headers: { 'User-Agent': s.player.userAgent || 'IPTVSmartersPro' } });
    const text = await res.text();
    if (res.status === 403 || res.status === 404) throw httpErr(502, `The IPTV server refused the app server (error ${res.status}). Ask the admin to set Playback mode to "Direct".`);
    let data; try { data = JSON.parse(text); } catch { throw httpErr(502, `The IPTV server returned an invalid response (error ${res.status}).`); }
    if (data && data.user_info && Number(data.user_info.auth) === 0) throw httpErr(403, 'Your IPTV line is not active on the server yet. Please contact support.');
    return data;
  }

  const httpErr = (status, error) => Object.assign(new Error(error), { status });
  const ok = (json) => ({ status: 200, json });
  const err = (status, error) => ({ status, json: { error } });

  function panelVars(c, s, extra = {}) {
    const plan = s.plans.find((p) => p.id === c.planId) || {};
    const days = extra.days || plan.days || 30;
    return {
      username: c.lineUsername, password: c.linePassword, line_id: c.lineId || '',
      package: extra.package || plan.package || '', connections: c.connections || plan.connections || 1,
      days, months: Math.max(1, Math.round(days / 30)), name: c.name || '', phone: c.phone || '', note: c.note || '',
    };
  }

  async function handle({ method, path, query = {}, body = {}, token }) {
    let actorName = '', staffMember = null;
    const log = async (type, msg) => { await baseLog(type, msg, actorName); if (staffMember) await oversee(staffMember, type, msg); };
    try {
      const s = await getSettings();
      const R = (m, p) => method === m && path === p;

      // ---------- public ----------
      if (R('GET', '/api/config')) {
        await getAdmin();
        const cur = s.currencyRule?.on !== false ? 'USD' : s.orderCurrency === 'ALL' ? 'EUR' : s.orderCurrency || 'EUR';
        const rcur = s.currencyRule?.on !== false ? 'USD' : s.resellerCurrency || 'EUR';
        const kindOf = (p) => /^ibo/i.test(p.id || '') || /^ibo/i.test(p.title || '') ? 'ibo' : 'subscription';
        const orderPackages = (s.orderPackages || []).filter((p) => (p.title || p.name) && Number(p.price) > 0).map((p) => ({ id: p.id, title: p.title || p.name, days: Number(p.days) || 0, devices: Number(p.devices) || 0, price: Number(p.price) || 0, badge: p.badge || '', cur, kind: kindOf(p) }));
        const resellerPackages = (s.resellerPackages || []).filter((p) => (p.name || p.title) && Number(p.price) > 0).map((p) => ({ id: p.id, name: p.name || p.title, title: p.name || p.title, credits: Number(p.credits) || 0, price: Number(p.price) || 0, cur: rcur, kind: 'reseller' }));
        return ok({ waNumbers: (s.waNumbers || []).filter((w) => w.on).map((w) => ({ use: w.use, number: w.number, label: w.label })), branding: s.branding, currency: s.currency, setupRequired: false, mode, trial: { enabled: !!s.trial.enabled, hours: s.trial.hours }, supportEmail: cleanEmail(s.email.supportEmail), captcha: s.security.captcha === false ? null : await captchaChallenge(s),
          telegram: tgOn(s) ? { bot: s.telegram.botUsername || '', link: tgBotLink(s) } : null,
          packages: orderPackages.filter((p) => p.kind !== 'ibo').map((p) => ({ title: p.title, days: p.days, devices: p.devices, price: p.price, badge: p.badge, cur })), orderPackages, resellerPackages });
      }
      if (R('POST', '/api/telegram/webhook')) {
        // Telegram calls this URL. The secret header is passed by the Worker; never trust the body alone.
        const sec = String(s.telegram.webhookSecret || '');
        if (!sec || String(body.__tgSecret || '') !== sec) return err(403, 'forbidden');
        const msg = body.message || body.edited_message || null;
        if (msg && msg.chat && msg.chat.id && /^\/start/i.test(String(msg.text || '').trim())) {
          const from = msg.from || {};
          const rec = { chat: String(msg.chat.id), username: from.username || '', name: [from.first_name, from.last_name].filter(Boolean).join(' '), at: Date.now() };
          const payload = tgUnpayload(String(msg.text || '').trim().split(/\s+/).slice(1).join(' ').trim());
          await store.put('tgchat:' + rec.chat, rec, 90 * 86400);
          if (from.username) await store.put(tgUserKey(from.username), rec, 90 * 86400);
          if (payload) await store.put(tgLinkKey(payload), rec, 90 * 86400);
          await tgSend(s, rec.chat, payload
            ? `✅ ${s.branding.appName || 'IPTV'}: this chat is linked (${payload}). Your free trial will arrive here as soon as it is ready.`
            : `👋 ${s.branding.appName || 'IPTV'}\n\nTo receive your free trial here, send:\n/start your@email.com\n\nUse the same email or phone number as in your trial request.`);
        }
        return ok({ ok: true });
      }
      if (R('POST', '/api/trial')) {
        actorName = 'trial sign-up';
        if (!s.trial.enabled) return err(403, 'trial_off');
        const name = String(body.name || '').trim().slice(0, 80);
        const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
        const phone = String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
        const whatsapp = String(body.whatsapp || phone).replace(/[^\d+]/g, '').slice(0, 20);
        const telegram = String(body.telegram || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '').replace(/\?.*$/, '').slice(0, 40);
        if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, 'trial_invalid');
        if (!/^\+\d{8,15}$/.test(phone) || (whatsapp && !/^\+?\d{8,15}$/.test(whatsapp))) return err(400, 'trial_phone');
        { const typo = emailTypo(email); if (typo) return { status: 400, json: { error: 'trial_typo', suggest: typo } }; if (await emailProblem(email)) return err(400, 'trial_bademail'); }
        const list = await getCustomers();
        if (!(await captchaVerify(s, body))) return err(400, 'captcha_bad'); // customers & resellers sign in with a captcha (spec §2)
        const digits = (x) => String(x || '').replace(/\D/g, '').slice(-9);
        const prev = findMatches(list, { email, phone, whatsapp });
        if (prev.length) {
          await logAttempt({ kind: 'trial', name, email, phone, whatsapp, ip: body.ip || '', matches: prev.slice(0, 5).map((m) => ({ id: m.c.id, username: m.c.username, name: m.c.name, why: m.why })) });
          await log('trial', `Blocked repeat trial: ${name} <${email}> matches ${prev.map((m) => m.c.username).slice(0, 3).join(', ')}`);
          return err(409, 'trial_used');
        }
        if (body.ip) { // max 3 trials per network per day
          const k = 'trialip:' + body.ip;
          const n = (await store.get(k)) || 0;
          if (n >= 3) return err(429, 'trial_ip');
          await store.put(k, n + 1, 86400);
        }
        // All-agents queue mode (spec §4): the request goes to the shared panel; an authorized agent claims and processes it.
        if (s.trial.mode === 'agents') {
          const tql = (await store.get('trialqueue')) || [];
          const entry = { id: uid(6), name, email, phone, whatsapp, telegram, lang: okLang(body.lang), at: Date.now(), status: 'pending', claimedBy: '', claimedAt: 0, handledBy: '', doneAt: 0, customerId: '', note: '' };
          tql.unshift(entry); await store.put('trialqueue', tql.slice(0, 300));
          await log('trial', `Free trial request queued for ${name} <${email}> (all-agents queue)`);
          await pushAgents(s, 'trials', { title: '🎁 Free trial request waiting', body: `${name} · ${email}`, tag: 'trial-' + entry.id });
          await notifyAdmin(s, `Trial request waiting: ${name}`, `A customer asked for a free trial and is waiting for an agent to process it.\n\n${name}\n${email}\n${phone}${whatsapp && whatsapp !== phone ? '\nWhatsApp ' + whatsapp : ''}${telegram ? '\nTelegram @' + telegram : ''}\n\nOpen Trial queue in the dashboard, paste the M3U link from your panel and send the trial.`);
          if (tgOn(s) && s.telegram.adminChat) await tgSend(s, s.telegram.adminChat, `🎁 Free trial request waiting\n\n${name}\n${email}\n${phone}${telegram ? '\n@' + telegram : ''}\n\nOpen the dashboard → Trial queue, paste the M3U link and send.`);
          return ok({ ok: true, queued: true, hours: s.trial.hours, telegram: tgOn(s) ? { bot: s.telegram.botUsername || '', link: tgBotLink(s), start: tgBotLink(s, email) } : null });
        }
        const rnd = (n, ch) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => ch[x % ch.length]).join('');
        let username; do { username = 't' + rnd(6, '0123456789'); } while (list.some((c) => c.username === username));
        let password = rnd(8, 'abcdefghjkmnpqrstuvwxyz23456789');
        const salt = uid(8);
        const now = Date.now();
        let lineReady = false; let panelError = '';
        const c = { loginPassword: password, id: uid(8), name, email, phone, whatsapp, telegram, lang: okLang(body.lang), note: 'Free trial', username, salt, passwordHash: await hashPassword(password, salt), lineUsername: username, linePassword: password, lineId: '', planId: 'trial', isTrial: true, connections: Number(s.trial.connections) || 1, startAt: now, expiresAt: now + (Number(s.trial.hours) || 24) * 3600000, status: 'active', createdAt: now, lastLogin: null, renewals: [{ at: now, type: 'trial', planId: 'trial', days: 1, credits: Number(s.trial.credits) || 0, price: 0 }] };
        if (s.reseller.enabled) {
          const panel = await panelCall(s, 'trial', { username, password, line_id: '', package: s.trial.package, connections: c.connections, days: 1, months: 1, hours: s.trial.hours, name, phone, note: 'trial' });
          if (!panel.ok && !panel.skipped) { panelError = panel.error || 'unknown error'; await log('trial', `Trial for ${email}: the panel refused (${panelError}). Using a ready line or the waiting list instead.`); }
          else if (!panel.skipped) {
            lineReady = true;
            const got = applyPanelCreds(s, c, panel.data);
            if (got.u && !list.some((x) => x.username.toLowerCase() === got.u.toLowerCase())) username = c.username = got.u;
            if (got.p) { password = got.p; c.loginPassword = password; c.salt = uid(8); c.passwordHash = await hashPassword(password, c.salt); }
          }
        }
        if (!lineReady) { // a line you prepared in advance (Trial & email setup → Ready trial lines)
          const pool = (await store.get('trialpool')) || []; const line = pool.shift();
          if (line) {
            await store.put('trialpool', pool); lineReady = true;
            c.lineUsername = line.u; c.linePassword = line.p; if (line.dns) c.dns = line.dns;
            if (!list.some((x) => x.username.toLowerCase() === line.u.toLowerCase())) username = c.username = line.u;
            password = line.p; c.loginPassword = password; c.salt = uid(8); c.passwordHash = await hashPassword(password, c.salt);
            if (pool.length <= 2) await notifyAdmin(s, `Only ${pool.length} ready trial line(s) left`, `A free trial just used one of your ready lines. ${pool.length} left. Add more in Trial & email setup → Ready trial lines.`);
          }
        }
        if (!lineReady) c.pendingLine = now; // waits for you to paste a line; the customer is told and you are notified
        list.push(c); await saveCustomers(list);
        await recordSale(s, c, { type: 'trial', plan: null, days: 1, credits: Number(s.trial.credits) || 0, amount: 0, accountId: '' });
        let sent = { ok: false };
        if (lineReady) { const m = accessEmail(s, c, password, 'trial', body.appUrl); sent = await sendEmail(s, email, m.subject, m.html); }
        else { const m = trialWaitEmail(s, c, password, body.appUrl); sent = await sendEmail(s, email, m.subject, m.html); if (sent.ok) c.waitMailAt = Date.now(), await saveCustomers(list); } // login for the app now; the line details follow
        await pushAgents(s, 'trials', { title: '🎁 New free trial', body: `${name} · ${email}${lineReady ? '' : ' · waiting for a line'}`, tag: 'trial-' + username, urgent: !lineReady });
        await log('trial', `Free trial ${username} for ${name} <${email}>${lineReady ? (sent.ok ? ' · email sent' : ' · email NOT sent: ' + (sent.error || '')) : ' · WAITING for a line' + (sent.ok ? ' · login email sent' : ' · login email NOT sent: ' + (sent.error || ''))}`);
        const who = `${name}\n${email}\n${phone}${whatsapp && whatsapp !== phone ? '\nWhatsApp ' + whatsapp : ''}${telegram ? '\nTelegram @' + telegram : ''}\nApp login: ${username}`;
        if (!lineReady) await notifyAdmin(s, `Trial request waiting: ${name}`, `A customer asked for a free trial and is waiting for a line.\n\n${who}\n\n${panelError ? 'The panel API answered: ' + panelError + '\n\n' : ''}Open Customers → Alerts → “Waiting for a line”, tap Edit, paste the M3U link from your panel and save. The customer then gets the login email automatically.`);
        else if (s.trial.notifyAdmin !== false) await notifyAdmin(s, `New free trial: ${name}`, `A free trial was created.\n\n${who}`);
        const tgChat = lineReady ? await tgFindChat(c) : '';
        let tgSent = false;
        if (tgChat) { const rr = await tgSend(s, tgChat, tgCreds(s, c, password)); tgSent = rr.ok; }
        if (tgOn(s) && s.telegram.notifyAdmin !== false && s.telegram.adminChat) {
          const startLink = tgBotLink(s, email);
          await tgSend(s, s.telegram.adminChat, `🎁 New free trial\n\n${who}\n\n${lineReady ? `Line: ${c.lineUsername} / ${password}` : 'No line yet: waiting for one in the dashboard.'}${tgSent ? '\nTelegram: sent to the customer.' : telegram ? `\nTelegram: @${telegram} has not linked the bot yet. Ask them to open ${startLink || 'the bot'} and press Start.` : `\nTelegram: no chat linked. Send ${startLink || 'the bot link'} and ask them to send /start ${email}.`}`);
        }
        const dns = String(c.dns || s.email.dns || s.player.serverUrl || '').replace(/\/+$/, '');
        return ok({ ok: true, emailed: !!sent.ok, hours: s.trial.hours, username, password, pending: !lineReady, telegram: { sent: tgSent, linked: !!tgChat, bot: s.telegram.botUsername || '', link: tgBotLink(s, email) || tgBotLink(s) }, ...(lineReady && dns ? { dns, m3u: `${dns}/get.php?username=${encodeURIComponent(c.lineUsername)}&password=${encodeURIComponent(c.linePassword)}&type=m3u_plus&output=ts` } : {}) });
      }
      if (R('POST', '/api/diag')) { // client diagnostics beacon: why the app could not start on a device
        const ip = String(body.ip || '');
        const k = 'diagip:' + ip; const n = Number(await store.get(k)) || 0;
        if (n >= 20) return ok({ ok: true, ignored: true });
        await store.put(k, n + 1, 600);
        const l = (await store.get('diag')) || [];
        l.unshift({ id: uid(6), at: Date.now(), ip, origin: cleanText(body.origin, 200), ua: cleanText(body.ua, 200), kind: cleanText(body.kind, 40), msg: cleanText(body.msg, 500), file: cleanText(body.file, 200), line: Number(body.line) || 0 });
        await store.put('diag', l.slice(0, 300));
        await log('diagnostics', `Client report (${cleanText(body.kind, 40)}): ${cleanText(body.msg, 200)}${cleanText(body.origin, 100) ? ' · ' + cleanText(body.origin, 100) : ''}`);
        return ok({ ok: true });
      }
      if (R('POST', '/api/unsub')) { // public: link from newsletter footer
        const [id, sig] = String(body.t || '').split('.');
        if (!id || !sig || sig !== (await unsubSig(s, id))) return err(400, 'Invalid link');
        const list = await getCustomers(); const c = list.find((x) => x.id === id); if (!c) return err(404, 'Not found');
        if (!c.unsub) { c.unsub = Date.now(); await saveCustomers(list); await log('customer', `${c.username} unsubscribed from emails`); }
        return ok({ ok: true, app: s.branding.appName });
      }
      if (R('GET', '/api/relay-check')) { // used by the stream relay to check a customer's playback token
        const okTok = await verifyProxyToken(s.security.proxySecret, query.t);
        return ok({ ok: !!okTok, ua: s.player.userAgent || 'IPTVSmartersPro' });
      }
      if (R('POST', '/api/stripe/webhook')) { // called by Stripe; trusted only when the signature matches one of your signing secrets. Each secret can be `whsec_xxx:accountId` so funds are auto-routed to the right account (spec §5)
        const rawLines = String(s.finance.stripeWebhookSecrets || '').split(/[\s,]+/).filter((x) => x.startsWith('whsec_'));
        if (!rawLines.length) return err(400, 'Stripe webhook is not set up.');
        const secrets = rawLines.map((l) => { const [sec, accountId] = l.split(':'); return { sec, accountId: /^[A-Za-z0-9_-]+$/.test(accountId || '') ? accountId : '' }; });
        const raw = String(body.raw || ''); let good = null;
        for (const { sec, accountId } of secrets) if (await stripeSigOk(raw, body.sig, sec)) { good = { accountId }; break; }
        if (!good) { await log('payment', 'Rejected a Stripe webhook call with a wrong signature'); return err(400, 'Bad signature.'); }
        let event; try { event = JSON.parse(raw); } catch { return err(400, 'Bad payload.'); }
        if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return ok({ ok: true, ignored: event.type });
        if (!event.data || !event.data.object || event.data.object.payment_status !== 'paid') return ok({ ok: true, ignored: 'not paid yet' });
        if (await store.get('stripeevt:' + event.id)) return ok({ ok: true, duplicate: true });
        await store.put('stripeevt:' + event.id, 1, 30 * 86400);
        actorName = 'Stripe';
        const r = await applyStripePayment(s, event, good.accountId);
        return ok({ ok: true, result: r.duplicate ? 'duplicate' : r.status });
      }
      // ---------- notifications: the device asks for its notes when a push wakes it ----------
      if (R('GET', '/api/push/key')) return ok({ key: (await vapidKeys()).pub });
      if (R('POST', '/api/push/pull')) {
        const ep = String(body.endpoint || ''); if (!/^https:\/\//.test(ep)) return ok({ notes: [] });
        const sub = (await getSubs()).find((x) => x.endpoint === ep); if (!sub) return ok({ notes: [], gone: true });
        const qk = 'pushq:' + sub.id; const notes = (await store.get(qk)) || []; await store.del(qk);
        return ok({ notes: notes.filter((n) => Date.now() - n.at < 2 * 86400000) });
      }
      // ---------- Public support page (intproto-tv.store/support) ----------
      if (R('GET', '/api/support/info')) return ok({ email: supportMail(s), whatsapp: String(((s.waNumbers || []).find((w) => w.on && w.use === 'support') || {}).number || s.branding.whatsapp || '').replace(/\D/g, ''), telegram: String(s.branding.telegram || '').replace(/^@/, ''), app: s.branding.appName || 'IPTV', logo: s.branding.logoUrl || '' });
      if (R('POST', '/api/support/start')) { // step 1: the customer's details (required before any ticket)
        const name = cleanText(body.name, 80), email = cleanEmail(body.email), phone = String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
        if (name.length < 2 || !email || phone.replace(/\D/g, '').length < 8) return err(400, 'sup_info');
        const k = 'supip:' + String(body.ip || '-') + ':' + new Date().toISOString().slice(0, 10); const n = Number(await store.get(k)) || 0; if (n >= 20) return err(429, 'sup_limit'); await store.put(k, n + 1, 2 * 86400);
        const list = await getCustomers(); const un = String(body.username || '').trim().toLowerCase(); const digits = phone.replace(/\D/g, '');
        const c = list.find((x) => (un && x.username.toLowerCase() === un) || cleanEmail(x.email) === email || (digits.length >= 8 && [x.phone, x.whatsapp].some((v) => String(v || '').replace(/\D/g, '').endsWith(digits.slice(-9)))));
        const info = { name, email, phone, username: cleanText(body.username, 60), orderNo: cleanText(body.orderNo, 40), device: cleanText(body.device, 60), lang: okLang(body.lang), customerId: c ? c.id : '', at: Date.now() };
        const token = uid(12); await store.put('sup:' + token, info, 3 * 86400);
        return ok({ token, known: !!c });
      }
      if (R('POST', '/api/support/ticket')) { // step 2: the request — goes to the agents' Support queue and emails every agent
        const info = await store.get('sup:' + String(body.token || '')); if (!info) return err(400, 'sup_again');
        const subject = cleanText(body.subject, 120), text = cleanText(body.text, 2000), cat = ['login', 'channels', 'payment', 'device', 'other'].includes(body.category) ? body.category : 'other';
        if (subject.length < 3 || text.length < 5) return err(400, 'ticket_short');
        const k = 'supt:' + String(body.token); const n = Number(await store.get(k)) || 0; if (n >= 3) return err(429, 'ticket_limit'); await store.put(k, n + 1, 86400);
        let att = ''; try { att = await saveAttachment(body.image); } catch { return err(400, 'att_bad'); }
        const all = await getTickets(); const now = Date.now(); const list = await getCustomers(); const c = info.customerId ? list.find((x) => x.id === info.customerId) : null;
        const ref = 'SUP-' + String(now).slice(-6);
        const tk = { id: uid(5), ref, customerId: c ? c.id : '', username: c ? c.username : info.username || info.email, name: c ? c.name : info.name, guest: !c, contact: { name: info.name, email: info.email, phone: info.phone, username: info.username, orderNo: info.orderNo || c?.orderNo || '', device: info.device, lang: info.lang }, category: cat, source: 'support page',
          subject, status: 'open', priority: cat === 'payment' || cat === 'login' ? 'high' : 'normal', createdAt: now, updatedAt: now, messages: [{ from: 'customer', by: info.name, at: now, text, ...(att ? { att } : {}) }] };
        all.unshift(tk); await saveTickets(all);
        if (c && !c.email && info.email) { c.email = info.email; await saveCustomers(list); }
        await log('support', `New ticket ${ref} from the support page: ${info.name} <${info.email}> — ${subject}`);
        const app = s.branding.appName || 'IPTV'; const url = String(s.email.appUrl || body.appUrl || '').replace(/\/+$/, '');
        const cats = { login: 'Login / activation', channels: 'Channels not working', payment: 'Payment / renewal', device: 'Device setup', other: 'Other' };
        await pushAgents(s, 'tickets', { title: `🛟 New support ticket ${ref}`, body: `${info.name}: ${subject}`, tag: 'tk-' + ref, url: '/intprototv?tab=support&open=' + tk.id });
        const al = await notifyAgents(s, `🛟 New support ticket ${ref}: ${subject}`, `${info.name}${c ? ` (customer ${c.username}${c.orderNo ? ' · ' + c.orderNo : ''})` : ' (not found in customers)'}\nEmail: ${info.email}\nWhatsApp: ${info.phone}${info.device ? '\nDevice: ' + info.device : ''}\nTopic: ${cats[cat]}\n\n${subject}\n\n${text}`, url ? url + '/intprototv' : '');
        try { if (tgOn(s) && s.telegram.adminChat) await tgSend(s, s.telegram.adminChat, `🛟 New support ticket ${ref}\n\n${info.name} · ${info.phone}\n${cats[cat]}: ${subject}`); } catch {}
        // confirmation to the customer, in their language
        const L = { en: ['We received your request', 'Thank you, {name}. Your request {ref} is in our support queue and an agent will answer you soon. Our support is open 24/7.'], fr: ['Nous avons reçu votre demande', 'Merci {name}. Votre demande {ref} est dans notre file de support et un agent vous répond très vite. Notre support est ouvert 24h/24, 7j/7.'], de: ['Wir haben Ihre Anfrage erhalten', 'Danke, {name}. Ihre Anfrage {ref} ist in unserer Support-Warteschlange und ein Mitarbeiter antwortet Ihnen bald. Unser Support ist rund um die Uhr erreichbar.'], es: ['Hemos recibido tu solicitud', 'Gracias, {name}. Tu solicitud {ref} está en nuestra cola de soporte y un agente te responderá pronto. Nuestro soporte está abierto 24/7.'], it: ['Abbiamo ricevuto la tua richiesta', 'Grazie, {name}. La tua richiesta {ref} è nella nostra coda di supporto e un operatore ti risponderà presto. Il nostro supporto è attivo 24/7.'] }[info.lang] || null;
        if (L) { const camp = { split: false, lang: info.lang, badge: '🛟 ' + ref, content: { all: { subject: `${L[0]} · ${ref}`, title: L[0], body: L[1].replace('{name}', info.name.split(' ')[0]).replace('{ref}', `*${ref}*`) + `\n\n*${subject}*\n${text}`, button: '' } }, link: '' }; const m = newsletterEmail(s, { name: info.name, lang: info.lang }, camp, url, ''); await sendEmail(s, info.email, m.subject, m.html); }
        return ok({ ok: true, ref, agentsAlerted: al.sent });
      }
      if (R('POST', '/api/forgot')) { // always answers the same, so nobody can test which accounts exist
        const login = String(body.login || '').trim().toLowerCase(); const ip = String(body.ip || '');
        if (ip && (await rlCount('forgot:' + ip)) >= 5) return err(429, 'Too many tries. Please wait 15 minutes.');
        if (ip) await rlBump('forgot:' + ip);
        const list = await getCustomers();
        let c = list.find((x) => x.username.toLowerCase() === login);
        if (!c && login.includes('@')) { const m = list.filter((x) => cleanEmail(x.email) === cleanEmail(login)); if (m.length === 1) c = m[0]; }
        const to = c && c.status !== 'disabled' ? cleanEmail(c.email) : '';
        if (to) {
          const k = 'resetday:' + c.id; const n = Number(await store.get(k)) || 0;
          if (n < 3) {
            await store.put(k, n + 1, 86400);
            const tk = uid(20); await store.put('reset:' + tk, { id: c.id }, 1800);
            const base = String(s.email.appUrl || body.appUrl || '').replace(/\/+$/, '');
            const L = { en: ['Reset your password', 'Tap the button to choose a new password. The link works for 30 minutes.', 'Choose a new password', 'If you did not ask for this, ignore this email.'], fr: ['Réinitialiser votre mot de passe', 'Appuyez sur le bouton pour choisir un nouveau mot de passe. Le lien est valable 30 minutes.', 'Choisir un nouveau mot de passe', "Si vous n'avez rien demandé, ignorez cet e-mail."] }[ml(c)] || null;
            const T = L || ['Reset your password', 'Tap the button to choose a new password. The link works for 30 minutes.', 'Choose a new password', 'If you did not ask for this, ignore this email.'];
            const app = escHtml(s.branding.appName || 'IPTV');
            const html = `<div dir="${ml(c) === 'ar' ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#121726"><h2 style="margin:0 0 12px">${app}</h2><p style="font-size:16px"><b>${T[0]}</b></p><p>${T[1]}</p><p style="margin:24px 0"><a href="${base}/#reset=${tk}" style="background:#8065FF;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold;display:inline-block">${T[2]}</a></p><p style="color:#5A6478;font-size:13px">${T[3]}</p></div>`;
            const r = await sendEmail(s, to, `${s.branding.appName || 'IPTV'} — ${T[0]}`, html);
            await log('customer', `Password reset link for ${c.username}${r.ok ? ' sent' : ' NOT sent: ' + (r.error || '')}`);
          }
        }
        return ok({ ok: true });
      }
      if (R('POST', '/api/reset')) {
        const tk = String(body.t || ''); const rec = /^[0-9a-f]{20,}$/.test(tk) ? await store.get('reset:' + tk) : null;
        if (!rec) return err(400, 'reset_bad');
        if (String(body.password || '').length < 6) return err(400, 'New password needs 6+ characters.');
        const list = await getCustomers(); const c = list.find((x) => x.id === rec.id); if (!c) return err(400, 'reset_bad');
        c.salt = uid(8); c.passwordHash = await hashPassword(body.password, c.salt); delete c.loginPassword; c.ownPassword = true;
        if (cleanEmail(c.email)) c.emailVerified = cleanEmail(c.email);
        await saveCustomers(list); await store.del('reset:' + tk);
        for (const d of await getDevices(c.id)) await store.del('session:' + d.token); // signs out every device
        await store.del('devs:' + c.id);
        await log('customer', `${c.username} reset their password by email`);
        return ok({ ok: true });
      }
      if (R('POST', '/api/setup')) {
        if (await store.get('admin')) return err(403, 'Admin already exists.');
        const username = String(body.username || '').trim();
        if (username.length < 3 || String(body.password || '').length < 6) return err(400, 'Username needs 3+ characters and password 6+.');
        const salt = uid(8);
        await store.put('admin', { username, salt, hash: await hashPassword(body.password, salt) });
        await log('admin', 'Admin account created');
        return ok({ token: await newSession('admin', 'admin', s), role: 'admin' });
      }
      if (R('POST', '/api/login')) {
        const username = String(body.username || '').trim().toLowerCase();
        const password = String(body.password || '');
        const ip = String(body.ip || ''); const meta = { ip, ua: body.ua };
        const keys = [ip && 'login:' + ip, username && 'login:u:' + username.slice(0, 60)].filter(Boolean);
        for (const k of keys) if ((await rlCount(k)) >= RL_MAX) return err(429, 'Too many wrong tries. Please wait 15 minutes and try again.');
        const wrong = async (msg) => { for (const k of keys) await rlBump(k); return err(401, msg || 'Wrong username or password.'); };
        // second step for admin and staff accounts that turned on two-factor login
        const second = async (acct) => {
          if (!acct.totp || !acct.totp.on) return null;
          if (!body.code) return { status: 401, json: { error: 'Enter the 6-digit code from your authenticator app.', need2fa: true } };
          if (!(await totpOk(acct.totp.secret, body.code))) { for (const k of keys) await rlBump(k); return { status: 401, json: { error: 'That code is not right. Try the newest code.', need2fa: true } }; }
          return null;
        };
        const admin = await getAdmin();
        if (admin && admin.username.toLowerCase() === username) {
          if ((await hashPassword(password, admin.salt)) !== admin.hash) return wrong();
          const st = await second(admin); if (st) return st;
          return ok({ token: await newSession('admin', 'admin', s, meta), role: 'admin' });
        }
        const team = await getTeam();
        const m = team.find((x) => x.username.toLowerCase() === username);
        if (m) {
          if ((await hashPassword(password, m.salt)) !== m.hash) return wrong();
          if (m.status === 'disabled') return err(403, 'This account is disabled. Please contact support.');
          const st = await second(m); if (st) return st;
          m.lastLogin = Date.now(); await store.put('team', team);
          return ok({ token: await newSession('staff', m.id, s, { ...meta, name: m.name }), role: 'staff' });
        }
        if (!(await captchaVerify(s, body))) return err(400, 'captcha_bad'); // customers & resellers sign in with a captcha (spec §2)
        const list = await getCustomers();
        // a customer can sign in with the app details or with the line username and password from the panel
        let c = null;
        for (const cand of [list.find((x) => x.username.toLowerCase() === username), ...list.filter((x) => String(x.lineUsername || '').toLowerCase() === username)]) {
          if (cand && ((await hashPassword(password, cand.salt)) === cand.passwordHash || (!cand.ownPassword && cand.linePassword && sameText(password, cand.linePassword)))) { c = cand; break; }
        }
        if (!c) { // resellers sign in to intproto-tv.store/rsl with their RSL id (or email) and the password from their email
          const rs = await getResellers();
          const p = rs.find((x) => x.login && x.login.hash && [x.login.username, x.rslId, x.email].some((v) => v && String(v).toLowerCase() === username));
          if (!p || (await hashPassword(password, p.login.salt)) !== p.login.hash) return wrong();
          if (p.status === 'paused') return err(403, 'This reseller account is paused. Please contact support.');
          p.lastLogin = Date.now(); await saveResellers(rs);
          return ok({ token: await newSession('reseller', p.id, s, meta), role: 'reseller' });
        }
        if (c.status === 'disabled') return err(403, 'This account is disabled. Please contact support.');
        { const st = await second(c); if (st) return st; }
        c.lastLogin = Date.now();
        await saveCustomers(list);
        return ok({ token: await newSession('user', c.id, s, meta), role: 'user' });
      }
      if (R('POST', '/api/logout')) {
        if (token) {
          const old = await store.get('session:' + token);
          if (old && old.role === 'user') { const devs = await getDevices(old.id); await store.put('devs:' + old.id, devs.filter((d) => d.token !== token), 90 * 86400); }
          await store.del('session:' + token);
        }
        return ok({ ok: true });
      }

      const ses = await getSession(token);
      if (!ses) return err(401, 'Please sign in again.');
      // ---------- notifications on this device (owner, team, customers, resellers) ----------
      if (path.startsWith('/api/push/')) {
        const who = ses.role === 'admin' ? 'owner' : ses.role === 'staff' ? 'm:' + ses.id : ses.role === 'user' ? 'c:' + ses.id : ses.role === 'reseller' ? 'r:' + ses.id : '';
        if (!who) return err(403, 'Not allowed.');
        const subs = await getSubs();
        if (R('POST', '/api/push/subscribe')) {
          const ep = String(body.sub?.endpoint || ''); if (!/^https:\/\/[^\s]+$/.test(ep) || ep.length > 1000) return err(400, 'This browser did not give a valid push address.');
          const label = cleanText(body.label, 60) || 'Device'; const old = subs.find((x) => x.endpoint === ep);
          if (old) { old.who = who; old.label = label; old.at = Date.now(); old.fails = 0; } else subs.push({ id: uid(8), who, endpoint: ep, label, ua: cleanText(body.ua, 160), at: Date.now(), last: 0, fails: 0 });
          await saveSubs(subs);
          if (!body.silent) await pushTo(s, (w, x) => x.endpoint === ep, { title: '🔔 ' + (s.branding.appName || 'INTPROTO-TV'), body: tx(okLang(body.lang), 'pushOn'), tag: 'welcome', url: body.url || '/' }).catch(() => {});
          return ok({ ok: true, devices: subs.filter((x) => x.who === who).length });
        }
        if (R('POST', '/api/push/unsubscribe')) { const ep = String(body.endpoint || ''); const keep = subs.filter((x) => !(x.who === who && (x.endpoint === ep || x.id === body.id))); await saveSubs(keep); return ok({ ok: true }); }
        if (R('GET', '/api/push/mine')) return ok({ devices: subs.filter((x) => x.who === who).map((x) => ({ id: x.id, label: x.label, at: x.at, last: x.last, mine: x.endpoint === String(query.endpoint || '') })) });
        if (R('POST', '/api/push/test')) { const r = await pushTo(s, who, { title: '🔔 Test', body: tx(okLang(body.lang), 'pushTest'), tag: 'test', url: body.url || '/' }); return ok(r); }
        return err(404, 'Not found');
      }

      // ---------- reseller dashboard (intproto-tv.store/rsl) ----------
      if (ses.role === 'reseller') {
        const rs = await getResellers(); const p = rs.find((x) => x.id === ses.id);
        if (!p) return err(401, 'Account not found.'); if (p.status === 'paused') return err(401, 'This reseller account is paused.');
        const cur = s.currencyRule?.on !== false ? custCurrency(s, p) : s.resellerCurrency || 'EUR';
        if (R('GET', '/api/rsl/me')) {
          const sales = await getSales(); const list = await getCustomers(); const now = Date.now(); const warn = 7 * DAY;
          const row = rsRows([p], s, sales, list)[0] || {};
          const lines = (p.customerIds || []).map((id) => list.find((c) => c.id === id)).filter(Boolean).map((c) => { const v = view(c, s); return { name: c.name, username: c.username, orderNo: c.orderNo || '', plan: v.planName, startAt: c.startAt, expiresAt: c.expiresAt, state: v.state, devices: connDevices(c) }; }).sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
          const orders = [...(p.orders || [])].sort((a, b) => (b.at || 0) - (a.at || 0)).map((o) => ({ ref: o.ref, at: o.at, pkg: o.pkg, credits: o.credits, amount: o.amount, currency: o.currency, note: o.note }));
          const mStart = new Date(new Date(now + 7 * 3600000).toISOString().slice(0, 7) + '-01T00:00:00Z').getTime() - 7 * 3600000;
          const b = s.branding;
          return ok({
            profile: { lang: p.lang || '', name: p.name, rslId: p.rslId, email: p.email, phone: p.phone, org: p.org, server: p.server, joinedAt: p.joinedAt || row.firstAt || 0, username: p.login?.username || p.rslId, lastLogin: p.lastLogin || 0 },
            panel: { url: p.panelUrl || '', user: p.panelUser || '', pass: p.panelPass || '', server: p.server || '' },
            credits: { bought: row.credits || 0, left: p.creditsLeft ?? null, thisMonth: (p.orders || []).filter((o) => o.at >= mStart).reduce((a, o) => a + (o.credits || 0), 0) },
            totals: { orders: row.purchases || 0, spentUsd: row.spentUsd || 0, firstAt: row.firstAt || 0, lastAt: row.lastAt || 0, rate: row.rate || 0 },
            lines: { list: lines.slice(0, 300), active: lines.filter((l) => l.expiresAt > now + warn).length, expiring: lines.filter((l) => l.expiresAt > now && l.expiresAt <= now + warn).length, expired: lines.filter((l) => l.expiresAt <= now).length },
            orders, requests: (p.requests || []).filter((q) => q.status === 'pending').map((q) => ({ id: q.id, at: q.at, pkg: q.pkg, credits: q.credits, price: q.price, cur: q.cur, method: q.method })),
            packages: (s.resellerPackages || []).filter((x) => Number(x.price) > 0).map((x) => ({ id: x.id, name: x.name, credits: Number(x.credits) || 0, price: Number(x.price) || 0, per: Number(x.credits) ? Math.round(Number(x.price) / Number(x.credits) * 100) / 100 : 0 })).sort((a, b) => a.credits - b.credits),
            currency: cur, payMethods: s.resellerPayMethods || [],
            support: { whatsapp: String(b.whatsapp || '').replace(/\D/g, ''), telegram: String(b.telegram || '').replace(/^@/, ''), email: s.email.replyTo || s.email.fromEmail || '', app: b.appName || 'IPTV', logo: b.logoUrl || '' },
          });
        }
        if (R('POST', '/api/rsl/order')) { // the reseller asks for credits: you get a message and send the payment link
          const pk = (s.resellerPackages || []).find((x) => x.id === String(body.pkg || '')); if (!pk || !(Number(pk.price) > 0)) return err(400, 'Choose a package.');
          const methods = s.resellerPayMethods || []; const method = String(body.method || '').trim();
          if (methods.length && !methods.includes(method)) return err(400, 'Choose how you want to pay.');
          const k = 'rslreq:' + p.id + ':' + new Date().toISOString().slice(0, 10); const n = Number(await store.get(k)) || 0;
          if (n >= 5) return err(429, 'Too many requests today. Please contact us on WhatsApp.'); await store.put(k, n + 1, 2 * 86400);
          const q = { id: uid(5), at: Date.now(), pkgId: pk.id, pkg: pk.name, credits: Number(pk.credits) || 0, price: Number(pk.price) || 0, cur, method, note: rsText(body.note, 300), status: 'pending' };
          p.requests = [q, ...(p.requests || [])].slice(0, 50); await saveResellers(rs);
          await log('customer', `🛒 Reseller ${p.name} (${p.rslId}) ordered ${pk.name} · ${pk.credits} credits (${method || 'no method'})`);
          await notifyAdmin(s, `🛒 Reseller order: ${p.name} (${p.rslId}) wants ${pk.credits} credits`, `${p.name} · ${p.rslId}\n${p.email || ''}\n${p.phone || ''}\n\nPackage: ${pk.name} · ${pk.credits} credits · ${pk.price} ${cur}\nPayment: ${method || '—'}${q.note ? '\nNote: ' + q.note : ''}\n\nSend the payment link, then open the app → Customers → Resellers → this reseller → ✓ Complete. The reseller gets the confirmation email.`);
          return ok({ ok: true, request: q });
        }
        // ---- reseller tools: own contact & shop prices, client subscription tracker, app email ----
        const RS_PRICE_DEF = () => [['1 Month', 1, 1], ['3 Months', 3, 1], ['6 Months', 6, 1], ['1 Year', 12, 1], ['2 Devices · 1 Year', 12, 2], ['3 Devices · 1 Year', 12, 3], ['4 Devices · 1 Year', 12, 4]].map(([label, months, devices]) => ({ id: uid(4), label, months, devices, price: 0 }));
        const getCl = async () => (await store.get('rslclients:' + p.id)) || [];
        const clView = (x) => { const left = Math.ceil((x.endAt - Date.now()) / DAY); return { ...x, daysLeft: left, state: left <= 0 ? 'expired' : left <= 7 ? 'expiring' : 'active' }; };
        const clClean = (b, o = {}) => { const months = Math.max(0, Math.min(60, Number(b.months ?? o.months) || 0)); const startAt = b.startAt ? new Date(b.startAt).getTime() : (o.startAt || Date.now());
          const endAt = b.endAt ? new Date(b.endAt).getTime() + 12 * 3600000 : (o.endAt && b.months === undefined ? o.endAt : startAt + (months || 1) * 30 * DAY);
          return { ...o, name: rsText(b.name ?? o.name, 80), phone: rsText(b.phone ?? o.phone, 30), email: cleanEmail(b.email ?? o.email) || '', username: rsText(b.username ?? o.username, 60), device: rsText(b.device ?? o.device, 60), plan: rsText(b.plan ?? o.plan, 60), months, devices: Math.max(1, Math.min(10, Number(b.devices ?? o.devices) || 1)), price: Math.max(0, Number(b.price ?? o.price) || 0), paid: b.paid !== undefined ? !!b.paid && b.paid !== 'false' : o.paid !== false, note: rsText(b.note ?? o.note, 300), startAt: isFinite(startAt) ? startAt : Date.now(), endAt: isFinite(endAt) ? endAt : Date.now() + 30 * DAY, updatedAt: Date.now() }; };
        if (R('GET', '/api/rsl/tools')) { const cl = (await getCl()).map(clView).sort((a, b) => a.endAt - b.endAt);
          return ok({ clients: cl, stats: { total: cl.length, active: cl.filter((x) => x.state === 'active').length, expiring: cl.filter((x) => x.state === 'expiring').length, expired: cl.filter((x) => x.state === 'expired').length, monthIncome: cl.filter((x) => x.paid && x.updatedAt >= Date.now() - 30 * DAY).reduce((a, x) => a + (x.price || 0), 0) },
            shop: { name: p.shopName || p.org || p.name, whatsapp: p.shopWa || p.phone || '', telegram: p.shopTg || '', email: p.shopEmail || p.email || '', note: p.shopNote || '', currency: p.shopCur || cur, prices: (p.shopPrices && p.shopPrices.length ? p.shopPrices : RS_PRICE_DEF()) }, contact: { phone: p.phone || '', org: p.org || '', email: p.email || '' } }); }
        if (R('PUT', '/api/rsl/shop')) { // contact details and the prices they charge their own clients
          if (body.phone !== undefined) p.phone = rsText(body.phone, 30); if (body.org !== undefined) p.org = rsText(body.org, 80);
          if (body.shopName !== undefined) p.shopName = rsText(body.shopName, 60); if (body.whatsapp !== undefined) p.shopWa = rsText(body.whatsapp, 30); if (body.telegram !== undefined) p.shopTg = rsText(body.telegram, 40).replace(/^@/, ''); if (body.shopEmail !== undefined) p.shopEmail = cleanEmail(body.shopEmail) || ''; if (body.note !== undefined) p.shopNote = rsText(body.note, 300);
          if (body.currency && ['EUR', 'USD', 'GBP', 'MAD', 'THB', 'TND', 'CAD', 'AUD'].includes(body.currency)) p.shopCur = body.currency;
          if (Array.isArray(body.prices)) p.shopPrices = body.prices.slice(0, 20).map((x) => ({ id: rsText(x.id, 8) || uid(4), label: rsText(x.label, 50), months: Math.max(0, Math.min(60, Number(x.months) || 0)), devices: Math.max(1, Math.min(10, Number(x.devices) || 1)), price: Math.max(0, Math.round((Number(x.price) || 0) * 100) / 100) })).filter((x) => x.label);
          await saveResellers(rs); await log('customer', `Reseller ${p.name} (${p.rslId}) updated contact / prices`); return ok({ ok: true }); }
        if (R('POST', '/api/rsl/clients')) { const cl = await getCl(); if (cl.length >= 2000) return err(400, 'Client list is full.'); const x = clClean(body, { id: uid(6), createdAt: Date.now() }); if (!x.name) return err(400, 'Enter the client name.'); cl.push(x); await store.put('rslclients:' + p.id, cl); return ok(clView(x)); }
        const clm = path.match(/^\/api\/rsl\/clients\/(\w+)(\/renew)?$/);
        if (clm) { const cl = await getCl(); const i = cl.findIndex((x) => x.id === clm[1]); if (i < 0) return err(404, 'Client not found.');
          if (method === 'DELETE') { cl.splice(i, 1); await store.put('rslclients:' + p.id, cl); return ok({ ok: true }); }
          if (clm[2] && method === 'POST') { const months = Math.max(1, Math.min(60, Number(body.months) || 1)); const o = cl[i]; const base = Math.max(Date.now(), o.endAt); cl[i] = { ...o, endAt: base + months * 30 * DAY, months, price: body.price !== undefined ? Math.max(0, Number(body.price) || 0) : o.price, paid: body.paid !== undefined ? !!body.paid : true, renewals: [...(o.renewals || []), { at: Date.now(), months, price: Number(body.price) || o.price || 0 }].slice(-30), updatedAt: Date.now() }; await store.put('rslclients:' + p.id, cl); return ok(clView(cl[i])); }
          if (method === 'PUT') { cl[i] = clClean(body, cl[i]); await store.put('rslclients:' + p.id, cl); return ok(clView(cl[i])); }
        }
        if (R('POST', '/api/rsl/appmail')) { // app download email for the reseller or one of their clients
          const k = 'rslmail:' + p.id + ':' + new Date().toISOString().slice(0, 10); const n = Number(await store.get(k)) || 0; if (n >= 30) return err(429, 'You sent 30 emails today. Try again tomorrow.');
          let target = { name: p.name, email: p.email, lang: p.lang || 'en' }; if (body.clientId) { const x = (await getCl()).find((y) => y.id === body.clientId); if (!x) return err(404, 'Client not found.'); target = { name: x.name, email: x.email, lang: body.lang || p.lang || 'en' }; }
          if (!cleanEmail(target.email)) return err(400, 'This client has no email address.');
          const m = appDownloadEmail(s, target, body.appUrl); const r = await sendEmail(s, cleanEmail(target.email), m.subject, m.html); if (!r.ok) return err(502, r.error || 'Email failed');
          await store.put(k, n + 1, 2 * 86400); await log('marketing', `Reseller ${p.rslId} sent the app email to ${target.email}`); return ok({ ok: true, to: cleanEmail(target.email) }); }
        if (R('POST', '/api/rsl/password')) {
          if ((await hashPassword(String(body.current || ''), p.login.salt)) !== p.login.hash) return err(400, 'Your current password is not right.');
          const np = String(body.password || ''); if (np.length < 6) return err(400, 'The new password needs 6 characters or more.');
          await rsSetPass(p, np); await saveResellers(rs); return ok({ ok: true });
        }
        return err(403, 'Not available in the reseller dashboard.');
      }

      // ---------- customer ----------
      if (ses.role === 'user') {
        const list = await getCustomers();
        const c = list.find((x) => x.id === ses.id);
        if (!c) return err(401, 'Account not found.');
        if (c.status === 'disabled') return err(401, 'This account is disabled.');
        if (path === '/api/me' && method === 'GET' && !c.pendingLine && (c.dns || s.player.serverUrl) && Date.now() - (lastLineCheck.get(c.id) || (c.panel && c.panel.at) || 0) > 30 * 60000) { try { if (await syncLine(s, c)) await saveCustomers(list); } catch {} }
        // Customer terms gate (spec §7): must accept the terms once before seeing the app
        if (!c.agreedAt && path !== '/api/me' && path !== '/api/me/agree' && path !== '/api/me/password' && path !== '/api/me/device' && path !== '/api/me/inbox/read' && path !== '/api/me/order') return err(403, 'terms_required'); // asking for a package works before the terms (trial users)
        const v = view(c, s);
        const canWatch = v.state !== 'expired' && !s.userDashboard.maintenance && !c.pendingLine;
        if (R('POST', '/api/me/device')) { // which phone / tablet / TV this customer uses
          const d = deviceFrom(String(body.ua || '').slice(0, 400), { model: body.model, touch: !!body.touch, app: !!body.app }); const key = (d.name + '|' + d.model + '|' + d.os.split(' ')[0]).toLowerCase();
          const seen = Array.isArray(c.devicesSeen) ? c.devicesSeen : []; let e = seen.find((x) => x.key === key);
          if (!e) { e = { key, ...d, first: Date.now(), n: 0 }; seen.unshift(e); } Object.assign(e, d, { last: Date.now(), n: (e.n || 0) + 1 });
          c.devicesSeen = seen.sort((a, b) => b.last - a.last).slice(0, 8); c.lastDevice = { name: d.name, brand: d.brand, model: d.model, os: d.os, kind: d.kind, at: Date.now() }; await saveCustomers(list);
          return ok({ device: d });
        }
        if (R('POST', '/api/me/inbox/read')) { let ch = 0; for (const n of c.inbox || []) if (!n.read) { n.read = Date.now(); ch++; } if (ch) await saveCustomers(list); return ok({ ok: true }); }
        if (R('POST', '/api/me/agree')) { c.agreedAt = Date.now(); await saveCustomers(list); await log('customer', `${c.username} accepted the terms of service`); return ok({ ok: true, agreed: true }); }

        if (R('POST', '/api/me/order')) { // customer asks to buy a package: the admin is told and sends a payment link
          const opk = (s.orderPackages || []).find((p) => p.id === body.pkg); const rpk = (s.resellerPackages || []).find((p) => p.id === body.pkg); const pk = opk || rpk; if (!pk) return err(400, 'Package not found.');
          const pkgTitle = pk.title || pk.name || 'Package';
          const pkgLine = rpk ? `${Number(rpk.credits) || 0} reseller credits` : `${Number(pk.days) || 0} days · ${Number(pk.devices) || 1} device(s)`;
          const pkgCur = s.currencyRule?.on !== false ? custCurrency(s, c) : rpk ? (s.resellerCurrency || 'EUR') : (s.orderCurrency || 'EUR'); // USD worldwide, EUR for Europe
          const k = 'buyreq:' + c.id + ':' + new Date().toISOString().slice(0, 10); const n = Number(await store.get(k)) || 0;
          if (n >= 5) return err(429, 'Too many requests today. Please contact us on WhatsApp.');
          await store.put(k, n + 1, 2 * 86400);
          c.buyRequest = { pkg: pk.id, title: pkgTitle, price: pk.price, at: Date.now() };
          // the customer gets the package email with its payment link right away (matching GreenApp Host link, rotation)
          let mailed = { ok: false, error: 'no email address' };
          if (opk && cleanEmail(c.email) && !(await getBad())[cleanEmail(c.email)]) {
            const n = await nextPayLink(s, opk, pkgCur); const m = orderEmail(s, c, opk, s.email.appUrl, n ? { url: n.url, acc: n.acc } : undefined, pkgCur);
            mailed = await sendEmail(s, c.email, m.subject, m.html);
            if (mailed.ok) { markSent(c, 'email'); c.orderSentAt = Date.now(); c.orderSentPkg = opk.id; c.orderSentLink = n?.url || ''; c.buyRequest.answeredAt = Date.now(); c.buyRequest.auto = true; }
          }
          await saveCustomers(list);
          await log('customer', `🛒 ${c.username} wants to buy "${pkgTitle}" (${pk.price})${mailed.ok ? ' · payment link emailed automatically' : opk ? ' · email NOT sent: ' + (mailed.error || '') : ''}`);
          await notifyAdmin(s, `🛒 Order request: ${c.name || c.username} wants “${pkgTitle}”`, `${c.name || ''} (${c.username})\n${c.email || ''}\n${c.whatsapp || c.phone || ''}\n\nPackage: ${pkgTitle} · ${pkgLine} · ${pk.price} ${pkgCur}\n\n${mailed.ok ? 'The package email with the payment link was sent to the customer automatically.' : 'Open the app → Customers → 🛒 requests → 💳 on this customer, paste your payment link and send.'}`).catch(() => {});
          await pushAgents(s, 'customers_view', { title: '🛒 Package request', body: `${c.name || c.username} · ${pkgTitle}`, url: '/intprototv?tab=customers', tag: 'buy-' + c.id }).catch(() => {});
          return ok({ ok: true, emailed: !!mailed.ok });
        }
        if (R('GET', '/api/me')) {
          const { lineUsername, linePassword, loginPassword, lines: _lines, ...pub } = v; pub.devicesTotal = connDevices(c);
          const sales = (await getSales()).filter((x) => x.customerId === c.id && Number(x.amount) > 0);
          const totalPaidUsd = Math.round(sales.reduce((a, x) => a + (Number(x.amountUsd) || 0), 0) * 100) / 100;
          return ok({
            user: pub, totalPaidUsd, paidCount: sales.length, agreed: !!c.agreedAt, dashboard: s.userDashboard, branding: s.branding, currency: s.currency, myCurrency: s.currencyRule?.on !== false ? custCurrency(s, c) : '',
            plans: s.plans.map((p) => ({ id: p.id, name: p.name, days: p.days, price: p.price, connections: p.connections })),
            orderPackages: (s.orderPackages || []).map((p) => ({ id: p.id, title: p.title || p.name, days: Number(p.days) || 0, devices: Number(p.devices) || 0, price: Number(p.price) || 0, badge: p.badge || '', kind: /^ibo/i.test(p.id || '') || /^ibo/i.test(p.title || '') ? 'ibo' : 'subscription', cur: ['EUR', 'USD', 'USDT', 'MAD', 'THB'].includes(s.orderCurrency) ? s.orderCurrency : 'EUR' })),
            resellerPackages: (s.resellerPackages || []).map((p) => ({ id: p.id, title: p.name || p.title, name: p.name || p.title, credits: Number(p.credits) || 0, days: 0, devices: 0, price: Number(p.price) || 0, badge: '', kind: 'reseller', cur: s.resellerCurrency || 'EUR' })),
            buyRequest: c.buyRequest || null,
            inbox: (c.inbox || []).slice(0, 30).map((n) => ({ id: n.id, at: n.at, title: n.title, body: n.body, url: n.url || '', read: !!n.read })),
            orderCurrency: s.currencyRule?.on !== false ? custCurrency(s, c) : s.orderCurrency || 'EUR', hasEmail: !!cleanEmail(c.email), chatUnread: ((await getChats()).find((x) => x.id === c.id) || {}).uc || 0,
            stream: canWatch && (s.player.serverUrl || c.dns) ? {
              server: trimSlash(c.dns || s.player.serverUrl), u: lineUsername, p: linePassword,
              useProxy: !!s.player.useProxy, proxyToken: await makeProxyToken(s.security.proxySecret, c.id, 12),
              mode: s.player.mode === 'direct' ? 'direct' : 'proxy', userAgent: s.player.userAgent || 'IPTVSmartersPro',
              relay: String(s.player.relayUrl || '').trim().replace(/\/+$/, ''),
              dns: String(c.dns || s.email.dns || s.player.serverUrl || '').replace(/\/+$/, ''),
              m3u: String(c.m3u || '').trim(),
              lineType: CONN_TYPES[c.lineType] ? c.lineType : 'xtream1', lines: customerConns(c, s).filter((x) => !x.main),
              ibo: c.ibo && (String(c.ibo.mac || '').trim() || String(c.ibo.key || '').trim()) ? { mac: String(c.ibo.mac || '').trim(), key: String(c.ibo.key || '').trim() } : null,
            } : null,
          });
        }
        if (R('GET', '/api/xtream')) {
          // In direct mode devices talk to the IPTV server themselves; an old copy of the app ends up here.
          if (s.player.mode === 'direct') return err(409, 'The app was updated. Please close it completely and open it again (or pull down to refresh).');
          if (!canWatch) return err(403, s.userDashboard.maintenance ? 'Service under maintenance.' : 'Your subscription has expired.');
          const { action, ...rest } = query;
          if (!XTREAM_ACTIONS.has(action)) return err(400, 'Action not allowed.');
          const params = { action };
          for (const k of ['category_id', 'series_id', 'vod_id', 'stream_id', 'limit']) if (rest[k]) params[k] = rest[k];
          return ok(await xtream(s, c, params));
        }
        if (R('GET', '/api/me/devices')) {
          return ok((await getDevices(c.id)).map((d) => ({ did: d.did, ua: d.ua, at: d.at, current: d.did === ses.did })).reverse());
        }
        if (R('POST', '/api/me/devices/remove')) {
          const devs = await getDevices(c.id); const d = devs.find((x) => x.did === String(body.did || ''));
          if (!d) return err(404, 'Device not found.');
          await store.del('session:' + d.token);
          await store.put('devs:' + c.id, devs.filter((x) => x !== d), 90 * 86400);
          await log('customer', `${c.username} signed out a device`);
          return ok({ ok: true, self: d.did === ses.did });
        }
        if (R('GET', '/api/me/payments')) {
          const sales = (await getSales()).filter((x) => x.customerId === c.id && Number(x.amount) > 0);
          return ok(sales.sort((a, b) => b.at - a.at).slice(0, 50).map((x) => ({ id: x.id, at: x.at, plan: x.planName, days: x.days, amount: x.amount, currency: x.currency, type: x.type })));
        }
        if (R('GET', '/api/me/tickets')) {
          return ok((await getTickets()).filter((x) => x.customerId === c.id).sort((a, b) => b.updatedAt - a.updatedAt).map(({ customerId, ...x }) => x));
        }
        if (R('POST', '/api/me/tickets')) {
          const subject = cleanText(body.subject, 120); const text = cleanText(body.text, 2000);
          if (subject.length < 3 || text.length < 5) return err(400, 'ticket_short');
          const k = 'ticketday:' + c.id; const n = Number(await store.get(k)) || 0;
          if (n >= 3) return err(429, 'ticket_limit');
          await store.put(k, n + 1, 86400);
          const all = await getTickets(); const now = Date.now();
          let att = ''; try { att = await saveAttachment(body.image); } catch { return err(400, 'att_bad'); }
          const tk = { id: uid(5), customerId: c.id, username: c.username, name: c.name, subject, status: 'open', priority: 'normal', createdAt: now, updatedAt: now, messages: [{ from: 'customer', by: c.name || c.username, at: now, text, ...(att ? { att } : {}) }] };
          all.unshift(tk); await saveTickets(all);
          await log('support', `New ticket from ${c.username}: ${subject}`);
          await pushAgents(s, 'tickets', { title: '🛟 New support request', body: `${c.name || c.username}: ${subject}`, tag: 'tk-' + c.id, url: '/intprototv?tab=support&open=' + tk.id });
          return ok({ ok: true, id: tk.id });
        }
        if (R('GET', '/api/me/tickets/att')) { // only pictures from the customer's own requests
          const id = String(query.id || ''); const mine = (await getTickets()).some((x) => x.customerId === c.id && x.messages.some((m) => m.att === id));
          const data = mine ? await store.get('att:' + id) : null;
          return data ? ok({ data }) : err(404, 'att_gone');
        }
        if (R('POST', '/api/me/tickets/reply')) {
          const all = await getTickets(); const tk = all.find((x) => x.id === String(body.id || '') && x.customerId === c.id);
          if (!tk) return err(404, 'Ticket not found.');
          const text = cleanText(body.text, 2000); if (text.length < 2) return err(400, 'ticket_short');
          if (tk.messages.length >= 40) return err(400, 'ticket_full');
          let att = ''; try { att = await saveAttachment(body.image); } catch { return err(400, 'att_bad'); }
          tk.messages.push({ from: 'customer', by: c.name || c.username, at: Date.now(), text, ...(att ? { att } : {}) }); tk.status = 'open'; tk.updatedAt = Date.now();
          await saveTickets(all);
          return ok({ ok: true });
        }
        if (R('POST', '/api/me/report')) { // the app tells us the TV server refused something; kept on the customer for the owner to see
          const k = 'playerr:' + c.id; if (await store.get(k)) return ok({ ok: true }); await store.put(k, 1, 600);
          c.playErr = { at: Date.now(), action: cleanText(body.action, 40), status: Number(body.status) || 0, message: cleanText(body.message, 120), route: cleanText(body.route, 10) };
          await saveCustomers(list);
          await log('customer', `${c.username} could not load ${c.playErr.action}: server code ${c.playErr.status || '—'} (${c.playErr.message}) via ${c.playErr.route}`);
          return ok({ ok: true });
        }
        if (R('GET', '/api/me/receipts')) return ok((await getReceipts()).filter((x) => x.customerId === c.id).map(({ customerId, att, ...x }) => x));
        if (R('POST', '/api/me/receipt')) {
          const pk = (s.orderPackages || []).find((p) => p.id === body.pkg); if (!pk) return err(400, 'rc_pkg');
          if (!body.image) return err(400, 'rc_image');
          const k = 'rcday:' + c.id; const n = Number(await store.get(k)) || 0; if (n >= 3) return err(429, 'rc_limit');
          let att; try { att = await saveAttachment(body.image); } catch { return err(400, 'att_bad'); }
          await store.put(k, n + 1, 86400);
          const cur = s.currencyRule?.on !== false ? custCurrency(s, c) : s.orderCurrency === 'ALL' ? 'EUR' : s.orderCurrency || 'EUR';
          const all = await getReceipts(); const rc = { id: uid(5), customerId: c.id, username: c.username, name: c.name, pkg: pk.id, pkgTitle: pk.title, days: pk.days, devices: pk.devices, amount: pk.price, cur, att, note: cleanText(body.note, 300), status: 'pending', at: Date.now() };
          all.unshift(rc); await store.put('receipts', all.slice(0, 400));
          await pushAgents(s, 'receipts', { title: '🧾 Payment receipt to check', body: `${c.name || c.username} sent a payment receipt`, tag: 'rc-' + c.id });
          await log('payment', `${c.username} uploaded a payment receipt for "${pk.title}"`);
          await notifyAdmin(s, `Payment receipt to check: ${c.name || c.username}`, `${c.name || ''} (${c.username}) uploaded a payment receipt.\n\nPackage: ${pk.title} · ${pk.days} days · ${pk.price} ${cur}${rc.note ? '\nNote: ' + rc.note : ''}\n\nOpen Money → Payment receipts, look at the picture and tap Approve. The subscription is extended and the customer is told.`);
          return ok({ ok: true, id: rc.id });
        }
        if (R('GET', '/api/me/chat')) { const ch = await chatRead(c.id, 'c'); return ok({ messages: ch.messages.map(({ from, at, text }) => ({ from, at, text })) }); }
        if (R('POST', '/api/me/chat')) {
          const text = cleanText(body.text, 1000); if (!text) return err(400, 'chat_empty');
          const k = 'chatrate:' + c.id; const n = Number(await store.get(k)) || 0; if (n >= 30) return err(429, 'chat_slow'); await store.put(k, n + 1, 600);
          const { ch, quiet } = await chatAdd(c, 'c', c.name || c.username, text);
          if (quiet) await pushAgents(s, 'tickets', { url: '/intprototv?tab=chat', title: '💬 New chat message', body: `${c.name || c.username}: ${text.slice(0, 140)}`, tag: 'chat-' + c.id });
          if (quiet) await notifyAdmin(s, `New chat message from ${c.name || c.username}`, `${c.name || ''} (${c.username}) wrote in the live chat:\n\n${text}\n\nAnswer in the dashboard: Customers → Live chat.`);
          return ok({ messages: ch.messages.map(({ from, at, text: t }) => ({ from, at, text: t })) });
        }
        if (R('POST', '/api/me/email/send')) { // sends a 6-digit code to the address on the account
          const to = cleanEmail(c.email); if (!to) return err(400, 'em_none');
          if (c.emailVerified) return ok({ ok: true, verified: true });
          const k = 'emailday:' + c.id; const n = Number(await store.get(k)) || 0;
          if (n >= 3) return err(429, 'em_limit');
          await store.put(k, n + 1, 86400);
          const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
          c.emailCode = { hash: await sha256(code + c.salt), exp: Date.now() + 15 * 60000, tries: 0 }; await saveCustomers(list);
          const app = escHtml(s.branding.appName || 'IPTV');
          const T = { fr: ['Votre code de vérification', 'Saisissez ce code dans l’application. Il est valable 15 minutes.'] }[ml(c)] || ['Your verification code', 'Enter this code in the app. It works for 15 minutes.'];
          const html = `<div dir="${ml(c) === 'ar' ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#121726"><h2 style="margin:0 0 12px">${app}</h2><p><b>${T[0]}</b></p><p style="font-size:32px;letter-spacing:6px;font-weight:bold;margin:16px 0" dir="ltr">${code}</p><p style="color:#5A6478">${T[1]}</p></div>`;
          const r = await sendEmail(s, to, `${s.branding.appName || 'IPTV'} — ${T[0]}`, html);
          if (!r.ok) return err(502, 'em_fail');
          return ok({ ok: true });
        }
        if (R('POST', '/api/me/email/verify')) {
          const ec = c.emailCode;
          if (!ec || ec.exp < Date.now() || ec.tries >= 5) return err(400, 'em_expired');
          if ((await sha256(String(body.code || '').replace(/\D/g, '') + c.salt)) !== ec.hash) { ec.tries++; await saveCustomers(list); return err(400, 'em_wrong'); }
          delete c.emailCode; c.emailVerified = cleanEmail(c.email); await saveCustomers(list);
          await log('customer', `${c.username} verified their email`);
          return ok({ ok: true });
        }
        if (path.startsWith('/api/me/2fa')) { // two-step sign-in for the customer's own account
          if (R('POST', '/api/me/2fa/setup')) {
            if (c.totp && c.totp.on) return err(400, 'tfa_already');
            const bytes = new Uint8Array(20); crypto.getRandomValues(bytes);
            c.totp = { secret: b32encode(bytes), on: false }; await saveCustomers(list);
            const app = s.branding.appName || 'IPTV';
            return ok({ secret: c.totp.secret, uri: `otpauth://totp/${encodeURIComponent(app + ':' + c.username)}?secret=${c.totp.secret}&issuer=${encodeURIComponent(app)}` });
          }
          if (R('POST', '/api/me/2fa/enable')) {
            if (!c.totp || !c.totp.secret) return err(400, 'tfa_start');
            if (!(await totpOk(c.totp.secret, body.code))) return err(400, 'tfa_wrong');
            c.totp.on = true; await saveCustomers(list); await log('customer', `${c.username} turned on two-step sign-in`);
            return ok({ ok: true });
          }
          if (R('POST', '/api/me/2fa/disable')) {
            if ((await hashPassword(body.password || '', c.salt)) !== c.passwordHash) return err(400, 'Current password is wrong.');
            delete c.totp; await saveCustomers(list); await log('customer', `${c.username} turned off two-step sign-in`);
            return ok({ ok: true });
          }
          return err(404, 'Not found');
        }
        if (R('POST', '/api/me/password')) {
          if (!s.userDashboard.allowPasswordChange) return err(403, 'Password change is turned off.');
          if ((await hashPassword(body.current || '', c.salt)) !== c.passwordHash) return err(400, 'Current password is wrong.');
          if (String(body.next || '').length < 6) return err(400, 'New password needs 6+ characters.');
          c.salt = uid(8); c.passwordHash = await hashPassword(body.next, c.salt); delete c.loginPassword; c.ownPassword = true; // their own password now: the line password no longer signs in
          await saveCustomers(list);
          await log('customer', `${c.username} changed their password`);
          return ok({ ok: true });
        }
        return err(404, 'Not found');
      }

      // ---------- admin ----------
      if (!['admin', 'staff'].includes(ses.role) || !path.startsWith('/api/admin/')) return err(403, 'Not allowed.');
      let perms = PERM_KEYS, isOwner = ses.role === 'admin', member = null;
      if (isOwner) actorName = (await getAdmin()).username + ' (owner)';
      else {
        const team = await getTeam();
        member = team.find((x) => x.id === ses.id);
        if (!member || member.status === 'disabled') return err(401, 'Please sign in again.');
        // Owner-only permissions can never take effect, even if a stale record still lists them.
        perms = (member.perms || []).filter((p) => !isOwnerOnly(p));
        // A trainee is limited to view, attendance and tasks for their first 14 days (spec §3)
        if (member.traineeUntil && member.traineeUntil > Date.now()) perms = perms.filter((p) => ['customers_view', 'attendance', 'tasks'].includes(p));
        actorName = member.name || member.username; staffMember = member;
      }
      // 'secrets' (API keys, accounts, hosting, domains): the owner, anyone given it, and the Technical Manager (Khalil).
      const tech = !isOwner && isTechRole(member && member.role);
      const can = (p) => isOwner || (!isOwnerOnly(p) && (TECH_ONLY.includes(p) ? tech : perms.includes(p) || (p === 'marketing' && (tech || perms.includes('customers_edit'))))); // anyone who serves customers can send marketing
      const locked = !can('templates_edit'); // agents: texts, subjects and links are fixed
      const need = permFor(method, path, body);
      if (need === 'owner' && !isOwner) { await log('security', `${actorName} was blocked from ${method} ${path} (owner only)`); return err(403, 'Only the owner can do this.'); }
      if (need && need !== 'owner' && !can(need)) {
        if (!isOwner) await log('security', `${actorName} was blocked from ${method} ${path} (needs "${need}")`);
        return err(403, 'You do not have permission for this.');
      }
      // Phone numbers only leave the server for callers allowed to see them (owner, or staff with customers_phone).
      const hidePhone = !can('customers_phone');
      const maskNum = (v) => String(v || '').replace(/\d(?=\d{2})/g, '•');
      const viewP = (c, st) => { const v = view(c, st || s); if (hidePhone) { if (v.phone) v.phone = maskNum(v.phone); if (v.whatsapp) v.whatsapp = maskNum(v.whatsapp); } return v; };
      // Mandatory two-factor for everyone (spec §2). Until it is on, only the memo and the 2FA endpoints answer.
      if (s.security.force2fa === true) {
        const acct = isOwner ? await getAdmin() : member;
        const tfaOn = !!(acct && acct.totp && acct.totp.on);
        if (!tfaOn) {
          const allow = path === '/api/admin/me' || path.startsWith('/api/admin/2fa');
          if (!allow) return err(403, '2fa_setup_required');
        }
      }
      // Mandatory staff bylaws signature (spec §7). Staff must sign once; the owner can list signatures anytime.
      const BYLAW_VERSION = '2026-01';
      if (!isOwner && member && member.status !== 'disabled') {
        const sigs = (await store.get('bylaws')) || [];
        const signed = sigs.some((x) => x.by === member.id && x.version === BYLAW_VERSION);
        if (!signed) {
          const allow = path === '/api/admin/me' || path === '/api/admin/bylaws' || path === '/api/admin/bylaws/sign' || path.startsWith('/api/admin/2fa');
          if (!allow) return err(403, 'bylaws_required');
        }
      }

      // Check-in before the panel: an agent must start the shift (track working hours) before anything else opens.
      let checkedIn = true;
      if (!isOwner && member && s.security.requireCheckIn !== false) {
        checkedIn = !!attOpen(await getAtt(), member.id);
        const allow = path === '/api/admin/me' || path === '/api/admin/attendance' || path.startsWith('/api/admin/2fa') || path.startsWith('/api/admin/bylaws') || path === '/api/admin/me/password' || path === '/api/admin/guide';
        if (!checkedIn && !allow) return err(403, 'checkin_required');
      }
      if (R('GET', '/api/admin/diag')) { // owner-only: what devices reported
        if (!isOwner) return err(403, 'Only the owner can see client diagnostics.');
        const list = (await store.get('diag')) || [];
        return ok({ list: list.slice(0, 200) });
      }
      if (R('GET', '/api/admin/me')) {
        const meta = { allPerms: PERMS, allRoles: ROLE_PRESETS, modules: PERM_MODULES, ownerOnly: OWNER_ONLY, mode, force2fa: s.security.force2fa === true };
        const must2fa = (acct) => meta.force2fa && !(acct && acct.totp && acct.totp.on);
        meta.sessionExp = ses.exp || 0; meta.staffHours = Number(s.security.staffHours) || 6; meta.mustCheckIn = !checkedIn; meta.noCopy = !isOwner && !tech && s.security.noCopy !== false; meta.lang = (member && member.lang) || 'en';
        if (isOwner) { const a = await getAdmin(); return ok({ ...meta, role: 'owner', name: a.username, username: a.username, isDefault: !!a.isDefault, perms: PERM_KEYS, mustSetup2fa: must2fa(a), twoFactor: !!(a.totp && a.totp.on) }); }
        return ok({ ...meta, role: 'staff', id: member.id, name: member.name, username: member.username, function: member.role || 'Staff', alias: member.alias || '', traineeUntil: Number(member.traineeUntil) || 0, isTrainee: !!(member.traineeUntil && member.traineeUntil > Date.now()), isDefault: false, perms: [...new Set([...perms.filter((p) => !TECH_ONLY.includes(p)), ...(tech ? TECH_ONLY : []), ...(can('marketing') ? ['marketing'] : [])])], tech, locked, mustSetup2fa: must2fa(member), mustSignBylaws: !(await (async () => ((await store.get('bylaws')) || []).some((x) => x.by === member.id && x.version === '2026-01'))()), twoFactor: !!(member.totp && member.totp.on) });
      }
      if (path.startsWith('/api/admin/2fa')) { // two-factor login for the signed-in admin or staff member
        const team = isOwner ? null : await getTeam();
        const acct = isOwner ? await getAdmin() : team.find((x) => x.id === ses.id);
        const save = () => (isOwner ? store.put('admin', acct) : store.put('team', team));
        if (R('POST', '/api/admin/2fa/setup')) {
          if (acct.totp && acct.totp.on) return err(400, 'Two-factor login is already on.');
          const bytes = new Uint8Array(20); crypto.getRandomValues(bytes);
          acct.totp = { secret: b32encode(bytes), on: false }; await save();
          const label = encodeURIComponent(`${s.branding.appName || 'IPTV'}:${acct.username}`);
          return ok({ secret: acct.totp.secret, uri: `otpauth://totp/${label}?secret=${acct.totp.secret}&issuer=${encodeURIComponent(s.branding.appName || 'IPTV')}` });
        }
        if (R('POST', '/api/admin/2fa/enable')) {
          if (!acct.totp || !acct.totp.secret) return err(400, 'Start the setup first.');
          if (!(await totpOk(acct.totp.secret, body.code))) return err(400, 'That code is not right. Check the time on your phone and try the newest code.');
          acct.totp.on = true; await save(); await log('security', 'Two-factor login turned on');
          return ok({ ok: true });
        }
        if (R('POST', '/api/admin/2fa/disable')) {
          if ((await hashPassword(body.password || '', acct.salt)) !== acct.hash) return err(400, 'Current password is wrong.');
          delete acct.totp; await save(); await log('security', 'Two-factor login turned off');
          return ok({ ok: true });
        }
        return err(404, 'Not found');
      }
      if (path.startsWith('/api/admin/bylaws')) { // Staff bylaws (spec §7) — trilingual, mandatory for staff, archived with name+IP+timestamp
        if (R('GET', '/api/admin/bylaws')) {
          const sigs = (await store.get('bylaws')) || [];
          const meId = isOwner ? 'owner' : (member ? member.id : '');
          const my = sigs.find((x) => x.by === meId && x.version === '2026-01');
          const list = isOwner ? sigs.slice(0, 100) : null; // owner sees the signature archive
          return ok({ signed: !!my, version: '2026-01', signature: my || null, list });
        }
        if (R('POST', '/api/admin/bylaws/sign')) {
          const meId = isOwner ? 'owner' : (member ? member.id : '');
          const sigs = (await store.get('bylaws')) || [];
          if (sigs.some((x) => x.by === meId && x.version === '2026-01')) return ok({ ok: true, already: true });
          const name = String(body.name || actorName || '').trim().slice(0, 80);
          if (name.length < 3) return err(400, 'Type your full name to sign.');
          const rec = { id: uid(6), by: meId, name, role: actorName, version: '2026-01', at: Date.now(), ip: ses.ip || 'unknown', ua: String(ses.ua || '').slice(0, 120) };
          sigs.unshift(rec); await store.put('bylaws', sigs.slice(0, 200));
          await log('security', `Bylaws signed (v2026-01) by ${actorName} from ${ses.ip || 'unknown IP'}`);
          return ok({ ok: true, signature: rec });
        }
        return err(404, 'Not found');
      }
      if (R('GET', '/api/admin/receipts')) return ok((await getReceipts()).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.at - a.at));
      if (R('POST', '/api/admin/receipts/decide')) {
        const all = await getReceipts(); const rc = all.find((x) => x.id === String(body.id || '')); if (!rc) return err(404, 'Receipt not found.');
        if (rc.status !== 'pending') return err(400, 'This receipt was already ' + rc.status + '.');
        const list = await getCustomers(); const c = list.find((x) => x.id === rc.customerId); if (!c) return err(404, 'This customer no longer exists.');
        const lang = ml(c); let panelNote = '';
        if (body.action === 'approve') {
          const days = Math.max(1, Number(body.days) || Number(rc.days) || 30); const devices = Number(rc.devices) || 1;
          const plan = s.plans.find((p) => Number(p.days) === days && (Number(p.connections) || 1) === devices) || s.plans.find((p) => Number(p.days) === days);
          let renewed = false;
          if (s.reseller.enabled && plan) { const pr = await panelCall(s, 'renew', panelVars(c, s, { days, package: plan.package })); if (pr.ok && !pr.skipped) renewed = true; else if (!pr.skipped) panelNote = pr.error || ''; }
          const base = Math.max(Date.now(), c.expiresAt); if (c.expiresAt < Date.now()) c.startAt = Date.now();
          c.expiresAt = base + days * DAY; c.connections = Math.max(Number(c.connections) || 1, devices); if (plan) c.planId = plan.id;
          const wasTrial = !!c.isTrial; c.isTrial = false;
          if (!renewed) c.renewPending = Date.now(); // shown in Alerts until the line is renewed on the panel
          const credits = plan ? planCredits(plan) : Math.max(1, Math.round(days / 30));
          (c.renewals ||= []).push({ at: Date.now(), type: wasTrial ? 'new' : 'renew', planId: plan ? plan.id : 'custom', days, price: Number(rc.amount) || 0, credits, receipt: rc.id });
          await saveCustomers(list);
          await recordSale(s, c, { type: wasTrial ? 'new' : 'renew', plan, days, credits, amount: Number(body.amount) || 0, accountId: String(body.accountId || ''), sa: String(body.stripeAccountId || ''), by: actorName });
          rc.status = 'approved'; rc.daysAdded = days;
          const T = [tx(lang, 'paidT'), tx(lang, 'paidB', { days })];
          if (cleanEmail(c.email)) await sendEmail(s, c.email, `${s.branding.appName || 'IPTV'} — ${T[0]}`, mailHtml(s, okLang(lang), [[mt(lang, 'user'), c.username], [mt(lang, 'expires'), new Date(c.expiresAt).toLocaleDateString(langLocale(lang), { dateStyle: 'long' })]], T[1], c.name));
          await chatAdd(c, 's', s.branding.appName || 'Support', `${T[0]} ${T[1]}`);
          await log('payment', `Receipt approved for ${c.username}: +${days} days (${rc.pkgTitle})${renewed ? ' · renewed on the panel' : ' · renew the line on the panel'}`);
        } else {
          rc.status = 'rejected'; rc.reason = cleanText(body.reason, 300);
          const T = { fr: 'Nous n’avons pas pu confirmer votre paiement.' }[lang] || 'We could not confirm your payment.';
          await chatAdd(c, 's', s.branding.appName || 'Support', `${T}${rc.reason ? ' ' + rc.reason : ''}`);
          await log('payment', `Receipt rejected for ${c.username}${rc.reason ? ': ' + rc.reason : ''}`);
        }
        rc.decidedAt = Date.now(); rc.by = actorName; await store.put('receipts', all);
        return ok({ ok: true, receipt: rc, panelNote });
      }
      if (R('POST', '/api/admin/sync')) { // checks a batch of customers against the panel; the dashboard calls it again until done
        const list = await getCustomers(); const ids = Array.isArray(body.ids) ? body.ids : null;
        const todo = list.filter((c) => !c.pendingLine && (ids ? ids.includes(c.id) : true)); const from = Math.max(0, Number(body.offset) || 0); const part = todo.slice(from, from + 12);
        let changed = 0, bad = 0, unreachable = ''; 
        for (const c of part) { try { if (await syncLine(s, c)) changed++; } catch {} if (c.lineBad) bad++; if (c.panel && c.panel.error) unreachable = c.panel.error; }
        if (part.length) await saveCustomers(list);
        if (from + part.length >= todo.length) { await store.put('lastsync', Date.now()); await log('customer', `Synced ${todo.length} customer(s) with the panel`); }
        return ok({ done: from + part.length >= todo.length, next: from + part.length, total: todo.length, changed, bad, error: unreachable });
      }
      // ---------- disputes & problem reports (spec §5) ----------
      const getDisputes = async () => (await store.get('disputes')) || [];
      const saveDisputes = (l) => store.put('disputes', l.slice(0, 500));
      const publicDispute = ({ att, notes, ...d }) => d;
      const getTrialQueue = async () => (await store.get('trialqueue')) || [];
      const saveTrialQueue = (l) => store.put('trialqueue', l.slice(0, 300));

      if (R('GET', '/api/admin/disputes/att')) { const data = /^[0-9a-f]+$/.test(String(query.id || '')) ? await store.get('att:' + query.id) : null; return data ? ok({ data }) : err(404, 'This picture is no longer stored.'); }
      if (R('GET', '/api/admin/disputes')) {
        const all = (await getDisputes()).sort((a, b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0) || b.updatedAt - a.updatedAt);
        return ok({ list: all.map(publicDispute), open: all.filter((d) => d.status !== 'resolved').length, high: all.filter((d) => d.status !== 'resolved' && d.priority === 'high').length });
      }
      if (R('POST', '/api/admin/disputes')) {
        // Any admin screen can report a problem: payment issue, service complaint, dispute, or a panel/technical bug (screenshot + priority).
        const kind = ['payment', 'service', 'dispute', 'bug', 'other'].includes(body.kind) ? body.kind : 'other';
        const subject = cleanText(body.subject, 160); const details = cleanText(body.details, 4000);
        if (subject.length < 3) return err(400, 'Write a short title first.');
        let att = ''; try { att = await saveAttachment(body.image); } catch { return err(400, 'The picture is too large or not an image.'); }
        const list = await getCustomers(); const cu = body.customerId ? list.find((x) => x.id === String(body.customerId)) : null;
        const d = { id: uid(8), kind, subject, details, priority: ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal', status: 'open',
          customerId: cu ? cu.id : '', username: cu ? cu.username : '', name: cu ? cu.name : '', orderNo: cu ? (cu.orderNo || '') : '', amount: Number(body.amount) || 0,
          att, createdBy: actorName, createdAt: Date.now(), updatedAt: Date.now(), assignedTo: String(body.assignedTo || '').slice(0, 40), notes: [], resolution: '' };
        const all = await getDisputes(); all.unshift(d); await saveDisputes(all);
        if (cu) { cu.statusFlag = 'dispute'; await saveCustomers(list); }
        await log('disputes', `${d.kind === 'bug' ? 'Problem report' : 'Dispute'} opened: "${d.subject}"${cu ? ' for ' + cu.username : ''} (${d.priority})`);
        await notifyAdmin(s, `${d.kind === 'bug' ? '🐞 Problem report' : '⚠️ Dispute'}: ${d.subject}`, `${d.details || ''}\n\nOpened by ${actorName}${cu ? `\nCustomer: ${cu.name} (${cu.username})` : ''}\nPriority: ${d.priority}`);
        await notifyTM(s, `${d.kind === 'bug' ? '🐞 Problem report' : '⚠️ Dispute'}: ${d.subject}`, `${d.details || ''}\n\nOpened by ${actorName}${cu ? `\nCustomer: ${cu.name} (${cu.username})` : ''}\nPriority: ${d.priority}`);
        return ok({ ok: true, dispute: publicDispute(d) });
      }
      if (R('POST', '/api/admin/disputes/update')) {
        const all = await getDisputes(); const d = all.find((x) => x.id === String(body.id || '')); if (!d) return err(404, 'Not found.');
        if (body.status) { const st = ['open', 'in_progress', 'resolved'].includes(body.status) ? body.status : null; if (!st) return err(400, 'Unknown status.'); d.status = st; if (st === 'resolved') { d.resolvedAt = Date.now(); d.resolvedBy = actorName; } }
        if (body.priority !== undefined) d.priority = ['low', 'normal', 'high'].includes(body.priority) ? body.priority : d.priority;
        if (body.assignedTo !== undefined) d.assignedTo = String(body.assignedTo || '').slice(0, 40);
        const note = cleanText(body.note, 1000);
        if (note) d.notes.push({ at: Date.now(), by: actorName, text: note });
        if (body.resolution !== undefined) d.resolution = cleanText(body.resolution, 2000);
        d.updatedAt = Date.now(); await saveDisputes(all);
        await log('disputes', `Dispute "${d.subject}" → ${d.status}${note ? ' · ' + note : ''}`);
        return ok({ ok: true, dispute: publicDispute(d) });
      }

      // ---------- Telegram: connect the bot, test it, and read its status ----------
      if (R('GET', '/api/admin/telegram')) {
        if (!can('settings')) return err(403, 'Not allowed.');
        const st = { enabled: tgOn(s), bot: s.telegram.botUsername ? '@' + s.telegram.botUsername : '', adminChat: !!s.telegram.adminChat, autoTrial: s.telegram.autoTrial !== false, notifyAdmin: s.telegram.notifyAdmin !== false, link: tgBotLink(s) };
        if (!tgOn(s)) return ok(st);
        const me = await tgApi(s, 'getMe', null);
        const wh = await tgApi(s, 'getWebhookInfo', null);
        return ok({ ...st, tokenOk: me.ok, bot: me.result?.username ? '@' + me.result.username : st.bot, error: me.ok ? '' : me.error, webhook: wh.result || null });
      }
      if (R('POST', '/api/admin/telegram/setup')) {
        if (!can('settings')) return err(403, 'Not allowed.');
        const next = { ...s, telegram: { ...s.telegram } };
        if (body.botToken && body.botToken !== '••••') next.telegram.botToken = String(body.botToken).trim().slice(0, 120);
        if (body.adminChat !== undefined) next.telegram.adminChat = String(body.adminChat || '').trim().slice(0, 80);
        if (body.enabled !== undefined) next.telegram.enabled = !!body.enabled;
        if (body.autoTrial !== undefined) next.telegram.autoTrial = !!body.autoTrial;
        if (body.notifyAdmin !== undefined) next.telegram.notifyAdmin = !!body.notifyAdmin;
        if (!next.telegram.botToken) return err(400, 'Paste the bot token from @BotFather first.');
        next.telegram.enabled = true;
        const me = await tgApi(next, 'getMe', null);
        const bot = me.result?.username || '';
        if (!me.ok) { await saveSettings(next); return err(400, me.error || 'Telegram refused this bot token.'); }
        next.telegram.botUsername = bot;
        const base = String(body.url || s.email.appUrl || '').trim().replace(/\/+$/, '');
        if (!/^https:\/\/[^\s]+$/i.test(base)) { await saveSettings(next); return err(400, 'Set your public app URL (Settings → Email → App URL) or paste the site URL so Telegram can reach the webhook.'); }
        const hook = base + '/api/telegram/webhook';
        const st = await tgApi(next, 'setWebhook', { url: hook, secret_token: next.telegram.webhookSecret, allowed_updates: ['message'], drop_pending_updates: false });
        await saveSettings(next);
        if (!st.ok) return err(400, st.error || 'The bot token works, but Telegram refused the webhook URL.');
        if (next.telegram.adminChat) await tgSend(next, next.telegram.adminChat, `✅ ${s.branding.appName || 'IPTV'} Telegram is connected. Free-trial logins can be sent to customers here.`);
        return ok({ ok: true, bot: bot ? '@' + bot : '', webhook: hook, link: tgBotLink(next) });
      }
      if (R('POST', '/api/admin/telegram/test')) {
        if (!can('settings')) return err(403, 'Not allowed.');
        const to = String(body.chat || s.telegram.adminChat || '').trim();
        if (!to) return err(400, 'Add the admin chat ID first.');
        const r = await tgSend(s, to, `✅ Test from ${s.branding.appName || 'IPTV'} — Telegram is working.\n\n${tgBotLink(s) ? 'Customers open ' + tgBotLink(s) + ' and press Start.' : ''}`);
        return r.ok ? ok({ ok: true }) : err(400, r.error || 'Telegram refused the message.');
      }

      // ---------- all-agents free trial queue (spec §4) ----------
      const trialSend = async (entry, m3uText) => {
        const ln = parseLineLink(String(m3uText || '').trim()); if (!ln) return { error: 'This does not look like an M3U link. Paste the full link (it contains username= and password=).' };
        const list = await getCustomers(); const prev = findMatches(list, { email: entry.email, phone: entry.phone, whatsapp: entry.whatsapp });
        if (prev.length) return { error: `A customer already uses this email or phone (${prev[0].c.username}). Open Customers to continue.` };
        const rnd = (n, ch) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => ch[x % ch.length]).join('');
        let username = String(entry.username || ln.u || '').trim() || ('t' + rnd(6, '0123456789'));
        let password = String(entry.password || ln.p || '').trim(); if (!password) password = rnd(8, 'abcdefghjkmnpqrstuvwxyz23456789');
        const now = Date.now(); const salt = uid(8);
        const c = { loginPassword: password, id: uid(8), name: entry.name, email: cleanEmail(entry.email) || entry.email, phone: entry.phone, whatsapp: entry.whatsapp, telegram: entry.telegram || '', lang: okLang(entry.lang), note: 'Free trial (agents queue)', username, salt, passwordHash: await hashPassword(password, salt), lineUsername: ln.u, linePassword: ln.p, dns: ln.dns, m3u: String(m3uText || '').trim(), lineId: '', planId: 'trial', isTrial: true, connections: Number(s.trial.connections) || 1, startAt: now, expiresAt: now + (Number(s.trial.hours) || 24) * 3600000, status: 'active', createdAt: now, lastLogin: null, renewals: [{ at: now, type: 'trial', planId: 'trial', days: 1, credits: Number(s.trial.credits) || 0, price: 0 }] };
        list.push(c); await saveCustomers(list);
        await recordSale(s, c, { type: 'trial', plan: null, days: 1, credits: Number(s.trial.credits) || 0, amount: 0, accountId: '' });
        const dns = String(ln.dns || s.email.dns || s.player.serverUrl || '').replace(/\/+$/, '');
        const m = accessEmail(s, c, password, 'trial', body.appUrl);
        const sent = await sendEmail(s, c.email, m.subject, m.html);
        const tgChat = await tgFindChat(c);
        let tgSent = false;
        if (tgChat) { const rr = await tgSend(s, tgChat, tgCreds(s, c, password)); tgSent = rr.ok; }
        if (tgOn(s) && s.telegram.adminChat) {
          const startLink = tgBotLink(s, c.email);
          await tgSend(s, s.telegram.adminChat, `🎁 Trial sent\n\n${c.name}\n${c.email}\nUsername: ${c.username}\nLine: ${ln.u} / ${ln.p}\n\n${tgSent ? 'Telegram: delivered to the customer.' : c.telegram ? `Telegram: @${String(c.telegram).replace(/^@/, '')} has not pressed Start yet. Send ${startLink || 'the bot link'}.` : `Telegram: no chat linked. Send ${startLink || 'the bot link'} and ask for /start ${c.email}.`}`);
        }
        await log('trial', `Trial sent to ${c.username} for ${c.name} <${c.email}>${sent.ok ? ' · email sent' : ' · email NOT sent: ' + (sent.error || '')}${tgSent ? ' · Telegram sent' : ''}`);
        return { ok: true, username: c.username, emailSent: sent.ok, telegramSent: tgSent, telegramLinked: !!tgChat, dns, m3u: dns ? `${dns}/get.php?username=${encodeURIComponent(ln.u)}&password=${encodeURIComponent(ln.p)}&type=m3u_plus&output=ts` : '', password, name: c.name, hours: s.trial.hours, phone: c.phone || '', whatsapp: c.whatsapp || '', telegram: c.telegram || '' };
      };
      if (R('POST', '/api/admin/trialq/direct')) { // Agent Panel: paste an M3U line -> dispatch the trial and sync My Details
        const body2 = body || {};
        const custId = String(body2.customerId || '');
        const list = await getCustomers();
        const c = custId ? list.find((x) => x.id === custId) || null : null;
        const paste = String(body2.m3u || '').trim();
        let ln = parseLineLink(paste);
        if (!ln) { const u0 = String(body2.username || '').trim(), p0 = String(body2.password || ''), d0 = String(body2.dns || '').trim().replace(/\/+$/, ''); if (u0 && p0) ln = { u: u0, p: p0, dns: d0 }; }
        if (!ln || !ln.u || !ln.p) return err(400, 'Paste the full M3U link from your panel (it contains username= and password=).');
        const dns = String(ln.dns || '').replace(/\/+$/, '');
        const m3u = /username=[^&]+/i.test(paste) && /password=[^&]+/i.test(paste) ? paste : `${dns}/get.php?username=${encodeURIComponent(ln.u)}&password=${encodeURIComponent(ln.p)}&type=m3u_plus&output=ts`;
        const hours = Number(s.trial.hours) || 24;
        const iboText = String(body2.ibo || '');
        if (c) { // existing customer: save the line under My Details and notify the same contact channels
          c.lineUsername = ln.u; c.linePassword = ln.p; c.dns = dns; c.m3u = m3u;
          if (c.isTrial) { const now = Date.now(); c.startAt = c.startAt || now; c.expiresAt = Math.max(Number(c.expiresAt) || 0, now + hours * 3600000); c.status = 'active'; }
          await saveCustomers(list);
          const m = accessEmail(s, c, c.loginPassword || '', 'trial', body2.appUrl);
          const sent = c.email ? await sendEmail(s, c.email, m.subject, m.html) : { ok: false, error: 'no email' };
          const tgChat = await tgFindChat(c); let tgSent = false;
          if (tgChat) { const rr = await tgSend(s, tgChat, tgCreds(s, c, c.loginPassword || '')); tgSent = rr.ok; }
          if (tgOn(s) && s.telegram.adminChat) {
            const startLink = tgBotLink(s, c.email);
            await tgSend(s, s.telegram.adminChat, `🎁 Trial line synced\n\n${c.name}\n${c.email}\nUsername: ${ln.u}\nLine: ${ln.u} / ${ln.p}\n\n${tgSent ? 'Telegram: delivered to the customer.' : c.telegram ? `Telegram: @${String(c.telegram).replace(/^@/, '')} has not pressed Start yet. Send ${startLink || 'the bot link'}.` : `Telegram: no chat linked. Send ${startLink || 'the bot link'} and ask for /start ${c.email}.`}`);
          }
          if (iboText) { try { await tgSend(s, s.telegram && s.telegram.adminChat, `🎮 IBO Player activation — ${c.name || c.username}\n${iboText}`); } catch {} }
          await log('trial', `Free-trial details synced to ${c.username} (${c.name}) · line ${ln.u}${sent.ok ? ' · email sent' : ' · email NOT sent: ' + (sent.error || '')}${tgSent ? ' · Telegram sent' : ''}`);
          return ok({ ok: true, updated: true, customerId: c.id, name: c.name, username: ln.u, password: ln.p, dns, m3u, emailSent: sent.ok, telegramSent: tgSent, telegramLinked: !!tgChat, loginUsername: c.username, hours, phone: c.phone || '', whatsapp: c.whatsapp || '', telegram: c.telegram || '', ibo: !!iboText });
        }
        const entry = {
          email: String(body2.email || '').trim(),
          phone: String(body2.phone || '').replace(/[^\d+]/g, '').slice(0, 20),
          whatsapp: String(body2.phone || '').replace(/[^\d+]/g, '').slice(0, 20),
          telegram: String(body2.telegram || ''),
          name: String(body2.name || '').trim(),
          lang: okLang(String(body2.lang || '')),
          username: ln.u, password: ln.p,
        };
        const r = await trialSend(entry, m3u);
        if (r.error) return err(400, r.error);
        if (iboText) { try { await tgSend(s, s.telegram && s.telegram.adminChat, `🎮 IBO Player activation — ${entry.name || ln.u}\n${iboText}`); } catch {} }
        await log('trial', `Dedicated free-trial dispatch via ${entry.email || ln.u}: email ${r.emailSent ? 'sent' : 'skipped'} · telegram ${r.telegramSent ? 'sent' : 'skipped'}`);
        return ok({ ok: true, ...r, updated: false, customerId: r.customerId || '', name: r.name || entry.name, username: ln.u, password: ln.p, dns, m3u, ibo: !!iboText });
      }
      if (R('GET', '/api/admin/trialq')) {
        const all = (await getTrialQueue()).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.at - a.at);
        return ok({ list: all, pending: all.filter((t) => t.status === 'pending').length });
      }
      if (R('POST', '/api/admin/trialq/claim')) {
        const all = await getTrialQueue(); const t = all.find((x) => x.id === String(body.id || '')); if (!t) return err(404, 'Not found.');
        if (t.status !== 'pending') return err(400, 'This request is already ' + t.status + '.');
        if (t.claimedBy && !isOwner) return err(400, `Already claimed by ${t.claimedBy}.`);
        t.claimedBy = actorName; t.claimedAt = Date.now(); await saveTrialQueue(all);
        return ok({ ok: true, request: t });
      }
      if (R('POST', '/api/admin/trialq/send')) {
        const all = await getTrialQueue(); const t = all.find((x) => x.id === String(body.id || '')); if (!t) return err(404, 'Not found.');
        if (t.status !== 'pending') return err(400, 'This request is already ' + t.status + '.');
        const r = await trialSend(t, body.m3u); if (r.error) return err(400, r.error);
        t.status = 'done'; t.handledBy = actorName; t.doneAt = Date.now();
        // link the new customer id if it can be matched (most recent created)
        const cl = (await getCustomers()).slice().sort((a, b) => b.createdAt - a.createdAt)[0]; if (cl) t.customerId = cl.id;
        await saveTrialQueue(all);
        return ok({ ok: true, ...r });
      }
      if (R('POST', '/api/admin/trialq/reject')) {
        const all = await getTrialQueue(); const t = all.find((x) => x.id === String(body.id || '')); if (!t) return err(404, 'Not found.');
        t.status = 'rejected'; t.handledBy = actorName; t.doneAt = Date.now(); t.note = cleanText(body.note, 500); await saveTrialQueue(all);
        await log('trial', `Trial request rejected for ${t.email}${t.note ? ': ' + t.note : ''}`);
        return ok({ ok: true });
      }

      // ---------- IBO Player panel (spec §7) ----------
      const getIbo = async () => (await store.get('ibo')) || [];
      const saveIbo = (l) => store.put('ibo', l.slice(0, 1000));
      const iboShelf = async () => (await store.get('iboCredits')) || { credits: 0, costUsd: 3.50, purchases: [] };
      const saveIboShelf = (x) => store.put('iboCredits', x);
      const iboMsg = (ibo, kind) => {
        const t = kind === 'trial' ? `${s.trial.hours || 24}-hour free trial` : kind === 'activation' ? '1-year activation' : 'renewed';
        return [`${s.branding.appName || 'INTPROTO-TV'} · IBO Player — ${t}`,
          `Username: ${ibo.username}`, `Password: ${ibo.password}`, ibo.dns ? `DNS: ${ibo.dns}` : '',
          '', 'Open IBO Player → Settings (⚙️) → Playlist/Xtream Codes → add these credentials.',
          'Using a MAC-based device (Smart TV, STB, Formuler…)? Send us your MAC address on WhatsApp or Telegram and we will activate it for you.',
        ].filter(Boolean).join('\n');
      };
      if (R('GET', '/api/admin/ibo')) {
        const all = (await getIbo()).sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0));
        const shelf = await iboShelf();
        const now = Date.now();
        return ok({ list: all, credits: shelf.credits, costUsd: shelf.costUsd,
          stats: { total: all.length, active: all.filter((x) => !x.isTrial && (x.expiresAt || 0) > now && x.status === 'active').length, trial: all.filter((x) => x.isTrial && (x.expiresAt || 0) > now).length, expired: all.filter((x) => (x.expiresAt || 0) <= now || x.status !== 'active').length } });
      }
      if (R('GET', '/api/admin/ibo/credits')) { const shelf = await iboShelf(); return ok(shelf); }
      if (R('POST', '/api/admin/ibo/credits')) {
        const shelf = await iboShelf();
        if (body.action === 'buy') {
          const credits = Math.max(1, Number(body.credits) || 0); const price = Math.max(0, Number(body.price) || 0);
          shelf.credits = (Number(shelf.credits) || 0) + credits;
          shelf.purchases = (shelf.purchases || []).concat([{ id: uid(6), at: Date.now(), credits, priceUsd: price, by: actorName }]).slice(-50);
          await saveIboShelf(shelf); await log('ibo', `Bought ${credits} IBO credit(s) for $${price}`);
          return ok({ ok: true, credits: shelf.credits });
        }
        if (body.action === 'set') { shelf.credits = Math.max(0, Number(body.credits) || 0); await saveIboShelf(shelf); await log('ibo', `IBO credits set to ${shelf.credits}`); return ok({ ok: true, credits: shelf.credits }); }
        if (body.action === 'cost') { shelf.costUsd = Math.max(0.1, Number(body.costUsd) || 3.5); await saveIboShelf(shelf); return ok({ ok: true, costUsd: shelf.costUsd }); }
        return err(400, 'Unknown action.');
      }
      if (R('POST', '/api/admin/ibo')) {
        const name = String(body.name || '').trim().slice(0, 80); if (!name) return err(400, 'Name is required.');
        const days = body.lifetime ? 36500 : Math.max(1, Number(body.days) || 365);
        const isTrial = body.trial === true || body.trial === 'true' || days <= 7;
        const shelf = await iboShelf();
        if (!isTrial && !body.free) { if ((Number(shelf.credits) || 0) < 1) return err(400, 'No IBO credits left — buy credits on this page first.'); shelf.credits = Number(shelf.credits) - 1; await saveIboShelf(shelf); }
        const rnd = (n, ch) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => ch[x % ch.length]).join('');
        const x = { id: uid(8), name, contact: String(body.contact || '').slice(0, 120), deviceApp: String(body.deviceApp || 'IBO Player').slice(0, 60), macAddress: String(body.macAddress || '').slice(0, 40),
          username: String(body.username || '').trim() || ('ibo' + rnd(5, '0123456789')), password: String(body.password || '').trim() || rnd(8, 'abcdefghjkmnpqrstuvwxyz23456789'),
          dns: String(body.dns || '').slice(0, 200), isTrial, creditsUsed: isTrial || body.free ? 0 : 1, status: 'active',
          startAt: Date.now(), expiresAt: Date.now() + days * DAY, note: String(body.note || '').slice(0, 500), createdAt: Date.now() };
        const list = await getIbo(); list.unshift(x); await saveIbo(list);
        await log('ibo', `Added IBO ${isTrial ? 'trial' : 'client'} ${x.name} (${x.username})`);
        return ok({ ok: true, client: x });
      }
      const iboId = path.match(/^\/api\/admin\/ibo\/([\w-]+)(?:\/(\w+))?$/);
      if (iboId) {
        const list = await getIbo(); const x = list.find((y) => y.id === iboId[1]); if (!x) return err(404, 'Not found.');
        const sub = iboId[2] || '';
        if (method === 'DELETE') { await saveIbo(list.filter((y) => y !== x)); await log('ibo', `Removed IBO client ${x.name}`); return ok({ ok: true }); }
        if (method === 'PUT' && !sub) {
          for (const k of ['name', 'contact', 'deviceApp', 'macAddress', 'username', 'password', 'dns', 'note']) if (body[k] !== undefined) x[k] = String(body[k]).slice(0, k === 'note' ? 500 : 120);
          if (body.status !== undefined && ['active', 'disabled'].includes(body.status)) x.status = body.status;
          if (body.days !== undefined) { const d = Math.max(1, Number(body.days) || 365); x.expiresAt = Math.max(Date.now(), x.expiresAt || 0) + d * DAY; }
          if (body.expiresAt !== undefined) { const t = new Date(body.expiresAt).getTime(); if (!isNaN(t)) x.expiresAt = t; }
          await saveIbo(list); await log('ibo', `Updated IBO client ${x.name}`);
          return ok({ ok: true, client: x });
        }
        if (sub === 'activate' || sub === 'renew') {
          const shelf = await iboShelf(); if ((Number(shelf.credits) || 0) < 1) return err(400, 'No IBO credits left — buy credits first.');
          shelf.credits = Number(shelf.credits) - 1; await saveIboShelf(shelf);
          x.creditsUsed = (Number(x.creditsUsed) || 0) + 1; x.isTrial = false; x.status = 'active';
          x.expiresAt = Math.max(Date.now(), x.expiresAt || 0) + (sub === 'renew' && (x.expiresAt || 0) > Date.now() ? 365 * DAY : 365 * DAY);
          await saveIbo(list); await log('ibo', `${sub === 'renew' ? 'Renewed' : 'Activated'} IBO client ${x.name} (${x.username}) — 1 credit`);
          return ok({ ok: true, credits: shelf.credits, client: x });
        }
        if (sub === 'send') {
          const via = ['email', 'whatsapp', 'telegram'].includes(body.via) ? body.via : 'whatsapp';
          const kind = ['trial', 'activation', 'renew'].includes(body.kind) ? body.kind : (x.isTrial ? 'trial' : 'activation');
          const text = iboMsg(x, kind);
          if (via === 'email') {
            if (!x.contact.includes('@')) return err(400, 'No email on this client — use WhatsApp or Telegram instead.');
            const r = await sendEmail(s, cleanEmail(x.contact), `${s.branding.appName || 'INTPROTO-TV'} · IBO Player`, mailHtml(s, 'en', [['Username', x.username], ['Password', x.password], ['DNS', x.dns || ''], [x.isTrial ? 'Valid for' : 'Expires', x.isTrial ? '24 hours' : new Date(x.expiresAt).toLocaleDateString('en-GB')]], iboMsg(x, kind).split('\n').slice(3).join('\n'), x.name));
            return ok({ ok: r.ok, sent: r.ok, text });
          }
          return ok({ ok: true, sent: false, via, text, wa: String(x.contact || '').replace(/\D/g, '') });
        }
        return err(404, 'Not found.');
      }

      // ---------- Email marketing dashboard (spec §8.1) ----------
      const getMkt = async () => (await store.get('mkt')) || { keys: Array(10).fill(''), domains: Array(10).fill(''), senders: ['', '', '', '', ''], subjects: ['', '', '', '', ''], costPerEmail: 0.0004, stats: {}, perKey: {}, perDomain: {}, totalSent: 0, totalSpendUsd: 0, lastSendAt: 0 };
      const saveMkt = (m) => store.put('mkt', m);
      const mktRowsOf = (m) => (Array.isArray(m.rows) ? m.rows : rowsFromLegacy(m.keys, m.domains, []));
      const getMktLists = async () => (await store.get('mktlists')) || [];
      const getMktList = async (id) => { if (!/^[\w-]{1,20}$/.test(String(id))) return null; return store.get('mktlist:' + id); };
      const mktStats = (m) => { const cut = Date.now() - 30 * DAY; const rows = Object.entries(m.stats || {}).filter(([d]) => new Date(d).getTime() >= cut); const day = Object.entries(m.stats || {}).find(([d]) => d === new Date().toISOString().slice(0, 10))?.[1] || { sent: 0 }; return { last30: rows.reduce((a, [, v]) => a + (Number(v.sent) || 0), 0), today: Number(day.sent) || 0, byDay: Object.fromEntries(rows.slice(-14)), totalSent: Number(m.totalSent) || 0, totalSpendUsd: Math.round((Number(m.totalSpendUsd) || 0) * 100) / 100, perKey: m.perKey || {}, perDomain: m.perDomain || {} } };
      if (R('GET', '/api/admin/emailmkt')) {
        const m = await getMkt(); const lists = (await getMktLists()).map(({ id, name, count, createdAt, by }) => ({ id, name, count, createdAt, by }));
        return ok({ keysSet: mktRowsOf(m).filter((r) => r.key && r.on !== false).length, rowsTotal: mktRowsOf(m).length, senders: (m.senders || []).filter(Boolean).length, subjects: (m.subjects || []).filter(Boolean).length, costPerEmail: Number(m.costPerEmail) || 0.0004, lists, ...mktStats(m) });
      }
      if (R('GET', '/api/admin/emailmkt/settings')) { const m = await getMkt(); return ok({ html: m.html || '', locked, rows: maskRows(mktRowsOf(m)), keys: (m.keys || []).map((k) => (k ? '••••' : '')), senders: m.senders || [], subjects: m.subjects || [], costPerEmail: m.costPerEmail, ...mktStats(m) }); }
      if (R('PUT', '/api/admin/emailmkt/settings')) {
        const m = await getMkt();
        if (Array.isArray(body.rows)) { m.rows = normRows(body.rows, mktRowsOf(m)); m.keys = []; m.domains = []; }
        if (Array.isArray(body.keys) && !Array.isArray(body.rows)) m.keys = body.keys.slice(0, 10).map((k, i) => String(k || '').startsWith('••••') ? m.keys[i] || '' : String(k || ''));
        if (Array.isArray(body.domains)) m.domains = body.domains.slice(0, 10).map((d) => { const v = String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '').replace(/^\.+|\.+$/g, ''); return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(v) ? v.slice(0, 100) : ''; });
        if (Array.isArray(body.senders)) m.senders = body.senders.slice(0, 5).map((x) => cleanText(x, 80));
        if (Array.isArray(body.subjects)) m.subjects = body.subjects.slice(0, 5).map((x) => cleanText(x, 150));
        if (body.costPerEmail !== undefined) m.costPerEmail = Math.max(0, Number(body.costPerEmail) || 0.0004);
        if (body.html !== undefined) m.html = String(body.html || '').slice(0, 200000); // the campaign email agents send (locked for them)
        await saveMkt(m); await log('marketing', 'Marketing settings updated');
        return ok({ ok: true });
      }
      if (R('POST', '/api/admin/email/test-key')) { // checks one sending row: sends a test email through that key and domain
        if (!(can('secrets'))) return err(403, 'Only the owner and the Technical Manager can test API keys.');
        const scope = body.scope === 'mkt' ? 'mkt' : 'trans'; const m = scope === 'mkt' ? await getMkt() : null;
        const rows = scope === 'mkt' ? mktRowsOf(m) : transRowsOf(s); const saved = rows.find((r) => r.id === String(body.id || ''));
        const typed = String(body.key || '').trim(); const key = typed && !typed.startsWith('••••') ? typed : saved?.key || '';
        const domain = cleanDomain(body.domain) || saved?.domain || ''; const name = String(body.name || saved?.name || s.branding.appName || 'INTPROTO-TV').replace(/[<>"]/g, '').slice(0, 80);
        if (!key) return err(400, 'Paste the Resend API key first.'); if (!domain) return err(400, 'Type the domain that is verified in Resend.');
        const to = cleanEmail(body.to || s.email.adminEmail || s.email.supportEmail || ''); if (!to) return err(400, 'Add your admin email in Trial & email setup, so the test has somewhere to go.');
        let okSend = false, msg = '';
        try { const r = await fetchFn('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `${name} <noreply@${domain}>`, to: [to], subject: `Test from ${domain}`, html: `<p>This test was sent through your Resend key ••••${escHtml(key.slice(-4))} and the domain <b>${escHtml(domain)}</b>. It works.</p>` }) }); const d = await r.json().catch(() => ({})); okSend = r.ok; msg = r.ok ? 'Sent to ' + to : (d.message || 'Resend error ' + r.status); if (r.ok) await keyTrouble(key, null); else { const t = resendTrouble(r.status, msg); if (t) await keyTrouble(key, t, msg); } }
        catch (e) { msg = e.message; }
        if (saved) { saved.testAt = Date.now(); saved.testOk = okSend; saved.testMsg = msg.slice(0, 200); if (scope === 'mkt') { m.rows = rows; await saveMkt(m); } else { s.email.transRows = rows; await saveSettings(s); } }
        return okSend ? ok({ ok: true, msg }) : err(502, msg);
      }
      if (R('POST', '/api/admin/emailmkt/list')) {
        const name = cleanText(body.name, 80); if (name.length < 2) return err(400, 'List name is required.');
        const emails = String(body.text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
        const clean = [...new Set(emails.map((e) => e.toLowerCase()))];
        if (!clean.length) return err(400, 'No email addresses found in the text.');
        const bad = await getBad(); const kept = clean.filter((e) => !bad[e]); const removed = clean.length - kept.length;
        const id = uid(8); await store.put('mktlist:' + id, { id, name, emails: kept, createdAt: Date.now(), by: actorName }, 400 * 86400);
        const lists = await getMktLists(); lists.unshift({ id, name, count: kept.length, createdAt: Date.now(), by: actorName }); await store.put('mktlists', lists.slice(0, 100));
        await log('marketing', `Marketing list "${name}": ${kept.length} emails (${removed} removed as bounced/dead)`);
        return ok({ ok: true, id, count: kept.length, removed });
      }
      const mktId = path.match(/^\/api\/admin\/emailmkt\/list\/([\w-]+)(?:\/(\w+))?$/);
      if (mktId) {
        if (method === 'DELETE') { await store.del('mktlist:' + mktId[1]); const lists = (await getMktLists()).filter((l) => l.id !== mktId[1]); await store.put('mktlists', lists); return ok({ ok: true }); }
        return err(404, 'Not found.');
      }
      if (R('POST', '/api/admin/emailmkt/send')) {
        const m = await getMkt();
        const mrows = mktRowsOf(m).filter((r) => r.key && r.on !== false); const keys = mrows.map((r) => r.key);
        if (!keys.length) return err(400, 'Add at least one Resend API key (switched on) first.');
        const lists = await getMktLists(); const listRef = lists.find((l) => l.id === String(body.listId || '')); if (!listRef) return err(404, 'List not found.');
        const doc = await getMktList(listRef.id); if (!doc) return err(404, 'List not found.');
        const bad = await getBad(); const recipients = (doc.emails || []).filter((e) => !bad[e]);
        if (!recipients.length) return err(400, 'Every email on this list bounced or was removed. Upload a fresh list.');
        const senders = (m.senders || []).filter((x) => x.trim()).map((x) => x.trim()); const subjects = (m.subjects || []).filter((x) => x.trim()).map((x) => x.trim()); const domains = mrows.map((r) => r.domain);
        const app = s.branding.appName || 'INTPROTO-TV'; const fromAddr = (String(s.email.from || '').match(/<([^>]+)>/) || [])[1] || String(s.email.from || '').trim() || 'noreply@' + (String(s.email.website || 'example.com').replace(/^https?:\/\//, '').split('/')[0] || 'example.com');
        const html = (locked ? String(m.html || '') : String(body.html || m.html || '')).slice(0, 200000) || `<div style="font-family:Arial;padding:24px"><h2>${escHtml(app)}</h2><p>${escHtml(subjects[0] || 'A message from ' + app)}</p><p><a href="${escHtml(String(s.branding.supportUrl || s.email.website || ''))}">${escHtml(app)}</a></p></div>`;
        const day = new Date().toISOString().slice(0, 10); let sentCount = 0, spent = 0; const perEmail = Number(m.costPerEmail) || 0;
        const accts = await getAccounts(); let stopped = '';
        for (let i = 0; i < recipients.length; i += 100) { // Resend batch API, 100 at a time; paid keys first, a key at its limit or failing is skipped
          const bi = Math.floor(i / 100); const batch = recipients.slice(i, i + 100);
          const cands = await mailCandidates(mrows, batch.length, accts);
          if (!cands.length) { stopped = 'Every marketing key is at its plan limit or paused. Add a paid key or wait for the limit to reset.'; await log('marketing', `Marketing stopped at ${i}/${recipients.length}: ${stopped}`); break; }
          const subject = subjects.length ? subjects[bi % subjects.length] : `${app} — special offer`;
          let done = false;
          for (const row of cands.slice(0, 6)) {
          const keyIndex = mrows.indexOf(row); const key = row.key; const dom = row.domain;
          const from = `${row.name || (senders.length ? senders[bi % senders.length] : app)} <noreply@${dom || 'intproto-tv.store'}>`;
          try {
            const r = await fetchFn('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(batch.map((to) => ({ from, to: [to], subject, html }))) });
            if (r.ok) await keyUse(key, batch.length);
            if (!r.ok) { const d = await r.json().catch(() => ({})); const msg = d.message || 'Resend error ' + r.status; const t = resendTrouble(r.status, msg); await log('marketing', `Marketing batch ${bi + 1} failed on key ${keyIndex + 1}: ${msg}${t ? ' — trying the next key' : ''}`); if (t) { await keyTrouble(key, t, msg); continue; } break; }
            if (r.ok) { done = true; sentCount += batch.length; spent += batch.length * perEmail; m.stats[day] = { sent: (Number(m.stats?.[day]?.sent) || 0) + batch.length }; m.perKey = m.perKey || {}; m.perKey[keyIndex + 1] = { sent: (Number(m.perKey?.[keyIndex + 1]?.sent) || 0) + batch.length, spend: Math.round(((Number(m.perKey?.[keyIndex + 1]?.spend) || 0) + batch.length * perEmail) * 100) / 100 }; }
            break;
          } catch (e) { await log('marketing', `Marketing batch ${bi + 1} failed: ${e.message}`); }
          }
        }
        if (m.perKey) { const perKey = Object.entries(m.perKey).filter(([, v]) => v.sent).map(([k, v]) => `#${k}: ${v.sent} sent`).join(', '); await log('marketing', `Per-key sends: ${perKey}`); }
        m.totalSent = (Number(m.totalSent) || 0) + sentCount; m.totalSpendUsd = Math.round(((Number(m.totalSpendUsd) || 0) + spent) * 100) / 100; m.lastSendAt = Date.now();
        await saveMkt(m); await log('marketing', `Marketing campaign: ${sentCount}/${recipients.length} sent to "${listRef.name}" (keys rotating, ${senders.length || 1} sender name(s), ${subjects.length || 1} subject line(s))`);
        return ok({ ok: true, sent: sentCount, removed: (doc.emails || []).length - recipients.length, spendUsd: Math.round(spent * 100) / 100, stopped });
      }

      // ---------- SEO & social, Google Ads, Facebook Ads dashboards (spec §8.2–§8.4) ----------
      const sumPeriod = (entries) => { const now = Date.now(); const day0 = new Date(); day0.setHours(0, 0, 0, 0); const week0 = day0.getTime() - 6 * DAY; const month0 = day0.getTime() - 29 * DAY; const sum = (from) => entries.filter((e) => e.at >= from).reduce((a, e) => a + (Number(e.spend) || 0), 0); const cnt = (from) => entries.filter((e) => e.at >= from).length; return { today: sum(day0.getTime()), week: sum(week0), month: sum(month0), todayCount: cnt(day0.getTime()), weekCount: cnt(week0), monthCount: cnt(month0) } };
      // SEO & social posts log
      if (R('GET', '/api/admin/seo')) {
        const list = (await store.get('seo')) || [];
        const byAgent = {}; for (const e of list) byAgent[e.agent || '—'] = (byAgent[e.agent || '—'] || 0) + 1;
        const month0 = Date.now() - 29 * DAY;
        return ok({ list: list.slice(0, 300), byAgent, monthCount: list.filter((e) => e.at >= month0).length, today: list.filter((e) => new Date(e.at).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)).length, weekCount: list.filter((e) => e.at >= Date.now() - 6 * DAY).length });
      }
      if (R('POST', '/api/admin/seo')) {
        const platform = ['Reddit', 'Quora', 'Facebook'].includes(body.platform) ? body.platform : 'Reddit';
        const e = { id: uid(6), at: Date.now(), platform, title: cleanText(body.title, 200), url: cleanText(body.url, 400), agent: String(actorName).slice(0, 60), result: cleanText(body.result, 300) };
        if (e.title.length < 2) return err(400, 'Write a short title first.');
        const list = (await store.get('seo')) || []; list.unshift(e); await store.put('seo', list.slice(0, 1000));
        return ok({ ok: true, entry: e });
      }
      const seoId = path.match(/^\/api\/admin\/seo\/([\w-]+)$/); if (seoId && method === 'DELETE') { await store.put('seo', ((await store.get('seo')) || []).filter((e) => e.id !== seoId[1])); return ok({ ok: true }); }
      // Google Ads: multiple accounts, free-text domain (no predefined choices)
      const gadsDomains = async () => [...new Set((((await store.get('gads')) || { campaigns: [] }).campaigns || []).map((c) => c.domain).filter(Boolean))];
      if (R('GET', '/api/admin/gads')) {
        const g = (await store.get('gads')) || { campaigns: [], entries: [] };
        const withStats = g.campaigns.map((c) => { const ent = g.entries.filter((e) => e.campaignId === c.id); return { ...c, ...sumPeriod(ent), impressions: Math.round(ent.reduce((a, e) => a + (Number(e.impressions) || 0), 0)), clicks: Math.round(ent.reduce((a, e) => a + (Number(e.clicks) || 0), 0)), results: Math.round(ent.reduce((a, e) => a + (Number(e.results) || 0), 0)) }; });
        const all = sumPeriod(g.entries);
        return ok({ domains: (await gadsDomains()), campaigns: withStats, total: { ...all, spend: all.month } });
      }
      if (R('POST', '/api/admin/gads/campaign')) {
        const g = (await store.get('gads')) || { campaigns: [], entries: [] };
        const name = cleanText(body.name, 120); if (name.length < 2) return err(400, 'Campaign name is required.');
        const c = { id: uid(6), account: String(body.account || '').slice(0, 80), gmail: cleanEmail(body.gmail || ''), keyword: cleanText(body.keyword, 120), domain: String(body.domain || '').trim().slice(0, 120) || 'intproto-tv.store', name, dailyBudget: Number(body.dailyBudget) || 0, currency: String(body.currency || 'USD').slice(0, 8), status: ['active', 'paused', 'ended'].includes(body.status) ? body.status : 'active', startedAt: body.startedAt ? new Date(body.startedAt).getTime() : Date.now(), createdAt: Date.now() };
        g.campaigns.unshift(c); await store.put('gads', g);
        return ok({ ok: true, campaign: c });
      }
      if (R('POST', '/api/admin/gads/entry')) {
        const g = (await store.get('gads')) || { campaigns: [], entries: [] };
        const c = g.campaigns.find((x) => x.id === String(body.campaignId || '')); if (!c) return err(404, 'Campaign not found.');
        const e = { id: uid(6), at: body.at ? new Date(body.at).getTime() : Date.now(), campaignId: c.id, spend: Math.max(0, Number(body.spend) || 0), impressions: Number(body.impressions) || 0, clicks: Number(body.clicks) || 0, results: Number(body.results) || 0 };
        g.entries.unshift(e); await store.put('gads', g);
        return ok({ ok: true, entry: e });
      }
      const gadsId = path.match(/^\/api\/admin\/gads\/campaign\/([\w-]+)$/); if (gadsId && method === 'DELETE') { const g = (await store.get('gads')) || { campaigns: [], entries: [] }; g.campaigns = g.campaigns.filter((c) => c.id !== gadsId[1]); g.entries = g.entries.filter((e) => e.campaignId !== gadsId[1]); await store.put('gads', g); return ok({ ok: true }); }
      // Facebook Ads: creative history with photo + description + phone + ad account
      if (R('GET', '/api/admin/fb/att')) { const data = /^[0-9a-f]+$/.test(String(query.id || '')) ? await store.get('att:' + query.id) : null; return data ? ok({ data }) : err(404, 'This picture is no longer stored.'); }
      if (R('GET', '/api/admin/fb')) {
        const f = (await store.get('fb')) || { ads: [], entries: [] };
        const ads = f.ads.map((a) => { const ent = f.entries.filter((e) => e.adId === a.id); return { ...a, ...sumPeriod(ent), spend: ent.reduce((x, e) => x + (Number(e.spend) || 0), 0), results: ent.reduce((x, e) => x + (Number(e.results) || 0), 0) }; });
        const all = sumPeriod(f.entries);
        return ok({ ads, total: { ...all, spend: all.month } });
      }
      if (R('POST', '/api/admin/fb/ad')) {
        const f = (await store.get('fb')) || { ads: [], entries: [] };
        const description = cleanText(body.description, 500); if (description.length < 2) return err(400, 'Write a creative description first.');
        let image = ''; try { image = await saveAttachment(body.image); } catch { return err(400, 'The picture is too large or not an image.'); }
        const a = { id: uid(6), account: String(body.account || '').slice(0, 80), phone: String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 20), description, image, status: ['active', 'paused', 'archived'].includes(body.status) ? body.status : 'active', createdAt: Date.now() };
        f.ads.unshift(a); await store.put('fb', f);
        return ok({ ok: true, ad: a });
      }
      if (R('POST', '/api/admin/fb/entry')) {
        const f = (await store.get('fb')) || { ads: [], entries: [] };
        const a = f.ads.find((x) => x.id === String(body.adId || '')); if (!a) return err(404, 'Creative not found.');
        const e = { id: uid(6), at: body.at ? new Date(body.at).getTime() : Date.now(), adId: a.id, spend: Math.max(0, Number(body.spend) || 0), results: Number(body.results) || 0, reach: Number(body.reach) || 0 };
        f.entries.unshift(e); await store.put('fb', f);
        return ok({ ok: true, entry: e });
      }
      const fbId = path.match(/^\/api\/admin\/fb\/ad\/([\w-]+)$/); if (fbId && method === 'DELETE') { const f = (await store.get('fb')) || { ads: [], entries: [] }; f.ads = f.ads.filter((a) => a.id !== fbId[1]); f.entries = f.entries.filter((e) => e.adId !== fbId[1]); await store.put('fb', f); return ok({ ok: true }); }

      // ---------- attendance, shifts, leave, tasks, team chat, reports (spec §9) ----------
      const getShifts = async () => (await store.get('shifts')) || [];
      const getLeaves = async () => (await store.get('leaves')) || [];
      const getTasks = async () => (await store.get('tasks')) || [];
      const attSummary = (events, since) => {
        const per = {}; // by id
        const add = (id, k, v) => { (per[id] ||= { logins: 0, ins: 0, outs: 0, breaksMs: 0, workedMs: 0, events: 0 })[k] += v || 1; };
        for (const e of events) { if (since && e.at < since) continue; const p = per[e.by] ||= { logins: 0, ins: 0, outs: 0, breaksMs: 0, workedMs: 0, events: 0 }; p.events++;
          if (e.action === 'login') p.logins++; else if (e.action === 'in') p.ins++; else if (e.action === 'out') p.outs++; }
        // pair in→out for worked time and break time, per person, in time order
        const by = {}; for (const e of events) { if (since && e.at < since) continue; (by[e.by] ||= []).push(e); }
        for (const id of Object.keys(by)) { const evs = by[id].slice().sort((a, b) => a.at - b.at); let openIn = null, openBreak = null;
          for (const e of evs) { if (e.action === 'in') openIn = e.at; else if (e.action === 'out') { if (openIn) { per[id].workedMs += e.at - openIn; openIn = null; } } else if (e.action === 'break_start') openBreak = e.at; else if (e.action === 'break_end' && openBreak) { per[id].breaksMs += e.at - openBreak; openBreak = null; } } }
        return per;
      };
      const meWorks = () => (isOwner ? { id: 'owner', name: actorName.replace(' (owner)', '') || 'Owner' } : { id: member ? member.id : '', name: actorName });
      const aliasName = (member && member.alias) ? member.alias : (member ? (member.name || member.username) : 'Owner'); // western alias shown to customers; logs keep the real name
      const scopeSelf = (l) => { const me = meWorks(); return isOwner || can('attendance_all') ? l : l.filter((x) => x.by === me.id || (isOwner && x.by === 'owner') || (member && x.by === member.id) || (!isOwner && !member)); };
      if (R('GET', '/api/admin/attendance')) {
        const since = Date.now() - 35 * DAY; const events = (await getAtt()).filter((e) => e.at >= since);
        const all = isOwner || can('attendance_all');
        const mine = scopeSelf(events);
        const sum = attSummary(events, since);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todaySum = attSummary(events.filter((e) => e.at >= today.getTime()));
        return ok({ mine: mine.slice(-200).reverse(), all: all ? events.slice(-200).reverse() : null, summary: sum, today: todaySum, scopeAll: all });
      }
      if (R('POST', '/api/admin/attendance')) {
        const action = ['in', 'out', 'break_start', 'break_end'].includes(body.action) ? body.action : null; if (!action) return err(400, 'Unknown action.');
        const me = meWorks(); await attLog(me.id, me.name, action, body.note);
        if ((action === 'in' || action === 'out') && notifyCfg(s).shifts) { const team = await getTeam(); const to = ['owner', ...team.filter((m) => m.id !== me.id && m.status !== 'disabled' && (m.perms || []).includes('attendance_all')).map((m) => 'm:' + m.id)].filter((w) => w !== (me.id === 'owner' ? 'owner' : ''));
          await pushTo(s, to, { title: action === 'in' ? `🟢 ${me.name} started the shift` : `⚪ ${me.name} ended the shift`, body: action === 'in' ? `Checked in${body.note ? ' · ' + cleanText(body.note, 80) : ''}. Tap to see the team attendance.` : `Checked out${body.note ? ' · ' + cleanText(body.note, 80) : ''}.`, tag: 'shift-' + me.id, url: '/intprototv?tab=attendance' }).catch(() => {}); }
        return ok({ ok: true });
      }
      const attM = path.match(/^\/api\/admin\/attendance\/(\w+)$/);
      if ((attM || path === '/api/admin/attendance/add') && !isOwner && !can('attendance_all')) return err(403, 'Only the owner or a team manager can edit attendance.');
      if (R('POST', '/api/admin/attendance/add')) { // owner adds a missing check-in / check-out for an agent
        const action = ['in', 'out', 'break_start', 'break_end'].includes(body.action) ? body.action : null; const at = new Date(body.at).getTime(); if (!action || !isFinite(at)) return err(400, 'Choose the action and the time.');
        const team = await getTeam(); const m = team.find((x) => x.id === body.memberId); if (!m) return err(400, 'Choose the agent.');
        const l = await getAtt(); l.push({ id: uid(6), by: m.id, name: m.name, at, action, note: cleanText(body.note || 'added by ' + actorName, 300), edited: actorName }); l.sort((a, b) => a.at - b.at); await store.put('attendance', l.slice(-1500));
        await log('team', `Attendance: ${action} added for ${m.name} at ${new Date(at).toISOString()}`); return ok({ ok: true });
      }
      if (attM && (method === 'PUT' || method === 'DELETE')) {
        const l = await getAtt(); const e = l.find((x) => x.id === attM[1]); if (!e) return err(404, 'Not found');
        if (method === 'DELETE') { await store.put('attendance', l.filter((x) => x !== e)); await log('team', `Attendance: ${e.action} of ${e.name} deleted`); return ok({ ok: true }); }
        if (body.at !== undefined) { const at = new Date(body.at).getTime(); if (!isFinite(at)) return err(400, 'Bad time.'); e.at = at; }
        if (body.action && ['in', 'out', 'break_start', 'break_end', 'login'].includes(body.action)) e.action = body.action;
        if (body.note !== undefined) e.note = cleanText(body.note, 300);
        e.edited = actorName; l.sort((a, b) => a.at - b.at); await store.put('attendance', l); await log('team', `Attendance: ${e.name} ${e.action} edited`); return ok({ ok: true });
      }
      if (path.startsWith('/api/admin/workplan')) {
        const wp = workPlanOf(s); const team = await getTeam(); const me0 = member;
        const dayKey = (ms) => { const L = localNow(wp.tz); void L; const d = new Date(ms); const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: wp.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
        const wdOf = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
        if (R('GET', '/api/admin/workplan')) {
          const today = dayKey(Date.now()); const ref = /^\d{4}-\d{2}-\d{2}$/.test(String(query.week || '')) ? query.week : today; const r0 = new Date(ref + 'T12:00:00Z'); const mon = new Date(r0.getTime() - ((r0.getUTCDay() + 6) % 7) * DAYMS);
          const week = Array.from({ length: 7 }, (_, i) => new Date(mon.getTime() + i * DAYMS).toISOString().slice(0, 10));
          const checks = {}; for (const d of week) checks[d] = (await store.get('plancheck:' + d)) || {};
          const who = isOwner || can('attendance_all') ? team.filter((m) => m.status !== 'disabled').map((m) => ({ id: m.id, name: m.name || m.username })) : [{ id: me0.id, name: me0.name }];
          const mine = (d) => (isOwner || can('attendance_all') ? checks[d] : { [me0.id]: checks[d][me0.id] || {} });
          const now = new Date(); const L = localNow(wp.tz); const meets = [0, 1].map((k) => meetDate(wp.meet, now.getUTCFullYear(), now.getUTCMonth() + k)).filter((d) => d >= today);
          return ok({ plan: wp, week, today, nowMin: L.min, checks: Object.fromEntries(week.map((d) => [d, mine(d)])), who, canEdit: isOwner, nextMeet: wp.meet.on ? meets[0] || null : null, me: me0 ? me0.id : 'owner' });
        }
        if (R('POST', '/api/admin/workplan/check')) { // an agent checks off one of today's tasks (or yesterday's, if forgotten)
          if (!me0) return err(400, 'The owner does not check off tasks.'); const d = String(body.date || ''); const today = dayKey(Date.now()); const yest = dayKey(Date.now() - DAYMS);
          if (d !== today && d !== yest) return err(400, 'You can check off today’s tasks (or yesterday’s).'); const sl = wp.slots.find((x) => x.id === body.slot); if (!sl || sl.noCheck) return err(400, 'Unknown task.');
          const c = (await store.get('plancheck:' + d)) || {}; c[me0.id] = c[me0.id] || {};
          if (body.done === false) delete c[me0.id][sl.id]; else c[me0.id][sl.id] = { at: Date.now(), note: cleanText(body.note, 200) };
          await store.put('plancheck:' + d, c, 400 * 86400);
          const url = wp.sheetUrl || s.accountsSheet; if (url) { const task = (wp.days[wdOf(d)] || {})[sl.id] || ''; fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ sheet: 'Agent Work Planning', append: true, header: ['Date', 'Day', 'Time', 'Activity', 'Task', 'Agent', 'Done', 'Checked at', 'Note'], rows: [[d, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wdOf(d)], sl.start + '–' + sl.end, sl.title, task, me0.name || me0.username, body.done === false ? 'NO' : 'YES', new Date().toISOString(), cleanText(body.note, 200)]] }) }).catch(() => {}); }
          return ok({ ok: true, done: body.done !== false });
        }
        if (R('PUT', '/api/admin/workplan')) { // owner only: the schedule structure, tasks per day, rules, meeting, time zone, Google Sheet
          if (!isOwner) return err(403, 'Only the owner edits the work planning.');
          const w = workPlanOf(s); const hm = (x) => (/^\d{2}:\d{2}$/.test(String(x || '')) ? x : null);
          if (Array.isArray(body.slots)) { const sl = body.slots.slice(0, 16).map((x, i) => ({ id: cleanText(x.id, 8) || 's' + uid(3), start: hm(x.start) || '09:00', end: hm(x.end) || '10:00', title: cleanText(x.title, 120), icon: cleanText(x.icon, 4) || '•', tab: cleanText(x.tab, 20), noCheck: !!x.noCheck })).filter((x) => x.title); if (sl.length) w.slots = sl; }
          if (isObj(body.days)) { const dd = {}; for (const k of ['0', '1', '2', '3', '4', '5', '6']) { const v = body.days[k] || {}; dd[k] = Object.fromEntries(Object.entries(v).slice(0, 16).map(([a, b]) => [cleanText(a, 8), cleanText(b, 200)]).filter(([, b]) => b)); } w.days = dd; }
          if (Array.isArray(body.rules)) w.rules = body.rules.map((x) => cleanText(x, 400)).filter(Boolean).slice(0, 12);
          if (isObj(body.meet)) w.meet = { on: body.meet.on !== false, weekday: Math.min(6, Math.max(0, Number(body.meet.weekday) || 0)), nth: Math.min(4, Math.max(1, Number(body.meet.nth) || 1)), time: hm(body.meet.time) || '20:00', title: cleanText(body.meet.title, 80) || 'Management Meet Party' };
          if (body.tz) { try { new Intl.DateTimeFormat('en', { timeZone: body.tz }); w.tz = body.tz; } catch { return err(400, 'Unknown time zone.'); } }
          if (body.sheetUrl !== undefined) { const u = String(body.sheetUrl || '').trim(); if (u && !/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) return err(400, 'Paste the Apps Script web app link (https://script.google.com/macros/s/…/exec).'); w.sheetUrl = u; }
          await saveSettings({ ...s, workPlan: w }); await log('team', 'Work planning updated by the owner'); return ok(w);
        }
        if (R('POST', '/api/admin/workplan/sheet')) { // owner: send the planning + this week's check-offs to Google Sheets
          if (!isOwner) return err(403, 'Owner only.'); const url = wp.sheetUrl || s.accountsSheet; if (!url) return err(400, 'Add your Google Sheets (Apps Script) link first.');
          const today = dayKey(Date.now()); const r0 = new Date(today + 'T12:00:00Z'); const mon = new Date(r0.getTime() - ((r0.getUTCDay() + 6) % 7) * DAYMS); const rows = [];
          for (let i = 0; i < 7; i++) { const d = new Date(mon.getTime() + i * DAYMS).toISOString().slice(0, 10); const c = (await store.get('plancheck:' + d)) || {}; const wd = wdOf(d);
            for (const sl of wp.slots) for (const m of team.filter((x) => x.status !== 'disabled')) { const k = (c[m.id] || {})[sl.id]; rows.push([d, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd], sl.start + '–' + sl.end, sl.title, (wp.days[wd] || {})[sl.id] || '', m.name || m.username, sl.noCheck ? '—' : k ? 'YES' : 'NO', k ? new Date(k.at).toISOString() : '', k?.note || '']); } }
          let r; try { r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ sheet: 'Agent Work Planning', header: ['Date', 'Day', 'Time', 'Activity', 'Task', 'Agent', 'Done', 'Checked at', 'Note'], rows }) }); } catch (e) { return err(502, 'Google Sheets could not be reached: ' + e.message); }
          if (!r.ok) return err(502, 'Google Sheets answered ' + r.status + '.'); return ok({ rows: rows.length });
        }
        return err(404, 'Not found');
      }
      if (R('GET', '/api/admin/holidays/upcoming')) { const hr = { ...HOLIDAY_REMIND_DEF, ...(s.holidayRemind || {}) }; const list = holidayCalendar(Date.now(), hr.custom).slice(0, 40).map((h) => ({ ...h, daysLeft: Math.ceil((h.at - Date.now()) / DAYMS) })); return ok({ cfg: hr, list, next: list.filter((h) => h.daysLeft >= 0 && h.daysLeft <= Math.max(...hr.days, 7)) }); }
      if (R('PUT', '/api/admin/holidays/remind')) { // owner / technical service: reminder days and own dates
        if (!can('templates_edit') && !can('holidays')) return err(403, 'Only the owner and the Technical Service change the holiday reminders.');
        const hr = { ...HOLIDAY_REMIND_DEF, ...(s.holidayRemind || {}) }; if (body.on !== undefined) hr.on = !!body.on;
        if (Array.isArray(body.days)) hr.days = [...new Set(body.days.map((d) => Math.round(Number(d))).filter((d) => d >= 0 && d <= 60))].slice(0, 4);
        if (Array.isArray(body.custom)) hr.custom = body.custom.slice(0, 40).map((c) => ({ id: cleanText(c.id, 10) || uid(5), name: cleanText(c.name, 80), date: String(c.date || '').slice(0, 10), kind: SEASON[c.kind] ? c.kind : 'evergreen', region: cleanText(c.region, 30), tip: cleanText(c.tip, 200) })).filter((c) => c.name && /^\d{4}-\d{2}-\d{2}$/.test(c.date));
        await saveSettings({ ...s, holidayRemind: hr }); await log('marketing', 'Holiday reminders updated'); return ok(hr); }
      if (R('GET', '/api/admin/waiting')) { // who is waiting right now (sounds in the panel)
        const tk = await getTickets(); const ch = await getChats(); const rc = await getReceipts(); const tq = await getTrialQueue(); const list = await getCustomers();
        const lastFrom = (t) => { const m = t.messages || []; return m.length ? m[m.length - 1].from : ''; };
        const sup = tk.filter((t) => t.status !== 'closed' && t.status !== 'resolved' && lastFrom(t) === 'customer');
        return ok({ support: sup.length, supportNew: sup.filter((t) => (t.messages || []).length <= 1).length, chat: ch.reduce((a, x) => a + (Number(x.ua) || 0), 0), trials: tq.filter((t) => t.status === 'pending').length, waitLine: list.filter((c) => c.pendingLine).length, receipts: rc.filter((r) => r.status === 'pending').length, buy: list.filter((c) => c.buyRequest && !c.buyRequest.answeredAt).length, at: Date.now() });
      }
      if (R('GET', '/api/admin/shifts')) return ok((await getShifts()));
      if (R('PUT', '/api/admin/shifts')) {
        const l = await getShifts(); const memberId = String(body.memberId || '').slice(0, 20); if (!memberId) return err(400, 'memberId required.');
        const idx = l.findIndex((x) => x.memberId === memberId);
        const tz = String(body.tz || 'Europe/Paris').slice(0, 40);
        const days = {}; for (const k of ['0', '1', '2', '3', '4', '5', '6']) { const d = (body.days || {})[k]; if (d && d.on) days[k] = { on: true, start: Math.max(0, Math.min(1440, Number(d.start) || 540)), end: Math.max(0, Math.min(1440, Number(d.end) || 1080)) }; else days[k] = { on: false }; }
        const rec = { memberId, memberName: String(body.memberName || memberId).slice(0, 60), tz, days, daysOff: Array.isArray(body.daysOff) ? body.daysOff.map(Number).filter((n) => n >= 0 && n <= 6) : [], updatedAt: Date.now(), by: actorName };
        if (idx >= 0) l[idx] = rec; else l.unshift(rec);
        await store.put('shifts', l.slice(0, 200)); await log('team', `Shift plan updated for ${rec.memberName}`);
        return ok({ ok: true });
      }
      if (R('GET', '/api/admin/leaves')) {
        const l = (await getLeaves()).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.createdAt - a.createdAt);
        const mine = isOwner || can('attendance_all');
        const me = meWorks();
        return ok({ list: (mine ? l : l.filter((x) => x.by === me.id)).slice(0, 200), pending: l.filter((x) => x.status === 'pending').length, mine: !mine });
      }
      if (R('POST', '/api/admin/leaves')) {
        const kind = ['vacation', 'sick', 'emergency', 'other'].includes(body.kind) ? body.kind : 'vacation';
        const from = new Date(body.from).getTime(), to = new Date(body.to || body.from).getTime();
        if (!isFinite(from) || !isFinite(to) || to < from) return err(400, 'Invalid dates.');
        const me = meWorks(); const reason = cleanText(body.reason, 500);
        const l = await getLeaves(); l.unshift({ id: uid(6), by: me.id, name: me.name, kind, from, to, reason, status: 'pending', createdAt: Date.now(), decidedBy: '', decidedAt: 0 });
        await store.put('leaves', l.slice(0, 300));
        await pushOwner(s, { url: '/intprototv?tab=holidays', title: `🗓 Leave request: ${me.name}`, body: `${kind} · ${new Date(from).toLocaleDateString('en-GB')} → ${new Date(to).toLocaleDateString('en-GB')}`, tag: 'leave-' + me.id });
        await notifyAdmin(s, `Leave request: ${me.name}`, `${me.name} asked for ${kind} leave from ${new Date(from).toLocaleDateString()} to ${new Date(to).toLocaleDateString()}${reason ? '\n' + reason : ''}`);
        return ok({ ok: true });
      }
      if (R('POST', '/api/admin/leaves/decide')) {
        const l = await getLeaves(); const x = l.find((y) => y.id === String(body.id || '')); if (!x) return err(404, 'Not found.');
        if (!['approved', 'rejected'].includes(body.action)) return err(400, 'Unknown action.');
        x.status = body.action; x.decidedBy = actorName; x.decidedAt = Date.now(); x.reason = cleanText(body.resolution, 300);
        await store.put('leaves', l); await log('team', `Leave ${body.action}: ${x.name} (${x.kind})`);
        return ok({ ok: true });
      }
      if (R('GET', '/api/admin/tasks')) {
        const l = (await getTasks()).sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0) || b.updatedAt - a.updatedAt);
        const me = meWorks(); const mine = me.id;
        const visible = isOwner || can('attendance_all') ? l : l.filter((t) => t.assignee === mine);
        return ok({ list: visible.slice(0, 300), mine: visible.filter((t) => t.assignee === mine), mineId: mine, scopeAll: isOwner || can('attendance_all') });
      }
      if (R('POST', '/api/admin/tasks')) {
        if (!isOwner && !can('attendance_all')) return err(403, 'Only the owner or a manager can assign tasks.');
        const l = await getTasks();
        const t = { id: uid(6), name: cleanText(body.name, 160), desc: cleanText(body.desc, 1000), assignee: String(body.assignee || 'owner').slice(0, 20), assigneeName: String(body.assigneeName || body.assignee || 'Owner').slice(0, 60), start: body.start ? new Date(body.start).getTime() : Date.now(), deadline: body.deadline ? new Date(body.deadline).getTime() : null, priority: ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal', status: 'not_started', notes: '', createdBy: actorName, createdAt: Date.now(), updatedAt: Date.now(), doneAt: 0 };
        if (t.name.length < 2) return err(400, 'Task name is required.');
        l.unshift(t); await store.put('tasks', l.slice(0, 500)); await log('team', `Task assigned: "${t.name}" → ${t.assigneeName}`);
        return ok({ ok: true, task: t });
      }
      const taskId = path.match(/^\/api\/admin\/tasks\/([\w-]+)$/);
      if (taskId) {
        const l = await getTasks(); const t = l.find((y) => y.id === taskId[1]); if (!t) return err(404, 'Not found.');
        if (method === 'DELETE') { if (!isOwner) return err(403, 'Only the owner can delete tasks.'); await store.put('tasks', l.filter((y) => y !== t)); return ok({ ok: true }); }
        if (method === 'PUT' || method === 'PATCH') {
          const mine = meWorks(); const canEdit = isOwner || can('attendance_all') || t.assignee === mine.id;
          if (!canEdit) return err(403, 'You can only update your own tasks.');
          if (body.status && ['not_started', 'in_progress', 'completed', 'delayed', 'blocked'].includes(body.status)) { t.status = body.status; if (body.status === 'completed') t.doneAt = Date.now(); }
          if (body.notes !== undefined) t.notes = cleanText(body.notes, 2000);
          if (isOwner || can('attendance_all')) { if (body.name !== undefined) t.name = cleanText(body.name, 160); if (body.desc !== undefined) t.desc = cleanText(body.desc, 1000); if (body.assignee !== undefined) { t.assignee = String(body.assignee).slice(0, 20); t.assigneeName = String(body.assigneeName || body.assignee).slice(0, 60); } if (body.priority !== undefined) t.priority = String(body.priority); if (body.deadline !== undefined) t.deadline = body.deadline ? new Date(body.deadline).getTime() : null; if (body.start !== undefined) t.start = new Date(body.start).getTime(); }
          t.updatedAt = Date.now(); await store.put('tasks', l); return ok({ ok: true, task: t });
        }
        return err(404, 'Not found.');
      }
      if (R('GET', '/api/admin/reports')) { // owner-only performance summary per member (spec §9.6)
        const since = Date.now() - Math.max(1, Math.min(90, Number(query.days) || 30)) * DAY;
        const events = await getAtt(), tasks = await getTasks();
        const summary = attSummary(events, since);
        const members = {};
        for (const e of events) if (e.at >= since) members[e.by] = members[e.by] || { id: e.by, name: e.name };
        for (const m of Object.values(members)) { const t = tasks.filter((x) => x.assignee === m.id); m.tasksTotal = t.length; m.completed = t.filter((x) => x.status === 'completed').length; m.delayed = t.filter((x) => x.status === 'delayed').length; m.blocked = t.filter((x) => x.status === 'blocked').length; m.adherence = m.tasksTotal ? Math.round((m.completed / m.tasksTotal) * 100) : null; m.workedMs = Math.round((summary[m.id]?.workedMs || 0)); m.breaksMs = Math.round((summary[m.id]?.breaksMs || 0)); m.logins = summary[m.id]?.logins || 0;
          const perf = m.tasksTotal ? (m.completed * 100 - m.delayed * 15 - m.blocked * 20) / m.tasksTotal : null; m.score = perf === null ? null : Math.max(0, Math.round(perf)); }
        return ok({ list: Object.values(members).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), since });
      }
      if (R('GET', '/api/admin/teamchat')) { const l = (await store.get('teamchat')) || []; return ok(l.slice(-120)); }
      if (R('POST', '/api/admin/teamchat')) { const text = cleanText(body.text, 1000); if (!text) return err(400, 'Write a message first.'); const me = meWorks(); const l = (await store.get('teamchat')) || []; l.push({ id: uid(6), by: me.id, name: me.name, at: Date.now(), text }); await store.put('teamchat', l.slice(-300)); return ok({ ok: true }); }

      // ---------- CC Collection (spec §5): full metadata + card status, owner-only ----------
      const getCc = async () => (await store.get('ccnotes')) || [];
      const saveCc = (l) => store.put('ccnotes', l.slice(0, 1000));
      if (R('GET', '/api/admin/cc')) {
        const list = (await getCc()).sort((a, b) => b.at - a.at);
        return ok({ list, liveCount: list.filter((x) => x.status === 'live').length, declinedCount: list.filter((x) => x.status === 'declined').length, deadCount: list.filter((x) => x.status === 'dead').length });
      }
      if (R('POST', '/api/admin/cc')) {
        const status = ['live', 'declined', 'dead'].includes(body.status) ? body.status : 'live';
        const rec = { id: uid(8), at: Date.now(), by: actorName, fullName: cleanText(body.fullName, 80), email: cleanEmail(body.email || ''), phone: cleanText(body.phone, 40), address: cleanText(body.address, 300), cardNumber: String(body.cardNumber || '').replace(/\D/g, '').slice(0, 16), exp: String(body.exp || '').replace(/[^0-9]/g, '').slice(0, 6), cvv: String(body.cvv || '').replace(/\D/g, '').slice(0, 4), notes: cleanText(body.notes || '', 300), status };
        if (!rec.fullName) return err(400, 'Full name is required.');
        if (rec.cardNumber.length !== 16) return err(400, 'Card number must be 16 digits.');
        const list = await getCc(); list.unshift(rec); await saveCc(list);
        await log('finance', `CC Collection: ${rec.fullName} · ${rec.status}`);
        return ok({ ok: true, record: rec });
      }
      const ccId = path.match(/^\/api\/admin\/cc\/([\w-]+)$/);
      if (ccId && method === 'DELETE') { const list = (await getCc()).filter((x) => x.id !== ccId[1]); await saveCc(list); await log('finance', 'CC Collection entry removed'); return ok({ ok: true }); }
      if (ccId && method === 'PUT') {
        const list = await getCc(); const idx = list.findIndex((x) => x.id === ccId[1]); if (idx === -1) return err(404, 'Not found.');
        const rec = list[idx];
        if (body.fullName !== undefined) rec.fullName = cleanText(body.fullName, 80);
        if (body.email !== undefined) rec.email = cleanEmail(body.email || '');
        if (body.phone !== undefined) rec.phone = cleanText(body.phone, 40);
        if (body.address !== undefined) rec.address = cleanText(body.address, 300);
        if (body.cardNumber !== undefined) { const cn = String(body.cardNumber || '').replace(/\D/g, '').slice(0, 16); if (cn.length !== 16) return err(400, 'Card number must be 16 digits.'); rec.cardNumber = cn; }
        if (body.exp !== undefined) rec.exp = String(body.exp || '').replace(/[^0-9]/g, '').slice(0, 6);
        if (body.cvv !== undefined) rec.cvv = String(body.cvv || '').replace(/\D/g, '').slice(0, 4);
        if (body.notes !== undefined) rec.notes = cleanText(body.notes, 300);
        if (body.status !== undefined) { if (!['live', 'declined', 'dead'].includes(body.status)) return err(400, 'Card status must be Live, Declined or Dead.'); rec.status = body.status; }
        if (!rec.fullName) return err(400, 'Full name is required.');
        rec.at = Date.now(); list[idx] = rec; await saveCc(list); return ok({ ok: true, record: rec });
      }

      if (R('GET', '/api/admin/chats')) return ok(await getChats());
      if (R('GET', '/api/admin/chat')) { const cu = (await getCustomers()).find((x) => x.id === query.id); if (!cu) return err(404, 'Customer not found.'); const ch = await chatRead(cu.id, 'a'); return ok({ id: cu.id, name: cu.name, username: cu.username, messages: ch.messages }); }
      if (R('POST', '/api/admin/chat')) {
        const cu = (await getCustomers()).find((x) => x.id === body.id); if (!cu) return err(404, 'Customer not found.');
        const text = cleanText(body.text, 1000); if (!text) return err(400, 'Write a message first.');
        const { ch } = await chatAdd(cu, 's', aliasName, text);
        if (notifyCfg(s).customers) await pushTo(s, 'c:' + cu.id, { title: tx(okLang(cu.lang), 'pushReplyT'), body: text.slice(0, 160), url: '/profile', tag: 'chat' }).catch(() => {});
        return ok({ id: cu.id, name: cu.name, username: cu.username, messages: ch.messages });
      }
      if (R('GET', '/api/admin/tickets')) return ok((await getTickets()).sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.updatedAt - a.updatedAt));
      if (R('GET', '/api/admin/tickets/att')) { const data = /^[0-9a-f]+$/.test(String(query.id || '')) ? await store.get('att:' + query.id) : null; return data ? ok({ data }) : err(404, 'This picture is no longer stored.'); }
      if (R('POST', '/api/admin/tickets/reply')) {
        const all = await getTickets(); const tk = all.find((x) => x.id === String(body.id || ''));
        if (!tk) return err(404, 'Ticket not found.');
        const text = cleanText(body.text, 2000);
        let att = ''; try { att = await saveAttachment(body.image); } catch { return err(400, 'The picture is too large or not an image.'); }
        if (text || att) { tk.messages.push({ from: 'staff', by: aliasName, at: Date.now(), text, ...(att ? { att } : {}) }); tk.status = 'answered'; }
        if (text && tk.contact?.email && !tk.customerId) { // support-page ticket from someone without an account: the answer goes by email
          const lang = okLang(tk.contact.lang); const H = { en: 'Answer to your request', fr: 'Réponse à votre demande', de: 'Antwort auf Ihre Anfrage', es: 'Respuesta a tu solicitud', it: 'Risposta alla tua richiesta' }[lang];
          const m = newsletterEmail(s, { name: tk.contact.name, lang }, { split: false, lang, badge: '🛟 ' + (tk.ref || ''), content: { all: { subject: `${H} ${tk.ref || ''}: ${tk.subject}`, title: H, body: text, button: '' } }, link: '' }, '', '');
          const r = await sendEmail(s, tk.contact.email, m.subject, m.html); tk.messages[tk.messages.length - 1].emailed = !!r.ok; }
        if (['open', 'answered', 'closed'].includes(body.status)) tk.status = body.status;
        if (['low', 'normal', 'high'].includes(body.priority)) tk.priority = body.priority;
        tk.updatedAt = Date.now(); await saveTickets(all);
        await log('support', `Ticket "${tk.subject}" (${tk.username}): ${text ? 'answered' : tk.status}`);
        if (text && tk.customerId && notifyCfg(s).customers) { const cu = (await getCustomers()).find((x) => x.id === tk.customerId); const lg = okLang(cu?.lang); await pushTo(s, 'c:' + tk.customerId, { title: tx(lg, 'pushReplyT'), body: tk.subject + ' — ' + tx(lg, 'pushReplyB'), url: '/profile', tag: 'tk-' + tk.id }).catch(() => {}); }
        return ok({ ok: true, ticket: tk });
      }
      if (R('GET', '/api/admin/payments')) { // card fraud risk heuristic (spec §2): high = unmatched customer, medium = unclear package or cross-domain email, else low
        const list = (await getPayments()).slice(0, 100);
        const withRisk = list.map((p) => {
          let risk = 'low', riskReason = 'Matched to customer and package';
          if (p.status === 'unmatched') { risk = 'high'; riskReason = 'No customer matches this payment (chargeback risk)'; }
          else if (p.status === 'needs_attention') { risk = 'medium'; riskReason = 'Package unclear or panel refused — renewing is manual'; }
          else if (Number(p.amount) >= 150) { risk = 'medium'; riskReason = 'Large amount — confirm recipient before renewing'; }
          return { ...p, risk, riskReason };
        });
        return ok({ list: withRisk, configured: /whsec_/.test(String(s.finance.stripeWebhookSecrets || '')) });
      }
      if (R('POST', '/api/admin/me/password')) {
        if (isOwner) return err(400, 'Use Account & backup.');
        const team = await getTeam(); const me = team.find((x) => x.id === member.id);
        if ((await hashPassword(body.current || '', me.salt)) !== me.hash) return err(400, 'Current password is wrong.');
        if (String(body.next || '').length < 6) return err(400, 'New password needs 6+ characters.');
        me.salt = uid(8); me.hash = await hashPassword(body.next, me.salt); await store.put('team', team);
        await log('team', `${me.username} changed their password`);
        return ok({ ok: true });
      }
      // ----- team (owner only) -----
      if (R('GET', '/api/admin/team')) return ok((await getTeam()).map(({ salt, hash, ...m }) => m));
      if (R('POST', '/api/admin/team')) {
        const team = await getTeam();
        const username = String(body.username || '').trim();
        if (username.length < 3 || String(body.password || '').length < 6) return err(400, 'Username needs 3+ characters and password 6+.');
        const taken = team.some((x) => x.username.toLowerCase() === username.toLowerCase()) || (await getCustomers()).some((x) => x.username.toLowerCase() === username.toLowerCase()) || (await getAdmin()).username.toLowerCase() === username.toLowerCase();
        if (taken) return err(400, 'This username is already used.');
        const salt = uid(8);
        const m = { id: uid(6), name: String(body.name || username), username, role: String(body.role || 'Staff'), salt, hash: await hashPassword(body.password, salt), perms: (body.perms || []).filter((p) => GRANTABLE_KEYS.includes(p)), status: 'active', alias: String(body.alias || '').slice(0, 40), bank: ['CIH', 'IBAN', 'US', 'other'].includes(body.bank) ? body.bank : '', bankDetails: String(body.bankDetails || '').slice(0, 120), lang: ['en', 'fr', 'de', 'es', 'it', 'ar'].includes(body.lang) ? body.lang : 'en', notifyEmail: String(body.notifyEmail || '').slice(0, 120), traineeUntil: body.trainee ? Date.now() + 14 * DAY : (Number(body.traineeUntil) || 0), createdAt: Date.now(), lastLogin: null };
        team.push(m); await store.put('team', team);
        await log('team', `Added team member ${m.name} (${username})`);
        const { salt: _s, hash: _h, ...pub } = m; return ok(pub);
      }
      const tm = path.match(/^\/api\/admin\/team\/(\w+)$/);
      if (tm) {
        const team = await getTeam(); const m = team.find((x) => x.id === tm[1]);
        if (!m) return err(404, 'Not found');
        if (method === 'DELETE') { await store.put('team', team.filter((x) => x !== m)); await log('team', `Removed team member ${m.name}`); return ok({ ok: true }); }
        if (method === 'PUT') {
          if (body.name !== undefined) m.name = String(body.name).slice(0, 80);
          if (body.role !== undefined) m.role = String(body.role).slice(0, 60);
          if (body.alias !== undefined) m.alias = String(body.alias).slice(0, 40);
          if (body.bank !== undefined) m.bank = ['CIH', 'IBAN', 'US', 'other'].includes(body.bank) ? body.bank : '';
          if (body.bankDetails !== undefined) m.bankDetails = String(body.bankDetails).slice(0, 120);
          if (body.lang !== undefined && ['en', 'fr', 'de', 'es', 'it', 'ar'].includes(body.lang)) m.lang = body.lang;
          if (body.notifyEmail !== undefined) m.notifyEmail = cleanEmail(body.notifyEmail) || String(body.notifyEmail || '').trim().toLowerCase().slice(0, 120);
          if (body.promote) m.traineeUntil = 0;
          else if (body.traineeUntil !== undefined) m.traineeUntil = Number(body.traineeUntil) || 0;
          if (body.trainee) m.traineeUntil = Date.now() + 14 * DAY;
          if (Array.isArray(body.perms)) m.perms = body.perms.filter((p) => GRANTABLE_KEYS.includes(p));
          if (body.status) m.status = body.status === 'disabled' ? 'disabled' : 'active';
          if (body.password) { if (String(body.password).length < 6) return err(400, 'Password needs 6+ characters.'); m.salt = uid(8); m.hash = await hashPassword(body.password, m.salt); }
          await store.put('team', team); await log('team', `Updated team member ${m.name}${body.promote ? ' · promoted to active' : ''}`);
          const { salt, hash, ...pub } = m; return ok(pub);
        }
      }

      if (R('GET', '/api/admin/settings')) {
        const maskStripe = (src) => ({ ...src, stripeAccounts: (src.stripeAccounts || []).map((a) => ({ ...a, rk: a.rk ? '••••' : '' })) });
        const maskPanel = (src) => ({ ...src, panel: Object.fromEntries(Object.entries(src.panel || {}).map(([k, v]) => [k, { ...v, apiKey: v.apiKey ? '••••' : '', password: v.password ? '••••' : '' }])) });
        const maskKeys = (src) => ({
          ...src,
          reseller: { ...src.reseller, baseUrl: src.reseller.baseUrl ? '••••' : '', apiKey: src.reseller.apiKey ? '••••' : '', username: src.reseller.username ? '••••' : '', password: src.reseller.password ? '••••' : '', actions: Object.fromEntries(Object.entries(src.reseller.actions || {}).map(([k, v]) => [k, { ...v, url: v.url && /api_key=|\{key\}/.test(v.url) ? '••••' : '••••', headers: '••••' }])) },
          email: { ...src.email, resendKey: src.email.resendKey ? '••••' : '', transKeys: (src.email.transKeys || []).map((k) => (k ? '••••' : '')), transRows: maskRows(transRowsOf(src)), transSenders: src.email.transSenders || [], transSubjects: src.email.transSubjects || [] },
          finance: { ...src.finance, stripeKey: src.finance.stripeKey ? '••••' : '', stripeWebhookSecrets: src.finance.stripeWebhookSecrets ? '••••' : '' },
          telegram: { ...src.telegram, botToken: src.telegram?.botToken ? '••••' : '', webhookSecret: src.telegram?.webhookSecret ? '••••' : '' },
        });
        if (can('settings')) {
          const isTm = can('secrets');
          if (isTm) return ok({ ...maskStripe(s), email: { ...s.email, transRows: maskRows(transRowsOf(s)) } }); // Nizar & Khalil: full access (sending keys shown as ••••last 4)
          return ok(maskPanel(maskKeys(maskStripe(s)))); // Other staff: everything masked (panel creds too)
        }
        return ok(maskPanel(maskStripe({ ...s, reseller: { ...s.reseller, baseUrl: '', apiKey: '', password: '', actions: {} }, email: { ...s.email, resendKey: '' }, finance: { ...s.finance, stripeWebhookSecrets: s.finance.stripeWebhookSecrets ? '••••' : '', stripeKey: s.finance.stripeKey ? '••••' : '' }, security: { sessionHours: s.security.sessionHours } })));
      }
      if (R('PUT', '/api/admin/settings')) {
        // Absolute sovereignty (spec §1): only Nizar (Owner) and Khalil (Technical Manager) may show, add, edit or update
        // IPTV panel keys, Resend keys, Stripe keys and other API credentials. Everyone else is locked out at the API level.
        const API_KEY_PATHS = [['panel', 'dino'], ['panel', 'xtream'], ['panel', 'mega'], ['reseller', 'baseUrl'], ['reseller', 'apiKey'], ['reseller', 'username'], ['reseller', 'password'], ['reseller', 'actions'], ['email', 'resendKey'], ['email', 'from'], ['finance', 'stripeKey'], ['finance', 'stripeWebhookSecrets'], ['telegram', 'botToken'], ['telegram', 'webhookSecret']];
        const touchesKey = API_KEY_PATHS.some(([a, b]) => body?.[a] && (Array.isArray(body[a]) ? body[a].some((x) => Object.keys(x || {}).some((k) => k === b)) : Object.keys(body[a] || {}).some((k) => k === b)));
        const isTm = can('secrets');
        if (touchesKey && !isTm) return err(403, 'Only the owner and the Technical Manager can change API keys.');
        if (body?.finance?.stripeKey === '••••') delete body.finance.stripeKey;
        if (body?.finance?.stripeWebhookSecrets === '••••') delete body.finance.stripeWebhookSecrets;
        if (body?.email?.resendKey === '••••') delete body.email.resendKey;
        if (body?.telegram?.botToken === '••••') delete body.telegram.botToken;
        if (body?.telegram?.webhookSecret === '••••') delete body.telegram.webhookSecret;
        if (body?.reseller?.apiKey === '••••') delete body.reseller.apiKey;
        if (body?.reseller?.password === '••••') delete body.reseller.password;
        if (body?.reseller?.username === '••••') delete body.reseller.username;
        if (body?.reseller?.baseUrl === '••••') delete body.reseller.baseUrl;
        if (body?.panel) for (const k of Object.keys(body.panel)) { const v = body.panel[k]; if (v && typeof v === 'object' && (v.apiKey === '••••' || v.password === '••••' || v.baseUrl === '••••')) { if (v.apiKey === '••••') delete v.apiKey; if (v.password === '••••') delete v.password; if (v.baseUrl === '••••') delete v.baseUrl; } }
        if (body?.finance?.stripeWebhookSecrets === '••••') delete body.finance.stripeWebhookSecrets;
        let newRows = null;
        if (body?.email && Array.isArray(body.email.transRows)) { if (!isTm) return err(403, 'Only the owner and the Technical Manager can change API keys.'); newRows = normRows(body.email.transRows, transRowsOf(s)); delete body.email.transRows; }
        const next = deepMerge(s, body || {});
        if (isObj(body.orders)) { const q = { ...(s.orders || {}), ...body.orders }; const pf = (x, d) => (/^[A-Za-z]{1,10}$/.test(String(x || '').trim()) ? String(x).trim() : d);
          next.orders = { prefix: pf(q.prefix, 'WLF'), iboPrefix: pf(q.iboPrefix, 'IBO'), rslPrefix: pf(q.rslPrefix, 'RLS'), pad: Math.max(1, Math.min(6, Number(q.pad) || 3)), devPad: 2 }; next.orders.series = [next.orders.prefix, next.orders.iboPrefix, next.orders.rslPrefix].join(','); }
        if (isObj(body.promo)) { const q = { ...(s.promo || {}), ...body.promo }; const day = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : '');
          next.promo = { on: !!q.on, name: String(q.name || 'Black Friday').trim().slice(0, 40) || 'Black Friday', code: String(q.code || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 30), offer: String(q.offer || '').trim().slice(0, 60), from: day(q.from), to: day(q.to), email: q.email !== false, whatsapp: q.whatsapp !== false, telegram: q.telegram !== false }; }
        if (isObj(body.payRoute)) { const ids = new Set((s.stripeAccounts || []).map((a) => a.id)); next.payRoute = { accounts: (Array.isArray(body.payRoute.accounts) ? body.payRoute.accounts : []).map(String).filter((x) => ids.has(x)).slice(0, 20), rotate: body.payRoute.rotate !== false }; }
        if (isObj(body.renewModels)) { const q = { ...RENEW_DEF, ...(s.renewModels || {}), ...body.renewModels }; const okM = (m) => (RENEW_MODELS[m] || m === 'off' ? m : 'm1');
          next.renewModels = { auto: q.auto !== false, code: cleanText(q.code, 40).replace(/\s+/g, ''), discount: cleanText(q.discount, 12), amount: cleanText(q.amount, 20), d7: okM(q.d7), today: okM(q.today), expired: okM(q.expired), expiredDays: Math.min(120, Math.max(1, Number(q.expiredDays) || 30)) }; }
        if (isObj(body.iboPromo)) { const q = { ...IBO_PROMO_DEF, ...(s.iboPromo || {}), ...body.iboPromo }; next.iboPromo = { on: q.on !== false, email: q.email !== false, whatsapp: q.whatsapp !== false, price: Math.max(0, Number(q.price) || 5.99), delayMin: Math.min(1440, Math.max(0, Math.round(Number(q.delayMin ?? 60) || 0))), pkg: String(q.pkg || 'ibo1y').slice(0, 30), everyDays: Math.max(1, Math.min(365, Number(q.everyDays) || 30)) }; }
        if (isObj(body.notify)) { const q = { ...notifyCfg(s), ...body.notify }; const b = (k) => q[k] !== false && q[k] !== 'false';
          next.notify = { tickets: b('tickets'), trials: b('trials'), receipts: b('receipts'), shifts: b('shifts'), shiftReminders: b('shiftReminders'), oversight: b('oversight'), customers: b('customers'), resellers: b('resellers'), autoPromo: q.autoPromo === true, promoDays: Math.max(1, Math.min(60, Math.round(Number(q.promoDays) || 7))), watch: (Array.isArray(q.watch) ? q.watch : []).map(String).filter((x) => /^[\w-]{1,20}$/.test(x)).slice(0, 50) }; }
        if (isObj(body.support)) { const q = { ...(s.support || {}), ...body.support }; const em = cleanEmail(q.email);
          next.support = { email: em || 'contact@intproto-tv.com', waLink: q.waLink !== false, alertEmails: String(q.alertEmails || '').split(/[\s,;]+/).map(cleanEmail).filter(Boolean).slice(0, 25).join(', ') }; }
        if (newRows) { next.email.transRows = newRows; next.email.transKeys = []; next.email.transDomains = []; }
        next.security.proxySecret = s.security.proxySecret;
        if (Array.isArray(body.waNumbers)) { // business WhatsApp numbers by purpose; the "main" one is the app's number
          next.waNumbers = body.waNumbers.slice(0, 20).map((w) => ({ id: /^[\w-]{1,20}$/.test(String(w.id || '')) ? String(w.id) : uid(5), label: cleanText(w.label, 40), number: String(w.number || '').replace(/\D/g, '').replace(/^00/, '').slice(0, 16), use: ['main', 'support', 'sales', 'resellers', 'other'].includes(w.use) ? w.use : 'other', on: w.on !== false })).filter((w) => w.number.length >= 8);
          const main = next.waNumbers.find((w) => w.use === 'main' && w.on) || next.waNumbers.find((w) => w.on); if (main) next.branding.whatsapp = main.number;
        }
        next.branding.whatsapp = String(next.branding.whatsapp || '').replace(/\D/g, '');
        if (next.branding.whatsapp && (!next.branding.supportUrl || /wa\.me\//.test(next.branding.supportUrl))) { next.branding.supportUrl = 'https://wa.me/' + next.branding.whatsapp; if (!next.branding.supportLabel || next.branding.supportLabel === 'Contact support') next.branding.supportLabel = 'WhatsApp'; }
        if (Array.isArray(body.plans)) next.plans = body.plans.map((p) => ({
          id: p.id || 'p' + uid(3), name: String(p.name || 'Plan'), days: Math.max(1, Number(p.days) || 30),
          price: Number(p.price) || 0, connections: Math.max(1, Number(p.connections) || 1), package: String(p.package || ''),
          credits: p.credits === '' || p.credits == null ? Math.max(1, Math.round((Number(p.days) || 30) / 30)) : Number(p.credits),
        }));
        if (Array.isArray(body.orderPackages)) next.orderPackages = body.orderPackages.map((p) => ({ id: p.id || 'o' + uid(3), title: String(p.title || 'Package'), days: Math.max(1, Number(p.days) || 30), devices: Math.max(1, Number(p.devices) || 1), price: Number(p.price) || 0, badge: String(p.badge || ''), link: '' }));
        if (Array.isArray(body.stripeAccounts)) { // multi-account Stripe panel (spec §6): accounts, status, payout schedule, package links
          const oldSa = new Map((s.stripeAccounts || []).map((a) => [a.id, a]));
          next.stripeAccounts = body.stripeAccounts.slice(0, 20).map((a) => {
            const id = String(a.id || uid(6)).replace(/[^\w-]/g, '').slice(0, 24) || uid(6);
            const o = oldSa.get(id) || {};
            return {
              id, name: String(a.name || 'Account').slice(0, 80),
              currency: ['USD', 'EUR'].includes(String(a.currency || '').toUpperCase()) ? String(a.currency).toUpperCase() : 'USD',
              status: ['active', 'verification', 'closed'].includes(a.status) ? a.status : 'active',
              payoutDays: Number(a.payoutDays) === 2 ? 2 : 7,
              bankId: String(a.bankId || o.bankId || '').slice(0, 24),
              balance: (a.balance === '' || a.balance == null) ? (o.balance ?? null) : Number(a.balance) || 0,
              balanceAt: (a.balanceAt === '') ? (o.balanceAt ?? 0) : (Number(a.balanceAt) || 0),
              note: String(a.note || '').slice(0, 200),
              rk: a.rk === '••••' ? (o.rk || '') : String(a.rk || '').slice(0, 200),
              links: (Array.isArray(a.links) ? a.links : []).slice(0, 50).map((l) => ({
                id: String(l.id || uid(6)).replace(/[^\w-]/g, '').slice(0, 12) || uid(6),
                label: String(l.label || 'Link').slice(0, 80),
                url: String(l.url || '').slice(0, 400),
                currency: ['USD', 'EUR'].includes(String(l.currency || '').toUpperCase()) ? String(l.currency).toUpperCase() : 'USD',
                tier: ['Normal', 'Resellers', 'IBO'].includes(l.tier) ? l.tier : 'Normal',
              })).filter((l) => /^https?:\/\//.test(l.url)),
            };
          });
        }
        // Templates are replaced as a whole, so removing a change brings the built-in wording back.
        if (isObj(body.mailTexts)) next.mailTexts = cleanMailTexts(body.mailTexts);
        if (isObj(body.waTemplates)) { next.waTemplates = {}; for (const ty of Object.keys(WA_TPL)) for (const lg of LANG_CODES) { const v = body.waTemplates?.[ty]?.[lg]; if (typeof v === 'string' && v.trim() && v !== WA_TPL[ty][lg]) (next.waTemplates[ty] ||= {})[lg] = v.slice(0, 3000); } }
        if (Array.isArray(body.waCustom)) next.waCustom = body.waCustom.slice(0, 30).map((x) => ({ id: String(x.id || uid(4)).replace(/[^\w]/g, '').slice(0, 12) || uid(4), name: String(x.name || 'Message').slice(0, 40), text: { en: String(x.text?.en || '').slice(0, 3000), fr: String(x.text?.fr || '').slice(0, 3000), ar: String(x.text?.ar || '').slice(0, 3000) } })).filter((x) => x.text.en || x.text.fr || x.text.ar);
        if (Array.isArray(body.resellerPayMethods)) next.resellerPayMethods = body.resellerPayMethods.map((x) => String(x || '').replace(/[<>]/g, '').trim().slice(0, 60)).filter(Boolean).slice(0, 12);
        if (Array.isArray(body.resellerPackages)) next.resellerPackages = body.resellerPackages.map((p) => ({ id: p.id || 'r' + uid(3), name: String(p.name || 'Package'), credits: Math.max(1, Number(p.credits) || 1), price: Number(p.price) || 0 }));
        if (Array.isArray(body.finance?.accounts)) next.finance.accounts = body.finance.accounts.map((a) => ({ id: a.id || 'a' + uid(3), name: String(a.name || 'Account'), currency: String(a.currency || 'USD').toUpperCase(), opening: Number(a.opening) || 0, color: a.color || '#7c5cff' }));
        await saveSettings(next);
        await log('settings', 'Settings updated: ' + Object.keys(body || {}).join(', '));
        return ok(next);
      }

      // ---------- Accounts (Resend / email marketing / Hostinger / Dynu): only the owner, Khalil and Nizar (permission 'secrets') ----------
      if (R('GET', '/api/admin/paylink')) { // the payment link the panel offers for a package (allowed accounts, rotation)
        const pk = [...s.orderPackages, ...(s.resellerPackages || [])].find((p) => p.id === String(query.pkg || '')); if (!pk) return err(400, 'Choose a package.');
        const n = await nextPayLink(s, pk, String(query.cur || '') || 'USD', query.peek === '1');
        return ok(n ? { url: n.url, acc: n.acc, accName: n.accName, label: n.label, currency: n.cur, options: n.options, otherCurrency: n.otherCurrency } : { url: '', none: true });
      }
      if (R('GET', '/api/admin/paylinks/check')) { // for every package and currency: which link is used, and the problems to fix in Stripe
        const r = payRoute(s); const rows = [];
        for (const pk of [...s.orderPackages, ...(s.resellerPackages || [])]) for (const cur of ['USD', 'EUR']) { const c = payCandidates(s, pk, cur); rows.push({ pkg: pk.id, name: pk.title || pk.name, cur, links: c.list.map((x) => ({ label: x.label, acc: x.accName, cur: x.cur, url: x.url })), otherCurrency: c.otherCurrency }); }
        return ok({ route: r, accounts: (s.stripeAccounts || []).map((a) => ({ id: a.id, name: a.name, status: a.status, links: (a.links || []).length })), rows, problems: payLinkProblems(s) });
      }
      if (R('POST', '/api/admin/appmail')) { // app download email (all devices): one customer, one reseller, or a group (bulk = owner & technical service)
        const list = await getCustomers(); const rs0 = await getResellers(); const now = Date.now(); let to = [];
        if (body.customerId) to = list.filter((c) => c.id === body.customerId); else if (body.resellerId) to = rs0.filter((r) => r.id === body.resellerId).map((r) => ({ ...r, lang: r.lang || 'en' }));
        else { if (!can('marketing')) return err(403, 'Only the owner and the Technical Service can email a whole group.'); if (!['active', 'trial', 'all', 'resellers'].includes(body.audience)) return err(400, 'Choose who gets it.'); const aud = String(body.audience); to = aud === 'resellers' ? rs0.filter((r) => r.status !== 'paused') : list.filter((c) => c.status !== 'disabled' && !c.unsub && (aud === 'all' || (aud === 'trial' ? c.isTrial : c.expiresAt > now && !c.isTrial))); }
        to = to.filter((x) => cleanEmail(x.email)); if (!to.length) return err(400, 'Nobody with an email address.'); if (to.length > 500) return err(400, 'Too many at once (max 500).');
        let sent = 0, failed = 0; for (const x of to) { const m = appDownloadEmail(s, x, body.appUrl); const r = await sendEmail(s, cleanEmail(x.email), m.subject, m.html); if (r.ok) sent++; else failed++; }
        await log('marketing', `App download email sent to ${sent}${failed ? ` (${failed} failed)` : ''}${to.length === 1 ? ' · ' + (to[0].username || to[0].rslId || to[0].name) : ''}`); return ok({ sent, failed });
      }
      if (R('GET', '/api/admin/renewmodels')) return ok({ cfg: renewCfg(s), code: renewCode(s), models: Object.entries(RENEW_MODELS).map(([id, m]) => ({ id, icon: m.icon, name: m.name, subject: m.en.s })) });
      if (R('GET', '/api/admin/renewmodels/preview')) { // preview of a model for one customer (or a sample), in a language
        const list = await getCustomers(); const real = list.find((x) => x.id === String(query.id || ''));
        const sample = real || { id: 'sample', name: 'Sarah Example', username: 'sample', email: 'sarah@example.com', lang: okLang(query.lang), connections: 1, expiresAt: Date.now() + ({ m2: 5 * 3600000, m3: -2 * DAYMS }[query.model] ?? 7 * DAYMS), planId: '' };
        const c1 = { ...sample, lang: query.lang ? okLang(query.lang) : sample.lang }; const model = RENEW_MODELS[query.model] ? query.model : 'm1';
        return ok(renewModelEmail(s, c1, model, await renewLinkFor(s, c1, model, true), query.appUrl)); }
      if (R('POST', '/api/admin/renewmodels/send')) { // send a model now: to one customer, a test to you, or a group
        const model = RENEW_MODELS[body.model] ? body.model : ''; if (!model) return err(400, 'Choose a model.');
        if (body.test) { const to = cleanEmail(body.to) || cleanEmail(s.email.adminEmail); if (!to) return err(400, 'Add your admin email first.'); const c1 = { id: 'test', name: 'Sarah Example', username: 'sample', email: to, lang: okLang(body.lang), connections: 1, expiresAt: Date.now() + 7 * DAYMS }; const m = renewModelEmail(s, c1, model, await renewLinkFor(s, c1, model, true), body.appUrl); const r = await sendEmail(s, to, '[TEST] ' + m.subject, m.html); return r.ok ? ok({ sent: 1, to }) : err(502, r.error || 'Email failed'); }
        const list = await getCustomers(); const now = Date.now(); const aud = String(body.audience || '');
        const pickA = { one: (c) => c.id === String(body.id || ''), d7: (c) => c.expiresAt > now && c.expiresAt - now <= 7 * DAYMS, today: (c) => c.expiresAt > now && c.expiresAt - now <= DAYMS, expired: (c) => c.expiresAt <= now && now - c.expiresAt <= 30 * DAYMS, expired90: (c) => c.expiresAt <= now && now - c.expiresAt <= 90 * DAYMS }[aud];
        if (!pickA) return err(400, 'Choose who gets it.');
        const to = list.filter((c) => !c.isTrial && !c.rsOrder && c.status !== 'disabled' && pickA(c)); if (!to.length) return err(400, 'Nobody matches.');
        if (to.length > 300) return err(400, `${to.length} customers — too many at once (max 300).`);
        let sent = 0, failed = 0; for (const c of to) { const r = await sendRenewModel(s, c, model, body.appUrl); if (r.ok) { sent++; markSent(c, 'email'); } else failed++; } await saveCustomers(list);
        return ok({ sent, failed, people: to.length }); }
      if (R('POST', '/api/admin/app-notify')) { // a notification in the customer's app (inbox) + on their phone if notifications are on
        const title = cleanText(body.title, 120), text = cleanText(body.body, 600); if (!title && !text) return err(400, 'Write a title or a message.');
        const aud = String(body.audience || 'one'); const list = await getCustomers(); const now = Date.now(); const warn = Number(s.userDashboard.expiryWarningDays) || 7;
        const pickF = { one: (c) => c.id === String(body.id || ''), all: (c) => c.status !== 'disabled', active: (c) => c.status !== 'disabled' && c.expiresAt >= now && !c.isTrial, expiring: (c) => c.status !== 'disabled' && c.expiresAt >= now && c.expiresAt - now <= warn * DAYMS, expired: (c) => c.status !== 'disabled' && c.expiresAt < now, trials: (c) => c.status !== 'disabled' && c.isTrial }[aud];
        if (!pickF) return err(400, 'Choose who gets it.');
        const to = list.filter(pickF); if (!to.length) return err(400, 'Nobody matches.'); if (to.length > 5000) return err(400, 'Too many people at once.');
        const n0 = { title: title || (s.branding.appName || 'INTPROTO-TV'), body: text, url: /^\/[\w\/-]*$/.test(String(body.url || '')) ? body.url : '/profile?go=inbox' };
        for (const c of to) { const inbox = Array.isArray(c.inbox) ? c.inbox : []; inbox.unshift({ id: uid(6), at: now, ...n0, by: actorName }); c.inbox = inbox.slice(0, 30); }
        await saveCustomers(list);
        const subs = await getSubs(); const want = new Set(to.map((c) => 'c:' + c.id)); let devices = 0;
        if (subs.some((x) => want.has(x.who))) { const r = await pushTo(s, (w) => want.has(w), { ...n0, tag: 'note-' + uid(4) }); devices = r.devices; }
        await log('customer', `App notification "${n0.title}" to ${aud === 'one' ? to[0].username : to.length + ' customers (' + aud + ')'} · ${devices} phone(s)`);
        return ok({ people: to.length, devices });
      }
      if (R('POST', '/api/admin/push/promo')) { // promotion reminder for packages (customers) or credits (resellers), on their devices
        const aud = ['inactive', 'active', 'trials', 'customers', 'resellers', 'all'].includes(body.audience) ? body.audience : 'inactive';
        const custom = !locked && (body.title || body.body) ? { title: cleanText(body.title, 120), body: cleanText(body.body, 300), url: /^\/[\w\/-]*$/.test(String(body.url || '')) ? body.url : '' } : null;
        const r = await sendPromo(s, aud, custom); await log('marketing', `Promotion notification (${aud}) sent to ${r.people} people on ${r.devices} device(s)`); return ok(r);
      }
      if (R('GET', '/api/admin/push/devices')) { // who gets notifications (labels only)
        const subs = await getSubs(); const team = await getTeam(); const cnt = (p) => subs.filter((x) => x.who.startsWith(p)).length;
        const people = [['owner', 'Owner'], ...team.map((m) => ['m:' + m.id, m.name || m.username])].map(([w, n]) => ({ who: w, name: n, devices: subs.filter((x) => x.who === w).map((x) => ({ label: x.label, at: x.at, last: x.last })) }));
        return ok({ team: people, customers: cnt('c:'), resellers: cnt('r:'), settings: notifyCfg(s), members: team.map((m) => ({ id: m.id, name: m.name || m.username, role: m.role || '' })) });
      }
      if (R('GET', '/api/admin/email/status')) { // every agent can see this: plan, use and health of each sending key (never the key itself)
        try { await rowsToAccounts(s); } catch {}
        const sec = can('secrets'); const accts = await getAccounts(); const u = (await store.get('keyuse')) || {}; const h = (await store.get('keyhealth')) || {};
        const mo = new Date().toISOString().slice(0, 7), dy = new Date().toISOString().slice(0, 10), now = Date.now();
        const mk = await store.get('mkt') || {}; const mkRows = Array.isArray(mk.rows) ? mk.rows : [];
        const one = (r, i, use) => { const f = keyFp(r.key); const x = u[f] || {}; const p = keyPlan(r, accts); const hh = h[f]; const month = x.months?.[mo] || 0, today = x.day === dy ? x.days || 0 : 0;
          const limited = (p.quota && month >= p.quota) || (p.daily && today >= p.daily);
          const state = r.on === false ? 'off' : hh && hh.until > now ? 'paused' : limited ? 'limit' : p.quota && month >= p.quota * 0.85 ? 'almost' : 'ok';
          return { n: i + 1, use, label: r.name || (use === 'marketing' ? 'Marketing key ' : 'Sending key ') + (i + 1), domain: sec ? r.domain || '' : '', key: sec ? '••••' + String(r.key).slice(-4) : '', tier: p.tier, plan: p.name, price: p.price, quota: p.quota, daily: p.daily, paid: p.paid, planFrom: p.from,
            month, today, total: x.total || 0, left: p.quota ? Math.max(0, p.quota - month) : null, leftToday: p.daily ? Math.max(0, p.daily - today) : null, pct: p.quota ? Math.min(100, Math.round(month / p.quota * 1000) / 10) : null,
            ...(sec ? (() => { const a = accts.find((y) => y.apiKey === r.key); return { accountId: a?.id || '', accountName: a?.name || '', login: a?.email || '', hasPassword: !!a?.password, url: a?.url || '', domains: a?.domains || (r.domain ? [r.domain] : []), paidUntil: a?.plan?.paidUntil || '', planPaid: !!a?.plan?.paid, note: a?.note || '' }; })() : {}),
            state, why: state === 'paused' ? hh.why : state === 'limit' ? (p.daily && today >= p.daily ? 'Daily limit reached — sends again tomorrow' : 'Monthly limit reached — sends again next month') : '', until: state === 'paused' ? hh.until : 0, last: x.last || 0, lastError: hh && hh.why ? { why: hh.why, at: hh.at, msg: sec ? hh.msg : '' } : null }; };
        const rows = [...transRowsOf(s).filter((r) => r.key).map((r, i) => one(r, i, 'customer')), ...mkRows.filter((r) => r.key).map((r, i) => one(r, i, 'marketing'))];
        const live = (use) => rows.filter((r) => r.use === use && (r.state === 'ok' || r.state === 'almost'));
        const sum = (list, f) => list.reduce((t, r) => t + (f(r) || 0), 0);
        const cap = (use) => { const l = live(use); return l.some((r) => !r.quota) ? null : sum(l, (r) => r.left); };
        const sum1 = { keys: rows.length, working: rows.filter((r) => r.state === 'ok' || r.state === 'almost').length, paused: rows.filter((r) => r.state === 'paused' || r.state === 'limit').length, paidKeys: rows.filter((r) => r.paid).length, freeKeys: rows.filter((r) => r.tier === 'free').length, unsetKeys: rows.filter((r) => r.tier === 'unset').length,
          month: sum(rows, (r) => r.month), today: sum(rows, (r) => r.today), quota: sum(rows, (r) => r.quota), fees: Math.round(sum(rows.filter((r) => r.paid), (r) => r.price) * 100) / 100, leftCustomer: cap('customer'), leftMarketing: cap('marketing') };
        const status = !rows.length ? 'none' : !live('customer').length && rows.some((r) => r.use === 'customer') ? 'down' : sum1.paused ? 'warn' : 'ok';
        return ok({ rows, summary: sum1, status, sheet: sec ? !!s.accountsSheet : undefined, tiers: Object.fromEntries(Object.entries(MAIL_TIERS).filter(([k]) => k !== 'unset')), canEdit: sec, month: mo });
      }
      if (R('GET', '/api/admin/accounts')) {
        const a = await accRows(await getAccounts()); const tr = transRowsOf(s); const mk = ((await store.get('mkt')) || {}).rows || [];
        const known = new Set((await getAccounts()).map((x) => x.apiKey).filter(Boolean)); const loose = [...tr, ...mk].filter((r) => r.key && !known.has(r.key)).length;
        return ok({ ...a, kinds: ACC_KINDS, plans: ACC_PLANS, sheetUrl: s.accountsSheet || '', looseKeys: loose, head: ACC_HEAD });
      }
      if (R('POST', '/api/admin/accounts/save')) {
        const list = await getAccounts(); let a = body.id ? list.find((x) => x.id === String(body.id)) : null;
        if (body.id && !a) return err(404, 'Account not found.');
        const v = accClean(body, a || {}); if (!v.name) return err(400, 'Give the account a name.');
        if (v.apiKey && v.kind === 'resend' && !/^re_\w{8,}/.test(v.apiKey)) return err(400, 'A Resend API key starts with re_');
        if (v.apiKey && list.some((x) => x !== a && x.apiKey === v.apiKey)) return err(409, 'This API key is already in another account.');
        if (a) Object.assign(a, v, { updatedAt: Date.now(), by: actorName }); else { a = { id: uid(6), ...v, createdAt: Date.now(), updatedAt: Date.now(), by: actorName }; list.push(a); }
        const oldKey = body.id ? (await getAccounts()).find((x) => x.id === a.id)?.apiKey : '';
        await saveAccounts(list); await log('security', `Account "${a.name}" (${ACC_KINDS[a.kind]}) ${body.id ? 'changed' : 'added'} by ${actorName}`);
        if (mailKind(a)) { if (oldKey && oldKey !== a.apiKey) { const { trows, mk, mrows } = await mailRowsAll(s); for (const r of [...trows, ...mrows]) if (r.key === oldKey) r.key = a.apiKey; await saveMailRows(s, trows, mk, mrows); } await accountsToRows(s); }
        return ok({ account: (await accRows([a])).rows[0] });
      }
      if (R('POST', '/api/admin/accounts/delete')) {
        const list = await getAccounts(); const a = list.find((x) => x.id === String(body.id || '')); if (!a) return err(404, 'Account not found.');
        await saveAccounts(list.filter((x) => x !== a)); await log('security', `Account "${a.name}" deleted by ${actorName}`);
        if (body.removeKey && a.apiKey) await accountsToRows(s, a.apiKey); return ok({ ok: true });
      }
      if (R('POST', '/api/admin/accounts/import-keys')) { // the sending keys already in Email settings / Email marketing become accounts
        const list = await getAccounts(); const have = new Set(list.map((x) => x.apiKey).filter(Boolean)); let n = 0;
        const add = (r, use) => { if (!r.key || have.has(r.key)) return; have.add(r.key); n++; list.push({ id: uid(6), ...accClean({ kind: 'resend', name: r.name || (r.domain ? 'Resend · ' + r.domain : 'Resend key'), apiKey: r.key, domains: r.domain ? [r.domain] : [], use, tier: 'free' }), createdAt: Date.now(), updatedAt: Date.now(), by: actorName }); };
        for (const r of transRowsOf(s)) add(r, 'customer'); for (const r of ((await store.get('mkt')) || {}).rows || []) add(r, 'marketing');
        await saveAccounts(list); await log('security', `${n} sending key(s) added to Accounts by ${actorName}`); return ok({ added: n });
      }
      if (R('POST', '/api/admin/accounts/resend-domains')) { // what Resend says about the domains of this key, with the DNS records it needs
        const a = (await getAccounts()).find((x) => x.id === String(body.id || '')); if (!a?.apiKey) return err(400, 'This account has no API key.');
        const H = { Authorization: 'Bearer ' + a.apiKey };
        let r, d; try { r = await fetchFn('https://api.resend.com/domains', { headers: H }); d = await r.json().catch(() => ({})); } catch (e) { return err(502, 'Resend could not be reached: ' + e.message); }
        if (!r.ok) return err(502, 'Resend: ' + (d.message || 'error ' + r.status));
        const out = [];
        for (const dm of (d.data || []).slice(0, 10)) { let recs = []; try { const x = await fetchFn('https://api.resend.com/domains/' + encodeURIComponent(dm.id), { headers: H }); const j = await x.json().catch(() => ({})); recs = (j.records || []).map((q) => ({ record: q.record, name: q.name, type: q.type, value: q.value, priority: q.priority, status: q.status, ttl: q.ttl })); } catch {} out.push({ id: dm.id, name: dm.name, status: dm.status, region: dm.region, records: recs }); }
        return ok({ domains: out });
      }
      if (R('POST', '/api/admin/email/plan')) { // quick switch: free trial ⇄ paid plan (account and its sending key together)
        const list = await getAccounts(); const a = list.find((x) => x.id === String(body.id || '')); if (!a) return err(404, 'Account not found.');
        if (!ACC_PLANS[body.tier]) return err(400, 'Choose a plan.');
        const was = a.plan?.tier; Object.assign(a, accClean({ tier: body.tier, paid: body.tier !== 'free', price: body.price, quota: body.quota, paidUntil: body.paidUntil }, a), { updatedAt: Date.now(), by: actorName });
        await saveAccounts(list); await accountsToRows(s);
        await log('security', `Email account "${a.name}": plan ${ACC_PLANS[was]?.name || was || '—'} → ${ACC_PLANS[a.plan.tier].name}${a.plan.price ? ' ($' + a.plan.price + ')' : ''} by ${actorName}`);
        return ok({ account: (await accRows([a])).rows[0] });
      }
      if (R('POST', '/api/admin/email/sending')) { // switch a key on or off for sending
        const list = await getAccounts(); const a = list.find((x) => x.id === String(body.id || '')); if (!a) return err(404, 'Account not found.');
        a.sending = body.on !== false; a.updatedAt = Date.now(); await saveAccounts(list); await accountsToRows(s);
        await log('security', `Email account "${a.name}" ${a.sending ? 'switched on' : 'switched off'} for sending by ${actorName}`); return ok({ ok: true });
      }
      if (R('POST', '/api/admin/accounts/hostinger')) { // what is on the Hostinger account: websites, domains, subscriptions
        const a = (await getAccounts()).find((x) => x.id === String(body.id || '')); if (!a?.apiKey) return err(400, 'Add the Hostinger API token to this account first (hPanel → Profile → API).');
        const H = { Authorization: 'Bearer ' + a.apiKey, accept: 'application/json' }; const get = async (p) => { try { const r = await fetchFn('https://developers.hostinger.com' + p, { headers: H }); const j = await r.json().catch(() => ({})); if (!r.ok) return { error: j.message || j.error || 'Hostinger answered ' + r.status, status: r.status }; return { data: Array.isArray(j) ? j : j.data || [] }; } catch (e) { return { error: e.message }; } };
        const [w, d, b] = [await get('/api/hosting/v1/websites?per_page=100'), await get('/api/domains/v1/portfolio'), await get('/api/billing/v1/subscriptions')];
        if (w.status === 401 || d.status === 401) return err(400, 'Hostinger refused the token. Make a new API token in hPanel → Profile → API and paste it in this account.');
        await log('security', `Hostinger account "${a.name}" checked by ${actorName}`);
        return ok({ websites: (w.data || []).map((x) => ({ domain: x.domain, enabled: x.is_enabled, type: x.website_type || x.vhost_type || '', username: x.username || '', created: x.created_at })), domains: (d.data || []).map((x) => ({ domain: x.domain, status: x.status, type: x.type, expires: x.expires_at })), subscriptions: (b.data || []).map((x) => ({ name: x.name, status: x.status, price: x.total_price, renew: x.renewal_price, currency: x.currency_code, expires: x.expires_at, auto: x.is_auto_renewed })), errors: [w.error, d.error, b.error].filter(Boolean) });
      }
      if (R('POST', '/api/admin/accounts/dynu-list')) { // the domains in the Dynu account, and their DNS records
        const a = (await getAccounts()).find((x) => x.id === String(body.id || '')); if (!a?.apiKey) return err(400, 'Add the Dynu API key to this account first (Dynu Control Panel → API Credentials).');
        const H = { 'API-Key': a.apiKey, accept: 'application/json' }; let r, j;
        try { r = await fetchFn('https://api.dynu.com/v2/dns', { headers: H }); j = await r.json().catch(() => ({})); } catch (e) { return err(502, 'Dynu could not be reached: ' + e.message); }
        if (r.status === 401 || r.status === 403) return err(400, 'Dynu refused the API key. Copy it again from Dynu → Control Panel → API Credentials.'); if (!r.ok) return err(502, 'Dynu: ' + (j.message || 'error ' + r.status));
        const out = [];
        for (const z of (j.domains || []).slice(0, 20)) { let recs = []; try { const x = await (await fetchFn(`https://api.dynu.com/v2/dns/${z.id}/record`, { headers: H })).json(); recs = (x.dnsRecords || []).map((q) => ({ type: q.recordType, name: q.nodeName || '@', value: q.textData || q.host || q.ipv4Address || q.content || '', on: q.state !== false })); } catch {}
          out.push({ id: z.id, name: z.name, ipv4: z.ipv4Address || '', updated: z.updatedOn || '', records: recs, mail: recs.some((q) => /resend|amazonses|_domainkey/i.test(q.name + ' ' + q.value)) }); }
        const list = await getAccounts(); const acc = list.find((x) => x.id === a.id); const names = out.map((d) => d.name.toLowerCase()); if (names.length && names.join() !== (acc.domains || []).join()) { acc.domains = names.slice(0, 30); await saveAccounts(list); }
        await log('security', `Dynu account "${a.name}" checked by ${actorName}`); return ok({ domains: out });
      }
      if (R('POST', '/api/admin/accounts/hostinger-dns')) { // add the DNS records Resend asks for to a domain whose DNS is at Hostinger
        const L = await getAccounts(); const ho = L.find((x) => x.id === String(body.hostingerId || '')), re = L.find((x) => x.id === String(body.resendId || ''));
        if (!ho?.apiKey) return err(400, 'Choose a Hostinger account with its API token.'); if (!re?.apiKey) return err(400, 'Choose a Resend account with its API key.');
        const domain = String(body.domain || '').trim().toLowerCase(); if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return err(400, 'Choose the domain.');
        const RH = { Authorization: 'Bearer ' + re.apiKey }, HH = { Authorization: 'Bearer ' + ho.apiKey, accept: 'application/json', 'Content-Type': 'application/json' };
        const rd = await (await fetchFn('https://api.resend.com/domains', { headers: RH })).json().catch(() => ({}));
        const rdom = (rd.data || []).find((x) => String(x.name).toLowerCase() === domain); if (!rdom) return err(404, `${domain} is not added in this Resend account yet.`);
        const rj = await (await fetchFn('https://api.resend.com/domains/' + encodeURIComponent(rdom.id), { headers: RH })).json().catch(() => ({}));
        // the zone at Hostinger is the main domain (mail.example.com lives in example.com)
        const parts = domain.split('.'); let zone = '', existing = null;
        for (let i = 0; i <= parts.length - 2 && !zone; i++) { const z = parts.slice(i).join('.'); try { const r = await fetchFn('https://developers.hostinger.com/api/dns/v1/zones/' + encodeURIComponent(z), { headers: HH }); if (r.ok) { zone = z; existing = await r.json().catch(() => []); } else if (r.status === 401) return err(400, 'Hostinger refused the token.'); } catch {} }
        if (!zone) return err(404, `${domain} is not a DNS zone in this Hostinger account (or its DNS is managed elsewhere, e.g. Dynu).`);
        const have = new Set((Array.isArray(existing) ? existing : existing.data || []).flatMap((x) => (x.records || []).map((q) => `${String(x.type).toUpperCase()}|${String(x.name || '@').toLowerCase()}|${String(q.content || '').toLowerCase().replace(/\.$/, '')}`)));
        const add = [], skipped = [];
        for (const q of rj.records || []) {
          let name = String(q.name || '').toLowerCase().replace(/\.$/, ''); if (name === zone) name = '@'; else if (name.endsWith('.' + zone)) name = name.slice(0, -(zone.length + 1));
          // Resend names are relative to the domain it sends from; inside the main zone they need that subdomain
          if (domain !== zone && name !== '@' && !name.endsWith(domain.slice(0, -(zone.length + 1)))) name = name + '.' + domain.slice(0, -(zone.length + 1));
          const type = String(q.type).toUpperCase(); const content = type === 'MX' ? `${Number(q.priority) || 10} ${q.value}` : String(q.value || '');
          const k = `${type}|${name}|${content.toLowerCase().replace(/\.$/, '')}`; if (have.has(k)) { skipped.push(`${type} ${name}`); continue; }
          add.push({ name, type, ttl: 3600, records: [{ content }] });
        }
        let failed = '';
        if (add.length) { try { const r = await fetchFn('https://developers.hostinger.com/api/dns/v1/zones/' + encodeURIComponent(zone), { method: 'PUT', headers: HH, body: JSON.stringify({ overwrite: false, zone: add }) }); if (!r.ok) { const j = await r.json().catch(() => ({})); failed = j.message || 'Hostinger answered ' + r.status; } } catch (e) { failed = e.message; } }
        await log('security', `Hostinger DNS for ${domain}: ${failed ? 0 : add.length} added, ${skipped.length} already there${failed ? ', failed: ' + failed : ''} (by ${actorName})`);
        return ok({ added: failed ? [] : add.map((x) => `${x.type} ${x.name}`), skipped, failed: failed ? [failed] : [], zone });
      }
      if (R('POST', '/api/admin/accounts/dynu')) { // add the DNS records Resend asks for to the domain at Dynu
        const L = await getAccounts(); const dy = L.find((x) => x.id === String(body.dynuId || '')), re = L.find((x) => x.id === String(body.resendId || ''));
        if (!dy?.apiKey) return err(400, 'Choose a Dynu account with its API key.'); if (!re?.apiKey) return err(400, 'Choose a Resend account with its API key.');
        const domain = String(body.domain || '').trim().toLowerCase(); if (!domain) return err(400, 'Choose the domain.');
        const RH = { Authorization: 'Bearer ' + re.apiKey }, DH = { 'API-Key': dy.apiKey, accept: 'application/json', 'Content-Type': 'application/json' };
        let rl = await fetchFn('https://api.resend.com/domains', { headers: RH }); let rd = await rl.json().catch(() => ({}));
        const rdom = (rd.data || []).find((x) => String(x.name).toLowerCase() === domain); if (!rdom) return err(404, `${domain} is not added in this Resend account yet.`);
        const rj = await (await fetchFn('https://api.resend.com/domains/' + encodeURIComponent(rdom.id), { headers: RH })).json().catch(() => ({}));
        const dl = await (await fetchFn('https://api.dynu.com/v2/dns', { headers: DH })).json().catch(() => ({}));
        const zone = (dl.domains || []).filter((z) => domain === String(z.name).toLowerCase() || domain.endsWith('.' + String(z.name).toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
        if (!zone) return err(404, `${domain} is not in this Dynu account.`);
        const zn = String(zone.name).toLowerCase(); const existing = await (await fetchFn(`https://api.dynu.com/v2/dns/${zone.id}/record`, { headers: DH })).json().catch(() => ({}));
        const have = (existing.dnsRecords || []).map((x) => `${String(x.recordType).toUpperCase()}|${String(x.nodeName || '').toLowerCase()}|${String(x.textData || x.host || x.content || '').toLowerCase()}`);
        const added = [], skipped = [], failed = [];
        for (const q of rj.records || []) {
          let node = String(q.name || '').toLowerCase().replace(/\.$/, ''); if (node === zn) node = ''; else if (node.endsWith('.' + zn)) node = node.slice(0, -(zn.length + 1));
          // Resend gives names relative to the main domain (e.g. "send.mail" for mail.example.com), which is what Dynu wants as the node name
          const type = String(q.type).toUpperCase(); const val = String(q.value || '');
          const k = `${type}|${node}|${val.toLowerCase()}`; if (have.includes(k)) { skipped.push(`${type} ${node || '@'}`); continue; }
          const rec = { nodeName: node, recordType: type, ttl: 3600, state: true, ...(type === 'TXT' ? { textData: val } : type === 'MX' ? { host: val, priority: Number(q.priority) || 10 } : type === 'CNAME' ? { host: val } : { content: val }) };
          try { const x = await fetchFn(`https://api.dynu.com/v2/dns/${zone.id}/record`, { method: 'POST', headers: DH, body: JSON.stringify(rec) }); if (x.ok) added.push(`${type} ${node || '@'}`); else { const j = await x.json().catch(() => ({})); failed.push(`${type} ${node || '@'}: ${j.message || x.status}`); } } catch (e) { failed.push(`${type} ${node || '@'}: ${e.message}`); }
        }
        await log('security', `Dynu DNS for ${domain}: ${added.length} added, ${skipped.length} already there, ${failed.length} failed (by ${actorName})`);
        return ok({ added, skipped, failed, zone: zn });
      }
      if (R('POST', '/api/admin/accounts/sheet')) { // Google Sheets: save the Apps Script link, send the accounts to the sheet, or read them back
        if (body.url !== undefined) { const u = String(body.url || '').trim(); if (u && !/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) return err(400, 'Paste the Apps Script web app link (https://script.google.com/macros/s/…/exec).'); s.accountsSheet = u; await saveSettings(s); }
        const url = s.accountsSheet; if (!url) return ok({ saved: true });
        if (body.push) { const list = await getAccounts(); let r; try { r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ sheet: 'Accounts', header: ACC_HEAD, rows: list.map(accSheetRow) }) }); } catch (e) { return err(502, 'Google Sheets could not be reached: ' + e.message); }
          if (!r.ok) return err(502, 'Google Sheets answered ' + r.status + '. Check the script is deployed for "Anyone".'); await log('security', `Accounts sent to Google Sheets by ${actorName} (${list.length})`); return ok({ pushed: list.length }); }
        if (body.pull) { let d; try { const r = await fetchFn(url + (url.includes('?') ? '&' : '?') + 'sheet=Accounts'); d = await r.json(); } catch (e) { return err(502, 'Could not read the sheet: ' + e.message); }
          const rows = accFromRows(d.rows || d.values || []); const list = await getAccounts(); let added = 0, changed = 0;
          for (const r of rows) { const old = list.find((x) => (r.apiKey && x.apiKey === r.apiKey) || (x.name === String(r.name || '').trim() && x.kind === r.kind)); if (old) { Object.assign(old, accClean(r, old), { updatedAt: Date.now() }); changed++; } else { list.push({ id: uid(6), ...accClean(r), createdAt: Date.now(), updatedAt: Date.now(), by: actorName }); added++; } }
          await saveAccounts(list); await log('security', `Accounts read from Google Sheets by ${actorName}: ${added} new, ${changed} updated`); await accountsToRows(s); return ok({ added, changed }); }
        return ok({ saved: true });
      }
      if (R('POST', '/api/admin/accounts/import')) { // pasted rows (copied from the sheet)
        const rows = String(body.text || '').split(/\r?\n/).map((l) => (l.includes('\t') ? l.split('\t') : l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/^"|"$/g, '')))); const got = accFromRows(rows);
        const list = await getAccounts(); let added = 0, changed = 0;
        for (const r of got) { const old = list.find((x) => (r.apiKey && x.apiKey === r.apiKey) || (x.name === String(r.name || '').trim() && x.kind === r.kind)); if (old) { Object.assign(old, accClean(r, old), { updatedAt: Date.now() }); changed++; } else { list.push({ id: uid(6), ...accClean(r), createdAt: Date.now(), updatedAt: Date.now(), by: actorName }); added++; } }
        await saveAccounts(list); await accountsToRows(s); return ok({ added, changed });
      }
      if (R('GET', '/api/admin/orders')) { // numbering summary: next number, duplicates, multi-device orders, backups
        const list = (await getCustomers()).filter((c) => !c.rsOrder);
        const by = new Map(); for (const c of list) { const k = orderKey(c.orderNo); if (!k) continue; (by.get(k) || by.set(k, []).get(k)).push(c); }
        const dups = [...by.values()].filter((v) => v.length > 1).map((v) => v.sort(orderCompare).map((c) => ({ id: c.id, name: c.name, username: c.username, orderNo: c.orderNo, at: orderAt(c) })));
        const mains = new Map(); for (const c of list) { const p = parseOrderNo(c.orderNo); if (p.num === null) continue; const k = p.main.toLowerCase(); (mains.get(k) || mains.set(k, []).get(k)).push(c); }
        const multi = list.filter((c) => orderDevices(c).length > 1).length;
        const missing = list.filter((c) => !String(c.orderNo || '').trim()).map((c) => ({ id: c.id, name: c.name, username: c.username }));
        const series = orderSeries(s); const sMax = {}; for (const c of list) { const p = parseOrderNo(c.orderNo); if (p.num !== null) { const k = p.prefix.toUpperCase(); sMax[k] = Math.max(sMax[k] || 0, p.num); } }
        return ok({ settings: s.orders, series, next: { standard: nextOrderNo(list, s), ibo: nextOrderNo(list, s, 'ibo'), reseller: nextOrderNo(list, s, 'reseller') }, prefixes: sMax,
          total: list.length, withNumber: list.length - missing.length, missing: missing.slice(0, 50), missingCount: missing.length, duplicates: dups, multiDevice: multi,
          sharedMain: [...mains.values()].filter((v) => v.length > 1).length, dated: list.filter((c) => Number(c.orderAt)).length,
          backups: ((await store.get('backups')) || []).map((b) => ({ key: b.key, at: b.at, customers: b.customers, why: b.why })) });
      }
      if (R('POST', '/api/admin/orders/organize')) { // owner: full backup first, then only ADDS the original order date (orderAt). Order numbers are never changed.
        const list = await getCustomers(); const sales = await getSales();
        const at = Date.now(); const key = 'backup:' + at;
        await store.put(key, { version: 2, exportedAt: at, settings: s, customers: list, sales, tx: await getTx(), stock: await getStock(), resellers: await getResellers(), ibo: (await store.get('ibo')) || [] });
        const bl = ((await store.get('backups')) || []); bl.unshift({ key, at, customers: list.length, why: 'Before organizing order numbers' });
        for (const old of bl.slice(5)) await store.del(old.key); await store.put('backups', bl.slice(0, 5));
        const first = new Map(); for (const x of sales) if (x.customerId && Number(x.at) && (!first.has(x.customerId) || x.at < first.get(x.customerId))) first.set(x.customerId, Number(x.at));
        let dated = 0;
        for (const c of list) {
          if (Number(c.orderAt)) continue;
          const cands = [first.get(c.id), Number(c.startAt), Number(c.createdAt), Number((c.renewals || [])[0]?.at)].filter((x) => x > 0);
          if (cands.length) { c.orderAt = Math.min(...cands); dated++; }
        }
        await saveCustomers(list); await log('admin', `Orders organized: backup ${key}, original order date kept for ${dated} customers (order numbers unchanged)`);
        return ok({ ok: true, backup: key, dated, total: list.length });
      }
      if (R('GET', '/api/admin/orders/backup')) { // download one of the saved backups
        const k = String(query.key || ''); if (!/^backup:\d+$/.test(k)) return err(400, 'Unknown backup.');
        const b = await store.get(k); return b ? ok(b) : err(404, 'This backup is gone.');
      }
      if (R('GET', '/api/admin/customers/newstats')) { // new customers of one month (default: last month), Bangkok time
        const TZ = 7 * 3600000; const now = new Date(Date.now() + TZ);
        let [y, mo] = /^\d{4}-\d{2}$/.test(String(query.month || '')) ? String(query.month).split('-').map(Number) : [now.getUTCFullYear(), now.getUTCMonth()];
        if (!/^\d{4}-\d{2}$/.test(String(query.month || '')) && mo === 0) { y -= 1; mo = 12; }
        const from = Date.UTC(y, mo - 1, 1) - TZ, to = Date.UTC(y, mo, 1) - TZ; const inM = (t) => Number(t) >= from && Number(t) < to;
        const month = `${y}-${String(mo).padStart(2, '0')}`;
        const all = (await getCustomers()).filter((c) => !c.rsOrder); const list = all.filter((c) => inM(c.createdAt));
        const t = Date.now(); const warn = (Number(s.userDashboard.expiryWarningDays) || 7) * DAY;
        const state = (c) => c.status === 'disabled' ? 'disabled' : c.expiresAt < t ? 'expired' : c.expiresAt - t <= warn ? 'expiring' : 'active';
        const count = (arr, f) => arr.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
        const plan = (c) => (s.plans.find((p) => p.id === c.planId) || {}).name || (c.isTrial ? 'Free trial' : 'Custom');
        const ct = (c, k) => !!((c.contact || {})[k]);
        const sent = { email: list.filter((c) => ct(c, 'email') || c.loginMailAt || c.profileMailAt).length, whatsapp: list.filter((c) => ct(c, 'whatsapp') || c.waSentAt).length, telegram: list.filter((c) => ct(c, 'telegram')).length };
        const none = list.filter((c) => !(ct(c, 'email') || c.loginMailAt || c.profileMailAt || ct(c, 'whatsapp') || c.waSentAt || ct(c, 'telegram')));
        const rs = await getResellers(); const rOrders = rs.flatMap((r) => (r.orders || []).filter((o) => inM(o.at)).map((o) => ({ ...o, rsl: r.rslId, name: r.name })));
        const ibo = ((await store.get('ibo')) || []).filter((x) => inM(x.createdAt || x.startAt));
        const iboCust = list.filter((c) => c.ibo && (c.ibo.mac || c.ibo.key)).length;
        // Retention: did each new customer pay again after joining? renewed / lost (ended without paying) / waiting (still running)
        const later = (c) => { const tr = (c.renewals || [])[0]?.type === 'trial'; return (c.renewals || []).filter((r) => Number(r.at) > Number(c.createdAt) + 120000 && (r.type === 'renew' || (tr && r.type === 'new'))); }; // a first purchase only counts for trial customers
        const renewOf = (c) => later(c).length ? 'renewed' : c.expiresAt < t ? 'lost' : 'waiting';
        const ren = count(list, renewOf); ren.renewed = ren.renewed || 0; ren.lost = ren.lost || 0; ren.waiting = ren.waiting || 0;
        const trialsL = list.filter((c) => c.isTrial || (c.renewals || [])[0]?.type === 'trial'); const conv = trialsL.filter((c) => later(c).length || !c.isTrial).length;
        // All renewals paid during the month (every customer), and subscriptions that ended in the month
        const paidIn = all.flatMap((c) => (c.renewals || []).filter((r) => r.type === 'renew' && inM(r.at)));
        const endedIn = all.filter((c) => inM(c.expiresAt) || (c.renewals || []).some((r) => r.type === 'renew' && inM(r.at) && Number(c.createdAt) < from));
        const endedRenewed = endedIn.filter((c) => (c.renewals || []).some((r) => r.type === 'renew' && Number(r.at) >= from)).length;
        return ok({ month, from, to,
          total: list.length, paid: list.filter((c) => !c.isTrial).length, trials: list.filter((c) => c.isTrial).length,
          standard: { count: list.filter((c) => !c.isTrial).length, plans: count(list.filter((c) => !c.isTrial), plan) },
          reseller: { newResellers: rs.filter((r) => inM(r.joinedAt)).length, orders: rOrders.length, credits: rOrders.reduce((a, o) => a + (Number(o.credits) || 0), 0), amount: Math.round(rOrders.reduce((a, o) => a + (Number(o.amount) || 0), 0) * 100) / 100, list: rOrders.slice(0, 50).map((o) => ({ at: o.at, rsl: o.rsl, name: o.name, pkg: o.pkg || '', credits: o.credits || 0, amount: o.amount || 0, currency: o.currency || '' })) },
          ibo: { activations: ibo.length + iboCust, panel: ibo.length, onCustomers: iboCust, trials: ibo.filter((x) => x.isTrial).length },
          balance: count(list, state), devices: list.reduce((a, c) => a + connDevices(c), 0), multi: list.filter((c) => (c.lines || []).length).length,
          sent, notSent: none.length,
          retention: { ...ren, rate: ren.renewed + ren.lost ? Math.round(ren.renewed / (ren.renewed + ren.lost) * 100) : null, trials: trialsL.length, trialsConverted: conv,
            month: { renewals: paidIn.length, amount: Math.round(paidIn.reduce((a, r) => a + (Number(r.price) || 0), 0) * 100) / 100, due: endedIn.length, dueRenewed: endedRenewed, dueLost: endedIn.filter((c) => c.expiresAt < t && !(c.renewals || []).some((r) => r.type === 'renew' && Number(r.at) >= from)).length } },
          customers: list.sort((a, b) => b.createdAt - a.createdAt).map((c) => ({ id: c.id, name: c.name, username: c.username, createdAt: c.createdAt, plan: plan(c), isTrial: !!c.isTrial, state: state(c), expiresAt: c.expiresAt, renew: renewOf(c), renewedAt: later(c).at(-1)?.at || 0, ibo: !!(c.ibo && (c.ibo.mac || c.ibo.key)),
            email: ct(c, 'email') || !!c.loginMailAt || !!c.profileMailAt, whatsapp: ct(c, 'whatsapp') || !!c.waSentAt, telegram: ct(c, 'telegram'), noWhatsapp: ct(c, 'noWhatsapp'), noTelegram: ct(c, 'noTelegram') })) });
      }
      if (R('GET', '/api/admin/customers')) {
        const bad = await getBad(); const sales = await getSales(); const paid = {};
        for (const sa of sales) if (Number(sa.amount) > 0) paid[sa.customerId] = (paid[sa.customerId] || 0) + (Number(sa.amountUsd) || 0);
        return ok((await getCustomers()).filter((c) => !c.rsOrder || query.rs).map((c) => { const v = viewP(c, s); v.totalPaidUsd = Math.round((paid[c.id] || 0) * 100) / 100; const b = bad[cleanEmail(c.email)]; return b ? { ...v, emailBad: b.why } : v; }));
      }

      if (R('POST', '/api/admin/customers')) {
        const list = await getCustomers();
        const ln0 = body.m3u ? parseLineLink(body.m3u) : null;
        if (body.m3u && !ln0) return err(400, 'This does not look like a line link from the panel. Paste the full M3U link (it contains username= and password=).');
        if (ln0) { if (!String(body.username || '').trim()) body.username = ln0.u; if (!body.password) body.password = ln0.p; }
        const username = String(body.username || '').trim();
        if (username.length < 3) return err(400, 'Login username needs 3+ characters.');
        if (String(body.password || '').length < 4) return err(400, 'Login password needs 4+ characters.');
        if (body.email && !body.emailAnyway) { const prob = await emailProblem(body.email); if (prob) return err(400, prob); }
        const admin = await store.get('admin');
        if (list.some((x) => x.username.toLowerCase() === username.toLowerCase()) || (admin && admin.username.toLowerCase() === username.toLowerCase()) || (await getTeam()).some((x) => x.username.toLowerCase() === username.toLowerCase()))
          return err(400, 'This username is already used.');
        const plan = s.plans.find((p) => p.id === body.planId);
        // Exact start: now (or the time given). A date string for today means "now", not midnight. Trials last the trial hours, plans their days.
        const msOk = (v) => Number.isFinite(Number(v)) && Number(v) > 1e12 && Number(v) < 4102444800000;
        const sDay = body.startAt ? dayStart(String(body.startAt).slice(0, 10)) : null;
        const startAt = msOk(body.startAtMs) ? Math.round(Number(body.startAtMs)) : sDay && Math.abs(sDay - dayStart(new Date().toISOString().slice(0, 10))) > DAY ? sDay : Date.now();
        const trialNew = body.isTrial === true || body.isTrial === 'true' || body.isTrial === 'on';
        const expiresAt = msOk(body.expiresAtMs) ? Math.round(Number(body.expiresAtMs)) : body.expiresAt ? dayStart(String(body.expiresAt).slice(0, 10)) + DAY - 1000 : startAt + (trialNew ? (Number(s.trial.hours) || 24) * 3600000 : (plan ? plan.days : 30) * DAY);
        const salt = uid(8);
        const c = {
          id: uid(8), name: String(body.name || username), phone: String(body.phone || ''), note: String(body.note || ''),
          email: cleanEmail(body.email) || String(body.email || '').trim().toLowerCase(), email2: cleanEmail(body.email2) || String(body.email2 || '').trim().toLowerCase(), whatsapp: String(body.whatsapp || body.phone || ''), lang: okLang(body.lang),
          telegram: String(body.telegram || ''), macAddress: String(body.macAddress || ''), deviceApp: String(body.deviceApp || ''),
          statusFlag: ['normal', 'excellent', 'dispute'].includes(body.statusFlag) ? body.statusFlag : 'normal', callNotes: String(body.callNotes || ''),
          username, salt, passwordHash: await hashPassword(body.password, salt), loginPassword: String(body.password),
          lineUsername: body.lineSame !== false ? username : String(body.lineUsername || ''),
          linePassword: body.lineSame !== false ? String(body.password) : String(body.linePassword || ''),
          lineId: String(body.lineId || ''), planId: plan ? plan.id : 'custom',
          connections: Number(body.connections) || (plan ? plan.connections : 1),
          startAt, expiresAt, status: 'active', createdAt: Date.now(), lastLogin: null,
          renewals: [{ at: Date.now(), type: 'new', planId: plan ? plan.id : 'custom', days: Math.round((expiresAt - startAt) / DAY), price: Number(body.price) || 0, credits: plan ? planCredits(plan) : Number(body.credits) || 0 }],
        };
        if (ln0) { c.lineUsername = ln0.u; c.linePassword = ln0.p; c.dns = ln0.dns; }
        // Order number: the one typed (must not be used yet) or the next one of the series
        { const typed = String(body.orderNo || '').trim();
          if (typed) { const t2 = orderTaken(list, typed); if (t2) return err(409, `Order number ${typed} is already used by ${t2.name || t2.username}.`); c.orderNo = typed; }
          else if (body.autoOrderNo !== false) c.orderNo = nextOrderNo(list, s, body.orderKind === 'ibo' ? 'ibo' : body.orderKind === 'reseller' ? 'reseller' : 'standard');
          c.orderAt = c.createdAt; }
        if (CONN_TYPES[body.lineType]) c.lineType = body.lineType;
        if (Array.isArray(body.lines)) { const ls = cleanConns(body.lines); if (ls.length) c.lines = ls; }
        let panel = null;
        if (body.createOnPanel && !ln0) {
          panel = await panelCall(s, 'create', panelVars(c, s));
          // The customer is saved even when the panel refuses, so nothing typed is lost; the dashboard shows what the panel answered.
          if (!panel.ok && !panel.skipped) await log('customer', `Panel did not create the line for ${c.username}: ${panel.error}`);
          else if (!panel.skipped) { const got = applyPanelCreds(s, c, panel.data); if (got.u || got.p) await adoptLine(list, c); }
        }
        if (ln0 || (body.lineSame === false && c.lineUsername && c.linePassword)) await adoptLine(list, c);
        const dup = findMatches(list, c);
        if (dup.length) await logAttempt({ kind: 'new customer', name: c.name, email: c.email, phone: c.phone, whatsapp: c.whatsapp, by: actorName, newUsername: c.username, matches: dup.slice(0, 5).map((m) => ({ id: m.c.id, username: m.c.username, name: m.c.name, why: m.why })) });
        list.push(c);
        await saveCustomers(list);
        await recordSale(s, c, { type: 'new', plan, days: c.renewals[0].days, credits: c.renewals[0].credits, amount: Number(body.price) || 0, accountId: body.accountId, sa: String(body.stripeAccountId || ''), by: actorName });
        let mail = null;
        if (body.sendEmail && c.email) { const m = accessEmail(s, c, String(body.password), 'sub', body.appUrl); mail = await sendEmail(s, c.email, m.subject, m.html); if (mail.ok) { c.loginMailAt = Date.now(); markSent(c, 'email'); await saveCustomers(list); } }
        await log('customer', `Created ${username} (${plan ? plan.name : 'custom'})${panel && !panel.skipped ? ' + panel line' : ''}${mail ? (mail.ok ? ' · email sent' : ' · email failed') : ''}`);
        return ok({ customer: viewP(c, s), panel, mail, iboOffer: !c.isTrial && iboCfg(s).on && iboCfg(s).whatsapp && !hasIbo(c) && !!(c.whatsapp || c.phone), duplicates: dup.map((m) => ({ username: m.c.username, name: m.c.name, why: m.why })) });
      }

      const m = path.match(/^\/api\/admin\/customers\/([\w-]+)(?:\/(\w+))?$/);
      if (m) {
        const list = await getCustomers();
        const c = list.find((x) => x.id === m[1]);
        if (!c) return err(404, 'Customer not found.');
        const sub = m[2];

        if (method === 'POST' && sub === 'line') { // paid customers: staff paste the panel M3U line -> saved to My Details (+ IBO Player device)
          if (c.isTrial) return err(400, 'Free-trial accounts use Trial queue → New free-trial dispatch.');
          const paste = String(body.m3u || '').trim();
          let ln = parseLineLink(paste);
          if (!ln) {
            const u0 = String(body.username || '').trim(), p0 = String(body.password || ''), d0 = String(body.dns || '').trim().replace(/\/+$/, '');
            if (u0 && p0 && d0) ln = { u: u0, p: p0, dns: d0 };
          }
          const iboMac = String(body.iboMac || '').trim(), iboKey = String(body.iboKey || '').trim();
          if (!ln && !iboMac && !iboKey) return err(400, 'Paste the full M3U link (or fill Username, Password and DNS), or add the IBO Player device fields.');
          if (!ln && (paste || String(body.username || '').trim() || String(body.password || '') || String(body.dns || '').trim())) return err(400, 'Paste the full M3U link (or fill Username, Password and DNS).');
          if (!ln) {
            if (iboMac || iboKey) c.ibo = { mac: iboMac, key: iboKey, at: Date.now(), by: actorName || 'team' };
            else if (body.clearIbo) delete c.ibo;
            await saveCustomers(list);
            await log('customer', `IBO Player details ${iboMac || iboKey ? 'saved' : 'cleared'} for paid customer ${c.username} (${c.name})${iboMac ? ' · ' + iboMac : ''}`);
            return ok({ ok: true, customerId: c.id, name: c.name, username: c.lineUsername || '', password: c.linePassword || '', dns: String(c.dns || ''), m3u: String(c.m3u || ''), ibo: c.ibo || null, iobOnly: true, emailSent: false, telegramSent: false, telegramLinked: false, email: c.email || '', phone: c.phone || '', whatsapp: c.whatsapp || '', telegram: String(c.telegram || '').replace(/^@/, ''), loginUsername: c.username, daysLeft: viewP(c, s).daysLeft, state: viewP(c, s).state, planName: viewP(c, s).planName, expiresAt: viewP(c, s).expiresAt });
          }
          const dns = String(ln.dns || '').replace(/\/+$/, '');
          if (!/^https?:\/\//i.test(dns)) return err(400, 'DNS must start with http:// or https://.');
          c.lineUsername = String(ln.u).trim(); c.linePassword = String(ln.p); c.dns = dns;
          if (paste) c.m3u = paste;
          delete c.pendingLine; delete c.lineBad;
          if (c.status === 'disabled' && body.enable !== false) c.status = 'active';
          if (iboMac || iboKey) c.ibo = { mac: iboMac, key: iboKey, at: Date.now(), by: actorName || 'team' };
          else if (body.clearIbo) delete c.ibo;
          await saveCustomers(list);
          const wantMail = body.sendEmail !== false && !!c.email;
          const m = accessEmail(s, c, c.loginPassword || '', 'sub', body.appUrl);
          const sent = wantMail ? await sendEmail(s, c.email, m.subject, m.html) : { ok: false, error: 'not requested' };
          const tgChat = wantMail ? await tgFindChat(c) : '';
          let tgSent = false;
          if (tgChat) { const rr = await tgSend(s, tgChat, tgCreds(s, c, c.loginPassword || '')); tgSent = rr.ok; }
          if (tgOn(s) && s.telegram.adminChat) await tgSend(s, s.telegram.adminChat, `📺 Paid line ${paste ? 'assigned' : 'updated'} — ${c.name || c.username}\n\nUsername: ${c.lineUsername}\nDNS: ${c.dns}${iboMac ? `\nIBO MAC: ${iboMac}` : ''}${iboKey ? `\nIBO key: ${iboKey}` : ''}\n\n${sent.ok ? 'Email: sent' : 'Email: not sent'} · ${tgSent ? 'Telegram: sent' : 'Telegram: not linked'}`);
          await log('customer', `M3U line synced for paid customer ${c.username} (${c.name}) · ${c.lineUsername}@${c.dns}${iboMac ? ' · IBO ' + iboMac : ''}${sent.ok ? ' · email sent' : ''}${tgSent ? ' · Telegram sent' : ''}`);
          const v = viewP(c, s);
          return ok({ ok: true, customerId: c.id, name: c.name, username: c.lineUsername, password: c.linePassword, dns: c.dns, m3u: String(c.m3u || ''), ibo: c.ibo || null, emailSent: !!sent.ok, telegramSent: tgSent, telegramLinked: !!tgChat, email: c.email || '', phone: c.phone || '', whatsapp: c.whatsapp || '', telegram: String(c.telegram || '').replace(/^@/, ''), loginUsername: c.username, daysLeft: v.daysLeft, state: v.state, planName: v.planName, expiresAt: v.expiresAt });
        }

        if (method === 'PUT' && !sub) {
          // 24-hour auto-reset contact checkboxes (spec §4): checking marks "contacted" today; stale marks auto-expire in the UI
          if (body.contact && typeof body.contact === 'object') {
            const ct = { ...(c.contact || {}) };
            for (const k of ['email', 'whatsapp', 'telegram', 'noWhatsapp', 'noTelegram']) {
              if (k in body.contact) { const v = body.contact[k]; ct[k] = v === 'toggle' ? (ct[k] ? 0 : Date.now()) : v ? Date.now() : 0; }
            }
            c.contact = ct; await saveCustomers(list);
            await log('customer', `Contact check: ${['email', 'whatsapp', 'telegram'].filter((k) => ct[k]).join(', ') || 'none'} marked for ${c.username}`);
            return ok({ ok: true, contact: ct });
          }
          if (body.email && cleanEmail(body.email) !== cleanEmail(c.email) && !body.emailAnyway) { const prob = await emailProblem(cleanEmail(body.email)); if (prob) return err(400, prob); }
          if (body.email2 !== undefined && (String(body.email2 || '') !== '' && cleanEmail(body.email2) !== cleanEmail(c.email2 || ''))) { const prob = await emailProblem(cleanEmail(body.email2)); if (prob) return err(400, 'Secondary email: ' + prob); }
          for (const k of ['name', 'phone', 'note', 'lineUsername', 'linePassword', 'lineId', 'planId', 'email', 'whatsapp', 'lang']) if (body[k] !== undefined) c[k] = String(body[k]);
          if (body.lang !== undefined) c.lang = okLang(c.lang);
          if (body.curOverride !== undefined) { const v = String(body.curOverride || '').toUpperCase(); if (['USD', 'EUR'].includes(v)) c.curOverride = v; else delete c.curOverride; }
          if (body.email !== undefined) c.email = cleanEmail(body.email) || String(body.email).trim();
          if (body.email2 !== undefined) c.email2 = cleanEmail(body.email2) || String(body.email2 || '').trim().toLowerCase();
          const lineWas = c.lineUsername + '\n' + c.linePassword;
          let activated = false;
          if (body.m3u) {
            const ln = parseLineLink(body.m3u); if (!ln) return err(400, 'This does not look like a line link from the panel. Paste the full M3U link (it contains username= and password=).');
            c.lineUsername = ln.u; c.linePassword = ln.p; c.dns = ln.dns;
            if (c.pendingLine) { // a trial that was waiting: it starts now, signs in with the line details, and gets the email
              delete c.pendingLine; activated = true;
              if (c.isTrial) { c.startAt = Date.now(); c.expiresAt = Date.now() + (Number(s.trial.hours) || 24) * 3600000; }
            }
          }
          if (c.lineUsername + '\n' + c.linePassword !== lineWas && !body.password) await adoptLine(list, c);
          if (body.connections !== undefined) c.connections = Number(body.connections) || 1;
          c.updatedAt = Date.now();
          if (body.lineType !== undefined) c.lineType = CONN_TYPES[body.lineType] ? body.lineType : 'xtream1';
          if (body.lines !== undefined) { c.lines = cleanConns(body.lines); if (!c.lines.length) delete c.lines; }
          if (body.username && body.username !== c.username) {
            const u = String(body.username).trim();
            if (list.some((x) => x !== c && x.username.toLowerCase() === u.toLowerCase())) return err(400, 'This username is already used.');
            c.username = u;
          }
          if (body.password) { c.salt = uid(8); c.passwordHash = await hashPassword(body.password, c.salt); c.loginPassword = String(body.password); }
          if (body.orderNo !== undefined && orderKey(body.orderNo) !== orderKey(c.orderNo)) { const t2 = orderTaken(list, body.orderNo, c); if (t2) return err(409, `Order number ${String(body.orderNo).trim()} is already used by ${t2.name || t2.username}.`); body.orderNo = String(body.orderNo).trim(); }
          for (const k of ['orderNo', 'country', 'address', 'server', 'panel', 'device', 'paymentMethod', 'telegram', 'macAddress', 'deviceApp', 'callNotes']) if (body[k] !== undefined) c[k] = String(body[k]);
          if (body.statusFlag !== undefined && ['normal', 'excellent', 'dispute'].includes(body.statusFlag)) {
            const was = c.statusFlag; c.statusFlag = body.statusFlag;
            if (body.statusFlag === 'dispute' && was !== 'dispute') {
              try {
                const dis = await getDisputes();
                dis.unshift({ id: uid(8), kind: 'dispute', subject: `Dispute flagged on ${c.name} (${c.username})`, details: String(body.callNotes || c.note || '').slice(0, 2000) || 'Customer was flagged as Dispute in their profile.', priority: 'high', status: 'open',
                  customerId: c.id, username: c.username, name: c.name, orderNo: c.orderNo || '', amount: 0, att: '', createdBy: actorName, createdAt: Date.now(), updatedAt: Date.now(), assignedTo: '', notes: [], resolution: '' });
                await saveDisputes(dis);
                await notifyAdmin(s, `⚠️ Dispute flagged: ${c.name}`, `${c.username} was flagged as Dispute by ${actorName}. Open Disputes for details.`);
                await notifyTM(s, `⚠️ Dispute flagged: ${c.name}`, `${c.username} was flagged as Dispute by ${actorName}. Open Disputes for details.`);
                await log('disputes', `Dispute auto-created for ${c.username} (flagged by ${actorName})`);
              } catch {}
            }
          }
          // Exact times from the app. A trial that was just started keeps its 24 hours. An old-style date string that is the same day as now saved is ignored (it used to reset the time to 23:59 and add days).
          const msOk = (v) => Number.isFinite(Number(v)) && Number(v) > 1e12 && Number(v) < 4102444800000;
          if (!activated) {
            if (msOk(body.expiresAtMs)) c.expiresAt = Math.round(Number(body.expiresAtMs));
            else if (body.expiresAt && Math.abs(dayStart(String(body.expiresAt).slice(0, 10)) - dayStart(new Date(c.expiresAt).toISOString().slice(0, 10))) > DAY) c.expiresAt = dayStart(String(body.expiresAt).slice(0, 10)) + DAY - 1000;
            if (msOk(body.startAtMs)) c.startAt = Math.round(Number(body.startAtMs));
            else if (body.startAt && Math.abs(dayStart(String(body.startAt).slice(0, 10)) - dayStart(new Date(c.startAt || 0).toISOString().slice(0, 10))) > DAY) c.startAt = dayStart(String(body.startAt).slice(0, 10));
          }
          await saveCustomers(list);
          await log('customer', `Updated ${c.username}${activated ? ' · line added, trial started' : ''}`);
          if (activated && cleanEmail(c.email)) { const m = accessEmail(s, c, c.loginPassword, c.isTrial ? 'trial' : 'sub', s.email.appUrl || body.appUrl); const r = await sendEmail(s, c.email, m.subject, m.html); await log('customer', `Login email to ${c.username}${r.ok ? ' sent' : ' NOT sent: ' + (r.error || '')}`);           return ok({ ...viewP(c, s), activated: true, emailed: !!r.ok });
          }
          return ok(viewP(c, s));
        }
        if (method === 'DELETE' && !sub) {
          let panel = null;
          if (query.panel === '1') {
            panel = await panelCall(s, 'delete', panelVars(c, s));
            if (!panel.ok && !panel.skipped && query.force !== '1') return err(502, 'Panel: ' + panel.error);
          }
          await saveCustomers(list.filter((x) => x !== c));
          await log('customer', `Deleted ${c.username}`);
          return ok({ ok: true, panel });
        }
        if (method === 'POST' && sub === 'tfaoff') { // customer lost their phone: support turns two-step sign-in off
          delete c.totp; await saveCustomers(list); await log('customer', `Two-step sign-in turned off for ${c.username}`);
          return ok({ ok: true });
        }
        if (method === 'POST' && sub === 'renew') {
          const plan = s.plans.find((p) => p.id === body.planId);
          const days = Number(body.days) || (plan ? plan.days : 30);
          let panel = null;
          if (body.syncPanel) {
            panel = await panelCall(s, 'renew', panelVars(c, s, { days, package: plan && plan.package }));
            // The renewal is kept even when the panel refuses; the customer is listed under Alerts until the line is renewed there.
            if (!panel.ok && !panel.skipped) { c.renewPending = Date.now(); await log('renewal', `Panel did not renew ${c.username}: ${panel.error}`); }
          }
          const base = Math.max(Date.now(), c.expiresAt);
          if (c.expiresAt < Date.now()) c.startAt = Date.now();
          c.expiresAt = base + days * DAY;
          if (plan) c.planId = plan.id;
          const wasTrial = !!c.isTrial; c.isTrial = false;
          if (c.status === 'disabled' && body.enable) c.status = 'active';
          const credits = body.credits !== undefined && body.credits !== '' ? Number(body.credits) : plan ? planCredits(plan) : Math.max(1, Math.round(days / 30));
          c.renewals = c.renewals || [];
          c.renewals.push({ at: Date.now(), type: wasTrial ? 'new' : 'renew', planId: plan ? plan.id : 'custom', days, price: Number(body.price) || 0, credits });
          await saveCustomers(list);
          await recordSale(s, c, { type: wasTrial ? 'new' : 'renew', plan, days, credits, amount: Number(body.price) || 0, accountId: body.accountId, sa: String(body.stripeAccountId || ''), by: actorName });
          await log('renewal', `Renewed ${c.username} +${days} days (${Number(body.price) || 0} ${(s.finance.accounts.find((a) => a.id === body.accountId) || {}).currency || (s.currencyRule?.on !== false ? custCurrency(s, c) : s.currency)})`);
          const iboOffer = iboCfg(s).on && iboCfg(s).whatsapp && !hasIbo(c) && !!(c.whatsapp || c.phone);
          if (notifyCfg(s).customers) { const lg = okLang(c.lang); await pushTo(s, 'c:' + c.id, { title: tx(lg, 'pushRenewT'), body: tx(lg, 'pushRenewB', { app: (s.branding.appName || 'INTPROTO-TV'), date: new Date(c.expiresAt).toLocaleDateString(langLocale(lg), { dateStyle: 'long' }) }), url: '/profile', tag: 'renew' }).catch(() => {}); }
          return ok({ customer: viewP(c, s), panel, iboOffer });
        }
        if (method === 'POST' && sub === 'email') {
          const to = String(body.to || c.email || '').trim();
          if (!to) return err(400, 'This customer has no email address.');
          const m = accessEmail(s, c, c.linePassword, c.isTrial ? 'trial' : 'sub', body.appUrl);
          const r = await sendEmail(s, to, m.subject, m.html);
          if (r.ok) { markSent(c, 'email'); c.lineMailAt = Date.now(); await saveCustomers(list); }
          await log('customer', `Emailed login to ${c.username} <${to}>${r.ok ? '' : ' — failed: ' + r.error}`);
          return r.ok ? ok(r) : err(502, r.error || 'Email failed');
        }
        if (method === 'POST' && sub === 'expiry') { // set / move / end / remove the end date, with exact time
          if (!can('customers_edit')) return err(403, 'Not allowed.');
          const before = c.expiresAt, a = String(body.action || 'set'); const msOk = (v) => Number.isFinite(Number(v)) && Number(v) > 1e12 && Number(v) < 4102444800000;
          if (a === 'set') { if (!msOk(body.expiresAtMs)) return err(400, 'Pick a date and time.'); c.expiresAt = Math.round(Number(body.expiresAtMs)); delete c.noExpiry; }
          else if (a === 'add') { const d = Number(body.days); if (!d || Math.abs(d) > 3650) return err(400, 'Number of days?'); c.expiresAt = Math.max(c.expiresAt, d > 0 && c.expiresAt < Date.now() ? Date.now() : c.expiresAt) + d * DAYMS; delete c.noExpiry; }
          else if (a === 'now') { c.expiresAt = Date.now() - 1000; delete c.noExpiry; }
          else if (a === 'none') { c.noExpiry = true; c.expiresAt = Date.UTC(2099, 11, 31, 23, 59, 59); }
          else return err(400, 'Unknown action.');
          if (c.pendingLine && a !== 'now') delete c.pendingLine;
          c.updatedAt = Date.now(); c.expiryLog = [{ at: Date.now(), by: actorName, from: before, to: c.expiresAt, a }, ...(c.expiryLog || [])].slice(0, 20); await saveCustomers(list);
          const f = (t) => (t > Date.UTC(2099, 0, 1) ? 'no end date' : new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
          await log('customer', `End date of ${c.username}: ${f(before)} → ${f(c.expiresAt)}`);
          return ok({ customer: viewP(c, s) });
        }
        if (method === 'GET' && sub === 'orderpreview') { const pk0 = s.orderPackages.find((p) => p.id === query.pkg) || s.resellerPackages.find((p) => p.id === query.pkg) || s.orderPackages[0]; if (!pk0) return err(400, 'No packages'); if (!/^https?:\/\//.test(String(query.link || ''))) { const n = await nextPayLink(s, pk0, s.currencyRule?.on !== false ? custCurrency(s, c) : s.orderCurrency, true); if (n) query.link = n.url; } const pk = { ...pk0, title: pk0.title || pk0.name || 'Package', days: Number(pk0.days) || 0, devices: Number(pk0.devices) || 1 }; const fl = /^https?:\/\/\S+$/.test(String(query.link || '')) ? { url: query.link, acc: '' } : undefined; const qcur = s.currencyRule?.on !== false ? undefined : (query.cur && ['EUR','USD','USDT','ALL','MAD','THB'].includes(query.cur)) ? query.cur : undefined; return ok(orderEmail(s, c, pk, query.appUrl, fl, qcur)); }
        if (method === 'POST' && sub === 'order') {
          const pk = s.orderPackages.find((p) => p.id === body.pkg); if (!pk) return err(400, 'Choose a package.');
          const to = String(body.to || c.email || '').trim(); if (!to) return err(400, 'This customer has no email address.');
          let fixedL = !locked && /^https?:\/\/\S+$/.test(String(body.link || '').trim()) ? { url: String(body.link).trim(), acc: '' } : undefined; // agents can't change links
          if (!fixedL) { const n = await nextPayLink(s, pk, s.currencyRule?.on !== false ? custCurrency(s, c) : s.orderCurrency); if (n) fixedL = { url: n.url, acc: n.acc }; } // the matching link, GreenApp Host / rotation
          const m = orderEmail(s, c, pk, body.appUrl, fixedL); const r = await sendEmail(s, to, m.subject, m.html);
          if (r.ok) { markSent(c, 'email'); c.orderSentAt = Date.now(); c.orderSentPkg = pk.id; c.orderSentLink = fixedL?.url || ''; if (c.buyRequest) c.buyRequest.answeredAt = Date.now(); await saveCustomers(list); }
          await log('customer', `Package email "${pk.title}" to ${c.username} <${to}>${r.ok ? '' : ' — failed: ' + r.error}`);
          return r.ok ? ok(r) : err(502, r.error || 'Email failed');
        }
        if (method === 'GET' && sub === 'profilepreview') return ok(profileEmail(s, c, query.appUrl));
        if (sub === 'invoice') { // invoice email for one payment (default: the latest one), in the customer's language
          const sales = (await getSales()).filter((x) => x.customerId === c.id && x.type !== 'trial' && Number(x.amount) > 0).sort((a, b) => (b.at || 0) - (a.at || 0));
          if (method === 'GET' && !query.saleId) return ok({ sales: sales.slice(0, 30).map((x) => ({ id: x.id, at: x.at, planName: x.planName, amount: x.amount, currency: x.currency, type: x.type, no: invoiceNo(x), sent: (c.invoices || {})[x.id] || 0 })) });
          const sale = sales.find((x) => x.id === String(body.saleId || query.saleId || '')) || sales[0]; if (!sale) return err(404, 'No payment recorded for this customer yet.');
          const m = invoiceEmail(s, c, sale, body.appUrl || query.appUrl);
          if (method === 'GET' || body.preview) return ok(m);
          const to = String(body.to || c.email || '').trim(); if (!cleanEmail(to)) return err(400, 'This customer has no email address.');
          const r = await sendEmail(s, to, m.subject, m.html);
          if (r.ok) { markSent(c, 'email'); c.invoices = { ...(c.invoices || {}), [sale.id]: Date.now() }; await saveCustomers(list); }
          await log('customer', `Invoice ${m.no} to ${c.username} <${to}>${r.ok ? '' : ' — failed: ' + r.error}`);
          return r.ok ? ok({ ...r, no: m.no }) : err(502, r.error || 'Email failed');
        }
        if (method === 'POST' && sub === 'profilemail') {
          const to = String(body.to || c.email || '').trim(); if (!to) return err(400, 'This customer has no email address.');
          const m = profileEmail(s, c, body.appUrl); const r = await sendEmail(s, to, m.subject, m.html);
          if (r.ok) { markSent(c, 'email'); c.profileMailAt = Date.now(); await saveCustomers(list); }
          await log('customer', `Profile email to ${c.username} <${to}>${r.ok ? '' : ' — failed: ' + r.error}`);
          return r.ok ? ok(r) : err(502, r.error || 'Email failed');
        }
        if (method === 'POST' && sub === 'tgsend') { // sends a text through your Telegram bot, when this customer has started the bot
          const text = String(body.text || '').slice(0, 3800).trim(); if (!text) return err(400, 'Write a message first.');
          const chat = await tgFindChat(c);
          if (!chat) return ok({ sent: false, linked: false });
          const rr = await tgSend(s, chat, text); if (!rr.ok) return err(502, 'Telegram: ' + (rr.error || 'not sent'));
          markSent(c, 'telegram'); await saveCustomers(list); await log('customer', `Telegram message to ${c.username}`);
          return ok({ sent: true, linked: true });
        }
        if (method === 'POST' && sub === 'wamsg') { // WhatsApp message for this customer
          const waOwn = (s.waCustom || []).find((x) => 'c:' + x.id === body.type);
          const type = waOwn ? body.type : WA_TPL[body.type] ? body.type : 'pay'; const lang = LANG_CODES.includes(body.lang) ? body.lang : okLang(c.lang);
          const base = s.orderPackages.find((p) => p.id === body.pkg) || s.orderPackages[0] || { id: 'custom', title: 'Package', days: 30, devices: 1, price: 0, links: [] };
          const num = (x, d) => (x === '' || x == null || isNaN(Number(x)) ? d : Number(x));
          const pk = { ...base, title: String(body.title || '').trim() || base.title, price: num(body.price, base.price), days: Math.max(1, num(body.days, base.days)), devices: Math.max(1, num(body.devices, base.devices)) };
          const st = body.currency && ['EUR', 'USD', 'USDT', 'ALL', 'MAD', 'THB'].includes(body.currency) ? { ...s, orderCurrency: body.currency } : s;
          if (locked) { body.link = ''; body.price = undefined; body.title = ''; } // agents: ready messages, price and link from the panel
          let pl = /^https?:\/\/\S+$/.test(String(body.link || '').trim()) ? { url: String(body.link).trim(), acc: '' } : null;
          const customPrice = body.price !== undefined && body.price !== null && String(body.price).trim() !== '';
          const cur = customPrice && body.currency && !['AUTO', 'ALL'].includes(body.currency) ? body.currency : s.currencyRule?.on !== false ? custCurrency(s, c) : body.currency && !['AUTO', 'ALL'].includes(body.currency) ? body.currency : st.orderCurrency === 'ALL' ? pl?.cur || 'EUR' : st.orderCurrency || 'EUR';
          if (!pl && !customPrice && (type === 'pay' || type === 'renew' || String(type).startsWith('promo_') || type === 'ibo_promo')) { const n = await nextPayLink(s, type === 'ibo_promo' ? (s.orderPackages.find((p) => p.id === iboCfg(s).pkg) || s.orderPackages.find((p) => p.id === 'ibo1y') || pk) : pk, cur, !body.log); if (n) pl = { url: n.url, acc: n.acc }; } // matching link (GreenApp Host, rotation)
          const price = (CUR_SIGN[cur] || '') + Number(pk.price).toFixed(2) + (CUR_SIGN[cur] ? '' : ' ' + cur);
          const dns = String(c.dns || s.email.dns || s.player.serverUrl || '').replace(/\/+$/, '');
          const lu = c.lineUsername || c.username, lp = c.linePassword || c.loginPassword || '';
          const vars = { name: (c.name || '').split(' ')[0], fullname: c.name || '', app: s.branding.appName || 'IPTV', package: pk.title, price, days: pk.days, devices: pk.devices,
            link: pl?.url || '', username: lu, password: lp, dns, m3u: dns && lp ? `${dns}/get.php?username=${encodeURIComponent(lu)}&password=${encodeURIComponent(lp)}&type=m3u_plus&output=ts` : '',
            expires: c.expiresAt < Date.now() - 90 * DAYMS ? new Date(c.expiresAt).toLocaleDateString(langLocale(lang), { month: 'long', year: 'numeric' }) : new Date(c.expiresAt).toLocaleDateString(langLocale(lang), { dateStyle: 'long' }), appUrl: String(s.email.appUrl || body.appUrl || '').replace(/\/+$/, ''),
            website: s.email.website || '', order: c.orderNo || '', connections: connsText(c, s, lang),
            promo: promoLive(s, body.channel === 'telegram' ? 'telegram' : 'whatsapp') ? promoText(s, lang, s.promo) : '', iboPrice: (() => { const ip = (s.iboPromo || IBO_PROMO_DEF).price || 5.99; return (CUR_SIGN[cur] || '') + Number(ip).toFixed(2) + (CUR_SIGN[cur] ? '' : ' ' + cur); })(), support: supportUrl(s, body.appUrl), trial: (String(s.email.appUrl || body.appUrl || 'https://intproto-tv.store').replace(/\/+$/, '')) + '/freetrial', supportEmail: supportMail(s), code: promoLive(s) ? String(s.promo.code) : '',
            ends: tx(lang, c.expiresAt < Date.now() - 90 * DAYMS ? 'inactiveSince' : c.expiresAt < Date.now() ? 'endedOn' : 'endsOn') };
          const tpl = String(body.template || (waOwn ? waOwn.text[lang] || waOwn.text.en || waOwn.text.fr || waOwn.text.ar : s.waTemplates?.[type]?.[lang] || WA_TPL[type][lang]));
          const out = []; // a line whose value is empty (e.g. no DNS yet) is left out, with its label line
          for (const line of tpl.split('\n')) {
            const empty = [...line.matchAll(/\{(\w+)\}/g)].some((m) => m[1] in vars && String(vars[m[1]]) === '');
            if (empty) { if (/^\s*\{\w+\}\s*$/.test(line) && /:\s*$/.test(out.at(-1) || '')) out.pop(); continue; }
            out.push(line.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)));
          }
          let text = out.join('\n').replace(/\n{3,}/g, '\n\n');
          // Extra connections are added to the login / welcome messages; the promotion to renewal, trial and order messages.
          if (vars.connections && ['login', 'thanks', 'trial'].includes(type) && !/\{connections\}/.test(tpl)) text = text.trimEnd() + '\n\n' + vars.connections;
          if (vars.promo && ['renew', 'trial', 'pay'].includes(type) && !/\{promo\}/.test(tpl)) text = text.trimEnd() + '\n\n' + vars.promo;
          // Every message ends with the 24/7 support link (intproto-tv.store/support), unless the template already has {support}
          if (vars.support && s.support?.waLink !== false && !/\{support\}/.test(tpl) && !text.includes(vars.support)) text = text.trimEnd() + '\n\n' + tx(lang, 'supLine', { link: vars.support });
          const phone = String(body.phone || c.whatsapp || c.phone || '').replace(/\D/g, '');
          if (body.log) { markSent(c, body.channel === 'telegram' ? 'telegram' : 'whatsapp'); if (body.channel !== 'telegram') c.waSentAt = Date.now(); c.waSentType = type; if (type !== 'login' && type !== 'support') { c.orderSentPkg = pk.id; c.orderSentAcc = pl?.acc || ''; } await saveCustomers(list); await log('customer', `WhatsApp "${type}" message to ${c.username}${type !== 'login' ? ` (${pk.title}, ${price})` : ''}`); }
          if (cur === 'USD' || cur === 'USDT') text = text.replace(/💶/g, '💵'); // dollar note next to a dollar price
          return ok({ text, phone, lang, type, payAcc: pl?.acc || '', template: tpl, isDefault: waOwn ? true : !s.waTemplates?.[type]?.[lang] });
        }
        if (method === 'GET' && sub === 'renewalpreview') return ok(renewalEmail(s, c, query.appUrl));
        if (method === 'POST' && sub === 'renewal') {
          const to = String(body.to || c.email || '').trim();
          if (!to) return err(400, 'This customer has no email address.');
          const m = renewalEmail(s, c, body.appUrl);
          const r = await sendEmail(s, to, m.subject, m.html);
          if (r.ok) { markSent(c, 'email'); c.renewalSentFor = c.expiresAt; c.renewalSentAt = Date.now(); await saveCustomers(list); const t = await sentToday(); await store.put(t.k, t.n + 1, 2 * 86400); }
          await log('customer', `Renewal email to ${c.username} <${to}>${r.ok ? '' : ' — failed: ' + r.error}`);
          return r.ok ? ok(r) : err(502, r.error || 'Email failed');
        }
        if (method === 'GET' && sub === 'emailpreview') return ok(accessEmail(s, c, c.linePassword, c.isTrial ? 'trial' : 'sub', query.appUrl));
        if (method === 'POST' && sub === 'toggle') {
          const next = c.status === 'disabled' ? 'active' : 'disabled';
          let panel = null;
          if (s.reseller.enabled && s.reseller.autoSync && c.lineId) {
            panel = await panelCall(s, next === 'active' ? 'enable' : 'disable', panelVars(c, s));
            if (!panel.ok && !panel.skipped && !body.force) return err(502, 'Panel: ' + panel.error);
          }
          c.status = next;
          await saveCustomers(list);
          await log('customer', `${next === 'active' ? 'Enabled' : 'Disabled'} ${c.username}`);
          return ok({ customer: viewP(c, s), panel });
        }
        return err(404, 'Not found');
      }

      // ----- finance -----
      if (R('GET', '/api/admin/finance')) {
        await refreshRates(s, false);
        const tx = await getTx();
        const accs = balances(s, tx);
        const days = Number(query.days) || 30;
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const points = [];
        for (let i = days - 1; i >= 0; i--) points.push(start.getTime() - i * DAYMS + DAYMS - 1);
        // one pass over transactions in time order → daily balance per account
        const sorted = tx.slice().sort((x, y) => x.at - y.at);
        const cur = Object.fromEntries(s.finance.accounts.map((a) => [a.id, Number(a.opening) || 0]));
        const history = Object.fromEntries(s.finance.accounts.map((a) => [a.id, []]));
        const totalHistoryUsd = [];
        let i = 0;
        for (const t of points) {
          while (i < sorted.length && sorted[i].at <= t) {
            const x = sorted[i++];
            if (x.type === 'income' && x.accountId in cur) cur[x.accountId] += x.amount;
            if ((x.type === 'expense' || x.type === 'transfer') && x.accountId in cur) cur[x.accountId] -= x.amount;
            if (x.type === 'transfer' && x.toAccountId in cur) cur[x.toAccountId] += x.toAmount ?? x.amount;
          }
          let tot = 0;
          for (const a of s.finance.accounts) { history[a.id].push(Math.round(cur[a.id] * 100) / 100); tot += toUsd(cur[a.id], a.currency, s.finance.rates); }
          totalHistoryUsd.push(Math.round(tot * 100) / 100);
        }
        const totalUsd = accs.reduce((x, a) => x + a.usd, 0);
        return ok({ accounts: accs, totalUsd, totalMad: fromUsd(totalUsd, 'MAD', s.finance.rates), rates: s.finance.rates, ratesUpdatedAt: s.finance.ratesUpdatedAt, points, history, totalHistoryUsd });
      }
      const sab = path.match(/^\/api\/admin\/stripe\/account\/([\w-]+)\/balance$/);
      if (sab && method === 'GET') { // live balance for one Stripe account, with its own read-only key
        const acct = (s.stripeAccounts || []).find((a) => a.id === sab[1]); if (!acct) return err(404, 'Stripe account not found.');
        if (!acct.rk) return ok({ connected: false, error: 'Add a read-only Stripe key for this account to see its live balance.' });
        let d;
        try { const r = await fetchFn('https://api.stripe.com/v1/balance', { headers: { Authorization: 'Bearer ' + acct.rk } }); d = await r.json(); if (!r.ok) return ok({ connected: true, error: d.error?.message || 'Stripe error ' + r.status }); } catch (e) { return ok({ connected: true, error: e.message }); }
        const cur = String(acct.currency).toLowerCase();
        const sum = (arr) => (arr || []).filter((x) => x.currency === cur).reduce((a, x) => a + x.amount, 0) / 100;
        const nDays = Number(acct.payoutDays) === 2 ? 2 : 7;
        return ok({ connected: true, accountId: acct.id, currency: cur.toUpperCase(), available: sum(d.available), pending: sum(d.pending), payoutDays: nDays, projected: addBizProjection(Date.now(), nDays) });
      }
      if (R('GET', '/api/admin/stripe/revenue')) {
        const tx = await getTx(); const salesAll = (await getSales()) || []; const cutoff = Date.now() - 30 * DAYMS;
        const byAcc = {};
        for (const x of tx) {
          if (x.type !== 'income') continue;
          const acc = (s.finance.accounts || []).find((a) => a.id === x.accountId); if (!acc) continue;
          const usd = toUsd(Number(x.amount) || 0, acc.currency, s.finance.rates);
          const e = (byAcc[acc.id] ||= { accountId: acc.id, usd: 0, n: 0, usd30d: 0, n30d: 0, lastAt: 0 });
          e.usd = Math.round((e.usd + usd) * 100) / 100; e.n++;
          if ((Number(x.at) || 0) >= cutoff) { e.usd30d = Math.round((e.usd30d + usd) * 100) / 100; e.n30d++; }
          e.lastAt = Math.max(e.lastAt || 0, Number(x.at) || 0);
        }
        const saList = Array.isArray(s.stripeAccounts) ? s.stripeAccounts : [];
        const bankToSa = {}; for (const sa of saList) { const b = String(sa.bankId || ''); if (b) (bankToSa[b] ||= []).push(String(sa.id)); }
        const bySa = {}; const unassigned = [];
        for (const x of salesAll) {
          if (x.type === 'trial') continue;
          let sid = String(x.stripeAccountId || '');
          if (!sid && x.accountId && (bankToSa[x.accountId] || []).length === 1) sid = bankToSa[x.accountId][0];
          if (!sid) { if (x.accountId && bankToSa[x.accountId]) unassigned.push(x); continue; }
          const e = (bySa[sid] ||= { accountId: sid, usd: 0, n: 0, usd30d: 0, n30d: 0, lastAt: 0 });
          e.usd = Math.round((e.usd + (Number(x.amountUsd) || 0)) * 100) / 100; e.n++;
          if ((Number(x.at) || 0) >= cutoff) { e.usd30d = Math.round((e.usd30d + (Number(x.amountUsd) || 0)) * 100) / 100; e.n30d++; }
          e.lastAt = Math.max(e.lastAt || 0, Number(x.at) || 0);
        }
        return ok({ revenue: Object.values(byAcc), total: Object.values(byAcc).reduce((a, x) => ({ usd: Math.round((a.usd + x.usd) * 100) / 100, n: a.n + x.n, usd30d: Math.round((a.usd30d + x.usd30d) * 100) / 100, n30d: a.n30d + x.n30d }), { usd: 0, n: 0, usd30d: 0, n30d: 0 }), stripeAccounts: Object.values(bySa), unattributedN: unassigned.length });
      }
      if (R('GET', '/api/admin/stripe/balance')) { // live balance from Stripe, compared with the app
        const key = s.finance.stripeKey;
        if (!key) return ok({ connected: false });
        let d;
        try { const r = await fetchFn('https://api.stripe.com/v1/balance', { headers: { Authorization: 'Bearer ' + key } }); d = await r.json(); if (!r.ok) return ok({ connected: true, error: d.error?.message || 'Stripe error ' + r.status }); }
        catch (e) { return ok({ connected: true, error: e.message }); }
        const acc = s.finance.accounts.find((a) => a.id === (s.finance.stripeAccountId || 'stripe'));
        const cur = (acc?.currency || 'USD').toLowerCase();
        const sum = (arr) => (arr || []).filter((x) => x.currency === cur).reduce((a, x) => a + x.amount, 0) / 100;
        const other = (arr) => (arr || []).filter((x) => x.currency !== cur).map((x) => `${x.amount / 100} ${x.currency.toUpperCase()}`);
        const appBal = acc ? balances(s, await getTx()).find((b) => b.id === acc.id).balance : 0;
        const saMatch = (s.stripeAccounts || []).find((x) => x.id === (s.finance.stripeAccountId || 'stripe'));
        const nDays = Number(saMatch?.payoutDays) === 2 ? 2 : 7;
        return ok({ connected: true, accountId: acc?.id, currency: cur.toUpperCase(), available: sum(d.available), pending: sum(d.pending), otherCurrencies: [...other(d.available), ...other(d.pending)], app: appBal, payoutDays: nDays, projected: addBizProjection(Date.now(), nDays) });
      }
      if (R('POST', '/api/admin/stripe/match')) { // add one adjustment so the app equals Stripe
        const acc = s.finance.accounts.find((a) => a.id === (s.finance.stripeAccountId || 'stripe'));
        if (!acc) return err(400, 'Stripe account not found in Banks.');
        const target = Number(body.target);
        if (!isFinite(target)) return err(400, 'Missing Stripe balance.');
        const tx = await getTx(); const cur = balances(s, tx).find((b) => b.id === acc.id).balance;
        const diff = Math.round((target - cur) * 100) / 100;
        if (!diff) return ok({ ok: true, diff: 0 });
        tx.push({ id: uid(6), by: actorName, at: Date.now(), type: diff > 0 ? 'income' : 'expense', accountId: acc.id, amount: Math.abs(diff), category: 'Stripe sync', note: `Matched to Stripe balance ${target} ${acc.currency}` });
        await store.put('tx', tx);
        await log('finance', `Stripe synced: ${diff > 0 ? '+' : ''}${diff} ${acc.currency}`);
        return ok({ ok: true, diff });
      }
      if (R('POST', '/api/admin/rates/refresh')) { const n = await refreshRates(s, true); return ok({ rates: n.finance.rates, ratesUpdatedAt: n.finance.ratesUpdatedAt }); }
      if (R('GET', '/api/admin/sales-by-day')) {
        const sales = (await getSales()).filter((x) => x.type !== 'trial');
        const mk = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        const monthKey = (t) => monthKeyOf(new Date(t));
        const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const today = mk(Date.now()), yest = mk(Date.now() - DAYMS);
        const days = {}; for (let i = 29; i >= 0; i--) { const k = mk(Date.now() - i * DAYMS); days[k] = { usd: 0, n: 0 }; }
        const months = {}; for (let i = 11; i >= 0; i--) { const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1); months[monthKeyOf(d)] = 0; }
        let todayUsd = 0, todayN = 0, yestUsd = 0, yestN = 0, monthUsd = 0, monthN = 0; const curMonth = monthKeyOf(new Date());
        for (const x of sales) {
          const u = Number(x.amountUsd) || 0; const k = mk(x.at);
          if (k in days) { days[k].usd += u; days[k].n++; }
          if (k === today) { todayUsd += u; todayN++; } else if (k === yest) { yestUsd += u; yestN++; }
          if (monthKey(x.at) === curMonth) { monthUsd += u; monthN++; }
          const mk2 = monthKey(x.at); if (mk2 in months) months[mk2] += u;
        }
        for (const k in days) days[k].usd = Math.round(days[k].usd * 100) / 100;
        for (const k in months) months[k] = Math.round(months[k] * 100) / 100;
        const best = Object.entries(days).sort((a, b) => b[1].usd - a[1].usd)[0] || [today, { usd: 0, n: 0 }];
        const avg = monthN ? Math.round((monthUsd / monthN) * 100) / 100 : 0;
        const recent = sales.slice().sort((a, b) => b.at - a.at).slice(0, 50).map((x) => { const acc = s.finance.accounts.find((a) => a.id === x.accountId); return { id: x.id, at: x.at, name: x.name, username: x.username, planName: x.planName, type: x.type, amount: x.amount, currency: x.currency, amountUsd: Math.round((Number(x.amountUsd) || 0) * 100) / 100, credits: x.credits, accountName: acc ? acc.name : '' }; });
        return ok({ today: Math.round(todayUsd * 100) / 100, todayN, yest: Math.round(yestUsd * 100) / 100, yestN, month: Math.round(monthUsd * 100) / 100, monthN, avg, bestDay: best[0], bestUsd: best[1] ? Math.round(best[1].usd * 100) / 100 : 0, days30: Object.entries(days).map(([k, v]) => ({ d: k, usd: v.usd, n: v.n })), months: Object.entries(months).map(([k, v]) => ({ k, usd: v })), recent });
      }
      if (R('GET', '/api/admin/tx')) {
        const tx = await getTx();
        return ok(tx.filter((t) => !query.account || t.accountId === query.account || t.toAccountId === query.account).sort((a, b) => b.at - a.at).slice(0, Number(query.limit) || 300));
      }
      if (R('POST', '/api/admin/tx')) {
        const type = ['income', 'expense', 'transfer'].includes(body.type) ? body.type : null;
        const acc = s.finance.accounts.find((a) => a.id === body.accountId);
        const amount = Math.abs(Number(body.amount) || 0);
        if (!type || !acc || !amount) return err(400, 'Choose a type, an account and an amount.');
        const t = { id: uid(6), by: actorName, at: body.date ? new Date(body.date).getTime() + 12 * 3600000 : Date.now(), type, accountId: acc.id, amount, category: String(body.category || (type === 'transfer' ? 'Transfer' : 'Other')), note: String(body.note || '').slice(0, 200) };
        if (type === 'transfer') {
          const to = s.finance.accounts.find((a) => a.id === body.toAccountId);
          if (!to || to.id === acc.id) return err(400, 'Choose a different destination account.');
          t.toAccountId = to.id;
          t.toAmount = body.toAmount ? Math.abs(Number(body.toAmount)) : Math.round(fromUsd(toUsd(amount, acc.currency, s.finance.rates), to.currency, s.finance.rates) * 100) / 100;
        }
        const tx = await getTx(); tx.push(t); await store.put('tx', tx);
        await log('finance', `${type} ${amount} ${acc.currency} · ${acc.name}${t.toAccountId ? ' → ' + s.finance.accounts.find((a) => a.id === t.toAccountId).name : ''} · ${t.category}`);
        return ok(t);
      }
      const txm = path.match(/^\/api\/admin\/tx\/(\w+)$/);
      if (txm && method === 'DELETE') {
        const tx = await getTx(); const t = tx.find((x) => x.id === txm[1]);
        if (!t) return err(404, 'Not found');
        await store.put('tx', tx.filter((x) => x !== t));
        // keep everything in sync: remove the sale / credit purchase this payment belongs to
        if (t.saleId) { const sales = await getSales(); await store.put('sales', sales.filter((x) => x.id !== t.saleId)); }
        if (t.stockId) { const st = await getStock(); await store.put('stock', st.filter((x) => x.id !== t.stockId)); }
        await log('finance', `Deleted transaction ${t.type} ${t.amount}`);
        return ok({ ok: true });
      }
      if (R('DELETE', '/api/admin/tx')) {
        const tx = await getTx();
        const count = tx.length;
        await store.put('tx', []);
        await log('finance', `Cleared all ${count} transactions`);
        return ok({ ok: true, cleared: count });
      }
      // ----- stock / credits -----
      if (R('GET', '/api/admin/stock')) {
        const info = await stockInfo(s);
        let panel = null;
        if (s.reseller.enabled && query.panel === '1') { const r = await panelCredits(s); panel = { ok: r.ok, credits: r.credits, error: r.error, last: r.last }; }
        return ok({ ...info, panel, settings: s.stock });
      }
      if (R('POST', '/api/admin/stock')) {
        const credits = Math.round(Number(body.credits) || 0);
        if (!credits) return err(400, 'Enter the number of credits.');
        const acc = s.finance.accounts.find((a) => a.id === body.accountId);
        const cost = Math.abs(Number(body.cost) || 0);
        const currency = acc ? acc.currency : (/^[A-Z]{3}$/.test(String(body.currency || '')) ? body.currency : 'USD');
        // paid: 'yes' (paid now from the account), 'no' (owed to the supplier), 'part' (paidAmount now)
        const mode = body.paid === 'no' || body.paid === false ? 'no' : body.paid === 'part' ? 'part' : 'yes';
        if (mode !== 'no' && cost && !acc) return err(400, 'Choose the account you paid from, or mark it Not paid.');
        const payNow = mode === 'yes' ? cost : mode === 'part' ? Math.min(cost, Math.abs(Number(body.paidAmount) || 0)) : 0;
        const at = body.date ? new Date(body.date).getTime() + 12 * 3600000 : Date.now();
        const p = { id: uid(6), at, credits, cost, currency, costUsd: toUsd(cost, currency, s.finance.rates), accountId: acc ? acc.id : '', supplier: cleanText(body.supplier || 'TVplus', 60) || 'TVplus', note: cleanText(body.note, 300), handedTo: cleanText(body.handedTo, 60), payments: [], payStatus: mode === 'no' ? 'unpaid' : '', by: actorName };
        if (payNow > 0) p.payments.push({ id: uid(6), at, amount: r2(payNow), accountId: acc.id, by: actorName });
        const st = await getStock(); st.push(p); await store.put('stock', st);
        if (payNow > 0) { const tx = await getTx(); tx.push({ id: uid(6), at, type: 'expense', accountId: acc.id, amount: r2(payNow), category: 'Credits purchase', note: `${credits} credits · ${p.supplier}`, stockId: p.id, payId: p.payments[0].id }); await store.put('tx', tx); }
        await log('stock', `Bought ${credits} credits from ${p.supplier} for ${cost} ${currency} — ${payNow >= cost ? 'paid' : payNow > 0 ? `paid ${r2(payNow)}, owes ${r2(cost - payNow)}` : 'not paid yet'}`);
        return ok(stockView(p));
      }
      const stm = path.match(/^\/api\/admin\/stock\/(\w+)$/);
      const stp = path.match(/^\/api\/admin\/stock\/(\w+)\/pay(?:\/(\w+))?$/);
      if (stp) {
        const st = await getStock(); const p = st.find((x) => x.id === stp[1]); if (!p) return err(404, 'Batch not found.');
        if (!Array.isArray(p.payments)) p.payments = stockPays(p); // move old batches to the payment list
        if (method === 'POST' && !stp[2]) { // record a payment to the supplier
          const v = stockView(p); const amount = r2(body.amount === 'rest' || body.amount === undefined || body.amount === '' ? v.due : Math.abs(Number(body.amount) || 0));
          if (!(amount > 0)) return err(400, v.due > 0 ? 'Enter the amount paid.' : 'This batch is already paid. Add its cost first if it was missing.');
          if (amount > v.due + 0.004 && Number(p.cost)) return err(400, `Only ${v.due} ${p.currency} is left to pay.`);
          const acc = s.finance.accounts.find((a) => a.id === body.accountId) || s.finance.accounts.find((a) => a.id === p.accountId); if (!acc) return err(400, 'Choose the account you paid from.');
          const at = body.date ? new Date(body.date).getTime() + 12 * 3600000 : Date.now(); const pay = { id: uid(6), at, amount, accountId: acc.id, by: actorName, note: cleanText(body.note, 200) };
          p.payments.push(pay); if (!p.accountId) p.accountId = acc.id; p.payStatus = ''; await store.put('stock', st);
          const tx = await getTx(); tx.push({ id: uid(6), at, type: 'expense', accountId: acc.id, amount, category: 'Credits purchase', note: `${p.credits} credits · ${p.supplier} (payment)`, stockId: p.id, payId: pay.id }); await store.put('tx', tx);
          await log('stock', `Paid ${amount} ${p.currency} to ${p.supplier} for ${p.credits} credits`);
          return ok(stockView(p));
        }
        if (method === 'DELETE' && stp[2]) { // undo a payment
          const pay = p.payments.find((x) => x.id === stp[2]); if (!pay) return err(404, 'Payment not found.');
          p.payments = p.payments.filter((x) => x !== pay); await store.put('stock', st);
          const tx = await getTx(); await store.put('tx', tx.filter((x) => !(x.stockId === p.id && (x.payId === pay.id || (pay.id === 'legacy' && !x.payId)))));
          await log('stock', `Payment of ${pay.amount} ${p.currency} to ${p.supplier} undone`);
          return ok(stockView(p));
        }
        return err(405, 'Method not allowed');
      }
      if (stm && method === 'PUT') { // supplier, note, cost, who it's handed to, or mark Not paid
        const st = await getStock(); const p = st.find((x) => x.id === stm[1]); if (!p) return err(404, 'Batch not found.');
        if (!Array.isArray(p.payments)) p.payments = stockPays(p);
        if (body.supplier !== undefined) p.supplier = cleanText(body.supplier, 60) || p.supplier;
        if (body.note !== undefined) p.note = cleanText(body.note, 300);
        if (body.handedTo !== undefined) { p.handedTo = cleanText(body.handedTo, 60); p.handedAt = p.handedTo ? Date.now() : 0; }
        if (body.cost !== undefined) { const c = Math.abs(Number(body.cost) || 0); const paid = p.payments.reduce((a, x) => a + x.amount, 0); if (c && c + 0.004 < paid) return err(400, `Already paid ${r2(paid)} — the cost can't be less.`); p.cost = c; p.costUsd = toUsd(c, p.currency, s.finance.rates); }
        if (body.currency && /^[A-Z]{3}$/.test(body.currency) && !p.payments.length) { p.currency = body.currency; p.costUsd = toUsd(p.cost, p.currency, s.finance.rates); }
        if (body.payStatus === 'unpaid' && !p.payments.length) p.payStatus = 'unpaid'; else if (body.payStatus === 'nocost') p.payStatus = '';
        await store.put('stock', st);
        await log('stock', `Credit batch ${p.credits} (${p.supplier}) updated${body.handedTo !== undefined ? ' — handed to ' + (p.handedTo || 'nobody') : ''}`);
        return ok(stockView(p));
      }
      if (stm && method === 'DELETE') {
        const st = await getStock(); await store.put('stock', st.filter((x) => x.id !== stm[1]));
        const tx = await getTx(); await store.put('tx', tx.filter((x) => x.stockId !== stm[1]));
        return ok({ ok: true });
      }
      // ----- profits -----
      if (R('GET', '/api/admin/profits')) {
        const sales = (await getSales()).filter((x) => x.type !== 'trial');
        const tx = await getTx();
        const other = tx.filter((t) => t.type === 'expense' && t.category !== 'Credits purchase');
        const period = ['week', 'month', 'year'].includes(query.period) ? query.period : 'month';
        const keyOf = (t) => {
          const d = new Date(t);
          if (period === 'year') return String(d.getFullYear());
          if (period === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
          return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
        };
        const now = new Date(); const keys = [];
        if (period === 'year') for (let i = 4; i >= 0; i--) keys.push(String(now.getFullYear() - i));
        else if (period === 'month') for (let i = 11; i >= 0; i--) keys.push(keyOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
        else for (let i = 11; i >= 0; i--) keys.push(keyOf(Date.now() - i * 7 * DAYMS));
        const b = Object.fromEntries(keys.map((k) => [k, { key: k, sales: 0, revenueUsd: 0, costUsd: 0, otherUsd: 0 }]));
        for (const x of sales) { const k = keyOf(x.at); if (b[k]) { b[k].sales++; b[k].revenueUsd += x.amountUsd || 0; b[k].costUsd += x.costUsd || 0; } }
        for (const t of other) { const k = keyOf(t.at); const acc = s.finance.accounts.find((a) => a.id === t.accountId); if (b[k]) b[k].otherUsd += toUsd(t.amount, acc ? acc.currency : 'USD', s.finance.rates); }
        const buckets = keys.map((k) => { const v = b[k]; v.grossUsd = v.revenueUsd - v.costUsd; v.netUsd = v.grossUsd - v.otherUsd; return v; });
        const sum = (f) => sales.reduce((a, x) => a + f(x), 0);
        return ok({
          period, buckets, madRate: s.finance.rates.MAD,
          totals: { sales: sales.length, revenueUsd: sum((x) => x.amountUsd || 0), costUsd: sum((x) => x.costUsd || 0), profitUsd: sum((x) => (x.amountUsd || 0) - (x.costUsd || 0)) },
          recent: sales.slice().sort((a, x) => x.at - a.at).slice(0, 60).map((x) => ({ ...x, profitUsd: (x.amountUsd || 0) - (x.costUsd || 0) })),
        });
      }
      if (path.startsWith('/api/admin/trialpool')) { // lines you made on the panel in advance, handed to new trials one by one
        const pool = (await store.get('trialpool')) || [];
        if (R('GET', '/api/admin/trialpool')) return ok({ lines: pool.map((x) => ({ u: x.u, dns: x.dns })) });
        if (R('POST', '/api/admin/trialpool')) {
          const used = new Set((await getCustomers()).map((c) => String(c.lineUsername || '').toLowerCase())); let added = 0, skipped = 0;
          for (const row of String(body.add || '').split(/\r?\n/)) { if (!row.trim()) continue; const ln = parseLineLink(row); if (!ln || used.has(ln.u.toLowerCase()) || pool.some((x) => x.u === ln.u)) { skipped++; continue; } pool.push(ln); added++; }
          if (added) { await store.put('trialpool', pool.slice(0, 500)); await log('settings', `Added ${added} ready trial line(s)`); }
          return ok({ added, skipped, count: pool.length });
        }
        if (R('POST', '/api/admin/trialpool/remove')) { const next = body.all ? [] : pool.filter((x) => x.u !== String(body.u || '')); await store.put('trialpool', next); return ok({ count: next.length }); }
        return err(404, 'Not found');
      }
      if (R('GET', '/api/admin/templates')) return ok({ defaults: tplDefaults(), custom: s.mailTexts || {}, waDefaults: WA_TPL, wa: s.waTemplates || {}, waCustom: s.waCustom || [] });
      if (R('POST', '/api/admin/templates/preview')) { // shows an email with wording that is not saved yet, using a made-up customer
        const lang = okLang(body.lang);
        const sample = { id: 'sample', name: 'Sara Example', username: 'sara2026', lang, email: 'sara@example.com', lineUsername: 'sara2026', linePassword: 'Pass1234', expiresAt: Date.now() + 30 * DAY, startAt: Date.now(), isTrial: body.kind === 'trial', connections: 1, planId: (s.plans[0] || {}).id };
        applyMailTexts(cleanMailTexts(body.mailTexts)); setMailLang('customer');
        let out;
        try {
          const url = String(s.email.appUrl || body.appUrl || '');
          if (body.kind === 'renewal') out = renewalEmail(isObj(body.promo) ? { ...s, promo: { ...(s.promo || {}), ...body.promo, on: true, from: '' } } : s, sample, url);
          else if (body.kind === 'order') out = orderEmail(s, sample, (s.orderPackages || [])[0] || { id: 'x', title: '1 Month', days: 30, devices: 1, price: 29.99 }, url);
          else if (body.kind === 'expiry') out = { subject: mt(lang, 'expirySubject', { days: 3 }), html: mailHtml(s, lang, [[mt(lang, 'user'), sample.username], [mt(lang, 'expires'), new Date(sample.expiresAt).toLocaleDateString()]], mt(lang, 'expiryBody', { date: new Date(sample.expiresAt).toLocaleDateString() }), sample.name) };
          else out = accessEmail(s, sample, 'Pass1234', body.kind === 'trial' ? 'trial' : 'sub', url);
        } finally { applyMailTexts(s.mailTexts); setMailLang(s.email.lang); }
        return ok({ subject: out.subject, html: out.html });
      }
      if (R('GET', '/api/admin/email/recent')) { // the latest emails Resend sent for this account, with their delivery status
        if (!mailKeys(s).length) return err(400, 'Email is not set up (Resend key missing).');
        let res, d, lastErr = '', okData = null;
        for (const k of mailKeys(s)) {
          try { res = await fetchFn('https://api.resend.com/emails?limit=100', { headers: { Authorization: 'Bearer ' + k } }); d = await res.json().catch(() => ({})); } catch (e) { lastErr = 'Could not reach Resend: ' + e.message; continue; }
          if (res.ok) { okData = d; break; }
          lastErr = res.status === 401 || res.status === 403 || /restricted/i.test(d.name || d.message || '') ? 'Your Resend API key can only send. To read the sent emails, create a key with "Full access" in Resend and paste it in Trial & email setup.' : d.message || 'Resend error ' + res.status;
        }
        if (!okData) return err(400, lastErr);
        return ok({ list: (Array.isArray(okData.data) ? okData.data : []).map((m) => ({ id: m.id, to: [].concat(m.to || []).join(', '), subject: m.subject || '', at: Date.parse(m.created_at || '') || 0, status: m.last_event || 'sent' })) });
      }
      if (R('POST', '/api/admin/email/bounces/clearall')) {
        const bad = await getBad(); const only = Array.isArray(body.emails) ? body.emails.map(cleanEmail) : null; let n = 0;
        for (const e of Object.keys(bad)) if (!e.startsWith('ok:') && (!only || only.includes(e))) { delete bad[e]; bad['ok:' + e] = Date.now(); n++; }
        if (n) { await store.put('badEmails', bad); await log('email', `Allowed ${n} paused email address(es) again`); }
        return ok({ ok: true, n });
      }
      if (R('GET', '/api/admin/email/bounces')) {
        const bad = await getBad(); const list = await getCustomers();
        return ok({ at: (await store.get('bouncesync')) || 0, list: Object.entries(bad).filter(([k]) => !k.startsWith('ok:')).map(([email, b]) => ({ email, why: b.why, at: b.at, customers: list.filter((c) => cleanEmail(c.email) === email).map((c) => ({ id: c.id, name: c.name, username: c.username })) })).sort((a, b) => b.at - a.at) });
      }
      if (R('POST', '/api/admin/email/bounces/sync')) { const r = await syncBounces(s); return r.ok ? ok(r) : err(400, r.error); }
      if (R('POST', '/api/admin/email/bounces/clear')) {
        const bad = await getBad(); const e = cleanEmail(body.email);
        if (bad[e]) { delete bad[e]; bad['ok:' + e] = Date.now(); await store.put('badEmails', bad); await log('email', `Allowed email again: ${e}`); }
        return ok({ ok: true });
      }
      if (R('POST', '/api/admin/email/test')) {
        const to = String(body.to || s.email.adminEmail || '').trim();
        const r = await sendEmail(s, to, `${s.branding.appName} · test email`, mailHtml(s, 'en', [['Status', 'Email is working ✅']], 'This is a test email from your IPTV app.', 'Admin'));
        return ok(r);
      }

      if (R('POST', '/api/admin/order/send')) { // body: { ids:[...<=100], pkg: id | 'random' }
        const list = await getCustomers(); const pk = s.orderPackages; if (!pk.length) return err(400, 'No packages');
        const want = new Set((body.ids || []).slice(0, 100));
        const pick = (c) => (body.pkg === 'random' ? pk[Math.floor(Math.random() * pk.length)] : pk.find((p) => p.id === body.pkg));
        if (body.pkg !== 'random' && !pick()) return err(400, 'Choose a package.');
        const fixedB = !locked && /^https?:\/\/\S+$/.test(String(body.link || '').trim()) ? { url: String(body.link).trim(), acc: '' } : undefined;
        const batch = []; for (const c of list.filter((c) => want.has(c.id) && cleanEmail(c.email) && !c.unsub)) { const p = pick(c); let L = fixedB; if (!L && p) { const n = await nextPayLink(s, p, s.currencyRule?.on !== false ? custCurrency(s, c) : s.orderCurrency); if (n) L = { url: n.url, acc: n.acc }; } batch.push({ c, p, m: orderEmail(s, c, p, body.appUrl, L) }); }
        if (!batch.length) return ok({ sent: 0 });
        const r = await sendBatch(s, batch.map(({ c, m }) => ({ to: c.email, subject: m.subject, html: m.html })));
        if (!r.ok) return err(502, r.error);
        const now = Date.now(); for (const { c, p, m } of batch) { markSent(c, 'email'); c.orderSentAt = now; c.orderSentPkg = p.id; c.orderSentAcc = m.payAcc; }
        await saveCustomers(list);
        await log('customer', `Package emails sent to ${batch.length} customers (${body.pkg === 'random' ? 'random packages' : batch[0].p.title})`);
        return ok({ sent: batch.length });
      }
      if (R('GET', '/api/admin/promo/library')) { // every ready promotion: email + WhatsApp + app notification texts in 5 languages
        const site = String(s.email.appUrl || 'https://intproto-tv.store').replace(/\/+$/, ''); const app = s.branding.appName || 'INTPROTO-TV';
        const o = { offer: query.offer, code: query.code, end: query.end };
        const fillW = (t) => t.replace(/\{app\}/g, app).replace(/\{trial\}/g, site + '/freetrial').replace(/\{support\}/g, site + '/support');
        return ok({ kinds: SEASON_KINDS.map((k) => ({ ...k, names: SEASON[k.id].names, wa: Object.fromEntries(LANG_CODES.map((l) => [l, fillW(seasonWa(k.id, l, o))])), note: Object.fromEntries(LANG_CODES.map((l) => [l, { title: fillW(SEASON[k.id][l].t), body: fillW(SEASON[k.id][l].b.split('\n\n')[0]) }])) })) });
      }
      if (R('GET', '/api/admin/newsletter/season')) return ok({ kinds: SEASON_KINDS, campaign: seasonCampaign(s, String(query.kind || 'blackfriday'), { offer: query.offer, code: query.code, end: query.end }) });
      if (R('GET', '/api/admin/promo')) return ok({ promo: s.promo || {}, live: !!promoLive(s), campaign: promoCampaign(s), post: promoChannelPost(s), wa: { en: promoText(s, 'en'), fr: promoText(s, 'fr') }, channel: s.branding.telegramChannel || '' });
      if (R('POST', '/api/admin/promo/telegram')) { // posts the promotion in your public Telegram channel (your bot must be an admin there)
        const ch = String(body.channel || s.branding.telegramChannel || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
        if (!ch) return err(400, 'Add your public Telegram channel in Login & branding first.');
        if (!tgOn(s)) return err(400, 'Set up your Telegram bot first (Login & branding → Telegram).');
        const text = String((!locked && body.text) || promoChannelPost(s)).slice(0, 3800).trim();
        const r = await tgSend(s, /^-?\d+$/.test(ch) ? ch : '@' + ch, text);
        await log('marketing', `Telegram channel post @${ch}${r.ok ? '' : ' — failed: ' + r.error}`);
        if (!r.ok) return err(502, `Telegram: ${r.error || 'not sent'}. Add your bot to the channel as an admin who can post messages, then try again.`);
        return ok({ ok: true });
      }
      if (R('GET', '/api/admin/newsletter')) { // groups and saved draft
        const list = await getCustomers(); const w = Number(s.userDashboard.expiryWarningDays) || 7; const camp = (await store.get('newsletter')) || null;
        const groups = Object.fromEntries(['all', 'paying', 'active', 'expiring', 'expired', 'trial'].map((g) => { const t = nlGroup(list, g, w); return [g, { total: t.length, left: camp?.id ? t.filter((c) => c.nlLast !== camp.id).length : t.length }]; }));
        return ok({ groups, camp, unsubscribed: list.filter((c) => c.unsub).length });
      }
      if (locked && path.startsWith('/api/admin/newsletter')) { const saved = await store.get('newsletter'); if (path === '/api/admin/newsletter/new') return err(403, 'Only the owner and the Technical Service can write a new newsletter.'); if (!saved || !saved.content) return err(400, 'No newsletter is ready yet. The owner or the Technical Service writes it first.'); body.camp = { ...saved }; } // agents send the saved newsletter as it is
      if (R('GET', '/api/admin/newsletter/saved')) { const sv = await store.get('newsletter'); return ok(sv || {}); }
      if (R('POST', '/api/admin/newsletter/preview')) { const m = newsletterEmail(s, { name: body.name ?? 'Linko', lang: body.lang || 'en' }, body.camp || {}, body.appUrl, '#'); return ok(m); }
      if (R('POST', '/api/admin/newsletter/send')) { // body: { camp, group, test }
        const camp = body.camp || {}; if (!Object.values(camp.content || {}).some((x) => x?.subject || x?.title)) return err(400, 'Write a subject or a title first.');
        if (body.test) { const to = cleanEmail(body.test); if (!to) return err(400, 'Enter a valid test email.'); const m = newsletterEmail(s, { name: 'Linko', lang: body.lang || 'en' }, camp, body.appUrl, '#'); const r = await sendEmail(s, to, '[TEST] ' + m.subject, m.html); return r.ok ? ok({ sent: 1 }) : err(502, r.error); }
        if (!camp.id) camp.id = 'nl' + uid(4);
        await store.put('newsletter', { ...camp, group: body.group, savedAt: Date.now() });
        const list = await getCustomers(); const targets = nlGroup(list, body.group, Number(s.userDashboard.expiryWarningDays) || 7).filter((c) => c.nlLast !== camp.id);
        const batch = targets.slice(0, 100); if (!batch.length) return ok({ sent: 0, left: 0, id: camp.id });
        const msgs = []; for (const c of batch) { const m = newsletterEmail(s, c, camp, body.appUrl, await unsubUrl(s, c, body.appUrl)); msgs.push({ to: c.email, subject: m.subject, html: m.html }); }
        const r = await sendBatch(s, msgs); if (!r.ok) return err(502, r.error);
        const now = Date.now(); for (const c of batch) { c.nlLast = camp.id; c.nlAt = now; }
        await saveCustomers(list);
        await log('customer', `Newsletter "${(camp.content.all || camp.content.en || Object.values(camp.content)[0])?.subject || ''}" sent to ${batch.length} (${body.group})`);
        return ok({ sent: batch.length, left: targets.length - batch.length, id: camp.id });
      }
      if (R('POST', '/api/admin/newsletter/new')) { await store.del('newsletter'); return ok({ ok: true }); }
      if (R('POST', '/api/admin/order/custom') && locked && !body.preview) return err(403, 'Emails with your own text, price or link are for the owner and the Technical Service. Use the package email (💳), it has the right link.');
      if (R('POST', '/api/admin/order/custom')) { // manual email: any address, own details; body.preview = only build it
        const base = s.orderPackages.find((p) => p.id === body.pkg) || s.orderPackages[0] || { id: 'custom', title: 'Package', days: 30, devices: 1, price: 0, links: [] };
        const num = (x, d) => (x === '' || x == null || isNaN(Number(x)) ? d : Number(x));
        const pk = { ...base, title: String(body.title || '').trim() || base.title, price: num(body.price, base.price), days: Math.max(1, num(body.days, base.days)), devices: Math.max(1, num(body.devices, base.devices)), badge: body.badge != null ? String(body.badge) : base.badge };
        const st = body.currency && ['EUR', 'USD', 'USDT', 'ALL', 'MAD', 'THB'].includes(body.currency) ? { ...s, orderCurrency: body.currency, currencyRule: { on: false } } : s;
        const fixed = /^https:\/\/\S+$/.test(String(body.link || '').trim()) ? { url: String(body.link).trim(), acc: '' } : null;
        const who = { name: String(body.name || '').trim(), lang: okLang(body.lang), note: String(body.note || '').trim().slice(0, 2000) };
        const m = orderEmail(st, who, pk, body.appUrl, fixed || undefined);
        if (body.subject) m.subject = String(body.subject).slice(0, 200);
        if (body.preview) return ok(m);
        const to = cleanEmail(body.to); if (!to) return err(400, 'Enter a valid email address.');
        const r = await sendEmail(s, to, m.subject, m.html);
        await log('customer', `Custom package email "${pk.title}" to <${to}>${r.ok ? '' : ' — failed: ' + r.error}`);
        if (body.saveCustomer && r.ok) { const list = await getCustomers(); const c = list.find((x) => cleanEmail(x.email) === to); if (c) { c.orderSentAt = Date.now(); c.orderSentPkg = base.id; c.orderSentAcc = m.payAcc; await saveCustomers(list); } }
        return r.ok ? ok({ ...r, payAcc: m.payAcc }) : err(502, r.error || 'Email failed');
      }
      if (R('POST', '/api/admin/clean-emails')) {
        const list = await getCustomers(); let fixed = 0;
        for (const c of list) { if (!c.email) continue; const e = cleanEmail(c.email); if (e && e !== c.email) { c.email = e; fixed++; } }
        if (fixed) await saveCustomers(list);
        await log('customer', `Cleaned ${fixed} email addresses`);
        return ok({ fixed });
      }
      // ----- duplicates -----
      if (R('GET', '/api/admin/duplicates')) {
        const list = await getCustomers();
        const useName = query.name === '1';
        const byKey = new Map();
        for (const c of list) for (const [t, v] of contactKeys(c)) {
          if (t === 'name' && !useName) continue;
          const k = t + ':' + v;
          if (!byKey.has(k)) byKey.set(k, []);
          if (!byKey.get(k).includes(c)) byKey.get(k).push(c);
        }
        const out = [];
        for (const [k, members] of byKey) {
          if (members.length < 2) continue;
          const type = k.slice(0, k.indexOf(':')), value = k.slice(k.indexOf(':') + 1);
          out.push({ id: k, type, value: type === 'phone' ? (members.map((m) => m.whatsapp || m.phone).find((x) => String(x || '').replace(/\D/g, '').endsWith(value)) || value) : type === 'name' ? members[0].name : value,
            members: members.map((c) => viewP(c, s)).sort((a, b) => (b.createdAt || b.startAt) - (a.createdAt || a.startAt)) });
        }
        out.sort((a, b) => b.members.length - a.members.length || a.type.localeCompare(b.type));
        return ok({ groups: out, attempts: ((await store.get('dupAttempts')) || []).slice(0, 200), customersInGroups: new Set(out.flatMap((g) => g.members.map((m) => m.id))).size });
      }

      // ----- renewal emails (bulk) -----
      if (R('GET', '/api/admin/renewal/status')) {
        const list = await getCustomers(); const t = await sentToday();
        const invalid = list.filter((c) => c.email && !cleanEmail(c.email) && c.expiresAt < Date.now()).map((c) => ({ id: c.id, name: c.name, username: c.username, orderNo: c.orderNo, email: c.email }));
        return ok({ waiting: renewalTargets(list).length, recent: renewalTargets(list, s.renewalOffer.autoDays || 3).length, sentToday: t.n, dailyLimit: Number(s.renewalOffer.dailyLimit) || 90, invalid });
      }
      if (R('POST', '/api/admin/renewal/send')) { // sends the next batch (max 50 per call, within today's limit)
        const list = await getCustomers(); const t = await sentToday();
        const left = body.all ? 100 : Math.max(0, (Number(s.renewalOffer.dailyLimit) || 90) - t.n);
        if (!left) return ok({ sent: 0, limitReached: true, waiting: renewalTargets(list).length });
        const batch = renewalTargets(list, body.onlyRecentDays).sort((a, b) => b.expiresAt - a.expiresAt).slice(0, Math.min(body.all ? 100 : 50, left));
        const r = await sendBatch(s, batch.map((c) => ({ to: cleanEmail(c.email) || cleanEmail(c.email2), ...renewalEmail(s, c, body.appUrl) })));
        if (!r.ok) return err(502, r.error);
        const now = Date.now(); batch.forEach((c) => { markSent(c, 'email'); c.renewalSentFor = c.expiresAt; c.renewalSentAt = now; });
        await saveCustomers(list); await store.put(t.k, t.n + batch.length, 2 * 86400);
        await log('customer', `Renewal emails sent to ${batch.length} customers`);
        return ok({ sent: batch.length, waiting: renewalTargets(list).length, limitReached: !body.all && t.n + batch.length >= (Number(s.renewalOffer.dailyLimit) || 90) });
      }

      // ----- reseller packages -----
      if (R('POST', '/api/admin/reseller-sale')) {
        const pk = s.resellerPackages.find((p) => p.id === body.packageId);
        if (!pk) return err(400, 'Choose a package.');
        const rs = await getResellers(); let rp = body.resellerId ? rs.find((x) => x.id === String(body.resellerId)) : null; let isNew = false; const seq0 = s.resellerSeq;
        if (body.resellerId && !rp) return err(404, 'Reseller not found.');
        if (!rp && body.register !== false && String(body.name || '').trim()) { // a new reseller: registered here, or found again by email / phone
          rp = rsFind(rs, { emails: [body.email], phone: body.phone, name: body.name });
          if (!rp) { rp = rsNew(s, rs, { name: body.name, email: body.email, phone: body.phone, org: body.org, rslId: body.rslId }); rp.joinedAt = Date.now(); rs.push(rp); isNew = true; }
        }
        const name = String(body.name || (rp ? rp.name : '') || '').trim();
        if (!name) return err(400, 'Enter the reseller name.');
        const buyer = rp ? { id: rp.id, name: rp.name, username: rp.rslId } : { id: 'r-' + uid(5), name, username: String(body.email || body.phone || name) };
        const sale = await recordSale(s, buyer, { type: 'reseller', plan: { id: pk.id, name: `Reseller ${pk.name} (${pk.credits} credits)` }, days: 0, credits: pk.credits, amount: body.amount === '' || body.amount == null ? pk.price : Number(body.amount), accountId: body.accountId, sa: String(body.stripeAccountId || ''), by: actorName });
        const sales = await getSales(); const x = sales.find((y) => y.id === sale.id);
        Object.assign(x, { planName: `Reseller ${pk.name} (${pk.credits} credits)`, email: String(body.email || (rp ? rp.email : '') || ''), phone: String(body.phone || (rp ? rp.phone : '') || ''), note: String(body.note || '') });
        await store.put('sales', sales);
        // the sale also shows in the reseller's own order history
        let order = null, mail = null;
        if (rp) { const ref = String(body.ref || '').trim() || rsNextRef(s, await getCustomers(), rs); order = rsCleanOrder({ ref, at: x.at, pkg: `${pk.name} (${pk.credits} credits)`, credits: pk.credits, amount: x.amount, currency: x.currency, note: body.note, saleId: x.id }, x.currency); rp.orders = rp.orders || []; rp.orders.push(order); rp.updatedAt = Date.now();
          if (body.requestId) { const rq = (rp.requests || []).find((q) => q.id === String(body.requestId)); if (rq) { rq.status = 'done'; rq.doneAt = Date.now(); rq.orderRef = ref; } }
          if (Number(body.creditsLeft) >= 0 && body.creditsLeft !== '' && body.creditsLeft != null) rp.creditsLeft = Math.round(Number(body.creditsLeft)); else if (rp.creditsLeft != null) rp.creditsLeft += pk.credits;
          if (body.sendEmail !== false) mail = await rsSendOrderMail(s, rp, order, body.appUrl, { isNew }); else await rsEnsureLogin(rp);
          await saveResellers(rs); if (s.resellerSeq !== seq0) await saveSettings(s);
          x.username = rp.rslId; x.customerId = rp.id; await store.put('sales', sales);
          if (notifyCfg(s).resellers) { const lg = okLang(rp.lang); await pushTo(s, 'r:' + rp.id, { title: tx(lg, 'pushRslT'), body: tx(lg, 'pushRslB', { n: pk.credits, ref }), url: '/rsl?tab=orders', tag: 'rsl-order' }).catch(() => {}); }
          await log('customer', `Reseller order ${ref} for ${rp.name} (${rp.rslId})${isNew ? ' — new reseller registered' : ''}${mail ? (mail.ok ? ' — confirmation email sent' : ' — email not sent: ' + mail.error) : ''}`); }
        await log('renewal', `Sold reseller package ${pk.name} (${pk.credits} credits) to ${rp ? rp.name : name}`);
        return ok({ ...x, reseller: rp ? { id: rp.id, rslId: rp.rslId, name: rp.name, isNew, login: rp.login ? { username: rp.login.username, pass: rp.login.pass } : null } : null, order, emailed: mail ? !!mail.ok : false, emailError: mail && !mail.ok ? mail.error : '' });
      }
      if (R('GET', '/api/admin/reseller-sales')) return ok((await getSales()).filter((x) => x.type === 'reseller').sort((a, b) => b.at - a.at));

      // ----- reseller profiles (RSL ids) -----
      const rsOut = (row) => (hidePhone && row && row.phone ? { ...row, phone: maskNum(row.phone) } : row);
      if (R('POST', '/api/admin/reseller/toggle')) { // flags one customer as a reseller, or takes the flag away
        const list = await getCustomers(); const c = list.find((x) => x.id === String(body.id || '')); if (!c) return err(404, 'Not found.');
        const rs = await getResellers(); const seq0 = s.resellerSeq;
        let p = rs.find((x) => (x.customerIds || []).includes(c.id));
        if (!c.isReseller && !p) { p = rsNew(s, rs, { name: c.name, email: c.email, phone: c.phone || c.whatsapp, rslId: c.rslId }); rs.push(p); }
        if (!c.isReseller) rsLink(p, c);
        else {
          delete c.isReseller; delete c.rsOrder;
          if (p) { p.customerIds = p.customerIds.filter((i) => i !== c.id); p.orders = (p.orders || []).filter((o) => o.customerId !== c.id); if (!p.customerIds.length && !p.orders.length) rs.splice(rs.indexOf(p), 1); }
        }
        await saveResellers(rs); await saveCustomers(list); if (s.resellerSeq !== seq0) await saveSettings(s);
        await log('customer', `${c.isReseller ? 'Flagged reseller' : 'Unflagged reseller'} ${c.username}${c.rslId ? ' (' + c.rslId + ')' : ''}`);
        return ok({ id: c.id, isReseller: !!c.isReseller, rslId: c.rslId || '' });
      }
      if (R('GET', '/api/admin/reseller')) {
        const customers = await getCustomers(); const sales = await getSales(); const rs = await getResellers(); const seq0 = s.resellerSeq;
        // customers that were flagged before profiles existed get a profile of their own
        const linked = new Set(rs.flatMap((p) => p.customerIds || [])); let dirty = false;
        for (const c of customers) if (c.isReseller && !linked.has(c.id)) { const p = rsNew(s, rs, { name: c.name, email: c.email, phone: c.phone || c.whatsapp, rslId: c.rslId }); rs.push(p); rsLink(p, c); linked.add(c.id); dirty = true; }
        if (dirty) { await saveResellers(rs); await saveCustomers(customers); if (s.resellerSeq !== seq0) await saveSettings(s); }
        // reseller orders that sit in the customer list and are not in any profile yet
        const first = rsFirstSales(sales);
        const found = rsGroupCustomers(customers.filter((c) => !linked.has(c.id) && !c.rsSkip && rsLooksReseller(c, first[c.id]))).map((g) => {
          const into = rsFind(rs, { emails: g.flatMap((c) => [c.email, c.email2]), phone: g.map((c) => c.phone || c.whatsapp).find(Boolean), name: '' });
          const os = g.map((c) => rsOrderFromCustomer(c, first[c.id], s));
          return { ids: g.map((c) => c.id), name: g[0].name, email: cleanEmail(g.map((c) => c.email).find((e) => cleanEmail(e)) || ''), phone: g.map((c) => c.phone || c.whatsapp).find(Boolean) || '', n: g.length, credits: os.reduce((a, o) => a + o.credits, 0), totalUsd: rsRound(os.reduce((a, o) => a + toUsd(o.amount, o.currency, s.finance.rates), 0)), refs: os.map((o) => o.ref).slice(0, 30), firstAt: Math.min(...os.map((o) => o.at).filter(Boolean), Date.now()), into: into ? { id: into.id, rslId: into.rslId, name: into.name } : null };
        }).sort((a, b) => b.n - a.n).slice(0, 60);
        return ok({ list: rsRows(rs, s, sales, customers).map(rsOut), found: found.map(rsOut), currencies: RS_CUR, emailTpl: s.resellerEmail || { subject: '', title: '', body: '', button: '', link: '' } });
      }
      if (R('POST', '/api/admin/reseller/save')) { // add a reseller by hand, or change one
        const rs = await getResellers(); const seq0 = s.resellerSeq;
        const name = rsText(body.name, 80); if (!name) return err(400, 'Enter the reseller name.');
        let p = body.id ? rs.find((x) => x.id === String(body.id)) : null;
        if (body.id && !p) return err(404, 'Reseller not found.');
        const wantId = String(body.rslId || '').trim() ? cleanRslId(body.rslId) : '';
        if (String(body.rslId || '').trim() && !wantId) return err(400, 'A reseller ID looks like RSL-12.');
        if (wantId && rs.some((x) => x !== p && String(x.rslId || '').toUpperCase() === wantId)) return err(409, `${wantId} is already used by another reseller.`);
        const emails = [...new Set([body.email, ...String(body.emails || '').split(/[\s,;/]+/)].map((e) => cleanEmail(e)).filter(Boolean))].slice(0, 6);
        const badMail = [body.email, ...String(body.emails || '').split(/[\s,;/]+/)].map((e) => String(e || '').trim()).find((e) => e && !cleanEmail(e));
        if (badMail) return err(400, `"${badMail.slice(0, 60)}" is not a valid email address.`);
        const typedPhone = String(body.phone || '').trim(); const keepPhone = !!p && hidePhone; // a masked number must never overwrite the real one
        if (typedPhone && !keepPhone && !cleanPhoneText(typedPhone)) return err(400, 'This phone number is not valid. Write it with the country code, for example +66812345678.');
        if (!p) {
          const twin = rsFind(rs, { emails, phone: typedPhone, name: '' });
          if (twin && !body.force) return err(409, `${twin.name} (${twin.rslId}) already has this email or phone. Open that reseller instead.`);
          p = rsNew(s, rs, { name, emails, phone: typedPhone, rslId: wantId }); rs.push(p);
        } else {
          p.name = name; p.emails = emails; p.email = emails[0] || '';
          if (!keepPhone) p.phone = cleanPhoneText(typedPhone);
          if (wantId && wantId !== p.rslId) { p.rslId = wantId; p.rslAuto = false; }
        }
        p.org = rsText(body.org, 80); p.server = rsText(body.server, 40); p.tag = rsText(body.tag, 80); p.note = rsText(body.note, 500);
        if (body.panelUrl !== undefined) { const u = String(body.panelUrl || '').trim(); if (u && !/^https?:\/\/\S+$/.test(u)) return err(400, 'The panel address must start with http:// or https://'); p.panelUrl = u.slice(0, 300); }
        if (body.panelUser !== undefined) p.panelUser = rsText(body.panelUser, 80);
        if (body.lang !== undefined) p.lang = okLang(String(body.lang || ''));
        if (body.curOverride !== undefined) { const v = String(body.curOverride || '').toUpperCase(); if (['USD', 'EUR'].includes(v)) p.curOverride = v; else delete p.curOverride; }
        if (body.panelPass !== undefined) p.panelPass = String(body.panelPass || '').replace(/[<>\s]/g, '').slice(0, 80);
        if (body.telegram !== undefined) p.telegram = String(body.telegram || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '').replace(/[^\w+]/g, '').slice(0, 40);
        p.status = body.status === 'paused' ? 'paused' : 'active'; p.updatedAt = Date.now();
        if (body.joined !== undefined) { const j = String(body.joined || '').trim() ? parseLooseDate(body.joined) : 0; if (String(body.joined || '').trim() && !j) return err(400, 'The date is not valid.'); if (j) p.joinedAt = j; else delete p.joinedAt; }
        await saveResellers(rs); if (s.resellerSeq !== seq0) await saveSettings(s);
        if ((p.customerIds || []).length) { const list = await getCustomers(); let ch = false; for (const c of list) if (p.customerIds.includes(c.id) && c.rslId !== p.rslId) { c.rslId = p.rslId; c.isReseller = true; ch = true; } if (ch) await saveCustomers(list); }
        await log('customer', `${body.id ? 'Changed' : 'Added'} reseller ${p.name} (${p.rslId})`);
        return ok({ ok: true, reseller: rsOut({ id: p.id, rslId: p.rslId, name: p.name, phone: p.phone }) });
      }
      if (R('POST', '/api/admin/reseller/login')) { // dashboard login: new password, own username / password, or send the login email
        const rs = await getResellers(); const p = rs.find((x) => x.id === String(body.id || '')); if (!p) return err(404, 'Reseller not found.');
        if (body.username !== undefined) { const u = String(body.username || '').trim().slice(0, 40); if (u.length < 3 || /\s/.test(u)) return err(400, 'Username: 3 characters or more, no spaces.');
          const k = u.toLowerCase(); if (rs.some((x) => x !== p && [x.login?.username, x.rslId].some((v) => v && String(v).toLowerCase() === k)) || (await getCustomers()).some((c) => c.username.toLowerCase() === k) || (await getAdmin())?.username.toLowerCase() === k) return err(409, 'This username is already used.');
          await rsEnsureLogin(p); p.login.username = u; }
        if (body.password) { if (String(body.password).length < 6) return err(400, 'Password: 6 characters or more.'); await rsSetPass(p, String(body.password)); }
        else if (body.reset) await rsSetPass(p, rsGenPass());
        else await rsEnsureLogin(p);
        if (body.creditsLeft !== undefined) { if (body.creditsLeft === '' || body.creditsLeft === null) delete p.creditsLeft; else p.creditsLeft = Math.max(0, Math.round(Number(body.creditsLeft) || 0)); }
        let mail = null; if (body.send) { const last = body.withOrder ? [...(p.orders || [])].sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null : null; mail = await rsSendOrderMail(s, p, last, body.appUrl, {}); }
        p.updatedAt = Date.now(); await saveResellers(rs);
        if (mail && !mail.ok) return err(502, mail.error || 'Email failed.');
        await log('customer', `Reseller dashboard login ${body.reset || body.password ? 'changed' : 'checked'} for ${p.name} (${p.rslId})${mail ? ' — login email sent' : ''}`);
        return ok({ username: p.login.username, pass: p.login.pass, emailed: !!mail, creditsLeft: p.creditsLeft ?? null });
      }
      if (R('POST', '/api/admin/reseller/request')) { // close a request without an order (refused / cancelled)
        const rs = await getResellers(); const p = rs.find((x) => x.id === String(body.id || '')); const q = p && (p.requests || []).find((x) => x.id === String(body.requestId || ''));
        if (!q) return err(404, 'Request not found.'); q.status = 'cancelled'; q.doneAt = Date.now(); await saveResellers(rs); return ok({ ok: true });
      }
      if (R('POST', '/api/admin/reseller/dismiss')) { // "this row is not a reseller": it stops being offered
        const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String)); const list = await getCustomers(); let n = 0;
        for (const c of list) if (ids.has(c.id)) { c.rsSkip = true; n++; }
        if (!n) return err(404, 'Not found.');
        await saveCustomers(list); return ok({ ok: true, n });
      }
      if (R('POST', '/api/admin/reseller/delete')) {
        const rs = await getResellers(); const i = rs.findIndex((x) => x.id === String(body.id || '')); if (i < 0) return err(404, 'Reseller not found.');
        const [p] = rs.splice(i, 1); await saveResellers(rs);
        if ((p.customerIds || []).length) { const list = await getCustomers(); for (const c of list) if (p.customerIds.includes(c.id)) rsUnlink(c); await saveCustomers(list); }
        await log('customer', `Removed reseller ${p.name} (${p.rslId})`);
        return ok({ ok: true });
      }
      if (R('POST', '/api/admin/reseller/from-customers')) { // customer rows become a reseller: one profile per person, each row an order
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))].slice(0, 400);
        if (!ids.length) return err(400, 'Choose at least one customer.');
        const list = await getCustomers(); const picked = list.filter((c) => ids.includes(c.id));
        if (!picked.length) return err(404, 'Customer not found.');
        const rs = await getResellers(); const seq0 = s.resellerSeq; const first = rsFirstSales(await getSales());
        const target = body.into ? rs.find((x) => x.id === String(body.into)) : null; if (body.into && !target) return err(404, 'Reseller not found.');
        const withOrders = body.orders !== false; let made = 0, rows = 0, orders = 0; const touched = [];
        for (const g of target ? [picked] : rsGroupCustomers(picked)) {
          const contact = { emails: g.flatMap((c) => [c.email, c.email2]), phone: g.map((c) => c.phone || c.whatsapp).find(Boolean) };
          let p = target || rs.find((x) => g.some((c) => (x.customerIds || []).includes(c.id))) || rsFind(rs, { ...contact, name: '' });
          if (!p) { p = rsNew(s, rs, { name: g[0].name, ...contact, rslId: g.map((c) => c.rslId).find(Boolean) }); rs.push(p); made++; } else rsMergeContact(p, contact);
          for (const c of g) {
            for (const other of rs) if (other !== p && (other.customerIds || []).includes(c.id)) { other.customerIds = other.customerIds.filter((i) => i !== c.id); other.orders = (other.orders || []).filter((o) => o.customerId !== c.id); }
            if (!p.customerIds.includes(c.id)) rows++;
            rsLink(p, c);
            if (!withOrders) continue;
            c.rsOrder = true; // this row is a reseller order, not a viewer: it leaves the customer list and customer emails
            const o = rsOrderFromCustomer(c, first[c.id], s); const same = p.orders.find((x) => rsSameOrder(x, o));
            if (same) rsFillOrder(same, o); else { p.orders.push(o); orders++; }
          }
          if (!p.server) p.server = rsServer(g.map((c) => c.server).filter(Boolean).join('/'));
          p.updatedAt = Date.now(); touched.push({ id: p.id, rslId: p.rslId, name: p.name });
        }
        await saveResellers(rs); await saveCustomers(list); if (s.resellerSeq !== seq0) await saveSettings(s);
        await log('customer', `Resellers from customers: ${made} new, ${rows} rows linked, ${orders} orders (${touched.map((t) => t.rslId).join(', ').slice(0, 120)})`);
        return ok({ made, rows, orders, resellers: touched });
      }
      if (R('POST', '/api/admin/reseller/import')) { // resellers read from pasted text: new people are added, known people get the missing details and orders
        const incs = (Array.isArray(body.profiles) ? body.profiles : []).slice(0, 200); if (!incs.length) return err(400, 'Nothing to add.');
        const defCur = RS_CUR.includes(String(body.currency || '').toUpperCase()) ? String(body.currency).toUpperCase() : 'USD';
        const rs = await getResellers(); const seq0 = s.resellerSeq; const list = await getCustomers(); const first = rsFirstSales(await getSales());
        const byRef = new Map(); for (const c of list) { const k = String(c.orderNo || '').trim().toLowerCase(); if (k) byRef.set(k, byRef.has(k) ? null : c); }
        let made = 0, updated = 0, orders = 0, rows = 0; const touched = [];
        for (const raw of incs) {
          if (!raw || typeof raw !== 'object') continue;
          const emails = [...new Set([raw.email, ...(Array.isArray(raw.emails) ? raw.emails : [])].map((e) => cleanEmail(e)).filter(Boolean))].slice(0, 6);
          const phone = cleanPhoneText(raw.phone); const name = rsText(raw.name, 80); const rslId = cleanRslId(raw.rslId);
          if (!name && !emails.length && !phone) continue;
          let p = rsFind(rs, { emails, phone, name, rslId });
          const free = rslId && !rs.some((x) => x !== p && String(x.rslId || '').toUpperCase() === rslId);
          if (!p) { p = rsNew(s, rs, { name: name || emails[0] || phone, emails, phone, rslId: free ? rslId : '' }); rs.push(p); made++; }
          else { updated++; rsMergeContact(p, { emails, phone }); if (free && rslId !== p.rslId && p.rslAuto !== false) { p.rslId = rslId; p.rslAuto = false; for (const c of list) if ((p.customerIds || []).includes(c.id)) c.rslId = rslId; } }
          if (!p.org && raw.org) p.org = rsText(raw.org, 80);
          if (!p.server && raw.server) p.server = rsText(raw.server, 40);
          if (!p.tag && raw.tag) p.tag = rsText(raw.tag, 80);
          if (!p.note && raw.note) p.note = rsText(raw.note, 500);
          for (const ro of (Array.isArray(raw.orders) ? raw.orders : []).slice(0, 300)) {
            if (!ro || typeof ro !== 'object') continue;
            const o = rsCleanOrder({ ref: ro.ref, at: ro.at, pkg: ro.pkg, credits: ro.credits, amount: ro.amount, currency: ro.currency, server: ro.server, note: ro.note }, defCur);
            // the same order as a row in the customer list (same order number, same person): take what the text left out from that row
            const hit = o.ref ? byRef.get(o.ref.toLowerCase()) : null;
            const c = hit && ((normPhone(hit.phone || hit.whatsapp) && normPhone(hit.phone || hit.whatsapp) === normPhone(p.phone)) || (p.emails || []).includes(cleanEmail(hit.email)) || (normName(hit.name).length >= 4 && normName(hit.name) === normName(p.name))) ? hit : null;
            if (c) { const co = rsOrderFromCustomer(c, first[c.id], s); rsFillOrder(o, co); o.customerId = c.id; if (!(p.customerIds || []).includes(c.id)) rows++; for (const other of rs) if (other !== p && (other.customerIds || []).includes(c.id)) { other.customerIds = other.customerIds.filter((i) => i !== c.id); other.orders = (other.orders || []).filter((y) => y.customerId !== c.id); } rsLink(p, c); c.rsOrder = true; }
            if (!o.ref && !o.at && !o.amount && !o.pkg) continue;
            const same = p.orders.find((x) => rsSameOrder(x, o));
            if (same) rsFillOrder(same, o); else { p.orders.push(o); orders++; }
          }
          p.updatedAt = Date.now(); touched.push({ id: p.id, rslId: p.rslId, name: p.name });
        }
        if (!touched.length) return err(400, 'No reseller with a name, email or phone was found in this text.');
        await saveResellers(rs); if (rows || touched.length) await saveCustomers(list); if (s.resellerSeq !== seq0) await saveSettings(s);
        await log('customer', `Resellers from text: ${made} new, ${updated} updated, ${orders} orders`);
        return ok({ made, updated, orders, rows, resellers: touched });
      }
      if (R('POST', '/api/admin/reseller/order')) { // add a past order to a reseller's history by hand, or change one
        const rs = await getResellers(); const p = rs.find((x) => x.id === String(body.id || '')); if (!p) return err(404, 'Reseller not found.');
        const b = body.order && typeof body.order === 'object' ? body.order : {};
        const o = rsCleanOrder({ ...b, at: b.date || b.at, customerId: undefined, saleId: undefined }, 'USD');
        if (!o.amount && !o.pkg && !o.credits && !o.ref) return err(400, 'Fill in the package, the credits or the price.');
        const old = b.id ? (p.orders || []).find((x) => x.id === String(b.id)) : null;
        if (b.id && !old) return err(404, 'Order not found.');
        if (old) Object.assign(old, { ref: o.ref, at: o.at, pkg: o.pkg, credits: o.credits, amount: o.amount, currency: o.currency, server: o.server, note: o.note });
        else { p.orders = p.orders || []; if (p.orders.length >= 2000) return err(400, 'This reseller has too many orders.'); p.orders.push(o); }
        p.updatedAt = Date.now(); await saveResellers(rs);
        await log('customer', `${old ? 'Changed' : 'Added'} an order for reseller ${p.name} (${p.rslId})`);
        return ok({ ok: true });
      }
      if (R('POST', '/api/admin/reseller/order-delete')) {
        const rs = await getResellers(); const p = rs.find((x) => x.id === String(body.id || '')); if (!p) return err(404, 'Reseller not found.');
        const o = (p.orders || []).find((x) => x.id === String(body.orderId || '')); if (!o) return err(404, 'Order not found.');
        p.orders = p.orders.filter((x) => x !== o); p.updatedAt = Date.now();
        if (o.customerId) { p.customerIds = (p.customerIds || []).filter((i) => i !== o.customerId); const list = await getCustomers(); rsUnlink(list.find((c) => c.id === o.customerId)); await saveCustomers(list); }
        await saveResellers(rs);
        await log('customer', `Removed an order from reseller ${p.name} (${p.rslId})`);
        return ok({ ok: true });
      }
      if (R('POST', '/api/admin/reseller/contact')) { // ✓ Sent marks and "has no WhatsApp / Telegram" for a reseller
        const rs = await getResellers(); const p = rs.find((x) => x.id === String(body.id || '')); if (!p) return err(404, 'Reseller not found.');
        const k = String(body.k || ''); if (!['email', 'whatsapp', 'telegram', 'noWhatsapp', 'noTelegram'].includes(k)) return err(400, 'Unknown mark.');
        p.contact = { ...(p.contact || {}), [k]: body.v ? Date.now() : 0 }; await saveResellers(rs); return ok({ ok: true, contact: p.contact });
      }
      if (R('POST', '/api/admin/reseller/tgsend')) {
        const rs = await getResellers(); const p = rs.find((x) => x.id === String(body.id || '')); if (!p) return err(404, 'Reseller not found.');
        const text = String(body.text || '').slice(0, 3800).trim(); if (!text) return err(400, 'Write a message first.');
        const chat = await tgFindChat({ telegram: p.telegram, email: p.email, phone: p.phone }); if (!chat) return ok({ sent: false });
        const rr = await tgSend(s, chat, text); if (!rr.ok) return err(502, 'Telegram: ' + (rr.error || 'not sent'));
        markSent(p, 'telegram'); await saveResellers(rs); return ok({ sent: true });
      }
      if (R('POST', '/api/admin/reseller/email')) { // an email you write yourself, to one, several or all resellers; the text can be kept as your template
        if (locked) { const sv = s.resellerEmail; if (!sv || !sv.subject) return err(400, 'No reseller email is saved yet. The owner or the Technical Service writes it first.'); Object.assign(body, sv, { save: false }); } // agents send the saved text
        const tpl = { subject: rsText(body.subject, 160), title: rsText(body.title, 120), body: String(body.body || '').replace(/[<>]/g, '').slice(0, 6000).trim(), button: rsText(body.button, 60), link: /^https?:\/\/\S+$/.test(String(body.link || '').trim()) ? String(body.link).trim() : (['site', 'contact', 'app'].includes(body.link) ? body.link : '') };
        if (body.save) { await saveSettings({ ...s, resellerEmail: tpl }); if (body.saveOnly) return ok({ ok: true, saved: true }); }
        if (!tpl.subject || !tpl.body) return err(400, 'Write a subject and a message first.');
        const rows = rsRows(await getResellers(), s, await getSales(), await getCustomers());
        const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String));
        const to = rows.filter((r) => (body.all ? r.status !== 'paused' : ids.has(r.id)) && cleanEmail(r.email)).slice(0, 100);
        const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
        const fill = (x, r) => String(x || '').replace(/\{(rsl|credits|orders|spent|last|fullname|org|server|url|username|password)\}/g, (_, k) => ({ rsl: r.rslId, credits: r.credits, orders: r.purchases, spent: '$' + r.spentUsd.toFixed(2), last: day(r.lastAt), fullname: r.name, org: r.org, server: r.server, url: r.panelUrl || '', username: r.panelUser || '', password: r.panelPass || '' })[k] ?? '');
        const make = (r) => newsletterEmail(s, { name: r.name, lang: 'en' }, { split: false, lang: okLang(body.lang), content: { all: { subject: fill(tpl.subject, r), title: fill(tpl.title, r), body: fill(tpl.body, r), button: tpl.button } }, link: tpl.link }, body.appUrl, '');
        if (body.preview) { const r = to[0] || rows.find((x) => ids.has(x.id)) || rows[0] || { rslId: 'RSL-01', name: 'Reseller Name', credits: 0, purchases: 0, spentUsd: 0, lastAt: 0, org: '', server: '' }; return ok(make(r)); }
        if (!to.length) return err(400, 'None of the chosen resellers has a valid email address.');
        const msgs = to.map((r) => { const m = make(r); return { to: r.email, subject: m.subject, html: m.html }; });
        const res = msgs.length === 1 ? await sendEmail(s, msgs[0].to, msgs[0].subject, msgs[0].html) : await sendBatch(s, msgs);
        if (!res.ok) return err(502, res.error || 'Email failed');
        const rs = await getResellers(); const now = Date.now(); for (const p of rs) if (to.some((r) => r.id === p.id)) { p.emailedAt = now; p.emailedSubject = tpl.subject; markSent(p, 'email'); } await saveResellers(rs);
        await log('customer', `Reseller email "${tpl.subject}" sent to ${to.length}`);
        return ok({ sent: to.length });
      }

      if (R('GET', '/api/admin/stats')) {
        const cs = (await getCustomers()).map((c) => viewP(c, s));
        const now = new Date();
        const monthKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
        const months = [];
        for (let i = 5; i >= 0; i--) months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
        const byMonth = Object.fromEntries(months.map((k) => [k, 0]));
        let total = 0, renewalsCount = 0;
        for (const r of await getSales()) {
          if (r.type === 'trial') continue;
          total += r.amountUsd || 0; renewalsCount++;
          const k = monthKey(r.at); if (k in byMonth) byMonth[k] += r.amountUsd || 0;
        }
        for (const k in byMonth) byMonth[k] = Math.round(byMonth[k] * 100) / 100;
        const stock = await stockInfo(s);
        const bal = can('finance_view') ? balances(s, await getTx()) : null;
        const totalBalUsd = bal ? bal.reduce((a, x) => a + x.usd, 0) : null;
        const count = (st) => cs.filter((c) => c.state === st).length;
        return ok({
          total: cs.length, active: count('active'), expiring: count('expiring'), expired: count('expired'), disabled: count('disabled'),
          ...(can('profits') ? { revenueTotal: Math.round(total * 100) / 100, revenueMonth: byMonth[months[5]], byMonth } : { revenueTotal: null, revenueMonth: null, byMonth: null }), renewalsCount, trials: cs.filter((c) => c.isTrial).length,
          stock: { available: stock.available, low: stock.low }, totalBalanceUsd: totalBalUsd, lowCreditsAlert: s.stock.lowCreditsAlert, madRate: s.finance.rates.MAD,
          expiringSoon: cs.filter((c) => c.state === 'expiring').sort((a, b) => a.expiresAt - b.expiresAt).slice(0, 8),
          recentlyExpired: cs.filter((c) => c.state === 'expired').sort((a, b) => b.expiresAt - a.expiresAt).slice(0, 8),
        });
      }

      if (R('POST', '/api/admin/panels/test')) { // check that a Dino/Xtream/Mega panel is reachable + auth ok
        const tm = can('secrets'); if (!tm) return err(403, 'Only the owner and the Technical Manager can test panels.');
        const baseUrl = String(body.baseUrl || '').trim().replace(/\/+$/, ''); const u = String(body.username || '').trim().slice(0, 80); const pw = String(body.password || '').slice(0, 200);
        if (!/^https?:\/\//.test(baseUrl)) return err(400, 'Base URL must start with http:// or https://');
        const type = ['dino', 'xtream', 'mega'].includes(String(body.type || '').toLowerCase()) ? String(body.type).toLowerCase() : 'xtream';
        try {
          const target = type === 'xtream' && u ? `${baseUrl}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(pw)}&action=get_account_info` : baseUrl;
          const r = await fetchFn(target);
          const text = await r.text();
          if (r.ok || r.status === 401 || r.status === 200) return ok({ ok: true, status: r.status, type, url: baseUrl, body: type === 'xtream' && u ? text.slice(0, 300) : text.slice(0, 120) });
          return ok({ ok: false, status: r.status, error: `Panel answered HTTP ${r.status}` });
        } catch (e) { return ok({ ok: false, error: e.message }); }
      }

      if (R('POST', '/api/admin/panel/test')) {
        if (body.target === 'reseller') {
          const r = await panelCredits(s, true);
          return ok({ ok: r.ok, status: r.status, data: r.data, error: r.error, credits: r.credits, via: r.via === 'relay' ? 'Reached through your relay (the panel refused Cloudflare directly).' : undefined });
        }
        const server = trimSlash(s.player.serverUrl);
        if (!server) return err(400, 'Add the streaming server URL first.');
        try {
          const q = new URLSearchParams({ username: body.username || '', password: body.password || '' });
          if (body.tryAgents) { // try several player identities and report which ones the server accepts
            const out = [];
            for (const ua of ['IPTVSmartersPro', 'VLC/3.0.20 LibVLC/3.0.20', 'okhttp/4.12.0', 'TiviMate/4.7.0 (Android 12)', 'Lavf/58.76.100', 'Mozilla/5.0 (Linux; Android 12; SM-A525F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', s.player.userAgent]) {
              try { const r = await fetchFn(`${server}/player_api.php?${q}`, { headers: { 'User-Agent': ua } }); const t = await r.text(); out.push({ ua, status: r.status, body: t.slice(0, 160) }); }
              catch (e) { out.push({ ua, error: e.message }); }
            }
            return ok({ ok: out.some((x) => x.status === 200), agents: out });
          }
          const res = await fetchFn(`${server}/player_api.php?${q}`, { headers: { 'User-Agent': s.player.userAgent || 'IPTVSmartersPro' } });
          const text = await res.text();
          let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
          const auth = isObj(data) && data.user_info ? Number(data.user_info.auth) === 1 : false;
          return ok({ ok: auth, status: res.status, data, error: auth ? undefined : 'Login was not accepted by the server.' });
        } catch (e) { return ok({ ok: false, error: 'Cannot reach server: ' + e.message }); }
      }
      if (R('GET', '/api/admin/panel/credits')) {
        if (!s.reseller.enabled) return ok({ enabled: false });
        const r = await panelCredits(s);
        return ok({ enabled: true, ok: r.ok, credits: r.credits, error: r.error, last: r.last, via: r.via });
      }

      if (R('POST', '/api/admin/account')) {
        const admin = await store.get('admin');
        if ((await hashPassword(body.currentPassword || '', admin.salt)) !== admin.hash) return err(400, 'Current password is wrong.');
        if (body.username) {
          const u = String(body.username).trim();
          if (u.length < 3) return err(400, 'Username needs 3+ characters.');
          if ((await getCustomers()).some((x) => x.username.toLowerCase() === u.toLowerCase())) return err(400, 'A customer already uses this username.');
          admin.username = u;
        }
        if (body.newPassword) {
          if (String(body.newPassword).length < 6) return err(400, 'New password needs 6+ characters.');
          admin.salt = uid(8); admin.hash = await hashPassword(body.newPassword, admin.salt);
          admin.isDefault = false;
        }
        await store.put('admin', admin);
        await log('admin', 'Admin login details changed');
        return ok({ ok: true, username: admin.username });
      }
      if (R('GET', '/api/admin/log')) return ok((await store.get('log')) || []);
      if (R('POST', '/api/admin/import')) { // bulk import of existing clients (owner only)
        const list = await getCustomers();
        const team = await getTeam(); const admin = await getAdmin();
        const taken = new Set([...list.map((x) => x.username.toLowerCase()), ...team.map((x) => x.username.toLowerCase()), admin.username.toLowerCase()]);
        let added = 0, skipped = 0;
        for (const c of body.customers || []) {
          if (!c || !c.username || !c.salt || !c.passwordHash || taken.has(String(c.username).toLowerCase())) { skipped++; continue; }
          taken.add(String(c.username).toLowerCase());
          list.push({ ...c, id: c.id || uid(8), status: c.status === 'disabled' ? 'disabled' : 'active', imported: true });
          added++;
        }
        await saveCustomers(list);
        if (Array.isArray(body.sales) && body.sales.length) { const sales = await getSales(); await store.put('sales', sales.concat(body.sales)); }
        await log('customer', `Imported ${added} clients${skipped ? ` (${skipped} skipped: already exist)` : ''}`);
        return ok({ added, skipped, total: list.length });
      }
      if (R('GET', '/api/admin/backup')) return ok({ version: 2, exportedAt: Date.now(), settings: s, customers: await getCustomers(), sales: await getSales(), tx: await getTx(), stock: await getStock(), resellers: await getResellers(), accounts: await getAccounts() });
      if (R('POST', '/api/admin/restore')) {
        if (!isObj(body.settings) || !Array.isArray(body.customers)) return err(400, 'This is not a valid backup file.');
        const next = deepMerge(DEFAULT_SETTINGS(), body.settings);
        next.security.proxySecret = s.security.proxySecret;
        await saveSettings(next);
        await saveCustomers(body.customers);
        if (Array.isArray(body.sales)) await store.put('sales', body.sales); else await store.del('sales');
        if (Array.isArray(body.tx)) await store.put('tx', body.tx);
        if (Array.isArray(body.stock)) await store.put('stock', body.stock);
        if (Array.isArray(body.resellers)) await store.put('resellers', body.resellers);
        if (Array.isArray(body.accounts)) await store.put('accounts', body.accounts);
        await log('admin', `Backup restored (${body.customers.length} customers)`);
        return ok({ ok: true });
      }
      return err(404, 'Not found');
    } catch (e) {
      return err(e.status || 500, e.message || 'Server error');
    }
  }

  // Daily job (Cloudflare cron): low credit alerts to admin + expiry reminders to customers.
  async function daily() {
    try { const s0 = await getSettings(); if (s0.email.resendKey) await syncBounces(s0); } catch {}
    try { // Automated duplicate cleanup (spec §1): same name + phone + email, expired 90+ days, no sign-in or renewal in months → remove the extras
      const sC = await getSettings();
      if (sC.security.autoDupCleanup !== false) {
        const list = await getCustomers(); const now = Date.now(); const groups = {};
        for (const c of list) { if (c.isTrial || c.status === 'disabled') continue; const k = normName(c.name) + '|' + normPhone(c.phone || c.whatsapp) + '|' + normEmail(c.email); if (!normName(c.name) || (!normPhone(c.phone) && !normEmail(c.email))) continue; (groups[k] ||= []).push(c); }
        const cutoff = now - 90 * DAYMS, renewalCutoff = now - 180 * DAYMS;
        const removed = [];
        for (const k of Object.keys(groups)) {
          const g = groups[k]; if (g.length < 2) continue;
          const stale = g.filter((c) => (c.expiresAt || 0) <= cutoff && (!c.lastLogin || c.lastLogin <= cutoff) && !(c.renewals || []).some((r) => (r.at || 0) >= renewalCutoff));
          if (stale.length < g.length) continue; // not everyone in the group is dead — leave manual review
          const keep = stale[0];
          for (const c of stale) { if (c === keep) continue; removed.push({ name: c.name, username: c.username }); await saveCustomers(list.filter((x) => x !== c)); }
        }
        if (removed.length) { await log('customer', `Auto duplicate cleanup removed ${removed.length} dead duplicate account(s)`); await notifyAdmin(sC, 'Duplicate cleanup', `Removed ${removed.length} expired duplicate account(s) (name + phone + email match, no sign-in or renewal in 6+ months):\n` + removed.slice(0, 10).map((x) => `- ${x.name} (${x.username})`).join('\n')); }
      }
    } catch {}
    try { // uptime monitor (spec §2/§4): daily probe of the streaming server; email the owner if it is down
      const sU = await getSettings();
      if (sU.player.serverUrl && sU.email.resendKey && sU.email.adminEmail && sU.email.uptimeMonitor !== false) {
        let ok = false, why = '';
        try { const r = await fetchFn(String(sU.player.serverUrl).replace(/\/+$/, '') + '/player_api.php', { headers: { 'User-Agent': sU.player.userAgent || 'IPTVSmartersPro' } }); ok = r.status < 500; why = 'HTTP ' + r.status; } catch (e) { why = e.message; }
        const last = await store.get('uptime'); const now = Date.now();
        if (!ok && now - (last?.at || 0) > 6 * 3600000) {
          await sendEmail(sU, sU.email.adminEmail, `🚨 ${sU.branding.appName || 'INTPROTO-TV'}: the IPTV server is not reachable`, mailHtml(sU, 'en', [['Server', sU.player.serverUrl], ['Answer', why], ['Checked at', new Date(now).toLocaleString('en-GB')]], 'The streaming server did not answer the daily health check. Customers may not be able to watch or renew lines through the panel API. Check the server, DNS and panel status with your provider.', 'Admin'));
          await store.put('uptime', { at: now, ok: false });
        } else if (ok && last) await store.del('uptime');
      }
    } catch {}
    try { const s1 = await getSettings(); if (s1.player.serverUrl) { const l = await getCustomers(); const part = l.filter((c) => !c.pendingLine && c.status !== 'disabled').sort((a, b) => ((a.panel && a.panel.at) || 0) - ((b.panel && b.panel.at) || 0)).slice(0, 20); let ch = 0; for (const c of part) { try { if (await syncLine(s1, c)) ch++; } catch {} } if (part.length) await saveCustomers(l); } } catch {}
    const s = await refreshRates(await getSettings(), false);
    const out = { reminders: 0, alert: false };
    if (s.email.lowCreditsAlerts && s.email.adminEmail) {
      const st = await stockInfo(s);
      let panelCredits = null;
      if (s.reseller.enabled) { const r = await panelCall(s, 'credits', {}); panelCredits = r.ok ? findCredits(r.data, s.reseller.creditsPath) : null; }
      const lim = Number(s.stock.lowCreditsAlert) || 0;
      const lowPanel = panelCredits != null && !isNaN(panelCredits) && panelCredits <= lim;
      if (st.low || lowPanel) {
        await sendEmail(s, s.email.adminEmail, `⚠️ ${s.branding.appName}: credits are low`, mailHtml(s, 'en', [['Panel credits (API)', panelCredits ?? '—'], ['Credits in stock', st.available], ['Alert level', lim]], 'Your credits are running low. Buy more from your supplier to keep creating lines.', 'Admin'));
        out.alert = true;
      }
    }
    try { // holiday reminders: tell the agents (notification) a few days before each holiday, with the promotion to send
      const hr = { ...HOLIDAY_REMIND_DEF, ...(s.holidayRemind || {}) };
      if (hr.on) for (const h of holidayCalendar(Date.now(), hr.custom)) { const dl = Math.ceil((h.at - Date.now()) / DAYMS); if (!hr.days.includes(dl)) continue; const k = 'holrem:' + h.id + ':' + dl; if (await store.get(k)) continue; await store.put(k, 1, 40 * 86400);
        const when = dl === 0 ? 'today' : dl === 1 ? 'tomorrow' : `in ${dl} days`; await pushAgents(s, 'holidays', { title: `🗓 ${h.name} ${when}`, body: `${h.tip} Send the ${SEASON[h.kind]?.names?.en || 'promotion'} promotion.`, url: '/intprototv?tab=promos&go=' + h.kind, tag: 'hol-' + h.id }).catch(() => {});
        const rl = (await store.get('holidayLog')) || []; rl.unshift({ at: Date.now(), id: h.id, name: h.name, days: dl, kind: h.kind }); await store.put('holidayLog', rl.slice(0, 50)); await log('marketing', `Holiday reminder: ${h.name} ${when}`); out.holidays = (out.holidays || 0) + 1; }
    } catch {}
    const rcfg = renewCfg(s);
    if (rcfg.auto && s.email.resendKey) { // renewal emails: 7 days before, on the last day, and once after it ends
      const list = await getCustomers(); let changed = false; const now = Date.now(); let n = 0;
      for (const c of list) {
        if (n >= 150) break; if (c.isTrial || c.rsOrder || c.status === 'disabled' || c.noExpiry || !(cleanEmail(c.email) || cleanEmail(c.email2)) || c.unsub || c.emailBad) continue;
        const rm = c.rm && c.rm.for === c.expiresAt ? c.rm : { for: c.expiresAt }; const left = c.expiresAt - now; let step = '';
        if (left > DAYMS && left <= 7 * DAYMS && !rm.d7 && !rm.d0) step = 'd7'; else if (left > 0 && left <= DAYMS && !rm.d0) step = 'today'; else if (left <= 0 && -left <= rcfg.expiredDays * DAYMS && !rm.exp && c.renewalSentFor !== c.expiresAt) step = 'expired';
        const model = step && rcfg[step]; if (!model || model === 'off') continue;
        const r = await sendRenewModel(s, c, model, s.email.appUrl); n++;
        if (r.ok) { rm[step === 'd7' ? 'd7' : step === 'today' ? 'd0' : 'exp'] = now; c.rm = rm; if (step === 'expired') { c.renewalSentFor = c.expiresAt; c.renewalSentAt = now; } if (step !== 'expired') c.remindedFor = c.expiresAt; markSent(c, 'email'); changed = true; out.reminders++; }
      }
      if (changed) await saveCustomers(list);
    }
    if (s.email.expiryReminders && !rcfg.auto) {
      const list = await getCustomers(); let changed = false;
      const days = Number(s.email.reminderDays) || 3;
      for (const c of list) {
        const to = cleanEmail(c.email) || cleanEmail(c.email2); // primary address, falling back to the secondary one
        const left = Math.ceil((c.expiresAt - Date.now()) / DAYMS);
        if (to && !c.isTrial && c.status !== 'disabled' && left > 0 && left <= days && c.remindedFor !== c.expiresAt) {
          const lang = ml(c);
          const date = new Date(c.expiresAt).toLocaleDateString(langLocale(lang), { dateStyle: 'medium' });
          const r = await sendEmail(s, to, mt(lang, 'expirySubject', { days: left }), mailHtml(s, lang, [[mt(lang, 'user'), c.username], [mt(lang, 'expires'), date]], mt(lang, 'expiryBody', { date }), c.name));
          if (r.ok) { c.remindedFor = c.expiresAt; changed = true; out.reminders++; }
        }
      }
      if (changed) await saveCustomers(list);
    }
    if (s.renewalOffer.auto && s.email.resendKey && !rcfg.auto) {
      const list = await getCustomers(); const t = await sentToday();
      const left = Math.max(0, (Number(s.renewalOffer.dailyLimit) || 90) - t.n);
      const batch = renewalTargets(list, Number(s.renewalOffer.autoDays) || 3).slice(0, Math.min(50, left));
      if (batch.length) {
        const r = await sendBatch(s, batch.map((c) => ({ to: cleanEmail(c.email) || cleanEmail(c.email2), ...renewalEmail(s, c, s.email.appUrl) })));
        if (r.ok) { const now = Date.now(); batch.forEach((c) => { markSent(c, 'email'); c.renewalSentFor = c.expiresAt; c.renewalSentAt = now; }); await saveCustomers(list); await store.put(t.k, t.n + batch.length, 2 * 86400); out.reminders += batch.length; }
      }
    }
    try { out.push = await dailyPush(s); } catch {}
    if (out.alert || out.reminders) await log('daily', `Daily check: ${out.reminders} reminder(s)${out.alert ? ', low-credit alert sent' : ''}`);
    return out;
  }

  return { handle, getSettings, daily, tick };
}
