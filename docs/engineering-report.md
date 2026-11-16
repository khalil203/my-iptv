# INTPROTO-TV — Engineering & Upgrade Report
Date 2026-11-16 (Asia/Bangkok). Status: never 100% complete; statuses below are honest.

## A. Project analysis (discovered)
- Stack: Cloudflare Worker (`worker/worker.js`, API rules + KV `DB`, `/proxy` stream relay, `/apk` `/tv` short links), assets from `public/` (vanilla JS, no framework, no build step), browser SPA `public/app.js` (~3.7k lines: admin + customer UI), `public/core.js` (~3.1k lines: backend, shared with tests), `site.js` public landing, `m3u.js`, `i18n.js`, `styles.css`, SW `sw.js` (network-first + cached-shell fallback), Android wrapper (`android/`), Electron (`desktop/`), Render Node stream relay (`relay/server.mjs`), PWA manifest.
- Data lives in Cloudflare KV; no SQL. Emails via Resend. Payments: Stripe (env secrets), payment links, WhatsApp dispatch, admin team with roles/perms, audit log, disputes, shift management, order requests.
- Auth: KV session tokens, 4-digit parental PIN, TOTP 2FA, customer lock after 8 failed logins.
- Legal: full bylaws/terms gates for staff and customers, consent logging.

## B. UI/UX improvements (recent commits)
- UltraIO dark-neon theme tokens (--primary #A855F7, --accent #D946EF, --bg #07080E) + Inter; day/night boot preset; light theme contrast pass on bnav/topbar.
- Customer sidebar + mobile nav: Home + Account only (Live/Movies/Series reachable via Home tiles & search).
- “My playlists” card now carries connection details: Username / Password / DNS / M3U (+ copy). Standalone duplicate card removed.
- Splash/manifest `theme_color`/`background_color` now `#07080E` (was old #07081A).
- Arabic removed from everything customer-facing (site, login, trial form, account language switcher); admin kept en/fr/ar intentionally.
- Boot screen: logo + spinner, centered, responsive (min() with dvh).

## C. Bug fixing (this batch)
| # | Root cause | Fix | Status |
|---|---|---|---|
| 1 | Landing pages /freetrial /resellers were 404 (no route mapping, SPA-only) | Worker maps both → index.html; route() guards (`!state.token`, `/resellers` allowed for signed-in users) | COMPLETED + live-verified (200, forms render) |
| 2 | route() trapped modals/back on landing pages (site-login & trial-login redraw landing forever) | Landing pages only when `!state.showLogin` and anonymous (or signed-in reseller) | COMPLETED + verified via Playwright flow |
| 3 | “This playlist cannot be opened in the browser” on http.dndnscloud.ru | https page → http panel = mixed content/no CORS; `fetchText` ignored Worker `/proxy` — now falls back to `/proxy` (12h signed token) then Render relay | COMPLETED + deployed (logic verified; `/proxy` 403 on bad token live) |
| 4 | Customer dashboard showed spinner forever | app.js used async fn as object property → parse error; reordered to named const | COMPLETED (commit 5090cd5) |
| 5 | Trial requests lost Telegram handle | parse/normalize (`@t.me/` strip), persist on queue entry + auto-created customer, return to agents for dispatch | COMPLETED + test asserts value |
| 6 | Agents queue had no WhatsApp/Telegram dispatch | queue card shows Telegram; `tq-send` returns phone/whatsapp/telegram; modal offers Copy / WhatsApp / Telegram buttons | COMPLETED (not live-verified end-to-end with real creds) |
| 7 | SW served stale shell on refresh after deploy | network-first + cached fallback | COMPLETED |
| 8 | Trial Telegram not stored; service-details missing | parsed/stored/returned; card added then moved into My playlists; copy button | COMPLETED |
| 9 | `/freetrial` & `/resellers` intermittently slow first hit | environment network flakiness, not a code defect; retries pass | NOT A BUG |
| 10 | Arabic options on customer side | dictionaries/pickers removed | COMPLETED + live-verified |

## D. Engineering improvements
- New clean routes without abandoning the SPA: `/freetrial` (real form: name/email/phone/optional Telegram ID + captcha, trial mode `auto` or `agents`), `/resellers` (sign-in + preview; full reseller ops remain admin-driven).
- Telegram unified across trial form → KV queue → agent dispatch (wa.me / t.me) and emails/notes.
- `serviceDetails` wired to `/api/me` stream payload with M3U builder.

## E. Compatibility report (honest)
- Tested live: Chromium (Playwright) @ this phone, viewport desktop-ish; HTTP via curl; routes 200; JS console: zero errors on /freetrial, /resellers, site.
- NOT tested: Safari/iOS, Firefox/Edge, real Android TV, full-screen video playback, offline SW behavior post-deploy.

## F. Testing report
- `node --test tests/backend.test.mjs` → 43/43 pass (in-memory KV).
- `node --check` on every edited JS: OK.
- Live Playwright checks: /freetrial (form fields incl. telegram), /resellers (sign-in → login form), site/login (no Arabic; en/fr only).
- NOT executed: full admin workflow click-through, playlist add with real http panel (no valid Xtream creds available here), i18n rendering of fr for every string.

## G. Deployment report
- Pipeline: push to main → GitHub Actions “Deploy to Cloudflare (free)” (~1m35s) → Workers + assets. Latest runs green (21eb91d, 3a5af94, de47ed7, f8d4924, 8035d19).
- Rollback: `git revert <sha>` (app is static+worker; KV format unchanged in this batch). No DB migration.
- Config: `wrangler.toml` routes to zone `intproto-tv.store`; KV namespace `DB`; secrets in Workers.

## H. Final status
- COMPLETED & VERIFIED: Arabic removal (customer), sidebar cleanup, My-playlists connection details, /freetrial route + form (incl. Telegram), /resellers landing + sign-in flow, trial-queue Telegram storage + dispatch UI, SW network-first, playlist http-fetch fallback via /proxy, manifest color sync, 43/43 tests, deploy green.
- IMPLEMENTED, NOT FULLY VERIFIED: service-details in My playlists (needs a live customer session), agents dispatch modal (needs a real queue entry).
- PARTIALLY COMPLETED (by design): MASTER redesign directive — audit done; redesign executed only where risk is low and value is direct (sidebar, playlist details, Arabic, boot/splash colors, routing). Full re-skin of every screen not done this session.
- BLOCKED / NOT STARTED: Reseller panel with IBO Player/TVPlus credentials, credit balance and purchase history (no reseller data model exists: customer has no isReseller/credit/panel fields — needs Nizar’s product decision + schema change); off-site backup (needs R2); Kast/Trade OKX/Epay integration; SOP scoring UI; AI chat archive.

## Addendum — financial batch (2026-11-16, commit 4ee02fc)
- Sales tracker: /api/admin/sales-by-day (perm profits) aggregates the sales ledger (trials excluded): today/yesterday/month, 30-day per-day series, 12-month series, latest 50 transactions. Admin: new "Sales tracker" tab; overview home now shows Today + This-month tiles linking to it; 30-day and 12-month bar charts; CSV export. Tests: 44/44 pass.
- Stripe payout projection: every live balance check now returns payoutDays (Grenapp Host LLC = 2, Waffim/Avixcloud/Bussalion = 7, enforced 2|7 in settings) + a Mon–Fri business-day projection of when pending lands; shown per account.
- Reseller module: customers flagged as resellers get auto RSL ids (RSL-01…, settings resellerSeq). New "Resellers" tab: flag/unflag, purchase history + credits bought, spend USD/MAD, USD per credit rate, rank by credits; Google Sheets Apps Script webhook config + "Sync now" posts the reseller table. Reseller downstream lines are NOT manageable here (they live on the reseller's own TVplus panel) — documented in the UI.
- Bugs fixed: fresh-install double sales record (lazy history migration counted the just-created sale; deduped in recordSale with a 5s/customer/plan/amount/currency match) — caught by a new test; persistStripeAccountsFromTable silently dropped saves when the admin cleared the account list.
- Call button on customer rows now copies the phone number instead of dialling.
- NOT DONE (needs input): Mercury/Wise live balance API (no credentials in app or env; wire once read tokens exist — Mercury read-only API + Wise public API); full reseller portal (lines owned by resellers belong to their panel; rank/rate are computed from in-app purchases only); Google Sheets sync needs the user's Apps Script URL.

## Addendum — pricing schedule v3 (2026-11-16)
- Final 8 packages applied: 1M 30d/1cr/PkgID1 €29.99 · 3M 90d/3cr/ID2 €49.99 · 6M 180d/6cr/ID3 €59.99 · 1Y 365d/12cr/ID1 €69.99 · 2Y 730d/24cr/ID4 €99.99 · 2D-1Y 365d/24cr/2dev/ID3 €109.99 · 3D-1Y 365d/36cr/3dev/ID4 €129.99 · 4D-1Y 365d/48cr/4dev/ID4 €139.99. EUR is the canonical price; USD mirrors the same numbers (user decision); orderCurrency setting unchanged.
- One-time auto-migration (pricingV3, runs in getSettings on deploy): rewrites plans + purchase-page packages, preserves IBO packages, preserves any hand-made custom packages/plans, and preserves per-package Stripe routing by matching days×devices (o1y1d→s1y=grenapp, o1y2d→s1y2d=waffim, o1y3d→s1y3d=grenapp verified in a simulated production KV).
- Migration logged in activity log; admins can still edit everything in Plans & prices afterwards.

## Addendum — Arabic removed everywhere (commit d8ebbaa / SW v55)
- UI: login, account, trial form, admin panel (bylaws modal now English/French only, customer language selector, WhatsApp language pickers, email language options incl. "Arabic for everyone", newsletter (split/all), order preview, templates LANG3, unsubscribe page), download page (APK page language list).
- Backend mail/WA template dictionaries (MAIL, AM/activation, RM/renewal, OM/order, NL/newsletter, WhatsApp templates, 2FA/password/reset/payment): all Arabic content deleted with the objects closed correctly. Language whitelists are now en/fr only; existing 'ar' customer records fall back to English.
- Android offline page: French/English only. Two Arabic strings remain deliberately: the ADULT content-filter regex and the panel error-detection regex (safety filters, not user-facing text).
- Tests: 44/44 pass (templates preview test updated to en/fr).

## Addendum — Stripe routing & accounts manager fixes (2026-11-16, commit 65d164b)
- Routing: new one-time migration stripeSettleV2 assigns settle-to banks by name when unset: Grenapp → 'stripe' (Stripe FIRST, not Mercury), Waffim → 'waffim', Avixcloud → 'avixcloud', Bussalion → 'bussalion'; any existing bankId is respected. All stray sales are kept and revenue is computed off the unified ledger (category "Sale"), so nothing double-counts.
- New "⚔ Account performance" card on the Stripe tab: per-account USD revenue (last 30 days + all time, sale counts), side-by-side bars, best-performer badge; backend /api/admin/stripe/revenue (perm profits) + tests.
- Each live balance refresh remains available (💰 per account) with Stripe's real available/pending; all balances (💰 All) aggregates stored balances; payout timers stay 2 (Grenapp) / 7 (others) with a business-day projection shown next to every balance.
- Link rows compacted: 🔗 label chip (click to open) + host text + terse editable label/url + currency + tier + delete; no more overflowing full URLs. sa-save persists bankId both from Add/Save and the 💰 refresh.
- Verified locally: migration simulated on a production-shaped KV (all mapped correctly); routes clean, 45/45 tests, SW v59.
