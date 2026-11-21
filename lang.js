// The Language Center: one modern sheet for every place that changes the
// language of the app (login, site footer, support, reseller, account).
// The translator hub is separate (translator.js) — it changes content, not the UI.

import { APP_LANGS, flagOf, nameOf, englishOf, dirOf } from './lang-data.js?v=122';
import { t, tIn, ensureLang } from './i18n.js?v=125';

const RECENT_KEY = 'tvp_lang_recent';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const focusables = (root) => [...root.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);

function recents() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((c) => APP_LANGS.some((l) => l.code === c)).slice(0, 3) : [];
  } catch { return []; }
}
function remember(code) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([code, ...recents().filter((c) => c !== code)].slice(0, 3))); } catch {}
}
function suggested() {
  const list = navigator.languages || [navigator.language || 'en'];
  for (const raw of list) {
    const two = String(raw || '').toLowerCase().split('-')[0];
    const hit = APP_LANGS.find((l) => l.code === two);
    if (hit) return hit.code;
  }
  return '';
}

let openState = null;

export function openLangSheet({ current = 'en', onPick, title, subtitle } = {}) {
  if (openState) closeLangSheet(true);
  const recent = recents();
  const sugg = suggested();
  const root = document.createElement('div');
  root.id = 'lang-sheet';
  root.className = 'ls-root';
  root.innerHTML = `<div class="ls-bg" data-ls-close></div>
    <section class="ls-sheet" role="dialog" aria-modal="true" aria-labelledby="ls-title">
      <div class="ls-grip" aria-hidden="true"></div>
      <header class="ls-head"><span class="ls-badge" aria-hidden="true">🌐</span><div class="ls-titles"><h2 id="ls-title">${esc(title || 'Language')}</h2><p>${esc(subtitle || 'Choose the language of the app. You can change it at any time.')}</p></div><button type="button" class="ls-x" data-ls-close aria-label="${esc(t('close'))}">×</button></header>
      <label class="ls-search"><span aria-hidden="true">🔎</span><input type="search" autocomplete="off" placeholder="${esc(t('searchLang'))}" aria-label="${esc(t('searchLang'))}" data-ls-q></label>
      <div class="ls-extra" data-ls-extra>${sugg && sugg !== current ? `<span class="ls-label">${esc(t('suggestedLang'))}</span><button type="button" class="ls-chip" data-code="${sugg}"><span>${flagOf(sugg)}</span>${esc(nameOf(sugg))}</button>` : ''}${recent.length ? `<span class="ls-label">${esc(t('recentLang'))}</span><div class="ls-recents">${recent.map((c) => `<button type="button" class="ls-chip" data-code="${c}"><span>${flagOf(c)}</span>${esc(nameOf(c))}</button>`).join('')}</div>` : ''}</div>
      <div class="ls-list" role="listbox" aria-label="${esc(t('language'))}" data-ls-list>${listHtml(current)}</div>
      <p class="ls-empty" data-ls-empty hidden>${esc(t('noLangMatch'))}</p>
      <div class="ls-preview"><div class="ls-pv-head"><span class="ls-pv-label">${esc(t('previewLang'))}</span><span class="ls-pv-lang" data-ls-pvlang>${flagOf(current)} ${esc(nameOf(current))}</span></div><div class="ls-pv-text" data-ls-pv dir="${dirOf(current)}">${esc(tIn(current, 'tagline'))}</div><div class="ls-pv-foot" data-ls-pvfoot dir="${dirOf(current)}">${esc(tIn(current, 'signIn'))} · ${esc(tIn(current, 'language'))}</div></div>
      <p class="ls-note">${esc(t('savedDevice'))}</p>
    </section>`;
  document.body.appendChild(root);
  document.body.classList.add('ls-open');
  const prevFocus = document.activeElement;

  const state = {
    current, onPick, root, prevFocus, active: current, query: '',
    key(e) {
      if (e.key === 'Escape') { e.preventDefault(); closeLangSheet(); return; }
      if (e.key === 'Tab') {
        const f = focusables(root);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const opts = [...root.querySelectorAll('[data-opt]')];
        if (!opts.length) return;
        e.preventDefault();
        const i = opts.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (i < 0 ? 0 : (i + 1) % opts.length) : (i <= 0 ? opts.length - 1 : i - 1);
        opts[next].focus();
      }
    },
    close() { closeLangSheet(); },
    choose(code) {
      if (!code) return;
      remember(code);
      closeLangSheet();
      try { onPick && onPick(code); } catch (err) { console.error(err); }
    },
  };
  openState = state;

  root.addEventListener('click', (e) => {
    const close = e.target.closest('[data-ls-close]');
    if (close) return state.close();
    const opt = e.target.closest('[data-code]');
    if (opt) state.choose(opt.dataset.code);
  });
  root.addEventListener('input', (e) => {
    if (!e.target.matches('[data-ls-q]')) return;
    state.query = e.target.value.trim().toLowerCase();
    filter(state);
  });
  root.addEventListener('keydown', (e) => {
    state.key(e);
    if (e.key === 'Enter' && e.target.matches('[data-opt]')) { e.preventDefault(); state.choose(e.target.dataset.code); }
  });
  root.addEventListener('focusin', (e) => {
    const opt = e.target.closest('[data-opt]');
    if (!opt) return;
    root.querySelectorAll('[data-opt]').forEach((x) => { x.tabIndex = x === opt ? 0 : -1; });
    state.active = opt.dataset.code;
    const pv = $('[data-ls-pv]', root); const pf = $('[data-ls-pvfoot]', root); const pl = $('[data-ls-pvlang]', root);
    const paint = () => {
      if (pv) { pv.textContent = tIn(state.active, 'tagline'); pv.dir = dirOf(state.active); }
      if (pf) { pf.textContent = `${tIn(state.active, 'signIn')} · ${tIn(state.active, 'language')}`; pf.dir = dirOf(state.active); }
      if (pl) pl.textContent = `${flagOf(state.active)} ${nameOf(state.active)}`;
    };
    paint();
    ensureLang(state.active).then(() => { if (state.active === opt.dataset.code) paint(); });
  });

  requestAnimationFrame(() => {
    root.classList.add('open');
    const q = $('[data-ls-q]', root);
    if (q && window.matchMedia('(min-width: 721px)').matches) q.focus();
    else root.querySelector('[data-opt].on')?.focus({ preventScroll: true });
  });
  return root;
}

function listHtml(current) {
  return APP_LANGS.map((l) => `<button type="button" role="option" class="ls-opt ${l.code === current ? 'on' : ''}" aria-selected="${l.code === current}" data-opt data-code="${l.code}" tabindex="${l.code === current ? 0 : -1}">
      <span class="ls-flag" aria-hidden="true">${l.flag}</span>
      <span class="ls-names"><b>${esc(l.native)}</b><small>${esc(l.english)}${l.rtl ? ' · RTL' : ''}</small></span>
      <span class="ls-check" aria-hidden="true">${l.code === current ? '✓' : ''}</span>
    </button>`).join('');
}

function filter(state) {
  const { root, query } = state;
  const list = $('[data-ls-list]', root);
  if (!list) return;
  let shown = 0;
  APP_LANGS.forEach((l) => {
    const hay = `${l.native} ${l.english} ${l.code}`.toLowerCase();
    const hit = !query || hay.includes(query);
    const el = list.querySelector(`[data-opt][data-code="${l.code}"]`);
    if (el) { el.hidden = !hit; if (hit) shown++; }
  });
  const empty = $('[data-ls-empty]', root);
  if (empty) empty.hidden = shown > 0;
  const extra = $('[data-ls-extra]', root);
  if (extra) extra.hidden = !!query;
}

export function closeLangSheet(instant) {
  const state = openState;
  if (!state) return;
  openState = null;
  const { root, prevFocus } = state;
  root.classList.remove('open');
  document.body.classList.remove('ls-open');
  const done = () => { root.remove(); if (prevFocus && document.contains(prevFocus)) try { prevFocus.focus({ preventScroll: true }); } catch {} };
  if (instant) return done();
  setTimeout(done, 180);
}

export const isLangSheetOpen = () => !!openState;

// The small chip used in the site footer, the login card, support and the
// reseller bar. The app's click handler opens the sheet.
export function langChip(current, { label } = {}) {
  return `<button type="button" class="ls-chip ls-chip-lg" data-act="lang-center" aria-haspopup="dialog" aria-label="${esc(label || t('language'))}"><span aria-hidden="true">${flagOf(current)}</span>${esc(nameOf(current))}<span class="ls-caret" aria-hidden="true">⌄</span></button>`;
}

// One floating pill on customer pages; it shows the language in its own script.
export function paintLangPill(current) {
  let el = document.getElementById('lang-pill');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lang-pill';
    el.className = 'ls-pill-wrap';
    document.body.appendChild(el);
  }
  el.innerHTML = `<button type="button" class="ls-pill" data-act="lang-center" aria-haspopup="dialog" aria-label="${esc(t('language') + ': ' + nameOf(current))}"><span class="ls-pill-flag" aria-hidden="true">${flagOf(current)}</span><span class="ls-pill-name">${esc(nameOf(current))}</span><span class="ls-pill-globe" aria-hidden="true">🌐</span></button>`;
}

export { englishOf, dirOf, flagOf, nameOf };
