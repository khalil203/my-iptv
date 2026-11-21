import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY_BY_TAB,
  categoryOf,
  categoryClass,
  refreshControlHtml,
  refreshMetaHtml,
  importantNoticeHtml,
  noticeEditorHtml,
  markRefreshBusy,
  esc,
} from '../public/ui-controls.js';

const EXPECTED = {
  overview: 'system',
  sales: 'sales',
  finance: 'finance',
  customers: 'customers',
  resellers: 'resellers',
  team: 'agents',
  agents: 'agents',
  promos: 'promos',
  domains: 'account',
  stripe: 'finance',
  settings: 'account',
  guide: 'system',
  chat: 'customers',
};

const CATEGORIES = new Set([
  'sales', 'finance', 'customers', 'resellers', 'agents', 'promos', 'account', 'system',
]);

test('every admin tab maps to the expected semantic category', () => {
  assert.deepEqual({ ...CATEGORY_BY_TAB }, EXPECTED);
  for (const [tab, category] of Object.entries(EXPECTED)) {
    assert.equal(categoryOf(tab), category, `categoryOf(${tab})`);
    assert.ok(CATEGORIES.has(categoryOf(tab)), `${tab}: unknown category`);
  }
  assert.equal(categoryOf('not-a-tab'), 'system');
  assert.equal(categoryOf('__proto__'), 'system');
});

test('categoryClass returns the CSS helper class', () => {
  assert.equal(categoryClass('finance'), 'cat-finance');
  assert.equal(categoryClass('team'), 'cat-agents');
  assert.match(categoryClass('unknown'), /^cat-[a-z]+$/);
});

test('refreshControlHtml has the action hook and escapes its label', () => {
  const html = refreshControlHtml();
  assert.match(html, /class="btn sm refresh-btn"/);
  assert.match(html, /data-act="panel-refresh"/);
  assert.match(html, /aria-label="Refresh"/);
  assert.match(html, /rf-spin/);

  const escaped = refreshControlHtml('<img src=x onerror="bad()">');
  assert.doesNotMatch(escaped, /<img/);
  assert.match(escaped, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;/);
  assert.match(escaped, /aria-label="&lt;img/);
});

test('refreshMetaHtml renders a local HH:MM:SS timestamp', () => {
  const html = refreshMetaHtml(new Date(2026, 0, 2, 3, 4, 5).getTime());
  assert.match(html, /data-refresh-meta/);
  assert.match(html, /Updated \d{2}:\d{2}:\d{2}/);
  assert.match(html, /Updated 03:04:05/);
  assert.match(refreshMetaHtml(), /Updated \d{2}:\d{2}:\d{2}/);
});

test('importantNoticeHtml escapes script text', () => {
  const html = importantNoticeHtml('<script>alert(1)</script>');
  assert.match(html, /class="notice warning important-notice"/);
  assert.match(html, /data-important-notice/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('noticeEditorHtml exposes textarea, preview and save/clear actions', () => {
  const html = noticeEditorHtml('Hello & welcome');
  assert.match(html, /<textarea name="notice"/);
  assert.match(html, /data-act="notice-save"/);
  assert.match(html, /data-act="notice-clear"/);
  assert.match(html, /data-notice-preview/);
  assert.match(html, /Hello &amp; welcome/);
});

test('markRefreshBusy toggles busy state and is safe with a null root', () => {
  assert.doesNotThrow(() => markRefreshBusy(null, true));
  assert.doesNotThrow(() => markRefreshBusy(undefined, false));

  const btn = {
    classList: { toggle(_name, on) { this.busy = on; } },
    setAttribute(name, value) { this[name] = value; },
    disabled: false,
  };
  const root = { matches: () => false, querySelectorAll: () => [btn] };
  markRefreshBusy(root, true);
  assert.equal(btn.disabled, true);
  assert.equal(btn['aria-busy'], 'true');
  markRefreshBusy(root, false);
  assert.equal(btn.disabled, false);
  assert.equal(btn['aria-busy'], 'false');
});

test('esc escapes all five HTML-sensitive characters', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(esc(undefined), '');
});
