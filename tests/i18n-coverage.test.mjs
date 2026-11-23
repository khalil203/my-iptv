import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_LANGS, RTL_LANGS, localeOf, dirOf, appLang, langSearchText } from '../public/lang-data.js';
import { LANGS, dictKeys, tIn, missingKeys, PACK_VERSION } from '../public/i18n.js';
import { siteStrings } from '../public/site.js';

const root = new URL('../public/', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const INLINE_APP = ['en', 'fr', 'de', 'es', 'it', 'ar'];
const INLINE_SITE = ['en', 'fr', 'es', 'de', 'it'];
const placeholders = (value) => {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\{(\w+)\}/g)) out.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(value);
  return [...out].sort().join(',');
};
const emptyStrings = (value, key = '') => {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === 'string' && !v.trim()) out.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + '[' + i + ']'));
  };
  walk(value, key);
  return out;
};

test('language catalogue is complete, unique and Intl-safe', () => {
  assert.ok(APP_LANGS.length >= 35);
  assert.equal(LANGS.length, APP_LANGS.length);
  const codes = APP_LANGS.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(LANGS.map(([code]) => code), codes);
  for (const l of APP_LANGS) {
    assert.match(l.code, /^[a-z]{2}(-[A-Z]{2})?$/);
    for (const field of ['native', 'english', 'flag']) assert.ok(l[field] && typeof l[field] === 'string', l.code + ' ' + field);
    assert.equal(l.rtl, RTL_LANGS.has(l.code), l.code);
    assert.equal(dirOf(l.code), l.rtl ? 'rtl' : 'ltr', l.code);
    assert.doesNotThrow(() => new Intl.NumberFormat(localeOf(l.code)), l.code);
    assert.ok(langSearchText(l).includes(l.code.toLowerCase()), l.code);
  }
  for (const code of ['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']) assert.equal(dirOf(code), 'rtl', code);
  for (const code of ['en', 'fr', 'de', 'es', 'it', 'pt', 'zh-CN']) assert.equal(dirOf(code), 'ltr', code);
  assert.equal(appLang('zz').code, 'en');
  assert.equal(dirOf('ar-EG'), 'rtl');
});

test('the six hand-curated dictionaries are complete', () => {
  const en = dictKeys('en');
  assert.equal(en.length, 700);
  for (const code of INLINE_APP) {
    assert.equal(dictKeys(code).length, en.length, code);
    assert.deepEqual(missingKeys(code), [], code);
    assert.ok(tIn(code, 'signIn').trim(), code);
    assert.ok(tIn(code, 'skipToContent').trim(), code);
  }
});

test('every generated app pack is complete, non-empty and placeholder-safe', () => {
  const en = dictKeys('en');
  const problems = [];
  for (const { code } of APP_LANGS) {
    if (INLINE_APP.includes(code)) continue;
    let j;
    try { j = readJson(`langs/${code}.json`); } catch (err) { problems.push(`${code}: unreadable (${err.message})`); continue; }
    if (j.code !== code) problems.push(`${code}: pack says ${j.code}`);
    const s = j.strings || {};
    const keys = Object.keys(s);
    const extra = keys.filter((k) => !en.includes(k));
    const missing = en.filter((k) => !(k in s));
    if (extra.length) problems.push(`${code}: unknown keys ${extra.slice(0, 5).join(',')}`);
    if (missing.length) problems.push(`${code}: missing ${missing.slice(0, 5).join(',')} (${missing.length})`);
    const empty = emptyStrings(s);
    if (empty.length) problems.push(`${code}: empty ${empty.slice(0, 5).join(',')}`);
    for (const key of en) {
      if (!(key in s)) continue;
      const a = placeholders(tIn('en', key));
      const b = placeholders(s[key]);
      if (a !== b) problems.push(`${code}.${key}: placeholders ${a} -> ${b}`);
      if (/КЗПХ|ZPH0QZ/.test(String(s[key]))) problems.push(`${code}.${key}: corrupted placeholder token`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every site-language pack matches the English content and placeholders', () => {
  const en = siteStrings('en');
  const enKeys = Object.keys(en);
  const problems = [];
  for (const { code } of APP_LANGS) {
    if (INLINE_SITE.includes(code)) {
      const inline = siteStrings(code);
      for (const key of enKeys) {
        if (!(key in inline)) problems.push(`${code}: inline missing ${key}`);
        else if (placeholders(inline[key]) !== placeholders(en[key])) problems.push(`${code}.${key}: inline placeholders`);
      }
      continue;
    }
    let j;
    try { j = readJson(`langs/site-${code}.json`); } catch (err) { problems.push(`${code}: site pack unreadable (${err.message})`); continue; }
    if (j.code !== code) problems.push(`${code}: site pack says ${j.code}`);
    const s = j.strings || {};
    const extra = Object.keys(s).filter((k) => !(k in en));
    if (extra.length) problems.push(`${code}: site unknown ${extra.join(',')}`);
    for (const key of enKeys) {
      if (!(key in s)) { problems.push(`${code}: site missing ${key}`); continue; }
      if (Array.isArray(en[key]) !== Array.isArray(s[key])) { problems.push(`${code}.${key}: type`); continue; }
      if (Array.isArray(en[key]) && en[key].length !== s[key].length) problems.push(`${code}.${key}: array length`);
      const empty = emptyStrings(s[key]);
      if (empty.length) problems.push(`${code}.${key}: empty`);
      if (placeholders(en[key]) !== placeholders(s[key])) problems.push(`${code}.${key}: placeholders ${placeholders(en[key])} -> ${placeholders(s[key])}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every t()/tIn() key in the UI exists in English', () => {
  const source = read('app.js');
  const en = new Set(dictKeys('en'));
  const used = new Map();
  const note = (key) => { if (key) used.set(key, (used.get(key) || 0) + 1); };
  for (const m of source.matchAll(/\b(?:t|tc|tn)\(\s*'([^'\\]+)'/g)) note(m[1]);
  for (const m of source.matchAll(/\btIn\(\s*[^,]+,\s*'([^'\\]+)'/g)) note(m[1]);
  const dynamic = new Set(['st_', 'sup_cat_', 'rc_']);
  const missing = [...used.keys()].filter((k) => !en.has(k) && !dynamic.has(k));
  assert.deepEqual(missing, []);
});

test('cache versions agree and the language is applied before first paint', () => {
  const app = read('app.js');
  const lang = read('lang.js');
  const index = read('index.html');
  const versions = new Set([...app.matchAll(/i18n\.js\?v=(\d+)/g)].map((m) => m[1]));
  versions.add(...[...lang.matchAll(/i18n\.js\?v=(\d+)/g)].map((m) => m[1]));
  assert.deepEqual([...versions], [PACK_VERSION]);
  assert.match(index, /localStorage\.getItem\("tvp_lang"\)/);
  assert.match(index, /documentElement\.dir/);
  assert.match(index, /family=Cairo/);
});
