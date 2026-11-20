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
