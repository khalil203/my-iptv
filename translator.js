// Translation engine + hub for the admin panel (rebuilt UI, same API).
//
// Engine: Google's public "dict-chrome-ex" endpoint (no key, CORS enabled).
// Nothing sensitive is sent: tables, codes, inputs, chat bubbles and
// e-mail/URL/template-variable patterns are filtered out before a request.
//
// This module has no imports from app.js; app.js injects the helpers it needs.

import {
  TR_LANGS, trLang, flagOf, nameOf, dirOf, isRtl, buildReadUrl,
  shield, unshield, shouldSkipText, splitLong, translateEndpoint, parseTranslateResponse,
  glossaryOf, DEFAULT_GLOSSARY, panelTarget, PANEL_SKIP_SELECTOR,
} from './lang-data.js?v=123';

const LS = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  json(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CACHE_KEY = 'tvp_tr_cache';
const GLOSSARY_KEY = 'tvp_tr_glossary';
const HISTORY_KEY = 'tvp_tr_history';
const REPLY_LANG_KEY = 'tvp_tr_reply';

const TABS = [
  { id: 'panel', ico: '🖥️', label: 'Panel' },
  { id: 'text', ico: '✍️', label: 'Text' },
  { id: 'reader', ico: '📖', label: 'Web reader' },
  { id: 'glossary', ico: '📚', label: 'Glossary' },
  { id: 'chat', ico: '💬', label: 'Chat' },
];

export function createTranslator(ctx) {
  const { toast, modal, closeModal, actions, getState, renderAdmin, isAdmin = () => true } = ctx;

  const S = {
    target: panelTarget(LS.get('tvp_tr', 'en')),
    on: LS.get('tvp_tr_on', '1') !== '0',
    active: false,
    running: false,
    timer: 0,
    obs: null,
    originals: new WeakMap(),
    fails: 0,
    coolUntil: 0,
    progress: { done: 0, total: 0 },
    hubTab: 'panel',
    text: { src: '', out: '', detected: '', busy: false },
    history: LS.json(HISTORY_KEY, []),
    glossary: null,
    replyLang: LS.get(REPLY_LANG_KEY, ''),
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
      if (shouldSkipText(src)) { out.set(src, src); continue; }
      const { text: shielded, tokens } = shield(src, glossary());
      recs.push({ src, shielded, tokens });
    }
    const BATCH = 20;
    for (let i = 0; i < recs.length; i += BATCH) {
      const slice = recs.slice(i, i + BATCH);
      try {
        const arr = await requestBatch(slice.map((r) => r.shielded), target);
        slice.forEach((r, k) => {
          const done = unshield(arr[k], r.tokens);
          out.set(r.src, done);
          cacheSet(target, r.src, done);
        });
        noteOk();
      } catch (e) {
        noteFail();
        slice.forEach((r) => out.set(r.src, r.src));
        if (onProgress && i === 0) toast(String(e.message || e));
      }
      if (onProgress) onProgress(Math.min(i + BATCH, recs.length), recs.length);
      if (i + BATCH < recs.length) await sleep(120);
    }
    for (const src of unique) if (!out.has(src)) out.set(src, src);
    return out;
  }

  // Long text: split at sentence boundaries, translate piece by piece.
  async function translateLong(text, target = S.target) {
    const parts = splitLong(text);
    const outs = [];
    for (const p of parts) {
      const hit = cacheGet(target, p);
      if (hit != null) { outs.push(hit); continue; }
      if (shouldSkipText(p)) { outs.push(p); continue; }
      const { text: shielded, tokens } = shield(p, glossary());
      try {
        const done = unshield(await requestOne(shielded, target), tokens);
        outs.push(done); cacheSet(target, p, done); noteOk();
      } catch (e) {
        noteFail(); outs.push(p);
        throw e;
      }
      await sleep(80);
    }
    return outs.join(' ');
  }

  // One chat/message string; returns '' when the text must not be sent.
  async function translateMsg(text, target = S.target) {
    const src = String(text ?? '');
    if (shouldSkipText(src)) return '';
    const hit = cacheGet(target, src);
    if (hit != null) return hit;
    const { text: shielded, tokens } = shield(src, glossary());
    const done = unshield(await requestOne(shielded, target), tokens);
    cacheSet(target, src, done);
    noteOk();
    return done;
  }

  // Auto-translate chat bubbles in place.
  function chatAuto() {
    S.chatOn = !S.chatOn;
    LS.set('tvp_tr_chat', S.chatOn ? '1' : '0');
    if (S.chatOn) startChatWatch();
    else stopChatWatch();
    return S.chatOn;
  }

  let chatObs = null;
  const chatSeen = new WeakSet();
  function startChatWatch() {
    if (chatObs || !S.chatOn) return;
    const scan = async () => {
      if (!S.chatOn) return;
      const nodes = $$('.msg-t, .thread .msg, .chat .msg').filter((el) => !chatSeen.has(el) && el.textContent && el.textContent.trim().length > 1);
      for (const el of nodes) {
        chatSeen.add(el);
        if (el.dataset.trDone === S.target) continue;
        try {
          const out = await translateMsg(el.textContent, S.target);
          if (out) { el.dataset.trDone = S.target; el.textContent = out; el.dir = dirOf(S.target); }
        } catch { /* quiet */ }
      }
    };
    scan();
    chatObs = new MutationObserver(() => { clearTimeout(S.timer); S.timer = setTimeout(scan, 400); });
    chatObs.observe(document.body, { childList: true, subtree: true });
  }
  function stopChatWatch() { if (chatObs) { chatObs.disconnect(); chatObs = null; } }

  // Reply in the customer's language.
  async function translateReply(text) {
    const lang = S.replyLang || S.target;
    if (!lang || lang === 'en') return String(text ?? '');
    return translateLong(String(text ?? ''), lang);
  }

  function setTarget(code) {
    S.target = panelTarget(code);
    LS.set('tvp_tr', S.target);
    if (S.active) { applyPanel(); paintHub(); }
    else paintHub();
  }

  // ---------- panel (whole-page) translation ----------
  function snapshot(el) {
    if (!S.originals.has(el)) S.originals.set(el, { text: el.textContent, dir: el.dir, lang: el.lang });
  }
  function restoreAll() {
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'en';
    for (const [el, o] of S.originals) {
      try { el.textContent = o.text; el.dir = o.dir; el.lang = o.lang; } catch {}
    }
    S.originals = new WeakMap();
    S.active = false;
  }

  let panelObs = null;
  async function applyPanel({ silent = false } = {}) {
    if (!isAdmin()) return;
    if (!S.on || S.target === 'en') { if (S.active) { restoreAll(); paintHub(); } return; }
    if (S.running) return;
    S.running = true;
    S.progress = { done: 0, total: 0 };
    paintHub();
    try {
      if (S.active) {
        for (const [el, o] of S.originals) { try { el.textContent = o.text; } catch {} }
        S.originals = new WeakMap();
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const el = node.parentElement;
          if (!el || el.closest(PANEL_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
          if (el.closest('.tr-hub, #tr-hub')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const nodes = [];
      while (walker.nextNode() && nodes.length < 800) nodes.push(walker.currentNode);
      const strings = nodes.map((n) => n.nodeValue);
      S.progress.total = nodes.length;
      S.active = true;
      document.documentElement.dir = dirOf(S.target);
      document.documentElement.lang = S.target;
      const map = await translateMany(strings, S.target, {
        onProgress: (done, total) => { S.progress = { done, total }; paintHub(); },
      });
      for (const n of nodes) {
        const out = map.get(n.nodeValue);
        if (out != null && out !== n.nodeValue) {
          snapshot(n.parentElement);
          n.nodeValue = out;
          if (n.parentElement) { n.parentElement.dir = dirOf(S.target); n.parentElement.lang = S.target; }
        }
      }
      if (!panelObs) {
        panelObs = new MutationObserver(() => {
          if (!S.active || S.running) return;
          clearTimeout(S.timer);
          S.timer = setTimeout(() => applyPanel({ silent: true }), 600);
        });
        panelObs.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      if (!silent) toast(`✅ ${nameOf(S.target)}`);
    } catch (e) {
      if (!silent) toast(String(e.message || e));
    } finally {
      S.running = false;
      paintHub();
    }
  }

  function stopPanel() {
    if (panelObs) { panelObs.disconnect(); panelObs = null; }
    restoreAll();
    paintHub();
    toast('↩️ English');
  }

  // ---------- public API ----------
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

  const afterRoute = () => {
    if (document.getElementById('tr-hub')) closeHub();
    if (S.chatOn) startChatWatch();
    if (S.active && !S.running) applyPanel({ silent: true });
  };

  // ---------- hub UI ----------
  function openHub(tab) {
    S.hubTab = TABS.some((t) => t.id === tab) ? tab : 'panel';
    let root = document.getElementById('tr-hub');
    if (!root) {
      root = document.createElement('div');
      root.id = 'tr-hub';
      root.className = 'tr-hub';
      root.setAttribute('data-no-tr', '');
      document.body.appendChild(root);
    }
    root.innerHTML = `<div class="trh-bg" data-tr-close></div>
      <section class="trh-sheet" role="dialog" aria-modal="true" aria-label="Translator">
        <header class="trh-head">
          <span class="trh-badge" aria-hidden="true">🌐</span>
          <div class="trh-titles"><h2>Translator</h2><p>${esc(nameOf(S.target))} · ${TR_LANGS.length} languages · your customer data stays private</p></div>
          <button type="button" class="trh-x" data-tr-close aria-label="Close">×</button>
        </header>
        <nav class="trh-tabs" role="tablist">${TABS.map((t) => `<button type="button" role="tab" class="trh-tab ${t.id === S.hubTab ? 'on' : ''}" data-tr-tab="${t.id}"><span aria-hidden="true">${t.ico}</span>${esc(t.label)}</button>`).join('')}</nav>
        <div class="trh-body" data-tr-body></div>
      </section>`;
    root.addEventListener('click', onHubClick);
    root.addEventListener('input', onHubInput);
    document.body.classList.add('trh-open');
    paintHub();
  }
  function closeHub() {
    const root = document.getElementById('tr-hub');
    if (root) { root.removeEventListener('click', onHubClick); root.removeEventListener('input', onHubInput); root.remove(); }
    document.body.classList.remove('trh-open');
  }

  function paintHub() {
    const body = $('[data-tr-body]');
    if (!body) return;
    const t = S.hubTab;
    body.innerHTML = t === 'panel' ? panelHtml() : t === 'text' ? textHtml() : t === 'reader' ? readerHtml() : t === 'glossary' ? glossaryHtml() : chatHtml();
    body.dir = dirOf(S.target);
  }

  function langGrid() {
    return `<div class="trh-grid">${TR_LANGS.map((l) => `<button type="button" class="trh-lang ${l.code === S.target ? 'on' : ''}" data-tr-lang="${l.code}"><span aria-hidden="true">${l.flag}</span><b>${esc(l.native)}</b><small>${esc(l.english)}</small></button>`).join('')}</div>`;
  }

  function panelHtml() {
    const busy = S.running;
    const pct = S.progress.total ? Math.round((S.progress.done / S.progress.total) * 100) : 0;
    const resting = Date.now() < S.coolUntil;
    return `<div class="trh-row">
      <label class="trh-switch"><input type="checkbox" data-tr-toggle ${S.on ? 'checked' : ''}><span></span> Live translation</label>
      <span class="trh-pill ${resting ? 'warn' : 'ok'}">${resting ? `resting ${Math.ceil((S.coolUntil - Date.now()) / 1000)}s` : 'ready'}</span>
    </div>
    <div class="trh-search"><input type="search" data-tr-q placeholder="Search languages…" aria-label="Search languages"></div>
    ${langGrid()}
    <div class="trh-actions">
      <button type="button" class="btn ${S.active ? '' : 'primary'}" data-tr-go ${busy ? 'disabled' : ''}>${busy ? `⏳ ${S.progress.done}/${S.progress.total} (${pct}%)` : S.active ? `✓ ${esc(nameOf(S.target))}` : '🌐 Translate panel'}</button>
      ${S.active ? '<button type="button" class="btn" data-tr-stop>↩ Back to English</button>' : ''}
    </div>
    <div class="trh-bar" ${busy ? '' : 'hidden'}><span style="width:${pct}%"></span></div>
    <p class="trh-note">Tables, codes, chat text and private fields are never sent anywhere.</p>`;
  }

  function textHtml() {
    return `<div class="trh-text">
      <textarea data-tr-src rows="5" placeholder="Type or paste text…">${esc(S.text.src)}</textarea>
      <div class="trh-text-mid"><span class="trh-det">${esc(S.text.detected)}</span><button type="button" class="btn small" data-tr-go-text ${S.text.busy ? 'disabled' : ''}>${S.text.busy ? '⏳' : 'Translate →'}</button></div>
      <textarea data-tr-out rows="5" readonly dir="${dirOf(S.target)}" placeholder="Translation appears here…">${esc(S.text.out)}</textarea>
      <div class="trh-actions">
        <button type="button" class="btn small" data-tr-copy ${S.text.out ? '' : 'disabled'}>Copy</button>
        <button type="button" class="btn small" data-tr-speak ${S.text.out ? '' : 'disabled'}>🔊 Speak</button>
        <button type="button" class="btn small" data-tr-clear>Clear</button>
      </div>
      ${S.history.length ? `<div class="trh-hist">${S.history.slice(0, 6).map((h, i) => `<button type="button" class="trh-chip" data-tr-hist="${i}" title="${esc(h.src)}">${esc(h.src.slice(0, 26))}…</button>`).join('')}</div>` : ''}
      <p class="trh-note">Glossary terms, links and e-mails in your text are protected.</p>`;
  }

  function readerHtml() {
    return `<div class="trh-reader">
      <label class="trh-label">Open any web page in ${esc(nameOf(S.target))}</label>
      <input type="url" data-tr-url placeholder="https://example.com/news" inputmode="url">
      <div class="trh-actions">
        <button type="button" class="btn primary" data-tr-read>📖 Open translated page</button>
        <button type="button" class="btn" data-tr-read-copy>Copy link</button>
      </div>
      <p class="trh-note">Opens Google's translation proxy — the page keeps its layout and links keep working.</p>`;
  }

  function glossaryHtml() {
    const g = glossary();
    return `<div class="trh-gloss">
      <div class="trh-row"><span class="trh-pill ok">${g.length} terms protected</span><button type="button" class="btn small" data-tr-gloss-reset>Reset defaults</button></div>
      <div class="trh-gloss-add"><input type="text" data-tr-g-from maxlength="40" placeholder="Keep as-is (e.g. Xtream)"><input type="text" data-tr-g-to maxlength="40" placeholder="Show as (optional)"><button type="button" class="btn small primary" data-tr-gloss-add>Add</button></div>
      <ul class="trh-gloss-list">${g.map((x, i) => `<li><b>${esc(x.from)}</b>${x.to && x.to !== x.from ? ` → ${esc(x.to)}` : ''}<button type="button" class="trh-x-s" data-tr-gloss-del="${i}" aria-label="Remove">×</button></li>`).join('')}</ul>
      <p class="trh-note">These words are never translated — they pass through untouched.</p>`;
  }

  function chatHtml() {
    return `<div class="trh-chat">
      <label class="trh-switch"><input type="checkbox" data-tr-chat ${S.chatOn ? 'checked' : ''}><span></span> Auto-translate chat bubbles on screen</label>
      <div class="trh-row"><label class="trh-label">Reply language</label></div>
      <div class="trh-grid trh-grid-s">${TR_LANGS.map((l) => `<button type="button" class="trh-lang ${l.code === (S.replyLang || S.target) ? 'on' : ''}" data-tr-reply="${l.code}"><span aria-hidden="true">${l.flag}</span><b>${esc(l.native)}</b></button>`).join('')}</div>
      <p class="trh-note">Replies you type are translated into the reply language before sending.</p>`;
  }

  // ---------- hub events ----------
  function onHubClick(e) {
    const root = document.getElementById('tr-hub');
    if (!root) return;
    if (e.target.closest('[data-tr-close]')) return closeHub();
    const tab = e.target.closest('[data-tr-tab]');
    if (tab) {
      S.hubTab = tab.dataset.trTab;
      root.querySelectorAll('[data-tr-tab]').forEach((b) => b.classList.toggle('on', b === tab));
      return paintHub();
    }
    const lang = e.target.closest('[data-tr-lang]');
    if (lang) return setTarget(lang.dataset.trLang);
    const reply = e.target.closest('[data-tr-reply]');
    if (reply) { S.replyLang = panelTarget(reply.dataset.trReply); LS.set(REPLY_LANG_KEY, S.replyLang); return paintHub(); }
    if (e.target.closest('[data-tr-go]')) { e.target.closest('[data-tr-go]').disabled = true; return applyPanel(); }
    if (e.target.closest('[data-tr-stop]')) return stopPanel();
    if (e.target.closest('[data-tr-go-text]')) return runText();
    if (e.target.closest('[data-tr-copy]')) { navigator.clipboard?.writeText(S.text.out).then(() => toast('Copied ✓')).catch(() => {}); return; }
    if (e.target.closest('[data-tr-speak]')) {
      try { const u = new SpeechSynthesisUtterance(S.text.out); u.lang = S.target; speechSynthesis.speak(u); } catch {}
      return;
    }
    if (e.target.closest('[data-tr-clear]')) { S.text = { src: '', out: '', detected: '', busy: false }; return paintHub(); }
    const hist = e.target.closest('[data-tr-hist]');
    if (hist) { const h = S.history[+hist.dataset.trHist]; if (h) { S.text.src = h.src; S.text.out = h.out || ''; paintHub(); } return; }
    if (e.target.closest('[data-tr-read]')) {
      const url = $('[data-tr-url]', root)?.value || '';
      try { window.open(buildReadUrl(url, S.target), '_blank', 'noopener'); } catch (err) { toast(String(err.message || err)); }
      return;
    }
    if (e.target.closest('[data-tr-read-copy]')) {
      const url = $('[data-tr-url]', root)?.value || '';
      try { navigator.clipboard?.writeText(buildReadUrl(url, S.target)).then(() => toast('Copied ✓')).catch(() => {}); } catch (err) { toast(String(err.message || err)); }
      return;
    }
    if (e.target.closest('[data-tr-gloss-add]')) {
      const from = $('[data-tr-g-from]', root)?.value.trim();
      const to = $('[data-tr-g-to]', root)?.value.trim();
      if (!from) return toast('Type the word to protect');
      if (glossary().some((x) => x.from.toLowerCase() === from.toLowerCase())) return toast('Already in the list');
      glossary().unshift({ from, to });
      if (glossary().length > 200) glossary().length = 200;
      saveGlossary();
      return paintHub();
    }
    const del = e.target.closest('[data-tr-gloss-del]');
    if (del) { glossary().splice(+del.dataset.trGlossDel, 1); saveGlossary(); return paintHub(); }
    if (e.target.closest('[data-tr-gloss-reset]')) { S.glossary = DEFAULT_GLOSSARY.slice(); saveGlossary(); return paintHub(); }
  }

  function onHubInput(e) {
    const root = document.getElementById('tr-hub');
    if (!root) return;
    if (e.target.matches('[data-tr-toggle]')) {
      S.on = e.target.checked;
      LS.set('tvp_tr_on', S.on ? '1' : '0');
      if (!S.on) stopPanel();
      return paintHub();
    }
    if (e.target.matches('[data-tr-chat]')) { chatAuto(); return paintHub(); }
    if (e.target.matches('[data-tr-src]')) { S.text.src = e.target.value; return; }
    if (e.target.matches('[data-tr-q]')) {
      const q = e.target.value.trim().toLowerCase();
      root.querySelectorAll('[data-tr-lang]').forEach((b) => {
        const code = b.dataset.trLang;
        const l = trLang(code);
        b.hidden = !!q && !`${l.native} ${l.english} ${code}`.toLowerCase().includes(q);
      });
    }
  }

  async function runText() {
    const src = S.text.src.trim();
    if (!src) return toast('Type some text first');
    S.text.busy = true; paintHub();
    try {
      const out = await translateLong(src, S.target);
      S.text.out = out;
      S.history = [{ src, out }, ...S.history].slice(0, 12);
      LS.set(HISTORY_KEY, JSON.stringify(S.history));
      noteOk();
    } catch (e) {
      noteFail();
      toast(String(e.message || e));
    } finally {
      S.text.busy = false;
      paintHub();
    }
  }

  // Escape closes the hub.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('tr-hub')) closeHub(); });

  const api = {
    trCur, trDir, trAuto, afterRoute,
    flagOf, nameOf,
    translatorCard: () => `<div class="card tr-teaser"><span class="tr-teaser-ico" aria-hidden="true">🌐</span><div style="flex:1;min-width:0"><h3 style="margin:0">Translator</h3><p class="muted small" style="margin:4px 0 0">The whole panel, a text, a chat or a web page — in ${esc(nameOf(S.target))} or any of ${TR_LANGS.length} languages. Your customer data stays private.</p></div><button type="button" class="btn primary" data-act="tr-open" aria-label="Open Translator panel">Open Translator</button></div>`,
    openHub, translateMany, translateLong, translateMsg, chatAuto, translateReply, setTarget,
    actions: {
      'tr-open': (el) => { openHub(el?.dataset?.tab || 'panel'); },
    },
  };
  return api;
}
