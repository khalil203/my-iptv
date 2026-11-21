import { createBackend, holidayCalendar, parseLineLink, parseResellerText, parseOrderNo, orderCompare, orderDevices, orderAt, orderRanks, txTime, sortTxNewest, applyTransactionInput, migrateLegacyTransactions, bankPayoutNote, normalizePayoutDays, formatExactTime, balanceTxLink, IBO_PLAYERS } from './core.js?v=128';
import { loadLogos, logosReady, findLogo } from './logos.js?v=83';
import { siteHtml, ensureSiteLang } from './site.js?v=123';
import { ic } from './icons.js?v=102';
import { parseM3U, m3uAnswer } from './m3u.js?v=83';
import { TIME_ZONES, timezoneOffsetLabel, zonedDayAndMinute } from './timezones.js?v=1';
import { t, tErr, setLang, getLang, detectLang, locale, LANGS, ensureLang } from './i18n.js?v=125';
import { openLangSheet, paintLangPill, langChip } from './lang.js?v=122';
import { flagOf as langFlag, nameOf as langName } from './lang-data.js?v=122';
import { createTranslator } from './translator.js?v=123';
import { esc as escHtml, categoryClass, refreshControlHtml, refreshMetaHtml, importantNoticeHtml, noticeEditorHtml, markRefreshBusy } from './ui-controls.js?v=123';
import { PROMOS, REFERRAL_TIERS, LIFETIME_PLANS, promoEligibility, applyPromoToReseller, adsTemplates, adsPanelHtml, resellerSampleHtml, domainAccountHtml, agentPermissionPreset } from './growth.js?v=123';

// Client diagnostics (spec: fix fast): if the app cannot start or throws anywhere, tell the server once.
const __diagSend = (o) => { try { navigator.sendBeacon('/api/diag', JSON.stringify({ at: Date.now(), origin: location.origin, ua: String(navigator.userAgent || '').slice(0, 200), ...o })); } catch {} };
window.addEventListener('error', (e) => __diagSend({ kind: 'js-error', msg: String((e && e.message) || '').slice(0, 400), file: String((e && e.filename) || '').slice(0, 200), line: e && e.lineno }));
window.addEventListener('unhandledrejection', (e) => __diagSend({ kind: 'js-reject', msg: String(((e && e.reason && e.reason.message) || (e && e.reason)) || '').slice(0, 400) }));

// ---------------- helpers ----------------
const $ = (s, r = document) => r.querySelector(s);
const esc = escHtml;
const fmtDate = (x) => (x ? new Date(x).toLocaleDateString(isAdminUI() ? undefined : locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDT = (x) => (x ? new Date(x).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const usd = (n) => `${Number(n) < 0 ? '−' : ''}$${Math.abs(Number(n || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mad = (n) => `${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;
const num = (n, cur) => `${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || ''}`;
// Time left, never rounded up: "23 h left", "2 days 8 h left", "29 days left", "3 days ago"
const leftTxt = (c) => { if (c.noExpiry) return 'no end date'; const ms = c.expiresAt - Date.now(); if (ms <= 0) { const d = Math.floor(-ms / 86400000); return d ? d + (d === 1 ? ' day ago' : ' days ago') : 'ended today'; }
  const h = Math.floor(ms / 3600000); if (h < 48) return (h || '<1') + ' h left'; const d = Math.floor((ms + 3600000) / 86400000), r = Math.max(0, h - d * 24); return d + ' days' + (d < 7 && r ? ' ' + r + ' h' : '') + ' left'; };
const isoDay = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const money = (n) => `${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${state.config?.currency || ''}`;
const initials = (n) => String(n || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const b64 = (s) => { try { return decodeURIComponent(escape(atob(s))); } catch { return s || ''; } };

function toast(msg, isErr) {
  const d = document.createElement('div');
  d.textContent = msg; if (isErr) d.className = 'err';
  d.setAttribute('role', isErr ? 'alert' : 'status');
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), 3200);
}
function modal(title, html, { wide = false, onClose } = {}) {
  closeModal();
  const root = $('#modal-root');
  const prev = (document.activeElement && document.activeElement.focus) ? document.activeElement : null;
  const titleId = 'modal-title-' + Math.random().toString(36).slice(2, 9);
  const closeLabel = esc(t('close'));
  root.innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}"><div class="modal-head"><h3 id="${titleId}">${title}</h3><button class="x" data-act="close-modal" aria-label="${closeLabel}" title="${closeLabel}">×</button></div><div class="modal-body">${html}</div></div></div>`;
  root._onClose = onClose;
  root._prevFocus = prev;
  const first = root.querySelector('.modal-body input:not([type=hidden]):not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled]), .modal-body button:not([disabled])');
  if (first) try { first.focus(); } catch {}
  return $('.modal-body', root);
}
function closeModal() {
  const root = $('#modal-root');
  if (root._onClose) { try { root._onClose(); } catch {} root._onClose = null; }
  root.innerHTML = '';
  const prev = root._prevFocus; root._prevFocus = null;
  if (prev && document.contains(prev)) { try { prev.focus(); } catch {} }
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
  // When a Stripe account is chosen, map it to the linked bank/ledger id so sales, renewals and new credits flow into that account.
  if (out.stripeAccountId) {
    const sas = (state.admin && state.admin.settings && state.admin.settings.stripeAccounts) || [];
    const sa = sas.find((a) => a && a.id === out.stripeAccountId);
    if (sa && sa.bankId) out.accountId = sa.bankId;
    else if ((sas || []).length) {/* keep explicit value */} else delete out.stripeAccountId;
    delete out.stripeAccountId;
  }
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
  admin: { tab: 'overview', customers: [], settings: null, filter: 'all', q: '', subDays: '30', refreshedAt: 0, domainDraft: {} },
  user: { tab: 'home', me: null, cache: {}, cat: {}, q: '', limit: 120 },
};
const txTimeLabel = (x) => formatExactTime(txTime(x));
const customerImportantNotice = () => state.user.me?.importantNotice ? importantNoticeHtml(state.user.me.importantNotice) : '';
const updateRefreshMeta = () => { const el = $('[data-refresh-meta]'); if (el) el.outerHTML = refreshMetaHtml(state.admin.refreshedAt || Date.now()); };

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
    if (status === 403 && json.error === 'checkin_required' && state.admin?.me) { state.admin.me.mustCheckIn = true; setTimeout(renderAdmin); }
    throw Object.assign(new Error(json.error || 'Error'), { status, data: json });
  }
  return json;
}
let sessionGeneration = 0;
function setSession(token, role) {
  sessionGeneration += 1;
  state.token = token; state.role = role; if (!token || role !== 'user') document.getElementById('chat-fab')?.remove();
  if (token) { localStorage.setItem('tvp_token', token); localStorage.setItem('tvp_role', role); }
  else { localStorage.removeItem('tvp_token'); localStorage.removeItem('tvp_role'); }
  state.user = { tab: 'home', me: null, cache: {}, cat: {}, q: '', limit: 120 };
  state.admin.me = null; state.admin.tab = 'overview';
  state.admin.mktDraft = null; state.admin.mktComposer = null;
}

function applyBranding(b) {
  const r = document.documentElement.style;
  r.setProperty('--b-primary', b.primary || '#FF6B42');
  r.setProperty('--b-accent', b.accent || '#19D5B1');
  r.setProperty('--brand-bg', b.background || '#0B0B0F');
  document.title = b.appName || 'IPTV';
  applyTheme();
}
const DAYMS = 86400000;
const countryFlag = (code) => { const s2 = String(code || '').trim().toUpperCase(); if (!/^[A-Z]{2}$/.test(s2)) return ''; return String.fromCodePoint(...[...s2].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65)); };
const spendTier = (paid) => { const n = Number(paid) || 0; return n >= 500 ? ['ELITE', 'st-active'] : n >= 100 ? ['VIP', 'st-expiring'] : n > 0 ? ['Regular', 'st-open'] : ['New', 'st-open']; };

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
    try { const r = await fetch('/api/unsub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: hp.get('unsub') }) }); const d = await r.json(); msg = r.ok ? { en: `You are unsubscribed. You will not get promotion emails from ${d.app} any more.`, fr: `Vous êtes désabonné. Vous ne recevrez plus d'emails promotionnels de ${d.app}.`, } : null; } catch {}
    const l = (navigator.language || 'en').slice(0, 2);
    $('#app').innerHTML = `<div class="block-screen"><div class="ic">${msg ? '✅' : '⚠️'}</div><p>${msg ? msg[l] || msg.en : 'This link is not valid.'}</p></div>`;
    return;
  }
  // The browser upgraded our http:// switch back to https:// — remember it and never loop.
  if (location.hash === '#paid') { state.justPaid = 'done'; history.replaceState(null, '', location.pathname); }
  else { try { if (Date.now() - Number(localStorage.getItem('tvp_paying_at') || 0) < 30 * 60000) state.justPaid = 'back'; } catch {} }
  try { localStorage.removeItem('tvp_paying_at'); sessionStorage.removeItem('tvp_paying'); } catch {}
  if (hp.get('reset')) { state.resetToken = hp.get('reset'); state.showLogin = true; history.replaceState(null, '', location.pathname); }
  if (location.hash === '#login') state.showLogin = true;
  if (/^\/intprototv\/?$/i.test(location.pathname)) { state.showLogin = true; state.forceSite = false; } // admin sign-in address
  if (hp.get('s') && location.protocol === 'https:') localStorage.setItem('tvp_nohttp', '1');
  if (hp.get('s')) { setSession(hp.get('s'), 'user'); if (hp.get('tab')) state.user.tab = hp.get('tab'); if (hp.get('lang')) setLang(hp.get('lang'), true); history.replaceState(null, '', location.pathname); }
  setLang(detectLang());
  await ensureLang(getLang());
  await ensureSiteLang(getLang());
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('no server');
    state.config = await r.json();
    state.mode = 'server';
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch (err) {
    __diagSend({ kind: 'config-fail', msg: String((err && err.message) || err || '').slice(0, 300), mode: state.mode });
    state.mode = 'demo';
    state.local = createBackend({ store: localStore(), fetchFn: (u, i) => fetch(u, i), mode: 'demo' });
    state.config = await api('GET', '/api/config');
  }
  applyBranding(state.config.branding);
  route();
  if (state.resetToken && !state.token) showReset();
}

// One language control on every customer / reseller / public page: a small
// pill that opens the Language Center sheet.
function paintPill() {
  if (isAdminUI() || document.querySelector('.site')) { document.getElementById('lang-pill')?.remove(); return; }
  paintLangPill(getLang());
}
function openLanguageCenter() {
  openLangSheet({ current: getLang(), onPick: applyLang, title: t('language'), subtitle: t('chooseLang') });
}
async function applyLang(code) {
  if (!LANGS.some(([k]) => k === code)) code = 'en';
  await ensureLang(code);
  await ensureSiteLang(code);
  setLang(code, true);
  paintPill();
  if (state.role === 'user' && state.token && location.pathname !== '/app') renderUser(); else route();
  toast(`${langFlag(code)} ${langName(code)} ✓`);
}
function route() {
  closeModal(); setTimeout(applyTheme); setTimeout(paintPill); setTimeout(() => TR.afterRoute(), 0);
  if (isAdminUI() && location.protocol === 'http:' && !/localhost|127\.0\.0\.1/.test(location.hostname)) { location.replace('https://' + location.host + location.pathname); return; }
  if (isAdminUI()) { document.documentElement.dir = TR.trDir() || 'ltr'; document.documentElement.lang = TR.trDir() ? TR.trCur() : 'en'; }
  else setLang(getLang());
  if (state.config.setupRequired) return renderSetup();
  if (state.token) pushRelink();
  if (state.token && state.role === 'user') setTimeout(reportDevice, 1200);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/app') return renderAppPage();
  takeDeepLink();
  // Before the dashboard opens: one tap to allow notifications (customers, resellers, agents, owner)
  if (state.token && !state.preview && notifGateDue()) return renderNotifGate();
  // Reseller dashboard: intproto-tv.store/rsl
  if (state.token && state.role === 'reseller') { if (path !== '/rsl') history.replaceState(null, '', '/rsl'); return renderRsl(); }
  if (/^\/support$/i.test(path) && !isAdminUI() && state.role !== 'admin' && state.role !== 'staff') return renderSupport();
  if (/^\/rsl$/i.test(path) && !isAdminUI()) { if (!state.token) { state.showLogin = true; return renderLogin(); } return renderRsl(); }
  // Public landing pages live on clean URLs; keep them out of the way of the
  // sign-in flow and of signed-in users (otherwise route() would redraw them forever).
  if (!state.showLogin) {
    if (!state.token && path === '/freetrial') return renderFreeTrial();
    if (!state.token && path === '/resellers') return renderResellers();
    if (state.token && path === '/resellers' && !isAdminUI()) return renderResellers();
  }
  if (path === '/profile') {
    if (!state.token) { state.forceSite = false; state.showLogin = true; return renderLogin(); }
    if (!isAdminUI()) return renderProfile();
  }
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
      ${error ? `<div class="err-box" role="alert" aria-live="assertive">${esc(error)}</div>` : ''}
      <form ${preview ? '' : 'data-form="login"'}>
        ${field(t('username'), 'username', '', { attrs: 'autocomplete="username" autocapitalize="none" required' })}
        <label class="field"><span>${t('password')}</span><div class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" data-act="pw-eye" title="Show password" aria-label="Show password">👁</button></div></label>
        ${!preview && state.config?.captcha ? `<label class="field" style="flex-direction:row;align-items:center;gap:10px"><span style="min-width:130px">${t('captchaQ', { q: esc(state.config.captcha.q) })}</span><input name="captchaAnswer" inputmode="numeric" autocomplete="off" required placeholder="=" style="width:110px;text-align:center" aria-label="captcha"></label><input type="hidden" name="captchaId" value="${esc(state.config.captcha.id)}">` : ''}
        <button class="btn primary block" ${preview ? 'type="button"' : ''}>${t('signIn')}</button>
      </form>
      ${preview ? '' : `<div class="login-foot" style="margin-top:10px"><a href="#" data-act="forgot">${t('forgot')}</a></div>`}
      ${state.config?.trial?.enabled ? `<button class="btn block" style="margin-top:10px;border-color:var(--accent);color:var(--accent)" ${preview ? '' : 'data-act="trial"'}>🎁 ${t('startTrial', { hours: state.config.trial.hours })}</button>` : ''}
      ${preview ? '' : `<a class="btn block ghost" href="download.html" style="margin-top:8px">📲 ${t('getApp')}</a>`}
      ${preview ? '' : `<div class="login-foot"><a data-act="theme" href="#" style="cursor:pointer;text-decoration:none" title="Theme" aria-label="Change theme">🌗</a></div>`}
      ${preview ? '' : `<div class="login-foot">${langChip(getLang(), { label: t('language') })}</div>`}
      ${waNum(b) ? `<a class="btn block wa-btn" style="margin-top:8px" href="${esc(waUrl(b, t('waMsg', { app: b.appName, u: '' })))}" target="_blank" rel="noopener">💬 ${t('whatsapp')}</a>` : b.supportUrl ? `<div class="login-foot"><a href="${esc(b.supportUrl)}" target="_blank" rel="noopener">${esc(b.supportLabel || t('support'))}</a></div>` : ''}
      ${b.footerText ? `<div class="login-foot">${esc(b.footerText)}</div>` : ''}
      ${preview || bridge() ? '' : `<div class="login-foot"><a href="#" data-act="site-page" data-page="home">${t('aboutSite', { app: esc(b.appName) })}</a></div>`}
      ${state.mode === 'demo' && !preview ? `<div class="login-foot"><span class="badge-demo">${t('demo')}</span></div>` : ''}
    </div></div>`;
}
function renderLogin(error = '') { const rsl = /^\/rsl\/?$/i.test(location.pathname); $('#app').innerHTML = loginCard(rsl ? { ...state.config.branding, loginTitle: '🤝 ' + t('rsl_title'), loginSubtitle: t('rsl_loginSub') } : state.config.branding, { error: error ? tErr(error) : '' }); setWaFab(state.config.branding, t('waMsg', { app: state.config.branding.appName, u: '' })); }
function trialForm() {
  const h = state.config.trial.hours;
  return `<p class="muted" style="margin-top:0">${t('trialIntro')}</p><form data-form="trial">
    ${field(t('fullName'), 'name', '', { attrs: 'required autocomplete="name"' })}
    ${field(t('email'), 'email', '', { type: 'email', attrs: 'required autocomplete="email" autocapitalize="none" dir="ltr"' })}
    ${phoneField(t('phone'), 'phone')}
    ${field(t('telegramId'), 'telegram', '', { ph: '@username', attrs: 'autocapitalize="none" autocomplete="off"', help: t('optional') })}
    ${toggle(t('sameWhatsapp'), 'same', true)}
    <div id="wa-field" style="display:none">${phoneField(t('whatsapp'), 'whatsapp', false)}</div>
    ${state.config?.captcha ? `<label class="field" style="flex-direction:row;align-items:center;gap:10px"><span style="min-width:130px">${t('captchaQ', { q: esc(state.config.captcha.q) })}</span><input name="captchaAnswer" inputmode="numeric" autocomplete="off" required placeholder="=" style="width:110px;text-align:center" aria-label="captcha"></label><input type="hidden" name="captchaId" value="${esc(state.config.captcha.id)}">` : ''}
    <div id="trial-err" aria-live="polite"></div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary">🎁 ${t('getTrial')}</button></div>
  </form>`;
}
function publicPkgCard(p, kind, b) {
  const title = pkgName(p.title || p.name || t('w_package'));
  const pr = priceTxt(p.price, p.cur);
  const meta = kind === 'reseller' ? t('pkgCreditsN', { n: p.credits }) : [p.days ? t('daysN', { n: p.days }) : '', p.devices ? t('devices', { n: p.devices }) : ''].filter(Boolean).join(' · ');
  const wa = waUrl(b, `${b.appName || 'INTPROTO-TV'}: ${title} (${pr})`);
  return `<div class="plan-c trial-pkg">${p.badge ? `<div class="small" style="color:var(--accent);font-weight:700">${esc(pkgName(p.badge))}</div>` : ''}<b dir="auto">${esc(title)}</b><div class="pp" dir="ltr">${pr}</div>${meta ? `<div class="small muted">${meta}</div>` : ''}${wa ? `<a class="btn sm wa-btn block" style="margin-top:8px" href="${esc(wa)}" target="_blank" rel="noopener">💬 ${esc(t('pkgOrderWa'))}</a>` : ''}</div>`;
}
function renderFreeTrial() {
  const b = state.config.branding || {}, tr = state.config.trial || {};
  const wa = waNum(b, 'sales'), tg = String(b.telegram || '').replace(/^@/, '');
  const tgInfo = state.config.telegram;
  const op = state.config.orderPackages || [], rp = state.config.resellerPackages || [];
  const std = op.filter((p) => p.kind !== 'ibo' && p.kind !== 'reseller'), ibo = op.filter((p) => p.kind === 'ibo');
  const pkgSec = (title, list, kind) => list.length ? `<h3 class="op-sec">${title}</h3><div class="plans-grid trial-pkgs">${list.map((p) => publicPkgCard(p, kind, b)).join('')}</div>` : '';
  const tgHint = tgInfo?.link ? `<div class="notice info small" style="margin:0 0 12px">✈️ ${t('trialTgHint', { bot: esc('@' + (tgInfo.bot || 'bot')) })} <a href="${esc(tgInfo.link)}" target="_blank" rel="noopener">${t('trialTgButton')}</a></div>` : '';
  const cap = state.config.captcha ? `<label class="field" style="flex-direction:row;align-items:center;gap:10px"><span style="min-width:130px">${t('captchaQ', { q: esc(state.config.captcha.q) })}</span><input name="captchaAnswer" inputmode="numeric" autocomplete="off" required placeholder="=" style="width:110px;text-align:center" aria-label="captcha"></label><input type="hidden" name="captchaId" value="${esc(state.config.captcha.id)}">` : '';
  const form = tr.enabled === false
    ? `<div class="notice warning">${esc(t('trial_off'))}</div>`
    : `<form data-form="trial" id="ft-form">
        ${tgHint}
        ${field(t('fullName'), 'name', '', { attrs: 'required autocomplete="name"' })}
        ${field(t('email'), 'email', '', { type: 'email', attrs: 'required autocomplete="email" autocapitalize="none" dir="ltr"' })}
        ${phoneField(t('phone'), 'phone')}
        ${field(t('telegramId'), 'telegram', '', { ph: '@username', attrs: 'autocapitalize="none" autocomplete="off"', help: t('optional') })}
        ${toggle(t('sameWhatsapp'), 'same', true)}
        <div id="wa-field" style="display:none">${phoneField(t('whatsapp'), 'whatsapp', false)}</div>
        ${cap}
        <div id="trial-err" aria-live="polite"></div>
        <button class="btn primary block" style="margin-top:10px">🎁 ${esc(t('getTrial'))}</button>
      </form>`;
  $('#app').innerHTML = `<div class="site"><main class="s-doc" id="main" style="max-width:560px;margin:0 auto">
    <a href="/" class="s-back">← ${esc(b.appName || 'INTPROTO-TV')}</a>
    <h1>🎁 ${esc(t('trialTitle', { hours: tr.hours }))}</h1>
    <p class="s-sub">${esc(t('trialIntro'))}</p>
    <div id="ft-card" class="card" style="padding:18px">${form}</div>
    ${(std.length || ibo.length || rp.length) ? `<section style="margin-top:22px"><h2 style="margin:0 0 4px">💎 ${esc(t('pkgAllTitle'))}</h2><p class="muted small" style="margin:0 0 12px">${esc(t('pkgAllText'))}</p>${pkgSec(t('pkgSubs'), std, 'subscription')}${pkgSec(t('pkgIbo'), ibo, 'ibo')}${pkgSec(t('pkgReseller'), rp, 'reseller')}</section>` : ''}
    <div class="s-cta" style="margin-top:14px;justify-content:flex-start">
      ${wa ? `<a class="btn wa-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 ${esc(t('whatsapp'))}</a>` : ''}
      ${tg ? `<a class="btn" href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">✈️ Telegram</a>` : ''}
      ${tgInfo?.link ? `<a class="btn" href="${esc(tgInfo.link)}" target="_blank" rel="noopener">✈️ ${esc('@' + (tgInfo.bot || 'bot'))}</a>` : ''}
      <a class="btn" href="/" data-act="site-page" data-page="home">${esc(t('backHome'))}</a>
      <a class="btn primary" href="/#pricing">${esc(t('seePlans'))}</a>
    </div>
  </main></div>`;
  setWaFab(b, t('waMsg', { app: b.appName || 'INTPROTO-TV', u: '' }));
  window.scrollTo(0, 0);
}

function renderResellers() {
  const b = state.config.branding || {};
  const wa = waNum(b, 'resellers'), tg = String(b.telegram || '').replace(/^@/, '');
  setWaFab(b, t('waMsg', { app: b.appName || 'INTPROTO-TV', u: '' }));
  $('#app').innerHTML = `<div class="site"><main class="s-doc" id="main" style="max-width:720px;margin:0 auto">
    <a href="/" class="s-back">← ${esc(b.appName || 'INTPROTO-TV')}</a>
    <h1>🤝 ${esc(t('resellerPanel'))}</h1>
    <p class="s-sub">${esc(t('resellerIntro'))}</p>
    <div id="rs-body"></div>
    <div class="card" style="margin-top:16px"><p class="small muted" style="margin:0">${esc(t('resellerProgram'))}</p>
      <div class="s-cta" style="margin-top:10px;justify-content:flex-start">
        ${wa ? `<a class="btn wa-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 ${esc(t('whatsapp'))}</a>` : ''}
        ${tg ? `<a class="btn" href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">✈️ Telegram</a>` : ''}
        ${b.supportUrl ? `<a class="btn" href="${esc(b.supportUrl)}" target="_blank" rel="noopener">${esc(b.supportLabel || t('support'))}</a>` : ''}
      </div></div>
  </main></div>`;
  if (state.token && state.role === 'user') loadResellerPanel();
  else if (state.token) $('#rs-body').innerHTML = `<div class="card" style="padding:18px"><p style="margin-top:0">${esc(t('resellerIntro'))}</p><a class="btn primary block" data-act="logout">${esc(t('logout'))}</a></div>`;
  else $('#rs-body').innerHTML = `<div class="card" style="padding:18px"><p style="margin-top:0">${esc(t('resellerSignIn'))}</p><button class="btn primary block" data-act="site-login">${esc(t('signIn'))}</button></div>`;
  window.scrollTo(0, 0);
}

// ---------------- public support page (/support) ----------------
// Step 1 asks who the customer is (required). Only then can a ticket be opened; it lands in the agents' queue right away.
const SUP = { step: 1, token: '', known: false, info: null, ref: '', me: null, form: {} };
const ticketPhotoConsent = () => `<label class="field" style="flex-direction:row;align-items:flex-start;gap:9px"><input type="checkbox" name="aiPhotoConsent" style="width:auto;margin-top:3px"><span class="small">${esc(t('ticketAiPhotoConsent'))}</span></label>`;
const supLangSel = () => langChip(getLang(), { label: t('language') });
async function renderSupport() {
  document.documentElement.dir = getLang() === 'ar' ? 'rtl' : 'ltr';
  const b = state.config.branding || {};
  if (!SUP.info) { try { SUP.info = await api('GET', '/api/support/info'); } catch { SUP.info = { email: 'contact@intproto-tv.com', whatsapp: waNum(b) }; } }
  if (state.token && state.role === 'user' && !SUP.me) { try { SUP.me = (await api('GET', '/api/me')).user; } catch { SUP.me = {}; } }
  supDraw();
}
function supDraw() {
  const b = state.config.branding || {}; const I = SUP.info || {}; const me = SUP.me || {}; const F = SUP.form;
  const wa = String(I.whatsapp || waNum(b, 'support') || '').replace(/\D/g, ''); const mail = I.email || 'contact@intproto-tv.com';
  setWaFab(b, t('waMsg', { app: b.appName || 'INTPROTO-TV', u: me.username || '' }));
  const steps = `<div class="sup-steps"><span class="${SUP.step === 1 ? 'on' : 'done'}">${esc(t('sup_step1'))}</span><span class="${SUP.step === 2 ? 'on' : SUP.step > 2 ? 'done' : ''}">${esc(t('sup_step2'))}</span></div>`;
  let body = '';
  if (SUP.step === 1) {
    body = `<form data-form="sup-start" class="card" style="padding:18px" novalidate>
      ${me.username ? `<div class="notice info small" style="margin:0 0 12px">${esc(t('sup_signedIn', { u: me.username }))}</div>` : ''}
      ${field(t('sup_name'), 'name', F.name || me.name || '', { attrs: 'required minlength="2" maxlength="80" autocomplete="name"' })}
      ${field(t('sup_email'), 'email', F.email || me.email || '', { type: 'email', attrs: 'required maxlength="120" autocomplete="email"' })}
      ${phoneField(esc(t('sup_phone')), 'phone', true, F.phone || me.whatsapp || me.phone || '')}
      ${field(t('sup_user'), 'username', F.username || me.username || '', { attrs: 'maxlength="60" autocomplete="username"' })}
      <div class="row" style="gap:10px;flex-wrap:wrap"><div style="flex:1;min-width:150px">${field(t('sup_order'), 'orderNo', F.orderNo || me.orderNo || '', { attrs: 'maxlength="40"' })}</div><div style="flex:1;min-width:150px">${field(t('sup_device'), 'device', F.device || '', { ph: t('sup_devicePh'), attrs: 'maxlength="60"' })}</div></div>
      <div id="sup-err"></div>
      <button class="btn primary block">${esc(t('sup_next'))}</button>
    </form>`;
  } else if (SUP.step === 2) {
    const cats = ['login', 'channels', 'payment', 'device', 'other'];
    body = `<form data-form="sup-ticket" class="card" style="padding:18px">
      <div class="notice ${SUP.known ? 'success' : 'info'} small" style="margin:0 0 12px">${esc(SUP.known ? t('sup_known') : t('sup_new'))} · ${esc(F.name || '')} · ${esc(F.email || '')}</div>
      ${field(t('sup_cat'), 'category', 'other', { type: 'select', options: cats.map((k) => [k, t('sup_cat_' + k)]) })}
      ${field(t('sup_subject'), 'subject', '', { attrs: 'required minlength="3" maxlength="120"' })}
      ${field(t('sup_msg'), 'text', '', { type: 'textarea', rows: 5, ph: t('sup_msgPh'), attrs: 'required minlength="5" maxlength="2000"' })}
      <label class="field"><span>${esc(t('attAdd'))}</span><input type="file" name="image" accept="image/*"></label>${ticketPhotoConsent()}
      <div id="sup-err"></div>
      <button class="btn primary block">${esc(t('sup_send'))}</button>
      <button type="button" class="btn ghost block" data-act="sup-back" style="margin-top:8px">${esc(t('sup_back'))}</button>
    </form>`;
  } else {
    body = `<div class="card" style="padding:22px;text-align:center"><div style="font-size:42px">✅</div><h2 style="margin:6px 0">${esc(t('sup_done'))}</h2>
      <p class="muted">${esc(t('sup_doneText', { ref: SUP.ref, wa: wa ? t('sup_doneWa') : '' }))}</p>
      <div style="font-size:22px;font-weight:700;letter-spacing:1px;margin:10px 0" id="sup-ref">${esc(SUP.ref)}</div>
      <button class="btn primary" data-act="sup-another">${esc(t('sup_another'))}</button>
      ${state.token && state.role === 'user' ? '' : `<p class="small muted" style="margin-top:14px">${esc(t('sup_account'))} <a href="/profile">${esc(t('signIn'))}</a></p>`}</div>`;
  }
  $('#app').innerHTML = `<div class="site"><main class="s-doc" id="main" style="max-width:640px;margin:0 auto">
    <div class="row" style="justify-content:space-between;align-items:center;gap:10px"><a href="/" class="s-back">← ${esc(b.appName || 'INTPROTO-TV')}</a>${supLangSel()}</div>
    <h1>🎧 ${esc(t('sup_title'))}</h1>
    <div class="sup-badge">🟢 ${esc(t('sup_247'))}</div>
    <p class="s-sub">${esc(t('sup_intro'))}</p>
    ${SUP.step < 3 ? steps : ''}
    ${body}
    <div class="card" style="margin-top:16px"><p class="small muted" style="margin:0">${esc(t('sup_or'))}</p>
      <div class="s-cta" style="margin-top:10px;justify-content:flex-start">
        <a class="btn" href="mailto:${esc(mail)}">📧 ${esc(mail)}</a>
        ${wa ? `<a class="btn wa-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      </div></div>
  </main></div>`;
  window.scrollTo(0, 0);
}

// ---------------- reseller dashboard (/rsl) ----------------
const RSL = { d: null, tab: 'home', q: '' };
const rslLangSel = () => langChip(getLang(), { label: t('language') });
async function renderRsl() {
  goAfterRender();
  document.documentElement.dir = getLang() === 'ar' ? 'rtl' : 'ltr';
  if (state.role !== 'reseller') {
    $('#app').innerHTML = `<div class="login-wrap"><div class="login-card"><h2>🤝 ${esc(t('rsl_title'))}</h2><p class="muted">${esc(t('rsl_custAcc'))}</p><a class="btn primary block" data-act="logout">${esc(t('logout'))}</a><div class="login-foot"><a href="/">← ${esc(state.config.branding.appName || t('home'))}</a></div></div></div>`; return;
  }
  $('#app').innerHTML = `<div class="rsl"><p class="muted" style="padding:40px;text-align:center">${esc(t('rsl_loading'))}</p></div>`;
  try { RSL.d = await api('GET', '/api/rsl/me'); } catch (e) { if (e.status === 401) { setSession(null); state.showLogin = true; return renderLogin(e.message); } $('#app').innerHTML = `<div class="login-wrap"><div class="login-card"><div class="err-box">${esc(e.message)}</div><button class="btn primary block" data-act="rsl-reload">${esc(t('retry'))}</button><a class="btn block" data-act="logout" style="margin-top:8px">${esc(t('logout'))}</a></div></div>`; return; }
  if (RSL.d.profile.lang && !localStorage.getItem('tvp_lang')) setLang(RSL.d.profile.lang);
  rslDraw();
}
function rslDraw() {
  const d = RSL.d; const P = d.profile; const cur = d.currency;
  const money = (n, c = cur) => (ORDER_CUR[c] || '') + Number(n || 0).toFixed(2) + (ORDER_CUR[c] ? '' : ' ' + (c || ''));
  const stat = (ic, l, n, sub = '') => `<div class="stat"><i class="st-ic">${ic}</i><span>${l}</span><b>${n}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const copyRow = (l, v, id, secret) => v ? `<div class="list-item"><span class="muted small" style="width:90px">${l}</span><code id="${id}" style="flex:1;word-break:break-all" ${secret ? `data-secret="${esc(v)}"` : ''}>${secret ? '••••••••' : esc(v)}</code>${secret ? `<button class="btn sm ghost" data-act="rsl-show" data-id="${id}" title="👁">👁</button>` : ''}<button class="btn sm" data-act="rsl-copy" data-v="${esc(v)}" title="${esc(t('copy'))}">📋</button></div>` : '';
  const tabs = [['home', t('rsl_tabHome')], ['clients', t('rsl_tabClients')], ['shop', t('rsl_tabShop')], ['buy', t('rsl_tabBuy')], ['orders', t('rsl_tabOrders')], ['lines', t('rsl_tabLines')], ['account', t('rsl_tabAccount')]];
  if ((RSL.tab === 'clients' || RSL.tab === 'shop') && !RSL.tools) { api('GET', '/api/rsl/tools').then((r) => { RSL.tools = r; rslDraw(); }).catch((e) => toast(e.message, true)); }
  const st = { active: `<span class="pill st-active">${esc(t('st_active'))}</span>`, expiring: `<span class="pill st-expiring">${esc(t('st_expiring'))}</span>`, expired: `<span class="pill st-expired">${esc(t('st_expired'))}</span>`, disabled: `<span class="pill st-disabled">${esc(t('st_disabled'))}</span>` };
  const sup = d.support; const kv = (l, v) => `<div class="list-item"><span class="muted small" style="width:130px">${esc(l)}</span><b>${esc(v)}</b></div>`;
  let body = '';
  if (RSL.tab === 'home') body = `
    <div class="stats">
      ${stat('🪙', esc(t('rsl_creditsBought')), d.credits.bought, esc(t('rsl_thisMonth', { n: d.credits.thisMonth })))}
      ${d.credits.left !== null ? stat('💳', esc(t('rsl_creditsLeft')), d.credits.left, esc(t('rsl_onPanel'))) : stat('🧾', esc(t('rsl_orders')), d.totals.orders, d.totals.lastAt ? esc(t('rsl_last', { date: fmtDate(d.totals.lastAt) })) : '')}
      ${stat('📺', esc(t('rsl_activeLines')), d.lines.active, esc(t('rsl_linesSub', { a: d.lines.expiring, b: d.lines.expired })))}
      ${stat('💵', esc(t('rsl_spent')), '$' + Number(d.totals.spentUsd).toFixed(2), d.totals.rate ? esc(t('rsl_perCredit', { p: '$' + Number(d.totals.rate).toFixed(2) })) : '')}
    </div>
    ${d.requests.length ? `<div class="notice" style="margin:14px 0">⏳ ${d.requests.map((q) => t('rsl_waiting', { n: q.credits, m: esc(q.method || ''), date: fmtDate(q.at) })).join('<br>')}</div>` : ''}
    <div class="card" style="margin-top:14px"><div class="row"><h3 style="margin:0;flex:1">${esc(t('rsl_panel'))}</h3>${d.panel.url ? `<a class="btn primary sm" href="${esc(d.panel.url)}" target="_blank" rel="noopener">${esc(t('rsl_openPanel'))}</a>` : ''}</div>
      ${d.panel.url || d.panel.user ? `<div style="margin-top:8px">${copyRow(esc(t('rsl_link')), d.panel.url, 'pu')}${copyRow(esc(t('username')), d.panel.user, 'pn')}${copyRow(esc(t('password')), d.panel.pass, 'pp', true)}${d.panel.server ? `<div class="list-item"><span class="muted small" style="width:90px">${esc(t('rsl_server'))}</span><b>${esc(d.panel.server)}</b></div>` : ''}</div>` : `<p class="muted small">${esc(t('rsl_noPanel'))}</p>`}</div>
    <div class="card" style="margin-top:14px"><div class="row"><h3 style="margin:0;flex:1">${esc(t('rsl_lastOrders'))}</h3><a class="btn sm ghost" data-act="rsl-tab" data-t="orders">${esc(t('rsl_seeAll'))}</a></div>${rslOrders(d.orders.slice(0, 5), money)}</div>
    <div class="card" style="margin-top:14px"><div class="row"><h3 style="margin:0;flex:1">${esc(t('rsl_needMore'))}</h3><a class="btn sm primary" data-act="rsl-tab" data-t="buy">${esc(t('rsl_buy'))}</a></div><p class="small muted" style="margin:6px 0 0">${esc(t('rsl_from', { x: d.packages[0] ? `${d.packages[0].credits} ${t('rsl_credits')} · ${money(d.packages[0].price)}` : '—' }))}</p></div>`;
  if (RSL.tab === 'buy') body = `<p class="muted">${esc(t('rsl_buyIntro'))}</p>
    <div class="plans-grid">${d.packages.map((x) => `<div class="plan-c" style="text-align:center"><div class="small muted">${esc(x.name)}</div><b style="font-size:2rem;display:block">${x.credits}</b><div class="small muted">${esc(t('rsl_credits'))}</div><div class="pp" style="margin:8px 0">${money(x.price)}</div><div class="small muted">${esc(t('rsl_perCredit', { p: money(x.per) }))}</div><button class="btn primary block" style="margin-top:10px" data-act="rsl-buy" data-id="${esc(x.id)}">${esc(t('rsl_order'))}</button></div>`).join('') || `<p class="muted">${esc(t('rsl_noPkgs'))}</p>`}</div>`;
  if (RSL.tab === 'orders') body = `<div class="card">${rslOrders(d.orders, money)}</div>`;
  if (RSL.tab === 'clients') body = RSL.tools ? rslClients() : `<p class="muted">${esc(t('rsl_loading'))}</p>`;
  if (RSL.tab === 'shop') body = RSL.tools ? rslShop() : `<p class="muted">${esc(t('rsl_loading'))}</p>`;
  if (RSL.tab === 'lines') { const q = RSL.q.toLowerCase(); const l = d.lines.list.filter((x) => !q || [x.name, x.username, x.orderNo].join(' ').toLowerCase().includes(q));
    body = `<div class="row" style="margin-bottom:10px"><input placeholder="${esc(t('rsl_searchLines'))}" value="${esc(RSL.q)}" data-input="rsl-q" style="flex:1"></div><div class="card" id="rsl-lines">${l.length ? `<div class="table-wrap"><table><thead><tr><th>${esc(t('rsl_line'))}</th><th>${esc(t('rsl_order'))}</th><th>${esc(t('rsl_pkg'))}</th><th>${esc(t('rsl_devices'))}</th><th>${esc(t('rsl_ends'))}</th><th>${esc(t('rsl_status'))}</th></tr></thead><tbody>${l.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="small muted">${esc(x.username)}</div></td><td>${esc(x.orderNo)}</td><td>${esc(x.plan || '')}</td><td>${x.devices}</td><td>${x.expiresAt ? fmtDate(x.expiresAt) : '—'}</td><td>${st[x.state] || ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted small">${esc(t('rsl_noLines'))}</p>`}</div>`; }
  if (RSL.tab === 'account') body = `<div class="card"><h3 style="margin-top:0">${esc(t('rsl_details'))}</h3>
      ${kv(t('rsl_id'), P.rslId)}${kv(t('rsl_name'), P.name)}${P.org ? kv(t('rsl_company'), P.org) : ''}${kv(t('email'), P.email || '—')}${kv(t('phone'), P.phone || '—')}${kv(t('rsl_signinName'), P.username)}${P.joinedAt ? kv(t('rsl_since'), fmtDate(P.joinedAt)) : ''}
      <div class="list-item"><span class="muted small" style="width:130px">${esc(t('language'))}</span>${rslLangSel()}</div>
      ${pushBox(false)}
      <p class="small muted">${esc(t('rsl_changeInfo2'))} <a data-act="rsl-tab" data-t="shop" href="#">${esc(t('rsl_tabShop'))}</a></p><button class="btn block" data-act="rsl-appme">${esc(t('rsl_appMe'))}</button></div>
    <div class="card" style="margin-top:14px"><h3 style="margin-top:0">${esc(t('rsl_changePw'))}</h3><form data-form="rsl-pass">${field(t('rsl_curPw'), 'current', '', { type: 'password', attrs: 'required autocomplete="current-password"' })}${field(t('rsl_newPw'), 'password', '', { type: 'password', attrs: 'required minlength="6" autocomplete="new-password"' })}<button class="btn primary">${esc(t('rsl_savePw'))}</button></form></div>`;
  $('#app').innerHTML = `<div class="rsl" style="max-width:1000px;margin:0 auto;padding:18px 14px 90px">
    <div class="row" style="gap:12px;margin-bottom:14px;flex-wrap:wrap">${sup.logo ? `<img src="${esc(sup.logo)}" alt="" style="height:40px;border-radius:10px">` : ''}<div style="flex:1;min-width:180px"><div class="small muted">${esc(sup.app)} · ${esc(t('rsl_title'))}</div><h2 style="margin:0">${esc(t('hello', { name: P.name.split(' ')[0] }))}</h2><div class="small muted">${esc(P.rslId)}${P.server ? ' · ' + esc(P.server) : ''}</div></div>${rslLangSel()}<button class="btn sm" data-act="rsl-reload" title="↻">↻</button><button class="btn sm ghost" data-act="logout">${esc(t('logout'))}</button></div>
    <div class="chips" style="margin-bottom:14px">${tabs.map(([k, l]) => `<a class="${RSL.tab === k ? 'on' : ''}" data-act="rsl-tab" data-t="${k}">${esc(l)}</a>`).join('')}</div>
    ${body}
    <div class="card" style="margin-top:18px"><h3 style="margin-top:0">${esc(t('rsl_help'))}</h3><div class="row" style="flex-wrap:wrap;gap:8px">${sup.whatsapp ? `<a class="btn wa-btn" href="https://wa.me/${sup.whatsapp}?text=${encodeURIComponent(t('rsl_waMsg', { id: P.rslId, name: P.name }))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${sup.telegram ? `<a class="btn" href="https://t.me/${esc(sup.telegram)}" target="_blank" rel="noopener">Telegram</a>` : ''}${sup.email ? `<a class="btn" href="mailto:${esc(sup.email)}">✉️ ${esc(sup.email)}</a>` : ''}${!sup.whatsapp && !sup.telegram && !sup.email ? `<span class="small muted">${esc(t('rsl_replyMail'))}</span>` : ''}</div></div>
  </div>`;
}
function rslOrders(list, money) {
  return list.length ? `<div class="table-wrap"><table><thead><tr><th>${esc(t('rsl_date'))}</th><th>${esc(t('rsl_order'))}</th><th>${esc(t('rsl_pkg'))}</th><th>${esc(t('rsl_credits'))}</th><th>${esc(t('rsl_amount'))}</th></tr></thead><tbody>${list.map((o) => `<tr><td>${o.at ? fmtDate(o.at) : '—'}</td><td>${esc(o.ref || '—')}</td><td>${esc(o.pkg || '')}</td><td><b>${o.credits || '—'}</b></td><td>${o.amount ? money(o.amount, o.currency) : '—'}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted small">${esc(t('rsl_noOrders'))}</p>`;
}

async function loadResellerPanel() {
  const el = $('#rs-body'); if (!el) return;
  el.innerHTML = `<div class="card" style="padding:18px"><p class="muted small" style="margin:0">${t('loadingDots')}</p></div>`;
  try {
    const me = await api('GET', '/api/me'); state.myCur = me.myCurrency || '';
    const u = me.user || {};
    const hist = (u.renewals || []).slice().reverse();
    const credit = Number(u.credit || u.creditBalance || 0);
    const rows = hist.length
      ? hist.map((r) => `<div class="list-item small"><span style="flex:1">${r.type === 'renew' ? t('renewed') : r.type === 'trial' ? t('trial') : t('startedOn')} · ${fmtDate(r.at)}</span><span dir="ltr">+${r.type === 'trial' ? '24h' : (Number(r.days) || 0) + 'd'}</span></div>`).join('')
      : `<p class="muted small">${esc(t('noPurchases'))}</p>`;
    el.innerHTML = `<div class="card"><div class="row"><div class="avatar" style="width:48px;height:48px;font-size:18px">${esc(initials(u.name || ''))}</div><div><h2 style="margin:0">${esc(u.name || '')}</h2><div class="muted">${esc(u.username || '')}</div></div><span class="spacer"></span>${pill(u.state || 'active')}</div></div>
      <div class="card"><h3>${esc(t('creditBalance'))}</h3><div class="list-item"><span style="flex:1">${esc(t('creditBalance'))}</span><b>${credit ? esc(credit) : '—'}</b></div>${(Number(me.totalPaidUsd) || 0) > 0 ? `<div class="list-item"><span style="flex:1">${esc(t('totalPaid'))}</span><b>$${Number(me.totalPaidUsd).toFixed(2)}</b></div>` : ''}</div>
      <div class="card"><h3>${esc(t('purchaseHistory'))}</h3>${rows}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="notice warning">${esc(e.message || 'Could not load your account.')}</div><button class="btn primary" data-act="site-login" style="margin-top:10px">${esc(t('signIn'))}</button>`;
  }
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
// Admin menu: [id, icon, name, permission, group, search words]
const ADMIN_TABS = [
  ['overview', '📊', 'Overview', null, 'Home', 'dashboard home stats revenue'],
   ['guide', '🎓', 'Agent guide', null, 'Home', 'help how instructions video tutorial training'],
   ['aiassist', '🤖', 'AI Assistant', null, 'Home', 'ai assistant chat ask planning alerts sports promos programs actions'],
  ['ownerplan', '🗓️', 'My planning', 'owner', 'Home', 'owner personal business planning calendar month week day schedule muay thai gym bank resend api keys domains meet party holidays reminders'],
  ['planview', '🗓️', 'Planning overview', null, 'Home', 'owner planning synced read only schedule months december 2027 agent team'],
  ['workplan', '📌', 'Work planning', null, 'Home', 'schedule planning planner tasks check off rules daily weekly agent work google sheets meeting'],
  ['customers', '👥', 'Customers', 'customers_view', 'Customers', 'clients users add renew whatsapp'],
  ['resellers', '🤝', 'Resellers', 'resellers', 'Customers', 'reseller rsl credits packages rank purchases orders email'],
  ['trialq', '⏳', 'Trial queue', 'customers_view', 'Customers', 'free trial agents claim process pending all agents'],
  ['alerts', '🚨', 'Alerts', 'customers_view', 'Customers', 'expiring expired trials attention reminders follow up'],
  ['subs', '📅', 'Subscriptions', 'customers_view', 'Customers', 'tracker csv expiry'],
  ['dups', '🧬', 'Duplicates', 'customers_view', 'Customers', 'repeat same email phone'],
  ['chat', '💬', 'Live chat', 'customers_view', 'Customers', 'messages talk conversation customer support instant'],
  ['support', '🛟', 'Support requests', 'customers_view', 'Customers', 'tickets requests help refund'],
  ['disputes', '⚠️', 'Disputes & problems', 'disputes', 'Customers', 'disputes escalations report a problem bug complaint payment issue'],
  ['tasks', '✅', 'Tasks', 'tasks', 'Team', 'tasks daily weekly plan status priority deadline completed delayed blocked assignee'],
  ['attendance', '🕒', 'Attendance & shifts', 'attendance', 'Team', 'attendance check in out breaks night shift timezone leave days off reports weekly performance clock'],
  ['notify', '🔔', 'Notifications', null, 'Team', 'push notifications devices phone iphone android laptop tablet alerts shift reminders owner check-in promotions'],
  ['teamchat', '🗣️', 'Team chat', null, 'Team', 'team chat internal handover announcements staff channel'],
  ['cc', '💳', 'CC Collection', 'owner', 'Money', 'cc collection card kast trade okx epay exchangers live declined owner'],
  ['receipts', '🧾', 'Payment receipts', 'customers_view', 'Money', 'paid proof transfer approve activate upload bank cash'],
  ['finance', '🏦', 'Banks & balances', 'finance_view', 'Money', 'stripe payments accounts transactions webhook'],
  ['stripe', '💠', 'Stripe accounts', 'stripe', 'Money', 'stripe accounts payouts grenapp waffim avixcloud bussalion normal resellers ibo links'],
  ['ibo', '📺', 'IBO Player', 'ibo', 'Money', 'ibo player credits activation mac lifetime 1 year trial smart iptv'],
  ['profits', '💰', 'Profits', 'profits', 'Money', 'reports weekly monthly yearly'],
  ['stock', '🎟', 'Credits stock', 'stock', 'Money', 'panel credits buy low'],
  ['sales', '📈', 'Sales tracker', 'sales', 'Money', 'sales daily monthly revenue transactions tracker today month'],
  ['plans', '🏷️', 'Plans & prices', 'plans', 'Money', 'packages pricing reseller pay links'],
  ['promos', '🎉', 'Promotions', 'customers_view', 'Marketing', 'promotions templates christmas new year black friday cyber monday sports cinema streaming champions league ufc formula 1 evergreen all year samsung iphone smart tv whatsapp email notification'],
  ['mkt', '📣', 'Email marketing', 'marketing', 'Marketing', 'resend keys rotation bounce lists campaign send marketing newsletter'],
  ['seo', '🧵', 'SEO & social', 'seo', 'Marketing', 'reddit quora facebook posts agents results seo social'],
  ['gads', '🔎', 'Google Ads', 'ads', 'Marketing', 'google ads campaigns budget spend domain'],
  ['fb', '📘', 'Facebook Ads', 'ads', 'Marketing', 'facebook ads creatives description performance photo history'],
  ['templates', '✍️', 'Message templates', 'settings', 'Messages', 'email whatsapp trial reminder renewal order wording text'],
  ['emails', '📬', 'Emails & bounces', 'customers_view', 'Messages', 'bounced spam delivered sent resend invalid'],
  ['trial', '🎁', 'Trial & email setup', 'settings', 'Messages', 'resend key sender free trial renewal offer'],
  ['userdash', '📱', 'User dashboard', 'settings', 'App', 'customer app sections announcement maintenance playlists'],
  ['branding', '🎨', 'Login & branding', 'settings', 'App', 'logo colours name theme'],
  ['wanums', '📞', 'WhatsApp numbers', 'customers_view', 'App', 'whatsapp numbers phone country code +1 support sales resellers'],
  ['api', '🔌', 'API settings', 'settings', 'App', 'tvplus panel server relay dns reseller'],
  ['mail', '📧', 'Email sending', null, 'System', 'email sending status resend api keys domains plans free trial paid google sheets hostinger dynu accounts'],
  ['accounts', '🗝️', 'Accounts & API keys', 'secrets', 'System', 'resend email marketing hostinger dynu domains api keys passwords google sheets spend cost'],
  ['data', '🗂', 'Import & export', 'owner', 'System', 'backup restore csv json download upload edit manually'],
  ['holidays', '🏖️', 'Holidays & reminders', 'customers_view', 'Marketing', 'holidays calendar europe usa campaign marketing planning thanksgiving black friday super bowl'],
  ['browser', '🌐', 'In-panel browser', null, 'System', 'browser internet search google sheets drive resend stripe duckduckgo'],
  ['team', '🛡', 'Team & access', 'owner', 'System', 'staff permissions roles'],
  ['security', '🔐', 'My account', null, 'System', 'password two-step 2fa sessions login'],
  ['activity', '📜', 'Activity', 'activity', 'System', 'log audit history'],
];
const navHtml = (tabs, t) => { let g = ''; return tabs.map(([k, icn, n, , grp, words]) => `${grp !== g ? ((g = grp), `<div class="nav-g ${categoryClass((tabs.find((z) => z[4] === grp) || [])[0])}">${grp}</div>`) : ''}<a class="${k === t ? 'on' : ''} ${categoryClass(k)}" ${k === t ? 'aria-current="page"' : ''} data-act="atab" data-tab="${k}" data-k="${esc((n + ' ' + grp + ' ' + words).toLowerCase())}"><span class="ic">${icn}</span>${n}${k === 'chat' ? '<b class="nav-badge" id="chat-badge" hidden></b>' : ''}</a>`).join(''); };


// Agents: check in before the panel opens (tracks working hours)
function renderCheckInGate(me) {
  const now = new Date();
  $('#app').innerHTML = `<div class="login-wrap"><div class="login-card" style="text-align:center;max-width:440px">
    <div style="font-size:54px;animation:pop .5s both">🟢</div><h2 style="margin:6px 0">Check in to start your shift</h2>
    <p class="muted">Hi <b>${esc(me.name || me.username)}</b>. Your working hours start when you check in. You are signed out automatically after <b>${me.staffHours || 6} hours</b>.</p>
    <div class="chips" style="justify-content:center;margin:10px 0"><a class="on">🕒 ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</a><a class="on">📅 ${now.toLocaleDateString()}</a></div>
    <label class="field" style="text-align:left"><span>Note (optional)</span><input id="ci-note" placeholder="e.g. morning shift"></label>
    <button class="btn primary block" data-act="checkin-go" style="min-height:52px;font-size:1.05rem">🟢 Check in &amp; open the panel</button>
    <div class="row" style="justify-content:center;margin-top:12px;gap:8px"><a class="btn sm ghost" href="/intprototv?tab=guide" data-act="guide-open">🎓 Agent guide</a>${logoutBtn()}</div></div></div>`;
}
// 6-hour sign-out timer + no-copy for agents
let staffTimer = null;
function staffGuards(me) {
  clearTimeout(staffTimer);
  if (me.role !== 'owner' && me.sessionExp) { const left = me.sessionExp - Date.now(); if (left > 0) staffTimer = setTimeout(async () => { try { await api('POST', '/api/admin/attendance', { action: 'out', note: 'Auto check-out: 6-hour sign-out' }); } catch {} toast(`Signed out after ${me.staffHours || 6} hours. Sign in and check in again.`, true); setSession(null); state.admin.me = null; route(); }, Math.min(left, 2147483000)); }
  document.body.classList.toggle('no-copy', !!me.noCopy);
}
const noCopyBlock = (e) => { if (!document.body.classList.contains('no-copy') || !isAdminUI()) return; const t0 = e.target; if (t0 && (t0.closest('input, textarea, [contenteditable]') || t0.closest('.allow-copy'))) return; e.preventDefault(); if (e.type === 'copy') toast('Copying is turned off for agents.', true); };
['copy', 'cut', 'contextmenu', 'dragstart'].forEach((ev) => document.addEventListener(ev, noCopyBlock));
async function renderBylawsGate(me) {
  setWaFab(null);
  const T = {
    en: ['Staff Internal Bylaws', 'French and English versions follow. Signing is mandatory — nothing else works until you sign.', '1. Confidentiality: everything you see inside this panel (customer data, finances, payments, API keys, other staff) is strictly confidential. Never share it.', '2. No data export: you may not export, copy, screenshot, download or photograph any data (customers, financials, lists) for any reason, except tasks explicitly assigned to you.', '3. Customer contact: use official channels only (in-app chat, tickets, email, WhatsApp/Telegram from the app). Never give personal phone numbers.', '4. Shift rules: check in and check out. Use live Europe/USA clocks before contacting customers. Use the contact checkboxes (24h auto-reset).', '5. Escalation: something you do not understand, or any technical problem → use the Report a Problem button. Do not guess.', '6. Honesty: you will leave the team exactly as you found it. All actions are logged by name.', 'Signature below: I have read and I agree. I understand violations lead to removal without notice.'],
    fr: ['Règlement intérieur', 'Les versions anglaise et française suivent. La signature est obligatoire pour accéder au panel.', '1. Confidentialité: tout ce que vous voyez ici (données clients, finances, paiements, clés API, équipe) est strictement confidentiel. Ne le partagez jamais.', '2. Aucune exportation: vous ne pouvez pas exporter, copier, photographier les données (clients, finances, listes).', '3. Contact client: utilisez uniquement les canaux officiels (chat dans l’app, tickets, e-mail, WhatsApp/Telegram depuis l’app).', '4. Horaires: pointage entrée/sortie. Utilisez les horloges Europe/USA avant tout contact client.', '5. Escalade: tout problème technique → bouton Report a Problem (Ne devinez pas).', '6. Honnêteté: vous laissez l’équipe telle que vous l’avez trouvée. Toutes les actions sont enregistrées.', 'Signature ci-dessous: j’ai lu et j’accepte. Les violations mènent au départ immédiat.'],
  };
  const sec = (lang) => `<div data-bylaw-lang="${lang}" style="display:none">${T[lang].map((line, i) => `<p${i === 0 ? ' style="font-size:1.1rem;font-weight:700;margin-bottom:10px"' : ''}>${esc(line)}</p>`).join('')}</div>`;
  $('#app').innerHTML = `<div class="block-screen" style="max-width:720px">
    <div class="ic">📜</div><h2>Staff Internal Bylaws</h2>
    <div class="chips" style="margin:6px 0 12px"><a class="on" data-act="bylaw-lang" data-l="en">English</a><a data-act="bylaw-lang" data-l="fr">Français</a></div>
    <div style="max-height:300px;overflow:auto;text-align:start;background:var(--elevated);border:1px solid var(--line2);border-radius:12px;padding:14px">${sec('en')}${sec('fr')}</div>
    <form data-form="bylaws-sign" style="margin-top:16px;width:100%;max-width:520px;text-align:start">
      ${field('Your full name (electronic signature)', 'name', (me && me.name) || '', { attrs: 'required maxlength="80"' })}
      <label class="toggle" style="margin:10px 0"><input type="checkbox" name="accepted" required><i></i><span>I have read and I accept the bylaws in English and French, in full.</span></label>
      <button class="btn primary block">✍️ Sign & continue to the dashboard</button>
    </form>
    <p class="small muted" style="margin-top:10px">Signing is recorded with your name, timestamp and IP address, and archived in the owner’s dashboard.</p>
  </div>`;
  // show English by default
  const first = $('[data-bylaw-lang="en"]'); if (first) first.style.display = 'block';
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act="bylaw-lang"]'); if (!el) return;
  document.querySelectorAll('[data-bylaw-lang]').forEach((x) => { x.style.display = x.dataset.bylawLang === el.dataset.l ? 'block' : 'none'; });
  el.parentElement.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a === el));
});
async function render2faGate() {
  setWaFab(null);
  const me = state.admin.me;
  $('#app').innerHTML = `<div class="block-screen"><div class="ic">🔐</div><h2>Two-factor sign-in required</h2>
    <p class="muted" style="max-width:440px;margin:6px 0 18px">The dashboard is only available once two-factor sign-in is on for <b>${esc(me?.username || '')}</b>. It protects customer lines, payments and settings (spec §2).</p>
    <button class="btn primary" data-act="tfa-setup">🔐 Turn on two-step sign-in</button>
    <p class="small muted" style="margin-top:14px">You will type a setup key into your authenticator app, then enter the 6-digit code it shows.</p></div>`;
}
async function renderAdmin() {
  setWaFab(null);
  startTzClock();
  setTimeout(applyTheme);
  const b = state.config.branding;
  if (!state.admin.me) { try { state.admin.me = await api('GET', '/api/admin/me'); } catch (e) { __diagSend({ kind: 'admin-me-fail', msg: String(e.message || '').slice(0, 200) }); if (!state.token) return renderLogin(); $('#app').innerHTML = `<div class="block-screen"><div class="ic">📡</div><h2>Can’t reach INTPROTO-TV</h2><p class="muted" style="max-width:320px">${esc(String(e.message || 'Session expired or server unreachable.'))}</p><button class="btn primary" onclick="location.reload()">Retry</button><button class="btn ghost" onclick="localStorage.removeItem('tvp_token');location.reload()">Sign in again</button></div>`; return; } }
  const me = state.admin.me;
  if (me.mustSetup2fa) { render2faGate(); return; }
  if (me.mustSignBylaws) { renderBylawsGate(me); return; }
  if (me.mustCheckIn) { renderCheckInGate(me); return; }
  staffGuards(me); setTimeout(() => TR.trAuto(me), 400);
  const tabs = ADMIN_TABS.filter((x) => {
    if (x[0] === 'api') return me.role === 'owner' || /technical|panel manager|tech\b/i.test(me.function || me.name || ''); // panel & Resend keys are Nizar/Khalil only (spec §1)
    return can(x[3]);
  }).filter((x) => READY_TABS(x[0]));
  if (!tabs.some((x) => x[0] === state.admin.tab)) state.admin.tab = tabs[0][0];
  const t = state.admin.tab;
  const title = ADMIN_TABS.find((x) => x[0] === t)?.[2] || '';
  document.body.className = (me.allPerms || []).filter(([p]) => !can(p)).map(([p]) => 'np-' + p).join(' ') + (me.noCopy ? ' no-copy' : '');
  $('#app').innerHTML = `<div class="admin">
    <div class="side-bg" data-act="menu-close"></div>
    <aside class="side" id="side">${brandHtml(b, false)}<input class="nav-search" type="search" placeholder="🔎 Find a page…" data-input="nav-search" aria-label="Find a page" autocomplete="off"><nav class="nav" id="nav">${navHtml(tabs, t)}<div class="nav-none muted small" hidden>No page matches.</div></nav>
      <a class="btn sm ghost" href="download.html" style="margin:6px 8px">📲 Get the apps</a>
      <div class="side-user"><div class="avatar">${esc(initials(me.name))}</div><div style="min-width:0"><b>${esc(me.name)}</b><div class="small muted">${me.role === 'owner' ? 'Owner · full access' : 'Team · ' + me.perms.length + ' permissions'}</div></div></div></aside>
    <main class="main" id="main">
      <div class="topbar"><button class="btn sm menu-btn" data-act="menu-open" aria-label="Menu">☰ Menu</button><h2>${title}</h2><span class="spacer"></span>${state.mode === 'demo' ? '<span class="badge-demo">Demo</span>' : ''}<span class="tz-clock small muted" title="Europe · US Eastern · local" style="align-self:center"><span data-tz="e">--:--</span> 🇪🇺 · <span data-tz="u">--:--</span> 🇺🇸</span>${me.role !== 'owner' && me.sessionExp ? `<span class="chip-user small" title="You are signed out automatically after ${me.staffHours || 6} hours">⏱ ${Math.max(0, Math.floor((me.sessionExp - Date.now()) / 3600000))}h ${Math.max(0, Math.floor(((me.sessionExp - Date.now()) % 3600000) / 60000))}m</span>` : ''}${refreshControlHtml()}${refreshMetaHtml(state.admin.refreshedAt || Date.now())}<button class="btn sm" data-act="tr-open" title="Translator — panel, text, chat, web" translate="no">🌐 ${esc(TR.trCur().toUpperCase().slice(0, 2))}</button><button class="btn sm" data-act="snd-open" title="Alert sounds">${sndCfg().on ? '🔊' : '🔇'}</button><button class="btn sm" data-act="atab" data-tab="guide" title="How the panel works">🎓 Guide</button><button class="btn sm danger" data-act="report-problem" title="Report a problem (bug, payment, service)">🐞 Report</button><span class="chip-user small">${esc(me.name)}</span><button class="btn sm" data-act="theme" title="Theme">🌗</button><button class="btn sm" data-act="logout">Log out</button></div>
      <div class="mobile-nav">${tabs.filter((x) => x[4] === (ADMIN_TABS.find((y) => y[0] === t) || [])[4]).map(([k, ic, n]) => `<a class="${k === t ? 'on' : ''} ${categoryClass(k)}" ${k === t ? 'aria-current="page"' : ''} data-act="atab" data-tab="${k}">${ic} ${n}</a>`).join('')}</div>
      <div class="content" id="admin-body"><div class="skeleton"></div><div class="skeleton short"></div></div>
    </main></div>`;
  try {
    const s = await api('GET', '/api/admin/settings');
    state.admin.settings = s;
    if (s.security && s.security.discordUrl) { // Discord team voice channel (spec §2)
      const tb = $('.topbar');
      if (tb && !tb.querySelector('[data-act="discord-vc"] a')) {
        const a = document.createElement('span');
        a.setAttribute('data-act', 'discord-vc');
        a.innerHTML = `<a class="btn sm" href="${esc(s.security.discordUrl)}" target="_blank" rel="noopener" title="Team voice channel on Discord">🎧 Discord</a>`;
        tb.insertBefore(a, tb.querySelector('[data-act="theme"]'));
      }
    }
    const body = $('#admin-body');
    if (t === 'guide') body.innerHTML = agentGuide();
    else if (t === 'aiassist') body.innerHTML = await adminAiAssist();
    else if (t === 'workplan') body.innerHTML = await adminWorkPlan();
    else if (t === 'ownerplan') body.innerHTML = await adminOwnerPlan();
    else if (t === 'planview') body.innerHTML = await adminPlanSync();
    else if (t === 'overview') body.innerHTML = await adminOverview();
    else if (t === 'customers') { state.admin.customers = await api('GET', '/api/admin/customers'); body.innerHTML = state.admin.profileId ? (adminCustomerProfile(state.admin.customers.find((x) => x.id === state.admin.profileId)) || adminCustomers()) : adminCustomers(); }
    else if (t === 'subs') { state.admin.customers = await api('GET', '/api/admin/customers'); body.innerHTML = await adminSubs(); }
    else if (t === 'plans') body.innerHTML = adminPlans(s) + adminOrderSection(s) + await adminResellerSection(s);
    else if (t === 'stripe') { body.innerHTML = await adminStripePage(s); setTimeout(() => { const b = body.querySelector('[data-act="sa-compare"]'); if (b) b.click(); }, 150); }
    else if (t === 'tasks') body.innerHTML = await adminTasksPage();
    else if (t === 'attendance') { body.innerHTML = await adminAttendancePage(); startTzClock(); loadShiftsAndLeaves().catch(() => {}); }
    else if (t === 'teamchat') { body.innerHTML = await adminTeamChatPage(); { const el = $('#tc-thread'); if (el) el.scrollTop = el.scrollHeight; } }
    else if (t === 'mkt') body.innerHTML = await adminMktPage();
    else if (t === 'seo') body.innerHTML = await adminSeoPage();
    else if (t === 'gads') body.innerHTML = await adminGadsPage();
    else if (t === 'fb') body.innerHTML = await adminFbPage();
    else if (t === 'cc') body.innerHTML = await adminCcPage();
    else if (t === 'ibo') body.innerHTML = await adminIboPage();
    else if (t === 'finance') { body.innerHTML = await adminFinance(s) + (can('settings') ? await adminAutoPay(s) : ''); loadStripe(); }
    else if (t === 'profits') body.innerHTML = await adminProfits(s);
    else if (t === 'stock') body.innerHTML = await adminStock(s);
    else if (t === 'sales') body.innerHTML = await adminSalesPage();
    else if (t === 'resellers') body.innerHTML = await adminResellerPage();
    else if (t === 'trial') body.innerHTML = (await adminPool()) + adminTrial(s);
    else if (t === 'userdash') body.innerHTML = adminUserDash(s);
    else if (t === 'branding') body.innerHTML = adminBranding(s);
    else if (t === 'api') body.innerHTML = await adminApi(s);
    else if (t === 'accounts') body.innerHTML = await adminAccounts();
    else if (t === 'security') body.innerHTML = await adminSecurity(s);
    else if (t === 'mail') body.innerHTML = await adminMail();
    else if (t === 'promos') body.innerHTML = await adminPromos();
    else if (t === 'wanums') body.innerHTML = waNumbersCard(s);
    else if (t === 'notify') { body.innerHTML = await adminNotify(s); pushPaint(); }
    else if (t === 'support') body.innerHTML = await adminSupport();
    else if (t === 'alerts') body.innerHTML = await adminAlerts(s);
    else if (t === 'receipts') body.innerHTML = await adminReceipts();
    else if (t === 'trialq') body.innerHTML = await adminTrialQueue();
    else if (t === 'disputes') body.innerHTML = await adminDisputes();
    else if (t === 'chat') { body.innerHTML = await adminChat(); chatScroll(); }
    else if (t === 'templates') body.innerHTML = await adminTemplates(s);
    else if (t === 'emails') body.innerHTML = await adminEmails();
    else if (t === 'browser') body.innerHTML = adminBrowserPage(s);
    else if (t === 'holidays') body.innerHTML = await adminHolidays();
    else if (t === 'data') body.innerHTML = await adminData(s);
    else if (t === 'activity') body.innerHTML = await adminActivity();
    else if (t === 'team') body.innerHTML = await adminTeam();
    else if (t === 'dups') { state.admin.customers = await api('GET', '/api/admin/customers'); body.innerHTML = await adminDups(); }
    animateIn(body);
    const oa = state.admin.openAfter; if (oa && oa.tab === t) { state.admin.openAfter = null; if (t === 'support') adminTicketModal(oa.id); else if (t === 'customers' && actions['view-customer']) actions['view-customer']({ dataset: { id: oa.id } }); }
    goAfterRender();
  } catch (e) { if (state.token) $('#admin-body').innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
}


// ---------------- email sending status (every agent can see it; keys stay hidden) ----------------
const MS_STATE = { ok: ['st-active', 'Working'], almost: ['st-expiring', 'Almost at its limit'], limit: ['st-expired', 'Limit reached'], paused: ['st-expired', 'Paused'], off: ['', 'Switched off'] };
const nfmt = (n) => Number(n || 0).toLocaleString('en-US');
async function mailStatusCard(compact, onPage) {
  let d; try { d = await api('GET', '/api/admin/email/status'); } catch { return ''; }
  if (!d.rows.length) return compact ? '' : `<div class="card"><h3>📧 Email sending status</h3><p class="muted small">No sending key yet.</p></div>`;
  const S = d.summary; const tone = d.status === 'down' ? 'danger' : d.status === 'warn' ? 'warning' : 'success';
  const head = d.status === 'down' ? '❌ Customer emails cannot be sent right now: every sending key is paused or at its limit.' : d.status === 'warn' ? `⚠️ ${S.paused} sending key${S.paused > 1 ? 's are' : ' is'} paused or at the limit. Emails go out through the other keys.` : '✅ All sending keys are working.';
  const left = (v) => (v === null ? 'no limit set' : nfmt(v) + ' left this month');
  const top = `<div class="notice ${tone}" style="margin:0 0 10px">${head}</div>
    <div class="stats" style="margin-bottom:10px">
      <div class="stat"><span>Sent this month</span><b>${nfmt(S.month)}</b><span>${nfmt(S.today)} today</span></div>
      <div class="stat c-ok"><span>Customer emails</span><b style="font-size:18px">${left(S.leftCustomer)}</b></div>
      <div class="stat"><span>Marketing</span><b style="font-size:18px">${d.rows.some((r) => r.use === 'marketing') ? left(S.leftMarketing) : '—'}</b></div>
      <div class="stat"><span>Keys</span><b>${S.working}/${S.keys}</b><span>${S.paidKeys} paid · ${S.freeKeys} free${S.unsetKeys ? ' · ' + S.unsetKeys + ' no plan' : ''}</span></div>
      <div class="stat"><span>Paid plans</span><b>$${nfmt(S.fees)}</b><span>a month</span></div>
    </div>`;
  if (compact) return `<div class="card"><div class="row"><h3>📧 Email sending status</h3><span class="spacer"></span>${onPage ? '' : '<a class="small" data-act="atab" data-tab="mail" style="cursor:pointer">Details →</a>'}</div>${top}</div>`;
  const bar = (r) => r.pct === null ? '' : `<div style="height:6px;border-radius:4px;background:rgba(127,127,127,.2);margin-top:4px"><i style="display:block;height:6px;border-radius:4px;width:${r.pct}%;background:${r.pct >= 100 ? '#ef4444' : r.pct >= 85 ? '#f59e0b' : '#22c55e'}"></i></div>`;
  const rows = d.rows.map((r) => { const [cls, lab] = MS_STATE[r.state] || ['', r.state];
    return `<div class="list-item" style="align-items:flex-start"><div style="flex:1;min-width:0"><b>${esc(r.label)}</b> <span class="pill">${r.use === 'marketing' ? 'Marketing' : 'Customer emails'}</span> <span class="pill ${r.paid ? 'st-active' : r.tier === 'free' ? 'st-expiring' : ''}">${esc(r.plan)}${r.price ? ' · $' + r.price : ''}</span>
      <div class="small muted">${d.canEdit && r.domain ? esc(r.domain) + ' · ' + esc(r.key) + ' · ' : ''}${nfmt(r.month)}${r.quota ? ' / ' + nfmt(r.quota) : ''} this month · ${nfmt(r.today)}${r.daily ? ' / ' + nfmt(r.daily) : ''} today · ${nfmt(r.total)} in total${r.last ? ' · last ' + fmtDT(r.last) : ''}</div>${bar(r)}
      ${r.why ? `<div class="small" style="margin-top:4px">⚠️ ${esc(r.why)}${r.until ? ' · tried again ' + fmtDT(r.until) : ''}</div>` : ''}${r.tier === 'unset' ? '<div class="small muted" style="margin-top:4px">Plan not set: tell the owner or Khalil which plan this key is on.</div>' : ''}</div><span class="pill ${cls}">${lab}</span></div>`; }).join('');
  return `${top}<div class="card">${rows}</div>
    <p class="small muted">Paid keys are used first, then free trial keys. A key that reaches its limit or gets an error from Resend is set aside and the next key sends the email, so no email is lost. Free trial accounts can send 100 emails a day and 3,000 a month.${d.canEdit ? ' Set the plan of each key in API settings → Resend keys, Email marketing, or Accounts & API keys.' : ' Only the owner, Khalil and Nizar can change the keys and plans.'}</p>`;
}

// ---------------- notifications before the dashboard + links from notifications ----------------
// Browsers only allow notifications after one tap on "Allow"; a device that already allowed them is connected silently.
function notifGateDue() {
  try {
    if (state.mode === 'demo' && !localStorage.getItem('tvp_ngate_test')) return false;
    const last = Number(localStorage.getItem('tvp_ngate_' + state.role) || 0); if (Date.now() - last < 3 * 86400000) return false;
    if (PUSH.ok) { if (Notification.permission === 'granted') { pushAutoLink(); return false; } return Notification.permission === 'default'; }
    return isIOS() && !isStandalone(); // iPhone in Safari: show how to install the app (needed for notifications)
  } catch { return false; }
}
async function pushAutoLink() { try { if (!(await pushSub())) await pushEnable(); } catch {} }
function renderNotifGate() {
  const A = isAdminUI(); const T = (k, en) => (A ? en : t(k)); const b = state.config.branding || {}; const ios = !PUSH.ok && isIOS() && !isStandalone();
  document.documentElement.dir = A ? 'ltr' : document.documentElement.dir;
  $('#app').innerHTML = `<div class="block-screen notif-gate" style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px">
    ${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="" style="max-height:64px;margin-bottom:10px">` : ''}<div style="font-size:64px;line-height:1">🔔</div>
    <h2 style="margin:12px 0 6px">${esc(T('ngTitle', 'Allow notifications'))}</h2>
    <p class="muted" style="max-width:420px;margin:0 auto 18px">${esc(ios ? T('ngIos', 'On iPhone and iPad, notifications work in the app: tap Share, then “Add to Home Screen”, and open the app from your home screen.') : T('ngText', A ? 'Get support requests, free trials and shift reminders instantly on this device, even when the panel is closed.' : ''))}</p>
    ${ios ? '' : `<button class="btn primary" data-act="ngate-allow" style="font-size:18px;padding:14px 28px;min-width:260px">🔔 ${esc(T('ngAllow', 'Allow notifications'))}</button>`}
    <button class="btn ghost" data-act="ngate-later" style="margin-top:12px">${esc(ios ? T('ngContinue', 'Continue') : T('ngLater', 'Not now'))}</button></div>`;
}
// A link from a notification: ?tab=support&open=<ticket> in the panel, ?go=<section> for customers and resellers
function takeDeepLink() {
  const q = new URLSearchParams(location.search); const tab = q.get('tab'), open = q.get('open'), go = q.get('go'); if (!tab && !go && !open) return;
  if (isAdminUI() && tab && state.admin) { state.admin.tab = tab; if (open) state.admin.openAfter = { tab, id: open }; }
  if (!isAdminUI() && state.user && tab) state.user.tab = tab;
  if (state.role === 'reseller' && tab && typeof RSL !== 'undefined') RSL.tab = tab;
  if (go) state.goAfter = go;
  history.replaceState(null, '', location.pathname);
}
function goAfterRender() {
  const go = state.goAfter; if (!go) return; let n = 0;
  const tick = () => { const el = document.getElementById(go) || document.querySelector(`[data-go="${go}"]`); if (el) { state.goAfter = ''; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash-go'); setTimeout(() => el.classList.remove('flash-go'), 2500); } else if (++n < 30) setTimeout(tick, 200); else state.goAfter = ''; };
  setTimeout(tick, 300);
}
// ---------------- /app: install the app + notifications (link in the emails) ----------------
let installEvt = null; window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; const b = document.getElementById('app-install'); if (b) b.hidden = false; });
// /app: one choice per device — Android (APK download), iPhone & iPad (Safari → Add to Home Screen), MacBook (download or Safari → Add to Dock)
const APP_DEV = { pick: '' };
const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|WhatsApp|GSA\/|Gmail|Outlook|MicroMessenger|; wv\)/i.test(navigator.userAgent) || (isIOS() && !/Safari\//.test(navigator.userAgent));
function devicePicker() {
  const u = navigator.userAgent; const qs = new URLSearchParams(location.search).get('os');
  const auto = qs === 'ios' || qs === 'android' || qs === 'mac' ? qs : isIOS() ? 'ios' : /android/i.test(u) ? 'android' : /Macintosh/.test(u) ? 'mac' : '';
  const cur = APP_DEV.pick || auto || 'android'; const link = location.origin + '/app';
  const tab = (k, n) => `<a data-act="app-dev" data-k="${k}" class="${cur === k ? 'on' : ''}" style="text-transform:none" tabindex="0">${esc(n)}${k === auto ? ' ✓' : ''}</a>`;
  const REL = 'https://github.com/khalil203/my-iptv/releases/download/desktop/';
  const safariBox = `<div class="notice" style="text-align:left;margin-top:10px"><b>🧭 ${esc(t('apSafariT'))}</b><p class="small" style="margin:6px 0">${esc(t('apSafariTxt'))}</p>
    <div class="code" dir="ltr" style="user-select:all;word-break:break-all;font-weight:700">${esc(link)}</div>
    <button type="button" class="btn sm primary" data-act="app-copy" style="margin-top:8px">${esc(t('apCopy'))}</button>${inAppBrowser() ? `<p class="small" style="color:var(--warn,#c80);margin:8px 0 0">⚠️ ${esc(t('apInApp'))}</p>` : ''}</div>`;
  const body = cur === 'android' ? `<a class="btn primary block" href="/apk/INTPROTO-TV.apk" download>${esc(t('apApkBtn'))}</a><p class="small muted" style="margin:8px 0 0">${esc(t('apApkSteps'))}</p>
    <div class="notice warning" style="text-align:left;margin-top:10px"><b>🛡️ ${esc(t('apAbT'))}</b><ol class="small" style="margin:6px 0 0;padding-inline-start:18px;line-height:1.55"><li>${esc(t('apAb1'))}</li><li>${esc(t('apAb2'))}</li><li>${esc(t('apAb3'))}</li></ol></div>
    <div class="notice" style="text-align:left;margin-top:10px"><b>🌐 ${esc(t('apPwaT'))}</b><p class="small" style="margin:6px 0">${esc(t('apPwa'))}</p>${installEvt ? `<button class="btn sm primary" data-act="app-install">${esc(t('apPwaBtn'))}</button>` : `<button class="btn sm" data-act="app-copy">${esc(t('apCopy'))}</button>`}</div>`
    : cur === 'ios' ? (isIOS() && !inAppBrowser() ? `<div class="notice" style="text-align:left"><b>✓ Safari</b><p style="margin:6px 0 0">📱 ${esc(t('apIosSteps'))}</p></div><details style="margin-top:8px"><summary class="small">${esc(t('apCopy'))}</summary>${safariBox}</details>` : `${safariBox}<p class="small" style="margin:10px 0 0">📱 ${esc(t('apIosSteps'))}</p>`)
    : `<a class="btn primary block" href="${REL}INTPROTO-TV-Mac-arm64.dmg">${esc(t('apMacDl'))}</a><a class="btn block" style="margin-top:6px" href="${REL}INTPROTO-TV-Mac-x64.dmg">⬇ ${esc(t('apMacIntel'))}</a><p class="small muted" style="margin:8px 0 0">💻 ${esc(t('apMacSteps'))}</p>${safariBox}`;
  return `<div class="card" id="app-dev" style="text-align:left"><h3>📲 ${esc(t('apDev'))}</h3><div class="chips" style="margin-bottom:10px;flex-wrap:wrap;overflow:visible">${tab('android', t('apAndroid'))}${tab('ios', t('apIphone'))}${tab('mac', t('apMac'))}</div>${body}</div>`;
}
function renderAppPage() {
  const b = state.config.branding || {}; const app = b.appName || 'INTPROTO-TV'; const home = state.role === 'reseller' ? '/rsl' : state.role === 'admin' || state.role === 'staff' ? '/intprototv' : '/';
  if (isStandalone() && state.token) { location.replace(home); return; }
  const ios = isIOS(); const inst = isStandalone();
  $('#app').innerHTML = `<div class="site"><main class="s-doc" style="max-width:560px;margin:0 auto;text-align:center">
    ${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="" style="max-height:72px;margin:10px auto">` : ''}<h1>📲 ${esc(t('appTitle', { app }))}</h1><p class="s-sub">${esc(t('appSub'))}</p>
    <div class="card" style="text-align:left"><h3>1. ${esc(t('appStep1'))}</h3>
      ${inst ? `<p class="pos">✓ ${esc(t('appInstalled'))}</p>` : ios ? `<p>${esc(t('appIos'))}</p>` : `<button class="btn primary block" id="app-install" data-act="app-install" ${installEvt ? '' : 'hidden'}>📲 ${esc(t('appInstallBtn', { app }))}</button><p class="small muted">${esc(t('appOther'))}</p>`}</div>
    ${devicePicker()}
    <div class="card" style="text-align:left"><h3>2. ${esc(t('appStep2'))}</h3><p class="small muted" style="margin-top:0">${esc(t('appStep2Text'))}</p>
      ${state.token ? pushBox(false) : `<a class="btn primary block" href="/profile">${esc(t('appSignIn'))}</a>`}</div>
    <div class="row" style="gap:8px;justify-content:center;margin-top:12px"><a class="btn" href="${home}">${esc(t('appOpen'))}</a><a class="btn ghost" href="/profile">👤 ${esc(t('appProfile'))}</a></div>
  </main></div>`;
}
// ---------------- notifications on this device (laptops, tablets, iPhone, Android) ----------------
const PUSH = { ok: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window };
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function devLabel() {
  const u = navigator.userAgent;
  const os = /iphone/i.test(u) ? 'iPhone' : /ipad/i.test(u) || (isIOS() && !/iphone/i.test(u)) ? 'iPad' : /android/i.test(u) ? (/mobile/i.test(u) ? 'Android phone' : 'Android tablet') : /mac/i.test(u) ? 'Mac' : /windows/i.test(u) ? 'Windows PC' : /cros/i.test(u) ? 'Chromebook' : /linux/i.test(u) ? 'Linux' : 'Device';
  const br = /edg\//i.test(u) ? 'Edge' : /opr\//i.test(u) ? 'Opera' : /samsungbrowser/i.test(u) ? 'Samsung Internet' : /chrome|crios/i.test(u) ? 'Chrome' : /firefox|fxios/i.test(u) ? 'Firefox' : /safari/i.test(u) ? 'Safari' : 'Browser';
  return `${os} · ${br}${isStandalone() ? ' (app)' : ''}`;
}
const b64ToU8 = (b) => { const s = atob((b + '='.repeat((4 - (b.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
async function swReg(make) { // never waits forever: the page may run without the service worker
  if (!('serviceWorker' in navigator)) return null; let r = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!r && make) r = await navigator.serviceWorker.register('/sw.js').catch(() => null);
  if (r && !r.active && make) { await Promise.race([navigator.serviceWorker.ready, new Promise((ok) => setTimeout(ok, 6000))]); r = await navigator.serviceWorker.getRegistration().catch(() => r); }
  return r || null;
}
async function pushSub() { if (!PUSH.ok) return null; try { const reg = await swReg(false); return reg ? await reg.pushManager.getSubscription() : null; } catch { return null; } }
async function pushState() {
  if (!PUSH.ok) return isIOS() && !isStandalone() ? 'ios-home' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await pushSub()) && Notification.permission === 'granted' ? 'on' : 'off';
}
async function pushEnable() {
  const perm = await Notification.requestPermission(); if (perm !== 'granted') throw new Error(t('notifDenied'));
  const reg = await swReg(true); if (!reg) throw new Error(t('notifNo')); const { key } = await api('GET', '/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
  await api('POST', '/api/push/subscribe', { sub: sub.toJSON(), label: devLabel(), ua: navigator.userAgent.slice(0, 150), lang: getLang(), url: isAdminUI() ? '/intprototv' : state.role === 'reseller' ? '/rsl' : '/profile' });
}
async function pushDisable() { const sub = await pushSub(); if (sub) { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); } }
async function pushForget() { try { const sub = await pushSub(); if (sub && state.token) await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch {} }
// After sign-in, a device that already allowed notifications is linked to the person signed in now (no welcome message).
async function pushRelink() { try { if (!state.token || !PUSH.ok || Notification.permission !== 'granted') return; const sub = await pushSub(); if (!sub) return; const k = 'tvp_push_' + state.role + '_' + (state.token || '').slice(-6); if (sessionStorage.getItem(k)) return; await api('POST', '/api/push/subscribe', { sub: sub.toJSON(), label: devLabel(), ua: navigator.userAgent.slice(0, 150), silent: true }); sessionStorage.setItem(k, '1'); } catch {} }
new MutationObserver(() => { const b = document.querySelector('#push-box [data-push-state]:not([data-painted])'); if (b) { b.dataset.painted = '1'; pushPaint(); } }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'push' && document.visibilityState === 'visible') { const n = (e.data.notes || []).slice(-1)[0]; if (n) toast(`${n.title}${n.body ? ' — ' + n.body.split('\n')[0] : ''}`); } });
// The on/off box for this device (same box in the panel, the customer profile and the reseller dashboard)
function pushBox(admin) {
  const T = (k, en) => (admin ? en : t(k));
  return `<div class="card push-box" id="push-box"><h3>🔔 ${T('notifT', 'Notifications on this device')}</h3><p class="small muted" style="margin-top:0">${T('notifText', 'Get an alert on this laptop, tablet or phone the moment something needs you, even when the panel is closed.')}</p><div data-push-state><p class="muted small">…</p></div></div>`;
}
async function pushPaint(admin = isAdminUI()) {
  const box = document.querySelector('#push-box [data-push-state]'); if (!box) return;
  const T = (k, en, v) => (admin ? en : t(k, v));
  const st = await pushState(); const lab = esc(devLabel());
  const btn = (act, label, cls = '') => `<button class="btn ${cls}" data-act="${act}">${label}</button>`;
  if (st === 'on') box.innerHTML = `<div class="notice success small" style="margin:0 0 10px">✅ ${T('notifIsOn', 'On for this device')} · ${lab}</div><div class="row" style="gap:8px;flex-wrap:wrap">${btn('push-test', T('notifTestBtn', 'Send a test'))}${btn('push-off', T('notifOffBtn', 'Turn off on this device'), 'ghost')}</div>`;
  else if (st === 'off') box.innerHTML = `${btn('push-on', '🔔 ' + T('notifOnBtn', 'Turn on notifications'), 'primary')}<p class="small muted">${lab}</p>`;
  else if (st === 'denied') box.innerHTML = `<div class="notice warning small" style="margin:0">${T('notifBlocked', 'Notifications are blocked for this site. Allow them in the browser settings (the lock icon next to the address), then reload.')}</div>`;
  else if (st === 'ios-home') box.innerHTML = `<div class="notice info small" style="margin:0">📱 ${T('notifIos', 'On iPhone and iPad: tap Share → “Add to Home Screen”, open the app from the home screen, then turn notifications on here (iOS 16.4 or newer).')}</div>`;
  else box.innerHTML = `<div class="notice warning small" style="margin:0">${T('notifNo', 'This browser cannot show notifications. Use Chrome, Edge, Firefox or Safari.')}</div>`;
}
async function adminNotify(s) {
  let d = null; try { d = await api('GET', '/api/admin/push/devices'); } catch {}
  const me = state.admin.me; const owner = me?.role === 'owner'; const N = d?.settings || {};
  const tg = (k, label, help) => `<label style="display:flex;flex-direction:row;align-items:flex-start;gap:10px;margin:0 0 12px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:inherit"><input type="checkbox" name="${k}" ${N[k] !== false ? 'checked' : ''} style="width:auto;margin-top:3px"><div><b>${label}</b>${help ? `<div class="small muted">${help}</div>` : ''}</div></label>`;
  const who = d ? `<div class="card"><h3>Who gets notifications</h3>${d.team.map((p) => `<div class="list-item"><div style="flex:1"><b>${esc(p.name)}</b><div class="small muted">${p.devices.length ? p.devices.map((x) => esc(x.label)).join(' · ') : 'No device yet'}</div></div><span class="pill ${p.devices.length ? 'st-active' : 'st-expiring'}">${p.devices.length} device${p.devices.length === 1 ? '' : 's'}</span></div>`).join('')}
      <p class="small muted">Customers with notifications on: <b>${d.customers}</b> device(s) · resellers: <b>${d.resellers}</b>. Each agent turns it on once per device in this tab.</p></div>` : '';
  const settings = owner && d ? `<form class="card" data-form="notify-set"><h3>What sends a notification</h3>
      <p class="small muted" style="margin-top:0">Only you (the owner) can change this.</p>
      <h4 style="margin:6px 0">To the agents (owner + everyone who can see customers)</h4>
      ${tg('tickets', '🛟 New support requests and chat messages', 'From intproto-tv.store/support, the in-app support and the live chat — sent at once to every agent device.')}
      ${tg('plan', '📌 Daily work planning to the agents', 'When the owner saves a change to My planning, every agent gets a push with today’s plan. Agents see it in the Work planning tab and in their Notifications.')}
      ${tg('trials', '🎁 Free trial requests', 'Every new free trial, and every request waiting in the trial queue.')}
      ${tg('receipts', '🧾 Payment receipts to check')}
      <h4 style="margin:12px 0 6px">Team & shifts</h4>
      ${tg('shiftReminders', '⏰ Shift start reminder to each agent', 'Sent to the agent when their shift starts (from Attendance & shifts).')}
      ${tg('shifts', '🟢 Tell me when an agent starts or ends the shift', 'Check-in and check-out alerts, and an alert if someone has not checked in 20 minutes after the shift started.')}
      ${tg('oversight', '👀 Check-ins on what the team does', 'An alert for each action of the team members you pick below (grouped so your phone rings at most once every 20 seconds per person).')}
      <div class="row" style="gap:6px 14px;flex-wrap:wrap;margin:0 0 8px 28px">${d.members.map((m) => `<label class="small row" style="gap:6px"><input type="checkbox" name="watch" value="${esc(m.id)}" ${!N.watch?.length || N.watch.includes(m.id) ? 'checked' : ''} style="width:auto">${esc(m.name)}${m.role ? ' · ' + esc(m.role) : ''}</label>`).join('') || '<span class="small muted">No team members yet.</span>'}</div>
      <h4 style="margin:12px 0 6px">Customers & resellers (in their language)</h4>
      ${tg('customers', '🙏 Customers: “Thank you for renewing”, renewal alerts and support answers', 'Renewal alert a few days before the end and on the day it ends.')}
      ${tg('resellers', '🤝 Resellers: “Thank you for your order” when credits are added')}
      <div style="display:flex;align-items:flex-start;gap:10px;margin:0 0 12px"><input type="checkbox" name="autoPromo" id="nt-ap" ${N.autoPromo ? 'checked' : ''} style="width:auto;margin-top:3px"><div><b>📣 Automatic promotion reminders</b><div class="small muted">Packages to expired customers and trials, credit packages to resellers.</div><div style="display:flex;align-items:center;gap:8px;margin-top:6px"><span class="small">Every</span><input type="number" name="promoDays" value="${esc(N.promoDays || 7)}" min="1" max="60" style="width:80px"><span class="small">days</span></div></div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary">Save</button></div></form>` : '';
  const promo = can('customers_edit') ? `<div class="card"><h3>📨 Send a notification in the customers' app</h3><p class="small muted" style="margin-top:0">Shows in the app under 🔔 Notifications for everyone you choose (all, active, expiring, expired, trials), and rings their phone if notifications are on. For one customer, use 🔔 on the customer.</p><button class="btn primary" data-act="note-all">📨 Write a notification</button></div><form class="card" data-form="push-promo"><h3>📣 Send a promotion reminder now</h3>
      <p class="small muted" style="margin-top:0">Goes to the devices of customers and resellers who turned notifications on. Leave the text empty to use the ready message in each person's language.</p>
      ${field('Who', 'audience', 'inactive', { type: 'select', options: [['inactive', 'Customers: expired + free trials (packages)'], ['active', 'Customers: active subscriptions'], ['trials', 'Customers: free trials only'], ['customers', 'All customers'], ['resellers', 'Resellers (credit packages)'], ['all', 'Everyone']] })}
      ${field('Title (optional)', 'title', '', { attrs: 'maxlength="120"', ph: 'Special offer on our packages 📺' })}
      ${field('Text (optional)', 'body', '', { type: 'textarea', rows: 2, attrs: 'maxlength="300"' })}
      <div class="row" style="justify-content:flex-end"><button class="btn primary">Send</button></div></form>` : '';
  return `<div class="grid2" style="gap:16px;align-items:start"><div>${pushBox(true)}${who}</div><div>${settings}${promo}</div></div>`;
}

// ---------------- 📧 Email sending: status for every agent; accounts, keys, domains and plans for the owner, Khalil and Nizar ----------------
async function adminMail() {
  let d; try { d = await api('GET', '/api/admin/email/status'); } catch (e) { return `<div class="notice danger">${esc(e.message)}</div>`; }
  if (!d.canEdit) return await mailStatusCard(false);
  try { ACC.d = await api('GET', '/api/admin/accounts'); } catch (e) { return `<div class="notice danger">${esc(e.message)}</div>`; }
  const A = (id) => ACC.d.rows.find((x) => x.id === id) || {};
  const S = d.summary; const nf = (n) => Number(n || 0).toLocaleString('en-US');
  const secV = (a, k, label) => { const v = a[k]; if (!v) return '<span class="muted">—</span>'; const id = a.id + k; return `<code style="word-break:break-all">${ACC.show[id] ? esc(v) : '••••' + esc(String(v).slice(-4))}</code> <button class="btn sm ghost" data-act="acc-eye" data-k="${id}" title="Show / hide ${label}">👁</button><button class="btn sm ghost" data-act="rsl-copy" data-v="${esc(v)}" title="Copy">📋</button>`; };
  const tierOpts = [['free', 'Free trial · 100/day · 3,000/month'], ['p50', 'Paid · $20 · 50,000/month'], ['p100', 'Paid · $35 · 100,000/month'], ['custom', 'Paid · other amount…']];
  const cards = d.rows.map((r) => { const a = A(r.accountId); const [cls, lab] = MS_STATE[r.state] || ['', r.state]; const pct = r.pct;
    const bar = pct === null ? '' : `<div style="height:6px;border-radius:4px;background:rgba(127,127,127,.2);margin-top:4px"><i style="display:block;height:6px;border-radius:4px;width:${pct}%;background:${pct >= 100 ? '#ef4444' : pct >= 85 ? '#f59e0b' : '#22c55e'}"></i></div>`;
    return `<div class="card mail-acc" style="margin-bottom:12px">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><b style="font-size:16px">${esc(r.accountName || r.label)}</b><span class="pill">${r.use === 'marketing' ? 'Marketing' : 'Customer emails'}</span><span class="pill ${cls}">${lab}</span><span class="spacer" style="flex:1"></span>
        <label class="small" style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;cursor:pointer"><input type="checkbox" data-input="mail-on" data-id="${esc(r.accountId)}" ${r.state !== 'off' ? 'checked' : ''} style="width:auto"> Sending on</label></div>
      <div class="grid3" style="margin-top:10px;gap:10px">
        <div><div class="small muted">Resend account (login)</div>${r.login ? `<div>${esc(r.login)}</div>` : '<div class="muted small">— add it with ✎ Edit</div>'}${a.password ? `<div class="small">${secV(a, 'password', 'password')}</div>` : ''}</div>
        <div><div class="small muted">API key</div><div class="small">${secV(a, 'apiKey', 'API key')}</div></div>
        <div><div class="small muted">Domains</div>${(r.domains || []).map((x) => `<span class="tagp">${esc(x)}</span>`).join(' ') || '—'}</div>
      </div>
      <div class="grid2" style="margin-top:10px;gap:10px;align-items:end">
        <div><div class="small muted">Plan ${r.paid ? '<span class="pill st-active">Paid</span>' : r.tier === 'free' ? '<span class="pill st-expiring">Free trial</span>' : ''}</div>
          <select data-input="mail-plan" data-id="${esc(r.accountId)}">${tierOpts.map(([k, n]) => `<option value="${k}" ${r.tier === k ? 'selected' : ''}>${n}${k === 'custom' && r.tier === 'custom' ? ` ($${r.price} · ${nf(r.quota)})` : ''}</option>`).join('')}${r.tier === 'unset' ? '<option value="" selected>Plan not set — choose</option>' : ''}</select>
          ${r.paidUntil ? `<div class="small muted">Paid until ${esc(r.paidUntil)}</div>` : ''}</div>
        <div><div class="small">${nf(r.month)}${r.quota ? ' / ' + nf(r.quota) : ''} this month · ${nf(r.today)}${r.daily ? ' / ' + nf(r.daily) : ''} today · ${nf(r.total)} total</div>${bar}</div>
      </div>
      ${r.why ? `<div class="small" style="margin-top:6px">⚠️ ${esc(r.why)}${r.until ? ' · tried again ' + fmtDT(r.until) : ''}${r.lastError?.msg ? ` <span class="muted">(${esc(r.lastError.msg)})</span>` : ''}</div>` : ''}
      ${r.note ? `<div class="small muted" style="margin-top:6px">📝 ${esc(r.note)}</div>` : ''}
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">${r.accountId ? `<button class="btn sm" data-act="acc-edit" data-id="${esc(r.accountId)}">✎ Edit all details</button><button class="btn sm" data-act="acc-domains" data-id="${esc(r.accountId)}">🌐 Domain status at Resend</button><button class="btn sm danger" data-act="acc-del" data-id="${esc(r.accountId)}">🗑 Remove</button>` : ''}</div>
    </div>`; }).join('');
  const others = ACC.d.rows.filter((a) => a.kind === 'hostinger' || a.kind === 'dynu');
  return `<div class="notice" style="margin-bottom:12px">🔐 You see the keys, passwords and domains because you are the owner, Khalil or Nizar. Support agents see this page without them.</div>
    ${await mailStatusCard(true, true)}
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:12px 0"><button class="btn primary" data-act="mail-add">＋ Add email account</button><button class="btn" data-act="acc-sheet">📊 Google Sheets ${d.sheet ? '<span class="pill st-active">linked</span>' : '<span class="pill">not linked</span>'}</button><button class="btn" data-act="acc-dns">🌐 Add Resend DNS records</button>${others.filter((a) => a.kind === 'hostinger' && a.apiKey).map((a) => `<button class="btn" data-act="acc-hostinger" data-id="${a.id}">🏠 ${esc(a.name)}</button>`).join('')}<a class="btn ghost" data-act="atab" data-tab="accounts">🗝️ All accounts (Hostinger, Dynu…)</a></div>
    ${cards || '<div class="card"><p class="muted">No email account yet. Press ＋ Add email account.</p></div>'}
    <div class="card"><h3>🏠 Hostinger & 🌐 Dynu</h3>
      <p class="small muted" style="margin-top:0">Only the owner, Khalil and Nizar see and change this. Paste the API key once: the websites, domains and DNS appear here, and Resend's email records can be added to your domains in one click.</p>
      <div class="grid2" style="gap:12px;align-items:start">
        ${['hostinger', 'dynu'].map((k) => { const list = others.filter((a) => a.kind === k); const H = k === 'hostinger';
          return `<div class="card" style="margin:0"><h4 style="margin-top:0">${H ? '🏠 Hostinger — websites & apps' : '🌐 Dynu — domains & DNS'}</h4>
            ${list.map((a) => `<div class="list-item"><div style="flex:1"><b>${esc(a.name)}</b><div class="small muted">${esc(a.email || '')}${(a.domains || []).length ? ' · ' + a.domains.map(esc).join(', ') : ''}</div></div>${a.apiKey ? `<button class="btn sm" data-act="${H ? 'acc-hostinger' : 'acc-dynu'}" data-id="${a.id}">${H ? '🏠 Websites & domains' : '🌐 Domains & DNS'}</button>` : '<span class="pill st-expiring">no API key</span>'}<button class="btn sm ghost" data-act="acc-edit" data-id="${a.id}">✎</button></div>`).join('')}
            <form data-form="hd-connect" data-k="${k}" style="margin-top:8px">${list.length ? '<p class="small muted" style="margin:0 0 6px">Add another account:</p>' : ''}
              ${field(H ? 'Hostinger API token' : 'Dynu API key', 'apiKey', '', { attrs: 'required autocomplete="off" autocapitalize="none" spellcheck="false"', ph: H ? 'hPanel → Profile → API → Create token' : 'Dynu → Control Panel → API Credentials', type: 'password' })}
              ${field('Account email (login)', 'email', '', { type: 'email', attrs: 'autocapitalize="none"' })}
              <button class="btn primary sm">🔗 Connect ${H ? 'Hostinger' : 'Dynu'}</button></form></div>`; }).join('')}
      </div></div>
    <p class="small muted">Everything here is the same list as 🗝️ Accounts & API keys and the Google Sheet: change it in any of the three and the sending keys follow (plan, domain, on/off). Paid keys send first; free trial keys only up to 100 a day and 3,000 a month.</p>`;
}
// ---------------- 🎉 Promotions hub: ready-to-send, sports, reseller, credit and full management ----------------
const PROMO = { lang: 'en', data: null };
const PC = { sub: 'manage', type: 'all', sport: 'all', data: null };
const PC_CHANNELS = ['email', 'whatsapp', 'notification', 'telegram'];
const pcRefresh = async () => { const b = $('#admin-body'); if (b) b.innerHTML = await adminPromos(); };
const PC_ICONS = { general: '⚡', football: '⚽', basketball: '🏀', reseller: '🤝', credit: '💳' };
const pcPill = (status) => `<span class="pill ${({ active: 'st-active', sent: 'st-active', scheduled: 'st-expiring', paused: 'st-expired', draft: '' })[status] || ''}">${esc(status)}</span>`;

async function adminPromos() {
  try { PC.data = await api('GET', '/api/admin/promos'); }
  catch (e) { return `<div class="notice danger">${esc(e.message)}</div>`; }
  try { PC.rm = await api('GET', '/api/admin/renewmodels'); } catch { PC.rm = null; }
  try { PROMO.data = await api('GET', '/api/admin/promo/library'); } catch { PROMO.data = null; }
  state.admin.sports = PC.data.sports;
  const manage = !!(PC.data.config && PC.data.config.canManage);
  const tabs = [['manage', '🛠️', 'Manage'], ['ready', '⚡', 'Ready to send'], ['sports', '🏆', 'Sports events'], ['reseller', '🤝', 'Reseller'], ['credit', '💳', 'Credit'], ['overview', '⚙️', 'More tools']];
  return `<div class="pc-hub">
    <div class="pc-head"><div><h2 style="margin:0">🎉 Promotions</h2><p class="small muted" style="margin:4px 0 0">Create, customise, preview, schedule and send campaigns — all in one place.</p></div>
      ${manage ? `<button class="btn primary" data-act="pc-new">＋ New promotion</button>` : ''}</div>
    <div class="pc-tabs" role="tablist">${tabs.map(([id, icon, n]) => `<button type="button" role="tab" class="pc-tab ${PC.sub === id ? 'on' : ''}" data-act="pc-sub" data-sub="${id}" aria-selected="${PC.sub === id}">${icon} ${n}</button>`).join('')}</div>
    <div class="pc-body" id="pc-body">${pcView(manage)}</div>
  </div>`;
}
function pcView(manage) {
  if (PC.sub === 'ready') return pcTemplates('all', manage);
  if (PC.sub === 'sports') return pcSports(manage);
  if (PC.sub === 'reseller') return pcType('reseller', manage);
  if (PC.sub === 'credit') return pcType('credit', manage);
  if (PC.sub === 'overview') return pcOverview();
  return pcManage(manage);
}

// ---- Reusable cards ----
function pcCampaignCard(c, manage) {
  const id = esc(c.id);
  return `<article class="pc-card" id="promo-${id}" data-go="promo-${id}">
    <div class="pc-card-top"><span class="pc-ic">${PC_ICONS[c.type] || '🎉'}</span><div style="flex:1;min-width:0"><h4 style="margin:0">${esc(c.title)}</h4><div class="small muted" style="margin-top:3px">${esc(c.description || 'No description yet.')}</div></div>${pcPill(c.status)}</div>
    <div class="pc-meta"><span>👥 ${esc(c.audience)}</span><span>📅 ${c.startAt ? esc(c.startAt) : 'any time'}${c.endAt ? ' → ' + esc(c.endAt) : ''}${c.time ? ' · ' + esc(c.time) : ''}</span><span>📣 ${esc((c.channels || []).join(', ') || '—')}</span>${c.code ? `<span>🏷️ ${esc(c.code)}</span>` : ''}${c.bonusPct ? `<span>🎁 +${esc(c.bonusPct)}%</span>` : ''}${c.creditAmount ? `<span>💳 ${esc(c.creditAmount)} credits</span>` : ''}</div>
    <div class="pc-actions"><button class="btn sm" data-act="pc-details" data-id="${id}">🔍 Details</button><button class="btn sm" data-act="pc-preview" data-id="${id}">👁 Preview</button>
      ${manage ? `<button class="btn sm" data-act="pc-edit" data-id="${id}">✎ Edit</button><button class="btn sm" data-act="pc-status" data-id="${id}" data-status="${c.status === 'active' || c.status === 'scheduled' ? 'paused' : 'active'}">${c.status === 'active' || c.status === 'scheduled' ? '⏸ Deactivate' : '▶ Activate'}</button><button class="btn sm primary" data-act="pc-send" data-id="${id}">📤 Send</button><button class="btn sm danger" data-act="pc-del" data-id="${id}" title="Delete">🗑</button>` : ''}</div>
  </article>`;
}
function pcTemplateCard(t, manage, fromEvent) {
  return `<article class="pc-card pc-tpl" id="tpl-${esc(t.id)}" data-go="tpl-${esc(t.id)}" data-act="pc-details" data-id="tpl_${esc(t.id)}">
    <div class="pc-card-top"><span class="pc-ic">${esc(t.icon || '🎉')}</span><div style="flex:1;min-width:0"><h4 style="margin:0">${esc(t.name)}</h4><div class="small muted" style="margin-top:3px">${esc(t.description)}</div></div><span class="pill">${esc(t.badge)}</span></div>
    <div class="pc-tpl-preview"><b>${esc(t.subject)}</b><div class="small muted" style="margin-top:4px;white-space:pre-line">${esc(String(t.whatsapp || '').slice(0, 160))}…</div></div>
    <div class="pc-meta"><span>👥 ${esc(t.audience)}</span><span>📣 ${esc((t.channels || []).join(', '))}</span>${t.code ? `<span>🏷️ ${esc(t.code)}</span>` : ''}</div>
    <div class="pc-actions"><button class="btn sm" data-act="pc-details" data-id="tpl_${esc(t.id)}">🔍 Details</button><button class="btn sm" data-act="pc-preview" data-id="tpl_${esc(t.id)}">👁 Preview</button>
      ${manage ? `<button class="btn sm primary" data-act="pc-copy" data-id="${esc(t.id)}" ${fromEvent ? `data-event="${esc(fromEvent)}"` : ''}>✍️ Customise &amp; send</button>` : ''}</div>
  </article>`;
}

// ---- Sub views ----
function pcManage(manage) {
  const all = PC.data.campaigns || [];
  const list = all.filter((c) => (PC.type === 'all' || c.type === PC.type) && (PC.status === 'all' || c.status === PC.status));
  const types = [['all', 'All types'], ...(PC.data.types || []).map((t) => [t, `${PC_ICONS[t] || '🎉'} ${t}`])];
  const statuses = [['all', 'All statuses'], ...(PC.data.statuses || []).map((s) => [s, s])];
  return `<div class="card"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center"><h3 style="margin:0;flex:1;min-width:180px">🛠️ Manage promotions <span class="pill">${all.length}</span></h3>
      <label class="small" style="text-transform:none;letter-spacing:0">Type <select data-input="pc-type" style="width:auto">${types.map(([v, n]) => `<option value="${v}" ${v === PC.type ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="small" style="text-transform:none;letter-spacing:0">Status <select data-input="pc-status-filter" style="width:auto">${statuses.map(([v, n]) => `<option value="${v}" ${v === PC.status ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
    <p class="small muted" style="margin:8px 0 12px">Saved campaigns are live on the server. Open <b>Details</b> for every setting, <b>Preview</b> to see it before sending, and <b>Send</b> to deliver it to the chosen audience.</p>
    <div class="pc-grid">${list.length ? list.map((c) => pcCampaignCard(c, manage)).join('') : `<div class="notice">No promotions here yet. ${manage ? 'Create one with <b>＋ New promotion</b>, or start from a ready template.' : 'Ask a manager to create one.'}</div>`}</div></div>`;
}
function pcTemplates(cat, manage) {
  const templates = (PC.data.templates || []).filter((t) => cat === 'all' || t.category === cat);
  const cats = [['all', 'All', '🎉'], ...(PC.data.categories || []).map((c) => [c.id, c.name, c.icon])];
  return `<div class="card"><h3 style="margin-top:0">⚡ Ready-to-send promotions <span class="pill">${templates.length}</span></h3>
    <p class="small muted">Professionally written, fully editable templates. Choose one to <b>customise</b> the title, description, message, offer and rules, then preview and send it — or open its full details first.</p>
    <div class="pc-chips">${cats.map(([id, n, ic]) => `<button type="button" class="chip ${id === cat ? 'on' : ''}" data-act="pc-cat" data-cat="${id}">${ic} ${esc(n)}</button>`).join('')}</div>
    <div class="pc-grid" style="margin-top:12px">${templates.map((t) => pcTemplateCard(t, manage)).join('')}</div></div>`;
}
function pcSports(manage) {
  const sp = (PC.data.sports && PC.data.sports.events) || [];
  const events = sp.filter((e) => PC.sport === 'all' || (e.category || (['basketball', 'nba'].includes(e.type) ? 'basketball' : 'football')) === PC.sport);
  const icon = (e) => { const t = e.type || ''; return t === 'basketball' || t === 'nba' ? '🏀' : t === 'nfl' ? '🏈' : '⚽'; };
  const templates = (PC.data.templates || []).filter((t) => t.category === 'football' || t.category === 'basketball');
  return `<div class="card"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center"><h3 style="margin:0;flex:1;min-width:180px">🏆 Football &amp; basketball events <span class="pill">${events.length}</span></h3>
    ${manage ? `<button class="btn sm primary" data-act="sport-new">＋ Add event</button>` : ''}</div>
    <p class="small muted" style="margin:8px 0 10px">Schedule campaigns around upcoming matches. Add an event, then use <b>Create promo</b> to pre-fill a football or basketball campaign you can preview, schedule and send.</p>
    <div class="pc-chips">${[['all', 'All', '🏆'], ['football', 'Football', '⚽'], ['basketball', 'Basketball', '🏀']].map(([id, n, ic]) => `<button type="button" class="chip ${PC.sport === id ? 'on' : ''}" data-act="pc-sport-filter" data-sport="${id}">${ic} ${n}</button>`).join('')}</div>
    <div class="pc-events" style="margin-top:12px">${events.length ? events.map((e) => {
      const cat = e.category || (['basketball', 'nba'].includes(e.type) ? 'basketball' : 'football');
      return `<article class="pc-event" id="sport-${esc(e.id)}"><div class="pc-card-top"><span class="pc-ic">${icon(e)}</span><div style="flex:1;min-width:0"><h4 style="margin:0">${esc(e.name)}</h4><div class="small muted">${esc(e.competition || String(e.type || '').replace(/-/g, ' '))}${e.teams ? ' · ' + esc(e.teams) : ''}${e.date ? ' · ' + esc(e.date) : ''}${e.time ? ' · ' + esc(e.time) : ''}</div>${e.tip ? `<div class="small" style="margin-top:5px">${esc(e.tip)}</div>` : ''}</div><span class="pill">${esc(cat)}</span></div>
        <div class="pc-actions">${e.url ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(e.url)}">🔗 Link</a>` : ''}<button class="btn sm primary" data-act="sport-promo" data-id="${esc(e.id)}">✍️ Create promo</button>
        ${manage ? `<button class="btn sm" data-act="sport-edit" data-id="${esc(e.id)}">✎ Edit</button><button class="btn sm danger" data-act="sport-del" data-id="${esc(e.id)}">🗑</button>` : ''}</div></article>`;
    }).join('') : '<div class="notice">No events yet — add one, or create a promo from a ready football/basketball template below.</div>'}</div>
    <h4 style="margin:18px 0 8px">Ready event templates</h4><div class="pc-grid">${templates.map((t) => pcTemplateCard(t, manage)).join('')}</div></div>`;
}
function pcType(type, manage) {
  const cat = (PC.data.categories || []).find((c) => c.id === type) || { name: type, icon: '🎉', desc: '' };
  const list = (PC.data.campaigns || []).filter((c) => c.type === type);
  const templates = (PC.data.templates || []).filter((t) => t.category === type);
  return `<div class="card"><div class="row" style="gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;flex:1;min-width:180px">${esc(cat.icon)} ${esc(cat.name)} promotions</h3>
    ${manage ? `<button class="btn sm primary" data-act="pc-new" data-type="${type}">＋ New ${esc(type)} promotion</button>` : ''}</div>
    <p class="small muted" style="margin:8px 0 12px">${esc(cat.desc)} These campaigns are managed independently from customer promotions.</p>
    <div class="pc-grid">${list.length ? list.map((c) => pcCampaignCard(c, manage)).join('') : `<div class="notice">No ${esc(type)} promotions saved yet. Start from a ready template below or create a new one.</div>`}</div>
    <h4 style="margin:18px 0 8px">Ready ${esc(type)} templates</h4><div class="pc-grid">${templates.map((t) => pcTemplateCard(t, manage)).join('')}</div></div>`;
}
function pcOverview() {
  const all = PC.data.campaigns || [];
  const count = (s) => all.filter((c) => c.status === s).length;
  const stats = `<div class="stats"><div class="stat"><span>Total promotions</span><b>${all.length}</b></div><div class="stat c-ok"><span>Active</span><b>${count('active')}</b></div><div class="stat c-acc"><span>Scheduled</span><b>${count('scheduled')}</b></div><div class="stat c-ok"><span>Sent</span><b>${count('sent')}</b></div></div>`;
  const ip = { on: true, email: true, whatsapp: true, price: 5.99, everyDays: 30, ...(state.admin.settings?.iboPromo || {}) };
  const iboCard = `<div class="card"><h3 style="margin-top:0">📺 IBO Player offer — automatic</h3>
    <p class="small muted">After every new subscription and renewal, the customer gets the IBO Player upgrade offer in their language and currency, with the IBO payment link.</p>
    <form data-form="ibo-auto" onsubmit="return false"><div class="row" style="gap:16px;flex-wrap:wrap">${toggle('On', 'on', ip.on)}${toggle('Send by email automatically', 'email', ip.email)}${toggle('Show the WhatsApp button after renew / create', 'whatsapp', ip.whatsapp)}</div>
    <div class="grid3">${field('IBO Player price', 'price', ip.price, { type: 'number', attrs: 'step="0.01" min="0"' })}${field('Not more than once every (days)', 'everyDays', ip.everyDays, { type: 'number', attrs: 'min="1"' })}</div>
    <div class="row"><span class="spacer"></span><button class="btn primary sm" data-act="ibo-auto-save">💾 Save</button></div></form></div>`;
  let rmCard = '';
  if (PC.rm) {
    const rm = PC.rm, c = rm.cfg, opts = [...rm.models.map((m) => [m.id, `${m.icon} ${m.name}`]), ['off', '— none —']];
    rmCard = `<div class="card"><h3 style="margin-top:0">🔁 Renewal emails — 5 ready models, 5 languages</h3>
      <p class="small muted">Sent automatically in each customer's language and currency, with the plans, promo code and renewal payment link.</p>
      <form data-form="rm" onsubmit="return false"><div class="row" style="gap:16px;flex-wrap:wrap">${toggle('Send automatically', 'auto', c.auto)}</div>
      <div class="grid3">${field('Promo code', 'code', c.code, { ph: 'e.g. STAY20' })}${field('Discount %', 'discount', c.discount)}${field('Or amount', 'amount', c.amount)}</div>
      <div class="grid3">${field('7 days before', 'd7', c.d7, { type: 'select', options: opts })}${field('Last day', 'today', c.today, { type: 'select', options: opts })}${field(`After it ends (up to ${c.expiredDays} days)`, 'expired', c.expired, { type: 'select', options: opts })}</div>
      <div class="row"><span class="spacer"></span><button class="btn primary" data-act="rm-save">💾 Save</button></div></form>
      <div class="grid2" style="gap:10px;margin-top:12px">${rm.models.map((m) => `<div class="card" style="margin:0;padding:14px"><div style="display:flex;gap:8px;align-items:center"><span style="font-size:24px">${m.icon}</span><b style="flex:1">${esc(m.name)}</b></div><p class="small muted" style="margin:6px 0 10px">${esc(m.subject)}</p>
        <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm" data-act="rm-preview" data-m="${m.id}">👁 Preview</button><button class="btn sm primary" data-act="rm-send" data-m="${m.id}">📤 Send now</button><button class="btn sm ghost" data-act="rm-test" data-m="${m.id}">🧪 Test to me</button></div></div>`).join('')}</div></div>`;
  }
  const by = Object.fromEntries((PROMO.data?.kinds || []).map((k) => [k.id, k]));
  const classic = PROMO.data ? `<div class="card"><h3 style="margin-top:0">🎁 Classic seasonal library — 5 languages</h3>
    <p class="small muted">The original ready email/WhatsApp/app campaigns. Load one into Email marketing, copy its WhatsApp text, or send it as an app notification.</p>
    <div class="pc-grid">${PROMO_KINDS.map(([k, name]) => { const x = by[k]; if (!x) return ''; const wa = x.wa[PROMO.lang] || x.wa.en;
      return `<article class="pc-card" id="classic-${esc(k)}"><div class="pc-card-top"><span class="pc-ic">🎉</span><div style="flex:1;min-width:0"><h4 style="margin:0">${esc(name)}</h4><div class="small muted">${esc(String(wa).slice(0, 90))}…</div></div></div>
      <div class="pc-actions"><button class="btn sm primary" data-act="nl-season" data-k="${esc(k)}">📧 Email to customers</button><button class="btn sm" data-act="promo-wa" data-k="${esc(k)}">💬 WhatsApp</button><button class="btn sm" data-act="promo-note" data-k="${esc(k)}">🔔 App notification</button></div></article>`;
    }).join('')}</div></div>` : '';
  const links = `<div class="card"><h3 style="margin-top:0">🔗 More campaign tools</h3>
    <p class="small muted">Black Friday, the newsletter and the Telegram channel post are managed in Message templates and Email marketing; they keep working as before.</p>
    <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm" data-act="atab" data-tab="templates">✉️ Message templates &amp; Black Friday</button><button class="btn sm" data-act="atab" data-tab="mkt">📣 Email marketing</button>${Object.values(PROMOS).map((p) => `<button class="btn sm" data-act="promo-preview" data-id="${esc(p.id)}">🔍 ${esc(p.title)}</button>`).join('')}</div></div>`;
  return stats + iboCard + rmCard + classic + links;
}

// ---- Forms & previews ----
function pcCampaignForm(c = {}) {
  const d = { type: 'general', audience: 'all', status: 'draft', channels: ['email'], ...c };
  const sel = (list, cur) => list.map(([v, n]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const types = (PC.data.types || ['general']).map((t) => [t, `${PC_ICONS[t] || '🎉'} ${t}`]);
  const audiences = (PC.data.audiences || ['all']).map((a) => [a, a]);
  const statuses = (PC.data.statuses || ['draft']).map((s) => [s, s]);
  return `<form data-form="pc-save" data-id="${esc(d.id || '')}" data-tpl="${esc(d.templateId || '')}" onsubmit="return false">
    <div class="grid2">${field('Title', 'title', d.title || '', { attrs: 'required' })}${field('Type', 'type', d.type, { type: 'select', options: types })}</div>
    ${field('Short description', 'description', d.description || '', { type: 'textarea', rows: 2 })}
    <div class="grid3">${field('Audience', 'audience', d.audience, { type: 'select', options: audiences })}${field('Status', 'status', d.status, { type: 'select', options: statuses })}${field('Sub-kind / category', 'category', d.category || '', { ph: 'matchday, bonus…' })}</div>
    <div class="grid3">${field('Start date', 'startAt', d.startAt || '', { type: 'date' })}${field('End date', 'endAt', d.endAt || '', { type: 'date' })}${field('Time (HH:MM)', 'time', d.time || '', { ph: '20:00' })}</div>
    <h4 style="margin:16px 0 8px">Message content</h4>
    ${field('Email subject', 'subject', d.subject || '')}
    ${field('Email body (HTML)', 'html', d.html || '', { type: 'textarea', rows: 6, help: 'Editable. Placeholders: {name} {app} {code} {discount} {credit} {bonus} {trial} {support}' })}
    ${field('WhatsApp message', 'whatsapp', d.whatsapp || '', { type: 'textarea', rows: 4 })}
    <div class="grid2">${field('App notification title', 'notifTitle', d.notifTitle || '')}${field('App notification body', 'notifBody', d.notifBody || '')}</div>
    <h4 style="margin:16px 0 8px">Offer &amp; rules</h4>
    <div class="grid3">${field('Promo code', 'code', d.code || '')}${field('Discount %', 'discountPct', d.discountPct || 0, { type: 'number', attrs: 'min="0" max="100"' })}${field('Credit amount', 'creditAmount', d.creditAmount || 0, { type: 'number', attrs: 'min="0"' })}</div>
    <div class="grid2">${field('Bonus %', 'bonusPct', d.bonusPct || 0, { type: 'number', attrs: 'min="0"' })}${field('Link / destination', 'link', d.link || '', { ph: '{trial}' })}</div>
    <div class="row" style="gap:14px;flex-wrap:wrap;margin-top:10px"><span class="small muted" style="text-transform:none;letter-spacing:0">Send through:</span>${PC_CHANNELS.map((ch) => `<label class="small" style="text-transform:none;letter-spacing:0;display:flex;gap:4px;align-items:center"><input type="checkbox" name="ch_${ch}" ${(d.channels || []).includes(ch) ? 'checked' : ''}> ${ch}</label>`).join('')}</div>
    <div class="row" style="margin-top:14px;gap:6px;flex-wrap:wrap"><button type="button" class="btn" data-act="pc-preview-draft">👁 Preview draft</button><span class="spacer"></span><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">💾 Save promotion</button></div>
  </form>`;
}
function pcDetailsHtml(x) {
  const c = x.campaign || x.template || {};
  const r = x.rendered || {};
  const rows = [['Type', c.type], ['Audience', c.audience], ['Status', c.status || 'template'], ['Schedule', `${c.startAt || 'any time'}${c.endAt ? ' → ' + c.endAt : ''}${c.time ? ' · ' + c.time : ''}`], ['Channels', (c.channels || []).join(', ')], ['Promo code', c.code], ['Discount', c.discountPct ? c.discountPct + '%' : ''], ['Credit amount', c.creditAmount], ['Bonus', c.bonusPct ? c.bonusPct + '%' : ''], ['Link', c.link]];
  return `<div class="notice"><b>${esc(c.title || 'Promotion')}</b><div class="small">${esc(c.description || '')}</div></div>
    <div class="pc-detail-grid">${rows.filter(([, v]) => v !== '' && v != null && v !== 0).map(([k, v]) => `<div><span class="small muted">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    <h4 style="margin:14px 0 6px">Email</h4><p class="small muted" style="margin:0 0 6px">Subject: <b>${esc(r.subject || c.subject || '')}</b></p>
    <h4 style="margin:12px 0 6px">WhatsApp</h4><pre class="promo-wa" style="white-space:pre-wrap;font:inherit;font-size:13px;background:rgba(127,127,127,.08);border-radius:10px;padding:10px;margin:0;max-height:200px;overflow:auto">${esc(r.whatsapp || c.whatsapp || '')}</pre>
    <h4 style="margin:12px 0 6px">App notification</h4><p class="small" style="margin:0"><b>${esc(r.notification?.title || c.notifTitle || '')}</b> — ${esc(r.notification?.body || c.notifBody || '')}</p>`;
}
function pcOpenPreview(r, title) {
  const body = modal(`👁 Preview: ${esc(title || 'Promotion')}`, `<div class="pc-pv-tabs" role="tablist">
      <button type="button" class="pc-pv-tab on" data-act="pc-pv-tab" data-pv="email" aria-selected="true">📧 Email</button>
      <button type="button" class="pc-pv-tab" data-act="pc-pv-tab" data-pv="whatsapp" aria-selected="false">💬 WhatsApp</button>
      <button type="button" class="pc-pv-tab" data-act="pc-pv-tab" data-pv="notification" aria-selected="false">🔔 App notification</button></div>
    <div class="pc-pv-panel" data-pv="email"><p class="small muted" style="margin:8px 0">Subject: <b>${esc(r.subject || '')}</b></p><iframe title="Email preview" sandbox="" style="width:100%;height:54vh;border:1px solid var(--border);border-radius:12px;background:#fff"></iframe></div>
    <div class="pc-pv-panel" data-pv="whatsapp" hidden><textarea readonly rows="12" style="width:100%;margin-top:8px">${esc(r.whatsapp || '')}</textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn" data-act="copy-text" data-text="${esc(r.whatsapp || '')}">📋 Copy text</button></div></div>
    <div class="pc-pv-panel" data-pv="notification" hidden><div class="card" style="margin:8px 0 0"><b>${esc(r.notification?.title || '')}</b><p class="small" style="margin:6px 0 0">${esc(r.notification?.body || '')}</p></div></div>
  `, { wide: true });
  const frame = body && body.querySelector('iframe');
  if (frame) frame.srcdoc = r.html || '';
}
function pcFormDraft(form) {
  const d = formToObj(form);
  return {
    id: form.dataset.id || undefined, templateId: form.dataset.tpl || undefined,
    title: d.title, description: d.description, type: d.type, category: d.category,
    audience: d.audience, status: d.status, startAt: d.startAt, endAt: d.endAt, time: d.time,
    subject: d.subject, html: d.html, whatsapp: d.whatsapp, notifTitle: d.notifTitle, notifBody: d.notifBody,
    code: d.code, discountPct: d.discountPct, creditAmount: d.creditAmount, bonusPct: d.bonusPct, link: d.link,
    channels: PC_CHANNELS.filter((ch) => d['ch_' + ch]),
  };
}

// ---- Sports form (football & basketball) ----
const sportForm = (e) => `<form data-form="sport-save" data-id="${esc(e.id || '')}"><h4 style="margin-top:0">🏆 ${e.id ? 'Edit' : 'Add'} sports event</h4>
  ${field('Event name', 'name', e.name || '', { attrs: 'required autocomplete="off"' })}
  <div class="grid2">${field('Sport', 'type', e.type || 'football', { type: 'select', options: [['football', '⚽ Football'], ['basketball', '🏀 Basketball'], ['champions-league', '⚽ Champions League'], ['nfl', '🏈 NFL'], ['nba', '🏀 NBA'], ['other', '🏆 Other']] })}
    ${field('Campaign kind', 'kind', e.kind || 'matchday', { type: 'select', options: [['matchday', 'Match day'], ['tournament', 'Tournament'], ['seasonal', 'Seasonal event'], ['special', 'Special offer'], ['other', 'Other']] })}</div>
  <div class="grid3">${field('Date', 'date', e.date || '', { type: 'date' })}${field('Kick-off time', 'time', e.time || '', { ph: '20:00' })}${field('Competition', 'competition', e.competition || '', { ph: 'Premier League, NBA…' })}</div>
  ${field('Teams', 'teams', e.teams || '', { ph: 'Team A vs Team B' })}
  ${field('Promotion text', 'tip', e.tip || '', { type: 'textarea', rows: 3 })}
  ${field('Link (optional)', 'url', e.url || '', { ph: 'https://…' })}
  <div class="row" style="margin-top:10px;gap:6px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Save event</button></div></form>`;

// ---------------- IBO Players: downloads & playlists (IBO Player tab) ----------------
const iboNormMac = (x) => { const s = String(x || '').replace(/[:\s.-]/g, '').toUpperCase(); return s ? (s.match(/.{2}/g) || []).join(':') : ''; };
const iboAppsForForm = IBO_PLAYERS.map((p) => [p.name, p.name]);
const iboPlayersCard = () => `<div class="card"><h3 style="margin-top:0">📺 IBO Players — download links, codes &amp; playlists</h3>
  <p class="small muted">Apps for TVs, STBs and Android devices. On the player: Settings (⚙️) → Playlist/Xtream Codes → enter the Downloader code, paste the APK (Android TV via the Downloader app), then log in to the Playlist URL and add the playlist M3U link from your panel.</p>
  <div class="ibo-players">${IBO_PLAYERS.map((p) => `<article class="ibo-card">
    ${p.icon ? `<img class="ibo-app-icon ibo-app-big" src="${esc(p.icon)}" alt="">` : ''}
    <h4>${esc(p.name)}${p.code ? ` <span class="tagp">${esc(p.code)}</span>` : ''}</h4>
    ${p.apk ? `<div class="ibo-link"><b style="color:var(--primary)">📥</b> <a href="${esc(p.apk)}" target="_blank" rel="noopener">${esc(p.apk)}</a></div>` : ''}
    ${p.altApk ? `<div class="ibo-link ibo-alt">alt APK: ${esc(p.altApk)}</div>` : ''}
    ${p.playlist ? `<div class="ibo-link ibo-playlist">📺 Playlist login: <a href="${esc(p.playlist)}" target="_blank" rel="noopener">${esc(p.playlist)}</a></div>` : `<div class="ibo-link ibo-playlist">📺 Playlist login: —</div>`}
    ${p.note ? `<div class="ibo-link ibo-alt">${esc(p.note)}</div>` : ''}
  </article>`).join('')}</div>
  <p class="small muted" style="margin-top:8px">Setup on the TV: open IBO Player → Settings (⚙️) → Playlist/Xtream Codes → add the M3U link (pasted from your panel) plus the username and password.</p></div>`;
const iboDevRowHtml = (idx, dev) => {
  const p = IBO_PLAYERS.find((x) => x.name === dev.deviceApp) || IBO_PLAYERS[0];
  return `<div class="ibo-devrow" data-app="${esc(p.name)}">
    <img class="ibo-app-icon" src="${esc(p.icon || '')}" alt="" style="flex:0 0 auto">
    <select name="deviceApp" class="ibo-devsel" title="App / device">${IBO_PLAYERS.map((q) => `<option value="${esc(q.name)}" ${q.name === p.name ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select>
    <input name="mac" type="text" class="ibo-devmac" value="${esc(dev.mac || '')}" placeholder="AA:BB:CC:DD:EE:FF" autocapitalize="characters" spellcheck="false" dir="ltr">
    <button type="button" class="btn sm ghost ibo-dev-del" title="Remove this device">✕</button>
  </div>`;
};
const iboDevListHtml = (devs) => `<div class="ibo-devlist">${((devs && devs.length) ? devs : [{}]).slice(0, 8).map(iboDevRowHtml).join('')}</div>`;
// App selected in a device row: attach the player’s downloader code / APK / playlist (used in the setup email) and swap the app icon.
function iboRowSelect(sel) {
  const row = sel.closest('.ibo-devrow'); if (!row) return;
  const p = IBO_PLAYERS.find((x) => x.name === sel.value) || IBO_PLAYERS[0];
  const icon = row.querySelector('img.ibo-app-icon'); if (icon) icon.src = esc(p.icon || '');
  row.dataset.app = p.name; row.dataset.code = p.code || ''; row.dataset.apk = p.apk || ''; row.dataset.playlist = p.playlist || '';
}
document.addEventListener('change', (e) => { const sel = e.target.closest('select[name="deviceApp"]'); if (sel) iboRowSelect(sel); });
const iboMacForm = (id) => `<form data-form="ibo-mac" data-id="${esc(id || '')}"><h4 style="margin-top:0">➕ Add a device (MAC) to this client</h4>
  ${field('MAC address of the new device', 'mac', '', { attrs: 'required autocapitalize="characters" dir="ltr" spellcheck="false"', ph: 'AA:BB:CC:DD:EE:FF' })}
  <div class="row" style="margin-top:10px;gap:6px"><button class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Add device</button></div></form>`;

// ---------------- Shared AI assistant (owner + agents): panel answers and actions ----------------
function aiaBubble(text, who) { return `<div class="aia-msg ${who === 'me' ? 'aia-me' : 'aia-ai'}">${esc(text)}<span class="aia-meta">${who === 'me' ? 'You' : 'AI'}</span></div>`; }
function showAia(text) { const box = $('#aia-chat'); if (box) { box.insertAdjacentHTML('beforeend', aiaBubble(text, 'ai')); box.scrollTop = box.scrollHeight; } }
async function aiaSend(q) {
  const box = $('#aia-chat'); if (!box) return;
  const text = q.trim(); if (!text) return;
  state.admin.aiChat.push({ who: 'me', text });
  box.insertAdjacentHTML('beforeend', aiaBubble(text, 'me')); box.scrollTop = box.scrollHeight;
    try { const r = await api('POST', '/api/admin/ai/ask', { question: text }); state.admin.aiChat.push({ who: 'ai', text: r.answer || '…' }); showAia(r.answer || '…'); }
  catch (e) { toast(e.message, true); }
}
async function aiaAction(kind) {
  if (kind === 'daily') return void (await aiaSend('Show today’s agent Work planning.'));
  if (kind === 'tomorrow') return void (await aiaSend('What are tomorrow’s schedules? Include agent Work planning and owner My planning separately.'));
  if (kind === 'workplan') return void (await aiaSend('Show today’s agent Work planning.'));
  if (kind === 'ownerplan') return void (await aiaSend('Show the owner’s My planning schedule.'));
  if (kind === 'campaign') { state.admin.tab = 'mkt'; return renderAdmin(); }
  if (kind === 'alerts') return void (await aiaSend('What are the current alerts? Give me the list from the Alerts tab.'));
  const map = { ibo: 'ibo-setup', ad: 'update-ad', resend: 'resend-create', program: 'change-program', notify: 'notify-agents' };
  const act = map[kind]; if (!act) return;
  try {
    const r = await api('POST', '/api/admin/ai/action', { action: act });
    if (act === 'ibo-setup') showAia(r.answer || '…');
    else if (act === 'resend') toast('✅ Resend API created — add the key to the rotating 10 keys on Email marketing (System → Email sending).');
    else if (act === 'update-ad') toast('✅ Sports promo saved — open Promotions to see it.');
    else if (act === 'change-program') { const cs = await api('GET', '/api/admin/customers'); const c = cs.find((x) => x.lineUsername); if (!c) return toast('No customer with a line found — set one up first.', true); modal('💾 Change the customer program', paidLineForm(c.id)); }
    else if (act === 'notify-agents') toast(`📣 Agents notified about the plan (${r.sent || 0} device(s)).`);
  } catch (e) { toast(e.message, true); }
}
async function adminAiAssist() {
  const me = state.admin.me; const owner = me && me.role === 'owner';
  state.admin.aiChat = state.admin.aiChat || [];
  let st = {}; try { st = await api('GET', '/api/admin/ai/config'); } catch {}
  const ready = st && st.on !== false;
  const act = (kind, label) => `<button class="btn sm" data-act="aia-act" data-action="${esc(kind)}">${esc(label)}</button>`;
  const quick = [
    ...ready ? [act('workplan', '🗓 Agent Work planning'), act('ownerplan', '🗓 Owner My planning'), act('tomorrow', '🗓 Tomorrow · both plans'), act('alerts', '⚠ Alerts'), act('ibo', '📺 IBO Player setup'), ...(can('marketing') ? [act('campaign', '📣 Email & WhatsApp drafts')] : []), act('ad', '🏆 Update sports promo')] : [],
    ...owner ? [act('resend', '⚙️ Create Resend API'), act('program', '💾 Change customer program'), act('notify', '📣 Notify agents')] : []
  ];
  return `<div class="card" style="max-width:760px;margin:0 auto">
    <h3 style="display:flex;gap:10px;align-items:baseline"><span>🤖 AI Assistant</span><span class="small muted">${ready ? (st.hasKey ? `${esc(st.model || 'AI')} · key set` : 'Panel answers — set up an AI key to enable full chat') : 'Turned off — ask the owner to turn it on'}</span></h3>
    <p class="small muted">Ask about agent Work planning and the owner’s read-only My planning, alerts, or IPTV setup in Smarters Pro, XCIPTV, TiviMate, IBO Player and other compatible apps. Draft separate email HTML and WhatsApp-ready text in Email marketing. Support staff can ask AI to review an image only when the customer opted in; the suggestion is not sent to the customer automatically.</p>
    <div class="aia-stat"><div class="aia-val">${ready ? '✓ On' : '— Off'}</div><div class="aia-sub">${st.provider ? esc(st.provider + ' · ' + (st.model || '')) : 'Panel mode — deterministic answers from the app data'}</div></div>
    ${owner ? `<form data-form="ai-cfg" class="card" style="padding:14px;background:var(--elevated);border:1px solid var(--line2);margin-top:12px"><h4 style="margin-top:0">⚙️ AI configuration (owner)</h4>
      <div class="grid2">${field('Provider', 'provider', st.provider || 'openai', { type: 'select', options: [['openai', 'OpenAI-compatible (recommended)'], ['openrouter', 'OpenRouter']] })}${field('Model', 'model', st.model || 'gpt-4o-mini')}</div>
      <div class="grid2">${field('API key', 'apiKey', '', { type: 'password', ph: st.hasKey ? 'Saved key — leave blank to keep' : 'sk-…', attrs: 'autocomplete="new-password"' })}${field('Time zone for “today”', 'tz', st.tz || 'Asia/Bangkok', { ph: 'Asia/Bangkok' })}</div>
      <div class="grid2">${field('Base URL', 'baseUrl', st.baseUrl || 'https://api.openai.com/v1', { help: 'Use an HTTPS provider URL; HTTP is refused because prompts can contain planning information.' })}${field('System instructions for the assistant', 'instructions', st.instructions || '', { type: 'textarea', rows: 3 })}</div>
      ${toggle('Allow staff to request consented customer-photo analysis', 'photoAnalysis', st.photoAnalysis !== false, 'Only after a customer opts in and a staff member clicks Analyze; only the image is sent to the configured provider. A human reviews the suggestion.')}
      <div class="row" style="margin-top:10px"><button type="submit" class="btn primary">💾 Save AI config</button></div></form>` : ''}
    <div class="aia-actions">${quick.join('')}</div>
    <div class="aia-chat" id="aia-chat">${state.admin.aiChat.length ? state.admin.aiChat.map((m) => aiaBubble(m.text, m.who)).join('') : `<div class="aia-empty"><span class="ic">🤖</span><div>Ask anything — “Show both plans”, “What are the alerts?”, “Set up Smarters Pro”, or “How do I load an M3U playlist?”</div></div>`}</div>
    <form data-form="ai-ask" class="aia-input-row" style="margin-top:12px"><input type="text" name="question" placeholder="Ask the AI…" required autocomplete="off" dir="ltr"><button type="submit" class="btn primary">Ask</button></form>
  </div>`;
}
async function adminOverview() {
  const [st, cr, me, sd] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/panel/credits').catch(() => ({})), api('GET', '/api/admin/me'), can('profits') ? api('GET', '/api/admin/sales-by-day').catch(() => null) : Promise.resolve(null)]);
  const max = Math.max(1, ...Object.values(st.byMonth || {}));
  const s = state.admin.settings;
  const setupTips = [];
  if (can('settings')) {
  if (!s.player.serverUrl) setupTips.push('Add your streaming server URL in <a data-act="atab" data-tab="api">API settings</a> so customers can watch.');
  if (!s.reseller.enabled) setupTips.push('Connect the TVplus reseller API in <a data-act="atab" data-tab="api">API settings</a> to create and renew lines automatically.');
  }
  const row = (c) => `<div class="list-item"><div class="avatar">${esc(initials(c.name))}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="small muted">${esc(c.username)} · ${c.state === 'expired' ? 'expired ' + (c.noExpiry ? '♾ No end date' : fmtDate(c.expiresAt)) : c.daysLeft + ' days left'}</div></div><button class="btn sm primary" data-act="renew" data-perm="customers_edit" data-id="${c.id}">Renew</button></div>`;
  const lim = st.lowCreditsAlert || 0;
  const panelLow = cr.enabled && cr.ok && Number(cr.credits) <= lim;
  const creditWarn = panelLow || st.stock.low ? `<div class="notice warning">🎟 <b>Credits are low</b> — ${panelLow ? `panel has <b>${esc(cr.credits)}</b> credits` : ''}${panelLow && st.stock.low ? ' · ' : ''}${st.stock.low ? `stock has <b>${st.stock.available}</b> credits` : ''}. <a data-act="atab" data-tab="stock" style="cursor:pointer">Buy credits →</a></div>` : '';
  const pwWarn = me.isDefault ? `<div class="notice danger">🔐 You are using the default admin login (<b>Iptv / Iptv</b>). Anyone who knows it can control your app. <a data-act="atab" data-tab="security" style="cursor:pointer">Change it now →</a></div>` : '';
  const panelErr = cr.enabled && !cr.ok && can('settings') ? `<div class="notice warning">🎟 <b>Panel credits could not be read.</b> ${esc(cr.error || '')} <a data-act="atab" data-tab="api" style="cursor:pointer">Open API settings →</a></div>` : '';
  let holBanner = ''; try { const hu = await api('GET', '/api/admin/holidays/upcoming'); const h = (hu.next || [])[0]; if (h) holBanner = `<div class="notice" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="font-size:24px">🗓</span><div style="flex:1;min-width:200px"><b>${esc(h.name)} ${h.daysLeft === 0 ? 'today' : h.daysLeft === 1 ? 'tomorrow' : 'in ' + h.daysLeft + ' days'}</b><div class="small muted">${esc(h.tip || '')}</div></div><button class="btn sm primary" data-act="hol-promo" data-k="${esc(h.kind)}">🎉 Send the promotion</button><a class="btn sm" data-act="atab" data-tab="holidays">All dates</a></div>`; } catch {}
  return `${holBanner}${pwWarn}${panelErr}${creditWarn}${setupTips.length ? `<div class="notice warning"><b>Finish setup</b><ul style="margin:6px 0 0;padding-left:18px">${setupTips.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}
  <div class="stats">
    ${sd ? `<div class="stat c-acc" data-act="atab" data-tab="sales" style="cursor:pointer"><i class="st-ic">${ic('cash', 20)}</i><span>Sales today</span><b>${usd(sd.today)}</b><span>${sd.todayN} sale${sd.todayN === 1 ? '' : 's'}${sd.yest || sd.yest === 0 ? ' · yest ' + usd(sd.yest) : ''}</span></div>
    <div class="stat c-acc" data-act="atab" data-tab="sales" style="cursor:pointer"><i class="st-ic">${ic('calendar', 20)}</i><span>This month</span><b>${usd(sd.month)}</b><span>${sd.monthN} sale${sd.monthN === 1 ? '' : 's'} · avg ${usd(sd.avg)}</span></div>` : ''}
    <div class="stat"><i class="st-ic">${ic('user', 20)}</i><span>Customers</span><b>${st.total}</b></div>
    <div class="stat c-ok"><i class="st-ic">${ic('check', 20)}</i><span>Active</span><b>${st.active}</b></div>
    <div class="stat c-warn"><i class="st-ic">${ic('clock', 20)}</i><span>Expiring soon</span><b>${st.expiring}</b></div>
    <div class="stat c-bad"><i class="st-ic">${ic('logout', 20)}</i><span>Expired</span><b>${st.expired}</b></div>
    <div class="stat"><i class="st-ic">${ic('star', 20)}</i><span>Free trials</span><b>${st.trials}</b></div>
    ${st.revenueTotal !== null ? `<div class="stat c-acc"><i class="st-ic">${ic('trend', 20)}</i><span>Revenue this month</span><b>${usd(st.revenueMonth)}</b><span>${mad(st.revenueMonth * st.madRate)}</span></div>
    <div class="stat"><i class="st-ic">${ic('coins', 20)}</i><span>Total revenue</span><b>${usd(st.revenueTotal)}</b><span>${mad(st.revenueTotal * st.madRate)}</span></div>` : ''}
    <div class="stat ${panelLow ? 'c-bad' : ''}"><span>Panel credits (API)</span><b>${cr.enabled ? (cr.ok ? esc(cr.credits ?? '—') : cr.last ? esc(cr.last.v) : '⚠️') : 'off'}</b>${cr.enabled && !cr.ok ? `<span title="${esc(cr.error || '')}">⚠️ ${cr.last ? 'last known, ' + fmtDate(cr.last.at) : 'not connected'}</span>` : ''}</div>
    <div class="stat ${st.stock.low ? 'c-bad' : ''}"><span>Credits in stock</span><b>${st.stock.available}</b></div>
    ${st.totalBalanceUsd !== null && st.totalBalanceUsd !== undefined ? `<div class="stat c-ok" data-act="atab" data-tab="finance" style="cursor:pointer"><span>All banks (total)</span><b>${usd(st.totalBalanceUsd)}</b><span>${mad(st.totalBalanceUsd * st.madRate)}</span></div>` : ''}
  </div>
  ${(await pushState()) === 'off' ? `<div class="notice info">🔔 <b>Get support requests, free trials and shift reminders instantly on this device.</b> <button class="btn sm primary" data-act="push-on" style="margin-inline-start:8px">Turn on notifications</button> <a class="small" data-act="atab" data-tab="notify" style="cursor:pointer">More</a></div>` : ''}
  ${await mailStatusCard(true)}
  <div class="grid2 ${can('customers_view') ? '' : 'hidden'}" style="gap:16px">
    <div class="card"><div class="row"><h3>Expiring soon</h3><span class="spacer"></span><a class="small" data-act="atab" data-tab="subs" style="cursor:pointer">Tracker →</a></div>${st.expiringSoon.length ? st.expiringSoon.map(row).join('') : '<p class="muted">Nobody is expiring soon.</p>'}</div>
    <div class="card"><h3>Recently expired</h3>${st.recentlyExpired.length ? st.recentlyExpired.map(row).join('') : '<p class="muted">No expired customers.</p>'}</div>
  </div>
  ${st.byMonth ? `<div class="card"><h3>Revenue (USD) · last 6 months</h3><div class="bars">${Object.entries(st.byMonth).map(([k, v]) => `<div><span>${v ? Number(v).toLocaleString() : ''}</span><i style="height:${(v / max) * 100}%"></i><span>${k.slice(5)}/${k.slice(2, 4)}</span></div>`).join('')}</div></div>` : ''}
  <div class="row"><button class="btn primary" data-act="new-customer" data-perm="customers_edit">＋ Add customer</button><button class="btn" data-act="new-tx" data-perm="finance_edit">💸 Add transaction</button><button class="btn" data-act="atab" data-tab="finance">🏦 Balances</button></div>`;
}

async function adminSalesPage() {
  const d = await api('GET', '/api/admin/sales-by-day');
  const max30 = Math.max(1, ...d.days30.map((x) => x.usd));
  const maxM = Math.max(1, ...d.months.map((x) => x.usd));
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const lab30 = (k) => { const [, m, dd] = k.split('-'); return `${dd}/${m}`; };
  const labM = (k) => { const [y, m] = k.split('-'); return `${M[Number(m) - 1]} ${y.slice(2)}`; };
  const rows = d.recent.map((x) => `<tr><td class="small">${fmtDT(x.at)}</td><td><div class="name-cell">${esc(x.name)}</div><div class="small muted">${esc(x.username)}${x.accountName ? ' · ' + esc(x.accountName) : ''}</div></td><td>${esc(x.planName)}</td><td><b>${num(x.amount, x.currency)}</b><div class="small muted">$${x.amountUsd.toFixed(2)}</div></td><td>${x.credits ?? ''}</td></tr>`).join('');
  return `<p class="small muted">Every sale the app records — trials excluded. Revenue shown in USD; MAD uses the finance rate.</p>
  <div class="stats">
    <div class="stat c-acc"><span>Today</span><b>${usd(d.today)}</b><span>${d.todayN} sale${d.todayN === 1 ? '' : 's'}</span></div>
    <div class="stat"><span>Yesterday</span><b>${usd(d.yest)}</b><span>${d.yestN} sale${d.yestN === 1 ? '' : 's'}</span></div>
    <div class="stat c-acc"><span>This month</span><b>${usd(d.month)}</b><span>${d.monthN} sale${d.monthN === 1 ? '' : 's'} · avg ${usd(d.avg)}</span></div>
    <div class="stat"><span>Best day (30d)</span><b>${usd(d.bestUsd)}</b><span>${d.bestDay.split('-').reverse().join('/')}</span></div>
  </div>
  <div class="card"><div class="row"><h3 style="margin:0">Daily sales · last 30 days (USD)</h3><span class="spacer"></span><button class="btn sm" data-act="sales-csv">⬇ CSV</button></div><div class="bars">${d.days30.map((x) => `<div><span>${x.usd ? Number(x.usd).toLocaleString() : ''}</span><i style="height:${(x.usd / max30) * 100}%"></i><span>${lab30(x.d)}</span></div>`).join('')}</div></div>
  <div class="card"><h3>Monthly sales · last 12 months (USD)</h3><div class="bars">${d.months.map((x) => `<div><span>${x.usd ? Number(x.usd).toLocaleString() : ''}</span><i style="height:${(x.usd / maxM) * 100}%"></i><span>${labM(x.k)}</span></div>`).join('')}</div></div>
  <div class="card"><h3>Transactions <span class="small muted">(${d.recent.length})</span></h3>${d.recent.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Customer</th><th>Plan</th><th>Amount</th><th>Credits</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No sales recorded yet.</p>'}</div>`;
}

// ---------- Resellers (admin): profiles with their own orders. Add by hand, from the customer list, or from pasted text ----------
const RS = { data: null, q: '', customers: null, pick: new Set(), pq: '', parsed: null };
const rsDay = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
const rsMoney = (o) => `${({ USD: '$', EUR: '€', USDT: '₮', GBP: '£' })[o.currency] || ''}${Number(o.amount || 0).toFixed(2)}${({ USD: 1, EUR: 1, USDT: 1, GBP: 1 })[o.currency] ? '' : ' ' + o.currency}`;
const rsGet = (id) => (RS.data?.list || []).find((x) => x.id === id);
function rsRowsHtml() {
  const q = RS.q.trim().toLowerCase();
  const list = (RS.data?.list || []).filter((x) => !q || q.split(/\s+/).every((w) => [x.rslId, x.name, x.email, (x.emails || []).join(' '), x.phone, x.org, x.server, x.tag, x.note, x.username, (x.orders || []).map((o) => o.ref + ' ' + o.pkg).join(' ')].join(' ').toLowerCase().includes(w)));
  if (!list.length) return `<p class="muted" style="padding:14px 4px">${q ? 'No reseller matches this search.' : 'No resellers yet. Add one with the buttons above.'}</p>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Reseller</th><th>Contact</th><th>Orders</th><th>Credits</th><th>Paid</th><th>Since</th><th>Last order</th><th></th></tr></thead><tbody>${list.map((x) => `<tr data-act="rs-open" data-id="${x.id}" style="cursor:pointer">
    <td><b>${esc(x.rslId)}</b>${x.status === 'paused' ? '<div><span class="pill st-expired">paused</span></div>' : ''}${(x.requests || []).length ? `<div><span class="pill st-expiring" title="Ordered on the reseller dashboard">🛒 ${x.requests.length} order${x.requests.length > 1 ? 's' : ''} waiting</span></div>` : ''}${x.login ? `<div class="small muted" title="Has a dashboard login">🔑 /rsl${x.lastLogin ? ' · seen ' + fmtDate(x.lastLogin) : ''}</div>` : ''}</td>
    <td><div class="name-cell">${esc(x.name)}</div><div class="small muted">${esc([x.org, x.server, x.tag].filter(Boolean).join(' · '))}</div></td>
    <td class="small">${esc(x.email || '—')}${x.phone ? '<br>' + esc(x.phone) : ''}<div style="margin-top:4px">${sentChips(x, 'rs-mark')}</div></td>
    <td>${x.purchases}</td><td>${x.credits}</td><td><b>${usd(x.spentUsd)}</b>${x.rate ? `<div class="small muted">${usd(x.rate)}/credit</div>` : ''}</td>
    <td class="small">${fmtDate(x.joinedAt)}</td><td class="small">${fmtDate(x.lastAt)}</td>
    <td style="white-space:nowrap">${waBtn('rs-msg', x.id, (x.contact || {}).noWhatsapp || !x.phone ? 'disabled data-ch="wa"' : 'data-ch="wa"', (x.contact || {}).noWhatsapp ? 'Has no WhatsApp' : 'WhatsApp')} ${tgBtn('rs-msg', x.id, (x.contact || {}).noTelegram ? 'disabled data-ch="tg"' : 'data-ch="tg"', (x.contact || {}).noTelegram ? 'Has no Telegram' : 'Telegram')} ${x.email ? `<button class="btn sm" data-act="rs-email" data-id="${x.id}" title="Send an email">✉️</button><button class="btn sm" data-act="rs-appdl" data-id="${x.id}" title="Email the app download links (all devices)">📲</button>` : ''} ${x.phone && !/•/.test(x.phone) ? `<button class="btn sm" data-act="copy-text" data-text="${esc(x.phone)}" title="Copy phone number">📞</button>` : ''} <button class="btn sm" data-act="rs-copy" data-id="${x.id}" title="Copy details">📋</button> <button class="btn sm" data-act="rs-open" data-id="${x.id}" title="Edit everything">✎ Edit</button> <button class="btn sm danger" data-act="rs-del" data-id="${x.id}" title="Delete this reseller">🗑</button></td></tr>`).join('')}</tbody></table></div>`;
}
async function adminResellerPage() {
  const r = await api('GET', '/api/admin/reseller'); RS.data = r;
  const tot = r.list.reduce((a, x) => ({ c: a.c + x.credits, u: a.u + x.spentUsd, n: a.n + x.purchases }), { c: 0, u: 0, n: 0 });
  const found = r.found || []; const waiting = r.list.filter((x) => (x.requests || []).length);
  const growthCard = `<div class="card" style="margin-top:14px"><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;flex:1;min-width:220px">Sample reseller app &amp; proposed offers</h3><span class="pill st-expiring">Preview only</span></div>
    <p class="small muted">This shows what a sample reseller sees and previews the proposed promo rules. Nothing here is saved or applied to a real reseller.</p>
    ${resellerSampleHtml()}
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:12px">${Object.values(PROMOS).map((p) => `<button class="btn sm" data-act="promo-preview" data-id="${esc(p.id)}">${esc(p.title)}</button>`).join('')}</div></div>`;
  return `${waiting.length ? `<div class="card" style="border:2px solid #f59e0b;margin-bottom:14px"><h3 style="margin-top:0">🛒 Orders from the reseller dashboard (${waiting.reduce((a, x) => a + x.requests.length, 0)})</h3>${waiting.map((x) => x.requests.map((q) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name)}</b> <span class="muted small">${esc(x.rslId)}</span> · ${q.credits} credits (${esc(q.pkg)}) · ${esc(String(q.price))} ${esc(q.cur)} · ${esc(q.method || '')} · ${fmtDT(q.at)}${q.note ? `<div class="small muted">“${esc(q.note)}”</div>` : ''}</span><button class="btn sm primary" data-act="rs-sell" data-id="${x.id}" data-req="${q.id}" data-pkg="${esc(q.pkgId || '')}">✓ Paid · complete</button><button class="btn sm ghost" data-act="rs-req-x" data-id="${x.id}" data-req="${q.id}" title="Cancel this order">✕</button></div>`).join('')).join('')}</div>` : ''}<div class="stats">
    <div class="stat c-acc"><i class="st-ic">${ic('user', 20)}</i><span>Resellers</span><b>${r.list.length}</b></div>
    <div class="stat"><i class="st-ic">${ic('list', 20)}</i><span>Orders</span><b>${tot.n}</b></div>
    <div class="stat c-ok"><i class="st-ic">${ic('star', 20)}</i><span>Credits sold</span><b>${tot.c}</b></div>
    <div class="stat c-ok"><i class="st-ic">${ic('card', 20)}</i><span>Total paid</span><b>${usd(tot.u)}</b></div></div>
  ${growthCard}
  ${found.length ? `<div class="card"><div class="row"><h3 style="margin:0">🔎 Found in your data: ${found.length} reseller${found.length > 1 ? 's' : ''}</h3><span class="spacer"></span><button class="btn danger" data-act="rs-found-clear">✕ Delete all</button><button class="btn primary" data-act="rs-found-all">＋ Add all</button></div>
    <p class="small muted">These rows have “Reseller”, “RSL” or credits in them. Adding them moves them out of the customer list and into a reseller profile, each row as one order.</p>
    ${found.map((f, i) => `<div class="list-item"><div class="avatar">${esc(initials(f.name))}</div><div style="flex:1;min-width:0"><b>${esc(f.name)}</b>${f.into ? ` <span class="tagp">goes to ${esc(f.into.rslId)}</span>` : ''}<div class="small muted">${f.n} order${f.n > 1 ? 's' : ''} · ${usd(f.totalUsd)}${f.credits ? ' · ' + f.credits + ' credits' : ''} · ${esc(f.refs.slice(0, 4).join(', '))}${f.refs.length > 4 ? '…' : ''}</div><div class="small muted">${esc([f.email, f.phone].filter(Boolean).join(' · '))}</div></div><button class="btn sm" data-act="rs-found-add" data-i="${i}">＋ Add</button> <button class="btn sm danger" data-act="rs-found-skip" data-i="${i}" title="Not a reseller: remove from this box">✕</button></div>`).join('')}</div>` : ''}
  <div class="card"><div class="row" style="gap:8px"><input data-input="rs-q" value="${esc(RS.q)}" placeholder="🔍 Search name, RSL id, email, phone, server, order…" style="flex:1;min-width:200px" autocomplete="off">
    <button class="btn primary" data-act="rs-sell">🪙 New credit order</button><button class="btn" data-act="rs-new">＋ Add manually</button><button class="btn" data-act="rs-pick">👥 From my data</button><button class="btn" data-act="rs-text">📋 From text</button><button class="btn" data-act="rs-email" data-id="">✉️ Email resellers</button></div>
    <div id="rs-list" style="margin-top:12px">${rsRowsHtml()}</div></div>`;
}
const rsProfileForm = (x = {}) => `<form data-form="rs-profile" onsubmit="return false" data-id="${esc(x.id || '')}">
  <div class="grid2">${field('Name', 'name', x.name || '', { attrs: 'required' })}${field('Reseller ID', 'rslId', x.id ? x.rslId : '', { ph: 'Empty = next number (RSL-01…)' })}</div>
  <div class="grid2">${field('Email', 'email', x.email || '', { type: 'email', attrs: 'autocapitalize="none"' })}${field('More emails', 'emails', (x.emails || []).slice(1).join(', '), { ph: 'separate with a comma', attrs: 'autocapitalize="none"' })}</div>
  <div class="grid2">${field('Phone / WhatsApp', 'phone', x.phone || '', { type: 'tel', ph: '+66812345678' })}${field('Reseller since (date)', 'joined', rsDay(x.joinedAt), { type: 'date' })}</div>
  <div class="grid3">${field('Organization', 'org', x.org || '')}${field('Server', 'server', x.server || '', { ph: 'MEGA, DINO…' })}${field('Panel tag', 'tag', x.tag || '')}</div>
  <div class="grid3">${field('Telegram username', 'telegram', x.telegram || '', { ph: 'without @', attrs: 'autocapitalize="none"' })}${field('Panel URL (for the email)', 'panelUrl', x.panelUrl || '', { ph: 'https://…', attrs: 'autocapitalize="none"' })}${field('Language', 'lang', x.lang || 'en', { type: 'select', options: LANG5, help: 'Emails and the /rsl dashboard.' })}</div>
  <div class="grid3">${field('Currency', 'curOverride', x.curOverride || '', { type: 'select', options: [['', 'Automatic ($, € for Europe)'], ['USD', 'US dollar $'], ['EUR', 'Euro €']] })}</div>
  <div class="grid2">${field('Panel username', 'panelUser', x.panelUser || '', { attrs: 'autocapitalize="none" autocomplete="off"' })}${field('Panel password', 'panelPass', x.panelPass || '', { attrs: 'autocapitalize="none" autocomplete="off"' })}</div>
  <div class="grid2">${field('Status', 'status', x.status || 'active', { type: 'select', options: [['active', 'Active'], ['paused', 'Paused']] })}${field('Note', 'note', x.note || '')}</div>
  <div class="row"><button type="button" class="btn primary" data-act="rs-save">💾 Save</button>${x.id ? `<span class="spacer"></span><button type="button" class="btn danger" data-act="rs-del" data-id="${x.id}">Delete reseller</button>` : ''}</div></form>`;
function rsOpen(id) {
  const x = rsGet(id); if (!x) return;
  const wa = String(x.phone || '').replace(/\D/g, '');
  modal(`🤝 ${esc(x.rslId)} · ${esc(x.name)}`, `<div class="row" style="gap:6px;margin-bottom:10px"><span class="tagp">${x.purchases} orders</span><span class="tagp">${x.credits} credits</span><span class="tagp">${usd(x.spentUsd)}</span>${x.emailedAt ? `<span class="small muted">last email ${fmtDate(x.emailedAt)}</span>` : ''}<span class="spacer"></span>
    ${x.email ? `<button class="btn sm" data-act="rs-email" data-id="${x.id}">✉️ Email</button>` : ''}${wa && !/•/.test(x.phone) ? `<a class="btn sm wa-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}</div>
    <div class="card" style="margin-bottom:12px;padding:12px 14px"><div class="row" style="gap:6px;flex-wrap:wrap"><b style="flex:1">🔑 Dashboard login · intproto-tv.store/rsl</b><button class="btn sm primary" data-act="rs-sell" data-id="${x.id}">🪙 New credit order</button></div>
      ${x.login ? `<div class="small" style="margin-top:6px">Username <code>${esc(x.login.username)}</code> · Password <code>${esc(x.login.pass || '—')}</code>${x.lastLogin ? ` · last sign-in ${fmtDT(x.lastLogin)}` : ' · never signed in'}</div>` : '<div class="small muted" style="margin-top:6px">No login yet. It is made with the first order, or now with the button.</div>'}
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">${x.login ? `<button class="btn sm" data-act="rs-login" data-id="${x.id}" data-do="reset">🔑 New password</button>` : `<button class="btn sm" data-act="rs-login" data-id="${x.id}" data-do="make">🔑 Make login</button>`}${x.email ? `<button class="btn sm" data-act="rs-login" data-id="${x.id}" data-do="send">✉️ Send login email</button>` : ''}<label class="small row" style="gap:6px;margin-left:auto">Credits left on panel <input type="number" min="0" id="rs-left" value="${x.creditsLeft ?? ''}" placeholder="—" style="width:90px"><button class="btn sm" data-act="rs-login" data-id="${x.id}" data-do="left">Save</button></label></div>
      ${(x.requests || []).length ? `<div style="margin-top:8px">${x.requests.map((q) => `<div class="list-item small"><span style="flex:1">🛒 ${q.credits} credits · ${esc(q.method || '')} · ${fmtDT(q.at)}</span><button class="btn sm primary" data-act="rs-sell" data-id="${x.id}" data-req="${q.id}" data-pkg="${esc(q.pkgId || '')}">✓ Paid · complete</button></div>`).join('')}</div>` : ''}</div>
    ${rsProfileForm(x)}
    <div class="row" style="margin-top:16px"><h3 style="margin:0">Orders</h3><span class="spacer"></span><button class="btn sm" data-act="rs-order" data-id="${x.id}">＋ Add past order</button></div>
    ${x.orders.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Order</th><th>Package</th><th>Credits</th><th>Price</th><th>Server</th><th></th></tr></thead><tbody>${x.orders.map((o) => `<tr><td class="small">${fmtDate(o.at)}</td><td class="small">${esc(o.ref || '—')}</td><td class="small">${esc(o.pkg || '—')}${o.note ? `<div class="muted">${esc(o.note)}</div>` : ''}</td><td>${o.credits || '—'}</td><td><b>${rsMoney(o)}</b></td><td class="small">${esc(o.server || '')}</td><td style="white-space:nowrap"><button class="btn sm" data-act="rs-order" data-id="${x.id}" data-oid="${o.id}">✎</button> <button class="btn sm danger" data-act="rs-order-del" data-id="${x.id}" data-oid="${o.id}">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No orders yet.</p>'}`, { wide: true });
}
async function rsReload(openId) { closeModal(); await renderAdmin(); if (openId) rsOpen(openId); }
function rsPickHtml() {
  const q = RS.pq.trim().toLowerCase(); const foundIds = new Set((RS.data?.found || []).flatMap((f) => f.ids));
  let list = (RS.customers || []).filter((c) => !c.rsOrder);
  list = q ? list.filter((c) => q.split(/\s+/).every((w) => [c.name, c.email, c.phone, c.whatsapp, c.orderNo, c.username, c.note].join(' ').toLowerCase().includes(w))) : list.filter((c) => foundIds.has(c.id) || RS.pick.has(c.id));
  if (!list.length) return `<p class="muted small" style="padding:10px 2px">${q ? 'Nothing matches.' : 'Type a name, email, phone or order number to search all your data.'}</p>`;
  return list.slice(0, 80).map((c) => `<label class="list-item" style="cursor:pointer"><input type="checkbox" data-rs-pick="${c.id}" ${RS.pick.has(c.id) ? 'checked' : ''} style="width:auto"><div style="flex:1;min-width:0"><b>${esc(c.name)}</b> <span class="tagp">${esc(c.orderNo || c.username)}</span>${foundIds.has(c.id) ? ' <span class="pill st-expiring">reseller</span>' : ''}<div class="small muted">${esc([c.email, c.phone, c.price ? '$' + c.price : '', fmtDate(c.startAt || c.createdAt)].filter(Boolean).join(' · '))}</div></div></label>`).join('') + (list.length > 80 ? `<p class="small muted">${list.length - 80} more — type more letters.</p>` : '');
}
function rsParsedHtml() {
  const ps = RS.parsed || [];
  if (!ps.length) return '<div class="notice warning">No reseller found in this text. Each reseller needs a name with an email or a phone number.</div>';
  return `<p class="small muted">${ps.length} reseller${ps.length > 1 ? 's' : ''} found. Untick the ones you do not want, fix a name if needed, then add.</p>${ps.map((p, i) => `<div class="list-item" style="align-items:flex-start"><input type="checkbox" data-rs-p="${i}" checked style="width:auto;margin-top:8px"><div style="flex:1;min-width:0"><input data-rs-name="${i}" value="${esc(p.name)}" style="font-weight:700"><div class="small muted" style="margin-top:4px">${esc([p.rslId, p.emails.join(', '), p.phone, p.org, p.server, p.tag].filter(Boolean).join(' · ') || 'no contact details')}</div>${p.orders.map((o) => `<div class="small">• ${esc([o.ref, rsDay(o.at), o.pkg, o.amount ? rsMoney({ ...o, currency: o.currency || 'USD' }) : ''].filter(Boolean).join(' · '))}</div>`).join('')}</div></div>`).join('')}
  <div class="row" style="margin-top:10px"><button class="btn primary" data-act="rs-text-add">＋ Add these resellers</button></div>`;
}
function rsEmailForm(id) {
  const x = id ? rsGet(id) : null; const tp = RS.data?.emailTpl || {}; const n = (RS.data?.list || []).filter((r) => r.email && r.status !== 'paused').length;
  const link = tp.link || ''; const sel = ['', 'site', 'contact', 'app'].includes(link) ? link : 'url';
  return `<form data-form="rs-mail" onsubmit="return false" data-id="${esc(id || '')}">
    <p class="small">${x ? `To: <b>${esc(x.name)}</b> &lt;${esc(x.email || 'no email')}&gt;` : `To: <b>all active resellers with an email</b> (${n})`}</p>
    ${field('Subject', 'subject', tp.subject || '', { ph: 'e.g. New credit prices for {rsl}' })}${field('Title in the email (optional)', 'title', tp.title || '')}
    ${field('Message', 'body', tp.body || '', { type: 'textarea', rows: 8, ph: 'Hello {name}, …' })}
    <p class="small muted" style="margin-top:-6px">You can use: {name} {fullname} {rsl} {url} {username} {password} {credits} {orders} {spent} {last} {org} {server}. *text* = bold. Empty line = new paragraph.</p>
    <div class="grid3">${field('Button text (optional)', 'button', tp.button || '')}${field('Button opens', 'linkSel', sel, { type: 'select', options: [['', 'No button'], ['site', 'Your website'], ['contact', 'Contact / WhatsApp'], ['app', 'The app'], ['url', 'A link…']] })}${field('Link', 'linkUrl', sel === 'url' ? link : '', { ph: 'https://…', attrs: 'autocapitalize="none"' })}</div>
    <div class="row"><button type="button" class="btn" data-act="rs-mail-pv">👁 Preview</button><button type="button" class="btn" data-act="rs-mail-save">💾 Save as my template</button><span class="spacer"></span><button type="button" class="btn primary" data-act="rs-mail-send">📨 Send</button></div>
    <iframe id="rs-mail-frame" sandbox="" style="width:100%;height:50vh;border:0;border-radius:12px;background:#f4f7fa;display:none;margin-top:10px"></iframe></form>`;
}
const rsMailBody = () => { const f = $('[data-form=rs-mail]'); const d = Object.fromEntries(new FormData(f)); return { subject: d.subject, title: d.title, body: d.body, button: d.button, link: d.linkSel === 'url' ? d.linkUrl : d.linkSel, ...(f.dataset.id ? { ids: [f.dataset.id] } : { all: true }), appUrl: location.origin }; };
document.addEventListener('input', (e) => {
  const t = e.target; if (!t.dataset) return;
  if (t.dataset.input === 'rs-q') { RS.q = t.value; const el = $('#rs-list'); if (el) el.innerHTML = rsRowsHtml(); }
  if (t.dataset.input === 'rs-pq') { RS.pq = t.value; const el = $('#rs-pick-list'); if (el) el.innerHTML = rsPickHtml(); }
});
document.addEventListener('change', (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.rsPick) return;
  if (t.checked) RS.pick.add(t.dataset.rsPick); else RS.pick.delete(t.dataset.rsPick);
  const b = $('#rs-pick-go'); if (b) b.textContent = `＋ Add ${RS.pick.size} row${RS.pick.size === 1 ? '' : 's'} as reseller`;
});

function adminCustomerProfile(c) {
  if (!c) return null;
  const s = state.admin.settings;
  const tier = spendTier(c.totalPaidUsd);
  const renewals = (c.renewals || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const mC = {};
  for (const r of renewals) { const d = new Date(r.at); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); mC[k] = (mC[k] || 0) + 1; }
  const months = Object.entries(mC).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-12);
  const maxM = Math.max(1, ...months.map(([, n]) => n));
  const pName = (r) => (s.plans || []).find((p) => p.id === r.planId)?.name || (r.planId === 'trial' ? 'Trial' : r.planId === 'custom' ? 'Custom' : r.planId);
  const row = (r) => `<tr><td class="small">${fmtDT(r.at)}</td><td>${esc(pName(r))}</td><td class="small muted">${esc(r.type || 'renew')}</td><td>${Number(r.price || 0).toFixed(2)}</td><td>${r.credits ?? ''}</td></tr>`;
  const contacts = [
    c.email ? `<div class="ilist"><span class="svc-l">Email</span><b dir="ltr" style="word-break:break-all;font-size:.9rem">${esc(c.email)}${c.emailVerified ? ' <span class="pill st-active" style="font-size:.68rem">✓ verified</span>' : ''}</b><button class="btn sm ghost svc-c" data-act="copy-text" data-text="${esc(c.email)}" aria-label="Copy email">⧉</button></div>` : '',
    c.phone ? `<div class="ilist"><span class="svc-l">Phone</span><b dir="ltr">${esc(c.phone)}</b><button class="btn sm ghost svc-c" data-act="copy-text" data-text="${esc(c.phone)}" aria-label="Copy phone">⧉</button></div>` : '',
    c.whatsapp && c.whatsapp !== c.phone ? `<div class="ilist"><span class="svc-l">WhatsApp</span><b dir="ltr">${esc(c.whatsapp)}</b><button class="btn sm ghost svc-c" data-act="copy-text" data-text="${esc(c.whatsapp)}" aria-label="Copy WhatsApp">⧉</button></div>` : '',
    c.telegram ? `<div class="ilist"><span class="svc-l">Telegram</span><b dir="ltr">@${esc(String(c.telegram).replace(/^@/, ''))}</b><button class="btn sm ghost svc-c" data-act="copy-text" data-text="${esc(String(c.telegram).replace(/^@/, ''))}" aria-label="Copy Telegram">⧉</button></div>` : '',
    c.macAddress ? `<div class="ilist"><span class="svc-l">MAC</span><b dir="ltr">${esc(c.macAddress)}</b><button class="btn sm ghost svc-c" data-act="copy-text" data-text="${esc(c.macAddress)}" aria-label="Copy MAC">⧉</button></div>` : '',
    c.deviceApp ? `<div class="ilist"><span class="svc-l">Device</span><b>${esc(c.deviceApp)}</b></div>` : '',
    c.country ? `<div class="ilist"><span class="svc-l">Country</span><b>${countryFlag(c.country)} ${esc(c.country)}</b></div>` : '',
    c.paymentMethod ? `<div class="ilist"><span class="svc-l">Payment</span><b>${esc(c.paymentMethod)}</b></div>` : '',
    c.rslId ? `<div class="ilist"><span class="svc-l">Reseller</span><b>${esc(c.rslId)}</b></div>` : '',
  ].filter(Boolean).join('');
  const st = c.stream || {};
  const cDns = String(c.dns || st.dns || '').replace(/\/+$/, '');
  const cU = st.u || c.lineUsername || '';
  const cP = st.p || c.linePassword || '';
  const m3u = String(c.m3u || '').trim() || (cDns && cU ? (cDns + '/get.php?username=' + encodeURIComponent(cU) + '&password=' + encodeURIComponent(cP || '') + '&type=m3u_plus&output=ts') : '');
  const ibo = c.ibo || null;
  const hasIbo = !!(ibo && (ibo.mac || ibo.key));
  const iboHtml = hasIbo ? (svcRow('Device MAC Address', ibo.mac || '—', 'mac') + svcRow('Device Key', ibo.key || '—', 'key')) : '';
  const svcRow = (label, value, key) => `<div class="svc-row"><span class="svc-l">${esc(label)}</span><b class="svc-v" dir="ltr">${esc(value)}</b><button class="btn sm ghost svc-c" data-act="copy-el" data-el="cp-${key}" aria-label="Copy ${esc(label)}">⧉</button><div id="cp-${key}" style="display:none">${esc(value)}</div></div>`;
  return `<div class="prof">
  <button class="btn ghost" data-act="back-list" style="margin-bottom:12px">← Back to customers</button>
  <div class="prof-grid">
    <div class="card prof-side">
      <div class="prof-id"><div class="avatar xl">${esc(initials(c.name))}</div><div><h2 style="margin:0">${esc(c.name)}</h2><div class="muted">${esc(c.username)}${c.orderNo ? ' · 🧾 ' + esc(c.orderNo) : ''}${orderAt(c) ? ' · ordered ' + fmtDate(orderAt(c)) : ''}</div>${(() => { const dv = orderDevices(c); const o = parseOrderNo(c.orderNo); const same = o.num !== null ? state.admin.customers.filter((x) => x.id !== c.id && parseOrderNo(x.orderNo).main.toLowerCase() === o.main.toLowerCase()) : [];
        return (dv.length > 1 ? `<div class="small" style="margin-top:6px">${dv.map((d) => `<span class="tagp">${esc(d)}</span>`).join(' ')}</div>` : '') + (same.length ? `<div class="small" style="margin-top:6px">Same order ${esc(o.main)}: ${same.map((x) => `<button class="name-link" data-act="view-customer" data-id="${x.id}">${esc(x.name)} (${esc(x.orderNo)})</button>`).join(', ')}</div>` : ''); })()}<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${pill(c.state)}${tier[0] !== 'Regular' ? `<span class="pill ${tier[1]}">${tier[0]}</span>` : ''}${c.isReseller ? `<span class="pill st-expiring">${esc(c.rslId || 'RSL')}</span>` : ''}${c.statusFlag === 'dispute' ? '<span class="pill st-expired">dispute</span>' : c.statusFlag === 'excellent' ? '<span class="pill st-active">excellent</span>' : ''}${c.isTrial ? '<span class="pill st-expiring">trial</span>' : ''}</div></div></div>
      <div class="prof-sub"><div><span class="dp-l">Plan</span><b>${esc(c.planName)}</b></div><div><span class="dp-l">Devices</span><b>${esc(c.connections)}</b></div><div><span class="dp-l">Started</span><b>${c.startAt ? fmtDate(c.startAt) : '—'}</b></div><div><span class="dp-l">Expires</span><b>${c.expiresAt ? (c.noExpiry ? '♾ No end date' : fmtDate(c.expiresAt)) : '—'}</b></div></div>
      <div style="margin-top:10px">${progress(c)}<div class="small muted" style="margin-top:6px">${c.state === 'expired' ? Math.abs(c.daysLeft) + ' days expired' + (c.lastLogin ? ' · last login ' + fmtDT(c.lastLogin) : '') : c.daysLeft + ' days left'}</div></div>
      <div class="row" style="margin-top:14px"><h3 style="margin:0">Connection details</h3><span class="spacer"></span><button class="btn sm primary" data-act="paid-line" data-perm="customers_edit" data-id="${c.id}">📺 ${hasIbo ? 'Edit M3U / IBO' : 'Assign M3U / IBO'}</button></div>
      <div class="svc-box" style="margin-top:6px">${svcRow('Username', cU || '—', 'u')}${svcRow('Password', cP || '—', 'p')}${cDns ? svcRow('DNS', cDns, 'dns') : ''}${m3u ? svcRow('M3U', m3u, 'm3u') : ''}${iboHtml}<p class="small muted" style="margin:8px 2px 0">Paste the panel M3U once — it fills the four <b>My Details</b> fields on the customer's paid profile. IBO Player: save the Device MAC Address and Device Key here; the customer sees them under My Details on intproto-tv.store/profile.</p></div>
      <h3 style="margin-top:14px">Contact</h3>
      <div class="prof-contacts">${contacts || '<p class="small muted">No contact details on file.</p>'}</div>
      ${c.callNotes ? `<h3 style="margin-top:14px">Call notes</h3><p class="small" style="white-space:pre-wrap">${esc(c.callNotes)}</p>` : ''}
      ${c.note ? `<h3 style="margin-top:14px">Internal notes</h3><p class="small" style="white-space:pre-wrap">${esc(c.note)}</p>` : ''}
    </div>
    <div class="prof-main">
      <div class="stats">
        <div class="stat c-acc"><i class="st-ic">${ic('card', 20)}</i><span>All-time paid</span><b>$${Number(c.totalPaidUsd || 0).toFixed(2)}</b><span>${renewals.length} renewal${renewals.length === 1 ? '' : 's'}</span></div>
        <div class="stat"><i class="st-ic">${ic('clock', 20)}</i><span>Days subscribed</span><b>${Math.max(0, Math.round(((c.expiresAt || 0) - (c.startAt || 0)) / 86400000))}</b><span>lifetime</span></div>
        <div class="stat"><i class="st-ic">${ic('crown', 20)}</i><span>Paid renewals</span><b>${renewals.filter((r) => (r.price || 0) > 0).length}</b><span>${tier[0]}</span></div>
        <div class="stat"><i class="st-ic">${ic('tv', 20)}</i><span>Credits used</span><b>${renewals.reduce((a, r) => a + (Number(r.credits) || 0), 0)}</b><span>all time</span></div>
      </div>
      ${months.length ? `<div class="card"><h3>Renewals per month</h3><div class="bars">${months.map(([k, n]) => `<div><span>${n}</span><i style="height:${(n / maxM) * 100}%"></i><span>${k.slice(5)}/${k.slice(2, 4)}</span></div>`).join('')}</div></div>` : ''}
      <div class="card"><div class="row"><h3 style="margin:0">Purchase history <span class="small muted">(${renewals.length})</span></h3><span class="spacer"></span></div><div class="row" style="margin:8px 0 0;flex-wrap:wrap">${custActions(c)}</div>${renewals.length ? `<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Date</th><th>Plan</th><th>Type</th><th>Amount</th><th>Credits</th></tr></thead><tbody>${renewals.map(row).join('')}</tbody></table></div>` : '<p class="muted">No purchases yet.</p>'}</div>
    </div>
  </div>
  </div>`;
}

// Last calendar month in Bangkok time (UTC+7): [from, to)
function lastMonthRange(back = 1) { const TZ = 7 * 3600000; const n = new Date(Date.now() + TZ); const from = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - back, 1) - TZ; const to = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - back + 1, 1) - TZ; const d = new Date(from + TZ); return { from, to, key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }; }
const custUpdated = (c) => Number(c.updatedAt) || 0;
const custFilterOk = (c, f) => f === 'all' || c.state === f || (f === 'trial' && c.isTrial) || (f === 'request' && c.buyRequest && !c.buyRequest.answeredAt) || (f === 'lastmonth' && (() => { const r = lastMonthRange(state.admin.nmBack || 1); return c.createdAt >= r.from && c.createdAt < r.to; })());
const CUST_SORTS = [['order', 'Order number · oldest first'], ['order-new', 'Order number · newest first'], ['updated', 'Updated first, old records last'], ['expiry', 'Ending soonest']];
let rankCache = { list: null, map: null };
const custRanks = () => { const l = state.admin.customers; if (rankCache.list !== l) rankCache = { list: l, map: orderRanks(l, state.admin.settings) }; return rankCache.map; };
const byRank = (a, b) => { const r = custRanks(); return (r.get(a.id) ?? 0) - (r.get(b.id) ?? 0); };
function filteredCustomers() {
  const { filter, q } = state.admin; if (!state.admin.custSort) { try { state.admin.custSort = localStorage.getItem('tvp_cust_sort') || ''; } catch {} } const sort = CUST_SORTS.some((x) => x[0] === state.admin.custSort) ? state.admin.custSort : 'order';
  const qq = q.trim().toLowerCase();
  return state.admin.customers
    .filter((c) => custFilterOk(c, filter))
    .filter((c) => !qq || [c.name, c.username, c.phone, c.lineUsername, c.note, c.email, c.email2, c.whatsapp, c.telegram, c.macAddress, c.orderNo, c.country].some((x) => String(x || '').toLowerCase().includes(qq)))
    .sort((a, b) => sort === 'expiry' ? a.expiresAt - b.expiresAt : sort === 'order' ? byRank(a, b) : sort === 'order-new' ? byRank(b, a) : (custUpdated(b) - custUpdated(a)) || byRank(b, a));
}
// "Updated 17 Nov 2026" for records edited in the new system; old records show when they were added.
const updTag = (c) => custUpdated(c) ? `<span class="small" style="color:#16a34a" title="Last change saved in the dashboard">✓ Updated ${fmtDate(c.updatedAt)}</span>` : `<span class="small muted" title="Not updated since the migration">Old record · added ${fmtDate(c.createdAt)}</span>`;
// 24-hour auto-reset contact checkboxes (spec §4): a mark expires 24h after it was made, for the daily follow-up routine.
const contactedRecently = (ts) => ts && Date.now() - ts < 24 * 3600000;
// Brand marks for the WhatsApp and Telegram buttons come from the Simple Icons library (falls back to text if it cannot load).
const brandImg = (n, alt) => `<img class="brand-ic" src="https://cdn.jsdelivr.net/npm/simple-icons@13/icons/${n}.svg" alt="${alt}" width="16" height="16" loading="lazy" onerror="this.replaceWith(document.createTextNode('${alt}'))">`;
const waBtn = (act, id, extra = '', title = 'Send a WhatsApp message') => `<button class="btn sm brand-btn wa" data-act="${act}" data-id="${id}" ${extra} title="${title}" aria-label="${title}">${brandImg('whatsapp', 'WA')}</button>`;
const tgBtn = (act, id, extra = '', title = 'Send a Telegram message') => `<button class="btn sm brand-btn tg" data-act="${act}" data-id="${id}" ${extra} title="${title}" aria-label="${title}">${brandImg('telegram', 'TG')}</button>`;
// The ✓ Sent marks: set automatically when you send (or by tapping), cleared after 24 hours. "No WhatsApp / No Telegram" marks stay until you remove them.
const sentChips = (o, act) => {
  const ct = o.contact || {};
  const chip = (k, label) => { const no = k !== 'email' && ct['no' + k[0].toUpperCase() + k.slice(1)]; const on = !no && contactedRecently(ct[k]); return `<button class="sent-chip ${no ? 'no' : on ? 'on' : ''}" data-act="${act}" data-id="${o.id}" data-k="${k}" title="${no ? 'Has no ' + label : on ? label + ' sent ' + fmtDT(ct[k]) + ' · clears after 24h' : label + ' not sent today'}">${label} ${no ? '✕' : on ? '✓' : '·'}</button>`; };
  return `<span class="sent-chips">${chip('email', 'Email')}${chip('whatsapp', 'WhatsApp')}${chip('telegram', 'Telegram')}</span>`;
};
async function custRefresh() { try { state.admin.customers = await api('GET', '/api/admin/customers'); const el = $('#cust-list'); if (el) el.innerHTML = customerListHtml(); } catch {} }
const contactChecks = (c) => (can('customers_edit') ? sentChips(c, 'contact-menu') : '');
// ---- which device the customer uses (Samsung, iPhone…) ----
const DEV_IC = { phone: '📱', tablet: '📲', tv: '📺', computer: '💻' };
const devLabelOf = (d) => (d ? `${d.name}${d.model && !d.name.includes(d.model) && d.brand !== 'Apple' ? ' ' + d.model : ''}` : '');
const devPill = (c) => { const d = c.lastDevice; if (!d) return ''; const all = (c.devicesSeen || []).map((x) => `${DEV_IC[x.kind] || '📱'} ${devLabelOf(x)}${x.os ? ' · ' + x.os : ''} · last ${fmtDT(x.last)}`).join('\n');
  return `<span class="pill ${d.brand === 'Samsung' ? 'dev-samsung' : d.brand === 'Apple' ? 'dev-apple' : ''}" title="${esc(all || devLabelOf(d))}">${d.brand === 'Apple' ? '' : DEV_IC[d.kind] || '📱'} ${esc(d.brand === 'Samsung' ? 'Samsung' : d.name === 'iPhone' || d.name === 'iPad' ? d.name : d.name)}</span>`; };
const endTxt = (c) => (c.noExpiry ? 'No end date' : `${new Date(c.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`);
const toLocalInput = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
function expModal(c) {
  modal(`📅 End date · ${esc(c.name || c.username)}`, `<form data-form="exp" data-id="${c.id}">
    <p style="margin-top:0">Now: <b>${esc(endTxt(c))}</b> <span class="muted small">(${c.noExpiry ? 'unlimited' : esc(leftTxt(c))})</span></p>
    <div class="grid2" style="align-items:end">${field('New end date and time', 'when', toLocalInput(c.noExpiry ? Date.now() + 30 * 86400000 : c.expiresAt), { type: 'datetime-local' })}<button class="btn primary" data-do="set">💾 Save this date</button></div>
    <p class="small muted" style="margin:10px 0 6px">Quick change (from the current end, or from today if it already ended):</p>
    <div class="row" style="gap:6px;flex-wrap:wrap">${[[1, '+1 day'], [7, '+7 days'], [30, '+30 days'], [90, '+3 months'], [365, '+1 year'], [-1, '−1 day'], [-7, '−7 days']].map(([d, l]) => `<button type="button" class="btn sm" data-act="exp-add" data-days="${d}">${l}</button>`).join('')}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:12px"><button type="button" class="btn sm danger" data-act="exp-now">⏹ End it now</button><button type="button" class="btn sm" data-act="exp-none">♾ No end date</button></div>
    ${(c.expiryLog || []).length ? `<details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Changes (${c.expiryLog.length})</summary>${c.expiryLog.map((x) => `<div class="small">${fmtDT(x.at)} · ${esc(x.by || '')}: ${x.from > 4070908800000 ? 'no end date' : fmtDT(x.from)} → ${x.to > 4070908800000 ? 'no end date' : fmtDT(x.to)}</div>`).join('')}</details>` : ''}
  </form>`);
}
async function expDo(id, body) {
  try { const r = await api('POST', `/api/admin/customers/${id}/expiry`, body); const i = state.admin.customers.findIndex((x) => x.id === id); if (i >= 0) state.admin.customers[i] = { ...state.admin.customers[i], ...r.customer };
    toast('End date: ' + endTxt(r.customer)); closeModal(); renderAdmin(); } catch (e) { toast(e.message, true); }
}
function noteModal(c) {
  modal(`🔔 Notification in the app${c ? ' · ' + esc(c.name || c.username) : ''}`, `<form data-form="note-send">${c ? `<input type="hidden" name="id" value="${c.id}"><input type="hidden" name="audience" value="one">` : field('Who', 'audience', 'all', { type: 'select', options: [['all', 'All customers'], ['active', 'Active subscriptions'], ['expiring', 'Expiring soon'], ['expired', 'Expired'], ['trials', 'Free trials']] })}
    ${field('Title', 'title', '', { attrs: 'required maxlength="120"', ph: 'Server maintenance tonight' })}
    ${field('Message', 'body', '', { type: 'textarea', rows: 3, attrs: 'maxlength="600"' })}
    <p class="small muted">It appears in the customer's app under 🔔 Notifications, and on their phone too if they turned notifications on.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn primary">Send</button></div></form>`);
}
function custActions(c) {
  return `${contactChecks(c)}${c.statusFlag === 'dispute' ? '<span class="pill st-expired" title="Flagged: Dispute">⚠️</span>' : ''}${can('customers_phone') && c.phone ? `<button class="btn sm" data-act="copy-text" data-text="${esc(String(c.phone))}" title="Copy phone number" aria-label="Copy phone number">📞</button>` : ''}${c.lineBad ? `<span class="pill st-expired" title="Last checked ${c.panel ? fmtDT(c.panel.at) : ''}">📡 ${esc(c.lineBad)}</span>` : ''}${c.emailBad ? `<span class="pill st-expired" title="Emails to ${esc(c.email)} are paused: the address ${esc(c.emailBad)}. Edit the customer to correct it.">✉️ ${esc(c.emailBad === 'bounced' ? 'email bounced' : 'marked spam')}</span>` : ''}<button class="btn sm primary" data-act="renew" data-perm="customers_edit" data-id="${c.id}">Renew</button>
    <button class="btn sm" data-act="exp-open" data-perm="customers_edit" data-id="${c.id}" title="Expiry date: add, change, end or remove">📅 Expiry</button><button class="btn sm" data-act="note-one" data-perm="customers_edit" data-id="${c.id}" title="Send a notification in the customer's app">🔔 Notify</button>
    <button class="btn sm" data-act="edit-customer" data-perm="customers_edit" data-id="${c.id}">Edit</button>
    <button class="btn sm" data-act="toggle-customer" data-perm="customers_edit" data-id="${c.id}">${c.status === 'disabled' ? 'Enable' : 'Disable'}</button>
    ${can('customers_edit') ? waBtn('wa-one', c.id, (c.contact || {}).noWhatsapp ? 'disabled' : '', (c.contact || {}).noWhatsapp ? 'Has no WhatsApp' : 'Send a WhatsApp message') + tgBtn('tg-one', c.id, (c.contact || {}).noTelegram ? 'disabled' : '', (c.contact || {}).noTelegram ? 'Has no Telegram' : 'Send a Telegram message') : ''}
    ${c.email ? `<button class="btn sm" data-act="mail-menu" data-perm="customers_edit" data-id="${c.id}" title="Send an email" aria-label="Send an email">✉️ ▾</button>` : ''}
    <button class="btn sm" data-act="copy-login" data-perm="customers_view" data-id="${c.id}" title="Copy login details" aria-label="Copy login details">📋</button>
    ${c.twoFactor ? `<button class="btn sm" data-act="cust-tfa-off" data-perm="customers_edit" data-id="${c.id}" title="Two-step sign-in is on. Tap to turn it off (lost phone)." aria-label="Turn off two-step sign-in">🔐</button>` : ''}
    <button class="btn sm" data-act="chat-with" data-id="${c.id}" title="Open the live chat with this customer" aria-label="Live chat">🗨</button>
    <button class="btn sm danger" data-act="del-customer" data-perm="customers_delete" data-id="${c.id}" title="Delete customer" aria-label="Delete customer">🗑</button>`;
}
function customerListHtml() {
  const all = filteredCustomers();
  if (!all.length) return `<div class="empty"><span class="ic">👥</span>No customers here yet.</div>`;
  const lim = state.admin.custLimit || 60;
  const list = all.slice(0, lim);
  const more = all.length > lim ? `<div style="text-align:center;margin:14px"><button class="btn" data-act="cust-more">Show more (${all.length - lim} left)</button></div>` : '';
  const narrow = matchMedia('(max-width: 760px)').matches;
  if (narrow) return `<div class="cust-cards" style="display:block">${list.map((c) => `<div class="cc"><div class="row"><div class="avatar">${esc(initials(c.name))}</div><div style="flex:1;min-width:0"><button class="name-link" data-act="view-customer" data-id="${c.id}" style="font-size:1.02rem">${esc(c.name)}</button>${orderChip(c)}${connChip(c)}${devPill(c)}<div class="small muted">${esc(c.username)} · ${esc(c.planName)}${c.email ? ' · ' + esc(c.email) : ''}</div></div>${pill(c.state)}</div>
      <div class="small muted" style="margin:10px 0 6px">Expires ${(c.noExpiry ? '♾ No end date' : fmtDate(c.expiresAt))} · ${c.daysLeft >= 0 ? c.daysLeft + ' days left' : 'expired'}</div><div style="margin:-2px 0 6px">${updTag(c)}</div>${progress(c)}<div class="row" style="margin-top:12px">${custActions(c)}</div></div>`).join('')}</div>${more}`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Login</th><th>Plan</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.isTrial ? ' <span class="pill st-expiring">trial</span>' : ''}${orderChip(c)}${connChip(c)}${devPill(c)}${spendTier(c.totalPaidUsd)[0] !== 'Regular' ? ' <span class="pill ' + spendTier(c.totalPaidUsd)[1] + '" title="Lifetime spend $${Number(c.totalPaidUsd||0).toFixed(2)}">' + spendTier(c.totalPaidUsd)[0] + '</span>' : ''}${c.country ? ' <span class="tagp" title="' + esc(c.country) + '">' + countryFlag(c.country) + ' ' + esc(c.country) + '</span>' : ''}${c.statusFlag === 'dispute' ? ' <span class="pill st-expired" title="Flagged: Dispute">dispute</span>' : c.statusFlag === 'excellent' ? ' <span class="pill st-active" title="Flagged: Excellent">excellent</span>' : ''}${c.buyRequest && !c.buyRequest.answeredAt ? ` <span class="pill st-active" title="Requested ${esc(c.buyRequest.title || '')}">🛒 ${esc(c.buyRequest.title || 'request')}</span>` : ''}<div class="small muted">${esc(c.phone)}${c.email ? ' · ' + esc(c.email) : ''}</div></td><td>${esc(c.username)}${c.lineId ? `<div class="small muted">line #${esc(c.lineId)}</div>` : ''}</td><td>${esc(c.planName)}<div class="small muted">${c.connections} device${c.connections > 1 ? 's' : ''}</div></td>
      <td>${(c.noExpiry ? '♾ No end date' : fmtDate(c.expiresAt))}<div>${updTag(c)}</div><div class="small muted">${leftTxt(c)}</div>${progress(c)}</td><td>${pill(c.state)}</td><td><div class="row" style="justify-content:flex-end">${custActions(c)}</div></td></tr>`).join('')}
    </tbody></table></div>${more}`;
}
function adminCustomers() {
  const a = state.admin;
  const counts = (st) => a.customers.filter((c) => custFilterOk(c, st)).length;
  return `<div class="row" style="margin-bottom:14px"><input style="flex:1;min-width:200px" placeholder="🔎 Search name, username, phone, order…" value="${esc(a.q)}" data-input="cust-search"><button class="btn" data-act="orders-open" title="Order numbers, duplicates and backups">🧾 Order numbers</button><button class="btn" data-act="sync-panel" data-perm="customers_edit" title="Checks every line on your panel and updates end dates, devices and broken lines">🔄 Sync with panel</button><button class="btn primary" data-act="new-customer" data-perm="customers_edit">＋ Add customer</button><button class="btn" data-act="export-xlsx" data-perm="exports">⬇ Excel</button><button class="btn" data-act="renewal-bulk" data-perm="marketing">🔁 Renewal emails</button><button class="btn" data-act="order-bulk" data-perm="marketing">💳 Package emails</button><button class="btn" data-act="order-custom" data-perm="marketing">✍️ Custom email</button><button class="btn" data-act="nl-open" data-perm="marketing">📣 Newsletter</button><button class="btn" data-act="appdl-bulk" data-perm="marketing">📲 App email</button></div>
    <div class="chips">${['all', 'active', 'expiring', 'expired', 'disabled', 'trial', 'request', 'lastmonth'].map((f) => `<a class="${a.filter === f ? 'on' : ''}" data-act="cust-filter" data-f="${f}">${f === 'request' ? '🛒 requests' : f === 'lastmonth' ? '📅 ' + ((a.nmBack ?? 1) === 1 ? 'Last month' : lastMonthRange(a.nmBack).label) : f} (${counts(f)})</a>`).join('')}</div>
    <div class="row" style="margin:-4px 0 12px;gap:8px"><span class="small muted">Order:</span><select data-input="cust-sort" style="width:auto">${CUST_SORTS.map(([k, l]) => `<option value="${k}" ${(CUST_SORTS.some((x) => x[0] === a.custSort) ? a.custSort : 'order') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${a.filter === 'lastmonth' ? `<div id="nm-stats" class="card" style="margin-bottom:14px"><p class="muted" style="margin:0">Loading new customers…</p></div>` : ''}
    <div id="cust-list">${customerListHtml()}</div>`;
}

// New customers of the chosen month: sign-ups, what they bought, balance status and whether their details were sent.
async function nmStats() {
  const box = $('#nm-stats'); if (!box) return; const r0 = lastMonthRange(state.admin.nmBack || 1);
  let d; try { d = await api('GET', `/api/admin/customers/newstats?month=${r0.key}`); } catch (e) { box.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; return; }
  const stat = (n, l, sub = '') => `<div style="flex:1;min-width:120px;background:var(--soft,rgba(148,163,184,.12));border-radius:12px;padding:10px 12px"><div class="small muted">${l}</div><b style="font-size:1.6rem">${n}</b>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
  const bar = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="tagp">${esc(k)} · <b>${v}</b></span>`).join(' ') || '<span class="small muted">—</span>';
  const mark = (on, no, l) => no ? `<span title="No ${l}" style="opacity:.5">🚫</span>` : on ? `<span title="${l} sent" style="color:#16a34a">✓</span>` : `<span title="${l} not sent" class="muted">·</span>`;
  const pct = (n) => d.total ? Math.round(n / d.total * 100) + '%' : '0%';
  box.innerHTML = `<div class="row" style="gap:6px;margin-bottom:10px"><button class="btn sm" data-act="nm-month" data-d="1" title="Month before">‹</button><h3 style="margin:0;flex:1;text-align:center">🆕 New customers · ${esc(r0.label)}</h3><button class="btn sm" data-act="nm-month" data-d="-1" ${(state.admin.nmBack || 1) <= 0 ? 'disabled' : ''} title="Next month">›</button></div>
    <div class="row" style="gap:8px;flex-wrap:wrap">${stat(d.total, 'New sign-ups', `${d.paid} paid · ${d.trials} trials`)}${stat(d.standard.count, 'Standard packages', `${d.devices} devices · ${d.multi} with several lines`)}${stat(d.reseller.credits, 'Reseller credits', `${d.reseller.orders} orders · ${d.reseller.newResellers} new resellers${d.reseller.amount ? ' · ' + d.reseller.amount : ''}`)}${stat(d.ibo.activations, 'IBO Player activations', `${d.ibo.panel} on IBO panel · ${d.ibo.onCustomers} on customers`)}</div>
    ${(() => { const r = d.retention, m = r.month; return `<div style="margin-top:12px;border:1px solid var(--border,#334155);border-radius:12px;padding:10px 12px"><div class="row" style="gap:8px;margin-bottom:6px"><b style="flex:1">🔁 Renewals & retention</b>${r.rate === null ? '<span class="small muted">no result yet</span>' : `<span class="pill ${r.rate >= 50 ? 'st-active' : 'st-expiring'}">${r.rate}% renewed</span>`}</div>
      <div class="small muted" style="margin-bottom:4px">These ${d.total} new customers today</div>
      <button class="tagp" data-act="nm-ren" data-r="renewed">✅ Renewed · <b>${r.renewed}</b></button> <button class="tagp" data-act="nm-ren" data-r="lost">❌ Ended, not renewed · <b>${r.lost}</b></button> <button class="tagp" data-act="nm-ren" data-r="waiting">⏳ Still running · <b>${r.waiting}</b></button>${r.trials ? ` <span class="tagp">🎁 Trials that bought · <b>${r.trialsConverted}/${r.trials}</b></span>` : ''}
      <div class="small muted" style="margin:8px 0 4px">All customers during ${esc(r0.label)}</div>
      <span class="tagp">💳 Renewals paid · <b>${m.renewals}</b>${m.amount ? ' · ' + m.amount : ''}</span> <span class="tagp">📆 Subscriptions ending · <b>${m.due}</b></span> <span class="tagp">✅ of them renewed · <b>${m.dueRenewed}</b></span> <span class="tagp">❌ lost · <b>${m.dueLost}</b></span></div>`; })()}
    <div style="margin-top:12px"><div class="small muted" style="margin-bottom:4px">Packages bought</div>${bar(d.standard.plans)}</div>
    <div style="margin-top:10px"><div class="small muted" style="margin-bottom:4px">Balance status today</div>${bar(d.balance)}</div>
    <div style="margin-top:10px"><div class="small muted" style="margin-bottom:4px">Login details delivered</div><span class="tagp">✉️ Email · <b>${d.sent.email}</b> (${pct(d.sent.email)})</span> <span class="tagp">WhatsApp · <b>${d.sent.whatsapp}</b> (${pct(d.sent.whatsapp)})</span> <span class="tagp">Telegram · <b>${d.sent.telegram}</b> (${pct(d.sent.telegram)})</span> ${d.notSent ? `<span class="pill st-expired">${d.notSent} not contacted yet</span>` : '<span class="pill st-active">everyone contacted</span>'}</div>
    ${d.customers.length ? `<details style="margin-top:12px"><summary class="small">Delivery & renewal log per customer (${d.customers.length})${state.admin.nmRen ? ` · showing: ${esc(state.admin.nmRen)} <a data-act="nm-ren" data-r="">show all</a>` : ''}</summary><div class="table-wrap" style="margin-top:6px"><table><thead><tr><th>Customer</th><th>Joined</th><th>Package</th><th>Status</th><th>Renewal</th><th title="Email">✉️</th><th title="WhatsApp">WA</th><th title="Telegram">TG</th><th>IBO</th></tr></thead><tbody>${d.customers.filter((c) => !state.admin.nmRen || c.renew === state.admin.nmRen).map((c) => `<tr><td><button class="name-link" data-act="view-customer" data-id="${c.id}">${esc(c.name || c.username)}</button><div class="small muted">${esc(c.username)}</div></td><td>${fmtDate(c.createdAt)}</td><td>${esc(c.plan)}</td><td>${pill(c.state)}</td><td class="small">${c.renew === 'renewed' ? `✅ ${fmtDate(c.renewedAt)}` : c.renew === 'lost' ? '❌ Not renewed' : '⏳ Running'}</td><td>${mark(c.email, false, 'Email')}</td><td>${mark(c.whatsapp, c.noWhatsapp, 'WhatsApp')}</td><td>${mark(c.telegram, c.noTelegram, 'Telegram')}</td><td>${c.ibo ? '📺' : ''}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    ${d.reseller.list.length ? `<details style="margin-top:8px"><summary class="small">Reseller orders (${d.reseller.list.length})</summary><ul class="small" style="margin:6px 0 0;padding-left:18px">${d.reseller.list.map((o) => `<li>${fmtDate(o.at)} · ${esc(o.rsl)} ${esc(o.name)} · ${esc(o.pkg)} · ${o.credits} credits${o.amount ? ' · ' + esc(o.amount) + ' ' + esc(o.currency) : ''}</li>`).join('')}</ul></details>` : ''}`;
}

const CONN_UI = [['xtream1', 'Xtream Codes 1 + M3U'], ['xtream2', 'Xtream Codes 2 + M3U'], ['unlimited', 'Unlimited M3U']];
const connName = (t) => (CONN_UI.find((x) => x[0] === t) || CONN_UI[0])[1];
// One extra connection (device line) in the customer form. Inputs carry data-skip so the form reader leaves them to connRead().
function connRow(x = {}, n = '') {
  const a = (k) => `data-skip data-cn="${k}" autocapitalize="none" spellcheck="false"`;
  return `<div class="conn-row" data-cid="${esc(x.id || '')}" style="border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:10px 12px;margin:8px 0">
    <div class="row" style="gap:6px;margin-bottom:4px"><b class="conn-n" style="flex:1">📡 Connection ${n}</b><button type="button" class="btn sm danger" data-act="conn-del" title="Remove this connection">✕ Remove</button></div>
    <div class="grid3">${field('Type', 'cn_type', x.type || 'xtream1', { type: 'select', options: CONN_UI, attrs: 'data-skip data-cn="type"' })}${field('Devices', 'cn_devices', x.devices || 1, { type: 'number', attrs: 'data-skip data-cn="devices" min="1" max="50"' })}${field('Name (optional)', 'cn_label', x.label || '', { ph: 'Living room TV, Son…', attrs: 'data-skip data-cn="label" maxlength="40"' })}</div>
    ${field('M3U link', 'cn_m3u', x.m3u || '', { ph: 'http://your-dns.com:8080/get.php?username=…&password=…&type=m3u_plus', attrs: a('m3u') + ' dir="ltr" data-input="conn-m3u"', help: 'Paste the link and the username, password and DNS fill in by themselves.' })}
    <div class="grid3">${field('Username', 'cn_u', x.u || '', { attrs: a('u') })}${field('Password', 'cn_p', x.p || '', { attrs: a('p') })}${field('DNS', 'cn_dns', x.dns || '', { ph: 'http://your-dns.com:8080', attrs: a('dns') + ' dir="ltr"' })}</div></div>`;
}
const connNumber = () => document.querySelectorAll('#conn-list .conn-row .conn-n').forEach((b, i) => (b.textContent = `📡 Connection ${i + 2}`));
function connRead(f) {
  return [...f.querySelectorAll('#conn-list .conn-row')].map((r) => { const g = (k) => (r.querySelector(`[data-cn="${k}"]`)?.value || '').trim(); return { id: r.dataset.cid || undefined, type: g('type'), devices: Number(g('devices')) || 1, label: g('label'), m3u: g('m3u'), u: g('u'), p: g('p'), dns: g('dns') }; }).filter((x) => x.m3u || x.u);
}
// 🧾 WLF-045 · 4 devices (devices WLF-045-01 … -04 in the tooltip)
const orderChip = (c) => { if (!String(c.orderNo || '').trim()) return ''; const o = parseOrderNo(c.orderNo); const dv = orderDevices(c); return ` <span class="tagp" title="${esc(['Order ' + o.raw + (orderAt(c) ? ' · ' + fmtDate(orderAt(c)) : ''), ...(dv.length > 1 ? dv : [])].join('\n'))}">🧾 ${esc(dv.length > 1 && o.num !== null && !o.sub ? o.main : o.raw)}${dv.length > 1 ? ` · ${dv.length} devices` : ''}</span>`; };
const connChip = (c) => (c.lines || []).length ? ` <span class="pill st-open" title="${esc([connName(c.lineType), ...(c.lines || []).map((x) => (x.label ? x.label + ': ' : '') + connName(x.type))].join(' · '))}">📡 ${(c.lines || []).length + 1} lines · ${connTotal(c)} devices</span>` : '';
const connTotal = (c) => Math.max(1, Number(c.connections) || 1) + (c.lines || []).reduce((a, x) => a + (Number(x.devices) || 1), 0);

function customerForm(c) {
  const s = state.admin.settings;
  const isNew = !c;
  c = c || { planId: s.plans[0]?.id, connections: s.plans[0]?.connections || 1, startAt: Date.now() };
  const planOpts = [...s.plans.map((p) => [p.id, `${p.name} · ${p.days} days · ${p.price} ${s.currency}`]), ['custom', 'Custom dates']];
  return `<form data-form="customer" data-id="${c.id || ''}">
    ${!isNew ? `<div class="card" style="padding:10px 12px;margin:0 0 10px"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
      <div style="flex:1;min-width:200px"><div class="small muted">Expiry date</div><b>${esc(endTxt(c))}</b> <span class="small muted">${c.noExpiry ? '(no end date)' : '(' + esc(leftTxt(c)) + ')'}</span></div>
      <button type="button" class="btn sm" data-act="exp-open" data-id="${c.id}">📅 Add / change / delete expiry</button><button type="button" class="btn sm" data-act="note-one" data-id="${c.id}">🔔 Send notification</button></div>
      <div class="small" style="margin-top:8px"><span class="muted">Connected device:</span> ${c.lastDevice ? (c.devicesSeen || [c.lastDevice]).map((d) => `<b>${DEV_IC[d.kind] || '📱'} ${esc(devLabelOf(d))}</b>${d.os ? ' · ' + esc(d.os) : ''}${d.last || d.at ? ' · ' + fmtDT(d.last || d.at) : ''}`).join('<br>') : '<span class="muted">not seen yet — shows Samsung, iPhone… the next time the customer opens their app</span>'}</div></div>` : ''}

    ${c.pendingLine ? `<div class="notice warning">⏳ This trial is waiting for a line. Paste the M3U link from your panel below and save: the trial starts and the login email is sent.</div>` : ''}
    ${field('M3U link from your panel (optional)', 'm3u', '', { ph: 'http://your-dns.com:8080/get.php?username=…&password=…&type=m3u_plus', attrs: 'autocapitalize="none" spellcheck="false" dir="ltr" data-input="m3u-paste"', help: 'Paste the line link and the username, password and server are filled in for you.' })}
    <div class="grid2">${field('Customer name', 'name', c.name || '', { attrs: 'required' })}${field('Email', 'email', c.email || '', { type: 'email', attrs: 'autocapitalize="none"' })}</div>
    <div class="grid2">${field('Secondary email', 'email2', c.email2 || '', { type: 'email', attrs: 'autocapitalize="none"', ph: 'Backup/reminder address' })}</div>
    <div class="grid2">${phoneField('Phone (with country code)', 'phone', false, c.phone || '', c.id ? custCC(c) : '')}${phoneField('WhatsApp (leave empty if the same)', 'whatsapp', false, c.whatsapp && c.whatsapp !== c.phone ? c.whatsapp : '', c.id ? custCC(c) : '')}</div>
    <div class="grid3">${field('Telegram handle', 'telegram', c.telegram || '', { ph: '@username or id', attrs: 'autocapitalize="none"' })}${field('App / device', 'deviceApp', c.deviceApp || '', { ph: 'IBO Player, Smarters, MAC…' })}${field('MAC address', 'macAddress', c.macAddress || '', { ph: 'AA:BB:CC:DD:EE:FF', attrs: 'autocapitalize="none" spellcheck="false"' })}</div>
    <div class="grid2">${field('Customer language', 'lang', c.lang || 'en', { type: 'select', options: LANG5, help: 'Emails, WhatsApp / Telegram messages and the app use this language.' })}${field('Currency', 'curOverride', c.curOverride || '', { type: 'select', options: [['', `Automatic${c.cur ? ' (now ' + c.cur + ')' : ''}`], ['USD', 'US dollar $'], ['EUR', 'Euro €']], help: 'Automatic: $ everywhere, € for Europe (email ending like .de .ch, or phone +41 +49 …).' })}${field('Status', 'statusFlag', c.statusFlag || 'normal', { type: 'select', options: [['normal', 'Normal'], ['excellent', 'Excellent'], ['dispute', 'Dispute']] })}</div>
    <div class="grid3">${field('Order number', 'orderNo', c.orderNo || '', { ph: isNew ? 'Empty = next number automatically' : '', help: isNew ? 'Leave empty: the next number of your series is given (like WLF-143). Several devices stay on this one number: WLF-143-01, -02…' : 'Must not be used by another customer.' })}${field('Country', 'country', c.country || '')}${field('Payment method', 'paymentMethod', c.paymentMethod || '', { ph: 'Wise, USDT, bank…' })}</div>
    <div class="grid3">${field('Address', 'address', c.address || '')}${field('Server', 'server', c.server || '', { ph: 'MEGA, DINO…' })}${field('Panel', 'panel', c.panel || '')}</div>
    <h3 style="margin-top:6px">App login details</h3>
    <div class="grid2">${field('Username', 'username', c.username || '', { attrs: 'required minlength="3" autocapitalize="none"' })}
      ${field(isNew ? 'Password' : 'New password (leave empty to keep)', 'password', '', { attrs: (isNew ? 'required minlength="4"' : '') + ' autocapitalize="none"', ph: isNew ? '' : '••••••' })}</div>
    <button type="button" class="btn sm" data-act="gen-login" style="margin:-4px 0 12px">🎲 Generate username & password</button>
    <h3>IPTV line (TVplus)</h3>
    ${isNew ? toggle('Use the same username & password for the IPTV line', 'lineSame', true, 'Turn off if the line on the panel has different details.') : ''}
    <div class="grid3" id="line-fields" style="${isNew ? 'display:none' : ''}">${field('Line username', 'lineUsername', c.lineUsername || '')}${field('Line password', 'linePassword', c.linePassword || '')}${field('Panel line ID', 'lineId', c.lineId || '', { help: 'Filled automatically when created through the API.' })}</div>
    <h3 style="margin-top:6px">Connections (devices)</h3>
    <p class="small muted" style="margin:0 0 6px">Connection 1 is the line above. Add one more for each extra line the customer has (for example a 4-device subscription with separate lines). Everything shows on the customer's /profile page and in the line email.</p>
    <div class="grid2">${field('Connection 1 type', 'lineType', c.lineType || 'xtream1', { type: 'select', options: CONN_UI })}${field('Connection 1 devices', 'connections', c.connections || 1, { type: 'number', attrs: 'min="1" max="50"' })}</div>
    <div id="conn-list">${(c.lines || []).map((x, i) => connRow(x, i + 2)).join('')}</div>
    <button type="button" class="btn sm" data-act="conn-add" style="margin:2px 0 12px">＋ Add a connection</button>
    <h3 style="margin-top:6px">Subscription</h3>
    <div class="grid2">${field('Plan', 'planId', c.planId, { type: 'select', options: planOpts })}<div class="field"><span>Devices in total</span><b id="conn-total" style="display:block;padding:10px 0">${connTotal(c)}</b></div></div>
    <div class="grid2">${field('Start date', 'startAt', isoDay(c.startAt || Date.now()), { type: 'date' })}${field('Expiry date', 'expiresAt', c.expiresAt ? isoDay(c.expiresAt) : '', { type: 'date', attrs: c.expiresAt ? `data-ms="${c.expiresAt}"` : '', help: isNew ? 'Leave empty to calculate from the plan.' : c.isTrial && c.state !== 'expired' ? `Trial ends ${fmtDT(c.expiresAt)} (${c.hoursLeft} h left). Change the date only to give more days.` : `Ends ${fmtDT(c.expiresAt)}` })}</div>
    ${isNew ? `<div class="grid2">${accountSelect(s, 'accountId', '')}${stripeSelect(s, 'stripeAccountId', '')}${field('Amount received', 'price', s.plans[0]?.price || 0, { type: 'number', attrs: 'min="0" step="any"', help: 'In the currency of the chosen account.' })}</div>
      ${toggle('Email the login details to the customer', 'sendEmail', !!s.email.resendKey, s.email.resendKey ? 'Sent with Resend in the language above.' : 'Set up Resend in "Trial & email" first.')}
      ${s.reseller.enabled ? toggle('Create the line on the TVplus panel now', 'createOnPanel', true, 'Uses the "create" action from API settings.') : '<p class="small muted">Reseller API is off — the line will only be saved in this app.</p>'}` : ''}
    ${field('Call notes (conclusion of call)', 'callNotes', c.callNotes || '', { type: 'textarea', rows: 2, ph: 'Summary of the last call / what was promised…' })}
    ${!isNew && c.totalPaidUsd !== undefined ? `<p class="small muted" style="margin:4px 0 0">Total paid (all time): <b>$${Number(c.totalPaidUsd || 0).toFixed(2)}</b></p>` : ''}
    ${field('Notes', 'note', c.note || '', { type: 'textarea', rows: 2 })}
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">${isNew ? 'Create customer' : 'Save changes'}</button></div>
  </form>`;
}

function renewForm(c) {
  const s = state.admin.settings;
  const p0 = s.plans.find((p) => p.id === c.planId) || s.plans[0] || { days: 30, price: 0 };
  return `<p class="muted" style="margin-top:0"><b>${esc(c.name)}</b> (${esc(c.username)}) · currently ${pill(c.state)} · expires ${(c.noExpiry ? '♾ No end date' : fmtDate(c.expiresAt))}</p>
  <form data-form="renew" data-id="${c.id}">
    ${field('Plan', 'planId', p0.id || '', { type: 'select', options: [...s.plans.map((p) => [p.id, `${p.name} · ${p.days} days`]), ['custom', 'Custom number of days']], attrs: 'data-renew-plan' })}
    <div class="grid3">${field('Days to add', 'days', p0.days, { type: 'number', attrs: 'min="1"' })}${field('Credits used', 'credits', p0.credits ?? '', { type: 'number', attrs: 'min="0"' })}${field(`Amount received (${c.cur === 'EUR' ? '€ EUR' : '$ USD'})`, 'price', p0.price, { type: 'number', attrs: 'min="0" step="any"', help: 'In the customer\'s currency, unless you pick a money account below.' })}</div>
    ${accountSelect(s, 'accountId', '')}
    ${stripeSelect(s, 'stripeAccountId', '')}
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
      <button class="btn sm" data-act="export-csv" data-perm="exports">⬇ CSV</button></div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Plan</th><th>Expires</th><th style="min-width:120px">Time left</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.username)} ${c.phone ? '· ' + esc(c.phone) : ''}</div></td><td>${esc(c.planName)}</td><td>${(c.noExpiry ? '♾ No end date' : fmtDate(c.expiresAt))}</td>
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
  const row = (p) => `<div class="rp-row" data-rp="${esc(p.id || '')}"><input data-k="name" value="${esc(p.name)}" placeholder="Name"><input data-k="credits" type="number" value="${p.credits}" placeholder="Credits"><input data-k="price" type="number" step="any" value="${p.price}" placeholder="Price"><button class="btn sm danger" data-act="del-rp" title="Remove reseller plan" aria-label="Remove reseller plan">✕</button></div>`;
  const cur = s.currencyRule?.on !== false ? 'USD' : s.resellerCurrency || 'EUR'; // USD worldwide, EUR for European resellers (shown per reseller)
  return `<div class="card"><div class="row"><h3 style="margin:0">🤝 Reseller packages</h3><span class="spacer"></span><button class="btn primary sm" data-act="sell-rp" data-perm="customers_edit">＋ Sell a package</button></div>
    <div class="plans-grid" style="margin:14px 0">${rp.map((p) => `<div class="plan-c"><b>${esc(p.name)}</b><div class="pp">${priceTxt(p.price, cur)}</div><div class="small muted">${p.credits} credits · ${priceTxt(Math.round((p.price / p.credits) * 100) / 100, cur)} each</div></div>`).join('')}</div>
    <details><summary class="small muted" style="cursor:pointer">Edit packages</summary><div style="margin-top:10px">
      <div class="rp-row small muted"><span>Name</span><span>Credits</span><span>Price</span><span></span></div>
      <div id="rps">${rp.map(row).join('')}</div>
      <div class="row"><button class="btn sm" data-act="add-rp">＋ Add package</button><select id="rp-cur" style="width:auto">${['EUR', 'USD', 'USDT', 'MAD', 'THB'].map((c) => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select><button class="btn sm primary" data-act="save-rp">Save packages</button></div><div style="margin-top:12px">${field('Payment methods resellers can choose on /rsl (one per line)', 'rp-pay', (s.resellerPayMethods || []).join('\n'), { type: 'textarea', rows: 4, attrs: 'id="rp-pay"', help: 'After an order you send the payment link or details; when paid, press ✓ Complete and the reseller gets the confirmation email.' })}</div></div></details>
    ${sales.length ? `<h3 style="margin-top:16px">Reseller sales</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Reseller</th><th>Package</th><th>Paid</th><th>Profit</th></tr></thead><tbody>${sales.slice(0, 50).map((x) => `<tr><td class="small">${fmtDT(x.at)}</td><td><b>${esc(x.name)}</b><div class="small muted">${esc([x.email, x.phone].filter(Boolean).join(' · '))}</div></td><td>${esc(x.planName)}</td><td>${num(x.amount, x.currency)}</td><td class="${x.amountUsd - x.costUsd < 0 ? 'neg' : 'pos'}">${usd(x.amountUsd - x.costUsd)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}
const ORDER_CUR = { EUR: '€', USD: '$', USDT: '₮', MAD: 'DH ', THB: '฿' };
const orderPrice = (s, p, cur) => { const c = cur || (s.currencyRule?.on !== false ? 'USD' : s.orderCurrency); return c === 'ALL' ? Number(p.price).toFixed(2) + ' €/$' : (ORDER_CUR[c || 'USD'] || '') + Number(p.price).toFixed(2) + (ORDER_CUR[c || 'USD'] ? '' : ' ' + c); };
// Package list shown for one customer (or reseller): prices in their currency — USD worldwide, EUR for Europe.
const packageOptions = (s, cur) => [
  ...(s.orderPackages || []).map((p) => [p.id, `${p.title} — ${orderPrice(s, p, cur)}`]),
  ...(s.resellerPackages || []).map((p) => [p.id, `${p.name} — ${orderPrice(s, p, cur)}`]),
];

// The panel asks the server which payment link to use: only the allowed accounts (GreenApp Host), the link that matches the package, in rotation.
const resolvePkgPayLink = async (s, pkgId, wantCur) => {
  try { const r = await api('GET', '/api/admin/paylink?' + new URLSearchParams({ pkg: pkgId || '', cur: wantCur || s.orderCurrency || 'USD', peek: '1' })); return r && r.url ? r : null; } catch { return null; }
};
const iboOfferBtn = (id) => `<button type="button" class="btn sm wa-btn" data-act="wa-one" data-id="${esc(id)}" data-type="ibo_promo">💬 Send IBO Player offer on WhatsApp</button>`;
const opRow = (p = {}, s = {}) => `<div class="op-row card" style="padding:10px;margin-bottom:8px" data-op="${esc(p.id || '')}"><div class="grid3"><input data-k="title" value="${esc(p.title || '')}" placeholder="Name (1 Month)"><input data-k="days" type="number" value="${p.days ?? 30}" placeholder="Days"><input data-k="devices" type="number" value="${p.devices ?? 1}" placeholder="Devices"></div>
  <div class="grid3" style="margin-top:6px"><input data-k="price" type="number" step="any" value="${p.price ?? ''}" placeholder="Price"><input data-k="badge" value="${esc(p.badge || '')}" placeholder="Top badge (optional)"><select data-k="stripeAccount" style="width:auto">${((s.stripeAccounts||[]).filter((a)=>a.status==='active')).map((a)=>`<option value="${esc(a.id)}" ${p.stripeAccount===a.id?'selected':''}>${esc(a.name||a.id)}</option>`).join('')}<option value="">— none (use any account)</option></select><button class="btn sm danger" data-act="del-op">✕ Remove</button></div></div>`;
function adminOrderSection(s) {
  const op = s.orderPackages || []; const cur = ['EUR', 'USD', 'USDT', 'MAD', 'THB'].includes(s.orderCurrency) ? s.orderCurrency : 'EUR';
  return `<div class="card"><div class="row"><h3 style="margin:0">💳 Package order emails</h3><span class="spacer"></span><button class="btn sm" data-act="order-custom" data-perm="marketing">✍️ Custom email</button><button class="btn primary sm" data-act="order-bulk" data-perm="marketing">📨 Send to customers…</button></div>
    <p class="small muted">Customers see these packages in their account and tap <b>🛒 Request</b> or WhatsApp. You get an email and a 🛒 mark on the customer (filter <b>🛒 requests</b>). Then you send the package email (💳 on the customer) with <b>your own payment link</b> for that order. Without a link, the email button says "Contact us to order" and opens your WhatsApp.</p>
    <label class="row small" style="gap:8px;margin:10px 0;cursor:pointer"><input type="checkbox" data-act="cur-rule" ${s.currencyRule?.on !== false ? 'checked' : ''} style="width:auto"> <span><b>Automatic currency:</b> US dollars ($) for everyone, euros (€) for customers in Europe — found from the email ending (.de, .ch, .fr, .co.uk…) or the phone code (+41, +49…). Used in package emails, WhatsApp, renewal emails, invoices and the reseller dashboard. Same price number, only the sign changes.</span></label>
    <div class="plans-grid" style="margin:14px 0">${op.map((p) => `<div class="plan-c"><b>${esc(p.title)}</b><div class="pp">${orderPrice(s, p)}</div><div class="small muted">${p.days} days · ${p.devices} device${p.devices > 1 ? 's' : ''}</div><button class="btn sm" style="margin-top:6px" data-act="order-preview" data-pkg="${esc(p.id)}">👁 Preview</button></div>`).join('')}</div>
    <details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Edit packages & prices</summary><div style="margin-top:10px">
      <div id="ops">${op.map((p)=>opRow(p,s)).join('')}</div>
      <div class="row"><button class="btn sm" data-act="add-op">＋ Add package</button><select id="op-cur" style="width:auto">${['EUR', 'USD', 'USDT', 'MAD', 'THB'].map((c) => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select><button class="btn sm primary" data-act="save-op">Save packages</button></div></div></details></div>`;
}
// Full international number for wa.me / t.me: country code box + number (never only the local part).
const intlDigits = (f, name = 'phone') => (fullPhone(f, name) || String(f[name]?.value || '')).replace(/\D/g, '').replace(/^00/, '');
const waForm = () => { const f = $('[data-form=wa]'); const d = Object.fromEntries(new FormData(f)); if ('phone' in d) { d.phone = fullPhone(f, 'phone') || String(f.phone.value || '').replace(/[^\d+]/g, ''); delete d.phone_cc; } return { ...d, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') }; };
async function waLoad() {
  const f = $('[data-form=wa]'); if (!f) return;
  try { const r = await api('POST', `/api/admin/customers/${f.dataset.id}/wamsg`, waForm()); $('#wa-text').value = r.text; $('#wa-tpl-text').value = r.template;
    $('#wa-info').textContent = (r.type !== 'login' && !waForm().link ? 'No payment link: the {link} line is left out. ' : '') + (r.isDefault ? 'Default template.' : 'Your saved template.'); }
  catch (e) { toast(e.message, true); }
}
const NL_GROUPS = [['all', 'All customers'], ['paying', 'Paying customers (no trials)'], ['active', 'Active subscriptions'], ['expiring', 'Expiring soon'], ['expired', 'Expired subscriptions'], ['trial', 'Trial users']];
const NL_LANGS = [['en', '🇬🇧 English'], ['fr', '🇫🇷 Français'], ['de', '🇩🇪 Deutsch'], ['es', '🇪🇸 Español'], ['it', '🇮🇹 Italiano']];
const LANG5 = [['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['it', 'Italiano']];
const LANG5_CODES = LANG5.map((x) => x[0]);
const nlBlank = () => ({ split: false, lang: 'en', content: { all: {}, en: {}, fr: {}, de: {}, es: {}, it: {} }, badge: '', image: '', coupon: '', link: 'site', group: 'all' });
const nlFields = (k, c = {}) => `<div class="nl-c" data-k="${k}">${field('Email subject', 'subject_' + k, c.subject || '', { ph: 'e.g. 🎉 Black Friday: 50% off all packages' })}${field('Big title', 'title_' + k, c.title || '', { ph: 'e.g. Black Friday deal 🔥' })}${field('Message', 'body_' + k, c.body || '', { type: 'textarea', rows: 7, ph: 'Write your message. {name} = customer first name. *text* = bold. Empty line = new paragraph.' })}${field('Button text', 'button_' + k, c.button || '', { ph: 'e.g. Get the offer →' })}</div>`;
function nlRead() {
  const f = $('[data-form=nl]'); if (!f) return null; const g = (n) => f.elements[n]?.value ?? '';
  const camp = { id: f.dataset.cid || undefined, split: g('split') === '1', lang: g('lang'), badge: g('badge'), image: g('image').trim(), coupon: g('coupon').trim(), group: g('group'), content: {} };
  if (f.dataset.badges && g('badge') === f.dataset.badge0) { try { camp.badges = JSON.parse(f.dataset.badges); } catch {} } // translated badge of a seasonal template
  camp.link = g('link') === 'url' ? g('linkUrl').trim() : g('link');
  for (const k of ['all', ...LANG5_CODES]) camp.content[k] = { subject: g('subject_' + k), title: g('title_' + k), body: g('body_' + k), button: g('button_' + k) };
  if (!camp.split) camp.content = { all: camp.content.all }; else delete camp.content.all;
  try { localStorage.setItem('tvp_nl_draft', JSON.stringify(camp)); } catch {}
  return camp;
}
const orderTargets = (grp) => (state.admin.customers || []).filter((c) => c.email && (grp === 'all' || (grp === 'trial' ? c.isTrial : grp === 'notrecent' ? !c.orderSentAt || Date.now() - c.orderSentAt > 7 * 86400000 : c.state === grp)));
function resellerSaleForm(s, o = {}) {
  const rp = s.resellerPackages || []; const cur = s.currencyRule?.on !== false ? (o.cur || 'USD') : s.resellerCurrency || 'EUR'; const list = RS.data?.list || [];
  const pk0 = rp.find((p) => p.id === o.pkg) || rp[0];
  return `<form data-form="rp-sale">${o.req ? `<input type="hidden" name="requestId" value="${esc(o.req)}">` : ''}
    ${field('Package', 'packageId', pk0?.id, { type: 'select', options: rp.map((p) => [p.id, `${p.name} · ${p.credits} credits · ${priceTxt(p.price, cur)}`]), attrs: 'data-rp-pick' })}
    ${field('Reseller', 'resellerId', o.id || '', { type: 'select', options: [['', '＋ New reseller (register now)'], ...list.slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => [r.id, `${r.name} · ${r.rslId}${r.email ? ' · ' + r.email : ''}`])], attrs: 'data-rs-who', help: 'An existing reseller gets the confirmation email with the dashboard login. A new one is registered first (RSL id and login made for him).' })}
    <div id="rs-newbox" style="${o.id ? 'display:none' : ''}"><div class="grid2">${field('Reseller name', 'name', '', { attrs: o.id ? '' : 'data-req' })}${field('Email', 'email', '', { type: 'email', attrs: 'autocapitalize="none"', help: 'Needed for the confirmation email.' })}</div>
    <div class="grid2">${phoneField('Phone / WhatsApp', 'phone', false)}${field('Company (optional)', 'org', '')}</div></div>
    <div class="grid2">${field('Amount received', 'amount', pk0?.price ?? '', { type: 'number', attrs: 'step="any" min="0"', help: 'In the currency of the account below.' })}${field('Order number', 'ref', '', { ph: 'Empty = next number (RLS-…)' })}</div>
    ${toggle('Send the confirmation email (order details + dashboard login + panel)', 'sendEmail', true)}
    ${accountSelect(s, 'accountId', '')}
    ${field('Note', 'note', '')}
    <p class="small muted">The package credits are taken from your credits stock, and the profit shows in Profits.</p>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">✓ Complete order</button></div></form>`;
}
function adminPlans(s) {
  const row = (p) => `<div class="plan-row" data-plan="${esc(p.id || '')}"><input data-k="name" value="${esc(p.name)}" placeholder="Name"><input data-k="days" type="number" value="${p.days}" placeholder="Days"><input data-k="price" type="number" step="any" value="${p.price}" placeholder="Price"><input data-k="credits" type="number" value="${p.credits ?? ''}" placeholder="Credits"><input data-k="connections" type="number" value="${p.connections}" placeholder="Devices"><input data-k="package" value="${esc(p.package)}" placeholder="Package ID"><button class="btn sm danger" data-act="del-plan" title="Remove plan" aria-label="Remove plan">✕</button></div>`;
  return `<div class="card"><h3>Plans & prices</h3><p class="muted small">"Credits" = how many panel credits one sale of this plan uses (for stock and profit). "Package ID" is the package number on your TVplus panel, sent as <code>{package}</code>.</p>
    <div class="plan-row small muted" style="margin-bottom:4px"><span>Name</span><span>Days</span><span>Price (${esc(s.currency)})</span><span>Credits</span><span>Devices</span><span>Package ID</span><span></span></div>
    <div id="plans">${s.plans.map(row).join('')}</div>
    <button class="btn sm" data-act="add-plan">＋ Add plan</button>
    <div class="grid2" style="margin-top:16px">${field('Price currency', 'currency', s.currency, { type: 'select', options: [['EUR', '€ Euro (EUR)'], ['USD', '$ US Dollar (USD)'], ['USDT', '₮ Tether (USDT)'], ['MAD', 'Moroccan Dirham (MAD)'], ['THB', '฿ Thai Baht (THB)']], attrs: 'id="currency"', help: 'Profits are converted to USD and MAD automatically.' })}</div>
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
    <p class="small muted">To block one person, use Disable on the Customers page.</p></form>
    <div class="card"><h3>Important notice</h3>${noticeEditorHtml(s.importantNotice || '')}</div>
    <div class="card"><h3>Domain &amp; account details</h3>${domainAccountHtml(state.admin.domainDraft || {})}</div>`;
}

// ---- 📞 WhatsApp numbers used across the app: main, support, sales (free trial / prices), resellers ----
const WA_USES = [['main', 'Main number (login page, customer app)'], ['support', 'Support (support page, help)'], ['sales', 'Sales (free trial & prices pages)'], ['resellers', 'Resellers page'], ['other', 'Other / backup']];
const waNumRow = (w = {}, i) => `<div class="card wa-num" data-wa="${esc(w.id || '')}" style="padding:10px;margin-bottom:8px">
  <div class="grid2" style="gap:8px">${field('Name', 'label_' + i, w.label || '', { ph: 'Support team · Khalil' })}${field('Used for', 'use_' + i, w.use || 'other', { type: 'select', options: WA_USES })}</div>
  ${phoneField('WhatsApp number', 'num_' + i, false, w.number ? '+' + w.number : '', 'US')}
  <div class="row" style="justify-content:space-between;align-items:center"><label class="small" style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0"><input type="checkbox" name="on_${i}" ${w.on !== false ? 'checked' : ''} style="width:auto"> In use</label>
  <span>${w.number ? `<a class="btn sm wa-btn" href="https://wa.me/${esc(w.number)}" target="_blank" rel="noopener">💬 Test</a>` : ''}<button type="button" class="btn sm danger" data-act="wa-num-del">🗑</button></span></div></div>`;
function waNumbersCard(s) {
  const list = (s.waNumbers || []).length ? s.waNumbers : s.branding.whatsapp ? [{ id: 'main', label: 'Main', number: s.branding.whatsapp, use: 'main', on: true }] : [];
  return `<form class="card" data-form="wa-nums" id="wa-numbers"><h3>📞 WhatsApp numbers</h3>
    <p class="small muted" style="margin-top:0">Add, edit or remove the WhatsApp numbers customers see. Pick the country (🇺🇸 +1 for the USA, or any other code), then the number. The <b>Main</b> number is used everywhere a page has no number of its own.</p>
    <div id="wa-num-list">${list.map(waNumRow).join('') || '<p class="muted small wa-empty">No number yet.</p>'}</div>
    <div class="row" style="justify-content:space-between"><button type="button" class="btn" data-act="wa-num-add">＋ Add a number</button><button class="btn primary">💾 Save numbers</button></div></form>`;
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
    <div class="field"><span>WhatsApp number</span><div>${b.whatsapp ? `<b>+${esc(b.whatsapp)}</b>` : '<span class="muted">none yet</span>'} <a class="small" data-act="atab" data-tab="wanums" style="cursor:pointer">📞 Manage WhatsApp numbers →</a></div></div>}
    <div class="grid2">${field('Telegram support handle', 'branding.telegram', b.telegram, { ph: 'yourid', help: 'Private support chat, without @. Payment and renewal links are sent here privately, never on the website.' })}${field('Telegram marketing channel', 'branding.telegramChannel', b.telegramChannel, { ph: 'yourchannel', help: 'Public channel for promos and announcements only — no payments here.' })}</div>
    <div class="grid2">${field('Support button text', 'branding.supportLabel', b.supportLabel)}${field('Support link', 'branding.supportUrl', b.supportUrl, { ph: 'https://line.me/ti/p/~yourid' })}</div>
    ${field('Footer text', 'branding.footerText', b.footerText, { ph: '© 2026 Your company' })}
    <button class="btn primary">Save branding</button></form>
    <div><h3>Live preview</h3><div class="preview-box" id="login-preview">${loginCard(b, { preview: true })}</div></div></div>`;
}

// ---------- 🗝️ Accounts & API keys (owner, Khalil, Nizar) ----------
const ACC = { d: null, kind: 'all', q: '', show: {} };
async function adminAccounts() {
  try { ACC.d = await api('GET', '/api/admin/accounts'); } catch (e) { return `<div class="notice danger">${esc(e.message)}</div>`; }
  return accPage();
}
function accPage() {
  const d = ACC.d; const T = d.totals; const usd = (n) => '$' + Number(n || 0).toFixed(2);
  const kinds = [['all', 'All'], ...Object.entries(d.kinds)];
  const q = ACC.q.toLowerCase(); const list = d.rows.filter((a) => (ACC.kind === 'all' || a.kind === ACC.kind) && (!q || [a.name, a.email, (a.domains || []).join(' '), a.note].join(' ').toLowerCase().includes(q)));
  const sec = (a, k, label) => { const v = a[k]; if (!v) return '<span class="muted">—</span>'; const id = a.id + k; return `<code id="ac-${id}" style="word-break:break-all">${ACC.show[id] ? esc(v) : '••••' + esc(String(v).slice(-4))}</code> <button class="btn sm ghost" data-act="acc-eye" data-k="${id}" title="Show / hide ${label}">👁</button><button class="btn sm ghost" data-act="rsl-copy" data-v="${esc(v)}" title="Copy">📋</button>`; };
  const bar = (pct) => pct === null ? '' : `<div style="height:6px;background:var(--line,#e2e8f0);border-radius:6px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${Math.min(100, pct)}%;background:${pct > 90 ? '#dc2626' : pct > 70 ? '#f59e0b' : '#16a34a'}"></div></div>`;
  return `<div class="notice" style="margin-bottom:12px">🗝️ Only the owner, Khalil and Nizar can open this page. Support agents never see these keys, passwords or domains.</div>
  <div class="stats">
    <div class="stat c-acc"><span>Accounts</span><b>${T.accounts}</b><span>${T.keys} API keys · ${T.paid} paid</span></div>
    <div class="stat"><span>Emails sent this month</span><b>${Number(T.month).toLocaleString()}</b><span>${T.quota ? `of ${Number(T.quota).toLocaleString()} in the plans` : ''}</span></div>
    <div class="stat c-ok"><span>Plans paid (monthly)</span><b>${usd(T.fees)}</b><span>all keys together</span></div>
    <div class="stat"><span>Cost of emails sent</span><b>${usd(T.usedCost)}</b><span>this month · ${Number(T.total).toLocaleString()} sent in total</span></div>
  </div>
  <div class="row" style="gap:6px;flex-wrap:wrap;margin:12px 0"><button class="btn primary" data-act="acc-edit">＋ Add account</button>${d.looseKeys ? `<button class="btn" data-act="acc-importkeys">⤵ Add the ${d.looseKeys} sending key(s) from Email settings</button>` : ''}<button class="btn" data-act="acc-sheet">📊 Google Sheets</button><button class="btn" data-act="acc-dns">🌐 Add Resend DNS records</button><button class="btn" data-act="acc-paste">📋 Paste rows</button></div>
  <div class="row" style="gap:8px;margin-bottom:10px"><input placeholder="🔎 Search name, email, domain…" value="${esc(ACC.q)}" data-input="acc-q" style="flex:1"><div class="chips" style="margin:0">${kinds.map(([k, n]) => `<a class="${ACC.kind === k ? 'on' : ''}" data-act="acc-kind" data-k="${k}">${esc(n)}</a>`).join('')}</div></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Account</th><th>Login</th><th>API key</th><th>Domains</th><th>Plan & spend</th><th></th></tr></thead><tbody>${list.map((a) => { const u = a.usage, pl = a.plan || {};
    return `<tr><td><b>${esc(a.name)}</b><div class="small muted">${esc(d.kinds[a.kind] || a.kind)}${a.use ? ' · for ' + esc(a.use === 'both' ? 'customers + marketing' : a.use === 'customer' ? 'customer emails' : 'marketing') : ''}</div>${a.url ? `<a class="small" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url.replace(/^https?:\/\//, ''))}</a>` : ''}</td>
      <td class="small">${esc(a.email || '—')}<div>${a.password ? sec(a, 'password', 'password') : ''}</div></td><td class="small">${sec(a, 'apiKey', 'API key')}</td><td class="small">${(a.domains || []).map((x) => `<span class="tagp">${esc(x)}</span>`).join(' ') || '—'}</td>
      <td class="small">${pl.paid ? `<span class="pill st-active">✓ Paid $${esc(String(pl.price))}</span>` : `<span class="pill st-expired">${pl.price ? 'Not paid' : 'Free'}</span>`} ${pl.quota ? Number(pl.quota).toLocaleString() + ' emails' : ''}${pl.paidUntil ? ` · until ${esc(pl.paidUntil)}` : ''}
        ${a.apiKey ? `<div>${Number(u.month).toLocaleString()} sent this month${u.pct !== null ? ` (${u.pct}%)` : ''} · ${usd(u.usedCost)}${u.cpe ? ` <span class="muted">($${u.cpe}/email)</span>` : ''}</div>${bar(u.pct)}` : ''}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="acc-edit" data-id="${a.id}">✎ Edit</button>${a.kind === 'resend' && a.apiKey ? `<button class="btn sm" data-act="acc-domains" data-id="${a.id}" title="Domain status at Resend">🌐</button>` : ''}${a.kind === 'hostinger' && a.apiKey ? `<button class="btn sm" data-act="acc-hostinger" data-id="${a.id}" title="Websites, domains and plans at Hostinger">🏠</button>` : ''}<button class="btn sm danger" data-act="acc-del" data-id="${a.id}" title="Delete">🗑</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No accounts yet. Add one, or add the keys from Email settings.</td></tr>'}</tbody></table></div>
  <p class="small muted">Spend = emails sent this month × (plan price ÷ emails in the plan). Sends are counted from today for every key used by the app (customer emails, marketing and resellers).</p>`;
}
function accForm(a = {}) {
  const d = ACC.d; const pl = a.plan || { tier: a.kind && !['resend', 'marketing'].includes(a.kind) ? 'custom' : 'free' };
  return `<form data-form="acc" data-id="${esc(a.id || '')}">
    <div class="grid3">${field('Type', 'kind', a.kind || 'resend', { type: 'select', options: Object.entries(d.kinds) })}${field('Name', 'name', a.name || '', { ph: 'Resend #3 · intproto mail', attrs: 'required maxlength="80"' })}${field('Used for', 'use', a.use || '', { type: 'select', options: [['', '—'], ['customer', 'Customer emails'], ['marketing', 'Email marketing'], ['both', 'Both']] })}</div>
    <div class="grid3">${field('Account email (login)', 'email', a.email || '', { type: 'email', attrs: 'autocapitalize="none"' })}${field('Account password', 'password', a.password || '', { attrs: 'autocomplete="off" autocapitalize="none"' })}${field('Website / panel link', 'url', a.url || '', { ph: 'https://resend.com/…', attrs: 'autocapitalize="none"' })}</div>
    ${field('API key', 'apiKey', a.apiKey || '', { ph: 're_… (Resend) · Dynu / Hostinger API key', attrs: 'autocomplete="off" autocapitalize="none" spellcheck="false"' })}
    ${field('Domains (comma or space between)', 'domains', (a.domains || []).join(', '), { ph: 'mail.intproto-tv.store, intproto-tv.com' })}
    <div class="grid3">${field('Plan', 'tier', pl.tier || 'free', { type: 'select', options: Object.entries(d.plans).map(([k, v]) => [k, v.name + (v.price ? ` · $${v.price}` : '')]) })}${field('Plan price $ / month', 'price', pl.price ?? '', { type: 'number', attrs: 'step="any" min="0"' })}${field('Emails in the plan', 'quota', pl.quota ?? '', { type: 'number', attrs: 'min="0"' })}</div>
    <div class="grid3">${toggle('✓ Plan paid', 'paid', !!pl.paid)}${field('Paid until', 'paidUntil', pl.paidUntil || '', { type: 'date' })}${toggle('📤 Send emails with this key', 'sending', a.sending !== false)}</div>
    <p class="small muted" style="margin-top:0">Resend: the API key starts with re_. Hostinger: make an API token in hPanel → Profile → API. Dynu: Control Panel → API Credentials.</p>
    ${field('Note', 'note', a.note || '', { type: 'textarea', rows: 2 })}
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">💾 Save</button></div></form>`;
}

async function adminApi(s) {
  const r = s.reseller;
  try { state.admin.mktSettings = await api('GET', '/api/admin/emailmkt/settings'); } catch {}
  const placeholders = ['{base}', '{key}', '{reseller_user}', '{reseller_pass}', '{username}', '{password}', '{line_id}', '{package}', '{connections}', '{days}', '{months}', '{name}', '{phone}', '{note}'];
  const panelFields = `
      <div class="card"><h3>IPTV Panels Management</h3>
        <p class="small muted">Update and manage IPTV panel credentials and configurations (Dino, Xtream, Mega panels).</p>
        ${['dino', 'xtream', 'mega'].map((k) => `<details open style="margin:8px 0;padding:10px;background:var(--panel2);border-radius:8px">
          <summary style="cursor:pointer;display:flex;gap:10px;align-items:center"><b style="text-transform:capitalize">${k} panel</b><span class="muted small"> — ${k === 'dino' ? 'Dino / DinoPanel' : k === 'xtream' ? 'Xtream-Codes' : 'Mega-Panel'}</span></summary>
          <div class="grid2" style="margin-top:8px">${field('Base URL', 'panel.' + k + '.baseUrl', (s.panel && s.panel[k] && s.panel[k].baseUrl) || '', { ph: 'http://panel.example.com:80', attrs: 'autocapitalize="none"' })}${field('API key', 'panel.' + k + '.apiKey', (s.panel && s.panel[k] && s.panel[k].apiKey) || '', { type: 'password', attrs: 'autocomplete="off"' })}</div>
          <div class="grid2">${field('Username', 'panel.' + k + '.username', (s.panel && s.panel[k] && s.panel[k].username) || '', { attrs: 'autocapitalize="none"' })}${field('Password', 'panel.' + k + '.password', (s.panel && s.panel[k] && s.panel[k].password) || '', { type: 'password', attrs: 'autocomplete="off"' })}</div>
          <div class="row" style="margin-top:6px"><button type="button" class="btn sm" data-act="panel-test" data-panel="${k}">Test ${k} connection</button><span class="small muted" id="panel-test-${k}" style="margin-left:8px"></span></div>
        </details>`).join('')}
        ${field('Panel streaming server URL', 'player.serverUrl', s.player.serverUrl, { ph: 'http://your-dns.com:8080', attrs: 'autocapitalize="none"' })}
        ${field('Playback mode', 'player.mode', s.player.mode || 'proxy', { type: 'select', options: [['proxy','Through the app server (works in every browser)'],['direct','Direct from each device (for servers that block Cloudflare)']] })}
        ${field('Stream relay URL', 'player.relayUrl', s.player.relayUrl, { ph: 'https://intproto-tv-relay.onrender.com', attrs: 'autocapitalize="none"' })}
        ${toggle('Play through the built-in secure proxy (recommended)', 'player.useProxy', s.player.useProxy, 'Fixes "http" streams on iPhone/HTTPS and hides the server from customers. Note: Cloudflare only connects to ports 80, 8080, 8880, 2052, 2082, 2086, 2095 (http) or 443, 8443, 2053, 2083, 2087, 2096 (https).')}
        ${field('Player identity (User-Agent)', 'player.userAgent', s.player.userAgent, { help: 'Some IPTV servers only accept known players. Default: IPTVSmartersPro.' })}
        <div class="grid3" style="margin-top:12px">${field('Test line username', 'tu', '', { attrs: 'data-skip id="test-u" autocapitalize="none"' })}${field('Test line password', 'tp', '', { attrs: 'data-skip id="test-p" autocapitalize="none"' })}<div class="field"><span>&nbsp;</span><button type="button" class="btn" data-act="test-player">Test server</button></div></div>
        <div id="test-player-out"></div>
        ${r.enabled && !r.baseUrl ? `<div class="notice warning" role="alert" style="margin:0 0 14px"><b>⚠️ Reseller API base URL is empty.</b> The free-trial and renewal line creation will always fail and trials pile up in the waiting queue. Set it in this page (API base URL, e.g. <code>https://panel.example.com</code>), save, then test a trial.</div>` : ''}
        <h3 style="margin-top:8px">TVplus reseller API (create / renew lines)</h3>
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
      </div>`;
  return `<div class="grid2" style="gap:16px;align-items:start">
    <form data-form="settings" class="card">${panelFields}
      <div class="row" style="position:sticky;bottom:12px"><button class="btn primary">💾 Save panel / API settings</button></div>
    </form>
    <form data-form="trans-settings" class="card"><h3>📧 Resend keys &amp; domains — customer emails</h3>
      <p class="small muted" style="margin-top:0">Add as many keys and domains as you need. Set the plan of each key (free trial or paid): paid keys send first, free trial keys only up to 100 a day / 3,000 a month, and a key that fails is skipped so the email still goes out. <a data-act="mail-status" style="cursor:pointer">See the sending status →</a></p>
      ${keysEditor('trans', s.email.transRows || [])}
      <h3 style="margin-top:14px">Subject lines</h3><div class="grid2">${Array.from({ length: 4 }, (_, i) => `<div class="field"><input name="transSubject${i}" value="${esc(((s.email.transSubjects || [])[i] || ''))}" placeholder="Subject ${i + 1}" dir="ltr" autocomplete="off"></div>`).join('')}</div>
      <label class="field" style="margin-top:10px"><span>Cost per email (USD)</span><input type="number" step="0.0001" min="0" name="transCost" value="${esc(String(s.email.transCostPerEmail ?? 0.0004))}"></label>
      <div class="row" style="margin-top:12px"><button type="submit" class="btn primary">💾 Save rotation</button></div>
    </form>
  </div>`;
}
// ---------- Resend sending keys: one row per key + domain, as many as you like ----------
const KEY_TIERS = [['', 'Same as in Accounts & API keys (or not set)'], ['free', 'Free trial account · 100 a day, 3,000 a month'], ['p50', 'Paid · $20 for 50,000 emails a month'], ['p100', 'Paid · $35 for 100,000 emails a month'], ['custom', 'Paid · other amount (type it)']];
const keyRow = (scope, r = {}) => `<div class="key-row card" data-key-row data-id="${esc(r.id || '')}" style="padding:10px;margin-bottom:8px">
  <div class="row" style="gap:6px;align-items:center"><label class="row small" style="gap:6px;flex:0 0 auto" title="Switch this key off without deleting it"><input type="checkbox" data-k="on" ${r.on === false ? '' : 'checked'} style="width:auto"> On</label>
    <input data-k="key" value="${esc(r.key || '')}" placeholder="Resend API key (re_…)" dir="ltr" autocomplete="off" spellcheck="false" style="flex:2;min-width:140px">
    <input data-k="domain" value="${esc(r.domain || '')}" placeholder="yourdomain.com" dir="ltr" autocomplete="off" style="flex:1;min-width:110px"></div>
  <div class="row" style="gap:6px;align-items:center;margin-top:6px"><input data-k="name" value="${esc(r.name || '')}" placeholder="Sender name, e.g. INTPROTO-TV Support" style="flex:1;min-width:150px">
    <button type="button" class="btn sm" data-act="key-test" data-scope="${scope}">🧪 Test</button><button type="button" class="btn sm danger" data-act="key-del" title="Delete this key">🗑</button></div>
  <div class="row" style="gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap"><span class="small muted">Plan</span><select data-k="tier" data-input="key-tier" style="flex:1;min-width:190px">${KEY_TIERS.map(([k, n]) => `<option value="${k}" ${String(r.tier || '') === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <input data-k="quota" type="number" min="0" step="1000" value="${r.tier === 'custom' && r.quota ? esc(r.quota) : ''}" placeholder="Emails / month" title="Emails a month in this plan" style="width:130px" ${r.tier === 'custom' ? '' : 'hidden'}>
    <input data-k="price" type="number" min="0" step="0.01" value="${r.tier === 'custom' && r.price ? esc(r.price) : ''}" placeholder="Price $" title="Price of the plan ($ a month)" style="width:95px" ${r.tier === 'custom' ? '' : 'hidden'}></div>
  <div class="small muted key-status" style="margin-top:4px">${r.testAt ? `${r.testOk ? '✅' : '❌'} Tested ${fmtDT(r.testAt)} · ${esc(r.testMsg || '')}` : 'Not tested yet'} · sends as <span dir="ltr">${esc(r.name || 'INTPROTO-TV')} &lt;noreply@${esc(r.domain || 'yourdomain.com')}&gt;</span></div></div>`;
const keysHelp = (scope) => `<details class="small" style="margin:6px 0 12px"><summary style="cursor:pointer;font-weight:700">📖 How to add a key and domain</summary><ol style="margin:8px 0 0;padding-inline-start:18px;line-height:1.6">
  <li>In <a href="https://resend.com/domains" target="_blank" rel="noopener">Resend → Domains</a>, add your domain and put the DNS records it shows in your domain's DNS (Cloudflare or Hostinger). Wait until it says <b>Verified</b>.</li>
  <li>In <a href="https://resend.com/api-keys" target="_blank" rel="noopener">Resend → API Keys</a>, create a key with <b>Sending access</b> for that domain, and copy it (it starts with <code>re_</code>).</li>
  <li>Here, tap <b>＋ Add key</b>, paste the key, type the domain and a sender name, then <b>🧪 Test</b>. A test email goes to your admin email.</li>
  <li>Tap <b>💾 Save</b>. Every key that is switched <b>On</b> is used in turn; a paused key is skipped.</li></ol>
  <p style="margin:8px 0 0">${scope === 'mkt' ? 'These keys are only for <b>marketing</b> emails (newsletter lists). Use different domains from your customer emails: if a newsletter gets spam reports, your login, payment and renewal emails keep arriving.' : 'These keys are for <b>customer</b> emails: login details, profile, payment links, renewals, trials. Keep newsletter domains separate (Email marketing page), so spam reports on promotions never block these.'}</p></details>`;
const keysEditor = (scope, rows) => !can('secrets') ? `<div class="notice">🔒 API keys and sending domains are only visible to the owner, Khalil and Nizar.</div>` : `${keysHelp(scope)}<div data-keys="${scope}">${(rows || []).map((r) => keyRow(scope, r)).join('') || '<p class="small muted key-empty">No keys yet.</p>'}</div>
  <div class="row" style="gap:8px"><button type="button" class="btn" data-act="key-add" data-scope="${scope}">＋ Add key</button><span class="small muted">${(rows || []).filter((r) => r.on !== false && r.key).length} switched on · ${(rows || []).length} in total</span></div>`;
const keysRead = (scope) => [...document.querySelectorAll(`[data-keys="${scope}"] [data-key-row]`)].map((el) => ({ id: el.dataset.id || undefined, key: el.querySelector('[data-k=key]').value.trim(), domain: el.querySelector('[data-k=domain]').value.trim(), name: el.querySelector('[data-k=name]').value.trim(), on: el.querySelector('[data-k=on]').checked, tier: el.querySelector('[data-k=tier]')?.value || '', quota: el.querySelector('[data-k=quota]')?.value || 0, price: el.querySelector('[data-k=price]')?.value || 0 })).filter((r) => r.key || r.domain);
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
  <div>${twoFactorCard(me)}<form data-form="settings" class="card"><h3>Security</h3>
    ${toggle('Require two-factor sign-in for owner & staff', 'security.force2fa', s.security.force2fa === true, 'Every owner and staff member must turn on two-step sign-in before using the dashboard (spec §2)')}
    ${toggle('Require captcha on customer & trial sign-in', 'security.captcha', s.security.captcha !== false, 'A small math question blocks bots; owner and staff use two-step sign-in instead')}
    ${toggle('Email me if the IPTV server is down (daily check)', 'email.uptimeMonitor', s.email.uptimeMonitor !== false, 'The daily health check emails you when the streaming server does not answer')}
    ${toggle('Auto-clean dead duplicate accounts (same name + phone + email)', 'security.autoDupCleanup', s.security.autoDupCleanup !== false, 'Runs daily: removes expired duplicates with no sign-in or renewal in 6+ months; always keeps the newest and emails you a list')}
    ${field('Discord voice channel link', 'security.discordUrl', s.security.discordUrl || '', { ph: 'https://discord.com/channels/…', attrs: 'autocapitalize="none"', help: 'One-tap team coordination in the dashboard header — for shift handovers and urgent discussions' })}
    ${field('Keep users signed in for (hours)', 'security.sessionHours', s.security.sessionHours, { type: 'number', attrs: 'min="1" max="2160"' })}
    <button class="btn primary">Save</button></form>
  <div class="card"><h3>Backup</h3><p class="small muted">Download all settings and customers, or restore from a backup file.</p>
    <div class="row"><button class="btn" data-act="backup">⬇ Download backup</button><label class="btn">⬆ Restore<input type="file" accept=".json" data-input="restore" hidden></label></div>
    ${state.mode === 'demo' ? `<hr style="border-color:var(--line);margin:16px 0"><p class="small muted">Demo mode keeps data in this browser only.</p><button class="btn danger" data-act="reset-demo">Reset demo data</button>` : ''}
  </div></div></div>`;
}

async function adminActivity() {
  const log = await api('GET', '/api/admin/log');
  let diag = [];
  if (state.admin.me.role === 'owner') { try { diag = (await api('GET', '/api/admin/diag')).list || []; } catch {} }
  const icon = { customer: '👤', renewal: '🔁', settings: '⚙️', admin: '🔐', team: '🛡', finance: '🏦', stock: '🎟', trial: '🎁', daily: '⏰' };
  return `${diag.length ? `<div class="card"><h3>🩺 Client diagnostics (last ${diag.length})</h3>${diag.slice(0, 20).map((d) => `<div class="list-item"><span>${d.kind === 'boot-timeout' ? '⏱' : d.kind === 'config-fail' ? '📡' : '⚠️'}</span><div style="flex:1;min-width:0"><b>${esc(d.kind)}</b> <span class="small muted">${esc(d.msg || '')}${d.file ? ' · ' + esc(d.file) + (d.line ? ':' + d.line : '') : ''}</span><div class="small muted">${esc(d.origin || '')} · ${esc(d.ua || '')} · ${fmtDT(d.at)} · IP ${esc(d.ip || '—')}</div></div></div>`).join('')}<p class="small muted" style="margin-top:8px">These are reports from devices where the app could not start. Empty = all good.</p></div>` : ''}
    <div class="card">${log.length ? log.map((l) => `<div class="list-item"><span>${icon[l.type] || '•'}</span><div style="flex:1">${esc(l.msg)}${l.by ? `<div class="small muted">by ${esc(l.by)}</div>` : ''}</div><span class="small muted">${fmtDT(l.at)}</span></div>`).join('') : '<p class="muted">No activity yet.</p>'}</div>`;
}

function showResult(el, r) {
  el.innerHTML = `<div class="notice ${r.ok ? 'success' : 'danger'}" style="margin-top:12px"><b>${r.ok ? '✅ Connected' : '❌ ' + esc(r.error || 'Failed')}</b>${r.credits != null ? ` · Credits: <b>${esc(r.credits)}</b>` : ''}${r.via ? `<div class="small" style="margin-top:6px">${esc(r.via)}</div>` : ''}${r.data != null ? `<div class="code" style="margin-top:8px">${esc(typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2)).slice(0, 3000)}</div>` : ''}</div>`;
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
  const me = state.admin.me;
  let sigs = [];
  if (me.role === 'owner') { try { sigs = (await api('GET', '/api/admin/bylaws')).list || []; } catch {} }
  return `<div class="row" style="margin-bottom:14px"><p class="muted" style="margin:0;flex:1">Give your team their own login. They sign in on the same page, and only see what you allow. Every action is logged with their name.</p><button class="btn primary" data-act="new-member">＋ Add team member</button></div>
  ${team.length ? `<div class="team-grid">${team.map((m) => `<div class="tm ${m.status === 'disabled' ? 'off' : ''}">
    <div class="row"><div class="avatar">${esc(initials(m.name))}</div><div style="flex:1;min-width:0"><b>${esc(m.name)}</b><div class="small muted">${esc(m.role || 'Staff')} · @${esc(m.username)}</div></div>${pill(m.status === 'disabled' ? 'disabled' : 'active')}</div>
    <div class="perm-tags">${(m.perms || []).map((p) => `<span class="tagp">${esc((all.find((x) => x[0] === p) || [p, p])[1])}</span>`).join('') || '<span class="small muted">No permissions</span>'}</div>
    ${m.alias ? `<div class="small muted">✍️ Alias for customers: <b>${esc(m.alias)}</b></div>` : ''}
    ${m.bank && m.bankDetails ? `<div class="small muted">💳 ${esc(m.bank)} · <code>•••• ${esc(String(m.bankDetails).slice(-4))}</code></div>` : ''}
    ${m.traineeUntil && m.traineeUntil > Date.now() ? `<div class="notice warning" style="margin:6px 0">⏳ Unpaid trainee · ${Math.ceil((m.traineeUntil - Date.now()) / 86400000)} day(s) left · view/tasks/attendance only</div>` : ''}
    <div class="small muted">Last sign-in: ${m.lastLogin ? fmtDT(m.lastLogin) : 'never'}</div>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-act="edit-member" data-id="${m.id}">Edit</button>${m.traineeUntil && m.traineeUntil > Date.now() ? `<button class="btn sm primary" data-act="promote-member" data-id="${m.id}">🎓 Promote</button>` : ''}<button class="btn sm" data-act="toggle-member" data-id="${m.id}">${m.status === 'disabled' ? 'Enable' : 'Disable'}</button><button class="btn sm danger" data-act="del-member" data-id="${m.id}" title="Remove team member" aria-label="Remove team member">🗑</button></div>
  </div>`).join('')}</div>` : `<div class="empty card"><span class="ic">🛡</span>No team members yet.</div>`}
  ${me.role === 'owner' && sigs.length ? `<div class="card" style="margin-top:16px"><h3>📜 Staff bylaws — signature archive</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Signed by</th><th>Role</th><th>Version</th><th>Date</th><th>IP</th></tr></thead><tbody>${sigs.map((x) => `<tr><td>${esc(x.name)}<div class="small muted">${esc(x.by)}</div></td><td class="small">${esc(x.role || '')}</td><td class="small">${esc(x.version)}</td><td class="small">${fmtDT(x.at)}</td><td class="small">${esc(x.ip || '—')}</td></tr>`).join('')}</tbody></table></div><p class="small muted" style="margin-top:8px">Signatures are archived with username, timestamp and IP. Bylaw violations lead to immediate removal.</p></div>` : ''}`;
}
function memberForm(m) {
  const me = state.admin.me; const all = me.allPerms; const isNew = !m;
  const roles = { ...(me.allRoles || PRESETS), 'Ads agent': agentPermissionPreset() };
  const ownerOnly = me.ownerOnly || ['exports', 'calls', 'master_sheets'];
  const grantable = all.filter(([k]) => !ownerOnly.includes(k));
  m = m || { perms: roles['Sales Agent'] || [], role: 'Sales Agent' };
  const modules = (me.modules || []).filter((mod) => grantable.some((x) => (x[2] || 'Other') === mod));
  const groups = modules.map((mod) => {
    const rows = grantable.filter((x) => (x[2] || 'Other') === mod);
    return `<div class="perm-group"><div class="small muted" style="margin:8px 0 2px">${esc(mod)}</div><div class="perm-list">${rows.map(([k, label]) => `<label class="toggle"><input type="checkbox" data-perm-cb value="${k}" ${m.perms.includes(k) ? 'checked' : ''}><i></i><span>${esc(label)}</span></label>`).join('')}</div></div>`;
  }).join('');
  return `<form data-form="member" data-id="${m.id || ''}">
    <div class="grid2">${field('Name', 'name', m.name || '', { attrs: 'required' })}${field('Function', 'role', m.role || '', { ph: 'e.g. Technical Manager' })}</div>
    <div class="grid2">${field('Username', 'username', m.username || '', { attrs: (isNew ? 'required minlength="3"' : 'disabled') + ' autocapitalize="none"' })}${field(isNew ? 'Password' : 'New password (optional)', 'password', '', { type: 'password', attrs: isNew ? 'required minlength="6"' : '' })}</div>
    <div class="grid2">${field('Western alias (shown to customers)', 'alias', m.alias || '', { ph: 'e.g. Mark, Simon, Jasmin' })}${field('Payroll bank', 'bank', m.bank || '', { type: 'select', options: [['', '—'], ['CIH', 'CIH (MAD)'], ['IBAN', 'European IBAN'], ['US', 'US bank'], ['other', 'Other']] })}</div>
    ${field('Agent language (guide & alerts)', 'lang', m.lang || 'en', { type: 'select', options: [['en', '🇬🇧 English'], ['fr', '🇫🇷 Français'], ['de', '🇩🇪 Deutsch'], ['es', '🇪🇸 Español'], ['it', '🇮🇹 Italiano'], ['ar', '🇸🇦 العربية']] })}
    <p class="small muted" style="margin:-4px 0 10px">🔐 API keys (Resend…), email marketing, list uploads, SEO and ads open only for the owner and the <b>Technical Manager</b> role, whatever is ticked below.</p>
    ${field('Payroll account / IBAN', 'bankDetails', m.bankDetails || '', { attrs: 'autocapitalize="none"', ph: 'e.g. MA64 3508 0000 0001 2345 6789 01' })}
    ${field('Work email (support alerts & escalations)', 'notifyEmail', m.notifyEmail || '', { type: 'email', attrs: 'autocapitalize="none"', ph: 'agent@example.com', help: 'New tickets from the support page are emailed here when this member can see customers.' })}
    ${isNew ? toggle('Start as an unpaid 14-day trainee', 'trainee', true, 'Restricted to Customers (view), Attendance and Tasks until you promote them') : (m.traineeUntil && m.traineeUntil > Date.now() ? `<p class="notice warning" style="margin:6px 0">⏳ Trainee · ${Math.ceil((m.traineeUntil - Date.now()) / 86400000)} day(s) left · restricted access</p>` : '')}
    <h3>Role preset</h3>
    <div class="chips">${Object.keys(roles).map((k) => `<a data-act="preset" data-p="${esc(k)}">${esc(k)}</a>`).join('')}</div>
    <h3>Access</h3>
    ${groups}
    <p class="small muted">Owner-only access (data exports, call management, master Google Sheets) is never given to team members.</p>
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

const stripeSelect = (s, name, value, label = 'Stripe account', opts = {}) => field(label, name, value, {
  type: 'select', options: [...(opts.none === false ? [] : [['', '— not recorded —']]), ...((s.stripeAccounts || []).filter((a) => a.status === 'active').map((a) => [a.id, a.name || a.id]))],
});


// ---------------- finance ----------------
async function adminFinance(s) {
  const f = await api('GET', '/api/admin/finance');
  state.admin.finance = f;
  const tx = sortTxNewest(await api('GET', '/api/admin/tx' + (state.admin.txAccount ? '?account=' + state.admin.txAccount : '')));
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
    <div class="card"><div class="row" style="margin-bottom:8px"><h3 style="margin:0">Transactions${state.admin.txAccount ? ' · ' + esc(accName(state.admin.txAccount)) : ''}</h3><span class="spacer"></span>${state.admin.txAccount ? '<button class="btn sm" data-act="tx-filter" data-acc="">Show all</button>' : ''}<button class="btn sm" data-act="export-tx" data-perm="exports">⬇ CSV</button><button class="btn sm danger" data-act="clear-tx" data-perm="finance_edit" style="margin-left:8px">🗑 Clear all history</button></div>
      ${tx.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Account</th><th>Category / note</th><th style="text-align:right">Amount</th><th></th></tr></thead><tbody>${tx.map((x) => {
        const lk = balanceTxLink(x);
        return `<tr>
        <td class="small">${esc(txTimeLabel(x))}</td><td>${x.type === 'income' ? '🟢 in' : x.type === 'expense' ? '🔴 out' : '🔁 transfer'}</td>
        <td>${esc(accName(x.accountId))}${x.toAccountId ? ` → ${esc(accName(x.toAccountId))}` : ''}</td><td><b>${esc(x.category)}</b><div class="small muted">${esc(x.note)}</div>${lk.id ? `<a class="bank-tx-link" href="${esc(lk.url)}">${esc(lk.label)}</a>` : ''}</td>
        <td style="text-align:right;white-space:nowrap" class="${x.type === 'income' ? 'pos' : x.type === 'expense' ? 'neg' : ''}">${x.type === 'expense' ? '−' : x.type === 'income' ? '+' : ''}${num(x.amount, accCur(x.accountId))}${x.toAccountId ? `<div class="small muted">→ ${num(x.toAmount, accCur(x.toAccountId))}</div>` : ''}</td>
        <td><button class="btn sm ghost" data-act="del-tx" data-perm="finance_edit" data-id="${x.id}" title="Delete transaction" aria-label="Delete transaction">🗑</button></td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="muted">No transactions yet.</p>'}
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
const accRow = (a) => `<div class="acc-row" data-acc="${esc(a.id || '')}"><input data-k="name" value="${esc(a.name)}" placeholder="Name"><select data-k="currency">${['MAD', 'USD', 'USDT', 'EUR', 'THB'].map((c) => `<option ${a.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select><input data-k="opening" type="number" step="any" value="${a.opening || 0}"><input data-k="color" type="color" value="${esc(a.color || '#7c5cff')}"><button class="btn sm danger" data-act="del-acc" title="Remove account" aria-label="Remove account">✕</button></div>`;

async function loadStripe() {
  const box = $('#stripe-box'); if (!box) return;
  const r = await api('GET', '/api/admin/stripe/balance').catch(() => null);
  if (!r || !r.connected) return;
  if (r.error) { box.innerHTML = `<div class="notice danger">Stripe: ${esc(r.error)}</div>`; return; }
  const diff = Math.round((r.available + r.pending - r.app) * 100) / 100;
  box.innerHTML = `<div class="card" style="border-color:#635bff55"><div class="row"><h3 style="margin:0">💠 Stripe (live)</h3><span class="spacer"></span>${diff ? `<button class="btn sm primary" data-act="stripe-match" data-target="${r.available + r.pending}" data-perm="finance_edit">Sync app to Stripe</button>` : '<span class="pill st-active">in sync</span>'}</div>
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
    <div class="grid2">${stripeSelect(s, 'stripeAccountId', '')}
    ${field('Category', 'category', cats[0], { attrs: 'list="cats"' })}<datalist id="cats">${cats.map((c) => `<option value="${c}">`).join('')}</datalist>${field('Date', 'date', isoDay(Date.now()), { type: 'date' })}${field('Time (optional)', 'time', '', { type: 'time', attrs: 'step="1"', help: 'Leave empty for date-only history.' })}</div>
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
const STOCKF = { f: 'all' };
const payBadge = (x) => ({ paid: '<span class="badge ok">✓ Paid</span>', partial: '<span class="badge warn">◐ Partly paid</span>', unpaid: '<span class="badge bad">✗ Not paid</span>', nocost: '<span class="badge">No cost entered</span>' })[x.payStatus] || '';
async function adminStock(s) {
  const [st, team] = await Promise.all([api('GET', '/api/admin/stock?panel=1'), api('GET', '/api/admin/team').catch(() => [])]);
  STOCKF.team = (team || []).filter((m) => m.status !== 'disabled').map((m) => m.name || m.username); STOCKF.st = st;
  const owed = (st.owed || []).filter((o) => o.due > 0); const flt = STOCKF.f;
  const shown = st.purchases.filter((x) => flt === 'all' || (flt === 'unpaid' ? x.payStatus === 'unpaid' || x.payStatus === 'partial' : flt === 'paid' ? x.payStatus === 'paid' : flt === 'handed' ? !!x.handedTo : true));
  const nUnpaid = st.purchases.filter((x) => x.payStatus === 'unpaid' || x.payStatus === 'partial').length;
  const accName = (id) => (s.finance.accounts.find((a) => a.id === id) || {}).name || id || '—';
  const row = (x) => `<div class="list-item" style="align-items:flex-start"><span>🎟</span><div style="flex:1;min-width:0"><div class="row" style="gap:6px;flex-wrap:wrap"><b>${x.credits} credits</b> · ${esc(x.supplier)} ${payBadge(x)}${x.handedTo ? ` <span class="badge">👤 ${esc(x.handedTo)}</span>` : ''}</div>
      <div class="small muted">${fmtDate(x.at)} · cost ${num(x.cost, x.currency)}${x.cost ? ` (${usd(x.costUsd)})` : ''} · paid <b>${num(x.paid, x.currency)}</b>${x.due > 0 ? ` · <b style="color:var(--bad,#d33)">owed ${num(x.due, x.currency)}</b>` : ''}${x.note ? ' · ' + esc(x.note) : ''}</div>
      ${x.payments.length ? `<div class="small" style="margin-top:4px">${x.payments.map((y) => `💵 ${fmtDate(y.at)} · ${num(y.amount, x.currency)} from ${esc(accName(y.accountId))}${y.by ? ' · ' + esc(y.by) : ''} <a href="#" data-act="stock-unpay" data-id="${x.id}" data-pay="${y.id}" class="muted">undo</a>`).join('<br>')}</div>` : ''}</div>
      <div class="row" style="gap:4px;flex-wrap:wrap;justify-content:flex-end">${x.due > 0 || x.payStatus === 'nocost' ? `<button class="btn sm primary" data-act="stock-pay" data-id="${x.id}">💵 Pay</button>` : ''}<button class="btn sm" data-act="stock-edit" data-id="${x.id}">✏️ Edit / hand over</button><button class="btn sm ghost" data-act="del-stock" data-id="${x.id}" title="Delete purchase" aria-label="Delete purchase">🗑</button></div></div>`;
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
      ${field('Payment to the supplier', 'paid', 'yes', { type: 'select', options: [['yes', '✓ Paid now'], ['no', '✗ Not paid yet (owed)'], ['part', '◐ Partly paid']] })}
      <div id="stock-part" style="display:none">${field('Amount paid now', 'paidAmount', '', { type: 'number', attrs: 'step="any" min="0"' })}</div>
      ${accountSelect(s, 'accountId', s.finance.accounts.find((a) => a.currency !== 'MAD')?.id || '', 'Paid from (bank / wallet)')}
      <div class="grid2">${field('Supplier', 'supplier', 'TVplus')}${field('Date', 'date', isoDay(Date.now()), { type: 'date' })}</div>
      ${field('Hand over to (agent)', 'handedTo', '', { type: 'select', options: [['', '— nobody yet —'], ...STOCKF.team.map((n) => [n, n])] })}
      ${field('Note', 'note', '')}
      <button class="btn primary">Add to stock</button></form>
    <form class="card" data-form="settings"><h3>Stock settings</h3>
      <div class="grid2">${field('Credits per pack', 'stock.packCredits', pk.packCredits, { type: 'number' })}${field('Pack price (USD)', 'stock.packPrice', pk.packPrice, { type: 'number', attrs: 'step="any"' })}</div>
      ${field('Remind me when credits are at or below', 'stock.lowCreditsAlert', pk.lowCreditsAlert, { type: 'number', help: 'Shown on the dashboard, and emailed daily if set up in "Trial & email".' })}
      <button class="btn primary">Save</button></form></div>
    <div class="card" id="stock-owed"><h3>🧾 Supplier payments</h3>${owed.length ? owed.map((o) => `<div class="list-item"><span>🏭</span><div style="flex:1"><b>${esc(o.supplier)}</b><div class="small muted">${o.unpaidBatches} batch${o.unpaidBatches === 1 ? '' : 'es'} not fully paid · bought ${num(o.cost, o.currency)} · paid ${num(o.paid, o.currency)}</div></div><b style="color:var(--bad,#d33)">owed ${num(o.due, o.currency)}</b></div>`).join('') : '<p class="small" style="margin:0">✓ Nothing owed to suppliers.</p>'}</div>
    <div class="card"><div class="row" style="flex-wrap:wrap;gap:8px"><h3 style="margin:0">Purchases (credit batches)</h3><span class="spacer"></span><div class="chips">${[['all', 'All ' + st.purchases.length], ['unpaid', '✗ Not paid ' + nUnpaid], ['paid', '✓ Paid'], ['handed', '👤 Handed over']].map(([k, n]) => `<a data-act="stock-filter" data-f="${k}" class="${flt === k ? 'on' : ''}">${n}</a>`).join('')}</div></div>
    <div style="margin-top:10px">${shown.length ? shown.map(row).join('') : '<p class="muted">No purchases here.</p>'}</div></div>`;
}

// ---------------- trial & email ----------------
function adminTrial(s) {
  const tr = s.trial, e = s.email, tg = s.telegram || {};
  const tgLink = tg.botUsername ? 'https://t.me/' + tg.botUsername : '';
  return `<form data-form="settings"><div class="grid2" style="gap:16px;align-items:start">
    <div class="card"><h3>🎁 Free trial</h3>
      ${field('Who processes free trials?', 'trial.mode', tr.mode || 'auto', { type: 'select', options: [['auto', 'Automatic — a line is created (or taken from the pool) and the email is sent'], ['agents', 'All-agents queue — requests appear in Trial queue; any agent claims one, pastes the M3U and sends it']], help: 'The all-agents queue is for your team to handle. In queue mode nothing is auto-created.' })}
      ${toggle('Allow free trial sign-up on the login page', 'trial.enabled', tr.enabled, 'Customers enter name, email, phone and WhatsApp. One trial per email/phone.')}
      <div class="grid2" style="margin-top:10px">${field('Trial length (hours)', 'trial.hours', tr.hours, { type: 'number', attrs: 'min="1" max="168"' })}${field('Credits a trial uses', 'trial.credits', tr.credits, { type: 'number', attrs: 'min="0" step="any"' })}</div>
      <div class="grid2">${field('Trial package ID on panel', 'trial.package', tr.package, { help: 'Sent as {package} with the "trial" API action.' })}${field('Devices', 'trial.connections', tr.connections, { type: 'number', attrs: 'min="1"' })}</div>
      ${toggle('Also show the login on screen', 'trial.showCredentialsOnScreen', tr.showCredentialsOnScreen, 'If off, the login is only sent by email (stops fake emails). It is always shown if the email fails.')}
      <p class="small muted">The panel call for trials is the <b>trial</b> action in API settings.</p>
    </div>
    <div class="card"><h3>✉️ Email (Resend)</h3>
      ${field('Language of emails', 'email.lang', s.email.lang || 'en', { type: 'select', options: [['en', 'English for everyone'], ['fr', 'French for everyone'], ['de', 'German for everyone'], ['es', 'Spanish for everyone'], ['it', 'Italian for everyone'], ['customer', 'Each customer’s own language']], help: 'Used for login, trial, reminder, renewal, order and confirmation emails.' })}${field('Resend API key', 'email.resendKey', e.resendKey, { type: 'password', attrs: 'autocomplete="off"', ph: 're_…', help: 'From resend.com → API Keys. Stored on the server only.' })}
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
    <div class="card"><h3>✈️ Telegram (free-trial delivery)</h3>
      <p class="small muted" style="margin-top:0">Customers open your bot and press Start once; their Telegram is linked to their email/phone. Trials are then sent to them automatically, and every request is copied to your admin chat.</p>
      <div class="grid2">${field('Bot token', 'telegram.botToken', tg.botToken, { type: 'password', attrs: 'autocomplete="off"', ph: '123456789:AA…', help: 'From @BotFather → /newbot or /token. Stored on the server and masked after saving.' })}${field('Admin chat ID', 'telegram.adminChat', tg.adminChat, { attrs: 'autocapitalize="none"', ph: '123456789', help: 'Send /start to the bot, then open your admin Telegram copy or use the bot to find your chat ID.' })}</div>
      ${field('Webhook secret (automatic)', 'telegram.webhookSecret', tg.webhookSecret, { type: 'password', attrs: 'autocomplete="off"', help: 'Generated automatically and registered with Telegram by “Connect”. Leave as is.' })}
      ${toggle('Send trial logins automatically on Telegram', 'telegram.autoTrial', tg.autoTrial !== false, 'When the customer has linked their Telegram, the login is sent there as soon as it is created.')}
      ${toggle('Notify the admin chat', 'telegram.notifyAdmin', tg.notifyAdmin !== false, 'Copies every trial request and the customer login to your admin chat.')}
      <div class="row" style="margin-top:10px"><button type="button" class="btn primary" data-act="tg-connect">🔗 Connect &amp; set webhook</button><button type="button" class="btn" data-act="tg-test">Send test</button></div>
      <div id="tg-out" class="small muted" style="margin-top:8px"></div>
      ${tgLink ? `<p class="small" style="margin:10px 0 0">Customer link: <a href="${esc(tgLink)}" target="_blank" rel="noopener">${esc(tgLink)}</a>${tg.enabled ? ' · connected' : ' · not connected'}</p>` : ''}
    </div>
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

async function renderTermsScreen() {
  const me = state.user.me; const wb = (me && me.branding) || state.config.branding;
  if (wb) setWaFab(wb, t('waMsg', { app: wb.appName, u: me?.user?.username || '' }));
  const b = (me && me.branding) || state.config.branding;
  const closeLink = `<div class="login-foot"><a data-act="logout">${t('logout')}</a></div>`;
  const termsHtml = `<style>.terms-doc{max-height:340px;overflow:auto;padding:12px 4px;text-align:start;font-size:13px;line-height:1.55;color:var(--text)}</style>
  <div class="terms-doc"><p><b>INTPROTO-TV — Terms of Service</b></p>
  <p><b>1. The service.</b> Intproto-TV (“the Service”) provides access to live TV, movies, and series on the devices included in your subscription. The Service is provided “as is”. We may change channel availability and content at any time.</p>
  <p><b>2. Accounts.</b> One account, one household, personal use only. Sharing credentials, reselling access, or using the Service for public performance is forbidden and may lead to suspension.</p>
  <p><b>3. Free trial.</b> One 24-hour free trial per person. Repeated trial requests may be refused. The trial ends automatically; it does not charge you anything.</p>
  <p><b>4. Payment and renewal.</b> Subscriptions are prepaid and end on the expiry date unless renewed. Renewal links are sent privately (WhatsApp / Telegram / email) only after payment confirmation. You must use renewal links sent to you by the Service; links found elsewhere may be invalid.</p>
  <p><b>5. Refunds.</b> All payments are final. Refunds are at our absolute discretion and only granted where the Service could not be used at all.</p>
  <p><b>6. Acceptable use.</b> You agree to use the Service in compliance with the laws of your country. We may suspend accounts used in violation of these terms.</p>
  <p><b>7. Data.</b> We store your account details, subscription history, and support messages on servers we control. We do not sell your data. We send account, service and marketing emails; marketing emails include an unsubscribe link.</p>
  <p><b>8. Contact.</b> Support is available in-app (chat, tickets) and on WhatsApp / Telegram in the app. We answer within one working day.</p>
  <p><b>9. Changes.</b> We may update these terms; the version in the app is always current. Continued use means acceptance.</p></div>`;
  $('#app').innerHTML = `<div class="block-screen"><div class="ic">📜</div><h2>Terms of Service</h2><p class="muted" style="max-width:460px">Please read and accept the terms to continue using ${esc(b.appName || 'INTPROTO-TV')}.</p>${termsHtml}
    <button class="btn primary" data-act="terms-agree" style="margin-top:10px">✓ I Agree — continue</button>
    ${closeLink}</div>`;
}
// ---- the customer's device (Samsung, iPhone…) is sent once per session so the team knows what they use ----
async function reportDevice() {
  try { if (sessionStorage.getItem('tvp_dev_sent')) return; let model = '';
    try { if (navigator.userAgentData?.getHighEntropyValues) model = (await navigator.userAgentData.getHighEntropyValues(['model'])).model || ''; } catch {}
    await api('POST', '/api/me/device', { ua: navigator.userAgent, model, touch: navigator.maxTouchPoints > 1, app: isStandalone() }); sessionStorage.setItem('tvp_dev_sent', '1'); } catch {}
}
// ---- notifications sent by the team, shown in the app (and on the phone if notifications are on) ----
function inboxCard(list) {
  const L = (list || []).slice(0, 5); if (!L.length) return '';
  const unread = L.filter((n) => !n.read).length; if (unread) setTimeout(() => api('POST', '/api/me/inbox/read').then(() => { (state.user.me.inbox || []).forEach((n) => { n.read = n.read || Date.now(); }); }).catch(() => {}), 1500);
  return `<div class="card inbox-card" id="inbox" style="margin-bottom:12px"><h3 style="margin-top:0">🔔 ${esc(t('notifInbox'))}${unread ? ` <span class="pill st-expiring">${unread} ${esc(t('notifNew'))}</span>` : ''}</h3>
    ${L.map((n) => `<div class="list-item" style="align-items:flex-start${n.read ? ';opacity:.75' : ''}"><div style="flex:1"><b>${esc(n.title)}</b>${n.body ? `<div class="small" style="white-space:pre-wrap">${esc(n.body)}</div>` : ''}<div class="small muted">${fmtDT(n.at)}</div></div>${n.read ? '' : '<span class="dot-new" style="width:8px;height:8px;border-radius:50%;background:var(--accent,#0ea5e9);margin-top:6px"></span>'}</div>`).join('')}</div>`;
}
async function renderUser() {
  reportDevice(); goAfterRender();
  const u = state.user;
  if (u.me && u.me.agreed === false) return renderTermsScreen();
  if (u.me && Date.now() - (u.meAt || 0) > 15000) { try { const fresh = await api('GET', '/api/me'); if (JSON.stringify(fresh.stream) !== JSON.stringify('_stream' in u.me ? u.me._stream : u.me.stream)) u.cache = {}; u.me = fresh; u.meAt = Date.now(); applySource(); } catch { return; } }
  if (!u.me) {
    $('#app').innerHTML = `<div class="boot"><div class="spinner"></div></div>`;
    try { u.me = await api('GET', '/api/me'); u.meAt = Date.now(); state.myCur = u.me.myCurrency || ''; applySource(); reportDevice(); }
    catch (e) {
      const msg = String(e.message || '');
      if (msg.includes('terms_required')) return renderTermsScreen(); // first open: must accept the terms
      __diagSend({ kind: 'me-fail', msg: msg.slice(0, 200) });
      $('#app').innerHTML = `<div class="block-screen"><div class="ic">📡</div><h2>Can’t reach INTPROTO-TV</h2><p class="muted" style="max-width:320px">${esc(msg || 'Session expired or server unreachable.')}</p><button class="btn primary" onclick="location.reload()">Retry</button><button class="btn ghost" onclick="localStorage.removeItem('tvp_token');location.reload()">Sign in again</button></div>`;
      return;
    }
    applyBranding(u.me.branding);
    if (u.me.agreed === false) return renderTermsScreen();
  }
  const { user, dashboard: d, branding: b } = u.me;
  setChatFab(u.me.chatUnread || 0);
  if (state.justPaid) { const how = state.justPaid; state.justPaid = null; setTimeout(() => modal(how === 'done' ? '✅ ' + t('paidTitle') : '💳 ' + t('paidBackTitle'), `<p>${how === 'done' ? t('paidText') : t('paidBackText')}</p><div class="row"><button class="btn primary" data-act="close-modal" style="flex:1">OK</button><button class="btn" data-act="rc-new" style="flex:1">🧾 ${t('rcBtn')}</button></div>`), 400); }
  const tabs = [['home', ic('home'), t('home')], ['account', ic('user'), t('account')]];
  if (u.tab !== 'home' && u.tab !== 'account') u.tab = 'home';
  $('#app').innerHTML = `<div class="uapp"><div class="uhead">${brandHtml(b, false)}<span class="spacer"></span>${state.mode === 'demo' ? '<span class="badge-demo">Demo</span>' : ''}<button class="btn sm ghost" data-act="theme" title="Theme" aria-label="Change theme" style="font-size:18px">🌗</button><div class="avatar" data-act="utab" data-tab="account" style="cursor:pointer">${esc(initials(user.name))}</div>${logoutBtn()}</div>
    <main class="ubody" id="main"></main>
    <nav class="bnav">${tabs.map(([k, ic, n]) => `<a class="${u.tab === k ? 'on' : ''}" ${u.tab === k ? 'aria-current="page"' : ''} data-act="utab" data-tab="${k}"><span class="ic">${ic}</span>${n}</a>`).join('')}<div class="bnav-tail"><button class="bnav-sup" data-act="goto-acc" data-to="acc-plans"><span class="ic">${ic('card')}</span>${t('managePlan')}</button><button class="bnav-sup" data-act="ticket-new"><span class="ic">${ic('chat')}</span>${t('contactSup')}</button></div></nav></div>`;
  renderUserTab();
}

async function renderProfile() {
  const u = state.user; reportDevice(); goAfterRender();
  if (u.me && u.me.agreed === false) return renderTermsScreen();
  if (!u.me) {
    $('#app').innerHTML = `<div class="boot"><div class="spinner"></div></div>`;
    try { u.me = await api('GET', '/api/me'); u.meAt = Date.now(); state.myCur = u.me.myCurrency || ''; reportDevice(); }
    catch (e) {
      const msg = String(e.message || '');
      if (msg.includes('terms_required')) return renderTermsScreen();
      $('#app').innerHTML = `<div class="block-screen"><div class="ic">📡</div><h2>Can’t reach ${esc(state.config?.branding?.appName || 'INTPROTO-TV')}</h2><p class="muted" style="max-width:320px">${esc(msg || 'Session expired or server unreachable.')}</p><button class="btn primary" onclick="location.reload()">Retry</button><button class="btn ghost" data-act="logout">Sign in again</button></div>`;
      return;
    }
  }
  const { user, branding: b } = u.me;
  applyBranding(b);
  setWaFab(b, t('waMsg', { app: b.appName, u: user.username }));
  if (user.isTrial) {
    $('#app').innerHTML = `<div class="block-screen"><div class="ic">🎁</div><h2>${t('pf_paidOnly')}</h2><p class="muted" style="max-width:430px"><b>${esc(b.appName || 'INTPROTO-TV')} /profile</b> — ${t('pf_paidOnlyTxt')}</p><div class="row" style="justify-content:center"><a class="btn primary" href="/">${t('pf_openTrial')}</a>${b.supportUrl ? `<a class="btn" href="${esc(waNum(b) ? waUrl(b, t('waMsg', { app: b.appName, u: user.username })) : b.supportUrl)}" target="_blank" rel="noopener">Get a paid plan</a>` : ''}</div></div>`;
    return;
  }
  $('#app').innerHTML = profilePage();
}

function profilePage() {
  const me = state.user.me; const { user, branding: b } = me; const st = me.stream || {};
  const ibo = st.ibo || null; const lines = Array.isArray(st.lines) ? st.lines : [];
  const dns = String(st.dns || st.server || '').replace(/\/+$/, '');
  const uname = st.u || '—', pass = st.p || '—';
  const m3u = String(st.m3u || '').trim() || (dns && st.u && st.p ? dns + '/get.php?username=' + encodeURIComponent(st.u) + '&password=' + encodeURIComponent(st.p || '') + '&type=m3u_plus&output=ts' : '—');
  const days = user.noExpiry ? '∞' : Math.max(0, Number(user.daysLeft) || 0);
  const pct = Math.max(0, Math.min(100, (Number(user.daysLeft) || 0) / (Number(user.planDays) || 30) * 100));
  const row = (label, value, key) => `<li><span class="cred-k">${label}</span><b class="cred-v" id="pf-${key}" dir="ltr" style="word-break:break-all">${esc(value)}</b><button class="btn sm ghost svc-c" data-act="copy-el" data-el="pf-${key}" aria-label="Copy ${label}" title="Copy">⧉</button></li>`;
  const all = `Username: ${uname}\nPassword: ${pass}\nDNS: ${dns || '—'}\nM3U: ${m3u}${ibo?.mac ? `\nDevice MAC Address: ${ibo.mac}` : ''}${ibo?.key ? `\nDevice Key: ${ibo.key}` : ''}`;
  const color = user.state === 'expired' ? '#ef4444' : user.state === 'expiring' ? '#f59e0b' : '#22c55e';
  return `<div class="uapp"><div class="uhead">${brandHtml(b, false)}<span class="spacer"></span>${logoutBtn()}</div>
    <div class="ubody" style="max-width:760px;margin:0 auto;padding:14px">
      ${customerImportantNotice()}
      ${inboxCard(state.user.me?.inbox)}
      <div class="card">
        <div class="row"><h2 style="margin:0">${t('pf_balance')}</h2><span class="spacer"></span>${pill(user.state)}</div>
        <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-end;margin-top:14px">
          <div><div class="muted small">${t('pf_daysLeft')}</div><b style="font-size:2.6rem;line-height:1" id="pf-days">${days}</b></div>
          <div><div class="muted small">${t('pf_plan')}</div><b>${esc(pkgName(user.planName) || t('w_custom'))}</b></div>
          <div><div class="muted small">${t('pf_expires')}</div><b>${fmtDate(user.expiresAt)}</b></div>
          <div><div class="muted small">${t('pf_devices')}</div><b>${esc(user.devicesTotal || user.connections || 1)}</b></div>
        </div>
        <div style="height:8px;border-radius:6px;background:var(--line,#e2e8f0);overflow:hidden;margin-top:14px"><i style="display:block;height:100%;width:${pct}%;background:${color}"></i></div>
        ${user.state === 'expired' ? `<p class="small" style="color:#ef4444;margin:10px 0 0">${t('pf_expired')}</p>` : user.state === 'expiring' ? `<p class="small" style="color:#b45309;margin:10px 0 0">${t('pf_ending')}</p>` : ''}
      </div>
      <div class="card" id="acc-sources" style="margin-top:14px">
        <div class="row" style="gap:8px;margin-bottom:8px"><h3 style="margin:0;flex:1">${lines.length ? t('pf_conn', { n: 1 }) : t('pf_details')}</h3>${lines.length || st.lineType ? `<span class="pill st-open">${esc(connName(st.lineType))}</span>` : ''}${lines.length ? `<span class="small muted">${esc(user.connections || 1)} ${t('pf_devs')}</span>` : ''}</div>
        <div class="svc-box creds"><ul class="cred-list">${row(t('pf_user'), uname, 'u')}${row(t('pf_pass'), pass, 'p')}${row('DNS', dns || '—', 'dns')}${row('M3U', m3u, 'm3u')}${ibo?.mac ? row(t('pf_mac'), ibo.mac, 'mac') : ''}${ibo?.key ? row(t('pf_key'), ibo.key, 'key') : ''}</ul>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-act="copy-el" data-el="pf-all">${t('copyAll')}</button></div><div id="pf-all" style="display:none">${esc(all)}</div>
        ${ibo?.mac || ibo?.key ? `<p class="small muted" style="margin:10px 0 0">📺 ${t('pf_iboReg')}</p>` : ''}
        </div>
      </div>
      ${lines.map((x, i) => { const k = 'c' + i; const txt = [x.u && `Username: ${x.u}`, x.p && `Password: ${x.p}`, x.dns && x.u && `DNS: ${x.dns}`, x.m3u && `M3U: ${x.m3u}`].filter(Boolean).join('\n');
        return `<div class="card" style="margin-top:14px"><div class="row" style="gap:8px;margin-bottom:8px"><h3 style="margin:0;flex:1">${t('pf_conn', { n: i + 2 })}${x.label ? ' · ' + esc(x.label) : ''}</h3><span class="pill st-open">${esc(x.typeName || connName(x.type))}</span><span class="small muted">${esc(x.devices || 1)} ${t('pf_devs')}</span></div>
        <div class="svc-box creds"><ul class="cred-list">${x.u ? row(t('pf_user'), x.u, k + 'u') + row(t('pf_pass'), x.p || '—', k + 'p') : ''}${x.dns && x.u ? row('DNS', x.dns, k + 'dns') : ''}${row('M3U', x.m3u || '—', k + 'm3u')}</ul>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-act="copy-el" data-el="pf-${k}all">${t('copyAll')}</button></div><div id="pf-${k}all" style="display:none">${esc(txt)}</div></div></div>`; }).join('')}
      <div class="row" style="margin-top:14px"><a class="btn primary" href="/" style="flex:1">📺 ${t('pf_openTv')}</a>${waNum(b) ? `<a class="btn wa-btn" href="${esc(waUrl(b, t('waMsg', { app: b.appName, u: user.username })))}" target="_blank" rel="noopener" style="flex:1">💬 ${t('whatsapp')}</a>` : ''}</div>
      <p class="small muted" style="text-align:center;margin:14px 0 0">${t('pf_signedAs')} <b>${esc(user.username)}</b> · <a href="#" data-act="logout">${t('logout')}</a></p>
    </div></div>`;
}

function blockedScreen() {
  const body = blockedScreenBody();
  return body ? customerImportantNotice() + body : '';
}
function blockedScreenBody() {
  const { user, dashboard: d, branding: b } = state.user.me;
  if (d.maintenance) return `<div class="block-screen"><div class="ic">🛠</div><h2>${t('maintTitle')}</h2><p class="muted">${esc(d.maintenanceMessage)}</p></div>`;
  if (user.state === 'expired') return `<div class="block-screen"><div class="ic">⏰</div><h2>${t('expiredTitle')}</h2><p class="muted">${t('expiredText', { date: fmtDate(user.expiresAt) })}</p>${b.supportUrl ? `<a class="btn primary ${waNum(b) ? 'wa-btn' : ''}" href="${esc(waNum(b) ? waUrl(b, t('waMsg', { app: b.appName, u: user.username })) : b.supportUrl)}" target="_blank" rel="noopener">${waNum(b) ? '💬 ' + t('whatsapp') : esc(b.supportLabel || t('support'))}</a>` : ''}</div>${orderCard()}`;
  if (state.user.me.user.lineBad && state.user.me.user.state !== 'expired') return `<div class="block-screen"><div class="ic">📡</div><h2>${t('lineBadTitle')}</h2><p class="muted">${t('lineBadText')}</p><div class="row" style="justify-content:center"><button class="btn primary" data-act="chat-open">🗨 ${t('chatT')}</button>${waNum(state.user.me.branding) ? `<a class="btn wa-btn" href="${esc(waUrl(state.user.me.branding, t('waMsg', { app: state.user.me.branding.appName, u: state.user.me.user.username })))}" target="_blank" rel="noopener">💬 ${t('whatsapp')}</a>` : ''}</div></div>`;
  if (state.user.me.user.pendingLine) return `<div class="block-screen"><div class="ic">⏳</div><h2>${t('pendingTitle')}</h2><p class="muted">${t('pendingText')}</p>${waNum(state.user.me.branding) ? `<a class="btn wa-btn" href="${esc(waUrl(state.user.me.branding, t('waMsg', { app: state.user.me.branding.appName, u: state.user.me.user.username })))}" target="_blank" rel="noopener">💬 ${t('whatsapp')}</a>` : ''}</div>`;
  if (!state.user.me.stream) return `<div class="block-screen"><div class="ic">📡</div><h2>${t('notReady')}</h2><p class="muted">${t('notReadyText')}</p></div>`;
  return '';
}

async function renderUserTab() {
  if (state.user.me) setWaFab(state.user.me.branding, t('waMsg', { app: state.user.me.branding.appName, u: state.user.me.user.username }));
  const u = state.user; const el = $('#main');
  const { user, dashboard: d, branding: b } = u.me;
  if (u.tab === 'home') {
    const renew = b.supportUrl ? `<a href="${esc(b.supportUrl)}" target="_blank" rel="noopener">${t('renewNow')}</a>` : t('contactRenew');
    const trialLeft = user.isTrial && user.state !== 'expired';
    pullNativePos();
    el.innerHTML = `<div class="cinema">${state.user.me.branding.logoUrl ? `<img class="cinema-logo" src="${esc(state.user.me.branding.logoUrl)}" alt="">` : `<div class="cinema-mark">${esc((state.user.me.branding.appName || 'INTPROTO-TV').slice(0, 2).toUpperCase())}</div>`}<div class="cinema-text"><span class="cinema-eyebrow">${t('overview')}</span><h2 class="cinema-title">${esc(state.user.me.branding.appName || 'INTPROTO-TV')}</h2><p class="cinema-h">${t('hello', { name: esc(user.name.split(' ')[0]) })}</p></div><div class="cinema-watermark">$${esc((state.user.me.branding.appName || 'INTPROTO').slice(0, 4))}</div></div>
      ${customerImportantNotice()}
      ${d.maintenance ? `<div class="notice warning">🛠 ${esc(d.maintenanceMessage)}</div>` : ''}
      ${d.announcement ? `<div class="notice ${esc(d.announcementType)}">📣 ${esc(d.announcement)}</div>` : ''}
      ${trialLeft ? `<div class="notice info">🎁 ${t('trialEnds', { n: user.hoursLeft })} ${renew}</div>` : ''}
      ${user.state === 'expiring' && !user.isTrial ? `<div class="notice warning">⏳ ${t('expiringSoon', { n: user.daysLeft })} ${renew}</div>` : ''}
      ${user.state === 'expired' ? `<div class="notice danger">⏰ ${t('expiredOn', { date: fmtDate(user.expiresAt) })} ${renew}</div>` : ''}
      ${srcBanner()}
      ${inboxCard(u.me.inbox)}
      <div class="dash">
        ${d.showSubscription ? `<div class="dash-plan" data-act="utab" data-tab="account" tabindex="0"><div class="dp-top"><div><span class="dp-l">${t('activePlan')}</span><b>${esc(user.isTrial ? t('trial') : pkgName(user.planName))}</b></div><div class="dp-r"><span class="dp-l">${t('expiresOn')}</span><b>${fmtDate(user.expiresAt)}</b></div></div>
          <div class="dp-days"><span class="big">${user.noExpiry ? '∞' : user.isTrial ? user.hoursLeft : Math.max(0, user.daysLeft)}</span><span class="muted small">${user.isTrial ? t('hoursLeft') : t('daysLeft')}</span><span class="spacer"></span>${pill(user.state)}</div>${progress(user)}</div>` : ''}
        <div class="dash-mini" data-act="goto-acc" data-to="acc-devices" tabindex="0"><span class="chip-ic ok">${ic('devices')}</span><div><span class="dp-l">${t('connectedDev')}</span><b id="dash-dev">– / ${esc(user.connections)}</b></div></div>
        <div class="dash-mini" data-act="goto-acc" data-to="acc-tickets" tabindex="0"><span class="chip-ic">${ic('chat')}</span><div><span class="dp-l">${t('supportT')}</span><b id="dash-tk">–</b></div></div>
      </div>
      <h3>${t('quick')}</h3>
      <div class="quick"><a data-act="utab" data-tab="account" tabindex="0">${ic('card')}<span>${t('managePlan')}</span></a><a data-act="goto-acc" data-to="acc-devices" tabindex="0">${ic('devices')}<span>${t('devicesT')}</span></a><a data-act="ticket-new" tabindex="0">${ic('chat')}<span>${t('contactSup')}</span></a>${d.ownPlaylists !== false ? `<a data-act="goto-acc" data-to="acc-sources" tabindex="0">${ic('list')}<span>${t('srcT')}</span></a>` : ''}</div>
      ${user.isTrial || user.state !== 'active' ? plansCard() : ''}`;
    loadDashCounts();
    return;
  }
  if (u.tab === 'account') {
    el.innerHTML = `${customerImportantNotice()}<div class="card"><div class="row"><div class="avatar" style="width:52px;height:52px;font-size:20px">${esc(initials(user.name))}</div><div><h2 style="margin:0">${esc(user.name)}</h2><div class="muted">${esc(user.username)}</div></div></div>
        ${user.email ? `<div class="list-item" style="margin-top:12px"><span style="flex:1;min-width:0;overflow-wrap:anywhere" dir="ltr">${esc(user.email)}</span>${user.emailVerified ? `<span class="pill st-active">${t('emVerified')}</span>` : `<button class="btn sm primary" data-act="em-send">${t('emVerify')}</button>`}</div>` : ''}</div>
      <div class="card"><h3>${t('mySub')}</h3><div class="list-item"><span style="flex:1">${t('status')}</span>${pill(user.state)}</div><div class="list-item"><span style="flex:1">${t('plan')}</span><b>${esc(user.isTrial ? t('trial') : pkgName(user.planName))}</b></div><div class="list-item"><span style="flex:1">${t('linesN')}</span><b>${user.connections}</b></div><div class="list-item"><span style="flex:1">${t('started')}</span><b>${fmtDate(user.startAt)}</b></div><div class="list-item"><span style="flex:1">${t('expires')}</span><b>${fmtDate(user.expiresAt)}</b></div>${(state.user.me.totalPaidUsd || 0) > 0 ? `<div class="list-item"><span style="flex:1">${t('totalPaid')}</span><b>$${Number(state.user.me.totalPaidUsd).toFixed(2)}</b></div>` : ''}
        ${(user.renewals || []).length ? `<h3 style="margin-top:14px">${t('history')}</h3>${user.renewals.slice().reverse().map((r) => `<div class="list-item small"><span style="flex:1">${r.type === 'renew' ? t('renewed') : r.type === 'trial' ? t('trial') : t('startedOn')} · ${fmtDate(r.at)}</span><span dir="ltr">+${r.type === 'trial' ? '24h' : r.days + 'd'}</span></div>`).join('')}` : ''}</div>
      ${plansCard()}
      ${(giftCard() || referralCard()) ? `<div class="grid2">${giftCard()}${referralCard()}</div>` : ''}
      <div class="card" id="acc-devices"><h3>${t('devicesT')}</h3><p class="muted small">${t('loadingDots')}</p></div>
      <div class="card" id="acc-tickets"><div class="row"><h3 style="margin:0;flex:1">${t('supportT')}</h3><button class="btn sm primary" data-act="ticket-new">＋ ${t('newTicket')}</button></div><p class="muted small">${t('loadingDots')}</p></div>
      <div class="card" id="acc-payments"><h3>${t('paymentsT')}</h3><p class="muted small">${t('loadingDots')}</p></div>
      <div class="card"><h3>${t('tfaT')}</h3><p class="muted small" style="margin-top:0">${user.twoFactor ? t('tfaOnText') : t('tfaText')}</p>${user.twoFactor ? `<span class="pill st-active">${t('tfaOn')}</span> <button class="btn sm" data-act="utfa-off" style="margin-inline-start:8px">${t('turnOff')}</button>` : `<button class="btn primary" data-act="utfa-setup">${t('turnOn')}</button>`}</div>
      ${sourcesCard()}
      <div class="card" id="acc-guide"><h3>${t('userGuide')}</h3><ol class="guide-ol"><li>${t('gStep1')}</li><li>${t('gStep2')}</li><li>${t('gStep3')}</li><li>${t('gStep4')}</li></ol></div>
      ${pushBox(false)}
      ${parentalCard()}
      <div class="card"><h3>${t('language')}</h3><div class="tr-langrow"><div><b>${langFlag(getLang())} ${langName(getLang())}</b><div class="small muted">${esc(t('chooseLang'))}</div></div><button class="btn" data-act="lang-center">🌐 ${t('language')}</button></div></div>
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
      ${kind === 'live' && d.epg && !state.user.me.stream?.m3u && mapped.length ? `<div class="seg" role="tablist"><button role="tab" aria-selected="${u.guide ? 'false' : 'true'}" class="${u.guide ? '' : 'on'}" data-act="guide-mode" data-on="">${ic('tv', 18)} ${t('channelsV')}</button><button role="tab" aria-selected="${u.guide ? 'true' : 'false'}" class="${u.guide ? 'on' : ''}" data-act="guide-mode" data-on="1">${ic('clock', 18)} ${t('tvGuide')}</button></div>` : ''}
      <div id="items">${mapped.length ? (kind === 'live' && u.guide && d.epg ? guideHtml(mapped.slice(0, Math.min(u.limit, 40))) : itemsGrid(mapped.slice(0, u.limit))) : `<div class="empty"><span class="ic">🔍</span>${t('nothing')}</div>`}</div>
      ${mapped.length > u.limit ? `<div style="text-align:center;margin:16px"><button class="btn" data-act="more">${t('more', { n: mapped.length - u.limit })}</button></div>` : ''}`;
    if (kind === 'live' && u.guide && d.epg && mapped.length) fillGuide(mapped.slice(0, Math.min(u.limit, 40)));
  } catch (e) { if (e.switching) return; el.innerHTML = e.direct ? appsCard() : `<div class="err-box">⚠️ ${esc(e.message)}</div>${e.line ? `<div class="card">${state.user.me.branding.supportUrl ? `<a class="btn primary" href="${esc(state.user.me.branding.supportUrl)}" target="_blank" rel="noopener">💬 ${t('support')}</a>` : ''} <button class="btn" data-act="retry">⟳ ${t('retry')}</button></div>` : `<button class="btn" data-act="retry">⟳ ${t('retry')}</button>`}`; }
}

// Browser direct: on the http:// address the browser itself loads the IPTV server (it allows CORS).
const httpOK = () => location.protocol === 'http:';
const canSwitchHttp = () => location.protocol === 'https:' && !/github\.io$|localhost|127\.0\.0\.1/.test(location.hostname) && !localStorage.getItem('tvp_nohttp');
function goHttp(tab) {
  const el = $('#main'); if (el) el.innerHTML = `<div class="block-screen"><div class="spinner"></div><p class="muted">${t('openingPlayer')}</p></div>`;
  location.href = `http://${location.host}${location.pathname}#s=${encodeURIComponent(state.token)}&tab=${tab || state.user.tab}&lang=${getLang()}`;
}
// Direct mode: the device itself talks to the IPTV server (Android app bridge).
const bridge = () => window.IPTVBridge;
const isDirect = () => state.user.me?.stream?.mode === 'direct' || (!!bridge() && !!state.user.me?.stream);
window.__bcb = {};
window.addEventListener('message', (e) => { if (e.origin !== location.origin && e.origin !== 'null') return; if (e.data && e.data.__iptv && window.__bridgeCb) window.__bridgeCb(e.data.id, e.data.status, e.data.body); });
window.__bridgeCb = (id, status, body) => { const p = window.__bcb[id]; delete window.__bcb[id]; if (!p) return; status >= 200 && status < 300 ? p.res(body) : p.rej(Object.assign(new Error(status === 403 ? 'The server refused the connection (403).' : t('srvCode', { n: status })), { status })); };
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
    const fail = (r, msg) => Object.assign(new Error(msg || t('srvCode', { n: r.status })), { status: r.status });
    // one try, by the best route this device has
    const once = async () => {
      if (bridge()) return bridgeFetch(url, st.userAgent);
      if (httpOK()) {
        const r = await fetch(url).catch(() => null);
        if (!r) throw Object.assign(new Error(t('lineBad')), { net: true });
        if (!r.ok) throw fail(r, r.status === 403 ? t('lineInactive') : '');
        return r.text();
      }
      if (st.relay) { // secure relay: works in every browser (the free relay may need ~1 min to wake up)
        let r = null;
        for (let i = 0; i < 3 && !r; i++) { r = await fetch(`${st.relay}/x?u=${encodeURIComponent(url)}&t=${encodeURIComponent(st.proxyToken)}`).catch(() => null); if (!r) await new Promise((ok) => setTimeout(ok, 4000)); }
        if (!r) throw Object.assign(new Error(t('relayDown')), { net: true });
        if (!r.ok) throw fail(r, r.status === 403 ? t('relayDown') : '');
        return r.text();
      }
      if (canSwitchHttp()) { goHttp(); throw Object.assign(new Error('switching'), { switching: true }); }
      throw Object.assign(new Error('direct'), { direct: true });
    };
    // Servers sometimes answer a busy or protection code (5xx, like 512) when asked too fast: wait and ask again, twice.
    let txt, lastErr;
    for (let i = 0; i < 3 && txt === undefined; i++) {
      try { txt = await once(); } catch (e) { lastErr = e; if (e.switching || e.direct || !(e.status >= 500 || e.status === 429)) break; await new Promise((ok) => setTimeout(ok, 900 * (i + 1))); }
    }
    // Last route: ask through the app's own server.
    if (txt === undefined && !lastErr.switching && !lastErr.direct && !st.custom && (lastErr.status >= 500 || lastErr.net)) {
      try { const d = await api('GET', '/api/xtream?' + q); return (c[key] = d); } catch {}
    }
    if (txt === undefined) { reportPlayErr(action, lastErr); throw lastErr; }
    let data; try { data = JSON.parse(txt); } catch { reportPlayErr(action, { message: 'not JSON' }); throw new Error(t('lineBad')); }
    if (data && data.user_info && Number(data.user_info.auth) === 0) throw Object.assign(new Error(t('lineInactive')), { line: true });
    if (action.startsWith('get_') && action.endsWith('categories') && !Array.isArray(data)) throw Object.assign(new Error(t('lineInactive')), { line: true });
    return (c[key] = data);
  }
  return (c[key] = await api('GET', '/api/xtream?' + q));
}
const CUR = { EUR: '€', USD: '$', USDT: '₮', MAD: 'MAD ', THB: 'THB ' };
const logoutBtn = () => `<button type="button" class="btn sm logout-btn" data-act="logout" aria-label="${esc(t('logout'))}">🚪 <span>${esc(t('logout'))}</span></button>`;
// Package names in the customer's language: "3 Months", "4 Devices · 1 Year", "IBO Player · 1 Year (2 Devices)", "IBO Player · Lifetime"
function pkgName(title) {
  const x = String(title || ''); const mo = (n) => t(Number(n) === 1 ? 'w_month' : 'w_months', { n }); const yr = (n) => t(Number(n) === 1 ? 'w_year' : 'w_years', { n }); const dv = (n) => t('w_devices', { n });
  let m;
  if ((m = x.match(/^(\d+)\s*Months?$/i))) return mo(m[1]);
  if ((m = x.match(/^(\d+)\s*Years?$/i))) return yr(m[1]);
  if ((m = x.match(/^(\d+)\s*Devices?\s*·\s*(\d+)\s*Years?$/i))) return dv(m[1]) + ' · ' + yr(m[2]);
  if ((m = x.match(/^IBO Player\s*·\s*(\d+)\s*Years?(?:\s*\((\d+)\s*Devices?\))?$/i))) return 'IBO Player · ' + yr(m[1]) + (m[2] ? ' (' + dv(m[2]) + ')' : '');
  if (/^IBO Player\s*·\s*Lifetime$/i.test(x)) return 'IBO Player · ' + t('w_lifetime');
  if ((m = x.match(/^(\d+)\s*credits?$/i))) return t('w_credits', { n: m[1] });
  if (/^⭐\s*Lifetime activation$/i.test(x)) return '⭐ ' + t('w_lifeAct');
  return x;
}
const priceTxt = (n, c0) => { const c = (state.role === 'user' && state.myCur) || c0; return priceTxt0(n, c); };
const priceTxt0 = (n, c) => (c === 'MAD' ? `${n} MAD` : `${CUR[c] || ''}${Number(n).toFixed(2)}${CUR[c] ? '' : ' ' + c}`);
const WA_SVG = '<svg viewBox="0 0 32 32" width="30" height="30" fill="#fff" aria-hidden="true"><path d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.5.7 4.8 1.9 6.8L3 29l6.8-2.2c1.9 1 4 1.6 6.2 1.6 7 0 12.7-5.7 12.7-12.7S23 3 16 3zm0 23.1c-2 0-3.9-.6-5.6-1.6l-.4-.2-4 1.3 1.3-3.9-.3-.4c-1.1-1.7-1.7-3.7-1.7-5.7C5.3 9.8 10.1 5 16 5s10.7 4.8 10.7 10.7S21.9 26.1 16 26.1zm5.9-8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1c-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2s0-.5.1-.6l.5-.6c.2-.2.2-.4.3-.6s0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4s-1.2 1.1-1.2 2.7 1.2 3.2 1.4 3.4 2.4 3.6 5.7 5c.8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5s.3-1.4.2-1.5-.3-.2-.6-.4z"/></svg>';
const waNum = (b, use) => { const L = state.config?.waNumbers || []; const w = use && L.find((x) => x.use === use); return String((w && w.number) || b?.whatsapp || (/wa\.me\/(\d+)/.exec(b?.supportUrl || '') || [])[1] || '').replace(/\D/g, ''); };
const waUrlFor = (b, use, text) => { const n = waNum(b, use); return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : ''; };
const waUrl = (b, text) => { const n = waNum(b); return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : ''; };
function setWaFab(b, text) {
  let el = document.getElementById('wa-fab'); const url = b ? waUrl(b, text) : '';
  if (!url) { el?.remove(); return; }
  if (!el) { el = document.createElement('a'); el.id = 'wa-fab'; el.className = 'wa-fab'; el.target = '_blank'; el.rel = 'noopener'; el.setAttribute('aria-label', 'WhatsApp'); el.innerHTML = WA_SVG; document.body.appendChild(el); }
  el.href = url;
}
function orderCard() {
  const me = state.user.me; const op = me.orderPackages || [];
  const rp = me.resellerPackages || [];
  if (!op.length && !rp.length) return '';
  const u = me.user.username; const app = me.branding.appName;
  const isIbo = (p) => p.kind === 'ibo' || /^ibo/i.test(p.id || '');
  const std = op.filter((p) => !isIbo(p));
  const ibo = op.filter((p) => isIbo(p));
  const waLink = (p, pr) => waUrl(me.branding, t('waBuy', { app, pkg: pkgName(p.title || p.name), price: pr, u }));
  const card = (p) => { const title = pkgName(p.title || p.name || t('w_package')); const pr = priceTxt(p.price, p.cur); const wa = waLink(p, pr); return `<div class="plan-c${LIFETIME_PLANS.some((x) => x.id === p.id) ? ' plan-lifetime' : ''}">${p.badge ? `<div class="small" dir="auto" style="color:var(--accent);font-weight:700">${esc(pkgName(p.badge))}</div>` : ''}<b dir="auto">${esc(title)}</b><div class="pp" dir="ltr">${pr}</div>${p.credits ? `<div class="small" style="color:var(--accent);font-weight:700">${esc(t('pkgCreditsN', { n: p.credits }))}</div>` : ''}${p.days ? `<div class="small muted">${t('daysN', { n: p.days })} · ${t('devices', { n: p.devices })}</div>` : ''}
    ${me.buyRequest?.pkg === p.id && !me.buyRequest.answeredAt ? `<div class="small pos" style="margin-top:8px">✓ ${t('requested')}</div>` : `<button class="btn sm primary block" style="margin-top:8px" data-act="buy-request" data-pkg="${esc(p.id)}">🛒 ${t('requestBuy')}</button>`}
    ${wa ? `<a class="btn sm wa-btn block" style="margin-top:6px" href="${esc(wa)}" target="_blank" rel="noopener">💬 ${t('whatsapp')}</a>` : ''}</div>`; };
  const section = (title, list) => list.length ? `<h3 class="op-sec">${esc(title)}</h3><div class="plans-grid">${list.map(card).join('')}</div>` : '';
  return `<div class="card"><h3>💎 ${t('buyTitle')}</h3>
    ${section('📡 ' + t('sec_subs'), std)}
    ${section('📺 ' + t('sec_ibo'), ibo)}
    ${section('🤝 ' + t('sec_rsl'), rp)}
    <p class="small muted" style="margin:10px 0 0">${t('buyHow')}</p><button class="btn block" style="margin-top:12px" data-act="rc-new">🧾 ${t('rcBtn')}</button></div>`;
}
function plansCard() {
  if (state.user.me.orderPackages?.length || state.user.me.resellerPackages?.length) return `<div id="acc-plans" data-go="packages">${orderCard()}</div>`;
  const me = state.user.me; if (!me.plans?.length) return '';
  const sup = me.branding.supportUrl;
  return `<div class="card"><h3>💎 ${t('plansTitle')}</h3><div class="plans-grid">${me.plans.map((p) => `<div class="plan-c${LIFETIME_PLANS.some((x) => x.id === p.id) ? ' plan-lifetime' : ''}"><b>${esc(pkgName(p.name))}</b><div class="pp">${priceTxt(p.price, me.currency)}</div><div class="small muted">${t('devices', { n: p.connections })}</div>${sup ? `<a class="btn sm primary" href="${esc(sup)}${sup.includes('wa.me') ? `?text=${encodeURIComponent(`${me.branding.appName}: ${p.name} (${priceTxt(p.price, me.currency)}) — ${me.user.username}`)}` : ''}" target="_blank" rel="noopener">${t('choose')}</a>` : ''}</div>`).join('')}</div></div>`;
}
function giftCard() {
  const list = state.user.me?.gifts || [];
  if (!list.length) return '';
  return `<div class="card" id="acc-gifts"><h3 style="margin-top:0">🎁 ${t('giftsTitle')}</h3>
    <p class="small muted" style="margin:6px 0 12px">${t('giftsText')}</p>
    <div class="gift-grid">${list.map((g) => `<div class="gift-item ${Number(g.discountPct || g.pct) > 0 ? 'gift-discount' : 'gift-free'}"><b>${esc(g.label || g.title || '')}</b><div class="small muted">${esc(g.note || '')}</div></div>`).join('')}</div></div>`;
}
function referralCard() {
  const r = state.user.me?.referral || {};
  const tiers = Array.isArray(r.rewardTable) && r.rewardTable.length ? r.rewardTable : Object.values(REFERRAL_TIERS);
  const code = r.code || ''; const link = r.link || '';
  return `<div class="card" id="acc-referral"><h3 style="margin-top:0">🤝 ${t('refTitle')}</h3>
    <p class="small muted" style="margin:6px 0 12px">${t('refText')}</p>
    ${code ? `<div class="ref-code"><span dir="ltr">${esc(code)}</span><button class="btn sm" data-act="ref-copy-code">⧉ ${t('copy')}</button></div>` : ''}
    ${link ? `<div class="ref-code"><span dir="ltr" style="overflow-wrap:anywhere;flex:1">${esc(link)}</span><button class="btn sm primary" data-act="ref-copy-link">⧉ ${t('refCopyLink')}</button></div>` : ''}
    <div class="ref-tiers">${tiers.map((x) => `<div class="list-item small"><span style="flex:1">${esc(x.label || '')}</span><b>${esc(x.days || 0)} ${t('daysShort')}</b></div>`).join('')}</div>
    ${Number(r.earned || r.awardedDays) > 0 ? `<div class="small pos" style="margin-top:8px">✓ ${t('refEarned', { n: Number(r.earned || r.awardedDays) })}</div>` : ''}</div>`;
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

const loadMpegts = () => window.mpegts ? Promise.resolve() : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
// Every way a stream can be played, best first. The player tries the next one when one fails.
//  hls  = .m3u8 (works everywhere, also iPhone)   ts = raw MPEG-TS via mpegts.js (Chrome, Edge, Firefox, Android, iPad, iPhone iOS 17.1+)   file = mp4 / mkv / webm directly
function playVariants(rawUrl, kind) {
  const u = String(rawUrl); const q = u.match(/[?#].*$/)?.[0] || ''; const path = u.slice(0, u.length - q.length);
  const ext = (path.match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase() || '';
  const xt = path.match(/^(https?:\/\/[^/]+)\/(?:(live|movie|series)\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.[a-z0-9]+)?$/i);
  const out = []; const add = (url, type) => { if (!out.some((x) => x.url === url && x.type === type)) out.push({ url, type }); };
  if (xt && (kind === 'live' || xt[2] === 'live' || !xt[2])) { const b = `${xt[1]}/live/${xt[3]}/${xt[4]}/${xt[5]}`; add(b + '.m3u8' + q, 'hls'); add(b + '.ts' + q, 'ts'); if (!xt[2]) add(u, 'ts'); return out; }
  if (ext === 'm3u8' || ext === 'm3u') { add(u, 'hls'); return out; }
  if (ext === 'ts' || (!ext && kind === 'live')) { add(u, 'ts'); add(u, 'hls'); add(u, 'file'); return out; }
  add(u, 'file');
  if (xt && (xt[2] === 'movie' || xt[2] === 'series')) add(`${xt[1]}/${xt[2]}/${xt[3]}/${xt[4]}/${xt[5]}.m3u8${q}`, 'hls');
  return out;
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
    const base = state.user.me._stream; const needRelay = location.protocol === 'https:' && it.url.startsWith('http:');
    if (needRelay && !base?.relay) return modal(esc(title), `<div class="notice warning">${t('srcNeedApp')}</div><a class="btn primary" href="download.html">${t('getApp')}</a>`);
    const wrap = (x) => (needRelay ? `${base.relay}/x?u=${encodeURIComponent(x)}&t=${encodeURIComponent(base.proxyToken)}` : x);
    const alts = playVariants(it.url, kind).map((x) => ({ ...x, url: wrap(x.url) }));
    return openPlayer({ title, url: alts[0].url, isHls: alts[0].type === 'hls', alts, kind, id, extraHtml: '' });
  }
  if (isDirect()) {
    const st = state.user.me.stream; const b = bridge();
    const raw = (e) => kind === 'live' ? `${st.server}/live/${encodeURIComponent(st.u)}/${encodeURIComponent(st.p)}/${id}.${e}`
      : `${st.server}/${kind}/${encodeURIComponent(st.u)}/${encodeURIComponent(st.p)}/${id}.${ext || 'mp4'}`;
    if (b && !b.inline) { noteNative(hk, id, raw('ts')); return b.play(raw('ts'), title, st.userAgent); } // Android / TV: native player (remembers the position itself)
    let wrap;
    if (b && b.inline) wrap = (x) => x;                                 // Windows / Mac app: plays here, direct
    else if (httpOK()) wrap = (x) => x;                                 // any browser on the http:// address: direct
    else if (st.relay) wrap = (x) => `${st.relay}/x?u=${encodeURIComponent(x)}&t=${encodeURIComponent(st.proxyToken)}`; // iPhone / browsers: secure relay
    else if (canSwitchHttp()) { closeModal(); return goHttp(); }
    else return modal(esc(title), appsCard(), { wide: true });
    const alts = playVariants(raw(kind === 'live' ? 'm3u8' : ext || 'mp4'), kind).map((x) => ({ ...x, url: wrap(x.url) }));
    return openPlayer({ title, url: alts[0].url, isHls: alts[0].type === 'hls', alts, kind, id, extraHtml });
  } else { url = streamUrl(kind, id, ext); isHls = kind === 'live' || ext === 'm3u8'; }
  openPlayer({ title, url, isHls, kind, id, extraHtml });
}

// ---------------- advanced player ----------------
const fmtT = (x) => { if (!isFinite(x)) return '0:00'; x = Math.max(0, Math.floor(x)); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), sec = String(x % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`; };
function openPlayer({ title, url, isHls, kind, id, extraHtml, alts }) {
  const live = kind === 'live';
  let hls = null, ts = null, hideT = null, retries = 0, alt = 0;
  alts = alts?.length ? alts : [{ url, type: isHls ? 'hls' : 'file' }];
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
    </div>${extraHtml}`, { wide: true, onClose: () => { clearTimeout(hideT); document.removeEventListener('keydown', onKey, true); if (hls) hls.destroy(); if (ts) { try { ts.destroy(); } catch {} } const v = $('#vid'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); } if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } });
  const vp = $('#vp', body), v = $('#vid', body), spin = $('#vp-spin', body), msg = $('#pl-msg', body), big = $('#vp-big', body), menu = $('#vp-menu', body);
  const vol = $('#vp-vol', body), muteB = $('#vp-mute', body), playB = body.querySelector('[data-vp=play]'), seek = $('#vp-seek', body), timeEl = $('#vp-time', body);
  // remembered volume
  const saved = JSON.parse(localStorage.getItem('tvp_vol') || '{"v":1,"m":false}');
  v.volume = saved.v; v.muted = saved.m; vol.value = Math.round(saved.v * 100);
  const saveVol = () => { localStorage.setItem('tvp_vol', JSON.stringify({ v: v.volume, m: v.muted })); muteB.textContent = v.muted || v.volume === 0 ? '🔇' : v.volume < .5 ? '🔉' : '🔊'; vol.value = v.muted ? 0 : Math.round(v.volume * 100); };
  saveVol();
  const show = () => { vp.classList.add('show'); clearTimeout(hideT); hideT = setTimeout(() => { if (!v.paused && !menu.classList.contains('open')) vp.classList.remove('show'); }, 3500); };
  const fail = (m) => { spin.style.display = 'none'; const app = bridge() ? '' : ` <a class="btn sm" href="download.html">📲 ${t('getApp')}</a>`; msg.innerHTML = `${m || t('streamFail')} <button class="btn sm" data-vp="retry">⟳ ${t('retry')}</button>${app}`; };
  const hasMSE = () => !!(window.MediaSource || window.ManagedMediaSource || window.WebKitMediaSource);
  // a source failed for good: try the next way of playing it, then give up
  const next = () => { if (alt < alts.length - 1) { alt++; retries = 0; return start(); } fail(); };
  let hadPlay = false;
  const start = () => {
    msg.innerHTML = ''; spin.style.display = '';
    if (hls) { hls.destroy(); hls = null; }
    if (ts) { try { ts.destroy(); } catch {} ts = null; }
    v.removeAttribute('src');
    const cur = alts[alt]; url = cur.url;
    if (cur.type === 'ts') {
      if (!hasMSE()) return next();
      if (!window.mpegts) return loadMpegts().then(start).catch(next);
      if (!window.mpegts.isSupported()) return next();
      ts = window.mpegts.createPlayer({ type: 'mpegts', isLive: live, url }, { enableWorker: true, liveBufferLatencyChasing: false, lazyLoad: !live, autoCleanupSourceBuffer: true, stashInitialSize: 384 * 1024 });
      ts.attachMediaElement(v); ts.load();
      ts.on(window.mpegts.Events.ERROR, () => { if (retries++ < 1 && hadPlay) return setTimeout(start, 1500); next(); });
    } else if (cur.type === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl')) {
      if (!window.Hls) return loadHls().then(start).catch(next);
      if (!window.Hls.isSupported()) return next();
      hls = new window.Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: live ? 20 : 40, startFragPrefetch: true, manifestLoadingMaxRetry: 3, fragLoadingMaxRetry: 6, levelLoadingMaxRetry: 3 });
      hls.loadSource(url); hls.attachMedia(v);
      hls.on(window.Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && retries++ < 2) return hls.recoverMediaError();
        if (hadPlay && retries++ < 3) return setTimeout(start, 1500);
        next();
      });
    } else { v.src = url; }
    v.play().catch(() => { big.style.display = 'grid'; });
  };
  start();
  // video events
  v.addEventListener('waiting', () => (spin.style.display = ''));
  v.addEventListener('playing', () => { hadPlay = true; spin.style.display = 'none'; big.style.display = 'none'; msg.innerHTML = ''; retries = 0; playB.textContent = '❚❚'; show(); });
  v.addEventListener('pause', () => { playB.textContent = '▶'; vp.classList.add('show'); });
  v.addEventListener('canplay', () => (spin.style.display = 'none'));
  v.addEventListener('error', () => { if (!hls && !ts) { if (hadPlay && retries++ < 2) setTimeout(start, 1500); else next(); } });
  // stuck: no picture after 15 s on this source → try the next one
  const stuckT = setTimeout(function chk() { if (!document.body.contains(v)) return; if (!hadPlay && v.readyState < 2 && alt < alts.length - 1) next(); }, 15000);
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
    if (a === 'retry') { retries = 0; alt = 0; hadPlay = false; start(); }
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

  'add-op': () => $('#ops').insertAdjacentHTML('beforeend', opRow()),
  'del-op': (el) => el.closest('.op-row').remove(),
  'save-op': async () => {
    const orderPackages = [...document.querySelectorAll('#ops .op-row')].map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`).value; return { id: r.dataset.op || undefined, title: g('title'), days: Number(g('days')), devices: Number(g('devices')), price: Number(g('price')), badge: g('badge'), link: g('link'), stripeAccount: g('stripeAccount') || undefined }; }).filter((p) => p.title);
    await saveSettings({ orderPackages, orderCurrency: $('#op-cur').value }); renderAdmin();
  },

  'order-preview': async (el) => {
    const appUrl = location.origin + location.pathname.replace(/index\.html$/, '');
    if (!state.admin.customers) state.admin.customers = await api('GET', '/api/admin/customers');
    const c = state.admin.customers.find((x) => x.email) || state.admin.customers[0];
    if (!c) return toast('Add a customer first to preview.', true);
    const pv = await api('GET', `/api/admin/customers/${c.id}/orderpreview?pkg=${el.dataset.pkg}&appUrl=${encodeURIComponent(appUrl)}`);
    const body = modal('👁 ' + pv.subject, `<iframe id="mail-pv" sandbox="" style="width:100%;height:65vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>`, { wide: true });
    $('#mail-pv', body).srcdoc = pv.html;
  },
  'order-one': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id); const s = state.admin.settings;
    const body = modal('💳 Send a package email', `<div class="row"><select id="op-pick" style="flex:1">${packageOptions(s, c.cur).map(([id, label]) => `<option value="${esc(id)}" ${id === (c.buyRequest?.pkg || c.orderSentPkg) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
      <p class="muted small" id="op-subj"></p><iframe id="mail-pv" sandbox="" style="width:100%;height:55vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>
      <label class="field" style="margin-top:12px"><span>Payment link for this order</span><input id="op-link" placeholder="https://… (empty = button opens your WhatsApp)" autocapitalize="none"></label>
      <div class="row"><input id="mail-to" value="${esc(c.email || '')}" style="flex:1" autocapitalize="none"><button class="btn primary" data-act="order-send" data-id="${c.id}">Send</button></div>
      ${c.buyRequest ? `<p class="small">🛒 Requested <b>${esc(c.buyRequest.title || '')}</b> on ${fmtDT(c.buyRequest.at)}${c.buyRequest.answeredAt ? ' · answered' : ''}</p>` : ''}
      ${c.orderSentAt ? `<p class="small muted">Last package email: ${fmtDT(c.orderSentAt)}${c.orderSentLink ? ' · link: ' + esc(c.orderSentLink) : ''}</p>` : ''}`, { wide: true });
    const load = async () => { const appUrl = location.origin + location.pathname.replace(/index\.html$/, ''); const pv = await api('GET', `/api/admin/customers/${c.id}/orderpreview?pkg=${$('#op-pick').value}&link=${encodeURIComponent($('#op-link').value.trim())}&cur=${encodeURIComponent(c.cur || 'USD')}&appUrl=${encodeURIComponent(appUrl)}`); $('#op-subj').innerHTML = 'Subject: <b>' + esc(pv.subject) + '</b>'; $('#mail-pv', body).srcdoc = pv.html; };
    const fillOpLink = async () => { if ($('#op-link').value.trim()) return; const r = await resolvePkgPayLink(s, $('#op-pick').value, c.cur); $('#op-link').placeholder = r ? `Automatic: ${r.accName || r.acc} link${r.options > 1 ? ` (rotation, ${r.options} links)` : ''}` : 'No matching link: paste one'; }; $('#op-pick').addEventListener('change', () => { fillOpLink(); load(); }); $('#op-link').addEventListener('change', load); fillOpLink(); load();
  },
  'order-send': async (el) => {
    el.disabled = true;
    try { await api('POST', `/api/admin/customers/${el.dataset.id}/order`, { pkg: $('#op-pick').value, to: $('#mail-to').value, link: $('#op-link').value.trim(), appUrl: location.origin }); toast(t('packageEmailSent')); const c = state.admin.customers.find((x) => x.id === el.dataset.id); if (c) { c.orderSentAt = Date.now(); c.orderSentPkg = $('#op-pick')?.value; if (c.buyRequest) c.buyRequest.answeredAt = Date.now(); } closeModal(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },

  'key-add': (el) => { const box = document.querySelector(`[data-keys="${el.dataset.scope}"]`); box.querySelector('.key-empty')?.remove(); box.insertAdjacentHTML('beforeend', keyRow(el.dataset.scope, { on: true })); box.lastElementChild.querySelector('[data-k=key]').focus(); },
  'key-del': (el) => { const row = el.closest('[data-key-row]'); if (row.querySelector('[data-k=key]').value && !confirm('Delete this key? Tap Save afterwards.')) return; row.remove(); },
  'key-test': async (el) => {
    const row = el.closest('[data-key-row]'); const q = (k) => row.querySelector(`[data-k=${k}]`).value.trim(); const st = row.querySelector('.key-status');
    el.disabled = true; st.textContent = 'Testing…';
    try { const r = await api('POST', '/api/admin/email/test-key', { scope: el.dataset.scope, id: row.dataset.id, key: q('key'), domain: q('domain'), name: q('name') }); st.textContent = '✅ Works · ' + r.msg + (row.dataset.id ? '' : ' · tap Save to keep it'); }
    catch (e) { st.textContent = '❌ ' + e.message; }
    el.disabled = false;
  },
  'mail-menu': (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id); if (!c) return;
    const last = (t) => (t ? `<span class="small muted">sent ${fmtDate(t)}</span>` : '<span class="small muted">not sent yet</span>');
    const item = (act, icon, name, desc, t) => `<button class="list-item mail-pick" data-act="${act}" data-id="${c.id}" style="width:100%;text-align:start;background:none;border:0;cursor:pointer;color:inherit"><span style="font-size:22px">${icon}</span><div style="flex:1"><b>${name}</b><div class="small muted">${desc}</div></div>${last(t)}</button>`;
    modal(`✉️ Email ${esc(c.name)}`, `<p class="small muted" style="margin-top:0">To ${esc(c.email)}. Each one opens a preview before it is sent.</p>
      ${item('mail-profile', '👤', 'Profile details', 'App username and password, with a button to their intproto-tv.store/profile page', c.profileMailAt)}
      ${item('email-login', '📺', 'Order details: TVplus line + M3U', 'Line username, password, DNS and M3U links', c.lineMailAt)}
      ${item('order-one', '💳', 'Payment link', 'A package with your payment link', c.orderSentAt)}
      ${item('renewal-one', '🔁', 'Renewal', 'Renewal offer for an ended or ending subscription', c.renewalSentAt)}
      ${item('mail-appdl', '📲', 'App download (all devices)', 'Android APK, iPhone & iPad (Safari), MacBook, with the app link', c.appMailAt)}
      ${item('mail-invoice', '🧾', 'Invoice', 'Invoice for a payment, in the customer’s language', Math.max(0, ...Object.values(c.invoices || {})) || 0)}
      <p class="small muted" style="margin:8px 0 0">Language: <b>${esc({ en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', it: 'Italiano' }[c.lang] || 'English')}</b> — change it in ✎ Edit.</p>`);
  },
  'mail-profile': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    const appUrl = location.origin;
    const pv = await api('GET', `/api/admin/customers/${c.id}/profilepreview?appUrl=${encodeURIComponent(appUrl)}`);
    const body = modal('👤 Profile details email', `<p class="muted small" style="margin-top:0">Subject: <b>${esc(pv.subject)}</b></p><iframe id="mail-pv" sandbox="" style="width:100%;height:60vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>
      <div class="row" style="margin-top:12px"><input id="mail-to" value="${esc(c.email || '')}" style="flex:1" autocapitalize="none"><button class="btn primary" data-act="mail-profile-send" data-id="${c.id}">Send email</button></div>`, { wide: true });
    $('#mail-pv', body).srcdoc = pv.html;
  },
  'mail-profile-send': async (el) => {
    el.disabled = true;
    try { await api('POST', `/api/admin/customers/${el.dataset.id}/profilemail`, { to: $('#mail-to').value, appUrl: location.origin }); toast(t('emailSent')); closeModal(); await custRefresh(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'contact-menu': (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id); if (!c) return; const k = el.dataset.k; const ct = c.contact || {};
    const name = { email: 'Email', whatsapp: 'WhatsApp', telegram: 'Telegram' }[k]; const noK = k === 'email' ? '' : 'no' + k[0].toUpperCase() + k.slice(1);
    const on = contactedRecently(ct[k]);
    modal(`${name} · ${esc(c.name)}`, `<p class="small muted" style="margin-top:0">${on ? `Marked sent ${fmtDT(ct[k])}. It clears by itself 24 hours later.` : 'Not marked as sent in the last 24 hours. Sending from the app marks it by itself.'}</p>
      <div class="row" style="gap:8px">${on ? `<button class="btn" data-act="contact-set" data-id="${c.id}" data-k="${k}" data-v="0">Clear ✓</button>` : `<button class="btn primary" data-act="contact-set" data-id="${c.id}" data-k="${k}" data-v="1">✓ Mark as sent</button>`}
      ${noK ? `<button class="btn ${ct[noK] ? '' : 'danger'}" data-act="contact-set" data-id="${c.id}" data-k="${noK}" data-v="${ct[noK] ? 0 : 1}">${ct[noK] ? `✓ They have ${name} after all` : `✕ Has no ${name}`}</button>` : ''}</div>`);
  },
  'contact-set': async (el) => {
    el.disabled = true;
    try { await api('PUT', '/api/admin/customers/' + el.dataset.id, { contact: { [el.dataset.k]: el.dataset.v === '1' } }); closeModal(); await custRefresh(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'tg-one': async (el) => {
    await actions['wa-one'](el);
    const f = $('[data-form=wa]'); if (!f) return; f.dataset.channel = 'telegram';
    const h = document.querySelector('.modal-head h3'); if (h) h.textContent = '✈️ Telegram message';
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    const b = f.querySelector('[data-act=wa-open]'); if (b) { b.dataset.act = 'tg-open'; b.className = 'btn primary brand-send tg'; b.textContent = '✈️ Send on Telegram'; }
    f.insertAdjacentHTML('afterbegin', `<label class="field"><span>Telegram username (optional)</span><input id="tg-user" value="${esc(String(c.telegram || '').replace(/^@/, ''))}" placeholder="username, without @" autocapitalize="none"></label>`);
  },
  'tg-open': async (el) => {
    const f = $('[data-form=wa]'); const text = $('#wa-text').value; const id = el.dataset.id; el.disabled = true;
    try {
      const r = await api('POST', `/api/admin/customers/${id}/tgsend`, { text });
      if (r.sent) { toast('Sent by your Telegram bot ✓'); closeModal(); return custRefresh(); }
      // the customer has not started your bot: copy the message and open their Telegram chat
      try { await navigator.clipboard.writeText(text); } catch {}
      const user = ($('#tg-user')?.value || '').trim().replace(/^@/, ''); const phone = intlDigits(f);
      if (!user && !phone) { el.disabled = false; return toast('Add their Telegram username or phone number.', true); }
      window.open(user ? `https://t.me/${encodeURIComponent(user)}` : `https://t.me/+${phone}`, '_blank', 'noopener');
      toast('Message copied. Paste it in the Telegram chat.');
      await api('POST', `/api/admin/customers/${id}/wamsg`, { ...waForm(), channel: 'telegram', log: true });
      if (user) await api('PUT', `/api/admin/customers/${id}`, { telegram: user }).catch(() => {});
      closeModal(); await custRefresh();
    } catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'wa-one': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id); const s = state.admin.settings; const p0 = s.orderPackages[0] || {};
    const pick = c.orderSentPkg && s.orderPackages.some((p) => p.id === c.orderSentPkg) ? c.orderSentPkg : p0.id;
    const body = modal('💬 WhatsApp message', `<form data-form="wa" onsubmit="return false">
      <div class="grid3">${field('Message', 'type', el.dataset.type || (c.state === 'expired' || c.state === 'expiring' ? 'renew' : 'pay'), { type: 'select', options: [['pay', '💳 Payment link (place an order)'], ['trial', '🎁 Free trial details'], ['thanks', '🙏 Thank you for your purchase'], ['renew', '🔁 Renewal reminder'], ['login', '🔑 Login details'], ['support', '🎧 Support link (24/7 help page)'], ['ibo_promo', '📺 IBO Player offer'], ...PROMO_KINDS.map(([k, n]) => ['promo_' + k, '📣 ' + n]), ...(state.admin.settings.waCustom || []).map((x) => ['c:' + x.id, '✍️ ' + x.name])] })}${field('Language', 'lang', LANG5_CODES.includes(c.lang) ? c.lang : 'en', { type: 'select', options: LANG5 })}${phoneField('WhatsApp number', 'phone', false, String(c.whatsapp || c.phone || ''), custCC(c))}</div>
      <div id="wa-pkg"><div class="grid2">${field('Package', 'pkg', c.buyRequest?.pkg || pick, { type: 'select', options: [...packageOptions(s, c.cur)] })}${field('Payment link', 'link', '', { attrs: 'autocapitalize="none"', ph: 'https://… your link for this order' })}</div>
      <details><summary class="small muted" style="cursor:pointer;margin:6px 0">✏️ Custom subscription (optional)</summary>
        <div class="grid3">${field('Package name', 'title', '', { ph: 'e.g. 1 Year + 2 months free' })}${field('Price', 'price', '', { type: 'number', attrs: 'step="any" min="0"' })}${field('Currency', 'currency', c.cur || 'USD', { type: 'select', options: [['EUR', '€ EUR'], ['USD', '$ USD'], ['USDT', '₮ USDT'], ['MAD', 'DH MAD'], ['THB', '฿ THB']] })}</div>
        <div class="grid3">${field('Days', 'days', '', { type: 'number', attrs: 'min="1"' })}${field('Devices', 'devices', '', { type: 'number', attrs: 'min="1"' })}</div>
      </details></div>
      <label class="field"><span>Message (you can edit it)</span><textarea id="wa-text" rows="12" dir="auto"></textarea></label>
      <div class="row"><button type="button" class="btn sm" data-act="wa-copy">📋 Copy</button><button type="button" class="btn sm" data-act="wa-tpl">⚙️ Edit template</button><span class="spacer"></span><button type="button" class="btn primary wa-btn" data-act="wa-open" data-id="${c.id}">💬 Open WhatsApp</button></div>
      <div id="wa-tpl-box" style="display:none;margin-top:10px"><p class="small muted">Saved template for this message type and language. You can use: {name} {fullname} {package} {price} {days} {devices} {link} {username} {password} {dns} {m3u} {expires} {ends} {appUrl} {website} {order} {app}. Use *text* for bold in WhatsApp.</p><textarea id="wa-tpl-text" rows="10" dir="auto"></textarea><div class="row"><button type="button" class="btn sm" data-act="wa-tpl-reset">Reset to default</button><span class="spacer"></span><button type="button" class="btn sm primary" data-act="wa-tpl-save">Save template</button></div></div>
      <p class="small muted" id="wa-info"></p></form>`, { wide: true });
    const f = $('[data-form=wa]', body); f.dataset.id = c.id;
    const show = () => { $('#wa-pkg').style.display = f.type.value === 'login' ? 'none' : ''; };
    ['type', 'lang', 'title', 'price', 'currency', 'days', 'devices', 'link'].forEach((k) => f[k].addEventListener('change', () => { show(); waLoad(); }));
    const fillWaLink = async () => { if (f.link.value.trim()) return; const r = await resolvePkgPayLink(s, f.type.value === 'ibo_promo' ? ((s.iboPromo || {}).pkg || 'ibo1y') : f.pkg.value, c.cur); f.link.placeholder = r ? `Automatic: ${r.accName || r.acc} link${r.options > 1 ? ` (rotation, ${r.options} links)` : ''}` : 'No matching link: paste one'; }; // the price stays in the customer's currency
    f.pkg.addEventListener('change', () => { fillWaLink(); show(); waLoad(); }); f.type.addEventListener('change', fillWaLink); fillWaLink();
    show(); waLoad();
  },
  'wa-refresh': () => waLoad(),
'wa-copy': async () => { try { await navigator.clipboard.writeText($('#wa-text').value); toast(t('copied')); } catch { $('#wa-text').select(); document.execCommand('copy'); toast(t('copied')); } },
'wa-tpl': () => { const b = $('#wa-tpl-box'); b.style.display = b.style.display === 'none' ? '' : 'none'; },
'wa-tpl-reset': async () => { const f = $('[data-form=wa]'); await saveSettings({ waTemplates: { [f.type.value]: { [f.lang.value]: '' } } }); toast(t('backToDefault')); waLoad(); },
'wa-tpl-save': async () => { const f = $('[data-form=wa]'); await saveSettings({ waTemplates: { [f.type.value]: { [f.lang.value]: $('#wa-tpl-text').value } } }); toast(t('templateSaved')); waLoad(); },
  'wa-open': async (el) => {
    const f = $('[data-form=wa]'); const phone = intlDigits(f); const text = $('#wa-text').value;
    if (!phone) return toast(t('waEnterNumber'), true);
    if (phone.startsWith('0') || phone.length < 8) return toast(t('waNoLeadingZero'), true);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    api('POST', `/api/admin/customers/${el.dataset.id}/wamsg`, { ...waForm(), log: true }).then(async () => { const sent = state.admin.customers.find((x) => x.id === el.dataset.id); if (sent) sent.waSentAt = Date.now(); document.querySelectorAll(`[data-act="wa-one"][data-id="${el.dataset.id}"]`).forEach((b) => { b.classList.remove('wa-todo'); b.classList.add('wa-sent'); b.title = 'WhatsApp message sent ' + fmtDate(Date.now()) + ' — tap to send another'; }); if (phone !== String(state.admin.customers.find((x) => x.id === el.dataset.id)?.whatsapp || '').replace(/\D/g, '') && !state.admin.customers.find((x) => x.id === el.dataset.id)?.whatsapp) await api('PUT', `/api/admin/customers/${el.dataset.id}`, { whatsapp: phone }).catch(() => {}); }).catch(() => {});
  },
  'promo-pv': async () => {
    const o = promoForm(); const lang = 'en';
    try {
      const r = await api('POST', '/api/admin/templates/preview', { kind: 'renewal', lang, promo: o, appUrl: location.origin });
      modal('👁 Renewal email with the promotion', `<div class="seg" style="margin-bottom:10px">${LANG5.map(([k, n], i) => `<button type="button" class="${i ? '' : 'on'}" data-act="promo-pv-l" data-l="${k}">${n}</button>`).join('')}</div><p class="small muted" style="margin:0 0 8px">Subject: <b id="pv-subj">${esc(r.subject)}</b></p><iframe title="Email preview" sandbox="" style="width:100%;height:62vh;border:1px solid var(--border);border-radius:12px;background:#fff"></iframe>`, { wide: true });
      $('.modal-body iframe').srcdoc = r.html; state.admin.promoPv = o;
    } catch (e) { toast(e.message, true); }
  },
  'promo-pv-l': async (el) => { el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); try { const r = await api('POST', '/api/admin/templates/preview', { kind: 'renewal', lang: el.dataset.l, promo: state.admin.promoPv || {}, appUrl: location.origin }); $('#pv-subj').textContent = r.subject; $('.modal-body iframe').srcdoc = r.html; } catch (e) { toast(e.message, true); } },
  'promo-nl': async () => {
    try { const f = $('[data-form=promo]'); if (f) await saveSettings({ promo: { ...promoForm(), code: String(promoForm().code || '').trim().toUpperCase() } }, true); const d = await api('GET', '/api/admin/promo');
      try { localStorage.setItem('tvp_nl_draft', JSON.stringify({ ...nlBlank(), ...d.campaign, group: 'active' })); } catch {}
      await actions['nl-open'](); toast('Black Friday email loaded: choose who gets it, preview, then Send.');
    } catch (e) { toast(e.message, true); }
  },
  'promo-tg': async () => {
    try { const f = $('[data-form=promo]'); if (f) await saveSettings({ promo: { ...promoForm(), code: String(promoForm().code || '').trim().toUpperCase() } }, true); const d = await api('GET', '/api/admin/promo');
      modal('✈️ Post in your Telegram channel', `<p class="small muted" style="margin-top:0">Your bot must be an <b>admin of the channel</b> with “Post messages” allowed. You can change the text before posting.</p>
        ${field('Channel', 'promo-ch', d.channel || '', { ph: '@yourchannel', attrs: 'id="promo-ch" autocapitalize="none"' })}
        <textarea id="promo-tg-text" rows="12" style="width:100%">${esc(d.post)}</textarea>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="button" class="btn primary" data-act="promo-tg-go">✈️ Post now</button></div>`);
    } catch (e) { toast(e.message, true); }
  },
  'promo-tg-go': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/promo/telegram', { channel: $('#promo-ch').value.trim(), text: $('#promo-tg-text').value }); closeModal(); toast('Posted in your Telegram channel ✓'); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'rs-sell': async (el) => { if (!RS.data) { try { RS.data = await api('GET', '/api/admin/reseller'); } catch {} } modal('🪙 Reseller credit order', resellerSaleForm(state.admin.settings, { id: el?.dataset?.id || '', req: el?.dataset?.req || '', pkg: el?.dataset?.pkg || '' }), { wide: true }); },
  'rs-req-x': async (el) => { if (!confirm('Cancel this order from the reseller dashboard?')) return; try { await api('POST', '/api/admin/reseller/request', { id: el.dataset.id, requestId: el.dataset.req }); renderAdmin(); } catch (e) { toast(e.message, true); } },
  'rs-login': async (el) => { const k = el.dataset.do; const body = { id: el.dataset.id, appUrl: location.origin };
    if (k === 'reset') { if (!confirm('Make a new password? The old one stops working.')) return; body.reset = true; }
    if (k === 'send') { body.send = true; body.withOrder = confirm('Add the last order details to the email?\n\nOK = yes · Cancel = login only'); }
    if (k === 'left') body.creditsLeft = $('#rs-left').value;
    try { const r = await api('POST', '/api/admin/reseller/login', body); toast(k === 'send' ? 'Login email sent ✓' : k === 'left' ? 'Saved ✓' : `Login: ${r.username} / ${r.pass}`); rsReload(el.dataset.id); } catch (e) { toast(e.message, true); } },
  'rsl-tab': (el) => { RSL.tab = el.dataset.t; rslDraw(); window.scrollTo(0, 0); },
  'rsl-reload': () => renderRsl(),
  'push-on': async (el) => { el.disabled = true; try { await pushEnable(); toast(isAdminUI() ? 'Notifications are on for this device ✓' : t('notifIsOn')); } catch (e) { toast(e.message, true); } pushPaint(); if (isAdminUI() && state.admin.tab === 'notify') renderAdmin(); },
  'push-off': async () => { await pushDisable(); pushPaint(); },
  'push-test': async () => { try { const r = await api('POST', '/api/push/test', { lang: getLang(), url: location.pathname }); toast(r.sent ? (isAdminUI() ? `Test sent to ${r.sent} device(s)` : '✓') : (isAdminUI() ? 'No device answered. Turn notifications off and on again.' : t('notifNo')), !r.sent); } catch (e) { toast(e.message, true); } },
  'mail-status': async () => { const h = await mailStatusCard(false); modal('📧 Email sending status', h, { wide: true }); },
  'sup-back': () => { SUP.step = 1; supDraw(); },
  'sup-another': () => { SUP.step = SUP.token ? 2 : 1; SUP.ref = ''; supDraw(); },
  'rsl-copy': (el) => { navigator.clipboard?.writeText(el.dataset.v).then(() => toast('Copied ✓'), () => toast(el.dataset.v)); },
  'rsl-show': (el) => { const c = document.getElementById(el.dataset.id); if (c) c.textContent = c.textContent.startsWith('•') ? c.dataset.secret : '••••••••'; },
  'rsl-buy': (el) => { const d = RSL.d; const x = d.packages.find((p) => p.id === el.dataset.id); if (!x) return;
    modal(`🛒 ${x.credits} ${esc(t('rsl_credits'))}`, `<p style="margin-top:0"><b>${esc(x.name)}</b> · ${x.credits} ${esc(t('rsl_credits'))} · <b>${(ORDER_CUR[d.currency] || '') + x.price.toFixed(2)}${ORDER_CUR[d.currency] ? '' : ' ' + d.currency}</b></p>
      <form data-form="rsl-order" data-id="${esc(x.id)}">${d.payMethods.length ? `<div class="field"><span>${esc(t('rsl_payHow'))}</span>${d.payMethods.map((m, i) => `<label class="list-item" style="cursor:pointer"><input type="radio" name="method" value="${esc(m)}" ${i ? '' : 'checked'}> ${esc(m)}</label>`).join('')}</div>` : ''}
      ${field(t('rsl_note'), 'note', '', { ph: t('rsl_notePh') })}<p class="small muted">${esc(t('rsl_payInfo'))}</p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">${esc(t('cancel'))}</button><button class="btn primary">${esc(t('rsl_sendOrder'))}</button></div></form>`); },
  'conn-add': () => { const l = $('#conn-list'); if (!l) return; l.insertAdjacentHTML('beforeend', connRow({})); connNumber(); l.lastElementChild.querySelector('[data-cn="m3u"]')?.focus(); },
  'conn-del': (el) => { const r = el.closest('.conn-row'); const f = r?.closest('form'); r?.remove(); connNumber(); const t = $('#conn-total'); if (t && f) t.textContent = (Number(f.connections?.value) || 1) + connRead(f).reduce((a, x) => a + x.devices, 0); },
  'nl-open': async () => {
    const st = await api('GET', '/api/admin/newsletter'); const s = state.admin.settings;
    let d; try { d = JSON.parse(localStorage.getItem('tvp_nl_draft')); } catch {}
    const running = st.camp?.id && st.groups[st.camp.group]?.left > 0 && st.groups[st.camp.group]?.left < st.groups[st.camp.group]?.total;
    if (running) d = st.camp; if (state.admin.me?.locked) { if (!st.camp?.content) return toast('No newsletter is ready yet. The owner or the Technical Service writes it first.', true); d = st.camp; }
    d = { ...nlBlank(), ...(d || {}), content: { ...nlBlank().content, ...(d?.content || {}) } };
    const link = String(d.link || ''); const linkSel = ['', 'site', 'app', 'contact'].includes(link) ? link : link.startsWith('pkg:') ? 'contact' : 'url';
    const body = modal('📣 Newsletter / promotion email', `<form data-form="nl" onsubmit="return false" ${running ? `data-cid="${esc(d.id)}"` : ''} ${d.badges ? `data-badges="${esc(JSON.stringify(d.badges))}" data-badge0="${esc(d.badge || '')}"` : ''}>
      ${running ? '' : `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px"><span class="small muted">📚 Ready templates (5 languages):</span>${PROMO_KINDS.map(([k, n]) => `<button type="button" class="btn sm" data-act="nl-season" data-k="${k}">${n}</button>`).join('')}</div>`}
      ${running ? `<div class="notice info">⏸ Your last campaign stopped with <b>${st.groups[d.group].left}</b> customers still waiting. Press <b>Send</b> to continue it, or <a data-act="nl-new" style="cursor:pointer;text-decoration:underline">start a new one</a>.</div>` : ''}
      <div class="grid2">${field('Send to', 'group', d.group, { type: 'select', options: NL_GROUPS.map(([k, l]) => [k, `${l} (${st.groups[k].total})`]) })}${field('Languages', 'split', d.split ? '1' : '0', { type: 'select', options: [['0', 'One message for everyone'], ['1', 'Different message per language (EN / FR / AR)']] })}</div>
      <div id="nl-one">${field('Email language (greeting & footer)', 'lang', d.lang || 'en', { type: 'select', options: NL_LANGS })}${nlFields('all', d.content.all)}</div>
      <div id="nl-split"><p class="small muted" style="margin:0 0 6px">Each customer gets the version in their language. If one language is empty, they get English.</p><div class="row" style="gap:6px;margin-bottom:8px">${NL_LANGS.map(([k, l], i) => `<button type="button" class="btn sm ${i ? '' : 'primary'}" data-act="nl-tab" data-k="${k}">${l}</button>`).join('')}</div>${LANG5_CODES.map((k) => nlFields(k, d.content[k] || { subject: '', title: '', body: '', button: '' })).join('')}</div>
      <div class="grid3">${field('Top badge (optional)', 'badge', d.badge, { ph: '🔥 Limited offer' })}${field('Coupon code (optional)', 'coupon', d.coupon, { ph: 'LION001' })}${field('Image URL (optional)', 'image', d.image, { attrs: 'autocapitalize="none"', ph: 'https://…/banner.jpg' })}</div>
      <div class="grid2">${field('Button opens', 'link', linkSel, { type: 'select', options: [['', 'No button'], ['site', 'Your website'], ['app', 'The INTPROTO-TV app'], ['contact', 'Contact us (WhatsApp)'], ['url', 'Other link (e.g. a payment link)…']] })}${field('Other link', 'linkUrl', linkSel === 'url' ? link : '', { attrs: 'autocapitalize="none"', ph: 'https://…' })}</div>
      <div class="row"><select id="nl-pvlang" style="width:auto">${NL_LANGS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button type="button" class="btn" data-act="nl-preview">👁 Preview</button><input id="nl-test" value="${esc(s.email.adminEmail || '')}" placeholder="test@email.com" style="flex:1;min-width:150px" autocapitalize="none"><button type="button" class="btn" data-act="nl-test">Send test</button></div>
      <iframe id="nl-pv" sandbox="" style="width:100%;height:55vh;border:0;border-radius:12px;background:#f4f7fa;display:none;margin-top:10px"></iframe>
      <div class="row" style="margin-top:12px"><span class="small muted" style="flex:1">Every email has an "Unsubscribe" link; unsubscribed customers are skipped${st.unsubscribed ? ` (${st.unsubscribed} so far)` : ''}. Sent 100 at a time. If Resend's daily limit stops it, open this again tomorrow and press Send to continue — nobody gets it twice.</span><button type="button" class="btn primary" data-act="nl-send">📨 Send</button></div>
      <div id="nl-out"></div></form>`, { wide: true });
    const f = $('[data-form=nl]', body);
    const sync = () => { const sp = f.split.value === '1'; $('#nl-one').style.display = sp ? 'none' : ''; $('#nl-split').style.display = sp ? '' : 'none'; f.linkUrl.closest('.field').style.display = f.link.value === 'url' ? '' : 'none'; };
    f.addEventListener('change', () => { sync(); nlRead(); }); f.addEventListener('input', () => nlRead());
    sync(); actions['nl-tab']({ dataset: { k: 'en' } });
  },
  'mail-invoice': async (el) => {
    const id = el.dataset.id; const c = state.admin.customers.find((x) => x.id === id); let d;
    try { d = await api('GET', `/api/admin/customers/${id}/invoice`); } catch (e) { return toast(e.message, true); }
    if (!d.sales.length) return modal('🧾 Invoice', '<p class="muted">No payment is recorded for this customer yet. Invoices are made from payments (renewals and new subscriptions with an amount).</p>');
    modal(`🧾 Invoice · ${esc(c?.name || '')}`, `<p class="small muted" style="margin-top:0">Choose the payment. The invoice is in the customer’s language.</p>${d.sales.map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.no)}</b> · ${fmtDate(x.at)} · ${esc(x.planName || '')} · ${esc(String(x.amount))} ${esc(x.currency || '')}${x.sent ? ` <span class="small muted">· sent ${fmtDate(x.sent)}</span>` : ''}</span><button class="btn sm" data-act="inv-pv" data-id="${id}" data-s="${x.id}">👁 Preview</button><button class="btn sm primary" data-act="inv-send" data-id="${id}" data-s="${x.id}">✉️ Send</button></div>`).join('')}`, { wide: true });
  },
  'inv-pv': async (el) => { try { const r = await api('GET', `/api/admin/customers/${el.dataset.id}/invoice?saleId=${encodeURIComponent(el.dataset.s)}&appUrl=${encodeURIComponent(location.origin)}`); modal('👁 ' + esc(r.subject), `<iframe title="Invoice preview" sandbox="" style="width:100%;height:68vh;border:1px solid var(--border);border-radius:12px;background:#fff"></iframe><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn ghost" data-act="mail-invoice" data-id="${el.dataset.id}">← Back</button><button class="btn primary" data-act="inv-send" data-id="${el.dataset.id}" data-s="${el.dataset.s}">✉️ Send</button></div>`, { wide: true }); $('.modal-body iframe').srcdoc = r.html; } catch (e) { toast(e.message, true); } },
  'inv-send': async (el) => { el.disabled = true; try { const r = await api('POST', `/api/admin/customers/${el.dataset.id}/invoice`, { saleId: el.dataset.s, appUrl: location.origin }); closeModal(); toast(`Invoice ${r.no} sent ✓`); custRefresh?.(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'cur-rule': async (el) => { try { await saveSettings({ currencyRule: { on: el.checked } }, true); toast(el.checked ? 'Automatic currency on ✓ ($, € for Europe)' : 'Automatic currency off — the package currency is used'); } catch (e) { toast(e.message, true); el.checked = !el.checked; } },
  'acc-kind': (el) => { ACC.kind = el.dataset.k; $('#admin-body').innerHTML = accPage(); },
  'acc-eye': async (el) => { ACC.show[el.dataset.k] = !ACC.show[el.dataset.k]; $('#admin-body').innerHTML = state.admin.tab === 'mail' ? await adminMail() : accPage(); },
  'acc-edit': (el) => { const a = el?.dataset?.id ? ACC.d.rows.find((x) => x.id === el.dataset.id) : null; modal(a ? `✎ ${esc(a.name)}` : '＋ Add account', accForm(a || {}), { wide: true }); },
  'acc-del': async (el) => { const a = ACC.d.rows.find((x) => x.id === el.dataset.id); if (!a || !confirm(`Delete the account "${a.name}"? Its key and password are removed from the app (not from Resend)${a.apiKey && ['resend', 'marketing'].includes(a.kind) ? ', and the app stops sending emails with this key' : ''}.`)) return; try { await api('POST', '/api/admin/accounts/delete', { id: a.id, removeKey: true }); toast('Deleted'); renderAdmin(); } catch (e) { toast(e.message, true); } },
  'acc-importkeys': async () => { try { const r = await api('POST', '/api/admin/accounts/import-keys', {}); toast(`${r.added} key(s) added ✓ Set their plan with ✎ Edit.`); renderAdmin(); } catch (e) { toast(e.message, true); } },
  'acc-domains': async (el) => { modal('🌐 Domains at Resend', '<p class="muted">Asking Resend…</p>', { wide: true });
    try { const r = await api('POST', '/api/admin/accounts/resend-domains', { id: el.dataset.id }); $('.modal-body').innerHTML = r.domains.length ? r.domains.map((x) => `<div class="card" style="margin-bottom:10px"><div class="row"><b style="flex:1">${esc(x.name)}</b><span class="pill ${x.status === 'verified' ? 'st-active' : 'st-expiring'}">${esc(x.status)}</span></div>${x.records.length ? `<div class="tbl-wrap"><table class="tbl small"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th>Status</th></tr></thead><tbody>${x.records.map((q) => `<tr><td>${esc(q.type)}${q.priority ? ' ' + q.priority : ''}</td><td><code>${esc(q.name)}</code></td><td><code style="word-break:break-all">${esc(q.value)}</code> <button class="btn sm ghost" data-act="rsl-copy" data-v="${esc(q.value)}">📋</button></td><td>${esc(q.status || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`).join('') : '<p class="muted">No domain in this Resend account yet.</p>'; } catch (e) { $('.modal-body').innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; } },
  'acc-dns': () => { const d = ACC.d; const rs = d.rows.filter((a) => a.kind === 'resend' && a.apiKey), dns = d.rows.filter((a) => (a.kind === 'dynu' || a.kind === 'hostinger') && a.apiKey);
    if (!dns.length || !rs.length) return modal('🌐 Resend DNS records', `<p>Add a <b>Resend</b> account and a <b>Dynu</b> or <b>Hostinger</b> account, each with its API key (Dynu: Control Panel → API Credentials · Hostinger: hPanel → Profile → API). Then this puts the DNS records Resend needs (SPF, DKIM, MX) into your domain for you.</p>`);
    modal('🌐 Resend DNS records → Dynu or Hostinger', `<form data-form="acc-dns"><p class="small muted" style="margin-top:0">Adds the records Resend asks for (SPF, DKIM, MX) to the domain where its DNS is kept. Records already there are skipped, nothing is deleted. Then press “Verify” in Resend.</p>
      <div class="grid3">${field('Resend account', 'resendId', rs[0].id, { type: 'select', options: rs.map((a) => [a.id, a.name + (a.domains?.length ? ' · ' + a.domains[0] : '')]) })}${field('DNS is at', 'dnsId', dns[0].id, { type: 'select', options: dns.map((a) => [a.id, (a.kind === 'dynu' ? 'Dynu · ' : 'Hostinger · ') + a.name]) })}${field('Domain', 'domain', (rs[0].domains || [])[0] || '', { ph: 'mail.intproto-tv.com', attrs: 'required autocapitalize="none"' })}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary">Add the records</button></div></form><div id="dns-out"></div>`); },
  'acc-hostinger': async (el) => { modal('🏠 Hostinger', '<p class="muted">Asking Hostinger…</p>', { wide: true });
    try { const r = await api('POST', '/api/admin/accounts/hostinger', { id: el.dataset.id }); const dt = (v) => (v ? new Date(v).toLocaleDateString() : '—');
      $('.modal-body').innerHTML = `${r.errors.length ? `<div class="notice warning small">${r.errors.map(esc).join('<br>')}</div>` : ''}
        <h3>Websites & apps (${r.websites.length})</h3>${r.websites.length ? `<div class="tbl-wrap"><table class="tbl small"><thead><tr><th>Domain</th><th>Type</th><th>Status</th><th>Since</th></tr></thead><tbody>${r.websites.map((w) => `<tr><td><a href="https://${esc(w.domain)}" target="_blank" rel="noopener">${esc(w.domain)}</a></td><td>${esc(w.type)}</td><td>${w.enabled ? '<span class="pill st-active">on</span>' : '<span class="pill st-expired">off</span>'}</td><td>${dt(w.created)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No website.</p>'}
        <h3>Domains (${r.domains.length})</h3>${r.domains.length ? `<div class="tbl-wrap"><table class="tbl small"><thead><tr><th>Domain</th><th>Status</th><th>Ends</th></tr></thead><tbody>${r.domains.map((x) => `<tr><td>${esc(x.domain || '—')}</td><td>${esc(x.status)}</td><td>${dt(x.expires)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No domain.</p>'}
        <h3>Subscriptions (${r.subscriptions.length})</h3>${r.subscriptions.length ? `<div class="tbl-wrap"><table class="tbl small"><thead><tr><th>Plan</th><th>Status</th><th>Renewal</th><th>Ends</th><th>Auto-renew</th></tr></thead><tbody>${r.subscriptions.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.status)}</td><td>${x.renew != null ? esc(String(x.renew / 100)) + ' ' + esc(x.currency || '') : '—'}</td><td>${dt(x.expires)}</td><td>${x.auto ? '✓' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No subscription.</p>'}
        <p class="small muted">Manage websites and files in <a href="https://hpanel.hostinger.com" target="_blank" rel="noopener">hPanel</a>. To point a domain's email records at Resend, use “🌐 Add Resend DNS records”.</p>`;
    } catch (e) { $('.modal-body').innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; } },
  'acc-dynu': async (el) => { modal('🌐 Dynu domains & DNS', '<p class="muted">Asking Dynu…</p>', { wide: true });
    try { const r = await api('POST', '/api/admin/accounts/dynu-list', { id: el.dataset.id });
      $('.modal-body').innerHTML = r.domains.length ? r.domains.map((d) => `<div class="card" style="margin-bottom:10px"><div class="row"><b style="flex:1">${esc(d.name)}</b>${d.mail ? '<span class="pill st-active">Resend email records ✓</span>' : '<span class="pill st-expiring">no Resend records yet</span>'}</div>
        ${d.records.length ? `<div class="tbl-wrap"><table class="tbl small"><thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead><tbody>${d.records.map((q) => `<tr><td>${esc(q.type)}</td><td><code>${esc(q.name)}</code></td><td><code style="word-break:break-all">${esc(String(q.value).slice(0, 120))}</code></td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">No record.</p>'}</div>`).join('') + '<p class="small muted">To add the records Resend needs, press “🌐 Add Resend DNS records”.</p>' : '<p class="muted">No domain in this Dynu account.</p>';
    } catch (e) { $('.modal-body').innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; } },
  'wa-num-add': () => { const box = $('#wa-num-list'); box.querySelector('.wa-empty')?.remove(); box.insertAdjacentHTML('beforeend', waNumRow({ use: box.children.length ? 'other' : 'main', on: true }, Date.now() % 100000)); },
  'wa-num-del': (el) => { if (confirm('Remove this number? Press Save afterwards.')) el.closest('.wa-num').remove(); },
  'wa-num-focus': (e, ev) => { ev?.preventDefault?.(); $('#wa-numbers')?.scrollIntoView({ behavior: 'smooth' }); },
  'promo-wa': (el) => { const x = PROMO.data.kinds.find((k) => k.id === el.dataset.k); const name = Object.fromEntries(PROMO_KINDS)[x.id];
    modal(`💬 ${esc(name)} · WhatsApp`, `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${LANG5.map(([c, n]) => `<button class="btn sm ${c === PROMO.lang ? 'primary' : ''}" data-act="promo-wa-l" data-k="${x.id}" data-l="${c}">${n}</button>`).join('')}</div>
      <textarea id="promo-wa-text" rows="14" style="width:100%" data-input="promo-wa-edit">${esc(x.wa[PROMO.lang] || x.wa.en)}</textarea>
      <div class="row" style="gap:6px;justify-content:flex-end;margin-top:8px"><button class="btn" data-act="promo-copy">📋 Copy</button><a class="btn wa-btn" id="promo-wa-share" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(x.wa[PROMO.lang] || x.wa.en)}">💬 Open WhatsApp</a></div>
      <p class="small muted">“Open WhatsApp” lets you pick a chat, a group or a broadcast list. To send it to one customer with their name, open the customer's 💬 WhatsApp window and choose “📣 ${esc(name)}”.</p>`, { wide: true }); },
  'promo-copy': async () => { const v = $('#promo-wa-text').value; try { await navigator.clipboard.writeText(v); toast('Copied ✓'); } catch { $('#promo-wa-text').select(); document.execCommand('copy'); toast('Copied ✓'); } },
  'promo-wa-l': (el) => { const x = PROMO.data.kinds.find((k) => k.id === el.dataset.k); const t2 = x.wa[el.dataset.l] || x.wa.en; $('#promo-wa-text').value = t2; $('#promo-wa-share').href = 'https://wa.me/?text=' + encodeURIComponent(t2); document.querySelectorAll('[data-act=promo-wa-l]').forEach((b) => b.classList.toggle('primary', b === el)); },
  'promo-note': (el) => { const x = PROMO.data.kinds.find((k) => k.id === el.dataset.k); noteModal(null); setTimeout(() => { const f = document.querySelector('form[data-form=note-send]'); if (!f) return; const n = x.note[PROMO.lang] || x.note.en; f.title.value = n.title; f.body.value = n.body; f.audience.value = ['events', 'evergreen', 'devices'].includes(x.id) ? 'expired' : 'all'; }, 50); },
  'ngate-allow': async (el) => { el.disabled = true; try { await pushEnable(); toast(isAdminUI() ? 'Notifications are on ✓' : t('notifIsOn')); } catch (e) { toast(e.message, true); } try { localStorage.setItem('tvp_ngate_' + state.role, String(Date.now())); } catch {} route(); },
  'ngate-later': () => { try { localStorage.setItem('tvp_ngate_' + state.role, String(Date.now())); } catch {} route(); },
  'app-install': async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; renderAppPage(); },
  'exp-open': (el) => { const c = state.admin.customers.find((x) => x.id === el.dataset.id); if (c) expModal(c); },
  'exp-add': (el) => expDo(el.closest('form').dataset.id, { action: 'add', days: Number(el.dataset.days) }),
  'exp-now': (el) => { if (confirm('End this subscription now?')) expDo(el.closest('form').dataset.id, { action: 'now' }); },
  'exp-none': (el) => { if (confirm('Remove the end date? The subscription will never end until you set a date again.')) expDo(el.closest('form').dataset.id, { action: 'none' }); },
  'note-one': (el) => noteModal(state.admin.customers.find((x) => x.id === el.dataset.id)),
  'note-all': () => noteModal(null),
  'mail-add': () => modal('＋ Add email account', accForm({ kind: 'resend', use: 'customer' }), { wide: true }),
  'mail-plan-custom': (el) => { const a = ACC.d?.rows.find((x) => x.id === el.dataset.id); if (a) modal(`✎ ${esc(a.name)}`, accForm(a), { wide: true }); },
  'acc-sheet': () => { const d = ACC.d; modal('📊 Google Sheets', `<p class="small" style="margin-top:0">Keep the same accounts in a Google Sheet: <b>Send</b> writes them to the sheet, <b>Read</b> brings changes you made in the sheet back here.</p>
      <div class="notice warning small">The sheet will hold the passwords and API keys. Share it only with Khalil and Nizar.</div>
      <details style="margin:8px 0"><summary class="small">How to connect the sheet (2 minutes)</summary><ol class="small"><li>Open your Google Sheet → Extensions → Apps Script.</li><li>Paste this code and save:</li></ol><textarea readonly rows="9" style="width:100%;font-family:monospace;font-size:12px">function doPost(e){var d=JSON.parse(e.postData.contents);var ss=SpreadsheetApp.getActive();var sh=ss.getSheetByName(d.sheet)||ss.insertSheet(d.sheet);sh.clear();sh.appendRow(d.header);if(d.rows.length)sh.getRange(2,1,d.rows.length,d.header.length).setValues(d.rows);return ContentService.createTextOutput('ok');}
function doGet(e){var sh=SpreadsheetApp.getActive().getSheetByName((e.parameter||{}).sheet||'Accounts');var v=sh?sh.getDataRange().getValues():[];return ContentService.createTextOutput(JSON.stringify({rows:v})).setMimeType(ContentService.MimeType.JSON);}</textarea><ol class="small" start="3"><li>Deploy → New deployment → Web app → Execute as <b>Me</b>, Who has access <b>Anyone</b> → Deploy.</li><li>Copy the web app link and paste it below.</li></ol></details>
      <form data-form="acc-sheet">${field('Apps Script web app link', 'url', d.sheetUrl || '', { ph: 'https://script.google.com/macros/s/…/exec', attrs: 'autocapitalize="none"' })}
      <div class="row" style="justify-content:flex-end;gap:6px"><button class="btn" data-do="save">Save link</button><button class="btn" data-do="pull" ${d.sheetUrl ? '' : 'disabled'}>⬇ Read from sheet</button><button class="btn primary" data-do="push" ${d.sheetUrl ? '' : 'disabled'}>⬆ Send to sheet</button></div></form>`, { wide: true }); },
  'acc-paste': () => modal('📋 Paste rows', `<p class="small muted" style="margin-top:0">Copy rows from your sheet (columns: ${esc(ACC.d.head.join(' · '))}) and paste them here. Existing accounts (same API key or same name) are updated.</p><form data-form="acc-paste"><textarea name="text" rows="8" style="width:100%" required></textarea><div class="row" style="justify-content:flex-end"><button class="btn primary">Add</button></div></form>`, { wide: true }),
  'nl-season': (el) => { const k = el.dataset.k; const names = Object.fromEntries(PROMO_KINDS); const pr = state.admin.settings?.promo || {};
    const ends = PROMO_ENDS();
    modal(`${names[k]} · email template`, `<form data-form="nl-season" data-k="${k}"><p class="small muted" style="margin-top:0">Ready in English, French, German, Spanish and Italian — each customer gets their language. You can edit every text after loading it.</p>
      <div class="grid3">${field('Discount (optional)', 'offer', k === 'blackfriday' ? pr.offer || '' : '', { ph: '30% OFF', help: 'Empty = a general wording without a number.' })}${field('Coupon code (optional)', 'code', k === 'blackfriday' ? pr.code || '' : '', { ph: k.toUpperCase() })}${field('Offer ends', 'end', ends[k], { type: 'date' })}</div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="nl-open">← Back</button><button class="btn primary">Load into the newsletter</button></div></form>`); },
  'nl-tab': (el) => { document.querySelectorAll('#nl-split .nl-c').forEach((x) => (x.style.display = x.dataset.k === el.dataset.k ? '' : 'none')); document.querySelectorAll('[data-act=nl-tab]').forEach((b) => b.classList.toggle('primary', b.dataset.k === el.dataset.k)); },
  'nl-new': async () => { await api('POST', '/api/admin/newsletter/new', {}); try { localStorage.removeItem('tvp_nl_draft'); } catch {} closeModal(); actions['nl-open'](); },
  'nl-preview': async () => {
    const camp = nlRead(); const lang = $('#nl-pvlang').value;
    const pv = await api('POST', '/api/admin/newsletter/preview', { camp, lang, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') });
    const fr = $('#nl-pv'); fr.style.display = ''; fr.srcdoc = pv.html; fr.scrollIntoView({ behavior: 'smooth' }); toast(t('nlSubject', { subject: pv.subject }));
  },
  'nl-test': async (el) => {
    el.disabled = true;
    try { await api('POST', '/api/admin/newsletter/send', { camp: nlRead(), test: $('#nl-test').value, lang: $('#nl-pvlang').value, appUrl: location.origin }); toast(t('testSent')); } catch (e) { toast(e.message, true); }
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
  'buy-request': async (el) => {
    el.disabled = true;
    try { const r = await api('POST', '/api/me/order', { pkg: el.dataset.pkg }); toast(r && r.emailed ? t('requestEmailed') : t('requestSent')); const me = state.user.me; me.buyRequest = { pkg: el.dataset.pkg, at: Date.now() }; renderUserTab(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'order-custom': async () => {
    const s = state.admin.settings; const p0 = s.orderPackages[0] || {};
    const body = modal('✍️ Custom package email', `<form data-form="order-custom" onsubmit="return false">
      <div class="grid2">${field('Email address', 'to', '', { type: 'email', attrs: 'required autocapitalize="none"', ph: 'customer@gmail.com' })}${field('Customer name', 'name', '', { ph: 'Leave empty for "Dear Valued Customer"' })}</div>
      <div class="grid2">${field('Language', 'lang', 'en', { type: 'select', options: LANG5 })}${field('Package', 'pkg', p0.id, { type: 'select', options: packageOptions(s) })}</div>
      <details><summary class="small muted" style="cursor:pointer;margin:6px 0">Change the details (optional)</summary>
        <div class="grid3">${field('Package name', 'title', '', { ph: p0.title })}${field('Price', 'price', '', { type: 'number', attrs: 'step="any" min="0"', ph: String(p0.price ?? '') })}${field('Currency', 'currency', s.orderCurrency || 'EUR', { type: 'select', options: [['EUR', '€ EUR'], ['USD', '$ USD'], ['USDT', '₮ USDT'], ['MAD', 'DH MAD'], ['THB', '฿ THB']] })}</div>
        <div class="grid3">${field('Days', 'days', '', { type: 'number', attrs: 'min="1"', ph: String(p0.days ?? '') })}${field('Devices', 'devices', '', { type: 'number', attrs: 'min="1"', ph: String(p0.devices ?? '') })}${field('Top badge', 'badge', '', { ph: 'e.g. 🎁 Special offer' })}</div>
        ${field('Pay link', 'link', '', { attrs: 'autocapitalize="none"', ph: 'https://… your payment link for this order', help: 'Empty = the button says "Contact us to order" and opens your WhatsApp.' })}
        ${field('Email subject', 'subject', '', { ph: 'Empty = automatic' })}
      </details>
      ${field('Personal message', 'note', '', { type: 'textarea', ph: 'Optional — shown in the email under the greeting' })}
      <div class="row"><button type="button" class="btn" data-act="oc-preview">👁 Preview</button><span class="spacer"></span><button type="button" class="btn primary" data-act="oc-send">📨 Send email</button></div>
      <p class="small muted" id="oc-subj"></p><iframe id="oc-pv" sandbox="" style="width:100%;height:50vh;border:0;border-radius:12px;background:#f4f7fa;display:none"></iframe></form>`, { wide: true });
    const f = $('[data-form=order-custom]', body);
    f.pkg.addEventListener('change', () => { const p = s.orderPackages.find((x) => x.id === f.pkg.value) || {}; f.title.placeholder = p.title || ''; f.price.placeholder = p.price ?? ''; f.days.placeholder = p.days ?? ''; f.devices.placeholder = p.devices ?? ''; if (!f.link.value.trim()) resolvePkgPayLink(s, f.pkg.value).then((r) => { if (r && !f.link.value.trim()) f.link.value = r.url; }); });
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
    try { const r = await api('POST', '/api/admin/order/custom', { ...d, saveCustomer: true, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') }); toast(`Sent to ${d.to} ✓`); closeModal(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'order-bulk': async () => {
    if (!state.admin.customers) state.admin.customers = await api('GET', '/api/admin/customers');
    const s = state.admin.settings; const n = (g) => orderTargets(g).length;
    modal('💳 Package emails to many customers', `<label class="small muted">Package</label><select id="ob-pkg">${packageOptions(s).map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('')}</select><label class="small muted" style="margin-top:10px;display:block">Payment link (optional, same for everyone)</label><input id="ob-link" placeholder="https://… empty = button opens your WhatsApp" autocapitalize="none">
      <label class="small muted" style="margin-top:10px;display:block">Send to</label><select id="ob-grp">${[['expired', 'Expired customers'], ['expiring', 'Expiring soon'], ['active', 'Active customers'], ['trial', 'Trial users'], ['notrecent', 'Everyone not emailed in the last 7 days'], ['all', 'All customers']].map(([k, l]) => `<option value="${k}">${l} (${n(k)})</option>`).join('')}</select>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-act="order-go">📨 Send now</button></div>
      <p class="small muted">Sent in batches of 100. Customers with a broken email address are skipped. Your Resend plan must allow that many emails (free plan: 100/day, 3,000/month).</p><div id="ob-out"></div>`);
  },
  'order-go': async (el) => {
    const grp = $('#ob-grp').value; const pkg = $('#ob-pkg').value; const ids = orderTargets(grp).map((c) => c.id);
    if (!ids.length) return toast('Nobody in this group has an email.', true);
    if (!confirm(`Send this package email to ${ids.length} customers?`)) return;
    el.disabled = true; const out = $('#ob-out'); let total = 0;
    try {
      for (let i = 0; i < ids.length; i += 100) {
        out.innerHTML = `<div class="spinner"></div><p class="small muted" style="text-align:center">Sent ${total} of ${ids.length}…</p>`;
        if (i) await new Promise((ok) => setTimeout(ok, 700));
        const r = await api('POST', '/api/admin/order/send', { ids: ids.slice(i, i + 100), pkg, link: $('#ob-link').value.trim(), appUrl: location.origin }); total += r.sent;
      }
      out.innerHTML = `<div class="notice success">✅ Sent ${total} package emails.${ids.length - total ? ` ${ids.length - total} skipped (invalid email).` : ''}</div>`;
      state.admin.customers = await api('GET', '/api/admin/customers');
    } catch (e) { out.innerHTML = `<div class="notice danger">${esc(e.message)} (sent ${total})</div>`; el.disabled = false; }
  },
  'renewal-one': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    const appUrl = location.origin + location.pathname.replace(/index\.html$/, '');
    const pv = await api('GET', `/api/admin/customers/${c.id}/renewalpreview?appUrl=${encodeURIComponent(appUrl)}`);
    const body = modal('🔁 Renewal offer', `<p class="muted small" style="margin-top:0">Subject: <b>${esc(pv.subject)}</b>${c.renewalSentAt ? ` · already sent ${fmtDate(c.renewalSentAt)}` : ''}</p><iframe id="mail-pv" sandbox="" style="width:100%;height:60vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>
      <div class="row" style="margin-top:12px"><input id="mail-to" value="${esc(c.email || '')}" style="flex:1" autocapitalize="none"><button class="btn primary" data-act="renewal-send" data-id="${c.id}">Send renewal email</button></div>`, { wide: true });
    $('#mail-pv', body).srcdoc = pv.html;
  },
  'renewal-send': async (el) => {
    el.disabled = true;
    try { await api('POST', `/api/admin/customers/${el.dataset.id}/renewal`, { to: $('#mail-to').value, appUrl: location.origin }); toast(t('renewalEmailSent')); closeModal(); if (state.admin.tab === 'customers') { state.admin.customers = await api('GET', '/api/admin/customers'); $('#cust-list').innerHTML = customerListHtml(); } }
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
    const body = modal('✉️ Email login details', `<p class="muted small" style="margin-top:0">Subject: <b>${esc(pv.subject)}</b></p><iframe id="mail-pv" sandbox="" style="width:100%;height:60vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>
      <div class="row" style="margin-top:12px"><input id="mail-to" value="${esc(c.email || '')}" style="flex:1" autocapitalize="none"><button class="btn primary" data-act="email-send" data-id="${c.id}">Send email</button></div>`, { wide: true });
    $('#mail-pv', body).srcdoc = pv.html;
  },
  'email-send': async (el) => {
    el.disabled = true;
    try { await api('POST', `/api/admin/customers/${el.dataset.id}/email`, { to: $('#mail-to').value, appUrl: location.origin + location.pathname.replace(/index\.html$/, '') }); toast(t('emailSent')); closeModal(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'close-modal': () => closeModal(),
  'new-member': () => modal('Add team member', memberForm(null), { wide: true }),
'promote-member': async (el) => { try { await api('PUT', '/api/admin/team/' + el.dataset.id, { promote: true }); toast(t('promotedToActive')); $('#admin-body').innerHTML = await adminTeam(); } catch (e) { toast(e.message, true); } },
'edit-member': (el) => modal('Edit team member', memberForm(state.admin.team.find((x) => x.id === el.dataset.id)), { wide: true }),
'toggle-member': async (el) => { const m = state.admin.team.find((x) => x.id === el.dataset.id); await api('PUT', '/api/admin/team/' + m.id, { status: m.status === 'disabled' ? 'active' : 'disabled' }); toast(t('updated')); renderAdmin(); },
'del-member': async (el) => { const m = state.admin.team.find((x) => x.id === el.dataset.id); if (!confirm(`Remove ${m.name}? They will no longer be able to sign in.`)) return; await api('DELETE', '/api/admin/team/' + m.id); toast(t('deleted')); renderAdmin(); },
preset: (el) => { const roles = { ...(state.admin.me.allRoles || PRESETS), 'Ads agent': agentPermissionPreset() }; const p = roles[el.dataset.p]; document.querySelectorAll('[data-perm-cb]').forEach((cb) => { cb.checked = !p || p.includes(cb.value); }); const r = $('form[data-form=member] [name=role]'); if (r && el.dataset.p !== 'Full access') r.value = el.dataset.p; },
'trial-login': async (el) => { closeModal(); try { const r = await api('POST', '/api/login', { username: el.dataset.u, password: el.dataset.p }); setSession(r.token, r.role); route(); } catch (e) { renderLogin(e.message); } },
theme: () => {
    const order = ['auto', 'light', 'dark']; const next = order[(order.indexOf(themeMode()) + 1) % 3];
    localStorage.setItem('tvp_theme', next); applyTheme(); toast(t('themeLabel', { label: themeLabel() }));
  },
lang: (el) => applyLang(el.dataset.lang),
  'lang-center': () => openLanguageCenter(),
trial: () => modal('🎁 ' + t('trialTitle', { hours: state.config.trial.hours }), trialForm()),
'new-tx': async (el) => { if (!state.admin.settings) state.admin.settings = await api('GET', '/api/admin/settings'); const type = el.dataset.type || 'income'; modal(type === 'income' ? 'Add income' : type === 'expense' ? 'Add expense' : 'Transfer between banks', txForm(type, el.dataset.acc)); },
'del-tx': async (el) => { if (!confirm('Delete this transaction? If it is a sale or a credit purchase, that sale / purchase is removed too (profits and stock update).')) return; await api('DELETE', '/api/admin/tx/' + el.dataset.id); toast(t('deleted')); renderAdmin(); },
'clear-tx': async (el) => { if (!confirm('⚠️ This will permanently delete ALL transaction history. This cannot be undone. Are you sure?')) return; el.disabled = true; el.textContent = 'Clearing…'; try { const r = await api('DELETE', '/api/admin/tx'); toast(t('clearedTransactions', { count: r.cleared })); renderAdmin(); } catch (e) { toast(e.message, true); } finally { el.disabled = false; el.textContent = '🗑 Clear all history'; } },
'tx-filter': (el) => { state.admin.txAccount = el.dataset.acc; renderAdmin(); },
'stripe-match': async (el) => { if (!confirm('Add one adjustment so the Stripe bank in the app equals your real Stripe balance?')) return; const r = await api('POST', '/api/admin/stripe/match', { target: Number(el.dataset.target) }); const diff = r.diff > 0 ? '+' + r.diff : r.diff; toast(t('stripeSynced', { diff })); renderAdmin(); },
'refresh-rates': async () => { await api('POST', '/api/admin/rates/refresh'); toast(t('ratesUpdated')); renderAdmin(); },
  'add-acc': () => $('#acc-rows').insertAdjacentHTML('beforeend', accRow({ name: '', currency: 'USD', opening: 0, color: '#FF6B42' })),
  'del-acc': (el) => { if (confirm('Remove this bank? Its transactions stay but will not count in balances.')) el.closest('.acc-row').remove(); },
  'save-accounts': async () => {
    const accounts = [...document.querySelectorAll('#acc-rows .acc-row')].map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`).value; return { id: r.dataset.acc || undefined, name: g('name'), currency: g('currency'), opening: Number(g('opening')), color: g('color') }; }).filter((a) => a.name);
    const rates = {}; document.querySelectorAll('[data-rate]').forEach((i) => { rates[i.dataset.rate] = Number(i.value) || 1; });
    await saveSettings({ finance: { accounts, rates, autoRates: $('#auto-rates').checked, stripeKey: $('#stripe-key').value.trim() } }); renderAdmin();
  },
  'export-tx': async () => {
    const f = state.admin.finance; const tx = sortTxNewest(await api('GET', '/api/admin/tx?limit=100000'));
    const n = (id) => f.accounts.find((a) => a.id === id)?.name || '';
    const rows = [['Date', 'Type', 'Account', 'Amount', 'To account', 'Amount received', 'Category', 'Note']].concat(tx.map((x) => [txTimeLabel(x), x.type, n(x.accountId), x.amount, n(x.toAccountId), x.toAmount ?? '', x.category, x.note]));
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
  'tg-connect': async (el) => {
    const out = $('#tg-out'); if (!out) return; out.innerHTML = '<div class="spinner"></div>';
    const btn = el; btn.disabled = true;
    try {
      await saveSettings(formToObj($('form[data-form=settings]')), true);
      const r = await api('POST', '/api/admin/telegram/setup', { url: location.origin }).catch((e) => ({ ok: false, error: e.message }));
      out.innerHTML = r.ok ? `<div class="notice success">✅ Connected${r.botUsername ? ' as @' + esc(r.botUsername) : ''}${r.webhook ? ' · webhook set' : ''}</div>` : `<div class="notice danger">❌ ${esc(r.error || 'Connection failed')}</div>`;
      if (r.ok) setTimeout(renderAdmin, 900);
    } finally { btn.disabled = false; }
  },
  'tg-test': async (el) => {
    const out = $('#tg-out'); if (!out) return; out.innerHTML = '<div class="spinner"></div>';
    const btn = el; btn.disabled = true;
    try {
      await saveSettings(formToObj($('form[data-form=settings]')), true);
      const r = await api('POST', '/api/admin/telegram/test', {}).catch((e) => ({ ok: false, error: e.message }));
      out.innerHTML = r.ok ? '<div class="notice success">✅ Test message sent to the admin chat</div>' : `<div class="notice danger">❌ ${esc(r.error || 'Failed')}</div>`;
    } finally { btn.disabled = false; }
  },
  'modal-bg': (el, e) => { if (e.target === el) closeModal(); },
  'pw-eye': (el) => { const i = el.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; },
  logout: async () => { await pushForget(); try { await api('POST', '/api/logout'); } catch {} setSession(null); state.showLogin = /^\/intprototv/i.test(location.pathname); document.body.className = ''; await refreshConfig(); route(); },
  atab: (el) => { state.admin.tab = el.dataset.tab; window.scrollTo(0, 0); renderAdmin(); },
  'menu-open': () => { $('#side')?.classList.add('open'); document.querySelector('.side-bg')?.classList.add('open'); setTimeout(() => $('.nav-search')?.focus(), 50); },
  'menu-close': () => { $('#side')?.classList.remove('open'); document.querySelector('.side-bg')?.classList.remove('open'); },
  'cust-filter': (el) => { state.admin.filter = el.dataset.f; state.admin.custLimit = 60; $('#admin-body').innerHTML = adminCustomers(); if (el.dataset.f === 'lastmonth') nmStats(); },
  'orders-open': async () => {
    let d; try { d = await api('GET', '/api/admin/orders'); } catch (e) { return toast(e.message, true); }
    const o = d.settings || {}; const owner = state.admin.me?.role === 'owner' || state.me?.isOwner || can('settings');
    modal('🧾 Order numbers', `<p class="small muted" style="margin-top:0">Order numbers are kept exactly as they were in your Google Sheet. The customer list is sorted by order date and number (oldest first) — change it with <b>Order</b> above the list.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">${[['Customers', d.total], ['With a number', d.withNumber], ['With original date', d.dated], ['Several devices', d.multiDevice], ['Same number twice', d.duplicates.length]].map(([l, n]) => `<div style="flex:1;min-width:110px;background:var(--soft,rgba(148,163,184,.12));border-radius:12px;padding:8px 10px"><div class="small muted">${l}</div><b style="font-size:1.3rem">${n}</b></div>`).join('')}</div>
      <h3 style="margin:14px 0 6px">Next numbers</h3><p class="small" style="margin:0">Standard <b>${esc(d.next.standard)}</b> · IBO <b>${esc(d.next.ibo)}</b> · Reseller <b>${esc(d.next.reseller)}</b> <span class="muted">— one counter shared by ${esc(d.series.join(', '))} (highest now: ${d.series.map((p) => `${p}-${d.prefixes[p] || 0}`).join(', ')})</span></p>
      <form data-form="orders-set" class="grid3" style="margin-top:8px">${field('Standard prefix', 'prefix', o.prefix || 'WLF')}${field('IBO prefix', 'iboPrefix', o.iboPrefix || 'IBO')}${field('Reseller prefix', 'rslPrefix', o.rslPrefix || 'RLS')}<div style="grid-column:1/-1" class="row"><span class="small muted" style="flex:1">A new customer with an empty order number gets the next number. A number already used is refused.</span><button class="btn sm primary">💾 Save prefixes</button></div></form>
      <h3 style="margin:14px 0 6px">Same number on two customers (${d.duplicates.length})</h3>
      ${d.duplicates.length ? `<p class="small muted" style="margin:0 0 6px">These came from the sheet like this. Nothing was changed. Open one and give it its own number if you want.</p><div class="table-wrap" style="max-height:220px;overflow:auto"><table><tbody>${d.duplicates.map((g) => g.map((c, i) => `<tr><td>${i ? '' : `<b>${esc(c.orderNo)}</b>`}</td><td><button class="name-link" data-act="view-customer" data-id="${c.id}">${esc(c.name)}</button> <span class="small muted">${esc(c.username)} · ${c.orderNo !== g[0].orderNo ? esc(c.orderNo) + ' · ' : ''}${c.at ? fmtDate(c.at) : ''}</span></td></tr>`).join('')).join('')}</tbody></table></div>` : '<p class="small muted">None 👍</p>'}
      ${d.missingCount ? `<h3 style="margin:14px 0 6px">Without an order number (${d.missingCount})</h3><p class="small">${d.missing.map((c) => `<button class="name-link" data-act="view-customer" data-id="${c.id}">${esc(c.name)}</button>`).join(', ')}</p>` : ''}
      <h3 style="margin:14px 0 6px">Backups</h3>
      ${d.backups.length ? `<ul class="small" style="margin:0;padding-left:18px">${d.backups.map((b) => `<li>${fmtDT(b.at)} · ${b.customers} customers · ${esc(b.why || '')} <a href="#" data-act="orders-dl" data-k="${esc(b.key)}">⬇️ Download</a></li>`).join('')}</ul>` : '<p class="small muted">No backup yet.</p>'}
      <div class="row" style="margin-top:12px"><span class="small muted" style="flex:1">Makes a full backup first, then saves each customer's original order date so the order can never get mixed up again. Order numbers, customers and subscriptions are not changed.</span><button class="btn primary" data-act="orders-fix" data-perm="settings">🛟 Back up & keep original dates</button></div>`, { wide: true });
  },
  'orders-fix': async (el) => { el.disabled = true; try { const r = await api('POST', '/api/admin/orders/organize', {}); toast(`Backup saved ✓ · original date kept for ${r.dated} customers`); closeModal(); renderAdmin(); setTimeout(() => actions['orders-open'](), 600); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'orders-dl': async (el) => { try { const b = await api('GET', `/api/admin/orders/backup?key=${encodeURIComponent(el.dataset.k)}`); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(b)], { type: 'application/json' })); a.download = `intproto-backup-${new Date(b.exportedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`; a.click(); } catch (e) { toast(e.message, true); } },
  'nm-ren': (el) => { state.admin.nmRen = state.admin.nmRen === el.dataset.r ? '' : el.dataset.r; nmStats().then(() => $('#nm-stats details')?.setAttribute('open', '')); },
  'nm-month': (el) => { state.admin.nmBack = Math.max(0, (state.admin.nmBack || 1) + Number(el.dataset.d)); $('#admin-body').innerHTML = adminCustomers(); nmStats(); },
  'cust-more': () => { state.admin.custLimit = (state.admin.custLimit || 60) + 100; $('#cust-list').innerHTML = customerListHtml(); },
  'new-customer': () => { modal('Add customer', customerForm(null), { wide: true }); },
  'edit-customer': async (el) => { if (!(state.admin.customers || []).some((x) => x.id === el.dataset.id)) state.admin.customers = await api('GET', '/api/admin/customers'); const c = state.admin.customers.find((x) => x.id === el.dataset.id); modal('Edit customer', customerForm(c), { wide: true }); },
  'gen-login': () => {
    const f = $('form[data-form=customer]');
    const rnd = (n, chars) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => chars[x % chars.length]).join('');
    f.username.value = 'u' + rnd(6, '0123456789');
    f.password.value = rnd(8, 'abcdefghjkmnpqrstuvwxyz23456789');
  },
'contact-toggle': async (el) => {
    el.disabled = true;
    try { await api('PUT', '/api/admin/customers/' + el.dataset.id, { contact: { [el.dataset.k]: 'toggle' } }); state.admin.customers = await api('GET', '/api/admin/customers'); $('#cust-list').innerHTML = customerListHtml(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
renew: async (el) => {
    if (!state.admin.customers.length || !state.admin.customers.find((x) => x.id === el.dataset.id)) state.admin.customers = await api('GET', '/api/admin/customers');
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    modal('Renew subscription', renewForm(c)); updateRenewPreview();
  },
'toggle-customer': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    const msg = c.status === 'disabled' ? t('customerEnabled') : t('customerDisabled');
    try { await api('POST', `/api/admin/customers/${c.id}/toggle`, {}); toast(msg); }
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
    toast(t('customerDeleted')); renderAdmin();
  },
'copy-login': async (el) => {
    const c = state.admin.customers.find((x) => x.id === el.dataset.id);
    const b = state.config.branding;
    const text = `${b.appName}\n🌐 ${location.origin}\n👤 Username: ${c.username}\n📅 Expires: ${(c.noExpiry ? '♾ No end date' : fmtDate(c.expiresAt))}\n(Password as given when the account was created)`;
    try { await navigator.clipboard.writeText(text); toast(t('loginDetailsCopied')); } catch { prompt('Copy:', text); }
  },
'export-xlsx': async () => {
    toast(t('preparingExcel'));
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
  'rs-open': (el) => rsOpen(el.dataset.id),
  'rs-copy': async (el) => { const x = rsGet(el.dataset.id); const txt = [x.name + ' (' + x.rslId + ')', x.email, /•/.test(x.phone) ? '' : x.phone, x.panelUrl && 'URL: ' + x.panelUrl, x.panelUser && 'Username: ' + x.panelUser, x.panelPass && 'Password: ' + x.panelPass].filter(Boolean).join('\n'); try { await navigator.clipboard.writeText(txt); toast('Details copied ✓'); } catch { toast(txt); } },
  'rs-mark': (el) => {
    const x = rsGet(el.dataset.id); const k = el.dataset.k; const ct = x.contact || {}; const name = { email: 'Email', whatsapp: 'WhatsApp', telegram: 'Telegram' }[k]; const noK = k === 'email' ? '' : 'no' + k[0].toUpperCase() + k.slice(1); const on = contactedRecently(ct[k]);
    modal(`${name} · ${esc(x.name)}`, `<p class="small muted" style="margin-top:0">${on ? `Marked sent ${fmtDT(ct[k])}. It clears by itself 24 hours later.` : 'Not marked as sent in the last 24 hours.'}</p><div class="row" style="gap:8px">${on ? `<button class="btn" data-act="rs-mark-set" data-id="${x.id}" data-k="${k}" data-v="0">Clear ✓</button>` : `<button class="btn primary" data-act="rs-mark-set" data-id="${x.id}" data-k="${k}" data-v="1">✓ Mark as sent</button>`}${noK ? `<button class="btn ${ct[noK] ? '' : 'danger'}" data-act="rs-mark-set" data-id="${x.id}" data-k="${noK}" data-v="${ct[noK] ? 0 : 1}">${ct[noK] ? `✓ They have ${name} after all` : `✕ Has no ${name}`}</button>` : ''}</div>`);
  },
  'rs-mark-set': async (el) => { try { await api('POST', '/api/admin/reseller/contact', { id: el.dataset.id, k: el.dataset.k, v: el.dataset.v === '1' }); await rsReload(); } catch (e) { toast(e.message, true); } },
  'rs-msg': (el) => {
    const x = rsGet(el.dataset.id); const tg = el.dataset.ch === 'tg'; const tp = RS.data.emailTpl || {};
    const fill = (t) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => ({ name: x.name.split(' ')[0], fullname: x.name, rsl: x.rslId, url: x.panelUrl, username: x.panelUser, password: x.panelPass, credits: x.credits, orders: x.purchases, spent: usd(x.spentUsd), org: x.org, server: x.server })[k] ?? m);
    const def = `Hello ${x.name.split(' ')[0]} 👋\n\nYour reseller panel (${x.rslId}):\n${x.panelUrl ? '🌐 URL: ' + x.panelUrl + '\n' : ''}${x.panelUser ? '👤 Username: ' + x.panelUser + '\n' : ''}${x.panelPass ? '🔑 Password: ' + x.panelPass + '\n' : ''}\nAny question, just reply here.`;
    modal(`${tg ? '✈️ Telegram' : '💬 WhatsApp'} · ${esc(x.name)}`, `<form data-form="rs-msg" onsubmit="return false" data-id="${x.id}" data-ch="${tg ? 'tg' : 'wa'}">
      ${tg ? field('Telegram username', 'tgUser', x.telegram || '', { ph: 'without @ (empty = phone number)', attrs: 'autocapitalize="none"' }) : field('WhatsApp number', 'phone', /•/.test(x.phone) ? '' : String(x.phone || '').replace(/\D/g, ''), { type: 'tel' })}
      ${field('Message', 'text', tp.body ? fill(tp.body) : def, { type: 'textarea', rows: 9 })}
      <div class="row"><span class="spacer"></span><button type="button" class="btn primary ${tg ? 'brand-send tg' : 'wa-btn'}" data-act="rs-msg-go">${tg ? '✈️ Send on Telegram' : '💬 Open WhatsApp'}</button></div></form>`, { wide: true });
  },
  'rs-msg-go': async (el) => {
    const f = el.closest('form'); const id = f.dataset.id; const text = f.text.value; el.disabled = true;
    try {
      if (f.dataset.ch === 'wa') {
        const ph = f.phone.value.replace(/\D/g, ''); if (!ph || ph.startsWith('0')) { el.disabled = false; return toast(t('waNoLeadingZero'), true); }
        window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        await api('POST', '/api/admin/reseller/contact', { id, k: 'whatsapp', v: true });
      } else {
        const r = await api('POST', '/api/admin/reseller/tgsend', { id, text });
        if (r.sent) toast('Sent by your Telegram bot ✓');
        else { try { await navigator.clipboard.writeText(text); } catch {} const u = f.tgUser.value.trim().replace(/^@/, ''); const x = rsGet(id); const ph = String(x.phone || '').replace(/\D/g, ''); if (!u && (!ph || /•/.test(x.phone))) { el.disabled = false; return toast('Add their Telegram username.', true); } window.open(u ? `https://t.me/${encodeURIComponent(u)}` : `https://t.me/+${ph}`, '_blank', 'noopener'); toast('Message copied. Paste it in the Telegram chat.'); await api('POST', '/api/admin/reseller/contact', { id, k: 'telegram', v: true }); }
      }
      await rsReload();
    } catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'rs-new': () => modal('＋ Add a reseller', rsProfileForm()),
  'rs-save': async (el) => {
    const f = el.closest('form'); if (!f.name.reportValidity()) return; const d = Object.fromEntries(new FormData(f));
    el.disabled = true;
    try { const r = await api('POST', '/api/admin/reseller/save', { ...d, id: f.dataset.id || undefined }); toast(`Saved ${r.reseller.rslId} ✓`); await rsReload(f.dataset.id ? r.reseller.id : ''); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'rs-del': async (el) => { if (!confirm('Delete this reseller and their order history? Rows that came from your customer list go back there.')) return; try { await api('POST', '/api/admin/reseller/delete', { id: el.dataset.id }); toast('Reseller deleted'); await rsReload(); } catch (e) { toast(e.message, true); } },
  'rs-order': (el) => {
    const x = rsGet(el.dataset.id); const o = (x.orders || []).find((y) => y.id === el.dataset.oid) || {};
    modal(o.id ? 'Edit order' : `＋ Order for ${esc(x.name)}`, `<form data-form="rs-order" onsubmit="return false" data-id="${x.id}" data-oid="${esc(o.id || '')}">
      <div class="grid3">${field('Date', 'date', rsDay(o.at) || (o.id ? '' : rsDay(Date.now())), { type: 'date' })}${field('Order number', 'ref', o.ref || '')}${field('Server', 'server', o.server || x.server || '')}</div>
      <div class="grid2">${field('Package', 'pkg', o.pkg || '', { ph: 'e.g. 10 Credit' })}${field('Credits', 'credits', o.credits || '', { type: 'number', attrs: 'min="0"' })}</div>
      <div class="grid2">${field('Price paid', 'amount', o.amount || '', { type: 'number', attrs: 'step="any" min="0"' })}${field('Currency', 'currency', o.currency || 'USD', { type: 'select', options: (RS.data.currencies || ['USD']).map((c) => [c, c]) })}</div>
      ${field('Note', 'note', o.note || '')}
      <p class="small muted">This is history only. It does not change your bank balances.</p>
      <div class="row"><button type="button" class="btn" data-act="rs-open" data-id="${x.id}">← Back</button><span class="spacer"></span><button type="button" class="btn primary" data-act="rs-order-save">💾 Save order</button></div></form>`);
  },
  'rs-order-save': async (el) => {
    const f = el.closest('form'); const d = Object.fromEntries(new FormData(f)); el.disabled = true;
    try { await api('POST', '/api/admin/reseller/order', { id: f.dataset.id, order: { ...d, id: f.dataset.oid || undefined } }); toast('Order saved ✓'); await rsReload(f.dataset.id); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'rs-order-del': async (el) => { if (!confirm('Remove this order from the history?')) return; try { await api('POST', '/api/admin/reseller/order-delete', { id: el.dataset.id, orderId: el.dataset.oid }); await rsReload(el.dataset.id); } catch (e) { toast(e.message, true); } },
  'rs-found-add': async (el) => { const f = RS.data.found[Number(el.dataset.i)]; el.disabled = true; try { const r = await api('POST', '/api/admin/reseller/from-customers', { ids: f.ids }); toast(`${f.name}: ${r.orders} order${r.orders === 1 ? '' : 's'} added ✓`); await rsReload(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'rs-found-skip': async (el) => { const f = RS.data.found[Number(el.dataset.i)]; try { await api('POST', '/api/admin/reseller/dismiss', { ids: f.ids }); toast('Removed from the box'); await rsReload(); } catch (e) { toast(e.message, true); } },
  'rs-found-clear': async () => { if (!confirm('Remove all of these from the box? They stay normal customers.')) return; try { await api('POST', '/api/admin/reseller/dismiss', { ids: RS.data.found.flatMap((f) => f.ids) }); toast('Box cleared'); await rsReload(); } catch (e) { toast(e.message, true); } },
  'rs-found-all': async (el) => { el.disabled = true; try { const r = await api('POST', '/api/admin/reseller/from-customers', { ids: RS.data.found.flatMap((f) => f.ids) }); toast(`${r.made} reseller${r.made === 1 ? '' : 's'} added with ${r.orders} orders ✓`); await rsReload(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'rs-pick': async () => {
    RS.pick = new Set(); RS.pq = '';
    modal('👥 Choose from my data', `<div class="spinner"></div>`, { wide: true });
    try { RS.customers = await api('GET', '/api/admin/customers'); } catch (e) { closeModal(); return toast(e.message, true); }
    closeModal();
    modal('👥 Choose from my data', `<input data-input="rs-pq" placeholder="🔍 Search name, email, phone or order number…" autocomplete="off">
      <div id="rs-pick-list" style="max-height:52vh;overflow:auto;margin:10px 0">${rsPickHtml()}</div>
      <label class="row small" style="gap:8px"><input type="checkbox" id="rs-pick-orders" checked style="width:auto"> Each chosen row is one order of the reseller (it leaves the customer list)</label>
      <p class="small muted">Rows of the same person (same phone or email) become one reseller.</p>
      <div class="row"><span class="spacer"></span><button class="btn primary" id="rs-pick-go" data-act="rs-pick-go">＋ Add 0 rows as reseller</button></div>`, { wide: true });
  },
  'rs-pick-go': async (el) => {
    if (!RS.pick.size) return toast('Tick at least one row.', true); el.disabled = true;
    try { const r = await api('POST', '/api/admin/reseller/from-customers', { ids: [...RS.pick], orders: $('#rs-pick-orders').checked }); toast(`${r.resellers.map((x) => x.rslId).join(', ')}: ${r.rows} row${r.rows === 1 ? '' : 's'} added ✓`); await rsReload(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'rs-text': () => { RS.parsed = null; modal('📋 Add resellers from text', `<p class="small muted">Paste contact details, a list with “Name: … Email: … Phone: …”, order lines, or rows copied from your Google Sheet. Card numbers are ignored.</p>
    <textarea id="rs-text-in" rows="9" placeholder="Paste here…" dir="auto"></textarea>
    <div class="row" style="margin:10px 0"><button class="btn primary" data-act="rs-text-read">🔎 Read the text</button></div><div id="rs-text-out"></div>`, { wide: true }); },
  'rs-text-read': () => { RS.parsed = parseResellerText($('#rs-text-in').value).profiles; $('#rs-text-out').innerHTML = rsParsedHtml(); },
  'rs-text-add': async (el) => {
    const profiles = (RS.parsed || []).filter((p, i) => $(`[data-rs-p="${i}"]`)?.checked).map((p) => ({ ...p, name: $(`[data-rs-name="${(RS.parsed || []).indexOf(p)}"]`)?.value || p.name }));
    if (!profiles.length) return toast('Tick at least one reseller.', true); el.disabled = true;
    try { const r = await api('POST', '/api/admin/reseller/import', { profiles }); toast(`${r.made} added, ${r.updated} updated, ${r.orders} orders ✓`); await rsReload(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'rs-email': (el) => { const x = el.dataset.id ? rsGet(el.dataset.id) : null; modal(x ? `✉️ Email ${esc(x.name)}` : '✉️ Email resellers', rsEmailForm(el.dataset.id), { wide: true }); },
  'rs-mail-pv': async () => { try { const pv = await api('POST', '/api/admin/reseller/email', { ...rsMailBody(), preview: true }); const fr = $('#rs-mail-frame'); fr.style.display = ''; fr.srcdoc = pv.html; toast('Subject: ' + pv.subject); } catch (e) { toast(e.message, true); } },
  'rs-mail-save': async () => { try { await api('POST', '/api/admin/reseller/email', { ...rsMailBody(), save: true, saveOnly: true }); RS.data.emailTpl = rsMailBody(); toast('Template saved ✓'); } catch (e) { toast(e.message, true); } },
  'rs-mail-send': async (el) => {
    const b = rsMailBody(); if (!confirm(b.all ? 'Send this email to all active resellers?' : 'Send this email?')) return; el.disabled = true;
    try { const r = await api('POST', '/api/admin/reseller/email', b); toast(`Sent to ${r.sent} ✓`); await rsReload(); } catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'sell-rp': () => modal('🤝 Sell a reseller package', resellerSaleForm(state.admin.settings)),
  'add-rp': () => $('#rps').insertAdjacentHTML('beforeend', `<div class="rp-row" data-rp=""><input data-k="name" placeholder="Name"><input data-k="credits" type="number" value="10"><input data-k="price" type="number" step="any" value="0"><button class="btn sm danger" data-act="del-rp" title="Remove reseller plan" aria-label="Remove reseller plan">✕</button></div>`),
  'del-rp': (el) => el.closest('.rp-row').remove(),
  'save-rp': async () => {
    const resellerPackages = [...document.querySelectorAll('#rps .rp-row')].map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`).value; return { id: r.dataset.rp || undefined, name: g('name'), credits: Number(g('credits')), price: Number(g('price')) }; }).filter((p) => p.name);
    await saveSettings({ resellerPackages, resellerCurrency: $('#rp-cur').value, ...($('#rp-pay') ? { resellerPayMethods: $('#rp-pay').value.split('\n').map((x) => x.trim()).filter(Boolean) } : {}) }); renderAdmin();
  },
  'add-plan': () => { $('#plans').insertAdjacentHTML('beforeend', `<div class="plan-row" data-plan=""><input data-k="name" placeholder="Name"><input data-k="days" type="number" value="30"><input data-k="price" type="number" value="0"><input data-k="credits" type="number" value="1"><input data-k="connections" type="number" value="1"><input data-k="package" placeholder="Package ID"><button class="btn sm danger" data-act="del-plan" title="Remove plan" aria-label="Remove plan">✕</button></div>`); },
  'del-plan': (el) => el.closest('.plan-row').remove(),
  'save-plans': async () => {
    const plans = [...document.querySelectorAll('#plans .plan-row')].map((r) => {
      const g = (k) => r.querySelector(`[data-k=${k}]`).value;
      return { id: r.dataset.plan || undefined, name: g('name'), days: Number(g('days')), price: Number(g('price')), credits: g('credits'), connections: Number(g('connections')), package: g('package') };
    }).filter((p) => p.name);
    if (!plans.length) return toast(t('addAtLeastOnePlan'), true);
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
  utab: (el) => { state.user.tab = el.dataset.tab === 'account' ? 'account' : 'home'; state.user.q = ''; state.user.limit = 120; window.scrollTo(0, 0); renderUser(); },
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
    if (!quiet) toast(t('saved'));
  } catch (e) { toast(e.message, true); throw e; }
}

const forms = {
  async 'wa-nums'(f) { const rows = [...f.querySelectorAll('.wa-num')].map((el) => { const i = el.querySelector('[name^=label_]').name.slice(6); return { id: el.dataset.wa, label: f['label_' + i].value.trim(), use: f['use_' + i].value, number: (fullPhone(f, 'num_' + i) || '').replace(/\D/g, ''), on: f['on_' + i].checked }; });
    const bad = rows.find((r) => r.number.length < 8); if (bad) return toast('Each number needs a country code and the number.', true);
    await saveSettings({ waNumbers: rows }); renderAdmin(); },
  async exp(f) { const v = f.when.value; if (!v) return toast('Pick a date and time', true); expDo(f.dataset.id, { action: 'set', expiresAtMs: new Date(v).getTime() }); },
  async 'note-send'(f) { const b = f.querySelector('button.primary'); b.disabled = true; try { const r = await api('POST', '/api/admin/app-notify', formToObj(f)); closeModal(); toast(`Sent to ${r.people} customer${r.people === 1 ? '' : 's'}${r.devices ? ` · ${r.devices} phone${r.devices === 1 ? '' : 's'} rang` : ''} ✓`); } catch (e) { toast(e.message, true); b.disabled = false; } },
  async 'hd-connect'(f) { const k = f.dataset.k; const b = f.querySelector('button'); b.disabled = true;
    try { const r = await api('POST', '/api/admin/accounts/save', { kind: k, name: k === 'hostinger' ? 'Hostinger' + (f.email.value ? ' · ' + f.email.value : '') : 'Dynu' + (f.email.value ? ' · ' + f.email.value : ''), apiKey: f.apiKey.value.trim(), email: f.email.value.trim() });
      toast('Connected ✓ Checking…'); await renderAdmin(); actions[k === 'hostinger' ? 'acc-hostinger' : 'acc-dynu']({ dataset: { id: r.account.id } }); } catch (e) { toast(e.message, true); b.disabled = false; } },
  async acc(f) { const o = formToObj(f); o.id = f.dataset.id || undefined; try { await api('POST', '/api/admin/accounts/save', o); closeModal(); toast('Saved ✓'); renderAdmin(); } catch (e) { toast(e.message, true); } },
  async 'acc-dns'(f) { const b = f.querySelector('button.primary'); b.disabled = true; $('#dns-out').innerHTML = '<p class="muted">Working…</p>';
    try { const o = formToObj(f); const dz = ACC.d.rows.find((a) => a.id === o.dnsId); const isH = dz?.kind === 'hostinger';
      const r = await api('POST', isH ? '/api/admin/accounts/hostinger-dns' : '/api/admin/accounts/dynu', isH ? { hostingerId: o.dnsId, resendId: o.resendId, domain: o.domain } : { dynuId: o.dnsId, resendId: o.resendId, domain: o.domain }); $('#dns-out').innerHTML = `<div class="notice success">${isH ? 'Hostinger' : 'Dynu'} zone <b>${esc(r.zone)}</b>: ${r.added.length} added${r.added.length ? ' (' + esc(r.added.join(', ')) + ')' : ''}, ${r.skipped.length} already there.${r.failed.length ? `<br>Not added: ${esc(r.failed.join(' · '))}` : ''}</div><p class="small">Now open Resend → Domains → press <b>Verify</b>. DNS can take a few minutes.</p>`; }
    catch (e) { $('#dns-out').innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; } b.disabled = false; },
  async 'acc-sheet'(f, ev) { const what = ev?.submitter?.dataset?.do || 'save'; try { const r = await api('POST', '/api/admin/accounts/sheet', { url: f.url.value.trim(), push: what === 'push', pull: what === 'pull' }); closeModal(); toast(what === 'push' ? `Sent ${r.pushed} account(s) to the sheet ✓` : what === 'pull' ? `From the sheet: ${r.added} new, ${r.changed} updated ✓` : 'Link saved ✓'); renderAdmin(); } catch (e) { toast(e.message, true); } },
  async 'acc-paste'(f) { try { const r = await api('POST', '/api/admin/accounts/import', { text: f.text.value }); closeModal(); toast(`${r.added} new, ${r.changed} updated ✓`); renderAdmin(); } catch (e) { toast(e.message, true); } },
  async 'nl-season'(f) { try { const q = new URLSearchParams({ kind: f.dataset.k, offer: f.offer.value.trim(), code: f.code.value.trim().toUpperCase(), end: f.end.value }); const d = await api('GET', '/api/admin/newsletter/season?' + q);
      try { localStorage.setItem('tvp_nl_draft', JSON.stringify({ ...nlBlank(), ...d.campaign, group: 'active' })); } catch {} await actions['nl-open'](); toast('Template loaded in 5 languages ✓ Check it with Preview, then Send.'); } catch (e) { toast(e.message, true); } },
  async 'rsl-order'(f) { const b = f.querySelector('button.primary'); b.disabled = true; try { await api('POST', '/api/rsl/order', { pkg: f.dataset.id, method: f.method?.value || (f.querySelector('[name=method]:checked')?.value || ''), note: f.note.value }); closeModal(); toast(t('rsl_orderSent')); RSL.tab = 'home'; renderRsl(); } catch (e) { toast(e.message, true); b.disabled = false; } },
  async 'rsl-pass'(f) { try { await api('POST', '/api/rsl/password', { current: f.current.value, password: f.password.value }); toast(t('rsl_pwChanged')); f.reset(); } catch (e) { toast(e.message, true); } },
  async 'orders-set'(f) { const o = formToObj(f); for (const k of ['prefix', 'iboPrefix', 'rslPrefix']) { o[k] = String(o[k] || '').trim(); if (!/^[A-Za-z]{1,10}$/.test(o[k])) return toast('Prefixes: letters only, like WLF.', true); } o.series = [o.prefix, o.iboPrefix, o.rslPrefix].join(','); await saveSettings({ orders: o }); actions['orders-open'](); },
  async promo(f) {
    const o = formToObj(f); if (!String(o.code || '').trim()) return toast('Type the promo code first.', true);
    if (o.from && o.to && o.to < o.from) return toast('The end date is before the start date.', true);
    o.code = String(o.code).trim().toUpperCase().replace(/\s+/g, '');
    await saveSettings({ promo: o }); renderAdmin();
  },
  async 'rp-sale'(f) {
    const o = formToObj(f); delete o.phone_cc;
    if (String(f.phone?.value || '').trim()) { const full = fullPhone(f, 'phone'); if (!full) return toast(t('phoneInvalid'), true); o.phone = full; }
    if (!o.resellerId && !String(o.name || '').trim()) return toast('Choose a reseller or type the new reseller\'s name.', true);
    if (!o.resellerId) delete o.resellerId; o.appUrl = location.origin;
    const b = f.querySelector('button.primary'); b.disabled = true;
    try { const r = await api('POST', '/api/admin/reseller-sale', o); closeModal(); await renderAdmin();
      const R = r.reseller; if (!R) return toast(t('resellerSaleRecorded'));
      modal('✅ Order complete', `<p style="margin-top:0"><b>${esc(R.name)}</b> · ${esc(R.rslId)}${R.isNew ? ' <span class="pill st-active">new reseller</span>' : ''}</p>
        <p>Order <b>${esc(r.order?.ref || '')}</b> · ${esc(r.order?.pkg || '')} · ${esc(String(r.order?.amount ?? ''))} ${esc(r.order?.currency || '')}</p>
        ${r.emailed ? '<div class="notice success">✉️ Confirmation email sent with the dashboard login.</div>' : `<div class="notice warning">${r.emailError ? '✉️ Email not sent: ' + esc(r.emailError) : 'No email sent.'} You can send the login below.</div>`}
        ${R.login ? `<div class="list-item"><span style="flex:1">Dashboard: <b>${esc(location.origin)}/rsl</b><br>Username <code>${esc(R.login.username)}</code> · Password <code>${esc(R.login.pass)}</code></span><button class="btn sm" data-act="rsl-copy" data-v="${esc(`${location.origin}/rsl\nUsername: ${R.login.username}\nPassword: ${R.login.pass}`)}">📋 Copy</button></div>` : ''}
        <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-act="rs-open" data-id="${R.id}">Open reseller</button><button class="btn primary" data-act="close-modal">Done</button></div>`);
    } catch (e) { toast(e.message, true); b.disabled = false; }
  },
  async 'browser-search'(f) {
    const q = (f.q.value || '').trim(); if (!q) return;
    const frame = $('#browser-frame iframe');
    if (frame) frame.src = 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q);
  },
async member(f) {
    const o = formToObj(f); o.perms = [...f.querySelectorAll('[data-perm-cb]:checked')].map((x) => x.value);
    if (!o.password) delete o.password;
    try { if (f.dataset.id) await api('PUT', '/api/admin/team/' + f.dataset.id, o); else await api('POST', '/api/admin/team', o); toast(t('saved')); closeModal(); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
async 'staff-password'(f) {
    try { await api('POST', '/api/admin/me/password', formToObj(f)); toast(t('passwordChanged')); f.reset(); } catch (e) { toast(e.message, true); }
  },
async trial(f) {
    const o = formToObj(f);
    const phone = fullPhone(f, 'phone'); const wa2 = o.same ? phone : fullPhone(f, 'whatsapp');
    if (!phone || (!o.same && !wa2)) { $('#trial-err').innerHTML = `<div class="err-box">${t('trial_phone')}</div>`; return; }
    const body = { name: o.name, email: o.email, phone, whatsapp: wa2, telegram: String(o.telegram || '').trim(), lang: getLang(), appUrl: location.origin + location.pathname.replace(/index\.html$/, '') };
    if (f.captchaAnswer && f.captchaAnswer.value) { body.captchaAnswer = f.captchaAnswer.value; body.captchaId = f.captchaId ? f.captchaId.value : ''; }
    const btn = f.querySelector('button.primary'); btn.disabled = true;
    try {
      const r = await api('POST', '/api/trial', body);
      const box = $('.modal-body') || $('#ft-card'); const onPage = !$('.modal-body'); const closeBtn = onPage ? '' : `<button class="btn primary block" data-act="close-modal" style="margin-top:12px">OK</button>`;
      if (r.queued) { const tgq = r.telegram || state.config.telegram; const tgStart = r.telegram?.start || tgq?.link; box.innerHTML = `<div class="notice success"><p style="margin:0 0 6px">${t('trialQueued')}</p><p class="small muted" style="margin:0">${t('trialQueuedSub', { email: esc(o.email) })}</p></div>${tgStart ? `<p class="small muted" style="margin-top:10px">${t('trialTgNotLinked')} <a href="${esc(tgStart)}" target="_blank" rel="noopener">${t('trialTgOpen')}</a></p>` : ''}${closeBtn}`; return; }
      const lines = [`Username: ${r.username}`, `Password: ${r.password}`, `DNS: ${r.dns || '—'}`, `M3U: ${r.m3u || '—'}`].join('\n');
      const b0 = state.config.branding;
      const tg = r.telegram || {};
      const tgLine = r.pending ? '' : tg.sent ? `<p class="small pos" style="margin:8px 0 0">${t('trialTgSent')}</p>` : tg.link ? `<p class="small muted" style="margin:8px 0 0">${t('trialTgNotLinked')} <a href="${esc(tg.link)}" target="_blank" rel="noopener">${t('trialTgOpen')}</a></p>` : '';
      box.innerHTML = `<p>${r.pending ? t('trialPending') : t('trialShown')}</p><div class="code" dir="ltr" id="trial-creds" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(lines)}</div>${tgLine}
        <div class="row" style="margin-top:10px"><button type="button" class="btn" data-act="copy-el" data-el="trial-creds" style="flex:1">📋 ${t('copy')}</button>${waNum(b0) ? `<a class="btn wa-btn" style="flex:1" href="${esc(waUrl(b0, t('waMsg', { app: b0.appName, u: r.username })))}" target="_blank" rel="noopener">💬 ${t('whatsapp')}</a>` : ''}</div>
        ${r.emailed ? `<p class="small muted">${t('trialSent', { email: esc(o.email) })}</p>` : ''}
        <button class="btn primary block" data-act="trial-login" data-u="${esc(r.username)}" data-p="${esc(r.password)}" style="margin-top:12px">${t('signIn')}</button>${closeBtn}`;
    } catch (e) { $('#trial-err').innerHTML = e.data?.suggest ? `<div class="err-box">${t('trial_typo', { s: esc(e.data.suggest) })} <button type="button" class="btn sm" data-act="trial-fix" data-email="${esc(e.data.suggest)}">${t('useIt')}</button></div>` : `<div class="err-box">${esc(t(e.message))}</div>`; btn.disabled = false; }
  },
async tx(f) {
    try { await api('POST', '/api/admin/tx', applyTransactionInput(formToObj(f))); toast(t('saved')); closeModal(); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
  async stock(f) {
    try { const r = await api('POST', '/api/admin/stock', formToObj(f)); toast(r.payStatus === 'unpaid' ? 'Added to stock — marked Not paid' : t('creditsAddedToStock')); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
  async login(f) {
    const btn = f.querySelector('button.primary'); btn.disabled = true;
    try {
      const body = { username: f.username.value, password: f.password.value };
      if (f.captchaAnswer && f.captchaAnswer.value) { body.captchaAnswer = f.captchaAnswer.value; body.captchaId = f.captchaId ? f.captchaId.value : ''; }
      const r = await api('POST', '/api/login', body);
      localStorage.setItem('tvp_known', '1'); setSession(r.token, r.role); route();
    } catch (e) {
      if (e.data?.need2fa) { btn.disabled = false; state.pendingLogin = { username: f.username.value, password: f.password.value }; const b = modal('🔐 ' + t('code2faTitle'), `<p class="muted" style="margin-top:0">${t('code2faText')}</p><form data-form="login-code">${field(t('code2fa'), 'code', '', { attrs: 'required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" dir="ltr"' })}<div id="code-err" aria-live="polite"></div><button class="btn primary block">${t('verify')}</button></form>`); b.querySelector('input').focus(); return; }
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
    for (const k of ['phone', 'whatsapp']) { // "+212612345678" from the country code and the number
      const raw = String(f[k]?.value || '').trim(); const full = fullPhone(f, k);
      if (raw && !full) return toast(`${k === 'phone' ? 'Phone' : 'WhatsApp'}: choose the country code and enter the full number.`, true);
      o[k] = full; delete o[k + '_cc'];
    }
    if (!o.whatsapp) o.whatsapp = o.phone;
    o.lines = connRead(f);
    // Dates: a field that was not changed is not sent, so the exact start / end time (e.g. a 24-hour trial) is kept.
    // A changed date is sent as an exact time: start = now if it is today, else the start of that day; end = same time of day as before, else the end of that day.
    for (const k of ['startAt', 'expiresAt']) { const el = f.elements[k]; const v = String(o[k] || ''); delete o[k]; if (!el || !v || (id && v === el.defaultValue)) continue;
      const [y, m, d] = v.split('-').map(Number); const day = new Date(y, m - 1, d);
      if (k === 'startAt') o.startAtMs = v === isoDay(Date.now()) ? Date.now() : day.getTime();
      else { const prev = Number(el.dataset.ms) || 0; if (prev) { const p = new Date(prev); day.setHours(p.getHours(), p.getMinutes(), p.getSeconds(), 0); o.expiresAtMs = day.getTime(); } else o.expiresAtMs = new Date(y, m - 1, d, 23, 59, 59).getTime(); } }
    if (o.planId === 'custom' && !id && !o.expiresAtMs) { return toast('Pick an expiry date for custom plans', true); }
    const btn = f.querySelector('button.primary'); btn.disabled = true; let panelNote = '';
    try {
      if (id) { if (!o.password) delete o.password; await api('PUT', `/api/admin/customers/${id}`, o); toast('Customer updated'); }
      else {
        o.appUrl = location.origin + location.pathname.replace(/index\.html$/, '');
        const r = await api('POST', '/api/admin/customers', o);
        toast(r.panel && !r.panel.skipped && r.panel.ok !== false ? 'Customer created + line added on panel ✓' : 'Customer created ✓');
        if (r.panel && r.panel.ok === false) panelNote = r.panel.error || 'unknown error';
        if (r.mail) toast(r.mail.ok ? `Login emailed to ${o.email} ✓` : 'Email failed: ' + (r.mail.error || ''), !r.mail.ok);
        if (r.duplicates?.length) toast(`⚠️ Same details as: ${r.duplicates.slice(0, 3).map((x) => `${x.name} (${x.username}, ${x.why.join('+')})`).join('; ')}`, true);
        const b = state.config.branding; o.username = r.customer.username || o.username; if (!o.password) o.password = r.customer.linePassword || '';
        const text = `${b.appName}\n🌐 ${location.origin}\n👤 Username: ${o.username}\n🔑 Password: ${o.password}\n📅 Expires: ${fmtDate(r.customer.expiresAt)}`;
        closeModal();
        modal('Customer created 🎉', `${panelNote ? `<div class="notice warning">⚠️ The customer is saved, but <b>the panel did not create the line</b>: ${esc(panelNote)}<br>Create the line on your panel, then tap Edit on this customer and paste its M3U link.</div>` : ''}<p class="muted">Send these login details to your customer:</p><div class="code" id="newlogin">${esc(text)}</div><div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn primary" data-act="copy-new">📋 Copy</button></div>${r.iboOffer ? `<div class="notice" style="margin-top:12px">📺 The IBO Player offer was emailed. Send it on WhatsApp too:<div class="row" style="margin-top:8px">${iboOfferBtn(r.customer.id)}</div></div>` : ''}`);
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
      if (r.iboOffer && !(r.panel && r.panel.ok === false)) modal('Renewed ✓', `<p>Renewed until <b>${esc(fmtDate(r.customer.expiresAt))}</b>.</p><div class="notice">📺 The IBO Player offer (${esc(String((state.admin.settings.iboPromo || {}).price || 5.99))}) was emailed. Send it on WhatsApp too:<div class="row" style="margin-top:8px">${iboOfferBtn(r.customer.id)}</div></div>`);
      if (r.panel && r.panel.ok === false) modal('Renewed in the app', `<div class="notice warning">⚠️ The subscription is renewed here, but <b>the panel did not renew the line</b>: ${esc(r.panel.error || 'unknown error')}<br>Renew the line on your panel too. Until then this customer is listed in Alerts → “Paid: renew on the panel”.</div><button class="btn block" data-act="close-modal">OK</button>`);
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
Object.assign(actions, {
  'panel-refresh': async () => {
    markRefreshBusy(document, true);
    try {
      if (state.admin.tab === 'overview') {
        state.admin.settings = await api('GET', '/api/admin/settings');
        await renderAdminBodyOnly();
      } else {
        await renderAdmin();
      }
      state.admin.refreshedAt = Date.now();
      updateRefreshMeta();
      toast('Data refreshed ✓');
    } catch (e) { toast(e.message, true); }
    finally { markRefreshBusy(document, false); }
  },
  'notice-save': async (el) => {
    const editor = el.closest('[data-notice-editor]') || $('[data-notice-editor]');
    const text = editor?.querySelector('[name=notice]')?.value ?? '';
    el.disabled = true;
    try { await saveSettings({ importantNotice: text }, true); toast('Notice saved ✓'); await renderAdmin(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'notice-clear': async (el) => {
    el.disabled = true;
    try { await saveSettings({ importantNotice: '' }, true); toast('Notice cleared ✓'); await renderAdmin(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'domain-save': (el) => {
    const form = el.closest('form'); if (!form) return;
    if (!form.reportValidity()) return;
    state.admin.domainDraft = Object.fromEntries(new FormData(form).entries());
    toast('Details saved in this browser session only. Provider and price still need confirmation.');
  },
  'domain-pay': () => toast('Payments are disabled until the domain provider and price are confirmed.', true),
  'promo-preview': (el) => {
    const promo = PROMOS[el.dataset.id];
    if (!promo) return toast('Unknown promotion.', true);
    const now = Date.now();
    const role = promo.id === 'fourForFive' ? 'reseller' : 'owner';
    const sample = { role, credits: 1, purchaseCount: 4, redeemedPromos: [], planExpiresAt: now, ledger: [] };
    const elig = promoEligibility({ role, credits: sample.credits, purchaseCount: sample.purchaseCount, promoId: promo.id, redeemed: [], now });
    const applied = applyPromoToReseller(sample, promo.id, now);
    modal(`Preview: ${promo.title}`, `<div class="notice ${elig.ok ? '' : 'warning'}"><b>${elig.ok ? 'Sample is eligible' : 'Sample is not eligible'}</b><div class="small">${esc(elig.reason || promo.terms)}</div></div>
      <p class="small muted">${esc(promo.start)} → ${esc(promo.end)} · ${esc(promo.status)}</p>
      <div class="card" style="margin:12px 0;padding:12px"><h4 style="margin-top:0">Result</h4><p class="small">${applied.ok ? 'Applied to the sample account only.' : esc(applied.reason || 'Not applied.')}</p>
      <pre class="promo-wa" style="white-space:pre-wrap;font:inherit;font-size:13px;max-height:220px;overflow:auto;background:rgba(127,127,127,.08);border-radius:10px;padding:10px;margin:0">${esc(JSON.stringify(applied.reseller, null, 2))}</pre></div>
      <p class="small muted">Preview only — nothing is saved or applied to a real reseller or manager.</p>`, { wide: true });
  },
  // ---- Promotions hub actions ----
  'pc-sub': async (el) => { PC.sub = el.dataset.sub; await pcRefresh(); },
  'pc-cat': async (el) => { PC.type = el.dataset.cat; PC.sub = 'ready'; await pcRefresh(); },
  'pc-sport-filter': async (el) => { PC.sport = el.dataset.sport; await pcRefresh(); },
  'pc-new': (el) => { const t = el.dataset.type || 'general'; modal(`＋ New ${esc(t)} promotion`, pcCampaignForm({ type: t }), { wide: true }); },
  'pc-copy': (el) => {
    const t = (PC.data?.templates || []).find((x) => x.id === el.dataset.id);
    if (!t) return toast('Template not found.', true);
    const d = { templateId: t.id, type: t.category, title: t.title, description: t.description, subject: t.subject, html: t.html, whatsapp: t.whatsapp, notifTitle: t.notifTitle, notifBody: t.notifBody, code: t.code, discountPct: t.discountPct, creditAmount: t.creditAmount, bonusPct: t.bonusPct, link: t.link, audience: t.audience, channels: t.channels, status: 'draft' };
    const ev = el.dataset.event && ((PC.data?.sports || {}).events || []).find((x) => x.id === el.dataset.event);
    if (ev) { d.title = `${ev.name} — ${t.title}`; d.description = [ev.competition, ev.teams, ev.tip].filter(Boolean).join(' · ').slice(0, 400); d.startAt = ev.date || ''; d.time = ev.time || ''; d.eventId = ev.id; }
    modal(`✍️ Customise: ${esc(t.name)}`, pcCampaignForm(d), { wide: true });
  },
  'pc-details': async (el) => {
    try { const x = await api('GET', '/api/admin/promos/' + encodeURIComponent(el.dataset.id)); modal('🔍 Promotion details', pcDetailsHtml(x), { wide: true }); }
    catch (e) { toast(e.message, true); }
  },
  'pc-preview': async (el) => {
    try { const x = await api('GET', '/api/admin/promos/' + encodeURIComponent(el.dataset.id)); pcOpenPreview(x.rendered || {}, (x.campaign || x.template || {}).title); }
    catch (e) { toast(e.message, true); }
  },
  'pc-preview-draft': async (el) => {
    const form = el.closest('form'); if (!form) return;
    try { const r = await api('POST', '/api/admin/promos/preview', { draft: pcFormDraft(form) }); pcOpenPreview(r, formToObj(form).title); }
    catch (e) { toast(e.message, true); }
  },
  'pc-pv-tab': (el) => {
    const root = el.closest('.modal-body') || document;
    root.querySelectorAll('.pc-pv-tab').forEach((b) => { b.classList.toggle('on', b === el); b.setAttribute('aria-selected', String(b === el)); });
    root.querySelectorAll('.pc-pv-panel').forEach((p) => { p.hidden = p.dataset.pv !== el.dataset.pv; });
  },
  'pc-edit': async (el) => {
    try { const x = await api('GET', '/api/admin/promos/' + encodeURIComponent(el.dataset.id)); modal(`✎ Edit: ${esc(x.campaign.title)}`, pcCampaignForm(x.campaign), { wide: true }); }
    catch (e) { toast(e.message, true); }
  },
  'pc-del': async (el) => {
    if (!confirm('Delete this promotion permanently?')) return;
    el.disabled = true;
    try { await api('DELETE', '/api/admin/promos/' + encodeURIComponent(el.dataset.id)); toast('Deleted ✓'); await pcRefresh(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'pc-status': async (el) => {
    el.disabled = true;
    try { await api('POST', '/api/admin/promos/' + encodeURIComponent(el.dataset.id) + '/status', { status: el.dataset.status }); toast('Status updated ✓'); await pcRefresh(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'pc-send': async (el) => {
    if (!confirm('Send this promotion to the selected audience now?')) return;
    el.disabled = true;
    try {
      const r = await api('POST', '/api/admin/promos/' + encodeURIComponent(el.dataset.id) + '/send', {});
      const st = r.stats || {};
      toast(`Sent: ${st.email || 0} emails, ${st.devices || 0} devices, ${st.telegram || 0} Telegram posts${(st.errors || []).length ? ' · ' + st.errors.join('; ') : ''}`);
      if ((r.campaign.channels || []).includes('whatsapp') && (st.waLinks || []).length) modal('💬 WhatsApp — ready to send', `<p class="small muted">Tap a contact to open the chat with the personalised message ready. Nothing is sent until you press send in WhatsApp.</p>${st.waLinks.map((l) => `<div class="list-item"><div style="flex:1;min-width:0"><b>${esc(l.name || 'Customer')}</b></div><a class="btn sm wa-btn" target="_blank" rel="noopener" href="${esc(l.url)}">💬 Open chat</a></div>`).join('')}`, { wide: true });
      await pcRefresh();
    } catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'sport-new': () => modal('＋ Add sports event', sportForm({})),
  'sport-promo': (el) => {
    const ev = ((PC.data?.sports || {}).events || []).find((x) => x.id === el.dataset.id);
    if (!ev) return toast('Event not found.', true);
    const cat = ev.category || (['basketball', 'nba'].includes(ev.type) ? 'basketball' : 'football');
    const tpls = (PC.data?.templates || []).filter((t) => t.category === cat);
    const re = ev.kind === 'tournament' ? /champions|playoff|tournament/i : ev.kind === 'seasonal' ? /final|season/i : /match|game|hoops/i;
    const pick = tpls.find((t) => re.test(t.id)) || tpls[0] || { id: cat === 'basketball' ? 'hoops-game-day' : 'match-day-football' };
    actions['pc-copy']({ dataset: { id: pick.id, event: ev.id } });
  },
  'ad-copy': (el, e) => {
    const tpl = adsTemplates().find((x) => x.id === el.dataset.id);
    if (!tpl) return toast('Ad example not found.', true);
    return actions['copy-text']({ dataset: { text: `${tpl.title}\n\n${tpl.body}\n\n${tpl.cta}` } }, e);
  },
});
async function renderAdminBodyOnly() { if (state.admin.tab === 'overview') $('#admin-body').innerHTML = await adminOverview(); }

const inFlight = new Set();
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  const key = el.dataset.act + '|' + (el.dataset.id || el.dataset.k || el.dataset.pkg || el.dataset.f || '');
  if (inFlight.has(key)) { e.preventDefault(); e.stopImmediatePropagation(); return; } // double-click guard (spec §6)
  inFlight.add(key);
  if (el.tagName === 'A' && !el.hasAttribute('data-keep')) e.preventDefault();
  Promise.resolve(fn(el, e)).catch((err) => toast(err.message, true)).finally(() => inFlight.delete(key));
});
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.ads-tab');
  if (!tab) return;
  const wrap = tab.closest('.ads-panel-wrap'); if (!wrap) return;
  const tabs = [...wrap.querySelectorAll('.ads-tab')];
  const panels = [...wrap.querySelectorAll('.ads-panel')];
  const idx = tabs.indexOf(tab); if (idx < 0) return;
  tabs.forEach((t, i) => { t.setAttribute('aria-selected', String(i === idx)); t.tabIndex = i === idx ? 0 : -1; });
  panels.forEach((p, i) => { p.hidden = i !== idx; });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.role === 'user' && state.user.me && Date.now() - (state.user.meAt || 0) > 60000) renderUser(); });
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f || f.dataset.busy === '1') { if (f) e.preventDefault(); return; } // duplicate-submit guard (spec §6)
  e.preventDefault();
  f.dataset.busy = '1';
  Promise.resolve(forms[f.dataset.form]?.(f, e)).catch((err) => toast(err.message, true)).finally(() => { delete f.dataset.busy; });
});
document.addEventListener('input', (e) => {
  const el = e.target; if (!el.dataset || el.dataset.m3ufill !== '1') return;
  const f = el.closest('form'); if (!f) return;
  const ln = parseLineLink(el.value.trim()); if (!ln) return;
  const put = (name, val) => { const x = f.querySelector(`[name="${name}"]`); if (!x || !val) return; if (x.value.trim() && x.dataset.auto !== '1') return; x.value = val; x.dataset.auto = '1'; };
  put('username', ln.u); put('password', ln.p); put('dns', ln.dns);
});
let searchT;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset?.input === 'nav-search') { const first = document.querySelector('#nav a:not([hidden])'); if (first) first.click(); }
  const adsTab = e.target.closest?.('.ads-tab');
  if (adsTab && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const wrap = adsTab.closest('.ads-panel-wrap'); if (!wrap) return;
    const tabs = [...wrap.querySelectorAll('.ads-tab')];
    const i = tabs.indexOf(adsTab); if (i < 0) return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus(); next.click();
  }
  const modalEl = $('#modal-root .modal');
  if (e.key === 'Escape' && modalEl) { e.preventDefault(); closeModal(); return; }
  if (e.key === 'Escape') { actions['menu-close']?.(); return; }
  if (e.key === 'Tab' && modalEl) {
    const q = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const els = [...modalEl.querySelectorAll(q)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (els.length) {
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && (document.activeElement === first || !modalEl.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !modalEl.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if ((t.id === 'mkt-html' || t.id === 'mkt-subject') && state.admin) {
    state.admin.mktComposer = { ...(state.admin.mktComposer || {}), [t.id === 'mkt-html' ? 'html' : 'subject']: t.value };
  }
  if (t.name === 'notice' && t.closest('[data-notice-editor]')) {
    const preview = t.closest('[data-notice-editor]').querySelector('[data-notice-preview]');
    if (preview) { preview.textContent = t.value || 'Nothing to preview yet.'; preview.classList.toggle('empty', !t.value); }
  }
  if (t.dataset.input === 'dup-search') { state.admin.dupQ = t.value; clearTimeout(searchT); searchT = setTimeout(async () => { const pos = t.selectionStart; $('#admin-body').innerHTML = await adminDups(); const n = $('[data-input=dup-search]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 300); }
  if (t.form?.dataset?.form === 'acc' && t.name === 'tier' && ACC.d) { const pl = ACC.d.plans[t.value]; if (pl && t.value !== 'custom') { t.form.price.value = pl.price; t.form.quota.value = pl.quota; } }
  if (t.dataset.input === 'acc-q') { ACC.q = t.value; const pos = t.selectionStart; $('#admin-body').innerHTML = accPage(); const n = $('[data-input=acc-q]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
  if (t.dataset.input === 'promo-wa-edit') { const a = $('#promo-wa-share'); if (a) a.href = 'https://wa.me/?text=' + encodeURIComponent(t.value); return; }
  if (t.dataset.input === 'promo-lang') { PROMO.lang = t.value; renderAdmin(); return; }
  if (t.dataset.input === 'pc-type') { PC.type = t.value; pcRefresh(); return; }
  if (t.dataset.input === 'pc-status-filter') { PC.status = t.value; pcRefresh(); return; }
  if (t.dataset.input === 'mail-plan') { if (!t.value) return; if (t.value === 'custom') return actions['mail-plan-custom'](t);
    api('POST', '/api/admin/email/plan', { id: t.dataset.id, tier: t.value }).then(() => { toast(t.value === 'free' ? 'Set to free trial ✓' : 'Upgraded to paid ✓'); renderAdmin(); }).catch((e) => toast(e.message, true)); return; }
  if (t.dataset.input === 'mail-on') { api('POST', '/api/admin/email/sending', { id: t.dataset.id, on: t.checked }).then(() => { toast(t.checked ? 'Sending switched on ✓' : 'Sending switched off'); renderAdmin(); }).catch((e) => toast(e.message, true)); return; }
  if (t.dataset.input === 'key-tier') { const row = t.closest('[data-key-row]'); row.querySelectorAll('[data-k=quota],[data-k=price]').forEach((x) => { x.hidden = t.value !== 'custom'; }); return; }
  if (t.dataset.input === 'rsl-q') { RSL.q = t.value; const pos = t.selectionStart; rslDraw(); const n = $('[data-input=rsl-q]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
  if (t.dataset.input === 'cust-sort') { state.admin.custSort = t.value; try { localStorage.setItem('tvp_cust_sort', t.value); } catch {} $('#cust-list').innerHTML = customerListHtml(); }
  if (t.dataset.input === 'cust-search') { state.admin.q = t.value; state.admin.custLimit = 60; clearTimeout(searchT); searchT = setTimeout(() => { $('#cust-list').innerHTML = customerListHtml(); }, 200); }
  if (t.dataset.input === 'nav-search') { // menu search: hides pages that do not match, by name, group or keywords
    const q = t.value.trim().toLowerCase(); let shown = 0;
    document.querySelectorAll('#nav a').forEach((a) => { const ok = !q || q.split(/\s+/).every((w) => a.dataset.k.includes(w)); a.hidden = !ok; if (ok) shown++; });
    document.querySelectorAll('#nav .nav-g').forEach((g) => { let n = g.nextElementSibling, any = false; while (n && n.tagName === 'A') { if (!n.hidden) any = true; n = n.nextElementSibling; } g.hidden = !any; });
    const none = document.querySelector('#nav .nav-none'); if (none) none.hidden = shown > 0;
    return;
  }
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
  if (t.hasAttribute?.('data-rs-who')) { const nb = $('#rs-newbox'); if (nb) nb.style.display = t.value ? 'none' : ''; }
  if (t.form?.dataset.form === 'rp-sale' && (t.name === 'packageId' || t.name === 'accountId')) {
    const st = state.admin.settings; const f = t.form;
    const p = st.resellerPackages.find((x) => x.id === f.packageId.value);
    const acc = st.finance.accounts.find((a) => a.id === f.accountId?.value);
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
      const restored = migrateLegacyTransactions(JSON.parse(await t.files[0].text()));
      if (!confirm(`Restore ${restored.data.customers?.length ?? 0} customers and all settings? Current data will be replaced.`)) return;
      await api('POST', '/api/admin/restore', restored.data); await refreshConfig(); toast(`Backup restored ✓ ${restored.report.migrated} transaction timestamp(s) filled in.`); renderAdmin();
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
// In a browser the link always opens the home page; Sign in is one tap from there. The installed apps open the sign-in directly.
const wantsSite = () => !bridge() && (state.forceSite || (!state.showLogin && !isStandalone()));
function renderSite() {
  const b = state.config.branding; setWaFab(b, t('waMsg', { app: b.appName, u: '' }));
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
  return [os, br].filter(Boolean).join(' · ') || t('w_device');
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
    let rcs = []; try { rcs = await api('GET', '/api/me/receipts'); } catch {}
    pm.innerHTML = `<h3>${t('paymentsT')}</h3>${rcs.length ? rcs.slice(0, 5).map((x) => `<div class="list-item"><div style="flex:1;min-width:0"><b>🧾 ${esc(pkgName(x.pkgTitle))}</b><div class="small muted">${fmtDate(x.at)}${x.reason ? ' · ' + esc(x.reason) : ''}</div></div><span class="pill st-${x.status === 'approved' ? 'active' : x.status === 'rejected' ? 'expired' : 'open'}">${t('rc_' + x.status)}</span></div>`).join('') : ''}${list.length ? list.map((x) => `<div class="list-item"><div style="flex:1;min-width:0"><b>${esc(pkgName(x.plan))}</b><div class="small muted">${fmtDate(x.at)}</div></div><b dir="ltr">${esc(priceTxt(x.amount, x.currency))}</b><button class="btn sm" data-act="receipt" data-id="${esc(x.id)}">${t('receipt')}</button></div>`).join('') + `<p style="margin:10px 0 0"><a href="#" class="small muted" data-act="refund-ask">${t('refundAsk')}</a></p>` : `<p class="muted small">${t('noPayments')}</p>`}`;
  });
}
function ticketThread(x, admin) {
  return `<div class="thread">${x.messages.map((m) => `<div class="msg ${m.from === (admin ? 'staff' : 'customer') ? 'mine' : ''}"><div class="small muted">${esc(m.from === 'staff' ? (admin ? m.by : t('supportTeam')) : (admin ? m.by : t('you')))} · ${fmtDT(m.at)}</div><div class="msg-t">${esc(m.text)}</div>${admin ? '<button type="button" class="tr-msg-btn" data-act="tr-msg" title="Translate this message" aria-label="Translate this message">🌐</button>' : ''}${admin && m.emailed ? '<div class="small muted">📧 emailed to the customer</div>' : ''}${m.att ? `<button type="button" class="btn sm" style="margin-top:8px" data-act="att-show" data-id="${esc(m.att)}" data-admin="${admin ? 1 : ''}">📎 ${admin ? 'Show picture' : t('attShow')}</button>${admin && m.from === 'customer' && m.aiPhotoConsent === true ? `<div class="small muted" style="margin-top:6px">Customer opted in to image-only AI troubleshooting.</div><button type="button" class="btn sm" style="margin-top:6px" data-act="ai-photo-analyze" data-ticket-id="${esc(x.id)}" data-att-id="${esc(m.att)}">🔎 Analyze photo with AI</button>` : ''}` : ''}</div>`).join('')}</div>`;
}
function openTicket(id) {
  const x = (state.user.tickets || []).find((k) => k.id === id); if (!x) return;
  modal(esc(x.subject), `<div style="margin-bottom:10px">${tpill(x.status)}</div>${ticketThread(x, false)}
    ${x.status === 'closed' ? '' : `<form data-form="ticket-reply" data-id="${esc(x.id)}">${field(t('reply'), 'text', '', { type: 'textarea', rows: 3, ph: t('writeReply'), attrs: 'required maxlength="2000"' })}<label class="field"><span>${t('attAdd')}</span><input type="file" name="image" accept="image/*"></label>${ticketPhotoConsent()}<button class="btn primary">${t('send')}</button></form>`}`);
}
function openReceipt(id) {
  const x = (state.user.payments || []).find((k) => k.id === id); if (!x) return; const me = state.user.me;
  modal('🧾 ' + t('receipt'), `<div class="receipt" id="receipt"><h2 style="margin:0">${esc(me.branding.appName)}</h2><p class="muted small" style="margin:2px 0 16px">${t('receipt')} · ${esc(String(x.id).toUpperCase())}</p>
    <div class="list-item"><span style="flex:1">${t('receiptFor')}</span><b>${esc(me.user.name)} (${esc(me.user.username)})</b></div>
    <div class="list-item"><span style="flex:1">${t('paidOn')}</span><b>${fmtDate(x.at)}</b></div>
    <div class="list-item"><span style="flex:1">${t('item')}</span><b>${esc(pkgName(x.plan))} · ${esc(t('daysN', { n: x.days }))}</b></div>
    <div class="list-item"><span style="flex:1">${t('amount')}</span><b dir="ltr">${esc(priceTxt(x.amount, x.currency))}</b></div></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" data-act="print">🖨 ${t('print')}</button></div>`);
}
function showReset() {
  modal('🔑 ' + t('resetTitle'), `<form data-form="reset">${field(t('newPw'), 'password', '', { type: 'password', attrs: 'required minlength="6" autocomplete="new-password"' })}<div id="reset-err" aria-live="polite"></div><button class="btn primary block">${t('updatePw')}</button></form>`);
}

// ---------------- admin: support desk ----------------
const PROMO_KINDS = [['holidays', '🎁 Christmas & New Year'], ['blackfriday', '🖤 Black Friday'], ['cybermonday', '💻 Cyber Monday'], ['events', '🏆 Sports, cinema & streaming'], ['evergreen', '⭐ All-year offer'], ['devices', '📱 Samsung, iPhone & Smart TV'], ['christmas', '🎄 Christmas'], ['newyear', '🎆 New Year']];
const PROMO_ENDS = () => { const y = new Date().getFullYear(), m = new Date().getMonth(); const pr = state.admin.settings?.promo || {}; return { blackfriday: pr.to || `${y}-12-01`, cybermonday: `${y}-12-02`, christmas: `${y}-12-26`, newyear: `${y + (m === 0 ? 0 : 1)}-01-07`, holidays: `${y + (m === 0 ? 0 : 1)}-01-07`, events: '', evergreen: '', devices: '' }; };
const TK_CATS = { login: 'Login / activation', channels: 'Channels', payment: 'Payment / renewal', device: 'Device setup', other: 'Other' };
async function adminSupport() {
  const list = await api('GET', '/api/admin/tickets'); state.admin.tickets = list;
  const f = state.admin.tkFilter || 'open';
  const shown = list.filter((x) => f === 'all' || x.status === f);
  const count = (st) => list.filter((x) => x.status === st).length;
  const S = state.admin.settings?.support || {};
  const setup = can('settings') ? `<details class="card" style="margin-bottom:12px"><summary><b>🎧 Support page settings</b> <span class="small muted">· ${esc(location.origin)}/support · open 24/7</span></summary>
    <form data-form="sup-set" style="margin-top:10px">
      <p class="small muted" style="margin-top:0">Customers must give their name, email and WhatsApp number before they can open a ticket. Each new ticket appears here at once and is emailed to the owner, every active team member who can see customers (their “work email”), and the extra emails below.</p>
      ${field('Support email shown to customers', 'email', S.email || 'contact@intproto-tv.com', { type: 'email', attrs: 'autocapitalize="none"' })}
      ${field('Extra alert emails (comma separated)', 'alertEmails', S.alertEmails || '', { ph: 'agent1@example.com, agent2@example.com', attrs: 'autocapitalize="none"' })}
      <label class="field" style="flex-direction:row;align-items:center;gap:10px"><input type="checkbox" name="waLink" ${S.waLink !== false ? 'checked' : ''} style="width:auto"><span>Add the support link at the end of every WhatsApp message</span></label>
      <div class="row" style="justify-content:flex-end;gap:8px"><a class="btn ghost" href="/support" target="_blank" rel="noopener">Open the page ↗</a><button class="btn primary">Save</button></div>
    </form></details>` : '';
  return `${setup}<div class="chips">${[['open', `Waiting for reply (${count('open')})`], ['answered', `Answered (${count('answered')})`], ['closed', `Closed (${count('closed')})`], ['all', `All (${list.length})`]].map(([k, n]) => `<a class="${f === k ? 'on' : ''}" data-act="tk-filter" data-f="${k}">${n}</a>`).join('')}</div>
    <div class="card">${shown.length ? shown.map((x) => `<div class="list-item" data-act="tk-open" data-id="${esc(x.id)}" style="cursor:pointer" tabindex="0"><div class="avatar">${esc(initials(x.name))}</div><div style="flex:1;min-width:0"><b>${esc(x.subject)}</b>${x.priority === 'high' ? ' <span class="pill st-expired">high</span>' : ''}${x.source === 'support page' ? ` <span class="pill">🎧 ${esc(x.ref || 'support page')}</span>` : ''}${x.category ? ` <span class="pill">${esc(TK_CATS[x.category] || x.category)}</span>` : ''}<div class="small muted">${esc(x.name)} · ${esc(x.guest ? (x.contact?.email || x.username) : x.username)}${x.guest ? ' · new contact' : ''} · ${fmtDT(x.updatedAt)} · ${x.messages.length} message${x.messages.length > 1 ? 's' : ''}</div></div>${tpill(x.status)}</div>`).join('') : `<div class="empty"><span class="ic">💬</span>${list.length ? 'Nothing in this list.' : 'No support requests yet. Customers open them at /support or from Account → Support in the app.'}</div>`}</div>`;
}
function adminTicketModal(id) {
  const x = (state.admin.tickets || []).find((k) => k.id === id); if (!x) return;
  const C = x.contact || null; const ph = C ? String(C.phone || '').replace(/\D/g, '') : '';
  const contactCard = C ? `<div class="card" style="padding:10px 12px;margin:0 0 10px"><div class="small"><b>🎧 ${esc(x.ref || '')}</b> · from the support page${x.category ? ' · ' + esc(TK_CATS[x.category] || x.category) : ''}${x.guest ? ' · <span class="pill st-expiring">not matched to a customer</span>' : ' · <span class="pill st-active">customer found</span>'}</div>
    <div class="small muted" style="margin-top:4px">${esc(C.name || '')} · <a href="mailto:${esc(C.email || '')}">${esc(C.email || '')}</a>${ph ? ` · <a href="https://wa.me/${ph}" target="_blank" rel="noopener">WhatsApp +${ph}</a>` : ''}${C.username ? ' · user ' + esc(C.username) : ''}${C.orderNo ? ' · order ' + esc(C.orderNo) : ''}${C.device ? ' · ' + esc(C.device) : ''}${C.lang ? ' · ' + esc(String(C.lang).toUpperCase()) : ''}</div>
    ${x.guest ? '<div class="small muted" style="margin-top:4px">Your answer is emailed to this person.</div>' : ''}</div>` : '';
  modal(esc(x.subject), `<p class="small muted" style="margin-top:0">${esc(x.name)} · ${esc(x.username)} · opened ${fmtDT(x.createdAt)} ${tpill(x.status)}</p>${contactCard}${ticketThread(x, true)}
    <form data-form="tk-reply" data-id="${esc(x.id)}" data-perm="customers_edit">${field('Your answer', 'text', '', { type: 'textarea', rows: 4, ph: 'Write the answer the customer will read in the app…', attrs: 'maxlength="2000"' })}<label class="field"><span>${'Attach a picture (optional)'}</span><input type="file" name="image" accept="image/*"></label>
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
  const riskTone = { low: 'st-active', medium: 'st-expiring', high: 'st-expired' };
  const riskLabel = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };
  const payoutDays = normalizePayoutDays(s.finance?.payoutSchedule ?? s.payoutSchedule ?? 2);
  const payoutAccount = (s.finance?.accounts || [])[0] || { name: '' };
  return `<div class="card"><h3>Automatic activation from Stripe</h3>
    <p class="small muted" style="margin-top:0">When a customer pays through one of your Stripe payment links, Stripe tells this app and the subscription is extended by itself. A payment is only accepted when Stripe's signature matches your signing secret, and it is never applied twice.</p>
    <div class="notice ${p.configured ? 'success' : 'warning'}">${p.configured ? '✅ Connected. Verified payments activate automatically.' : '⚠️ Not connected yet. Follow the three steps below for each Stripe account.'}</div>
    <p class="small muted">${esc(bankPayoutNote({ ...payoutAccount, payoutDays }))} Automatic bank transfers are off and remain display-only until the provider is confirmed.</p>
    <ol class="small" style="padding-inline-start:18px;line-height:1.7"><li>In Stripe: <b>Developers → Webhooks → Add endpoint</b>, with this address:<div class="code" style="margin:6px 0">${esc(url)}</div></li><li>Choose the event <b>checkout.session.completed</b>.</li><li>Copy the endpoint's <b>Signing secret</b> (starts with <code>whsec_</code>) and paste it here, one per line if you use several Stripe accounts.</li></ol>
    <form data-form="settings">${field('Signing secrets', 'finance.stripeWebhookSecrets', s.finance.stripeWebhookSecrets || '', { type: 'textarea', rows: 3, ph: 'whsec_…', attrs: 'autocapitalize="none" spellcheck="false"' })}<button class="btn primary">Save</button></form>
    <h3 style="margin-top:18px">Payments received from Stripe</h3>
    ${p.list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Fraud risk</th><th>Result</th></tr></thead><tbody>${p.list.map((x) => `<tr><td class="small">${fmtDT(x.at)}</td><td>${esc(x.username || x.email || '—')}<div class="small muted">${esc(x.pkg || '')}</div></td><td>${esc(x.amount)} ${esc(x.currency)}</td><td>${x.risk ? `<span class="pill ${riskTone[x.risk] || ''}" title="${esc(x.riskReason || '')}">${riskLabel[x.risk] || ''}</span>` : ''}</td><td><span class="pill ${tone[x.status] || ''}">${esc(String(x.status).replace('_', ' '))}</span><div class="small muted">${esc(x.note || '')}</div></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted small">No Stripe payments recorded yet.</p>`}</div>`;
}

Object.assign(actions, {
  'terms-agree': async () => { try { await api('POST', '/api/me/agree', {}); if (state.user.me) state.user.me.agreed = true; toast('Thank you ✓'); renderUser(); } catch (e) { toast(e.message, true); } },
  'site-login': () => { state.showLogin = true; state.forceSite = false; route(); window.scrollTo(0, 0); },
  'site-page': (el) => { state.forceSite = true; state.sitePage = el.dataset.page; route(); window.scrollTo(0, 0); },
  'site-jump': (el) => { document.getElementById(el.dataset.to)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); const d = document.querySelector('.s-menu[open]'); if (d) d.removeAttribute('open'); const l = document.querySelector('.s-menu[open] nav a'); if (l) l.blur(); },
  forgot: () => { modal('🔑 ' + t('forgot'), `<p class="muted" style="margin-top:0">${t('forgotText')}</p><form data-form="forgot">${field(t('loginOrEmail'), 'login', '', { attrs: 'required autocapitalize="none" dir="ltr"' })}<button class="btn primary block">${t('sendLink')}</button></form>`); },
  'hist-clear': () => { localStorage.removeItem(histKey()); toast(t('histCleared')); renderUserTab(); },
  'pin-unlock': () => { const b = modal('🔒 ' + t('parentalT'), `<form data-form="pin-unlock">${field(t('enterPin'), 'pin', '', { type: 'password', attrs: 'required inputmode="numeric" maxlength="4" autocomplete="off" dir="ltr"' })}<button class="btn primary block">${t('unlock')}</button></form>`); b.querySelector('input').focus(); },
  'dev-remove': async (el) => { if (!confirm(t('signOutDev') + '?')) return; await api('POST', '/api/me/devices/remove', { did: el.dataset.did }); toast(t('devOut')); loadAccountExtras(); },
  'ticket-new': () => { modal('💬 ' + t('newTicket'), `<form data-form="ticket-new">${field(t('subject'), 'subject', '', { attrs: 'required minlength="3" maxlength="120"' })}${field(t('message'), 'text', '', { type: 'textarea', rows: 5, attrs: 'required minlength="5" maxlength="2000"' })}<label class="field"><span>${t('attAdd')}</span><input type="file" name="image" accept="image/*"></label>${ticketPhotoConsent()}<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary">${t('send')}</button></div></form>`); },
  'ticket-open': (el) => openTicket(el.dataset.id),
  receipt: (el) => openReceipt(el.dataset.id),
  print: () => window.print(),
  'tk-filter': async (el) => { state.admin.tkFilter = el.dataset.f; $('#admin-body').innerHTML = await adminSupport(); },
  'tk-open': (el) => adminTicketModal(el.dataset.id),
  'ai-photo-analyze': async (el) => {
    const ticketModal = el.closest('.modal');
    el.disabled = true; toast('Analyzing the consented image…');
    try {
      const r = await api('POST', '/api/admin/ai/analyze-photo', { ticketId: el.dataset.ticketId, att: el.dataset.attId });
      const body = ticketModal && $('#modal-root').contains(ticketModal) ? ticketModal.querySelector('.modal-body') : null;
      if (body) {
        let suggestion = body.querySelector('[data-ai-photo-suggestion]');
        if (!suggestion) { suggestion = document.createElement('div'); suggestion.dataset.aiPhotoSuggestion = ''; body.append(suggestion); }
        suggestion.innerHTML = `<div class="notice warning small">Suggestion only — review it, verify the visible details, and write the customer reply yourself. The result was not saved or sent.</div><div style="white-space:pre-wrap;line-height:1.6">${esc(r.answer || '')}</div><p class="small muted" style="margin-bottom:0">Model: ${esc(r.model || 'configured provider')}</p>`;
      }
      if (el.isConnected) el.disabled = false;
    } catch (e) { toast(e.message, true); if (el.isConnected) el.disabled = false; }
  },
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
  async 'sup-set'(f) { await saveSettings({ support: { email: f.email.value.trim(), alertEmails: f.alertEmails.value, waLink: f.waLink.checked } }); $('#admin-body').innerHTML = await adminSupport(); },
  async 'notify-set'(f) { const g = (k) => !!f.elements[k]?.checked; const watch = [...f.querySelectorAll('[name=watch]')]; const all = watch.every((x) => x.checked);
    await saveSettings({ notify: { tickets: g('tickets'), trials: g('trials'), receipts: g('receipts'), shiftReminders: g('shiftReminders'), shifts: g('shifts'), oversight: g('oversight'), plan: g('plan'), customers: g('customers'), resellers: g('resellers'), autoPromo: g('autoPromo'), promoDays: Number(f.promoDays.value) || 7, watch: all ? [] : watch.filter((x) => x.checked).map((x) => x.value) } }); renderAdmin(); },
  async 'push-promo'(f) { const b = f.querySelector('button.primary'); b.disabled = true; try { const r = await api('POST', '/api/admin/push/promo', { audience: f.audience.value, title: f.title.value, body: f.body.value }); toast(`Sent to ${r.people} people (${r.devices} device${r.devices === 1 ? '' : 's'})`); } catch (e) { toast(e.message, true); } b.disabled = false; },
  async 'sup-start'(f) {
    const b = f.querySelector('button.primary'); const box = f.querySelector('#sup-err');
    const F = { name: f.name.value.trim(), email: f.email.value.trim(), phone: fullPhone(f, 'phone'), username: f.username.value.trim(), orderNo: f.orderNo.value.trim(), device: f.device.value.trim() };
    if (F.name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(F.email) || !F.phone) { box.innerHTML = `<div class="err-box">${esc(t('sup_info'))}</div>`; return; }
    b.disabled = true;
    try { const r = await api('POST', '/api/support/start', { ...F, lang: getLang() }); SUP.form = F; SUP.token = r.token; SUP.known = !!r.known; SUP.step = 2; supDraw(); }
    catch (e) { box.innerHTML = `<div class="err-box">${esc(tErr(e.message))}</div>`; b.disabled = false; }
  },
  async 'sup-ticket'(f) {
    const b = f.querySelector('button.primary'); const box = f.querySelector('#sup-err'); b.disabled = true;
    try {
      const r = await api('POST', '/api/support/ticket', { token: SUP.token, category: f.category.value, subject: f.subject.value, text: f.text.value, image: await pickedImage(f), aiPhotoConsent: !!f.aiPhotoConsent?.checked });
      SUP.ref = r.ref; SUP.step = 3; supDraw();
    } catch (e) {
      if (e.message === 'sup_again') { SUP.token = ''; SUP.step = 1; supDraw(); const x = $('#sup-err'); if (x) x.innerHTML = `<div class="err-box">${esc(t('sup_again'))}</div>`; return; }
      box.innerHTML = `<div class="err-box">${esc(tErr(e.message))}</div>`; b.disabled = false;
    }
  },
  async 'ticket-new'(f) {
    try { await api('POST', '/api/me/tickets', { subject: f.subject.value, text: f.text.value, image: await pickedImage(f), aiPhotoConsent: !!f.aiPhotoConsent?.checked }); closeModal(); toast(t('ticketSent')); loadAccountExtras(); }
    catch (e) { toast(tErr(e.message), true); }
  },
  async 'ticket-reply'(f) {
    try { await api('POST', '/api/me/tickets/reply', { id: f.dataset.id, text: f.text.value, image: await pickedImage(f), aiPhotoConsent: !!f.aiPhotoConsent?.checked }); closeModal(); toast(t('ticketSent')); loadAccountExtras(); }
    catch (e) { toast(tErr(e.message), true); }
  },
  async 'tk-reply'(f) {
    try { await api('POST', '/api/admin/tickets/reply', { id: f.dataset.id, text: f.text.value, status: f.status.value, priority: f.priority.value, image: await pickedImage(f) }); closeModal(); toast('Saved ✓'); $('#admin-body').innerHTML = await adminSupport(); }
    catch (e) { toast(e.message, true); }
  },
  async 'bylaws-sign'(f) {
    try { await api('POST', '/api/admin/bylaws/sign', { name: f.name.value }); const me = state.admin.me; state.admin.me.mustSignBylaws = false; toast('Bylaws signed ✓'); renderAdmin(); }
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
  // The Worker itself proxies http IPTV panels server-side (the browser can't: mixed content / no CORS).
  if (base?.proxyToken) {
    try { const r = await fetch(`/proxy?u=${encodeURIComponent(url)}&t=${encodeURIComponent(base.proxyToken)}`); if (r && r.ok) return r.text(); } catch {}
  }
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
  const me = state.user.me;
  const list = getSources(); const act = activeSrc(); const app = me.branding.appName;
  const row = (id, name, tag, canDel) => `<div class="list-item"><div style="flex:1;min-width:0"><b>${esc(name)}</b>${tag ? ` <span class="tagp">${tag}</span>` : ''}</div>${act === id ? `<span class="pill st-active">${t('srcActive')}</span>` : `<button class="btn sm" data-act="src-use" data-id="${esc(id)}">${t('srcUse')}</button>`}${canDel ? `<button class="btn sm ghost" data-act="src-del" data-id="${esc(id)}" aria-label="${t('srcRemove')}">✕</button>` : ''}</div>`;
  const st = me.stream;
  const ibo = st && st.ibo ? st.ibo : null;
  const src = list.find((x) => x.id === act);
  const m3uOnly = src?.type === 'm3u';
  const dns = m3uOnly ? '' : String(st?.dns || st?.server || '').replace(/\/+$/, '');
  const u = m3uOnly ? '—' : (st?.u || '—');
  const p = m3uOnly ? '—' : (st?.p || '—');
  const m3uUrl = m3uOnly ? (src.url || '—') : (String(st?.m3u || '').trim() || (dns && st?.u && st?.p ? dns + '/get.php?username=' + encodeURIComponent(st.u) + '&password=' + encodeURIComponent(st.p || '') + '&type=m3u_plus&output=ts' : '—'));
  const credLine = (label, value, key) => `<li><span class="cred-k">${label}</span><b class="cred-v" id="cred-${key}" dir="ltr">${esc(value)}</b><button class="btn sm ghost svc-c" data-act="copy-el" data-el="cred-${key}" aria-label="Copy ${label}" title="Copy">⧉</button></li>`;
  const allCreds = `Username: ${u}\nPassword: ${p}\nDNS: ${dns || '—'}\nM3U: ${m3uUrl}${ibo?.mac ? `\nDevice MAC Address: ${ibo.mac}` : ''}${ibo?.key ? `\nDevice Key: ${ibo.key}` : ''}`;
  const svc = st ? `<div class="svc-box creds">
      ${m3uOnly ? `<p class="small muted" style="margin:0 0 4px">${t('credOwnM3u')}</p>` : ''}
      <ul class="cred-list">
        ${credLine(t('pf_user'), u, 'u')}
        ${credLine(t('pf_pass'), p, 'p')}
        ${credLine('DNS', dns || '—', 'dns')}
        ${credLine('M3U', m3uUrl, 'm3u')}
        ${ibo?.mac ? credLine(t('pf_mac'), ibo.mac, 'mac') : ''}
        ${ibo?.key ? credLine(t('pf_key'), ibo.key, 'key') : ''}
      </ul>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="copy-el" data-el="cred-all">${t('copyAll')}</button></div><div id="cred-all" style="display:none">${esc(allCreds)}</div>
      <details class="setup-steps" open><summary>📲 ${t('setupTitle')}</summary>
        <h4>${t('setupXtream')}</h4><ol class="guide-ol"><li>${t('setupX1')}</li><li>${t('setupX2')}</li><li>${t('setupX3')}</li><li>${t('setupX4')}</li></ol>
        <h4>${t('setupM3u')}</h4><ol class="guide-ol"><li>${t('setupM1')}</li><li>${t('setupM2')}</li><li>${t('setupM3')}</li></ol>
        <p class="small muted" style="margin:10px 0 0">${t('setupHint')}</p>
      </details></div>` : '';
  const canOwn = me.dashboard.ownPlaylists !== false;
  return `<div class="card" id="acc-sources"><h3>${t('srcT')}</h3><p class="muted small" style="margin-top:0">${t('srcText')}</p>
    ${row('', t('srcMain', { app }), '', false)}${list.map((x) => row(x.id, x.name, x.type === 'xtream' ? 'Xtream' : 'M3U', true)).join('')}${svc}
    ${canOwn ? `<div class="row" style="margin-top:12px"><button class="btn" data-act="src-add" data-type="xtream">＋ Xtream Codes</button><button class="btn" data-act="src-add" data-type="m3u">＋ M3U</button></div>` : ''}</div>`;
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
  ? `<form data-form="src-xtream">${field(t('srcName'), 'name', '', { attrs: 'required maxlength="40"' })}${field(t('srcServer'), 'server', '', { ph: 'http://example.com:8080', attrs: 'required inputmode="url" autocapitalize="none" dir="ltr"' })}${field(t('username'), 'u', '', { attrs: 'required autocapitalize="none" autocomplete="off" dir="ltr"' })}${field(t('password'), 'p', '', { type: 'password', attrs: 'required autocomplete="off" dir="ltr"' })}<div id="src-err" aria-live="polite"></div><p class="small muted">${t('srcOnlyYours')}</p><button class="btn primary block">${t('srcCheckAdd')}</button></form>`
  : `<form data-form="src-m3u">${field(t('srcName'), 'name', '', { attrs: 'required maxlength="40"' })}${field(t('srcUrl'), 'url', '', { ph: 'https://example.com/playlist.m3u', attrs: 'inputmode="url" autocapitalize="none" dir="ltr"' })}<label class="field"><span>${t('srcFile')}</span><input type="file" name="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl"></label><div id="src-err" aria-live="polite"></div><p class="small muted">${t('srcOnlyYours')}</p><button class="btn primary block">${t('srcCheckAdd')}</button></form>`;
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

// ---------------- pictures in support requests ----------------
// Shrinks the chosen photo on the device (longest side 1280px, JPEG) so it is small to send and store.
async function pickedImage(f) {
  const file = f.image && f.image.files[0]; if (!file) return '';
  if (!/^image\//.test(file.type)) throw new Error('att_bad');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('att_bad')); i.src = url; });
    for (const [side, q] of [[1280, 0.72], [1000, 0.6], [800, 0.5]]) {
      const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', q);
      if (data.length <= 560000) return data;
    }
    throw new Error('att_bad');
  } finally { URL.revokeObjectURL(url); }
}
Object.assign(actions, {
  'att-show': async (el) => {
    el.disabled = true;
    try { const r = await api('GET', el.dataset.src || `${el.dataset.admin ? '/api/admin' : '/api/me'}/tickets/att?id=${encodeURIComponent(el.dataset.id)}`); const img = new Image(); img.src = r.data; img.alt = ''; img.style.cssText = 'display:block;max-width:100%;border-radius:10px;margin-top:8px'; el.replaceWith(img); }
    catch (e) { el.disabled = false; toast(tErr(e.message), true); }
  },
});

// ---------------- TV guide grid: channels down the side, the next hours across ----------------
const G_MIN = 5;            // pixels per minute
const G_SPAN = 180;         // minutes shown
const guideStart = () => { const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); return d.getTime(); };
function guideHtml(chs) {
  const start = guideStart(); const now = Date.now();
  const ticks = Array.from({ length: G_SPAN / 30 }, (_, i) => `<span style="width:${30 * G_MIN}px">${new Date(start + i * 1800000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`).join('');
  return `<div class="guide" dir="ltr" data-start="${start}"><div class="g-row g-head"><div class="g-ch"></div><div class="g-line" style="width:${G_SPAN * G_MIN}px">${ticks}</div></div>
    ${chs.map((c) => `<div class="g-row"><div class="g-ch" data-act="open-item" data-item="${esc(JSON.stringify(c))}" tabindex="0"><b>${esc(c.name)}</b></div><div class="g-line" id="g-${esc(c.id)}" style="width:${G_SPAN * G_MIN}px"><span class="g-wait">…</span></div></div>`).join('')}
    <i class="g-now" style="left:calc(var(--g-ch) + ${Math.round(((now - start) / 60000) * G_MIN)}px)"></i></div>`;
}
async function fillGuide(chs) {
  const start = guideStart(); const end = start + G_SPAN * 60000; const token = (state.user.guideRun = Math.random());
  const queue = chs.slice();
  const work = async () => {
    for (let c; (c = queue.shift());) {
      if (state.user.guideRun !== token) return;
      let list = []; try { list = (await xt('get_short_epg', { stream_id: c.id, limit: 6 }))?.epg_listings || []; } catch {}
      const row = document.getElementById('g-' + c.id); if (!row || state.user.guideRun !== token) continue;
      const blocks = list.map((e) => ({ a: Number(e.start_timestamp) * 1000, b: Number(e.stop_timestamp) * 1000, title: b64(e.title) })).filter((e) => e.b > start && e.a < end && e.b > e.a);
      row.innerHTML = blocks.length ? blocks.map((e) => { const a = Math.max(e.a, start), b = Math.min(e.b, end); const live = e.a <= Date.now() && e.b > Date.now();
        return `<div class="g-prog ${live ? 'on' : ''}" data-act="open-item" data-item="${esc(JSON.stringify(c))}" tabindex="0" style="left:${Math.round(((a - start) / 60000) * G_MIN)}px;width:${Math.max(24, Math.round(((b - a) / 60000) * G_MIN) - 4)}px" title="${esc(e.title)}"><b>${esc(e.title)}</b><span>${new Date(e.a).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`; }).join('') : `<span class="g-wait">${t('noGuide')}</span>`;
    }
  };
  await Promise.all([work(), work(), work(), work()]);
}
Object.assign(actions, { 'guide-mode': (el) => { state.user.guide = !!el.dataset.on; renderUserTab(); } });

// ---------------- admin: bounced email addresses ----------------
async function adminBounces() {
  let d = { list: [], at: 0 }; try { d = await api('GET', '/api/admin/email/bounces'); } catch { return ''; }
  return `<div class="card" id="bounces"><div class="row"><h3 style="margin:0;flex:1">Bounced addresses</h3><button class="btn sm primary" data-act="bounce-sync" data-perm="customers_edit">Check Resend now</button></div>
    <p class="small muted">When an email bounces or is marked as spam, the address is paused here and no more emails are sent to it, which protects your sender reputation. Checked automatically once a day${d.at ? ' · last check ' + fmtDT(d.at) : ''}. Correct the customer's email, or tap “Allow again” if the address is fine.</p>
    ${d.list.length ? d.list.map((x) => `<div class="list-item"><div style="flex:1;min-width:0"><b dir="ltr" style="overflow-wrap:anywhere">${esc(x.email)}</b><div class="small muted">${esc(x.why)} · ${fmtDate(x.at)}${x.customers.length ? ' · ' + x.customers.map((c) => esc(c.name || c.username)).join(', ') : ''}</div></div>${x.customers[0] ? `<button class="btn sm" data-act="edit-customer" data-perm="customers_edit" data-id="${esc(x.customers[0].id)}">Edit</button>` : ''}<button class="btn sm" data-act="bounce-clear" data-perm="customers_edit" data-email="${esc(x.email)}">Allow again</button></div>`).join('') : '<p class="muted small">No paused addresses.</p>'}</div>`;
}
Object.assign(actions, {
  'bounce-sync': async (el) => { el.disabled = true; try { const r = await api('POST', '/api/admin/email/bounces/sync', {}); toast(`Checked ${r.checked} emails · ${r.added} new bounced address${r.added === 1 ? '' : 'es'}`); state.admin.customers = null; renderAdmin(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'bounce-clear': async (el) => { await api('POST', '/api/admin/email/bounces/clear', { email: el.dataset.email }); toast('Allowed again ✓'); renderAdmin(); },
  'trial-fix': (el) => { const f = $('form[data-form=trial]'); if (f) { f.email.value = el.dataset.email; $('#trial-err').innerHTML = ''; } },
});

// =====================================================================
// Admin: Alerts, Emails & bounces
// =====================================================================
const READY_TABS = () => true;
const csvCell = (v) => { v = String(v ?? ''); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCsv = (head, rows) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
const custCsv = (list) => toCsv(['Name', 'Username', 'Email', 'Phone', 'WhatsApp', 'Plan', 'Status', 'Expires', 'Days left'], list.map((c) => [c.name, c.username, c.email || '', c.phone || '', c.whatsapp || '', c.planName, c.state, isoDay(c.expiresAt), c.daysLeft]));

// ---------------- alerts: who needs attention, in groups the owner can tune ----------------
const ALERT_DEFS = [
  ['playErr', '⚠️', 'TV server refused the app', (c) => !!c.playErr && Date.now() - c.playErr.at < 3 * 86400000, () => 'In the last 3 days the TV server refused a request from these customers. The small text under each name shows the code it answered.'],
  ['lineBad', '📡', 'Line not working on the panel', (c) => !!c.lineBad, () => 'The panel says these lines do not exist or are not active, so these customers cannot watch. Create or fix the line on the panel, then tap Edit and paste its M3U link.'],
  ['renewPending', '🔁', 'Paid: renew on the panel', (c) => !!c.renewPending, () => 'You approved a payment, and the line still has to be renewed on the panel. This clears by itself after the next sync once the panel shows the new end date.'],
  ['pendingLine', '🆘', 'Waiting for a line', (c) => !!c.pendingLine, () => 'These customers asked for a trial and the panel did not create it. Tap Edit, paste the M3U link from your panel and save.'],
  ['trialEnding', '⏳', 'Trials ending soon', (c, a) => c.isTrial && c.state !== 'expired' && c.status !== 'disabled' && c.hoursLeft <= a.trialHours, (a) => `Free trials with ${a.trialHours} hours or less left. A good moment to send the payment link.`],
  ['expiring', '📅', 'Subscriptions ending soon', (c, a) => !c.isTrial && c.state !== 'expired' && c.status !== 'disabled' && c.daysLeft <= a.expiringDays, (a) => `Paid subscriptions ending within ${a.expiringDays} days.`],
  ['expired', '⛔', 'Expired, not renewed', (c, a) => !c.isTrial && c.state === 'expired' && c.daysLeft >= -a.expiredDays, (a) => `Subscriptions that ended in the last ${a.expiredDays} days.`],
  ['trialEnded', '🎁', 'Trials that ended', (c, a) => c.isTrial && c.state === 'expired' && c.daysLeft >= -a.expiredDays, (a) => `Free trials that ended in the last ${a.expiredDays} days without buying.`],
  ['notMessaged', '💬', 'Not contacted on WhatsApp yet', (c, a) => !c.waSentAt && (c.whatsapp || c.phone) && c.status !== 'disabled' && (c.state === 'expired' ? c.daysLeft >= -a.expiredDays : c.isTrial || c.daysLeft <= a.expiringDays), () => 'Ending or ended, has a number, and no WhatsApp message was sent from the app.'],
  ['bounced', '✉️', 'Email bounced', (c) => !!c.emailBad, () => 'Emails to these customers are paused. Correct the address.'],
  ['noEmail', '📭', 'No email address', (c) => !c.email, () => 'These customers cannot receive login, reminder or offer emails.'],
  ['noContact', '🚫', 'No way to contact', (c) => !c.email && !c.phone && !c.whatsapp, () => 'No email and no phone number on file.'],
  ['neverIn', '👻', 'Never signed in', (c) => !c.lastLogin && c.state !== 'expired' && c.status !== 'disabled', () => 'Active accounts that have not opened the app yet. They may need help installing.'],
  ['disabled', '🔒', 'Disabled accounts', (c) => c.status === 'disabled', () => 'Accounts you switched off.'],
];
async function adminAlerts(s) {
  state.admin.customers = await api('GET', '/api/admin/customers');
  const a = { expiringDays: 7, expiredDays: 30, trialHours: 12, hide: {}, ...(s.alerts || {}) }; const ui = (state.admin.al ||= { f: '', q: '', open: {} });
  const q = ui.q.trim().toLowerCase();
  const match = (c) => !q || [c.name, c.username, c.email, c.phone, c.whatsapp].some((x) => String(x || '').toLowerCase().includes(q));
  const groups = ALERT_DEFS.filter(([k]) => !a.hide[k]).map(([k, icn, name, test, why]) => ({ k, icn, name, why: why(a), list: state.admin.customers.filter((c) => test(c, a) && match(c)).sort((x, y) => x.expiresAt - y.expiresAt) }));
  state.admin.alGroups = groups;
  const total = new Set(groups.flatMap((g) => g.list.map((c) => c.id))).size;
  const shown = groups.filter((g) => (!ui.f || g.k === ui.f) && (ui.f || g.list.length));
  return `<div class="row" style="margin-bottom:12px"><input style="flex:1;min-width:180px" type="search" placeholder="🔎 Search these alerts…" value="${esc(ui.q)}" data-input="al-search"><button class="btn" data-act="sync-panel" data-perm="customers_edit">🔄 Sync with panel</button>${can('settings') ? `<button class="btn" data-act="al-custom">⚙️ Customize</button>` : ''}</div>
    <div class="chips"><a class="${ui.f ? '' : 'on'}" data-act="al-f" data-f="">All · ${total}</a>${groups.map((g) => `<a class="${ui.f === g.k ? 'on' : ''}" data-act="al-f" data-f="${g.k}">${g.icn} ${g.name} · ${g.list.length}</a>`).join('')}</div>
    ${shown.length ? shown.map((g) => { const all = ui.open[g.k] || ui.f === g.k; const rows = all ? g.list : g.list.slice(0, 5);
      return `<div class="card"><div class="row"><h3 style="margin:0;flex:1">${g.icn} ${g.name} <span class="pill ${g.list.length ? 'st-expiring' : 'st-active'}">${g.list.length}</span></h3>${g.list.length ? `<button class="btn sm" data-act="al-csv" data-perm="exports" data-k="${g.k}">⬇ CSV</button>` : ''}</div><p class="small muted" style="margin:4px 0 10px">${esc(g.why)}</p>
        ${rows.map((c) => `<div class="list-item al-row"><div class="avatar">${esc(initials(c.name))}</div><div style="flex:1;min-width:150px"><b>${esc(c.name)}</b> ${pill(c.state)}<div class="small muted">${esc(c.username)} · ${c.state === 'expired' ? 'ended ' + (c.noExpiry ? '♾ No end date' : fmtDate(c.expiresAt)) : leftTxt(c)}${c.email ? ' · ' + esc(c.email) : ''}${c.playErr && Date.now() - c.playErr.at < 3 * 86400000 ? `<br>⚠️ ${fmtDT(c.playErr.at)} · ${esc(c.playErr.action)} · code ${esc(c.playErr.status || '—')} · via ${esc(c.playErr.route)}` : ''}</div></div><div class="row al-acts">${custActions(c)}</div></div>`).join('') || '<p class="muted small">Nobody here right now. ✓</p>'}
        ${g.list.length > 5 && !all ? `<div style="text-align:center;margin-top:10px"><button class="btn sm" data-act="al-more" data-k="${g.k}">Show all ${g.list.length}</button></div>` : ''}</div>`; }).join('') : `<div class="empty"><span class="ic">✅</span>${q ? 'No alert matches your search.' : 'Nothing needs your attention right now.'}</div>`}`;
}

// ---------------- emails & bounces ----------------
async function adminEmails() {
  const ui = (state.admin.em ||= { f: 'all', q: '', rf: 'all', rq: '', recent: null });
  let d = { list: [], at: 0 }; try { d = await api('GET', '/api/admin/email/bounces'); } catch {}
  if (!state.admin.customers) { try { state.admin.customers = await api('GET', '/api/admin/customers'); } catch { state.admin.customers = []; } }
  const q = ui.q.trim().toLowerCase();
  const bad = d.list.filter((x) => (ui.f === 'all' || (ui.f === 'spam') === /spam/.test(x.why)) && (!q || x.email.includes(q) || x.customers.some((c) => (c.name + ' ' + c.username).toLowerCase().includes(q))));
  state.admin.emShown = bad;
  const noMail = state.admin.customers.filter((c) => !c.email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(c.email));
  const tone = { delivered: 'st-active', opened: 'st-active', clicked: 'st-active', sent: 'st-open', delivery_delayed: 'st-expiring', queued: 'st-open', bounced: 'st-expired', complained: 'st-expired', suppressed: 'st-expired', failed: 'st-expired', canceled: 'st-closed' };
  const rq = ui.rq.trim().toLowerCase();
  const rec = (ui.recent || []).filter((m) => (ui.rf === 'all' || (ui.rf === 'problem' ? ['bounced', 'complained', 'suppressed', 'failed', 'delivery_delayed'].includes(m.status) : m.status === ui.rf)) && (!rq || (m.to + ' ' + m.subject).toLowerCase().includes(rq)));
  const count = (f) => (ui.recent || []).filter((m) => (f === 'problem' ? ['bounced', 'complained', 'suppressed', 'failed', 'delivery_delayed'].includes(m.status) : m.status === f)).length;
  return `<div class="stats"><div class="stat c-bad"><i class="st-ic">${ic('logout', 20)}</i><span>Paused addresses</span><b>${d.list.length}</b></div><div class="stat c-warn"><i class="st-ic">${ic('user', 20)}</i><span>Customers without a usable email</span><b>${noMail.length}</b></div><div class="stat"><i class="st-ic">${ic('clock', 20)}</i><span>Last bounce check</span><b style="font-size:1rem">${d.at ? fmtDT(d.at) : 'never'}</b></div></div>
    <div class="card" id="bounces"><div class="row"><h3 style="margin:0;flex:1">Bounced and spam-marked addresses</h3><button class="btn sm primary" data-act="bounce-sync" data-perm="customers_edit">Check Resend now</button></div>
      <p class="small muted">No emails are sent to these addresses, which protects your sender reputation. Checked automatically once a day. Correct the customer's email, or allow the address again if it is fine.</p>
      <div class="row" style="margin-bottom:10px"><input style="flex:1;min-width:160px" type="search" placeholder="🔎 Search address or customer…" value="${esc(ui.q)}" data-input="em-search"></div>
      <div class="chips">${[['all', 'All'], ['bounced', 'Bounced'], ['spam', 'Marked as spam']].map(([k, n]) => `<a class="${ui.f === k ? 'on' : ''}" data-act="em-f" data-f="${k}">${n} · ${k === 'all' ? d.list.length : d.list.filter((x) => (k === 'spam') === /spam/.test(x.why)).length}</a>`).join('')}</div>
      ${bad.length ? `<div class="row" style="margin-bottom:8px"><button class="btn sm" data-act="em-csv" data-perm="exports">⬇ Export these (${bad.length})</button><button class="btn sm" data-act="em-allowall" data-perm="customers_edit">Allow these again</button></div>` : ''}
      ${bad.length ? bad.map((x) => `<div class="list-item"><div style="flex:1;min-width:0"><b dir="ltr" style="overflow-wrap:anywhere">${esc(x.email)}</b> <span class="pill st-expired">${esc(/spam/.test(x.why) ? 'spam' : 'bounced')}</span><div class="small muted">${fmtDate(x.at)}${x.customers.length ? ' · ' + x.customers.map((c) => esc(c.name || c.username)).join(', ') : ' · no customer uses it now'}</div></div>${x.customers[0] ? `<button class="btn sm" data-act="edit-customer" data-perm="customers_edit" data-id="${esc(x.customers[0].id)}">Edit</button>` : ''}<button class="btn sm" data-act="bounce-clear" data-perm="customers_edit" data-email="${esc(x.email)}">Allow again</button></div>`).join('') : `<p class="muted small">${d.list.length ? 'Nothing matches this filter.' : 'No paused addresses. ✓'}</p>`}</div>
    <div class="card"><h3>Customers without a usable email (${noMail.length})</h3><p class="small muted">They cannot get login details, reminders or offers by email.</p>
      ${noMail.slice(0, ui.allNo ? 9999 : 8).map((c) => `<div class="list-item"><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="small muted">${esc(c.username)}${c.email ? ' · ' + esc(c.email) : ''}${c.whatsapp || c.phone ? ' · ' + esc(c.whatsapp || c.phone) : ''}</div></div><button class="btn sm" data-act="edit-customer" data-perm="customers_edit" data-id="${c.id}">Add email</button></div>`).join('') || '<p class="muted small">Every customer has an email address. ✓</p>'}
      ${noMail.length > 8 && !ui.allNo ? `<div style="text-align:center;margin-top:10px"><button class="btn sm" data-act="em-allno">Show all ${noMail.length}</button></div>` : ''}</div>
    <div class="card"><div class="row"><h3 style="margin:0;flex:1">Recent emails (from Resend)</h3><button class="btn sm" data-act="em-recent">${ui.recent ? '⟳ Refresh' : 'Load the last 100'}</button></div>
      ${ui.recent ? `<div class="row" style="margin:10px 0"><input style="flex:1;min-width:160px" type="search" placeholder="🔎 Search address or subject…" value="${esc(ui.rq)}" data-input="em-rsearch"></div>
        <div class="chips">${[['all', 'All · ' + ui.recent.length], ['delivered', 'Delivered · ' + count('delivered')], ['opened', 'Opened · ' + count('opened')], ['problem', 'Problems · ' + count('problem')]].map(([k, n]) => `<a class="${ui.rf === k ? 'on' : ''}" data-act="em-rf" data-f="${k}">${n}</a>`).join('')}</div>
        ${rec.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sent</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>${rec.map((m) => `<tr><td class="small">${fmtDT(m.at)}</td><td dir="ltr" style="overflow-wrap:anywhere">${esc(m.to)}</td><td>${esc(m.subject)}</td><td><span class="pill ${tone[m.status] || ''}">${esc(m.status.replace('_', ' '))}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Nothing matches this filter.</p>'}` : '<p class="small muted">Shows what was sent, to whom, and whether it was delivered, opened or bounced.</p>'}</div>`;
}
const reAdmin = async () => { const b = $('#admin-body'); const tb = state.admin.tab; if (!b) return; if (tb === 'alerts') b.innerHTML = await adminAlerts(state.admin.settings); else if (tb === 'emails') b.innerHTML = await adminEmails(); };
const keepFocus = async (sel, fn) => { const el = $(sel); const pos = el ? el.selectionStart : 0; await fn(); const n = $(sel); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } };
let alT = 0;
document.addEventListener('input', (e) => {
  const k = e.target.dataset?.input; if (!['al-search', 'em-search', 'em-rsearch'].includes(k)) return;
  if (k === 'al-search') state.admin.al.q = e.target.value; else if (k === 'em-search') state.admin.em.q = e.target.value; else state.admin.em.rq = e.target.value;
  clearTimeout(alT); alT = setTimeout(() => keepFocus(`[data-input=${k}]`, reAdmin), 250);
});
Object.assign(actions, {
  'al-f': (el) => { state.admin.al.f = el.dataset.f; reAdmin(); },
  'al-more': (el) => { state.admin.al.open[el.dataset.k] = true; reAdmin(); },
  'al-csv': (el) => { const g = (state.admin.alGroups || []).find((x) => x.k === el.dataset.k); if (g) download(`alerts-${g.k}-${isoDay(Date.now())}.csv`, custCsv(g.list), 'text/csv'); },
  'al-custom': () => {
    const a = { expiringDays: 7, expiredDays: 30, trialHours: 12, hide: {}, ...(state.admin.settings.alerts || {}) };
    modal('⚙️ Customize alerts', `<form data-form="al-custom"><div class="grid3">${field('“Ending soon” means within (days)', 'expiringDays', a.expiringDays, { type: 'number', attrs: 'min="1" max="60" required' })}${field('Keep expired customers listed for (days)', 'expiredDays', a.expiredDays, { type: 'number', attrs: 'min="1" max="365" required' })}${field('“Trial ending” means within (hours)', 'trialHours', a.trialHours, { type: 'number', attrs: 'min="1" max="72" required' })}</div>
      <h3 style="margin-top:8px">Groups to show</h3>${ALERT_DEFS.map(([k, icn, name]) => toggle(`${icn} ${name}`, 'show_' + k, !a.hide[k])).join('')}
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`, { wide: true });
  },
  'em-f': (el) => { state.admin.em.f = el.dataset.f; reAdmin(); },
  'em-rf': (el) => { state.admin.em.rf = el.dataset.f; reAdmin(); },
  'em-allno': () => { state.admin.em.allNo = true; reAdmin(); },
  'em-csv': () => download(`paused-emails-${isoDay(Date.now())}.csv`, toCsv(['Email', 'Reason', 'Date', 'Customers'], (state.admin.emShown || []).map((x) => [x.email, x.why, isoDay(x.at), x.customers.map((c) => c.username).join(' ')])), 'text/csv'),
  'em-allowall': async () => { const list = state.admin.emShown || []; if (!list.length || !confirm(`Allow emails to these ${list.length} address(es) again?`)) return; await api('POST', '/api/admin/email/bounces/clearall', { emails: list.map((x) => x.email) }); toast('Allowed again ✓'); state.admin.customers = null; reAdmin(); },
  'em-recent': async (el) => { el.disabled = true; try { state.admin.em.recent = (await api('GET', '/api/admin/email/recent')).list; reAdmin(); } catch (e) { toast(e.message, true); el.disabled = false; } },
});
Object.assign(forms, {
  async 'al-custom'(f) {
    const hide = {}; ALERT_DEFS.forEach(([k]) => { hide[k] = !f['show_' + k].checked; });
    try { await saveSettings({ alerts: { expiringDays: Number(f.expiringDays.value), expiredDays: Number(f.expiredDays.value), trialHours: Number(f.trialHours.value), hide } }, true); closeModal(); toast('Saved ✓'); state.admin.al.f = ''; reAdmin(); } catch (e) { toast(e.message, true); }
  },
});

// =====================================================================
// Admin: Message templates, Import & export
// =====================================================================
const TPL_GROUPS = [
  ['AM', 'trial', '🎁 Trial & welcome email', 'Sent with the login details when a free trial or a subscription starts. Texts starting with “trial” are for trials, “sub” for paid subscriptions.', '{name} {app} {date} {hours}'],
  ['MAIL', 'expiry', '⏰ Expiry reminder & short emails', 'The reminder sent a few days before a subscription ends, plus the short labels used in simple emails.', '{name} {days} {date} {hours}'],
  ['RM', 'renewal', '🔁 Renewal offer email', 'Sent to customers whose subscription or trial has ended.', '{name} {app} {site} {coupon}'],
  ['OM', 'order', '💳 Package order email', 'Package email; the button uses the payment link you type when sending (or WhatsApp).', '{name} {app} {pkg} {price} {d} {n}'],
];
const WA_NAMES = { pay: '💳 Payment link (place an order)', trial: '🎁 Free trial details', thanks: '🙏 Thank you for your purchase', renew: '🔁 Renewal reminder', login: '🔑 Login details', support: '🎧 Support link (24/7 help page)' };
const LANG3 = LANG5;
const nice = (k) => k.replace(/([A-Z0-9])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
// Black Friday (seasonal) promotion: one switch, the code goes into renewal emails and WhatsApp / Telegram messages.
async function promoCard() {
  let d; try { d = await api('GET', '/api/admin/promo'); } catch { return ''; }
  const p = d.promo || {}; state.admin.promo = d;
  return `<div class="card" id="promo-card" style="margin-bottom:14px;border:2px solid #0f172a">
    <div class="row" style="gap:8px"><h3 style="margin:0;flex:1">🖤 ${esc(p.name || 'Black Friday')} promotion</h3><span class="pill ${d.live ? 'st-active' : 'st-expired'}">${d.live ? 'Live now' : p.on ? 'On, outside the dates' : 'Off'}</span></div>
    <p class="small muted" style="margin:6px 0 10px">While it is on and today is between the dates, the code is added to: <b>renewal emails</b> (after a trial and after a subscription, the automatic ones too), and the <b>WhatsApp and Telegram messages</b> for renewals, trials and orders. For everyone else, send the ready newsletter and post it in your Telegram channel with the buttons below.</p>
    <form data-form="promo">
      ${toggle('Promotion on', 'on', !!p.on, 'Turn off any time: messages go back to normal at once.')}
      <div class="grid3">${field('Name', 'name', p.name || 'Black Friday', { attrs: 'maxlength="40"' })}${field('Promo code', 'code', p.code || '', { attrs: 'required maxlength="30" autocapitalize="characters"', help: 'Must work at checkout on your website.' })}${field('Discount (optional)', 'offer', p.offer || '', { ph: '30% OFF', attrs: 'maxlength="60"', help: 'Empty = “our biggest discount of the year”.' })}</div>
      <div class="grid2">${field('Starts', 'from', p.from || '', { type: 'date' })}${field('Ends (last day)', 'to', p.to || '', { type: 'date' })}</div>
      <div class="grid3">${toggle('Emails', 'email', p.email !== false)}${toggle('WhatsApp', 'whatsapp', p.whatsapp !== false)}${toggle('Telegram', 'telegram', p.telegram !== false)}</div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px"><button class="btn primary" data-perm="templates_edit">💾 Save</button><button type="button" class="btn" data-act="promo-pv">👁 Renewal email</button><button type="button" class="btn" data-act="promo-nl">📣 Newsletter to customers</button><button type="button" class="btn" data-act="promo-tg">✈️ Post in Telegram channel</button></div>
    </form>
    <details style="margin-top:10px"><summary class="small">Text added to WhatsApp / Telegram messages</summary><div class="grid2" style="margin-top:6px"><pre class="small" style="white-space:pre-wrap;background:var(--soft,#f1f5f9);padding:10px;border-radius:10px">${esc(d.wa.en)}</pre><pre class="small" style="white-space:pre-wrap;background:var(--soft,#f1f5f9);padding:10px;border-radius:10px">${esc(d.wa.fr)}</pre></div></details>
  </div>`;
}
const promoForm = () => { const f = $('[data-form=promo]'); return f ? formToObj(f) : {}; };

async function adminTemplates() {
  const ui = (state.admin.tp ||= { g: 'AM', lang: 'en', q: '', only: false });
  if (!ui.data) ui.data = await api('GET', '/api/admin/templates');
  const d = ui.data; const wa = ui.g === 'WA'; const own = ui.g === 'OWN';
  const edits = (d.custom[ui.g] || {})[ui.lang] || {};
  const changedCount = (g) => g === 'WA' ? Object.values(d.wa).reduce((n, x) => n + Object.keys(x).length, 0) : g === 'OWN' ? d.waCustom.length : Object.values(d.custom[g] || {}).reduce((n, x) => n + Object.keys(x).length, 0);
  const grp = TPL_GROUPS.find((x) => x[0] === ui.g);
  const canEdit = can("templates_edit");
  const q = ui.q.trim().toLowerCase();
  let body;
  if (own) {
    body = `<p class="small muted">Your own WhatsApp messages. They appear in the message list when you tap 💬 on a customer. You can use: {name} {fullname} {app} {package} {price} {days} {devices} {link} {username} {password} {dns} {m3u} {expires} {appUrl}</p>
      ${d.waCustom.map((x, i) => `<div class="tpl-f"><div class="row"><input style="flex:1" value="${esc(x.name)}" data-own="${i}" data-k="name" placeholder="Name of this message" maxlength="40"><button type="button" class="btn sm danger" data-act="tp-own-del" data-perm="templates_edit" data-i="${i}">Delete</button></div><textarea rows="5" data-own="${i}" data-k="text" dir="${ui.lang === 'ar' ? 'rtl' : 'ltr'}" placeholder="Message in ${LANG3.find((l) => l[0] === ui.lang)[1]}">${esc(x.text[ui.lang] || '')}</textarea></div>`).join('') || '<p class="muted small">No messages of your own yet.</p>'}
      <button type="button" class="btn" data-act="tp-own-add" data-perm="templates_edit">＋ Add a message</button>`;
  } else if (wa) {
    body = `<p class="small muted">The ready-made WhatsApp messages. You can use: {name} {fullname} {app} {package} {price} {days} {devices} {link} {username} {password} {dns} {m3u} {expires} {appUrl}</p>
      ${Object.keys(d.waDefaults).map((ty) => { const cur = (d.wa[ty] || {})[ui.lang]; return `<div class="tpl-f"><label><b>${WA_NAMES[ty] || nice(ty)}</b>${cur ? ' <span class="pill st-open">changed</span>' : ''}</label><textarea rows="9" data-wa="${ty}" dir="${ui.lang === 'ar' ? 'rtl' : 'ltr'}">${esc(cur || d.waDefaults[ty][ui.lang] || '')}</textarea>${cur ? `<button type="button" class="btn sm" data-act="tp-wa-reset" data-perm="templates_edit" data-ty="${ty}">Back to the original</button>` : ''}</div>`; }).join('')}`;
  } else {
    const keys = Object.keys(d.defaults[ui.g][ui.lang]).filter((k) => k !== 'dir').filter((k) => (!ui.only || edits[k]) && (!q || (k + ' ' + (edits[k] || d.defaults[ui.g][ui.lang][k])).toLowerCase().includes(q)));
    body = `<p class="small muted">${grp[3]} You can use: <span dir="ltr">${grp[4]}</span>. Simple formatting like &lt;b&gt;bold&lt;/b&gt; works.</p>
      <div class="row" style="margin-bottom:10px"><input style="flex:1;min-width:160px" type="search" placeholder="🔎 Find a text…" value="${esc(ui.q)}" data-input="tp-search"><label class="toggle" style="margin:0"><input type="checkbox" data-act="tp-only" ${ui.only ? 'checked' : ''}><i></i><span>Only changed</span></label></div>
      ${keys.map((k) => { const def = d.defaults[ui.g][ui.lang][k]; const cur = edits[k]; const long = (cur || def).length > 70;
        return `<div class="tpl-f"><label><b>${esc(nice(k))}</b>${cur ? ' <span class="pill st-open">changed</span>' : ''}</label>${long ? `<textarea rows="${Math.min(8, Math.ceil((cur || def).length / 60) + 1)}" data-tk="${k}" dir="${ui.lang === 'ar' ? 'rtl' : 'ltr'}">${esc(cur || def)}</textarea>` : `<input data-tk="${k}" value="${esc(cur || def)}" dir="${ui.lang === 'ar' ? 'rtl' : 'ltr'}">`}${cur ? `<button type="button" class="btn sm" data-act="tp-reset" data-perm="templates_edit" data-k="${k}">Back to the original</button>` : ''}</div>`; }).join('') || '<p class="muted small">Nothing matches.</p>'}`;
  }
  const promo = await promoCard();
  return promo + `<div class="chips">${TPL_GROUPS.map(([g, , n]) => `<a class="${ui.g === g ? 'on' : ''}" data-act="tp-g" data-g="${g}">${n}${changedCount(g) ? ' · ' + changedCount(g) : ''}</a>`).join('')}<a class="${wa ? 'on' : ''}" data-act="tp-g" data-g="WA">💬 WhatsApp messages${changedCount('WA') ? ' · ' + changedCount('WA') : ''}</a><a class="${own ? 'on' : ''}" data-act="tp-g" data-g="OWN">✍️ My own WhatsApp messages · ${d.waCustom.length}</a></div>
    <div class="card"><div class="row" style="margin-bottom:10px"><div class="seg">${LANG3.map(([k, n]) => `<button type="button" class="${ui.lang === k ? 'on' : ''}" data-act="tp-lang" data-lang="${k}">${n}</button>`).join('')}</div><span class="spacer"></span>${grp ? `<button type="button" class="btn" data-act="tp-preview">👁 Preview email</button>` : ''}<button type="button" class="btn primary" data-act="tp-save" data-perm="templates_edit">Save</button></div>
      <fieldset id="tpl-fields" ${canEdit ? "" : "disabled"} style="border:none;margin:0;padding:0">${body}</fieldset>
      <div class="row" style="margin-top:14px;justify-content:space-between"><div class="row"><button type="button" class="btn sm" data-act="tp-export" data-perm="exports">⬇ Export all templates</button><button type="button" class="btn sm" data-act="tp-import" data-perm="templates_edit">⬆ Import</button></div><button type="button" class="btn primary" data-act="tp-save" data-perm="templates_edit">Save</button></div></div>`;
}
// Reads what is typed on the page into the working copy, so switching language or group loses nothing.
function tpCollect() {
  const ui = state.admin.tp; if (!ui || !ui.data) return; const d = ui.data;
  document.querySelectorAll('#tpl-fields [data-tk]').forEach((el) => { const k = el.dataset.tk; const def = d.defaults[ui.g][ui.lang][k]; const v = el.value; const slot = ((d.custom[ui.g] ||= {})[ui.lang] ||= {}); if (v.trim() && v !== def) slot[k] = v; else delete slot[k]; });
  document.querySelectorAll('#tpl-fields [data-wa]').forEach((el) => { const ty = el.dataset.wa; const def = d.waDefaults[ty][ui.lang]; const v = el.value; const slot = (d.wa[ty] ||= {}); if (v.trim() && v !== def) slot[ui.lang] = v; else delete slot[ui.lang]; });
  document.querySelectorAll('#tpl-fields [data-own]').forEach((el) => { const x = d.waCustom[Number(el.dataset.own)]; if (!x) return; if (el.dataset.k === 'name') x.name = el.value; else x.text[ui.lang] = el.value; });
}
const tpRedraw = async () => { $('#admin-body').innerHTML = await adminTemplates(); };
const pickJson = () => new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = async () => { try { res(JSON.parse(await i.files[0].text())); } catch { toast('This file is not valid JSON.', true); res(null); } }; i.click(); });

// ---------------- import & export: every list, as a file or edited by hand ----------------
const DATA_SETS = [
  ['plans', 'Plans', 'The plans customers are on: name, days, price, devices, panel package, credits.', 'plans'],
  ['orderPackages', 'Order packages', 'The packages customers can request and that you send in order emails.', 'plans'],
  ['resellerPackages', 'Reseller packages', 'Credit packages you sell to resellers.', 'plans'],
  ['templates', 'Message templates', 'Your email wording and WhatsApp messages.', 'templates'],
  ['alerts', 'Alert settings', 'The thresholds and groups of the Alerts page.', 'alerts'],
  ['branding', 'Login & branding', 'App name, logo, colours, WhatsApp number, texts.', 'branding'],
  ['userDashboard', 'User dashboard', 'What customers can see and the announcement.', 'userdash'],
  ['renewalOffer', 'Renewal offer', 'The offer shown in renewal emails.', 'trial'],
  ['trial', 'Free trial', 'Trial length, credits and package.', 'trial'],
];
const dataValue = (s, k) => (k === 'templates' ? { mailTexts: s.mailTexts || {}, waTemplates: s.waTemplates || {}, waCustom: s.waCustom || [] } : s[k]);
const dataPatch = (k, v) => (k === 'templates' ? { mailTexts: v.mailTexts || {}, waTemplates: v.waTemplates || {}, waCustom: v.waCustom || [] } : { [k]: v });
async function adminData(s) {
  return `<div class="notice info">Everything here can be downloaded as a file, changed by hand, and loaded back. A full backup of the whole app (customers, money, settings) is one tap.</div>
    <div class="card"><h3>Whole app</h3><p class="small muted">One file with everything. Keep a copy somewhere safe before big changes.</p><div class="row"><button class="btn primary" data-act="backup">⬇ Download full backup</button><button class="btn" data-act="atab" data-tab="security">Restore from a backup…</button></div></div>
    <div class="card"><h3>Customers</h3><p class="small muted">Spreadsheet file (CSV) that opens in Excel or Google Sheets. To add many customers at once, use the import on the Customers page.</p><div class="row"><button class="btn" data-act="data-cust-csv" data-perm="exports">⬇ Customers (CSV)</button><button class="btn" data-act="data-cust-json" data-perm="exports">⬇ Customers (JSON)</button><button class="btn" data-act="atab" data-tab="customers">Open Customers →</button></div></div>
    <div class="card"><h3>Settings, one part at a time</h3><p class="small muted">Download a part, edit it by hand right here, or load a file you saved earlier. Nothing changes until you save.</p>
      ${DATA_SETS.map(([k, n, why, tab]) => `<div class="list-item data-row"><div style="flex:1;min-width:180px"><b>${n}</b><div class="small muted">${why}</div></div><div class="row"><button class="btn sm" data-act="data-export" data-perm="exports" data-k="${k}">⬇ Export</button><button class="btn sm" data-act="data-import" data-k="${k}">⬆ Import</button><button class="btn sm" data-act="data-edit" data-k="${k}">✏️ Edit by hand</button><button class="btn sm ghost" data-act="atab" data-tab="${tab}">Open page</button></div></div>`).join('')}</div>`;
}
async function dataApply(k, v) {
  const want = Array.isArray(dataValue(state.admin.settings, k)) ? 'a list' : 'a group of settings';
  if (Array.isArray(dataValue(state.admin.settings, k)) !== Array.isArray(v) || v === null || typeof v !== 'object') throw new Error(`This does not look right: “${DATA_SETS.find((x) => x[0] === k)[1]}” must be ${want}.`);
  await saveSettings(dataPatch(k, v), true); if (state.admin.tp) state.admin.tp.data = null;
}

let tpT = 0;
document.addEventListener('input', (e) => { if (e.target.dataset?.input !== 'tp-search') return; tpCollect(); state.admin.tp.q = e.target.value; clearTimeout(tpT); tpT = setTimeout(() => keepFocus('[data-input=tp-search]', tpRedraw), 250); });
Object.assign(actions, {
  'tp-g': (el) => { tpCollect(); Object.assign(state.admin.tp, { g: el.dataset.g, q: '', only: false }); tpRedraw(); },
  'tp-lang': (el) => { tpCollect(); state.admin.tp.lang = el.dataset.lang; tpRedraw(); },
  'tp-only': (el) => { tpCollect(); state.admin.tp.only = el.checked; tpRedraw(); },
  'tp-reset': (el) => { tpCollect(); const ui = state.admin.tp; delete ui.data.custom[ui.g]?.[ui.lang]?.[el.dataset.k]; tpRedraw(); toast('Original text is back. Tap Save to keep it.'); },
  'tp-wa-reset': (el) => { tpCollect(); const ui = state.admin.tp; delete ui.data.wa[el.dataset.ty]?.[ui.lang]; tpRedraw(); toast('Original text is back. Tap Save to keep it.'); },
  'tp-own-add': () => { tpCollect(); state.admin.tp.data.waCustom.push({ id: Math.random().toString(36).slice(2, 8), name: 'New message', text: { en: '', fr: '', ar: '' } }); tpRedraw(); },
  'tp-own-del': (el) => { if (!confirm('Delete this message?')) return; tpCollect(); state.admin.tp.data.waCustom.splice(Number(el.dataset.i), 1); tpRedraw(); },
  'tp-save': async () => {
    tpCollect(); const d = state.admin.tp.data;
    try { await saveSettings({ mailTexts: d.custom, waTemplates: d.wa, waCustom: d.waCustom }, true); state.admin.tp.data = null; toast('Templates saved ✓'); tpRedraw(); } catch {}
  },
  'tp-preview': async () => {
    tpCollect(); const ui = state.admin.tp; const kind = TPL_GROUPS.find((x) => x[0] === ui.g)[1];
    const show = async (k) => { const r = await api('POST', '/api/admin/templates/preview', { kind: k, lang: ui.lang, mailTexts: ui.data.custom, appUrl: location.origin }); const b = $('.modal-body'); b.querySelector('#pv-subj').textContent = r.subject; b.querySelector('iframe').srcdoc = r.html; };
    modal('👁 Preview (not saved yet)', `${kind === 'trial' ? `<div class="seg" style="margin-bottom:10px"><button type="button" class="on" data-act="tp-pv" data-k="trial">Trial</button><button type="button" data-act="tp-pv" data-k="welcome">New subscription</button></div>` : ''}<p class="small muted" style="margin:0 0 8px">Subject: <b id="pv-subj"></b></p><iframe title="Email preview" sandbox="" style="width:100%;height:62vh;border:1px solid var(--border);border-radius:12px;background:#fff"></iframe>`, { wide: true });
    state.admin.tp.show = show; try { await show(kind); } catch (e) { toast(e.message, true); }
  },
  'tp-pv': async (el) => { el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); try { await state.admin.tp.show(el.dataset.k); } catch (e) { toast(e.message, true); } },
  'tp-export': () => { tpCollect(); const d = state.admin.tp.data; download(`templates-${isoDay(Date.now())}.json`, JSON.stringify({ mailTexts: d.custom, waTemplates: d.wa, waCustom: d.waCustom }, null, 2), 'application/json'); },
  'tp-import': async () => { const v = await pickJson(); if (!v) return; if (!v.mailTexts && !v.waTemplates && !v.waCustom) return toast('This file has no templates in it.', true); if (!confirm('Replace your current templates with the ones in this file?')) return; try { await dataApply('templates', v); toast('Templates imported ✓'); tpRedraw(); } catch (e) { toast(e.message, true); } },
  'data-export': (el) => download(`${el.dataset.k}-${isoDay(Date.now())}.json`, JSON.stringify(dataValue(state.admin.settings, el.dataset.k), null, 2), 'application/json'),
  'data-import': async (el) => { const v = await pickJson(); if (!v) return; const n = DATA_SETS.find((x) => x[0] === el.dataset.k)[1]; if (!confirm(`Replace “${n}” with the content of this file?`)) return; try { await dataApply(el.dataset.k, v); toast(n + ' imported ✓'); } catch (e) { toast(e.message, true); } },
  'data-edit': (el) => { const k = el.dataset.k; const n = DATA_SETS.find((x) => x[0] === k)[1];
    modal('✏️ ' + n, `<form data-form="data-edit" data-k="${k}"><p class="small muted" style="margin-top:0">Edit carefully and keep the punctuation ( { } [ ] " , ). The app checks it before saving and tells you if something is wrong.</p><textarea name="json" rows="18" spellcheck="false" dir="ltr" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82rem;white-space:pre;overflow:auto">${esc(JSON.stringify(dataValue(state.admin.settings, k), null, 2))}</textarea><div id="data-err"></div><div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Check and save</button></div></form>`, { wide: true }); },
  'data-cust-csv': async () => { const l = await api('GET', '/api/admin/customers'); download(`customers-${isoDay(Date.now())}.csv`, custCsv(l), 'text/csv'); },
  'data-cust-json': async () => { const l = await api('GET', '/api/admin/customers'); download(`customers-${isoDay(Date.now())}.json`, JSON.stringify(l, null, 2), 'application/json'); },
});
Object.assign(forms, {
  async 'data-edit'(f) {
    let v; try { v = JSON.parse(f.json.value); } catch (e) { $('#data-err').innerHTML = `<div class="err-box">This is not valid yet: ${esc(e.message)}</div>`; return; }
    try { await dataApply(f.dataset.k, v); closeModal(); toast('Saved ✓'); } catch (e) { $('#data-err').innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
  },
});

// =====================================================================
// Phone numbers with country code, ready trial lines, line link paste
// =====================================================================
const DIAL = 'MA212 DZ213 TN216 EG20 LY218 MR222 SA966 AE971 QA974 KW965 BH973 OM968 JO962 LB961 IQ964 SY963 PS970 YE967 SD249 FR33 BE32 NL31 DE49 ES34 IT39 PT351 GB44 IE353 CH41 AT43 LU352 SE46 NO47 DK45 FI358 PL48 RO40 GR30 CZ420 SK421 HU36 HR385 SI386 BG359 LT370 LV371 EE372 CY357 MT356 IS354 LI423 MC377 AD376 SM378 GI350 RS381 BA387 ME382 AL355 MK389 MD373 XK383 BY375 TR90 RU7 UA380 US1 CA1 MX52 BR55 AR54 CO57 CL56 IN91 PK92 BD880 TH66 MY60 SG65 ID62 PH63 VN84 CN86 JP81 KR82 AU61 NZ64 ZA27 NG234 SN221 CI225 CM237 ML223 GH233 KE254 IL972 IR98'.split(' ').map((x) => [x.slice(0, 2), x.slice(2)]);
const TZ_CC = { 'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN', 'Africa/Cairo': 'EG', 'Europe/Paris': 'FR', 'Europe/Brussels': 'BE', 'Europe/Amsterdam': 'NL', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/London': 'GB', 'Europe/Istanbul': 'TR', 'Asia/Riyadh': 'SA', 'Asia/Dubai': 'AE', 'Asia/Qatar': 'QA', 'Asia/Bangkok': 'TH', 'America/New_York': 'US', 'America/Toronto': 'CA' };
function guessCountry() {
  try { const tz = TZ_CC[Intl.DateTimeFormat().resolvedOptions().timeZone]; if (tz) return tz; } catch {}
  for (const l of navigator.languages || []) { const r = (l.split('-')[1] || '').toUpperCase(); if (DIAL.some((d) => d[0] === r)) return r; }
  return 'US'; // unknown: +1 (USA)
}
const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
let regionNames = null; const countryName = (cc) => { try { regionNames ||= new Intl.DisplayNames([getLang()], { type: 'region' }); return regionNames.of(cc); } catch { return cc; } };
// The customer's country when a saved number has no country code: Europe from the email ending (.de → +49, .ch → +41, .co.uk → +44…), otherwise USA (+1).
const TLD_CC = { de: 'DE', ch: 'CH', at: 'AT', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', be: 'BE', uk: 'GB', gb: 'GB', ie: 'IE', pt: 'PT', se: 'SE', no: 'NO', dk: 'DK', fi: 'FI', pl: 'PL', lu: 'LU', gr: 'GR', cz: 'CZ', sk: 'SK', hu: 'HU', ro: 'RO', bg: 'BG', hr: 'HR', si: 'SI', lt: 'LT', lv: 'LV', ee: 'EE', cy: 'CY', mt: 'MT', is: 'IS', li: 'LI', mc: 'MC', rs: 'RS', ba: 'BA', al: 'AL', mk: 'MK', md: 'MD', ua: 'UA', ad: 'AD', sm: 'SM', va: 'VA', gi: 'GI' };
const custCC = (c) => TLD_CC[String(c?.email || '').trim().toLowerCase().split('.').pop()] || 'US';
// A number written with + or 00 keeps its own country code. Without it: the customer's country (default USA +1); a leading 0 of a local number is dropped.
function splitPhone(value, defCC) {
  const raw = String(value || '').trim(); let digits = raw.replace(/\D/g, ''); const intl = raw.startsWith('+') || digits.startsWith('00'); if (digits.startsWith('00')) digits = digits.slice(2);
  const longest = () => DIAL.filter(([, d]) => digits.startsWith(d)).sort((x, y) => y[1].length - x[1].length)[0];
  if (!digits) return { cc: '', rest: '' };
  if (intl) { const h = longest(); return h ? { cc: h[0], rest: digits.slice(h[1].length) } : { cc: '', rest: digits }; }
  if (defCC) { const dd = (DIAL.find((x) => x[0] === defCC) || [])[1];
    if (dd && digits.startsWith(dd) && digits.length - dd.length >= 7) return { cc: defCC, rest: digits.slice(dd.length) };
    if (defCC === 'US' && !(digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))) { const h = longest(); if (h && digits.length - h[1].length >= 7) return { cc: h[0], rest: digits.slice(h[1].length) }; } // US numbers have 10 digits (+1); anything else already carries its country code
    return { cc: defCC, rest: digits.replace(/^0+/, '') }; }
  const h = digits.length >= 11 ? longest() : null; return h ? { cc: h[0], rest: digits.slice(h[1].length) } : { cc: '', rest: raw };
}
function phoneField(label, name, required = true, value = '', defCC = '') {
  // an existing number is split into its country code and the rest
  const sp = splitPhone(value, defCC); const hit = !!sp.cc;
  const g = hit ? sp.cc : value ? '' : defCC || guessCountry(); const rest = value ? sp.rest : '';
  return `<label class="field"><span>${label}</span><div class="phone-row"><select name="${name}_cc" aria-label="${t('countryCode')}" ${required ? 'required' : ''}><option value="">${t('countryCode')}</option>${DIAL.map(([cc, d]) => `<option value="${d}" ${cc === g ? 'selected' : ''}>${flag(cc)} ${esc(countryName(cc))} +${d}</option>`).join('')}</select><input type="tel" name="${name}" value="${esc(rest)}" ${required ? 'required' : ''} inputmode="tel" autocomplete="tel-national" dir="ltr" placeholder="612345678"></div></label>`;
}
// "+212612345678" from the country code and the number typed (a leading 0 is dropped; a full +number typed by hand is kept).
function fullPhone(f, name) {
  const raw = String(f[name]?.value || '').trim(); const cc = f[name + '_cc']?.value || '';
  const digits = raw.replace(/\D/g, '');
  const full = raw.startsWith('+') || raw.startsWith('00') ? digits.replace(/^00/, '') : cc && digits.startsWith(cc) && digits.length > 10 ? digits : cc ? cc + digits.replace(/^0+/, '') : '';
  return /^\d{8,15}$/.test(full) ? '+' + full : '';
}
function parseLineLinkClient(link) {
  const m = String(link || '').match(/https?:\/\/[^\s"'<>]+/i); if (!m) return null; let u; try { u = new URL(m[0]); } catch { return null; }
  let user = u.searchParams.get('username') || '', pass = u.searchParams.get('password') || '';
  if (!user || !pass) { const p = u.pathname.split('/').filter(Boolean); const i = ['live', 'movie', 'series'].includes(p[0]) ? 1 : 0; if (p.length >= i + 2) { user = decodeURIComponent(p[i]); pass = decodeURIComponent(p[i + 1]); } }
  return user && pass && !/\.(php|m3u8?|ts)$/i.test(user) ? { u: user, p: pass, dns: u.origin } : null;
}
document.addEventListener('input', (e) => {
  if (e.target.form?.dataset?.form === 'customer' && (e.target.dataset?.cn === 'devices' || e.target.name === 'connections')) { const t = $('#conn-total'); if (t) t.textContent = (Number(e.target.form.connections?.value) || 1) + connRead(e.target.form).reduce((a, x) => a + x.devices, 0); }
  if (e.target.dataset?.input === 'conn-m3u') {
    const r = e.target.closest('.conn-row'); const ln = parseLineLinkClient(e.target.value); if (!r || !ln) return;
    const set = (k, v) => { const el = r.querySelector(`[data-cn="${k}"]`); if (el) el.value = v; }; set('u', ln.u); set('p', ln.p); set('dns', ln.dns);
    return toast(`Connection found: ${ln.u} on ${ln.dns}`);
  }
  if (e.target.dataset?.input !== 'm3u-paste') return;
  const f = e.target.form; const ln = parseLineLinkClient(e.target.value); if (!f || !ln) return;
  if (f.username && !f.username.value) f.username.value = ln.u;
  if (f.password && !f.password.value) f.password.value = ln.p;
  if (f.lineUsername) f.lineUsername.value = ln.u; if (f.linePassword) f.linePassword.value = ln.p;
  if (f.lineSame && f.lineSame.checked) { f.lineSame.checked = false; const lf = $('#line-fields'); if (lf) lf.style.display = ''; }
  toast(`Line found: ${ln.u} on ${ln.dns}`);
});
async function adminPool() {
  let d = { lines: [] }; try { d = await api('GET', '/api/admin/trialpool'); } catch { return ''; }
  return `<div class="card" id="pool"><div class="row"><h3 style="margin:0;flex:1">🎟 Ready trial lines <span class="pill ${d.lines.length > 2 ? 'st-active' : 'st-expired'}">${d.lines.length} left</span></h3></div>
    <p class="small muted">Make trial lines on your panel, then paste their M3U links here, one per line. Each new free trial takes one, so the customer gets the login on screen and by email at once, even when the panel API is not answering. When none are left, the request goes to Alerts → “Waiting for a line” and you get an email.</p>
    <form data-form="pool-add">${field('M3U links, one per line', 'add', '', { type: 'textarea', rows: 4, ph: 'http://your-dns.com:8080/get.php?username=AAA&password=BBB&type=m3u_plus\nhttp://your-dns.com:8080/get.php?username=CCC&password=DDD&type=m3u_plus', attrs: 'required spellcheck="false" autocapitalize="none" dir="ltr"' })}<div class="row"><button class="btn primary">Add lines</button>${d.lines.length ? `<button type="button" class="btn" data-act="pool-export" data-perm="exports">⬇ Export list</button><button type="button" class="btn danger" data-act="pool-clear">Remove all</button>` : ''}</div></form>
    ${d.lines.length ? `<div style="margin-top:12px">${d.lines.slice(0, 30).map((x) => `<div class="list-item"><div style="flex:1;min-width:0" dir="ltr"><b>${esc(x.u)}</b><div class="small muted">${esc(x.dns)}</div></div><button class="btn sm" data-act="pool-del" data-u="${esc(x.u)}">Remove</button></div>`).join('')}${d.lines.length > 30 ? `<p class="small muted">…and ${d.lines.length - 30} more.</p>` : ''}</div>` : ''}</div>`;
}
async function persistStripeAccountsFromTable(silent) {
    const stripeAccounts = [...document.querySelectorAll('#sa-list .op-row')].map((r) => {
      const g = (k) => (r.querySelector(`[data-k=${k}]`) || {}).value || '';
      const bTxt = g('balance').trim();
      return { id: r.dataset.sa || undefined, name: g('name').trim(), currency: g('currency'), status: g('status'), payoutDays: Number(g('payoutDays')) || 7, note: g('note'), rk: g('rk'), bankId: g('bankId') || undefined,
        balance: bTxt === '' ? null : Number(bTxt),
        balanceAt: bTxt === '' ? 0 : (Number(g('balanceAt')) || Date.now()),
        links: [...r.querySelectorAll('.sa-link')].map((l) => { const h = (k) => (l.querySelector(`[data-k=${k}]`) || {}).value.trim(); return { id: l.dataset.link || undefined, label: h('label'), url: h('url'), currency: h('currency'), tier: h('tier') }; }).filter((l) => l.url) };
    }).filter((a) => a.name || a.balance != null);

    try { await api('PUT', '/api/admin/settings', { stripeAccounts }); if (!silent) toast('Saved ✓'); } catch (e) { toast(e.message, true); }
}
Object.assign(actions, {
  'copy-el': async (el) => { const txt = document.getElementById(el.dataset.el)?.textContent || ''; try { await navigator.clipboard.writeText(txt); } catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); } toast(t('copied')); },
  'copy-text': async (el) => { const txt = el.dataset.text || ''; try { await navigator.clipboard.writeText(txt); } catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); } toast(t('copied')); },
  'ref-copy-code': async () => { const txt = state.user.me?.referral?.code || ''; if (txt) await actions['copy-text']({ dataset: { text: txt } }); },
  'ref-copy-link': async () => { const txt = state.user.me?.referral?.link || ''; if (txt) await actions['copy-text']({ dataset: { text: txt } }); },
  'view-customer': async (el) => { if ($('.modal')) closeModal(); state.admin.profileId = el.dataset.id; const body = $('#admin-body'); if (body) body.innerHTML = adminCustomerProfile((state.admin.customers || []).find((x) => x.id === el.dataset.id)) || adminCustomers(); },
  'back-list': () => { state.admin.profileId = ''; renderAdmin(); },
  'pool-del': async (el) => { await api('POST', '/api/admin/trialpool/remove', { u: el.dataset.u }); renderAdmin(); },
  'pool-clear': async () => { if (!confirm('Remove every ready trial line?')) return; await api('POST', '/api/admin/trialpool/remove', { all: true }); renderAdmin(); },
  'pool-export': async () => { const d = await api('GET', '/api/admin/trialpool'); download(`trial-lines-${isoDay(Date.now())}.csv`, toCsv(['Username', 'Server'], d.lines.map((x) => [x.u, x.dns])), 'text/csv'); },
});
Object.assign(forms, {
  async 'pool-add'(f) { try { const r = await api('POST', '/api/admin/trialpool', { add: f.add.value }); toast(`${r.added} line(s) added${r.skipped ? ' · ' + r.skipped + ' skipped (not a line link, or already used)' : ''}`, !r.added); renderAdmin(); } catch (e) { toast(e.message, true); } },
});

// =====================================================================
// Live chat between a customer and the dashboard
// =====================================================================
const chatBubbles = (msgs, mine) => msgs.length ? msgs.map((m) => `<div class="msg ${m.from === mine ? 'mine' : ''}"><div class="msg-t">${esc(m.text)}</div><div class="small muted" style="margin-top:3px">${m.by && m.from !== mine ? esc(m.by) + ' · ' : ''}${fmtDT(m.at)}${isAdminUI() ? ` <button type="button" class="tr-msg-btn" data-act="tr-msg" title="Translate this message" aria-label="Translate this message">🌐</button>` : ''}</div></div>`).join('') : `<p class="muted small" style="text-align:center;margin:24px 0">${isAdminUI() ? 'No messages yet. Write the first one.' : t('chatEmpty')}</p>`;
const chatScroll = () => { const el = $('#chat-thread'); if (el) el.scrollTop = el.scrollHeight; };
function chatPaint(msgs, mine) { const el = $('#chat-thread'); if (!el) return; if (Number(el.dataset.n) === msgs.length) return; const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80 || !el.dataset.n; el.dataset.n = msgs.length; el.innerHTML = chatBubbles(msgs, mine); if (atEnd) chatScroll(); setTimeout(() => TR.chatAuto(), 80); }
// customer side
function setChatFab(unread) {
  let el = document.getElementById('chat-fab');
  if (!el) { el = document.createElement('button'); el.id = 'chat-fab'; el.className = 'chat-fab'; el.dataset.act = 'chat-open'; el.setAttribute('aria-label', t('chatT')); document.body.appendChild(el); }
  el.innerHTML = `${ic('chat', 26)}${unread ? `<b>${unread > 9 ? '9+' : unread}</b>` : ''}`;
}
async function openChat() {
  modal('🗨 ' + t('chatT'), `<div class="thread chat" id="chat-thread"><div class="spinner"></div></div><form data-form="chat-send" class="chat-form"><input name="text" maxlength="1000" autocomplete="off" placeholder="${t('chatPh')}" aria-label="${t('chatPh')}" required><button class="btn primary" aria-label="${t('send')}">${ic('play', 18)}</button></form>`);
  try { const r = await api('GET', '/api/me/chat'); chatPaint(r.messages, 'c'); setChatFab(0); state.user.me.chatUnread = 0; } catch (e) { toast(tErr(e.message), true); }
  $('.chat-form input')?.focus();
}
// admin side
async function adminChat() {
  const ui = (state.admin.ch ||= { id: '', q: '' });
  const list = await api('GET', '/api/admin/chats'); ui.list = list;
  let thread = null; if (ui.id) { try { thread = await api('GET', '/api/admin/chat?id=' + encodeURIComponent(ui.id)); const e = list.find((x) => x.id === ui.id); if (e) e.ua = 0; } catch { ui.id = ''; } }
  chatBadge(list);
  const q = ui.q.trim().toLowerCase(); const shown = list.filter((x) => !q || (x.name + ' ' + x.username + ' ' + x.last).toLowerCase().includes(q));
  return `<div class="chat-wrap ${ui.id ? 'has-open' : ''}"><div class="card chat-list"><input type="search" placeholder="🔎 Search chats…" value="${esc(ui.q)}" data-input="ch-search" style="margin-bottom:10px">
      <div id="chat-items">${chatItems(shown, ui.id)}</div></div>
    <div class="card chat-pane">${thread ? `<div class="row" style="margin-bottom:10px"><button class="btn sm chat-back" data-act="chat-back">←</button><div class="avatar">${esc(initials(thread.name))}</div><div style="flex:1;min-width:0"><b>${esc(thread.name)}</b><div class="small muted">${esc(thread.username)}</div></div><button class="btn sm" data-act="edit-customer" data-perm="customers_edit" data-id="${esc(thread.id)}">Customer</button></div>
      <div class="thread chat" id="chat-thread" data-n="${thread.messages.length}">${chatBubbles(thread.messages, 's')}</div>
      <form data-form="chat-reply" class="chat-form" data-perm="customers_edit"><input name="text" maxlength="1000" autocomplete="off" placeholder="Write a message…" aria-label="Message" required><button type="button" class="btn sm" data-act="tr-reply" title="Translate my reply">🌐</button><button class="btn primary">Send</button></form>` : `<div class="empty"><span class="ic">🗨</span>${list.length ? 'Choose a chat on the left.' : 'No chats yet. Customers start one with the chat button in their app, or tap 🗨 on a customer to write first.'}</div>`}</div></div>`;
}
const chatItems = (list, cur) => list.length ? list.map((x) => `<div class="list-item chat-item ${x.id === cur ? 'on' : ''}" data-act="chat-pick" data-id="${esc(x.id)}" tabindex="0"><div class="avatar">${esc(initials(x.name))}</div><div style="flex:1;min-width:0"><b>${esc(x.name)}</b><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x.from === 's' ? 'You: ' : ''}${esc(x.last)}</div></div><div style="text-align:end"><div class="small muted">${fmtDate(x.at)}</div>${x.ua ? `<b class="nav-badge">${x.ua}</b>` : ''}</div></div>`).join('') : '<p class="muted small">No chats.</p>';
function chatBadge(list) { const n = list.reduce((a, x) => a + (x.ua || 0), 0); document.querySelectorAll('#chat-badge').forEach((b) => { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }); }
// One light timer keeps open chats fresh: every 5 seconds while a chat is on screen, every 30 seconds for the menu badge.
let chatN = 0;
setInterval(async () => {
  if (document.hidden || !state.token) return; chatN++;
  try {
    if (state.role === 'user') { if ($('#chat-thread') && $('form[data-form=chat-send]')) { const r = await api('GET', '/api/me/chat'); chatPaint(r.messages, 'c'); } return; }
    if (!isAdminUI() || !can('customers_view')) return;
    if (state.admin.tab === 'chat' && $('.chat-wrap')) {
      const ui = state.admin.ch;
      if (ui.id && $('#chat-thread')) { const r = await api('GET', '/api/admin/chat?id=' + encodeURIComponent(ui.id)); chatPaint(r.messages, 's'); }
      if (chatN % 2 === 0) { const list = await api('GET', '/api/admin/chats'); ui.list = list; const q = ui.q.trim().toLowerCase(); const el = $('#chat-items'); if (el) el.innerHTML = chatItems(list.filter((x) => !q || (x.name + ' ' + x.username + ' ' + x.last).toLowerCase().includes(q)), ui.id); chatBadge(list); }
    } else if (chatN % 6 === 0) chatBadge(await api('GET', '/api/admin/chats'));
  } catch {}
}, 5000);
document.addEventListener('input', (e) => { if (e.target.dataset?.input !== 'ch-search') return; state.admin.ch.q = e.target.value; const q = e.target.value.trim().toLowerCase(); const el = $('#chat-items'); if (el) el.innerHTML = chatItems((state.admin.ch.list || []).filter((x) => !q || (x.name + ' ' + x.username + ' ' + x.last).toLowerCase().includes(q)), state.admin.ch.id); });
Object.assign(actions, {
  'chat-open': () => openChat(),
  'chat-pick': async (el) => { state.admin.ch.id = el.dataset.id; $('#admin-body').innerHTML = await adminChat(); chatScroll(); $('.chat-form input')?.focus(); },
  'chat-back': async () => { state.admin.ch.id = ''; $('#admin-body').innerHTML = await adminChat(); },
  'chat-with': (el) => { closeModal(); (state.admin.ch ||= { id: '', q: '' }).id = el.dataset.id; state.admin.tab = 'chat'; renderAdmin(); },
});
Object.assign(forms, {
  async 'chat-send'(f) { const text = f.text.value.trim(); if (!text) return; f.text.value = ''; try { const r = await api('POST', '/api/me/chat', { text }); const el = $('#chat-thread'); if (el) el.dataset.n = ''; chatPaint(r.messages, 'c'); chatScroll(); } catch (e) { f.text.value = text; toast(tErr(e.message), true); } f.text.focus(); },
  async 'chat-reply'(f) { const text = f.text.value.trim(); if (!text) return; f.text.value = ''; try { const r = await api('POST', '/api/admin/chat', { id: state.admin.ch.id, text }); const el = $('#chat-thread'); if (el) el.dataset.n = ''; chatPaint(r.messages, 's'); chatScroll(); } catch (e) { f.text.value = text; toast(e.message, true); } f.text.focus(); },
});

// =====================================================================
// Panel sync and payment receipts
// =====================================================================
async function syncPanel(ids) {
  let off = 0, changed = 0, bad = 0, total = 0, error = '';
  for (let guard = 0; guard < 400; guard++) {
    const r = await api('POST', '/api/admin/sync', { offset: off, ids });
    changed += r.changed; total = r.total; if (r.error) error = r.error; off = r.next; bad += r.bad;
    toast(`Checking the panel… ${Math.min(off, total)} / ${total}`);
    if (r.done) break;
  }
  return { changed, bad, total, error };
}
// ---------------- multi-account Stripe control panel (spec §6) ----------------
const saLinkRow = (l = {}) => {
  let host = l.url; try { host = new URL(l.url).host.replace(/^www\./, ''); } catch {}
  return `<div class="sa-link" data-link="${esc(l.id || '')}">
    <a class="sa-link-chip" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.url || '')}">🔗 ${esc(l.label || 'Link')}</a>
    <span class="sa-link-host" title="${esc(l.url || '')}">${esc(host)}</span>
    <input data-k="label" value="${esc(l.label || '')}" placeholder="Label" class="sa-link-label" style="width:110px">
    <input data-k="url" value="${esc(l.url || '')}" placeholder="https://buy.stripe.com/…" dir="ltr" autocomplete="off" class="sa-link-url" style="flex:1;min-width:120px">
    <select data-k="currency" style="width:auto">${['USD', 'EUR'].map((c) => `<option ${l.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <select data-k="tier" style="width:auto">${['Normal', 'Resellers', 'IBO'].map((t2) => `<option ${l.tier === t2 ? 'selected' : ''}>${t2}</option>`).join('')}</select>
    <button class="btn sm danger" data-act="sa-del-link" title="Remove link" aria-label="Remove link">🗑</button>
  </div>`;
};
const saRow = (a, finAccounts, rec) => `<div class="op-row card" data-sa="${esc(a.id || '')}" style="padding:12px;margin-bottom:12px">
  <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><input data-k="name" value="${esc(a.name || '')}" placeholder="Account name" style="flex:2;min-width:160px">
    <select data-k="currency" style="width:auto">${['USD', 'EUR'].map((c) => `<option ${a.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <select data-k="status" style="width:auto">${[['active', 'Active'], ['verification', 'Verification'], ['closed', 'Closed']].map(([k, n]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <select data-k="payoutDays" style="width:auto">${[2, 7].map((n) => `<option value="${n}" ${Number(a.payoutDays) === n ? 'selected' : ''}>${n}-day payout</option>`).join('')}</select>
    <select data-k="bankId" class="sa-bank" style="width:auto" title="Payments are booked to this bank FIRST; your Stripe payout then lands in it">${(finAccounts || []).map((acc) => `<option value="${esc(acc.id)}" ${a.bankId === acc.id ? 'selected' : ''}>Settles to → ${esc(acc.name)}</option>`).join('')}</select>
    <span class="sa-balance-display" style="flex:1;text-align:right;min-width:170px"><b>Recorded ${rec ? '$' + Number(rec.usd || 0).toFixed(2) : '$0.00'}</b><div class="small muted">${rec ? rec.n + ' sale(s)' + (rec.usd30d ? ' · $' + Number(rec.usd30d).toFixed(2) + ' in 30 days' : '') : 'no sales yet'}</div></span>
    <button class="btn sm" data-act="sa-balance" data-id="${esc(a.id)}" title="Fetch live balance from Stripe">💰</button>
    <button class="btn sm" data-act="sa-edit-balance" data-id="${esc(a.id)}" title="Edit balance manually" aria-label="Edit balance manually">✏️</button>
    <button class="btn sm danger" data-act="sa-del" title="Remove account" aria-label="Remove account">🗑</button></div>
  <input data-k="note" value="${esc(a.note || '')}" placeholder="Note (payout schedule, bank transfer, …)" style="margin-top:8px">
  <div class="grid2" style="margin-top:8px">
    <label class="field" style="margin:0"><span class="small">Stored balance</span><input data-k="balance" type="number" step="any" value="${a.balance == null ? '' : String(a.balance)}" placeholder="e.g. 28.82" dir="ltr" min="0"></label>
    <label class="field" style="margin:0"><span class="small">As of (auto)</span><input data-k="balanceAt" type="number" value="${esc(String(a.balanceAt || ''))}" placeholder="Unix ms" dir="ltr" style="display:none"></label>
  </div>
  <div style="margin-top:12px"><p class="small muted" style="margin:0 0 6px">Payment links — normal / resellers / IBO</p><div class="sa-links">${(a.links || []).map(saLinkRow).join('')}</div>
    <button class="btn sm" data-act="sa-add-link">＋ Add link</button></div>
  <div class="sa-bal small muted" style="margin-top:6px"></div></div>`;
// Which accounts the panel takes payment links from (GreenApp Host by default), rotation, and which link each package gets
async function payRouteCard(s) {
  const ck = await api('GET', '/api/admin/paylinks/check').catch(() => null); if (!ck) return '';
  const on = new Set(ck.route.accounts); const canEdit = can('stripe');
  const accs = ck.accounts.map((a) => `<label style="display:inline-flex;gap:6px;align-items:center;margin:0 16px 6px 0;text-transform:none;letter-spacing:0;font-size:14px"><input type="checkbox" style="width:auto" name="pr-acc" value="${esc(a.id)}" ${on.has(a.id) ? 'checked' : ''} ${a.status !== 'active' || !canEdit ? 'disabled' : ''}> ${esc(a.name || a.id)} <span class="muted small">(${a.links} links${a.status !== 'active' ? ', ' + esc(a.status) : ''})</span></label>`).join('');
  const rows = ck.rows.filter((r) => !/^r/i.test(r.pkg) || r.links.length).map((r) => `<tr><td>${esc(r.name || r.pkg)}</td><td>${esc(r.cur)}</td><td>${r.links.length ? r.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" class="small">${esc(l.label || 'link')}</a>`).join('<br>') + (r.links.length > 1 && ck.route.rotate ? ' <span class="badge">🔁 rotation</span>' : '') + (r.otherCurrency ? ` <span class="badge warn">only ${esc(r.links[0].cur)}</span>` : '') : '<span class="badge bad">no link</span>'}</td></tr>`).join('');
  const kinds = { 'same-url': (x) => `The same link is used for <b>${esc(x.a)}</b> and <b>${esc(x.b)}</b>${x.currency ? ' (' + esc(x.currency) + ')' : ''}. One of them charges the wrong package: create a separate link in Stripe.`, label: (x) => `Label <b>${esc(x.a)}</b>${x.currency ? ' (' + esc(x.currency) + ')' : ''}: ${esc(x.hint || '')}.` };
  const probs = ck.problems.filter((x) => on.has(x.acc));
  return `<div class="card" id="pay-route"><h3 style="margin-top:0">🔗 Payment links used by the panel</h3>
    <p class="small muted">Package emails, WhatsApp messages and order links take their payment link only from the accounts ticked here. The link is matched to the package (months, credits, IBO devices) and the customer's currency. With rotation on, packages that have more than one link take turns.</p>
    <div style="margin:8px 0">${accs}</div>
    <div class="row">${toggle('Rotation between links', 'pr-rotate', ck.route.rotate)}<span class="spacer"></span>${canEdit ? '<button class="btn primary sm" data-act="pr-save">💾 Save</button>' : ''}</div>
    ${probs.length ? `<div class="notice warning" style="margin-top:10px"><b>⚠️ ${probs.length} link problem${probs.length === 1 ? '' : 's'} to fix in Stripe</b> (these links are skipped until fixed):<ul style="margin:6px 0 0 18px">${probs.map((x) => `<li>${esc(x.accName || x.acc)}: ${(kinds[x.kind] || ((y) => esc(y.kind)))(x)}</li>`).join('')}</ul></div>` : '<p class="small" style="color:var(--ok,#2a2)">✓ No link problems in the selected accounts.</p>'}
    <details style="margin-top:10px"><summary>Link for each package (${ck.rows.filter((r) => !r.links.length).length} without a link)</summary><div style="overflow:auto"><table class="table small"><thead><tr><th>Package</th><th>Currency</th><th>Payment link</th></tr></thead><tbody>${rows}</tbody></table></div></details></div>`;
}
Object.assign(actions, {
  'stock-filter': (el, e) => { e && e.preventDefault(); STOCKF.f = el.dataset.f; renderAdmin(); },
  'stock-pay': (el) => { const x = STOCKF.st.purchases.find((p) => p.id === el.dataset.id); if (!x) return; const s = state.admin.settings;
    const body = modal('💵 Pay the supplier', `<form data-form="stock-pay" data-id="${x.id}" onsubmit="return false"><p><b>${x.credits} credits</b> · ${esc(x.supplier)} · cost ${num(x.cost, x.currency)} · paid ${num(x.paid, x.currency)}</p>
      ${x.cost ? '' : field('Cost of this batch', 'cost', '', { type: 'number', attrs: 'step="any" min="0" required' })}
      ${field('Amount paid', 'amount', x.due || '', { type: 'number', attrs: 'step="any" min="0"', help: x.due ? `Owed: ${num(x.due, x.currency)}` : '' })}
      ${accountSelect(s, 'accountId', x.accountId || s.finance.accounts.find((a) => a.currency === x.currency)?.id || '', 'Paid from (bank / wallet)')}
      ${field('Date', 'date', isoDay(Date.now()), { type: 'date' })}
      <div class="row"><span class="spacer"></span><button class="btn primary" data-act="stock-pay-go">💵 Save payment</button></div></form>`);
    void body; },
  'stock-pay-go': async (el) => { const f = el.closest('form'); const o = formToObj(f); el.disabled = true;
    try { if (o.cost !== undefined) await api('PUT', '/api/admin/stock/' + f.dataset.id, { cost: o.cost }); await api('POST', `/api/admin/stock/${f.dataset.id}/pay`, o); toast('Payment saved ✓'); closeModal(); renderAdmin(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'stock-unpay': async (el, e) => { e && e.preventDefault(); if (!confirm('Undo this payment? The expense is removed from finance too.')) return;
    try { await api('DELETE', `/api/admin/stock/${el.dataset.id}/pay/${el.dataset.pay}`); toast('Payment undone'); renderAdmin(); } catch (err) { toast(err.message, true); } },
  'stock-edit': (el) => { const x = STOCKF.st.purchases.find((p) => p.id === el.dataset.id); if (!x) return; const names = STOCKF.team.includes(x.handedTo) || !x.handedTo ? STOCKF.team : [x.handedTo, ...STOCKF.team];
    modal('✏️ Credit batch', `<form data-form="stock-edit" data-id="${x.id}" onsubmit="return false"><p>${x.credits} credits · ${fmtDate(x.at)} ${payBadge(x)}</p>
      <div class="grid2">${field('Supplier', 'supplier', x.supplier)}${field('Cost', 'cost', x.cost, { type: 'number', attrs: 'step="any" min="0"', help: 'In ' + x.currency })}</div>
      ${field('Hand over to (agent)', 'handedTo', x.handedTo || '', { type: 'select', options: [['', '— nobody —'], ...names.map((n) => [n, n])] })}
      ${!x.payments.length ? field('Status', 'payStatus', x.payStatus === 'unpaid' ? 'unpaid' : 'nocost', { type: 'select', options: [['unpaid', '✗ Not paid'], ['nocost', 'No cost / free']] }) : ''}
      ${field('Note', 'note', x.note || '')}
      <div class="row"><span class="spacer"></span><button class="btn primary" data-act="stock-edit-go">💾 Save</button></div></form>`); },
  'stock-edit-go': async (el) => { const f = el.closest('form'); el.disabled = true; try { await api('PUT', '/api/admin/stock/' + f.dataset.id, formToObj(f)); toast(t('saved')); closeModal(); renderAdmin(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'ibo-auto-save': async () => { const f = $('[data-form=ibo-auto]'); const o = { on: f.on.checked, email: f.email.checked, whatsapp: f.whatsapp.checked, price: Number(f.price.value) || 5.99, everyDays: Number(f.everyDays.value) || 30 };
    try { await saveSettings({ iboPromo: o }); toast('IBO Player offer saved ✓'); } catch (e) { toast(e.message, true); } },
  'pr-save': async () => { const box = $('#pay-route'); const accounts = [...box.querySelectorAll('input[name=pr-acc]:checked')].map((x) => x.value); if (!accounts.length) return toast('Tick at least one account.', true);
    const rot = box.querySelector('[name=pr-rotate]'); try { await saveSettings({ payRoute: { accounts, rotate: !!(rot && rot.checked) } }); toast('Payment link routing saved ✓'); renderAdmin(); } catch (e) { toast(e.message, true); } },
});
async function adminStripePage(s) {
  const finAcc = (s.finance && s.finance.accounts) || [];
  const list = s.stripeAccounts || []; const links = list.flatMap((a) => a.links || []);
  const byTier = (t) => links.filter((l) => l.tier === t).length;
  const active = list.filter((a) => a.status === 'active').length;
  const two = list.filter((a) => Number(a.payoutDays) === 2).length;
  // Balances are taken from sales recorded in the app, not from the stored/legacy values
  const rev = await api('GET', '/api/admin/stripe/revenue').catch(() => null);
  const bySa = Object.fromEntries((rev?.stripeAccounts || []).map((x) => [x.accountId, x]));
  let totUsd = 0, nSa = 0, nSales = 0;
  (list || []).forEach((a) => { const r = bySa[a.id]; if (r) { totUsd += Number(r.usd || 0); nSales += Number(r.n || 0); } if (Number(a.balance)) nSa++; });
  return `<p class="small muted">All your Stripe accounts in one place. Track <b>status</b> (Active / Verification / Closed), the <b>payout schedule</b> and your <b>package payment links</b> in USD and EUR. Links you add here are what you can put in package emails and IBO activations — deleting a link here does not remove it from Stripe.</p>
    <div class="chips" style="margin-bottom:12px"><a class="on">${list.length} account${list.length === 1 ? '' : 's'} · ${active} active</a><a class="on">${two} with 2-day payout · ${list.length - two} with 7-day payout</a><a class="on">${links.length} link${links.length === 1 ? '' : 's'} — Normal ${byTier('Normal')} · Resellers ${byTier('Resellers')} · IBO ${byTier('IBO')}</a></div>
    ${await payRouteCard(s)}
    <div class="card" id="sa-compare"><div class="row"><h3 style="margin:0">⚔ Account performance</h3><span class="spacer"></span><button class="btn sm" data-act="sa-compare">↻ Refresh</button></div><div id="sa-compare-body" class="small muted" style="margin-top:10px">Loading comparison…</div></div>
    <div id="sa-all-bal" class="small muted" style="margin-bottom:10px">Sales recorded in app across your Stripe accounts: <b>$${totUsd.toFixed(2)}</b> · ${nSales} sale(s).${rev && rev.unattributedN ? ` ${rev.unattributedN} legacy sale(s) have no Stripe account — they settle through banks and cannot be split between accounts.` : ''}</div>
    <div id="sa-list">${list.map((a) => saRow(a, finAcc, bySa[a.id])).join('')}</div>
    <div class="row" style="margin-top:6px"><button class="btn" data-act="sa-add">＋ Add account</button><button class="btn" data-act="sa-balance-all">💰 All balances (total)</button><span class="spacer"></span><button class="btn primary" data-act="sa-save">💾 Save accounts</button></div>`;
}
Object.assign(actions, {
  'sa-add': () => $('#sa-list').insertAdjacentHTML('beforeend', saRow({ id: '', currency: 'USD', status: 'active', payoutDays: 7, note: '', rk: '', links: [] }, (state.admin.settings && state.admin.settings.finance && state.admin.settings.finance.accounts) || [])),
  'sa-del': (el) => el.closest('.op-row').remove(),
  'sa-add-link': (el) => el.closest('.op-row').querySelector('.sa-links').insertAdjacentHTML('beforeend', saLinkRow()),
  'sa-del-link': (el) => el.closest('.sa-link').remove(),
  'sa-compare': async () => {
    const box = $('#sa-compare-body'); if (!box) return;
    box.textContent = 'Loading comparison…';
    const [r, settings] = await Promise.all([api('GET', '/api/admin/stripe/revenue').catch(() => null), api('GET', '/api/admin/settings').catch(() => null)]);
    if (!r || !settings) { box.textContent = 'No revenue data yet.'; return; }
    const stripe = settings.stripeAccounts || [];
    const byFin = {}; for (const x of r.revenue) byFin[x.accountId] = x;
    const zero = { usd: 0, usd30d: 0, n: 0, n30d: 0 };
    const revOf = (a) => (a.bankId && byFin[a.bankId]) || zero;
    const cash = (a, v) => `${a.cur === 'EUR' ? '\u20ac' : '$'}${Number(v || 0).toFixed(2)}`;
    const totals = stripe.map((a) => ({ name: a.name || a.id, bal: Number(a.balance || 0), cur: a.currency || 'USD', days: Number(a.payoutDays) === 2 ? 2 : 7, rev: revOf(a) }));
    const balMax = Math.max(1, ...totals.map((t) => t.bal));
    const sorted = [...totals].sort((a, b) => b.bal - a.bal);
    box.innerHTML = `<div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:10px">${totals.map((t) => `<div class="stat"><span>${esc(t.name)}</span><b>${cash(t, t.bal)}</b><span>${t.days}-day payout · 30d ${t.rev.n30d} sale${t.rev.n30d === 1 ? '' : 's'}</span></div>`).join('')}</div>
      <div class="hbars2">${sorted.map((t) => `<div><span>${esc(t.name)}</span><div class="hbar2" title="${esc(t.name)}: ${cash(t, t.bal)} stored · ${t.days}-day payout"><i style="width:${Math.round((t.bal / balMax) * 100)}%"></i></div><span class="small muted">${cash(t, t.bal)} · ${t.days}-day payout</span></div>`).join('')}</div>
      <p class="small muted" style="margin:10px 0 0">💰 Largest balance: <b>${esc((sorted[0] || {}).name || '—')}</b> — ${cash(sorted[0] || { cur: 'USD' }, (sorted[0] || {}).bal)}</p>
      <p class="small muted" style="margin:6px 0 0">Stored balances update with 💰 per account or “💰 All balances (total)”. Income booked through an account is added to the bank it settles to first.</p>`;
  },
  'sa-save': async () => {
    const stripeAccounts = [...document.querySelectorAll('#sa-list .op-row')].map((r) => {
      const g = (k) => (r.querySelector(`[data-k=${k}]`) || {}).value || '';
      const bTxt = g('balance').trim();
      return { id: r.dataset.sa || undefined, name: g('name').trim(), currency: g('currency'), status: g('status'), payoutDays: Number(g('payoutDays')) || 7, note: g('note'), rk: g('rk'), bankId: g('bankId') || undefined,
        balance: bTxt === '' ? null : Number(bTxt),
        balanceAt: bTxt === '' ? 0 : Date.now(),
        links: [...r.querySelectorAll('.sa-link')].map((l) => { const h = (k) => (l.querySelector(`[data-k=${k}]`) || {}).value.trim(); return { id: l.dataset.link || undefined, label: h('label'), url: h('url'), currency: h('currency'), tier: h('tier') }; }).filter((l) => l.url) };
    }).filter((a) => a.name);
    try { await api('PUT', '/api/admin/settings', { stripeAccounts }); toast('Saved ✓'); renderAdmin(); } catch (e) { toast(e.message, true); }
  },
  'sa-balance': async (el) => {
    el.disabled = true; const card = el.closest('.op-row'); const out = card.querySelector('.sa-bal'); out.textContent = 'Checking with Stripe…';
    try {
      const r = await api('GET', `/api/admin/stripe/account/${encodeURIComponent(el.dataset.id)}/balance`);
      out.textContent = r.connected ? `Available now: ${r.available} ${r.currency} · Pending: ${r.pending} ${r.currency} · lands ≈ ${r.projected || '—'} (${r.payoutDays || 7}-day payout)` : (r.error || 'Stripe not reached');
      if (r.connected) {
        card.querySelector('[data-k="balance"]').value = String(r.available);
        card.querySelector('[data-k="balanceAt"]').value = String(Date.now());
        await persistStripeAccountsFromTable();
        toast('Balance saved ✓');
      }
    } catch (e) { out.textContent = e.message; }
    el.disabled = false;
  },
  'sa-balance-all': async (el) => {
    el.disabled = true; const out = $('#sa-all-bal'); if (out) out.textContent = 'Checking…';
    let totUsd = 0, totEur = 0, okCount = 0, fail = 0;
    for (const card of $('#sa-list').querySelectorAll('.op-row')) {
      const id = card.dataset.sa; const out = card.querySelector('.sa-bal'); if (!id) continue;
      const bTxt = (card.querySelector('[data-k="balance"]') || {}).value || '';
      if (bTxt.trim() !== '') { const n = Number(bTxt) || 0; const cur = (card.querySelector('[data-k="currency"]') || {}).value || 'USD'; if (cur === 'EUR') totEur += n; else totUsd += n; okCount++; out.textContent = `Stored: Available ${n} ${cur}`; continue; }
      try { const r = await api('GET', `/api/admin/stripe/account/${encodeURIComponent(id)}/balance`); if (r.connected) { out.textContent = `Available now: ${r.available} ${r.currency} · Pending: ${r.pending} ${r.currency} · lands ≈ ${r.projected || '—'} (${r.payoutDays || 7}d)`; if (r.currency === 'EUR') totEur += Number(r.available) || 0; else totUsd += Number(r.available) || 0; okCount++; card.querySelector('[data-k="balance"]').value = String(r.available); card.querySelector('[data-k="balanceAt"]').value = String(Date.now()); } else { out.textContent = r.error || 'Stripe not reached'; fail++; } } catch (e) { out.textContent = e.message; fail++; }
    }
    await persistStripeAccountsFromTable(true);
    if (out) out.textContent = `All accounts (${okCount} ok${fail ? `, ${fail} skipped/failed` : ''}): Available ${totUsd.toFixed(2)} · €${totEur.toFixed(2)}`;
    el.disabled = false;
  },
  'sa-edit-balance': async (el) => {
    const card = el.closest('.op-row');
    const name = card.querySelector('[data-k="name"]').value;
    const cur = card.querySelector('[data-k="currency"]').value;
    const curBal = card.querySelector('[data-k="balance"]').value || '';
    const m = modal(`✏️ Edit balance — ${esc(name)}`, `<form data-form="sa-balance-edit" data-id="${esc(el.dataset.id)}">
      <div class="grid2">${field('Currency', 'currency', cur, { type: 'select', options: [['USD', 'USD ($)'], ['EUR', 'EUR (€)']] })}${field('New balance', 'balance', curBal, { type: 'number', step: 'any', attrs: 'required min="0"', placeholder: 'e.g. 102.52' })}</div>
      <p class="small muted">Enter the balance to store locally. This does not contact Stripe.</p>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">💾 Save balance</button></div>
    </form>`);
  },
});

// ---------------- CC Collection — owner only (spec §5) ----------------
async function adminCcPage() {
  const r = await api('GET', '/api/admin/cc'); const list = r.list || [];
  const last4 = (n) => { const s = String(n || ''); return s.length >= 4 ? '•••• ' + s.slice(-4) : '••••'; };
  const exp = (e) => { const s = String(e || '').replace(/\D/g, ''); if (s.length >= 4) return s.slice(0, 2) + '/' + s.slice(-2); return s; };
  const rows = list.map((x) => { const id = esc(x.id); return `<tr><td class="small">${fmtDT(x.at)}</td><td><b>${esc(x.fullName)}</b><div class="small muted">${esc(x.email || '')}${x.phone ? ' · ' + esc(x.phone) : ''}${x.address ? ' · ' + esc(x.address) : ''}</div>${x.notes ? '<div class="small muted" style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(x.notes || '') + '">📝 ' + esc(x.notes) + '</div>' : ''}</td><td class="small">${last4(x.cardNumber)}</td><td class="small">${esc(exp(x.exp))}</td><td class="small">•••</td><td><span class="pill ${x.status === 'live' ? 'st-active' : 'st-expired'}">${esc((x.status || 'dead').toUpperCase())}</span></td><td><button class="btn sm" data-act="cc-edit" data-id="${id}" title="Edit card" aria-label="Edit card">✏️</button> <button class="btn sm danger" data-act="cc-del" data-id="${id}" title="Delete card" aria-label="Delete card">🗑</button></td></tr>` }).join('');
  return `<p class="small muted">Owner-only. Every CC collection with full card details and card status.</p>
  <div class="chips" style="margin-bottom:14px"><a class="on">Live ${r.liveCount || 0}</a><a class="on">Declined ${r.declinedCount || 0}</a><a class="on">Dead ${r.deadCount || 0}</a></div>
  <form data-form="cc-add" class="card"><h3>＋ Log a collection</h3>
    ${field('Full Name', 'fullName', '', { attrs: 'required maxlength="120"' })}
    <div class="grid2">${field('Email', 'email', '', { type: 'email' })}${field('Phone Number', 'phone', '', { type: 'tel' })}</div>
    ${field('Address', 'address', '', { attrs: 'maxlength="300"' })}
    ${field('Card Number (16 Digits)', 'cardNumber', '', { inputmode: 'numeric', attrs: 'required maxlength="19" placeholder="0000000000000000"' })}
    <div class="grid3">${field('Expiration Date (MM/YY)', 'exp', '', { attrs: 'required maxlength="5" placeholder="MM/YY" inputmode="numeric"' })}${field('CVV', 'cvv', '', { type: 'password', attrs: 'required maxlength="4" inputmode="numeric"' })}${field('Card Status', 'status', 'live', { type: 'select', options: [['live', 'Live'], ['declined', 'Declined'], ['dead', 'Dead']] })}</div>
    ${field('Notes (optional)', 'notes', '', { type: 'textarea', rows: 2, ph: 'Reference, exchanger, anything useful…' })}
    <button type="submit" class="btn primary">Save entry</button>
  </form>
  ${list.length ? `<div class="card" style="margin-top:14px"><h3>Log <span class="small muted">(${list.length})</span></h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Cardholder</th><th>Card</th><th>EXP</th><th>CVV</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>` : ''}`;
}
Object.assign(actions, {

  'panel-test': async (el) => {
    const card = el.closest('div');
    const baseUrl = (card.querySelector('[name="panel.' + el.dataset.panel + '.baseUrl"]') || {}).value || '';
    const apiKey = (card.querySelector('[name="panel.' + el.dataset.panel + '.apiKey"]') || {}).value || '';
    const username = (card.querySelector('[name="panel.' + el.dataset.panel + '.username"]') || {}).value || '';
    const password = (card.querySelector('[name="panel.' + el.dataset.panel + '.password"]') || {}).value || '';
    const out = document.getElementById('panel-test-' + el.dataset.panel);
    el.disabled = true; el.textContent = 'Testing…';
    try {
      const r = await api('POST', '/api/admin/panels/test', { type: el.dataset.panel, baseUrl, apiKey, username, password });
      out.textContent = r.ok ? '✅ Panel reachable' : '❌ ' + (r.error || ('HTTP ' + r.status));
      out.style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
    } catch (e) { out.textContent = '❌ ' + e.message; out.style.color = 'var(--bad)'; }
    el.textContent = 'Test connection'; el.disabled = false;
  },

  'cc-del': async (el) => { if (!confirm('Delete this CC collection entry?')) return; el.disabled = true; try { await api('DELETE', '/api/admin/cc/' + el.dataset.id); $('#admin-body').innerHTML = await adminCcPage(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'cc-edit': async (el) => {
    const r = await api('GET', '/api/admin/cc'); const rec = (r.list || []).find((x) => x.id === el.dataset.id);
    if (!rec) return toast('Record not found', true);
    const m = modal('✏️ Edit CC entry — Owner only', `<form data-form="cc-edit" data-id="${esc(rec.id)}" class="grid2">
      <div class="grid2 full">${field('Full Name', 'fullName', rec.fullName || '', { attrs: 'required maxlength="80"' })}</div>
      <div>${field('Email', 'email', rec.email || '', { type: 'email' })}</div>
      <div>${field('Phone Number', 'phone', rec.phone || '', { type: 'tel' })}</div>
      <div class="grid2 full">${field('Address', 'address', rec.address || '', { attrs: 'maxlength="300"' })}</div>
      <div class="grid2 full">${field('Card Number (16 Digits)', 'cardNumber', rec.cardNumber || '', { inputmode: 'numeric', attrs: 'required maxlength="19" placeholder="0000000000000000"' })}</div>
      <div>${field('Expiration Date (MM/YY)', 'exp', (rec.exp ? rec.exp.slice(0,2)+'/'+rec.exp.slice(2) : ''), { attrs: 'required maxlength="5" placeholder="MM/YY" inputmode="numeric"' })}</div>
      <div>${field('CVV', 'cvv', rec.cvv || '', { type: 'password', attrs: 'required maxlength="4" inputmode="numeric"' })}</div>
      <div class="grid2 full">${field('Card Status', 'status', rec.status || 'live', { type: 'select', options: [['live','Live'],['declined','Declined'],['dead','Dead']] })}</div>
      <div class="grid2 full">${field('Notes (optional)', 'notes', rec.notes || '', { type: 'textarea', rows: 2, ph: 'Reference, exchanger, anything useful…' })}</div>
      <div class="row full" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">💾 Save changes</button></div>
    </form>`);
  },
});
Object.assign(forms, {
  async 'cc-add'(f) { try { await api('POST', '/api/admin/cc', formToObj(f)); toast('Saved ✓'); f.reset(); $('#admin-body').innerHTML = await adminCcPage(); } catch (e) { toast(e.message, true); } },
  async 'cc-edit'(f) {
    const id = f.dataset.id;
    const body = { fullName: f.fullName.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim(), cardNumber: f.cardNumber.value.replace(/\D/g, '').slice(0, 16), exp: f.exp.value.replace(/[^0-9]/g, '').slice(0, 6), cvv: f.cvv.value.replace(/\D/g, '').slice(0, 4), notes: f.notes.value.trim(), status: ['live', 'declined', 'dead'].includes(f.status.value) ? f.status.value : 'live' };
    try { await api('PUT', '/api/admin/cc/' + id, body); closeModal(); toast('CC entry updated ✓'); $('#admin-body').innerHTML = await adminCcPage(); } catch (e) { toast(e.message, true); }
  },
  async 'sa-balance-edit'(f) {
    const id = f.dataset.id;
    const card = $(`#sa-list .op-row[data-sa="${id}"]`);
    if (!card) return toast('Account not found', true);
    const balance = Number(f.balance.value);
    const currency = f.currency.value;
    const balanceInput = card.querySelector('[data-k="balance"]');
    const balanceAtInput = card.querySelector('[data-k="balanceAt"]');
    const display = card.querySelector('.sa-balance-display');
    if (balanceInput) balanceInput.value = String(balance);
    if (balanceAtInput) balanceAtInput.value = String(Date.now());
    if (display) display.innerHTML = `<b>${currency === 'EUR' ? '€' : '$'}${balance.toFixed(2)}</b> <span class="small muted">(${fmtDT(Date.now())})</span>`;
    await persistStripeAccountsFromTable();
    closeModal();
    toast('Balance updated ✓');
  },
});

// ---------------- all-agents trial queue & disputes (spec §4, §5) ----------------
async function adminTrialQueue() {
  const r = await api('GET', '/api/admin/trialq'); const list = (r.list || []).slice(0, 200); state.admin.trialq = list;
  const ui = (state.admin.tq ||= { f: 'pending' });
  const cnt = (f) => list.filter((x) => x.status === f).length;
  const shown = list.filter((x) => ui.f === 'all' || x.status === ui.f);
  const _r = state.admin.settings?.reseller || {};
  const warn = _r.enabled && !_r.baseUrl ? `<div class="notice warning" role="alert" style="margin:0 0 12px"><b>⚠️ Provisioning is offline.</b> The reseller panel API base URL is empty — new free trials cannot create lines, they only queue here. Set it in <b>⚙️ Settings → API → TVplus reseller API → API base URL</b> (and the API key), save, then ask a customer (or yourself) to retry. Current mode: <b>${esc((state.admin.settings?.trial || {}).mode || 'auto')}</b>.</div>` : '';
  return `${warn}<div class="row" style="margin:0 0 10px"><button class="btn primary" data-act="trial-add">🎁 New free-trial dispatch</button><span class="small muted">Paste the M3U link from your panel — Username, Password, DNS fill in automatically and sync to the customer’s My Details.</span></div><p class="small muted">When “<b>All agents queue</b>” is on (Trial &amp; email setup), a customer who taps <b>Start free trial</b> on the website appears here instead of being auto-activated. Any team member with customer access can claim one, paste the M3U line from your panel and send the trial.</p>
    <div class="chips">${[['pending', 'Pending'], ['done', 'Sent'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, n]) => `<a class="${ui.f === k ? 'on' : ''}" data-act="tq-f" data-f="${k}">${n} · ${k === 'all' ? list.length : cnt(k)}</a>`).join('')}</div>
    ${shown.length ? shown.map((t) => `<div class="card"><div class="row"><div class="avatar">${esc(initials(t.name))}</div><div style="flex:1;min-width:180px"><b>${esc(t.name)}</b> ${t.status === 'pending' ? (t.claimedBy ? `<span class="pill st-expiring">claimed · ${esc(t.claimedBy)}</span>` : '<span class="pill st-open">waiting</span>') : `<span class="pill st-active">${esc(t.status)}</span>`}<div class="small muted">${esc(t.email)}${t.phone ? ' · ' + esc(t.phone) : ''}${t.telegram ? ' · ✈️ @' + esc(String(t.telegram).replace(/^@/, '')) : ''} · ${fmtDT(t.at)}${t.lang ? ' · ' + esc(t.lang.toUpperCase()) : ''}</div></div></div>
      ${t.status === 'pending' ? `<form data-form="tq-send" data-id="${esc(t.id)}" style="margin-top:10px">${field('M3U line from your panel', 'm3u', '', { ph: 'http://your-dns.com:8080/get.php?username=…&password=…&type=m3u_plus', attrs: 'required autocapitalize="none" spellcheck="false" dir="ltr"', help: 'Username, password and DNS are read from the link automatically.' })}<div class="row"><button type="button" class="btn" data-act="tq-claim" data-id="${esc(t.id)}">${t.claimedBy ? 'Re-claim' : '✋ Claim for me'}</button><button type="button" class="btn danger" data-act="tq-reject" data-id="${esc(t.id)}">Reject</button><button type="submit" class="btn primary">Send trial</button></div></form>` : `<p class="small muted" style="margin:10px 0 0">${esc(t.handledBy || '')}${t.doneAt ? ' · ' + fmtDT(t.doneAt) : ''}${t.note ? ' · ' + esc(t.note) : ''}</p>`}</div>`).join('') : `<div class="empty"><span class="ic">⚡</span>${list.length ? 'Nothing in this list.' : 'No trial requests yet. They arrive when customers tap “Start free trial” on the website.'}</div>`}`;
}
const DISP_KIND = { payment: ['💳', 'st-expiring'], service: ['🛠', 'st-open'], dispute: ['⚠️', 'st-expired'], bug: ['🐞', 'st-open'], other: ['❔', 'st-open'] };
async function adminDisputes() {
  const r = await api('GET', '/api/admin/disputes'); const list = r.list || []; state.admin.disputes = list;
  const ui = (state.admin.disUi ||= { f: 'open' });
  const cnt = (f) => list.filter((x) => x.status === f).length;
  const shown = list.filter((x) => ui.f === 'all' || (ui.f === 'open' ? x.status !== 'resolved' : x.status === ui.f));
  const attHtml = (x) => x.att ? `<button class="btn sm" data-act="att-show" data-src="/api/admin/disputes/att?id=${encodeURIComponent(x.att)}">📎 Picture</button>` : '';
  return `<p class="small muted">Every dispute and problem report lands here, from the flagged customers, unpaid issues, service complaints and panel bugs. Anyone on the team can <b>Report a problem</b> from the top bar (🐞). Reports and disputes are emailed when they arrive.</p>
    <div class="row" style="margin-bottom:10px"><button class="btn primary" data-act="report-problem">🐞 Report a problem</button><span class="spacer"></span><div class="chips">${[['open', 'Open · ' + list.filter((x) => x.status !== 'resolved').length], ['in_progress', 'In progress · ' + cnt('in_progress')], ['resolved', 'Resolved · ' + cnt('resolved')], ['all', 'All · ' + list.length]].map(([k, n]) => `<a class="${ui.f === k ? 'on' : ''}" data-act="dis-f" data-f="${k}">${n}</a>`).join('')}</div></div>
    ${shown.length ? shown.map((d) => `<div class="card"><div class="row"><div class="avatar">${DISP_KIND[d.kind]?.[0] || '❔'}</div><div style="flex:1;min-width:180px"><b>${esc(d.subject)}</b> <span class="pill ${DISP_KIND[d.kind]?.[1] || 'st-open'}">${esc(d.kind)}</span>${d.priority === 'high' ? '<span class="pill st-expired" title="High priority">high</span>' : ''}${d.status === 'in_progress' ? '<span class="pill st-expiring">in progress</span>' : ''}<div class="small muted">${d.username ? esc(d.name || d.username) + ' (' + esc(d.username) + ') · ' : ''}${fmtDT(d.createdAt)} · by ${esc(d.createdBy || 'unknown')}${d.orderNo ? ' · order ' + esc(d.orderNo) : ''}</div></div>
        ${d.status !== 'resolved' ? `<div class="row"><button class="btn sm" data-act="dis-start" data-id="${esc(d.id)}"${d.status === 'in_progress' ? ' disabled' : ''}>${d.status === 'in_progress' ? 'In progress' : '▶ In progress'}</button><button class="btn sm primary" data-act="dis-resolve" data-id="${esc(d.id)}">✓ Resolve</button></div>` : `<span class="small muted">resolved${d.resolvedBy ? ' by ' + esc(d.resolvedBy) : ''}${d.resolvedAt ? ' · ' + fmtDT(d.resolvedAt) : ''}</span>`}</div>
      ${d.details ? `<p class="small" style="white-space:pre-wrap;margin:10px 0 6px">${esc(d.details)}</p>` : ''}
      <div class="row">${attHtml(d)}${d.resolution ? `<span class="small muted">Resolution: ${esc(d.resolution)}</span>` : ''}${(d.notes || []).length ? `<button class="btn sm" data-act="dis-note" data-id="${esc(d.id)}">💬 Note (${d.notes.length})</button>` : `<button class="btn sm" data-act="dis-note" data-id="${esc(d.id)}">＋ Note</button>`}</div></div>`).join('') : `<div class="empty"><span class="ic">⚠️</span>${list.length ? 'Nothing in this list.' : 'No disputes or problem reports yet. 🎉'}</div>`}`;
}
// new dispute / report a problem (any staff can file one)
const reportForm = (kind) => `<form data-form="report-problem" data-kind="${esc(kind || 'bug')}"><div class="grid2">${field('Kind', 'kind', kind || 'bug', { type: 'select', options: [['bug', '🐞 Panel / app bug'], ['payment', '💳 Payment issue'], ['service', '🛠 Service issue'], ['dispute', '⚠️ Customer dispute'], ['other', '❔ Other']] })}${field('Priority', 'priority', 'normal', { type: 'select', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']] })}</div>
  ${field('Title', 'subject', '', { attrs: 'required maxlength="160"', ph: 'Short summary' })}
  ${field('Details', 'details', '', { type: 'textarea', rows: 4, attrs: 'maxlength="4000"', ph: 'What happened? Steps to reproduce, error codes, customer name…' })}
  <label class="field"><span>Picture (optional)</span><input type="file" name="image" accept="image/*"></label>
  <p class="small muted">Sends to the Owner and Technical Manager immediately.</p>
  <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Send report</button></div></form>`;

const trialDispatchForm = () => `<form data-form="trial-add">
  ${field('Customer', 'customerId', '', { type: 'select', options: [['', '— new trial customer —'], ...(state.admin.customers || []).map((c) => [c.id, `${c.name || c.username} (${c.username})`])], help: 'Pick a customer to sync the line into their My Details, or keep “new trial customer”.' })}
  ${field('M3U link from your panel', 'm3u', '', { ph: 'http://your-dns.com:8080/get.php?username=…&password=…&type=m3u_plus', attrs: 'required data-m3ufill="1" autocapitalize="none" spellcheck="false" dir="ltr"', help: 'Paste the full M3U link — Username, Password and DNS fill in automatically.' })}
  <div class="grid2">${field('Username', 'username', '', { attrs: 'required autocapitalize="none" autocomplete="off" dir="ltr"' })}${field('Password', 'password', '', { type: 'password', attrs: 'required autocomplete="off" dir="ltr"' })}</div>
  ${field('DNS', 'dns', '', { ph: 'http://your-dns.com:8080', attrs: 'required inputmode="url" autocapitalize="none" dir="ltr"' })}
  <div class="grid2">${field('New customer name', 'fullname', '', { ph: 'Only when no customer is picked' })}${field('Email', 'email', '', { type: 'email', ph: 'name@example.com' })}</div>
  <div class="grid2">${phoneField('Phone / WhatsApp', 'phone', false)}${field('Telegram @username', 'telegram', '', { ph: '@username' })}</div>
  ${field('IBO Player activation details (optional)', 'ibo', '', { type: 'textarea', rows: 3, attrs: 'maxlength="1200"', ph: 'MAC / device key / activation instructions for IBO Player — leave empty to skip.' })}
  <p class="small muted">Dispatches Username / Password / DNS / M3U by Email and Telegram, gives you a one-tap WhatsApp message, and saves the same details under the customer’s <b>My Details</b>.</p>
  <div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Send free trial</button></div>
</form>`;

const paidLineForm = (id) => {
  const c = (state.admin.customers || []).find((x) => x.id === id) || {};
  const ibo = c.ibo || {};
  return `<form data-form="paid-line" data-id="${esc(id)}">
  <p class="small muted" style="margin-top:0">Paid account — save the line once and it appears under <b>My Details</b> on <b>intproto-tv.store/profile</b>. Free trials use the separate Trial queue.</p>
  ${field('M3U link from your panel', 'm3u', '', { ph: 'http://your-dns.com:8080/get.php?username=…&password=…&type=m3u_plus', attrs: 'data-m3ufill="1" autocapitalize="none" spellcheck="false" dir="ltr"', help: 'Paste it once — Username, Password and DNS fill in automatically. Leave every line field empty to update only the IBO Player device.' })}
  <div class="grid2">${field('Username', 'username', '', { attrs: 'autocapitalize="none" autocomplete="off" dir="ltr"' })}${field('Password', 'password', '', { type: 'password', attrs: 'autocomplete="off" dir="ltr"' })}</div>
  ${field('DNS', 'dns', '', { ph: 'http://your-dns.com:8080', attrs: 'inputmode="url" autocapitalize="none" dir="ltr"' })}
  <h4 style="margin:16px 0 4px">IBO Player activation <span class="small muted">(optional)</span></h4>
  <div class="grid2">${field('Device MAC Address', 'iboMac', ibo.mac || '', { ph: 'AA:BB:CC:DD:EE:FF', attrs: 'autocapitalize="characters" dir="ltr"' })}${field('Device Key', 'iboKey', ibo.key || '', { attrs: 'autocapitalize="none" spellcheck="false" dir="ltr"' })}</div>
  ${toggle('Email the updated details to the customer', 'sendEmail', true)}
  <div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Save to paid profile</button></div>
</form>`;
};
Object.assign(actions, {
  'trial-add': () => modal('🎁 Free trial details', trialDispatchForm()),
  'paid-line': (el) => modal('📺 Paid account — M3U / IBO Player', paidLineForm(el.dataset.id)),
  'tq-f': async (el) => { state.admin.tq.f = el.dataset.f; $('#admin-body').innerHTML = await adminTrialQueue(); },
  'dis-f': async (el) => { state.admin.disUi.f = el.dataset.f; $('#admin-body').innerHTML = await adminDisputes(); },
  'tq-claim': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/trialq/claim', { id: el.dataset.id }); $('#admin-body').innerHTML = await adminTrialQueue(); } catch (e) { toast(tErr(e.message), true); el.disabled = false; } },
  'tq-reject': (el) => { modal('Reject this trial request', `<form data-form="tq-reject" data-id="${esc(el.dataset.id)}">${field('Note (optional, internal)', 'note', '', { attrs: 'maxlength="500"' })}<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn danger">Reject request</button></div></form>`); },
  'report-problem': () => { modal('🐞 Report a problem', reportForm('bug'), { wide: true }); },
  'dis-start': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/disputes/update', { id: el.dataset.id, status: 'in_progress' }); $('#admin-body').innerHTML = await adminDisputes(); } catch (e) { toast(tErr(e.message), true); el.disabled = false; } },
  'dis-resolve': (el) => { const d = (state.admin.disputes || []).find((x) => x.id === el.dataset.id); modal('Resolve: ' + esc(d?.subject || ''), `<form data-form="dis-resolve" data-id="${esc(el.dataset.id)}">${field('Resolution', 'resolution', '', { type: 'textarea', rows: 3, attrs: 'maxlength="2000"', ph: 'What was the outcome?' })}<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">✓ Mark resolved</button></div></form>`); },
  'dis-note': (el) => { modal('Add a note', `<form data-form="dis-note" data-id="${esc(el.dataset.id)}">${field('Note', 'note', '', { type: 'textarea', rows: 3, attrs: 'maxlength="1000"', ph: 'Internal note — visible to the team only' })}<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Add note</button></div></form>`); },
});
Object.assign(forms, {
  async 'paid-line'(f) { const btn = f.querySelector('button[type=submit]'); btn.disabled = true; const id = f.dataset.id; try { const r = await api('POST', `/api/admin/customers/${id}/line`, { m3u: f.m3u.value.trim(), username: f.username.value.trim(), password: f.password.value, dns: f.dns.value.trim(), iboMac: f.iboMac.value.trim(), iboKey: f.iboKey.value.trim(), sendEmail: f.sendEmail ? f.sendEmail.checked : true }); closeModal(); const ibo = r.ibo || {}; const iboRows = `${ibo.mac ? `<li><span class="cred-k">Device MAC Address</span><b class="cred-v" dir="ltr">${esc(ibo.mac)}</b></li>` : ''}${ibo.key ? `<li><span class="cred-k">Device Key</span><b class="cred-v" dir="ltr" style="word-break:break-all">${esc(ibo.key)}</b></li>` : ''}`; const msg = r.iobOnly ? `IBO Player device saved\n\nDevice MAC Address: ${ibo.mac || '—'}\nDevice Key: ${ibo.key || '—'}` : `Your subscription details\n\nUsername: ${r.username}\nPassword: ${r.password}\nDNS: ${r.dns || '—'}\nM3U: ${r.m3u || '—'}${ibo.mac ? `\n\nIBO Player\nDevice MAC Address: ${ibo.mac}\nDevice Key: ${ibo.key || '—'}` : ''}`; const waDigits = String(r.whatsapp || r.phone || '').replace(/\D/g, ''); const tgUser = String(r.telegram || '').replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, ''); const waHref = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(msg)}` : ''; const tgHref = tgUser ? `https://t.me/${tgUser}` : ''; modal('Saved to the paid profile ✓', `<div class="notice success"><p style="margin:0 0 8px"><b>${esc(r.name || r.loginUsername || '')}</b> — synced to <b>intproto-tv.store/profile → My Details</b>${r.iobOnly ? ' (IBO Player device only)' : r.emailSent ? ' · email sent ✓' : ' · email not sent'}${r.telegramSent ? ' · Telegram sent ✓' : ''}.</p><ul class="cred-list"><li><span class="cred-k">Username</span><b class="cred-v" dir="ltr">${esc(r.username || '—')}</b></li><li><span class="cred-k">Password</span><b class="cred-v" dir="ltr">${esc(r.password || '—')}</b></li><li><span class="cred-k">DNS</span><b class="cred-v" dir="ltr">${esc(r.dns || '—')}</b></li><li><span class="cred-k">M3U</span><b class="cred-v" dir="ltr" style="word-break:break-all">${esc(r.m3u || '—')}</b></li>${iboRows}</ul></div><div class="row" style="margin-top:10px"><button class="btn" data-act="copy-el" data-el="pl-creds" style="flex:1">📋 Copy</button>${waHref ? `<a class="btn wa-btn" style="flex:1" target="_blank" rel="noopener" href="${esc(waHref)}">💬 WhatsApp</a>` : ''}${tgHref ? `<a class="btn" style="flex:1" target="_blank" rel="noopener" href="${esc(tgHref)}">✈️ Telegram</a>` : ''}</div><div id="pl-creds" style="display:none">${esc(msg)}</div><button class="btn block" data-act="close-modal" style="margin-top:10px">OK</button>`); try { state.admin.customers = await api('GET', '/api/admin/customers'); } catch {} const body = $('#admin-body'); if (body && state.admin.profileId === id) body.innerHTML = adminCustomerProfile((state.admin.customers || []).find((x) => x.id === id)) || adminCustomers(); } catch (e) { btn.disabled = false; toast(tErr(e.message), true); } },
  async 'trial-add'(f) { const phone = f.phone && f.phone.value.trim() ? fullPhone(f, 'phone') : ''; if (f.phone && f.phone.value.trim() && !phone) return toast('Phone / WhatsApp: choose the country code and enter the full number.', true); const btn = f.querySelector('button[type=submit]'); btn.disabled = true; try { const r = await api('POST', '/api/admin/trialq/direct', { customerId: f.customerId.value, username: f.username.value.trim(), password: f.password.value, dns: f.dns.value.trim(), m3u: f.m3u.value.trim(), name: f.fullname ? f.fullname.value.trim() : '', email: f.email ? f.email.value.trim() : '', phone, telegram: f.telegram ? f.telegram.value.trim() : '', ibo: f.ibo ? f.ibo.value.trim() : '' }); closeModal(); const msg = `Your free trial is ready 🎉\n\nUsername: ${r.username}\nPassword: ${r.password}\nDNS: ${r.dns}\nM3U: ${r.m3u}`; const waDigits = String(r.whatsapp || r.phone || '').replace(/\D/g, ''); const tgUser = String(r.telegram || '').replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, ''); const waHref = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(msg)}` : ''; const tgHref = tgUser ? `https://t.me/${tgUser}` : ''; modal('Trial sent ✓', `<div class="notice success"><p style="margin:0 0 8px"><b>${esc(r.name || r.username)}</b> — saved to <b>My Details</b>${r.emailSent ? ' · email sent ✓' : ' · email not sent'}${r.telegramSent ? ' · Telegram sent ✓' : ''}.</p><ul class="cred-list"><li><span class="cred-k">Username</span><b class="cred-v" dir="ltr">${esc(r.username)}</b></li><li><span class="cred-k">Password</span><b class="cred-v" dir="ltr">${esc(r.password)}</b></li><li><span class="cred-k">DNS</span><b class="cred-v" dir="ltr">${esc(r.dns || '—')}</b></li><li><span class="cred-k">M3U</span><b class="cred-v" dir="ltr" style="word-break:break-all">${esc(r.m3u || '—')}</b></li></ul>${r.telegramSent ? '' : state.config.telegram?.link ? `<p class="small muted" style="margin:6px 0 0">Telegram not linked — send the bot link: <a href="${esc(state.config.telegram.link)}" target="_blank" rel="noopener">${esc(state.config.telegram.link)}</a></p>` : ''}</div><div class="row" style="margin-top:10px"><button class="btn" data-act="copy-el" data-el="tq-creds" style="flex:1">📋 Copy</button>${waHref ? `<a class="btn wa-btn" style="flex:1" target="_blank" rel="noopener" href="${esc(waHref)}">💬 WhatsApp</a>` : `<span class="btn" style="flex:1;opacity:.45" title="No WhatsApp number">💬 WhatsApp</span>`}${tgHref ? `<a class="btn" style="flex:1" target="_blank" rel="noopener" href="${esc(tgHref)}">✈️ Telegram</a>` : `<span class="btn" style="flex:1;opacity:.45" title="No Telegram username">✈️ Telegram</span>`}</div><div id="tq-creds" style="display:none">${esc(msg)}</div><button class="btn block" data-act="close-modal" style="margin-top:10px">OK</button>`); $('#admin-body').innerHTML = await adminTrialQueue(); } catch (e) { btn.disabled = false; toast(tErr(e.message), true); } },
  async 'tq-send'(f) { const btn = f.querySelector('button[type=submit]'); btn.disabled = true; try { const r = await api('POST', '/api/admin/trialq/send', { id: f.dataset.id, m3u: f.m3u.value.trim() }); closeModal(); const msg = `Your free trial is ready 🎉\n\nUsername: ${r.username}\nPassword: ${r.password}\nDNS: ${r.dns || '—'}\nM3U: ${r.m3u || '—'}`; const waDigits = String(r.whatsapp || r.phone || '').replace(/\D/g, ''); const tgUser = String(r.telegram || '').replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, ''); const waHref = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(msg)}` : ''; const tgHref = tgUser ? `https://t.me/${tgUser}` : ''; modal('Trial sent ✓', `<div class="notice success"><p style="margin:0 0 6px"><b>${esc(r.name || '')}</b> got the trial${r.emailSent ? ' email' : ' (email NOT sent — check the address and Resend setup)'}.</p><p class="small muted" style="word-break:break-all">Username: <b>${esc(r.username)}</b>${r.dns ? ` · DNS: ${esc(r.dns)}` : ''}</p>${r.m3u ? `<p class="small muted" style="word-break:break-all">M3U: ${esc(r.m3u)}</p>` : ''}${r.telegramSent ? '<p class="small pos" style="margin:6px 0 0">✈️ Sent on Telegram ✓</p>' : state.config.telegram?.link ? `<p class="small muted" style="margin:6px 0 0">Telegram not linked. Send the bot link: <a href="${esc(state.config.telegram.link)}" target="_blank" rel="noopener">${esc(state.config.telegram.link)}</a></p>` : ''}</div><div class="row" style="margin-top:10px"><button class="btn" data-act="copy-el" data-el="tq-creds" style="flex:1">📋 Copy</button>${waHref ? `<a class="btn wa-btn" style="flex:1" target="_blank" rel="noopener" href="${esc(waHref)}">💬 WhatsApp</a>` : `<span class="btn" style="flex:1;opacity:.45" title="No WhatsApp number on this request">💬 WhatsApp</span>`}${tgHref ? `<a class="btn" style="flex:1" target="_blank" rel="noopener" href="${esc(tgHref)}">✈️ Telegram</a>` : `<span class="btn" style="flex:1;opacity:.45" title="No Telegram ID on this request">✈️ Telegram</span>`}</div><div id="tq-creds" style="display:none">${esc(msg)}</div><button class="btn block" data-act="close-modal" style="margin-top:10px">OK</button>`); $('#admin-body').innerHTML = await adminTrialQueue(); } catch (e) { btn.disabled = false; toast(tErr(e.message), true); } },
  async 'tq-reject'(f) { try { await api('POST', '/api/admin/trialq/reject', { id: f.dataset.id, note: f.note.value }); closeModal(); toast('Rejected'); $('#admin-body').innerHTML = await adminTrialQueue(); } catch (e) { toast(tErr(e.message), true); } },
  async 'report-problem'(f) { const btn = f.querySelector('button[type=submit]'); btn.disabled = true; try { const img = await pickedImage(f).catch(() => ''); await api('POST', '/api/admin/disputes', { kind: f.kind.value, subject: f.subject.value, details: f.details.value, priority: f.priority.value, image: img }); closeModal(); toast('Sent to the owner & technical manager ✓'); } catch (e) { btn.disabled = false; toast(tErr(e.message), true); } },
  async 'dis-resolve'(f) { try { await api('POST', '/api/admin/disputes/update', { id: f.dataset.id, status: 'resolved', resolution: f.resolution.value }); closeModal(); toast('Resolved ✓'); $('#admin-body').innerHTML = await adminDisputes(); } catch (e) { toast(tErr(e.message), true); } },
  async 'dis-note'(f) { try { await api('POST', '/api/admin/disputes/update', { id: f.dataset.id, note: f.note.value }); closeModal(); toast('Note added'); $('#admin-body').innerHTML = await adminDisputes(); } catch (e) { toast(tErr(e.message), true); } },
});

// ---------------- Team: attendance, night shifts, leave, tasks, team chat, reports (spec §9) ----------------
const TZ_OPTS = TIME_ZONES.map((tz) => { const offset = timezoneOffsetLabel(tz); return [tz, offset ? `${tz} (${offset})` : tz]; });
const WD = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minOf = (v) => { const [h, mm] = String(v || '09:00').split(':').map(Number); return (h || 0) * 60 + (mm || 0); };
async function adminAttendancePage() {
  const r = await api('GET', '/api/admin/attendance'); let team = [], shifts = [];
  try { team = await api('GET', '/api/admin/team'); } catch { team = []; } // staff managers can't list the team; owner can
  try { shifts = await api('GET', '/api/admin/shifts'); } catch { shifts = []; }
  const me = state.admin.me; const mine = r.mine || [];
  const lastMine = mine[0]?.action;
  const myShift = shifts.find((s) => s.memberId === (me.id || 'owner'));
  const now = new Date(); const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; let shiftTz = myShift?.tz || localTz; let shiftLocal;
  try { shiftLocal = zonedDayAndMinute(now, shiftTz); } catch { shiftTz = localTz; shiftLocal = zonedDayAndMinute(now, shiftTz); }
  const wd = String(shiftLocal.day); const today = (myShift && myShift.days && myShift.days[wd]) || null;
  const minsNow = shiftLocal.minute;
  const prevWd = String((shiftLocal.day + 6) % 7); const prevShift = (myShift && myShift.days && myShift.days[prevWd]) || null;
  let shiftBanner = '';
  const to = (m) => { const [h, mm] = [Math.floor(m / 60), m % 60]; return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
  if (today && today.on && lastMine !== 'in' && today.start - minsNow > 0 && today.start - minsNow <= 10) shiftBanner = `⏰ Your shift starts at ${to(today.start)} (${shiftTz}) — in ${today.start - minsNow} minute(s). Check in when you begin.`;
  if (!shiftBanner && lastMine === 'in') {
    const start = today?.start, end = today?.end;
    let remaining = null, endAt = null;
    if (today?.on && start !== end) {
      if (end > start && minsNow >= start && minsNow < end) { remaining = end - minsNow; endAt = end; }
      else if (end < start && minsNow >= start) { remaining = 1440 - minsNow + end; endAt = end; }
    }
    if (remaining === null && prevShift?.on && prevShift.end < prevShift.start && minsNow < prevShift.end) { remaining = prevShift.end - minsNow; endAt = prevShift.end; }
    if (remaining !== null && remaining >= 0 && remaining <= 10) shiftBanner = `⏰ Your shift ends at ${to(endAt)} (${shiftTz}) — ${remaining} minute(s) left. Do your handover, then Check out.`;
  }
  if (shiftBanner && !sessionStorage.getItem('shiftBeeped')) { try { const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC(); const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.08, ctx.currentTime); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.6); sessionStorage.setItem('shiftBeeped', '1'); } catch {} }
  const status = lastMine === 'in' ? 'on shift' : lastMine === 'out' ? 'off duty' : lastMine === 'break_start' ? 'on break' : 'not checked in';
  const nameOf = (id) => (team.find((m) => m.id === id) || {}).name || (id === 'owner' ? 'Owner' : id);
  const summaryRows = Object.entries(r.summary || {}).sort((a, b) => (b[1].workedMs || 0) - (a[1].workedMs || 0)).map(([id, p]) => `<tr><td>${esc(nameOf(id))}</td><td>${p.logins}</td><td>${p.ins}</td><td>${p.outs}</td><td>${Math.round((p.workedMs || 0) / 360000) / 10}h</td><td>${Math.round((p.breaksMs || 0) / 60000)}min</td></tr>`).join('');
  const clock = `<div class="chips" style="margin-bottom:10px"><a class="on tz-clock"><span class="dp-l">🇪🇺 Europe</span><b data-tz="e" style="font-variant-numeric:tabular-nums">--:--:--</b></a><a class="on tz-clock"><span class="dp-l">🇺🇸 US</span><b data-tz="u" style="font-variant-numeric:tabular-nums">--:--:--</b></a><a class="on tz-clock"><span class="dp-l">📍 Local</span><b data-tz="l" style="font-variant-numeric:tabular-nums">--:--:--</b></a></div>`;
  return `${shiftBanner ? `<div class="notice warning" style="margin-bottom:12px">${esc(shiftBanner)}</div>` : ''}${clock}<div class="grid2" style="gap:16px;align-items:start">
    <div class="card"><h3>🕒 My attendance</h3><p class="small muted" style="margin-top:0">Status: <b>${esc(status)}</b>${myShift ? ` · Shift time zone: <b>${esc(shiftTz)}</b>` : ''}</p>
      <div class="row" style="gap:8px"><button class="btn primary" data-act="att-in" ${status === 'on shift' ? 'disabled' : ''}>Check in</button><button class="btn" data-act="att-break-start" ${status !== 'on shift' ? 'disabled' : ''}>☕ Break</button><button class="btn" data-act="att-break-end" ${status !== 'on break' ? 'disabled' : ''}>Back</button><button class="btn danger" data-act="att-out" ${status === 'off duty' ? 'disabled' : ''}>Check out</button></div>
      <h3 style="margin-top:14px">My recent events</h3>${mine.length ? `<div style="max-height:220px;overflow:auto">${mine.slice(0, 20).map((e) => `<div class="list-item"><span style="flex:1"><b>${esc(e.action)}</b>${e.note ? ' · ' + esc(e.note) : ''}</span><span class="small muted">${fmtDT(e.at)}</span></div>`).join('')}</div>` : '<p class="muted small">No events yet. Check in to start your shift.</p>'}</div>
      <div class="card"><h3>🌴 Leave request</h3><form data-form="leave-request">${field('Type', 'kind', 'vacation', { type: 'select', options: [['vacation', 'Vacation'], ['sick', 'Sick leave'], ['emergency', 'Emergency'], ['other', 'Other']] })}<div class="grid2">${field('From', 'from', '', { type: 'date', attrs: 'required' })}${field('To', 'to', '', { type: 'date', attrs: 'required' })}</div>${field('Reason', 'reason', '', { type: 'textarea', rows: 2 })}<button type="submit" class="btn primary">Send for approval</button></form></div>
  </div>
  ${r.scopeAll ? `<div class="card" style="margin-top:16px"><h3>👥 Team attendance (last 30 days)</h3>${summaryRows ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Member</th><th>Logins</th><th>Check-ins</th><th>Check-outs</th><th>Worked</th><th>Breaks</th></tr></thead><tbody>${summaryRows}</tbody></table></div>` : '<p class="muted small">No attendance recorded yet — the team checks in when they start work.</p>'}
    <div class="row" style="margin-top:14px"><h3 style="margin:0;flex:1">🧾 Team log (edit any entry)</h3><button class="btn sm primary" data-act="att-add">➕ Add entry</button></div>
    <div style="max-height:360px;overflow:auto;margin-top:8px">${(r.all || []).filter((e) => e.action !== 'login').slice(0, 80).map((e) => `<div class="list-item"><span style="flex:1"><b>${esc(e.name || nameOf(e.by))}</b> · ${esc({ in: '🟢 check in', out: '⚪ check out', break_start: '☕ break', break_end: '▶️ back' }[e.action] || e.action)}${e.auto ? ' <span class="badge warn">auto</span>' : ''}${e.edited ? ` <span class="badge">edited by ${esc(e.edited)}</span>` : ''}${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ''}</span><span class="small muted">${fmtDT(e.at)}</span>${e.id ? `<button class="btn sm ghost" data-act="att-edit" data-id="${esc(e.id)}" data-at="${e.at}" data-action="${esc(e.action)}" data-note="${esc(e.note || '')}">✏️</button>` : ''}</div>`).join('') || '<p class="muted small">No entries.</p>'}</div></div>
  <div class="card" style="margin-top:16px"><h3>🌙 Shifts, night shifts &amp; weekly rest days</h3><p class="small muted" style="margin-top:0">All supported time zones are available. Each agent's schedule, reminders, and attendance warnings follow the selected zone, including daylight-saving changes. Shifts past midnight (e.g. 22:00 → 06:00) are handled correctly. Rest days are never all on the same days for the whole team.</p>
    <datalist id="agent-timezones">${TZ_OPTS.map(([k, n]) => `<option value="${esc(k)}" label="${esc(n)}"></option>`).join('')}</datalist><div id="shifts-box"><p class="small muted">Loading members…</p></div></div>
  <div class="card" style="margin-top:16px"><h3>🗑 Leave requests (approve / reject)</h3><div id="leaves-box"><p class="small muted">Loading…</p></div></div>
  <div class="card" style="margin-top:16px"><h3>📊 Weekly performance report</h3><div id="reports-box"><p class="small muted">Loading…</p></div></div>` : ''}`;
}
const shiftEditorHtml = (m, sh) => { const tz = sh?.tz || 'Europe/Paris'; const days = sh?.days || {}; return `<div class="card" data-member="${esc(m.id)}" data-tz="${esc(tz)}" style="margin-bottom:10px;padding:12px"><div class="row" style="gap:8px"><div class="avatar">${esc(initials(m.name))}</div><div style="flex:1"><b>${esc(m.name)}</b><div class="small muted">@${esc(m.username)}</div></div>
    <input data-k="tz" list="agent-timezones" value="${esc(tz)}" autocomplete="off" aria-label="Agent shift time zone" title="Type or select an IANA time zone" style="width:220px;max-width:100%"></div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:10px">${WD.map(([i, n]) => { const d = days[i] || { on: false }; return `<div style="text-align:center"><label class="toggle" style="justify-content:center"><input type="checkbox" data-day="${i}" ${d.on ? 'checked' : ''}><i></i><span>${n}</span></label>${d.on ? `<input type="time" data-start="${i}" value="${fmtMin(d.start ?? 540)}" style="margin-top:4px;width:100%"><input type="time" data-end="${i}" value="${fmtMin(d.end ?? 1080)}" style="margin-top:4px;width:100%">` : '<div class="small muted" style="margin-top:20px">rest</div>'}</div>`; }).join('')}</div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary sm" data-act="shift-save" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Save shift plan</button></div></div>`; };
async function loadShiftsAndLeaves() {
  const box = $('#shifts-box'); const lbox = $('#leaves-box'); if (!box) return;
  let team = []; try { team = await api('GET', '/api/admin/team'); } catch { box.innerHTML = '<p class="small muted">Only the owner can edit shift plans. The attendance summary above is still yours.</p>'; }
  let shifts = []; try { shifts = await api('GET', '/api/admin/shifts'); } catch {}
  if (box && team.length) box.innerHTML = team.filter((m) => m.status !== 'disabled').map((m) => shiftEditorHtml(m, shifts.find((s) => s.memberId === m.id))).join('');
  if (lbox) { try { const r = await api('GET', '/api/admin/leaves'); const list = r.list || []; lbox.innerHTML = list.length ? `<div style="max-height:260px;overflow:auto">${list.map((l) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(l.name)}</b> · ${esc(l.kind)}<div class="small muted">${fmtDate(l.from)} → ${fmtDate(l.to)}${l.reason ? ' · ' + esc(l.reason) : ''}</div></span>${l.status === 'pending' ? `<span class="row" style="gap:6px"><button class="btn sm primary" data-act="leave-approve" data-id="${esc(l.id)}" title="Approve leave" aria-label="Approve leave">✓</button><button class="btn sm danger" data-act="leave-reject" data-id="${esc(l.id)}" title="Reject leave" aria-label="Reject leave">✕</button></span>` : `<span class="pill ${l.status === 'approved' ? 'st-active' : 'st-expired'}">${l.status}</span>`}</div>`).join('')}</div>` : '<p class="muted small">No leave requests.</p>'; } catch (e) { lbox.innerHTML = `<p class="small muted">${esc(e.message)}</p>`; } }
  const rbox = $('#reports-box'); if (rbox) { try { const r = await api('GET', '/api/admin/reports?days=30'); rbox.innerHTML = (r.list || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Member</th><th>Score</th><th>Worked</th><th>Breaks</th><th>Logins</th><th>Tasks done</th><th>Adherence</th></tr></thead><tbody>${r.list.map((m) => `<tr><td>${esc(m.name)}</td><td><b>${m.score === null ? '—' : m.score}</b></td><td>${Math.round((m.workedMs || 0) / 360000) / 10}h</td><td>${Math.round((m.breaksMs || 0) / 60000)}min</td><td>${m.logins}</td><td>${m.completed}/${m.tasksTotal}${m.delayed ? ` · ${m.delayed} delayed` : ''}${m.blocked ? ` · ${m.blocked} blocked` : ''}</td><td>${m.adherence === null ? '—' : m.adherence + '%'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No data yet this month.</p>'; } catch (e) { rbox.innerHTML = `<p class="small muted">${esc(e.message)}</p>`; } }
}
const startTzClock = () => { if (window.__tzIv) return; const tick = () => { const now = new Date(); const o = { hour: '2-digit', minute: '2-digit', second: '2-digit' }; const e = now.toLocaleTimeString('en-GB', { ...o, timeZone: 'Europe/Paris' }); const us = now.toLocaleTimeString('en-US', { ...o, timeZone: 'America/New_York' }); const l = now.toLocaleTimeString('en-GB', o); document.querySelectorAll('[data-tz=e]').forEach((x) => { x.textContent = e; }); document.querySelectorAll('[data-tz=u]').forEach((x) => { x.textContent = us; }); document.querySelectorAll('[data-tz=l]').forEach((x) => { x.textContent = l; }); }; window.__tzIv = setInterval(tick, 1000); tick(); };
async function adminTasksPage() {
  const r = await api('GET', '/api/admin/tasks'); const list = r.list || []; const mine = r.mine || [];
  const canAssign = r.scopeAll;
  let team = []; if (canAssign) { try { team = await api('GET', '/api/admin/team'); } catch {} }
  const assigneeOpts = [['owner', 'Owner'], ...team.filter((m) => m.status !== 'disabled').map((m) => [m.id, m.name])];
  const opts = assigneeOpts.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
  const sts = ['not_started', 'in_progress', 'completed', 'delayed', 'blocked'];
  const pill = { not_started: 'st-open', in_progress: 'st-expiring', completed: 'st-active', delayed: 'st-expired', blocked: 'st-expired' };
  const row = (t, own) => `<tr><td><b>${esc(t.name)}</b> <span class="tagp" title="Task ID">${esc(t.id)}</span>${t.desc ? `<div class="small muted">${esc(t.desc)}</div>` : ''}<div class="small muted">${t.deadline ? 'Deadline ' + fmtDate(t.deadline) : ''}${t.doneAt ? ' · done ' + fmtDT(t.doneAt) : ''}${t.priority === 'high' ? ' · <b style="color:var(--bad)">high</b>' : ''}</div></td><td class="small">${esc(t.assigneeName)}</td><td><select data-task="${esc(t.id)}" style="width:auto">${sts.map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></td><td>${r.scopeAll ? `<button class="btn sm danger" data-act="task-del" data-id="${esc(t.id)}" title="Delete task" aria-label="Delete task">🗑</button>` : ''}</td></tr>`;
  const byMember = {}; if (r.scopeAll) for (const t of list) (byMember[t.assignee] ||= []).push(t);
  const plan = r.scopeAll ? `<div class="card" style="margin-top:16px"><h3>📅 Weekly plan</h3>${Object.entries(byMember).map(([id, ts]) => `<div style="margin-bottom:10px"><b>${esc(assigneeOpts.find(([v]) => v === id)?.[1] || id)}</b><ul style="margin:4px 0 0 16px">${ts.filter((t) => t.status !== 'completed').slice(0, 10).map((t) => `<li class="small">${esc(t.name)}${t.deadline ? ' — ' + fmtDate(t.deadline) : ''}</li>`).join('') || '<li class="small muted">All done 🎉</li>'}</ul></div>`).join('')}</div>` : '';
  return `${canAssign ? `<form data-form="task-add" class="card"><h3>＋ Assign a task</h3><div class="grid2">${field('Task', 'name', '', { attrs: 'required maxlength="160"', ph: 'What needs to be done' })}${field('Assign to', 'assignee', 'owner', { type: 'select', options: assigneeOpts.map(([v, n]) => [v, n]) })}</div>${field('Details', 'desc', '', { type: 'textarea', rows: 2 })}<div class="grid3">${field('Start', 'start', new Date().toISOString().slice(0, 10), { type: 'date' })}${field('Deadline', 'deadline', '', { type: 'date' })}${field('Priority', 'priority', 'normal', { type: 'select', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']] })}</div><button type="submit" class="btn primary">Assign task</button></form>` : ''}
  ${mine.length ? `<div class="card" style="margin-top:16px"><h3>My tasks (${mine.length})</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Task</th><th>Assignee</th><th>Status</th><th></th></tr></thead><tbody>${mine.map((t) => row(t, true)).join('')}</tbody></table></div></div>` : ''}
  ${r.scopeAll && list.length ? `<div class="card" style="margin-top:16px"><h3>All tasks</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Task</th><th>Assignee</th><th>Status</th><th></th></tr></thead><tbody>${list.map((t) => row(t, false)).join('')}</tbody></table></div></div>` : ''}${plan}`;
}
async function adminTeamChatPage() {
  const list = await api('GET', '/api/admin/teamchat'); const me = state.admin.me;
  return `<p class="small muted">Internal channel for shift handovers and team updates. Not for customers and not for payments.</p>
    <div class="card"><div class="thread chat" id="tc-thread" style="max-height:56vh;overflow:auto">${list.length ? list.map((m) => `<div class="msg ${m.name === me?.name ? 'mine' : ''}"><b class="small">${esc(m.name)}</b><div class="msg-t">${esc(m.text)}</div><div class="small muted" style="margin-top:3px">${fmtDT(m.at)} <button type="button" class="tr-msg-btn" data-act="tr-msg" title="Translate this message" aria-label="Translate this message">🌐</button></div></div>`).join('') : '<p class="muted small" style="text-align:center;margin:24px 0">No messages yet. Write the first one.</p>'}</div>
    <form data-form="teamchat-send" class="chat-form"><input name="text" maxlength="1000" autocomplete="off" placeholder="Write to the team…" required><button type="submit" class="btn primary">Send</button></form></div>`;
}
Object.assign(actions, {
  'att-in': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/attendance', { action: 'in' }); $('#admin-body').innerHTML = await adminAttendancePage(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'att-out': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/attendance', { action: 'out' }); $('#admin-body').innerHTML = await adminAttendancePage(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'att-break-start': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/attendance', { action: 'break_start' }); $('#admin-body').innerHTML = await adminAttendancePage(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'att-break-end': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/attendance', { action: 'break_end' }); $('#admin-body').innerHTML = await adminAttendancePage(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'leave-approve': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/leaves/decide', { id: el.dataset.id, action: 'approved' }); await loadShiftsAndLeaves(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'leave-reject': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/leaves/decide', { id: el.dataset.id, action: 'rejected' }); await loadShiftsAndLeaves(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'shift-save': async (el) => {
    el.disabled = true; const card = el.closest('[data-member]'); const g = (k) => card.querySelector(`[data-k=${k}]`).value;
    const days = {}; card.querySelectorAll('[data-day]').forEach((cb) => { const i = cb.dataset.day; days[i] = { on: cb.checked, start: minOf(card.querySelector(`[data-start="${i}"]`)?.value) || 540, end: minOf(card.querySelector(`[data-end="${i}"]`)?.value) || 1080 }; });
    const daysOff = WD.filter(([i]) => !days[i].on).map(([i]) => Number(i));
    try { await api('PUT', '/api/admin/shifts', { memberId: card.dataset.member, memberName: el.dataset.name, tz: g('tz'), days, daysOff }); toast('Shift plan saved ✓'); el.disabled = false; } catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'task-del': async (el) => { if (!confirm('Delete this task?')) return; try { await api('DELETE', '/api/admin/tasks/' + el.dataset.id); $('#admin-body').innerHTML = await adminTasksPage(); } catch (e) { toast(e.message, true); } },
});
Object.assign(forms, {
  async 'leave-request'(f) { try { await api('POST', '/api/admin/leaves', formToObj(f)); toast('Sent for approval ✓'); f.reset(); } catch (e) { toast(e.message, true); } },
  async 'task-add'(f) { const o = formToObj(f); try { await api('POST', '/api/admin/tasks', o); toast('Task assigned ✓'); f.reset(); $('#admin-body').innerHTML = await adminTasksPage(); } catch (e) { toast(e.message, true); } },
  async 'teamchat-send'(f) { const t = f.text.value.trim(); if (!t) return; try { await api('POST', '/api/admin/teamchat', { text: t }); f.text.value = ''; $('#tc-thread').innerHTML = (await api('GET', '/api/admin/teamchat')).map((m) => `<div class="msg ${m.name === state.admin.me?.name ? 'mine' : ''}"><b class="small">${esc(m.name)}</b><div class="msg-t">${esc(m.text)}</div><div class="small muted" style="margin-top:3px">${fmtDT(m.at)}</div></div>`).join(''); const th = $('#tc-thread'); th.scrollTop = th.scrollHeight; } catch (e) { toast(e.message, true); } },
});
document.addEventListener('change', (e) => { const t = e.target; if (t.dataset?.task && ['not_started', 'in_progress', 'completed', 'delayed', 'blocked'].includes(t.value)) { t.disabled = true; api('PUT', '/api/admin/tasks/' + t.dataset.task, { status: t.value }).then(() => { }).catch((err) => toast(err.message, true)).finally(() => { t.disabled = false; }); } });

// ---------------- Holidays & campaign planning: Owner and Technical Manager only (spec §2) ----------------
const easterSunday = (y) => { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), month = Math.floor((h + l - 7 * m + 114) / 31) - 1, day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month, day);
};
function holidaysList() { return holidayCalendar(Date.now(), (state.admin.settings?.holidayRemind || {}).custom || []).slice(0, 40); }

function adminHolidaysTable() {
  const list = holidaysList();
  const regionTone = { US: 'st-open', 'US / EU': 'st-active', EU: 'st-expiring', Intl: 'st-renewed' };
  return `<p class="small muted">Use these dates to plan marketing campaigns and to expect Stripe/bank payout delays (US federal holidays delay ACH/payout by 1–2 days). Moveable feasts (Ramadan, Eid) are approximate — double-check each year.</p>
  <div class="card"><h3>🗓 Upcoming holidays &amp; campaign windows</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>Region</th><th>Planning note</th></tr></thead><tbody>${list.map((h) => `<tr><td class="small">${fmtDate(h.at)}</td><td class="small">${new Date(h.at).toLocaleDateString(undefined, { weekday: 'short' })}</td><td><b>${esc(h.name)}</b>${h.at < Date.now() + 30 * DAYMS ? ' <span class="pill st-active">soon</span>' : ''}</td><td><span class="tagp">${esc(h.region)}</span></td><td class="small">${esc(h.tip)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

async function adminHolidays() {
  let up = null; try { up = await api('GET', '/api/admin/holidays/upcoming'); } catch {}
  const me = state.admin.me || {}; const canEdit = !me.locked || me.role === 'owner'; const cfg = up?.cfg || { on: true, days: [7, 1], custom: [] };
  const kindName = { christmas: '🎄 Christmas', newyear: '🎆 New Year', holidays: '🎁 Christmas & New Year', blackfriday: '🖤 Black Friday', cybermonday: '💻 Cyber Monday', events: '🏆 Sports & events', evergreen: '✨ All-year', devices: '📱 Multi-device' };
  const next = (up?.list || []).filter((h) => h.daysLeft >= 0).slice(0, 8);
  return `<div class="card"><h3 style="margin-top:0">⏰ Holiday reminders</h3>
    <p class="small muted" style="margin-top:0">Every agent gets a notification ${cfg.days.map((d) => d === 0 ? 'on the day' : d + ' day' + (d === 1 ? '' : 's')).join(' and ')} before each holiday, with the promotion to send. Tap “Send the promotion” to open the ready texts (email, WhatsApp, app notification).</p>
    ${next.map((h) => `<div class="list-item" style="align-items:center"><span style="font-size:22px">${h.daysLeft <= 1 ? '🔔' : '🗓'}</span><div style="flex:1;min-width:0"><b>${esc(h.name)}</b> <span class="pill ${h.daysLeft <= 7 ? 'st-expiring' : 'st-active'}">${h.daysLeft === 0 ? 'today' : h.daysLeft === 1 ? 'tomorrow' : 'in ' + h.daysLeft + ' days'}</span>${h.custom ? ' <span class="badge">own date</span>' : ''}<div class="small muted">${fmtDate(h.at)} · ${esc(h.region)} · ${esc(h.tip || '')}</div></div><button class="btn sm primary" data-act="hol-promo" data-k="${esc(h.kind)}">${esc(kindName[h.kind] || '🎉')} · Send the promotion</button></div>`).join('') || '<p class="muted small">Nothing coming up.</p>'}
    ${canEdit ? `<form data-form="hol" onsubmit="return false" style="margin-top:14px"><h3>⚙️ Reminder settings</h3><div class="row" style="gap:14px;flex-wrap:wrap">${toggle('Reminders on', 'on', cfg.on)}${field('Remind days before (comma)', 'days', cfg.days.join(', '), { ph: '7, 1' })}</div>
      <h3 style="margin-top:12px">➕ Your own dates</h3><div id="hol-custom">${(cfg.custom || []).map((c) => holRow(c)).join('')}</div><button type="button" class="btn sm" data-act="hol-add">＋ Add a date</button>
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn primary" data-act="hol-save">💾 Save reminders</button></div></form>` : '<p class="small muted lock-note">🔒 The owner / Technical Service sets the reminder days and own dates.</p>'}</div>
  ${adminHolidaysTable()}`;
}
const holRow = (c = {}) => `<div class="row hol-row" style="gap:6px;margin-bottom:6px;flex-wrap:wrap" data-id="${esc(c.id || '')}"><input data-k="name" placeholder="Name (e.g. Shop anniversary)" value="${esc(c.name || '')}" style="flex:2;min-width:160px"><input data-k="date" type="date" value="${esc(c.date || '')}" style="width:160px"><select data-k="kind" style="width:auto">${['evergreen', 'events', 'devices', 'holidays', 'christmas', 'newyear', 'blackfriday', 'cybermonday'].map((k) => `<option ${c.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select><input data-k="tip" placeholder="Note" value="${esc(c.tip || '')}" style="flex:2;min-width:140px"><button type="button" class="btn sm ghost" data-act="hol-del">✕</button></div>`;
Object.assign(actions, {
  'hol-promo': (el) => { const map = { holidays: 'season-kickoff', christmas: 'season-kickoff', newyear: 'season-kickoff', blackfriday: 'double-credit', cybermonday: 'credit-purchase-offer', events: 'match-day-football', evergreen: 'season-kickoff', devices: 'extra-credit-pack' }; actions['pc-details']({ dataset: { id: 'tpl_' + (map[el.dataset.k] || 'season-kickoff') } }); },
  'hol-add': () => document.getElementById('hol-custom').insertAdjacentHTML('beforeend', holRow({})),
  'hol-del': (el) => el.closest('.hol-row').remove(),
  'hol-save': async (el) => { const f = el.closest('form'); const custom = [...document.querySelectorAll('#hol-custom .hol-row')].map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`).value; return { id: r.dataset.id, name: g('name'), date: g('date'), kind: g('kind'), tip: g('tip') }; }).filter((c) => c.name && c.date);
    try { const hr = await api('PUT', '/api/admin/holidays/remind', { on: f.on.checked, days: String(f.days.value).split(/[,\s]+/).map(Number).filter((n) => !isNaN(n)), custom }); state.admin.settings.holidayRemind = hr; toast('Holiday reminders saved ✓'); renderAdmin(); } catch (e) { toast(e.message, true); } },
});

// ---------------- In-panel browser (spec §2) ----------------
function adminBrowserPage(s) {
  const panel = (s && s.reseller && s.reseller.enabled && s.reseller.baseUrl) ? String(s.reseller.baseUrl) : '';
  const links = [
    ['📊', 'Google Sheets', 'https://docs.google.com/spreadsheets'],
    ['📁', 'Google Drive', 'https://drive.google.com'],
    ['📬', 'Gmail', 'https://mail.google.com'],
    ['✉️', 'Resend (email)', 'https://resend.com/emails'],
    ['💳', 'Stripe', 'https://dashboard.stripe.com'],
    ['🛡', 'Cloudflare Workers', 'https://dash.cloudflare.com/?to=/:account/workers/overview'],
    panel && ['🔌', 'TVplus panel', panel],
  ].filter(Boolean);
  return `<p class="small muted">Work browser inside the dashboard. Google and others block embedding, so they open in a new tab — it is by design. For quick answers, use the search below (web results from DuckDuckGo).</p>
    <div class="card"><h3>🔗 Work shortcuts</h3><div class="chips" style="gap:10px;flex-wrap:wrap">${links.map(([i, n, u]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${i} ${esc(n)}</a>`).join('')}</div></div>
    ${TR.translatorCard()}
    <div class="card"><h3>🔎 Web search (in-panel)</h3><form data-form="browser-search" class="row" style="gap:8px"><input name="q" placeholder="Search the web…" style="flex:1" autocomplete="off"><button type="submit" class="btn primary">Search</button></form>
      <div id="browser-frame" style="margin-top:14px;border:1px solid var(--line2);border-radius:12px;overflow:hidden;height:60vh"><iframe title="search results" style="width:100%;height:100%;border:0;background:#fff" src="about:blank"></iframe></div>
      <p class="small muted" style="margin-top:8px">If the results do not load, <a href="https://lite.duckduckgo.com/lite/" target="_blank" rel="noopener">open full search in a new tab →</a></p>
    </div>`;
}

// ---------------- Marketing dashboards (spec §8) ----------------
function mktDraftHtml(d) {
  if (!d) return '';
  const locked = !!state.admin.me?.locked;
  return `<div class="card" style="padding:12px;margin-top:10px"><div class="small muted">${d.source === 'ai' ? 'AI draft' : 'Template fallback draft'} · not saved or sent</div>
    <label class="field"><span>Email subject</span><textarea id="mkt-ai-subject" rows="2" readonly>${esc(d.emailSubject || '')}</textarea><button type="button" class="btn sm" data-act="mkt-copy-ai" data-kind="subject">Copy subject</button></label>
    <label class="field"><span>Email HTML</span><textarea id="mkt-ai-html" rows="8" readonly spellcheck="false">${esc(d.emailHtml || '')}</textarea><button type="button" class="btn sm" data-act="mkt-copy-ai" data-kind="html">Copy email HTML</button></label>
    <label class="field"><span>WhatsApp-ready text (plain text, not HTML)</span><textarea id="mkt-ai-whatsapp" rows="6" readonly>${esc(d.whatsappText || '')}</textarea><button type="button" class="btn sm" data-act="mkt-copy-ai" data-kind="whatsapp">Copy WhatsApp text</button></label>
    ${locked ? '<p class="small muted">Your account uses locked campaign copy, so this draft is for reference only.</p>' : '<button type="button" class="btn sm primary" data-act="mkt-ai-apply">Use email HTML + subject in the campaign form (unsaved)</button>'}</div>`;
}
async function adminMktPage() {
  const m = await api('GET', '/api/admin/emailmkt'); const st = await api('GET', '/api/admin/emailmkt/settings');
  state.admin.mkt = m; state.admin.mktSettings = st;
  const lists = m.lists || [];
  const input = (k, val, ph) => `<input name="${k}" data-k="${k}" value="${esc(val || '')}" placeholder="${esc(ph)}" dir="ltr" autocomplete="off">`;
  const msCard = await mailStatusCard(true);
  const composer = state.admin.mktComposer || {};
  const aiComposer = `<h3 style="margin-top:14px">✨ Draft Email &amp; WhatsApp messages</h3><p class="small muted">Describe the campaign without customer-specific data. Drafting does not save or send. The WhatsApp result is plain text; copy it into WhatsApp and review it before sending.</p>
    <form data-form="mkt-ai"><div class="grid2">${field('Audience (optional)', 'audience', '', { ph: 'e.g. existing subscribers' })}${field('Tone (optional)', 'tone', '', { ph: 'e.g. warm and concise' })}</div>${field('Campaign brief', 'brief', '', { type: 'textarea', rows: 3, attrs: 'required maxlength="1200"', ph: 'What should the message say? Include only claims, prices or offers you have verified.' })}<button type="submit" class="btn">✨ Generate drafts</button></form><div id="mkt-ai-output">${mktDraftHtml(state.admin.mktDraft)}</div>`;
  return `${msCard}<p class="small muted">Marketing email lists are isolated from customer emails. Keys, sender names and subjects rotate batch by batch. Bounced/dead addresses are removed at upload and excluded at send. Sender is <b>noreply@<domain></b> — auto-generated from the domain paired with each key.</p>
  <div class="chips" style="margin-bottom:12px"><a class="on">${m.keysSet} key${m.keysSet === 1 ? '' : 's'} on · ${m.rowsTotal || 0} in total</a><a class="on">${m.senders}/5 sender names</a><a class="on">${m.subjects}/5 subject lines</a><a class="on">Today: ${m.today} sent</a><a class="on">30 days: ${m.last30} sent</a><a class="on">Total spend: $${Number(m.totalSpendUsd || 0).toFixed(2)}</a></div>
  <div class="grid2" style="gap:16px;align-items:start">
    <div class="card"><h3>🔑 Resend keys &amp; rotation</h3><p class="small muted" style="margin-top:0">As many keys and domains as you need. Set each key's plan: paid keys are used first, free trial keys only up to their limit, and a key that fails is skipped for the next one. Saved keys show only their last 4 characters.</p>
      <form data-form="mkt-settings">
        ${keysEditor('mkt', st.rows || [])}
        <h3 style="margin-top:12px">Sender names</h3><div class="grid2">${Array.from({ length: 5 }, (_, i) => input('sender' + i, st.senders[i] || '', 'Sender ' + (i + 1) + ' e.g. INTPROTO-TV')).join('')}</div>
        <h3 style="margin-top:12px">Subject lines (rotated per batch)</h3><div class="grid2">${Array.from({ length: 5 }, (_, i) => input('subject' + i, st.subjects[i] || '', 'Subject ' + (i + 1))).join('')}</div>
        <div style="margin:12px 0 10px">${field('Cost per email (USD)', 'costPerEmail', m.costPerEmail, { type: 'number', attrs: 'step="0.0001" min="0"', help: '$0.0004 = $0.40 per 1,000 emails' })}</div>
        <button type="submit" class="btn primary">💾 Save marketing settings</button></form></div>
    <div class="card"><h3>📋 Lists &amp; campaign</h3><form data-form="mkt-list">${field('List name', 'name', '', { attrs: 'required' })}<label class="field"><span>Paste emails (one per line)</span><textarea name="text" rows="5" required placeholder="one email per line"></textarea></label><button type="submit" class="btn primary">Upload list</button></form>${aiComposer}
      ${lists.length ? `<div style="margin-top:12px">${lists.map((l) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(l.name)}</b><div class="small muted">${l.count} emails · ${fmtDate(l.createdAt)} · by ${esc(l.by || '')}</div></span><button class="btn sm danger" data-act="mkt-del" data-id="${esc(l.id)}" title="Delete mailing list" aria-label="Delete mailing list">🗑</button></div>`).join('')}</div>
      <h3 style="margin-top:14px">🚀 Send a campaign</h3><select id="mkt-list" data-input="mkt-list" style="width:100%;margin-bottom:8px">${lists.map((l) => `<option value="${esc(l.id)}">${esc(l.name)} (${l.count})</option>`).join('')}</select>${state.admin.me?.locked ? `<p class="small notice" style="margin:0 0 8px">🔒 The campaign email is set by the owner / Technical Service${st.html ? '' : ' (default message for now)'}. You choose the list and send.</p>` : `<label class="field"><span>Email subject (used for an applied AI draft; editable before sending)</span><input id="mkt-subject" value="${esc(composer.subject ?? st.subjects?.[0] ?? '')}" autocomplete="off"></label><textarea id="mkt-html" rows="4" placeholder="Optional: paste custom HTML content. Empty = default message.">${esc(composer.html ?? st.html ?? '')}</textarea><button type="button" class="btn sm" data-act="mkt-html-save" style="margin:6px 0">💾 Save as the campaign agents send</button>`}<p class="small muted" id="mkt-estimate"></p><button class="btn primary block" data-act="mkt-send">Send to this list</button>` : '<p class="small muted" style="margin-top:12px">Upload a list first.</p>'}</div>
  </div>`;
}
async function adminSeoPage() {
  const r = await api('GET', '/api/admin/seo');
  const rows = r.list.map((e) => `<tr><td class="small">${fmtDT(e.at)}</td><td><span class="tagp">${esc(e.platform)}</span></td><td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</td><td class="small">${esc(e.result || '')}</td><td class="small">${esc(e.agent)}</td><td><button class="btn sm danger" data-act="seo-del" data-id="${esc(e.id)}" title="Delete post" aria-label="Delete post">🗑</button></td></tr>`).join('');
  return `<p class="small muted">Team tasks for SEO and promo posts on Reddit, Quora and Facebook — one log, daily / weekly / monthly counts, per-agent results.</p>
    <div class="chips" style="margin-bottom:12px"><a class="on">Today: ${r.today}</a><a class="on">Last 7 days: ${r.weekCount}</a><a class="on">Last 30 days: ${r.monthCount}</a>${Object.entries(r.byAgent || {}).map(([a, n]) => `<a class="on">${esc(a)}: ${n}</a>`).join('')}</div>
    <div class="grid2" style="gap:16px;align-items:start"><form data-form="seo-add" class="card"><h3>＋ Log a post</h3>${field('Platform', 'platform', 'Reddit', { type: 'select', options: [['Reddit', 'Reddit'], ['Quora', 'Quora'], ['Facebook', 'Facebook']] })}${field('Title / what you did', 'title', '', { attrs: 'required maxlength="200"' })}${field('Link (optional)', 'url', '', { attrs: 'autocapitalize="none"' })}${field('Result (optional)', 'result', '', { ph: 'views, upvotes, signups…' })}<button type="submit" class="btn primary">Log it</button></form>
    <div class="card"><h3>Recent posts</h3>${r.list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Platform</th><th>Post</th><th>Result</th><th>Agent</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted small">Nothing logged yet.</p>'}</div></div>`;
}
async function adminGadsPage() {
  const r = await api('GET', '/api/admin/gads'); const t = r.total || {};
  const rows = (r.campaigns || []).map((c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.account || '—')} · ${esc(c.domain)}${c.gmail ? ' · ' + esc(c.gmail) : ''} · ${esc(c.status)}</div><div class="small muted">🔑 ${esc(c.keyword || '—')}</div></td><td class="small">${c.dailyBudget} ${esc(c.currency)}/day<div class="muted">${c.impressions|0} impr · ${c.clicks|0} clk · <b>${c.results|0} results</b></div></td><td class="small">Today $${Number(c.today||0).toFixed(2)}<div class="muted">7d $${Number(c.week||0).toFixed(2)} · 30d $${Number(c.month||0).toFixed(2)}</div></td><td><button class="btn sm" data-act="gads-entry" data-id="${esc(c.id)}">＋ Spend</button><button class="btn sm danger" data-act="gads-del" data-id="${esc(c.id)}">🗑</button></td></tr>`).join('');
  return `<p class="small muted">Google Ads campaigns across <b>InProto-TV.com</b>, <b>online.info.net</b> and <b>intproto-tv.store</b> — multiple accounts, per-campaign daily budget and spend per day / week / month.</p>
    ${adsPanelHtml()}
    <div class="chips" style="margin-bottom:12px"><a class="on">Today $${Number(t.today||0).toFixed(2)}</a><a class="on">Last 7 days $${Number(t.week||0).toFixed(2)}</a><a class="on">Last 30 days $${Number(t.month||0).toFixed(2)}</a></div>
    <div class="grid2" style="gap:16px;align-items:start"><form data-form="gads-campaign" class="card"><h3>＋ New campaign</h3>${field('Google Ads account', 'account', '', { ph: 'e.g. GreenApp Ads' })}${field('Campaign name', 'name', '', { attrs: 'required maxlength="120"' })}${field('Email (Gmail)', 'gmail', '', { type: 'email', ph: 'name@gmail.com', attrs: 'placeholder="name@gmail.com"' })}${field('Domain', 'domain', '', { type: 'text', ph: 'intproto-tv.store', attrs: 'placeholder="intproto-tv.store"', help: 'Type it manually — no predefined domains.' })}${field('Keywords', 'keyword', '', { ph: 'iptv subscription buy, tvplus, ibo player', attrs: 'maxlength="140"' })}<div class="grid2">${field('Budget (daily)', 'dailyBudget', 10, { type: 'number', attrs: 'min="0" step="any"' })}${field('Currency', 'currency', 'USD', { type: 'select', options: [['USD', 'USD'], ['EUR', 'EUR']] })}</div><button type="submit" class="btn primary">Add campaign</button></form>
    <div class="card"><h3>Campaigns (${(r.campaigns || []).length})</h3>${(r.campaigns || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Campaign</th><th>Budget</th><th>Spend</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted small">No campaigns yet.</p>'}</div></div>`;
}
async function adminFbPage() {
  const r = await api('GET', '/api/admin/fb'); const t = r.total || {};
  const cards = (r.ads || []).map((a) => `<div class="card"><div class="row">${a.image ? `<button class="btn" style="flex:0 0 auto" data-act="att-show" data-src="/api/admin/fb/att?id=${encodeURIComponent(a.image)}">🖼 Photo</button>` : ''}<div style="flex:1;min-width:180px"><p style="margin:0;white-space:pre-wrap">${esc(a.description)}</p><p class="small muted">${esc(a.account || '—')} · ${esc(a.phone || '')}</p></div></div><p class="small" style="margin:8px 0 4px">Today $${Number(a.today||0).toFixed(2)} · 7d $${Number(a.week||0).toFixed(2)} · 30d $${Number(a.month||0).toFixed(2)} · ${a.results||0} results</p><div class="row"><button class="btn sm" data-act="fb-entry" data-id="${esc(a.id)}">＋ Log performance</button><button class="btn sm danger" data-act="fb-del" data-id="${esc(a.id)}">🗑</button></div></div>`).join('');
  return `<p class="small muted">Facebook Ads for photo posts — keep the creative description, the phone number and the ad account used for each campaign, and log performance per creative. Everything is kept in the creative history log.</p>
    ${adsPanelHtml()}
    <div class="chips" style="margin-bottom:12px"><a class="on">${(r.ads || []).length} creatives</a><a class="on">Today $${Number(t.today||0).toFixed(2)}</a><a class="on">Last 7 days $${Number(t.week||0).toFixed(2)}</a><a class="on">Last 30 days $${Number(t.month||0).toFixed(2)}</a></div>
    <div class="grid2" style="gap:16px;align-items:start"><form data-form="fb-ad" class="card"><h3>＋ New creative</h3>${field('Facebook Ad account', 'account', '', { ph: 'act_…' })}${field('Phone used', 'phone', '', { type: 'tel', ph: '+212…' })}${field('Description', 'description', '', { type: 'textarea', rows: 4, attrs: 'required maxlength="500"', ph: 'Post text / creative description' })}<label class="field"><span>Photo</span><input type="file" name="image" accept="image/*"></label><button type="submit" class="btn primary">Add creative</button></form>
    <div>${cards || '<div class="empty card"><span class="ic">👍</span>No creatives yet.</div>'}</div></div>`;
}
Object.assign(actions, {
  'mkt-del': async (el) => { el.disabled = true; try { await api('DELETE', '/api/admin/emailmkt/list/' + el.dataset.id); $('#admin-body').innerHTML = await adminMktPage(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'mkt-copy-ai': async (el) => { const d = state.admin.mktDraft || {}; const value = el.dataset.kind === 'html' ? d.emailHtml : el.dataset.kind === 'whatsapp' ? d.whatsappText : d.emailSubject; if (value) await actions['copy-text']({ dataset: { text: value } }); },
  'mkt-ai-apply': () => { const d = state.admin.mktDraft; if (!d || state.admin.me?.locked) return; const html = d.emailHtml || '', subject = d.emailSubject || ''; state.admin.mktComposer = { ...(state.admin.mktComposer || {}), html, subject, aiSubjectApplied: true }; const htmlField = $('#mkt-html'), subjectField = $('#mkt-subject'); if (htmlField) htmlField.value = html; if (subjectField) subjectField.value = subject; toast('Draft filled in the campaign form. It is not saved or sent.'); },
  'mkt-send': async (el) => {
    const sel = $('#mkt-list'); const listId = sel?.value; if (!listId) return toast('Upload a list first.', true);
    const l = (state.admin.mkt.lists || []).find((x) => x.id === listId); const html = ($('#mkt-html') || {}).value || '';
    const subject = state.admin.mktComposer?.aiSubjectApplied ? String($('#mkt-subject')?.value || '').trim() : '';
    const cost = ((l?.count || 0) * Number(state.admin.mkt.costPerEmail || 0)).toFixed(2);
    if (!confirm(`Send to ${l?.count || 0} recipients?\nEstimated cost: $${cost}`)) return;
    const submittedComposer = state.admin.mktComposer;
    el.disabled = true; toast('Sending…');
    try { const r = await api('POST', '/api/admin/emailmkt/send', { listId, html, ...(subject ? { subject } : {}) }); toast(`Campaign sent: ${r.sent} delivered · $${Number(r.spendUsd || 0).toFixed(2)} spent ✓`); if (state.admin.mktComposer === submittedComposer) state.admin.mktComposer = null; $('#admin-body').innerHTML = await adminMktPage(); } catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'seo-del': async (el) => { el.disabled = true; try { await api('DELETE', '/api/admin/seo/' + el.dataset.id); $('#admin-body').innerHTML = await adminSeoPage(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'gads-del': async (el) => { if (!confirm('Delete this campaign and its stats?')) return; try { await api('DELETE', '/api/admin/gads/campaign/' + el.dataset.id); $('#admin-body').innerHTML = await adminGadsPage(); } catch (e) { toast(e.message, true); } },
  'gads-entry': (el) => { modal('＋ Log spend', `<form data-form="gads-entry" data-id="${esc(el.dataset.id)}"><div class="grid2">${field('Spend (USD)', 'spend', '', { type: 'number', attrs: 'min="0" step="0.01" required' })}${field('Results (signups…)', 'results', '', { type: 'number', attrs: 'min="0"' })}</div><div class="grid2">${field('Impressions', 'impressions', '', { type: 'number', attrs: 'min="0"' })}${field('Clicks', 'clicks', '', { type: 'number', attrs: 'min="0"' })}</div><div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Log</button></div></form>`); },
  'fb-del': async (el) => { if (!confirm('Delete this creative and its stats?')) return; try { await api('DELETE', '/api/admin/fb/ad/' + el.dataset.id); $('#admin-body').innerHTML = await adminFbPage(); } catch (e) { toast(e.message, true); } },
  'fb-entry': (el) => { modal('＋ Log performance', `<form data-form="fb-entry" data-id="${esc(el.dataset.id)}"><div class="grid2">${field('Spend (USD)', 'spend', '', { type: 'number', attrs: 'min="0" step="0.01" required' })}${field('Results', 'results', '', { type: 'number', attrs: 'min="0"' })}</div>${field('Reach', 'reach', '', { type: 'number', attrs: 'min="0"' })}<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button type="submit" class="btn primary">Log</button></div></form>`); },
});
Object.assign(forms, {

  async 'ai-cfg'(f) {
    const config = formToObj(f); if (!config.apiKey) delete config.apiKey;
    try { await api('PUT', '/api/admin/ai/config', config); toast('AI settings saved ✓'); renderAdmin(); }
    catch (e) { toast(e.message, true); }
  },
  async 'trans-settings'(f) {
    const el = (n) => f.elements[n];
    const val = (n) => ((el(n) && 'value' in el(n)) ? el(n).value : '').trim();
    const subjects = []; for (let i = 0; i < 10; i++) { if (el('transSubject' + i)) subjects.push(val('transSubject' + i)); }
    const cost = Number(val('transCost') || '0.0004') || 0.0004;
    try { await api('PUT', '/api/admin/settings', { email: { transRows: keysRead('trans'), transSubjects: subjects, transCostPerEmail: cost } }); } catch (e) { return toast(e.message, true); }
    toast('Saved ✓'); renderAdmin();
  },
    async 'mkt-settings'(f) {
    const val = (n) => ((f.elements[n] && 'value' in f.elements[n]) ? f.elements[n].value : '').trim();
    const senders = Array.from({ length: 5 }, (_, i) => val('sender' + i));
    const subjects = []; for (let i = 0; i < 10; i++) { if (f.elements['subject' + i]) subjects.push(val('subject' + i)); }
    const costEl = f.elements['costPerEmail'];
    try { await api('PUT', '/api/admin/emailmkt/settings', { rows: keysRead('mkt'), senders, subjects, costPerEmail: Number((costEl && costEl.value) || 0.0004) || 0.0004 }); } catch (e) { return toast(e.message, true); }
    toast('Saved ✓'); renderAdmin();
  },
  async 'mkt-list'(f) { const o = formToObj(f); try { const r = await api('POST', '/api/admin/emailmkt/list', { name: o.name, text: o.text }); toast(`List saved: ${r.count} emails (${r.removed} removed as bounced) ✓`); f.reset(); $('#admin-body').innerHTML = await adminMktPage(); } catch (e) { toast(e.message, true); } },
  async 'mkt-ai'(f) {
    const requestSession = sessionGeneration;
    const button = f.querySelector('button[type="submit"]'); if (button) button.disabled = true;
    try {
      const r = await api('POST', '/api/admin/ai/compose-marketing', { brief: f.brief.value, audience: f.audience.value, tone: f.tone.value });
      if (requestSession !== sessionGeneration) return;
      state.admin.mktDraft = r; const out = $('#mkt-ai-output'); if (out) out.innerHTML = mktDraftHtml(r);
      toast(r.source === 'ai' ? 'Drafts ready — nothing saved or sent.' : 'Template draft ready; configure an AI key for generated copy.');
    } catch (e) { toast(e.message, true); }
    finally { if (button) button.disabled = false; }
  },
  async 'seo-add'(f) { const o = formToObj(f); try { await api('POST', '/api/admin/seo', o); toast('Logged ✓'); f.reset(); $('#admin-body').innerHTML = await adminSeoPage(); } catch (e) { toast(e.message, true); } },
  async 'gads-campaign'(f) { const o = formToObj(f); try { await api('POST', '/api/admin/gads/campaign', o); toast('Campaign added ✓'); f.reset(); $('#admin-body').innerHTML = await adminGadsPage(); } catch (e) { toast(e.message, true); } },
  async 'gads-entry'(f) { try { await api('POST', '/api/admin/gads/entry', { campaignId: f.dataset.id, spend: f.spend.value, impressions: f.impressions.value, clicks: f.clicks.value, results: f.results.value }); closeModal(); toast('Logged ✓'); $('#admin-body').innerHTML = await adminGadsPage(); } catch (e) { toast(e.message, true); } },
  async 'fb-ad'(f) { const o = formToObj(f); o.image = await pickedImage(f).catch(() => ''); try { await api('POST', '/api/admin/fb/ad', o); toast('Creative added ✓'); f.reset(); $('#admin-body').innerHTML = await adminFbPage(); } catch (e) { toast(e.message, true); } },
  async 'fb-entry'(f) { try { await api('POST', '/api/admin/fb/entry', { adId: f.dataset.id, spend: f.spend.value, results: f.results.value, reach: f.reach.value }); closeModal(); toast('Logged ✓'); $('#admin-body').innerHTML = await adminFbPage(); } catch (e) { toast(e.message, true); } },
});

// ---------------- IBO Player panel (spec §7) ----------------
const iboForm = (s) => `<form data-form="ibo-add" class="card"><h3>＋ Add IBO client</h3>
  ${field('Name', 'name', '', { attrs: 'required' })}
  ${field('Contact (Telegram, WhatsApp or email)', 'contact', '', { ph: '@id · +212… · name@email.com', attrs: 'autocomplete="off"' })}
  <h4 style="margin:8px 0 6px">Devices — up to 8, each with its own app and MAC</h4>
  ${iboDevListHtml(state.admin.iboSelected || [])}
  <button type="button" class="btn sm ghost" data-act="ibo-dev-add" ${(state.admin.iboSelected || []).length >= 8 ? 'disabled' : ''}>➕ Add device</button>
  <div class="grid2">${field('DNS / portal (optional)', 'dns', state.admin.settings.player.serverUrl || '', { ph: 'http://dns:8080', attrs: 'autocapitalize="none"' })}${field('Username (optional)', 'username', '', { attrs: 'autocapitalize="none"' })}</div>
  ${field('Password (optional)', 'password', '', { attrs: 'autocapitalize="none"' })}
  <div class="grid2">${field('Duration', 'days', '365', { type: 'select', options: [['365', '1 year'], ['36500', 'Lifetime'], ['1', '1 day (trial)']] })}${field('Note', 'note', '', { ph: 'Order, source…' })}</div>
  <label class="toggle" style="margin:6px 0"><input type="checkbox" name="trial" value="1"><i></i><span>Free 24h trial (no credit used)</span></label>
  <p class="small muted">Each device uses <b>1 IBO credit</b> ($${(state.admin.iboShelf?.costUsd || 3.5).toFixed(2)}) — this client: <b>${Math.max(1, (state.admin.iboSelected || []).length)} device(s)</b>. Lifetime also uses 1 credit per device.</p>
  <button type="submit" class="btn primary block">＋ Add client</button></form>`;
async function adminIboPage() {
  let r; try { r = await api('GET', '/api/admin/ibo'); } catch (e) { return `<div class="err-box">${esc(e.message)}</div>`; }
  state.admin.ibo = r.list; state.admin.iboShelf = r;
  const st = r.stats || {}; const now = Date.now();
  const pillFor = (x) => (x.expiresAt && x.expiresAt <= now) || x.status !== 'active' ? '<span class="pill st-expired">expired</span>' : x.isTrial ? '<span class="pill st-expiring">trial</span>' : '<span class="pill st-active">active</span>';
  const row = (x) => {
    const devs = Array.isArray(x.devices) && x.devices.length ? x.devices : (Array.isArray(x.macs) && x.macs.length ? x.macs.map((m) => ({ deviceApp: x.deviceApp || 'IBO Player', mac: m })) : (x.macAddress ? [{ deviceApp: x.deviceApp || 'IBO Player', mac: x.macAddress }] : []));
    return `<tr><td><b>${esc(x.name)}</b><div class="small muted">${esc(x.contact || '')}</div></td><td class="small">${esc(x.username)} / ${esc(x.password)}<div class="muted">${esc(x.dns || '')}</div></td><td class="small">${devs.map((d) => `${esc(d.deviceApp || '')}<span class="muted"> · ${esc(iboNormMac(d.mac || ''))}</span>`).join('<br>')}${devs.length > 1 ? `<span class="muted small">(${devs.length} devices)</span>` : ''}</td><td class="small">${x.expiresAt ? fmtDate(x.expiresAt) : '—'}</td><td>${pillFor(x)}</td>
      <td><div class="row" style="justify-content:flex-end;gap:6px"><button class="btn sm" data-act="ibo-mac" data-id="${esc(x.id)}" title="Add another MAC address" aria-label="Add another MAC address">➕</button><button class="btn sm" data-act="ibo-activate" data-id="${esc(x.id)}" title="Activate / renew (1 credit)" aria-label="Activate or renew (1 credit)">💳</button><button class="btn sm" data-act="ibo-send" data-id="${esc(x.id)}" data-via="whatsapp" title="Send details by WhatsApp" aria-label="Send details by WhatsApp">💬</button><button class="btn sm" data-act="ibo-send" data-id="${esc(x.id)}" data-via="email" title="Send details by email" aria-label="Send details by email">✉️</button><button class="btn sm danger" data-act="ibo-del" data-id="${esc(x.id)}" title="Remove" aria-label="Remove IBO device">🗑</button></div></td></tr>`; };
  return `<div class="ibo-page">
    ${iboPlayersCard()}
    <div class="grid2" style="gap:16px;align-items:start">
    <div class="card"><h3>💳 IBO credit balance</h3><div class="row" style="gap:16px;align-items:baseline"><div class="stat"><span class="dp-l">Credits</span><div class="big">${r.credits}</div></div><div class="stat"><span class="dp-l">Cost per credit</span><div class="big">$${Number(r.costUsd || 3.5).toFixed(2)}</div></div><div class="stat"><span class="dp-l">Active / trial / expired</span><div class="big">${st.active || 0} / ${st.trial || 0} / ${st.expired || 0}</div></div></div>
      <form data-form="ibo-buy" class="row" style="margin-top:10px;gap:8px;align-items:flex-end"><div style="flex:1">${field('Credits to buy', 'credits', 10, { type: 'number', attrs: 'min="1" required' })}</div><div style="flex:1">${field('Total paid (USD)', 'price', 35, { type: 'number', attrs: 'min="0" step="any"' })}</div><button type="submit" class="btn primary">Buy</button></form>
      <p class="small muted">1 credit = 1-year activation for 1 IBO account · $${Number(r.costUsd || 3.5).toFixed(2)} per credit.</p></div>
    ${iboForm(state.admin.settings)}
    </div>
  </div>
  <div class="card"><h3>📺 IBO clients <span class="small muted">(${(r.list || []).length})</span></h3>
    ${(r.list || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Client</th><th>Login</th><th>Device / MAC</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>${(r.list || []).map(row).join('')}</tbody></table></div>` : '<div class="empty"><span class="ic">📺</span>No IBO clients yet. Add your first one above — or add another MAC to an existing one with ➕.</div>'}</div>`;
}
Object.assign(actions, {
  'ibo-mac': (el) => modal('➕ Add a device to this client', iboMacForm(el.dataset.id)),
  'ibo-dev-add': (el) => { const form = el.closest('form[data-form="ibo-add"]'); const list = form && form.querySelector('.ibo-devlist'); if (!list) return; const n = list.querySelectorAll('.ibo-devrow').length; if (n >= 8) return; list.insertAdjacentHTML('beforeend', iboDevRowHtml(n, {})); iboRowSelect(list.querySelectorAll('.ibo-devrow')[n].querySelector('select[name="deviceApp"]')); },
  'ibo-dev-del': (el) => { el.closest('.ibo-devrow').remove(); },
  'ibo-del': async (el) => { if (!confirm('Remove this IBO client?')) return; el.disabled = true; try { await api('DELETE', '/api/admin/ibo/' + el.dataset.id); $('#admin-body').innerHTML = await adminIboPage(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'ibo-activate': async (el) => { el.disabled = true; try { const r = await api('POST', `/api/admin/ibo/${el.dataset.id}/activate`, {}); toast(`Activated ✓ · ${r.credits} credit${r.credits === 1 ? '' : 's'} left`); $('#admin-body').innerHTML = await adminIboPage(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'ibo-send': async (el) => {
    const via = el.dataset.via; el.disabled = true;
    try {
      const r = await api('POST', `/api/admin/ibo/${el.dataset.id}/send`, { via });
      if (via === 'email') { toast(r.sent ? 'Email sent ✓' : 'Email not sent — check the address and Resend setup', !r.sent); }
      else {
        const waDigits = String(r.wa || '').replace(/\D/g, '');
        const waHref = via === 'whatsapp' && waDigits.length >= 8 ? `https://wa.me/${waDigits}?text=${encodeURIComponent(r.text)}` : '';
        modal('💬 Send to the customer', `<p class="small muted">Copy the message and paste it in ${esc(via === 'telegram' ? 'Telegram' : 'WhatsApp')}:</p><textarea id="ibo-out" style="width:100%;min-height:180px;font-family:inherit" readonly>${esc(r.text)}</textarea><div class="row" style="margin-top:10px"><button class="btn" data-act="copy-el" data-el="ibo-out" style="flex:1">📋 Copy</button>${waHref ? `<a class="btn wa-btn" style="flex:1" target="_blank" rel="noopener" href="${esc(waHref)}">💬 Open WhatsApp</a>` : ''}</div>`);
      }
      el.disabled = false;
    } catch (e) { toast(e.message, true); el.disabled = false; }
  },
});
Object.assign(forms, {
  async 'ibo-mac'(f) { try { const r = await api('POST', '/api/admin/ibo/macs', { id: f.dataset.id, mac: iboNormMac(f.mac.value) }); closeModal(); toast('Device added ✓ — credits multiply by the number of devices.'); $('#admin-body').innerHTML = await adminIboPage(); } catch (e) { toast(e.message, true); } },
  async 'ai-ask'(f) { const q = f.question ? f.question.value : ''; if (f.question) f.question.value = ''; await aiaSend(q); },
  async 'ibo-add'(f) {
    const devs = [...f.querySelectorAll('.ibo-devrow')].map((r) => { const app = r.querySelector('select[name="deviceApp"]').value; const mac = iboNormMac(r.querySelector('input[name="mac"]').value); return mac ? { deviceApp: app, mac } : null; }).filter(Boolean);
    if (!devs.length) return toast('Enter the MAC address of at least one device.', true);
    const o = formToObj(f); delete o.deviceApp; delete o.mac; delete o.macAddress;
    o.devices = devs; o.trial = f.trial && f.trial.checked ? true : undefined;
    try { await api('POST', '/api/admin/ibo', o); toast('Added ✓ — ' + devs.length + ' device(s)'); f.reset(); state.admin.iboSelected = []; $('#admin-body').innerHTML = await adminIboPage(); } catch (e) { toast(e.message, true); }
  },
  async 'ibo-buy'(f) { try { const o = formToObj(f); await api('POST', '/api/admin/ibo/credits', { action: 'buy', credits: o.credits, price: o.price }); toast('Credits added ✓'); f.reset(); $('#admin-body').innerHTML = await adminIboPage(); } catch (e) { toast(e.message, true); } },
  async 'sport-save'(f) { try { const o = formToObj(f); await api('POST', '/api/admin/sports', { id: f.dataset.id, ...o }); closeModal(); toast('Event saved ✓'); await pcRefresh(); } catch (e) { toast(e.message, true); } },
  async 'pc-save'(f) {
    const d = pcFormDraft(f);
    const url = d.id ? '/api/admin/promos/' + encodeURIComponent(d.id) : '/api/admin/promos';
    try {
      await api(d.id ? 'PUT' : 'POST', url, d);
      closeModal(); toast(d.id ? 'Promotion updated ✓' : 'Promotion created ✓'); await pcRefresh();
    } catch (e) { toast(e.message, true); }
  },
});
Object.assign(actions, {
  'sport-edit': (el) => { const e = (state.admin.sports || {}).events.find((x) => x.id === el.dataset.id) || {}; modal('🏆 Sports promo', sportForm(e)); },
  'sport-del': async (el) => { if (!confirm('Delete this sports promo?')) return; el.disabled = true; try { await api('DELETE', '/api/admin/sports/' + encodeURIComponent(el.dataset.id)); toast('Deleted ✓'); $('#admin-body').innerHTML = await adminPromos(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'aia-act': (el) => void aiaAction(el.dataset.action || ''),
});

async function adminReceipts() {
  const list = await api('GET', '/api/admin/receipts'); state.admin.rcs = list; const ui = (state.admin.rc ||= { f: 'pending' });
  const shown = list.filter((x) => ui.f === 'all' || x.status === ui.f); const n = (f) => list.filter((x) => x.status === f).length;
  const tone = { pending: 'st-open', approved: 'st-active', rejected: 'st-expired' };
  return `<p class="small muted">Customers who paid by bank transfer, cash or another way upload a photo of their receipt from the app. Look at the picture and tap Approve: the subscription is extended and the customer is told by email and in the chat.</p>
    <div class="chips">${[['pending', 'To check'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, nm]) => `<a class="${ui.f === k ? 'on' : ''}" data-act="rc-f" data-f="${k}">${nm} · ${k === 'all' ? list.length : n(k)}</a>`).join('')}</div>
    ${shown.length ? shown.map((x) => `<div class="card"><div class="row"><div class="avatar">${esc(initials(x.name))}</div><div style="flex:1;min-width:160px"><b>${esc(x.name)}</b> <span class="pill ${tone[x.status]}">${x.status === 'pending' ? 'to check' : x.status}</span><div class="small muted">${esc(x.username)} · ${fmtDT(x.at)}</div></div><b dir="ltr">${esc(x.amount)} ${esc(x.cur)}</b></div>
      <p style="margin:10px 0 6px"><b>${esc(x.pkgTitle)}</b> · ${esc(x.days)} days · ${esc(x.devices)} device(s)${x.note ? `<br><span class="muted">“${esc(x.note)}”</span>` : ''}${x.reason ? `<br><span class="muted">Reason given: ${esc(x.reason)}</span>` : ''}</p>
      <div class="row"><button class="btn sm" data-act="att-show" data-id="${esc(x.att)}" data-admin="1">📎 Show the receipt</button>${x.status === 'pending' ? `<span class="spacer"></span><button class="btn sm danger" data-act="rc-reject" data-perm="customers_edit" data-id="${esc(x.id)}">Reject</button><button class="btn sm primary" data-act="rc-approve" data-perm="customers_edit" data-id="${esc(x.id)}">Approve</button>` : `<span class="small muted" style="margin-inline-start:auto">${esc(x.by || '')} · ${x.decidedAt ? fmtDT(x.decidedAt) : ''}</span>`}</div></div>`).join('') : `<div class="empty"><span class="ic">🧾</span>${list.length ? 'Nothing in this list.' : 'No receipts yet. Customers send one with “I have paid” under the packages in their app.'}</div>`}`;
}
Object.assign(actions, {
  'sync-panel': async (el) => {
    el.disabled = true;
    try { const r = await syncPanel(); state.admin.customers = null; await renderAdmin(); toast(r.error && !r.changed && r.bad === 0 ? 'The panel could not be checked: ' + r.error : `Checked ${r.total} customers · ${r.changed} updated · ${r.bad} line(s) not working${r.error ? ' · some could not be checked' : ''}`, !!r.error && !r.changed); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  },
  'rc-f': async (el) => { state.admin.rc.f = el.dataset.f; $('#admin-body').innerHTML = await adminReceipts(); },
  'rc-approve': (el) => { const x = (state.admin.rcs || []).find((k) => k.id === el.dataset.id); if (!x) return; const s = state.admin.settings;
    modal('Approve this payment', `<form data-form="rc-approve" data-id="${esc(x.id)}"><p class="muted" style="margin-top:0">${esc(x.name)} · ${esc(x.pkgTitle)}</p><div class="grid3">${field('Days to add', 'days', x.days, { type: 'number', attrs: 'min="1" max="1100" required' })}${field(`Amount received (${s.currency})`, 'amount', '', { type: 'number', attrs: 'min="0" step="0.01"', help: `They paid ${x.amount} ${x.cur}.` })}${field('Received in', 'accountId', '', { type: 'select', options: [['', '—'], ...s.finance.accounts.map((a) => [a.id, `${a.name} (${a.currency})`])] })}</div><div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Approve and extend</button></div></form>`, { wide: true }); },
  'rc-reject': (el) => { modal('Reject this receipt', `<form data-form="rc-reject" data-id="${esc(el.dataset.id)}">${field('Reason the customer will read (optional)', 'reason', '', { type: 'textarea', rows: 2, attrs: 'maxlength="300"', ph: 'e.g. The amount does not match the package.' })}<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn danger">Reject</button></div></form>`); },
  'rc-new': () => { const me = state.user.me; const op = me.orderPackages || [];
    modal('🧾 ' + t('rcTitle'), `<form data-form="rc-new">${field(t('rcPkg'), 'pkg', op[0]?.id || '', { type: 'select', options: op.map((p) => [p.id, `${p.title} · ${priceTxt(p.price, p.cur)}`]) })}<label class="field"><span>${t('rcFile')}</span><input type="file" name="image" accept="image/*" required></label>${field(t('rcNote'), 'note', '', { attrs: 'maxlength="300"' })}<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal">${t('cancel')}</button><button class="btn primary">${t('send')}</button></div></form>`); },
});
Object.assign(forms, {
  async 'rc-new'(f) { const btn = f.querySelector('button.primary'); btn.disabled = true; try { await api('POST', '/api/me/receipt', { pkg: f.pkg.value, note: f.note.value, image: await pickedImage(f) }); closeModal(); modal('🧾 ' + t('rcTitle'), `<div class="notice success">${t('rcSent')}</div><button class="btn block" data-act="close-modal">OK</button>`); if (state.user.tab === 'account') loadAccountExtras(); } catch (e) { btn.disabled = false; toast(tErr(e.message), true); } },
  async 'rc-approve'(f) { try { const r = await api('POST', '/api/admin/receipts/decide', { id: f.dataset.id, action: 'approve', days: f.days.value, amount: f.amount.value, accountId: f.accountId.value }); closeModal(); toast('Approved · customer told ✓'); if (r.panelNote) toast('Renew the line on your panel too: the panel answered “' + r.panelNote + '”', true); $('#admin-body').innerHTML = await adminReceipts(); } catch (e) { toast(e.message, true); } },
  async 'rc-reject'(f) { try { await api('POST', '/api/admin/receipts/decide', { id: f.dataset.id, action: 'reject', reason: f.reason.value }); closeModal(); toast('Rejected · customer told'); $('#admin-body').innerHTML = await adminReceipts(); } catch (e) { toast(e.message, true); } },
});

// Tells the dashboard when the TV server refuses a request, so the owner sees the real reason (at most once every 10 minutes).
let lastPlayReport = 0;
function reportPlayErr(action, e) {
  if (!e || e.switching || e.direct || state.user.me?.stream?.custom || Date.now() - lastPlayReport < 600000) return; lastPlayReport = Date.now();
  const route = bridge() ? 'app' : location.protocol === 'http:' ? 'direct' : state.user.me?.stream?.relay ? 'relay' : 'none';
  api('POST', '/api/me/report', { action, status: e.status || 0, message: String(e.message || '').slice(0, 120), route }).catch(() => {});
}

setTimeout(() => { // Watchdog: if the boot did not finish in 8s, show a clear message instead of an endless spinner
  if (document.querySelector('#app .boot') || document.querySelector('#app .boot .spinner')) {
    __diagSend({ kind: 'boot-timeout', msg: 'no route() after 8s' });
    $('#app').innerHTML = `<div class="block-screen"><div class="ic">📡</div><h2>Can’t reach INTPROTO-TV right now</h2><p class="muted" style="max-width:340px">Please check your internet connection or VPN, then try again. If it keeps happening, your network may be blocking Cloudflare Workers.</p><button class="btn primary" onclick="location.reload()">Retry</button></div>`;
  }
}, 8000);
// Translator: the panel, a text, chat and web pages. The hub is opened from the
// top bar; its actions are registered here so they exist before the first render.
const TR = createTranslator({
  toast, modal, closeModal, actions,
  getState: () => state,
  renderAdmin,
  isAdmin: () => isAdminUI(),
});
Object.assign(actions, TR.actions);

boot().catch((e) => {
  __diagSend({ kind: 'boot-throw', msg: String((e && e.message) || e || '').slice(0, 300) });
  const el = document.getElementById('app');
  if (el) el.innerHTML = `<div class="block-screen"><div class="ic">⚠️</div><h2>The app failed to start</h2><p class="muted" style="max-width:320px">${esc(String((e && e.message) || e || 'Unknown error').slice(0, 200))}</p><button class="btn primary" onclick="location.reload()">Retry</button></div>`;
});
// Credits stock form: show "Amount paid now" only for a partly paid batch
document.addEventListener('change', (e) => { const el = e.target; if (el && el.name === 'paid' && el.closest('[data-form=stock]')) { const b = document.getElementById('stock-part'); if (b) b.style.display = el.value === 'part' ? '' : 'none'; } });

Object.assign(actions, {
  'app-dev': (el) => { APP_DEV.pick = el.dataset.k; const box = $('#app-dev'); if (box) box.outerHTML = devicePicker(); },
  'app-copy': async () => { const link = location.origin + '/app'; try { await navigator.clipboard.writeText(link); } catch { const ta = document.createElement('textarea'); ta.value = link; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); } toast(t('apCopied')); },
});

Object.assign(actions, {
  'rm-save': async () => { const f = $('[data-form=rm]'); const o = formToObj(f); o.auto = f.auto.checked; try { await saveSettings({ renewModels: o }); toast('Renewal emails saved ✓'); } catch (e) { toast(e.message, true); } },
  'rm-preview': async (el, ev, lang) => { const m = el.dataset.m; const L = lang || getLang() || 'en';
    try { const r = await api('GET', `/api/admin/renewmodels/preview?model=${m}&lang=${L}&appUrl=${encodeURIComponent(location.origin)}`);
      const body = modal('👁 ' + esc(r.subject), `<div class="chips" style="margin-bottom:10px;flex-wrap:wrap">${LANGS.map(([k, n]) => `<a data-act="rm-lang" data-m="${m}" data-l="${k}" class="${k === L ? 'on' : ''}">${LANG_FLAG[k]} ${n}</a>`).join('')}</div><iframe id="rm-frame" sandbox="" style="width:100%;height:65vh;border:0;border-radius:12px;background:#f4f7fa"></iframe>`, { wide: true });
      $('#rm-frame', body).srcdoc = r.html; } catch (e) { toast(e.message, true); } },
  'rm-lang': (el) => { closeModal(); actions['rm-preview']({ dataset: { m: el.dataset.m } }, null, el.dataset.l); },
  'rm-send': (el) => { const m = el.dataset.m;
    modal('📤 Send renewal email', `<form onsubmit="return false"><p class="small muted">Each customer gets it in their own language and currency, with their renewal link.</p>${field('Send to', 'aud', 'd7', { type: 'select', options: [['d7', '⏰ Ending in the next 7 days'], ['today', '⚠️ Ending in the next 24 hours'], ['expired', '🎁 Ended in the last 30 days'], ['expired90', '🎁 Ended in the last 90 days']] })}
      <div class="row"><span class="spacer"></span><button class="btn primary" data-act="rm-send-go" data-m="${m}">📤 Send</button></div></form>`); },
  'rm-send-go': async (el) => { const aud = el.closest('form').aud.value; if (!confirm('Send this renewal email now?')) return; el.disabled = true;
    try { const r = await api('POST', '/api/admin/renewmodels/send', { model: el.dataset.m, audience: aud, appUrl: location.origin }); toast(`Sent to ${r.sent} customer(s)${r.failed ? ` · ${r.failed} failed` : ''} ✓`); closeModal(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'rm-test': async (el) => { try { const r = await api('POST', '/api/admin/renewmodels/send', { model: el.dataset.m, test: true, lang: getLang(), appUrl: location.origin }); toast(`Test sent to ${r.to} ✓`); } catch (e) { toast(e.message, true); } },
});

Object.assign(actions, {
  'checkin-go': async (el) => { el.disabled = true; try { await api('POST', '/api/admin/attendance', { action: 'in', note: ($('#ci-note')?.value || '').trim() }); state.admin.me = null; toast('Checked in ✓ Have a good shift'); renderAdmin(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'att-edit': (el) => { const at = new Date(Number(el.dataset.at)); const iso = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    modal('✏️ Edit attendance', `<form onsubmit="return false" data-id="${esc(el.dataset.id)}">${field('Action', 'action', el.dataset.action, { type: 'select', options: [['in', 'Check in'], ['out', 'Check out'], ['break_start', 'Break start'], ['break_end', 'Break end'], ['login', 'Login']] })}${field('Time', 'at', iso, { type: 'datetime-local' })}${field('Note', 'note', el.dataset.note || '')}
      <div class="row"><button type="button" class="btn danger" data-act="att-del" data-id="${esc(el.dataset.id)}">🗑 Delete</button><span class="spacer"></span><button class="btn primary" data-act="att-save">💾 Save</button></div></form>`); },
  'att-save': async (el) => { const f = el.closest('form'); try { await api('PUT', '/api/admin/attendance/' + f.dataset.id, { action: f.action.value, at: new Date(f.at.value).toISOString(), note: f.note.value }); toast('Saved ✓'); closeModal(); renderAdmin(); } catch (e) { toast(e.message, true); } },
  'att-del': async (el) => { if (!confirm('Delete this attendance entry?')) return; try { await api('DELETE', '/api/admin/attendance/' + el.dataset.id); toast('Deleted'); closeModal(); renderAdmin(); } catch (e) { toast(e.message, true); } },
  'att-add': async () => { let team = []; try { team = await api('GET', '/api/admin/team'); } catch {} const iso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    modal('➕ Add attendance entry', `<form onsubmit="return false">${field('Agent', 'memberId', team[0]?.id || '', { type: 'select', options: team.map((m) => [m.id, m.name]) })}${field('Action', 'action', 'in', { type: 'select', options: [['in', 'Check in'], ['out', 'Check out'], ['break_start', 'Break start'], ['break_end', 'Break end']] })}${field('Time', 'at', iso, { type: 'datetime-local' })}${field('Note', 'note', '')}<div class="row"><span class="spacer"></span><button class="btn primary" data-act="att-add-go">➕ Add</button></div></form>`); },
  'att-add-go': async (el) => { const f = el.closest('form'); try { await api('POST', '/api/admin/attendance/add', { memberId: f.memberId.value, action: f.action.value, at: new Date(f.at.value).toISOString(), note: f.note.value }); toast('Added ✓'); closeModal(); renderAdmin(); } catch (e) { toast(e.message, true); } },
});
// ---------------- alert sounds for agents: support requests, waiting line (trials / lines), live chat, payments ----------------
const SND = { last: null, lastRemind: 0, ctx: null };
const SND_STYLES = { chime: [[659, .18], [523, .32]], rise: [[523, .12], [659, .12], [784, .26]], pop: [[880, .09]], coin: [[988, .08], [1319, .22]], alarm: [[880, .15], [660, .15], [880, .15], [660, .3]], bell: [[1047, .5]] };
const SND_KINDS = [['support', '🛟 Support request', 'chime'], ['trials', '🎁 Free trial waiting', 'rise'], ['waitLine', '⏳ Customer waiting for a line', 'alarm'], ['chat', '💬 Live chat message', 'pop'], ['receipts', '🧾 Payment receipt', 'coin'], ['buy', '🛒 Package request', 'bell']];
const sndCfg = () => { let c = {}; try { c = JSON.parse(localStorage.getItem('tvp_snd') || '{}'); } catch {} return { on: true, vol: 0.6, voice: true, remind: 3, ...c, kinds: { ...Object.fromEntries(SND_KINDS.map(([k, , d]) => [k, d])), ...(c.kinds || {}) } }; };
const sndSave = (c) => { try { localStorage.setItem('tvp_snd', JSON.stringify(c)); } catch {} };
document.addEventListener('pointerdown', () => { try { if (!SND.ctx) SND.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (SND.ctx.state === 'suspended') SND.ctx.resume(); } catch {} }, { passive: true });
function playTone(style, vol) {
  try { const ctx = SND.ctx || (SND.ctx = new (window.AudioContext || window.webkitAudioContext)()); let t0 = ctx.currentTime + 0.02;
    for (const [f, d] of SND_STYLES[style] || SND_STYLES.chime) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = style === 'alarm' ? 'square' : 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.01, vol) * (style === 'alarm' ? 0.35 : 0.8), t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + d + 0.05); t0 += d * 0.9; }
  } catch {}
}
const SND_SAY = { en: { support: 'New support request', trials: 'A customer is waiting for a free trial', waitLine: 'A customer is waiting for a line', chat: 'New chat message', receipts: 'New payment receipt', buy: 'New package request' },
  fr: { support: 'Nouvelle demande de support', trials: 'Un client attend un essai gratuit', waitLine: 'Un client attend une ligne', chat: 'Nouveau message', receipts: 'Nouveau reçu de paiement', buy: 'Nouvelle demande de forfait' },
  ar: { support: 'طلب دعم جديد', trials: 'عميل ينتظر تجربة مجانية', waitLine: 'عميل ينتظر خطاً', chat: 'رسالة دردشة جديدة', receipts: 'إيصال دفع جديد', buy: 'طلب باقة جديد' } };
function sayAlert(kind) { try { const lang = (state.admin.me && state.admin.me.lang) || 'en'; const L = SND_SAY[lang] || SND_SAY.en; const u = new SpeechSynthesisUtterance(L[kind] || SND_SAY.en[kind]); u.lang = { fr: 'fr-FR', ar: 'ar-SA' }[lang] || 'en-US'; u.volume = sndCfg().vol; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {} }
function sndAlert(kind, voice = true) { const c = sndCfg(); if (!c.on) return; playTone(c.kinds[kind] || 'chime', c.vol); if (c.voice && voice) setTimeout(() => sayAlert(kind), 900); }
async function sndPoll() {
  if (!state.token || !isAdminUI() || !state.admin.me || state.admin.me.mustCheckIn || !can('customers_view')) return;
  let w; try { w = await api('GET', '/api/admin/waiting'); } catch { return; }
  const prev = SND.last; SND.last = w; const c = sndCfg(); const kinds = SND_KINDS.map((k) => k[0]);
  const waitingNow = kinds.filter((k) => (w[k] || 0) > 0); document.title = (waitingNow.length ? `(${kinds.reduce((a, k) => a + (w[k] || 0), 0)}) ` : '') + (state.config?.branding?.appName || 'INTPROTO-TV');
  if (!prev) { if (waitingNow.length) { sndAlert(waitingNow[0], false); SND.lastRemind = Date.now(); } return; }
  const up = kinds.find((k) => (w[k] || 0) > (prev[k] || 0));
  if (up) { sndAlert(up); SND.lastRemind = Date.now(); toast(`${(SND_KINDS.find((x) => x[0] === up) || [])[1] || 'New'} · ${w[up]} waiting`); return; }
  if (waitingNow.length && c.remind > 0 && Date.now() - SND.lastRemind >= c.remind * 60000 && ['support', 'trials', 'waitLine'].some((k) => w[k] > 0)) { sndAlert(['support', 'trials', 'waitLine'].find((k) => w[k] > 0)); SND.lastRemind = Date.now(); }
}
setInterval(sndPoll, 15000);
Object.assign(actions, {
  'snd-open': () => { const c = sndCfg();
    modal('🔊 Alert sounds', `<form data-form="snd" onsubmit="return false"><p class="small muted" style="margin-top:0">Sounds play on this device when a customer is waiting. Keep this tab open (it can be in the background).</p>
      <div class="row" style="gap:16px;flex-wrap:wrap">${toggle('Sounds on', 'on', c.on)}${toggle('Spoken alert (voice)', 'voice', c.voice)}</div>
      <div class="grid2">${field('Volume', 'vol', Math.round(c.vol * 100), { type: 'number', attrs: 'min="5" max="100" step="5"' })}${field('Remind while customers wait (minutes, 0 = off)', 'remind', c.remind, { type: 'number', attrs: 'min="0" max="30"' })}</div>
      ${SND_KINDS.map(([k, n]) => `<div class="row" style="gap:8px;align-items:center;margin:6px 0"><span style="flex:1">${n}</span><select name="k_${k}" style="width:auto">${Object.keys(SND_STYLES).map((st) => `<option value="${st}" ${c.kinds[k] === st ? 'selected' : ''}>${st}</option>`).join('')}</select><button type="button" class="btn sm" data-act="snd-test" data-k="${k}">▶️ Test</button></div>`).join('')}
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn primary" data-act="snd-save">💾 Save</button></div></form>`); },
  'snd-test': (el) => { const f = el.closest('form'); const st = f['k_' + el.dataset.k].value; playTone(st, (Number(f.vol.value) || 60) / 100); if (f.voice.checked) setTimeout(() => sayAlert(el.dataset.k), 900); },
  'snd-save': (el) => { const f = el.closest('form'); const c = { on: f.on.checked, voice: f.voice.checked, vol: Math.min(1, Math.max(0.05, (Number(f.vol.value) || 60) / 100)), remind: Math.max(0, Number(f.remind.value) || 0), kinds: Object.fromEntries(SND_KINDS.map(([k]) => [k, f['k_' + k].value])) }; sndSave(c); toast('Alert sounds saved ✓'); closeModal(); renderAdmin(); },
});
// ---------------- Agent guide: how the panel works (text, screenshots and short videos), in the agent's language ----------------
const GUIDE = {
  en: { title: 'Agent guide — how the panel works', intro: 'Read this once before your first shift. Screenshots and short videos show each step.', sec: [
    ['🟢', 'Start and end your shift', ['Sign in with your username and password (and the 6-digit code if two-step sign-in is on).', 'Tap <b>Check in & open the panel</b>. Nothing opens before you check in: this records your working hours.', 'Take a break with <b>☕ Break</b> in Attendance, and tap <b>Check out</b> when you finish.', 'For security you are <b>signed out automatically after 6 hours</b> (the ⏱ timer at the top shows the time left). Sign in and check in again to continue.'], 'checkin.png', 'checkin.webm'],
    ['👥', 'Find a customer', ['Open <b>Customers</b> and type in the search box: name, username, phone, email or <b>order number</b>.', 'Use the chips (Active, Expiring, Expired, Trial, 🛒 requests) to filter.', 'Tap a customer to open the profile: subscription, lines, devices and history.'], 'customers.png'],
    ['🔁', 'Renew, change the end date, contact', ['<b>🔁 Renew</b>: pick the plan, the price and the account that received the money.', '<b>📅 Expiry</b>: set an exact end date, add days, end now, or no end date.', '<b>📧 Email</b>, <b>💬 WhatsApp</b> (Telegram is inside the same window) and <b>🔔 App notification</b> send ready messages in the customer\'s language and currency, with the right payment link.'], 'profile.png', 'renew.webm'],
    ['🎁', 'Free trials and customers waiting for a line', ['<b>Trial queue</b>: claim a request, paste the M3U link from the panel and send. The customer gets the login by email.', '<b>Alerts → Waiting for a line</b>: tap Edit, paste the M3U link and save. The 24 hours start then.'], 'trialq.png'],
    ['🛟', 'Support requests and live chat', ['New requests ring a sound and show a notification. Open <b>Support requests</b>, read, reply, then close the request.', 'Live chat messages appear in <b>Live chat</b> with a red badge.'], 'support.png'],
    ['🛒', 'Package requests and payments', ['When a customer taps <b>Request</b>, the payment link is emailed to them automatically. You see it under <b>🛒 requests</b>.', 'Check payment receipts in <b>Receipts</b> and approve or reject them.'], ''],
    ['🔊', 'Alert sounds', ['Tap <b>🔊</b> at the top to choose a sound for each alert, the volume, the spoken alert and a reminder while customers wait.', 'Keep the panel tab open (it can stay in the background) so you hear new customers.'], 'sounds.png'],
     ['🤝', 'Referrals, gifts and planning', ['A customer who refers a friend earns free days for the referrer, never a discount on the buyer: 30 days for a 1-year plan, 90 days for the 2-device 1-year ($109.99), 180 days for the 4-device 1-year ($139.99).', 'Customers see 1/3/6 months free or 10%/20% discount gifts. Resellers only see 10%/20% discount on credit packs — never free months.', 'Lifetime plans are fixed: Lifetime Standard · 1 Device $499.95 and Lifetime VIP · 4 Devices $999.95. Do not discount them.', 'Owner planning is synced through December 2027. Use <b>Planning overview</b> to read the shared schedule; the owner can tap <b>📣 Notify agents</b> to re-send the notice.'], ''],
     ['🔐', 'Rules', ['Never share customer data. Copying text from the panel is turned off for agents.', 'API keys, email marketing, list uploads, sender names, SEO and ads are managed only by the owner and the Technical Service.', 'Problem? Tap <b>🐞 Report</b> at the top.'], ''] ] },
  fr: { title: 'Guide agent — fonctionnement du panneau', intro: 'Lisez ce guide avant votre premier service. Captures et courtes vidéos montrent chaque étape.', sec: [
    ['🟢', 'Début et fin de service', ['Connectez-vous avec votre identifiant et mot de passe (et le code à 6 chiffres si la double authentification est active).', 'Touchez <b>Check in & open the panel</b>. Rien ne s’ouvre avant le pointage : cela enregistre vos heures.', 'Pause avec <b>☕ Break</b> dans Attendance, puis <b>Check out</b> à la fin.', 'Par sécurité vous êtes <b>déconnecté automatiquement après 6 heures</b> (le minuteur ⏱ en haut affiche le temps restant). Reconnectez-vous et pointez à nouveau.'], 'checkin.png', 'checkin.webm'],
    ['👥', 'Trouver un client', ['Ouvrez <b>Customers</b> et tapez : nom, identifiant, téléphone, e-mail ou <b>numéro de commande</b>.', 'Les filtres (Active, Expiring, Expired, Trial, 🛒 requests) affinent la liste.', 'Touchez un client pour ouvrir sa fiche : abonnement, lignes, appareils, historique.'], 'customers.png'],
    ['🔁', 'Renouveler, date de fin, contacter', ['<b>🔁 Renew</b> : choisissez l’offre, le prix et le compte qui a reçu l’argent.', '<b>📅 Expiry</b> : date exacte, ajouter des jours, terminer maintenant ou sans fin.', '<b>📧 Email</b>, <b>💬 WhatsApp</b> (Telegram dans la même fenêtre) et <b>🔔 notification</b> envoient des messages prêts dans la langue et la devise du client, avec le bon lien de paiement.'], 'profile.png', 'renew.webm'],
    ['🎁', 'Essais gratuits et clients en attente', ['<b>Trial queue</b> : prenez la demande, collez le lien M3U du panel et envoyez.', '<b>Alerts → Waiting for a line</b> : Edit, collez le lien M3U et enregistrez. Les 24 h commencent alors.'], 'trialq.png'],
    ['🛟', 'Support et chat en direct', ['Chaque nouvelle demande sonne et affiche une notification. Ouvrez <b>Support requests</b>, répondez puis fermez.', 'Les messages du chat arrivent dans <b>Live chat</b> avec un badge rouge.'], 'support.png'],
    ['🛒', 'Demandes de forfait et paiements', ['Quand un client touche <b>Demander</b>, le lien de paiement lui est envoyé automatiquement par e-mail.', 'Vérifiez les reçus dans <b>Receipts</b> et approuvez ou refusez.'], ''],
    ['🔊', 'Sons d’alerte', ['Touchez <b>🔊</b> en haut pour choisir un son par alerte, le volume, la voix et un rappel tant que des clients attendent.', 'Gardez l’onglet du panneau ouvert (même en arrière-plan).'], 'sounds.png'],
     ['🤝', 'Parrainage, cadeaux et planning', ['Un client qui parraine un ami reçoit des jours gratuits pour lui-même, jamais une réduction sur l’achat : 30 jours pour un forfait 1 an, 90 jours pour le 1 an 2 appareils (109,99 $), 180 jours pour le 1 an 4 appareils (139,99 $).', 'Les clients voient 1/3/6 mois offerts ou 10 %/20 % de réduction. Les revendeurs ne voient que 10 %/20 % de réduction sur les packs de crédits — jamais de mois gratuits.', 'Les forfaits Lifetime sont fixes : Lifetime Standard · 1 appareil 499,95 $ et Lifetime VIP · 4 appareils 999,95 $.', 'Le planning du propriétaire est synchronisé jusqu’en décembre 2027. Utilisez <b>Planning overview</b> pour lire le calendrier partagé ; le propriétaire peut toucher <b>📣 Notify agents</b> pour renvoyer l’avis.'], ''],
     ['🔐', 'Règles', ['Ne partagez jamais les données clients. La copie de texte est désactivée pour les agents.', 'Clés API, e-mail marketing, imports de listes, noms d’expéditeur, SEO et publicités : uniquement le propriétaire et le Service technique.', 'Un problème ? Touchez <b>🐞 Report</b>.'], ''] ] },
  ar: { title: 'دليل الموظف — كيف تعمل لوحة التحكم', intro: 'اقرأ هذا الدليل قبل أول مناوبة. الصور والفيديوهات القصيرة توضح كل خطوة.', sec: [
    ['🟢', 'بداية ونهاية المناوبة', ['سجّل الدخول باسم المستخدم وكلمة المرور (والرمز المكوّن من 6 أرقام إذا كان التحقق بخطوتين مفعّلاً).', 'اضغط <b>Check in & open the panel</b>. لا يُفتح شيء قبل تسجيل الحضور: هكذا تُحسب ساعات عملك.', 'للاستراحة اضغط <b>☕ Break</b> في Attendance، وفي النهاية اضغط <b>Check out</b>.', 'للأمان يتم <b>تسجيل خروجك تلقائياً بعد 6 ساعات</b> (المؤقت ⏱ في الأعلى يعرض الوقت المتبقي). سجّل الدخول وسجّل الحضور من جديد للمتابعة.'], 'checkin.png', 'checkin.webm'],
    ['👥', 'البحث عن عميل', ['افتح <b>Customers</b> واكتب في خانة البحث: الاسم أو اسم المستخدم أو الهاتف أو البريد أو <b>رقم الطلب</b>.', 'استعمل الفلاتر (Active، Expiring، Expired، Trial، 🛒 requests).', 'اضغط على العميل لفتح ملفه: الاشتراك والخطوط والأجهزة والسجل.'], 'customers.png'],
    ['🔁', 'التجديد وتاريخ الانتهاء والتواصل', ['<b>🔁 Renew</b>: اختر الباقة والسعر والحساب الذي استلم المبلغ.', '<b>📅 Expiry</b>: تاريخ محدد، إضافة أيام، إنهاء الآن، أو بدون تاريخ انتهاء.', '<b>📧 Email</b> و<b>💬 WhatsApp</b> (تيليغرام في نفس النافذة) و<b>🔔 إشعار التطبيق</b> ترسل رسائل جاهزة بلغة العميل وعملته مع رابط الدفع الصحيح.'], 'profile.png', 'renew.webm'],
    ['🎁', 'التجارب المجانية والعملاء المنتظرون', ['<b>Trial queue</b>: خذ الطلب، الصق رابط M3U من اللوحة وأرسل. يصل للعميل بريد بمعلومات الدخول.', '<b>Alerts → Waiting for a line</b>: اضغط Edit، الصق رابط M3U واحفظ. تبدأ الـ24 ساعة عندها.'], 'trialq.png'],
    ['🛟', 'طلبات الدعم والدردشة المباشرة', ['كل طلب جديد يصدر صوتاً وإشعاراً. افتح <b>Support requests</b> واقرأ ورد ثم أغلق الطلب.', 'رسائل الدردشة تظهر في <b>Live chat</b> مع شارة حمراء.'], 'support.png'],
    ['🛒', 'طلبات الباقات والمدفوعات', ['عندما يضغط العميل <b>طلب</b>، يصله رابط الدفع تلقائياً بالبريد. تجده في <b>🛒 requests</b>.', 'راجع إيصالات الدفع في <b>Receipts</b> واقبلها أو ارفضها.'], ''],
    ['🔊', 'أصوات التنبيه', ['اضغط <b>🔊</b> في الأعلى لاختيار صوت لكل تنبيه، ومستوى الصوت، والتنبيه الصوتي المنطوق، والتذكير أثناء انتظار العملاء.', 'اترك تبويب اللوحة مفتوحاً (ولو في الخلفية) لتسمع العملاء الجدد.'], 'sounds.png'],
     ['🤝', 'الإحالة والهدايا والتخطيط', ['العميل الذي يحيل صديقاً يحصل على أيام مجانية له هو، وليس خصماً على المشتري: 30 يوماً لخطة سنة واحدة، و90 يوماً لخطة جهازين/سنة (109.99$)، و180 يوماً لخطة 4 أجهزة/سنة (139.99$).', 'يرى العملاء هدايا 1/3/6 أشهر مجانية أو خصم 10%/20%. يرى الوكلاء خصم 10%/20% فقط على حزم الرصيد — ولا أشهر مجانية.', 'أسعار Lifetime ثابتة: Lifetime Standard · جهاز واحد 499.95$ وLifetime VIP · 4 أجهزة 999.95$.', 'تخطيط المالك متزامن حتى ديسمبر 2027. استخدم <b>Planning overview</b> لقراءة الجدول المشترك، ويمكن للمالك الضغط على <b>📣 Notify agents</b> لإعادة إرسال الإشعار.'], ''],
     ['🔐', 'القواعد', ['لا تشارك بيانات العملاء أبداً. نسخ النصوص من اللوحة معطّل للموظفين.', 'مفاتيح API والتسويق بالبريد ورفع القوائم وأسماء المرسل وSEO والإعلانات: للمالك والخدمة التقنية فقط.', 'مشكلة؟ اضغط <b>🐞 Report</b> في الأعلى.'], ''] ] } };
function agentGuide() {
  const me = state.admin.me || {}; const lang = GUIDE[me.lang] ? me.lang : 'en'; const G = GUIDE[lang]; const rtl = lang === 'ar';
  const tabs = Object.keys(GUIDE).map((k) => `<a data-act="guide-lang" data-l="${k}" class="${k === lang ? 'on' : ''}">${{ en: '🇬🇧 English', fr: '🇫🇷 Français', ar: '🇸🇦 العربية' }[k]}</a>`).join('');
  return `<div dir="${rtl ? 'rtl' : 'ltr'}" class="guide"><div class="card"><h2 style="margin-top:0">🎓 ${esc(G.title)}</h2><p class="muted">${esc(G.intro)}</p><div class="chips">${tabs}</div>
    <div class="chips" style="margin-top:10px;flex-wrap:wrap">${G.sec.map(([ic, h], i) => `<a href="#g${i}" class="allow-copy">${ic} ${esc(h)}</a>`).join('')}</div></div>
    ${G.sec.map(([ic, h, steps, img, vid], i) => `<div class="card guide-sec" id="g${i}" style="margin-top:14px"><h3 style="margin-top:0">${ic} ${i + 1}. ${esc(h)}</h3><ol style="line-height:1.7;padding-inline-start:20px">${steps.map((x) => `<li>${x}</li>`).join('')}</ol>
      ${img || vid ? `<div class="grid2" style="gap:12px;align-items:start">${img ? `<a href="/guide/${img}" target="_blank" rel="noopener"><img src="/guide/${img}" alt="${esc(h)}" loading="lazy" style="width:100%;border-radius:12px;border:1px solid var(--border)"></a>` : ''}${vid ? `<video src="/guide/${vid}" controls playsinline preload="metadata" style="width:100%;border-radius:12px;border:1px solid var(--border);background:#000"></video>` : ''}</div>` : ''}</div>`).join('')}</div>`;
}
Object.assign(actions, {
  'guide-lang': async (el) => { state.admin.me = state.admin.me || {}; state.admin.me.lang = el.dataset.l; const g = el.closest('.guide'); if (g) g.outerHTML = agentGuide(); },
  'guide-open': (el, e) => { e && e.preventDefault(); const body = modal('🎓 Agent guide', agentGuide(), { wide: true }); void body; },
});

// ---------------- reseller tools: client subscription tracker + prices & contact ----------------
const RCL = { q: '', f: 'all' };
const rMoney = (n) => { const c = RSL.tools?.shop?.currency || RSL.d?.currency || 'EUR'; const sg = { EUR: '€', USD: '$', GBP: '£' }[c]; return sg ? sg + Number(n || 0).toFixed(2) : Number(n || 0).toFixed(2) + ' ' + c; };
const rHow = (title, steps) => `<details class="card" style="margin-bottom:12px" ${localStorage.getItem('tvp_rhow_' + title) ? '' : 'open'} data-act="rhow-toggle" data-k="${esc(title)}"><summary style="cursor:pointer;font-weight:700">💡 ${esc(title)}</summary><ol style="margin:8px 0 0;padding-inline-start:20px;line-height:1.7">${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>`;
function rslClients() {
  const T = RSL.tools; const st = T.stats; const q = RCL.q.toLowerCase();
  const list = T.clients.filter((x) => (RCL.f === 'all' || x.state === RCL.f) && (!q || [x.name, x.phone, x.email, x.username, x.plan].join(' ').toLowerCase().includes(q)));
  const badge = (x) => x.state === 'expired' ? `<span class="pill st-expired">${esc(t('cl_ended', { n: Math.abs(x.daysLeft) }))}</span>` : `<span class="pill st-${x.state}">${esc(t('cl_left', { n: x.daysLeft }))}</span>`;
  const card = (x) => `<div class="card cl-card cl-${x.state}" style="margin:0 0 10px;padding:14px"><div class="row" style="gap:8px;flex-wrap:wrap"><b style="flex:1;min-width:140px">${esc(x.name)}</b>${badge(x)}${x.paid ? '' : `<span class="badge bad">${esc(t('cl_unpaid'))}</span>`}</div>
    <div class="small muted" style="margin:6px 0 10px">${esc(pkgName(x.plan) || '')}${x.plan ? ' · ' : ''}${esc(t('cl_endsOn', { date: fmtDate(x.endAt) }))}${x.price ? ' · ' + esc(rMoney(x.price)) : ''}${x.phone ? ' · <span dir="ltr">' + esc(x.phone) + '</span>' : ''}${x.username ? ' · ' + esc(x.username) : ''}${x.note ? '<br>📝 ' + esc(x.note) : ''}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm primary" data-act="cl-renew" data-id="${x.id}">${esc(t('cl_renew'))}</button>${x.phone ? `<button class="btn sm wa-btn" data-act="cl-remind" data-id="${x.id}">${esc(t('cl_remind'))}</button>` : ''}${x.email ? `<button class="btn sm" data-act="cl-appmail" data-id="${x.id}">${esc(t('cl_appMail'))}</button>` : ''}<button class="btn sm" data-act="cl-edit" data-id="${x.id}">${esc(t('cl_edit'))}</button><button class="btn sm ghost" data-act="cl-del" data-id="${x.id}" aria-label="delete">🗑</button></div></div>`;
  return `${rHow(t('cl_howT'), [t('cl_how1'), t('cl_how2'), t('cl_how3'), t('cl_how4')])}
    <div class="stats"><div class="stat"><span>${esc(t('cl_total'))}</span><b>${st.total}</b></div><div class="stat c-ok"><span>${esc(t('st_active'))}</span><b>${st.active}</b></div><div class="stat c-warn"><span>${esc(t('st_expiring'))}</span><b>${st.expiring}</b></div><div class="stat c-bad"><span>${esc(t('st_expired'))}</span><b>${st.expired}</b></div><div class="stat"><span>${esc(t('cl_income'))}</span><b>${esc(rMoney(st.monthIncome))}</b></div></div>
    <div class="row" style="gap:8px;margin:12px 0;flex-wrap:wrap"><input style="flex:1;min-width:180px" placeholder="${esc(t('cl_search'))}" value="${esc(RCL.q)}" data-input="cl-q"><button class="btn primary" data-act="cl-add">${esc(t('cl_add'))}</button></div>
    <div class="chips" style="margin-bottom:12px">${[['all', t('cl_all')], ['expiring', t('st_expiring')], ['expired', t('st_expired')], ['active', t('st_active')]].map(([k, n]) => `<a data-act="cl-f" data-f="${k}" class="${RCL.f === k ? 'on' : ''}">${esc(n)}</a>`).join('')}</div>
    <div id="cl-list">${list.length ? list.map(card).join('') : `<div class="card"><p class="muted" style="margin:0">${esc(t('cl_empty'))}</p></div>`}</div>`;
}
function clForm(x = {}) {
  const pr = RSL.tools.shop.prices; const iso = (ms) => ms ? new Date(ms).toISOString().slice(0, 10) : '';
  return `<form data-form="cl" data-id="${esc(x.id || '')}" onsubmit="return false">${field(t('cl_name'), 'name', x.name || '', { attrs: 'required' })}
    <div class="grid2">${field(t('cl_phone'), 'phone', x.phone || '', { attrs: 'dir="ltr" inputmode="tel"', ph: '+33 6…' })}${field(t('cl_email'), 'email', x.email || '', { type: 'email', attrs: 'dir="ltr"' })}</div>
    <div class="grid2">${field(t('cl_user'), 'username', x.username || '', { attrs: 'dir="ltr" autocapitalize="none"' })}${field(t('cl_device'), 'device', x.device || '')}</div>
    ${field(t('cl_plan'), 'pick', '', { type: 'select', options: [['', '—'], ...pr.map((p) => [p.id, `${pkgName(p.label)}${p.price ? ' · ' + rMoney(p.price) : ''}`]), ['custom', t('cl_custom')]] })}
    <div class="grid3">${field(t('cl_plan'), 'plan', x.plan || '')}${field(t('cl_months'), 'months', x.months || 1, { type: 'number', attrs: 'min="0" max="60"' })}${field(t('cl_price'), 'price', x.price || '', { type: 'number', attrs: 'step="any" min="0"' })}</div>
    <div class="grid2">${field(t('cl_start'), 'startAt', iso(x.startAt || Date.now()), { type: 'date' })}${field(t('cl_end'), 'endAt', iso(x.endAt), { type: 'date' })}</div>
    ${toggle(t('cl_paid'), 'paid', x.paid !== false)}${field(t('cl_note'), 'note', x.note || '')}
    <div class="row"><span class="spacer"></span><button class="btn primary" data-act="cl-save">${esc(t('cl_save'))}</button></div></form>`;
}
function rslShop() {
  const S = RSL.tools.shop; const C = RSL.tools.contact; const cur = S.currency;
  const row = (p) => `<div class="row sh-row" style="gap:6px;margin-bottom:6px;flex-wrap:wrap" data-id="${esc(p.id || '')}"><input data-k="label" value="${esc(p.label)}" style="flex:2;min-width:140px" aria-label="${esc(t('sh_label'))}"><input data-k="months" type="number" min="0" max="60" value="${p.months}" style="width:80px" aria-label="${esc(t('sh_months'))}"><input data-k="devices" type="number" min="1" max="10" value="${p.devices}" style="width:80px" aria-label="${esc(t('sh_devices'))}"><input data-k="price" type="number" step="any" min="0" value="${p.price || ''}" style="width:110px" aria-label="${esc(t('sh_price'))}" placeholder="${esc(t('sh_price'))}"><button type="button" class="btn sm ghost" data-act="sh-del-row">✕</button></div>`;
  return `${rHow(t('sh_howT'), [t('sh_how1'), t('sh_how2'), t('sh_how3')])}
    <form data-form="shop" onsubmit="return false"><div class="card"><h3 style="margin-top:0">📇 ${esc(t('sh_contact'))}</h3>
      ${field(t('sh_shopName'), 'shopName', S.name)}<div class="grid2">${field(t('sh_wa'), 'whatsapp', S.whatsapp, { attrs: 'dir="ltr" inputmode="tel"' })}${field(t('sh_tg'), 'telegram', S.telegram, { attrs: 'dir="ltr"', ph: '@username' })}</div>
      <div class="grid2">${field(t('sh_email'), 'shopEmail', S.email, { type: 'email', attrs: 'dir="ltr"' })}${field(t('sh_phone'), 'phone', C.phone, { attrs: 'dir="ltr" inputmode="tel"' })}</div>
      <div class="grid2">${field(t('sh_org'), 'org', C.org)}${field(t('sh_note'), 'note', S.note)}</div></div>
    <div class="card" style="margin-top:12px"><h3 style="margin-top:0">🏷️ ${esc(t('sh_prices'))}</h3><p class="small muted" style="margin-top:0">${esc(t('sh_pricesHelp'))}</p>
      <div class="small muted row" style="gap:6px"><span style="flex:2;min-width:140px">${esc(t('sh_label'))}</span><span style="width:80px">${esc(t('sh_months'))}</span><span style="width:80px">${esc(t('sh_devices'))}</span><span style="width:110px">${esc(t('sh_price'))}</span></div>
      <div id="sh-rows">${S.prices.map(row).join('')}</div>
      <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-act="sh-add-row">${esc(t('sh_addRow'))}</button><span class="spacer"></span><label class="small" style="display:flex;gap:6px;align-items:center">${esc(t('sh_currency'))} <select name="currency" style="width:auto">${['EUR', 'USD', 'GBP', 'MAD', 'TND', 'THB', 'CAD', 'AUD'].map((c) => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div></div>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" data-act="sh-save" style="min-height:46px">${esc(t('sh_save'))}</button></div></form>
    <div class="card" style="margin-top:12px"><h3 style="margin-top:0">🪪 ${esc(t('sh_card'))}</h3><p class="small muted" style="margin-top:0">${esc(t('sh_cardHelp'))}</p><pre id="sh-card" class="allow-copy" style="white-space:pre-wrap;font:inherit;background:rgba(127,127,127,.08);border-radius:10px;padding:12px;margin:0">${esc(shopCard())}</pre>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn" data-act="sh-copy">${esc(t('sh_copy'))}</button><a class="btn wa-btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shopCard())}">${esc(t('sh_shareWa'))}</a></div></div>`;
}
function shopCard() { const S = RSL.tools.shop; const lines = S.prices.filter((p) => p.price > 0).map((p) => `• ${pkgName(p.label)}: ${rMoney(p.price)}`); return [t('sh_cardTitle', { shop: S.name || 'IPTV' }), '', ...lines, '', S.note || '', `${t('sh_cardContact')} ${[S.whatsapp && 'WhatsApp ' + S.whatsapp, S.telegram && 'Telegram @' + S.telegram, S.email].filter(Boolean).join(' · ')}`].filter((x, i, a) => x || (a[i - 1] && i < a.length - 1)).join('\n'); }
async function rclReload() { RSL.tools = await api('GET', '/api/rsl/tools'); rslDraw(); }
document.addEventListener('input', (e) => { if (e.target.dataset?.input === 'cl-q') { RCL.q = e.target.value; const el = document.getElementById('cl-list'); const pos = e.target.selectionStart; rslDraw(); const i = document.querySelector('[data-input=cl-q]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } void el; } });
document.addEventListener('change', (e) => { const f = e.target.closest && e.target.closest('[data-form=cl]'); if (!f || e.target.name !== 'pick') return; const p = RSL.tools.shop.prices.find((x) => x.id === e.target.value); if (!p) return; f.plan.value = p.label; f.months.value = p.months; if (p.price) f.price.value = p.price; const st = new Date(f.startAt.value || Date.now()); f.endAt.value = new Date(st.getTime() + (p.months || 1) * 30 * 86400000).toISOString().slice(0, 10); });
Object.assign(actions, {
  'rhow-toggle': (el) => { setTimeout(() => { try { if (el.open) localStorage.removeItem('tvp_rhow_' + el.dataset.k); else localStorage.setItem('tvp_rhow_' + el.dataset.k, '1'); } catch {} }, 0); },
  'cl-f': (el) => { RCL.f = el.dataset.f; rslDraw(); },
  'cl-add': () => modal(t('cl_add'), clForm({})),
  'cl-edit': (el) => modal(t('cl_edit'), clForm(RSL.tools.clients.find((x) => x.id === el.dataset.id))),
  'cl-save': async (el) => { const f = el.closest('form'); const o = formToObj(f); o.paid = f.paid.checked; delete o.pick; if (!o.endAt) delete o.endAt; el.disabled = true;
    try { if (f.dataset.id) await api('PUT', '/api/rsl/clients/' + f.dataset.id, o); else await api('POST', '/api/rsl/clients', o); toast(t('sh_saved')); closeModal(); await rclReload(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'cl-del': async (el) => { if (!confirm(t('cl_del'))) return; try { await api('DELETE', '/api/rsl/clients/' + el.dataset.id); await rclReload(); } catch (e) { toast(e.message, true); } },
  'cl-renew': (el) => { const x = RSL.tools.clients.find((y) => y.id === el.dataset.id); const pr = RSL.tools.shop.prices;
    modal(t('cl_renewT') + ' · ' + esc(x.name), `<form onsubmit="return false" data-id="${x.id}"><div class="chips" style="margin-bottom:10px;flex-wrap:wrap">${pr.filter((p) => p.months > 0).map((p) => `<a data-act="cl-renew-pick" data-m="${p.months}" data-p="${p.price || ''}">${esc(pkgName(p.label))}${p.price ? ' · ' + esc(rMoney(p.price)) : ''}</a>`).join('')}</div>
      <div class="grid2">${field(t('cl_months'), 'months', x.months || 1, { type: 'number', attrs: 'min="1" max="60"' })}${field(t('cl_price'), 'price', x.price || '', { type: 'number', attrs: 'step="any" min="0"' })}</div>${toggle(t('cl_paid'), 'paid', true)}
      <div class="row"><span class="spacer"></span><button class="btn primary" data-act="cl-renew-go">${esc(t('cl_renew'))}</button></div></form>`); },
  'cl-renew-pick': (el) => { const f = el.closest('.modal').querySelector('form'); f.months.value = el.dataset.m; if (el.dataset.p) f.price.value = el.dataset.p; el.parentElement.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a === el)); },
  'cl-renew-go': async (el) => { const f = el.closest('form'); el.disabled = true; try { const r = await api('POST', `/api/rsl/clients/${f.dataset.id}/renew`, { months: Number(f.months.value) || 1, price: f.price.value === '' ? undefined : Number(f.price.value), paid: f.paid.checked }); toast(`✓ ${t('cl_endsOn', { date: fmtDate(r.endAt) })}`); closeModal(); await rclReload(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'cl-remind': (el) => { const x = RSL.tools.clients.find((y) => y.id === el.dataset.id); const S = RSL.tools.shop; const p = S.prices.find((y) => y.label === x.plan); const msg = t('cl_remindMsg', { name: (x.name || '').split(' ')[0], plan: pkgName(x.plan) || '', date: fmtDate(x.endAt), price: rMoney((p && p.price) || x.price || 0), shop: S.name || '' }); window.open(`https://wa.me/${String(x.phone).replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener'); },
  'cl-appmail': async (el) => { el.disabled = true; try { const r = await api('POST', '/api/rsl/appmail', { clientId: el.dataset.id, lang: getLang(), appUrl: location.origin }); toast(t('cl_appSent', { to: r.to })); } catch (e) { toast(e.message, true); } el.disabled = false; },
  'rsl-appme': async (el) => { el.disabled = true; try { const r = await api('POST', '/api/rsl/appmail', { appUrl: location.origin }); toast(t('cl_appSent', { to: r.to })); } catch (e) { toast(e.message, true); } el.disabled = false; },
  'sh-add-row': () => { const box = document.getElementById('sh-rows'); box.insertAdjacentHTML('beforeend', `<div class="row sh-row" style="gap:6px;margin-bottom:6px;flex-wrap:wrap" data-id=""><input data-k="label" style="flex:2;min-width:140px"><input data-k="months" type="number" min="0" max="60" value="1" style="width:80px"><input data-k="devices" type="number" min="1" max="10" value="1" style="width:80px"><input data-k="price" type="number" step="any" min="0" style="width:110px"><button type="button" class="btn sm ghost" data-act="sh-del-row">✕</button></div>`); box.lastElementChild.querySelector('input').focus(); },
  'sh-del-row': (el) => el.closest('.sh-row').remove(),
  'sh-save': async (el) => { const f = el.closest('form'); const o = formToObj(f); o.prices = [...document.querySelectorAll('#sh-rows .sh-row')].map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`).value; return { id: r.dataset.id, label: g('label'), months: Number(g('months')) || 0, devices: Number(g('devices')) || 1, price: Number(g('price')) || 0 }; });
    el.disabled = true; try { await api('PUT', '/api/rsl/shop', o); toast(t('sh_saved')); RSL.d = await api('GET', '/api/rsl/me'); await rclReload(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'sh-copy': async () => { try { await navigator.clipboard.writeText(shopCard()); toast(t('copied')); } catch { toast(t('copied')); } },
});

Object.assign(actions, {
  'mail-appdl': async (el) => { el.disabled = true; try { const r = await api('POST', '/api/admin/appmail', { customerId: el.dataset.id, appUrl: location.origin }); toast(r.sent ? 'App download email sent ✓' : 'Not sent', !r.sent); closeModal(); } catch (e) { toast(e.message, true); el.disabled = false; } },
  'rs-appdl': async (el) => { el.disabled = true; try { const r = await api('POST', '/api/admin/appmail', { resellerId: el.dataset.id, appUrl: location.origin }); toast(r.sent ? 'App download email sent ✓' : 'Not sent', !r.sent); } catch (e) { toast(e.message, true); } el.disabled = false; },
  'appdl-bulk': () => modal('📲 App download email', `<form onsubmit="return false"><p class="small muted" style="margin-top:0">Sends the download instructions for Android (APK), iPhone & iPad (Safari) and MacBook with the app link, in each person's language.</p>${field('Send to', 'aud', 'active', { type: 'select', options: [['active', 'Active customers'], ['trial', 'Free trial customers'], ['all', 'All customers'], ['resellers', 'All resellers']] })}<div class="row"><span class="spacer"></span><button class="btn primary" data-act="appdl-bulk-go">📤 Send</button></div></form>`),
  'appdl-bulk-go': async (el) => { if (!confirm('Send the app download email now?')) return; el.disabled = true; try { const r = await api('POST', '/api/admin/appmail', { audience: el.closest('form').aud.value, appUrl: location.origin }); toast(`Sent to ${r.sent}${r.failed ? ` · ${r.failed} failed` : ''} ✓`); closeModal(); } catch (e) { toast(e.message, true); el.disabled = false; } },
});

// ---------------- agents: fixed texts, subjects and links (they choose who gets it and send) ----------------
const LOCK_NOTE = '🔒 Texts and links are fixed by the owner / Technical Service.';
function applyLocks(root = document) {
  const me = state.admin?.me; if (!me || !me.locked || !isAdminUI()) return;
  const q = (sel) => root.querySelectorAll(sel);
  q('#wa-text').forEach((e) => { if (e.readOnly) return; e.readOnly = true; e.classList.add('locked-text'); const lab = e.closest('label')?.querySelector('span'); if (lab) lab.textContent = 'Message (ready to send) ' + '🔒'; });
  q('[data-form=wa] [name=link], [data-form=wa] [name=title], [data-form=wa] [name=price], [data-form=wa] [name=days], [data-form=wa] [name=devices], #op-link').forEach((e) => { const f = e.closest('.field') || e; f.style.display = 'none'; e.disabled = true; });
  q('#wa-tpl-box, [data-act^=wa-tpl], [data-act=order-custom], [data-act=promo-edit], [data-act=nl-new]').forEach((e) => { e.style.display = 'none'; });
  q('[data-form=nl] input, [data-form=nl] textarea, [data-form=nl] select').forEach((e) => { if (!['group', 'test', 'testEmail'].includes(e.name) && !e.closest('[data-keep]')) { e.disabled = true; } });
  q('[data-form=nl]').forEach((f) => { if (!f.querySelector('.lock-note')) f.insertAdjacentHTML('afterbegin', `<p class="small notice lock-note" style="margin-top:0">${LOCK_NOTE} You choose the group and send.</p>`); });
  q('[data-form=rm] input, [data-form=rm] select, [data-form=ibo-auto] input, [data-form=mkt-settings] input, [data-form=mkt-settings] select, [data-form=wa-nums] input, [data-form=wa-nums] select, [data-form=wa-nums] textarea').forEach((e) => { e.disabled = true; });
  q('[data-act=rm-save], [data-act=ibo-auto-save], [data-form=mkt-settings] button[type=submit], [data-form=mkt-settings] [data-act^=key], [data-form=wa-nums] button, [data-act^=wa-num]').forEach((e) => { e.style.display = 'none'; });
  q('[data-form=rm], [data-form=ibo-auto], [data-form=mkt-settings], [data-form=wa-nums]').forEach((f) => { if (!f.querySelector('.lock-note')) f.insertAdjacentHTML('afterbegin', `<p class="small notice lock-note" style="margin-top:0">${f.dataset.form === 'wa-nums' ? '👁 View only. The owner / Technical Service changes these numbers.' : f.dataset.form === 'mkt-settings' ? '👁 View only: domains and senders are shown, API keys stay hidden.' : LOCK_NOTE}</p>`); });
  q('.promo-card textarea, #admin-body textarea[data-promo]').forEach((e) => { e.readOnly = true; });
}
new MutationObserver(() => { clearTimeout(applyLocks.t); applyLocks.t = setTimeout(() => applyLocks(), 30); }).observe(document.documentElement, { childList: true, subtree: true });
Object.assign(actions, {
  'mkt-html-save': async () => { try { await api('PUT', '/api/admin/emailmkt/settings', { html: ($('#mkt-html') || {}).value || '' }); toast('Saved: agents send this campaign ✓'); } catch (e) { toast(e.message, true); } },
});

// ---------------- Agent work planning: daily schedule, tasks to check off, rules (owner edits, agents check off) ----------------
const WP = { week: '', agent: '' };
const WD_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
async function adminWorkPlan() {
  const r = await api('GET', '/api/admin/workplan' + (WP.week ? '?week=' + WP.week : '')); state.admin.wp = r; const P = r.plan;
  const me = state.admin.me || {}; const isOwn = r.canEdit; const agents = r.who; if (!WP.agent || !agents.some((a) => a.id === WP.agent)) WP.agent = isOwn ? (agents[0]?.id || '') : r.me;
  const wdOf = (d) => new Date(d + 'T12:00:00Z').getUTCDay(); const toMin = (x) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; };
  const tasks = P.slots.filter((x) => !x.noCheck);
  const doneOf = (d, aid) => Object.keys(((r.checks[d] || {})[aid]) || {}).filter((k) => tasks.some((x) => x.id === k)).length;
  const pctDay = (d, aid) => Math.round((doneOf(d, aid) / tasks.length) * 100);
  const weekDone = r.week.reduce((a, d) => a + doneOf(d, WP.agent), 0); const weekPct = Math.round((weekDone / (tasks.length * 7)) * 100);
  const cell = (d, sl) => { const c = ((r.checks[d] || {})[WP.agent] || {})[sl.id]; const today = d === r.today; const yest = new Date(new Date(r.today + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10) === d;
    const can = !isOwn && (today || yest) && !sl.noCheck; const task = (P.days[wdOf(d)] || {})[sl.id] || '';
    const now = today && r.nowMin >= toMin(sl.start) && r.nowMin < toMin(sl.end);
    return `<td class="wp-cell ${c ? 'wp-done' : ''} ${now ? 'wp-now' : ''}">${task ? (() => { const inf = ((P.info || {})[wdOf(d)] || {})[sl.id]; return `<div class="small" style="margin-bottom:4px" title="${inf ? esc(inf[0] + ' · ' + inf[1] + ' — ' + inf[2]) : ''}">${esc(task)}${inf ? `<div class="muted" style="font-size:11px">${esc(inf[0])}</div>` : ''}</div>`; })() : ''}${sl.noCheck ? '<span class="muted small">—</span>' : can ? `<label class="wp-check"><input type="checkbox" data-act="wp-check" data-date="${d}" data-slot="${sl.id}" ${c ? 'checked' : ''}> <span>${c ? '✓ Done' : 'Mark done'}</span></label>` : c ? `<span class="badge ok" title="${esc(c.note || '')}">✓ ${new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : d < r.today ? '<span class="badge bad">✗</span>' : '<span class="muted small">·</span>'}</td>`; };
  const meetTxt = r.nextMeet ? `<div class="notice" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="font-size:24px">🎉</span><div style="flex:1"><b>${esc(P.meet.title)}</b> · ${fmtDate(new Date(r.nextMeet + 'T12:00:00Z').getTime())} at ${esc(P.meet.time)} <span class="small muted">(${esc(P.tz)})</span><div class="small muted">Once a month — attendance is mandatory. A reminder comes 3 days before and on the day.</div></div></div>` : '';
  const todayRow = P.slots.map((sl) => { const task = (P.days[wdOf(r.today)] || {})[sl.id]; const c = ((r.checks[r.today] || {})[WP.agent] || {})[sl.id]; const now = r.nowMin >= toMin(sl.start) && r.nowMin < toMin(sl.end);
    return `<div class="list-item wp-today ${now ? 'wp-now' : ''} ${c ? 'wp-done' : ''}"><span style="font-size:22px">${esc(sl.icon || '•')}</span><div style="flex:1;min-width:0"><b>${esc(sl.start)}–${esc(sl.end)} · ${esc(sl.title)}</b>${now ? ' <span class="pill st-expiring">now</span>' : ''}${task ? `<div class="small muted">${esc(task)}</div>` : ''}${((P.info || {})[wdOf(r.today)] || {})[sl.id] ? (([ch, ty, go]) => `<div class="small" style="margin-top:3px"><span class="badge">${esc(ch)}</span> <b>${esc(ty)}</b> — ${esc(go)}</div>`)(P.info[wdOf(r.today)][sl.id]) : ''}</div>${sl.tab ? `<a class="btn sm" data-act="atab" data-tab="${esc(sl.tab)}">Open →</a>` : ''}${sl.noCheck ? '' : !isOwn ? `<label class="wp-check"><input type="checkbox" data-act="wp-check" data-date="${r.today}" data-slot="${sl.id}" ${c ? 'checked' : ''}> <span>${c ? '✓ Done' : 'Done?'}</span></label>` : c ? '<span class="badge ok">✓</span>' : ''}</div>`; }).join('');
  return `<div class="card"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center"><h3 style="margin:0;flex:1">📌 Agent work planning</h3>${isOwn ? `<select data-input="wp-agent" style="width:auto">${agents.map((a) => `<option value="${esc(a.id)}" ${a.id === WP.agent ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select><button class="btn sm" data-act="wp-edit">✏️ Edit the planning</button>` : '<span class="badge">👁 View only · check off your tasks</span>'}</div>
      <div class="stats" style="margin-top:12px"><div class="stat"><span>Today</span><b>${pctDay(r.today, WP.agent)}%</b></div><div class="stat"><span>This week</span><b>${weekPct}%</b></div><div class="stat"><span>Tasks done</span><b>${weekDone}/${tasks.length * 7}</b></div><div class="stat"><span>Time zone</span><b style="font-size:1rem">${esc(P.tz)}</b></div></div>
      <div class="wp-bar"><i style="width:${weekPct}%"></i></div></div>
    ${meetTxt}
    <div class="card"><h3 style="margin-top:0">🕘 Today · ${esc(WD_NAMES[wdOf(r.today)])} ${fmtDate(new Date(r.today + 'T12:00:00Z').getTime())}</h3>${todayRow}</div>
    <div class="card"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><h3 style="margin:0;flex:1">📅 Week</h3><button class="btn sm" data-act="wp-week" data-d="-7">← Previous</button><button class="btn sm" data-act="wp-week" data-d="0">This week</button><button class="btn sm" data-act="wp-week" data-d="7">Next →</button></div>
      <div class="tbl-wrap" style="margin-top:10px"><table class="tbl wp-tbl"><thead><tr><th>Time</th>${r.week.map((d) => `<th class="${d === r.today ? 'wp-th-today' : ''}">${WD_NAMES[wdOf(d)].slice(0, 3)} ${d.slice(8)}<div class="small muted">${pctDay(d, WP.agent)}%</div></th>`).join('')}</tr></thead>
      <tbody>${P.slots.map((sl) => `<tr><td style="white-space:nowrap"><b>${esc(sl.icon || '')} ${esc(sl.start)}–${esc(sl.end)}</b><div class="small muted" style="max-width:190px">${esc(sl.title)}</div></td>${r.week.map((d) => cell(d, sl)).join('')}</tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h3 style="margin-top:0">📜 Key agent rules &amp; panel permissions</h3><ol style="line-height:1.7;padding-inline-start:20px;margin:0">${P.rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`;
}
document.addEventListener('change', (e) => { if (e.target.dataset?.input === 'wp-agent') { WP.agent = e.target.value; renderAdmin(); } });
Object.assign(actions, {
  'wp-check': async (el) => { const done = el.checked; try { await api('POST', '/api/admin/workplan/check', { date: el.dataset.date, slot: el.dataset.slot, done }); toast(done ? '✓ Checked off' : 'Unchecked'); renderAdmin(); } catch (e) { el.checked = !done; toast(e.message, true); } },
  'wp-week': (el) => { const d = Number(el.dataset.d); const base = state.admin.wp?.week?.[0] || new Date().toISOString().slice(0, 10); WP.week = d === 0 ? '' : new Date(new Date(base + 'T12:00:00Z').getTime() + d * 86400000).toISOString().slice(0, 10); renderAdmin(); },
  'wp-sheet': () => { const P = state.admin.wp.plan;
    modal('📤 Google Sheets · Agent Work Planning', `<p class="small" style="margin-top:0">Each time an agent checks off a task, the <b>Agent Work Planning</b> tab of your Google Sheet is updated with the whole week (every agent, every time slot, YES / NO).</p>
      <details ${P.sheetUrl ? '' : 'open'} style="margin:8px 0"><summary class="small"><b>How to connect the sheet (2 minutes, once)</b></summary><ol class="small"><li>Open your Google Sheet → <b>Extensions → Apps Script</b>.</li><li>Delete what is there, paste this code and click 💾 Save:</li></ol><textarea readonly rows="7" style="width:100%;font-family:monospace;font-size:12px" onclick="this.select()">function doPost(e){var d=JSON.parse(e.postData.contents);var ss=SpreadsheetApp.getActive();var sh=ss.getSheetByName(d.sheet)||ss.insertSheet(d.sheet);if(!d.append){sh.clear();sh.appendRow(d.header);}else if(sh.getLastRow()==0){sh.appendRow(d.header);}if(d.rows.length)sh.getRange(sh.getLastRow()+1,1,d.rows.length,d.header.length).setValues(d.rows);return ContentService.createTextOutput('ok');}
function doGet(e){var sh=SpreadsheetApp.getActive().getSheetByName((e.parameter||{}).sheet||'Accounts');var v=sh?sh.getDataRange().getValues():[];return ContentService.createTextOutput(JSON.stringify({rows:v})).setMimeType(ContentService.MimeType.JSON);}</textarea><ol class="small" start="3"><li><b>Deploy → New deployment</b> → type <b>Web app</b> → Execute as <b>Me</b>, Who has access <b>Anyone</b> → Deploy → allow access.</li><li>Copy the <b>Web app URL</b> (…/exec) and paste it below.</li></ol><p class="small muted">The same link also works for 📊 Accounts → Google Sheets.</p></details>
      <form data-form="wp-sheet">${field('Apps Script web app link', 'url', P.sheetUrl || '', { ph: 'https://script.google.com/macros/s/…/exec', attrs: 'autocapitalize="none"' })}
      <div class="row" style="justify-content:flex-end;gap:6px"><button type="submit" class="btn primary">Save & send this week</button></div></form>`, { wide: true });
    $('[data-form=wp-sheet]').onsubmit = async (ev) => { ev.preventDefault(); const url = ev.target.url.value.trim();
      try { if (url !== (P.sheetUrl || '')) { await api('PUT', '/api/admin/workplan', { sheetUrl: url }); P.sheetUrl = url; } const r = await api('POST', '/api/admin/workplan/sheet'); closeModal(); toast(`Sent ${r.rows} rows to the "Agent Work Planning" sheet ✓`); } catch (e) { toast(e.message, true); } }; },
  'wp-edit': () => { const P = state.admin.wp.plan; const dayName = (k) => WD_NAMES[Number(k)];
    const slotRow = (x) => `<div class="row wp-slot" style="gap:6px;margin-bottom:6px;flex-wrap:wrap" data-id="${esc(x.id || '')}"><input data-k="icon" value="${esc(x.icon || '')}" style="width:52px"><input data-k="start" type="time" value="${esc(x.start || '')}" style="width:110px"><input data-k="end" type="time" value="${esc(x.end || '')}" style="width:110px"><input data-k="title" value="${esc(x.title || '')}" style="flex:1;min-width:200px"><label class="small" style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-k="noCheck" style="width:auto" ${x.noCheck ? 'checked' : ''}> no check</label><button type="button" class="btn sm ghost" data-act="wp-slot-del">✕</button></div>`;
    modal('✏️ Edit the work planning', `<form onsubmit="return false" data-form="wp"><p class="small muted" style="margin-top:0">Only you (the owner) can change this. Agents see it and check off their tasks.</p>
      <h3>Time slots (every day)</h3><div id="wp-slots">${P.slots.map(slotRow).join('')}</div><button type="button" class="btn sm" data-act="wp-slot-add">＋ Add a slot</button>
      <h3 style="margin-top:14px">Day by day tasks</h3><p class="small muted" style="margin-top:0">What to post or send in each slot. Empty = the slot title only.</p>
      ${['1', '2', '3', '4', '5', '6', '0'].map((k) => `<details ${k === '1' ? 'open' : ''}><summary><b>${dayName(k)}</b></summary>${P.slots.map((sl) => `<label class="field"><span>${esc(sl.start)} · ${esc(sl.title)}</span><input data-day="${k}" data-slot="${esc(sl.id)}" value="${esc((P.days[k] || {})[sl.id] || '')}"></label>`).join('')}</details>`).join('')}
      <h3 style="margin-top:14px">Rules</h3><textarea name="rules" rows="7" style="width:100%">${esc(P.rules.join('\n'))}</textarea>
      <h3 style="margin-top:14px">Monthly meeting</h3><div class="grid3">${field('Name', 'meetTitle', P.meet.title)}${field('Day of the month (0 = use the weekday below)', 'meetDom', P.meet.dom || 0, { type: 'number', attrs: 'min="0" max="31"' })}</div><div class="grid2">${field('Which', 'meetNth', P.meet.nth, { type: 'select', options: [['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['4', '4th']] })}${field('Day', 'meetWd', P.meet.weekday, { type: 'select', options: WD_NAMES.map((n, i) => [String(i), n]) })}</div><div class="grid2">${field('Time', 'meetTime', P.meet.time, { type: 'time' })}${field('Time zone of the schedule', 'tz', P.tz, { ph: 'Europe/Paris' })}</div>${toggle('Meeting reminders on', 'meetOn', P.meet.on)}
      <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" data-act="wp-save">💾 Save the planning</button></div></form>`, { wide: true }); },
  'wp-slot-add': () => document.getElementById('wp-slots').insertAdjacentHTML('beforeend', `<div class="row wp-slot" style="gap:6px;margin-bottom:6px;flex-wrap:wrap" data-id=""><input data-k="icon" value="•" style="width:52px"><input data-k="start" type="time" style="width:110px"><input data-k="end" type="time" style="width:110px"><input data-k="title" style="flex:1;min-width:200px" placeholder="Activity"><label class="small" style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-k="noCheck" style="width:auto"> no check</label><button type="button" class="btn sm ghost" data-act="wp-slot-del">✕</button></div>`),
  'wp-slot-del': (el) => el.closest('.wp-slot').remove(),
  'wp-save': async (el) => { const f = el.closest('form'); const P = state.admin.wp.plan;
    const slots = [...f.querySelectorAll('.wp-slot')].map((r) => { const g = (k) => r.querySelector(`[data-k=${k}]`); return { id: r.dataset.id, icon: g('icon').value, start: g('start').value, end: g('end').value, title: g('title').value, noCheck: g('noCheck').checked, tab: (P.slots.find((x) => x.id === r.dataset.id) || {}).tab || '' }; });
    const days = {}; f.querySelectorAll('[data-day]').forEach((i) => { (days[i.dataset.day] = days[i.dataset.day] || {})[i.dataset.slot] = i.value; });
    try { await api('PUT', '/api/admin/workplan', { slots, days, rules: f.rules.value.split('\n').map((x) => x.trim()).filter(Boolean), meet: { title: f.meetTitle.value, dom: Number(f.meetDom.value) || 0, nth: f.meetNth.value, weekday: f.meetWd.value, time: f.meetTime.value, on: f.meetOn.checked }, tz: f.tz.value.trim() }); toast('Work planning saved ✓'); closeModal(); renderAdmin(); } catch (e) { toast(e.message, true); } },
});

// ===== Owner personal & business planning (owner only) =====
const OP = { view: 'day', date: '', month: '', data: null, cache: null };
const OP_STATUS = [['todo', '⬜ To do'], ['created', '🔑 Key created'], ['dns', '🌐 Domain added (DNS)'], ['verified', '✅ Domain verified'], ['linked', '🔗 Linked']];
const opAdd = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const opMon = (d) => opAdd(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
const opWd = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const opMonthName = (m) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const opDayName = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
async function adminOwnerPlan() {
  const base = await api('GET', '/api/admin/ownerplan'); const today = base.today;
  if (!OP.date || OP.date < base.first || OP.date > base.last) OP.date = today; if (!OP.month || !base.months.includes(OP.month)) OP.month = OP.date.slice(0, 7);
  let from = OP.date, to = OP.date;
  if (OP.view === 'week') { from = opMon(OP.date); to = opAdd(from, 6); }
  if (OP.view === 'month') { from = opMon(OP.month + '-01'); const end = OP.month + '-' + String(new Date(Date.UTC(+OP.month.slice(0, 4), +OP.month.slice(5, 7), 0)).getUTCDate()).padStart(2, '0'); to = opAdd(opMon(end), 6); }
  const r = from === today && to === today ? base : await api('GET', `/api/admin/ownerplan?from=${from}&to=${to}`); OP.data = r; OP.cache = base;
  const S = base.stats; const pctCls = (p) => (p >= 100 ? 'ok' : p >= 60 ? '' : 'bad');
  const stat = (label, big, sub = '') => `<div class="stat"><span>${label}</span><b>${big}</b>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
  const ms = S.months[OP.month] || S.all;
  const head = `<div class="card"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><h3 style="margin:0;flex:1;min-width:200px">🗓️ My planning <span class="badge">🔒 Owner only</span></h3>
      <button class="btn sm primary" data-act="op-add">＋ Add activity</button><button class="btn sm" data-act="op-holiday">🏖️ Holidays</button><button class="btn sm" data-act="op-notify">🔔 Alerts</button><button class="btn sm" data-act="op-notify-agents" title="Notify all active agents that the planning is synced through December 2027">📣 Notify agents</button></div>
    <div class="op-months-scroll" style="margin-top:12px"><label class="small muted" for="op-month-select">${esc(t('planSyncMonth'))}</label><select id="op-month-select" class="btn sm" data-act="op-month-select">${base.months.map((m) => `<option value="${m}" ${m === OP.month ? 'selected' : ''}>${esc(opMonthName(m))}</option>`).join('')}</select><span class="small muted">${esc(t('planSyncThrough'))}</span></div>
    <div class="op-tabs" style="margin-top:8px">${[['day', '📋 Day'], ['week', '📅 Week'], ['month', '🗓️ Month']].map(([k, n]) => `<button class="btn sm ${OP.view === k ? 'primary' : 'ghost'}" data-act="op-view" data-v="${k}">${n}</button>`).join('')}<span class="spacer"></span><button class="btn sm" data-act="op-go" data-d="today">Today</button></div>
    <div class="stats" style="margin-top:12px">${stat('Today', S.today.pct + '%', `${S.today.done}/${S.today.total} done`)}${stat('This week', S.week.pct + '%', `${S.week.done}/${S.week.total}`)}${stat(opMonthName(OP.month), ms.done + '/' + ms.total, ms.pct + '% of the month')}${stat('Compliance so far', `<span class="${pctCls(S.all.compliance)}">${S.all.compliance}%</span>`, `${S.all.dueDone}/${S.all.due} due tasks · goal 100%`)}${stat('Resend keys today', `${S.today.api}/${base.apiDaily}`, `week ${S.week.api}/${S.week.apiGoal} · 4 months ${S.all.api}/${S.all.apiGoal}`)}</div>
    <div class="wp-bar"><i style="width:${S.all.compliance}%"></i></div>
    ${S.today.pending ? `<div class="notice warning" style="margin-top:10px">⏳ <b>${S.today.pending} activit${S.today.pending > 1 ? 'ies' : 'y'} of today not checked off</b> — ${base.rows[0].blocks.filter((b) => b.past && !b.done).map((b) => esc(b.title)).join(' · ')}</div>` : ''}</div>`;
  let body = '';
  if (OP.view === 'day') body = opDayCard(r.rows[0], r);
  else if (OP.view === 'week') body = opWeekCard(r);
  else body = opMonthCard(r);
  return head + body;
}
function opBlockRow(b, row, r, compact = false) {
  const can = row.date <= r.today; const late = b.past && !b.done;
  const chk = `<label class="wp-check" title="${can ? 'Done?' : 'Future day'}"><input type="checkbox" data-act="op-check" data-date="${row.date}" data-id="${esc(b.id)}" ${b.done ? 'checked' : ''} ${can ? '' : 'disabled'}>${compact ? '' : `<span>${b.done ? '✓ Done' : 'Done?'}</span>`}</label>`;
  const tools = `<span class="op-tools"><button class="btn sm ghost" data-act="op-edit" data-date="${row.date}" data-id="${esc(b.id)}" title="Edit">✏️</button><button class="btn sm ghost" data-act="op-dup" data-date="${row.date}" data-id="${esc(b.id)}" title="Duplicate">⧉</button><button class="btn sm ghost" data-act="op-del" data-date="${row.date}" data-id="${esc(b.id)}" title="Delete">🗑</button></span>`;
  if (compact) return `<div class="op-mini ${b.done ? 'wp-done' : ''} ${b.now ? 'wp-now' : ''} ${late ? 'op-late' : ''}">${chk}<div style="flex:1;min-width:0"><b>${esc(b.start)}</b> ${esc(b.icon)} ${esc(b.title)}</div><button class="btn sm ghost" data-act="op-edit" data-date="${row.date}" data-id="${esc(b.id)}" title="Edit">✏️</button></div>`;
  return `<div class="list-item wp-today op-item ${b.now ? 'wp-now' : ''} ${b.done ? 'wp-done' : ''} ${late ? 'op-late' : ''}"><span style="font-size:22px">${esc(b.icon)}</span><div style="flex:1;min-width:0"><b>${esc(b.start)}–${esc(b.end)} · ${esc(b.title)}</b>${b.now ? ' <span class="pill st-expiring">now</span>' : ''}${late ? ' <span class="badge bad">⏳ pending</span>' : ''}${b.changed ? ' <span class="badge">changed today</span>' : ''}${!b.recurring ? ' <span class="badge">this day only</span>' : ''}<div class="small muted">${b.recurring ? (b.rule === 'monthly' ? `Every month on the ${b.dom}th` : (b.days || []).length === 7 ? 'Every day' : (b.days || []).map((d) => WD_NAMES[d].slice(0, 3)).join(' · ')) : ''}${b.note ? ' · ' + esc(b.note) : ''}${b.api ? ` · ${row.apiLinked}/${r.apiDaily} keys linked` : ''}</div></div>${tools}${chk}</div>`;
}
function opDayCard(row, r) {
  const idx = r.months.indexOf(row.date.slice(0, 7));
  const nav = `<div class="row" style="gap:6px;flex-wrap:wrap;align-items:center"><h3 style="margin:0;flex:1;min-width:200px">📋 ${esc(opDayName(row.date))}${row.date === r.today ? ' <span class="pill st-active">today</span>' : ''} <span class="small muted">${row.done}/${row.total} · ${row.total ? Math.round((row.done / row.total) * 100) : 0}%</span></h3><button class="btn sm" data-act="op-go" data-d="-1" ${row.date <= r.first ? 'disabled' : ''}>← Previous day</button><button class="btn sm" data-act="op-go" data-d="1" ${row.date >= r.last ? 'disabled' : ''}>Next day →</button></div>`; void idx;
  const hol = row.holidays.length ? `<div class="notice" style="margin-top:10px">🏖️ <b>${row.holidays.map((h) => esc(h.name) + ` <span class="small muted">(${esc(h.region)})</span>`).join(' · ')}</b></div>` : '';
  const list = row.blocks.length ? row.blocks.map((b) => opBlockRow(b, row, r)).join('') : '<p class="muted">Nothing planned on this day.</p>';
  return `<div class="card">${nav}${hol}<div style="margin-top:10px">${list}</div><button class="btn sm" data-act="op-add" style="margin-top:8px">＋ Add an activity on this day</button></div>${row.blocks.some((b) => b.api) ? opApiCard(row, r) : ''}`;
}
function opApiCard(row, r) {
  const list = (r.api || {})[row.date] || []; const n = r.apiDaily; const linked = list.filter((e) => e.status === 'linked').length;
  const rows = Array.from({ length: n }, (_, i) => { const e = list[i] || { domain: '', hint: '', status: 'todo' };
    return `<form class="op-api ${e.status === 'linked' ? 'wp-done' : ''}" data-form="op-api" data-i="${i}" data-date="${row.date}"><b class="op-n">${i + 1}</b><input name="domain" value="${esc(e.domain || '')}" placeholder="domain.site" autocapitalize="none" spellcheck="false"><input name="apiKey" value="" placeholder="${e.hint ? esc(e.hint) + ' (saved)' : 're_… paste the new key'}" autocomplete="off" autocapitalize="none" spellcheck="false"><select name="status">${OP_STATUS.map(([k, t]) => `<option value="${k}" ${e.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn sm primary">Save</button></form>`; }).join('');
  return `<div class="card"><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;flex:1;min-width:200px">🔑 Daily Resend API keys & domains <span class="small muted">${linked}/${n} linked</span></h3><a class="btn sm" data-act="atab" data-tab="accounts">🗝️ Accounts & API keys →</a></div>
    <div class="wp-bar"><i style="width:${Math.round((linked / n) * 100)}%"></i></div>
    <p class="small muted">Create the key in Resend, paste it here with its domain, then move the status to 🔗 Linked. The key is saved in <b>Accounts & API keys</b> (owner / technical service only) with sending <b>off</b> — turn it on there once the domain is verified. Here and everywhere else only a masked hint (re_••••1234) is shown; agents never see keys. At ${n}/${n} linked the routine is checked off automatically.</p>
    <div class="op-api-list">${rows}</div></div>`;
}
function opWeekCard(r) {
  const days = r.rows;
  return `<div class="card"><div class="row" style="gap:6px;flex-wrap:wrap;align-items:center"><h3 style="margin:0;flex:1">📅 Week of ${esc(opDayName(days[0].date))}</h3><button class="btn sm" data-act="op-go" data-d="-7">← Previous week</button><button class="btn sm" data-act="op-go" data-d="7">Next week →</button></div>
    <div class="op-week" style="margin-top:10px">${days.map((row) => `<div class="op-col ${row.date === r.today ? 'op-today' : ''}"><a class="op-colh" data-act="op-open" data-d="${row.date}"><b>${WD_NAMES[row.wd].slice(0, 3)} ${row.date.slice(8)}</b> <span class="small muted">${row.total ? Math.round((row.done / row.total) * 100) : 0}%</span>${row.holidays.length ? `<div class="small op-hol">🏖️ ${esc(row.holidays[0].name)}</div>` : ''}</a>${row.blocks.map((b) => opBlockRow(b, row, r, true)).join('') || '<p class="small muted">—</p>'}</div>`).join('')}</div></div>`;
}
function opMonthCard(r) {
  const m = OP.month; const cells = r.rows.map((row) => { const out = row.date.slice(0, 7) !== m; const p = row.total ? Math.round((row.done / row.total) * 100) : 0; const meet = row.blocks.find((b) => b.id === 'meet');
    return `<a class="op-day ${out ? 'op-out' : ''} ${row.date === r.today ? 'op-today' : ''} ${row.date < r.first || row.date > r.last ? 'op-off' : ''}" data-act="op-open" data-d="${row.date}"><div class="row" style="justify-content:space-between"><b>${Number(row.date.slice(8))}</b><span class="small ${p >= 100 ? 'ok' : ''}">${row.date <= r.today && row.date >= r.since ? p + '%' : ''}</span></div>
      <div class="op-dbar"><i style="width:${p}%"></i></div>${meet ? '<div class="small op-meet">🎉 Meet Party ' + esc(meet.start) + '</div>' : ''}${row.holidays.map((h) => `<div class="small op-hol">🏖️ ${esc(h.name)}</div>`).join('')}<div class="small muted op-cnt">${row.total} activities${row.apiLinked ? ` · 🔑 ${row.apiLinked}` : ''}</div></a>`; }).join('');
  const pad = r.rows.length ? '<div></div>'.repeat((r.rows[0].wd + 6) % 7) : '';
  return `<div class="card"><h3 style="margin-top:0">🗓️ ${opMonthName(m)}</h3><div class="op-month">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="op-wdh">${d}</div>`).join('')}${pad}${cells}</div><p class="small muted" style="margin-bottom:0">Tap a day to open it, check off activities and edit them.</p></div>`;
}
function opFindBlock(date, id) { const row = (OP.data?.rows || []).find((x) => x.date === date) || (OP.cache?.rows || []).find((x) => x.date === date); return row && row.blocks.find((b) => b.id === id); }
function opForm(b = {}, mode = 'add', date = OP.date) {
  const rule = b.rule || 'weekly'; const days = b.days || [opWd(date)]; const recurring = mode === 'add' ? false : b.recurring;
  const scope = mode === 'add' ? `<div class="op-scope"><label><input type="radio" name="scope" value="day" checked> Only on ${esc(opDayName(date))}</label><label><input type="radio" name="scope" value="future"> Repeat from this day on (all future weeks / months)</label></div>`
    : recurring ? `<div class="op-scope"><label><input type="radio" name="scope" value="day" checked> Save for this day only</label><label><input type="radio" name="scope" value="future"> Apply to all future weeks/months (from ${esc(date)})</label></div>` : '<p class="small muted">This activity is only on this day.</p>';
  return `<form data-form="op-block" data-mode="${mode}" data-id="${esc(b.id || '')}" data-date="${date}" onsubmit="return false">
    <div class="grid2">${field('Title', 'title', b.title || '', { attrs: 'required maxlength="120"' })}${field('Icon (emoji)', 'icon', b.icon || '📌', { attrs: 'maxlength="4"' })}</div>
    <div class="grid2">${field('Start', 'start', b.start || '09:00', { type: 'time' })}${field('End', 'end', b.end || '10:00', { type: 'time' })}</div>
    ${mode === 'dup' ? field('Copy to the day', 'toDate', date, { type: 'date', attrs: `min="${OP.cache.first}" max="${OP.cache.last}"` }) : ''}
    ${field('Note (optional)', 'note', b.note || '', { attrs: 'maxlength="200"' })}
    <div class="op-repeat"><b class="small">Repeats</b><div class="row" style="gap:10px;flex-wrap:wrap;margin:6px 0"><label><input type="radio" name="rule" value="weekly" ${rule === 'weekly' ? 'checked' : ''}> Weekly on</label>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="op-wdl"><input type="checkbox" name="d${d}" ${days.includes(d) ? 'checked' : ''}> ${WD_NAMES[d].slice(0, 3)}</label>`).join('')}</div>
      <div class="row" style="gap:10px;align-items:center"><label><input type="radio" name="rule" value="monthly" ${rule === 'monthly' ? 'checked' : ''}> Monthly on day</label><input name="dom" type="number" min="1" max="31" value="${b.dom || Number(date.slice(8))}" style="width:80px"></div><p class="small muted" style="margin:4px 0 0">Used when it repeats (future). Short months use their last day.</p></div>
    ${scope}
    <div class="row" style="justify-content:flex-end;gap:6px;margin-top:10px">${mode === 'edit' && b.changed ? `<button class="btn sm ghost" data-act="op-restore">↺ Back to the usual</button>` : ''}<button class="btn primary" data-act="op-save">💾 Save</button></div></form>`;
}
async function opReload() { await renderAdmin(); opAlertsRefresh(); }
Object.assign(actions, {
  'op-month': (el) => { OP.month = el.dataset.m; if (OP.view === 'day') OP.view = 'month'; const t = OP.cache?.today || ''; OP.date = t.startsWith(OP.month) ? t : OP.month + '-01'; renderAdmin(); },
  'op-view': (el) => { OP.view = el.dataset.v; renderAdmin(); },
  'op-open': (el) => { const d = el.dataset.d; if (OP.cache && (d < OP.cache.first || d > OP.cache.last)) return toast('Outside the planning (available through December 2027).', true); OP.date = d; OP.month = d.slice(0, 7); OP.view = 'day'; renderAdmin(); },
  'op-go': (el) => { const c = OP.cache; if (el.dataset.d === 'today') { OP.date = c.today; OP.month = c.today.slice(0, 7); } else { let d = opAdd(OP.date, Number(el.dataset.d)); if (d < c.first) d = c.first; if (d > c.last) d = c.last; OP.date = d; OP.month = d.slice(0, 7); } renderAdmin(); },
  'op-notify-agents': async () => { try { const r = await api('POST', '/api/admin/ownerplan/notify-agents'); toast(`📣 ${esc(t('planSyncSent', { n: Number(r.sent) || 0 }))}`); } catch (e) { toast(e.message, true); } },
  'op-check': async (el) => { const done = el.checked; try { await api('POST', '/api/admin/ownerplan/check', { date: el.dataset.date, id: el.dataset.id, done }); toast(done ? '✓ Checked off' : 'Unchecked'); opReload(); } catch (e) { el.checked = !done; toast(e.message, true); } },
  'op-add': () => modal('＋ Add an activity', opForm({}, 'add', OP.date)),
  'op-edit': (el) => { const b = opFindBlock(el.dataset.date, el.dataset.id); if (!b) return; modal('✏️ Edit · ' + b.title, opForm(b, 'edit', el.dataset.date)); },
  'op-dup': (el) => { const b = opFindBlock(el.dataset.date, el.dataset.id); if (!b) return; modal('⧉ Duplicate · ' + b.title, opForm({ ...b, recurring: true }, 'dup', el.dataset.date)); },
  'op-del': (el) => { const b = opFindBlock(el.dataset.date, el.dataset.id); if (!b) return; const d = el.dataset.date;
    modal('🗑 Delete · ' + b.title, `<form data-form="op-del" data-id="${esc(b.id)}" data-date="${d}" onsubmit="return false"><p>${esc(b.start)}–${esc(b.end)} · ${esc(b.title)}</p>${b.recurring ? `<div class="op-scope"><label><input type="radio" name="scope" value="day" checked> Delete on ${esc(opDayName(d))} only</label><label><input type="radio" name="scope" value="future"> Delete from this day and all future weeks/months</label></div>` : ''}<div class="row" style="justify-content:flex-end"><button class="btn danger" data-act="op-del-ok">Delete</button></div></form>`); },
  'op-del-ok': async (el) => { const f = el.closest('form'); try { await api('POST', '/api/admin/ownerplan/block', { op: 'del', id: f.dataset.id, date: f.dataset.date, scope: f.scope ? f.querySelector('[name=scope]:checked').value : 'day' }); closeModal(); toast('Deleted'); opReload(); } catch (e) { toast(e.message, true); } },
  'op-restore': async (el) => { const f = el.closest('form'); try { await api('POST', '/api/admin/ownerplan/block', { op: 'restore', id: f.dataset.id, date: f.dataset.date }); closeModal(); toast('Back to the usual'); opReload(); } catch (e) { toast(e.message, true); } },
  'op-save': async (el) => { const f = el.closest('form'); const mode = f.dataset.mode; const sc = f.querySelector('[name=scope]:checked');
    const block = { title: f.elements.title.value.trim(), icon: f.icon.value.trim(), start: f.start.value, end: f.end.value, note: f.note.value.trim(), rule: f.querySelector('[name=rule]:checked')?.value || 'weekly', days: [0, 1, 2, 3, 4, 5, 6].filter((d) => f['d' + d].checked), dom: Number(f.dom.value) || 1 };
    if (!block.title) return toast('Give the activity a title.', true); if (block.end <= block.start) return toast('The end time must be after the start time.', true);
    if (block.rule === 'weekly' && sc?.value === 'future' && !block.days.length) return toast('Pick at least one day of the week.', true);
    try { await api('POST', '/api/admin/ownerplan/block', { op: mode, id: f.dataset.id || undefined, date: f.dataset.date, toDate: f.toDate?.value, scope: sc ? sc.value : 'day', block }); closeModal(); toast(mode === 'add' ? 'Added ✓' : mode === 'dup' ? 'Duplicated ✓' : 'Saved ✓'); if (mode === 'dup' && f.toDate?.value) { OP.date = f.toDate.value; OP.month = OP.date.slice(0, 7); } opReload(); } catch (e) { toast(e.message, true); } },
  'op-notify': () => { const n = OP.cache.notify; const blocks = OP.cache.blocks.filter((b) => b.v && !b.v.off);
    modal('🔔 Planning alerts', `<form data-form="op-notify" onsubmit="return false"><p class="small muted" style="margin-top:0">Alerts come ${n.pre} min before and at the start of every activity, and again if it is not checked off by its end. Sounds and banners play in the panel; push notifications reach your phone/browser (turn them on in 🔔 Notifications).</p>
      <div class="row" style="gap:16px;flex-wrap:wrap">${toggle('Push notifications', 'push', n.push)}${toggle('Sound + banner in the panel', 'sound', n.sound)}${toggle('Telegram bot message', 'tg', n.tg, 'To the admin chat of your Telegram bot')}</div>
      ${field('Minutes before (0 = only at the start)', 'pre', n.pre, { type: 'number', attrs: 'min="0" max="60"' })}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Activity</th><th>Push</th><th>Sound</th><th>Telegram</th></tr></thead><tbody>${blocks.map((b) => { const p = n.per[b.id] || {}; return `<tr><td>${esc(b.v.icon)} ${esc(b.v.start)} · ${esc(b.v.title)}</td><td><input type="checkbox" name="p_${b.id}" ${p.push !== false ? 'checked' : ''}></td><td><input type="checkbox" name="s_${b.id}" ${p.sound !== false ? 'checked' : ''}></td><td><input type="checkbox" name="t_${b.id}" ${p.tg ? 'checked' : ''}></td></tr>`; }).join('')}</tbody></table></div>
      <div class="row" style="justify-content:flex-end;gap:6px;margin-top:10px"><button class="btn sm" data-act="op-snd-test">🔊 Test the sound</button><button class="btn primary" data-act="op-notify-save">💾 Save</button></div></form>`, { wide: true }); },
  'op-snd-test': () => opBanner({ icon: '🔔', title: 'Test alert', start: '', end: '' }, 'start', true),
  'op-notify-save': async (el) => { const f = el.closest('form'); const per = {}; for (const b of OP.cache.blocks) if (f['p_' + b.id]) per[b.id] = { push: f['p_' + b.id].checked, sound: f['s_' + b.id].checked, tg: f['t_' + b.id].checked };
    try { await api('PUT', '/api/admin/ownerplan/notify', { push: f.push.checked, sound: f.sound.checked, tg: f.tg.checked, pre: Number(f.pre.value) || 0, per }); closeModal(); toast('Alerts saved ✓'); opReload(); } catch (e) { toast(e.message, true); } },
  'op-holiday': () => { const c = OP.cache; const list = c.holidaysCustom || [];
    modal('🏖️ Holidays', `<p class="small muted" style="margin-top:0">Official holidays (US, Europe, Islamic dates approx.) are highlighted automatically on the calendar. Add your own days here.</p>
      ${list.length ? `<div>${list.map((h) => `<div class="list-item"><div style="flex:1"><b>${esc(h.name)}</b> <span class="small muted">${esc(h.date)}</span></div><button class="btn sm ghost" data-act="op-hol-del" data-id="${esc(h.id)}">🗑</button></div>`).join('')}</div>` : ''}
      <form data-form="op-hol" onsubmit="return false"><div class="grid2">${field('Date', 'date', OP.date, { type: 'date' })}${field('Name', 'name', '', { ph: 'Family day', attrs: 'maxlength="80"' })}</div><div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="op-hol-add">＋ Add</button></div></form>`); },
  'op-hol-add': async (el) => { const f = el.closest('form'); try { await api('POST', '/api/admin/ownerplan/holiday', { date: f.elements.date.value, name: f.elements.name.value }); closeModal(); toast('Holiday added ✓'); opReload(); } catch (e) { toast(e.message, true); } },
  'op-hol-del': async (el) => { try { await api('POST', '/api/admin/ownerplan/holiday', { remove: el.dataset.id }); closeModal(); toast('Removed'); opReload(); } catch (e) { toast(e.message, true); } },
  'op-banner-x': () => { document.getElementById('op-banner')?.remove(); },
});
document.addEventListener('submit', async (e) => { const f = e.target; if (f.dataset?.form !== 'op-api') return; e.preventDefault();
  const b = f.querySelector('button'); b.disabled = true;
  try { const r = await api('POST', '/api/admin/ownerplan/api', { date: f.dataset.date, i: Number(f.dataset.i), domain: f.domain.value.trim(), apiKey: f.apiKey.value.trim() || undefined, status: f.status.value }); f.apiKey.value = ''; toast(`Saved ✓ · ${r.linked}/${r.goal} linked`); opReload(); } catch (er) { toast(er.message, true); b.disabled = false; } });
// --- alerts in the panel: banner + sound N minutes before / at the start, a pending pill for unchecked activities ---
const OPA = { data: null, at: 0 };
async function opAlertsRefresh() { if (!state.token || !isAdminUI() || state.admin.me?.role !== 'owner') return; try { OPA.data = await api('GET', '/api/admin/ownerplan'); OPA.at = Date.now(); } catch {} opAlertsTick(); }
function opBanner(b, kind, force = false) {
  const n = OPA.data?.notify || {}; const per = (n.per || {})[b.id] || {}; if (!force && (n.sound === false || per.sound === false)) return;
  try { const c = sndCfg(); if (c.on || force) playTone(kind === 'late' ? 'alarm' : 'bell', c.vol || 0.6); } catch {}
  document.getElementById('op-banner')?.remove(); const d = document.createElement('div'); d.id = 'op-banner'; d.className = 'op-banner';
  d.innerHTML = `<span style="font-size:26px">${esc(b.icon || '⏰')}</span><div style="flex:1"><b>${kind === 'pre' ? `In ${n.pre || 10} min` : kind === 'late' ? 'Not checked off' : 'Now'} · ${esc(b.title)}</b><div class="small">${esc(b.start || '')}${b.end ? '–' + esc(b.end) : ''}</div></div><a class="btn sm primary" data-act="atab" data-tab="ownerplan">Open</a><button class="btn sm ghost" data-act="op-banner-x">✕</button>`;
  document.body.appendChild(d); setTimeout(() => d.remove(), 120000);
}
function opAlertsTick() {
  const D = OPA.data; if (!D || state.admin.me?.role !== 'owner' || !isAdminUI()) { document.getElementById('op-pill')?.remove(); return; }
  const now = new Date(); let p; try { p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: D.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value])); } catch { return; }
  const date = `${p.year}-${p.month}-${p.day}`; const min = +p.hour * 60 + +p.minute; if (date !== D.today) { if (Date.now() - OPA.at > 60000) opAlertsRefresh(); return; }
  const toM = (x) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; }; const pre = Number(D.notify?.pre) || 0; const row = D.rows[0];
  for (const b of row.blocks) for (const [kind, at] of [['pre', toM(b.start) - pre], ['start', toM(b.start)], ['late', toM(b.end)]]) {
    if ((kind === 'pre' && !pre) || (kind === 'late' && b.done)) continue; if (min < at || min - at >= 3) continue;
    const k = `op:${date}:${b.id}:${kind}`; try { if (localStorage.getItem(k)) continue; localStorage.setItem(k, '1'); } catch {} opBanner(b, kind); }
  const pending = row.blocks.filter((b) => !b.done && toM(b.end) <= min).length; let pill = document.getElementById('op-pill');
  if (!pending) { pill?.remove(); return; }
  if (!pill) { pill = document.createElement('a'); pill.id = 'op-pill'; pill.className = 'op-pill'; pill.dataset.act = 'atab'; pill.dataset.tab = 'ownerplan'; document.body.appendChild(pill); }
  pill.textContent = `⏳ ${pending} pending`; pill.title = 'Activities of today not checked off yet';
}
setInterval(() => { if (Date.now() - OPA.at > 5 * 60000) opAlertsRefresh(); else opAlertsTick(); }, 30000);
setTimeout(opAlertsRefresh, 4000);

async function adminPlanSync() {
  const r = await api('GET', '/api/admin/ownerplan/sync'); const d = r.result || r;
  const months = Array.isArray(d.months) ? d.months : [];
  const cur = String(d.today || '').slice(0, 7);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `<div class="card"><h3 style="margin-top:0">🗓️ ${esc(t('planSyncTitle'))}</h3>
    <p class="small muted" style="margin:6px 0 12px">${esc(t('planSyncText', { from: d.from || d.first || '', to: d.to || d.last || '' }))}</p>
    <div class="op-months-scroll">${months.map((m) => `<span class="op-chip ${m === cur ? 'on' : ''}">${esc(m)}</span>`).join('')}</div>
    <div class="small muted" style="margin-top:8px">${esc(t('planSyncUpdated', { at: fmtDT(d.updatedAt) }))}</div></div>
  <div class="card"><h3 style="margin-top:0">📌 ${esc(t('planSyncRules'))}</h3>
    ${(d.plan || []).length ? d.plan.map((b) => `<div class="plan-sync-row"><span class="plan-sync-icon">${esc(b.icon || '•')}</span><div style="flex:1;min-width:0"><b>${esc(b.title || '')}</b><div class="small muted">${esc(b.rule || '')} · ${esc((b.days || []).map((x) => days[x]).join(' / '))}${Number(b.dom) ? ' · ' + esc(t('planSyncDom', { n: b.dom })) : ''}</div></div><span class="small muted">${esc(b.start || '')} → ${esc(b.end || '')}</span></div>`).join('') : `<p class="muted small">${esc(t('planSyncEmpty'))}</p>`}</div>
  <div class="card"><h3 style="margin-top:0">👥 ${esc(t('planSyncTeam'))}</h3><div class="chip-row">${(d.agents || []).map((a) => `<span class="op-chip">${esc(a.name || a.username || a.id)}</span>`).join('')}</div>
    <p class="small muted" style="margin:10px 0 0">${esc(t('planSyncPrivate'))}</p></div>`;
}
document.addEventListener('change', (e) => {
  const el = e.target; if (el?.dataset?.act !== 'op-month-select') return;
  OP.month = el.value; if (OP.view === 'day') OP.view = 'month';
  const today = OP.cache?.today || ''; OP.date = today.startsWith(OP.month) ? today : OP.month + '-01';
  renderAdmin();
});
