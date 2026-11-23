import test from 'node:test';
import assert from 'node:assert/strict';

const load = (tag) => import(`../public/i18n.js?engine=${tag}`);

test('detectLang and setLang are safe with no browser globals', async () => {
  const savedNav = globalThis.navigator;
  try {
    delete globalThis.navigator;
    const i18n = await load('no-dom');
    assert.equal(i18n.detectLang(), 'en');
    assert.equal(i18n.setLang('fr', true), true);
    assert.equal(i18n.getLang(), 'fr');
    assert.equal(i18n.t('signIn'), i18n.tIn('fr', 'signIn'));
    assert.equal(i18n.setLang('not-a-language'), true);
    assert.equal(i18n.getLang(), 'en');
  } finally {
    if (savedNav) globalThis.navigator = savedNav;
  }
});

test('resolveLang handles regions, case, underscores, legacy and unknown codes', async () => {
  const i18n = await load('resolve');
  assert.equal(i18n.getLang(), 'en');
  const cases = [
    ['en', 'en'], ['EN_us', 'en'], ['fr-CA', 'fr'], ['pt-BR', 'pt'],
    ['zh', 'zh-CN'], ['zh-TW', 'zh-CN'], ['zh-cn', 'zh-CN'],
    ['iw', 'he'], ['in', 'id'], ['ji', 'yi'], ['fil', 'tl'],
    ['nb-NO', 'no'], ['nn', 'no'], ['sw_KE', 'sw'], ['xx', 'en'], ['', 'en'],
  ];
  for (const [input, expected] of cases) {
    const copy = await load('resolve-' + input.replace(/[^a-z]/gi, '') + expected);
    assert.equal(copy.resolveLang(input), expected, input);
  }
  assert.equal(i18n.resolveLang('fr-CA'), 'fr');
  assert.equal(i18n.locale(), 'en-US');
  assert.equal(i18n.localeFor('en'), 'en-US');
  assert.equal(i18n.localeFor('zh-CN'), 'zh-CN');
});

test('registerLangPack validates, drops blanks, blocks prototype keys, merges', async () => {
  const i18n = await load('register');
  assert.equal(i18n.registerLangPack('th', null), false);
  assert.equal(i18n.registerLangPack('th', []), false);
  assert.equal(i18n.registerLangPack('th', {}), false);
  assert.equal(i18n.registerLangPack('th', { a: '', b: '   ', c: 1 }), false);
  assert.equal(i18n.registerLangPack('th', { ok: 'ใช่' }), true);
  const evil = JSON.parse('{"__proto__":"x","constructor":"y","prototype":"z","keep":"yes","blank":" "}');
  assert.equal(i18n.registerLangPack('th', evil), true);
  assert.equal(i18n.tIn('th', 'ok'), 'ใช่');
  assert.equal(i18n.tIn('th', 'keep'), 'yes');
  assert.equal(i18n.hasKey('__proto__', 'th'), false);
  assert.equal(i18n.hasKey('constructor', 'th'), false);
  assert.equal(i18n.hasKey('prototype', 'th'), false);
  assert.equal(i18n.hasKey('blank', 'th'), false);
  assert.equal(i18n.hasKey('keep', 'th'), true);
});

test('placeholders are preserved when vars are missing and filled when present', async () => {
  const i18n = await load('vars');
  assert.equal(i18n.t('daysN'), '{n} days');
  assert.equal(i18n.t('daysN', {}), '{n} days');
  assert.equal(i18n.t('daysN', { n: 0 }), '0 days');
  assert.equal(i18n.t('daysN', { n: 3 }), '3 days');
  i18n.setLang('fr', true);
  assert.match(i18n.t('hello', { name: 'Sam' }), /Sam/);
  assert.equal(i18n.t('unknown_key_zz'), 'unknown_key_zz');
});

test('French inline dictionary and fallback lookup work', async () => {
  const i18n = await load('fr');
  i18n.setLang('fr', true);
  assert.notEqual(i18n.t('signIn'), i18n.tIn('en', 'signIn'));
  assert.equal(i18n.t('nope_zz'), i18n.tIn('en', 'nope_zz'));
  i18n.registerLangPack('pt', { signIn: 'Entrar' });
  assert.equal(i18n.tIn('pt-BR', 'signIn'), 'Entrar');
  assert.equal(i18n.tIn('pt', 'signIn'), 'Entrar');
});

test('plurals use Intl.PluralRules, fall back to _other, then base key', async () => {
  const i18n = await load('plural');
  i18n.registerLangPack('de', {
    __testThing_one: 'ein Ding', __testThing_other: '{n} Dinge', __testThing: 'Ding',
    __testOnly_one: 'nur eins', __testOnly: 'nur',
  });
  i18n.setLang('de', true);
  assert.equal(i18n.tn('__testThing', 1), 'ein Ding');
  assert.equal(i18n.tn('__testThing', 2), '2 Dinge');
  assert.equal(i18n.tn('__testOnly', 2), 'nur');
  const ru = {};
  for (let i = 0; i < 101; i++) ru['__fill' + i] = 'x';
  Object.assign(ru, {
    __testThing_one: 'one', __testThing_few: 'few', __testThing_many: 'many',
    __testThing_other: 'other', __testThing: 'base',
  });
  i18n.registerLangPack('ru', ru);
  i18n.setLang('ru', true);
  assert.equal(i18n.tn('__testThing', 1), 'one');
  assert.equal(i18n.tn('__testThing', 2), 'few');
  assert.equal(i18n.tn('__testThing', 5), 'many');
  assert.equal(i18n.tn('__testThing', 1.5), 'other');
});

test('tErr reverse-maps exact and templated English server errors', async () => {
  const i18n = await load('errors');
  i18n.setLang('fr', true);
  assert.match(i18n.tErr('Wrong username or password.'), /incorrect/i);
  const out = i18n.tErr('The TV server did not accept this request (code 500). Please try again in a moment.');
  assert.match(out, /500/);
  assert.match(out, /serveur TV/i);
  assert.equal(i18n.tErr('something never translated'), 'something never translated');
  assert.equal(i18n.tErr(''), '');
});

test('Intl helpers follow the active language and stay valid', async () => {
  const i18n = await load('intl');
  i18n.setLang('fr', true);
  assert.equal(i18n.locale(), 'fr-FR');
  assert.equal(i18n.formatNumber(1234.5), new Intl.NumberFormat('fr-FR').format(1234.5));
  assert.equal(i18n.formatDate('2026-11-23'), new Intl.DateTimeFormat('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date('2026-11-23T00:00:00Z')));
  assert.match(i18n.formatTime('2026-11-23T15:30:00Z', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }), /^15:30$/);
  assert.match(i18n.formatCurrency(12.5, 'EUR'), /€/);
  assert.match(i18n.formatList(['a', 'b']), / et /);
  assert.ok(i18n.formatRelative(-2, 'day').length > 0);
  assert.equal(i18n.dir(), 'ltr');
});

test('setLang updates document, saves once and emits only on change', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.document = { baseURI: 'https://example.test/app/', documentElement: { lang: '', dir: '' } };
  globalThis.window = new EventTarget();
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const code = new URL(String(url)).pathname.split('/').pop().replace(/\.json$/, '');
    return { ok: true, json: async () => ({ code, strings: { signIn: 'Fetched ' + code } }) };
  };
  try {
    const i18n = await load('ui');
    const events = [];
    globalThis.window.addEventListener('langchange', (e) => events.push(e.detail.code));
    assert.equal(i18n.setLang('fa', true), true);
    assert.equal(globalThis.document.documentElement.dir, 'rtl');
    assert.equal(globalThis.document.documentElement.lang, 'fa');
    assert.equal(store.get('tvp_lang'), 'fa');
    assert.equal(events.join(','), 'fa');
    assert.equal(i18n.setLang('fa', true), false);
    assert.equal(events.join(','), 'fa');
    i18n.setLang('iw', true);
    assert.equal(globalThis.document.documentElement.dir, 'rtl');
    assert.equal(globalThis.document.documentElement.lang, 'he');
    i18n.setLang('en-GB', true);
    assert.equal(globalThis.document.documentElement.dir, 'ltr');
    assert.equal(globalThis.document.documentElement.lang, 'en');
    assert.equal(store.get('tvp_lang'), 'en');
    assert.ok(requested.some((u) => /langs\/fa\.json\?v=127$/.test(u)), requested.join(' '));
  } finally {
    delete globalThis.fetch;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.localStorage;
  }
});

test('ensureLang dedupes concurrent loads and sends a cache-busted URL', async () => {
  globalThis.document = { baseURI: 'https://example.test/app/' };
  let calls = 0;
  let last = '';
  globalThis.fetch = async (url) => {
    calls++;
    last = String(url);
    await new Promise((res) => setTimeout(res, 15));
    const code = new URL(String(url)).pathname.split('/').pop().replace(/\.json$/, '');
    return { ok: true, json: async () => ({ code, strings: { signIn: 'Fetched ' + code } }) };
  };
  try {
    const i18n = await load('dedupe');
    const [a, b] = await Promise.all([i18n.ensureLang('vi'), i18n.ensureLang('vi')]);
    assert.equal(a, true);
    assert.equal(b, true);
    assert.equal(calls, 1);
    assert.match(last, /langs\/vi\.json\?v=127$/);
    assert.equal(i18n.tIn('vi', 'signIn'), 'Fetched vi');
    assert.equal(i18n.packError(), null);
    assert.equal(await i18n.ensureLang('vi'), true);
    assert.equal(calls, 1);
  } finally {
    delete globalThis.fetch;
    delete globalThis.document;
  }
});

test('ensureLang retries once, then reports a stable error', async () => {
  globalThis.document = { baseURI: 'https://example.test/app/' };
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
    const code = new URL(String(url)).pathname.split('/').pop().replace(/\.json$/, '');
    return { ok: true, json: async () => ({ code, strings: { signIn: 'Masuk' } }) };
  };
  try {
    const i18n = await load('retry');
    assert.equal(await i18n.ensureLang('id'), true);
    assert.equal(calls, 2);
    assert.equal(i18n.tIn('id', 'signIn'), 'Masuk');
  } finally {
    delete globalThis.fetch;
    delete globalThis.document;
  }
});

test('malformed or mismatched packs are rejected without breaking English', async () => {
  globalThis.document = { baseURI: 'https://example.test/app/' };
  globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ code: 'fr', strings: { signIn: 'wrong' } }) });
  try {
    const i18n = await load('badpack');
    assert.equal(await i18n.ensureLang('ms'), false);
    assert.ok(i18n.packError() instanceof Error);
    i18n.setLang('ms', true);
    assert.equal(i18n.getLang(), 'ms');
    assert.equal(i18n.t('signIn'), 'Sign in');
    assert.equal(i18n.tIn('en', 'signIn'), 'Sign in');
  } finally {
    delete globalThis.fetch;
    delete globalThis.document;
  }
});
