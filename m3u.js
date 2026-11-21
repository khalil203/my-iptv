// m3u.js — reads an M3U / M3U8 playlist into a simple list of channels.
// Tolerates messy files: missing header, extra blank lines, unknown tags, names with commas.
const VOD = /\.(mp4|mkv|avi|mov|m4v|wmv|flv)(\?|$)/i;

export function parseM3U(text, max = 20000) {
  const out = []; let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      const attr = (k) => (line.match(new RegExp(k + '="([^"]*)"', 'i')) || [])[1] || '';
      // the name is everything after the comma that follows the attributes (names may contain commas)
      const bare = line.replace(/"[^"]*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"');
      const cut = bare.indexOf(',');
      const name = (cut >= 0 ? line.slice(cut + 1) : '').trim();
      cur = { name: name || attr('tvg-name'), logo: attr('tvg-logo'), group: attr('group-title'), tid: attr('tvg-id') };
    } else if (/^#EXTGRP:/i.test(line)) {
      if (cur && !cur.group) cur.group = line.slice(8).trim();
    } else if (line[0] !== '#') {
      if (/^(https?|rtmp|rtsp|udp|rtp|mms):\/\//i.test(line)) {
        const c = cur || { name: '', logo: '', group: '', tid: '' };
        const name = c.name || decodeURIComponent(line.split('?')[0].split('/').pop() || 'Channel').replace(/\.\w{2,4}$/, '');
        out.push({ name, logo: /^https?:/i.test(c.logo) ? c.logo : '', group: c.group || '', tid: c.tid || '', url: line, vod: VOD.test(line) || /\/(movie|series)\//i.test(line) });
        if (out.length >= max) break;
      }
      cur = null;
    }
  }
  return out;
}

// Answers the same questions the app asks an Xtream server, from a parsed playlist.
export function m3uAnswer(items, action, params = {}) {
  const pick = (vod) => items.map((it, i) => ({ it, i })).filter((x) => !!x.it.vod === vod);
  const cats = (vod) => [...new Set(pick(vod).map((x) => x.it.group || '—'))].map((g) => ({ category_id: g, category_name: g }));
  const list = (vod) => pick(vod).filter((x) => params.category_id === undefined || params.category_id === '' || (x.it.group || '—') === params.category_id)
    .map((x) => ({ stream_id: x.i, name: x.it.name, stream_icon: x.it.logo, category_id: x.it.group || '—', epg_channel_id: x.it.tid, container_extension: (x.it.url.split('?')[0].match(/\.(\w{2,4})$/) || [])[1] || 'mp4' }));
  if (action === 'get_live_categories') return cats(false);
  if (action === 'get_live_streams') return list(false);
  if (action === 'get_vod_categories') return cats(true);
  if (action === 'get_vod_streams') return list(true);
  if (action === 'get_series_categories' || action === 'get_series') return [];
  if (action === 'get_vod_info') return { info: {} };
  return {};
}
