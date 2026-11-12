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
    appName: 'My IPTV',
    tagline: 'Live TV · Movies · Series',
    logoUrl: '',
    primary: '#7c5cff',
    accent: '#22d3ee',
    background: '#0b0d17',
    loginTitle: 'Welcome back',
    loginSubtitle: 'Sign in with the login details you received.',
    loginBgUrl: '',
    supportLabel: 'Contact support',
    supportUrl: '',
    footerText: '',
  },
  userDashboard: {
    live: true, movies: true, series: true, epg: true, search: true, favorites: true,
    showSubscription: true, allowPasswordChange: true, expiryWarningDays: 7,
    announcement: '', announcementType: 'info',
    maintenance: false, maintenanceMessage: 'We are updating the service. Please come back soon.',
  },
  player: { serverUrl: '', useProxy: true },
  reseller: {
    enabled: false, autoSync: true,
    baseUrl: '', apiKey: '', username: '', password: '',
    idPath: 'id', creditsPath: 'credits',
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
  trial: { enabled: true, hours: 24, credits: 0, package: '', connections: 1, showCredentialsOnScreen: false },
  email: { resendKey: '', from: '', adminEmail: '', appUrl: '', expiryReminders: true, reminderDays: 3, lowCreditAlerts: true },
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
    ],
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
    if (!s.security.proxySecret) { s.security.proxySecret = uid(24); await store.put('settings', s); }
    sCache = s; sAt = Date.now();
    return s;
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
  async function recordSale(s, c, { type, plan, days, credits, amount, accountId, at }) {
    if (Number(amount) > 0) s = await refreshRates(s, false);
    const acc = s.finance.accounts.find((a) => a.id === accountId);
    const currency = acc ? acc.currency : s.currency;
    const amountUsd = toUsd(amount, currency, s.finance.rates);
    const costUsd = credits * (await creditCostUsd(s));
    const sale = { id: uid(6), at: at || Date.now(), customerId: c.id, username: c.username, name: c.name, type, planId: plan ? plan.id : (type === 'trial' ? 'trial' : 'custom'), planName: type === 'trial' ? 'Trial' : plan ? plan.name : 'Custom', days, credits, amount: Number(amount) || 0, currency, amountUsd, costUsd, accountId: acc ? acc.id : '' };
    const sales = await getSales(); sales.push(sale); await store.put('sales', sales);
    if (acc && Number(amount) > 0) {
      const tx = await getTx();
      tx.push({ id: uid(6), at: sale.at, type: 'income', accountId: acc.id, amount: Number(amount), category: 'Sale', note: `${sale.planName} · ${c.name} (${c.username})`, saleId: sale.id });
      await store.put('tx', tx);
    }
    return sale;
  }
  async function sendEmail(s, to, subject, html) {
    const e = s.email;
    if (!e.resendKey || !e.from || !to) return { ok: false, skipped: true, error: 'Email is not set up (Resend key / sender missing).' };
    try {
      const res = await fetchFn('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + e.resendKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: e.from, to: [to], subject, html }) });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, id: data.id } : { ok: false, error: data.message || 'Resend error ' + res.status };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  const withUrl = (s, u) => (s.email.appUrl || !u ? s : { ...s, email: { ...s.email, appUrl: String(u) } });
  function loginMail(s, c, password, kind) {
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
  async function stockInfo(s) {
    const st = await getStock(); const sales = await getSales();
    const purchased = st.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    const used = sales.reduce((a, x) => a + (Number(x.credits) || 0), 0);
    return { purchased, used, available: purchased - used, avgCostUsd: await creditCostUsd(s), low: purchased - used <= (Number(s.stock.lowCreditsAlert) || 0), purchases: st.slice().sort((a, b) => b.at - a.at) };
  }
  async function log(type, msg) {
    const l = (await store.get('log')) || [];
    l.unshift({ at: Date.now(), type, msg });
    await store.put('log', l.slice(0, 300));
  }
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
    const res = await fetchFn(`${server}/player_api.php?${q}`, { headers: { 'User-Agent': 'Mozilla/5.0 (IPTV Player)' } });
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw httpErr(502, 'The streaming server returned an invalid response.'); }
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
    try {
      const s = await getSettings();
      const R = (m, p) => method === m && path === p;

      // ---------- public ----------
      if (R('GET', '/api/config')) {
        await getAdmin();
        return ok({ branding: s.branding, currency: s.currency, setupRequired: false, mode, trial: { enabled: !!s.trial.enabled, hours: s.trial.hours } });
      }
      if (R('POST', '/api/trial')) {
        if (!s.trial.enabled) return err(403, 'trial_off');
        const name = String(body.name || '').trim().slice(0, 80);
        const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
        const phone = String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
        const whatsapp = String(body.whatsapp || phone).replace(/[^\d+]/g, '').slice(0, 20);
        if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.replace(/\D/g, '').length < 8) return err(400, 'trial_invalid');
        const list = await getCustomers();
        const digits = (x) => String(x || '').replace(/\D/g, '').slice(-9);
        if (list.some((c) => (c.email && c.email === email) || (c.phone && digits(c.phone) === digits(phone)) || (c.whatsapp && digits(c.whatsapp) === digits(whatsapp)))) return err(409, 'trial_used');
        if (body.ip) { // max 3 trials per network per day
          const k = 'trialip:' + body.ip;
          const n = (await store.get(k)) || 0;
          if (n >= 3) return err(429, 'trial_ip');
          await store.put(k, n + 1, 86400);
        }
        const rnd = (n, ch) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => ch[x % ch.length]).join('');
        let username; do { username = 't' + rnd(6, '0123456789'); } while (list.some((c) => c.username === username));
        const password = rnd(8, 'abcdefghjkmnpqrstuvwxyz23456789');
        const salt = uid(8);
        const now = Date.now();
        const c = { id: uid(8), name, email, phone, whatsapp, lang: ['en', 'fr', 'ar'].includes(body.lang) ? body.lang : 'en', note: 'Free trial', username, salt, passwordHash: await hashPassword(password, salt), lineUsername: username, linePassword: password, lineId: '', planId: 'trial', isTrial: true, connections: Number(s.trial.connections) || 1, startAt: now, expiresAt: now + (Number(s.trial.hours) || 24) * 3600000, status: 'active', createdAt: now, lastLogin: null, renewals: [{ at: now, type: 'trial', planId: 'trial', days: 1, credits: Number(s.trial.credits) || 0, price: 0 }] };
        if (s.reseller.enabled) {
          const panel = await panelCall(s, 'trial', { username, password, line_id: '', package: s.trial.package, connections: c.connections, days: 1, months: 1, hours: s.trial.hours, name, phone, note: 'trial' });
          if (!panel.ok && !panel.skipped) { await log('trial', `Trial for ${email} failed on panel: ${panel.error}`); return err(502, 'trial_panel'); }
          const id = getPath(panel.data, s.reseller.idPath); if (id != null && id !== '') c.lineId = String(id);
        }
        list.push(c); await saveCustomers(list);
        await recordSale(s, c, { type: 'trial', plan: null, days: 1, credits: Number(s.trial.credits) || 0, amount: 0, accountId: '' });
        const m = loginMail(withUrl(s, body.appUrl), c, password, 'trial');
        const sent = await sendEmail(s, email, m.subject, m.html);
        await log('trial', `Free trial ${username} for ${name} <${email}>${sent.ok ? ' · email sent' : ' · email NOT sent: ' + (sent.error || '')}`);
        const showOnScreen = !sent.ok || s.trial.showCredentialsOnScreen;
        return ok({ ok: true, emailed: !!sent.ok, hours: s.trial.hours, ...(showOnScreen ? { username, password } : {}) });
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

        if (R('GET', '/api/me')) {
          const { lineUsername, linePassword, ...pub } = v;
          return ok({
            user: pub, dashboard: s.userDashboard, branding: s.branding, currency: s.currency,
            stream: canWatch && s.player.serverUrl ? {
              server: trimSlash(s.player.serverUrl), u: lineUsername, p: linePassword,
              useProxy: !!s.player.useProxy, proxyToken: await makeProxyToken(s.security.proxySecret, c.id, 12),
            } : null,
          });
        }
        if (R('GET', '/api/xtream')) {
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
          c.salt = uid(8); c.passwordHash = await hashPassword(body.next, c.salt);
          await saveCustomers(list);
          await log('customer', `${c.username} changed their password`);
          return ok({ ok: true });
        }
        return err(404, 'Not found');
      }

      // ---------- admin ----------
      if (ses.role !== 'admin' || !path.startsWith('/api/admin/')) return err(403, 'Not allowed.');

      if (R('GET', '/api/admin/settings')) return ok(s);
      if (R('PUT', '/api/admin/settings')) {
        const next = deepMerge(s, body || {});
        next.security.proxySecret = s.security.proxySecret;
        if (Array.isArray(body.plans)) next.plans = body.plans.map((p) => ({
          id: p.id || 'p' + uid(3), name: String(p.name || 'Plan'), days: Math.max(1, Number(p.days) || 30),
          price: Number(p.price) || 0, connections: Math.max(1, Number(p.connections) || 1), package: String(p.package || ''),
          credits: p.credits === '' || p.credits == null ? Math.max(1, Math.round((Number(p.days) || 30) / 30)) : Number(p.credits),
        }));
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
        if (list.some((x) => x.username.toLowerCase() === username.toLowerCase()) || (admin && admin.username.toLowerCase() === username.toLowerCase()))
          return err(400, 'This username is already used.');
        const plan = s.plans.find((p) => p.id === body.planId);
        const startAt = body.startAt ? new Date(body.startAt).getTime() : Date.now();
        const expiresAt = body.expiresAt ? new Date(body.expiresAt).getTime() + DAY - 1000 : startAt + (plan ? plan.days : 30) * DAY;
        const salt = uid(8);
        const c = {
          id: uid(8), name: String(body.name || username), phone: String(body.phone || ''), note: String(body.note || ''),
          email: String(body.email || '').trim().toLowerCase(), whatsapp: String(body.whatsapp || body.phone || ''), lang: ['en', 'fr', 'ar'].includes(body.lang) ? body.lang : 'en',
          username, salt, passwordHash: await hashPassword(body.password, salt),
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
          const id = getPath(panel.data, s.reseller.idPath);
          if (id != null && id !== '') c.lineId = String(id);
        }
        list.push(c);
        await saveCustomers(list);
        await recordSale(s, c, { type: 'new', plan, days: c.renewals[0].days, credits: c.renewals[0].credits, amount: Number(body.price) || 0, accountId: body.accountId });
        let mail = null;
        if (body.sendEmail && c.email) { const m = loginMail(withUrl(s, body.appUrl), c, String(body.password), 'welcome'); mail = await sendEmail(s, c.email, m.subject, m.html); }
        await log('customer', `Created ${username} (${plan ? plan.name : 'custom'})${panel && !panel.skipped ? ' + panel line' : ''}${mail ? (mail.ok ? ' · email sent' : ' · email failed') : ''}`);
        return ok({ customer: view(c, s), panel, mail });
      }

      const m = path.match(/^\/api\/admin\/customers\/([\w-]+)(?:\/(\w+))?$/);
      if (m) {
        const list = await getCustomers();
        const c = list.find((x) => x.id === m[1]);
        if (!c) return err(404, 'Customer not found.');
        const sub = m[2];

        if (method === 'PUT' && !sub) {
          for (const k of ['name', 'phone', 'note', 'lineUsername', 'linePassword', 'lineId', 'planId', 'email', 'whatsapp', 'lang']) if (body[k] !== undefined) c[k] = String(body[k]);
          if (body.connections !== undefined) c.connections = Number(body.connections) || 1;
          if (body.username && body.username !== c.username) {
            const u = String(body.username).trim();
            if (list.some((x) => x !== c && x.username.toLowerCase() === u.toLowerCase())) return err(400, 'This username is already used.');
            c.username = u;
          }
          if (body.password) { c.salt = uid(8); c.passwordHash = await hashPassword(body.password, c.salt); }
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
          await recordSale(s, c, { type: wasTrial ? 'new' : 'renew', plan, days, credits, amount: Number(body.price) || 0, accountId: body.accountId });
          await log('renewal', `Renewed ${c.username} +${days} days (${Number(body.price) || 0} ${s.currency})`);
          return ok({ customer: view(c, s), panel });
        }
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
        const t = { id: uid(6), at: body.date ? new Date(body.date).getTime() + 12 * 3600000 : Date.now(), type, accountId: acc.id, amount, category: String(body.category || (type === 'transfer' ? 'Transfer' : 'Other')), note: String(body.note || '').slice(0, 200) };
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
        const count = (st) => cs.filter((c) => c.state === st).length;
        return ok({
          total: cs.length, active: count('active'), expiring: count('expiring'), expired: count('expired'), disabled: count('disabled'),
          revenueTotal: Math.round(total * 100) / 100, revenueMonth: byMonth[months[5]], byMonth, renewalsCount, trials: cs.filter((c) => c.isTrial).length,
          stock: { available: stock.available, low: stock.low }, lowCreditsAlert: s.stock.lowCreditsAlert, madRate: s.finance.rates.MAD,
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
          const res = await fetchFn(`${server}/player_api.php?${q}`, { headers: { 'User-Agent': 'Mozilla/5.0 (IPTV Player)' } });
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
      if (R('GET', '/api/admin/me')) { const a = await getAdmin(); return ok({ username: a.username, isDefault: !!a.isDefault, mode }); }
      if (R('GET', '/api/admin/log')) return ok((await store.get('log')) || []);
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
    if (out.alert || out.reminders) await log('daily', `Daily check: ${out.reminders} reminder(s)${out.alert ? ', low-credit alert sent' : ''}`);
    return out;
  }

  return { handle, getSettings, daily };
}
