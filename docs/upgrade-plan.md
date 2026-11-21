# Upgrade plan — intproto-tv.store ecosystem

Source: owner specification (Team/RBAC, storefront, pricing, CRM, disputes, Stripe,
IBO Player, marketing/ads, attendance). This file tracks the phased delivery.

Canonical product scope: [Developer Brief](developer-brief.md) — v2 draft, 20 Nov 2026. Keep this file as the historical delivery tracker.

Architecture note: the app runs on **Cloudflare Workers + KV** (`worker/worker.js`,
`public/core.js`). KV is a key/value store, so there is no SQL Row-Level Security.
"Backend-level enforcement" here means: every `/api/admin/*` call is checked in
`core.js` against the caller's permissions (never only hidden in the UI), sensitive
fields are stripped before they leave the server, and every mutation is written to
the activity log with the actor's name. Anything that must never reach a non-owner
(phone numbers, exports, master sheets) is blocked or redacted server-side.

## Phase 1 — Access, roles & audit (spec §1)  ← in progress
- Permission registry grouped by module (Customers, Finance, Marketing, Team, System…).
- Roles/Functions presets: Owner, Technical Manager, Sales Agent, Accountant, Manager, Full access.
- Owner-only locks (cannot be granted to staff): **exports**, **calls**, **master sheets**,
  team management, backups, owner login.
- Staff restrictions enforced in the backend: no data export, no phone numbers unless
  granted `customers_phone`, no call management, no master sheets.
- Redaction: customer phone/WhatsApp masked for staff without `customers_phone`.
- Audit log: every admin mutation and every blocked attempt recorded with the actor.
- Team screen: add/edit members with Function + granular per-module toggles.

## Phase 2 — Storefront & pricing (spec §2, §3)
- Customer login page = status only (days left, expiry, balance, lines). No pay/renew links.
- Renewal links sent privately (WhatsApp / Telegram) only.
- Telegram marketing channel (promos) separate from private support/payment chats.
- IBO Player packages: 1 Year $5.99, Lifetime $11.98.
- Multi-device (1 year): 1/2/3/4 devices → $5.99 / $11.98 / $17.97 / $23.96.
- Stripe direct pay buttons/links removed from the site (verify none remain).

## Phase 3 — CRM, order templates & free trial (spec §4)
- Separate storefront login credentials from panel (IPTV) credentials; store panel creds securely.
- Order template generator: M3U field → auto-parse username/password → formatted order
  (package, user, pass, M3U) saved + emailable.
- MAC-address notice for MAC-based devices (send MAC to support).
- Customer profile: Telegram/phone, send-password-via-WhatsApp button, total paid,
  status (Normal / Excellent / Dispute), call button, call-conclusion notes field.
- Reseller profile section (accounts, orders, balances).
- Storefront dashboard: lines, expiry, balance/payments, status.
- Free-trial: shared all-agents queue, M3U auto-extract, dedicated email + WhatsApp
  templates (sender name + subject, never noreply@).

## Phase 4 — Disputes & problem reporting (spec §5)
- Unified disputes/escalations tracker (payment, service, status=Dispute) with context + resolution.
- "Report a problem" button on every screen (screenshot + priority).
- Auto-escalation to Owner + Technical Manager dashboards.

## Phase 5 — Multi-account Stripe & payouts (spec §6)
- One dashboard for all Stripe accounts (USD/EUR), add/remove accounts.
- Map payment links to tiers (Normal, Resellers, IBO Player); status (Active/Verification/Closed)
  and payout schedule (2-day / 7-day).
- Accounts: GreenApp Host LLC (2-day), Waffim, Avixcloud, Bussalion (7-day).
- Package link manager per currency (USD/EUR).

## Phase 6 — IBO Player panel (spec §7)
- App/MAC device support; show username/password/DNS/M3U; per-device setup guides.
- IBO panel: manage IBO customers, credits (1 credit = 1-year activation = $3.50),
  manual add, send trials via Email / WhatsApp / Telegram.

## Phase 7 — Marketing, SEO & Ads dashboards (spec §8)
- Email marketing: isolated lists, 10 rotating Resend keys, bounce removal,
  templates + custom HTML, 5 sender names + 5 subjects rotation, cost calculator, stats.
- SEO/social: task tracking for Reddit/Quora/Facebook with daily/weekly/monthly stats per agent.
- Google Ads: campaigns, dates, daily/weekly/monthly spend, multiple accounts, per-domain budgets.
- Facebook Ads: photo creatives, performance, creative history log, phone/ad-account tracking.

## Phase 8 — Attendance, shifts & tasks (spec §9)
- Per-user logins, login timestamps, check-in/out, breaks, late/absence flags, audit-logged edits.
- Night shifts (Europe/America), cross-midnight handling, live multi-timezone header clock,
  shift rotation.
- Weekly rest-day roster (staggered), leave requests → owner approval, auto-exclude from absence.
- Daily task list (ID, name, assignee, dates, priority, status, completion, notes) + weekly plan.
- Internal team chat.
- Automated daily/weekly reports + owner monitoring dashboard (owner only).

## Delivery rules
- Backend enforcement first, UI second. No sensitive data without an explicit grant.
- Every phase ships with tests (`npm test`) and a short changelog line.
- Deploy = push to `main` (GitHub Actions → Cloudflare Workers).

## 2026 addendum — blueprint additions shipped (all tested, live)
- **Mandatory two-factor** for owner & staff: until 2FA is on, the dashboard only serves the 2FA setup screen (backend enforced, not just UI).
- **Math captcha** on customer & trial sign-in (no external keys; login page + trial modal). Owner can toggle in Security settings.
- **Contact checkboxes** (Email / WhatsApp / Telegram) per customer: 24h auto-reset, "contacted today?" workflow for daily follow-ups.
- **Dual email per customer** (primary + secondary): search, expiry reminders and renewal mailers fall back to the secondary address.
- **Trainee mode**: new members can start as an unpaid 14-day trainee (Customers view + Attendance + Tasks only); Nizar promotes to active on the team page.
- **Staff aliases & payroll fields**: western alias (shown to customers), band (CIH / IBAN / US), masked bank details, escalation email for the Technical Manager.
- **Technical Manager escalation copies**: disputes and problem reports are emailed to Nizar *and* to Khalil's notifyEmail (set per member).
- **CC Collection tracker** (owner-only): Customer name/ID, country, contact, processor (Kast / Trade OKX / Epay / Exchanger / Other), card status (Live / Declined / Refunded), amount with full decimals, notes; live vs declined totals.
- **Templates lock**: everyone can view & input; only Owner / Technical Manager / Full access can save (new `templates_edit` permission).
- **Uptime monitor**: daily cron probes the streaming server and emails you (max one per 6h) if it stops answering.
- **Live multi-timezone clock** in the admin top bar (Europe / US / local) + big clock on the attendance page.
- **Holidays & campaign calendar** for Nizar & Khalil only: Europe/US holidays incl. Thanksgiving, Black Friday, Super Bowl, Easter & Islamic holidays (approx.), with campaign notes and Stripe/bank payout-delay warnings.
- **Discord voice channel** link in the dashboard header (Security settings) for instant team coordination.
- **Un-truncated financial figures** (USD, MAD, totals) everywhere — minimumFractionDigits: 2.
- **Daily income/expense tracking**, IBO credits ($3.50), marketing rotation, attendance/shifts/tasks/team chat — all in earlier phases.

### Not built yet (honest)
- **Staff bylaws with mandatory e-signature** & in-panel SOP manual (needs the legal text approved to publish).
- **Automatic deletion of expired duplicate entries** (name+phone+email) — available as the Duplicates page; auto-deletion left off deliberately.
- **Off-site 24h backup with 30-day retention + 1-year monthly archive** — needs a storage backend (e.g. Cloudflare R2); only in-app download/restore exists.
- **AI chat archiving & automated KPIs** — needs an LLM provider decision.
- **SOP training evaluation UI** (week 1/week 2 scoring) — trainee flag + restricted perms shipped; scoring form not yet.
- **Kast / Trade OKX / Epay direct API integration** — entries are manual logs; direct integration needs their credentials + docs.
- **In-panel browser & 10 Resend keys with DNS/domain rotation** — keys exist (10, rotating); domain-to-key mapping is manual per list.

## Phase E — Promotions, referrals & planning sync (20 Nov 2026)

New owner request tracked here; the [developer brief](developer-brief.md) holds the canonical requirements.

| Item | Requirement | State in this working tree |
|---|---|---|
| REF-01 | Referral rewards: 30 / 90 / 180 days for 1-year, 2-device $109.99 and 4-device $139.99 plans | Tier table + pure helpers in `public/core.js`; rewards granted on Stripe success, receipt approval and paid admin create/renewal |
| REF-02 | Self-referral / duplicate-code protection | Enforced in `/api/me/referral/apply` (own-code check + one code per buyer) and in the automatic award (buyer-level marker + award cross-check) |
| GIFT-01 | One simple gifts surface for customers (1/3/6 months or 10%/20% off) | Defaults added to `gifts.customer`; visible in `/api/me` and rendered in Account → Gifts & promotions |
| GIFT-02 | Resellers see 10% / 20% discount only | `visibleGifts()` strips free months for resellers; default reseller entries are 10% / 20% only |
| LIFE-01 | Lifetime Standard 1 device $499.95 / Lifetime VIP 4 devices $999.95, fixed | Added to `plans` and `orderPackages`; lifetime IDs excluded from referral rewards |
| PANEL-01 | Same colours/overview on owner + agent panels, simple phone/iPhone/Samsung/tablet layouts | Category tokens + responsive CSS added; phone/desktop smoke pass pending live environment |
| PLAN-01 | Owner "My planning" through Dec 2027, read-only agent sync | Month range helper ends at `2027-12`; agent-facing `/ownerplan/sync` route and **Planning overview** tab wired |
| PLAN-02 | Notify all agents once live; owner can re-notify | `notifyOwnerPlanSync()` one-shot marker on the daily tick; owner **📣 Notify agents** action re-sends on demand |
| GUIDE-01 | Updated in-app agent guide | New rules appended to the in-app agent guide (`en` / `fr` / `ar`) and to `docs/admin-guide.md` / `docs/user-guide.md` |

Follow-up before marking Phase E fully live: run the full test suite, then do a phone/desktop smoke pass and confirm the one-time agent notice in the deployed environment.

## Phase F — Shared AI assistant, IBO Players & sports promotions (21 Nov 2026)

New upgrade, shipped with backend tests (`node --test tests/backend.test.mjs`, 140 passing) and the real-browser e2e (`python3 tests/e2e.py` — the website, the app, the customer flow and the new pages on a 390 px phone pass; the stale e2e checks — the footer language links, the login captcha, the post-logout sign-in screen — were updated for the current UI).

| Item | Requirement | State in this working tree |
|---|---|---|
| AI-01 | **Shared AI Assistant across panels** — Owner and agents get the same assistant: panel answers to recurring operational/setup questions (today / tomorrow plan, alerts, IBO Player setup on Roku TV, sports promos) plus actions: create a Resend API, update a sports promo, change a customer program, ask about alerts | New **AI Assistant** tab (Home; Owner + agents). `POST /api/admin/ai/ask` (shared). `GET/PUT /api/admin/ai/config` (owner). `POST /api/admin/ai/action` (owner). Optional LLM mode via any OpenAI-compatible base URL + model key (key stored only in settings, never returned); the panel answers work without a key |
| AI-02 | **Agent notifications about planning** — when the Owner saves My planning, every agent gets a push with today's plan (once per day; the 📣 Notify agents button re-sends) | `savePlan` in `core.js` now calls `pushAgents(s, 'plan', …)`; `NOTIFY_DEF.plan` added; the owner-plan page shows the plan push toggle in the Notifications tab |
| AI-03 | **IBO Players & download links** — all IBO Player download links with downloader codes and playlist logins: IBO Player (1171959, ibodesk.com/iboupdate.apk, iboplayer.com/device/login), IBO Player Pro (923441, ibodesk.com/ibopro.apk, iboplayer.pro/manage-playlists/login/), KING4K Player (862414), IBO Pro Player (6402995), IBO Pro (474637), IBOSS IPTV (967528), IBO XPlayer (7947185) | `IBO_PLAYERS` data + public `GET /api/ibo/players`; "📺 IBO Players — download links, codes & playlists" cards with app photos on the IBO tab |
| AI-04 | **IBO device management** — multiple devices (IBO clients) per account, multiple MAC addresses per device, change APP/Device with the IBO type name (IBO Player, KING4K Player, IBO Pro, IBO Pro Player, IBOSS IPTV, IBO XPlayer, Smart IPTV, …) | IBO clients now carry `devices: [{ deviceApp, mac }]` (legacy `macs[]`/`macAddress` still supported); **Add IBO client form**: "➕ Add Device" adds device rows (up to 8) — each row has its own APP/DEVICE selector (with the 7 apps' photos) + MAC field; selecting an app auto-attaches its downloader code/APK/playlist (used in the setup email); **credits multiply by the number of devices** (4 devices = 4 credits); `iboMacs()` used everywhere; `POST /api/admin/ibo/macs` / `DELETE /api/admin/ibo/macs`; IBO table shows per-device apps + MACs |
| AI-05 | **Sports promotions** — the Owner adds/edits sports events (Champions League, NFL, …) on Promotions | New **Sports & events** cards + edit/add form on the Promotions tab; `GET/POST/PUT/DELETE /api/admin/sports` (owner-only edits); seeded defaults (UEFA Champions League Final, NFL — prime-time match) |
| AI-06 | **Cross-device fit** — the new pages work on all devices/browsers | Responsive CSS (`.aia-*`, `.ibo-card`, `.sport-card`); e2e phone checks (overflow, actions, IBO cards, sports cards, the AI answer) |

Still on the earlier "Not built yet" honesty list: AI chat archiving & automated KPIs, Kast/Trade OKX/Epay live API integration, off-site backup, the SOP scoring UI.
