# My IPTV — Admin + Customer app for TVplus panel

One app for web, iPhone and Android (installs from the browser as an app).

- **Customer side:** branded login, subscription card (days left, expiry), Live TV + TV guide, Movies, Series, search, favorites, account and password change.
- **Admin side:** overview, customers (add / edit / renew / enable / disable / delete), subscription tracker with CSV export and revenue, plans and prices, user-dashboard controls (sections, announcement, maintenance), login page and branding editor with live preview, **API settings** (streaming server + TVplus reseller API actions), admin login change, backup/restore, activity log.
- **Free 24h trial:** customers sign up on the login page (name, email, phone, WhatsApp). The line is created on the panel and the login is emailed with **Resend**.
- **Languages:** Arabic, French and English, chosen automatically from the phone's language (Arabic shows right-to-left). Customers can switch.
- **Banks & balances:** CIH Bank (MAD), Mercury (USD), Cash Plus (MAD), OKX (USDT), Binance (USDT), Relay (USD), Wise, RedotPay (USDT). You can add or edit them. Track income, expenses and transfers, see each balance plus totals in **USD and MAD**, with charts. Exchange rates update daily.
- **Credits stock:** record supplier purchases (120 credits = $90). Every sale uses credits. Shows average cost per credit and alerts when credits are low, from both your stock and the live panel API.
- **Profits:** profit on every sale (price − credits cost), plus weekly, monthly and yearly reports in USD and MAD.
- **Daily emails:** a low-credit alert to you, and expiry reminders to customers.
- **Secure proxy:** streams play over HTTPS on iPhone and Android, and your reseller API key never leaves the server.

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

## Install on phones
- **iPhone:** open the link in Safari → Share → *Add to Home Screen*.
- **Android:** open the link in Chrome → ⋮ → *Install app*.

## Good to know
- **Ports:** Cloudflare can only connect to these ports. http: 80, 8080, 8880, 2052, 2082, 2086, 2095. https: 443, 8443, 2053, 2083, 2087, 2096. If your TVplus DNS uses a port that isn't listed (like 25461), ask TVplus for a DNS on port 80 or 8080, or turn off the proxy. Without the proxy, http streams won't play on iPhone.
- **Video formats:** Live TV plays as HLS (`.m3u8`). Movies in `.mp4` play everywhere. `.mkv` files may not play in browsers.
- **Free plan limits:** KV allows 1,000 writes per day (logins, renewals, settings). That's plenty for a small reseller. If you grow past it, Cloudflare's $5/month plan removes the limit.
- **Backups:** Account & backup → Download backup. Do this regularly.
- **Demo mode:** if you open `public/index.html` without the worker, it runs in demo mode and saves data only in that browser. This is useful for trying it out.

## Files
```
public/         the app (index.html, app.js, styles.css, core.js, sw.js, icons)
public/core.js  backend logic (shared by the worker and demo mode)
worker/worker.js  Cloudflare Worker: /api, /proxy, static files
wrangler.toml   Cloudflare config
```
