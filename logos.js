// logos.js — finds a real logo for a TV channel from its name.
// Used when the panel gives no logo for a channel, or its logo does not load.
// The index (logos-db.json) is built by tools/build-logos.mjs from the public iptv-org channel database.

// Words that describe the stream, not the channel.
const JUNK = new Set(('hd fhd uhd sd qhd 4k 8k hevc h265 h264 x265 x264 raw hq lq hdr 50fps 60fps fps 1080p 720p 576p 480p 1080 720 '
  + 'backup bkp vip multi low high test new org original dolby').split(' '));
const SOFT = new Set(['tv', 'channel', 'television', 'the']);

// Country hints taken from the prefix panels put before a name ("FR: TF1", "|UK| Sky News").
const ARAB = ['QA', 'AE', 'SA', 'EG', 'MA', 'DZ', 'TN', 'LB', 'IQ', 'JO', 'KW', 'SY', 'BH', 'OM', 'LY', 'PS', 'SD', 'YE'];
const HINTS = {
  UK: ['GB', 'UK'], EN: ['GB', 'UK', 'US'], USA: ['US'], AR: ARAB, ARB: ARAB, ARA: ARAB, ARAB: ARAB, MAR: ['MA'], TUN: ['TN'], ALG: ['DZ'], EGY: ['EG'],
  GER: ['DE'], DEU: ['DE'], FRA: ['FR'], ITA: ['IT'], ESP: ['ES'], SPA: ['ES'], POR: ['PT'], NED: ['NL'], NLD: ['NL'], BEL: ['BE'],
  TUR: ['TR'], CAN: ['CA'], BRA: ['BR'], MEX: ['MX'], LAT: ['MX', 'AR', 'CO', 'CL', 'PE'], LATINO: ['MX', 'AR', 'CO', 'CL', 'PE'],
  SWE: ['SE'], NOR: ['NO'], DEN: ['DK'], DNK: ['DK'], FIN: ['FI'], POL: ['PL'], ROM: ['RO'], GRE: ['GR'], RUS: ['RU'], IND: ['IN'],
  PAK: ['PK'], AFR: ['ZA', 'NG', 'SN', 'CI', 'CM'], SUI: ['CH'], SWI: ['CH'], AUT: ['AT'], IRL: ['IE'], AUS: ['AU'], ISR: ['IL'], ALB: ['AL'], EXYU: ['RS', 'HR', 'BA', 'SI', 'MK', 'ME'],
};

const tokens = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/\+/g, ' plus ').match(/[\p{L}\p{N}]+/gu) || [];
const tidy = (w) => (w === 'sports' ? 'sport' : w === 'movies' ? 'movie' : w);

// "|FR| TF1 FHD" → { key: 'tf1', words: ['tf1'], cc: ['FR'] }
export function logoKey(name, { prefix = true } = {}) {
  let s = String(name || '').replace(/[#*◉●★☆▎│✦►▶]+/g, ' ').trim();
  let cc = [];
  if (prefix) {
    const m = s.match(/^[|[(]?\s*([A-Za-z]{2,6})\s*[|\])]?\s*[-:|]\s*(.+)$/) || s.match(/^[|[(]\s*([A-Za-z]{2,6})\s*[|\])]\s*(.+)$/);
    if (m && m[1] === m[1].toUpperCase()) { const c = m[1]; cc = HINTS[c] || (c.length === 2 ? [c] : []); s = m[2]; }
  }
  const all = tokens(s).map(tidy);
  const words = all.filter((w) => !JUNK.has(w));
  const use = words.length ? words : all;
  return { key: use.join(''), words: use, cc };
}
export const softKey = (words) => words.filter((w) => !SOFT.has(w)).join('');

let db = null; let loading = null;
export const logosReady = () => !!db;
export function loadLogos(url = 'logos-db.json') {
  loading ||= fetch(url).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.k && j.u) db = j; return !!db; }).catch(() => false);
  return loading;
}
export function useLogoDb(j) { db = j; }

function pick(entry, cc) {
  // entry: "CC12,CC40" — country code + number of the logo address
  const list = entry.split(',');
  const hit = (cc.length && list.find((e) => cc.includes(e.slice(0, 2)))) || list[0];
  const u = db.u[parseInt(hit.slice(2), 36)];
  if (!u) return '';
  const i = u.indexOf(':');
  return db.p[parseInt(u.slice(0, i), 36)] + u.slice(i + 1);
}

// Real logo address for a channel name, or '' when the channel is not known.
export function findLogo(name) {
  if (!db) return '';
  const { key, words, cc } = logoKey(name);
  if (!key) return '';
  const tries = [key, softKey(words)];
  // "Sky Sport F1 Event 2" → also try the shorter brand names
  for (let n = words.length - 1; n >= 1 && n >= words.length - 2; n--) tries.push(words.slice(0, n).join(''));
  for (let i = 0; i < tries.length; i++) {
    const k = tries[i];
    if (!k || (i > 0 && k.length < 4)) continue;
    const e = db.k[k];
    if (e) return pick(e, cc);
  }
  return '';
}
