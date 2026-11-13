// Builds public/logos-db.json — the channel-name → logo index used by public/logos.js.
// Source: the public iptv-org channel database (https://github.com/iptv-org/database).
// Run: node tools/build-logos.mjs
import { writeFileSync } from 'node:fs';
import { logoKey, softKey } from '../public/logos.js';

const SRC = 'https://raw.githubusercontent.com/iptv-org/database/master/data/';
const get = async (f) => { const r = await fetch(SRC + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.text(); };

function csv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const [channels, logos] = await Promise.all([get('channels.csv'), get('logos.csv')]).then((a) => a.map(csv));

// Best logo per channel: the channel's main logo, a normal image format, a sensible size.
const best = new Map();
const score = (l) => (l.feed ? 0 : 1000) + (l.in_use === 'TRUE' ? 500 : 0) + (/^(PNG|WEBP|JPEG|JPG)$/i.test(l.format) ? 200 : /^SVG$/i.test(l.format) ? 100 : 0)
  + Math.min(Number(l.width) || 0, 512) / 10 - (Number(l.width) > 1600 ? 50 : 0);
for (const l of logos) {
  l.url = l.url.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/(.+?)(\?raw=true)?$/, 'https://raw.githubusercontent.com/$1/$2');
  if (!/^https:\/\//.test(l.url)) continue;
  const s = score(l); const b = best.get(l.channel);
  if (!b || s > b.s) best.set(l.channel, { s, url: l.url });
}

const prefixes = []; const pIdx = new Map(); const urls = []; const uIdx = new Map();
function urlId(url) {
  if (uIdx.has(url)) return uIdx.get(url);
  const cut = url.lastIndexOf('/') + 1; const p = url.slice(0, cut);
  if (!pIdx.has(p)) { pIdx.set(p, prefixes.length); prefixes.push(p); }
  urls.push(pIdx.get(p).toString(36) + ':' + url.slice(cut));
  uIdx.set(url, urls.length - 1);
  return urls.length - 1;
}

const keys = new Map(); const soft = new Map();
const add = (map, key, cc, id) => {
  if (!key || key.length < 2) return;
  const list = map.get(key) || []; const e = cc + id.toString(36);
  if (!list.includes(e) && list.length < 12) list.push(e);
  map.set(key, list);
};
// Channels still on air first, so they win when a name is shared.
channels.sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0));
let used = 0;
for (const c of channels) {
  if (c.is_nsfw === 'TRUE') continue;
  const logo = best.get(c.id); if (!logo) continue;
  const cc = (c.country || 'XX').slice(0, 2).toUpperCase().padEnd(2, 'X');
  const id = urlId(logo.url); used++;
  for (const n of [c.name, ...String(c.alt_names || '').split(';')]) {
    if (!n.trim()) continue;
    const k = logoKey(n, { prefix: false });
    add(keys, k.key, cc, id);
    const s = softKey(k.words);
    if (s !== k.key && s.length >= 4) add(soft, s, cc, id);
  }
}
// Names without "TV"/"Channel" only fill gaps; they never replace an exact name.
for (const [k, v] of soft) if (!keys.has(k)) keys.set(k, v);

const out = { v: 1, built: new Date().toISOString().slice(0, 10), p: prefixes, u: urls, k: Object.fromEntries([...keys].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, v.join(',')])) };
const file = new URL('../public/logos-db.json', import.meta.url);
writeFileSync(file, JSON.stringify(out));
console.log(`logos-db.json: ${used} channels with a logo, ${keys.size} names, ${urls.length} logo addresses, ${(JSON.stringify(out).length / 1048576).toFixed(2)} MB`);
