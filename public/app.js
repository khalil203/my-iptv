import { createBackend } from './core.js';

// ---------------- helpers ----------------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDT = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
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
const pill = (st) => `<span class="pill st-${st}">${st}</span>`;
function progress(c) {
  const pct = Math.max(0, Math.min(100, (c.daysLeft / (c.planDays || 30)) * 100));
  return `<div class="prog ${c.state === 'expired' ? 'bad' : c.state === 'expiring' ? 'warn' : ''}"><i style="width:${pct}%"></i></div>`;
}
const brandHtml = (b, sub = true) => `<div class="brand">${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="">` : `<div class="logo-mark">${esc(initials(b.appName))}</div>`}<div><b>${esc(b.appName)}</b>${sub ? `<span>${esc(b.tagline)}</span>` : ''}</div></div>`;

// ---------------- state & API ----------------
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
  if (status >= 400) {
    if (status === 401 && state.token && !path.includes('/login')) { setSession(null); route(); }
    throw Object.assign(new Error(json.error || 'Error'), { status });
  }
  return json;
}
function setSession(token, role) {
  state.token = token; state.role = role;
  if (token) { localStorage.setItem('tvp_token', token); localStorage.setItem('tvp_role', role); }
  else { localStorage.removeItem('tvp_token'); localStorage.removeItem('tvp_role'); }
  state.user = { tab: 'home', me: null, cache: {}, cat: {}, q: '', limit: 120 };
}

function applyBranding(b) {
  const r = document.documentElement.style;
  r.setProperty('--primary', b.primary || '#7c5cff');
  r.setProperty('--accent', b.accent || '#22d3ee');
  r.setProperty('--bg', b.background || '#0b0d17');
  document.title = b.appName || 'IPTV';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', b.background || '#0b0d17');
}

async function boot() {
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
}

function route() {
  closeModal();
  if (state.config.setupRequired) return renderSetup();
  if (!state.token) return renderLogin();
  if (state.role === 'admin') return renderAdmin();
  return renderUser();
}
async function refreshConfig() { state.config = await api('GET', '/api/config'); applyBranding(state.config.branding); }

// ---------------- login & setup ----------------
function loginCard(b, { preview = false, error = '' } = {}) {
  return `<div class="login-wrap" style="${b.loginBgUrl ? `background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.6)),url('${esc(b.loginBgUrl)}')` : ''}">
    <div class="login-card">
      ${brandHtml(b)}
      <h2>${esc(b.loginTitle)}</h2>
      <p class="muted" style="margin-top:0">${esc(b.loginSubtitle)}</p>
      ${error ? `<div class="err-box">${esc(error)}</div>` : ''}
      <form ${preview ? '' : 'data-form="login"'}>
        ${field('Username', 'username', '', { attrs: 'autocomplete="username" autocapitalize="none" required' })}
        <label class="field"><span>Password</span><div class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" data-act="pw-eye">👁</button></div></label>
        <button class="btn primary block" ${preview ? 'type="button"' : ''}>Sign in</button>
      </form>
      ${b.supportUrl ? `<div class="login-foot"><a href="${esc(b.supportUrl)}" target="_blank" rel="noopener">${esc(b.supportLabel || 'Contact support')}</a></div>` : ''}
      ${b.footerText ? `<div class="login-foot">${esc(b.footerText)}</div>` : ''}
      ${state.mode === 'demo' && !preview ? `<div class="login-foot"><span class="badge-demo">Demo mode · data stays in this browser</span></div>` : ''}
    </div></div>`;
}
function renderLogin(error = '') { $('#app').innerHTML = loginCard(state.config.branding, { error }); }
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
  ['overview', '📊', 'Overview'], ['customers', '👥', 'Customers'], ['subs', '📅', 'Subscriptions'], ['plans', '💳', 'Plans & prices'],
  ['userdash', '📱', 'User dashboard'], ['branding', '🎨', 'Login & branding'], ['api', '🔌', 'API settings'],
  ['security', '🔐', 'Account & backup'], ['activity', '🧾', 'Activity'],
];

async function renderAdmin() {
  const b = state.config.branding;
  const t = state.admin.tab;
  const title = ADMIN_TABS.find((x) => x[0] === t)?.[2] || '';
  $('#app').innerHTML = `<div class="admin">
    <aside class="side">${brandHtml(b, false)}<nav class="nav">${ADMIN_TABS.map(([k, ic, n]) => `<a class="${k === t ? 'on' : ''}" data-act="atab" data-tab="${k}"><span class="ic">${ic}</span>${n}</a>`).join('')}</nav></aside>
    <div class="main">
      <div class="topbar"><h2>${title}</h2><span class="spacer"></span>${state.mode === 'demo' ? '<span class="badge-demo">Demo</span>' : ''}<button class="btn sm" data-act="logout">Log out</button></div>
      <div class="mobile-nav">${ADMIN_TABS.map(([k, ic, n]) => `<a class="${k === t ? 'on' : ''}" data-act="atab" data-tab="${k}">${ic} ${n}</a>`).join('')}</div>
      <div class="content" id="admin-body"><div class="spinner"></div></div>
    </div></div>`;
  try {
    const s = await api('GET', '/api/admin/settings');
    state.admin.settings = s;
    const body = $('#admin-body');
    if (t === 'overview') body.innerHTML = await adminOverview();
    else if (t === 'customers') { state.admin.customers = await api('GET', '/api/admin/customers'); body.innerHTML = adminCustomers(); }
    else if (t === 'subs') { state.admin.customers = await api('GET', '/api/admin/customers'); body.innerHTML = await adminSubs(); }
    else if (t === 'plans') body.innerHTML = adminPlans(s);
    else if (t === 'userdash') body.innerHTML = adminUserDash(s);
    else if (t === 'branding') body.innerHTML = adminBranding(s);
    else if (t === 'api') body.innerHTML = adminApi(s);
    else if (t === 'security') body.innerHTML = await adminSecurity(s);
    else if (t === 'activity') body.innerHTML = await adminActivity();
  } catch (e) { if (state.token) $('#admin-body').innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
}

async function adminOverview() {
  const [st, cr] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/panel/credits').catch(() => ({}))]);
  const max = Math.max(1, ...Object.values(st.byMonth));
  const s = state.admin.settings;
  const setupTips = [];
  if (!s.player.serverUrl) setupTips.push('Add your streaming server URL in <a data-act="atab" data-tab="api">API settings</a> so customers can watch.');
  if (!s.reseller.enabled) setupTips.push('Connect the TVplus reseller API in <a data-act="atab" data-tab="api">API settings</a> to create and renew lines automatically.');
  const row = (c) => `<div class="list-item"><div class="avatar">${esc(initials(c.name))}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="small muted">${esc(c.username)} · ${c.state === 'expired' ? 'expired ' + fmtDate(c.expiresAt) : c.daysLeft + ' days left'}</div></div><button class="btn sm primary" data-act="renew" data-id="${c.id}">Renew</button></div>`;
  return `${setupTips.length ? `<div class="notice warning"><b>Finish setup</b><ul style="margin:6px 0 0;padding-left:18px">${setupTips.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}
  <div class="stats">
    <div class="stat"><span>Customers</span><b>${st.total}</b></div>
    <div class="stat c-ok"><span>Active</span><b>${st.active}</b></div>
    <div class="stat c-warn"><span>Expiring soon</span><b>${st.expiring}</b></div>
    <div class="stat c-bad"><span>Expired</span><b>${st.expired}</b></div>
    <div class="stat"><span>Disabled</span><b>${st.disabled}</b></div>
    <div class="stat c-acc"><span>Revenue this month</span><b>${money(st.revenueMonth)}</b></div>
    <div class="stat"><span>Total revenue</span><b>${money(st.revenueTotal)}</b></div>
    <div class="stat"><span>Panel credits</span><b>${cr.enabled ? (cr.ok ? esc(cr.credits ?? '—') : '⚠️') : 'off'}</b></div>
  </div>
  <div class="grid2" style="gap:16px">
    <div class="card"><div class="row"><h3>Expiring soon</h3><span class="spacer"></span><a class="small" data-act="atab" data-tab="subs" style="cursor:pointer">Tracker →</a></div>${st.expiringSoon.length ? st.expiringSoon.map(row).join('') : '<p class="muted">Nobody is expiring soon.</p>'}</div>
    <div class="card"><h3>Recently expired</h3>${st.recentlyExpired.length ? st.recentlyExpired.map(row).join('') : '<p class="muted">No expired customers.</p>'}</div>
  </div>
  <div class="card"><h3>Revenue · last 6 months</h3><div class="bars">${Object.entries(st.byMonth).map(([k, v]) => `<div><span>${v ? Number(v).toLocaleString() : ''}</span><i style="height:${(v / max) * 100}%"></i><span>${k.slice(5)}/${k.slice(2, 4)}</span></div>`).join('')}</div></div>
  <div class="row"><button class="btn primary" data-act="new-customer">＋ Add customer</button><button class="btn" data-act="atab" data-tab="api">🔌 API settings</button></div>`;
}

function filteredCustomers() {
  const { filter, q } = state.admin;
  const qq = q.trim().toLowerCase();
  return state.admin.customers
    .filter((c) => filter === 'all' || c.state === filter)
    .filter((c) => !qq || [c.name, c.username, c.phone, c.lineUsername, c.note].some((x) => String(x || '').toLowerCase().includes(qq)))
    .sort((a, b) => a.expiresAt - b.expiresAt);
}
function custActions(c) {
  return `<button class="btn sm primary" data-act="renew" data-id="${c.id}">Renew</button>
    <button class="btn sm" data-act="edit-customer" data-id="${c.id}">Edit</button>
    <button class="btn sm" data-act="toggle-customer" data-id="${c.id}">${c.status === 'disabled' ? 'Enable' : 'Disable'}</button>
    <button class="btn sm" data-act="copy-login" data-id="${c.id}" title="Copy login details">📋</button>
    <button class="btn sm danger" data-act="del-customer" data-id="${c.id}">🗑</button>`;
}
function customerListHtml() {
  const list = filteredCustomers();
  if (!list.length) return `<div class="empty"><span class="ic">👥</span>No customers here yet.</div>`;
  return `<div class="tbl-wrap cust-table"><table class="tbl"><thead><tr><th>Customer</th><th>Login</th><th>Plan</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.phone)}</div></td><td>${esc(c.username)}${c.lineId ? `<div class="small muted">line #${esc(c.lineId)}</div>` : ''}</td><td>${esc(c.planName)}<div class="small muted">${c.connections} device${c.connections > 1 ? 's' : ''}</div></td>
      <td>${fmtDate(c.expiresAt)}<div class="small muted">${c.daysLeft >= 0 ? c.daysLeft + ' days left' : -c.daysLeft + ' days ago'}</div>${progress(c)}</td><td>${pill(c.state)}</td><td><div class="row" style="justify-content:flex-end">${custActions(c)}</div></td></tr>`).join('')}
    </tbody></table></div>
    <div class="cust-cards">${list.map((c) => `<div class="cc"><div class="row"><div class="avatar">${esc(initials(c.name))}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="small muted">${esc(c.username)} · ${esc(c.planName)}</div></div>${pill(c.state)}</div>
      <div class="small muted" style="margin:10px 0 6px">Expires ${fmtDate(c.expiresAt)} · ${c.daysLeft >= 0 ? c.daysLeft + ' days left' : 'expired'}</div>${progress(c)}<div class="row" style="margin-top:12px">${custActions(c)}</div></div>`).join('')}</div>`;
}
function adminCustomers() {
  const a = state.admin;
  const counts = (st) => a.customers.filter((c) => st === 'all' || c.state === st).length;
  return `<div class="row" style="margin-bottom:14px"><input style="flex:1;min-width:200px" placeholder="🔎 Search name, username, phone…" value="${esc(a.q)}" data-input="cust-search"><button class="btn primary" data-act="new-customer">＋ Add customer</button></div>
    <div class="chips">${['all', 'active', 'expiring', 'expired', 'disabled'].map((f) => `<a class="${a.filter === f ? 'on' : ''}" data-act="cust-filter" data-f="${f}">${f} (${counts(f)})</a>`).join('')}</div>
    <div id="cust-list">${customerListHtml()}</div>`;
}

function customerForm(c) {
  const s = state.admin.settings;
  const isNew = !c;
  c = c || { planId: s.plans[0]?.id, connections: s.plans[0]?.connections || 1, startAt: Date.now() };
  const planOpts = [...s.plans.map((p) => [p.id, `${p.name} · ${p.days} days · ${p.price} ${s.currency}`]), ['custom', 'Custom dates']];
  return `<form data-form="customer" data-id="${c.id || ''}">
    <div class="grid2">${field('Customer name', 'name', c.name || '', { attrs: 'required' })}${field('Phone / LINE ID', 'phone', c.phone || '')}</div>
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
    ${isNew ? `<div class="grid2">${field(`Amount paid (${s.currency})`, 'price', s.plans[0]?.price || 0, { type: 'number', attrs: 'min="0"' })}<div></div></div>
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
    <div class="grid2">${field('Days to add', 'days', p0.days, { type: 'number', attrs: 'min="1"' })}${field(`Amount paid (${s.currency})`, 'price', p0.price, { type: 'number', attrs: 'min="0"' })}</div>
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
  const list = a.customers.filter((c) => c.state !== 'disabled' && c.daysLeft <= lim).sort((x, y) => x.expiresAt - y.expiresAt);
  const renewals = a.customers.flatMap((c) => (c.renewals || []).map((r) => ({ ...r, name: c.name, username: c.username }))).sort((x, y) => y.at - x.at).slice(0, 40);
  const max = Math.max(1, ...Object.values(st.byMonth));
  return `<div class="stats">
      <div class="stat c-ok"><span>Active</span><b>${st.active}</b></div><div class="stat c-warn"><span>Expiring soon</span><b>${st.expiring}</b></div>
      <div class="stat c-bad"><span>Expired</span><b>${st.expired}</b></div><div class="stat"><span>Renewals recorded</span><b>${st.renewalsCount}</b></div>
      <div class="stat c-acc"><span>This month</span><b>${money(st.revenueMonth)}</b></div></div>
    <div class="card"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">Subscription tracker</h3><span class="spacer"></span>
      <select data-input="sub-days" style="width:auto">${[['7', 'Expiring in 7 days'], ['14', '14 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All subscriptions']].map(([v, t]) => `<option value="${v}" ${a.subDays === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn sm" data-act="export-csv">⬇ CSV</button></div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Plan</th><th>Expires</th><th style="min-width:120px">Time left</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.username)} ${c.phone ? '· ' + esc(c.phone) : ''}</div></td><td>${esc(c.planName)}</td><td>${fmtDate(c.expiresAt)}</td>
        <td><div class="small">${c.daysLeft >= 0 ? c.daysLeft + ' days' : 'expired ' + -c.daysLeft + 'd ago'}</div>${progress(c)}</td><td>${pill(c.state)}</td><td><button class="btn sm primary" data-act="renew" data-id="${c.id}">Renew</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Nothing in this range.</p>'}</div>
    <div class="grid2" style="gap:16px">
      <div class="card"><h3>Revenue by month</h3><div class="bars">${Object.entries(st.byMonth).map(([k, v]) => `<div><span>${v ? Number(v).toLocaleString() : ''}</span><i style="height:${(v / max) * 100}%"></i><span>${k.slice(5)}/${k.slice(2, 4)}</span></div>`).join('')}</div></div>
      <div class="card"><h3>Latest payments & renewals</h3>${renewals.length ? renewals.map((r) => `<div class="list-item"><span>${r.type === 'new' ? '🆕' : '🔁'}</span><div style="flex:1;min-width:0"><b>${esc(r.name)}</b><div class="small muted">${fmtDT(r.at)} · +${r.days} days</div></div><b>${money(r.price)}</b></div>`).join('') : '<p class="muted">No payments yet.</p>'}</div>
    </div>`;
}

function adminPlans(s) {
  const row = (p) => `<div class="plan-row" data-plan="${esc(p.id || '')}"><input data-k="name" value="${esc(p.name)}" placeholder="Name"><input data-k="days" type="number" value="${p.days}" placeholder="Days"><input data-k="price" type="number" value="${p.price}" placeholder="Price"><input data-k="connections" type="number" value="${p.connections}" placeholder="Devices"><input data-k="package" value="${esc(p.package)}" placeholder="Package ID"><button class="btn sm danger" data-act="del-plan">✕</button></div>`;
  return `<div class="card"><h3>Plans & prices</h3><p class="muted small">"Package ID" is the package/bouquet number on your TVplus panel. It is sent as <code>{package}</code> in API calls.</p>
    <div class="plan-row small muted" style="margin-bottom:4px"><span>Name</span><span>Days</span><span>Price</span><span>Devices</span><span>Package ID</span><span></span></div>
    <div id="plans">${s.plans.map(row).join('')}</div>
    <button class="btn sm" data-act="add-plan">＋ Add plan</button>
    <div class="grid2" style="margin-top:16px">${field('Currency', 'currency', s.currency, { attrs: 'id="currency"' })}</div>
    <button class="btn primary" data-act="save-plans">Save plans</button></div>`;
}

function adminUserDash(s) {
  const d = s.userDashboard;
  return `<form data-form="settings" class="card"><h3>What customers can see</h3>
    ${toggle('📺 Live TV', 'userDashboard.live', d.live)}${toggle('🎬 Movies', 'userDashboard.movies', d.movies)}${toggle('🎞 Series', 'userDashboard.series', d.series)}
    ${toggle('🗓 TV guide (EPG) under live channels', 'userDashboard.epg', d.epg)}${toggle('🔎 Search', 'userDashboard.search', d.search)}${toggle('⭐ Favorites', 'userDashboard.favorites', d.favorites)}
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
    ${toggle('Play through the built-in secure proxy (recommended)', 'player.useProxy', s.player.useProxy, 'Fixes "http" streams on iPhone/HTTPS and hides the server from customers. Note: Cloudflare only connects to ports 80, 8080, 8880, 2052, 2082, 2086, 2095 (http) or 443, 8443, 2053, 2083, 2087, 2096 (https).')}
    <div class="grid3" style="margin-top:12px">${field('Test line username', 'tu', '', { attrs: 'data-skip id="test-u" autocapitalize="none"' })}${field('Test line password', 'tp', '', { attrs: 'data-skip id="test-p" autocapitalize="none"' })}<div class="field"><span>&nbsp;</span><button type="button" class="btn" data-act="test-player">Test server</button></div></div>
    <div id="test-player-out"></div>
  </div>
  <div class="card"><h3>2 · TVplus reseller API (create / renew lines)</h3>
    ${toggle('Enable reseller API', 'reseller.enabled', r.enabled)}
    ${toggle('Auto-sync enable/disable with the panel', 'reseller.autoSync', r.autoSync)}
    <div class="grid2" style="margin-top:12px">${field('API base URL', 'reseller.baseUrl', r.baseUrl, { ph: 'https://panel.tvpluspanel.com', attrs: 'autocapitalize="none"', help: 'Used as {base}' })}${field('API key / token', 'reseller.apiKey', r.apiKey, { type: 'password', attrs: 'autocomplete="off"', help: 'Used as {key}. Stored on the server only.' })}</div>
    <div class="grid2">${field('Reseller username', 'reseller.username', r.username, { attrs: 'autocapitalize="none"', help: '{reseller_user}' })}${field('Reseller password', 'reseller.password', r.password, { type: 'password', help: '{reseller_pass}' })}</div>
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
  const me = await api('GET', '/api/admin/me');
  return `<div class="grid2" style="gap:16px;align-items:start">
  <form data-form="admin-account" class="card"><h3>Admin login details</h3>
    ${field('Admin username', 'username', me.username, { attrs: 'autocapitalize="none"' })}
    ${field('New password (leave empty to keep)', 'newPassword', '', { type: 'password' })}
    ${field('Current password (required)', 'currentPassword', '', { type: 'password', attrs: 'required' })}
    <button class="btn primary">Update admin login</button></form>
  <div><form data-form="settings" class="card"><h3>Sessions</h3>
    ${field('Keep users signed in for (hours)', 'security.sessionHours', s.security.sessionHours, { type: 'number', attrs: 'min="1" max="2160"' })}
    <button class="btn primary">Save</button></form>
  <div class="card"><h3>Backup</h3><p class="small muted">Download all settings and customers, or restore from a backup file.</p>
    <div class="row"><button class="btn" data-act="backup">⬇ Download backup</button><label class="btn">⬆ Restore<input type="file" accept=".json" data-input="restore" hidden></label></div>
    ${state.mode === 'demo' ? `<hr style="border-color:var(--line);margin:16px 0"><p class="small muted">Demo mode keeps data in this browser only.</p><button class="btn danger" data-act="reset-demo">Reset demo data</button>` : ''}
  </div></div></div>`;
}

async function adminActivity() {
  const log = await api('GET', '/api/admin/log');
  const icon = { customer: '👤', renewal: '🔁', settings: '⚙️', admin: '🔐' };
  return `<div class="card">${log.length ? log.map((l) => `<div class="list-item"><span>${icon[l.type] || '•'}</span><div style="flex:1">${esc(l.msg)}</div><span class="small muted">${fmtDT(l.at)}</span></div>`).join('') : '<p class="muted">No activity yet.</p>'}</div>`;
}

function showResult(el, r) {
  el.innerHTML = `<div class="notice ${r.ok ? 'success' : 'danger'}" style="margin-top:12px"><b>${r.ok ? '✅ Connected' : '❌ ' + esc(r.error || 'Failed')}</b>${r.credits != null ? ` · Credits: <b>${esc(r.credits)}</b>` : ''}${r.data != null ? `<div class="code" style="margin-top:8px">${esc(typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2)).slice(0, 3000)}</div>` : ''}</div>`;
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
  if (!u.me) {
    $('#app').innerHTML = `<div class="boot"><div class="spinner"></div></div>`;
    try { u.me = await api('GET', '/api/me'); } catch { return; }
    applyBranding(u.me.branding);
  }
  const { user, dashboard: d, branding: b } = u.me;
  const tabs = [['home', '🏠', 'Home'], d.live && ['live', '📺', 'Live'], d.movies && ['movies', '🎬', 'Movies'], d.series && ['series', '🎞', 'Series'], ['account', '👤', 'Account']].filter(Boolean);
  if (!tabs.some((t) => t[0] === u.tab)) u.tab = 'home';
  $('#app').innerHTML = `<div class="uapp"><div class="uhead">${brandHtml(b, false)}<span class="spacer"></span>${state.mode === 'demo' ? '<span class="badge-demo">Demo</span>' : ''}<div class="avatar" data-act="utab" data-tab="account" style="cursor:pointer">${esc(initials(user.name))}</div></div>
    <div class="ubody" id="ubody"></div>
    <nav class="bnav">${tabs.map(([k, ic, n]) => `<a class="${u.tab === k ? 'on' : ''}" data-act="utab" data-tab="${k}"><span class="ic">${ic}</span>${n}</a>`).join('')}</nav></div>`;
  renderUserTab();
}

function blockedScreen() {
  const { user, dashboard: d, branding: b } = state.user.me;
  if (d.maintenance) return `<div class="block-screen"><div class="ic">🛠</div><h2>Under maintenance</h2><p class="muted">${esc(d.maintenanceMessage)}</p></div>`;
  if (user.state === 'expired') return `<div class="block-screen"><div class="ic">⏰</div><h2>Your subscription has expired</h2><p class="muted">Expired on ${fmtDate(user.expiresAt)}. Renew to keep watching.</p>${b.supportUrl ? `<a class="btn primary" href="${esc(b.supportUrl)}" target="_blank" rel="noopener">${esc(b.supportLabel || 'Contact support')}</a>` : ''}</div>`;
  if (!state.user.me.stream) return `<div class="block-screen"><div class="ic">📡</div><h2>Not available yet</h2><p class="muted">The streaming server isn't set up yet. Please contact support.</p></div>`;
  return '';
}

async function renderUserTab() {
  const u = state.user; const el = $('#ubody');
  const { user, dashboard: d, branding: b } = u.me;
  if (u.tab === 'home') {
    const favs = d.favorites ? getFavs() : [];
    el.innerHTML = `<h2>Hello, ${esc(user.name.split(' ')[0])} 👋</h2>
      ${d.maintenance ? `<div class="notice warning">🛠 ${esc(d.maintenanceMessage)}</div>` : ''}
      ${d.announcement ? `<div class="notice ${esc(d.announcementType)}">📣 ${esc(d.announcement)}</div>` : ''}
      ${user.state === 'expiring' ? `<div class="notice warning">⏳ Your subscription ends in <b>${user.daysLeft} day${user.daysLeft === 1 ? '' : 's'}</b>. ${b.supportUrl ? `<a href="${esc(b.supportUrl)}" target="_blank" rel="noopener">Renew now</a>` : 'Contact us to renew.'}</div>` : ''}
      ${user.state === 'expired' ? `<div class="notice danger">⏰ Your subscription expired on ${fmtDate(user.expiresAt)}. ${b.supportUrl ? `<a href="${esc(b.supportUrl)}" target="_blank" rel="noopener">Renew now</a>` : ''}</div>` : ''}
      ${d.showSubscription ? `<div class="sub-card"><div class="row"><span class="muted small" style="font-weight:700">MY SUBSCRIPTION</span><span class="spacer"></span>${pill(user.state)}</div>
        <div class="row" style="margin:12px 0;align-items:flex-end"><div><div class="big">${Math.max(0, user.daysLeft)}</div><div class="muted small">days left</div></div><span class="spacer"></span><div style="text-align:right"><b>${esc(user.planName)}</b><div class="small muted">until ${fmtDate(user.expiresAt)}</div><div class="small muted">${user.connections} device${user.connections > 1 ? 's' : ''}</div></div></div>${progress(user)}</div>` : ''}
      <div class="tiles">${d.live ? '<div class="tile" data-act="utab" data-tab="live"><span class="ic">📺</span><b>Live TV</b></div>' : ''}${d.movies ? '<div class="tile" data-act="utab" data-tab="movies"><span class="ic">🎬</span><b>Movies</b></div>' : ''}${d.series ? '<div class="tile" data-act="utab" data-tab="series"><span class="ic">🎞</span><b>Series</b></div>' : ''}${b.supportUrl ? `<a class="tile" href="${esc(b.supportUrl)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="ic">💬</span><b>${esc(b.supportLabel || 'Support')}</b></a>` : ''}</div>
      ${favs.length ? `<h3>⭐ Favorites</h3>${itemsGrid(favs)}` : ''}`;
    return;
  }
  if (u.tab === 'account') {
    el.innerHTML = `<div class="card"><div class="row"><div class="avatar" style="width:52px;height:52px;font-size:20px">${esc(initials(user.name))}</div><div><h2 style="margin:0">${esc(user.name)}</h2><div class="muted">${esc(user.username)}</div></div></div></div>
      <div class="card"><h3>Subscription</h3><div class="list-item"><span style="flex:1">Status</span>${pill(user.state)}</div><div class="list-item"><span style="flex:1">Plan</span><b>${esc(user.planName)}</b></div><div class="list-item"><span style="flex:1">Started</span><b>${fmtDate(user.startAt)}</b></div><div class="list-item"><span style="flex:1">Expires</span><b>${fmtDate(user.expiresAt)}</b></div><div class="list-item"><span style="flex:1">Devices</span><b>${user.connections}</b></div>
        ${(user.renewals || []).length ? `<h3 style="margin-top:14px">History</h3>${user.renewals.slice().reverse().map((r) => `<div class="list-item small"><span style="flex:1">${r.type === 'new' ? 'Started' : 'Renewed'} · ${fmtDate(r.at)}</span><span>+${r.days} days</span></div>`).join('')}` : ''}</div>
      ${d.allowPasswordChange ? `<form class="card" data-form="user-password"><h3>Change password</h3>${field('Current password', 'current', '', { type: 'password', attrs: 'required' })}${field('New password', 'next', '', { type: 'password', attrs: 'required minlength="6"' })}<button class="btn primary">Update password</button></form>` : ''}
      <div class="row">${b.supportUrl ? `<a class="btn" href="${esc(b.supportUrl)}" target="_blank" rel="noopener">💬 ${esc(b.supportLabel || 'Support')}</a>` : ''}<button class="btn danger" data-act="logout">Log out</button></div>`;
    return;
  }
  const blocked = blockedScreen();
  if (blocked) { el.innerHTML = blocked; return; }
  const kind = u.tab;
  const catAction = { live: 'get_live_categories', movies: 'get_vod_categories', series: 'get_series_categories' }[kind];
  const listAction = { live: 'get_live_streams', movies: 'get_vod_streams', series: 'get_series' }[kind];
  el.innerHTML = `<div class="spinner"></div>`;
  try {
    const cats = await xt(catAction);
    const cat = u.cat[kind] ?? (cats[0]?.category_id ?? '');
    u.cat[kind] = cat;
    const items = cat === '*' ? await xt(listAction) : await xt(listAction, { category_id: cat });
    const q = u.q.trim().toLowerCase();
    const list = (Array.isArray(items) ? items : []).filter((i) => !q || String(i.name).toLowerCase().includes(q));
    const mapped = list.map((i) => kind === 'live'
      ? { kind: 'live', id: i.stream_id, name: i.name, icon: i.stream_icon }
      : kind === 'movies' ? { kind: 'movie', id: i.stream_id, name: i.name, icon: i.stream_icon, ext: i.container_extension }
      : { kind: 'series', id: i.series_id, name: i.name, icon: i.cover });
    el.innerHTML = `${d.search ? `<input placeholder="🔎 Search in this category…" value="${esc(u.q)}" data-input="u-search" style="margin-bottom:12px">` : ''}
      <div class="chips"><a class="${cat === '*' ? 'on' : ''}" data-act="ucat" data-cat="*">All</a>${(Array.isArray(cats) ? cats : []).map((c) => `<a class="${String(c.category_id) === String(cat) ? 'on' : ''}" data-act="ucat" data-cat="${esc(c.category_id)}">${esc(c.category_name)}</a>`).join('')}</div>
      <div id="items">${mapped.length ? itemsGrid(mapped.slice(0, u.limit)) : `<div class="empty"><span class="ic">🔍</span>Nothing found.</div>`}</div>
      ${mapped.length > u.limit ? `<div style="text-align:center;margin:16px"><button class="btn" data-act="more">Show more (${mapped.length - u.limit})</button></div>` : ''}`;
  } catch (e) { el.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
}

async function xt(action, params = {}) {
  const key = action + JSON.stringify(params);
  const c = state.user.cache;
  if (c[key]) return c[key];
  const q = new URLSearchParams({ action, ...params });
  return (c[key] = await api('GET', '/api/xtream?' + q));
}

function itemsGrid(items) {
  const d = state.user.me.dashboard;
  const live = items.filter((i) => i.kind === 'live');
  const vod = items.filter((i) => i.kind !== 'live');
  const favBtn = (i) => d.favorites ? `<button class="fav ${isFav(i.kind, i.id) ? 'on' : ''}" data-act="fav" data-item="${esc(JSON.stringify(i))}">★</button>` : '';
  return `${live.length ? `<div class="ch-grid" style="margin-bottom:14px">${live.map((i) => `<div class="ch" data-act="open-item" data-item="${esc(JSON.stringify(i))}">${favBtn(i)}${i.icon ? `<img src="${esc(i.icon)}" loading="lazy" alt="" onerror="this.outerHTML='<div class=noimg>📺</div>'">` : '<div class="noimg">📺</div>'}<span>${esc(i.name)}</span></div>`).join('')}</div>` : ''}
    ${vod.length ? `<div class="poster-grid">${vod.map((i) => `<div class="poster" data-act="open-item" data-item="${esc(JSON.stringify(i))}">${favBtn(i)}<div class="img" style="${i.icon ? `background-image:url('${esc(i.icon)}')` : ''}">${i.icon ? '' : '🎬'}</div><span>${esc(i.name)}</span></div>`).join('')}</div>` : ''}`;
}

function streamUrl(kind, id, ext) {
  const s = state.user.me.stream;
  const raw = kind === 'live' ? `${s.server}/live/${encodeURIComponent(s.u)}/${encodeURIComponent(s.p)}/${id}.m3u8`
    : `${s.server}/${kind}/${encodeURIComponent(s.u)}/${encodeURIComponent(s.p)}/${id}.${ext || 'mp4'}`;
  if (s.useProxy && state.mode === 'server') return `/proxy?u=${encodeURIComponent(raw)}&t=${encodeURIComponent(s.proxyToken)}`;
  return raw;
}

function play(title, kind, id, ext, extraHtml = '') {
  if (blockedScreen()) return toast('Playback is not available right now.', true);
  const url = streamUrl(kind, id, ext);
  const isHls = kind === 'live' || ext === 'm3u8';
  let hls = null;
  const body = modal(esc(title), `<div class="player"><video id="vid" controls playsinline autoplay></video></div><div id="pl-msg" class="small muted" style="margin-top:8px"></div>${extraHtml}`, { wide: true, onClose: () => { if (hls) hls.destroy(); const v = $('#vid'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); } } });
  const v = $('#vid', body);
  const fail = () => { $('#pl-msg').innerHTML = '⚠️ This stream could not be played. Try another channel or contact support.'; };
  if (location.protocol === 'https:' && url.startsWith('http:')) $('#pl-msg').textContent = 'Tip: turn on the secure proxy in API settings so http streams play on HTTPS and iPhone.';
  if (isHls && !v.canPlayType('application/vnd.apple.mpegurl') && window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
    hls.loadSource(url); hls.attachMedia(v);
    hls.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal) fail(); });
  } else { v.src = url; v.onerror = fail; }
  v.play().catch(() => {});
  if (kind === 'live' && state.user.me.dashboard.epg) loadEpg(id);
}
async function loadEpg(id) {
  try {
    const r = await xt('get_short_epg', { stream_id: id, limit: 5 });
    const list = r?.epg_listings || [];
    const el = $('#epg'); if (!el) return;
    el.innerHTML = list.length ? `<h3 style="margin-top:14px">TV guide</h3>${list.map((e) => `<div class="epg-item"><b>${esc(String(e.start || '').slice(11, 16))}</b>${esc(b64(e.title))}</div>`).join('')}` : '';
  } catch {}
}

async function openItem(i) {
  if (i.kind === 'live') return play(i.name, 'live', i.id, 'm3u8', '<div id="epg"></div>');
  if (i.kind === 'movie') {
    const body = modal(esc(i.name), '<div class="spinner"></div>', { wide: true });
    let info = {};
    try { info = (await xt('get_vod_info', { vod_id: i.id })).info || {}; } catch {}
    body.innerHTML = `<div class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:16px">${i.icon ? `<img src="${esc(i.icon)}" style="width:130px;border-radius:12px" alt="">` : ''}<div><p class="muted small">${esc([info.releasedate || info.year, info.genre, info.duration].filter(Boolean).join(' · '))}${info.rating ? ' · ⭐ ' + esc(info.rating) : ''}</p><p>${esc(info.plot || info.description || '')}</p><button class="btn primary" data-act="play-movie" data-item="${esc(JSON.stringify(i))}">▶ Play</button></div></div>`;
    return;
  }
  if (i.kind === 'series') {
    const body = modal(esc(i.name), '<div class="spinner"></div>', { wide: true });
    try {
      const r = await xt('get_series_info', { series_id: i.id });
      const eps = r.episodes || {};
      const seasons = Object.keys(eps).sort((a, b) => a - b);
      const renderSeason = (sn) => (eps[sn] || []).map((e) => `<div class="ep" data-act="play-ep" data-item="${esc(JSON.stringify({ id: e.id, ext: e.container_extension, name: `${i.name} · S${sn}E${e.episode_num}` }))}"><b>▶</b><div style="flex:1;min-width:0"><b>E${esc(e.episode_num)}</b> ${esc(e.title || '')}</div></div>`).join('');
      body.innerHTML = `<p class="muted">${esc(r.info?.plot || '')}</p>${seasons.length ? `<div class="chips" id="seasons">${seasons.map((sn, k) => `<a class="${k === 0 ? 'on' : ''}" data-act="season" data-sn="${esc(sn)}">Season ${esc(sn)}</a>`).join('')}</div><div id="eps">${renderSeason(seasons[0])}</div>` : '<p class="muted">No episodes yet.</p>'}`;
      body._renderSeason = renderSeason;
    } catch (e) { body.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
  }
}

// ---------------- events ----------------
const actions = {
  'close-modal': () => closeModal(),
  'modal-bg': (el, e) => { if (e.target === el) closeModal(); },
  'pw-eye': (el) => { const i = el.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; },
  logout: async () => { try { await api('POST', '/api/logout'); } catch {} setSession(null); await refreshConfig(); route(); },
  atab: (el) => { state.admin.tab = el.dataset.tab; window.scrollTo(0, 0); renderAdmin(); },
  'cust-filter': (el) => { state.admin.filter = el.dataset.f; $('#admin-body').innerHTML = adminCustomers(); },
  'new-customer': () => { modal('Add customer', customerForm(null), { wide: true }); },
  'edit-customer': (el) => { const c = state.admin.customers.find((x) => x.id === el.dataset.id); modal('Edit customer', customerForm(c), { wide: true }); },
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
  'export-csv': () => {
    const rows = [['Name', 'Username', 'Phone', 'Plan', 'Start', 'Expires', 'Days left', 'Status', 'Line ID']]
      .concat(state.admin.customers.map((c) => [c.name, c.username, c.phone, c.planName, isoDay(c.startAt), isoDay(c.expiresAt), c.daysLeft, c.state, c.lineId]));
    const csv = rows.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    download('subscriptions.csv', '﻿' + csv, 'text/csv');
  },
  'add-plan': () => { $('#plans').insertAdjacentHTML('beforeend', `<div class="plan-row" data-plan=""><input data-k="name" placeholder="Name"><input data-k="days" type="number" value="30"><input data-k="price" type="number" value="0"><input data-k="connections" type="number" value="1"><input data-k="package" placeholder="Package ID"><button class="btn sm danger" data-act="del-plan">✕</button></div>`); },
  'del-plan': (el) => el.closest('.plan-row').remove(),
  'save-plans': async () => {
    const plans = [...document.querySelectorAll('#plans .plan-row')].map((r) => {
      const g = (k) => r.querySelector(`[data-k=${k}]`).value;
      return { id: r.dataset.plan || undefined, name: g('name'), days: Number(g('days')), price: Number(g('price')), connections: Number(g('connections')), package: g('package') };
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
  async login(f) {
    const btn = f.querySelector('button.primary'); btn.disabled = true;
    try {
      const r = await api('POST', '/api/login', { username: f.username.value, password: f.password.value });
      setSession(r.token, r.role); route();
    } catch (e) { renderLogin(e.message); }
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
        const r = await api('POST', '/api/admin/customers', o);
        toast(r.panel && !r.panel.skipped ? 'Customer created + line added on panel ✓' : 'Customer created ✓');
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
    try { await api('POST', '/api/me/password', formToObj(f)); toast('Password updated ✓'); f.reset(); }
    catch (e) { toast(e.message, true); }
  },
};
async function renderAdminBodyOnly() { if (state.admin.tab === 'overview') $('#admin-body').innerHTML = await adminOverview(); }

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { if (el.tagName === 'A') e.preventDefault(); Promise.resolve(fn(el, e)).catch((err) => toast(err.message, true)); }
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  Promise.resolve(forms[f.dataset.form]?.(f)).catch((err) => toast(err.message, true));
});
let searchT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.input === 'cust-search') { state.admin.q = t.value; $('#cust-list').innerHTML = customerListHtml(); }
  if (t.dataset.input === 'u-search') { state.user.q = t.value; clearTimeout(searchT); searchT = setTimeout(() => { const pos = t.selectionStart; renderUserTab().then(() => { const n = $('[data-input=u-search]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); }, 300); }
  const pf = t.closest('form[data-preview]');
  if (pf) { const o = formToObj(pf).branding; applyBranding(o); $('#login-preview').innerHTML = loginCard(o, { preview: true }); }
  if (t.closest('form[data-form=renew]')) updateRenewPreview();
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.name === 'lineSame') $('#line-fields').style.display = t.checked ? 'none' : '';
  if (t.dataset.input === 'sub-days') { state.admin.subDays = t.value; $('#admin-body').innerHTML = await adminSubs(); }
  if (t.hasAttribute('data-renew-plan')) {
    const p = state.admin.settings.plans.find((x) => x.id === t.value);
    const f = t.form; if (p) { f.days.value = p.days; f.price.value = p.price; } updateRenewPreview();
  }
  if (t.name === 'planId' && t.form?.dataset.form === 'customer' && !t.form.dataset.id) {
    const p = state.admin.settings.plans.find((x) => x.id === t.value);
    if (p) { t.form.price.value = p.price; t.form.connections.value = p.connections; }
  }
  if (t.dataset.input === 'restore' && t.files[0]) {
    try {
      const data = JSON.parse(await t.files[0].text());
      if (!confirm(`Restore ${data.customers?.length ?? 0} customers and all settings? Current data will be replaced.`)) return;
      await api('POST', '/api/admin/restore', data); await refreshConfig(); toast('Backup restored ✓'); renderAdmin();
    } catch (err) { toast(err.message || 'Invalid file', true); }
  }
});

boot();
