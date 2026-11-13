import { createBackend } from './core.js';
import { loadLogos, logosReady, findLogo } from './logos.js';
import { siteHtml } from './site.js';
import { ic } from './icons.js';
import { parseM3U, m3uAnswer } from './m3u.js';
import { t, tErr, setLang, getLang, detectLang, locale, LANGS } from './i18n.js';

// ---------------- helpers ----------------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (x) => (x ? new Date(x).toLocaleDateString(isAdminUI() ? undefined : locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDT = (x) => (x ? new Date(x).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const usd = (n) => `${Number(n) < 0 ? '−' : ''}$${Math.abs(Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const mad = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} MAD`;
const num = (n, cur) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${cur || ''}`;
const isoDay = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const money = (n) => `${Number(n || 0).toLocaleString()} ${state.config?.currency || ''}`;
const initials = (n) => String(n || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const b64 = (s) => { try { return decodeURIComponent(escape(atob(s))); } catch { return s || ''; } };

function toast(msg, isErr) {
  const d = document.createElement('div');
  d.textContent = msg; if (isErr) d.className = 'err';
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), 3200);
}
function modal(title, html, { wide = false, onClose } = {}) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal ${wide ? 'wide' : ''}"><div class="modal-head"><h3>${title}</h3><button class="x" data-act="close-modal">×</button></div><div class="modal-body">${html}</div></div></div>`;
  root._onClose = onClose;
  return $('.modal-body', root);
}
function closeModal() {
  const root = $('#modal-root');
  if (root._onClose) { try { root._onClose(); } catch {} root._onClose = null; }
  root.innerHTML = '';
}
const field = (label, name, value, o = {}) => `<label class="field"><span>${label}</span>${
  o.type === 'textarea' ? `<textarea name="${name}" rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}" ${o.attrs || ''}>${esc(value)}</textarea>`
  : o.type === 'select' ? `<select name="${name}" ${o.attrs || ''}>${o.options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
  : `<input name="${name}" type="${o.type || 'text'}" value="${esc(value)}" placeholder="${esc(o.ph || '')}" ${o.attrs || ''}>`
}${o.help ? `<small>${o.help}</small>` : ''}</label>`;
const toggle = (label, name, checked, help = '') => `<label class="toggle"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><i></i><span>${label}${help ? `<small>${help}</small>` : ''}</span></label>`;
function formToObj(form) {
  const out = {};
  form.querySelectorAll('[name]').forEach((el) => {
    if ('skip' in el.dataset) return;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
    const parts = el.name.split('.');
    let o = out;
    parts.slice(0, -1).forEach((p) => { o = o[p] ??= {}; });
    o[parts.at(-1)] = v;
  });
  return out;
}
const pill = (st) => `<span class="pill st-${st}">${isAdminUI() ? st : t('st_' + st)}</span>`;
function progress(c) {
  const pct = Math.max(0, Math.min(100, (c.daysLeft / (c.planDays || 30)) * 100));
  return `<div class="prog ${c.state === 'expired' ? 'bad' : c.state === 'expiring' ? 'warn' : ''}"><i style="width:${pct}%"></i></div>`;
}
const brandHtml = (b, sub = true) => `<div class="brand">${b.logoUrl ? `<img class="brand-logo" src="${esc(b.logoUrl)}" alt="">` : `<div class="logo-mark">${esc(initials(b.appName))}</div>`}<div><b class="brand-name">${esc(b.appName)}</b>${sub ? `<span>${esc(b.tagline)}</span>` : ''}</div></div>`;
const brandHero = (b) => `<div class="hero">${b.logoUrl ? `<div class="hero-logo"><i></i><img src="${esc(b.logoUrl)}" alt=""></div>` : `<div class="logo-mark big">${esc(initials(b.appName))}</div>`}<div class="brand-name xl">${esc(b.appName)}</div><div class="muted small hero-tag">${esc(b.tagline)}</div></div>`;

// ---------------- state & API ----------------
const isAdminUI = () => !!state.token && (state.role === 'admin' || state.role === 'staff');
const can = (p) => { const me = state.admin.me; if (!p) return true; if (!me) return false; if (me.role === 'owner') return true; return p !== 'owner' && me.perms.includes(p); };
const state = {
  mode: 'server', config: null, local: null,
  token: localStorage.getItem('tvp_token'), role: localStorage.getItem('tvp_role'),
  admin: { tab: 'overview', customers: [], settings: null, filter: 'all', q: '', subDays: '30' },
  user: { tab: 'home', me: null, cache: {}, cat: {}, q: '', limit: 120 },
};

function localStore() {
  const P = 'tvp_db_';
  return {
    get: async (k) => { const v = localStorage.getItem(P + k); if (!v) return null; const o = JSON.parse(v); if (o.e && o.e < Date.now()) { localStorage.removeItem(P + k); return null; } return o.v; },
    put: async (k, v, ttl) => localStorage.setItem(P + k, JSON.stringify({ v, e: ttl ? Date.now() + ttl * 1000 : 0 })),
    del: async (k) => localStorage.removeItem(P + k),
  };
}

async function api(method, path, body) {
  let status, json;
  if (state.mode === 'demo') {
    const u = new URL(path, location.href);
    const r = await state.local.handle({ method, path: u.pathname.replace(/^.*(\/api\/)/, '/api/'), query: Object.fromEntries(u.searchParams), body: body || {}, token: state.token });
    status = r.status; json = r.json;
  } else {
    const res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(state.token ? { authorization: 'Bearer ' + state.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    status = res.status; json = await res.json().catch(() => ({ error: 'Unexpected server response' }));
  }
  if (status === 409 && path.includes('/api/xtream')) { location.reload(); }
  if (status >= 400) {
    if (status === 401 && state.token && !path.includes('/login')) { setSession(null); route(); }
    throw Object.assign(new Error(json.error || 'Error'), { status, data: json });
  }
  return json;
}
function setSession(token, role) {
  state.token = token; state.role = role;
  if (token) { localStorage.setItem('tvp_token', token); localStorage.setItem('tvp_role', role); }
  else { localStorage.removeItem('tvp_token'); localStorage.removeItem('tvp_role'); }
  state.user = { tab: 'home', me: null, cache: {}, cat: {}, q: '', limit: 120 };
  state.admin.me = null; state.admin.tab = 'overview';
}

function applyBranding(b) {
  const r = document.documentElement.style;
  r.setProperty('--b-primary', b.primary || '#7C4DFF');
  r.setProperty('--b-accent', b.accent || '#19D5B1');
  r.setProperty('--brand-bg', b.background || '#07081A');
  document.title = b.appName || 'IPTV';
  applyTheme();
}

// ---------------- day / night theme ----------------
// Auto (default): day theme 06:00–18:00 in the device's own time zone, night theme otherwise.
const themeMode = () => localStorage.getItem('tvp_theme') || 'auto';
const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
function currentTheme() {
  const m = themeMode();
  if (m === 'light' || m === 'dark') return m;
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? 'light' : 'dark';
}
function applyTheme() {
  const th = currentTheme();
  document.documentElement.dataset.theme = th;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', th === 'light' ? '#F4F5FA' : '#07081A');
  document.querySelectorAll('[data-act=theme]').forEach((b) => { b.textContent = themeMode() === 'auto' ? '🌗' : th === 'light' ? '☀️' : '🌙'; b.title = themeLabel(); });
}
const themeLabel = () => { const m = themeMode(); return m === 'auto' ? `Auto (${currentTheme() === 'light' ? 'day' : 'night'} · ${tzName()})` : m === 'light' ? 'Day' : 'Night'; };
setInterval(applyTheme, 5 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) applyTheme(); });

async function boot() {
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('unsub')) {
    $('#app').innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    let msg;
    try { const r = await fetch('/api/unsub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: hp.get('unsub') }) }); const d = await r.json(); msg = r.ok ? { en: `You are unsubscribed. You will not get promotion emails from ${d.app} any more.`, fr: `Vous êtes désabonné. Vous ne recevrez plus d'emails promotionnels de ${d.app}.`, ar: `تم إلغاء اشتراكك. لن تصلك رسائل العروض من ${d.app} بعد الآن.` } : null; } catch {}
    const l = (navigator.language || 'en').slice(0, 2);
    $('#app').innerHTML = `<div class="block-screen"><div class="ic">${msg ? '✅' : '⚠️'}</div><p>${msg ? msg[l] || msg.en : 'This link is not valid.'}</p></div>`;
    return;
  }
  // The browser upgraded our http:// switch back to https:// — remember it and never loop.
  if (hp.get('reset')) { state.resetToken = hp.get('reset'); state.showLogin = true; history.replaceState(null, '', location.pathname); }
  if (location.hash === '#login') state.showLogin = true;
  if (hp.get('s') && location.protocol === 'https:') localStorage.setItem('tvp_nohttp', '1');
  if (hp.get('s')) { setSession(hp.get('s'), 'user'); if (hp.get('tab')) state.user.tab = hp.get('tab'); if (hp.get('lang')) setLang(hp.get('lang'), true); history.replaceState(null, '', location.pathname); }
  setLang(detectLang());
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('no server');
    state.config = await r.json();
    state.mode = 'server';
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch {
    state.mode = 'demo';
    state.local = createBackend({ store: localStore(), fetchFn: (u, i) => fetch(u, i), mode: 'demo' });
    state.config = await api('GET', '/api/config');
  }
  applyBranding(state.config.branding);
  route();
  if (state.resetToken && !state.token) showReset();
}

function route() {
  closeModal(); setTimeout(applyTheme);
  if (isAdminUI() && location.protocol === 'http:' && !/localhost|127\.0\.0\.1/.test(location.hostname)) { location.replace('https://' + location.host + location.pathname); return; }
  if (isAdminUI()) { document.documentElement.dir = 'ltr'; document.documentElement.lang = 'en'; }
  else setLang(getLang());
  if (state.config.setupRequired) return renderSetup();
  if (!state.token) return wantsSite() ? renderSite() : renderLogin();
  if (isAdminUI()) return renderAdmin();
  return renderUser();
}
async function refreshConfig() { state.config = await api('GET', '/api/config'); applyBranding(state.config.branding); }

// ---------------- login & setup ----------------
// Default texts follow the customer's language; texts you customise stay as you wrote them.
function localBrand(b) {
  if (isAdminUI()) return b;
  const d = { loginTitle: ['Welcome back', 'welcome'], loginSubtitle: ['Sign in with the login details you received.', 'loginSub'], tagline: ['Live TV · Movies · Series', 'tagline'] };
  const o = { ...b };
  for (const [k, [en, key]] of Object.entries(d)) if (!o[k] || o[k] === en) o[k] = t(key);
  return o;
}
function loginCard(b, { preview = false, error = '' } = {}) {
  if (!preview) b = localBrand(b);
  return `<div class="login-wrap" style="${b.loginBgUrl ? `background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.6)),url('${esc(b.loginBgUrl)}')` : ''}">
    <div class="login-card">
      ${brandHero(b)}
      <h2>${esc(b.loginTitle)}</h2>
      <p class="muted" style="margin-top:0">${esc(b.loginSubtitle)}</p>
      ${error ? `<div class="err-box">${esc(error)}</div>` : ''}
      <form ${preview ? '' : 'data-form="login"'}>
        ${field(t('username'), 'username', '', { attrs: 'autocomplete="username" autocapitalize="none" required' })}
        <label class="field"><span>${t('password')}</span><div class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" data-act="pw-eye">👁</button></div></label>
        <button class="btn primary block" ${preview ? 'type="button"' : ''}>${t('signIn')}</button>
      </form>
      ${preview ? '' : `<div class="login-foot" style="margin-top:10px"><a href="#" data-act="forgot">${t('forgot')}</a></div>`}
      ${state.config?.trial?.enabled ? `<button class="btn block" style="margin-top:10px;border-color:var(--accent);color:var(--accent)" ${preview ? '' : 'data-act="trial"'}>🎁 ${t('startTrial', { hours: state.config.trial.hours })}</button>` : ''}
      ${preview ? '' : `<a class="btn block ghost" href="download.html" style="margin-top:8px">📲 ${t('getApp')}</a>`}
      ${preview ? '' : `<div class="login-foot"><a data-act="theme" style="cursor:pointer;text-decoration:none">🌗</a></div>`}
      ${preview ? '' : `<div class="login-foot lang-sw">${LANGS.map(([k, n]) => `<a data-act="lang" data-lang="${k}" class="${getLang() === k ? 'on' : ''}">${n}</a>`).join(' · ')}</div>`}
      ${waNum(b) ? `<a class="btn block wa-btn" style="margin-top:8px" href="${esc(waUrl(b, t('waMsg', { app: b.appName, u: '' })))}" target="_blank" rel="noopener">💬 ${t('whatsapp')}</a>` : b.supportUrl ? `<div class="login-foot"><a href="${esc(b.supportUrl)}" target="_blank" rel="noopener">${esc(b.supportLabel || t('support'))}</a></div>` : ''}
      ${b.footerText ? `<div class="login-foot">${esc(b.footerText)}</div>` : ''}
      ${preview || bridge() ? '' : `<div class="login-foot"><a href="#" data-act="site-page" data-page="home">${t('aboutSite', { app: esc(b.appName) })}</a></div>`}
      ${state.mode === 'demo' && !preview ? `<div class="login-foot"><span class="badge-demo">${t('demo')}</span></div>` : ''}
    </div></div>`;
}
function renderLogin(error = '') { $('#app').innerHTML = loginCard(state.config.branding, { error: error ? tErr(error) : '' }); setWaFab(state.config.branding, t('waMsg', { app: state.config.branding.appName, u: '' })); }
function trialForm() {
  const h = state.config.trial.hours;
  return `<p class="muted" style="margin-top:0">${t('trialIntro')}</p><form data-form="trial">
    ${field(t('fullName'), 'name', '', { attrs: 'required autocomplete="name"' })}
    ${field(t('email'), 'email', '', { type: 'email', attrs: 'required autocomplete="email" autocapitalize="none" dir="ltr"' })}
    ${field(t('phone'), 'phone', '', { type: 'tel', attrs: 'required autocomplete="tel" dir="ltr" placeholder="+212 6…"' })}
    ${toggle(t('sameWhatsapp'), 'same', true)}
    <div id="wa-field" style="display:none">${field(t('whatsapp'), 'whatsapp', '', { type: 'tel', attrs: 'dir="ltr"' })}</div>
    <div id="trial-err"></div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary">🎁 ${t('getTrial')}</button></div>
  </form>`;
}
function renderSetup() {
  const b = state.config.branding;
  $('#app').innerHTML = `<div class="login-wrap"><div class="login-card">${brandHtml(b)}
    <h2>Create your admin account</h2><p class="muted" style="margin-top:0">First-time setup. This account controls the whole app.</p>
    <form data-form="setup">
      ${field('Admin username', 'username', '', { attrs: 'required minlength="3" autocapitalize="none"' })}
      ${field('Password (6+ characters)', 'password', '', { type: 'password', attrs: 'required minlength="6"' })}
      <button class="btn primary block">Create admin</button>
    </form>
    ${state.mode === 'demo' ? `<div class="login-foot"><span class="badge-demo">Demo mode · data stays in this browser</span></div>` : ''}
  </div></div>`;
}

// ---------------- ADMIN ----------------
const ADMIN_TABS = [
  ['overview', '📊', 'Overview', null], ['customers', '👥', 'Customers', 'customers_view'], ['subs', '📅', 'Subscriptions', 'customers_view'], ['dups', '🧬', 'Duplicates', 'customers_view'],
  ['finance', '🏦', 'Banks & balances', 'finance_view'], ['profits', '📈', 'Profits', 'profits'], ['stock', '🎟', 'Credits stock', 'stock'],
  ['plans', '💳', 'Plans & prices', 'plans'], ['trial', '🎁', 'Trial & email', 'settings'], ['userdash', '📱', 'User dashboard', 'settings'],
  ['branding', '🎨', 'Login & branding', 'settings'], ['api', '🔌', 'API settings', 'settings'], ['team', '🛡', 'Team & access', 'owner'],
  ['support', '💬', 'Support', 'customers_view'], ['security', '🔐', 'My account', null], ['activity', '🧾', 'Activity', 'activity'],
];

async function renderAdmin() {
  setWaFab(null);
  setTimeout(applyTheme);
  const b = state.config.branding;
  if (!state.admin.me) { try { state.admin.me = await api('GET', '/api/admin/me'); } catch { return; } }
  const me = state.admin.me;
  const tabs = ADMIN_TABS.filter((x) => can(x[3]));
  if (!tabs.some((x) => x[0] === state.admin.tab)) state.admin.tab = tabs[0][0];
  const t = state.admin.tab;
  const title = ADMIN_TABS.find((x) => x[0] === t)?.[2] || '';
  document.body.className = (me.allPerms || []).filter(([p]) => !can(p)).map(([p]) => 'np-' + p).join(' ');
  $('#app').innerHTML = `<div class="admin">
    <aside class="side">${brandHtml(b, false)}<nav class="nav">${tabs.map(([k, ic, n]) => `<a class="${k === t ? 'on' : ''}" data-act="atab" data-tab="${k}"><span class="ic">${ic}</span>${n}</a>`).join('')}</nav>
      <a class="btn sm ghost" href="download.html" style="margin:6px 8px">📲 Get the apps</a>
      <div class="side-user"><div class="avatar">${esc(initials(me.name))}</div><div style="min-width:0"><b>${esc(me.name)}</b><div class="small muted">${me.role === 'owner' ? 'Owner · full access' : 'Team · ' + me.perms.length + ' permissions'}</div></div></div></aside>
    <div class="main">
      <div class="topbar"><img class="tb-logo" src="${esc(b.logoUrl || 'logo.png')}" alt=""><h2>${title}</h2><span class="spacer"></span>${state.mode === 'demo' ? '<span class="badge-demo">Demo</span>' : ''}<span class="chip-user small">${esc(me.name)}</span><button class="btn sm" data-act="theme" title="Theme">🌗</button><button class="btn sm" data-act="logout">Log out</button></div>
      <div class="mobile-nav">${tabs.map(([k, ic, n]) => `<a class="${k === t ? 'on' : ''}" data-act="atab" data-tab="${k}">${ic} ${n}</a>`).join('')}</div>
      <div class="content" id="admin-body"><div class="skeleton"></div><div class="skeleton short"></div></div>
    </div></div>`;
  try {
    const s = await api('GET', '/api/admin/settings');
    state.admin.settings = s;
    const body = $('#admin-body');
    if (t === 'overview') body.innerHTML = await adminOverview();
    else if (t === 'customers') { state.admin.customers = await api('GET', '/api/admin/customers'); body.innerHTML = adminCustomers(); }
    else if (t === 'subs') { state.admin.customers = await api('GET', '/api/admin/customers'); body.innerHTML = await adminSubs(); }
    else if (t === 'plans') body.innerHTML = adminPlans(s) + adminOrderSection(s) + await adminResellerSection(s);
    else if (t === 'finance') { body.innerHTML = await adminFinance(s) + (can('settings') ? await adminAutoPay(s) : ''); loadStripe(); }
    else if (t === 'profits') body.innerHTML = await adminProfits(s);
    else if (t === 'stock') body.innerHTML = await adminStock(s);
    else if (t === 'trial') body.innerHTML = adminTrial(s);
    else if (t === 'userdash') body.innerHTML = adminUserDash(s);
    else if (t === 'branding') body.innerHTML = adminBranding(s);
    else if (t === 'api') body.innerHTML = adminApi(s);
    else if (t === 'security') body.innerHTML = await adminSecurity(s);
    else if (t === 'support') body.innerHTML = await adminSupport();
    else if (t === 'activity') body.innerHTML = await adminActivity();
    else if (t === 'team') body.innerHTML = await adminTeam();
    else if (t === 'dups') { state.admin.customers = await api('GET', '/api/admin/customers'); body.innerHTML = await adminDups(); }
    animateIn(body);
  } catch (e) { if (state.token) $('#admin-body').innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
}

async function adminOverview() {
  const [st, cr, me] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/panel/credits').catch(() => ({})), api('GET', '/api/admin/me')]);
  const max = Math.max(1, ...Object.values(st.byMonth || {}));
  const s = state.admin.settings;
  const setupTips = [];
  if (can('settings')) {
  if (!s.player.serverUrl) setupTips.push('Add your streaming server URL in <a data-act="atab" data-tab="api">API settings</a> so customers can watch.');
  if (!s.reseller.enabled) setupTips.push('Connect the TVplus reseller API in <a data-act="atab" data-tab="api">API settings</a> to create and renew lines automatically.');
  }
  const row = (c) => `<div class="list-item"><div class="avatar">${esc(initials(c.name))}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="small muted">${esc(c.username)} · ${c.state === 'expired' ? 'expired ' + fmtDate(c.expiresAt) : c.daysLeft + ' days left'}</div></div><button class="btn sm primary" data-act="renew" data-perm="customers_edit" data-id="${c.id}">Renew</button></div>`;
  const lim = st.lowCreditsAlert || 0;
  const panelLow = cr.enabled && cr.ok && Number(cr.credits) <= lim;
  const creditWarn = panelLow || st.stock.low ? `<div class="notice warning">🎟 <b>Credits are low</b> — ${panelLow ? `panel has <b>${esc(cr.credits)}</b> credits` : ''}${panelLow && st.stock.low ? ' · ' : ''}${st.stock.low ? `stock has <b>${st.stock.available}</b> credits` : ''}. <a data-act="atab" data-tab="stock" style="cursor:pointer">Buy credits →</a></div>` : '';
  const pwWarn = me.isDefault ? `<div class="notice danger">🔐 You are using the default admin login (<b>Iptv / Iptv</b>). Anyone who knows it can control your app. <a data-act="atab" data-tab="security" style="cursor:pointer">Change it now →</a></div>` : '';
  return `${pwWarn}${creditWarn}${setupTips.length ? `<div class="notice warning"><b>Finish setup</b><ul style="margin:6px 0 0;padding-left:18px">${setupTips.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}
  <div class="stats">
    <div class="stat"><i class="st-ic">${ic('user', 20)}</i><span>Customers</span><b>${st.total}</b></div>
    <div class="stat c-ok"><i class="st-ic">${ic('check', 20)}</i><span>Active</span><b>${st.active}</b></div>
    <div class="stat c-warn"><i class="st-ic">${ic('clock', 20)}</i><span>Expiring soon</span><b>${st.expiring}</b></div>
    <div class="stat c-bad"><i class="st-ic">${ic('logout', 20)}</i><span>Expired</span><b>${st.expired}</b></div>
    <div class="stat"><i class="st-ic">${ic('star', 20)}</i><span>Free trials</span><b>${st.trials}</b></div>
    ${st.revenueTotal !== null ? `<div class="stat c-acc"><i class="st-ic">${ic('card', 20)}</i><span>Revenue this month</span><b>${usd(st.revenueMonth)}</b><span>${mad(st.revenueMonth * st.madRate)}</span></div>
    <div class="stat"><i class="st-ic">${ic('crown', 20)}</i><span>Total revenue</span><b>${usd(st.revenueTotal)}</b><span>${mad(st.revenueTotal * st.madRate)}</span></div>` : ''}
    <div class="stat ${panelLow ? 'c-bad' : ''}"><span>Panel credits (API)</span><b>${cr.enabled ? (cr.ok ? esc(cr.credits ?? '—') : '⚠️') : 'off'}</b></div>
    <div class="stat ${st.stock.low ? 'c-bad' : ''}"><span>Credits in stock</span><b>${st.stock.available}</b></div>
    ${st.totalBalanceUsd !== null && st.totalBalanceUsd !== undefined ? `<div class="stat c-ok" data-act="atab" data-tab="finance" style="cursor:pointer"><span>All banks (total)</span><b>${usd(st.totalBalanceUsd)}</b><span>${mad(st.totalBalanceUsd * st.madRate)}</span></div>` : ''}
  </div>
  <div class="grid2 ${can('customers_view') ? '' : 'hidden'}" style="gap:16px">
    <div class="card"><div class="row"><h3>Expiring soon</h3><span class="spacer"></span><a class="small" data-act="atab" data-tab="subs" style="cursor:pointer">Tracker →</a></div>${st.expiringSoon.length ? st.expiringSoon.map(row).join('') : '<p class="muted">Nobody is expiring soon.</p>'}</div>
    <div class="card"><h3>Recently expired</h3>${st.recentlyExpired.length ? st.recentlyExpired.map(row).join('') : '<p class="muted">No expired customers.</p>'}</div>
  </div>
  ${st.byMonth ? `<div class="card"><h3>Revenue (USD) · last 6 months</h3><div class="bars">${Object.entries(st.byMonth).map(([k, v]) => `<div><span>${v ? Number(v).toLocaleString() : ''}</span><i style="height:${(v / max) * 100}%"></i><span>${k.slice(5)}/${k.slice(2, 4)}</span></div>`).join('')}</div></div>` : ''}
  <div class="row"><button class="btn primary" data-act="new-customer" data-perm="customers_edit">＋ Add customer</button><button class="btn" data-act="new-tx" data-perm="finance_edit">💸 Add transaction</button><button class="btn" data-act="atab" data-tab="finance">🏦 Balances</button></div>`;
}

function filteredCustomers() {
  const { filter, q } = state.admin;
  const qq = q.trim().toLowerCase();
  return state.admin.customers
    .filter((c) => filter === 'all' || c.state === filter || (filter === 'trial' && c.isTrial))
    .filter((c) => !qq || [c.name, c.username, c.phone, c.lineUsername, c.note, c.email, c.whatsapp, c.orderNo, c.country].some((x) => String(x || '').toLowerCase().includes(qq)))
    .sort((a, b) => a.expiresAt - b.expiresAt);
}
function custActions(c) {
  return `<button class="btn sm primary" data-act="renew" data-perm="customers_edit" data-id="${c.id}">Renew</button>
    <button class="btn sm" data-act="edit-customer" data-perm="customers_edit" data-id="${c.id}">Edit</button>
    <button class="btn sm" data-act="toggle-customer" data-perm="customers_edit" data-id="${c.id}">${c.status === 'disabled' ? 'Enable' : 'Disable'}</button>
    <button class="btn sm ${c.waSentAt ? 'wa-sent' : c.whatsapp || c.phone ? 'wa-todo' : ''}" data-act="wa-one" data-perm="customers_edit" data-id="${c.id}" title="${c.waSentAt ? 'WhatsApp message sent ' + fmtDate(c.waSentAt) + ' — tap to send another' : 'Send a WhatsApp message'}" aria-label="${c.waSentAt ? 'WhatsApp message already sent' : 'Send a WhatsApp message'}">💬</button>
    ${c.email ? `<button class="btn sm" data-act="email-login" data-perm="customers_edit" data-id="${c.id}" title="Email login details">✉️</button>` : ''}
    ${c.email ? `<button class="btn sm" data-act="order-one" data-perm="customers_edit" data-id="${c.id}" title="Send a package order email${c.orderSentAt ? ' (last sent ' + fmtDate(c.orderSentAt) + ')' : ''}">💳</button>` : ''}
    ${c.email && c.state === 'expired' ? `<button class="btn sm" data-act="renewal-one" data-perm="customers_edit" data-id="${c.id}" title="Send renewal offer${c.renewalSentAt ? ' (sent ' + fmtDate(c.renewalSentAt) + ')' : ''}">🔁${c.renewalSentFor === c.expiresAt ? '✓' : ''}</button>` : ''}
    <button class="btn sm" data-act="copy-login" data-perm="customers_view" data-id="${c.id}" title="Copy login details">📋</button>
    ${c.twoFactor ? `<button class="btn sm" data-act="cust-tfa-off" data-perm="customers_edit" data-id="${c.id}" title="Two-step sign-in is on. Tap to turn it off (lost phone).">🔐</button>` : ''}
    <button class="btn sm danger" data-act="del-customer" data-perm="customers_delete" data-id="${c.id}">🗑</button>`;
}
function customerListHtml() {
  const all = filteredCustomers();
  if (!all.length) return `<div class="empty"><span class="ic">👥</span>No customers here yet.</div>`;
  const lim = state.admin.custLimit || 60;
  const list = all.slice(0, lim);
  const more = all.length > lim ? `<div style="text-align:center;margin:14px"><button class="btn" data-act="cust-more">Show more (${all.length - lim} left)</button></div>` : '';
  const narrow = matchMedia('(max-width: 760px)').matches;
  if (narrow) return `<div class="cust-cards" style="display:block">${list.map((c) => `<div class="cc"><div class="row"><div class="avatar">${esc(initials(c.name))}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b>${c.orderNo ? ` <span class="tagp">${esc(c.orderNo)}</span>` : ''}<div class="small muted">${esc(c.username)} · ${esc(c.planName)}${c.email ? ' · ' + esc(c.email) : ''}</div></div>${pill(c.state)}</div>
      <div class="small muted" style="margin:10px 0 6px">Expires ${fmtDate(c.expiresAt)} · ${c.daysLeft >= 0 ? c.daysLeft + ' days left' : 'expired'}</div>${progress(c)}<div class="row" style="margin-top:12px">${custActions(c)}</div></div>`).join('')}</div>${more}`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Login</th><th>Plan</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.isTrial ? ' <span class="pill st-expiring">trial</span>' : ''}${c.orderNo ? ` <span class="tagp">${esc(c.orderNo)}</span>` : ''}<div class="small muted">${esc(c.phone)}${c.email ? ' · ' + esc(c.email) : ''}</div></td><td>${esc(c.username)}${c.lineId ? `<div class="small muted">line #${esc(c.lineId)}</div>` : ''}</td><td>${esc(c.planName)}<div class="small muted">${c.connections} device${c.connections > 1 ? 's' : ''}</div></td>
      <td>${fmtDate(c.expiresAt)}<div class="small muted">${c.isTrial && c.state !== 'expired' ? c.hoursLeft + ' hours left' : c.daysLeft >= 0 ? c.daysLeft + ' days left' : -c.daysLeft + ' days ago'}</div>${progress(c)}</td><td>${pill(c.state)}</td><td><div class="row" style="justify-content:flex-end">${custActions(c)}</div></td></tr>`).join('')}
    </tbody></table></div>${more}`;
}
function oldCustomerListHtml() {
  const list = filteredCustomers();
  return `<div class="tbl-wrap cust-table"><table class="tbl"><thead><tr><th>Customer</th><th>Login</th><th>Plan</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.isTrial ? ' <span class="pill st-expiring">trial</span>' : ''}${c.orderNo ? ` <span class="tagp">${esc(c.orderNo)}</span>` : ''}<div class="small muted">${esc(c.phone)}${c.email ? ' · ' + esc(c.email) : ''}</div></td><td>${esc(c.username)}${c.lineId ? `<div class="small muted">line #${esc(c.lineId)}</div>` : ''}</td><td>${esc(c.planName)}<div class="small muted">${c.connections} device${c.connections > 1 ? 's' : ''}</div></td>
      <td>${fmtDate(c.expiresAt)}<div class="small muted">${c.isTrial && c.state !== 'expired' ? c.hoursLeft + ' hours left' : c.daysLeft >= 0 ? c.daysLeft + ' days left' : -c.daysLeft + ' days ago'}</div>${progress(c)}</td><td>${pill(c.state)}</td><td><div class="row" style="justify-content:flex-end">${custActions(c)}</div></td></tr>`).join('')}
    </tbody></table></div>
    <div class="cust-cards">${list.map((c) => `<div class="cc"><div class="row"><div class="avatar">${esc(initials(c.name))}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="small muted">${esc(c.username)} · ${esc(c.planName)}${c.email ? ' · ' + esc(c.email) : ''}</div></div>${pill(c.state)}</div>
      <div class="small muted" style="margin:10px 0 6px">Expires ${fmtDate(c.expiresAt)} · ${c.daysLeft >= 0 ? c.daysLeft + ' days left' : 'expired'}</div>${progress(c)}<div class="row" style="margin-top:12px">${custActions(c)}</div></div>`).join('')}</div>`;
}
function adminCustomers() {
  const a = state.admin;
  const counts = (st) => a.customers.filter((c) => st === 'all' || c.state === st || (st === 'trial' && c.isTrial)).length;
  return `<div class="row" style="margin-bottom:14px"><input style="flex:1;min-width:200px" placeholder="🔎 Search name, username, phone…" value="${esc(a.q)}" data-input="cust-search"><button class="btn primary" data-act="new-customer" data-perm="customers_edit">＋ Add customer</button><button class="btn" data-act="export-xlsx">⬇ Excel</button><button class="btn" data-act="renewal-bulk" data-perm="customers_edit">🔁 Renewal emails</button><button class="btn" data-act="order-bulk" data-perm="customers_edit">💳 Package emails</button><button class="btn" data-act="order-custom" data-perm="customers_edit">✍️ Custom email</button><button class="btn" data-act="nl-open" data-perm="customers_edit">📣 Newsletter</button></div>
    <div class="chips">${['all', 'active', 'expiring', 'expired', 'disabled', 'trial'].map((f) => `<a class="${a.filter === f ? 'on' : ''}" data-act="cust-filter" data-f="${f}">${f} (${counts(f)})</a>`).join('')}</div>
    <div id="cust-list">${customerListHtml()}</div>`;
}

function customerForm(c) {
  const s = state.admin.settings;
  const isNew = !c;
  c = c || { planId: s.plans[0]?.id, connections: s.plans[0]?.connections || 1, startAt: Date.now() };
  const planOpts = [...s.plans.map((p) => [p.id, `${p.name} · ${p.days} days · ${p.price} ${s.currency}`]), ['custom', 'Custom dates']];
  return `<form data-form="customer" data-id="${c.id || ''}">
    <div class="grid2">${field('Customer name', 'name', c.name || '', { attrs: 'required' })}${field('Email', 'email', c.email || '', { type: 'email', attrs: 'autocapitalize="none"' })}</div>
    <div class="grid3">${field('Phone', 'phone', c.phone || '', { type: 'tel' })}${field('WhatsApp', 'whatsapp', c.whatsapp || '', { type: 'tel', ph: 'same as phone' })}${field('Email language', 'lang', c.lang || 'fr', { type: 'select', options: [['ar', 'العربية'], ['fr', 'Français'], ['en', 'English']] })}</div>
    <div class="grid3">${field('Order number', 'orderNo', c.orderNo || '')}${field('Country', 'country', c.country || '')}${field('Payment method', 'paymentMethod', c.paymentMethod || '', { ph: 'Wise, USDT, bank…' })}</div>
    <div class="grid3">${field('Address', 'address', c.address || '')}${field('Server', 'server', c.server || '', { ph: 'MEGA, DINO…' })}${field('Panel', 'panel', c.panel || '')}</div>
    <h3 style="margin-top:6px">App login details</h3>
    <div class="grid2">${field('Username', 'username', c.username || '', { attrs: 'required minlength="3" autocapitalize="none"' })}
      ${field(isNew ? 'Password' : 'New password (leave empty to keep)', 'password', '', { attrs: (isNew ? 'required minlength="4"' : '') + ' autocapitalize="none"', ph: isNew ? '' : '••••••' })}</div>
    <button type="button" class="btn sm" data-act="gen-login" style="margin:-4px 0 12px">🎲 Generate username & password</button>
    <h3>IPTV line (TVplus)</h3>
    ${isNew ? toggle('Use the same username & password for the IPTV line', 'lineSame', true, 'Turn off if the line on the panel has different details.') : ''}
    <div class="grid3" id="line-fields" style="${isNew ? 'display:none' : ''}">${field('Line username', 'lineUsername', c.lineUsername || '')}${field('Line password', 'linePassword', c.linePassword || '')}${field('Panel line ID', 'lineId', c.lineId || '', { help: 'Filled automatically when created through the API.' })}</div>
    <h3 style="margin-top:6px">Subscription</h3>
    <div class="grid2">${field('Plan', 'planId', c.planId, { type: 'select', options: planOpts })}${field('Devices (connections)', 'connections', c.connections || 1, { type: 'number', attrs: 'min="1" max="10"' })}</div>
    <div class="grid2">${field('Start date', 'startAt', isoDay(c.startAt || Date.now()), { type: 'date' })}${field('Expiry date', 'expiresAt', c.expiresAt ? isoDay(c.expiresAt) : '', { type: 'date', help: isNew ? 'Leave empty to calculate from the plan.' : '' })}</div>
    ${isNew ? `<div class="grid2">${accountSelect(s, 'accountId', '')}${field('Amount received', 'price', s.plans[0]?.price || 0, { type: 'number', attrs: 'min="0" step="any"', help: 'In the currency of the chosen account.' })}</div>
      ${toggle('Email the login details to the customer', 'sendEmail', !!s.email.resendKey, s.email.resendKey ? 'Sent with Resend in the language above.' : 'Set up Resend in "Trial & email" first.')}
      ${s.reseller.enabled ? toggle('Create the line on the TVplus panel now', 'createOnPanel', true, 'Uses the "create" action from API settings.') : '<p class="small muted">Reseller API is off — the line will only be saved in this app.</p>'}` : ''}
    ${field('Notes', 'note', c.note || '', { type: 'textarea', rows: 2 })}
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">${isNew ? 'Create customer' : 'Save changes'}</button></div>
  </form>`;
}

function renewForm(c) {
  const s = state.admin.settings;
  const p0 = s.plans.find((p) => p.id === c.planId) || s.plans[0] || { days: 30, price: 0 };
  return `<p class="muted" style="margin-top:0"><b>${esc(c.name)}</b> (${esc(c.username)}) · currently ${pill(c.state)} · expires ${fmtDate(c.expiresAt)}</p>
  <form data-form="renew" data-id="${c.id}">
    ${field('Plan', 'planId', p0.id || '', { type: 'select', options: [...s.plans.map((p) => [p.id, `${p.name} · ${p.days} days`]), ['custom', 'Custom number of days']], attrs: 'data-renew-plan' })}
    <div class="grid3">${field('Days to add', 'days', p0.days, { type: 'number', attrs: 'min="1"' })}${field('Credits used', 'credits', p0.credits ?? '', { type: 'number', attrs: 'min="0"' })}${field('Amount received', 'price', p0.price, { type: 'number', attrs: 'min="0" step="any"' })}</div>
    ${accountSelect(s, 'accountId', '')}
    <p class="small muted" id="renew-preview"></p>
    ${s.reseller.enabled ? toggle('Also renew the line on the TVplus panel', 'syncPanel', !!c.lineId || true, 'Uses the "renew" action from API settings.') : ''}
    ${c.status === 'disabled' ? toggle('Enable this customer again', 'enable', true) : ''}
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Renew subscription</button></div>
  </form>`;
}
function updateRenewPreview() {
  const f = $('form[data-form=renew]'); if (!f) return;
  const c = state.admin.customers.find((x) => x.id === f.dataset.id);
  const days = Number(f.days.value) || 0;
  const base = Math.max(Date.now(), c.expiresAt);
  $('#renew-preview').textContent = `New expiry: ${fmtDate(base + days * 86400000)}`;
}

async function adminSubs() {
  const st = await api('GET', '/api/admin/stats');
  const a = state.admin;
  const lim = a.subDays === 'all' ? Infinity : Number(a.subDays);
  const list = a.customers.filter((c) => c.state !== 'disabled' && c.daysLeft <= lim && (a.subDays === 'all' || c.daysLeft >= -30)).sort((x, y) => x.expiresAt - y.expiresAt).slice(0, 150);
  const renewals = a.customers.flatMap((c) => (c.renewals || []).map((r) => ({ ...r, name: c.name, username: c.username }))).sort((x, y) => y.at - x.at).slice(0, 40);
  const max = Math.max(1, ...Object.values(st.byMonth || {}));
  return `<div class="stats">
      <div class="stat c-ok"><span>Active</span><b>${st.active}</b></div><div class="stat c-warn"><span>Expiring soon</span><b>${st.expiring}</b></div>
      <div class="stat c-bad"><span>Expired</span><b>${st.expired}</b></div><div class="stat"><span>Renewals recorded</span><b>${st.renewalsCount}</b></div>
      ${st.revenueMonth !== null ? `<div class="stat c-acc"><span>This month</span><b>${usd(st.revenueMonth)}</b></div>` : ''}</div>
    <div class="card"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Subscription tracker</h3><span class="spacer"></span>
      <select data-input="sub-days" style="width:auto">${[['7', 'Expiring in 7 days'], ['14', '14 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All subscriptions']].map(([v, t]) => `<option value="${v}" ${a.subDays === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn sm" data-act="export-csv">⬇ CSV</button></div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Plan</th><th>Expires</th><th style="min-width:120px">Time left</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.username)} ${c.phone ? '· ' + esc(c.phone) : ''}</div></td><td>${esc(c.planName)}</td><td>${fmtDate(c.expiresAt)}</td>
        <td><div class="small">${c.daysLeft >= 0 ? c.daysLeft + ' days' : 'expired ' + -c.daysLeft + 'd ago'}</div>${progress(c)}</td><td>${pill(c.state)}</td><td><button class="btn sm primary" data-act="renew" data-perm="customers_edit" data-id="${c.id}">Renew</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Nothing in this range.</p>'}</div>
    <div class="grid2" style="gap:16px">
      <div class="card"><h3>Revenue by month (USD)</h3><div class="bars">${Object.entries(st.byMonth || {}).map(([k, v]) => `<div><span>${v ? Number(v).toLocaleString() : ''}</span><i style="height:${(v / max) * 100}%"></i><span>${k.slice(5)}/${k.slice(2, 4)}</span></div>`).join('')}</div></div>
      <div class="card"><h3>Latest payments & renewals</h3>${renewals.length ? renewals.map((r) => `<div class="list-item"><span>${r.type === 'new' ? '🆕' : r.type === 'trial' ? '🎁' : '🔁'}</span><div style="flex:1;min-width:0"><b>${esc(r.name)}</b><div class="small muted">${fmtDT(r.at)} · ${r.type === 'trial' ? 'free trial' : '+' + r.days + ' days'}</div></div><b>${r.type === 'trial' ? '—' : esc(r.price)}</b></div>`).join('') : '<p class="muted">No payments yet.</p>'}</div>
    </div>`;
}

// ---------------- duplicates ----------------
const DUP_ICON = { email: '📧', phone: '📱', line: '📺', name: '👤' };
const DUP_LABEL = { email: 'Same email', phone: 'Same phone / WhatsApp', line: 'Same IPTV line', name: 'Same name' };
async function adminDups() {
  const a = state.admin; a.dupType ||= 'all'; a.dupLimit ||= 30;
  const d = await api('GET', '/api/admin/duplicates' + (a.dupType === 'name' ? '?name=1' : ''));
  a.dups = d;
  const q = (a.dupQ || '').toLowerCase();
  const groups = d.groups.filter((g) => (a.dupType === 'all' ? g.type !== 'name' : g.type === a.dupType))
    .filter((g) => !q || g.value.toLowerCase().includes(q) || g.members.some((m) => [m.name, m.username, m.email, m.phone, m.orderNo].some((x) => String(x || '').toLowerCase().includes(q))));
  const count = (t) => d.groups.filter((g) => g.type === t).length;
  const row = (m) => `<tr><td><b>${esc(m.name)}</b>${m.orderNo ? ` <span class="tagp">${esc(m.orderNo)}</span>` : ''}<div class="small muted">${esc(m.username)}</div></td><td class="small">${esc(m.email || '')}<div class="muted">${esc(m.whatsapp || m.phone || '')}</div></td><td class="small">${esc(m.planName)}<div class="muted">${fmtDate(m.createdAt || m.startAt)} → ${fmtDate(m.expiresAt)}</div></td><td>${pill(m.state)}</td><td><div class="row" style="justify-content:flex-end">${custActions(m)}</div></td></tr>`;
  return `<div class="stats">
      <div class="stat c-warn"><span>Duplicate groups</span><b>${d.groups.filter((g) => g.type !== 'name').length}</b></div>
      <div class="stat"><span>Customers involved</span><b>${d.customersInGroups}</b></div>
      <div class="stat c-bad"><span>Repeat attempts blocked / flagged</span><b>${d.attempts.length}</b></div></div>
    <div class="row" style="margin-bottom:12px"><input style="flex:1;min-width:200px" placeholder="🔎 Search email, phone, name, order…" value="${esc(a.dupQ || '')}" data-input="dup-search"></div>
    <div class="chips">${[['all', 'All'], ['email', '📧 Email (' + count('email') + ')'], ['phone', '📱 Phone (' + count('phone') + ')'], ['line', '📺 IPTV line (' + count('line') + ')'], ['name', '👤 Same name'], ['attempts', '🚩 Repeat attempts (' + d.attempts.length + ')']].map(([k, n]) => `<a class="${a.dupType === k ? 'on' : ''}" data-act="dup-type" data-t="${k}">${n}</a>`).join('')}</div>
    ${a.dupType === 'attempts' ? (d.attempts.length ? `<div class="card"><p class="small muted" style="margin-top:0">Someone tried to start a free trial or was added as a new customer with an email or phone that already belongs to another customer.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Used details</th><th>Already used by</th></tr></thead><tbody>
      ${d.attempts.map((x) => `<tr><td class="small">${fmtDT(x.at)}</td><td>${x.kind === 'trial' ? '🎁 Free trial (blocked)' : '➕ New customer (flagged)'}${x.by ? `<div class="small muted">by ${esc(x.by)}</div>` : ''}</td><td><b>${esc(x.name || '')}</b><div class="small muted">${esc([x.email, x.phone, x.ip && 'IP ' + x.ip].filter(Boolean).join(' · '))}</div></td><td class="small">${(x.matches || []).map((m) => `${esc(m.name)} <span class="tagp">${esc(m.username)}</span> <span class="muted">(${esc(m.why.join(', '))})</span>`).join('<br>')}</td></tr>`).join('')}
      </tbody></table></div></div>` : '<div class="empty card"><span class="ic">✅</span>No repeat attempts yet.</div>')
    : groups.length ? groups.slice(0, a.dupLimit).map((g) => `<div class="card dup-g"><div class="row"><h3 style="margin:0">${DUP_ICON[g.type]} ${DUP_LABEL[g.type]}: <span class="tagp" style="font-size:.85rem">${esc(g.value)}</span></h3><span class="spacer"></span><span class="pill st-expiring">${g.members.length} customers</span></div>
      <div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><tbody>${g.members.map(row).join('')}</tbody></table></div></div>`).join('') + (groups.length > a.dupLimit ? `<div style="text-align:center"><button class="btn" data-act="dup-more">Show more (${groups.length - a.dupLimit})</button></div>` : '')
    : '<div class="empty card"><span class="ic">✅</span>No duplicates found.</div>'}`;
}
async function adminResellerSection(s) {
  const sales = can('customers_view') ? await api('GET', '/api/admin/reseller-sales').catch(() => []) : [];
  const rp = s.resellerPackages || [];
  const row = (p) => `<div class="rp-row" data-rp="${esc(p.id || '')}"><input data-k="name" value="${esc(p.name)}" placeholder="Name"><input data-k="credits" type="number" value="${p.credits}" placeholder="Credits"><input data-k="price" type="number" step="any" value="${p.price}" placeholder="Price"><button class="btn sm danger" data-act="del-rp">✕</button></div>`;
  const cur = s.resellerCurrency || 'EUR';
  return `<div class="card"><div class="row"><h3 style="margin:0">🤝 Reseller packages</h3><span class="spacer"></span><button class="btn primary sm" data-act="sell-rp" data-perm="customers_edit">＋ Sell a package</button></div>
    <div class="plans-grid" style="margin:14px 0">${rp.map((p) => `<div class="plan-c"><b>${esc(p.name)}</b><div class="pp">${priceTxt(p.price, cur)}</div><div class="small muted">${p.credits} credits · ${priceTxt(Math.round((p.price / p.credits) * 100) / 100, cur)} each</div></div>`).join('')}</div>
    <details><summary class="small muted" style="cursor:pointer">Edit packages</summary><div style="margin-top:10px">
      <div class="rp-row small muted"><span>Name</span><span>Credits</span><span>Price</span><span></span></div>
      <div id="rps">${rp.map(row).join('')}</div>
      <div class="row"><button class="btn sm" data-act="add-rp">＋ Add package</button><select id="rp-cur" style="width:auto">${['EUR', 'USD', 'USDT', 'MAD'].map((c) => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select><button class="btn sm primary" data-act="save-rp">Save packages</button></div></div></details>
    ${sales.length ? `<h3 style="margin-top:16px">Reseller sales</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Reseller</th><th>Package</th><th>Paid</th><th>Profit</th></tr></thead><tbody>${sales.slice(0, 50).map((x) => `<tr><td class="small">${fmtDT(x.at)}</td><td><b>${esc(x.name)}</b><div class="small muted">${esc([x.email, x.phone].filter(Boolean).join(' · '))}</div></td><td>${esc(x.planName)}</td><td>${num(x.amount, x.currency)}</td><td class="${x.amountUsd - x.costUsd < 0 ? 'neg' : 'pos'}">${usd(x.amountUsd - x.costUsd)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}
const ORDER_CUR = { EUR: '€', USD: '$', USDT: '₮' };
const orderPrice = (s, p) => (s.orderCurrency === 'ALL' ? Number(p.price).toFixed(2) + ' €/$' : (ORDER_CUR[s.orderCurrency || 'EUR'] || '') + Number(p.price).toFixed(2) + (ORDER_CUR[s.orderCurrency || 'EUR'] ? '' : ' ' + s.orderCurrency));
const opRow = (p = {}) => `<div class="op-row card" style="padding:10px;margin-bottom:8px" data-op="${esc(p.id || '')}"><div class="grid3"><input data-k="title" value="${esc(p.title || '')}" placeholder="Name (1 Month)"><input data-k="days" type="number" value="${p.days ?? 30}" placeholder="Days"><input data-k="devices" type="number" value="${p.devices ?? 1}" placeholder="Devices"></div>
  <div class="grid3" style="margin-top:6px"><input data-k="price" type="number" step="any" value="${p.price ?? ''}" placeholder="Price"><input data-k="badge" value="${esc(p.badge || '')}" placeholder="Top badge (optional)"><button class="btn sm danger" data-act="del-op">✕ Remove</button></div>
  <input data-k="link" style="margin-top:6px" value="${esc(p.link || '')}" placeholder="${(p.links || []).length ? 'Optional: one fixed link instead of the random ones' : 'Stripe payment link https://buy.stripe.com/…'}" autocapitalize="none"></div>`;
function adminOrderSection(s) {
  const op = s.orderPackages || []; const cur = s.orderCurrency || 'EUR'; const lc = cur === 'USDT' ? 'USD' : cur;
  const on = new Set((s.orderAccounts || []).filter((a) => a.enabled !== false).map((a) => a.id));
  const mine = (l) => (lc === 'ALL' || l.cur === lc) && (!l.acc || on.has(l.acc));
  const nLinks = (p) => (p.links || []).filter(mine).length || (p.link ? 1 : 0);
  const nAccs = (p) => new Set((p.links || []).filter(mine).map((l) => l.acc)).size;
  const missing = op.filter((p) => !nLinks(p)).length;
  const accs = s.orderAccounts || [];
  return `<div class="card"><div class="row"><h3 style="margin:0">💳 Package order emails</h3><span class="spacer"></span><button class="btn sm" data-act="order-custom" data-perm="customers_edit">✍️ Custom email</button><button class="btn primary sm" data-act="order-bulk" data-perm="customers_edit">📨 Send to customers…</button></div>
    <p class="small muted">Your 8 order templates. Each email shows the package and a <b>Stripe pay button</b>. It is sent in the customer's language (English, French, Arabic). Send one from a customer's 💳 button, or many at once here.</p>
    <div class="plans-grid" style="margin:14px 0">${op.map((p) => `<div class="plan-c"><b>${esc(p.title)}</b><div class="pp">${orderPrice(s, p)}</div><div class="small muted">${p.days} days · ${p.devices} device${p.devices > 1 ? 's' : ''}</div><div class="small ${nLinks(p) ? 'pos' : 'neg'}">${nLinks(p) ? `✓ ${nLinks(p)} link${nLinks(p) > 1 ? 's' : ''} · ${nAccs(p)} account${nAccs(p) > 1 ? 's' : ''}` : '⚠️ no pay link'}</div><button class="btn sm" style="margin-top:6px" data-act="order-preview" data-pkg="${esc(p.id)}">👁 Preview</button></div>`).join('')}</div>
    ${missing ? `<div class="notice warning">${missing} package${missing > 1 ? 's have' : ' has'} no Stripe payment link yet, so the button opens your website instead. ${s.finance.stripeKey ? 'Tap below to create them in your Stripe account.' : 'Paste the links below, or add your Stripe secret key in Finance and let the app create them.'}</div>` : ''}
    ${accs.length ? `<h3 style="margin:14px 0 6px;font-size:15px">Stripe accounts used for pay links</h3><p class="small muted" style="margin-top:0">Each email picks a random account from the ones switched on, then one of its links${lc === 'ALL' ? ' (USD or EUR — the email shows the price in that currency)' : ' in ' + lc}. Switch an account off if it is blocked or full.</p>
      <div id="op-accs">${accs.map((a) => `<label class="row" style="padding:4px 0"><input type="checkbox" data-acc="${esc(a.id)}" ${a.enabled !== false ? 'checked' : ''} style="width:auto"> <b>${esc(a.name)}</b> <span class="small muted">${op.reduce((n, p) => n + (p.links || []).filter((l) => l.acc === a.id && (lc === 'ALL' || l.cur === lc)).length, 0)} links${lc === 'ALL' ? '' : ' in ' + lc}</span></label>`).join('')}</div>
      <button class="btn sm" data-act="save-accs">Save accounts</button>` : ''}
    <div class="row">${s.finance.stripeKey && missing ? `<button class="btn" data-act="order-stripe-links">⚡ Create ${missing} Stripe links automatically</button>` : ''}</div>
    <details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Edit packages, prices & Stripe links</summary><div style="margin-top:10px">
      <div id="ops">${op.map(opRow).join('')}</div>
      <div class="row"><button class="btn sm" data-act="add-op">＋ Add package</button><select id="op-cur" style="width:auto">${[['ALL', 'USD + EUR links (mixed)'], ['EUR', 'EUR only'], ['USD', 'USD only'], ['USDT', 'USDT']].map(([c, l]) => `<option value="${c}" ${c === cur ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn sm primary" data-act="save-op">Save packages</button></div></div></details></div>`;
}
const waForm = () => { const f = $('[data-form=wa]'); const d = Object.fromEntries(new FormData(f)); return { ...d, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') }; };
async function waLoad() {
  const f = $('[data-form=wa]'); if (!f) return;
  try { const r = await api('POST', `/api/admin/customers/${f.dataset.id}/wamsg`, waForm()); $('#wa-text').value = r.text; $('#wa-tpl-text').value = r.template;
    const acc = (state.admin.settings.orderAccounts || []).find((a) => a.id === r.payAcc); $('#wa-info').textContent = (r.type !== 'login' && acc ? `Stripe account: ${acc.name}. ` : '') + (r.isDefault ? 'Default template.' : 'Your saved template.'); }
  catch (e) { toast(e.message, true); }
}
const NL_GROUPS = [['all', 'All customers'], ['paying', 'Paying customers (no trials)'], ['active', 'Active subscriptions'], ['expiring', 'Expiring soon'], ['expired', 'Expired subscriptions'], ['trial', 'Trial users']];
const NL_LANGS = [['en', '🇬🇧 English'], ['fr', '🇫🇷 Français'], ['ar', '🇲🇦 العربية']];
const nlBlank = () => ({ split: false, lang: 'en', content: { all: {}, en: {}, fr: {}, ar: {} }, badge: '', image: '', coupon: '', link: 'site', group: 'all' });
const nlFields = (k, c = {}) => `<div class="nl-c" data-k="${k}">${field('Email subject', 'subject_' + k, c.subject || '', { ph: 'e.g. 🎉 Black Friday: 50% off all packages' })}${field('Big title', 'title_' + k, c.title || '', { ph: 'e.g. Black Friday deal 🔥' })}${field('Message', 'body_' + k, c.body || '', { type: 'textarea', rows: 7, ph: 'Write your message. {name} = customer first name. *text* = bold. Empty line = new paragraph.' })}${field('Button text', 'button_' + k, c.button || '', { ph: 'e.g. Get the offer →' })}</div>`;
function nlRead() {
  const f = $('[data-form=nl]'); if (!f) return null; const g = (n) => f.elements[n]?.value ?? '';
  const camp = { id: f.dataset.cid || undefined, split: g('split') === '1', lang: g('lang'), badge: g('badge'), image: g('image').trim(), coupon: g('coupon').trim(), group: g('group'), content: {} };
  camp.link = g('link') === 'url' ? g('linkUrl').trim() : g('link');
  for (const k of ['all', 'en', 'fr', 'ar']) camp.content[k] = { subject: g('subject_' + k), title: g('title_' + k), body: g('body_' + k), button: g('button_' + k) };
  if (!camp.split) camp.content = { all: camp.content.all }; else delete camp.content.all;
  try { localStorage.setItem('tvp_nl_draft', JSON.stringify(camp)); } catch {}
  return camp;
}
const orderTargets = (grp) => (state.admin.customers || []).filter((c) => c.email && (grp === 'all' || (grp === 'trial' ? c.isTrial : grp === 'notrecent' ? !c.orderSentAt || Date.now() - c.orderSentAt > 7 * 86400000 : c.state === grp)));
function resellerSaleForm(s) {
  const rp = s.resellerPackages || []; const cur = s.resellerCurrency || 'EUR';
  return `<form data-form="rp-sale">
    ${field('Package', 'packageId', rp[0]?.id, { type: 'select', options: rp.map((p) => [p.id, `${p.name} · ${p.credits} credits · ${priceTxt(p.price, cur)}`]), attrs: 'data-rp-pick' })}
    <div class="grid2">${field('Reseller name', 'name', '', { attrs: 'required' })}${field('Email', 'email', '', { type: 'email', attrs: 'autocapitalize="none"' })}</div>
    <div class="grid2">${field('Phone / WhatsApp', 'phone', '', { type: 'tel' })}${field('Amount received', 'amount', rp[0]?.price ?? '', { type: 'number', attrs: 'step="any" min="0"', help: 'In the currency of the account below.' })}</div>
    ${accountSelect(s, 'accountId', '')}
    ${field('Note', 'note', '')}
    <p class="small muted">The package credits are taken from your credits stock, and the profit shows in Profits.</p>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Record sale</button></div></form>`;
}
function adminPlans(s) {
  const row = (p) => `<div class="plan-row" data-plan="${esc(p.id || '')}"><input data-k="name" value="${esc(p.name)}" placeholder="Name"><input data-k="days" type="number" value="${p.days}" placeholder="Days"><input data-k="price" type="number" step="any" value="${p.price}" placeholder="Price"><input data-k="credits" type="number" value="${p.credits ?? ''}" placeholder="Credits"><input data-k="connections" type="number" value="${p.connections}" placeholder="Devices"><input data-k="package" value="${esc(p.package)}" placeholder="Package ID"><button class="btn sm danger" data-act="del-plan">✕</button></div>`;
  return `<div class="card"><h3>Plans & prices</h3><p class="muted small">"Credits" = how many panel credits one sale of this plan uses (for stock and profit). "Package ID" is the package number on your TVplus panel, sent as <code>{package}</code>.</p>
    <div class="plan-row small muted" style="margin-bottom:4px"><span>Name</span><span>Days</span><span>Price (${esc(s.currency)})</span><span>Credits</span><span>Devices</span><span>Package ID</span><span></span></div>
    <div id="plans">${s.plans.map(row).join('')}</div>
    <button class="btn sm" data-act="add-plan">＋ Add plan</button>
    <div class="grid2" style="margin-top:16px">${field('Price currency', 'currency', s.currency, { type: 'select', options: [['EUR', '€ Euro (EUR)'], ['USD', '$ US Dollar (USD)'], ['USDT', '₮ Tether (USDT)'], ['MAD', 'Moroccan Dirham (MAD)']], attrs: 'id="currency"', help: 'Profits are converted to USD and MAD automatically.' })}</div>
    <button class="btn primary" data-act="save-plans">Save plans</button></div>`;
}

function adminUserDash(s) {
  const d = s.userDashboard;
  return `<form data-form="settings" class="card"><h3>What customers can see</h3>
    ${toggle('📺 Live TV', 'userDashboard.live', d.live)}${toggle('🎬 Movies', 'userDashboard.movies', d.movies)}${toggle('🎞 Series', 'userDashboard.series', d.series)}
    ${toggle('🗓 TV guide (EPG) under live channels', 'userDashboard.epg', d.epg)}${toggle('🔎 Search', 'userDashboard.search', d.search)}${toggle('⭐ Favorites', 'userDashboard.favorites', d.favorites)}
    ${toggle('📡 Customers can add their own playlists (Xtream Codes / M3U)', 'userDashboard.ownPlaylists', d.ownPlaylists !== false, 'Saved on the customer\'s device only. Turn off to keep the app for your own service.')}
    ${toggle('📅 Subscription card with expiry & days left', 'userDashboard.showSubscription', d.showSubscription)}${toggle('🔑 Customers can change their own password', 'userDashboard.allowPasswordChange', d.allowPasswordChange)}
    <div class="grid2" style="margin-top:12px">${field('Show "expiring soon" warning (days before)', 'userDashboard.expiryWarningDays', d.expiryWarningDays, { type: 'number', attrs: 'min="1" max="60"' })}</div>
    <h3 style="margin-top:10px">Announcement banner</h3>
    ${field('Message shown on every customer home screen (empty = hidden)', 'userDashboard.announcement', d.announcement, { type: 'textarea', rows: 2, ph: 'e.g. New sports channels added! 🎉' })}
    <div class="grid2">${field('Style', 'userDashboard.announcementType', d.announcementType, { type: 'select', options: [['info', 'Info (blue)'], ['success', 'Success (green)'], ['warning', 'Warning (orange)'], ['danger', 'Important (red)']] })}</div>
    <h3 style="margin-top:10px">Maintenance mode</h3>
    ${toggle('Turn on maintenance (customers cannot watch)', 'userDashboard.maintenance', d.maintenance, 'Admins can still sign in.')}
    ${field('Maintenance message', 'userDashboard.maintenanceMessage', d.maintenanceMessage, { type: 'textarea', rows: 2 })}
    <button class="btn primary">Save user dashboard</button>
    <p class="small muted">To block one person, use Disable on the Customers page.</p></form>`;
}

function adminBranding(s) {
  const b = s.branding;
  return `<div class="grid2" style="gap:18px;align-items:start"><form data-form="settings" class="card" data-preview="1"><h3>App identity</h3>
    ${field('App name', 'branding.appName', b.appName)}${field('Tagline', 'branding.tagline', b.tagline)}
    ${field('Logo image URL', 'branding.logoUrl', b.logoUrl, { ph: 'https://…/logo.png', help: 'Square image works best. Empty = letters badge.' })}
    <div class="grid3">${field('Main color', 'branding.primary', b.primary, { type: 'color' })}${field('Accent', 'branding.accent', b.accent, { type: 'color' })}${field('Background', 'branding.background', b.background, { type: 'color' })}</div>
    <h3>Login page</h3>
    ${field('Title', 'branding.loginTitle', b.loginTitle)}${field('Subtitle', 'branding.loginSubtitle', b.loginSubtitle, { type: 'textarea', rows: 2 })}
    ${field('Background image URL', 'branding.loginBgUrl', b.loginBgUrl, { ph: 'https://…/background.jpg' })}
    ${field('WhatsApp number', 'branding.whatsapp', b.whatsapp, { type: 'tel', ph: '66812345678', help: 'With country code, no + or spaces (Thailand 66…, Morocco 212…). Shows a green WhatsApp button on the login page and in every customer account.' })}
    <div class="grid2">${field('Support button text', 'branding.supportLabel', b.supportLabel)}${field('Support link', 'branding.supportUrl', b.supportUrl, { ph: 'https://line.me/ti/p/~yourid' })}</div>
    ${field('Footer text', 'branding.footerText', b.footerText, { ph: '© 2026 Your company' })}
    <button class="btn primary">Save branding</button></form>
    <div><h3>Live preview</h3><div class="preview-box" id="login-preview">${loginCard(b, { preview: true })}</div></div></div>`;
}

function adminApi(s) {
  const r = s.reseller;
  const placeholders = ['{base}', '{key}', '{reseller_user}', '{reseller_pass}', '{username}', '{password}', '{line_id}', '{package}', '{connections}', '{days}', '{months}', '{name}', '{phone}', '{note}'];
  return `<form data-form="settings">
  <div class="card"><h3>1 · Streaming server (customers watch from here)</h3>
    <p class="small muted">The Xtream-style DNS/URL from TVplus, the same one you'd type into IPTV Smarters.</p>
    ${field('Server URL', 'player.serverUrl', s.player.serverUrl, { ph: 'http://your-dns.com:8080', attrs: 'autocapitalize="none"' })}
    ${field('Playback mode', 'player.mode', s.player.mode || 'proxy', { type: 'select', options: [['proxy', 'Through the app server (works in every browser)'], ['direct', 'Direct from each device (for servers that block Cloudflare)']], help: 'Direct: the Android / Android TV app connects to your IPTV server itself and plays with its built-in player. Windows/Mac apps also connect directly; iPhone, iPad and browsers play through the Stream relay below.' })}
    ${field('Stream relay URL (iPhone, iPad & browsers)', 'player.relayUrl', s.player.relayUrl, { ph: 'https://intproto-tv-relay.onrender.com', attrs: 'autocapitalize="none"', help: 'Used in Direct mode for devices without our app. Deploy it free on Render (see README). Empty = those devices are asked to install the app.' })}
    ${toggle('Play through the built-in secure proxy (recommended)', 'player.useProxy', s.player.useProxy, 'Fixes "http" streams on iPhone/HTTPS and hides the server from customers. Note: Cloudflare only connects to ports 80, 8080, 8880, 2052, 2082, 2086, 2095 (http) or 443, 8443, 2053, 2083, 2087, 2096 (https).')}
    ${field('Player identity (User-Agent)', 'player.userAgent', s.player.userAgent, { help: 'Some IPTV servers only accept known players. Default: IPTVSmartersPro.' })}
    <div class="grid3" style="margin-top:12px">${field('Test line username', 'tu', '', { attrs: 'data-skip id="test-u" autocapitalize="none"' })}${field('Test line password', 'tp', '', { attrs: 'data-skip id="test-p" autocapitalize="none"' })}<div class="field"><span>&nbsp;</span><button type="button" class="btn" data-act="test-player">Test server</button></div></div>
    <div id="test-player-out"></div>
  </div>
  <div class="card"><h3>2 · TVplus reseller API (create / renew lines)</h3>
    ${toggle('Enable reseller API', 'reseller.enabled', r.enabled)}
    ${toggle('Auto-sync enable/disable with the panel', 'reseller.autoSync', r.autoSync)}
    <div class="grid2" style="margin-top:12px">${field('API base URL', 'reseller.baseUrl', r.baseUrl, { ph: 'https://panel.tvpluspanel.com', attrs: 'autocapitalize="none"', help: 'Used as {base}' })}${field('API key / token', 'reseller.apiKey', r.apiKey, { type: 'password', attrs: 'autocomplete="off"', help: 'Used as {key}. Stored on the server only.' })}</div>
    <div class="grid2">${field('Reseller username', 'reseller.username', r.username, { attrs: 'autocapitalize="none"', help: '{reseller_user}' })}${field('Reseller password', 'reseller.password', r.password, { type: 'password', help: '{reseller_pass}' })}</div>
    <div class="grid3">${field('New line username in response', 'reseller.usernamePath', r.usernamePath, { ph: 'e.g. username or data.username', help: 'If TVplus creates the username, the app uses it.' })}${field('New line password in response', 'reseller.passwordPath', r.passwordPath, { ph: 'e.g. password' })}${field('DNS in response (optional)', 'reseller.dnsPath', r.dnsPath, { ph: 'e.g. dns or data.url' })}</div>
    <div class="grid2">${field('Where is the new line ID in the response?', 'reseller.idPath', r.idPath, { help: 'e.g. <code>id</code> or <code>data.id</code>' })}${field('Where are credits in the response?', 'reseller.creditsPath', r.creditsPath, { help: 'e.g. <code>credits</code> or <code>data.credits</code>' })}</div>
    <h3 style="margin-top:8px">API actions</h3>
    <p class="small muted">Copy each call from the TVplus API docs. These placeholders are filled in automatically:</p>
    <div class="tags">${placeholders.map((p) => `<code>${p}</code>`).join('')}</div>
    ${Object.entries(r.actions).map(([k, a]) => `<div class="action-row"><h4>${k}</h4><div>
      <div class="row" style="align-items:flex-start;flex-wrap:nowrap"><select name="reseller.actions.${k}.method" style="width:96px">${['GET', 'POST', 'PUT', 'DELETE'].map((m) => `<option ${a.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select><input name="reseller.actions.${k}.url" value="${esc(a.url)}" placeholder="{base}/api/…" autocapitalize="none"></div>
      <details style="margin-top:6px"><summary class="small muted" style="cursor:pointer">Body & headers</summary>
      <div style="margin-top:8px">${field('Body (for POST — JSON or form text)', `reseller.actions.${k}.body`, a.body, { type: 'textarea', rows: 3, ph: '{"username":"{username}","password":"{password}","package":"{package}"}' })}${field('Headers (one per line)', `reseller.actions.${k}.headers`, a.headers, { type: 'textarea', rows: 2, ph: 'Authorization: Bearer {key}' })}</div></details>
    </div></div>`).join('')}
    <div class="row" style="margin-top:14px"><button type="button" class="btn" data-act="test-reseller">Test API (get credits)</button></div>
    <div id="test-reseller-out"></div>
  </div>
  <div class="row" style="position:sticky;bottom:12px"><button class="btn primary">💾 Save API settings</button></div>
  </form>`;
}

async function adminSecurity(s) {
  const me = state.admin.me;
  if (me.role !== 'owner') return `<form data-form="staff-password" class="card" style="max-width:520px"><h3>My login</h3><p class="muted small">Signed in as <b>${esc(me.username)}</b>. Permissions: ${me.perms.map((p) => `<span class="tagp">${esc((me.allPerms.find((x) => x[0] === p) || [p, p])[1])}</span>`).join(' ') || 'none'}</p>
    ${field('Current password', 'current', '', { type: 'password', attrs: 'required' })}${field('New password', 'next', '', { type: 'password', attrs: 'required minlength="6"' })}<button class="btn primary">Change my password</button></form>${twoFactorCard(me)}`;
  return `<div class="grid2" style="gap:16px;align-items:start">
  <form data-form="admin-account" class="card"><h3>Admin login details</h3>
    ${field('Admin username', 'username', me.username, { attrs: 'autocapitalize="none"' })}
    ${field('New password (leave empty to keep)', 'newPassword', '', { type: 'password' })}
    ${field('Current password (required)', 'currentPassword', '', { type: 'password', attrs: 'required' })}
    <button class="btn primary">Update admin login</button></form>
  <div>${twoFactorCard(me)}<form data-form="settings" class="card"><h3>Sessions</h3>
    ${field('Keep users signed in for (hours)', 'security.sessionHours', s.security.sessionHours, { type: 'number', attrs: 'min="1" max="2160"' })}
    <button class="btn primary">Save</button></form>
  <div class="card"><h3>Backup</h3><p class="small muted">Download all settings and customers, or restore from a backup file.</p>
    <div class="row"><button class="btn" data-act="backup">⬇ Download backup</button><label class="btn">⬆ Restore<input type="file" accept=".json" data-input="restore" hidden></label></div>
    ${state.mode === 'demo' ? `<hr style="border-color:var(--line);margin:16px 0"><p class="small muted">Demo mode keeps data in this browser only.</p><button class="btn danger" data-act="reset-demo">Reset demo data</button>` : ''}
  </div></div></div>`;
}

async function adminActivity() {
  const log = await api('GET', '/api/admin/log');
  const icon = { customer: '👤', renewal: '🔁', settings: '⚙️', admin: '🔐', team: '🛡', finance: '🏦', stock: '🎟', trial: '🎁', daily: '⏰' };
  return `<div class="card">${log.length ? log.map((l) => `<div class="list-item"><span>${icon[l.type] || '•'}</span><div style="flex:1">${esc(l.msg)}${l.by ? `<div class="small muted">by ${esc(l.by)}</div>` : ''}</div><span class="small muted">${fmtDT(l.at)}</span></div>`).join('') : '<p class="muted">No activity yet.</p>'}</div>`;
}

function showResult(el, r) {
  el.innerHTML = `<div class="notice ${r.ok ? 'success' : 'danger'}" style="margin-top:12px"><b>${r.ok ? '✅ Connected' : '❌ ' + esc(r.error || 'Failed')}</b>${r.credits != null ? ` · Credits: <b>${esc(r.credits)}</b>` : ''}${r.data != null ? `<div class="code" style="margin-top:8px">${esc(typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2)).slice(0, 3000)}</div>` : ''}</div>`;
}

// ---------------- animations ----------------
function animateIn(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('.stat b').forEach((el) => {
    const m = el.textContent.match(/^([^\d−-]*)([−-]?)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    const target = Number(m[3].replace(/,/g, '')); if (!isFinite(target) || target === 0) return;
    const dec = (m[3].split('.')[1] || '').length; const t0 = performance.now(); const dur = 900;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - k, 3);
      el.textContent = m[1] + m[2] + (target * e).toLocaleString(undefined, { minimumFractionDigits: k < 1 ? 0 : dec, maximumFractionDigits: dec }) + m[4];
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ---------------- team & access ----------------
const PRESETS = {
  'Sales agent': ['customers_view', 'customers_edit'],
  Accountant: ['finance_view', 'finance_edit', 'profits', 'stock'],
  Manager: ['customers_view', 'customers_edit', 'customers_delete', 'finance_view', 'finance_edit', 'profits', 'stock', 'plans', 'activity'],
  'Full access': null,
};
async function adminTeam() {
  const team = await api('GET', '/api/admin/team');
  state.admin.team = team;
  const all = state.admin.me.allPerms;
  return `<div class="row" style="margin-bottom:14px"><p class="muted" style="margin:0;flex:1">Give your team their own login. They sign in on the same page, and only see what you allow. Every action is logged with their name.</p><button class="btn primary" data-act="new-member">＋ Add team member</button></div>
  ${team.length ? `<div class="team-grid">${team.map((m) => `<div class="tm ${m.status === 'disabled' ? 'off' : ''}">
    <div class="row"><div class="avatar">${esc(initials(m.name))}</div><div style="flex:1;min-width:0"><b>${esc(m.name)}</b><div class="small muted">${esc(m.role || 'Staff')} · @${esc(m.username)}</div></div>${pill(m.status === 'disabled' ? 'disabled' : 'active')}</div>
    <div class="perm-tags">${(m.perms || []).map((p) => `<span class="tagp">${esc((all.find((x) => x[0] === p) || [p, p])[1])}</span>`).join('') || '<span class="small muted">No permissions</span>'}</div>
    <div class="small muted">Last sign-in: ${m.lastLogin ? fmtDT(m.lastLogin) : 'never'}</div>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-act="edit-member" data-id="${m.id}">Edit</button><button class="btn sm" data-act="toggle-member" data-id="${m.id}">${m.status === 'disabled' ? 'Enable' : 'Disable'}</button><button class="btn sm danger" data-act="del-member" data-id="${m.id}">🗑</button></div>
  </div>`).join('')}</div>` : `<div class="empty card"><span class="ic">🛡</span>No team members yet.</div>`}`;
}
function memberForm(m) {
  const all = state.admin.me.allPerms; const isNew = !m;
  m = m || { perms: PRESETS['Sales agent'], role: 'Sales agent' };
  return `<form data-form="member" data-id="${m.id || ''}">
    <div class="grid2">${field('Name', 'name', m.name || '', { attrs: 'required' })}${field('Role / title', 'role', m.role || '', { ph: 'e.g. Sales agent' })}</div>
    <div class="grid2">${field('Username', 'username', m.username || '', { attrs: (isNew ? 'required minlength="3"' : 'disabled') + ' autocapitalize="none"' })}${field(isNew ? 'Password' : 'New password (optional)', 'password', '', { type: 'password', attrs: isNew ? 'required minlength="6"' : '' })}</div>
    <h3>Permissions</h3>
    <div class="chips">${Object.keys(PRESETS).map((k) => `<a data-act="preset" data-p="${esc(k)}">${esc(k)}</a>`).join('')}</div>
    <div class="perm-list">${all.map(([k, label]) => `<label class="toggle"><input type="checkbox" data-perm-cb value="${k}" ${m.perms.includes(k) ? 'checked' : ''}><i></i><span>${esc(label)}</span></label>`).join('')}</div>
    <p class="small muted">Only you (the owner) can manage the team, backups and your owner login.</p>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">${isNew ? 'Add member' : 'Save'}</button></div>
  </form>`;
}

// ---------------- charts ----------------
function lineChart(series, { height = 160, fmt = (v) => v } = {}) {
  const all = series.flatMap((x) => x.values);
  if (!all.length) return '';
  let min = Math.min(0, ...all), max = Math.max(...all);
  if (max === min) max = min + 1;
  const W = 600, H = height, n = series[0].values.length;
  const X = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const Y = (v) => H - 6 - ((v - min) / (max - min)) * (H - 12);
  const zero = min < 0 ? `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(255,255,255,.15)" stroke-dasharray="4 4"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px;display:block">${zero}${series.map((s) => {
    const pts = s.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    return `${s.fill ? `<polygon points="0,${H} ${pts} ${W},${H}" fill="${s.color}" opacity=".12"/>` : ''}<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  }).join('')}</svg><div class="row small muted" style="justify-content:space-between"><span>${fmt(min)}</span><span>${fmt(max)}</span></div>`;
}
function hBars(items, fmt) {
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return items.map((i) => `<div class="hbar"><span class="hb-l">${esc(i.label)}</span><div class="hb-t"><i style="width:${(Math.abs(i.value) / max) * 100}%;background:${i.value < 0 ? 'var(--bad)' : i.color || 'var(--primary)'}"></i></div><b>${fmt(i.value)}</b></div>`).join('');
}
const accountSelect = (s, name, value, label = 'Paid into (bank / wallet)', opts = {}) => field(label, name, value, {
  type: 'select', options: [...(opts.none === false ? [] : [['', '— not recorded —']]), ...s.finance.accounts.map((a) => [a.id, `${a.name} (${a.currency})`])],
});

// ---------------- finance ----------------
async function adminFinance(s) {
  const f = await api('GET', '/api/admin/finance');
  state.admin.finance = f;
  const tx = await api('GET', '/api/admin/tx' + (state.admin.txAccount ? '?account=' + state.admin.txAccount : ''));
  const accName = (id) => f.accounts.find((a) => a.id === id)?.name || '—';
  const accCur = (id) => f.accounts.find((a) => a.id === id)?.currency || '';
  const labels = f.points.map((p) => new Date(p).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  return `<div class="stats">
      <div class="stat c-acc"><span>Total balance (USD)</span><b>${usd(f.totalUsd)}</b></div>
      <div class="stat c-ok"><span>Total balance (MAD)</span><b>${mad(f.totalMad)}</b></div>
      <div class="stat"><span>1 USD =</span><b>${num(f.rates.MAD, 'MAD')}</b><span>${f.ratesUpdatedAt ? 'updated ' + fmtDT(f.ratesUpdatedAt) : 'manual rate'} · <a data-act="refresh-rates" data-perm="finance_edit" style="cursor:pointer">refresh</a></span></div>
    </div>
    <div id="stripe-box"></div>
    <div class="row" style="margin-bottom:14px"><button class="btn primary" data-act="new-tx" data-perm="finance_edit" data-type="income">＋ Income</button><button class="btn" data-act="new-tx" data-perm="finance_edit" data-type="expense">− Expense</button><button class="btn" data-act="new-tx" data-perm="finance_edit" data-type="transfer">⇄ Transfer</button></div>
    <div class="grid2" style="gap:16px;align-items:start">
      <div class="card"><h3>Balance by bank (USD)</h3>${hBars(f.accounts.map((a) => ({ label: a.name, value: a.usd, color: a.color })), usd)}</div>
      <div class="card"><h3>Total balance · last 30 days (USD)</h3>${lineChart([{ values: f.totalHistoryUsd, color: 'var(--accent)', fill: true }], { fmt: usd })}<div class="row small muted" style="justify-content:space-between"><span>${labels[0]}</span><span>${labels.at(-1)}</span></div></div>
    </div>
    <div class="acc-grid">${f.accounts.map((a) => `<div class="acc" style="border-top:3px solid ${esc(a.color)}">
      <div class="row"><b>${esc(a.name)}</b><span class="spacer"></span><span class="small muted">${esc(a.currency)}</span></div>
      <div class="acc-bal ${a.balance < 0 ? 'neg' : ''}">${num(a.balance, a.currency)}</div>
      <div class="small muted">≈ ${usd(a.usd)} · ${mad(a.mad)}</div>
      ${lineChart([{ values: f.history[a.id] || [], color: a.color, fill: true }], { height: 60, fmt: (v) => num(v) })}
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="new-tx" data-perm="finance_edit" data-type="income" data-acc="${a.id}">＋</button><button class="btn sm" data-act="new-tx" data-perm="finance_edit" data-type="expense" data-acc="${a.id}">−</button><button class="btn sm" data-act="new-tx" data-perm="finance_edit" data-type="transfer" data-acc="${a.id}">⇄</button><span class="spacer"></span><a class="small" data-act="tx-filter" data-acc="${a.id}" style="cursor:pointer">history</a></div>
    </div>`).join('')}</div>
    <div class="card"><div class="row" style="margin-bottom:8px"><h3 style="margin:0">Transactions${state.admin.txAccount ? ' · ' + esc(accName(state.admin.txAccount)) : ''}</h3><span class="spacer"></span>${state.admin.txAccount ? '<button class="btn sm" data-act="tx-filter" data-acc="">Show all</button>' : ''}<button class="btn sm" data-act="export-tx">⬇ CSV</button></div>
      ${tx.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Account</th><th>Category / note</th><th style="text-align:right">Amount</th><th></th></tr></thead><tbody>${tx.map((x) => `<tr>
        <td class="small">${fmtDT(x.at)}</td><td>${x.type === 'income' ? '🟢 in' : x.type === 'expense' ? '🔴 out' : '🔁 transfer'}</td>
        <td>${esc(accName(x.accountId))}${x.toAccountId ? ` → ${esc(accName(x.toAccountId))}` : ''}</td><td><b>${esc(x.category)}</b><div class="small muted">${esc(x.note)}</div></td>
        <td style="text-align:right;white-space:nowrap" class="${x.type === 'income' ? 'pos' : x.type === 'expense' ? 'neg' : ''}">${x.type === 'expense' ? '−' : x.type === 'income' ? '+' : ''}${num(x.amount, accCur(x.accountId))}${x.toAccountId ? `<div class="small muted">→ ${num(x.toAmount, accCur(x.toAccountId))}</div>` : ''}</td>
        <td><button class="btn sm ghost" data-act="del-tx" data-perm="finance_edit" data-id="${x.id}">🗑</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No transactions yet.</p>'}
    </div>
    <details class="card" data-perm="finance_edit"><summary style="cursor:pointer"><b>⚙️ Banks, wallets & exchange rates</b></summary>
      <div style="margin-top:12px"><div class="acc-row small muted"><span>Name</span><span>Currency</span><span>Opening balance</span><span>Color</span><span></span></div>
      <div id="acc-rows">${s.finance.accounts.map(accRow).join('')}</div>
      <button class="btn sm" data-act="add-acc">＋ Add bank / wallet</button>
      <h3 style="margin-top:16px">Exchange rates (units per 1 USD)</h3>
      <div class="grid3" id="rates">${Object.entries(s.finance.rates).map(([k, v]) => field(k, 'rate-' + k, v, { type: 'number', attrs: `step="any" data-rate="${k}" ${k === 'USD' ? 'readonly' : ''}` })).join('')}</div>
      <h3 style="margin-top:16px">Stripe connection (optional)</h3>
      ${field('Stripe secret or restricted key', 'stripe-key', s.finance.stripeKey || '', { type: 'password', attrs: 'id="stripe-key" autocomplete="off" data-skip', help: 'Stripe Dashboard → Developers → API keys → Create restricted key with <b>Balance: Read</b>. The app then shows your real Stripe balance and can match the Stripe bank to it.' })}
      <label class="toggle"><input type="checkbox" id="auto-rates" ${s.finance.autoRates ? 'checked' : ''}><i></i><span>Update rates automatically every day<small>MAD, EUR, THB from a free rates service. USDT stays 1:1 with USD.</small></span></label>
      <button class="btn primary" data-act="save-accounts" style="margin-top:10px">Save banks & rates</button></div>
    </details>`;
}
const accRow = (a) => `<div class="acc-row" data-acc="${esc(a.id || '')}"><input data-k="name" value="${esc(a.name)}" placeholder="Name"><select data-k="currency">${['MAD', 'USD', 'USDT', 'EUR', 'THB'].map((c) => `<option ${a.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select><input data-k="opening" type="number" step="any" value="${a.opening || 0}"><input data-k="color" type="color" value="${esc(a.color || '#7c5cff')}"><button class="btn sm danger" data-act="del-acc">✕</button></div>`;

async function loadStripe() {
  const box = $('#stripe-box'); if (!box) return;
  const r = await api('GET', '/api/admin/stripe/balance').catch(() => null);
  if (!r || !r.connected) return;
  if (r.error) { box.innerHTML = `<div class="notice danger">Stripe: ${esc(r.error)}</div>`; return; }
  const diff = Math.round((r.available + r.pending - r.app) * 100) / 100;
  box.innerHTML = `<div class="card" style="border-color:#635bff55"><div class="row"><h3 style="margin:0">💳 Stripe (live)</h3><span class="spacer"></span>${diff ? `<button class="btn sm primary" data-act="stripe-match" data-target="${r.available + r.pending}" data-perm="finance_edit">Sync app to Stripe</button>` : '<span class="pill st-active">in sync</span>'}</div>
    <div class="row small" style="margin-top:8px;gap:18px"><span>Available: <b>${num(r.available, r.currency)}</b></span><span>Pending: <b>${num(r.pending, r.currency)}</b></span><span>In the app: <b>${num(r.app, r.currency)}</b></span>${diff ? `<span class="${diff > 0 ? 'pos' : 'neg'}">Difference: ${num(diff, r.currency)}</span>` : ''}</div>
    ${r.otherCurrencies.length ? `<div class="small muted" style="margin-top:6px">Other currencies in Stripe: ${esc(r.otherCurrencies.join(', '))}</div>` : ''}</div>`;
}
function txForm(type, accId) {
  const s = state.admin.settings;
  const accs = s.finance.accounts;
  const cats = type === 'income' ? ['Sale', 'Deposit', 'Refund', 'Other'] : type === 'expense' ? ['Credits purchase', 'Fees', 'Ads', 'Salary', 'Hosting', 'Withdrawal', 'Other'] : ['Transfer', 'Exchange'];
  return `<form data-form="tx">
    ${field('Type', 'type', type, { type: 'select', options: [['income', '🟢 Income (money in)'], ['expense', '🔴 Expense (money out)'], ['transfer', '🔁 Transfer between banks']], attrs: 'data-tx-type' })}
    <div class="grid2">${field(type === 'transfer' ? 'From' : 'Bank / wallet', 'accountId', accId || accs[0]?.id, { type: 'select', options: accs.map((a) => [a.id, `${a.name} (${a.currency})`]) })}
    ${field('Amount', 'amount', '', { type: 'number', attrs: 'step="any" min="0" required' })}</div>
    ${type === 'transfer' ? `<div class="grid2">${field('To', 'toAccountId', accs.find((a) => a.id !== (accId || accs[0]?.id))?.id, { type: 'select', options: accs.map((a) => [a.id, `${a.name} (${a.currency})`]) })}${field('Amount received', 'toAmount', '', { type: 'number', attrs: 'step="any" min="0"', help: 'Leave empty to convert with today\'s rate.' })}</div>` : ''}
    <div class="grid2">${field('Category', 'category', cats[0], { attrs: 'list="cats"' })}<datalist id="cats">${cats.map((c) => `<option value="${c}">`).join('')}</datalist>${field('Date', 'date', isoDay(Date.now()), { type: 'date' })}</div>
    ${field('Note', 'note', '')}
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div>
  </form>`;
}

// ---------------- profits ----------------
async function adminProfits(s) {
  const per = state.admin.period || 'month';
  const p = await api('GET', '/api/admin/profits?period=' + per);
  const r = p.madRate;
  const max = Math.max(1e-9, ...p.buckets.map((b) => Math.max(b.revenueUsd, b.netUsd)));
  const lab = (k) => per === 'year' ? k : per === 'month' ? `${k.slice(5)}/${k.slice(2, 4)}` : new Date(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const cur = p.buckets.at(-1);
  return `<div class="chips">${[['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']].map(([k, n]) => `<a class="${per === k ? 'on' : ''}" data-act="period" data-p="${k}">${n}</a>`).join('')}</div>
    <div class="stats">
      <div class="stat"><span>This ${per} · sales</span><b>${cur.sales}</b></div>
      <div class="stat c-acc"><span>This ${per} · revenue</span><b>${usd(cur.revenueUsd)}</b><span>${mad(cur.revenueUsd * r)}</span></div>
      <div class="stat c-ok"><span>This ${per} · net profit</span><b>${usd(cur.netUsd)}</b><span>${mad(cur.netUsd * r)}</span></div>
      <div class="stat"><span>All time · profit</span><b>${usd(p.totals.profitUsd)}</b><span>${mad(p.totals.profitUsd * r)}</span></div>
    </div>
    <div class="card"><div class="row"><h3 style="margin:0">Revenue vs profit (USD)</h3><span class="spacer"></span><span class="small"><span class="dot" style="background:var(--accent)"></span> revenue <span class="dot" style="background:var(--ok)"></span> net profit</span></div>
      <div class="bars2">${p.buckets.map((b) => `<div><div class="bb"><i style="height:${(Math.max(0, b.revenueUsd) / max) * 100}%;background:var(--accent)"></i><i style="height:${(Math.max(0, b.netUsd) / max) * 100}%;background:var(--ok)"></i></div><span>${lab(b.key)}</span></div>`).join('')}</div></div>
    <div class="card"><h3>Breakdown</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${per}</th><th>Sales</th><th>Revenue</th><th>Credits cost</th><th>Other expenses</th><th>Net profit</th></tr></thead><tbody>
      ${p.buckets.slice().reverse().map((b) => `<tr><td>${lab(b.key)}</td><td>${b.sales}</td><td>${usd(b.revenueUsd)}</td><td>${usd(b.costUsd)}</td><td>${usd(b.otherUsd)}</td><td><b class="${b.netUsd < 0 ? 'neg' : 'pos'}">${usd(b.netUsd)}</b><div class="small muted">${mad(b.netUsd * r)}</div></td></tr>`).join('')}
    </tbody></table></div><p class="small muted">Credits cost = credits used × average cost per credit (from your stock purchases). Other expenses = expenses you add in Banks & balances (except credit purchases).</p></div>
    <div class="card"><h3>Profit on every sale</h3>${p.recent.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Customer</th><th>Plan</th><th>Paid</th><th>Credits</th><th>Cost</th><th>Profit</th></tr></thead><tbody>
      ${p.recent.map((x) => `<tr><td class="small">${fmtDT(x.at)}</td><td>${esc(x.name)}<div class="small muted">${esc(x.username)}</div></td><td>${esc(x.planName)}</td><td>${num(x.amount, x.currency)}<div class="small muted">${usd(x.amountUsd)}</div></td><td>${x.credits}</td><td>${usd(x.costUsd)}</td><td><b class="${x.profitUsd < 0 ? 'neg' : 'pos'}">${usd(x.profitUsd)}</b></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No sales yet.</p>'}</div>`;
}

// ---------------- stock ----------------
async function adminStock(s) {
  const st = await api('GET', '/api/admin/stock?panel=1');
  const pk = s.stock;
  return `${st.low ? `<div class="notice warning">🎟 Stock is low: <b>${st.available}</b> credits left (alert at ${pk.lowCreditsAlert}).</div>` : ''}
    ${st.panel && st.panel.ok && Number(st.panel.credits) <= pk.lowCreditsAlert ? `<div class="notice danger">⚠️ Your TVplus panel has only <b>${esc(st.panel.credits)}</b> credits left.</div>` : ''}
    <div class="stats">
      <div class="stat ${st.low ? 'c-bad' : 'c-ok'}"><span>Credits in stock</span><b>${st.available}</b></div>
      <div class="stat"><span>Used (sales)</span><b>${st.used}</b></div>
      <div class="stat"><span>Bought (total)</span><b>${st.purchased}</b></div>
      <div class="stat c-acc"><span>Cost per credit</span><b>${usd(st.avgCostUsd)}</b><span>${mad(st.avgCostUsd * s.finance.rates.MAD)}</span></div>
      <div class="stat"><span>Panel credits (API)</span><b>${st.panel ? (st.panel.ok ? esc(st.panel.credits ?? '—') : '⚠️') : 'off'}</b></div>
    </div>
    <div class="grid2" style="gap:16px;align-items:start">
    <form class="card" data-form="stock"><h3>Buy credits from supplier</h3>
      <div class="row" style="margin-bottom:12px">${[1, 2, 5].map((n) => `<button type="button" class="btn sm" data-act="pack" data-n="${n}">${n} pack${n > 1 ? 's' : ''} · ${pk.packCredits * n} cr · $${pk.packPrice * n}</button>`).join('')}</div>
      <div class="grid2">${field('Credits', 'credits', pk.packCredits, { type: 'number', attrs: 'min="1" required' })}${field('Cost', 'cost', pk.packPrice, { type: 'number', attrs: 'step="any" min="0"', help: 'In the currency of the account below.' })}</div>
      ${accountSelect(s, 'accountId', s.finance.accounts.find((a) => a.currency !== 'MAD')?.id || '', 'Paid from (bank / wallet)')}
      <div class="grid2">${field('Supplier', 'supplier', 'TVplus')}${field('Date', 'date', isoDay(Date.now()), { type: 'date' })}</div>
      <button class="btn primary">Add to stock</button></form>
    <form class="card" data-form="settings"><h3>Stock settings</h3>
      <div class="grid2">${field('Credits per pack', 'stock.packCredits', pk.packCredits, { type: 'number' })}${field('Pack price (USD)', 'stock.packPrice', pk.packPrice, { type: 'number', attrs: 'step="any"' })}</div>
      ${field('Remind me when credits are at or below', 'stock.lowCreditsAlert', pk.lowCreditsAlert, { type: 'number', help: 'Shown on the dashboard, and emailed daily if set up in "Trial & email".' })}
      <button class="btn primary">Save</button></form></div>
    <div class="card"><h3>Purchases</h3>${st.purchases.length ? st.purchases.map((x) => `<div class="list-item"><span>🎟</span><div style="flex:1"><b>${x.credits} credits</b> · ${esc(x.supplier)}<div class="small muted">${fmtDate(x.at)} · ${num(x.cost, x.currency)} (${usd(x.costUsd)})</div></div><button class="btn sm ghost" data-act="del-stock" data-id="${x.id}">🗑</button></div>`).join('') : '<p class="muted">No purchases yet.</p>'}</div>`;
}

// ---------------- trial & email ----------------
function adminTrial(s) {
  const tr = s.trial, e = s.email;
  return `<form data-form="settings"><div class="grid2" style="gap:16px;align-items:start">
    <div class="card"><h3>🎁 Free trial</h3>
      ${toggle('Allow free trial sign-up on the login page', 'trial.enabled', tr.enabled, 'Customers enter name, email, phone and WhatsApp. One trial per email/phone.')}
      <div class="grid2" style="margin-top:10px">${field('Trial length (hours)', 'trial.hours', tr.hours, { type: 'number', attrs: 'min="1" max="168"' })}${field('Credits a trial uses', 'trial.credits', tr.credits, { type: 'number', attrs: 'min="0" step="any"' })}</div>
      <div class="grid2">${field('Trial package ID on panel', 'trial.package', tr.package, { help: 'Sent as {package} with the "trial" API action.' })}${field('Devices', 'trial.connections', tr.connections, { type: 'number', attrs: 'min="1"' })}</div>
      ${toggle('Also show the login on screen', 'trial.showCredentialsOnScreen', tr.showCredentialsOnScreen, 'If off, the login is only sent by email (stops fake emails). It is always shown if the email fails.')}
      <p class="small muted">The panel call for trials is the <b>trial</b> action in API settings.</p>
    </div>
    <div class="card"><h3>✉️ Email (Resend)</h3>
      ${field('Resend API key', 'email.resendKey', e.resendKey, { type: 'password', attrs: 'autocomplete="off"', ph: 're_…', help: 'From resend.com → API Keys. Stored on the server only.' })}
      ${field('Send from', 'email.from', e.from, { ph: 'My IPTV <noreply@yourdomain.com>', help: 'Must use a domain verified in Resend. For a quick test use <code>onboarding@resend.dev</code> (only sends to your own Resend email).' })}
      ${field('App link in emails', 'email.appUrl', e.appUrl || location.origin, { attrs: 'autocapitalize="none"' })}
      ${field('DNS / Portal shown to customers', 'email.dns', e.dns, { ph: s.player.serverUrl || 'http://line.yourdns.com', attrs: 'autocapitalize="none"', help: 'Used in the email for Username / Password / DNS and the M3U links. Empty = your streaming server URL.' })}
      <div class="grid2">${field('Support email', 'email.supportEmail', e.supportEmail, { type: 'email', ph: 'contact@intproto-tv.com', attrs: 'autocapitalize="none"' })}${field('Website', 'email.website', e.website, { ph: 'https://intproto-tv.com', attrs: 'autocapitalize="none"' })}</div>
      ${field('Your email (for alerts)', 'email.adminEmail', e.adminEmail, { type: 'email', attrs: 'autocapitalize="none"' })}
      ${toggle('Email me when credits are low (daily check)', 'email.lowCreditAlerts', e.lowCreditAlerts)}
      ${toggle('Email customers before their subscription ends', 'email.expiryReminders', e.expiryReminders)}
      ${field('Days before expiry', 'email.reminderDays', e.reminderDays, { type: 'number', attrs: 'min="1" max="30"' })}
      <div class="row"><input id="test-to" placeholder="send test to…" value="${esc(e.adminEmail)}" data-skip style="flex:1"><button type="button" class="btn" data-act="test-email">Send test</button></div><div id="test-email-out"></div>
    </div></div>
    <div class="card"><h3>🔁 Renewal offer (email to expired customers)</h3>
      <p class="small muted" style="margin-top:0">Uses your renewal template. Sent in the customer's language (Arabic, French, English).</p>
      <div class="grid2">${field('Offer title', 'renewalOffer.title', s.renewalOffer.title)}${field('Price shown', 'renewalOffer.price', s.renewalOffer.price, { ph: '$109.99' })}</div>
      <div class="grid3">${field('Bonus badge', 'renewalOffer.bonus', s.renewalOffer.bonus, { ph: 'Including 2 FREE Months' })}${field('Coupon code', 'renewalOffer.coupon', s.renewalOffer.coupon)}${field('Renew button link', 'renewalOffer.url', s.renewalOffer.url, { attrs: 'autocapitalize="none"' })}</div>
      ${toggle('Send automatically when a subscription or trial ends', 'renewalOffer.auto', s.renewalOffer.auto, 'Checked once a day. Each customer gets it once per expiry.')}
      <div class="grid2" style="margin-top:10px">${field('Only if expired within (days)', 'renewalOffer.autoDays', s.renewalOffer.autoDays, { type: 'number', attrs: 'min="1" max="60"' })}${field('Max renewal emails per day', 'renewalOffer.dailyLimit', s.renewalOffer.dailyLimit, { type: 'number', attrs: 'min="1" max="5000"', help: 'Resend free plan: 100 emails/day, 3,000/month.' })}</div>
      <div class="row"><button type="button" class="btn" data-act="renewal-bulk">🔁 Send to expired customers…</button></div>
    </div>
    <button class="btn primary">💾 Save trial & email settings</button></form>`;
}

// ---------------- USER ----------------
const favKey = () => 'tvp_fav_' + (state.user.me?.user.id || '');
const getFavs = () => { try { return JSON.parse(localStorage.getItem(favKey())) || []; } catch { return []; } };
const isFav = (kind, id) => getFavs().some((f) => f.kind === kind && String(f.id) === String(id));
function toggleFav(item) {
  let f = getFavs();
  if (f.some((x) => x.kind === item.kind && String(x.id) === String(item.id))) f = f.filter((x) => !(x.kind === item.kind && String(x.id) === String(item.id)));
  else f.unshift(item);
  localStorage.setItem(favKey(), JSON.stringify(f.slice(0, 200)));
}

async function renderUser() {
  const u = state.user;
  if (u.me && Date.now() - (u.meAt || 0) > 15000) { try { const fresh = await api('GET', '/api/me'); if (JSON.stringify(fresh.stream) !== JSON.stringify('_stream' in u.me ? u.me._stream : u.me.stream)) u.cache = {}; u.me = fresh; u.meAt = Date.now(); applySource(); } catch { return; } }
  if (!u.me) {
    $('#app').innerHTML = `<div class="boot"><div class="spinner"></div></div>`;
    try { u.me = await api('GET', '/api/me'); u.meAt = Date.now(); applySource(); } catch { return; }
    applyBranding(u.me.branding);
  }
  const { user, dashboard: d, branding: b } = u.me;
  const tabs = [['home', ic('home'), t('home')], d.live && ['live', ic('tv'), t('live')], d.movies && ['movies', ic('film'), t('movies')], d.series && ['series', ic('series'), t('series')], ['account', ic('user'), t('account')]].filter(Boolean);
  if (!tabs.some((t) => t[0] === u.tab)) u.tab = 'home';
  $('#app').innerHTML = `<div class="uapp"><div class="uhead">${brandHtml(b, false)}<span class="spacer"></span>${state.mode === 'demo' ? '<span class="badge-demo">Demo</span>' : ''}<button class="btn sm ghost" data-act="theme" title="Theme" style="font-size:18px">🌗</button><div class="avatar" data-act="utab" data-tab="account" style="cursor:pointer">${esc(initials(user.name))}</div></div>
    <div class="ubody" id="ubody"></div>
    <nav class="bnav">${tabs.map(([k, ic, n]) => `<a class="${u.tab === k ? 'on' : ''}" data-act="utab" data-tab="${k}"><span class="ic">${ic}</span>${n}</a>`).join('')}</nav></div>`;
  renderUserTab();
}

function blockedScreen() {
  const { user, dashboard: d, branding: b } = state.user.me;
  if (d.maintenance) return `<div class="block-screen"><div class="ic">🛠</div><h2>${t('maintTitle')}</h2><p class="muted">${esc(d.maintenanceMessage)}</p></div>`;
  if (user.state === 'expired') return `<div class="block-screen"><div class="ic">⏰</div><h2>${t('expiredTitle')}</h2><p class="muted">${t('expiredText', { date: fmtDate(user.expiresAt) })}</p>${b.supportUrl ? `<a class="btn primary ${waNum(b) ? 'wa-btn' : ''}" href="${esc(waNum(b) ? waUrl(b, t('waMsg', { app: b.appName, u: user.username })) : b.supportUrl)}" target="_blank" rel="noopener">${waNum(b) ? '💬 ' + t('whatsapp') : esc(b.supportLabel || t('support'))}</a>` : ''}</div>${orderCard()}`;
  if (!state.user.me.stream) return `<div class="block-screen"><div class="ic">📡</div><h2>${t('notReady')}</h2><p class="muted">${t('notReadyText')}</p></div>`;
  return '';
}

async function renderUserTab() {
  if (state.user.me) setWaFab(state.user.me.branding, t('waMsg', { app: state.user.me.branding.appName, u: state.user.me.user.username }));
  const u = state.user; const el = $('#ubody');
  const { user, dashboard: d, branding: b } = u.me;
  if (u.tab === 'home') {
    if (!u.prefetched && !blockedScreen()) { u.prefetched = true; setTimeout(() => { const d = u.me.dashboard; [d.live && 'get_live_categories', d.movies && 'get_vod_categories', d.series && 'get_series_categories'].filter(Boolean).forEach((a) => xt(a).then((cats) => { const first = cats?.[0]?.category_id; if (first && a === 'get_live_categories') xt('get_live_streams', { category_id: first }).catch(() => {}); }).catch(() => {})); loadHls().catch(() => {}); }, 800); }
    const favs = d.favorites ? getFavs() : [];
    const renew = b.supportUrl ? `<a href="${esc(b.supportUrl)}" target="_blank" rel="noopener">${t('renewNow')}</a>` : t('contactRenew');
    const trialLeft = user.isTrial && user.state !== 'expired';
    pullNativePos();
    el.innerHTML = `<div class="welcome"><h2>${t('hello', { name: esc(user.name.split(' ')[0]) })}</h2><p class="muted">${t('overview')}</p></div>
      ${d.maintenance ? `<div class="notice warning">🛠 ${esc(d.maintenanceMessage)}</div>` : ''}
      ${d.announcement ? `<div class="notice ${esc(d.announcementType)}">📣 ${esc(d.announcement)}</div>` : ''}
      ${trialLeft ? `<div class="notice info">🎁 ${t('trialEnds', { n: user.hoursLeft })} ${renew}</div>` : ''}
      ${user.state === 'expiring' && !user.isTrial ? `<div class="notice warning">⏳ ${t('expiringSoon', { n: user.daysLeft })} ${renew}</div>` : ''}
      ${user.state === 'expired' ? `<div class="notice danger">⏰ ${t('expiredOn', { date: fmtDate(user.expiresAt) })} ${renew}</div>` : ''}
      ${srcBanner()}
      <div class="dash">
        ${d.showSubscription ? `<div class="dash-plan" data-act="utab" data-tab="account" tabindex="0"><div class="dp-top"><div><span class="dp-l">${t('activePlan')}</span><b>${esc(user.isTrial ? t('trial') : user.planName)}</b></div><div class="dp-r"><span class="dp-l">${t('expiresOn')}</span><b>${fmtDate(user.expiresAt)}</b></div></div>
          <div class="dp-days"><span class="big">${user.isTrial ? user.hoursLeft : Math.max(0, user.daysLeft)}</span><span class="muted small">${user.isTrial ? t('hoursLeft') : t('daysLeft')}</span><span class="spacer"></span>${pill(user.state)}</div>${progress(user)}</div>` : ''}
        <div class="dash-mini" data-act="goto-acc" data-to="acc-devices" tabindex="0"><span class="chip-ic ok">${ic('devices')}</span><div><span class="dp-l">${t('connectedDev')}</span><b id="dash-dev">– / ${esc(user.connections)}</b></div></div>
        <div class="dash-mini" data-act="goto-acc" data-to="acc-tickets" tabindex="0"><span class="chip-ic">${ic('chat')}</span><div><span class="dp-l">${t('supportT')}</span><b id="dash-tk">–</b></div></div>
      </div>
      <div class="tiles big">${d.live ? `<div class="tile t-live" data-act="utab" data-tab="live" tabindex="0">${ic('tv', 34)}<b>${t('liveTv')}</b></div>` : ''}${d.movies ? `<div class="tile t-movies" data-act="utab" data-tab="movies" tabindex="0">${ic('film', 34)}<b>${t('movies')}</b></div>` : ''}${d.series ? `<div class="tile t-series" data-act="utab" data-tab="series" tabindex="0">${ic('series', 34)}<b>${t('series')}</b></div>` : ''}</div>
      <h3>${t('quick')}</h3>
      <div class="quick"><a data-act="utab" data-tab="account" tabindex="0">${ic('card')}<span>${t('managePlan')}</span></a><a data-act="goto-acc" data-to="acc-devices" tabindex="0">${ic('devices')}<span>${t('devicesT')}</span></a><a data-act="ticket-new" tabindex="0">${ic('chat')}<span>${t('contactSup')}</span></a>${d.ownPlaylists !== false ? `<a data-act="goto-acc" data-to="acc-sources" tabindex="0">${ic('list')}<span>${t('srcT')}</span></a>` : ''}</div>
      ${user.isTrial || user.state !== 'active' ? plansCard() : ''}
      ${libraryHtml()}
      ${favs.length ? `<h3>${t('favorites')}</h3>${itemsGrid(favs)}` : ''}`;
    loadDashCounts();
    return;
  }
  if (u.tab === 'account') {
    el.innerHTML = `<div class="card"><div class="row"><div class="avatar" style="width:52px;height:52px;font-size:20px">${esc(initials(user.name))}</div><div><h2 style="margin:0">${esc(user.name)}</h2><div class="muted">${esc(user.username)}</div></div></div>
        ${user.email ? `<div class="list-item" style="margin-top:12px"><span style="flex:1;min-width:0;overflow-wrap:anywhere" dir="ltr">${esc(user.email)}</span>${user.emailVerified ? `<span class="pill st-active">${t('emVerified')}</span>` : `<button class="btn sm primary" data-act="em-send">${t('emVerify')}</button>`}</div>` : ''}</div>
      <div class="card"><h3>${t('mySub')}</h3><div class="list-item"><span style="flex:1">${t('status')}</span>${pill(user.state)}</div><div class="list-item"><span style="flex:1">${t('plan')}</span><b>${esc(user.isTrial ? t('trial') : user.planName)}</b></div><div class="list-item"><span style="flex:1">${t('started')}</span><b>${fmtDate(user.startAt)}</b></div><div class="list-item"><span style="flex:1">${t('expires')}</span><b>${fmtDate(user.expiresAt)}</b></div><div class="list-item"><span style="flex:1">${t('devicesL')}</span><b>${user.connections}</b></div>
        ${(user.renewals || []).length ? `<h3 style="margin-top:14px">${t('history')}</h3>${user.renewals.slice().reverse().map((r) => `<div class="list-item small"><span style="flex:1">${r.type === 'renew' ? t('renewed') : r.type === 'trial' ? t('trial') : t('startedOn')} · ${fmtDate(r.at)}</span><span dir="ltr">+${r.type === 'trial' ? '24h' : r.days + 'd'}</span></div>`).join('')}` : ''}</div>
      ${plansCard()}
      <div class="card" id="acc-devices"><h3>${t('devicesT')}</h3><p class="muted small">${t('loadingDots')}</p></div>
      <div class="card" id="acc-tickets"><div class="row"><h3 style="margin:0;flex:1">${t('supportT')}</h3><button class="btn sm primary" data-act="ticket-new">＋ ${t('newTicket')}</button></div><p class="muted small">${t('loadingDots')}</p></div>
      <div class="card" id="acc-payments"><h3>${t('paymentsT')}</h3><p class="muted small">${t('loadingDots')}</p></div>
      <div class="card"><h3>${t('tfaT')}</h3><p class="muted small" style="margin-top:0">${user.twoFactor ? t('tfaOnText') : t('tfaText')}</p>${user.twoFactor ? `<span class="pill st-active">${t('tfaOn')}</span> <button class="btn sm" data-act="utfa-off" style="margin-inline-start:8px">${t('turnOff')}</button>` : `<button class="btn primary" data-act="utfa-setup">${t('turnOn')}</button>`}</div>
      ${d.ownPlaylists !== false ? sourcesCard() : ''}
      ${parentalCard()}
      <div class="card"><h3>${t('language')}</h3><div class="chips">${LANGS.map(([k, n]) => `<a class="${getLang() === k ? 'on' : ''}" data-act="lang" data-lang="${k}">${n}</a>`).join('')}</div></div>
      ${d.allowPasswordChange ? `<form class="card" data-form="user-password"><h3>${t('changePw')}</h3>${field(t('currentPw'), 'current', '', { type: 'password', attrs: 'required' })}${field(t('newPw'), 'next', '', { type: 'password', attrs: 'required minlength="6"' })}<button class="btn primary">${t('updatePw')}</button></form>` : ''}
      <div class="row"><a class="btn" href="download.html">📲 ${t('getApp')}</a>${waNum(b) ? `<a class="btn wa-btn" href="${esc(waUrl(b, t('waMsg', { app: b.appName, u: user.username })))}" target="_blank" rel="noopener">💬 ${t('whatsapp')}</a>` : ''}${!waNum(b) && b.supportUrl ? `<a class="btn" href="${esc(b.supportUrl)}" target="_blank" rel="noopener">💬 ${esc(b.supportLabel || t('support'))}</a>` : ''}<button class="btn danger" data-act="logout">${t('logout')}</button></div>
      <p style="margin-top:16px"><a href="#" class="small muted" data-act="del-ask">${t('delAsk')}</a></p>`;
    loadAccountExtras();
    if (u.scrollTo) { const to = u.scrollTo; u.scrollTo = null; setTimeout(() => document.getElementById(to)?.scrollIntoView({ block: 'start' }), 60); }
    return;
  }
  const blocked = blockedScreen();
  if (blocked) { el.innerHTML = blocked; return; }
  const kind = u.tab;
  const catAction = { live: 'get_live_categories', movies: 'get_vod_categories', series: 'get_series_categories' }[kind];
  const listAction = { live: 'get_live_streams', movies: 'get_vod_streams', series: 'get_series' }[kind];
  el.innerHTML = `<div class="chips">${'<a style="width:90px">&nbsp;</a>'.repeat(4)}</div><div class="ch-grid">${'<div class="ch sk"><div class="noimg"></div><span>&nbsp;</span></div>'.repeat(12)}</div>`;
  try {
    const allCats = await xt(catAction);
    const hiddenCats = lockedCats(allCats);
    const cats = (Array.isArray(allCats) ? allCats : []).filter((c) => !hiddenCats.has(String(c.category_id)));
    let cat = u.cat[kind] ?? (cats[0]?.category_id ?? '');
    if (hiddenCats.has(String(cat))) cat = cats[0]?.category_id ?? '';
    u.cat[kind] = cat;
    const items = cat === '*' ? await xt(listAction) : await xt(listAction, { category_id: cat });
    const q = u.q.trim().toLowerCase();
    const list = (Array.isArray(items) ? items : []).filter((i) => !hiddenCats.has(String(i.category_id)) && (!q || String(i.name).toLowerCase().includes(q)));
    const mapped = list.map((i) => kind === 'live'
      ? { kind: 'live', id: i.stream_id, name: i.name, icon: i.stream_icon }
      : kind === 'movies' ? { kind: 'movie', id: i.stream_id, name: i.name, icon: i.stream_icon, ext: i.container_extension }
      : { kind: 'series', id: i.series_id, name: i.name, icon: i.cover });
    el.innerHTML = `${d.search ? `<input placeholder="${t('search')}" value="${esc(u.q)}" data-input="u-search" style="margin-bottom:12px">` : ''}
      <div class="chips">${kind === 'live' ? `<a class="${cat === '*' ? 'on' : ''}" data-act="ucat" data-cat="*">${t('all')}</a>` : ''}${(Array.isArray(cats) ? cats : []).map((c) => `<a class="${String(c.category_id) === String(cat) ? 'on' : ''}" data-act="ucat" data-cat="${esc(c.category_id)}">${esc(c.category_name)}</a>`).join('')}${hiddenCats.size ? `<a data-act="pin-unlock">${t('locked')}</a>` : ''}</div>
      <div id="items">${mapped.length ? itemsGrid(mapped.slice(0, u.limit)) : `<div class="empty"><span class="ic">🔍</span>${t('nothing')}</div>`}</div>
      ${mapped.length > u.limit ? `<div style="text-align:center;margin:16px"><button class="btn" data-act="more">${t('more', { n: mapped.length - u.limit })}</button></div>` : ''}`;
  } catch (e) { if (e.switching) return; el.innerHTML = e.direct ? appsCard() : `<div class="err-box">⚠️ ${esc(e.message)}</div>${e.line ? `<div class="card">${state.user.me.branding.supportUrl ? `<a class="btn primary" href="${esc(state.user.me.branding.supportUrl)}" target="_blank" rel="noopener">💬 ${t('support')}</a>` : ''} <button class="btn" data-act="retry">⟳ ${t('retry')}</button></div>` : `<button class="btn" data-act="retry">⟳ ${t('retry')}</button>`}`; }
}

// Browser direct: on the http:// address the browser itself loads the IPTV server (it allows CORS).
const httpOK = () => location.protocol === 'http:';
const canSwitchHttp = () => location.protocol === 'https:' && !/github\.io$|localhost|127\.0\.0\.1/.test(location.hostname) && !localStorage.getItem('tvp_nohttp');
function goHttp(tab) {
  const el = $('#ubody'); if (el) el.innerHTML = `<div class="block-screen"><div class="spinner"></div><p class="muted">${t('openingPlayer')}</p></div>`;
  location.href = `http://${location.host}${location.pathname}#s=${encodeURIComponent(state.token)}&tab=${tab || state.user.tab}&lang=${getLang()}`;
}
// Direct mode: the device itself talks to the IPTV server (Android app bridge).
const bridge = () => window.IPTVBridge;
const isDirect = () => state.user.me?.stream?.mode === 'direct' || (!!bridge() && !!state.user.me?.stream);
window.__bcb = {};
window.addEventListener('message', (e) => { if (e.data && e.data.__iptv && window.__bridgeCb) window.__bridgeCb(e.data.id, e.data.status, e.data.body); });
window.__bridgeCb = (id, status, body) => { const p = window.__bcb[id]; delete window.__bcb[id]; if (!p) return; status >= 200 && status < 300 ? p.res(body) : p.rej(new Error(status === 403 ? 'The server refused the connection (403).' : 'Server error ' + status)); };
const bridgeFetch = (url, ua) => new Promise((res, rej) => { const id = Math.random().toString(36).slice(2); window.__bcb[id] = { res, rej }; bridge().fetch(id, url, ua); });
const XT_TTL = 6 * 3600000;
function xtCacheGet(k) { try { const v = JSON.parse(localStorage.getItem('tvp_xt_' + k)); return v; } catch { return null; } }
function xtCacheSet(k, data) {
  const val = JSON.stringify({ at: Date.now(), data });
  try { localStorage.setItem('tvp_xt_' + k, val); }
  catch { Object.keys(localStorage).filter((x) => x.startsWith('tvp_xt_')).forEach((x) => localStorage.removeItem(x)); try { localStorage.setItem('tvp_xt_' + k, val); } catch {} }
}
async function xt(action, params = {}) {
  const key = action + JSON.stringify(params);
  const c = state.user.cache;
  if (c[key]) return c[key];
  // Lists (not EPG / details) are kept on the device: shown instantly, refreshed in the background.
  const cacheable = /^get_(live|vod|series)_(categories|streams)$|^get_series$/.test(action);
  const dkey = (state.user.me?.stream?.custom || '') + (state.user.me?.stream?.u || '') + ':' + key;
  if (cacheable) {
    const hit = xtCacheGet(dkey);
    if (hit && hit.data) {
      c[key] = hit.data;
      if (Date.now() - hit.at > 20 * 60000) xtFetch(action, params).then((d) => { c[key] = d; xtCacheSet(dkey, d); }).catch(() => {});
      return hit.data;
    }
  }
  const data = await xtFetch(action, params);
  c[key] = data;
  if (cacheable && Array.isArray(data)) xtCacheSet(dkey, data);
  return data;
}
async function xtFetch(action, params = {}) {
  const c = {}; const key = 'x';
  if (state.user.me?.stream?.m3u) return m3uAnswer(await m3uItems(state.user.me.stream.m3u), action, params);
  const q = new URLSearchParams({ action, ...params });
  if (isDirect()) {
    const st = state.user.me.stream;
    const url = `${st.server}/player_api.php?${new URLSearchParams({ username: st.u, password: st.p, ...Object.fromEntries(q) })}`;
    let txt;
    if (bridge()) txt = await bridgeFetch(url, st.userAgent);
    else if (httpOK()) {
      const r = await fetch(url).catch(() => null);
      if (!r) throw new Error(t('lineBad'));
      if (!r.ok) throw new Error(r.status === 403 ? t('lineInactive') : `Server error ${r.status}`);
      txt = await r.text();
    } else if (st.relay) { // secure relay: works in every browser (the free relay may need ~1 min to wake up)
      let r = null;
      for (let i = 0; i < 3 && !r; i++) { r = await fetch(`${st.relay}/x?u=${encodeURIComponent(url)}&t=${encodeURIComponent(st.proxyToken)}`).catch(() => null); if (!r) await new Promise((ok) => setTimeout(ok, 4000)); }
      if (!r) throw new Error(t('relayDown'));
      if (!r.ok) throw new Error(r.status === 403 ? t('relayDown') : `Server error ${r.status}`);
      txt = await r.text();
    } else if (canSwitchHttp()) { goHttp(); throw Object.assign(new Error('switching'), { switching: true }); }
    else throw Object.assign(new Error('direct'), { direct: true });
    let data; try { data = JSON.parse(txt); } catch { throw new Error(t('lineBad')); }
    if (data && data.user_info && Number(data.user_info.auth) === 0) throw Object.assign(new Error(t('lineInactive')), { line: true });
    if (action.startsWith('get_') && action.endsWith('categories') && !Array.isArray(data)) throw Object.assign(new Error(t('lineInactive')), { line: true });
    return (c[key] = data);
  }
  return (c[key] = await api('GET', '/api/xtream?' + q));
}
const CUR = { EUR: '€', USD: '$', USDT: '₮', MAD: 'MAD ' };
const priceTxt = (n, c) => (c === 'MAD' ? `${n} MAD` : `${CUR[c] || ''}${Number(n).toFixed(2)}${CUR[c] ? '' : ' ' + c}`);
const WA_SVG = '<svg viewBox="0 0 32 32" width="30" height="30" fill="#fff" aria-hidden="true"><path d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.5.7 4.8 1.9 6.8L3 29l6.8-2.2c1.9 1 4 1.6 6.2 1.6 7 0 12.7-5.7 12.7-12.7S23 3 16 3zm0 23.1c-2 0-3.9-.6-5.6-1.6l-.4-.2-4 1.3 1.3-3.9-.3-.4c-1.1-1.7-1.7-3.7-1.7-5.7C5.3 9.8 10.1 5 16 5s10.7 4.8 10.7 10.7S21.9 26.1 16 26.1zm5.9-8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1c-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2s0-.5.1-.6l.5-.6c.2-.2.2-.4.3-.6s0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4s-1.2 1.1-1.2 2.7 1.2 3.2 1.4 3.4 2.4 3.6 5.7 5c.8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5s.3-1.4.2-1.5-.3-.2-.6-.4z"/></svg>';
const waNum = (b) => String(b?.whatsapp || (/wa\.me\/(\d+)/.exec(b?.supportUrl || '') || [])[1] || '').replace(/\D/g, '');
const waUrl = (b, text) => { const n = waNum(b); return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : ''; };
function setWaFab(b, text) {
  let el = document.getElementById('wa-fab'); const url = b ? waUrl(b, text) : '';
  if (!url) { el?.remove(); return; }
  if (!el) { el = document.createElement('a'); el.id = 'wa-fab'; el.className = 'wa-fab'; el.target = '_blank'; el.rel = 'noopener'; el.setAttribute('aria-label', 'WhatsApp'); el.innerHTML = WA_SVG; document.body.appendChild(el); }
  el.href = url;
}
function orderCard() {
  const me = state.user.me; const op = me.orderPackages || []; if (!op.length) return '';
  const u = me.user.username; const app = me.branding.appName;
  return `<div class="card"><h3>💎 ${t('buyTitle')}</h3><div class="plans-grid">${op.map((p) => { const pr = priceTxt(p.price, p.cur); const wa = waUrl(me.branding, t('waBuy', { app, pkg: p.title, price: pr, u })); return `<div class="plan-c">${p.badge ? `<div class="small" dir="auto" style="color:var(--accent);font-weight:700">${esc(p.badge)}</div>` : ''}<b dir="auto">${esc(p.title)}</b><div class="pp" dir="ltr">${pr}</div><div class="small muted">${t('daysN', { n: p.days })} · ${t('devices', { n: p.devices })}</div>
    <a class="btn sm primary block" style="margin-top:8px" href="${esc(p.url)}" target="_blank" rel="noopener" data-keep data-act="pay-click" data-pkg="${esc(p.id)}">${t('payNow')}</a>
    <div class="row" style="margin-top:6px;gap:6px">${me.hasEmail ? `<button class="btn sm" style="flex:1" data-act="pay-email" data-pkg="${esc(p.id)}">${t('emailMe')}</button>` : ''}${wa ? `<a class="btn sm wa-btn" style="flex:1" href="${esc(wa)}" target="_blank" rel="noopener">💬 ${t('whatsapp')}</a>` : ''}</div></div>`; }).join('')}</div></div>`;
}
function plansCard() {
  if (state.user.me.orderPackages?.length) return orderCard();
  const me = state.user.me; if (!me.plans?.length) return '';
  const sup = me.branding.supportUrl;
  return `<div class="card"><h3>💎 ${t('plansTitle')}</h3><div class="plans-grid">${me.plans.map((p) => `<div class="plan-c"><b>${esc(p.name)}</b><div class="pp">${priceTxt(p.price, me.currency)}</div><div class="small muted">${t('devices', { n: p.connections })}</div>${sup ? `<a class="btn sm primary" href="${esc(sup)}${sup.includes('wa.me') ? `?text=${encodeURIComponent(`${me.branding.appName}: ${p.name} (${priceTxt(p.price, me.currency)}) — ${me.user.username}`)}` : ''}" target="_blank" rel="noopener">${t('choose')}</a>` : ''}</div>`).join('')}</div></div>`;
}
function appsCard() {
  return `<div class="card" style="text-align:center"><div style="font-size:46px">📲</div><h3>${t('apps_title')}</h3><p class="muted">${t('apps_text')}</p>
    <a class="btn primary" href="download.html">${t('getApp')}</a></div>`;
}

// Logo loading: the panel's logo first (direct, then through the relay), then the channel's real logo
// from the logo index (logos.js), and only then the initials tile.
// A logo server is only skipped after 4 failures with no success at all.
window.__logoStat = {}; window.__deadLogo = new Set();
const logoHost = (u) => { try { return new URL(u).host; } catch { return ''; } };
const proxiedImg = (u) => { const st = state.user.me?.stream; return st?.proxyToken && state.mode === 'server' ? `/img?u=${encodeURIComponent(u)}&t=${encodeURIComponent(st.proxyToken)}` : ''; };
window.__logoOk = (img) => { if (img.dataset.db) return; const h = logoHost(img.dataset.src); (window.__logoStat[h] ||= { ok: 0, bad: 0 }).ok++; };
window.__logoFail = (img) => {
  const d = img.dataset;
  if (!d.db) {
    if (d.alt && img.src !== d.alt && !d.tried) { d.tried = '1'; img.src = d.alt; return; }
    const h = logoHost(d.src); const st = (window.__logoStat[h] ||= { ok: 0, bad: 0 }); st.bad++;
    if (st.bad >= 4 && !st.ok) window.__deadLogo.add(h);
    const real = d.name ? findLogo(d.name) : '';
    if (real && real !== d.src) { d.db = '1'; d.real = real; img.referrerPolicy = 'no-referrer'; img.src = real; return; }
  } else if (d.db === '1') {
    const via = proxiedImg(d.real);
    if (via) { d.db = '2'; img.src = via; return; }
  }
  const tile = img.nextElementSibling.content.cloneNode(true);
  if (d.db && tile.firstElementChild) tile.firstElementChild.dataset.lx = '1'; // real logo already tried
  img.nextElementSibling.remove(); img.replaceWith(tile);
};
// Channels shown with an initials tile get their real logo as soon as the logo index is loaded.
function upgradeLogos() {
  if (!logosReady()) return;
  for (const tile of document.querySelectorAll('.noimg[data-ln]:not([data-lx])')) {
    tile.dataset.lx = '1';
    const real = findLogo(tile.dataset.ln);
    if (!real) continue;
    const img = new Image();
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.onerror = () => { const via = proxiedImg(real); if (via && !img.dataset.db) { img.dataset.db = '2'; img.src = via; } else img.replaceWith(tile); };
    img.src = real;
    tile.replaceWith(img);
  }
}
let logoTimer = 0;
new MutationObserver(() => { if (!logoTimer) logoTimer = setTimeout(() => { logoTimer = 0; upgradeLogos(); }, 60); }).observe(document.getElementById('app'), { childList: true, subtree: true });
function relayImg(u) { const st = state.user.me?.stream; return st?.relay && /^http:/.test(u) ? `${st.relay}/x?u=${encodeURIComponent(u)}&t=${encodeURIComponent(st.proxyToken)}` : ''; }
function imgSrc(u) {
  if (!u || !/^https?:/.test(u)) return '';
  if (window.__deadLogo.has(logoHost(u))) return '';
  const st = state.user.me?.stream;
  if (u.startsWith('https:') || location.protocol === 'http:') return u;      // already loadable
  if (bridge()) return u;                                                     // Android / TV / desktop apps load http images directly
  if (st?.relay) return `${st.relay}/x?u=${encodeURIComponent(u)}&t=${encodeURIComponent(st.proxyToken)}`; // bare-IP logos: via the relay
  if (st?.proxyToken) return `/img?u=${encodeURIComponent(u)}&t=${encodeURIComponent(st.proxyToken)}`;
  return u;
}
function initialsTile(name, big) {
  const n = String(name || '?').replace(/#+/g, ' ').replace(/^\s*[|[(]?[A-Z]{2,3}[|\])]?\s*[-:|]\s*/i, '').replace(/^\s*\|[^|]*\|\s*/, '').trim() || String(name || '?');
  const ini = (n.match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<div class="noimg${big ? ' big' : ''}"${big ? '' : ` data-ln="${esc(name)}"`} style="background:linear-gradient(135deg,hsl(${h} 70% 40%),hsl(${(h + 40) % 360} 70% 25%))">${esc(ini)}</div>`;
}
function itemsGrid(items) {
  const d = state.user.me.dashboard;
  const live = items.filter((i) => i.kind === 'live');
  const vod = items.filter((i) => i.kind !== 'live');
  if (live.length && !logosReady()) loadLogos().then(upgradeLogos);
  const favBtn = (i) => d.favorites ? `<button class="fav ${isFav(i.kind, i.id) ? 'on' : ''}" data-act="fav" data-item="${esc(JSON.stringify(i))}">★</button>` : '';
  return `${live.length ? `<div class="ch-grid" style="margin-bottom:14px">${live.map((i) => `<div class="ch" data-act="open-item" data-item="${esc(JSON.stringify(i))}">${favBtn(i)}${imgSrc(i.icon) ? `<img src="${esc(imgSrc(i.icon))}" data-src="${esc(i.icon)}" data-alt="${esc(relayImg(i.icon))}" data-name="${esc(i.name)}" loading="lazy" decoding="async" alt="" onload="__logoOk(this)" onerror="__logoFail(this)"><template>${initialsTile(i.name)}</template>` : initialsTile(i.name)}<span>${esc(i.name)}</span></div>`).join('')}</div>` : ''}
    ${vod.length ? `<div class="poster-grid">${vod.map((i) => `<div class="poster" data-act="open-item" data-item="${esc(JSON.stringify(i))}">${favBtn(i)}<div class="img">${imgSrc(i.icon) ? `<img src="${esc(imgSrc(i.icon))}" data-src="${esc(i.icon)}" data-alt="${esc(relayImg(i.icon))}" loading="lazy" decoding="async" alt="" onload="__logoOk(this)" onerror="__logoFail(this)"><template>${initialsTile(i.name, true)}</template>` : initialsTile(i.name, true)}</div><span>${esc(i.name)}</span></div>`).join('')}</div>` : ''}`;
}

function streamUrl(kind, id, ext) {
  const s = state.user.me.stream;
  const raw = kind === 'live' ? `${s.server}/live/${encodeURIComponent(s.u)}/${encodeURIComponent(s.p)}/${id}.m3u8`
    : `${s.server}/${kind}/${encodeURIComponent(s.u)}/${encodeURIComponent(s.p)}/${id}.${ext || 'mp4'}`;
  if (s.useProxy && state.mode === 'server') return `/proxy?u=${encodeURIComponent(raw)}&t=${encodeURIComponent(s.proxyToken)}`;
  return raw;
}

const loadHls = () => window.Hls ? Promise.resolve() : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
function play(title, kind, id, ext, extraHtml = '') {
  if (blockedScreen()) return toast(t('notAvailable'), true);
  recordWatch({ kind: kind === 'series' ? 'episode' : kind, id, name: title, ext, icon: state.user.lastIcon || '' });
  let url, isHls;
  const hk = kind === 'series' ? 'episode' : kind;
  if (state.user.me.stream?.m3u) {
    const st = state.user.me.stream; const it = (state.user.m3u?.[st.m3u] || [])[id]; const b = bridge();
    if (!it) return toast(t('streamFail'), true);
    if (b && !b.inline) { noteNative(hk, id, it.url); return b.play(it.url, title, st.userAgent); }
    url = it.url; const base = state.user.me._stream;
    if (location.protocol === 'https:' && url.startsWith('http:')) { if (base?.relay) url = `${base.relay}/x?u=${encodeURIComponent(url)}&t=${encodeURIComponent(base.proxyToken)}`; else return modal(esc(title), `<div class="notice warning">${t('srcNeedApp')}</div><a class="btn primary" href="download.html">${t('getApp')}</a>`); }
    return openPlayer({ title, url, isHls: /\.m3u8(\?|$)/i.test(it.url) || (kind === 'live' && !/\.(ts|mp4|mkv)(\?|$)/i.test(it.url)), kind, id, extraHtml: '' });
  }
  if (isDirect()) {
    const st = state.user.me.stream; const b = bridge();
    const raw = (e) => kind === 'live' ? `${st.server}/live/${encodeURIComponent(st.u)}/${encodeURIComponent(st.p)}/${id}.${e}`
      : `${st.server}/${kind}/${encodeURIComponent(st.u)}/${encodeURIComponent(st.p)}/${id}.${ext || 'mp4'}`;
    if (b && !b.inline) { noteNative(hk, id, raw('ts')); return b.play(raw('ts'), title, st.userAgent); } // Android / TV: native player (remembers the position itself)
    if (b && b.inline) { url = raw('m3u8'); }                          // Windows / Mac app: plays here, direct
    else if (httpOK()) { url = raw('m3u8'); }                         // any browser on the http:// address: direct
    else if (st.relay) { url = `${st.relay}/x?u=${encodeURIComponent(raw('m3u8'))}&t=${encodeURIComponent(st.proxyToken)}`; } // iPhone / browsers: secure relay
    else if (canSwitchHttp()) { closeModal(); return goHttp(); }
    else return modal(esc(title), appsCard(), { wide: true });
    isHls = kind === 'live' || ext === 'm3u8';
  } else { url = streamUrl(kind, id, ext); isHls = kind === 'live' || ext === 'm3u8'; }
  openPlayer({ title, url, isHls, kind, id, extraHtml });
}

// ---------------- advanced player ----------------
const fmtT = (x) => { if (!isFinite(x)) return '0:00'; x = Math.max(0, Math.floor(x)); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), sec = String(x % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`; };
function openPlayer({ title, url, isHls, kind, id, extraHtml }) {
  const live = kind === 'live';
  let hls = null, hideT = null, retries = 0;
  const body = modal(esc(title), `<div class="vp" id="vp" tabindex="0">
      <video id="vid" playsinline autoplay preload="auto"></video>
      <div class="vp-spin" id="vp-spin"><div class="spinner"></div></div>
      <div class="vp-msg" id="pl-msg"></div>
      <button class="vp-big" id="vp-big" aria-label="Play">▶</button>
      <div class="vp-bar">
        ${live ? '' : `<input type="range" class="vp-seek" id="vp-seek" min="0" max="1000" value="0" aria-label="Seek">`}
        <div class="vp-row">
          <button class="vp-b" data-vp="play" aria-label="Play/Pause">❚❚</button>
          ${live ? '<span class="vp-live">● LIVE</span>' : `<button class="vp-b" data-vp="back" aria-label="Back 10s">⏪</button><button class="vp-b" data-vp="fwd" aria-label="Forward 10s">⏩</button><span class="vp-time" id="vp-time">0:00 / 0:00</span>`}
          <span class="spacer"></span>
          <button class="vp-b" data-vp="mute" id="vp-mute" aria-label="Mute">🔊</button>
          <input type="range" class="vp-vol" id="vp-vol" min="0" max="100" aria-label="Volume">
          <button class="vp-b" data-vp="menu" data-m="subs" aria-label="Subtitles">CC</button>
          <button class="vp-b" data-vp="menu" data-m="audio" aria-label="Audio">🎧</button>
          <button class="vp-b" data-vp="menu" data-m="quality" aria-label="Quality">⚙️</button>
          ${document.pictureInPictureEnabled ? '<button class="vp-b" data-vp="pip" aria-label="Picture in picture">⧉</button>' : ''}
          <button class="vp-b" data-vp="fs" aria-label="Fullscreen">⛶</button>
        </div>
      </div>
      <div class="vp-menu" id="vp-menu"></div>
    </div>${extraHtml}`, { wide: true, onClose: () => { clearTimeout(hideT); document.removeEventListener('keydown', onKey, true); if (hls) hls.destroy(); const v = $('#vid'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); } if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } });
  const vp = $('#vp', body), v = $('#vid', body), spin = $('#vp-spin', body), msg = $('#pl-msg', body), big = $('#vp-big', body), menu = $('#vp-menu', body);
  const vol = $('#vp-vol', body), muteB = $('#vp-mute', body), playB = body.querySelector('[data-vp=play]'), seek = $('#vp-seek', body), timeEl = $('#vp-time', body);
  // remembered volume
  const saved = JSON.parse(localStorage.getItem('tvp_vol') || '{"v":1,"m":false}');
  v.volume = saved.v; v.muted = saved.m; vol.value = Math.round(saved.v * 100);
  const saveVol = () => { localStorage.setItem('tvp_vol', JSON.stringify({ v: v.volume, m: v.muted })); muteB.textContent = v.muted || v.volume === 0 ? '🔇' : v.volume < .5 ? '🔉' : '🔊'; vol.value = v.muted ? 0 : Math.round(v.volume * 100); };
  saveVol();
  const show = () => { vp.classList.add('show'); clearTimeout(hideT); hideT = setTimeout(() => { if (!v.paused && !menu.classList.contains('open')) vp.classList.remove('show'); }, 3500); };
  const fail = (m) => { spin.style.display = 'none'; msg.innerHTML = `${m || t('streamFail')} <button class="btn sm" data-vp="retry">⟳ ${t('retry')}</button>`; };
  const start = () => {
    msg.innerHTML = ''; spin.style.display = '';
    if (hls) { hls.destroy(); hls = null; }
    if (isHls && !v.canPlayType('application/vnd.apple.mpegurl') && window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: live ? 20 : 40, startFragPrefetch: true, manifestLoadingMaxRetry: 4, fragLoadingMaxRetry: 6 });
      hls.loadSource(url); hls.attachMedia(v);
      hls.on(window.Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError();
        if (retries++ < 3) return setTimeout(start, 1500);
        fail();
      });
    } else { v.src = url; }
    v.play().catch(() => { big.style.display = 'grid'; });
  };
  if (isHls && !v.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) loadHls().then(start).catch(() => fail()); else start();
  // video events
  v.addEventListener('waiting', () => (spin.style.display = ''));
  v.addEventListener('playing', () => { spin.style.display = 'none'; big.style.display = 'none'; msg.innerHTML = ''; retries = 0; playB.textContent = '❚❚'; show(); });
  v.addEventListener('pause', () => { playB.textContent = '▶'; vp.classList.add('show'); });
  v.addEventListener('canplay', () => (spin.style.display = 'none'));
  v.addEventListener('error', () => { if (!hls) { if (retries++ < 2) setTimeout(start, 1500); else fail(); } });
  if (!live) {
    const hk = kind === 'series' ? 'episode' : kind; let lastSave = 0;
    v.addEventListener('loadedmetadata', () => { const h = getHist().find((x) => x.kind === hk && String(x.id) === String(id)); if (h && h.pos > 30 && isFinite(v.duration) && h.pos < v.duration - 60) { v.currentTime = h.pos; toast(t('resumed', { t: fmtT(h.pos) })); } }, { once: true });
    v.addEventListener('timeupdate', () => { if (isFinite(v.duration) && Date.now() - lastSave > 10000) { lastSave = Date.now(); savePos(hk, id, v.currentTime, v.duration); } });
    v.addEventListener('pause', () => { if (isFinite(v.duration)) savePos(hk, id, v.currentTime, v.duration); });
  }
  v.addEventListener('timeupdate', () => { if (!live && seek && isFinite(v.duration)) { if (!seek.dragging) seek.value = Math.round((v.currentTime / v.duration) * 1000); timeEl.textContent = `${fmtT(v.currentTime)} / ${fmtT(v.duration)}`; } });
  v.addEventListener('volumechange', saveVol);
  if (seek) { seek.addEventListener('input', () => { seek.dragging = true; timeEl.textContent = `${fmtT((seek.value / 1000) * v.duration)} / ${fmtT(v.duration)}`; }); seek.addEventListener('change', () => { seek.dragging = false; if (isFinite(v.duration)) v.currentTime = (seek.value / 1000) * v.duration; }); }
  vol.addEventListener('input', () => { v.volume = vol.value / 100; v.muted = vol.value == 0; });
  vp.addEventListener('mousemove', show); vp.addEventListener('touchstart', show, { passive: true });
  v.addEventListener('click', () => { if (vp.classList.contains('show')) toggle(); else show(); });
  v.addEventListener('dblclick', () => fullscreen());
  big.addEventListener('click', () => { v.play(); });
  const toggle = () => (v.paused ? v.play() : v.pause());
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (vp.requestFullscreen) vp.requestFullscreen().catch(() => {}); else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); };
  // menus: subtitles, audio, quality, speed
  const openMenu = (m) => {
    let items = [];
    if (m === 'subs') {
      const tracks = hls && hls.subtitleTracks?.length ? hls.subtitleTracks.map((tr, i) => ({ label: tr.name || tr.lang || `Track ${i + 1}`, on: hls.subtitleTrack === i, act: () => { hls.subtitleTrack = i; hls.subtitleDisplay = true; } }))
        : [...v.textTracks].filter((tr) => /subtitles|captions/.test(tr.kind)).map((tr, i) => ({ label: tr.label || tr.language || `Track ${i + 1}`, on: tr.mode === 'showing', act: () => { [...v.textTracks].forEach((x) => (x.mode = 'disabled')); tr.mode = 'showing'; } }));
      items = [{ label: t('off'), on: !tracks.some((x) => x.on), act: () => { if (hls) hls.subtitleTrack = -1; [...v.textTracks].forEach((x) => (x.mode = 'disabled')); } }, ...tracks];
      if (!tracks.length) items.push({ label: t('noSubs'), disabled: true });
    } else if (m === 'audio') {
      const tracks = hls && hls.audioTracks?.length > 1 ? hls.audioTracks.map((tr, i) => ({ label: tr.name || tr.lang || `Audio ${i + 1}`, on: hls.audioTrack === i, act: () => (hls.audioTrack = i) }))
        : v.audioTracks && v.audioTracks.length > 1 ? [...v.audioTracks].map((tr, i) => ({ label: tr.label || tr.language || `Audio ${i + 1}`, on: tr.enabled, act: () => [...v.audioTracks].forEach((x, j) => (x.enabled = j === i)) })) : [];
      items = tracks.length ? tracks : [{ label: t('oneAudio'), disabled: true }];
    } else if (m === 'quality') {
      if (hls && hls.levels?.length > 1) items = [{ label: 'Auto', on: hls.autoLevelEnabled, act: () => (hls.currentLevel = -1) }, ...hls.levels.map((l, i) => ({ label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`, on: !hls.autoLevelEnabled && hls.currentLevel === i, act: () => (hls.currentLevel = i) }))];
      if (!live) items.push({ head: t('speed') }, ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ label: r + '×', on: v.playbackRate === r, act: () => (v.playbackRate = r) })));
      if (!items.length) items = [{ label: v.videoHeight ? `${v.videoHeight}p` : 'Auto', on: true }];
    }
    menu.innerHTML = items.map((x, i) => x.head ? `<div class="vp-mh">${esc(x.head)}</div>` : `<button class="vp-mi ${x.on ? 'on' : ''}" ${x.disabled ? 'disabled' : ''} data-vpi="${i}">${x.on ? '✓ ' : ''}${esc(x.label)}</button>`).join('');
    menu._items = items; menu.classList.add('open'); vp.classList.add('show');
    menu.querySelector('.vp-mi:not([disabled])')?.focus();
  };
  menu.addEventListener('click', (e) => { const b = e.target.closest('[data-vpi]'); if (!b) return; const it = menu._items[b.dataset.vpi]; if (it?.act) it.act(); menu.classList.remove('open'); show(); });
  vp.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vp]'); if (!b) { if (!e.target.closest('.vp-menu')) menu.classList.remove('open'); return; }
    const a = b.dataset.vp; show();
    if (a === 'play') toggle();
    if (a === 'back') v.currentTime = Math.max(0, v.currentTime - 10);
    if (a === 'fwd') v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10);
    if (a === 'mute') { v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = .5; }
    if (a === 'fs') fullscreen();
    if (a === 'pip') (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(() => {});
    if (a === 'menu') menu.classList.contains('open') && menu.dataset.m === b.dataset.m ? menu.classList.remove('open') : (menu.dataset.m = b.dataset.m, openMenu(b.dataset.m));
    if (a === 'retry') { retries = 0; start(); }
  });
  // keyboard & TV remote
  function onKey(e) {
    if (!$('#vp') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range') return;
    const k = e.key; let used = true;
    if (menu.classList.contains('open') && /Arrow|Enter/.test(k)) { used = false; }
    else if (k === ' ' || k === 'k' || k === 'MediaPlayPause') toggle();
    else if (k === 'ArrowRight' && !live) v.currentTime += 10;
    else if (k === 'ArrowLeft' && !live) v.currentTime = Math.max(0, v.currentTime - 10);
    else if (k === 'ArrowUp') { v.muted = false; v.volume = Math.min(1, v.volume + 0.1); }
    else if (k === 'ArrowDown') v.volume = Math.max(0, v.volume - 0.1);
    else if (k === 'm' || k === 'AudioVolumeMute') v.muted = !v.muted;
    else if (k === 'f') fullscreen();
    else if (k === 'c') openMenu('subs');
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); show(); }
  }
  document.addEventListener('keydown', onKey, true);
  vp.focus(); show();
  if (live && state.user.me.dashboard.epg) loadEpg(id);
}
async function loadEpg(id) {
  try {
    const r = await xt('get_short_epg', { stream_id: id, limit: 5 });
    const list = r?.epg_listings || [];
    const el = $('#epg'); if (!el) return;
    el.innerHTML = list.length ? `<h3 style="margin-top:14px">${t('tvGuide')}</h3>${list.map((e) => `<div class="epg-item"><b>${esc(String(e.start || '').slice(11, 16))}</b>${esc(b64(e.title))}</div>`).join('')}` : '';
  } catch {}
}

async function openItem(i) {
  state.user.lastIcon = i.icon || '';
  if (i.kind === 'episode') return play(i.name, 'series', i.id, i.ext);
  if (i.kind === 'live') return play(i.name, 'live', i.id, 'm3u8', '<div id="epg"></div>');
  if (i.kind === 'movie') {
    const body = modal(esc(i.name), '<div class="spinner"></div>', { wide: true });
    let info = {};
    try { info = (await xt('get_vod_info', { vod_id: i.id })).info || {}; } catch {}
    body.innerHTML = `<div class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:16px">${imgSrc(i.icon) ? `<img src="${esc(imgSrc(i.icon))}" style="width:130px;border-radius:12px" alt="">` : ''}<div><p class="muted small">${esc([info.releasedate || info.year, info.genre, info.duration].filter(Boolean).join(' · '))}${info.rating ? ' · ⭐ ' + esc(info.rating) : ''}</p><p>${esc(info.plot || info.description || '')}</p><button class="btn primary" data-act="play-movie" data-item="${esc(JSON.stringify(i))}">${t('play')}</button></div></div>`;
    return;
  }
  if (i.kind === 'series') {
    const body = modal(esc(i.name), '<div class="spinner"></div>', { wide: true });
    try {
      const r = await xt('get_series_info', { series_id: i.id });
      const eps = r.episodes || {};
      const seasons = Object.keys(eps).sort((a, b) => a - b);
      const renderSeason = (sn) => (eps[sn] || []).map((e) => `<div class="ep" data-act="play-ep" data-item="${esc(JSON.stringify({ id: e.id, ext: e.container_extension, name: `${i.name} · S${sn}E${e.episode_num}` }))}"><b>▶</b><div style="flex:1;min-width:0"><b>E${esc(e.episode_num)}</b> ${esc(e.title || '')}</div></div>`).join('');
      body.innerHTML = `<p class="muted">${esc(r.info?.plot || '')}</p>${seasons.length ? `<div class="chips" id="seasons">${seasons.map((sn, k) => `<a class="${k === 0 ? 'on' : ''}" data-act="season" data-sn="${esc(sn)}">${t('season', { n: esc(sn) })}</a>`).join('')}</div><div id="eps">${renderSeason(seasons[0])}</div>` : `<p class="muted">${t('noEps')}</p>`}`;
      body._renderSeason = renderSeason;
    } catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
  }
}

// ---------------- events ----------------
const actions = {
  retry: () => { state.user.cache = {}; state.user.meAt = 0; renderUser(); },
  'dup-type': async (el) => { state.admin.dupType = el.dataset.t; state.admin.dupLimit = 30; $('#admin-body').innerHTML = await adminDups(); },
  'dup-more': async () => { state.admin.dupLimit += 30; $('#admin-body').innerHTML = await adminDups(); },
  'save-accs': async () => {
    const orderAccounts = (state.admin.settings.orderAccounts || []).map((a) => ({ ...a, enabled: !!$(`[data-acc="${a.id}"]`)?.checked }));
    await saveSettings({ orderAccounts }); renderAdmin();
  },
  'add-op': () => $('#ops').insertAdjacentHTML('beforeend', opRow()),
  'del-op': (el) => el.closest('.op-row').remove(),
  'save-op': async () => {
    const orderPackages = [...document.querySelectorAll('#ops .op-row')].map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`).value; return { id: r.dataset.op || undefined, title: g('title'), days: Number(g('days')), devices: Number(g('devices')), price: Number(g('price')), badge: g('badge'), link: g('link') }; }).filter((p) => p.title);
    await saveSettings({ orderPackages, orderCurrency: $('#op-cur').value }); renderAdmin();
  },
  'order-stripe-links': async (el) => {
    el.disabled = true; el.textContent = 'Creating…';
    try { const r = await api('POST', '/api/admin/stripe/paylinks', {}); state.admin.settings.orderPackages = r.packages; toast(`Created ${r.made} Stripe payment links ✓`); renderAdmin(); }
    catch (e) { toast(e.message, true); el.disabled = false; el.textContent = 'Try again'; }
  },
  'order-preview': async (el) => {
    const appUrl = location.origin + location.pathname.replace(/index\.html$/, '');
    if (!state.admin.customers) state.admin.customers = await api('GET', '/api/admin/customers');
    const c = state.admin.customers.find((x) => x.email) || state.admin.customers[0];
    if (!c) return toast('Add a customer first to preview.', true);
    const pv = await api('GET', `/api/admin/customers/${c.id}/orderpreview?pkg=${el.dataset.pkg}&appUrl=${encodeURIComponent(appUrl)}`);
    const body = modal('👁 ' + pv.subject, `<iframe id="mail-pv" style="width:100%;height:65vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>`, { wide: true });
    $('#mail-pv', body).srcdoc = pv.html;
  },
  'order-one': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id); const s = state.admin.settings;
    const body = modal('💳 Send a package email', `<div class="row"><select id="op-pick" style="flex:1">${s.orderPackages.map((p) => `<option value="${esc(p.id)}" ${p.id === c.orderSentPkg ? 'selected' : ''}>${esc(p.title)} — ${orderPrice(s, p)}</option>`).join('')}</select></div>
      <p class="muted small" id="op-subj"></p><iframe id="mail-pv" style="width:100%;height:55vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>
      <div class="row" style="margin-top:12px"><input id="mail-to" value="${esc(c.email || '')}" style="flex:1" autocapitalize="none"><button class="btn primary" data-act="order-send" data-id="${c.id}">Send</button></div>
      ${c.orderSentAt ? `<p class="small muted">Last package email: ${fmtDT(c.orderSentAt)}${c.orderSentAcc ? ' · Stripe: ' + esc((s.orderAccounts || []).find((a) => a.id === c.orderSentAcc)?.name || c.orderSentAcc) : ''}</p>` : ''}`, { wide: true });
    const load = async () => { const appUrl = location.origin + location.pathname.replace(/index\.html$/, ''); const pv = await api('GET', `/api/admin/customers/${c.id}/orderpreview?pkg=${$('#op-pick').value}&appUrl=${encodeURIComponent(appUrl)}`); $('#op-subj').innerHTML = 'Subject: <b>' + esc(pv.subject) + '</b>'; $('#mail-pv', body).srcdoc = pv.html; };
    $('#op-pick').addEventListener('change', load); load();
  },
  'order-send': async (el) => {
    el.disabled = true;
    try { await api('POST', `/api/admin/customers/${el.dataset.id}/order`, { pkg: $('#op-pick').value, to: $('#mail-to').value, appUrl: location.origin }); toast('Package email sent ✓'); closeModal(); const c = state.admin.customers.find((x) => x.id === el.dataset.id); if (c) { c.orderSentAt = Date.now(); c.orderSentPkg = $('#op-pick')?.value; } }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'pay-click': (el) => { api('POST', '/api/me/order', { pkg: el.dataset.pkg }).catch(() => {}); },
  'pay-email': async (el) => {
    el.disabled = true;
    try { const r = await api('POST', '/api/me/order', { pkg: el.dataset.pkg, email: true, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') }); toast(t('offerSent', { email: r.email })); }
    catch (e) { toast(e.message === 'no_email' ? t('noEmail') : e.message, true); }
    el.disabled = false;
  },
  'wa-one': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id); const s = state.admin.settings; const p0 = s.orderPackages[0] || {};
    const pick = c.orderSentPkg && s.orderPackages.some((p) => p.id === c.orderSentPkg) ? c.orderSentPkg : p0.id;
    const body = modal('💬 WhatsApp message', `<form data-form="wa" onsubmit="return false">
      <div class="grid3">${field('Message', 'type', c.state === 'expired' || c.state === 'expiring' ? 'renew' : c.isTrial ? 'pay' : 'pay', { type: 'select', options: [['pay', '💳 Payment link'], ['renew', '🔁 Renewal reminder'], ['login', '🔑 Login details']] })}${field('Language', 'lang', ['en', 'fr', 'ar'].includes(c.lang) ? c.lang : 'en', { type: 'select', options: [['en', 'English'], ['fr', 'Français'], ['ar', 'العربية']] })}${field('WhatsApp number', 'phone', String(c.whatsapp || c.phone || '').replace(/\D/g, ''), { type: 'tel', ph: '212612345678' })}</div>
      <div id="wa-pkg">${field('Package', 'pkg', pick, { type: 'select', options: [...s.orderPackages.map((p) => [p.id, `${p.title} — ${orderPrice(s, p)}`])] })}
      <details><summary class="small muted" style="cursor:pointer;margin:6px 0">✏️ Custom subscription (optional)</summary>
        <div class="grid3">${field('Package name', 'title', '', { ph: 'e.g. 1 Year + 2 months free' })}${field('Price', 'price', '', { type: 'number', attrs: 'step="any" min="0"' })}${field('Currency', 'currency', s.orderCurrency || 'EUR', { type: 'select', options: [['ALL', 'Random € or $'], ['EUR', '€ EUR'], ['USD', '$ USD'], ['USDT', '₮ USDT']] })}</div>
        <div class="grid3">${field('Days', 'days', '', { type: 'number', attrs: 'min="1"' })}${field('Devices', 'devices', '', { type: 'number', attrs: 'min="1"' })}${field('Pay link', 'link', '', { attrs: 'autocapitalize="none"', ph: 'Empty = random Stripe link' })}</div>
      </details></div>
      <label class="field"><span>Message (you can edit it)</span><textarea id="wa-text" rows="12" dir="auto"></textarea></label>
      <div class="row"><button type="button" class="btn sm" data-act="wa-refresh">🎲 New random link</button><button type="button" class="btn sm" data-act="wa-copy">📋 Copy</button><button type="button" class="btn sm" data-act="wa-tpl">⚙️ Edit template</button><span class="spacer"></span><button type="button" class="btn primary wa-btn" data-act="wa-open" data-id="${c.id}">💬 Open WhatsApp</button></div>
      <div id="wa-tpl-box" style="display:none;margin-top:10px"><p class="small muted">Saved template for this message type and language. You can use: {name} {fullname} {package} {price} {days} {devices} {link} {username} {password} {dns} {m3u} {expires} {ends} {appUrl} {website} {order} {app}. Use *text* for bold in WhatsApp.</p><textarea id="wa-tpl-text" rows="10" dir="auto"></textarea><div class="row"><button type="button" class="btn sm" data-act="wa-tpl-reset">Reset to default</button><span class="spacer"></span><button type="button" class="btn sm primary" data-act="wa-tpl-save">Save template</button></div></div>
      <p class="small muted" id="wa-info"></p></form>`, { wide: true });
    const f = $('[data-form=wa]', body); f.dataset.id = c.id;
    const show = () => { $('#wa-pkg').style.display = f.type.value === 'login' ? 'none' : ''; };
    ['type', 'lang', 'pkg', 'title', 'price', 'currency', 'days', 'devices', 'link'].forEach((k) => f[k].addEventListener('change', () => { show(); waLoad(); }));
    show(); waLoad();
  },
  'wa-refresh': () => waLoad(),
  'wa-copy': async () => { try { await navigator.clipboard.writeText($('#wa-text').value); toast('Copied ✓'); } catch { $('#wa-text').select(); document.execCommand('copy'); toast('Copied ✓'); } },
  'wa-tpl': () => { const b = $('#wa-tpl-box'); b.style.display = b.style.display === 'none' ? '' : 'none'; },
  'wa-tpl-reset': async () => { const f = $('[data-form=wa]'); await saveSettings({ waTemplates: { [f.type.value]: { [f.lang.value]: '' } } }); toast('Back to default ✓'); waLoad(); },
  'wa-tpl-save': async () => { const f = $('[data-form=wa]'); await saveSettings({ waTemplates: { [f.type.value]: { [f.lang.value]: $('#wa-tpl-text').value } } }); toast('Template saved ✓'); waLoad(); },
  'wa-open': async (el) => {
    const f = $('[data-form=wa]'); const phone = f.phone.value.replace(/\D/g, ''); const text = $('#wa-text').value;
    if (!phone) return toast('Enter the WhatsApp number with country code.', true);
    if (phone.startsWith('0')) return toast('Add the country code instead of the first 0 (Thailand 66…, Morocco 212…).', true);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    api('POST', `/api/admin/customers/${el.dataset.id}/wamsg`, { ...waForm(), log: true }).then(async () => { const sent = state.admin.customers.find((x) => x.id === el.dataset.id); if (sent) sent.waSentAt = Date.now(); document.querySelectorAll(`[data-act="wa-one"][data-id="${el.dataset.id}"]`).forEach((b) => { b.classList.remove('wa-todo'); b.classList.add('wa-sent'); b.title = 'WhatsApp message sent ' + fmtDate(Date.now()) + ' — tap to send another'; }); if (phone !== String(state.admin.customers.find((x) => x.id === el.dataset.id)?.whatsapp || '').replace(/\D/g, '') && !state.admin.customers.find((x) => x.id === el.dataset.id)?.whatsapp) await api('PUT', `/api/admin/customers/${el.dataset.id}`, { whatsapp: phone }).catch(() => {}); }).catch(() => {});
  },
  'nl-open': async () => {
    const st = await api('GET', '/api/admin/newsletter'); const s = state.admin.settings;
    let d; try { d = JSON.parse(localStorage.getItem('tvp_nl_draft')); } catch {}
    const running = st.camp?.id && st.groups[st.camp.group]?.left > 0 && st.groups[st.camp.group]?.left < st.groups[st.camp.group]?.total;
    if (running) d = st.camp; d = { ...nlBlank(), ...(d || {}), content: { ...nlBlank().content, ...(d?.content || {}) } };
    const link = String(d.link || ''); const linkSel = ['', 'site', 'app'].includes(link) || link.startsWith('pkg:') ? link : 'url';
    const body = modal('📣 Newsletter / promotion email', `<form data-form="nl" onsubmit="return false" ${running ? `data-cid="${esc(d.id)}"` : ''}>
      ${running ? `<div class="notice info">⏸ Your last campaign stopped with <b>${st.groups[d.group].left}</b> customers still waiting. Press <b>Send</b> to continue it, or <a data-act="nl-new" style="cursor:pointer;text-decoration:underline">start a new one</a>.</div>` : ''}
      <div class="grid2">${field('Send to', 'group', d.group, { type: 'select', options: NL_GROUPS.map(([k, l]) => [k, `${l} (${st.groups[k].total})`]) })}${field('Languages', 'split', d.split ? '1' : '0', { type: 'select', options: [['0', 'One message for everyone'], ['1', 'Different message per language (EN / FR / AR)']] })}</div>
      <div id="nl-one">${field('Email language (greeting & footer)', 'lang', d.lang || 'en', { type: 'select', options: NL_LANGS })}${nlFields('all', d.content.all)}</div>
      <div id="nl-split"><p class="small muted" style="margin:0 0 6px">Each customer gets the version in their language. If one language is empty, they get English.</p><div class="row" style="gap:6px;margin-bottom:8px">${NL_LANGS.map(([k, l], i) => `<button type="button" class="btn sm ${i ? '' : 'primary'}" data-act="nl-tab" data-k="${k}">${l}</button>`).join('')}</div>${['en', 'fr', 'ar'].map((k) => nlFields(k, d.content[k])).join('')}</div>
      <div class="grid3">${field('Top badge (optional)', 'badge', d.badge, { ph: '🔥 Limited offer' })}${field('Coupon code (optional)', 'coupon', d.coupon, { ph: 'LION001' })}${field('Image URL (optional)', 'image', d.image, { attrs: 'autocapitalize="none"', ph: 'https://…/banner.jpg' })}</div>
      <div class="grid2">${field('Button opens', 'link', linkSel, { type: 'select', options: [['', 'No button'], ['site', 'Your website'], ['app', 'The INTPROTO-TV app'], ...s.orderPackages.map((p) => ['pkg:' + p.id, `Pay: ${p.title} (random Stripe link)`]), ['url', 'Other link…']] })}${field('Other link', 'linkUrl', linkSel === 'url' ? link : '', { attrs: 'autocapitalize="none"', ph: 'https://…' })}</div>
      <div class="row"><select id="nl-pvlang" style="width:auto">${NL_LANGS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button type="button" class="btn" data-act="nl-preview">👁 Preview</button><input id="nl-test" value="${esc(s.email.adminEmail || '')}" placeholder="test@email.com" style="flex:1;min-width:150px" autocapitalize="none"><button type="button" class="btn" data-act="nl-test">Send test</button></div>
      <iframe id="nl-pv" style="width:100%;height:55vh;border:0;border-radius:12px;background:#f4f7fa;display:none;margin-top:10px"></iframe>
      <div class="row" style="margin-top:12px"><span class="small muted" style="flex:1">Every email has an "Unsubscribe" link; unsubscribed customers are skipped${st.unsubscribed ? ` (${st.unsubscribed} so far)` : ''}. Sent 100 at a time. If Resend's daily limit stops it, open this again tomorrow and press Send to continue — nobody gets it twice.</span><button type="button" class="btn primary" data-act="nl-send">📨 Send</button></div>
      <div id="nl-out"></div></form>`, { wide: true });
    const f = $('[data-form=nl]', body);
    const sync = () => { const sp = f.split.value === '1'; $('#nl-one').style.display = sp ? 'none' : ''; $('#nl-split').style.display = sp ? '' : 'none'; f.linkUrl.closest('.field').style.display = f.link.value === 'url' ? '' : 'none'; };
    f.addEventListener('change', () => { sync(); nlRead(); }); f.addEventListener('input', () => nlRead());
    sync(); actions['nl-tab']({ dataset: { k: 'en' } });
  },
  'nl-tab': (el) => { document.querySelectorAll('#nl-split .nl-c').forEach((x) => (x.style.display = x.dataset.k === el.dataset.k ? '' : 'none')); document.querySelectorAll('[data-act=nl-tab]').forEach((b) => b.classList.toggle('primary', b.dataset.k === el.dataset.k)); },
  'nl-new': async () => { await api('POST', '/api/admin/newsletter/new', {}); try { localStorage.removeItem('tvp_nl_draft'); } catch {} closeModal(); actions['nl-open'](); },
  'nl-preview': async () => {
    const camp = nlRead(); const lang = $('#nl-pvlang').value;
    const pv = await api('POST', '/api/admin/newsletter/preview', { camp, lang, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') });
    const fr = $('#nl-pv'); fr.style.display = ''; fr.srcdoc = pv.html; fr.scrollIntoView({ behavior: 'smooth' }); toast('Subject: ' + pv.subject);
  },
  'nl-test': async (el) => {
    el.disabled = true;
    try { await api('POST', '/api/admin/newsletter/send', { camp: nlRead(), test: $('#nl-test').value, lang: $('#nl-pvlang').value, appUrl: location.origin }); toast('Test sent ✓'); } catch (e) { toast(e.message, true); }
    el.disabled = false;
  },
  'nl-send': async (el) => {
    const f = $('[data-form=nl]'); const camp = nlRead(); const grp = f.group.value; const label = f.group.selectedOptions[0].textContent;
    if (!confirm(`Send this email to: ${label}?`)) return;
    el.disabled = true; const out = $('#nl-out'); let total = 0;
    try {
      for (let i = 0; i < 100; i++) {
        out.innerHTML = `<div class="spinner"></div><p class="small muted" style="text-align:center">Sent ${total}…</p>`;
        if (i) await new Promise((ok) => setTimeout(ok, 700));
        const r = await api('POST', '/api/admin/newsletter/send', { camp: { ...camp, id: f.dataset.cid || camp.id }, group: grp, appUrl: location.origin });
        f.dataset.cid = r.id; total += r.sent;
        if (!r.left || !r.sent) { out.innerHTML = `<div class="notice success">✅ Sent ${total} emails.${r.left ? ` ${r.left} still waiting.` : ' Everyone in this group got it.'}</div>`; break; }
      }
    } catch (e) { out.innerHTML = `<div class="notice danger">${esc(e.message)} — sent ${total}. Open the newsletter again later and press Send to continue.</div>`; }
    el.disabled = false;
  },
  'order-custom': async () => {
    const s = state.admin.settings; const p0 = s.orderPackages[0] || {};
    const body = modal('✍️ Custom package email', `<form data-form="order-custom" onsubmit="return false">
      <div class="grid2">${field('Email address', 'to', '', { type: 'email', attrs: 'required autocapitalize="none"', ph: 'customer@gmail.com' })}${field('Customer name', 'name', '', { ph: 'Leave empty for "Dear Valued Customer"' })}</div>
      <div class="grid2">${field('Language', 'lang', 'en', { type: 'select', options: [['en', 'English'], ['fr', 'Français'], ['ar', 'العربية']] })}${field('Package', 'pkg', p0.id, { type: 'select', options: s.orderPackages.map((p) => [p.id, `${p.title} — ${orderPrice(s, p)}`]) })}</div>
      <details><summary class="small muted" style="cursor:pointer;margin:6px 0">Change the details (optional)</summary>
        <div class="grid3">${field('Package name', 'title', '', { ph: p0.title })}${field('Price', 'price', '', { type: 'number', attrs: 'step="any" min="0"', ph: String(p0.price ?? '') })}${field('Currency', 'currency', s.orderCurrency || 'EUR', { type: 'select', options: [['ALL', 'Random € or $'], ['EUR', '€ EUR'], ['USD', '$ USD'], ['USDT', '₮ USDT']] })}</div>
        <div class="grid3">${field('Days', 'days', '', { type: 'number', attrs: 'min="1"', ph: String(p0.days ?? '') })}${field('Devices', 'devices', '', { type: 'number', attrs: 'min="1"', ph: String(p0.devices ?? '') })}${field('Top badge', 'badge', '', { ph: 'e.g. 🎁 Special offer' })}</div>
        ${field('Pay link', 'link', '', { attrs: 'autocapitalize="none"', ph: 'Empty = random Stripe link of this package', help: 'Paste a special Stripe link here for a custom price.' })}
        ${field('Email subject', 'subject', '', { ph: 'Empty = automatic' })}
      </details>
      ${field('Personal message', 'note', '', { type: 'textarea', ph: 'Optional — shown in the email under the greeting' })}
      <div class="row"><button type="button" class="btn" data-act="oc-preview">👁 Preview</button><span class="spacer"></span><button type="button" class="btn primary" data-act="oc-send">📨 Send email</button></div>
      <p class="small muted" id="oc-subj"></p><iframe id="oc-pv" style="width:100%;height:50vh;border:0;border-radius:12px;background:#f4f7fa;display:none"></iframe></form>`, { wide: true });
    const f = $('[data-form=order-custom]', body);
    f.pkg.addEventListener('change', () => { const p = s.orderPackages.find((x) => x.id === f.pkg.value) || {}; f.title.placeholder = p.title || ''; f.price.placeholder = p.price ?? ''; f.days.placeholder = p.days ?? ''; f.devices.placeholder = p.devices ?? ''; });
  },
  'oc-preview': async () => {
    const f = $('[data-form=order-custom]'); const d = Object.fromEntries(new FormData(f));
    try { const pv = await api('POST', '/api/admin/order/custom', { ...d, preview: true, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') }); $('#oc-subj').innerHTML = 'Subject: <b>' + esc(pv.subject) + '</b>'; const fr = $('#oc-pv'); fr.style.display = ''; fr.srcdoc = pv.html; fr.scrollIntoView({ behavior: 'smooth' }); }
    catch (e) { toast(e.message, true); }
  },
  'oc-send': async (el) => {
    const f = $('[data-form=order-custom]'); const d = Object.fromEntries(new FormData(f));
    if (!f.to.reportValidity()) return;
    el.disabled = true;
    try { const r = await api('POST', '/api/admin/order/custom', { ...d, saveCustomer: true, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') }); const acc = (state.admin.settings.orderAccounts || []).find((a) => a.id === r.payAcc); toast(`Sent to ${d.to} ✓${acc ? ' · Stripe: ' + acc.name : ''}`); closeModal(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'order-bulk': async () => {
    if (!state.admin.customers) state.admin.customers = await api('GET', '/api/admin/customers');
    const s = state.admin.settings; const n = (g) => orderTargets(g).length;
    modal('💳 Package emails to many customers', `<label class="small muted">Package</label><select id="ob-pkg"><option value="random">🎲 Random package for each customer</option>${s.orderPackages.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} — ${orderPrice(s, p)}</option>`).join('')}</select>
      <label class="small muted" style="margin-top:10px;display:block">Send to</label><select id="ob-grp">${[['expired', 'Expired customers'], ['expiring', 'Expiring soon'], ['active', 'Active customers'], ['trial', 'Trial users'], ['notrecent', 'Everyone not emailed in the last 7 days'], ['all', 'All customers']].map(([k, l]) => `<option value="${k}">${l} (${n(k)})</option>`).join('')}</select>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-act="order-go">📨 Send now</button></div>
      <p class="small muted">Sent in batches of 100. Customers with a broken email address are skipped. Your Resend plan must allow that many emails (free plan: 100/day, 3,000/month).</p><div id="ob-out"></div>`);
  },
  'order-go': async (el) => {
    const grp = $('#ob-grp').value; const pkg = $('#ob-pkg').value; const ids = orderTargets(grp).map((c) => c.id);
    if (!ids.length) return toast('Nobody in this group has an email.', true);
    if (!confirm(`Send ${pkg === 'random' ? 'a random package email' : 'this package email'} to ${ids.length} customers?`)) return;
    el.disabled = true; const out = $('#ob-out'); let total = 0;
    try {
      for (let i = 0; i < ids.length; i += 100) {
        out.innerHTML = `<div class="spinner"></div><p class="small muted" style="text-align:center">Sent ${total} of ${ids.length}…</p>`;
        if (i) await new Promise((ok) => setTimeout(ok, 700));
        const r = await api('POST', '/api/admin/order/send', { ids: ids.slice(i, i + 100), pkg, appUrl: location.origin }); total += r.sent;
      }
      out.innerHTML = `<div class="notice success">✅ Sent ${total} package emails.${ids.length - total ? ` ${ids.length - total} skipped (invalid email).` : ''}</div>`;
      state.admin.customers = await api('GET', '/api/admin/customers');
    } catch (e) { out.innerHTML = `<div class="notice danger">${esc(e.message)} (sent ${total})</div>`; el.disabled = false; }
  },
  'renewal-one': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    const appUrl = location.origin + location.pathname.replace(/index\.html$/, '');
    const pv = await api('GET', `/api/admin/customers/${c.id}/renewalpreview?appUrl=${encodeURIComponent(appUrl)}`);
    const body = modal('🔁 Renewal offer', `<p class="muted small" style="margin-top:0">Subject: <b>${esc(pv.subject)}</b>${c.renewalSentAt ? ` · already sent ${fmtDate(c.renewalSentAt)}` : ''}</p><iframe id="mail-pv" style="width:100%;height:60vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>
      <div class="row" style="margin-top:12px"><input id="mail-to" value="${esc(c.email || '')}" style="flex:1" autocapitalize="none"><button class="btn primary" data-act="renewal-send" data-id="${c.id}">Send renewal email</button></div>`, { wide: true });
    $('#mail-pv', body).srcdoc = pv.html;
  },
  'renewal-send': async (el) => {
    el.disabled = true;
    try { await api('POST', `/api/admin/customers/${el.dataset.id}/renewal`, { to: $('#mail-to').value, appUrl: location.origin }); toast('Renewal email sent ✓'); closeModal(); if (state.admin.tab === 'customers') { state.admin.customers = await api('GET', '/api/admin/customers'); $('#cust-list').innerHTML = customerListHtml(); } }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'renewal-bulk': async () => {
    const st = await api('GET', '/api/admin/renewal/status');
    const left = Math.max(0, st.dailyLimit - st.sentToday);
    modal('🔁 Renewal emails', `<p>Expired customers with an email who haven't had the offer for their latest expiry: <b>${st.waiting}</b> (expired in the last ${state.admin.settings.renewalOffer.autoDays} days: <b>${st.recent}</b>).</p>
      <p class="small muted">Sent today: ${st.sentToday} / ${st.dailyLimit}. You can send <b>${left}</b> more today. Newest expiries go first; the rest can be sent on the next days.</p>
      <div class="row"><button class="btn primary" data-act="renewal-go" data-all="1" ${st.waiting ? '' : 'disabled'}>📨 Send to ALL ${st.waiting} now</button><button class="btn" data-act="renewal-go" ${left && st.waiting ? '' : 'disabled'}>Today's limit only (${Math.min(left, st.waiting)})</button><button class="btn" data-act="renewal-go" data-recent="1" ${left && st.recent ? '' : 'disabled'}>Only recent (${Math.min(left, st.recent)})</button></div>
      <p class="small muted">"Send to ALL" ignores the daily limit and sends in batches of 100. Your Resend plan must allow that many emails (free plan: 100/day, 3,000/month) — if Resend stops, the rest stay waiting.</p>
      <div id="rb-out" style="margin-top:12px"></div>
      ${st.invalid.length ? `<div class="notice warning" style="margin-top:12px"><b>⚠️ ${st.invalid.length} expired customers have an invalid email</b> — they are skipped. Fix them with Edit:<div class="small" style="margin-top:6px">${st.invalid.map((c) => `<div class="row" style="justify-content:space-between;padding:3px 0"><span>${esc(c.name)} <span class="tagp">${esc(c.orderNo || c.username)}</span> <span class="muted">“${esc(c.email)}”</span></span><button class="btn sm" data-act="edit-customer" data-id="${c.id}">Edit</button></div>`).join('')}</div></div>` : ''}`);
  },
  'renewal-go': async (el) => {
    const all = !!el.dataset.all;
    if (all && !confirm('Send the renewal offer to ALL expired customers now?')) return;
    const out = $('#rb-out'); document.querySelectorAll('[data-act=renewal-go]').forEach((b) => (b.disabled = true));
    let total = 0;
    try {
      for (let i = 0; i < 60; i++) {
        out.innerHTML = `<div class="spinner"></div><p class="small muted" style="text-align:center">Sent ${total}…</p>`;
        if (i) await new Promise((ok) => setTimeout(ok, 700));
        const r = await api('POST', '/api/admin/renewal/send', { all, appUrl: location.origin, onlyRecentDays: el.dataset.recent ? state.admin.settings.renewalOffer.autoDays : 0 });
        total += r.sent;
        if (!r.sent || r.limitReached) { out.innerHTML = `<div class="notice success">✅ Sent ${total} renewal emails.${r.limitReached ? " Today's limit is reached — continue tomorrow." : ''} ${r.waiting} still waiting.</div>`; break; }
      }
    } catch (e) { out.innerHTML = `<div class="notice danger">${esc(e.message)} (sent ${total})</div>`; }
  },
  'email-login': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    const appUrl = location.origin + location.pathname.replace(/index\.html$/, '');
    const pv = await api('GET', `/api/admin/customers/${c.id}/emailpreview?appUrl=${encodeURIComponent(appUrl)}`);
    const body = modal('✉️ Email login details', `<p class="muted small" style="margin-top:0">Subject: <b>${esc(pv.subject)}</b></p><iframe id="mail-pv" style="width:100%;height:60vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>
      <div class="row" style="margin-top:12px"><input id="mail-to" value="${esc(c.email || '')}" style="flex:1" autocapitalize="none"><button class="btn primary" data-act="email-send" data-id="${c.id}">Send email</button></div>`, { wide: true });
    $('#mail-pv', body).srcdoc = pv.html;
  },
  'email-send': async (el) => {
    el.disabled = true;
    try { await api('POST', `/api/admin/customers/${el.dataset.id}/email`, { to: $('#mail-to').value, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') }); toast('Email sent ✓'); closeModal(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'close-modal': () => closeModal(),
  'new-member': () => modal('Add team member', memberForm(null), { wide: true }),
  'edit-member': (el) => modal('Edit team member', memberForm(state.admin.team.find((x) => x.id === el.dataset.id)), { wide: true }),
  'toggle-member': async (el) => { const m = state.admin.team.find((x) => x.id === el.dataset.id); await api('PUT', '/api/admin/team/' + m.id, { status: m.status === 'disabled' ? 'active' : 'disabled' }); toast('Updated ✓'); renderAdmin(); },
  'del-member': async (el) => { const m = state.admin.team.find((x) => x.id === el.dataset.id); if (!confirm(`Remove ${m.name}? They will no longer be able to sign in.`)) return; await api('DELETE', '/api/admin/team/' + m.id); toast('Removed'); renderAdmin(); },
  preset: (el) => { const p = PRESETS[el.dataset.p]; document.querySelectorAll('[data-perm-cb]').forEach((cb) => { cb.checked = !p || p.includes(cb.value); }); const r = $('form[data-form=member] [name=role]'); if (r && el.dataset.p !== 'Full access') r.value = el.dataset.p; },
  'trial-login': async (el) => { closeModal(); try { const r = await api('POST', '/api/login', { username: el.dataset.u, password: el.dataset.p }); setSession(r.token, r.role); route(); } catch (e) { renderLogin(e.message); } },
  theme: () => {
    const order = ['auto', 'light', 'dark']; const next = order[(order.indexOf(themeMode()) + 1) % 3];
    localStorage.setItem('tvp_theme', next); applyTheme(); toast('Theme: ' + themeLabel());
  },
  lang: (el) => { setLang(el.dataset.lang, true); if (state.role === 'user' && state.token) renderUser(); else route(); },
  trial: () => modal('🎁 ' + t('trialTitle', { hours: state.config.trial.hours }), trialForm()),
  'new-tx': async (el) => { if (!state.admin.settings) state.admin.settings = await api('GET', '/api/admin/settings'); const type = el.dataset.type || 'income'; modal(type === 'income' ? 'Add income' : type === 'expense' ? 'Add expense' : 'Transfer between banks', txForm(type, el.dataset.acc)); },
  'del-tx': async (el) => { if (!confirm('Delete this transaction? If it is a sale or a credit purchase, that sale / purchase is removed too (profits and stock update).')) return; await api('DELETE', '/api/admin/tx/' + el.dataset.id); toast('Deleted'); renderAdmin(); },
  'tx-filter': (el) => { state.admin.txAccount = el.dataset.acc; renderAdmin(); },
  'stripe-match': async (el) => { if (!confirm('Add one adjustment so the Stripe bank in the app equals your real Stripe balance?')) return; const r = await api('POST', '/api/admin/stripe/match', { target: Number(el.dataset.target) }); toast(`Stripe synced (${r.diff > 0 ? '+' : ''}${r.diff}) ✓`); renderAdmin(); },
  'refresh-rates': async () => { await api('POST', '/api/admin/rates/refresh'); toast('Rates updated ✓'); renderAdmin(); },
  'add-acc': () => $('#acc-rows').insertAdjacentHTML('beforeend', accRow({ name: '', currency: 'USD', opening: 0, color: '#7c5cff' })),
  'del-acc': (el) => { if (confirm('Remove this bank? Its transactions stay but will not count in balances.')) el.closest('.acc-row').remove(); },
  'save-accounts': async () => {
    const accounts = [...document.querySelectorAll('#acc-rows .acc-row')].map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`).value; return { id: r.dataset.acc || undefined, name: g('name'), currency: g('currency'), opening: Number(g('opening')), color: g('color') }; }).filter((a) => a.name);
    const rates = {}; document.querySelectorAll('[data-rate]').forEach((i) => { rates[i.dataset.rate] = Number(i.value) || 1; });
    await saveSettings({ finance: { accounts, rates, autoRates: $('#auto-rates').checked, stripeKey: $('#stripe-key').value.trim() } }); renderAdmin();
  },
  'export-tx': async () => {
    const f = state.admin.finance; const tx = await api('GET', '/api/admin/tx?limit=100000');
    const n = (id) => f.accounts.find((a) => a.id === id)?.name || '';
    const rows = [['Date', 'Type', 'Account', 'Amount', 'To account', 'Amount received', 'Category', 'Note']].concat(tx.map((x) => [new Date(x.at).toISOString(), x.type, n(x.accountId), x.amount, n(x.toAccountId), x.toAmount ?? '', x.category, x.note]));
    download('transactions.csv', '\ufeff' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  },
  period: (el) => { state.admin.period = el.dataset.p; renderAdmin(); },
  pack: (el) => { const f = $('form[data-form=stock]'); const pk = state.admin.settings.stock; f.credits.value = pk.packCredits * el.dataset.n; f.cost.value = pk.packPrice * el.dataset.n; },
  'del-stock': async (el) => { if (!confirm('Delete this purchase and its expense?')) return; await api('DELETE', '/api/admin/stock/' + el.dataset.id); renderAdmin(); },
  'test-email': async () => {
    const out = $('#test-email-out'); out.innerHTML = '<div class="spinner"></div>';
    await saveSettings(formToObj($('form[data-form=settings]')), true);
    const r = await api('POST', '/api/admin/email/test', { to: $('#test-to').value }).catch((e) => ({ ok: false, error: e.message }));
    out.innerHTML = `<div class="notice ${r.ok ? 'success' : 'danger'}" style="margin-top:10px">${r.ok ? '✅ Test email sent' : '❌ ' + esc(r.error || 'Failed')}</div>`;
  },
  'modal-bg': (el, e) => { if (e.target === el) closeModal(); },
  'pw-eye': (el) => { const i = el.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; },
  logout: async () => { try { await api('POST', '/api/logout'); } catch {} setSession(null); document.body.className = ''; await refreshConfig(); route(); },
  atab: (el) => { state.admin.tab = el.dataset.tab; window.scrollTo(0, 0); renderAdmin(); },
  'cust-filter': (el) => { state.admin.filter = el.dataset.f; state.admin.custLimit = 60; $('#admin-body').innerHTML = adminCustomers(); },
  'cust-more': () => { state.admin.custLimit = (state.admin.custLimit || 60) + 100; $('#cust-list').innerHTML = customerListHtml(); },
  'new-customer': () => { modal('Add customer', customerForm(null), { wide: true }); },
  'edit-customer': async (el) => { if (!(state.admin.customers || []).some((x) => x.id === el.dataset.id)) state.admin.customers = await api('GET', '/api/admin/customers'); const c = state.admin.customers.find((x) => x.id === el.dataset.id); modal('Edit customer', customerForm(c), { wide: true }); },
  'gen-login': () => {
    const f = $('form[data-form=customer]');
    const rnd = (n, chars) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => chars[x % chars.length]).join('');
    f.username.value = 'u' + rnd(6, '0123456789');
    f.password.value = rnd(8, 'abcdefghjkmnpqrstuvwxyz23456789');
  },
  renew: async (el) => {
    if (!state.admin.customers.length || !state.admin.customers.find((x) => x.id === el.dataset.id)) state.admin.customers = await api('GET', '/api/admin/customers');
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    modal('Renew subscription', renewForm(c)); updateRenewPreview();
  },
  'toggle-customer': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    try { await api('POST', `/api/admin/customers/${c.id}/toggle`, {}); toast(c.status === 'disabled' ? 'Customer enabled' : 'Customer disabled'); }
    catch (e) {
      if (!confirm(`${e.message}\n\nChange it in the app anyway?`)) return;
      await api('POST', `/api/admin/customers/${c.id}/toggle`, { force: true });
    }
    renderAdmin();
  },
  'del-customer': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    if (!confirm(`Delete ${c.name} (${c.username})? This cannot be undone.`)) return;
    const s = state.admin.settings;
    const panel = s.reseller.enabled && c.lineId && confirm('Also delete the line on the TVplus panel?');
    try { await api('DELETE', `/api/admin/customers/${c.id}?panel=${panel ? 1 : 0}`); }
    catch (e) { if (!confirm(`${e.message}\n\nDelete from the app anyway?`)) return; await api('DELETE', `/api/admin/customers/${c.id}?panel=1&force=1`); }
    toast('Customer deleted'); renderAdmin();
  },
  'copy-login': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    const b = state.config.branding;
    const text = `${b.appName}\n🌐 ${location.origin}\n👤 Username: ${c.username}\n📅 Expires: ${fmtDate(c.expiresAt)}\n(Password as given when the account was created)`;
    try { await navigator.clipboard.writeText(text); toast('Login details copied'); } catch { prompt('Copy:', text); }
  },
  'export-xlsx': async () => {
    toast('Preparing Excel…');
    if (!window.XLSX) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
    const list = await api('GET', '/api/admin/customers');
    const d = (x) => (x ? isoDay(x) : '');
    const rows = list.sort((a, b) => String(a.orderNo || a.username).localeCompare(String(b.orderNo || b.username), undefined, { numeric: true })).map((c) => ({
      'Order number': c.orderNo || '', 'Full name': c.name, Email: c.email || '', Phone: c.phone || '', WhatsApp: c.whatsapp || c.phone || '', Country: c.country || '', Address: c.address || '',
      'App username': c.username, 'App password': c.loginPassword || '(changed by customer)', 'IPTV line username': c.lineUsername || '', 'IPTV line password': c.linePassword || '',
      Plan: c.planName, Devices: c.connections, 'Start date': d(c.startAt), 'Expiry date': d(c.expiresAt), 'Days left': c.daysLeft, Status: c.state,
      Price: c.price ?? (c.renewals?.at(-1)?.price ?? ''), Currency: c.currency || '', 'Payment method': c.paymentMethod || '', Server: c.server || '', Panel: c.panel || '', Device: c.device || '',
      Promotion: c.promotion || '', 'Order status': c.orderStatus || '', Refunded: c.refunded ? 'YES' : '', 'Free trial': c.isTrial ? 'YES' : '', Notes: c.note || '', 'Created': d(c.createdAt || c.startAt), 'Last login': d(c.lastLogin),
    }));
    const ws = window.XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2, ...rows.slice(0, 200).map((r) => String(r[k] ?? '').length))) }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Clients');
    window.XLSX.writeFile(wb, `INTPROTO-TV-clients-${isoDay(Date.now())}.xlsx`);
  },
  'export-csv': () => {
    const rows = [['Name', 'Username', 'Phone', 'Plan', 'Start', 'Expires', 'Days left', 'Status', 'Line ID']]
      .concat(state.admin.customers.map((c) => [c.name, c.username, c.phone, c.planName, isoDay(c.startAt), isoDay(c.expiresAt), c.daysLeft, c.state, c.lineId]));
    const csv = rows.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    download('subscriptions.csv', '﻿' + csv, 'text/csv');
  },
  'sell-rp': () => modal('🤝 Sell a reseller package', resellerSaleForm(state.admin.settings)),
  'add-rp': () => $('#rps').insertAdjacentHTML('beforeend', `<div class="rp-row" data-rp=""><input data-k="name" placeholder="Name"><input data-k="credits" type="number" value="10"><input data-k="price" type="number" step="any" value="0"><button class="btn sm danger" data-act="del-rp">✕</button></div>`),
  'del-rp': (el) => el.closest('.rp-row').remove(),
  'save-rp': async () => {
    const resellerPackages = [...document.querySelectorAll('#rps .rp-row')].map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`).value; return { id: r.dataset.rp || undefined, name: g('name'), credits: Number(g('credits')), price: Number(g('price')) }; }).filter((p) => p.name);
    await saveSettings({ resellerPackages, resellerCurrency: $('#rp-cur').value }); renderAdmin();
  },
  'add-plan': () => { $('#plans').insertAdjacentHTML('beforeend', `<div class="plan-row" data-plan=""><input data-k="name" placeholder="Name"><input data-k="days" type="number" value="30"><input data-k="price" type="number" value="0"><input data-k="credits" type="number" value="1"><input data-k="connections" type="number" value="1"><input data-k="package" placeholder="Package ID"><button class="btn sm danger" data-act="del-plan">✕</button></div>`); },
  'del-plan': (el) => el.closest('.plan-row').remove(),
  'save-plans': async () => {
    const plans = [...document.querySelectorAll('#plans .plan-row')].map((r) => {
      const g = (k) => r.querySelector(`[data-k=${k}]`).value;
      return { id: r.dataset.plan || undefined, name: g('name'), days: Number(g('days')), price: Number(g('price')), credits: g('credits'), connections: Number(g('connections')), package: g('package') };
    }).filter((p) => p.name);
    if (!plans.length) return toast('Add at least one plan', true);
    await saveSettings({ plans, currency: $('#currency').value });
    renderAdmin();
  },
  'test-player': async () => {
    const out = $('#test-player-out'); out.innerHTML = '<div class="spinner"></div>';
    await saveSettings(formToObj($('form[data-form=settings]')), true);
    const r = await api('POST', '/api/admin/panel/test', { target: 'player', username: $('#test-u').value, password: $('#test-p').value }).catch((e) => ({ ok: false, error: e.message }));
    showResult(out, r);
  },
  'test-reseller': async () => {
    const out = $('#test-reseller-out'); out.innerHTML = '<div class="spinner"></div>';
    await saveSettings(formToObj($('form[data-form=settings]')), true);
    const r = await api('POST', '/api/admin/panel/test', { target: 'reseller' }).catch((e) => ({ ok: false, error: e.message }));
    showResult(out, r);
  },
  backup: async () => { const d = await api('GET', '/api/admin/backup'); download(`iptv-backup-${isoDay(Date.now())}.json`, JSON.stringify(d, null, 2), 'application/json'); },
  'reset-demo': () => { if (!confirm('Erase all demo data?')) return; Object.keys(localStorage).filter((k) => k.startsWith('tvp_')).forEach((k) => localStorage.removeItem(k)); location.reload(); },
  // user
  utab: (el) => { state.user.tab = el.dataset.tab; state.user.q = ''; state.user.limit = 120; window.scrollTo(0, 0); renderUser(); },
  ucat: (el) => { state.user.cat[state.user.tab] = el.dataset.cat; state.user.limit = 120; renderUserTab(); },
  more: () => { state.user.limit += 120; renderUserTab(); },
  'open-item': (el, e) => { if (e.target.closest('.fav')) return; openItem(JSON.parse(el.dataset.item)); },
  fav: (el, e) => { e.stopPropagation(); toggleFav(JSON.parse(el.dataset.item)); el.classList.toggle('on'); if (state.user.tab === 'home') renderUserTab(); },
  'play-movie': (el) => { const i = JSON.parse(el.dataset.item); play(i.name, 'movie', i.id, i.ext); },
  'play-ep': (el) => { const i = JSON.parse(el.dataset.item); play(i.name, 'series', i.id, i.ext); },
  season: (el) => { const body = el.closest('.modal-body'); body.querySelectorAll('#seasons a').forEach((a) => a.classList.toggle('on', a === el)); $('#eps').innerHTML = body._renderSeason(el.dataset.sn); },
};

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function saveSettings(partial, quiet) {
  try {
    state.admin.settings = await api('PUT', '/api/admin/settings', partial);
    await refreshConfig();
    if (!quiet) toast('Saved ✓');
  } catch (e) { toast(e.message, true); throw e; }
}

const forms = {
  async 'rp-sale'(f) {
    try { await api('POST', '/api/admin/reseller-sale', formToObj(f)); toast('Reseller sale recorded ✓'); closeModal(); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
  async member(f) {
    const o = formToObj(f); o.perms = [...f.querySelectorAll('[data-perm-cb]:checked')].map((x) => x.value);
    if (!o.password) delete o.password;
    try { if (f.dataset.id) await api('PUT', '/api/admin/team/' + f.dataset.id, o); else await api('POST', '/api/admin/team', o); toast('Saved ✓'); closeModal(); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
  async 'staff-password'(f) {
    try { await api('POST', '/api/admin/me/password', formToObj(f)); toast('Password changed ✓'); f.reset(); } catch (e) { toast(e.message, true); }
  },
  async trial(f) {
    const o = formToObj(f);
    const body = { name: o.name, email: o.email, phone: o.phone, whatsapp: o.same ? o.phone : o.whatsapp, lang: getLang(), appUrl: location.origin + location.pathname.replace(/index\.html$/, '') };
    const btn = f.querySelector('button.primary'); btn.disabled = true;
    try {
      const r = await api('POST', '/api/trial', body);
      const box = $('.modal-body');
      box.innerHTML = r.username
        ? `<p>${t('trialShown')}</p><div class="code" dir="ltr">${t('username')}: ${esc(r.username)}\n${t('password')}: ${esc(r.password)}</div>${r.emailed ? `<p class="small muted">${t('trialSent', { email: esc(o.email) })}</p>` : ''}<button class="btn primary block" data-act="trial-login" data-u="${esc(r.username)}" data-p="${esc(r.password)}" style="margin-top:12px">${t('signIn')}</button>`
        : `<div class="notice success">${t('trialSent', { email: esc(o.email) })}</div><button class="btn block" data-act="close-modal">${t('haveAccount')}</button>`;
    } catch (e) { $('#trial-err').innerHTML = `<div class="err-box">${esc(t(e.message))}</div>`; btn.disabled = false; }
  },
  async tx(f) {
    try { await api('POST', '/api/admin/tx', formToObj(f)); toast('Saved ✓'); closeModal(); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
  async stock(f) {
    try { await api('POST', '/api/admin/stock', formToObj(f)); toast('Credits added to stock ✓'); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
  async login(f) {
    const btn = f.querySelector('button.primary'); btn.disabled = true;
    try {
      const r = await api('POST', '/api/login', { username: f.username.value, password: f.password.value });
      localStorage.setItem('tvp_known', '1'); setSession(r.token, r.role); route();
    } catch (e) {
      if (e.data?.need2fa) { btn.disabled = false; state.pendingLogin = { username: f.username.value, password: f.password.value }; const b = modal('🔐 ' + t('code2faTitle'), `<p class="muted" style="margin-top:0">${t('code2faText')}</p><form data-form="login-code">${field(t('code2fa'), 'code', '', { attrs: 'required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" dir="ltr"' })}<div id="code-err"></div><button class="btn primary block">${t('verify')}</button></form>`); b.querySelector('input').focus(); return; }
      renderLogin(e.message);
    }
  },
  async setup(f) {
    try { const r = await api('POST', '/api/setup', { username: f.username.value, password: f.password.value }); setSession(r.token, r.role); await refreshConfig(); state.admin.tab = 'api'; route(); }
    catch (e) { toast(e.message, true); }
  },
  async settings(f) { await saveSettings(formToObj(f)); if (state.admin.tab === 'branding') renderAdmin(); },
  async customer(f) {
    const o = formToObj(f);
    const id = f.dataset.id;
    if (o.planId === 'custom' && !o.expiresAt) return toast('Pick an expiry date for custom plans', true);
    const btn = f.querySelector('button.primary'); btn.disabled = true;
    try {
      if (id) { if (!o.password) delete o.password; if (!o.expiresAt) delete o.expiresAt; await api('PUT', `/api/admin/customers/${id}`, o); toast('Customer updated'); }
      else {
        o.appUrl = location.origin + location.pathname.replace(/index\.html$/, '');
        const r = await api('POST', '/api/admin/customers', o);
        toast(r.panel && !r.panel.skipped ? 'Customer created + line added on panel ✓' : 'Customer created ✓');
        if (r.mail) toast(r.mail.ok ? `Login emailed to ${o.email} ✓` : 'Email failed: ' + (r.mail.error || ''), !r.mail.ok);
        if (r.duplicates?.length) toast(`⚠️ Same details as: ${r.duplicates.slice(0, 3).map((x) => `${x.name} (${x.username}, ${x.why.join('+')})`).join('; ')}`, true);
        const b = state.config.branding;
        const text = `${b.appName}\n🌐 ${location.origin}\n👤 Username: ${o.username}\n🔑 Password: ${o.password}\n📅 Expires: ${fmtDate(r.customer.expiresAt)}`;
        closeModal();
        modal('Customer created 🎉', `<p class="muted">Send these login details to your customer:</p><div class="code" id="newlogin">${esc(text)}</div><div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn primary" data-act="copy-new">📋 Copy</button></div>`);
        actions['copy-new'] = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { prompt('Copy:', text); } };
        state.admin.customers = await api('GET', '/api/admin/customers');
        if (state.admin.tab === 'customers') $('#admin-body').innerHTML = adminCustomers(); else if (state.admin.tab === 'overview') renderAdminBodyOnly();
        return;
      }
      closeModal(); renderAdmin();
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  },
  async renew(f) {
    const o = formToObj(f);
    const btn = f.querySelector('button.primary'); btn.disabled = true;
    try {
      const r = await api('POST', `/api/admin/customers/${f.dataset.id}/renew`, o);
      toast(`Renewed until ${fmtDate(r.customer.expiresAt)} ✓`); closeModal(); renderAdmin();
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  },
  async 'admin-account'(f) {
    try { await api('POST', '/api/admin/account', formToObj(f)); toast('Admin login updated ✓'); f.currentPassword.value = ''; f.newPassword.value = ''; }
    catch (e) { toast(e.message, true); }
  },
  async 'user-password'(f) {
    try { await api('POST', '/api/me/password', formToObj(f)); toast(t('pwUpdated')); f.reset(); }
    catch (e) { toast(e.message, true); }
  },
};
async function renderAdminBodyOnly() { if (state.admin.tab === 'overview') $('#admin-body').innerHTML = await adminOverview(); }

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { if (el.tagName === 'A' && !el.hasAttribute('data-keep')) e.preventDefault(); Promise.resolve(fn(el, e)).catch((err) => toast(err.message, true)); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.role === 'user' && state.user.me && Date.now() - (state.user.meAt || 0) > 60000) renderUser(); });
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  Promise.resolve(forms[f.dataset.form]?.(f)).catch((err) => toast(err.message, true));
});
let searchT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.input === 'dup-search') { state.admin.dupQ = t.value; clearTimeout(searchT); searchT = setTimeout(async () => { const pos = t.selectionStart; $('#admin-body').innerHTML = await adminDups(); const n = $('[data-input=dup-search]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 300); }
  if (t.dataset.input === 'cust-search') { state.admin.q = t.value; state.admin.custLimit = 60; clearTimeout(searchT); searchT = setTimeout(() => { $('#cust-list').innerHTML = customerListHtml(); }, 200); }
  if (t.dataset.input === 'u-search') { state.user.q = t.value; clearTimeout(searchT); searchT = setTimeout(() => { const pos = t.selectionStart; renderUserTab().then(() => { const n = $('[data-input=u-search]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); }, 300); }
  const pf = t.closest('form[data-preview]');
  if (pf) { const o = formToObj(pf).branding; applyBranding(o); $('#login-preview').innerHTML = loginCard(o, { preview: true }); }
  if (t.closest('form[data-form=renew]')) updateRenewPreview();
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.name === 'lineSame') $('#line-fields').style.display = t.checked ? 'none' : '';
  if (t.name === 'same' && t.form?.dataset.form === 'trial') $('#wa-field').style.display = t.checked ? 'none' : '';
  if (t.hasAttribute('data-tx-type')) { const acc = t.form.accountId.value; closeModal(); modal(t.value === 'income' ? 'Add income' : t.value === 'expense' ? 'Add expense' : 'Transfer between banks', txForm(t.value, acc)); }
  if (t.dataset.input === 'sub-days') { state.admin.subDays = t.value; $('#admin-body').innerHTML = await adminSubs(); }
  if ((t.form?.dataset.form === 'customer' && !t.form.dataset.id && (t.name === 'planId' || t.name === 'accountId')) || (t.form?.dataset.form === 'renew' && (t.name === 'planId' || t.name === 'accountId'))) {
    const st = state.admin.settings; const f = t.form;
    const p = st.plans.find((x) => x.id === f.planId.value);
    const acc = st.finance.accounts.find((a) => a.id === f.accountId?.value);
    if (p) { const r = st.finance.rates; const from = st.currency || 'USD'; const to = acc ? acc.currency : from;
      f.price.value = Math.round((p.price / (r[from] || 1)) * (r[to] || 1) * 100) / 100; }
  }
  if (t.form?.dataset.form === 'rp-sale' && (t.name === 'packageId' || t.name === 'accountId')) {
    const st = state.admin.settings; const f = t.form;
    const p = st.resellerPackages.find((x) => x.id === f.packageId.value);
    const acc = st.finance.accounts.find((a) => a.id === f.accountId.value);
    if (p) { const r = st.finance.rates; const from = st.resellerCurrency || 'EUR'; const to = acc ? acc.currency : from;
      f.amount.value = Math.round((p.price / (r[from] || 1)) * (r[to] || 1) * 100) / 100; }
  }
  if (t.hasAttribute('data-renew-plan')) {
    const p = state.admin.settings.plans.find((x) => x.id === t.value);
    const f = t.form; if (p) { f.days.value = p.days; f.credits.value = p.credits ?? ''; } updateRenewPreview();
  }
  if (t.name === 'planId' && t.form?.dataset.form === 'customer' && !t.form.dataset.id) {
    const p = state.admin.settings.plans.find((x) => x.id === t.value);
    if (p) { t.form.connections.value = p.connections; }
  }
  if (t.dataset.input === 'restore' && t.files[0]) {
    try {
      const data = JSON.parse(await t.files[0].text());
      if (!confirm(`Restore ${data.customers?.length ?? 0} customers and all settings? Current data will be replaced.`)) return;
      await api('POST', '/api/admin/restore', data); await refreshConfig(); toast('Backup restored ✓'); renderAdmin();
    } catch (err) { toast(err.message || 'Invalid file', true); }
  }
});

// TV remotes & keyboards: make every clickable item focusable and press it with OK/Enter.
function tvFocus(root = document) {
  root.querySelectorAll('[data-act]:not(a[href]):not(button):not([tabindex])').forEach((el) => el.setAttribute('tabindex', '0'));
}
new MutationObserver(() => tvFocus()).observe(document.getElementById('app'), { childList: true, subtree: true });
new MutationObserver(() => tvFocus()).observe(document.getElementById('modal-root'), { childList: true, subtree: true });
document.addEventListener('keydown', (e) => {
  const el = document.activeElement;
  if ((e.key === 'Enter' || e.key === ' ') && el && el.hasAttribute('data-act') && el.tagName !== 'BUTTON' && !(el.tagName === 'A' && el.hasAttribute('href'))) { e.preventDefault(); el.click(); }
  if ((e.key === 'Escape' || e.key === 'Backspace' && !/INPUT|TEXTAREA/.test(el?.tagName || '')) && $('#modal-root').innerHTML) { e.preventDefault(); closeModal(); }
});
// =====================================================================
// Public website, sign-in help, account portal, library, parental PIN,
// admin support desk, two-factor login and automatic Stripe payments
// =====================================================================

// ---------------- public website ----------------
const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } };
// Visitors see the website. The installed apps, and devices that have signed in before, open the sign-in screen directly.
const wantsSite = () => !bridge() && (state.forceSite || (!state.showLogin && !isStandalone() && !localStorage.getItem('tvp_known')));
function renderSite() {
  setWaFab(null);
  $('#app').innerHTML = siteHtml({ config: state.config, lang: getLang(), langs: LANGS, page: state.sitePage || 'home' });
}

// ---------------- watch history (kept on this device only) ----------------
const histKey = () => 'tvp_hist_' + (state.user.me?.user?.username || '');
const getHist = () => { try { return JSON.parse(localStorage.getItem(histKey())) || []; } catch { return []; } };
const putHist = (l) => { try { localStorage.setItem(histKey(), JSON.stringify(l.slice(0, 60))); } catch {} };
function recordWatch(i) {
  const l = getHist(); const old = l.find((x) => x.kind === i.kind && String(x.id) === String(i.id));
  putHist([{ ...old, ...i, icon: i.icon || old?.icon || '', at: Date.now() }, ...l.filter((x) => x !== old)]);
}
function savePos(kind, id, pos, dur) {
  const l = getHist(); const h = l.find((x) => x.kind === kind && String(x.id) === String(id)); if (!h) return;
  h.pos = Math.floor(pos); h.dur = Math.floor(dur); h.at = Date.now(); putHist(l);
}
function libraryHtml() {
  if (blockedScreen()) return '';
  const l = getHist();
  const cont = l.filter((x) => x.kind !== 'live' && x.pos > 30 && x.dur && x.pos < x.dur * 0.95).slice(0, 8);
  const recent = l.filter((x) => x.kind === 'live').slice(0, 12);
  if (!cont.length && !recent.length) return '';
  const row = (x) => `<div class="cw" data-act="open-item" data-item="${esc(JSON.stringify({ kind: x.kind, id: x.id, name: x.name, icon: x.icon, ext: x.ext }))}" tabindex="0"><div class="cw-play">▶</div><div style="flex:1;min-width:0"><b>${esc(x.name)}</b><div class="prog" style="margin-top:8px"><i style="width:${Math.round((x.pos / x.dur) * 100)}%;animation:none"></i></div><div class="small muted" dir="ltr">${fmtT(x.pos)} / ${fmtT(x.dur)}</div></div></div>`;
  return `${cont.length ? `<h3>${t('continueW')}</h3><div class="cw-list">${cont.map(row).join('')}</div>` : ''}
    ${recent.length ? `<h3>${t('recentCh')}</h3>${itemsGrid(recent.map((x) => ({ kind: 'live', id: x.id, name: x.name, icon: x.icon })))}` : ''}
    <p style="margin:-4px 0 16px"><a href="#" class="small muted" data-act="hist-clear">${t('clearHist')}</a></p>`;
}

// ---------------- parental PIN (kept on this device only) ----------------
const pinKey = () => 'tvp_pin_' + (state.user.me?.user?.username || '');
const getPin = () => localStorage.getItem(pinKey()) || '';
const ADULT = /adult|xxx|18\s*\+|\+\s*18|porn|erot|للكبار|بالغين/i;
function lockedCats(cats) {
  if (!getPin() || state.user.unlocked) return new Set();
  return new Set((Array.isArray(cats) ? cats : []).filter((c) => ADULT.test(String(c.category_name))).map((c) => String(c.category_id)));
}
function parentalCard() {
  const on = !!getPin();
  return `<form class="card" data-form="${on ? 'pin-off' : 'pin-on'}"><h3>${t('parentalT')}</h3><p class="muted small" style="margin-top:0">${on ? t('pinOnText') : t('parentalText')}</p>
    ${field(on ? t('enterPin') : t('pin'), 'pin', '', { type: 'password', attrs: 'required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" dir="ltr"' })}
    <button class="btn ${on ? '' : 'primary'}">${on ? t('removePin') : t('setPin')}</button></form>`;
}

// ---------------- account portal: devices, support, payments ----------------
function devName(ua) {
  ua = String(ua || '');
  const os = /Android/.test(ua) ? (/TV|AFT|BRAVIA|SHIELD|Box|MiBOX/i.test(ua) ? 'Android TV' : 'Android') : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /; wv\)|Electron/.test(ua) ? 'App' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ') || 'Device';
}
const tpill = (st) => `<span class="pill st-${st}">${isAdminUI() ? st : t('st_' + st)}</span>`;
async function loadAccountExtras() {
  const dv = $('#acc-devices'), tk = $('#acc-tickets'), pm = $('#acc-payments');
  const fill = async (el, fn) => { if (!el) return; try { await fn(); } catch (e) { const p = el.querySelector('p.muted'); if (p) p.textContent = e.message; } };
  fill(dv, async () => {
    const list = await api('GET', '/api/me/devices');
    if (!$('#acc-devices')) return;
    dv.innerHTML = `<h3>${t('devicesT')}</h3>${list.length ? list.map((d) => `<div class="list-item"><div style="flex:1;min-width:0"><b>${esc(devName(d.ua))}</b>${d.current ? ` <span class="tagp">${t('thisDevice')}</span>` : ''}<div class="small muted">${t('signedInOn', { date: fmtDate(d.at) })}</div></div>${d.current ? '' : `<button class="btn sm" data-act="dev-remove" data-did="${esc(d.did)}">${t('signOutDev')}</button>`}</div>`).join('') : `<p class="muted small">${t('noDevices')}</p>`}`;
  });
  fill(tk, async () => {
    const list = await api('GET', '/api/me/tickets'); state.user.tickets = list;
    if (!$('#acc-tickets')) return;
    tk.querySelector('p.muted')?.remove(); tk.querySelectorAll('.list-item').forEach((x) => x.remove());
    tk.insertAdjacentHTML('beforeend', list.length ? list.map((x) => `<div class="list-item" data-act="ticket-open" data-id="${esc(x.id)}" style="cursor:pointer" tabindex="0"><div style="flex:1;min-width:0"><b>${esc(x.subject)}</b><div class="small muted">${fmtDate(x.updatedAt)} · ${x.messages.length}</div></div>${tpill(x.status)}</div>`).join('') : `<p class="muted small">${t('noTickets')}</p>`);
  });
  fill(pm, async () => {
    const list = await api('GET', '/api/me/payments'); state.user.payments = list;
    if (!$('#acc-payments')) return;
    pm.innerHTML = `<h3>${t('paymentsT')}</h3>${list.length ? list.map((x) => `<div class="list-item"><div style="flex:1;min-width:0"><b>${esc(x.plan)}</b><div class="small muted">${fmtDate(x.at)}</div></div><b dir="ltr">${esc(priceTxt(x.amount, x.currency))}</b><button class="btn sm" data-act="receipt" data-id="${esc(x.id)}">${t('receipt')}</button></div>`).join('') + `<p style="margin:10px 0 0"><a href="#" class="small muted" data-act="refund-ask">${t('refundAsk')}</a></p>` : `<p class="muted small">${t('noPayments')}</p>`}`;
  });
}
function ticketThread(x, admin) {
  return `<div class="thread">${x.messages.map((m) => `<div class="msg ${m.from === (admin ? 'staff' : 'customer') ? 'mine' : ''}"><div class="small muted">${esc(m.from === 'staff' ? (admin ? m.by : t('supportTeam')) : (admin ? m.by : t('you')))} · ${fmtDT(m.at)}</div><div class="msg-t">${esc(m.text)}</div></div>`).join('')}</div>`;
}
function openTicket(id) {
  const x = (state.user.tickets || []).find((k) => k.id === id); if (!x) return;
  modal(esc(x.subject), `<div style="margin-bottom:10px">${tpill(x.status)}</div>${ticketThread(x, false)}
    ${x.status === 'closed' ? '' : `<form data-form="ticket-reply" data-id="${esc(x.id)}">${field(t('reply'), 'text', '', { type: 'textarea', rows: 3, ph: t('writeReply'), attrs: 'required maxlength="2000"' })}<button class="btn primary">${t('send')}</button></form>`}`);
}
function openReceipt(id) {
  const x = (state.user.payments || []).find((k) => k.id === id); if (!x) return; const me = state.user.me;
  modal('🧾 ' + t('receipt'), `<div class="receipt" id="receipt"><h2 style="margin:0">${esc(me.branding.appName)}</h2><p class="muted small" style="margin:2px 0 16px">${t('receipt')} · ${esc(String(x.id).toUpperCase())}</p>
    <div class="list-item"><span style="flex:1">${t('receiptFor')}</span><b>${esc(me.user.name)} (${esc(me.user.username)})</b></div>
    <div class="list-item"><span style="flex:1">${t('paidOn')}</span><b>${fmtDate(x.at)}</b></div>
    <div class="list-item"><span style="flex:1">${t('item')}</span><b>${esc(x.plan)} · ${esc(x.days)}d</b></div>
    <div class="list-item"><span style="flex:1">${t('amount')}</span><b dir="ltr">${esc(priceTxt(x.amount, x.currency))}</b></div></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" data-act="print">🖨 ${t('print')}</button></div>`);
}
function showReset() {
  modal('🔑 ' + t('resetTitle'), `<form data-form="reset">${field(t('newPw'), 'password', '', { type: 'password', attrs: 'required minlength="6" autocomplete="new-password"' })}<div id="reset-err"></div><button class="btn primary block">${t('updatePw')}</button></form>`);
}

// ---------------- admin: support desk ----------------
async function adminSupport() {
  const list = await api('GET', '/api/admin/tickets'); state.admin.tickets = list;
  const f = state.admin.tkFilter || 'open';
  const shown = list.filter((x) => f === 'all' || x.status === f);
  const count = (st) => list.filter((x) => x.status === st).length;
  return `<div class="chips">${[['open', `Waiting for reply (${count('open')})`], ['answered', `Answered (${count('answered')})`], ['closed', `Closed (${count('closed')})`], ['all', `All (${list.length})`]].map(([k, n]) => `<a class="${f === k ? 'on' : ''}" data-act="tk-filter" data-f="${k}">${n}</a>`).join('')}</div>
    <div class="card">${shown.length ? shown.map((x) => `<div class="list-item" data-act="tk-open" data-id="${esc(x.id)}" style="cursor:pointer" tabindex="0"><div class="avatar">${esc(initials(x.name))}</div><div style="flex:1;min-width:0"><b>${esc(x.subject)}</b>${x.priority === 'high' ? ' <span class="pill st-expired">high</span>' : ''}<div class="small muted">${esc(x.name)} · ${esc(x.username)} · ${fmtDT(x.updatedAt)} · ${x.messages.length} message${x.messages.length > 1 ? 's' : ''}</div></div>${tpill(x.status)}</div>`).join('') : `<div class="empty"><span class="ic">💬</span>${list.length ? 'Nothing in this list.' : 'No support requests yet. Customers open them from Account → Support in the app.'}</div>`}</div>`;
}
function adminTicketModal(id) {
  const x = (state.admin.tickets || []).find((k) => k.id === id); if (!x) return;
  modal(esc(x.subject), `<p class="small muted" style="margin-top:0">${esc(x.name)} · ${esc(x.username)} · opened ${fmtDT(x.createdAt)} ${tpill(x.status)}</p>${ticketThread(x, true)}
    <form data-form="tk-reply" data-id="${esc(x.id)}" data-perm="customers_edit">${field('Your answer', 'text', '', { type: 'textarea', rows: 4, ph: 'Write the answer the customer will read in the app…', attrs: 'maxlength="2000"' })}
      <div class="grid2">${field('Status after saving', 'status', x.status === 'closed' ? 'closed' : 'answered', { type: 'select', options: [['answered', 'Answered'], ['open', 'Still waiting for reply'], ['closed', 'Closed']] })}${field('Priority', 'priority', x.priority, { type: 'select', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']] })}</div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`, { wide: true });
}

// ---------------- admin: two-factor login ----------------
function twoFactorCard(me) {
  return `<div class="card" style="max-width:520px"><h3>Two-step sign-in</h3>
    <p class="small muted" style="margin-top:0">${me.twoFactor ? 'On. Signing in to this account needs your password and a 6-digit code from your authenticator app.' : 'Adds a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password…) on top of your password.'}</p>
    ${me.twoFactor ? `<span class="pill st-active">on</span> <button class="btn sm danger" data-act="tfa-off" style="margin-inline-start:8px">Turn off</button>` : `<button class="btn primary" data-act="tfa-setup">Turn on</button>`}</div>`;
}

// ---------------- admin: automatic Stripe payments ----------------
async function adminAutoPay(s) {
  let p = { list: [], configured: false }; try { p = await api('GET', '/api/admin/payments'); } catch {}
  const url = location.origin + '/api/stripe/webhook';
  const tone = { activated: 'st-active', unmatched: 'st-expiring', needs_attention: 'st-expired' };
  return `<div class="card"><h3>Automatic activation from Stripe</h3>
    <p class="small muted" style="margin-top:0">When a customer pays through one of your Stripe payment links, Stripe tells this app and the subscription is extended by itself. A payment is only accepted when Stripe's signature matches your signing secret, and it is never applied twice.</p>
    <div class="notice ${p.configured ? 'success' : 'warning'}">${p.configured ? '✅ Connected. Verified payments activate automatically.' : '⚠️ Not connected yet. Follow the three steps below for each Stripe account.'}</div>
    <ol class="small" style="padding-inline-start:18px;line-height:1.7"><li>In Stripe: <b>Developers → Webhooks → Add endpoint</b>, with this address:<div class="code" style="margin:6px 0">${esc(url)}</div></li><li>Choose the event <b>checkout.session.completed</b>.</li><li>Copy the endpoint's <b>Signing secret</b> (starts with <code>whsec_</code>) and paste it here, one per line if you use several Stripe accounts.</li></ol>
    <form data-form="settings">${field('Signing secrets', 'finance.stripeWebhookSecrets', s.finance.stripeWebhookSecrets || '', { type: 'textarea', rows: 3, ph: 'whsec_…', attrs: 'autocapitalize="none" spellcheck="false"' })}<button class="btn primary">Save</button></form>
    <h3 style="margin-top:18px">Payments received from Stripe</h3>
    ${p.list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Result</th></tr></thead><tbody>${p.list.map((x) => `<tr><td class="small">${fmtDT(x.at)}</td><td>${esc(x.username || x.email || '—')}<div class="small muted">${esc(x.pkg || '')}</div></td><td>${esc(x.amount)} ${esc(x.currency)}</td><td><span class="pill ${tone[x.status] || ''}">${esc(String(x.status).replace('_', ' '))}</span><div class="small muted">${esc(x.note || '')}</div></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted small">No Stripe payments recorded yet.</p>`}</div>`;
}

Object.assign(actions, {
  'site-login': () => { state.showLogin = true; state.forceSite = false; route(); window.scrollTo(0, 0); },
  'site-page': (el) => { state.forceSite = true; state.sitePage = el.dataset.page; route(); window.scrollTo(0, 0); },
  'site-jump': (el) => { document.getElementById(el.dataset.to)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); },
  forgot: () => { modal('🔑 ' + t('forgot'), `<p class="muted" style="margin-top:0">${t('forgotText')}</p><form data-form="forgot">${field(t('loginOrEmail'), 'login', '', { attrs: 'required autocapitalize="none" dir="ltr"' })}<button class="btn primary block">${t('sendLink')}</button></form>`); },
  'hist-clear': () => { localStorage.removeItem(histKey()); toast(t('histCleared')); renderUserTab(); },
  'pin-unlock': () => { const b = modal('🔒 ' + t('parentalT'), `<form data-form="pin-unlock">${field(t('enterPin'), 'pin', '', { type: 'password', attrs: 'required inputmode="numeric" maxlength="4" autocomplete="off" dir="ltr"' })}<button class="btn primary block">${t('unlock')}</button></form>`); b.querySelector('input').focus(); },
  'dev-remove': async (el) => { if (!confirm(t('signOutDev') + '?')) return; await api('POST', '/api/me/devices/remove', { did: el.dataset.did }); toast(t('devOut')); loadAccountExtras(); },
  'ticket-new': () => { modal('💬 ' + t('newTicket'), `<form data-form="ticket-new">${field(t('subject'), 'subject', '', { attrs: 'required minlength="3" maxlength="120"' })}${field(t('message'), 'text', '', { type: 'textarea', rows: 5, attrs: 'required minlength="5" maxlength="2000"' })}<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary">${t('send')}</button></div></form>`); },
  'ticket-open': (el) => openTicket(el.dataset.id),
  receipt: (el) => openReceipt(el.dataset.id),
  print: () => window.print(),
  'tk-filter': async (el) => { state.admin.tkFilter = el.dataset.f; $('#admin-body').innerHTML = await adminSupport(); },
  'tk-open': (el) => adminTicketModal(el.dataset.id),
  'tfa-setup': async () => {
    const r = await api('POST', '/api/admin/2fa/setup', {});
    modal('🔐 Turn on two-step sign-in', `<ol style="padding-inline-start:18px;line-height:1.7;margin-top:0"><li>Open your authenticator app and add a new account.</li><li>On this phone, tap <a href="${esc(r.uri)}" data-keep>Add to my authenticator app</a>. On another device, choose “enter a setup key” and type this key:<div class="code" style="margin:8px 0;font-size:1rem;letter-spacing:.08em">${esc(r.secret.match(/.{1,4}/g).join(' '))}</div></li><li>Type the 6-digit code the app shows:</li></ol>
      <form data-form="tfa-enable">${field('6-digit code', 'code', '', { attrs: 'required inputmode="numeric" autocomplete="one-time-code" maxlength="7"' })}<p class="small muted">Keep the setup key somewhere safe. If you lose your phone, it is the only way to add the account to a new authenticator.</p><button class="btn primary block">Turn on</button></form>`);
  },
  'tfa-off': () => { modal('Turn off two-step sign-in', `<form data-form="tfa-off">${field('Current password', 'password', '', { type: 'password', attrs: 'required' })}<button class="btn danger block">Turn off</button></form>`); },
});
Object.assign(forms, {
  async 'login-code'(f) {
    const p = state.pendingLogin; if (!p) return closeModal();
    try { const r = await api('POST', '/api/login', { ...p, code: f.code.value }); state.pendingLogin = null; localStorage.setItem('tvp_known', '1'); closeModal(); setSession(r.token, r.role); route(); }
    catch (e) { $('#code-err').innerHTML = `<div class="err-box">${esc(e.message)}</div>`; f.code.select(); }
  },
  async forgot(f) {
    const btn = f.querySelector('button'); btn.disabled = true;
    try { await api('POST', '/api/forgot', { login: f.login.value, appUrl: location.origin + location.pathname.replace(/index\.html$/, '').replace(/\/$/, '') }); f.outerHTML = `<div class="notice success">✅ ${t('forgotSent')}</div>`; }
    catch (e) { btn.disabled = false; toast(tErr(e.message), true); }
  },
  async reset(f) {
    try { await api('POST', '/api/reset', { t: state.resetToken, password: f.password.value }); state.resetToken = null; closeModal(); toast(t('resetDone')); }
    catch (e) { $('#reset-err').innerHTML = `<div class="err-box">${esc(tErr(e.message))}</div>`; }
  },
  'pin-on'(f) { const pin = f.pin.value.trim(); if (!/^\d{4}$/.test(pin)) return toast(t('pinNeeds'), true); localStorage.setItem(pinKey(), pin); state.user.unlocked = false; state.user.cache = {}; toast(t('pinSaved')); renderUserTab(); },
  'pin-off'(f) { if (f.pin.value.trim() !== getPin()) return toast(t('wrongPin'), true); localStorage.removeItem(pinKey()); toast(t('pinRemoved')); renderUserTab(); },
  'pin-unlock'(f) { if (f.pin.value.trim() !== getPin()) return toast(t('wrongPin'), true); state.user.unlocked = true; closeModal(); renderUserTab(); },
  async 'ticket-new'(f) {
    try { await api('POST', '/api/me/tickets', { subject: f.subject.value, text: f.text.value }); closeModal(); toast(t('ticketSent')); loadAccountExtras(); }
    catch (e) { toast(tErr(e.message), true); }
  },
  async 'ticket-reply'(f) {
    try { await api('POST', '/api/me/tickets/reply', { id: f.dataset.id, text: f.text.value }); closeModal(); toast(t('ticketSent')); loadAccountExtras(); }
    catch (e) { toast(tErr(e.message), true); }
  },
  async 'tk-reply'(f) {
    try { await api('POST', '/api/admin/tickets/reply', { id: f.dataset.id, text: f.text.value, status: f.status.value, priority: f.priority.value }); closeModal(); toast('Saved ✓'); $('#admin-body').innerHTML = await adminSupport(); }
    catch (e) { toast(e.message, true); }
  },
  async 'tfa-enable'(f) {
    try { await api('POST', '/api/admin/2fa/enable', { code: f.code.value }); state.admin.me = null; closeModal(); toast('Two-step sign-in is on ✓'); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
  async 'tfa-off'(f) {
    try { await api('POST', '/api/admin/2fa/disable', { password: f.password.value }); state.admin.me = null; closeModal(); toast('Two-step sign-in is off'); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
});

// =====================================================================
// Own playlists (Xtream / M3U), native resume, dashboard counters, requests
// =====================================================================
const uname = () => state.user.me?.user?.username || '';
const getSources = () => { try { return JSON.parse(localStorage.getItem('tvp_sources_' + uname())) || []; } catch { return []; } };
const putSources = (l) => localStorage.setItem('tvp_sources_' + uname(), JSON.stringify(l));
const activeSrc = () => localStorage.getItem('tvp_src_' + uname()) || '';
// Points the player at the customer's own provider when they picked one. Their details stay on this device.
function applySource() {
  const me = state.user.me; if (!me) return;
  if (!('_stream' in me)) me._stream = me.stream;
  const src = me.dashboard.ownPlaylists === false ? null : getSources().find((x) => x.id === activeSrc());
  if (!src) { me.stream = me._stream; return; }
  const base = me._stream || {}; const ua = base.userAgent || 'IPTVSmartersPro';
  me.stream = src.type === 'xtream'
    ? { ...base, server: src.server, u: src.u, p: src.p, mode: 'direct', useProxy: false, userAgent: ua, custom: src.id, dns: src.server }
    : { ...base, server: '', u: 'm3u', p: '', mode: 'direct', useProxy: false, userAgent: ua, custom: src.id, m3u: src.id };
}
async function fetchText(url) {
  const ua = state.user.me?.stream?.userAgent || 'IPTVSmartersPro';
  if (bridge()) return bridgeFetch(url, ua);
  if (url.startsWith('https:') || location.protocol === 'http:') { try { const r = await fetch(url); if (r.ok) return await r.text(); } catch {} }
  const base = state.user.me?._stream;
  if (base?.relay) { const r = await fetch(`${base.relay}/x?u=${encodeURIComponent(url)}&t=${encodeURIComponent(base.proxyToken)}`).catch(() => null); if (r && r.ok) return r.text(); if (r) throw new Error(t('srcUnreachable')); }
  throw new Error(t('srcNeedApp'));
}
async function m3uItems(id, force) {
  state.user.m3u ||= {};
  if (state.user.m3u[id] && !force) return state.user.m3u[id];
  const src = getSources().find((x) => x.id === id); if (!src) return [];
  let saved = null; try { saved = JSON.parse(localStorage.getItem('tvp_m3u_' + id)); } catch {}
  if (saved && !force && (!src.url || Date.now() - saved.at < 12 * 3600000)) return (state.user.m3u[id] = saved.items);
  if (!src.url) return (state.user.m3u[id] = saved ? saved.items : []);
  let items;
  try { items = parseM3U(await fetchText(src.url)); } catch (e) { if (saved) return (state.user.m3u[id] = saved.items); throw e; }
  if (!items.length) { if (saved) return (state.user.m3u[id] = saved.items); throw new Error(t('srcEmpty')); }
  saveM3u(id, items);
  return (state.user.m3u[id] = items);
}
function saveM3u(id, items) { try { localStorage.setItem('tvp_m3u_' + id, JSON.stringify({ at: Date.now(), items })); } catch { try { localStorage.removeItem('tvp_m3u_' + id); } catch {} } }
function useSource(id) {
  if (id) localStorage.setItem('tvp_src_' + uname(), id); else localStorage.removeItem('tvp_src_' + uname());
  const u = state.user; u.cache = {}; u.cat = {}; u.q = ''; u.unlocked = false; applySource();
}
function srcBanner() {
  const src = getSources().find((x) => x.id === activeSrc()); const me = state.user.me;
  if (!src || me.dashboard.ownPlaylists === false) return '';
  return `<div class="notice info row"><span style="flex:1">${ic('list', 18)} ${t('srcNow', { name: esc(src.name) })}</span><button class="btn sm" data-act="src-use" data-id="">${t('srcBack', { app: esc(me.branding.appName) })}</button></div>`;
}
function sourcesCard() {
  const list = getSources(); const act = activeSrc(); const app = state.user.me.branding.appName;
  const row = (id, name, tag, canDel) => `<div class="list-item"><div style="flex:1;min-width:0"><b>${esc(name)}</b>${tag ? ` <span class="tagp">${tag}</span>` : ''}</div>${act === id ? `<span class="pill st-active">${t('srcActive')}</span>` : `<button class="btn sm" data-act="src-use" data-id="${esc(id)}">${t('srcUse')}</button>`}${canDel ? `<button class="btn sm ghost" data-act="src-del" data-id="${esc(id)}" aria-label="${t('srcRemove')}">✕</button>` : ''}</div>`;
  return `<div class="card" id="acc-sources"><h3>${t('srcT')}</h3><p class="muted small" style="margin-top:0">${t('srcText')}</p>
    ${row('', t('srcMain', { app }), '', false)}${list.map((x) => row(x.id, x.name, x.type === 'xtream' ? 'Xtream' : 'M3U', true)).join('')}
    <div class="row" style="margin-top:12px"><button class="btn" data-act="src-add" data-type="xtream">＋ Xtream Codes</button><button class="btn" data-act="src-add" data-type="m3u">＋ M3U</button></div></div>`;
}
// Android / TV app: the native player remembers the position; this brings it back for "Continue watching".
function noteNative(kind, id, url) { try { localStorage.setItem('tvp_lastnative', JSON.stringify({ kind, id, url })); } catch {} }
function pullNativePos() {
  const b = bridge(); if (!b || !b.lastPos) return;
  try { const r = JSON.parse(b.lastPos() || '{}'); const n = JSON.parse(localStorage.getItem('tvp_lastnative') || 'null'); if (r.url && n && n.url === r.url && r.dur > 0) savePos(n.kind, n.id, r.pos, r.dur); } catch {}
}
async function loadDashCounts() {
  const u = state.user;
  if (!u.counts || Date.now() - u.counts.at > 60000) {
    try { const [dv, tk] = await Promise.all([api('GET', '/api/me/devices'), api('GET', '/api/me/tickets')]); u.counts = { at: Date.now(), dev: dv.length, open: tk.filter((x) => x.status !== 'closed').length, answered: tk.filter((x) => x.status === 'answered').length }; u.tickets = tk; } catch { return; }
  }
  const a = $('#dash-dev'), b = $('#dash-tk');
  if (a) a.textContent = `${u.counts.dev} / ${u.me.user.connections}`;
  if (b) b.textContent = u.counts.answered ? `${u.counts.open} · ${t('st_answered')}` : String(u.counts.open);
}
const srcForm = (type) => type === 'xtream'
  ? `<form data-form="src-xtream">${field(t('srcName'), 'name', '', { attrs: 'required maxlength="40"' })}${field(t('srcServer'), 'server', '', { ph: 'http://example.com:8080', attrs: 'required inputmode="url" autocapitalize="none" dir="ltr"' })}${field(t('username'), 'u', '', { attrs: 'required autocapitalize="none" autocomplete="off" dir="ltr"' })}${field(t('password'), 'p', '', { type: 'password', attrs: 'required autocomplete="off" dir="ltr"' })}<div id="src-err"></div><p class="small muted">${t('srcOnlyYours')}</p><button class="btn primary block">${t('srcCheckAdd')}</button></form>`
  : `<form data-form="src-m3u">${field(t('srcName'), 'name', '', { attrs: 'required maxlength="40"' })}${field(t('srcUrl'), 'url', '', { ph: 'https://example.com/playlist.m3u', attrs: 'inputmode="url" autocapitalize="none" dir="ltr"' })}<label class="field"><span>${t('srcFile')}</span><input type="file" name="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl"></label><div id="src-err"></div><p class="small muted">${t('srcOnlyYours')}</p><button class="btn primary block">${t('srcCheckAdd')}</button></form>`;
const srcFail = (f, msg) => { const b = f.querySelector('button'); b.disabled = false; b.textContent = t('srcCheckAdd'); $('#src-err').innerHTML = `<div class="err-box">${esc(msg)}</div>`; };

document.addEventListener('visibilitychange', () => { if (!document.hidden && state.role === 'user' && state.user.me && state.user.tab === 'home' && bridge()?.lastPos) { pullNativePos(); renderUserTab(); } });

Object.assign(actions, {
  'goto-acc': (el) => { state.user.tab = 'account'; state.user.scrollTo = el.dataset.to; renderUser(); },
  'src-add': (el) => { modal(el.dataset.type === 'xtream' ? '＋ Xtream Codes' : '＋ M3U', srcForm(el.dataset.type)); },
  'src-use': (el) => { useSource(el.dataset.id); state.user.tab = 'home'; window.scrollTo(0, 0); renderUser(); },
  'src-del': (el) => { if (!confirm(t('srcRemove') + '?')) return; if (activeSrc() === el.dataset.id) useSource(''); putSources(getSources().filter((x) => x.id !== el.dataset.id)); localStorage.removeItem('tvp_m3u_' + el.dataset.id); renderUserTab(); },
  'refund-ask': () => { actions['ticket-new'](); const f = $('form[data-form=ticket-new]'); if (f) { f.subject.value = t('refundSubj'); f.text.focus(); } },
  'del-ask': () => { actions['ticket-new'](); const f = $('form[data-form=ticket-new]'); if (f) { f.subject.value = t('delSubj'); f.text.value = t('delText'); } },
});
Object.assign(forms, {
  async 'src-xtream'(f) {
    const server = f.server.value.trim().replace(/\/+$/, '').replace(/\/player_api\.php.*$/i, '');
    if (!/^https?:\/\/[^\s/]+/i.test(server)) return srcFail(f, t('srcBadUrl'));
    const b = f.querySelector('button'); b.disabled = true; b.textContent = t('srcTesting');
    let data;
    try { data = JSON.parse(await fetchText(`${server}/player_api.php?${new URLSearchParams({ username: f.u.value.trim(), password: f.p.value })}`)); }
    catch (e) { return srcFail(f, /srcNeedApp|browser|navigateur|المتصفح/.test(e.message) || e.message === t('srcNeedApp') ? t('srcNeedApp') : t('srcUnreachable')); }
    const info = data && data.user_info;
    if (!info || Number(info.auth) === 0) return srcFail(f, t('srcBadLogin'));
    if (info.status && !/^active$/i.test(info.status)) return srcFail(f, t('srcExpired'));
    const id = Math.random().toString(36).slice(2, 9);
    putSources([...getSources(), { id, type: 'xtream', name: f.name.value.trim(), server, u: f.u.value.trim(), p: f.p.value }]);
    useSource(id); closeModal(); toast(t('srcSaved', { n: f.name.value.trim() })); state.user.tab = 'home'; renderUser();
  },
  async 'src-m3u'(f) {
    const url = f.url.value.trim(); const file = f.file.files[0];
    if (!file && !/^https?:\/\/[^\s/]+/i.test(url)) return srcFail(f, t('srcBadUrl'));
    const b = f.querySelector('button'); b.disabled = true; b.textContent = t('srcTesting');
    let items;
    try { items = parseM3U(file ? await file.text() : await fetchText(url)); } catch (e) { return srcFail(f, e.message === t('srcNeedApp') ? e.message : t('srcUnreachable')); }
    if (!items.length) return srcFail(f, t('srcEmpty'));
    const id = Math.random().toString(36).slice(2, 9);
    putSources([...getSources(), { id, type: 'm3u', name: f.name.value.trim(), url: file ? '' : url }]);
    saveM3u(id, items); (state.user.m3u ||= {})[id] = items;
    useSource(id); closeModal(); toast(`${t('srcSaved', { n: f.name.value.trim() })} · ${t('srcChannels', { n: items.length })}`); state.user.tab = 'home'; renderUser();
  },
});

// ---------------- customer two-step sign-in ----------------
const refreshMe = async () => { state.user.me = await api('GET', '/api/me'); state.user.meAt = Date.now(); applySource(); renderUserTab(); };
Object.assign(actions, {
  'utfa-setup': async () => {
    const r = await api('POST', '/api/me/2fa/setup', {});
    modal('🔐 ' + t('tfaT'), `<ol style="padding-inline-start:18px;line-height:1.7;margin-top:0"><li>${t('tfaStep1')}</li><li>${t('tfaStep2')} <a href="${esc(r.uri)}" data-keep>${t('tfaAdd')}</a><div class="code" dir="ltr" style="margin:8px 0;font-size:1rem;letter-spacing:.08em">${esc(r.secret.match(/.{1,4}/g).join(' '))}</div></li><li>${t('tfaStep3')}</li></ol>
      <form data-form="utfa-enable">${field(t('code2fa'), 'code', '', { attrs: 'required inputmode="numeric" autocomplete="one-time-code" maxlength="7" dir="ltr"' })}<p class="small muted">${t('tfaKeep')}</p><button class="btn primary block">${t('turnOn')}</button></form>`);
  },
  'utfa-off': () => { modal(t('tfaT'), `<form data-form="utfa-off">${field(t('currentPw'), 'password', '', { type: 'password', attrs: 'required' })}<button class="btn danger block">${t('turnOff')}</button></form>`); },
  'cust-tfa-off': async (el) => { if (!confirm('Turn off two-step sign-in for this customer? Do this only when they lost their phone.')) return; await api('POST', `/api/admin/customers/${el.dataset.id}/tfaoff`, {}); toast('Two-step sign-in turned off ✓'); el.remove(); },
});
Object.assign(forms, {
  async 'utfa-enable'(f) { try { await api('POST', '/api/me/2fa/enable', { code: f.code.value }); closeModal(); toast(t('tfaOn')); await refreshMe(); } catch (e) { toast(tErr(e.message), true); } },
  async 'utfa-off'(f) { try { await api('POST', '/api/me/2fa/disable', { password: f.password.value }); closeModal(); toast(t('tfaOff')); await refreshMe(); } catch (e) { toast(tErr(e.message), true); } },
});

// ---------------- customer email check ----------------
Object.assign(actions, {
  'em-send': async (el) => {
    el.disabled = true;
    try { const r = await api('POST', '/api/me/email/send', {}); if (r.verified) return refreshMe();
      const b = modal('✉️ ' + t('emVerify'), `<p class="muted" style="margin-top:0">${t('emSent', { email: esc(state.user.me.user.email) })}</p><form data-form="em-verify">${field(t('code2fa'), 'code', '', { attrs: 'required inputmode="numeric" autocomplete="one-time-code" maxlength="7" dir="ltr"' })}<button class="btn primary block">${t('verify')}</button></form>`); b.querySelector('input').focus(); }
    catch (e) { toast(tErr(e.message), true); } finally { el.disabled = false; }
  },
});
Object.assign(forms, {
  async 'em-verify'(f) { try { await api('POST', '/api/me/email/verify', { code: f.code.value }); closeModal(); toast(t('emVerified') + ' ✓'); await refreshMe(); } catch (e) { toast(tErr(e.message), true); } },
});

boot();
