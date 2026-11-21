# INTPROTO-TV — Admin + Customer app for TVplus panel

One app for web, iPhone and Android (installs from the browser as an app).

- **Customer side:** branded login, subscription card (days left, expiry), Live TV + TV guide, Movies, Series, search, favorites, account and password change.
- **Admin side:** overview, customers (add / edit / renew / enable / disable / delete), subscription tracker with CSV export and revenue, plans and prices, user-dashboard controls (sections, announcement, maintenance), login page and branding editor with live preview, **API settings** (streaming server + TVplus reseller API actions), admin login change, backup/restore, activity log.
- **Free 24h trial:** customers sign up on the login page (name, email, phone, WhatsApp). The line is created on the panel and the login is emailed with **Resend**.
- **Languages:** Arabic, French and English, chosen automatically from the phone's language (Arabic shows right-to-left). Customers can switch.
- **Banks & balances:** CIH Bank (MAD), Mercury (USD), Cash Plus (MAD), OKX (USDT), Binance (USDT), Relay (USD), Wise, RedotPay (USDT). You can add or edit them. Track income, expenses and transfers, see each balance plus totals in **USD and MAD**, with charts. Exchange rates update daily.
- **Credits stock:** record supplier purchases (120 credits = $90). Every sale uses credits. Shows average cost per credit and alerts when credits are low, from both your stock and the live panel API.
- **Profits:** profit on every sale (price − credits cost), plus weekly, monthly and yearly reports in USD and MAD.
- **Daily emails:** a low-credit alert to you, and expiry reminders to customers.
- **Team & access:** add staff logins with permissions (presets: Sales agent, Accountant, Manager, Full access). Staff only see what you allow, and every action is logged with their name.
- **Secure proxy:** streams play over HTTPS on iPhone and Android, and your reseller API key never leaves the server.
- **Shared AI Assistant (Owner + agents):** ask about the daily/tomorrow work plan, alerts, IBO Player setup on Roku TV or sports promos — the panel answers work without any key; the Owner can also create Resend APIs, update sports promos and change customer programs. Agents get pushed a summary of today's plan when the Owner saves My planning.
- **IBO Players:** download links with downloader codes and playlist logins for IBO Player (1171959), IBO Player Pro (923441), KING4K (862414), IBO Pro Player (6402995), IBO Pro (474637), IBOSS IPTV (967528) and IBO XPlayer (7947185) — in the IBO tab.
- **IBO device management:** several devices per account, several MAC addresses per device — the APP/device name is the IBO type name, and each box gets a MAC, all managed on the IBO tab.
- **Sports promotions:** the Owner adds Champions League and NFL-style events on Promotions — every panel shows them.

It runs on **Cloudflare Workers + KV (free plan)**.

---

## Free hosting from GitHub (no computer needed)

This repo deploys itself with GitHub Actions on every push:

| Where | What | Cost |
|---|---|---|
| **Cloudflare Workers** | The real app: admin, customers, API, stream proxy | Free |
| **GitHub Pages** | A demo you can click around (data stays in your browser) | Free |

### Turn on the real app (one time, ~5 min)
1. Make a free account at **dash.cloudflare.com**.
2. Copy your **Account ID** (Workers & Pages → right side of the page).
3. Create an **API token**: My Profile → API Tokens → *Create Token* → template **"Edit Cloudflare Workers"** → Create → copy it.
4. On GitHub, open this repo → **Settings → Secrets and variables → Actions → New repository secret**, and add:
   - `CLOUDFLARE_API_TOKEN` = the token
   - `CLOUDFLARE_ACCOUNT_ID` = the account ID
5. Go to **Actions → "Deploy to Cloudflare (free)" → Run workflow**.
6. When it's done, your app is at `https://my-iptv.<your-subdomain>.workers.dev`. The link is in the workflow log and in Cloudflare → Workers.

### Demo on GitHub Pages
Repo **Settings → Pages → Source: GitHub Actions**. The demo is then at `https://<user>.github.io/<repo>/`.

## Deploy from your computer instead (optional)

You need a free Cloudflare account and Node.js 18+ on your computer.

```bash
cd iptv-app
npm install
npx wrangler login                       # opens the browser, sign in to Cloudflare
npx wrangler kv namespace create DB      # copy the "id" it prints
```

Open `wrangler.toml`, replace `PASTE_YOUR_KV_NAMESPACE_ID_HERE` with that id, then:

```bash
npx wrangler deploy
```

You get a link like `https://my-iptv.<you>.workers.dev`. Open it, then:

1. **Sign in** with the default admin login **Iptv / Iptv**, then change it in *Account & backup*.
2. **API settings:**
   - *Streaming server URL*: the TVplus DNS, e.g. `http://your-dns.com:8080`. Put in a test line, then tap **Test server**.
   - *Reseller API*: turn it on and fill in the base URL and API key. Copy each action (create, renew, enable, disable, delete, credits) from the TVplus API docs using the placeholders shown on that page, then tap **Test API**.
3. **Plans & prices:** set your plans and the TVplus package ID for each one.
4. **Login & branding:** set the app name, logo, colours, login text and support link (LINE / WhatsApp).
5. **Customers → Add customer.** The app creates the line on the panel and gives you the login details to send.

Optional: add your own domain in Cloudflare → Workers → your worker → *Domains & Routes*.

## Default admin login
Username **Iptv** · Password **Iptv**. Change it right after the first sign-in: **Account & backup → Admin login details**.

## Set up email (Resend)
1. Create a free account at resend.com and add your domain (Domains → Add). Then add the DNS records it shows.
2. API Keys → Create → copy the key.
3. In the app, go to **Trial & email**. Paste the key, set *Send from* (e.g. `My IPTV <noreply@yourdomain.com>`), add your email, then press **Send test**.

## Customer email
Every trial and new customer gets your INTPROTO-TV email (Arabic, French or English) with **Username, Password, DNS and M3U links** (TS + HLS), filled from the TVplus panel. If the panel returns its own username/password, set *New line username / password in response* in **API settings**. On the Customers page, use ✉️ to preview and (re)send it.

## Apps for every device (auto-updating)
Open **/download.html** on any device:
- **Android phone/tablet, Android TV, TV Box, Fire TV:** APK built automatically by GitHub Actions. TVs: install *Downloader* and type `your-app-url/tv`.
- **iPhone / iPad:** Safari → Share → Add to Home Screen.
- **Windows / Mac:** Chrome or Edge → Install app (Safari on Mac: File → Add to Dock).
All versions load the live app, so they update automatically. The APK only needs reinstalling if the Android wrapper itself changes.

## Stream relay for iPhone, iPad & browsers (free, Render)
Your IPTV server blocks Cloudflare, so these devices play through a small relay hosted elsewhere:
1. Go to https://render.com and sign up with GitHub (free).
2. **New → Blueprint** → choose the `my-iptv` repo → **Apply**. It reads `render.yaml` and starts `intproto-tv-relay`.
3. Copy its address (e.g. `https://intproto-tv-relay.onrender.com`) into **API settings → Stream relay URL** and save.
Free plan: the relay sleeps after 15 minutes without viewers, so the first channel can take ~1 minute to start. Android and Windows/Mac apps don't use the relay.

## Install on phones
- **iPhone:** open the link in Safari → Share → *Add to Home Screen*.
- **Android:** open the link in Chrome → ⋮ → *Install app*.

## Good to know
- **Ports:** Cloudflare can only connect to these ports. http: 80, 8080, 8880, 2052, 2082, 2086, 2095. https: 443, 8443, 2053, 2083, 2087, 2096. If your TVplus DNS uses a port that isn't listed (like 25461), ask TVplus for a DNS on port 80 or 8080, or turn off the proxy. Without the proxy, http streams won't play on iPhone.
- **Video formats:** Live TV plays as HLS (`.m3u8`). Movies in `.mp4` play everywhere. `.mkv` files may not play in browsers.
- **Free plan limits:** KV allows 1,000 writes per day (logins, renewals, settings). That's plenty for a small reseller. If you grow past it, Cloudflare's $5/month plan removes the limit.
- **Backups:** Account & backup → Download backup. Do this regularly.
- **Demo mode:** if you open `public/index.html` without the worker, it runs in demo mode and saves data only in that browser. This is useful for trying it out.

## Promotions & referral programme (20 Nov 2026)

- **Referral (free days for the referrer, never a discount for the buyer):** a friend/family referral who buys an eligible 1-year plan gives **30 days** (1-year), **90 days** (2-device 1-year, $109.99) or **180 days** (4-device 1-year, $139.99). Each customer shares a personal code from **Account → Referral**; capped at **365 days per referrer** and **one award per buyer**. Self-referral and code reuse are blocked. Lifetime plans are not referral-eligible.
- **Gifts & promotions (one place):** normal customers see `1 month free`, `3 months free`, `6 months free` or `10% / 20% discount` together. **Resellers only ever see 10% or 20% discount** — free months are never shown to resellers.
- **Lifetime Intproto-TV (fixed, not discounted):** Lifetime Standard **1 Device $499.95** and Lifetime VIP **4 Devices $999.95** across all packages and promotions.
- **Owner "My planning":** extended through **December 2027**, read-only and synced to the agent panel with a one-time notify-all-agents on go-live (owner can re-notify). Only the owner can edit; agents use **Work planning** for their own tasks.
- **Panels & guide:** owner and agent panels share the same colours/overview and responsive layouts for laptop, iPhone, Samsung and tablets. The in-app agent guide is updated with these rules.

## Files
```
public/         the app (index.html, app.js, styles.css, core.js, sw.js, icons, growth.js, ui-controls.js)
public/core.js  backend logic (shared by the worker and demo mode)
public/growth.js  promo and marketing helpers (ads/templates/permissions)
public/ui-controls.js  shared UI helpers (category tokens, refresh, notice)
docs/developer-brief.md  canonical product brief and upgrade scope
worker/worker.js  Cloudflare Worker: /api, /proxy, static files
wrangler.toml   Cloudflare config
```
