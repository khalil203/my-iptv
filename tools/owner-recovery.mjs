// Resets the PRIMARY owner login of the live app. Run only by the "Owner recovery" workflow.
// Reads the new login from repository secrets; never prints the password.
import { readFileSync, writeFileSync } from 'node:fs';
import { hashPassword, uid } from '../public/core.js';

const username = String(process.env.NEW_USER || '').trim();
const password = String(process.env.NEW_PASS || '');
if (username.length < 3) { console.error('Secret OWNER_RECOVERY_USER is missing or shorter than 3 characters.'); process.exit(1); }
if (password.length < 8) { console.error('Secret OWNER_RECOVERY_PASSWORD is missing or shorter than 8 characters.'); process.exit(1); }

let old = null;
try { old = JSON.parse(readFileSync('/tmp/rec/admin.json', 'utf8')); } catch {}
const salt = uid(8);
const admin = { ...(old && typeof old === 'object' ? old : {}), username, salt, hash: await hashPassword(password, salt), isDefault: false };
delete admin.totp; // two-step sign-in is turned off so you can get back in; turn it on again after
writeFileSync('/tmp/rec/admin.new.json', JSON.stringify(admin));
console.log(`Primary owner login prepared (username length ${username.length}). Two-step sign-in cleared.`);
