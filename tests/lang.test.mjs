import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_LANGS, LANGS, RTL_LANGS, TR_LANGS, dirOf, isRtl, flagOf, nameOf,
  buildReadUrl, shield, unshield, shouldSkipText, splitLong, batchTexts,
  translateEndpoint, parseTranslateResponse, glossaryOf, DEFAULT_GLOSSARY,
  panelTarget, PANEL_SKIP_SELECTOR,
} from '../public/lang-data.js';

test('app languages are the six languages the customer UI supports', () => {
  assert.deepEqual(LANGS.map((x) => x[0]), ['en', 'fr', 'de', 'es', 'it', 'ar']);
  assert.equal(APP_LANGS.length, 6);
  assert.equal(nameOf('ar'), 'العربية');
  assert.equal(flagOf('fr'), '🇫🇷');
  assert.equal(nameOf('xx'), 'English');
});

test('translator offers many targets without duplicates', () => {
  assert.ok(TR_LANGS.length >= 35);
  const codes = TR_LANGS.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const l of TR_LANGS) {
    assert.match(l.code, /^[a-z]{2}(-[A-Z]{2})?$/);
    assert.ok(l.native && l.english && l.flag);
  }
});

test('right-to-left detection', () => {
  for (const c of ['ar', 'fa', 'he', 'ur']) assert.equal(dirOf(c), 'rtl', c);
  for (const c of ['en', 'fr', 'zh-CN']) assert.equal(dirOf(c), 'ltr', c);
  assert.equal(isRtl('ar'), true);
  assert.equal(isRtl('de'), false);
  assert.ok(RTL_LANGS.has('ar'));
});

test('a web page is read through the translate proxy, keeping the path', () => {
  const u = buildReadUrl('https://www.example.com/news?p=2#top', 'ar');
  const url = new URL(u);
  assert.equal(url.hostname, 'www-example-com.translate.goog');
  assert.equal(url.pathname, '/news');
  assert.equal(url.searchParams.get('p'), '2');
  assert.equal(url.searchParams.get('_x_tr_tl'), 'ar');
  assert.equal(url.hash, '#top');
  assert.throws(() => buildReadUrl('javascript:alert(1)', 'ar'), /Only http/);
  assert.throws(() => buildReadUrl('not a link', 'ar'), /full link/);
});

test('brands, links, e-mails and template variables are shielded and restored', () => {
  const src = 'Hello {name}, write to support@example.com or open https://a.b/c?x=1 — INTPROTO-TV is here.';
  const { text, tokens } = shield(src, DEFAULT_GLOSSARY);
  assert.ok(!text.includes('support@example.com'));
  assert.ok(!text.includes('https://a.b/c?x=1'));
  assert.ok(!text.includes('{name}'));
  assert.match(text, /\{\{0\}\}/);
  assert.equal(unshield(text, tokens), src);
});

test('the glossary can translate a term instead of keeping it', () => {
  const { text, tokens } = shield('Open the dashboard now', [{ from: 'dashboard', to: 'لوحة التحكم' }]);
  assert.ok(!/dashboard/.test(text));
  assert.equal(unshield(text, tokens), 'Open the لوحة التحكم now');
});

test('unshield tolerates spaces the engine may add inside tokens', () => {
  assert.equal(unshield('Hi {{ 0 }} and {{1}}', ['A', 'B']), 'Hi A and B');
  assert.equal(unshield('keep {{9}}', ['A']), 'keep {{9}}');
});

test('data, links, numbers and identifiers are never sent', () => {
  for (const s of ['', ' ', 'a', 'https://x.y', 'WWW.example.com', 'a@b.co', '@username', '#tag',
    '123', '$12.50', '2026-03-01', '12:30', '192.168.1.7', 'AA:BB:CC:DD:EE:FF', 'ABCDEFGHJK', '···']) {
    assert.equal(shouldSkipText(s), true, JSON.stringify(s));
  }
  for (const s of ['Sign in', 'Expires today', '3 days left', 'Copy customer details', 'اللغة', '日本語']) {
    assert.equal(shouldSkipText(s), false, JSON.stringify(s));
  }
});

test('long text is split at readable boundaries and can be joined again', () => {
  const sentence = 'This is a sentence that repeats. ';
  const src = sentence.repeat(200);
  const parts = splitLong(src, 500);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(''), src);
  assert.ok(parts.every((p) => p.length <= 500));
  assert.deepEqual(splitLong('short'), ['short']);
});

test('batching removes duplicates and respects limits', () => {
  const list = ['one', 'two', 'one', 'three', 'four'];
  const batches = batchTexts(list, 2, 100);
  assert.deepEqual(batches, [['one', 'two'], ['three', 'four']]);
  assert.deepEqual(batchTexts(['a', 'a']), [['a']]);
  assert.deepEqual(batchTexts([]), []);
  const big = batchTexts(Array.from({ length: 60 }, (_, i) => 'text ' + i), 24);
  assert.equal(big.length, 3);
  assert.ok(big.every((b) => b.length <= 24));
});

test('the request URL encodes every q parameter', () => {
  const u = translateEndpoint('ar', ['Hello world', 'a&b=c']);
  assert.match(u, /^https:\/\/clients5\.google\.com\/translate_a\/t\?/);
  assert.match(u, /tl=ar/);
  assert.match(u, /q=Hello%20world/);
  assert.match(u, /q=a%26b%3Dc/);
});

test('responses from both endpoint shapes are parsed', () => {
  assert.deepEqual(parseTranslateResponse([['مرحبا', 'en'], ['شكرا', 'en']]), ['مرحبا', 'شكرا']);
  assert.deepEqual(parseTranslateResponse([['مرحبا', 'en']]), ['مرحبا']);
  assert.deepEqual(parseTranslateResponse([['a', 'b'], 3]), ['a', '3']);
  assert.equal(parseTranslateResponse('nope'), null);
});

test('glossary JSON is validated and trimmed', () => {
  assert.deepEqual(glossaryOf('[{"from":" TV ","to":"تلفزيون"},{"from":""}]'), [{ from: 'TV', to: 'تلفزيون' }]);
  assert.deepEqual(glossaryOf('not json'), []);
  assert.deepEqual(glossaryOf('{"a":1}'), []);
  assert.deepEqual(glossaryOf(''), []);
  assert.equal(glossaryOf(JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ from: 't' + i, to: 'x' })))).length, 200);
});

test('unknown targets fall back to English, and the skip list covers data viewers', () => {
  assert.equal(panelTarget('ar'), 'ar');
  assert.equal(panelTarget('klingon'), 'en');
  for (const sel of ['.tbl td', '.msg-t', '.cred-v', '[data-no-tr]', 'input', 'textarea']) {
    assert.ok(PANEL_SKIP_SELECTOR.includes(sel), sel);
  }
});
