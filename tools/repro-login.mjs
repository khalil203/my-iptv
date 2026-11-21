import { readFileSync } from 'node:fs';
import { createBackend } from '../public/core.js';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

function storeFrom(obj) {
  const db = new Map();
  for (const [k,v] of Object.entries(obj)) db.set(k, { v: JSON.stringify(v), e: 0 });
  return { get: async (k) => { const v = db.get(k); if (!v) return null; return JSON.parse(v.v); }, put: async (k,v,ttl) => { db.set(k, { v: JSON.stringify(v), e: ttl ? Date.now()+ttl*1000 : 0 }); }, del: async (k) => { db.delete(k); } };
}
const settings = JSON.parse(readFileSync('/tmp/diag/settings.json','utf8'));
const customers = JSON.parse(readFileSync('/tmp/diag/customers.json','utf8'));
let admin = null; try { admin = JSON.parse(readFileSync('/tmp/diag/admin.json','utf8')); } catch {}
let team = null; try { team = JSON.parse(readFileSync('/tmp/diag/team.json','utf8')); } catch {}
const data = { settings, customers };
if (admin !== null) data.admin = admin;
if (team !== null) data.team = team;
const store = storeFrom(data);
const be = createBackend({ store, fetchFn: async () => ({ ok:true, status:200, json: async()=>({}), text: async()=>'{}' }), mode: 'server' });
const call = (m,p,b,t) => be.handle({ method:m, path:p, body:b||{}, token:t, query:{} });
try {
  const r = await call('POST','/api/login',{ username:'Iptv', password:'Iptv' });
  console.log('LOGIN RESULT:', JSON.stringify(r));
} catch (e) {
  console.log('LOGIN THREW:', e && e.stack ? e.stack : e);
}
console.log('ADMIN:', JSON.stringify(await store.get('admin')));
