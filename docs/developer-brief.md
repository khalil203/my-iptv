# Developer Brief — INTPROTO-TV Management App & Panel

**Owner:** Khalil (Technical Manager) · **Approver:** Nizar (Owner) · **Status:** Implemented — pending approval · **Last updated:** Friday, 20 November 2026, 18:58 (Asia/Bangkok)  
**Canonical brief:** this file · **Related:** [Upgrade plan](upgrade-plan.md) · [Architecture](architecture.md) · [Engineering report](engineering-report.md)

## New upgrade — 20 Nov 2026

A newer owner request supersedes the promo details that were still open in Q2/Q3 below. It is implemented across the backend, UI and docs; the historical brief is kept unchanged for traceability.

- **Referral programme:** a referred friend/family member gives the referrer free subscription days — **30 days** for a 1-year plan, **90 days** for the **2-device 1-year $109.99** plan, **180 days** for the **4-device 1-year $139.99** plan. Rewards are free days for the referrer, never a price change for the buyer; a referrer-wide cap and one award per buyer apply.
- **Gifts & promotions visibility:** one simple, shared place shows normal customers `1 month free`, `3 months free`, `6 months free` or `10% / 20% discount`. **Resellers only ever see `10%` or `20%` discount** — never free months.
- **Lifetime Intproto-TV promotions:** Lifetime Standard **1 Device $499.95** and Lifetime VIP **4 Devices $999.95** across all packages/promotions; these are fixed prices, not discounted and not referral-eligible.
- **Panel & sync:** owner and agent panels share the same colours/overview and simple laptop + phone (iPhone, Samsung, tablet) layouts. The agent guide page carries all new features.
- **Owner "My planning":** schedule extended through **December 2027**; a read-only synced overview is available to agents; all agents are notified once when the update is live, and the owner can re-notify.
- **Verification status:** pricing constants, reward-tier table and reseller gift filtering are present in `public/core.js`; referral rewards are granted on Stripe success, receipt approval and paid admin create/renewal; the read-only agent sync view and owner re-notify action are wired in `public/app.js`.

## Problem

The panel already covers the core reseller operation, but several daily workflows still feel inconsistent or untrustworthy: finance rows do not expose exact time, bank-balance movements are not linked to transaction detail, payout schedules are fixed, panel colours and dark mode vary by screen, refresh is scattered across unrelated controls, and promo/marketing tools are only partly available to resellers and agents. Customers also have no in-app path to pay for a domain or update personal account information.

This brief turns those requests into buildable, testable work packages. The reversible work is implemented and awaiting approval; finance auto-transfer, final promo rules, live campaign management, and domain payment remain preview-only pending the decisions in [Open questions](#open-questions).

## Goals

- Give every panel screen one consistent colour language and a polished, low-glare dark mode.
- Make money data trustworthy: newest-first ordering, exact timestamps, holiday-aware payout notes, linked bank-balance transactions, and preserved history.
- Give resellers and managers trackable credit/subscription promotions and a sample business app.
- Give agents marketing examples, templates, and permissions without exposing owner-only secrets.
- Let users pay for domains and maintain their own personal account details in one place.

## Non-goals

- No SQL rebuild or framework migration; Cloudflare Workers + KV remains the source of truth.
- No new npm dependencies or paid infrastructure without separate approval.
- No irreversible deletion of old transactions; historical data is preserved and labelled.
- No automatic Stripe-to-bank transfer until the schedule and bank-detail fields are confirmed.
- No live ad-campaign submission/management until the agent scope is confirmed.
- No invented precision for legacy records that only stored a date.

## Users and scenarios

- **Owner / Technical Manager** — needs accurate payout timing, audit trails, and controlled rollout.
- **Accountant / Finance agent** — needs exact transaction order/time, bank-balance detail, and holiday context.
- **Sales / Support agent** — needs copy-and-paste ad/post templates and clear permissions.
- **Reseller / Manager** — needs credit tracking, promo eligibility, and a sample app to learn the workflow.
- **Customer / domain owner** — needs to pay for a domain and correct personal information without contacting support.

## Current state snapshot

| Area | Current implementation | Gap for this brief |
|---|---|---|
| Panel colour/dark mode | Tokens at `public/styles.css:1-19`; dark/light overrides at `:390-405`, `:904-918`; theme toggle at `public/app.js:150-168` | Category colours are not tokenised; reduced-motion rule is later overridden at `public/styles.css:928-935`; contrast needs AA pass |
| Refresh | Reseller `↻`, finance “refresh”, `refresh-rates`, chat retries at `public/app.js:449`, `:489`, `:1869`, `:3155`, `:643` | No shared busy state, `aria-busy`, “last updated”, or consistent error toast |
| Important notice | `.notice.danger` / “Important (red)” at `public/app.js:1564-1566`, `:2203`; styles near `public/styles.css:271`, `:900-902` | No admin screen to edit the text shown to customers |
| Transactions | Backend already sorts newest-first and caps table at 300 (`public/core.js:5091-5093`); CSV uses `limit=100000` (`public/app.js:3164`) | UI `fmtDT()` omits seconds/timezone (`public/app.js:20`, `:1886`); manual date becomes noon (`public/core.js:5100`) |
| Payouts | `payoutDays` exists as 2/7-day (`public/core.js:150-154`); account manager at `public/app.js:4508`, `:4719`; holiday calendar at `public/core.js:1115-1143` | 1-day option missing; holiday warning is calendar-only for Nizar/Khalil (`docs/upgrade-plan.md:95`); no confirmed auto-transfer |
| Bank balance | Stripe accounts carry `balance` and `bankId` | No bank-balance transaction list/detail linked to the same history as sales |
| Reseller / agent | Reseller ledger at `public/core.js:1810-1818`; IBO panel at `public/app.js:5187`; ads tabs at `public/app.js:5115` | Promo engine, sample app, Reddit/Quora/Facebook group templates, and uniform agent permissions are not complete |
| Domain / personal info | Routes and manual domain-to-key mapping in `wrangler.toml` and `docs/upgrade-plan.md:107` | No in-app domain payment or personal-info editor found |

## Requirements

| # | Requirement | Priority | Notes |
|---|---|---|---|
| UX-01 | Use one tokenised colour set per panel category/status in light and dark themes | Must | Never rely on colour alone; ship AA contrast |
| UX-02 | Add one global refresh control with busy state, last-updated time, and success/error feedback | Must | Reuse existing fetch paths; no full reload |
| UX-03 | Let an authorised admin edit the “Important” notice/problem text shown on screens | Must | Preview, save, clear, audit log |
| FIN-01 | Show transactions newest-first everywhere | Must | Backend already does for main table; verify CSV/export/bank views |
| FIN-02 | Store and display exact transaction time: local date, hours, minutes, seconds, and timezone | Must | Legacy date-only rows keep original value and are labelled |
| FIN-03 | Explain bank-balance discrepancies and mark US bank-holiday processing windows | Must | Uses `America/New_York`; finance-visible note |
| FIN-04 | Give bank-balance movements the same transaction history/detail view as sales | Must | Linked by Stripe payout/balance-transaction ID |
| FIN-05 | Manage Stripe payouts with configurable 1/2/7-day schedules | Must | Auto-transfer blocked on Q1 |
| FIN-06 | Review, preserve, and migrate historical transaction data | Must | Additive migration; no data loss; dry-run report |
| GROW-01 | Add reseller credit promotions, including a “4 for 5” offer | Must | Rules blocked on Q2 |
| GROW-02 | Add a reseller sample app with credit tracking and business-management tools | Should | Reuse reseller/IBO panel patterns |
| GROW-03 | Add Black Friday / manager-subscription promos and gifts | Should | Dates and reward blocked on Q2 |
| GROW-04 | Add Google Ads, Facebook Ads, Reddit, Quora, and Facebook-group examples/templates for agents | Must | Scope blocked on Q3 |
| GROW-05 | Enable the relevant agent permissions consistently in backend and UI | Must | Owner-only secrets remain owner-only |
| ACC-01 | Let users pay for domains and update personal account information | Should | Provider/price/fields blocked on Q4 |

## Acceptance criteria

### UX-01 — Category colour coding and dark mode

- Given a category, status, or badge, when it appears on any admin screen, then it uses the same tokenised colour in light and dark themes.
- Given dark mode, when text, chips, tables, and modals render, then contrast meets WCAG AA and no category is identified by colour alone.
- Given reduced motion, when any page loads, then later CSS layers preserve the preference and no fixed aurora animation runs.

### UX-02 — Refresh button

- Given stale panel data, when the user presses **Refresh**, then the control is disabled, marked `aria-busy`, and shows a visible progress state.
- When refresh completes, then “last updated” changes, the relevant panels update without a full page reload, and a success or error toast is announced.
- Given slow/offline network, when refresh fails, then the previous data stays visible and a Retry action is offered.

### UX-03 — Important notice editing

- Given an authorised admin, when they open **Settings → Important notice**, then they can edit, preview, save, and clear the message.
- Given a saved notice, when a customer/reseller opens the home screen, then the notice appears with icon/text plus the red style and survives theme changes.
- Every save/clear is recorded in the activity log with actor and timestamp.

### FIN-01 / FIN-02 — Ordering and exact time

- Given the finance tab, bank-balance view, or CSV export, when records load, then newest appears first and oldest last.
- Given a new transaction, when the user saves it, then the form accepts date **and** time and the backend stores one epoch value plus timezone.
- Given an existing date-only record, when displayed, then it shows the original date with `time unknown` rather than a fabricated time.

### FIN-03 / FIN-04 — Bank balance and holidays

- Given a bank-balance discrepancy, when an accountant opens the row, then they see available/pending amounts, payout/balance-transaction ID, status, fees, arrival date, exact timestamp, and a link to the matching transaction detail.
- Given a US bank holiday, when a payout/arrival date falls inside the holiday window, then the screen shows a clear “bank holiday — processing may be delayed” note using `America/New_York`.
- Given a bank-balance entry with no matching sale, when opened, then it is still viewable, linked to its source, and flagged for reconciliation.

### FIN-05 / FIN-06 — Payout schedules and history

- Given a Stripe account, when an admin edits payout settings, then they can choose 1-day, 2-day, or 7-day scheduling per account and see the effective next payout date.
- Given auto-transfer is enabled after Q1 approval, when a payout runs, then it is idempotent, audit-logged, and respects the configured holiday rule.
- Given the migration runs, when it completes, then row counts before/after match, no legacy field is overwritten, and a downloadable report lists skipped/repaired records.

### GROW-01 / GROW-02 — Reseller promos and sample app

- Given an eligible reseller, when a promo is active, then the offer, eligibility, expiry, and credit impact are visible before confirmation.
- When a promo is applied, then the backend validates rules, caps abuse, writes the ledger entry, and records the audit event.
- Given a reseller opens the sample app, when they simulate a sale, then credits, expiry, customer status, and business totals update in the sample dataset only.

### GROW-03 / GROW-04 / GROW-05 — Promos, templates, permissions

- Given Black Friday or a manager promo is active, when an eligible user opens the promo surface, then they see exact reward, dates, and terms confirmed in Q2.
- Given an agent with marketing permission, when they open the Ads & Posts panel, then Google Ads, Facebook Ads, Reddit, Quora, and Facebook-group examples are available to copy.
- Given an agent without a sensitive grant, when they open the same panel, then secret keys, exports, and owner-only settings remain hidden and blocked server-side.

### ACC-01 — Domain and personal info

- Given a user, when they open **Account → Domain & personal info**, then they can update allowed personal fields and choose a domain-payment option.
- When payment succeeds, then domain status, payer, amount, method reference, and expiry are shown and saved with an exact timestamp.
- Invalid or duplicate domain/personal data is rejected with a clear message and no partial write.

## Success metrics

- **Finance trust:** 100% of new transactions have second-level timestamps; 0 newest-first regressions; 0 bank-balance rows without a viewable detail path.
- **Payout clarity:** every payout screen shows schedule, next date, holiday flag, and linked balance transaction; reconciliation exceptions are visible, not silent.
- **UX consistency:** one token set for all category/status colours; dark-mode AA pass on dashboard, finance, team, reseller, agent, and modal screens.
- **Refresh speed:** standard panel refresh resolves in under 2 seconds on typical Cloudflare Workers response; no full-page reload for tables.
- **Promo safety:** every granted credit/gift has an audit record; no stack abuse beyond confirmed Q2 rules.
- **Agent enablement:** all agents with marketing permission can access the approved template set; zero owner-secret leaks.

## Constraints and dependencies

- Architecture: Cloudflare Workers + KV; no SQL, no new npm packages, no build step (`docs/architecture.md:5-16`).
- All permissions, promo eligibility, and payout actions must be enforced in `public/core.js`, not only hidden in `public/app.js`.
- Free-plan KV has 1,000 writes/day; batch writes, avoid per-row churn, and keep the existing 300-row finance cap or add pagination.
- Preserve demo mode: new storage shapes need safe defaults.
- New UI strings must be added through the Language Center/i18n path and covered by the i18n test.
- Q1 answers are required before any auto-transfer code; Q2 before promo rules; Q3 before campaign-management scope; Q4 before domain payment provider work.
- Deploy only through `main` (GitHub Actions → Cloudflare Workers) with tests and a short changelog line.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| KV eventual consistency makes refresh feel stale | Use cache-busting reads, show “last updated”, update only changed rows, and re-fetch on conflict |
| Stripe webhooks repeat or arrive late | Idempotency keys, event dedupe, exact timestamps, and audit log |
| Holiday windows differ by timezone | Store dates in UTC; compute display/processing notes in `America/New_York`; label explicitly |
| Legacy transactions lack time | Preserve original date, set `timePrecision: 'date-only'`, never invent seconds |
| Promo abuse or stacking | Backend caps, eligibility checks, expiry, one-per-period rules, audit trail |
| Agent access creep | Least-privilege presets, server-side checks, redaction, regression tests for denied actions |
| Dark-mode regressions from layered CSS | Token audit, AA contrast check, reduced-motion regression test, manual phone pass |

## Open questions

These are implementation blockers. Proposed defaults are **not approved** until confirmed.

### Q1 — Stripe payouts and auto-transfer

1. Should Stripe payouts **automatically transfer** to the bank on a fixed 1-day, 2-day, or 7-day schedule, or should the schedule only display/forecast the payout?
2. Is the schedule global, per Stripe account, or per bank account? Which interval is the default?
3. What exactly must the bank-balance screen show? Proposed fields: available balance, pending balance, currency, Stripe payout/balance-transaction ID, amount, fees, net, status, created/arrival exact time, bank holiday note, and linked sale/refund/adjustment transactions.
4. Who may change payout settings: Owner only, Owner + Technical Manager, or Accountant too?

### Q2 — Reseller and Black Friday promo rules

1. Does “4 for 5” mean **pay for 4 credits, get 1 free**, or 5 credits for the price of 4 with a different cap?
2. Eligibility: all resellers, active resellers only, new resellers only, or named accounts?
3. Limits: one per reseller, one per promo period, maximum credits, expiry, and stackability with manager/IBO offers?
4. Black Friday: exact start/end dates, gift (credits, free manager month, discount, or bundle), and whether it applies to new or renewing subscriptions.
5. Who approves manual exceptions and how are they audited?

### Q3 — Agent ads and posts scope

1. Should agents only get **copy-and-paste templates/examples** for Google Ads, Facebook Ads, Reddit, Quora, and Facebook groups?
2. Or should they also **submit and manage campaigns** inside the panel (drafts, scheduling, spend, results)?
3. If campaign management is in scope: which accounts, budgets, approvals, and which agents may see spend/credentials?
4. Should all agents receive the marketing permission by default, or should it be added to their preset explicitly?

### Q4 — Domain and personal info details (new)

1. Which domain provider/registrar is used, and is payment through Stripe, WhatsApp/Telegram transfer, or existing balance credits?
2. Who can request a domain: customers, resellers, staff, or all of them? What is the price and renewal rule?
3. Which personal fields are editable (name, company, phone, addresses, tax ID, emails) and which require owner approval?
4. Where should domain expiry and payer details be stored, and who can view them?

## Rollout

1. **Wave A — UX quick wins (no blockers):** UX-01, UX-02, UX-03, reduced-motion fix, i18n strings.
2. **Wave B — finance correctness:** FIN-01, FIN-02, FIN-03, FIN-04, FIN-06, then FIN-05 after Q1.
3. **Wave C — growth tools:** GROW-01/GROW-03 after Q2; GROW-04/GROW-05 after Q3; GROW-02 after credit rules are final.
4. **Wave D — account services:** ACC-01 after Q4.
5. Each wave: backend/tests first, UI second, docs/changelog with the deploy, then a phone and desktop smoke pass.

### Definition of done

- Tests pass with `/tmp/node-v22.12.0-linux-arm64/bin/node --test tests/backend.test.mjs tests/lang.test.mjs tests/i18n.test.mjs tests/ui-controls.test.mjs tests/growth.test.mjs`.
- `git diff --check` is clean; no secrets in code or docs.
- Backend denies unauthorised actions in tests, not just in the UI.
- Migration dry-run report is attached to the PR for any data-shape change.
- Live smoke check covers light/dark, mobile, desktop, and RTL where applicable.

## Source request

Upgrade brief supplied by the owner on Friday, 20 November 2026: panel colour coding/dark mode, refresh button, editable important notice, newest-first transactions, exact timestamps, bank holidays and balance detail links, Stripe payout schedules/auto-transfer, old-transaction preservation, reseller credits/sample app, Black Friday/manager promos, agent ad examples and permissions, and domain/personal-info payment/editing.
