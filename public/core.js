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
    primary: '#12bfd8',
    accent: '#7cf0ff',
    background: '#060a12',
    loginTitle: 'Welcome back',
    loginSubtitle: 'Sign in with the login details you received.',
    loginBgUrl: '',
    supportLabel: 'Contact support',
    supportUrl: '',
    whatsapp: '', // WhatsApp number with country code, digits only (shows the green WhatsApp button)
    footerText: '',
  },
  userDashboard: {
    live: true, movies: true, series: true, epg: true, search: true, favorites: true,
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
    { id: 'p1', name: '1 Month', days: 30, price: 10, connections: 1, package: '1', credits: 1 },
    { id: 'p3', name: '3 Months', days: 90, price: 25, connections: 1, package: '2', credits: 3 },
    { id: 'p6', name: '6 Months', days: 180, price: 45, connections: 1, package: '3', credits: 6 },
    { id: 'p12', name: '12 Months', days: 365, price: 80, connections: 1, package: '4', credits: 12 },
  ],
  currency: 'USD',
  resellerPackages: [
    { id: 'r10', name: 'Basic', credits: 10, price: 280.99 },
    { id: 'r20', name: 'Standard', credits: 20, price: 499.99 },
    { id: 'r30', name: 'Premium', credits: 30, price: 630.99 },
    { id: 'r50', name: 'VIP', credits: 50, price: 999.99 },
  ],
  resellerCurrency: 'EUR',
  // Package order emails (each one has its own Stripe payment link)
  orderPackages: [
    { id: 'o1m', title: '1 Month', days: 30, devices: 1, price: 29.99, badge: '', link: '' },
    { id: 'o3m', title: '3 Months', days: 90, devices: 1, price: 49.99, badge: '', link: '' },
    { id: 'o6m', title: '6 Months', days: 180, devices: 1, price: 59.99, badge: '', link: '' },
    { id: 'o1y', title: '1 Year', days: 365, devices: 1, price: 69.99, badge: '', link: '' },
    { id: 'o2y', title: '2 Years', days: 730, devices: 1, price: 99.99, badge: '⭐ Best Value • 2-Year Plan', link: '' },
    { id: 'o1y2d', title: '2 Devices · 1 Year', days: 365, devices: 2, price: 109.99, badge: 'Multi-Device Plan • 2 Connections', link: '' },
    { id: 'o1y3d', title: '3 Devices · 1 Year', days: 365, devices: 3, price: 129.99, badge: 'Family Plan • 3 Connections', link: '' },
    { id: 'o1y4d', title: '4 Devices · 1 Year', days: 365, devices: 4, price: 139.99, badge: '🔥 Ultimate Plan • 4 Connections', link: '' },
  ],
  orderCurrency: 'EUR',
  waTemplates: {}, // custom WhatsApp templates: { pay: { en, fr, ar }, login: {...}, renew: {...} }
  orderAccounts: [], // Stripe accounts the pay links come from: { id, name, enabled }
  renewalOffer: { title: '2-Device, 1-Year Subscription', price: '$109.99', bonus: 'Including 2 FREE Months', coupon: 'LION001', url: 'https://intproto-tv.com', auto: true, autoDays: 3, dailyLimit: 90 },
  trial: { enabled: true, hours: 24, credits: 0, package: '', connections: 1, showCredentialsOnScreen: false },
  email: { resendKey: '', from: '', adminEmail: '', appUrl: '', expiryReminders: true, reminderDays: 3, lowCreditAlerts: true, dns: '', supportEmail: '', website: '' },
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
    stripeKey: '', stripeAccountId: 'stripe',
  },
  stock: { packCredits: 120, packPrice: 90, lowCreditsAlert: 20 },
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

const XTREAM_ACTIONS = new Set([
  'get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_vod_info',
  'get_series_categories', 'get_series', 'get_series_info', 'get_short_epg',
]);

export const PERMS = [
  ['customers_view', 'See customers & subscriptions'],
  ['customers_edit', 'Add, edit, renew, enable/disable customers'],
  ['customers_delete', 'Delete customers'],
  ['finance_view', 'See banks & balances'],
  ['finance_edit', 'Add income, expenses, transfers'],
  ['profits', 'See revenue & profits'],
  ['stock', 'Credits stock (see & buy)'],
  ['plans', 'Edit plans & prices'],
  ['settings', 'App settings (API, branding, trial, email, user dashboard)'],
  ['activity', 'See activity log'],
];
const PERM_KEYS = PERMS.map((p) => p[0]);
function permFor(method, path, body) {
  if (['/api/admin/me', '/api/admin/stats', '/api/admin/panel/credits', '/api/admin/me/password'].includes(path)) return null;
  if (path === '/api/admin/settings') {
    if (method === 'GET') return null;
    const k = Object.keys(body || {});
    if (k.length && k.every((x) => ['plans', 'currency', 'resellerPackages', 'resellerCurrency', 'renewalOffer', 'orderPackages', 'orderCurrency', 'orderAccounts', 'waTemplates'].includes(x))) return 'plans';
    if (k.length && k.every((x) => x === 'stock')) return 'stock';
    if (k.length && k.every((x) => x === 'finance')) return 'finance_edit';
    return 'settings';
  }
  if (path === '/api/admin/reseller-sale') return 'customers_edit';
  if (path === '/api/admin/renewal/send') return 'customers_edit';
  if (path === '/api/admin/order/send') return 'customers_edit';
  if (path === '/api/admin/order/custom') return 'customers_edit';
  if (path.startsWith('/api/admin/newsletter')) return 'customers_edit';
  if (path === '/api/admin/stripe/paylinks') return 'plans';
  if (path === '/api/admin/renewal/status') return 'customers_view';
  if (path === '/api/admin/duplicates') return 'customers_view';
  if (path === '/api/admin/reseller-sales') return 'customers_view';
  if (path.startsWith('/api/admin/customers')) return method === 'GET' ? 'customers_view' : method === 'DELETE' ? 'customers_delete' : 'customers_edit';
  if (path === '/api/admin/finance' || (path === '/api/admin/tx' && method === 'GET')) return 'finance_view';
  if (path === '/api/admin/stripe/balance') return 'finance_view';
  if (path.startsWith('/api/admin/tx') || path === '/api/admin/rates/refresh' || path === '/api/admin/stripe/match') return 'finance_edit';
  if (path.startsWith('/api/admin/stock')) return 'stock';
  if (path === '/api/admin/profits') return 'profits';
  if (path === '/api/admin/log') return 'activity';
  if (path === '/api/admin/panel/test' || path === '/api/admin/email/test') return 'settings';
  return 'owner';
}

// Returns a clean, valid email address, or '' if the text isn't one ("name@site.com," -> "name@site.com")
export function cleanEmail(x) {
  const m = String(x || '').toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}/);
  return m ? m[0] : '';
}
export const toUsd = (amount, cur, rates) => (Number(amount) || 0) / (Number((rates || {})[cur]) || 1);
export const fromUsd = (usd, cur, rates) => (Number(usd) || 0) * (Number((rates || {})[cur]) || 1);
const DAYMS = 86400000;
const planCredits = (p) => (p && p.credits != null && p.credits !== '' ? Number(p.credits) : p ? Math.max(1, Math.round((p.days || 30) / 30)) : 1);
const escHtml = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Email texts in English, French and Arabic
const MAIL = {
  en: { trialSubject: 'Your free {hours}h trial is ready', welcomeSubject: 'Your account is ready', hello: 'Hello {name},', trialBody: 'Your free trial is active for {hours} hours. Sign in with these details:', welcomeBody: 'Your subscription is active. Sign in with these details:', user: 'Username', pass: 'Password', expires: 'Expires', open: 'Open the app', install: 'Tip: add the app to your home screen to use it like a normal app.', expirySubject: 'Your subscription ends in {days} days', expiryBody: 'Your subscription ends on {date}. Contact us to renew and keep watching.', thanks: 'Thank you!' },
  fr: { trialSubject: 'Votre essai gratuit de {hours}h est prêt', welcomeSubject: 'Votre compte est prêt', hello: 'Bonjour {name},', trialBody: 'Votre essai gratuit est actif pendant {hours} heures. Connectez-vous avec ces informations :', welcomeBody: 'Votre abonnement est actif. Connectez-vous avec ces informations :', user: "Nom d'utilisateur", pass: 'Mot de passe', expires: 'Expire le', open: "Ouvrir l'application", install: "Astuce : ajoutez l'application à votre écran d'accueil.", expirySubject: 'Votre abonnement se termine dans {days} jours', expiryBody: 'Votre abonnement se termine le {date}. Contactez-nous pour le renouveler.', thanks: 'Merci !' },
  ar: { trialSubject: 'تجربتك المجانية لمدة {hours} ساعة جاهزة', welcomeSubject: 'حسابك جاهز', hello: 'مرحبًا {name}،', trialBody: 'تجربتك المجانية مفعّلة لمدة {hours} ساعة. سجّل الدخول بهذه المعلومات:', welcomeBody: 'اشتراكك مفعّل. سجّل الدخول بهذه المعلومات:', user: 'اسم المستخدم', pass: 'كلمة المرور', expires: 'ينتهي في', open: 'افتح التطبيق', install: 'نصيحة: أضف التطبيق إلى الشاشة الرئيسية لاستخدامه كتطبيق عادي.', expirySubject: 'ينتهي اشتراكك خلال {days} أيام', expiryBody: 'ينتهي اشتراكك في {date}. تواصل معنا للتجديد ومواصلة المشاهدة.', thanks: 'شكرًا لك!' },
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
  ar: { dir: 'rtl', trialTitle: 'تجربتك المجانية جاهزة 🎉', subTitle: 'اشتراكك مفعّل ✅', trialSub: 'تم التفعيل فورًا. ابدأ المشاهدة الآن.', subSub: 'خطّك مفعّل. ابدأ المشاهدة الآن.',
    dear: 'عزيزي/عزيزتي {name}،', trialIntro: 'شكرًا لاختيارك <b>{app}</b>. يسعدنا إبلاغك بأن تجربتك المجانية جاهزة للاستخدام.', subIntro: 'شكرًا لاختيارك <b>{app}</b>. اشتراكك مفعّل وجاهز للاستخدام.',
    trialNote: '<b>⏳ ملاحظة:</b> تنتهي تجربتك المجانية بعد <b>{hours} ساعة</b>.', subNote: '<b>📅 صالح حتى:</b> {date}',
    details: '📺 معلومات الدخول', detailsIntro: 'شاهد في تطبيقنا، أو استخدم أي مشغّل IPTV متوافق بهذه المعلومات:', user: 'اسم المستخدم', pass: 'كلمة المرور', dns: 'DNS / البوابة', m3u: 'روابط M3U',
    appTitle: '📲 شاهد في تطبيق {app}', appText: 'يعمل على أندرويد وأندرويد TV وآيفون وآيباد وويندوز وماك. يتحدّث تلقائيًا.', openApp: 'افتح التطبيق', getApp: 'حمّل التطبيق',
    setup: '⚙️ طريقة الإعداد على مشغّلات IPTV الأخرى', s1: 'حمّل وثبّت مشغّل IPTV متوافق (مثل IPTV Smarters Pro أو XCIPTV أو TiviMate).', s2: 'افتحه واختر <b>Login with Xtream Codes API</b> أو <b>M3U Playlist URL</b>.', s3: 'أدخل <b>اسم المستخدم</b> و<b>كلمة المرور</b> و<b>رابط DNS</b> أعلاه.', s4: 'اضغط <b>Connect</b> أو <b>Add User</b>، وانتظر تحميل القنوات، واستمتع!',
    help: '📞 تحتاج مساعدة؟', helpText: 'إذا كان لديك أي سؤال أو تحتاج مساعدة في الإعداد، فريق خدمة العملاء جاهز لمساعدتك.', support: 'خدمة العملاء', email: 'البريد', website: 'الموقع', whatsapp: 'واتساب',
    closing: 'نشكرك على اهتمامك بـ <b>{app}</b> ونتمنى لك تجربة ممتعة.', regards: 'مع أطيب التحيات،', team: 'فريق خدمة العملاء',
    footer: 'شكرًا لثقتك ودعمك. لأي سؤال تواصل مع فريق الدعم — نحن هنا لنجعل تجربتك مع IPTV استثنائية.' },
};
export function accessEmail(s, c, password, kind, appUrl) {
  const lang = AM[c.lang] ? c.lang : 'en'; const L = AM[lang]; const e = escHtml;
  const app = s.branding.appName || 'IPTV';
  const v = (k, x = {}) => String(L[k]).replace(/\{(\w+)\}/g, (_, n) => (n === 'app' ? e(app) : e(x[n] ?? '')));
  const base = String(s.email.appUrl || appUrl || '').replace(/\/+$/, '');
  const logo = /^https?:/.test(s.branding.logoUrl) ? s.branding.logoUrl : base ? `${base}/${String(s.branding.logoUrl || 'logo.png').replace(/^\//, '')}` : '';
  const dns = String(c.dns || s.email.dns || s.player.serverUrl || '').replace(/\/+$/, '');
  const u = c.lineUsername || c.username, p = c.linePassword || password;
  const q = `username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
  const m3u = dns ? [`${dns}/get.php?${q}&type=m3u_plus&output=ts`, `${dns}/get.php?${q}&type=m3u_plus&output=m3u8`] : [];
  const date = new Date(c.expiresAt).toLocaleString(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' });
  const trial = kind === 'trial';
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
<tr><td class="mobile-pad" style="padding:10px 40px 20px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#fef3c7;border-${align}:4px solid #f59e0b;border-radius:6px"><tr><td style="padding:12px 16px;font-size:14px;color:#b45309;line-height:1.5;text-align:${align}">${trial ? v('trialNote', { hours: s.trial.hours }) : v('subNote', { date })}</td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 24px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
<tr><td style="padding:20px 24px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;text-align:${align}"><h2 style="margin:0;font-size:17px;font-weight:700;color:#0f172a">${L.details}</h2><p style="margin:6px 0 0;font-size:13px;color:#475569;line-height:1.5">${L.detailsIntro}</p></td></tr>
<tr><td style="padding:20px 24px"><table border="0" cellpadding="0" cellspacing="0" width="100%">${row(L.user, e(u))}${row(L.pass, e(p))}${dns ? row(L.dns, `<a href="${e(dns)}" style="color:${P};text-decoration:none;font-size:14px">${e(dns)}</a>`) : ''}
${m3u.length ? `<tr><td colspan="2" style="padding-top:16px;text-align:${align}"><div style="font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">${L.m3u}</div>${m3u.map((x, i) => `<div dir="ltr" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-bottom:10px;font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.5;color:#0369a1;word-break:break-all;text-align:left"><b style="color:#64748b">${i ? 'HLS' : 'TS'}:</b> ${e(x)}</div>`).join('')}</td></tr>` : ''}
</table></td></tr></table></td></tr>
${base ? `<tr><td class="mobile-pad" align="center" style="padding:0 40px 28px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(135deg,#0c4a6e,#0284c7);border-radius:12px"><tr><td align="center" style="padding:24px;color:#fff"><h3 style="margin:0 0 6px;font-size:17px;color:#fff">${v('appTitle')}</h3><p style="margin:0 0 16px;font-size:13px;color:#e0f2fe">${L.appText}</p>
<a href="${e(base)}/" style="display:inline-block;background:#fff;color:#0369a1;font-weight:700;padding:11px 18px;border-radius:10px;text-decoration:none;margin:4px">${L.openApp}</a> <a href="${e(base)}/download.html" style="display:inline-block;background:#38bdf8;color:#fff;font-weight:700;padding:11px 18px;border-radius:10px;text-decoration:none;margin:4px">${L.getApp}</a></td></tr></table></td></tr>` : ''}
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
  en: { dir: 'ltr', badgeSub: 'Subscription expired • Renewal reminder', badgeTrial: 'Free trial ended • Special offer', title: 'Renew Your {app} Subscription Today 🎉', dear: 'Dear {name},',
    introTrial: '🌼 We hope you enjoyed your recent trial with <b>{app}</b>. Thank you for giving our service a try.', introSub: '🌼 Thank you for watching with <b>{app}</b>. Your subscription ended on <b>{date}</b>.',
    intro2: 'We’d be delighted to welcome you back with our special renewal offer:', offerLabel: 'Special Welcome-Back Package', coupon: '🎁 Exclusive Coupon Code', cta: 'Renew Subscription Now →',
    how: 'How to Renew', h1: '🌐 Visit {site}', h2: '📺 Browse the available subscription plans and select the package that suits you.', h3: '🎁 Enter {coupon} at checkout, if applicable.', h4: '🔒 Complete your payment through the secure checkout.', h5: '🔄 Once your order is confirmed, contact our support team if you need help with activation.',
    help: 'If you have any questions or need help with your renewal, our support team is happy to assist.', thanks: 'Thank you for choosing <b>{app}</b>. We appreciate your support and look forward to serving you again.', regards: 'Best regards,', team: 'Customer Support Team', subject: 'Renew your {app} subscription — special offer inside 🎉' },
  fr: { dir: 'ltr', badgeSub: 'Abonnement expiré • Rappel de renouvellement', badgeTrial: 'Essai terminé • Offre spéciale', title: 'Renouvelez votre abonnement {app} 🎉', dear: 'Cher/Chère {name},',
    introTrial: "🌼 Nous espérons que vous avez apprécié votre essai avec <b>{app}</b>. Merci d'avoir essayé notre service.", introSub: '🌼 Merci de regarder avec <b>{app}</b>. Votre abonnement a pris fin le <b>{date}</b>.',
    intro2: 'Nous serions ravis de vous retrouver avec notre offre spéciale de renouvellement :', offerLabel: 'Offre spéciale de retour', coupon: '🎁 Code promo exclusif', cta: "Renouveler maintenant →",
    how: 'Comment renouveler', h1: '🌐 Rendez-vous sur {site}', h2: '📺 Parcourez les formules et choisissez celle qui vous convient.', h3: '🎁 Saisissez {coupon} lors du paiement, si applicable.', h4: '🔒 Finalisez votre paiement en toute sécurité.', h5: "🔄 Une fois la commande confirmée, contactez notre support si vous avez besoin d'aide pour l'activation.",
    help: "Pour toute question ou aide au renouvellement, notre équipe support est là pour vous.", thanks: "Merci d'avoir choisi <b>{app}</b>. Nous serons heureux de vous servir à nouveau.", regards: 'Cordialement,', team: 'Service client', subject: 'Renouvelez votre abonnement {app} — offre spéciale 🎉' },
  ar: { dir: 'rtl', badgeSub: 'انتهى الاشتراك • تذكير بالتجديد', badgeTrial: 'انتهت التجربة • عرض خاص', title: 'جدّد اشتراكك في {app} اليوم 🎉', dear: 'عزيزي/عزيزتي {name}،',
    introTrial: '🌼 نتمنى أن تكون قد استمتعت بتجربتك مع <b>{app}</b>. شكرًا لتجربتك خدمتنا.', introSub: '🌼 شكرًا لمشاهدتك مع <b>{app}</b>. انتهى اشتراكك في <b>{date}</b>.',
    intro2: 'يسعدنا أن نرحب بعودتك مع عرض التجديد الخاص:', offerLabel: 'باقة العودة الخاصة', coupon: '🎁 كود خصم حصري', cta: 'جدّد اشتراكك الآن ←',
    how: 'طريقة التجديد', h1: '🌐 زر موقع {site}', h2: '📺 تصفح الباقات واختر ما يناسبك.', h3: '🎁 أدخل {coupon} عند الدفع إن أمكن.', h4: '🔒 أكمل الدفع عبر صفحة الدفع الآمنة.', h5: '🔄 بعد تأكيد الطلب، تواصل مع الدعم إذا احتجت مساعدة في التفعيل.',
    help: 'إذا كان لديك أي سؤال أو تحتاج مساعدة في التجديد، فريق الدعم جاهز لمساعدتك.', thanks: 'شكرًا لاختيارك <b>{app}</b>. نتطلع لخدمتك مرة أخرى.', regards: 'مع أطيب التحيات،', team: 'فريق خدمة العملاء', subject: 'جدّد اشتراكك في {app} — عرض خاص 🎉' },
};
const OM = {
  en: { dir: 'ltr', badge: '{app} Order Checkout', title: 'Thank You for Choosing {app} 🎉', sub: 'Please place your order for your selected package below.', dear: 'Dear {name},', dearAny: 'Dear Valued Customer,',
    intro: 'Your <strong>{pkg}</strong> subscription package is ready for checkout. Click the secure Stripe payment button below to complete your order and receive instant activation.',
    introMulti: 'Your <strong>{pkg}</strong> subscription package is ready for checkout. Stream simultaneously on {n} devices. Click below to complete your order via Stripe.',
    access: '{d} Days Access', dev1: '📺 1 Device Connection', devN: '📺 {n} Devices Simultaneous Connection', cta: '🔒 Order {pkg} ({price}) →', secure: '100% Secure Stripe Payment • Instant Email Delivery',
    help: '📞 Need Assistance?', regards: 'Warm regards,', team: 'Customer Support Team', subject: '{pkg} — {price} | {app} order' },
  fr: { dir: 'ltr', badge: 'Commande {app}', title: "Merci d'avoir choisi {app} 🎉", sub: 'Passez votre commande pour la formule choisie ci-dessous.', dear: 'Bonjour {name},', dearAny: 'Cher client,',
    intro: 'Votre abonnement <strong>{pkg}</strong> est prêt. Cliquez sur le bouton de paiement sécurisé Stripe ci-dessous pour finaliser votre commande et recevoir une activation immédiate.',
    introMulti: 'Votre abonnement <strong>{pkg}</strong> est prêt. Regardez en même temps sur {n} appareils. Cliquez ci-dessous pour payer via Stripe.',
    access: 'Accès {d} jours', dev1: '📺 1 appareil', devN: '📺 {n} appareils en même temps', cta: '🔒 Commander {pkg} ({price}) →', secure: 'Paiement Stripe 100 % sécurisé • Livraison immédiate par email',
    help: "📞 Besoin d'aide ?", regards: 'Cordialement,', team: 'Service client', subject: '{pkg} — {price} | commande {app}' },
  ar: { dir: 'rtl', badge: 'طلب {app}', title: 'شكرًا لاختيارك {app} 🎉', sub: 'أكمل طلب الباقة التي اخترتها أدناه.', dear: 'عزيزي/عزيزتي {name}،', dearAny: 'عزيزي العميل،',
    intro: 'باقة اشتراكك <strong>{pkg}</strong> جاهزة للدفع. اضغط على زر الدفع الآمن عبر Stripe لإتمام طلبك والحصول على تفعيل فوري.',
    introMulti: 'باقة اشتراكك <strong>{pkg}</strong> جاهزة للدفع. شاهد على {n} أجهزة في نفس الوقت. اضغط أدناه للدفع عبر Stripe.',
    access: 'وصول لمدة {d} يومًا', dev1: '📺 جهاز واحد', devN: '📺 {n} أجهزة في نفس الوقت', cta: '🔒 اطلب {pkg} ({price}) ←', secure: 'دفع آمن 100% عبر Stripe • تسليم فوري بالبريد',
    help: '📞 تحتاج مساعدة؟', regards: 'مع أطيب التحيات،', team: 'فريق خدمة العملاء', subject: '{pkg} — {price} | طلب {app}' },
};
const CUR_SIGN = { EUR: '€', USD: '$', USDT: '₮', MAD: 'MAD ' };
// Random pay link for a package: from enabled Stripe accounts, in the email currency
export function pickPayLink(s, pkg) {
  const cur = s.orderCurrency === 'USDT' ? 'USD' : s.orderCurrency || 'EUR'; const all = cur === 'ALL';
  const on = new Set((s.orderAccounts || []).filter((a) => a.enabled !== false).map((a) => a.id));
  let pool = (pkg.links || []).filter((l) => (all || l.cur === cur) && l.url && (!l.acc || on.has(l.acc)));
  if (all && pool.length) { // first a random account, then one of its links, so every account gets the same share
    const accs = [...new Set(pool.map((l) => l.acc))]; const a = accs[Math.floor(Math.random() * accs.length)]; pool = pool.filter((l) => l.acc === a);
  }
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  return pkg.link ? { url: pkg.link, acc: '' } : null;
}
export function orderEmail(s, c, pkg, appUrl, chosen) {
  const lang = OM[c?.lang] ? c.lang : 'en'; const L = OM[lang]; const e = escHtml;
  const app = s.branding.appName || 'IPTV'; const pl = chosen || pickPayLink(s, pkg);
  const cur = s.orderCurrency === 'ALL' ? pl?.cur || 'EUR' : s.orderCurrency || 'EUR';
  const price = (CUR_SIGN[cur] || '') + Number(pkg.price).toFixed(2) + (CUR_SIGN[cur] ? '' : ' ' + cur);
  const n = Math.max(1, Number(pkg.devices) || 1);
  const v = (k, x = {}) => String(L[k]).replace(/\{(\w+)\}/g, (_, m) => (m === 'app' ? e(app) : m === 'pkg' ? e(pkg.title) : m === 'price' ? e(price) : m === 'n' ? n : m === 'd' ? pkg.days : e(x[m] ?? '')));
  const base = String(s.email.appUrl || appUrl || '').replace(/\/+$/, '');
  const logo = /^https?:/.test(s.branding.logoUrl) ? s.branding.logoUrl : base ? `${base}/${String(s.branding.logoUrl || 'logo.png').replace(/^\//, '')}` : '';
  const site = String(s.email.website || s.renewalOffer?.url || '').replace(/\/+$/, ''); const siteTxt = site.replace(/^https?:\/\//, '');
  const link = pl?.url || site; const al = L.dir === 'rtl' ? 'right' : 'left';
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
${link ? `<a href="${e(link)}" class="cta-btn" style="display:inline-block;background:#0284c7;color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:15px 36px;border-radius:8px;box-shadow:0 4px 14px rgba(2,132,199,.3)">${v('cta')}</a>` : ''}
<div style="margin-top:12px;font-size:12px;color:#64748b">${L.secure}</div></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 32px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0"><tr><td style="padding:20px 24px;text-align:${al}"><div style="font-size:15px;font-weight:700;color:#166534;margin-bottom:6px">${L.help}</div><div style="font-size:14px;color:#166534">
${s.email.supportEmail ? `📧 <a href="mailto:${e(s.email.supportEmail)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.email.supportEmail)}</a>` : ''}${s.email.supportEmail && site ? ' &nbsp;|&nbsp; ' : ''}${site ? `🌐 <a href="${e(site)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(siteTxt)}</a>` : ''}${s.branding.supportUrl ? ` &nbsp;|&nbsp; 💬 <a href="${e(s.branding.supportUrl)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.branding.supportLabel || 'WhatsApp')}</a>` : ''}</div></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 32px;border-bottom:1px solid #f1f5f9;text-align:${al}"><p style="margin:0;font-size:14px;line-height:1.6;color:#64748b">${L.regards}<br><b style="color:#0f172a;font-size:15px">${e(app)}</b><br><span style="color:#0284c7;font-weight:600">${L.team}</span></p></td></tr>
<tr><td align="center" class="mobile-pad" style="padding:22px 40px;background:#f8fafc;text-align:center">${site ? `<a href="${e(site)}" style="font-size:13px;font-weight:700;color:#0284c7;text-decoration:none">${e(siteTxt)}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: v('subject').replace(/<[^>]+>/g, ''), html, payAcc: pl?.acc || '' };
}
// Newsletter / promotion email. camp = { id, content: { en: { subject, title, body, button }, fr, ar }, image, badge, coupon, link: 'site' | 'pkg:<id>' | url }
const NL = { en: { dear: 'Hello {name},', dearAny: 'Hello,', coupon: '🎁 Your coupon code', help: '📞 Need assistance?', regards: 'Warm regards,', team: 'Customer Support Team', unsub: "Don't want these emails?", unsubLink: 'Unsubscribe', btn: 'See the offer →' },
  fr: { dear: 'Bonjour {name},', dearAny: 'Bonjour,', coupon: '🎁 Votre code promo', help: "📞 Besoin d'aide ?", regards: 'Cordialement,', team: 'Service client', unsub: 'Vous ne souhaitez plus recevoir ces emails ?', unsubLink: 'Se désabonner', btn: "Voir l'offre →" },
  ar: { dear: 'مرحبًا {name}،', dearAny: 'مرحبًا،', coupon: '🎁 كود الخصم الخاص بك', help: '📞 تحتاج مساعدة؟', regards: 'مع أطيب التحيات،', team: 'فريق خدمة العملاء', unsub: 'لا تريد هذه الرسائل؟', unsubLink: 'إلغاء الاشتراك', btn: 'شاهد العرض ←' } };
export function newsletterEmail(s, c, camp, appUrl, unsubUrl) {
  const pick = (l) => { const x = camp.content?.[l] || {}; return x.subject || x.title || x.body ? x : null; };
  const lang = (camp.split && pick(c?.lang) ? c.lang : (camp.split ? (pick('en') ? 'en' : ['fr', 'ar'].find(pick) || 'en') : (['en', 'fr', 'ar'].includes(camp.lang) ? camp.lang : 'en')));
  const C = (camp.split ? pick(lang) : camp.content?.all || camp.content?.[lang]) || {}; const L = NL[camp.split ? lang : (camp.lang || 'en')] || NL.en;
  const dir = (camp.split ? lang : camp.lang) === 'ar' ? 'rtl' : 'ltr'; const al = dir === 'rtl' ? 'right' : 'left'; const e = escHtml;
  const app = s.branding.appName || 'IPTV'; const first = (c?.name || '').split(' ')[0];
  const fillTxt = (t) => String(t || '').replace(/\{name\}/g, first || '').replace(/\{app\}/g, app);
  const para = (t) => e(fillTxt(t)).replace(/\*(.+?)\*/g, '<b>$1</b>').split(/\n{2,}/).map((p) => `<p dir="auto" style="margin:0 0 14px;font-size:15px;line-height:1.65">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const base = String(s.email.appUrl || appUrl || '').replace(/\/+$/, '');
  const logo = /^https?:/.test(s.branding.logoUrl) ? s.branding.logoUrl : base ? `${base}/${String(s.branding.logoUrl || 'logo.png').replace(/^\//, '')}` : '';
  const site = String(s.email.website || s.renewalOffer?.url || '').replace(/\/+$/, ''); const siteTxt = site.replace(/^https?:\/\//, '');
  let link = ''; let payAcc = '';
  if (camp.link === 'site') link = site;
  else if (camp.link === 'app') link = base;
  else if (String(camp.link || '').startsWith('pkg:')) { const pk = (s.orderPackages || []).find((p) => p.id === camp.link.slice(4)); const pl = pk && pickPayLink(s, pk); link = pl?.url || site; payAcc = pl?.acc || ''; }
  else if (/^https?:\/\/\S+$/.test(String(camp.link || ''))) link = camp.link;
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(fillTxt(C.subject || C.title))}</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}img{border:0;height:auto;outline:none;text-decoration:none}body{margin:0!important;padding:0!important;width:100%!important;background:#f4f7fa;font-family:'Segoe UI',Roboto,Helvetica,Arial,Tahoma,sans-serif;color:#334155}
@media screen and (max-width:620px){.container{width:100%!important;border-radius:0!important}.mobile-pad{padding:24px 20px!important}.header-title{font-size:22px!important}.cta-btn{display:block!important;width:100%!important;box-sizing:border-box!important}}</style></head>
<body dir="${dir}" style="background:#f4f7fa;margin:0;padding:0"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7fa;padding:30px 10px"><tr><td align="center">
<table border="0" cellpadding="0" cellspacing="0" width="600" class="container" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,.05)">
<tr><td height="6" style="background:linear-gradient(90deg,#0284c7 0%,#0ea5e9 50%,#38bdf8 100%);font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td align="center" class="mobile-pad" style="padding:36px 40px 26px;background:linear-gradient(180deg,#f8fafc 0%,#fff 100%);border-bottom:1px solid #f1f5f9">
${logo ? `<img src="${e(logo)}" alt="${e(app)}" width="90" style="display:block;border-radius:50%;border:3px solid #0ea5e9;box-shadow:0 4px 12px rgba(14,165,233,.2);margin:0 auto 16px">` : ''}
${camp.badge ? `<div dir="auto" style="display:inline-block;background:#0369a1;color:#fff;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:50px;margin-bottom:14px">${e(fillTxt(camp.badge))}</div>` : ''}
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
    ar: 'مرحبًا {name} 👋\n\nشكرًا لاختيارك *{app}* 🎉\nهذه باقتك:\n\n📺 *{package}*\n⏳ {days} يوم · {devices} جهاز\n💶 *{price}*\n\n🔒 ادفع بأمان من هنا:\n{link}\n\nالتفعيل فوري بعد الدفع. لأي سؤال، رد هنا 😊',
  },
  login: {
    en: 'Hello {name} 👋\n\nYour *{app}* subscription is ready ✅\n\n👤 Username: {username}\n🔑 Password: {password}\n🌐 DNS: {dns}\n📅 Expires: {expires}\n\n📋 M3U link:\n{m3u}\n\n📲 Watch in our app: {appUrl}\nEnjoy! 🍿',
    fr: 'Bonjour {name} 👋\n\nVotre abonnement *{app}* est prêt ✅\n\n👤 Identifiant : {username}\n🔑 Mot de passe : {password}\n🌐 DNS : {dns}\n📅 Expire le : {expires}\n\n📋 Lien M3U :\n{m3u}\n\n📲 Regardez dans notre application : {appUrl}\nBon visionnage ! 🍿',
    ar: 'مرحبًا {name} 👋\n\nاشتراكك في *{app}* جاهز ✅\n\n👤 اسم المستخدم: {username}\n🔑 كلمة المرور: {password}\n🌐 DNS: {dns}\n📅 ينتهي في: {expires}\n\n📋 رابط M3U:\n{m3u}\n\n📲 شاهد في تطبيقنا: {appUrl}\nمشاهدة ممتعة! 🍿',
  },
  renew: {
    en: 'Hello {name} 👋\n\nYour *{app}* subscription {ends} *{expires}* ⏰\nRenew now and keep watching 📺\n\n*{package}* — *{price}*\n🔒 Pay here: {link}\n\nNeed help? Just reply here 😊',
    fr: 'Bonjour {name} 👋\n\nVotre abonnement *{app}* {ends} *{expires}* ⏰\nRenouvelez maintenant pour continuer à regarder 📺\n\n*{package}* — *{price}*\n🔒 Payez ici : {link}\n\nBesoin d\'aide ? Répondez ici 😊',
    ar: 'مرحبًا {name} 👋\n\nاشتراكك في *{app}* {ends} *{expires}* ⏰\nجدّد الآن واستمر في المشاهدة 📺\n\n*{package}* — *{price}*\n🔒 ادفع من هنا: {link}\n\nتحتاج مساعدة؟ رد هنا 😊',
  },
};
export function renewalEmail(s, c, appUrl) {
  const lang = RM[c.lang] ? c.lang : 'en'; const L = RM[lang]; const e = escHtml; const o = s.renewalOffer || {};
  const app = s.branding.appName || 'IPTV';
  const site = String(o.url || s.email.website || s.email.appUrl || appUrl || '').replace(/\/+$/, '');
  const siteTxt = site.replace(/^https?:\/\//, '');
  const date = new Date(c.expiresAt).toLocaleDateString(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long' });
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
<div style="display:inline-block;background:#fef3c7;border:1px solid #fde68a;color:#b45309;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:50px;margin-bottom:14px">${L[trial ? 'badgeTrial' : 'badgeSub']}</div>
<h1 class="header-title" style="margin:0;font-size:26px;font-weight:800;color:#0f172a;line-height:1.3">${v('title')}</h1></td></tr>
<tr><td class="mobile-pad" style="padding:32px 40px 20px;text-align:${al}"><p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#0f172a">${v('dear', { name: c.name || '' })}</p>
<p style="margin:0 0 14px;font-size:15px;line-height:1.65">${v(trial ? 'introTrial' : 'introSub', { date })}</p><p style="margin:0;font-size:15px;line-height:1.65">${L.intro2}</p></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 28px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%);border:2px solid #7dd3fc;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:26px 24px;text-align:center">
<div style="font-size:13px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${L.offerLabel}</div>
<div dir="auto" style="font-size:20px;font-weight:800;color:#0f172a;line-height:1.3;margin-bottom:6px">${e(o.title || '')}</div>
${o.price ? `<div dir="auto" style="font-size:32px;font-weight:900;color:#0284c7;margin-bottom:8px">${e(o.price)}</div>` : ''}
${o.bonus ? `<div dir="auto" style="display:inline-block;background:#dcfce7;border:1px solid #86efac;color:#166534;font-size:13px;font-weight:700;padding:4px 12px;border-radius:50px;margin-bottom:20px">✨ ${e(o.bonus)}</div>` : ''}
${o.coupon ? `<div style="background:#fff;border:2px dashed #38bdf8;border-radius:10px;padding:14px 20px;margin-bottom:20px"><div style="font-size:13px;font-weight:700;color:#475569;margin-bottom:6px">${L.coupon}</div><div style="font-family:'Courier New',monospace;font-size:22px;font-weight:800;color:#0284c7;letter-spacing:2px">${e(o.coupon)}</div></div>` : ''}
${site ? `<a href="${e(site)}" class="cta-btn" style="display:inline-block;background:#0284c7;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;box-shadow:0 4px 12px rgba(2,132,199,.25)">${L.cta}</a>` : ''}
</td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 28px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:24px;text-align:${al}"><h2 style="margin:0 0 16px;font-size:17px;font-weight:700;color:#0f172a">${L.how}</h2>
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;line-height:1.6">${site ? step(1, v('h1')) : ''}${step(site ? 2 : 1, L.h2)}${o.coupon ? step(site ? 3 : 2, v('h3')) : ''}${step(4 - (site ? 0 : 1) - (o.coupon ? 0 : 1), L.h4)}${step(5 - (site ? 0 : 1) - (o.coupon ? 0 : 1), L.h5)}</table></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 32px"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0"><tr><td style="padding:22px 24px;text-align:${al}"><p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#166534">${L.help}</p>
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;color:#166534">${s.email.supportEmail ? `<tr><td style="padding:4px 0">📧 <a href="mailto:${e(s.email.supportEmail)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.email.supportEmail)}</a></td></tr>` : ''}${site ? `<tr><td style="padding:4px 0">🌐 <a href="${e(site)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(siteTxt)}</a></td></tr>` : ''}${s.branding.supportUrl ? `<tr><td style="padding:4px 0">💬 <a href="${e(s.branding.supportUrl)}" style="color:#0284c7;text-decoration:none;font-weight:600">${e(s.branding.supportLabel || 'WhatsApp')}</a></td></tr>` : ''}</table></td></tr></table></td></tr>
<tr><td class="mobile-pad" style="padding:0 40px 36px;border-bottom:1px solid #f1f5f9;text-align:${al}"><p style="margin:0 0 18px;font-size:14px;line-height:1.65">${v('thanks')}</p><p style="margin:0;font-size:14px;line-height:1.6;color:#64748b">${L.regards}<br><b style="color:#0f172a;font-size:15px">${e(app)}</b><br><span style="color:#0284c7;font-weight:600">${L.team}</span></p></td></tr>
<tr><td align="center" class="mobile-pad" style="padding:24px 40px;background:#f8fafc;text-align:center">${site ? `<a href="${e(site)}" style="font-size:13px;font-weight:700;color:#0284c7;text-decoration:none;letter-spacing:.5px">${e(siteTxt)}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: v('subject').replace(/<[^>]+>/g, ''), html };
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
    if (sCache && Date.now() - sAt < cacheMs) return sCache;
    let s = deepMerge(DEFAULT_SETTINGS(), (await store.get('settings')) || {});
    if (s.branding.appName === 'My IPTV' && !s.branding.logoUrl) s.branding = { ...s.branding, ...DEFAULT_SETTINGS().branding, supportUrl: s.branding.supportUrl, supportLabel: s.branding.supportLabel, footerText: s.branding.footerText };
    if (!s.security.proxySecret) { s.security.proxySecret = uid(24); await store.put('settings', s); }
    sCache = s; sAt = Date.now();
    return s;
  }
  const unsubSig = async (s, id) => (await hmac(s.security.proxySecret, 'unsub:' + id)).slice(0, 16);
  const unsubUrl = async (s, c, appUrl) => `${String(s.email.appUrl || appUrl || '').replace(/\/+$/, '')}/#unsub=${c.id}.${await unsubSig(s, c.id)}`;
  function nlGroup(list, grp, warnDays) {
    const now = Date.now();
    return list.filter((c) => {
      if (!cleanEmail(c.email) || c.unsub) return false;
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
  async function saveSettings(s) { await store.put('settings', s); sCache = s; sAt = Date.now(); }
  const getCustomers = async () => (await store.get('customers')) || [];
  const saveCustomers = (c) => store.put('customers', c);
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
  async function recordSale(s, c, { type, plan, days, credits, amount, accountId, at, by }) {
    if (Number(amount) > 0) s = await refreshRates(s, false);
    const acc = s.finance.accounts.find((a) => a.id === accountId);
    const currency = acc ? acc.currency : s.currency;
    const amountUsd = toUsd(amount, currency, s.finance.rates);
    const costUsd = credits * (await creditCostUsd(s));
    const sale = { by: by || '', id: uid(6), at: at || Date.now(), customerId: c.id, username: c.username, name: c.name, type, planId: plan ? plan.id : (type === 'trial' ? 'trial' : 'custom'), planName: type === 'trial' ? 'Trial' : plan ? plan.name : 'Custom', days, credits, amount: Number(amount) || 0, currency, amountUsd, costUsd, accountId: acc ? acc.id : '' };
    const sales = await getSales(); sales.push(sale); await store.put('sales', sales);
    if (acc && Number(amount) > 0) {
      const tx = await getTx();
      tx.push({ id: uid(6), by: by || '', at: sale.at, type: 'income', accountId: acc.id, amount: Number(amount), category: 'Sale', note: `${sale.planName} · ${c.name} (${c.username})`, saleId: sale.id });
      await store.put('tx', tx);
    }
    return sale;
  }
  async function sendEmail(s, to, subject, html) {
    const e = s.email;
    to = cleanEmail(to);
    if (!to) return { ok: false, error: 'This is not a valid email address.' };
    if (!e.resendKey || !e.from || !to) return { ok: false, skipped: true, error: 'Email is not set up (Resend key / sender missing).' };
    try {
      const res = await fetchFn('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + e.resendKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: e.from, to: [to], subject, html }) });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, id: data.id } : { ok: false, error: data.message || 'Resend error ' + res.status };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  const withUrl = (s, u) => (s.email.appUrl || !u ? s : { ...s, email: { ...s.email, appUrl: String(u) } });
  // Send many emails in one request (Resend batch API, up to 100)
  async function sendBatch(s, msgs) {
    const e = s.email;
    if (!e.resendKey || !e.from) return { ok: false, error: 'Email is not set up (Resend key / sender missing).' };
    if (!msgs.length) return { ok: true, sent: 0 };
    try {
      msgs = msgs.map((m) => ({ ...m, to: cleanEmail(m.to) })).filter((m) => m.to);
      if (!msgs.length) return { ok: true, sent: 0 };
      const r = await fetchFn('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: 'Bearer ' + e.resendKey, 'Content-Type': 'application/json' }, body: JSON.stringify(msgs.map((m) => ({ from: e.from, to: [m.to], subject: m.subject, html: m.html }))) });
      const d = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, sent: msgs.length } : { ok: false, error: d.message || 'Resend error ' + r.status };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  // Who can get a renewal email right now
  function renewalTargets(list, onlyRecentDays) {
    const now = Date.now();
    return list.filter((c) => cleanEmail(c.email) && !c.unsub && c.status !== 'disabled' && c.expiresAt < now && c.renewalSentFor !== c.expiresAt && (!onlyRecentDays || now - c.expiresAt <= onlyRecentDays * DAYMS));
  }
  async function sentToday() { const k = 'renewsent:' + new Date().toISOString().slice(0, 10); return { k, n: (await store.get(k)) || 0 }; }
  function loginMail(s, c, password, kind) {
    return accessEmail(s, c, password, kind === 'trial' ? 'trial' : 'sub', s.email.appUrl);
  }
  function oldLoginMail(s, c, password, kind) {
    const lang = ['en', 'fr', 'ar'].includes(c.lang) ? c.lang : 'en';
    const hours = s.trial.hours;
    const exp = new Date(c.expiresAt).toLocaleString(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
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
  async function stockInfo(s) {
    const st = await getStock(); const sales = await getSales();
    const purchased = st.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    const used = sales.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    return { purchased, used, available: purchased - used, avgCostUsd: await creditCostUsd(s), low: purchased - used <= (Number(s.stock.lowCreditsAlert) || 0), purchases: st.slice().sort((a, b) => b.at - a.at) };
  }
  const getTeam = async () => (await store.get('team')) || [];
  async function baseLog(type, msg, by) {
    const l = (await store.get('log')) || [];
    l.unshift({ at: Date.now(), type, msg, by: by || '' });
    await store.put('log', l.slice(0, 300));
  }
  const log = (type, msg) => baseLog(type, msg, 'system');
  async function newSession(role, id, s) {
    const token = uid(24);
    const hours = Math.max(1, Number(s.security.sessionHours) || 72);
    await store.put('session:' + token, { role, id, exp: Date.now() + hours * 3600000 }, hours * 3600);
    return token;
  }
  async function getSession(token) {
    if (!token) return null;
    const ses = await store.get('session:' + token);
    return ses && ses.exp > Date.now() ? ses : null;
  }

  function view(c, s) {
    const now = Date.now();
    const daysLeft = Math.ceil((c.expiresAt - now) / DAY);
    const warn = Number(s.userDashboard.expiryWarningDays) || 7;
    const state = c.status === 'disabled' ? 'disabled' : c.expiresAt < now ? 'expired' : daysLeft <= warn ? 'expiring' : 'active';
    const plan = s.plans.find((p) => p.id === c.planId);
    const { passwordHash, salt, ...rest } = c;
    return { ...rest, daysLeft, hoursLeft: Math.max(0, Math.round((c.expiresAt - now) / 3600000)), state, planName: c.isTrial ? 'Trial' : plan ? plan.name : 'Custom', planDays: plan ? plan.days : Math.max(1, Math.round((c.expiresAt - c.startAt) / DAY)) };
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
    let res, text;
    try { res = await fetchFn(url, init); text = await res.text(); }
    catch (e) { return { ok: false, error: 'Cannot reach panel: ' + e.message }; }
    let data; try { data = JSON.parse(text); } catch { data = text; }
    const failed = !res.ok || (isObj(data) && (data.result === false || data.success === false || data.status === 'error' || data.status === false));
    return { ok: !failed, status: res.status, data, error: failed ? (isObj(data) && (data.message || data.error)) || `Panel returned HTTP ${res.status}` : undefined };
  }

  async function xtream(s, c, params) {
    const server = trimSlash(s.player.serverUrl);
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
    let actorName = '';
    const log = (type, msg) => baseLog(type, msg, actorName);
    try {
      const s = await getSettings();
      const R = (m, p) => method === m && path === p;

      // ---------- public ----------
      if (R('GET', '/api/config')) {
        await getAdmin();
        return ok({ branding: s.branding, currency: s.currency, setupRequired: false, mode, trial: { enabled: !!s.trial.enabled, hours: s.trial.hours } });
      }
      if (R('POST', '/api/trial')) {
        actorName = 'trial sign-up';
        if (!s.trial.enabled) return err(403, 'trial_off');
        const name = String(body.name || '').trim().slice(0, 80);
        const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
        const phone = String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
        const whatsapp = String(body.whatsapp || phone).replace(/[^\d+]/g, '').slice(0, 20);
        if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.replace(/\D/g, '').length < 8) return err(400, 'trial_invalid');
        const list = await getCustomers();
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
        const rnd = (n, ch) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => ch[x % ch.length]).join('');
        let username; do { username = 't' + rnd(6, '0123456789'); } while (list.some((c) => c.username === username));
        let password = rnd(8, 'abcdefghjkmnpqrstuvwxyz23456789');
        const salt = uid(8);
        const now = Date.now();
        const c = { loginPassword: password, id: uid(8), name, email, phone, whatsapp, lang: ['en', 'fr', 'ar'].includes(body.lang) ? body.lang : 'en', note: 'Free trial', username, salt, passwordHash: await hashPassword(password, salt), lineUsername: username, linePassword: password, lineId: '', planId: 'trial', isTrial: true, connections: Number(s.trial.connections) || 1, startAt: now, expiresAt: now + (Number(s.trial.hours) || 24) * 3600000, status: 'active', createdAt: now, lastLogin: null, renewals: [{ at: now, type: 'trial', planId: 'trial', days: 1, credits: Number(s.trial.credits) || 0, price: 0 }] };
        if (s.reseller.enabled) {
          const panel = await panelCall(s, 'trial', { username, password, line_id: '', package: s.trial.package, connections: c.connections, days: 1, months: 1, hours: s.trial.hours, name, phone, note: 'trial' });
          if (!panel.ok && !panel.skipped) { await log('trial', `Trial for ${email} failed on panel: ${panel.error}`); return err(502, 'trial_panel'); }
          if (!panel.skipped) {
            const got = applyPanelCreds(s, c, panel.data);
            if (got.u && !list.some((x) => x.username.toLowerCase() === got.u.toLowerCase())) username = c.username = got.u;
            if (got.p) { password = got.p; c.loginPassword = password; c.salt = uid(8); c.passwordHash = await hashPassword(password, c.salt); }
          }
        }
        list.push(c); await saveCustomers(list);
        await recordSale(s, c, { type: 'trial', plan: null, days: 1, credits: Number(s.trial.credits) || 0, amount: 0, accountId: '' });
        const m = accessEmail(s, c, password, 'trial', body.appUrl);
        const sent = await sendEmail(s, email, m.subject, m.html);
        await log('trial', `Free trial ${username} for ${name} <${email}>${sent.ok ? ' · email sent' : ' · email NOT sent: ' + (sent.error || '')}`);
        const showOnScreen = !sent.ok || s.trial.showCredentialsOnScreen;
        return ok({ ok: true, emailed: !!sent.ok, hours: s.trial.hours, ...(showOnScreen ? { username, password } : {}) });
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
        const admin = await getAdmin();
        if (admin && admin.username.toLowerCase() === username) {
          if ((await hashPassword(password, admin.salt)) !== admin.hash) return err(401, 'Wrong username or password.');
          return ok({ token: await newSession('admin', 'admin', s), role: 'admin' });
        }
        const team = await getTeam();
        const m = team.find((x) => x.username.toLowerCase() === username);
        if (m) {
          if ((await hashPassword(password, m.salt)) !== m.hash) return err(401, 'Wrong username or password.');
          if (m.status === 'disabled') return err(403, 'This account is disabled. Please contact support.');
          m.lastLogin = Date.now(); await store.put('team', team);
          return ok({ token: await newSession('staff', m.id, s), role: 'staff' });
        }
        const list = await getCustomers();
        const c = list.find((x) => x.username.toLowerCase() === username);
        if (!c || (await hashPassword(password, c.salt)) !== c.passwordHash) return err(401, 'Wrong username or password.');
        if (c.status === 'disabled') return err(403, 'This account is disabled. Please contact support.');
        c.lastLogin = Date.now();
        await saveCustomers(list);
        return ok({ token: await newSession('user', c.id, s), role: 'user' });
      }
      if (R('POST', '/api/logout')) {
        if (token) await store.del('session:' + token);
        return ok({ ok: true });
      }

      const ses = await getSession(token);
      if (!ses) return err(401, 'Please sign in again.');

      // ---------- customer ----------
      if (ses.role === 'user') {
        const list = await getCustomers();
        const c = list.find((x) => x.id === ses.id);
        if (!c) return err(401, 'Account not found.');
        if (c.status === 'disabled') return err(401, 'This account is disabled.');
        const v = view(c, s);
        const canWatch = v.state !== 'expired' && !s.userDashboard.maintenance;

        if (R('POST', '/api/me/order')) { // customer picks a package: get a pay link, and optionally the payment email
          const pk = (s.orderPackages || []).find((p) => p.id === body.pkg); if (!pk) return err(400, 'Package not found.');
          const m = orderEmail(s, c, pk, body.appUrl); const url = (m.html.match(/<a href="([^"]+)" class="cta-btn"/) || [])[1]?.replace(/&amp;/g, '&') || '';
          if (!body.email) { c.orderClickAt = Date.now(); c.orderClickPkg = pk.id; await saveCustomers(list); await log('customer', `${c.username} opened pay link "${pk.title}"${m.payAcc ? ' (' + m.payAcc + ')' : ''}`); return ok({ url }); }
          const to = cleanEmail(c.email); if (!to) return err(400, 'no_email');
          const k = 'ordermail:' + c.id + ':' + new Date().toISOString().slice(0, 10); const n = Number(await store.get(k)) || 0;
          if (n >= 5) return err(429, 'Too many emails today. Please try tomorrow or contact us.');
          const r = await sendEmail(s, to, m.subject, m.html);
          if (!r.ok) return err(502, r.error || 'Email failed');
          await store.put(k, n + 1, 2 * 86400); c.orderSentAt = Date.now(); c.orderSentPkg = pk.id; c.orderSentAcc = m.payAcc; await saveCustomers(list);
          await log('customer', `${c.username} asked for the "${pk.title}" payment email <${to}>`);
          return ok({ url, email: to });
        }
        if (R('GET', '/api/me')) {
          const { lineUsername, linePassword, loginPassword, ...pub } = v;
          return ok({
            user: pub, dashboard: s.userDashboard, branding: s.branding, currency: s.currency,
            plans: s.plans.map((p) => ({ id: p.id, name: p.name, days: p.days, price: p.price, connections: p.connections })),
            orderPackages: (s.orderPackages || []).map((p) => ({ p, pl: pickPayLink(s, p) })).filter((x) => x.pl).map(({ p, pl }) => ({ id: p.id, title: p.title, days: p.days, devices: p.devices, price: p.price, badge: p.badge, url: pl.url, cur: s.orderCurrency === 'ALL' ? pl.cur || 'EUR' : s.orderCurrency === 'USDT' ? 'USDT' : s.orderCurrency || 'EUR' })),
            orderCurrency: s.orderCurrency || 'EUR', hasEmail: !!cleanEmail(c.email),
            stream: canWatch && s.player.serverUrl ? {
              server: trimSlash(s.player.serverUrl), u: lineUsername, p: linePassword,
              useProxy: !!s.player.useProxy, proxyToken: await makeProxyToken(s.security.proxySecret, c.id, 12),
              mode: s.player.mode === 'direct' ? 'direct' : 'proxy', userAgent: s.player.userAgent || 'IPTVSmartersPro',
              relay: String(s.player.relayUrl || '').trim().replace(/\/+$/, ''),
              dns: String(c.dns || s.email.dns || s.player.serverUrl || '').replace(/\/+$/, ''),
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
        if (R('POST', '/api/me/password')) {
          if (!s.userDashboard.allowPasswordChange) return err(403, 'Password change is turned off.');
          if ((await hashPassword(body.current || '', c.salt)) !== c.passwordHash) return err(400, 'Current password is wrong.');
          if (String(body.next || '').length < 6) return err(400, 'New password needs 6+ characters.');
          c.salt = uid(8); c.passwordHash = await hashPassword(body.next, c.salt); delete c.loginPassword;
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
        perms = member.perms || [];
        actorName = member.name || member.username;
      }
      const can = (p) => isOwner || perms.includes(p);
      const need = permFor(method, path, body);
      if (need === 'owner' && !isOwner) return err(403, 'Only the owner can do this.');
      if (need && need !== 'owner' && !can(need)) return err(403, 'You do not have permission for this.');

      if (R('GET', '/api/admin/me')) {
        if (isOwner) { const a = await getAdmin(); return ok({ role: 'owner', name: a.username, username: a.username, isDefault: !!a.isDefault, perms: PERM_KEYS, allPerms: PERMS, mode }); }
        return ok({ role: 'staff', name: member.name, username: member.username, isDefault: false, perms, allPerms: PERMS, mode });
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
        const m = { id: uid(6), name: String(body.name || username), username, role: String(body.role || 'Staff'), salt, hash: await hashPassword(body.password, salt), perms: (body.perms || []).filter((p) => PERM_KEYS.includes(p)), status: 'active', createdAt: Date.now(), lastLogin: null };
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
          if (body.name !== undefined) m.name = String(body.name);
          if (body.role !== undefined) m.role = String(body.role);
          if (Array.isArray(body.perms)) m.perms = body.perms.filter((p) => PERM_KEYS.includes(p));
          if (body.status) m.status = body.status === 'disabled' ? 'disabled' : 'active';
          if (body.password) { if (String(body.password).length < 6) return err(400, 'Password needs 6+ characters.'); m.salt = uid(8); m.hash = await hashPassword(body.password, m.salt); }
          await store.put('team', team); await log('team', `Updated team member ${m.name}`);
          const { salt, hash, ...pub } = m; return ok(pub);
        }
      }

      if (R('GET', '/api/admin/settings')) {
        if (can('settings')) return ok(s);
        return ok({ ...s, reseller: { ...s.reseller, apiKey: '', password: '', actions: {} }, email: { ...s.email, resendKey: '' }, finance: { ...s.finance, stripeKey: s.finance.stripeKey ? '••••' : '' }, security: { sessionHours: s.security.sessionHours } });
      }
      if (R('PUT', '/api/admin/settings')) {
        if (body?.finance?.stripeKey === '••••') delete body.finance.stripeKey;
        const next = deepMerge(s, body || {});
        next.security.proxySecret = s.security.proxySecret;
        next.branding.whatsapp = String(next.branding.whatsapp || '').replace(/\D/g, '');
        if (next.branding.whatsapp && (!next.branding.supportUrl || /wa\.me\//.test(next.branding.supportUrl))) { next.branding.supportUrl = 'https://wa.me/' + next.branding.whatsapp; if (!next.branding.supportLabel || next.branding.supportLabel === 'Contact support') next.branding.supportLabel = 'WhatsApp'; }
        if (Array.isArray(body.plans)) next.plans = body.plans.map((p) => ({
          id: p.id || 'p' + uid(3), name: String(p.name || 'Plan'), days: Math.max(1, Number(p.days) || 30),
          price: Number(p.price) || 0, connections: Math.max(1, Number(p.connections) || 1), package: String(p.package || ''),
          credits: p.credits === '' || p.credits == null ? Math.max(1, Math.round((Number(p.days) || 30) / 30)) : Number(p.credits),
        }));
        if (Array.isArray(body.orderPackages)) next.orderPackages = body.orderPackages.map((p) => ({ id: p.id || 'o' + uid(3), title: String(p.title || 'Package'), days: Math.max(1, Number(p.days) || 30), devices: Math.max(1, Number(p.devices) || 1), price: Number(p.price) || 0, badge: String(p.badge || ''), link: String(p.link || '').trim(), links: Array.isArray(p.links) ? p.links.filter((l) => /^https:\/\/[^\s]+$/.test(l?.url || '')).map((l) => ({ acc: String(l.acc || ''), cur: String(l.cur || 'EUR').toUpperCase(), url: String(l.url) })) : (s.orderPackages.find((x) => x.id === p.id)?.links || []) }));
        if (Array.isArray(body.orderAccounts)) next.orderAccounts = body.orderAccounts.map((a) => ({ id: String(a.id || 'acc' + uid(3)), name: String(a.name || 'Stripe'), enabled: a.enabled !== false }));
        if (Array.isArray(body.resellerPackages)) next.resellerPackages = body.resellerPackages.map((p) => ({ id: p.id || 'r' + uid(3), name: String(p.name || 'Package'), credits: Math.max(1, Number(p.credits) || 1), price: Number(p.price) || 0 }));
        if (Array.isArray(body.finance?.accounts)) next.finance.accounts = body.finance.accounts.map((a) => ({ id: a.id || 'a' + uid(3), name: String(a.name || 'Account'), currency: String(a.currency || 'USD').toUpperCase(), opening: Number(a.opening) || 0, color: a.color || '#7c5cff' }));
        await saveSettings(next);
        await log('settings', 'Settings updated: ' + Object.keys(body || {}).join(', '));
        return ok(next);
      }

      if (R('GET', '/api/admin/customers')) return ok((await getCustomers()).map((c) => view(c, s)));

      if (R('POST', '/api/admin/customers')) {
        const list = await getCustomers();
        const username = String(body.username || '').trim();
        if (username.length < 3) return err(400, 'Login username needs 3+ characters.');
        if (String(body.password || '').length < 4) return err(400, 'Login password needs 4+ characters.');
        const admin = await store.get('admin');
        if (list.some((x) => x.username.toLowerCase() === username.toLowerCase()) || (admin && admin.username.toLowerCase() === username.toLowerCase()) || (await getTeam()).some((x) => x.username.toLowerCase() === username.toLowerCase()))
          return err(400, 'This username is already used.');
        const plan = s.plans.find((p) => p.id === body.planId);
        const startAt = body.startAt ? new Date(body.startAt).getTime() : Date.now();
        const expiresAt = body.expiresAt ? new Date(body.expiresAt).getTime() + DAY - 1000 : startAt + (plan ? plan.days : 30) * DAY;
        const salt = uid(8);
        const c = {
          id: uid(8), name: String(body.name || username), phone: String(body.phone || ''), note: String(body.note || ''),
          email: cleanEmail(body.email) || String(body.email || '').trim().toLowerCase(), whatsapp: String(body.whatsapp || body.phone || ''), lang: ['en', 'fr', 'ar'].includes(body.lang) ? body.lang : 'en',
          username, salt, passwordHash: await hashPassword(body.password, salt), loginPassword: String(body.password),
          lineUsername: body.lineSame !== false ? username : String(body.lineUsername || ''),
          linePassword: body.lineSame !== false ? String(body.password) : String(body.linePassword || ''),
          lineId: String(body.lineId || ''), planId: plan ? plan.id : 'custom',
          connections: Number(body.connections) || (plan ? plan.connections : 1),
          startAt, expiresAt, status: 'active', createdAt: Date.now(), lastLogin: null,
          renewals: [{ at: Date.now(), type: 'new', planId: plan ? plan.id : 'custom', days: Math.round((expiresAt - startAt) / DAY), price: Number(body.price) || 0, credits: plan ? planCredits(plan) : Number(body.credits) || 0 }],
        };
        let panel = null;
        if (body.createOnPanel) {
          panel = await panelCall(s, 'create', panelVars(c, s));
          if (!panel.ok && !panel.skipped) return err(502, 'Panel: ' + panel.error);
          if (!panel.skipped) applyPanelCreds(s, c, panel.data);
        }
        const dup = findMatches(list, c);
        if (dup.length) await logAttempt({ kind: 'new customer', name: c.name, email: c.email, phone: c.phone, whatsapp: c.whatsapp, by: actorName, newUsername: c.username, matches: dup.slice(0, 5).map((m) => ({ id: m.c.id, username: m.c.username, name: m.c.name, why: m.why })) });
        list.push(c);
        await saveCustomers(list);
        await recordSale(s, c, { type: 'new', plan, days: c.renewals[0].days, credits: c.renewals[0].credits, amount: Number(body.price) || 0, accountId: body.accountId, by: actorName });
        let mail = null;
        if (body.sendEmail && c.email) { const m = accessEmail(s, c, String(body.password), 'sub', body.appUrl); mail = await sendEmail(s, c.email, m.subject, m.html); }
        await log('customer', `Created ${username} (${plan ? plan.name : 'custom'})${panel && !panel.skipped ? ' + panel line' : ''}${mail ? (mail.ok ? ' · email sent' : ' · email failed') : ''}`);
        return ok({ customer: view(c, s), panel, mail, duplicates: dup.map((m) => ({ username: m.c.username, name: m.c.name, why: m.why })) });
      }

      const m = path.match(/^\/api\/admin\/customers\/([\w-]+)(?:\/(\w+))?$/);
      if (m) {
        const list = await getCustomers();
        const c = list.find((x) => x.id === m[1]);
        if (!c) return err(404, 'Customer not found.');
        const sub = m[2];

        if (method === 'PUT' && !sub) {
          for (const k of ['name', 'phone', 'note', 'lineUsername', 'linePassword', 'lineId', 'planId', 'email', 'whatsapp', 'lang']) if (body[k] !== undefined) c[k] = String(body[k]);
          if (body.email !== undefined) c.email = cleanEmail(body.email) || String(body.email).trim();
          if (body.connections !== undefined) c.connections = Number(body.connections) || 1;
          if (body.username && body.username !== c.username) {
            const u = String(body.username).trim();
            if (list.some((x) => x !== c && x.username.toLowerCase() === u.toLowerCase())) return err(400, 'This username is already used.');
            c.username = u;
          }
          if (body.password) { c.salt = uid(8); c.passwordHash = await hashPassword(body.password, c.salt); c.loginPassword = String(body.password); }
          for (const k of ['orderNo', 'country', 'address', 'server', 'panel', 'device', 'paymentMethod']) if (body[k] !== undefined) c[k] = String(body[k]);
          if (body.expiresAt) c.expiresAt = new Date(body.expiresAt).getTime() + DAY - 1000;
          if (body.startAt) c.startAt = new Date(body.startAt).getTime();
          await saveCustomers(list);
          await log('customer', `Updated ${c.username}`);
          return ok(view(c, s));
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
        if (method === 'POST' && sub === 'renew') {
          const plan = s.plans.find((p) => p.id === body.planId);
          const days = Number(body.days) || (plan ? plan.days : 30);
          let panel = null;
          if (body.syncPanel) {
            panel = await panelCall(s, 'renew', panelVars(c, s, { days, package: plan && plan.package }));
            if (!panel.ok && !panel.skipped) return err(502, 'Panel: ' + panel.error);
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
          await recordSale(s, c, { type: wasTrial ? 'new' : 'renew', plan, days, credits, amount: Number(body.price) || 0, accountId: body.accountId, by: actorName });
          await log('renewal', `Renewed ${c.username} +${days} days (${Number(body.price) || 0} ${s.currency})`);
          return ok({ customer: view(c, s), panel });
        }
        if (method === 'POST' && sub === 'email') {
          const to = String(body.to || c.email || '').trim();
          if (!to) return err(400, 'This customer has no email address.');
          const m = accessEmail(s, c, c.linePassword, c.isTrial ? 'trial' : 'sub', body.appUrl);
          const r = await sendEmail(s, to, m.subject, m.html);
          await log('customer', `Emailed login to ${c.username} <${to}>${r.ok ? '' : ' — failed: ' + r.error}`);
          return r.ok ? ok(r) : err(502, r.error || 'Email failed');
        }
        if (method === 'GET' && sub === 'orderpreview') { const pk = s.orderPackages.find((p) => p.id === query.pkg) || s.orderPackages[0]; if (!pk) return err(400, 'No packages'); return ok(orderEmail(s, c, pk, query.appUrl)); }
        if (method === 'POST' && sub === 'order') {
          const pk = s.orderPackages.find((p) => p.id === body.pkg); if (!pk) return err(400, 'Choose a package.');
          const to = String(body.to || c.email || '').trim(); if (!to) return err(400, 'This customer has no email address.');
          const m = orderEmail(s, c, pk, body.appUrl); const r = await sendEmail(s, to, m.subject, m.html);
          if (r.ok) { c.orderSentAt = Date.now(); c.orderSentPkg = pk.id; c.orderSentAcc = m.payAcc; await saveCustomers(list); }
          await log('customer', `Package email "${pk.title}" to ${c.username} <${to}>${r.ok ? '' : ' — failed: ' + r.error}`);
          return r.ok ? ok(r) : err(502, r.error || 'Email failed');
        }
        if (method === 'POST' && sub === 'wamsg') { // WhatsApp message for this customer
          const type = WA_TPL[body.type] ? body.type : 'pay'; const lang = ['en', 'fr', 'ar'].includes(body.lang) ? body.lang : (WA_TPL.pay[c.lang] ? c.lang : 'en');
          const base = s.orderPackages.find((p) => p.id === body.pkg) || s.orderPackages[0] || { id: 'custom', title: 'Package', days: 30, devices: 1, price: 0, links: [] };
          const num = (x, d) => (x === '' || x == null || isNaN(Number(x)) ? d : Number(x));
          const pk = { ...base, title: String(body.title || '').trim() || base.title, price: num(body.price, base.price), days: Math.max(1, num(body.days, base.days)), devices: Math.max(1, num(body.devices, base.devices)) };
          const st = body.currency && ['EUR', 'USD', 'USDT', 'ALL'].includes(body.currency) ? { ...s, orderCurrency: body.currency } : s;
          const pl = /^https:\/\/\S+$/.test(String(body.link || '').trim()) ? { url: String(body.link).trim(), acc: '' } : pickPayLink(st, pk);
          const cur = st.orderCurrency === 'ALL' ? pl?.cur || 'EUR' : st.orderCurrency || 'EUR';
          const price = (CUR_SIGN[cur] || '') + Number(pk.price).toFixed(2) + (CUR_SIGN[cur] ? '' : ' ' + cur);
          const dns = String(c.dns || s.email.dns || s.player.serverUrl || '').replace(/\/+$/, '');
          const lu = c.lineUsername || c.username, lp = c.linePassword || c.loginPassword || '';
          const vars = { name: (c.name || '').split(' ')[0], fullname: c.name || '', app: s.branding.appName || 'IPTV', package: pk.title, price, days: pk.days, devices: pk.devices,
            link: pl?.url || s.email.website || '', username: lu, password: lp, dns, m3u: dns && lp ? `${dns}/get.php?username=${encodeURIComponent(lu)}&password=${encodeURIComponent(lp)}&type=m3u_plus&output=ts` : '',
            expires: new Date(c.expiresAt).toLocaleDateString(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long' }), appUrl: String(s.email.appUrl || body.appUrl || '').replace(/\/+$/, ''),
            website: s.email.website || '', order: c.orderNo || '',
            ends: c.expiresAt < Date.now() ? { en: 'ended on', fr: 's\'est terminé le', ar: 'انتهى في' }[lang] : { en: 'ends on', fr: 'se termine le', ar: 'ينتهي في' }[lang] };
          const tpl = String(body.template || s.waTemplates?.[type]?.[lang] || WA_TPL[type][lang]);
          const out = []; // a line whose value is empty (e.g. no DNS yet) is left out, with its label line
          for (const line of tpl.split('\n')) {
            const empty = [...line.matchAll(/\{(\w+)\}/g)].some((m) => m[1] in vars && String(vars[m[1]]) === '');
            if (empty) { if (/^\s*\{\w+\}\s*$/.test(line) && /:\s*$/.test(out.at(-1) || '')) out.pop(); continue; }
            out.push(line.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)));
          }
          const text = out.join('\n').replace(/\n{3,}/g, '\n\n');
          const phone = String(body.phone || c.whatsapp || c.phone || '').replace(/\D/g, '');
          if (body.log) { c.waSentAt = Date.now(); c.waSentType = type; if (type !== 'login') { c.orderSentPkg = pk.id; c.orderSentAcc = pl?.acc || ''; } await saveCustomers(list); await log('customer', `WhatsApp "${type}" message to ${c.username}${type !== 'login' ? ` (${pk.title}, ${price})` : ''}`); }
          return ok({ text, phone, lang, type, payAcc: pl?.acc || '', template: tpl, isDefault: !s.waTemplates?.[type]?.[lang] });
        }
        if (method === 'GET' && sub === 'renewalpreview') return ok(renewalEmail(s, c, query.appUrl));
        if (method === 'POST' && sub === 'renewal') {
          const to = String(body.to || c.email || '').trim();
          if (!to) return err(400, 'This customer has no email address.');
          const m = renewalEmail(s, c, body.appUrl);
          const r = await sendEmail(s, to, m.subject, m.html);
          if (r.ok) { c.renewalSentFor = c.expiresAt; c.renewalSentAt = Date.now(); await saveCustomers(list); const t = await sentToday(); await store.put(t.k, t.n + 1, 2 * 86400); }
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
          return ok({ customer: view(c, s), panel });
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
        return ok({ connected: true, accountId: acc?.id, currency: cur.toUpperCase(), available: sum(d.available), pending: sum(d.pending), otherCurrencies: [...other(d.available), ...other(d.pending)], app: appBal });
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
      // ----- stock / credits -----
      if (R('GET', '/api/admin/stock')) {
        const info = await stockInfo(s);
        let panel = null;
        if (s.reseller.enabled && query.panel === '1') { const r = await panelCall(s, 'credits', {}); panel = { ok: r.ok, credits: getPath(r.data, s.reseller.creditsPath), error: r.error }; }
        return ok({ ...info, panel, settings: s.stock });
      }
      if (R('POST', '/api/admin/stock')) {
        const credits = Math.round(Number(body.credits) || 0);
        if (!credits) return err(400, 'Enter the number of credits.');
        const acc = s.finance.accounts.find((a) => a.id === body.accountId);
        const cost = Math.abs(Number(body.cost) || 0);
        const currency = acc ? acc.currency : 'USD';
        const p = { id: uid(6), at: body.date ? new Date(body.date).getTime() + 12 * 3600000 : Date.now(), credits, cost, currency, costUsd: toUsd(cost, currency, s.finance.rates), accountId: acc ? acc.id : '', supplier: String(body.supplier || 'TVplus'), note: String(body.note || '') };
        const st = await getStock(); st.push(p); await store.put('stock', st);
        if (acc && cost) { const tx = await getTx(); tx.push({ id: uid(6), at: p.at, type: 'expense', accountId: acc.id, amount: cost, category: 'Credits purchase', note: `${credits} credits · ${p.supplier}`, stockId: p.id }); await store.put('tx', tx); }
        await log('stock', `Bought ${credits} credits for ${cost} ${currency}`);
        return ok(p);
      }
      const stm = path.match(/^\/api\/admin\/stock\/(\w+)$/);
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
        const batch = list.filter((c) => want.has(c.id) && cleanEmail(c.email) && !c.unsub).map((c) => { const p = pick(c); return { c, p, m: orderEmail(s, c, p, body.appUrl) }; });
        if (!batch.length) return ok({ sent: 0 });
        const r = await sendBatch(s, batch.map(({ c, m }) => ({ to: c.email, subject: m.subject, html: m.html })));
        if (!r.ok) return err(502, r.error);
        const now = Date.now(); for (const { c, p, m } of batch) { c.orderSentAt = now; c.orderSentPkg = p.id; c.orderSentAcc = m.payAcc; }
        await saveCustomers(list);
        await log('customer', `Package emails sent to ${batch.length} customers (${body.pkg === 'random' ? 'random packages' : batch[0].p.title})`);
        return ok({ sent: batch.length });
      }
      if (R('GET', '/api/admin/newsletter')) { // groups and saved draft
        const list = await getCustomers(); const w = Number(s.userDashboard.expiryWarningDays) || 7; const camp = (await store.get('newsletter')) || null;
        const groups = Object.fromEntries(['all', 'paying', 'active', 'expiring', 'expired', 'trial'].map((g) => { const t = nlGroup(list, g, w); return [g, { total: t.length, left: camp?.id ? t.filter((c) => c.nlLast !== camp.id).length : t.length }]; }));
        return ok({ groups, camp, unsubscribed: list.filter((c) => c.unsub).length });
      }
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
      if (R('POST', '/api/admin/order/custom')) { // manual email: any address, own details; body.preview = only build it
        const base = s.orderPackages.find((p) => p.id === body.pkg) || s.orderPackages[0] || { id: 'custom', title: 'Package', days: 30, devices: 1, price: 0, links: [] };
        const num = (x, d) => (x === '' || x == null || isNaN(Number(x)) ? d : Number(x));
        const pk = { ...base, title: String(body.title || '').trim() || base.title, price: num(body.price, base.price), days: Math.max(1, num(body.days, base.days)), devices: Math.max(1, num(body.devices, base.devices)), badge: body.badge != null ? String(body.badge) : base.badge };
        const st = body.currency && ['EUR', 'USD', 'USDT', 'ALL'].includes(body.currency) ? { ...s, orderCurrency: body.currency } : s;
        const fixed = /^https:\/\/\S+$/.test(String(body.link || '').trim()) ? { url: String(body.link).trim(), acc: '' } : null;
        const who = { name: String(body.name || '').trim(), lang: ['en', 'fr', 'ar'].includes(body.lang) ? body.lang : 'en', note: String(body.note || '').trim().slice(0, 2000) };
        const m = orderEmail(st, who, pk, body.appUrl, fixed || undefined);
        if (body.subject) m.subject = String(body.subject).slice(0, 200);
        if (body.preview) return ok(m);
        const to = cleanEmail(body.to); if (!to) return err(400, 'Enter a valid email address.');
        const r = await sendEmail(s, to, m.subject, m.html);
        await log('customer', `Custom package email "${pk.title}" to <${to}>${r.ok ? '' : ' — failed: ' + r.error}`);
        if (body.saveCustomer && r.ok) { const list = await getCustomers(); const c = list.find((x) => cleanEmail(x.email) === to); if (c) { c.orderSentAt = Date.now(); c.orderSentPkg = base.id; c.orderSentAcc = m.payAcc; await saveCustomers(list); } }
        return r.ok ? ok({ ...r, payAcc: m.payAcc }) : err(502, r.error || 'Email failed');
      }
      if (R('POST', '/api/admin/stripe/paylinks')) { // creates a Stripe Payment Link for every package without one
        const key = s.finance.stripeKey; if (!key) return err(400, 'Add your Stripe secret key in Finance first.');
        const st = async (path, form) => { const r = await fetchFn('https://api.stripe.com/v1/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }); const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || 'Stripe error ' + r.status); return d; };
        const cur = (s.orderCurrency === 'USDT' ? 'USD' : s.orderCurrency === 'ALL' ? 'EUR' : s.orderCurrency || 'EUR').toLowerCase(); let made = 0;
        try {
          for (const p of s.orderPackages) {
            if (p.link || (p.links || []).length) continue;
            const price = await st('prices', { currency: cur, unit_amount: String(Math.round(p.price * 100)), 'product_data[name]': `${s.branding.appName || 'IPTV'} — ${p.title}` });
            const pl = await st('payment_links', { 'line_items[0][price]': price.id, 'line_items[0][quantity]': '1', 'phone_number_collection[enabled]': 'true', 'metadata[package]': p.id });
            p.link = pl.url; made++;
          }
        } catch (e) { if (made) await saveSettings(s); return err(502, `Stripe: ${e.message}${made ? ` (${made} links were created)` : ''}`); }
        await saveSettings(s); await log('settings', `Created ${made} Stripe payment links`);
        return ok({ made, packages: s.orderPackages });
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
            members: members.map((c) => view(c, s)).sort((a, b) => (b.createdAt || b.startAt) - (a.createdAt || a.startAt)) });
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
        const r = await sendBatch(s, batch.map((c) => ({ to: c.email, ...renewalEmail(s, c, body.appUrl) })));
        if (!r.ok) return err(502, r.error);
        const now = Date.now(); batch.forEach((c) => { c.renewalSentFor = c.expiresAt; c.renewalSentAt = now; });
        await saveCustomers(list); await store.put(t.k, t.n + batch.length, 2 * 86400);
        await log('customer', `Renewal emails sent to ${batch.length} customers`);
        return ok({ sent: batch.length, waiting: renewalTargets(list).length, limitReached: !body.all && t.n + batch.length >= (Number(s.renewalOffer.dailyLimit) || 90) });
      }

      // ----- reseller packages -----
      if (R('POST', '/api/admin/reseller-sale')) {
        const pk = s.resellerPackages.find((p) => p.id === body.packageId);
        if (!pk) return err(400, 'Choose a package.');
        const name = String(body.name || '').trim();
        if (!name) return err(400, 'Enter the reseller name.');
        const buyer = { id: 'r-' + uid(5), name, username: String(body.email || body.phone || name) };
        const sale = await recordSale(s, buyer, { type: 'reseller', plan: { id: pk.id, name: `Reseller ${pk.name} (${pk.credits} credits)` }, days: 0, credits: pk.credits, amount: body.amount === '' || body.amount == null ? pk.price : Number(body.amount), accountId: body.accountId, by: actorName });
        const sales = await getSales(); const x = sales.find((y) => y.id === sale.id);
        Object.assign(x, { planName: `Reseller ${pk.name} (${pk.credits} credits)`, email: String(body.email || ''), phone: String(body.phone || ''), note: String(body.note || '') });
        await store.put('sales', sales);
        await log('renewal', `Sold reseller package ${pk.name} (${pk.credits} credits) to ${name}`);
        return ok(x);
      }
      if (R('GET', '/api/admin/reseller-sales')) return ok((await getSales()).filter((x) => x.type === 'reseller').sort((a, b) => b.at - a.at));

      if (R('GET', '/api/admin/stats')) {
        const cs = (await getCustomers()).map((c) => view(c, s));
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

      if (R('POST', '/api/admin/panel/test')) {
        if (body.target === 'reseller') {
          const r = await panelCall({ ...s, reseller: { ...s.reseller, enabled: true } }, 'credits', {});
          return ok({ ok: r.ok, status: r.status, data: r.data, error: r.error, credits: getPath(r.data, s.reseller.creditsPath) });
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
        const r = await panelCall(s, 'credits', {});
        return ok({ enabled: true, ok: r.ok, credits: getPath(r.data, s.reseller.creditsPath), error: r.error });
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
      if (R('GET', '/api/admin/backup')) return ok({ version: 2, exportedAt: Date.now(), settings: s, customers: await getCustomers(), sales: await getSales(), tx: await getTx(), stock: await getStock() });
      if (R('POST', '/api/admin/restore')) {
        if (!isObj(body.settings) || !Array.isArray(body.customers)) return err(400, 'This is not a valid backup file.');
        const next = deepMerge(DEFAULT_SETTINGS(), body.settings);
        next.security.proxySecret = s.security.proxySecret;
        await saveSettings(next);
        await saveCustomers(body.customers);
        if (Array.isArray(body.sales)) await store.put('sales', body.sales); else await store.del('sales');
        if (Array.isArray(body.tx)) await store.put('tx', body.tx);
        if (Array.isArray(body.stock)) await store.put('stock', body.stock);
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
    const s = await refreshRates(await getSettings(), false);
    const out = { reminders: 0, alert: false };
    if (s.email.lowCreditsAlerts && s.email.adminEmail) {
      const st = await stockInfo(s);
      let panelCredits = null;
      if (s.reseller.enabled) { const r = await panelCall(s, 'credits', {}); panelCredits = r.ok ? Number(getPath(r.data, s.reseller.creditsPath)) : null; }
      const lim = Number(s.stock.lowCreditsAlert) || 0;
      const lowPanel = panelCredits != null && !isNaN(panelCredits) && panelCredits <= lim;
      if (st.low || lowPanel) {
        await sendEmail(s, s.email.adminEmail, `⚠️ ${s.branding.appName}: credits are low`, mailHtml(s, 'en', [['Panel credits (API)', panelCredits ?? '—'], ['Credits in stock', st.available], ['Alert level', lim]], 'Your credits are running low. Buy more from your supplier to keep creating lines.', 'Admin'));
        out.alert = true;
      }
    }
    if (s.email.expiryReminders) {
      const list = await getCustomers(); let changed = false;
      const days = Number(s.email.reminderDays) || 3;
      for (const c of list) {
        const left = Math.ceil((c.expiresAt - Date.now()) / DAYMS);
        if (c.email && !c.isTrial && c.status !== 'disabled' && left > 0 && left <= days && c.remindedFor !== c.expiresAt) {
          const lang = c.lang || 'en';
          const date = new Date(c.expiresAt).toLocaleDateString(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium' });
          const r = await sendEmail(s, c.email, mt(lang, 'expirySubject', { days: left }), mailHtml(s, lang, [[mt(lang, 'user'), c.username], [mt(lang, 'expires'), date]], mt(lang, 'expiryBody', { date }), c.name));
          if (r.ok) { c.remindedFor = c.expiresAt; changed = true; out.reminders++; }
        }
      }
      if (changed) await saveCustomers(list);
    }
    if (s.renewalOffer.auto && s.email.resendKey) {
      const list = await getCustomers(); const t = await sentToday();
      const left = Math.max(0, (Number(s.renewalOffer.dailyLimit) || 90) - t.n);
      const batch = renewalTargets(list, Number(s.renewalOffer.autoDays) || 3).slice(0, Math.min(50, left));
      if (batch.length) {
        const r = await sendBatch(s, batch.map((c) => ({ to: c.email, ...renewalEmail(s, c, s.email.appUrl) })));
        if (r.ok) { const now = Date.now(); batch.forEach((c) => { c.renewalSentFor = c.expiresAt; c.renewalSentAt = now; }); await saveCustomers(list); await store.put(t.k, t.n + batch.length, 2 * 86400); out.reminders += batch.length; }
      }
    }
    if (out.alert || out.reminders) await log('daily', `Daily check: ${out.reminders} reminder(s)${out.alert ? ', low-credit alert sent' : ''}`);
    return out;
  }

  return { handle, getSettings, daily };
}
