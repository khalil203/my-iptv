export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export const CATEGORY_BY_TAB = Object.freeze({
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
});

const DEFAULT_CATEGORY = 'system';

export function categoryOf(tab) {
  const key = String(tab ?? '');
  return Object.hasOwn(CATEGORY_BY_TAB, key) ? CATEGORY_BY_TAB[key] : DEFAULT_CATEGORY;
}

export function categoryClass(tab) {
  return `cat-${categoryOf(tab)}`;
}

const ACT = '[data-act="panel-refresh"]';

export function refreshControlHtml(label = 'Refresh') {
  const text = esc(label);
  return `<button type="button" class="btn sm refresh-btn" data-act="panel-refresh" aria-label="${text}" title="${text}">`
    + '<span class="rf-ico" aria-hidden="true">&#8635;</span>'
    + '<span class="rf-spin" aria-hidden="true"></span>'
    + `<span class="rf-label">${text}</span></button>`;
}

export function refreshMetaHtml(ts = Date.now()) {
  const numeric = Number(ts);
  const d = new Date(Number.isFinite(numeric) ? numeric : Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `<span class="refresh-meta" data-refresh-meta data-ts="${d.getTime()}">Updated ${clock}</span>`;
}

export function importantNoticeHtml(text) {
  return '<div class="notice warning important-notice" data-important-notice role="note">'
    + '<span class="notice-ic" aria-hidden="true">!</span>'
    + `<span class="notice-txt">${esc(text)}</span></div>`;
}

export function noticeEditorHtml(current = '') {
  const value = esc(current);
  const preview = value || '<span class="muted small">Nothing to preview yet.</span>';
  return '<div class="notice-edit" data-notice-editor>'
    + '<label class="field"><span>Important notice</span>'
    + `<textarea name="notice" rows="5" placeholder="Text shown on screen…">${value}</textarea></label>`
    + '<div class="notice-edit-preview"><span class="small muted">Live preview</span>'
    + `<div class="notice warning important-notice" data-notice-preview>${preview}</div></div>`
    + '<div class="row notice-edit-actions">'
    + '<button type="button" class="btn primary" data-act="notice-save">Save notice</button>'
    + '<button type="button" class="btn danger" data-act="notice-clear">Clear notice</button>'
    + '</div></div>';
}

export function markRefreshBusy(root, busy = true) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const buttons = [];
  if (typeof root.matches === 'function' && root.matches(ACT)) buttons.push(root);
  buttons.push(...Array.from(root.querySelectorAll(ACT)));
  const isBusy = Boolean(busy);
  for (const btn of buttons) {
    btn.classList.toggle('busy', isBusy);
    btn.setAttribute('aria-busy', String(isBusy));
    if ('disabled' in btn) btn.disabled = isBusy;
  }
}
