// Translation engine + hub for the admin panel.
//
// Engine: Google's public "dict-chrome-ex" endpoint (no key, CORS enabled).
// Nothing sensitive is sent: tables, codes, inputs, chat bubbles and
// e-mail/URL/template-variable patterns are filtered out before a request.
//
// This module has no imports from app.js; app.js injects the helpers it needs.

import {
  TR_LANGS, trLang, flagOf, nameOf, dirOf, isRtl, buildReadUrl,
  shield, unshield, shouldSkipText, splitLong, translateEndpoint, parseTranslateResponse,
  glossaryOf, DEFAULT_GLOSSARY, panelTarget,
} from './lang-data.js?v=122';

const LS = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  json(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CACHE_KEY = 'tvp_tr_cache';
const GLOSSARY_KEY = 'tvp_tr_glossary';
const HISTORY_KEY = 'tvp_tr_history';
const REPLY_LANG_KEY = 'tvp_tr_reply';

export function createTranslator(ctx) {
  const { toast, modal, closeModal, actions, getState, renderAdmin, isAdmin = () => true } = ctx;

  const S = {
    target: panelTarget(LS.get('tvp_tr', 'en')),
    on: LS.get('tvp_tr_on', '1') !== '0',
    active: false,
    running: false,
    pending: false,
    timer: 0,
    obs: null,
    originals: new WeakMap(),
    attrs: [],
    fails: 0,
    coolUntil: 0,
    progress: { done: 0, total: 0 },
    hubTab: 'panel',
    text: { src: '', out: '', detected: '', at: 0, busy: false },
    history: LS.json(HISTORY_KEY, []),
    glossary: null,
    replyLang: LS.get(REPLY_LANG_KEY, ''),
    reader: null,
    chatOn: LS.get('tvp_tr_chat', '0') === '1',
    cache: null,
    saveT: 0,
  };

  // ---------- persistence ----------
  const glossary = () => {
    if (S.glossary) return S.glossary;
    const raw = LS.get(GLOSSARY_KEY, '');
    S.glossary = raw ? glossaryOf(raw) : DEFAULT_GLOSSARY.slice();
    return S.glossary;
  };
  const saveGlossary = () => { LS.set(GLOSSARY_KEY, JSON.stringify(glossary())); };

  const cache = () => {
    if (S.cache) return S.cache;
    const raw = LS.json(CACHE_KEY, {});
    S.cache = raw && typeof raw === 'object' ? raw : {};
    return S.cache;
  };
  const cacheGet = (lang, src) => { const m = cache()[lang]; return m && typeof m[src] === 'string' ? m[src] : null; };
  const cacheSet = (lang, src, out) => {
    if (!src || src.length > 400 || out == null) return;
    const all = cache();
    const m = (all[lang] ||= {});
    m[src] = out;
    const keys = Object.keys(m);
    if (keys.length > 1800) for (const k of keys.slice(0, keys.length - 1800)) delete m[k];
    clearTimeout(S.saveT);
    S.saveT = setTimeout(() => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); } catch { S.cache = {}; } }, 800);
  };

  const trCur = () => S.target;
  const trDir = () => (S.active ? dirOf(S.target) : '');
  const trAuto = (me) => {
    if (!isAdmin()) return;
    if (!S.on) return;
    let saved = null; try { saved = localStorage.getItem('tvp_tr'); } catch {}
    const lang = saved || (me && me.lang && me.lang !== 'en' ? me.lang : '');
    if (!lang || lang === 'en') return;
    S.target = panelTarget(lang);
    applyPanel({ silent: true });
  };

  // ---------- network ----------
  function checkCircuit() {
    if (Date.now() < S.coolUntil) {
      const s = Math.ceil((S.coolUntil - Date.now()) / 1000);
      throw new Error(`The translator is resting — try again in ${s}s.`);
    }
  }
  function noteFail() { S.fails++; if (S.fails >= 3) { S.coolUntil = Date.now() + 60000; S.fails = 0; } }
  function noteOk() { S.fails = 0; }

  async function requestBatch(texts, target) {
    checkCircuit();
    const r = await fetch(translateEndpoint(target, texts), { credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 429 ? 'The free translator is busy — try again in a minute.' : 'The translator did not answer.');
    const ct = r.headers.get('content-type') || '';
    if (!/json/i.test(ct)) throw new Error('The translator is busy — try again in a minute.');
    const arr = parseTranslateResponse(await r.json());
    if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error('The translator returned an unexpected answer.');
    return arr;
  }

  async function requestOne(text, target) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text.slice(0, 4500))}`;
    const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error('The translator did not answer.');
    const j = await r.json();
    return (j[0] || []).map((x) => (Array.isArray(x) ? x[0] : '')).join('');
  }

  // Translate a list of plain strings, returning Map<source, translation>.
  async function translateMany(list, target, { onProgress } = {}) {
    const unique = [...new Set(list.map((s) => String(s ?? '')).filter(Boolean))];
    const out = new Map();
    const recs = [];
    for (const src of unique) {
      const hit = cacheGet(target, src);
      if (hit != null) { out.set(src, hit); continue; }
      if (shouldSkipText(src)) continue;
      const g = shield(src, glossary());
      recs.push({ src, p: g.text, tokens: g.tokens });
    }
    const total = recs.length;
    let done = 0;
    const report = () => { try { onProgress && onProgress(done, total); } catch {} };

    for (let i = 0; i < recs.length;) {
      const group = [];
      let size = 0;
      while (i < recs.length && group.length < 24 && (size === 0 || size + recs[i].p.length <= 3200)) {
        group.push(recs[i]); size += recs[i].p.length + 8; i++;
      }
      const texts = group.map((r) => r.p);
      let translated = null;
      try {
        translated = await requestBatch(texts, target);
        noteOk();
      } catch (e) {
        // One retry, then the single-string endpoint, then give up on this batch.
        try { await sleep(400); translated = await requestBatch(texts, target); noteOk(); }
        catch (e2) {
          if (group.length === 1) {
            try { translated = [await requestOne(texts[0], target)]; noteOk(); }
            catch { noteFail(); throw e2; }
          } else {
            const one = [];
            for (const t of texts) one.push(await requestOne(t, target).catch(() => null));
            translated = one;
            if (one.every((x) => x == null)) { noteFail(); throw e2; }
          }
        }
      }
      group.forEach((rec, k) => {
        const value = translated[k];
        if (value == null) return;
        const final = unshield(value, rec.tokens);
        out.set(rec.src, final);
        cacheSet(target, rec.src, final);
      });
      done += group.length;
      report();
    }
    if (total === 0) report();
    return out;
  }

  async function translateLong(text, target, onProgress) {
    const parts = splitLong(String(text ?? ''), 3400);
    const out = [];
    let acc = 0;
    for (const part of parts) {
      const map = await translateMany([part], target, {
        onProgress: (d) => onProgress && onProgress(acc + (d ? 1 : 0), parts.length),
      });
      out.push(map.get(part) ?? part);
      acc++;
      onProgress && onProgress(acc, parts.length);
    }
    return out.join('');
  }

  // ---------- panel translation ----------
  const localSkip = () =>
    'script,style,noscript,svg,canvas,code,pre,kbd,samp,time,input,textarea,select,option,template,' +
    '[contenteditable="true"],[data-no-tr],[translate="no"],[dir="ltr"],' +
    '.cred-v,.code,.mono,.tbl td,.msg-t,.thread,.chat,.receipt,.tr-hub,#tr-hub,#tr-status,.tr-status,#lang-sheet,.ls-root,.no-tr';

  function panelRoots() {
    return [$('#app'), $('#modal-root'), $('#admin-body')].filter(Boolean);
  }

  function collect() {
    const skip = localSkip();
    const nodes = [];
    const attrs = [];
    for (const root of panelRoots()) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const v = node.nodeValue;
          if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p || p.closest(skip)) return NodeFilter.FILTER_REJECT;
          if (S.originals.has(node)) return NodeFilter.FILTER_REJECT;
          if (shouldSkipText(v)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      while (w.nextNode()) nodes.push(w.currentNode);
      for (const el of root.querySelectorAll('[placeholder],[title],[aria-label]')) {
        if (el.closest(skip)) continue;
        for (const name of ['placeholder', 'title', 'aria-label']) {
          const v = el.getAttribute(name);
          if (!v || !v.trim() || shouldSkipText(v)) continue;
          if (S.attrs.some((a) => a.el === el && a.name === name)) continue;
          attrs.push({ el, name, value: v });
        }
      }
    }
    return { nodes, attrs };
  }

  function splitSpace(value) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    return { lead: m ? m[1] : '', text: m ? m[2] : value, trail: m ? m[3] : '' };
  }

  async function runPanel() {
    if (!S.active || S.target === 'en') return;
    if (S.running) { S.pending = true; return; }
    S.running = true;
    try {
      const { nodes, attrs } = collect();
      const items = nodes.map((n) => ({ n, ...splitSpace(n.nodeValue) })).filter((x) => x.text && !shouldSkipText(x.text));
      const sources = [...new Set([...items.map((x) => x.text), ...attrs.map((a) => a.value)])];
      if (!sources.length) { S.progress = { done: 0, total: 0 }; paintStatus(); return; }
      S.progress = { done: 0, total: sources.length };
      paintStatus();
      const map = await translateMany(sources, S.target, {
        onProgress: (d, t) => { S.progress = { done: d, total: t }; paintStatus(); paintHubProgress(); },
      });
      for (const it of items) {
        const out = map.get(it.text);
        if (!out || out === it.text || !it.n.isConnected) continue;
        S.originals.set(it.n, it.n.nodeValue);
        it.n.nodeValue = it.lead + out + it.trail;
      }
      for (const a of attrs) {
        const out = map.get(a.value);
        if (!out || out === a.value || !a.el.isConnected) continue;
        S.attrs.push(a);
        a.el.setAttribute(a.name, out);
      }
    } catch (e) {
      if (!/resting/.test(e.message)) console.warn('[translator]', e.message);
      paintStatus(e.message);
    } finally {
      S.running = false;
      paintStatus();
      if (S.pending) { S.pending = false; setTimeout(runPanel, 120); }
    }
  }

  function observe() {
    if (S.obs) return;
    S.obs = new MutationObserver((recs) => {
      if (!S.active) return;
      if (recs.every((r) => {
        const n = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        return n && n.closest('#tr-status, .tr-hub, #toast, #lang-sheet, .tr-msg-alt');
      })) return;
      clearTimeout(S.timer);
      S.timer = setTimeout(() => { runPanel(); chatAuto(); }, 180);
    });
    S.obs.observe(document.body, { childList: true, subtree: true });
  }
  function unobserve() { if (S.obs) { S.obs.disconnect(); S.obs = null; } clearTimeout(S.timer); }

  function applyPanel({ silent = false } = {}) {
    if (!isAdmin()) return;
    if (S.target === 'en') { restorePanel(); return; }
    S.active = true;
    LS.set('tvp_tr', S.target);
    document.documentElement.classList.add('tr-live');
    document.documentElement.dir = dirOf(S.target);
    document.documentElement.lang = S.target;
    document.body.classList.add('tr-live-body');
    if (S.on) observe(); else unobserve();
    paintStatus();
    runPanel();
    if (!silent) toast(`${flagOf(S.target)} ${nameOf(S.target)} — translating…`, false);
  }

  function restorePanel() {
    if (!S.active) { paintStatus(); return; }
    unobserve();
    for (const [node, orig] of S.originals || []) { if (node.isConnected) node.nodeValue = orig; }
    S.originals = new WeakMap();
    for (const a of S.attrs) { if (a.el && a.el.isConnected) a.el.setAttribute(a.name, a.value); }
    S.attrs = [];
    S.active = false;
    S.progress = { done: 0, total: 0 };
    document.documentElement.classList.remove('tr-live');
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'en';
    document.body.classList.remove('tr-live-body');
    paintStatus();
    toast('Original English restored ✓');
  }

  function afterRoute() {
    if (!isAdmin()) { document.getElementById('tr-status')?.remove(); return; }
    if (S.active) {
      document.documentElement.dir = dirOf(S.target);
      document.documentElement.lang = S.target;
      observe();
      clearTimeout(afterRoute.t);
      afterRoute.t = setTimeout(runPanel, 60);
      paintStatus();
    } else paintStatus();
  }

  // ---------- status pill ----------
  function paintStatus(err) {
    if (!isAdmin()) return;
    let el = document.getElementById('tr-status');
    if (!S.active) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'tr-status';
      el.className = 'tr-status';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    const busy = S.running && S.progress.total > 0;
    const text = busy ? `Translating ${Math.min(S.progress.done, S.progress.total)}/${S.progress.total}` : (err ? 'Translator busy' : `${nameOf(S.target)} ✓`);
    const key = `${busy}|${text}`;
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    el.classList.toggle('busy', !!busy);
    el.innerHTML = `<button type="button" class="tr-status-main" data-act="tr-open" title="Translator">${flagOf(S.target)}<b>${esc(text)}</b>${busy ? '<i class="tr-dot"></i>' : ''}</button><button type="button" class="tr-status-x" data-act="tr-off" aria-label="Show the original English" title="Show original">×</button>`;
  }

  // ---------- chat ----------
  const chatTextOf = (msg) => msg.querySelector('.msg-t')?.textContent || '';

  async function translateMsg(msg) {
    const body = msg.querySelector('.msg-t');
    if (!body) return;
    if (msg.dataset.trAlt === '1') {
      body.textContent = msg.dataset.trOrig || body.textContent;
      msg.dataset.trAlt = '0';
      msg.classList.remove('tr-msg-alt');
      msg.querySelector('[data-act="tr-msg"]')?.setAttribute('title', 'Translate this message');
      return;
    }
    const src = body.textContent || '';
    if (!src.trim() || shouldSkipText(src)) return;
    msg.dataset.trOrig = src;
    body.textContent = '…';
    try {
      const map = await translateMany([src], S.target);
      const out = map.get(src);
      body.textContent = out || src;
      if (out && out !== src) {
        msg.dataset.trAlt = '1';
        msg.classList.add('tr-msg-alt');
        msg.querySelector('[data-act="tr-msg"]')?.setAttribute('title', 'Show the original text');
      }
    } catch (e) { body.textContent = src; toast(e.message, true); }
  }

  function chatAuto() {
    if (!S.chatOn || !isAdmin()) return;
    for (const msg of $$('.thread .msg')) {
      if (msg.dataset.trDone || msg.dataset.trAlt) continue;
      const body = msg.querySelector('.msg-t');
      if (!body) continue;
      const src = body.textContent || '';
      if (!src.trim() || shouldSkipText(src)) continue;
      const key = S.target + '|' + src.slice(0, 120);
      if (msg.dataset.trKey === key) continue;
      msg.dataset.trKey = key;
      msg.dataset.trDone = '1';
      translateMsg(msg).catch(() => {});
    }
  }

  function replyTarget() {
    return panelTarget(S.replyLang || S.target || 'en');
  }

  async function translateReply(input) {
    if (!input) return;
    if (input.dataset.trOrig != null) { input.value = input.dataset.trOrig; delete input.dataset.trOrig; input.dispatchEvent(new Event('input', { bubbles: true })); return; }
    const src = input.value.trim();
    if (!src) { toast('Write your reply first', true); return; }
    const target = replyTarget();
    const btn = input.closest('form')?.querySelector('[data-act="tr-reply"]');
    if (btn) btn.disabled = true;
    try {
      const map = await translateMany([src], target);
      const out = map.get(src);
      if (!out) throw new Error('Nothing to translate');
      input.dataset.trOrig = src;
      input.value = out;
      input.dir = dirOf(target);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      toast(`${flagOf(target)} Ready to send in ${nameOf(target)} — tap 🌐 again to undo`);
    } catch (e) { toast(e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }

  // ---------- hub ----------
  function langOptions(selected) {
    return `<optgroup label="Popular">${['en', 'ar', 'fr', 'es', 'de', 'it', 'pt', 'tr'].map((c) => {
      const l = trLang(c); return `<option value="${c}" ${c === selected ? 'selected' : ''}>${l.flag} ${esc(l.native)} — ${esc(l.english)}</option>`;
    }).join('')}</optgroup><optgroup label="All languages">${TR_LANGS.filter((l) => !['en', 'ar', 'fr', 'es', 'de', 'it', 'pt', 'tr'].includes(l.code)).map((l) => `<option value="${l.code}" ${l.code === selected ? 'selected' : ''}>${l.flag} ${esc(l.native)} — ${esc(l.english)}</option>`).join('')}</optgroup>`;
  }

  function hubInner() {
    const t = S.target;
    return `<div class="tr-top">
      <div class="tr-brand"><span class="tr-logo" aria-hidden="true">🌐</span><div><h3>Translator</h3><p>Read, write and reply in any language — without changing the app.</p></div></div>
      <label class="tr-target"><span>Translate into</span><select data-tr-target aria-label="Translate into">${langOptions(t)}</select></label>
    </div>
    <div class="tr-tabs" role="tablist">${[['panel', '🖥️ Panel'], ['text', '✍️ Text'], ['chat', '💬 Chat'], ['web', '🌍 Web'], ['glossary', '📚 Glossary']].map(([k, n]) => `<button type="button" role="tab" aria-selected="${S.hubTab === k}" class="tr-tab ${S.hubTab === k ? 'on' : ''}" data-act="tr-tab" data-tab="${k}">${n}</button>`).join('')}</div>
    <div class="tr-body" role="tabpanel">${S.hubTab === 'panel' ? panelTab() : S.hubTab === 'text' ? textTab() : S.hubTab === 'chat' ? chatTab() : S.hubTab === 'web' ? webTab() : glossaryTab()}</div>
    <div class="tr-foot"><span class="tr-engine"><i></i> Free engine · no key</span><span>Brands, customer data, links and codes are protected</span></div>`;
  }

  function panelTab() {
    const busy = S.running;
    const pct = S.progress.total ? Math.round((S.progress.done / S.progress.total) * 100) : 0;
    return `<div class="tr-hero"><span class="tr-hero-ico" aria-hidden="true">🖥️</span><div><h4>Translate the whole admin panel</h4><p>Menus, buttons, forms and notices in your language. Names, usernames, tables, codes, links and chat messages are never sent.</p></div></div>
      <div class="tr-cards">
        <div class="tr-mini"><span class="tr-label">Current</span><div class="tr-now"><span class="tr-now-flag">${flagOf(S.target)}</span><div><b>${esc(nameOf(S.target))}</b><small>${esc(trLang(S.target).english)}</small></div><span class="tr-badge ${S.active ? 'on' : ''}">${S.active ? 'Live' : 'Off'}</span></div>
          <div class="tr-mini-actions"><button type="button" class="btn primary" data-act="tr-apply">${S.active ? 'Apply again' : 'Apply to the panel'}</button>${S.active ? '<button type="button" class="btn ghost" data-act="tr-off">Show original</button>' : ''}</div></div>
        <div class="tr-mini"><span class="tr-label">While you work</span><label class="tr-toggle"><input type="checkbox" data-tr-auto ${S.on ? 'checked' : ''}><i></i><span>Translate new pages automatically</span></label><p class="tr-help">Pop-ups, new tabs and refreshed lists are translated as they appear. Turn this off to translate only once.</p></div>
      </div>
      <div class="tr-progress" data-tr-progress ${busy ? '' : 'hidden'}><div class="tr-progress-top"><span>Translating…</span><b data-tr-prog-txt>${S.progress.done}/${S.progress.total}</b></div><div class="tr-bar"><i style="width:${pct}%"></i></div></div>
      <ul class="tr-never"><li>🙈 <b>Never sent</b> — customer names, usernames, e-mails, links, codes, IPs, tables and chat</li><li>🔒 <b>Stays private</b> — the free Google endpoint receives only visible UI labels</li><li>↩️ <b>Reversible</b> — “Show original” puts every word back instantly</li></ul>`;
  }

  function textTab() {
    const t = S.text;
    const dir = t.out ? dirOf(S.target) : 'auto';
    return `<div class="tr-text">
      <div class="tr-pane"><div class="tr-pane-head"><span class="tr-label">Your text</span><span class="tr-count" data-tr-count>${t.src.length} / 5000</span></div>
        <textarea data-tr-src maxlength="5000" placeholder="Paste a customer message, an e-mail, a reply…" aria-label="Text to translate">${esc(t.src)}</textarea>
        <div class="tr-pane-foot"><button type="button" class="btn sm ghost" data-act="tr-paste">📋 Paste</button><button type="button" class="btn sm ghost" data-act="tr-clear">Clear</button><span class="spacer"></span><button type="button" class="btn sm ghost" data-act="tr-mic">🎙 Dictate</button></div></div>
      <div class="tr-pane tr-out-pane"><div class="tr-pane-head"><span class="tr-label">Translation</span><span class="tr-detected">${t.detected ? 'From ' + esc(t.detected) : 'Auto-detect'}</span></div>
        <div class="tr-out" data-tr-out dir="${dir}">${t.out ? esc(t.out) : '<span class="tr-placeholder">The translation appears here.</span>'}</div>
        <div class="tr-pane-foot"><button type="button" class="btn sm" data-act="tr-copy-out" ${t.out ? '' : 'disabled'}>📋 Copy</button><button type="button" class="btn sm" data-act="tr-share-out" ${t.out ? '' : 'disabled'}>💬 WhatsApp</button><button type="button" class="btn sm" data-act="tr-listen-out" ${t.out ? '' : 'disabled'}>🔊 Listen</button><span class="spacer"></span><button type="button" class="btn primary" data-act="tr-text-go" ${t.busy ? 'disabled' : ''}>${t.busy ? 'Translating…' : 'Translate'}</button></div></div>
    </div>
    <div class="tr-progress" data-tr-progress ${t.busy ? '' : 'hidden'}><div class="tr-progress-top"><span>Translating…</span><b data-tr-prog-txt>${S.progress.done}/${S.progress.total || 1}</b></div><div class="tr-bar"><i style="width:${S.progress.total ? Math.round((S.progress.done / S.progress.total) * 100) : 0}%"></i></div></div>
    <div class="tr-tip">Tip: <kbd>Ctrl</kbd> + <kbd>Enter</kbd> translates. The text never touches your customer database.</div>
    ${S.history.length ? `<div class="tr-hist"><span class="tr-label">Recent</span>${S.history.slice(0, 6).map((h, i) => `<button type="button" class="tr-hist-item" data-act="tr-history" data-i="${i}"><span>${flagOf(h.to)}</span><span class="tr-hist-txt">${esc((h.src || '').slice(0, 70))}</span><span class="tr-hist-out">${esc((h.out || '').slice(0, 40))}</span></button>`).join('')}</div>` : ''}`;
  }

  function chatTab() {
    return `<div class="tr-cards">
      <div class="tr-mini"><span class="tr-label">Incoming messages</span><label class="tr-toggle"><input type="checkbox" data-tr-chat ${S.chatOn ? 'checked' : ''}><i></i><span>Translate chat bubbles automatically</span></label><p class="tr-help">Each message shows in your language, with the original one tap away. Team chat too.</p></div>
      <div class="tr-mini"><span class="tr-label">Your reply</span><label class="tr-field"><span>Translate my reply into</span><select data-tr-reply>${langOptions(replyTarget())}</select></label><div class="tr-mini-actions"><button type="button" class="btn primary" data-act="tr-open-chat">Open live chat →</button></div><p class="tr-help">In a chat, write in English and tap 🌐 next to Send. Tap it again to undo.</p></div>
    </div>
    <div class="tr-hero soft"><span class="tr-hero-ico" aria-hidden="true">💬</span><div><h4>Never send the wrong language</h4><p>Read an Arabic message in English, answer in Arabic, and keep the original text beside it. The customer only sees the message you send.</p></div></div>`;
  }

  function webTab() {
    if (S.reader) return readerTab();
    return `<div class="tr-hero soft"><span class="tr-hero-ico" aria-hidden="true">🌍</span><div><h4>Read any web page in your language</h4><p>Open a customer's site, a supplier page or a guide. Links keep working in the translated view.</p></div></div>
      <div class="tr-webrow"><input type="url" data-tr-url placeholder="https://…" dir="ltr" aria-label="Web page address"><button type="button" class="btn primary" data-act="tr-read">Read in ${esc(nameOf(S.target))} ↗</button></div>
      <div class="tr-cards tr-cards-3"><div class="tr-mini"><span class="tr-label">Best for</span><p class="tr-help">Public pages: news, suppliers, documentation, customer websites.</p></div><div class="tr-mini"><span class="tr-label">Private pages</span><p class="tr-help">Pages behind a login will ask you to sign in again inside the reader.</p></div><div class="tr-mini"><span class="tr-label">Reader mode</span><p class="tr-help">No layout? Use Reader mode for a clean, translated text view. <button type="button" class="tr-link" data-act="tr-reader-beta">Try it</button></p></div></div>
      <p class="tr-help" style="margin-top:14px">The address is opened through Google's public translate proxy. Never paste a link that contains a password.</p>`;
  }

  function readerTab() {
    const r = S.reader;
    if (r.loading) return `<div class="tr-reader"><div class="tr-reader-head"><button type="button" class="btn sm ghost" data-act="tr-reader-close">← Back</button><span class="tr-label">Reader mode</span></div><div class="tr-reader-load"><div class="spinner"></div><p>Reading and translating…<br><span class="tr-help">${esc(r.url)}</span></p></div></div>`;
    if (r.err) return `<div class="tr-reader"><div class="tr-reader-head"><button type="button" class="btn sm ghost" data-act="tr-reader-close">← Back</button></div><div class="tr-empty">⚠️ ${esc(r.err)}<div class="tr-mini-actions"><a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Open the original ↗</a></div></div></div>`;
    return `<div class="tr-reader"><div class="tr-reader-head"><button type="button" class="btn sm ghost" data-act="tr-reader-close">← Back</button><span class="tr-label">${esc(r.title || 'Reader')}</span><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">Original ↗</a></div><article class="tr-reader-body" dir="${dirOf(S.target)}">${r.paras.map((p) => `<p>${esc(p)}</p>`).join('')}</article></div>`;
  }

  function glossaryTab() {
    const g = glossary();
    return `<div class="tr-hero soft"><span class="tr-hero-ico" aria-hidden="true">📚</span><div><h4>Words that must stay yours</h4><p>Brands, package names and technical terms. “Keep” leaves the word untouched; write a translation to force it everywhere.</p></div></div>
      <div class="tr-gloss">${g.map((x, i) => `<div class="tr-gloss-row"><input value="${esc(x.from)}" data-gl-i="${i}" data-gl-k="from" placeholder="Word" aria-label="Word ${i + 1}"><span class="tr-gloss-arrow">→</span><input value="${esc(x.to)}" data-gl-i="${i}" data-gl-k="to" placeholder="Keep as is" aria-label="Translation ${i + 1}"><button type="button" class="tr-gloss-x" data-act="tr-gloss-del" data-i="${i}" aria-label="Remove">×</button></div>`).join('')}</div>
      <div class="tr-mini-actions"><button type="button" class="btn" data-act="tr-gloss-add">＋ Add a word</button><button type="button" class="btn primary" data-act="tr-gloss-save">Save glossary</button><button type="button" class="btn ghost" data-act="tr-gloss-reset">Reset brands</button><button type="button" class="btn ghost" data-act="tr-gloss-export">Export</button><label class="btn ghost">Import<input type="file" accept="application/json,.json" data-tr-import hidden></label></div>
      <p class="tr-help">Saved on this device. Export the JSON to use the same glossary on another device.</p>`;
  }

  function renderHub() {
    const hub = $('.tr-hub');
    if (!hub) return;
    const scroll = hub.querySelector('.tr-body')?.scrollTop || 0;
    hub.innerHTML = hubInner();
    const body = hub.querySelector('.tr-body'); if (body) body.scrollTop = scroll;
    bindHub();
  }

  function openHub(tab = 'panel') {
    S.hubTab = tab;
    S.reader = null;
    modal('🌐 Translator', `<div class="tr-hub" id="tr-hub" data-no-tr>${hubInner()}</div>`, { wide: true, onClose: () => { S.reader = null; } });
    bindHub();
  }

  function bindHub() {
    const hub = $('.tr-hub');
    if (!hub) return;
    const src = hub.querySelector('[data-tr-src]');
    if (src) {
      src.addEventListener('input', () => {
        S.text.src = src.value;
        const c = hub.querySelector('[data-tr-count]');
        if (c) c.textContent = `${src.value.length} / 5000`;
      });
      src.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); actions['tr-text-go']?.(); }
      });
    }
    hub.querySelector('[data-tr-target]')?.addEventListener('change', (e) => { setTarget(e.target.value); });
    hub.querySelector('[data-tr-reply]')?.addEventListener('change', (e) => { S.replyLang = e.target.value; LS.set(REPLY_LANG_KEY, e.target.value); });
    hub.querySelector('[data-tr-auto]')?.addEventListener('change', (e) => {
      S.on = e.target.checked; LS.set('tvp_tr_on', S.on ? '1' : '0');
      if (!S.active) return;
      if (S.on) { observe(); runPanel(); } else unobserve();
    });
    hub.querySelector('[data-tr-chat]')?.addEventListener('change', (e) => { S.chatOn = e.target.checked; LS.set('tvp_tr_chat', S.chatOn ? '1' : '0'); if (S.chatOn) chatAuto(); });
    hub.querySelectorAll('[data-gl-i]').forEach((inp) => inp.addEventListener('change', () => {
      const g = glossary(); const i = +inp.dataset.glI; if (!g[i]) return;
      g[i][inp.dataset.glK] = inp.value.trim();
    }));
    hub.querySelector('[data-tr-import]')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try {
        const arr = glossaryOf(await f.text());
        if (!arr.length) throw new Error('No words found in this file');
        S.glossary = arr; saveGlossary(); renderHub(); toast(`${arr.length} words imported ✓`);
      } catch (err) { toast(err.message, true); }
    });
  }

  function setTarget(code) {
    const next = panelTarget(code);
    if (next === S.target) return;
    S.target = next;
    LS.set('tvp_tr', next);
    S.text.detected = '';
    if (S.active) {
      if (next === 'en') restorePanel();
      else { applyPanel({ silent: true }); }
    }
    renderHub();
  }

  function paintHubProgress() {
    for (const box of $$('[data-tr-progress]')) {
      box.hidden = !S.running;
      const txt = $('[data-tr-prog-txt]', box);
      if (txt) txt.textContent = `${S.progress.done}/${S.progress.total || 1}`;
      const bar = $('.tr-bar i', box);
      if (bar) bar.style.width = (S.progress.total ? Math.round((S.progress.done / S.progress.total) * 100) : 0) + '%';
    }
  }

  async function runTextTranslate() {
    const src = ($('[data-tr-src]')?.value || '').trim();
    if (!src) { toast('Paste or type a text first', true); return; }
    S.text.src = src;
    S.text.busy = true;
    S.running = true;
    S.progress = { done: 0, total: 1 };
    renderHub();
    try {
      const out = await translateLong(src, S.target, (d, t) => {
        S.progress = { done: d, total: t };
        paintHubProgress();
      });
      S.text.out = out;
      S.text.at = Date.now();
      S.history = [{ src, out, to: S.target, at: S.text.at }, ...S.history.filter((h) => h.src !== src)].slice(0, 12);
      LS.set(HISTORY_KEY, JSON.stringify(S.history));
    } catch (e) { toast(e.message, true); }
    finally { S.text.busy = false; S.running = false; renderHub(); }
  }

  async function openReader(url) {
    let clean;
    try { clean = new URL(String(url || '').trim()); if (!/^https?:$/.test(clean.protocol)) throw 0; } catch { toast('Paste a full link starting with https://', true); return; }
    const target = S.target;
    S.hubTab = 'web';
    S.reader = { url: clean.href, loading: true, err: '', title: '', paras: [] };
    renderHub();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25000);
      const r = await fetch('https://r.jina.ai/' + clean.href, { signal: ctl.signal, headers: { Accept: 'text/plain' } });
      clearTimeout(timer);
      if (!r.ok) throw new Error('This page could not be read (it may need a login).');
      const text = (await r.text()).slice(0, 16000);
      const paras = text.split(/\n{2,}/).map((p) => p.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim())
        .filter((p) => p.length > 24).slice(0, 40);
      if (!paras.length) throw new Error('No readable text was found on this page.');
      const map = await translateMany(paras, target);
      S.reader = { url: clean.href, loading: false, err: '', title: clean.hostname, paras: paras.map((p) => map.get(p) || p) };
    } catch (e) {
      S.reader = { url: clean.href, loading: false, err: e.name === 'AbortError' ? 'The reader took too long. Try the normal reader.' : (e.message || 'Could not read this page.'), title: '', paras: [] };
    }
    renderHub();
  }

  // Chat bubbles appear in modals and in the dashboard; watch for them even when
  // the panel itself is not translated.
  const chatObs = new MutationObserver((recs) => {
    if (!S.chatOn) return;
    if (recs.every((r) => {
      const n = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      return n && n.closest('.tr-msg-alt, .tr-hub, #tr-status, #toast, #lang-sheet');
    })) return;
    clearTimeout(S.chatT);
    S.chatT = setTimeout(chatAuto, 160);
  });
  chatObs.observe(document.body, { childList: true, subtree: true });

  // ---------- public API ----------
  const api = {
    trCur, trDir, trAuto, afterRoute,
    flagOf, nameOf,
    translatorCard: () => `<div class="card tr-teaser"><span class="tr-teaser-ico" aria-hidden="true">🌐</span><div style="flex:1;min-width:0"><h3 style="margin:0">Translator</h3><p class="muted small" style="margin:4px 0 0">The whole panel, a text, a chat or a web page — in ${esc(nameOf(S.target))} or any of ${TR_LANGS.length} languages. Your customer data stays private.</p></div><button type="button" class="btn primary" data-act="tr-open">Open</button></div>`,
    openHub, translateMany, translateLong, translateMsg, chatAuto, translateReply, setTarget,
    actions: {
      'tr-open': (el) => { openHub(el?.dataset?.tab || 'panel'); },
      'tr-tab': (el) => { S.hubTab = el.dataset.tab || 'panel'; S.reader = null; renderHub(); },
      'tr-apply': async () => { if (S.target === 'en') { toast('Choose a language other than English first', true); return; } applyPanel(); },
      'tr-off': () => restorePanel(),
      'tr-text-go': () => runTextTranslate(),
      'tr-paste': async () => { try { const v = await navigator.clipboard.readText(); S.text.src = v; const ta = $('[data-tr-src]'); if (ta) { ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); } } catch { toast('Allow clipboard access, or paste with the keyboard', true); } },
      'tr-clear': () => { S.text = { src: '', out: '', detected: '', at: 0, busy: false }; renderHub(); },
      'tr-copy-out': async () => { try { await navigator.clipboard.writeText(S.text.out || ''); toast('Copied ✓'); } catch { toast('Copy failed', true); } },
      'tr-share-out': () => { const v = S.text.out || ''; if (!v) return; window.open('https://wa.me/?text=' + encodeURIComponent(v.slice(0, 3500)), '_blank', 'noopener'); },
      'tr-listen-out': () => { const v = S.text.out || ''; if (!v || !window.speechSynthesis) return toast('Listening is not available in this browser', true); const u = new SpeechSynthesisUtterance(v.slice(0, 3000)); const m = { ar: 'ar-SA', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', ru: 'ru-RU', tr: 'tr-TR', hi: 'hi-IN' }; u.lang = m[S.target] || S.target; speechSynthesis.cancel(); speechSynthesis.speak(u); },
      'tr-mic': () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return toast('Dictation is not available in this browser', true);
        const rec = new SR(); rec.lang = S.target === 'en' ? 'en-US' : S.target; rec.interimResults = false; rec.maxAlternatives = 1;
        rec.onresult = (e) => { const ta = $('[data-tr-src]'); if (!ta) return; ta.value = (ta.value + ' ' + e.results[0][0].transcript).trim(); ta.dispatchEvent(new Event('input', { bubbles: true })); };
        rec.onerror = () => toast('Could not hear you — check the microphone permission', true);
        rec.start();
        toast('Listening…');
      },
      'tr-history': (el) => { const h = S.history[+el.dataset.i]; if (!h) return; S.text = { src: h.src, out: h.out, detected: '', at: h.at, busy: false }; S.target = panelTarget(h.to); LS.set('tvp_tr', S.target); renderHub(); },
      'tr-msg': (el) => { const msg = el.closest('.msg'); if (msg) translateMsg(msg, true); },
      'tr-reply': (el) => { const form = el.closest('form'); translateReply(form?.querySelector('input[name=text]')); },
      'tr-open-chat': () => { closeModal(); actions['atab']?.({ dataset: { tab: 'chat' } }); },
      'tr-read': () => { const u = $('[data-tr-url]')?.value || ''; try { window.open(buildReadUrl(u, S.target), '_blank', 'noopener'); } catch (e) { toast(e.message, true); } },
      'tr-reader-beta': () => { const u = $('[data-tr-url]')?.value || ''; if (!u.trim()) return toast('Paste a link first', true); openReader(u); },
      'tr-reader-close': () => { S.reader = null; renderHub(); },
      'tr-gloss-add': () => { const g = glossary(); if (g.length >= 200) return toast('The glossary is full', true); g.push({ from: '', to: '' }); S.glossary = g; renderHub(); },
      'tr-gloss-del': (el) => { const g = glossary(); g.splice(+el.dataset.i, 1); S.glossary = g; saveGlossary(); renderHub(); },
      'tr-gloss-save': () => { S.glossary = glossary().filter((x) => x.from); saveGlossary(); toast('Glossary saved ✓'); renderHub(); },
      'tr-gloss-reset': () => { S.glossary = DEFAULT_GLOSSARY.slice(); saveGlossary(); renderHub(); toast('Brands restored ✓'); },
      'tr-gloss-export': () => { const blob = new Blob([JSON.stringify(glossary(), null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'translator-glossary.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); },
    },
  };

  return api;
}
