// Modern instant-translate overlay — additive UI, does not touch translator.js hub.
// Reuses the free engine + language metadata from lang-data.js.
import {
  TR_LANGS, trLang, dirOf, shouldSkipText, translateEndpoint, parseTranslateResponse,
} from './lang-data.js?v=122';

const LS = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  json(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CACHE_KEY = 'tvp_it_cache';
const HIST_KEY = 'tvp_it_history';

const CSS = `
#it-fab{position:fixed;right:18px;bottom:18px;z-index:9990;width:52px;height:52px;border-radius:50%;border:1px solid rgba(34,211,238,.35);background:rgba(5,12,14,.72);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#22D3EE;font-size:20px;display:grid;place-items:center;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.45),0 0 0 1px rgba(34,211,238,.15) inset;transition:transform .18s ease,box-shadow .18s ease}
#it-fab:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 12px 36px rgba(34,211,238,.35)}
#it-card{position:fixed;z-index:9991;right:18px;bottom:80px;width:min(430px,calc(100vw - 24px));border-radius:18px;border:1px solid rgba(34,211,238,.28);background:rgba(10,20,24,.86);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);color:#E6FBFF;font-family:Inter,system-ui,sans-serif;box-shadow:0 24px 70px rgba(0,0,0,.55);opacity:0;transform:translateY(14px) scale(.97);pointer-events:none;transition:opacity .22s ease,transform .22s cubic-bezier(.2,.9,.3,1.2)}
#it-card.open{opacity:1;transform:none;pointer-events:auto}
#it-card .it-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(34,211,238,.14)}
#it-card .it-title{font-weight:800;font-size:.85rem;letter-spacing:.06em;color:#8DEFFF;flex:1}
#it-card .it-x{background:none;border:0;color:#7BD8E8;font-size:16px;cursor:pointer;padding:4px 6px;border-radius:8px}
#it-card .it-x:hover{background:rgba(34,211,238,.12)}
.it-langs{display:flex;align-items:center;gap:8px;padding:12px 14px 6px}
.it-sel{appearance:none;border:1px solid rgba(34,211,238,.25);background:rgba(34,211,238,.08);color:#E6FBFF;font:inherit;font-size:.82rem;padding:7px 26px 7px 10px;border-radius:10px;cursor:pointer;max-width:44vw}
.it-sel option{background:#0A1418;color:#E6FBFF}
.it-swap{border:1px solid rgba(34,211,238,.25);background:rgba(34,211,238,.08);color:#22D3EE;border-radius:10px;width:34px;height:34px;font-size:15px;cursor:pointer;transition:transform .25s ease}
.it-swap:hover{transform:rotate(180deg)}
.it-body{padding:6px 14px 14px;display:grid;gap:8px}
.it-src,.it-out{width:100%;box-sizing:border-box;border-radius:12px;padding:12px;font:inherit;font-size:.95rem;resize:none;background:rgba(255,255,255,.05);border:1px solid rgba(34,211,238,.18);color:inherit;outline:none}
.it-src:focus{border-color:#22D3EE;box-shadow:0 0 0 3px rgba(34,211,238,.15)}
.it-out{background:rgba(34,211,238,.06);border-color:rgba(34,211,238,.28);min-height:74px;white-space:pre-wrap}
.it-out[readonly]{cursor:default}
.it-meta{display:flex;align-items:center;gap:8px;font-size:.72rem;color:#7BD8E8;min-height:18px}
.it-badge{padding:2px 8px;border-radius:99px;background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.22);font-weight:700}
.it-count{margin-left:auto;opacity:.7}
.it-acts{display:flex;gap:6px}
.it-btn{flex:1;border:1px solid rgba(34,211,238,.25);background:rgba(34,211,238,.08);color:#CFFAFE;font:inherit;font-size:.78rem;font-weight:700;padding:8px 4px;border-radius:10px;cursor:pointer;transition:background .15s ease}
.it-btn:hover{background:rgba(34,211,238,.18)}
.it-hist{padding:0 14px 12px;display:flex;flex-wrap:wrap;gap:6px}
.it-hist button{border:1px solid rgba(34,211,238,.2);background:rgba(34,211,238,.06);color:#9BE8F5;font:inherit;font-size:.7rem;padding:4px 9px;border-radius:99px;cursor:pointer;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.it-hist button:hover{background:rgba(34,211,238,.16)}
.it-err{color:#FFB4B4;font-size:.75rem}
.it-dot{width:7px;height:7px;border-radius:50%;background:#22D3EE;display:inline-block;animation:itP 1s ease-in-out infinite}
@keyframes itP{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){#it-card,.it-swap,.it-dot{animation:none;transition:none}}
@media (max-width:480px){#it-card{right:12px;left:12px;width:auto;bottom:78px}}
`;

const HIST_MAX = 8;
const cache = () => LS.json(CACHE_KEY, {});
const cacheGet = (lang, src) => { const m = cache()[lang]; return m && typeof m[src] === 'string' ? m[src] : null; };
let saveT = 0;
const cacheSet = (lang, src, out) => {
  if (!src || src.length > 400 || out == null) return;
  const all = cache();
  (all[lang] ||= {})[src] = out;
  const keys = Object.keys(all[lang]);
  if (keys.length > 900) for (const k of keys.slice(0, keys.length - 900)) delete all[lang][k];
  clearTimeout(saveT);
  saveT = setTimeout(() => LS.set(CACHE_KEY, JSON.stringify(all)), 600);
};

let fails = 0, coolUntil = 0;
const checkCircuit = () => {
  if (Date.now() < coolUntil) throw new Error(`Translator resting — try again in ${Math.ceil((coolUntil - Date.now()) / 1000)}s.`);
};

async function translate(text, target) {
  checkCircuit();
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text.slice(0, 4500))}`;
  const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!r.ok) { fails++; if (fails >= 3) { coolUntil = Date.now() + 60000; fails = 0; } throw new Error('Translator did not answer.'); }
  const j = await r.json();
  fails = 0;
  return (j[0] || []).map((x) => (Array.isArray(x) ? x[0] : '')).join('');
}

function mount() {
  if (document.getElementById('it-fab')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const opts = TR_LANGS.map((l) => `<option value="${l.code}">${l.flag} ${esc(l.native)}</option>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
    <button id="it-fab" aria-label="Instant translate" title="Instant translate">🌐</button>
    <div id="it-card" role="dialog" aria-label="Instant translate" data-no-tr>
      <div class="it-head"><span class="it-title">⚡ INSTANT TRANSLATE</span><button class="it-x" aria-label="Close">✕</button></div>
      <div class="it-langs">
        <select class="it-sel" id="it-from"><option value="auto">🌐 Detect language</option>${opts}</select>
        <button class="it-swap" title="Swap" aria-label="Swap languages">⇄</button>
        <select class="it-sel" id="it-to">${opts}</select>
      </div>
      <div class="it-body">
        <textarea class="it-src" id="it-in" rows="3" placeholder="Type or paste text…"></textarea>
        <div class="it-out" id="it-out" dir="ltr"></div>
        <div class="it-meta"><span id="it-status"></span><span class="it-count" id="it-count"></span></div>
        <div class="it-acts">
          <button class="it-btn" id="it-copy">📋 Copy</button>
          <button class="it-btn" id="it-speak">🔊 Speak</button>
          <button class="it-btn" id="it-clear">✕ Clear</button>
        </div>
      </div>
      <div class="it-hist" id="it-hist"></div>
    </div>`);

  const fab = document.getElementById('it-fab'), card = document.getElementById('it-card');
  const $in = document.getElementById('it-in'), $out = document.getElementById('it-out');
  const $from = document.getElementById('it-from'), $to = document.getElementById('it-to');
  const $status = document.getElementById('it-status'), $count = document.getElementById('it-count');
  const $hist = document.getElementById('it-hist');

  $to.value = LS.get('tvp_it_to', trLang(LS.get('tvp_tr', 'en')).code === 'en' ? 'ar' : LS.get('tvp_tr', 'en'));
  let timer = 0, seq = 0, last = '';

  const history = () => LS.json(HIST_KEY, []);
  const renderHist = () => {
    const h = history();
    $hist.innerHTML = h.map((x, i) => `<button data-i="${i}" title="${esc(x.o).slice(0, 80)}">${esc(x.o.slice(0, 26))}</button>`).join('');
  };
  const pushHist = (o, t, lang) => {
    if (!o.trim()) return;
    const h = history().filter((x) => x.o !== o);
    h.unshift({ o, t, lang, at: Date.now() });
    LS.set(HIST_KEY, JSON.stringify(h.slice(0, HIST_MAX)));
    renderHist();
  };

  const setStatus = (html) => { $status.innerHTML = html; };

  async function run() {
    const text = $in.value.trim();
    const mySeq = ++seq;
    $count.textContent = `${$in.value.length} chars`;
    if (!text) { $out.textContent = ''; setStatus(''); return; }
    if (shouldSkipText(text)) { $out.textContent = text; setStatus('<span class="it-badge">nothing to translate</span>'); return; }
    const target = $to.value;
    if (target === $from.value && $from.value !== 'auto') { setStatus(''); return; }
    const hit = cacheGet(target, text);
    if (hit != null) { show(hit, ''); return; }
    setStatus('<span class="it-dot"></span> translating…');
    try {
      const out = await translate(text, target);
      if (mySeq !== seq) return;
      cacheSet(target, text, out);
      show(out, '');
      pushHist(text, out, target);
    } catch (e) {
      if (mySeq !== seq) return;
      setStatus(`<span class="it-err">${esc(e.message || 'Translation failed')}</span>`);
    }
    function show(out, det) {
      $out.textContent = out;
      $out.dir = dirOf(target);
      last = out;
      setStatus(det ? `<span class="it-badge">detected: ${esc(det)}</span>` : '');
    }
  }

  $in.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  $in.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); } });
  $to.addEventListener('change', () => { LS.set('tvp_it_to', $to.value); run(); });
  $from.addEventListener('change', run);
  document.querySelector('.it-swap').addEventListener('click', () => {
    if (!last || $from.value === 'auto') return;
    const prev = $from.value;
    $from.value = $to.value;
    $to.value = prev;
    LS.set('tvp_it_to', $to.value);
    $in.value = last;
    run();
  });
  document.getElementById('it-copy').addEventListener('click', async () => {
    if (!last) return;
    try { await navigator.clipboard.writeText(last); setStatus('<span class="it-badge">copied ✓</span>'); } catch {}
  });
  document.getElementById('it-speak').addEventListener('click', () => {
    if (!last || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(last);
    u.lang = $to.value;
    speechSynthesis.speak(u);
  });
  document.getElementById('it-clear').addEventListener('click', () => { $in.value = ''; $out.textContent = ''; last = ''; setStatus(''); $count.textContent = ''; $in.focus(); });
  $hist.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const item = history()[+b.dataset.i];
    if (!item) return;
    $in.value = item.o;
    if (item.lang) $to.value = item.lang;
    run();
  });
  card.querySelector('.it-x').addEventListener('click', () => card.classList.remove('open'));
  fab.addEventListener('click', () => {
    card.classList.toggle('open');
    if (card.classList.contains('open')) { renderHist(); $in.focus(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') card.classList.remove('open'); });
  document.addEventListener('click', (e) => {
    if (card.classList.contains('open') && !card.contains(e.target) && e.target !== fab && !fab.contains(e.target)) card.classList.remove('open');
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();
