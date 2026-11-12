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
    },
  },
  plans: [
    { id: 'p1', name: '1 Month', days: 30, price: 300, connections: 1, package: '1' },
    { id: 'p3', name: '3 Months', days: 90, price: 800, connections: 1, package: '2' },
    { id: 'p6', name: '6 Months', days: 180, price: 1500, connections: 1, package: '3' },
    { id: 'p12', name: '12 Months', days: 365, price: 2800, connections: 1, package: '4' },
  ],
  currency: 'THB',
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

export function createBackend({ store, fetchFn, cacheMs = 0, mode = 'server' }) {
  let sCache = null, sAt = 0;

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
    return { ...rest, daysLeft, state, planName: plan ? plan.name : 'Custom', planDays: plan ? plan.days : Math.max(1, Math.round((c.expiresAt - c.startAt) / DAY)) };
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
        const admin = await store.get('admin');
        return ok({ branding: s.branding, currency: s.currency, setupRequired: !admin, mode });
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
        const admin = await store.get('admin');
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
        }));
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
          username, salt, passwordHash: await hashPassword(body.password, salt),
          lineUsername: body.lineSame !== false ? username : String(body.lineUsername || ''),
          linePassword: body.lineSame !== false ? String(body.password) : String(body.linePassword || ''),
          lineId: String(body.lineId || ''), planId: plan ? plan.id : 'custom',
          connections: Number(body.connections) || (plan ? plan.connections : 1),
          startAt, expiresAt, status: 'active', createdAt: Date.now(), lastLogin: null,
          renewals: [{ at: Date.now(), type: 'new', planId: plan ? plan.id : 'custom', days: Math.round((expiresAt - startAt) / DAY), price: Number(body.price) || 0 }],
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
        await log('customer', `Created ${username} (${plan ? plan.name : 'custom'})${panel && !panel.skipped ? ' + panel line' : ''}`);
        return ok({ customer: view(c, s), panel });
      }

      const m = path.match(/^\/api\/admin\/customers\/([\w-]+)(?:\/(\w+))?$/);
      if (m) {
        const list = await getCustomers();
        const c = list.find((x) => x.id === m[1]);
        if (!c) return err(404, 'Customer not found.');
        const sub = m[2];

        if (method === 'PUT' && !sub) {
          for (const k of ['name', 'phone', 'note', 'lineUsername', 'linePassword', 'lineId', 'planId']) if (body[k] !== undefined) c[k] = String(body[k]);
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
          if (c.status === 'disabled' && body.enable) c.status = 'active';
          c.renewals = c.renewals || [];
          c.renewals.push({ at: Date.now(), type: 'renew', planId: plan ? plan.id : 'custom', days, price: Number(body.price) || 0 });
          await saveCustomers(list);
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

      if (R('GET', '/api/admin/stats')) {
        const cs = (await getCustomers()).map((c) => view(c, s));
        const now = new Date();
        const monthKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
        const months = [];
        for (let i = 5; i >= 0; i--) months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
        const byMonth = Object.fromEntries(months.map((k) => [k, 0]));
        let total = 0, renewalsCount = 0;
        cs.forEach((c) => (c.renewals || []).forEach((r) => {
          total += r.price || 0; renewalsCount++;
          const k = monthKey(r.at); if (k in byMonth) byMonth[k] += r.price || 0;
        }));
        const count = (st) => cs.filter((c) => c.state === st).length;
        return ok({
          total: cs.length, active: count('active'), expiring: count('expiring'), expired: count('expired'), disabled: count('disabled'),
          revenueTotal: total, revenueMonth: byMonth[months[5]], byMonth, renewalsCount,
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
        }
        await store.put('admin', admin);
        await log('admin', 'Admin login details changed');
        return ok({ ok: true, username: admin.username });
      }
      if (R('GET', '/api/admin/me')) return ok({ username: (await store.get('admin')).username, mode });
      if (R('GET', '/api/admin/log')) return ok((await store.get('log')) || []);
      if (R('GET', '/api/admin/backup')) return ok({ version: 1, exportedAt: Date.now(), settings: s, customers: await getCustomers() });
      if (R('POST', '/api/admin/restore')) {
        if (!isObj(body.settings) || !Array.isArray(body.customers)) return err(400, 'This is not a valid backup file.');
        const next = deepMerge(DEFAULT_SETTINGS(), body.settings);
        next.security.proxySecret = s.security.proxySecret;
        await saveSettings(next);
        await saveCustomers(body.customers);
        await log('admin', `Backup restored (${body.customers.length} customers)`);
        return ok({ ok: true });
      }
      return err(404, 'Not found');
    } catch (e) {
      return err(e.status || 500, e.message || 'Server error');
    }
  }

  return { handle, getSettings };
}
