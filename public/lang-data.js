// Language metadata and pure translation helpers. No DOM here: this file is
// imported by the browser (lang.js, translator.js) and by the Node unit tests.

export const APP_LANGS = [
  { code: 'en', native: 'English', english: 'English', flag: '🇬🇧' },
  { code: 'fr', native: 'Français', english: 'French', flag: '🇫🇷' },
  { code: 'de', native: 'Deutsch', english: 'German', flag: '🇩🇪' },
  { code: 'es', native: 'Español', english: 'Spanish', flag: '🇪🇸' },
  { code: 'it', native: 'Italiano', english: 'Italian', flag: '🇮🇹' },
  { code: 'ar', native: 'العربية', english: 'Arabic', flag: '🇸🇦', rtl: true },
];

export const LANGS = APP_LANGS.map((l) => [l.code, l.native]);

export const RTL_LANGS = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);

// Target languages offered by the translator hub (the free Google endpoint).
export const TR_LANGS = [
  { code: 'en', native: 'English', english: 'English', flag: '🇬🇧' },
  { code: 'ar', native: 'العربية', english: 'Arabic', flag: '🇸🇦' },
  { code: 'fr', native: 'Français', english: 'French', flag: '🇫🇷' },
  { code: 'es', native: 'Español', english: 'Spanish', flag: '🇪🇸' },
  { code: 'de', native: 'Deutsch', english: 'German', flag: '🇩🇪' },
  { code: 'it', native: 'Italiano', english: 'Italian', flag: '🇮🇹' },
  { code: 'pt', native: 'Português', english: 'Portuguese', flag: '🇵🇹' },
  { code: 'nl', native: 'Nederlands', english: 'Dutch', flag: '🇳🇱' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish', flag: '🇹🇷' },
  { code: 'ru', native: 'Русский', english: 'Russian', flag: '🇷🇺' },
  { code: 'uk', native: 'Українська', english: 'Ukrainian', flag: '🇺🇦' },
  { code: 'pl', native: 'Polski', english: 'Polish', flag: '🇵🇱' },
  { code: 'ro', native: 'Română', english: 'Romanian', flag: '🇷🇴' },
  { code: 'el', native: 'Ελληνικά', english: 'Greek', flag: '🇬🇷' },
  { code: 'sv', native: 'Svenska', english: 'Swedish', flag: '🇸🇪' },
  { code: 'da', native: 'Dansk', english: 'Danish', flag: '🇩🇰' },
  { code: 'no', native: 'Norsk', english: 'Norwegian', flag: '🇳🇴' },
  { code: 'fi', native: 'Suomi', english: 'Finnish', flag: '🇫🇮' },
  { code: 'cs', native: 'Čeština', english: 'Czech', flag: '🇨🇿' },
  { code: 'hu', native: 'Magyar', english: 'Hungarian', flag: '🇭🇺' },
  { code: 'bg', native: 'Български', english: 'Bulgarian', flag: '🇧🇬' },
  { code: 'sr', native: 'Српски', english: 'Serbian', flag: '🇷🇸' },
  { code: 'hr', native: 'Hrvatski', english: 'Croatian', flag: '🇭🇷' },
  { code: 'th', native: 'ไทย', english: 'Thai', flag: '🇹🇭' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', flag: '🇻🇳' },
  { code: 'id', native: 'Indonesia', english: 'Indonesian', flag: '🇮🇩' },
  { code: 'ms', native: 'Melayu', english: 'Malay', flag: '🇲🇾' },
  { code: 'tl', native: 'Filipino', english: 'Filipino', flag: '🇵🇭' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', flag: '🇮🇳' },
  { code: 'ur', native: 'اردو', english: 'Urdu', flag: '🇵🇰', rtl: true },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', flag: '🇧🇩' },
  { code: 'fa', native: 'فارسی', english: 'Persian', flag: '🇮🇷', rtl: true },
  { code: 'he', native: 'עברית', english: 'Hebrew', flag: '🇮🇱', rtl: true },
  { code: 'zh-CN', native: '中文', english: 'Chinese (Simplified)', flag: '🇨🇳' },
  { code: 'ja', native: '日本語', english: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', native: '한국어', english: 'Korean', flag: '🇰🇷' },
  { code: 'sw', native: 'Kiswahili', english: 'Swahili', flag: '🇰🇪' },
  { code: 'am', native: 'አማርኛ', english: 'Amharic', flag: '🇪🇹' },
  { code: 'so', native: 'Soomaali', english: 'Somali', flag: '🇸🇴' },
  { code: 'ha', native: 'Hausa', english: 'Hausa', flag: '🇳🇬' },
];

const APP_MAP = Object.fromEntries(APP_LANGS.map((l) => [l.code, l]));
const TR_MAP = Object.fromEntries(TR_LANGS.map((l) => [l.code, l]));

export const appLang = (code) => APP_MAP[code] || APP_MAP.en;
export const trLang = (code) => TR_MAP[code] || TR_MAP.en;
export const flagOf = (code) => appLang(code).flag;
export const dirOf = (code) => (RTL_LANGS.has(String(code || '').split('-')[0]) ? 'rtl' : 'ltr');
export const isRtl = (code) => dirOf(code) === 'rtl';
export const nameOf = (code) => appLang(code).native;
export const englishOf = (code) => appLang(code).english;
export const trNameOf = (code) => trLang(code).native;

// A public web-page reader: Google's translate proxy keeps the page's layout and
// rewrites links so the visitor can keep browsing in the same language.
export function buildReadUrl(rawUrl, target) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch { throw new Error('Paste a full link starting with https://'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links can be read');
  const host = u.hostname.replace(/\./g, '-');
  const sep = u.search ? '&' : '?';
  return `https://${host}.translate.goog${u.pathname}${u.search}${sep}_x_tr_sl=auto&_x_tr_tl=${encodeURIComponent(target)}&_x_tr_hl=${encodeURIComponent(target)}${u.hash}`;
}

// Keep brands, links, e-mails, template variables and glossary terms out of the
// translation request, so the engine cannot rename or mangle them.
const SHIELD_PATTERNS = [
  /https?:\/\/[^\s<>"']+/gi,
  /\bwww\.[^\s<>"']+/gi,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  /@[A-Za-z0-9_]{2,}/g,
  /\{\{[^{}]{0,40}\}\}/g,
  /\{[A-Za-z0-9_ .:-]{1,40}\}/g,
  /%[sdif]/g,
];

export function glossaryOf(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => ({ from: String(x && x.from || '').trim(), to: String(x && x.to || '').trim() }))
      .filter((x) => x.from && x.from.length <= 40).slice(0, 200);
  } catch { return []; }
}

export const DEFAULT_GLOSSARY = [
  { from: 'INTPROTO-TV', to: 'INTPROTO-TV' },
  { from: 'INTPROTO', to: 'INTPROTO' }, { from: 'Xtream', to: 'Xtream' }, { from: 'EPG', to: 'EPG' },
  { from: 'VOD', to: 'VOD' }, { from: 'M3U', to: 'M3U' }, { from: 'IPTV', to: 'IPTV' },
  { from: 'WhatsApp', to: 'WhatsApp' }, { from: 'Telegram', to: 'Telegram' },
  { from: 'Stripe', to: 'Stripe' }, { from: 'Resend', to: 'Resend' }, { from: 'Cloudflare', to: 'Cloudflare' },
];

// Protect: replace every shielded span with {{n}}. The free endpoint keeps
// these numeric tokens intact (checked against the live service).
export function shield(text, glossary = []) {
  const tokens = [];
  let out = String(text ?? '');
  const keep = glossary.filter((g) => g && g.from).sort((a, b) => b.from.length - a.from.length);
  const sources = keep.map((g) => `(?<![\\w-])${g.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)
    .concat(SHIELD_PATTERNS.map((re) => re.source));
  // One pass only: a second pass would see the {{n}} tokens we just inserted and
  // wrap them again ({{{{1}}}}), which the engine then cannot preserve.
  out = out.replace(new RegExp(sources.join('|'), 'gi'), (m) => {
    const hit = keep.find((g) => m.toLowerCase() === g.from.toLowerCase());
    return `{{${tokens.push(hit ? (hit.to || hit.from) : m) - 1}}}`;
  });
  return { text: out, tokens };
}

export function unshield(text, tokens = []) {
  return String(text ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (m, i) => (tokens[+i] != null ? tokens[+i] : m));
}

// Text that must never leave the browser: links, identifiers, pure numbers,
// dates, e-mails, MAC addresses and very short fragments.
export function shouldSkipText(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 2) return true;
  if (!/[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u1200-\u137F]/.test(s)) return true;
  if (/^(https?:\/\/|www\.|mailto:|tel:)/i.test(s)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
  if (/^[@#][\w.-]+$/.test(s)) return true;
  if (/^[\d\s.,:%+\-/$()#*]+$/.test(s)) return true;
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}([ T]\d{1,2}:\d{2})?$/.test(s)) return true;
  if (/^\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?$/.test(s)) return true;
  if (/(?:\d{1,3}\.){3}\d{1,3}/.test(s)) return true;
  if (/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(s)) return true;
  if (/^[A-Z0-9_-]{6,}$/.test(s) && !/[a-z]/.test(s)) return true;
  return false;
}

// Split very long text at sentence/paragraph boundaries; the endpoint accepts
// roughly 4000 characters per q parameter.
export function splitLong(text, max = 3500) {
  const s = String(text ?? '');
  if (s.length <= max) return [s];
  const parts = [];
  let buf = '';
  const push = (piece) => {
    if (!piece) return;
    if ((buf + piece).length > max && buf) { parts.push(buf); buf = ''; }
    if (piece.length > max) {
      for (let i = 0; i < piece.length; i += max) {
        const cut = piece.slice(i, i + max);
        if (buf) { parts.push(buf); buf = ''; }
        parts.push(cut);
      }
      return;
    }
    buf += piece;
  };
  for (const piece of s.split(/(?<=[.!?。！？\n])/)) push(piece);
  if (buf) parts.push(buf);
  return parts.filter(Boolean);
}

// Batch unique strings for the endpoint: at most `maxItems` q parameters and
// about `maxChars` characters per request (the service rejects very big calls).
export function batchTexts(list, maxItems = 24, maxChars = 3200) {
  const seen = new Set();
  const batches = [];
  let cur = [];
  let size = 0;
  for (const raw of list) {
    const s = String(raw ?? '');
    if (!s || seen.has(s)) continue;
    seen.add(s);
    if (cur.length && (cur.length >= maxItems || size + s.length > maxChars)) {
      batches.push(cur); cur = []; size = 0;
    }
    cur.push(s); size += s.length + 8;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

export function translateEndpoint(target, texts) {
  const qs = texts.map((q) => 'q=' + encodeURIComponent(q)).join('&');
  return `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(target)}&${qs}`;
}

// The endpoint answers either [[text, source], ...] or, for one item,
// [text, source]; older shapes wrap the text in an array.
export function parseTranslateResponse(data) {
  if (!Array.isArray(data)) return null;
  return data.map((row) => {
    if (Array.isArray(row)) {
      const first = row[0];
      if (Array.isArray(first)) return first.map((x) => (Array.isArray(x) ? x[0] : x)).join('');
      return first == null ? '' : String(first);
    }
    return row == null ? '' : String(row);
  });
}

// The panel's own labels are translated; customer data is not. These selectors
// cover the data-bearing spots in the dashboard (tables, codes, chat, links).
export const PANEL_SKIP_SELECTOR = [
  'script', 'style', 'noscript', 'svg', 'canvas', 'code', 'pre', 'kbd', 'samp', 'time',
  'input', 'textarea', 'select', 'option', 'template',
  '[contenteditable="true"]', '[data-no-tr]', '[translate="no"]', '[dir="ltr"]',
  '.cred-v', '.code', '.mono', '.tbl td', '.msg-t', '.thread', '.chat', '.receipt',
  '.tr-hub', '#tr-hub', '#lang-sheet', '#toast', '.no-tr',
].join(',');

export function panelTarget(code) {
  return TR_MAP[code] ? code : 'en';
}
