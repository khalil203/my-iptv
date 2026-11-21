import test from 'node:test';
import assert from 'node:assert/strict';

test('i18n module loads with all six language dictionaries', async () => {
  const m = await import('../public/i18n.js');
  for (const code of ['en', 'fr', 'de', 'es', 'it', 'ar']) {
    assert.ok(m.tIn(code, 'noLangMatch'), `${code}: noLangMatch missing`);
    assert.ok(m.tIn(code, 'chooseLang'), `${code}: chooseLang missing`);
    assert.ok(m.tIn(code, 'savedDevice'), `${code}: savedDevice missing`);
  }
  assert.equal(m.tIn('en', 'searchLang'), 'Search a language…');
  assert.match(m.tIn('fr', 'savedDevice'), /identifiant/);
  assert.match(m.tIn('ar', 'noLangMatch'), /لغة/);
});

test('generated language packs cover every selectable language', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const m = await import('../public/i18n.js');
  const { APP_LANGS } = await import('../public/lang-data.js');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'langs');
  const inline = new Set(['en', 'fr', 'de', 'es', 'it', 'ar']);
  for (const l of APP_LANGS) {
    if (inline.has(l.code)) continue;
    const file = path.join(dir, l.code + '.json');
    assert.ok(fs.existsSync(file), `${l.code}: language pack missing`);
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(pack.code, l.code);
    assert.ok(Object.keys(pack.strings).length >= 650, `${l.code}: incomplete pack`);
    m.registerLangPack(l.code, pack.strings);
    assert.ok(m.tIn(l.code, 'signIn'), `${l.code}: signIn missing`);
    const msg = m.tIn(l.code, 'waMsg', { app: 'App', u: 'user' });
    assert.ok(!/\{(app|u)\}/.test(msg), `${l.code}: placeholders not substituted`);
  }
});

test('public website packs exist for every non-inline language', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { APP_LANGS } = await import('../public/lang-data.js');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'langs');
  const inline = new Set(['en', 'fr', 'de', 'es', 'it']);
  for (const l of APP_LANGS) {
    if (inline.has(l.code)) continue;
    const file = path.join(dir, `site-${l.code}.json`);
    assert.ok(fs.existsSync(file), `${l.code}: site pack missing`);
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(pack.code, l.code);
    assert.ok(pack.strings && pack.strings.h1 && Array.isArray(pack.strings.nav), `${l.code}: incomplete site pack`);
  }
});
