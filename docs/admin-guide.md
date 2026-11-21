# Admin guide

- **Overview**: live numbers from your data — customers, active, expiring, revenue, credits.
- **Customers / Subscriptions**: add, renew, disable, email or WhatsApp a customer.
- **Support**: customer requests. Open one, write the answer, choose the status (answered / waiting / closed) and priority. The customer reads it in the app.
- **Banks & balances**: accounts and transactions; at the bottom, *Automatic activation from Stripe* and the list of payments Stripe reported (activated / unmatched / needs attention).
- **Plans & prices**: plans, the order packages shown on the public website and in order emails, Stripe pay links.
- **Login & branding**: name, logo, colours (leave the defaults for the standard violet theme), WhatsApp number shown on the website.
- **Team & access**: staff accounts with permissions.
- **My account**: your login, two-step sign-in, session length, backup and restore.
- **Activity**: the audit log.

The public website (home, pricing, FAQ, privacy, terms) is shown to visitors who are not signed in. Devices that have signed in before, and the installed apps, open the sign-in screen directly.

## Added later
- **Customers list**: the WhatsApp button is outlined until a message was sent to that customer, then solid green with a tick. A 🔐 button appears for customers who turned on two-step sign-in; use it only when they lost their phone.
- **User dashboard**: *Customers can add their own playlists* switches the Xtream / M3U feature on or off.
- **Support**: customers and staff can attach one picture per message (kept 90 days).
- **Panel credits**: if the panel refuses the app's server, the app retries through your relay. When it still fails, the Overview shows the reason and the last known number.
- **Bounced addresses** (Trial & email, at the bottom): addresses that bounced or were marked as spam are paused automatically (checked daily, or tap *Check Resend now*). Reading bounces needs a Resend API key with *Full access*.

## Menu and new pages
- **Menu**: pages are grouped (Customers, Money, Messages, App, System). Type in *Find a page* to jump anywhere; on a phone tap **☰ Menu**.
- **Alerts**: customers who need attention, in groups (trials ending, ending soon, expired, not contacted on WhatsApp, email bounced, no email, never signed in, disabled). *Customize* sets the day limits and which groups show. Each group exports to CSV.
- **Message templates**: reword every email (trial and welcome, expiry reminder, renewal offer, package order) and WhatsApp message in English, French and Arabic; add your own WhatsApp messages; preview before saving; *Back to the original* undoes a change; export and import as a file.
- **Emails & bounces**: paused addresses with filters, search, bulk allow and export; customers without a usable email; the last 100 emails from Resend with their status.
- **Import & export**: full backup, customers as CSV or JSON, and each settings part (plans, packages, templates, alerts, branding…) to export, import, or edit by hand.

## Free trials that never fail
- **Ready trial lines** (Trial & email setup, top card): paste M3U links of trial lines you made on your panel. Each new trial takes one; the customer sees the login on screen (with a Copy button) and gets the email at the same moment.
- When the panel API does not answer and no ready line is left, the customer's account is still created and they are told the line is being prepared. You get an email with what the panel answered, and the customer appears in **Alerts → Waiting for a line**. Tap Edit, paste the M3U link, save: the trial starts and the login email goes out.
- **Any customer**: the customer form has an *M3U link from your panel* box. Paste the link and username, password and server are filled in.
- Trial sign-up asks for a country code and a full phone number.
- WhatsApp messages now include *Free trial details* and *Thank you for your purchase*; edit them in Message templates.
- **Live chat** (Customers → Live chat): one running conversation per customer. Customers open it with the round chat button in their app. New messages show a red count in the menu, and you get an email when a quiet chat starts again. Tap 🗨 on any customer to write first.

## Sync with the panel, and payment receipts
- **Sync with panel** (Customers and Alerts pages): asks your streaming server about every line and updates each customer's end date and devices. Lines the panel does not know, or has banned or expired, are tagged and listed in **Alerts → Line not working on the panel**. It also runs by itself: when a customer opens the app (at most every 30 minutes) and for 20 customers a day in the background. It only needs the streaming server address in API settings, not the reseller API.
- **Payment receipts** (Money): customers tap *I have paid: send my receipt* under the packages and upload a photo. You get an email. Open the receipt, tap **Approve**: the subscription is extended and the customer is told by email and in the chat. If the panel could not be renewed automatically, the customer appears in **Alerts → Paid: renew on the panel** until you renew the line there.

## Login details and email language
- A customer's app login is the **real line username and password from the panel**. Pasting an M3U link, or typing the line details, sets the login to match. Signing in works with either the app details or the line details, unless the customer chose their own password.
- When a line was pasted from an M3U link, the app plays from **that link's server**, even if the general server address in API settings is different.
- **Language of emails** (Trial & email setup): English for everyone by default; you can pick French, Arabic, or each customer's own language.
- **Renewing never fails because of the panel**: the renewal is saved, a notice shows what the panel answered, and the customer is listed in Alerts → *Paid: renew on the panel*.
- **Paying inside the app**: *Pay now* opens the Stripe page in the same window (and inside the Android app after customers install the new version). Stripe does not allow its payment page to be shown inside a frame of another page. New pay links created from Plans & prices send the customer back into the app after paying; for links you made yourself, set “After payment → redirect to” `https://intproto-tv.store/#paid` in Stripe.

## Promotions, referrals & planning (20 Nov 2026 update)

### Referral programme
- Every customer has a personal referral link (`?ref=<code>`) under **Account → Referral**. A friend or family member who signs up with it and buys an eligible 1-year plan earns the referrer **free subscription days**: **1 month (30 days)** for a standard 1-year plan, **3 months (90 days)** for the **2-device 1-year ($109.99)** plan and **6 months (180 days)** for the **4-device 1-year ($139.99)** plan.
- The reward is added to the referrer's expiry date, never applied as a discount to the buyer. There is a **365-day lifetime cap per referrer** and **one reward per referred buyer**. Self-referrals and changing an already-applied code are blocked.
- Monitor it in **Customers / referral reports**: a customer's account shows the code, how many people they referred, days awarded and days remaining.

### Gifts & promotions visibility
- Normal customers see all available gifts and discounts in **one place** in the app: `1 month free`, `3 months free`, `6 months free`, or `10% / 20% discount`. Keep the wording simple — no separate hidden offers.
- **Resellers see discounts only** (`10%` or `20%`); free-month gifts are stripped from the reseller view even if an older setting still lists them. When editing gift settings, keep reseller entries to discounts only.

### Lifetime Intproto-TV promotions
- **Lifetime Standard — 1 Device: $499.95** and **Lifetime VIP — 4 Devices: $999.95**. These fixed prices apply across all packages and promotions: no discount code, no referral reward and no free months on lifetime plans.

### Owner "My planning" & agent sync
- The owner's **🗓️ My planning** schedule now runs through **December 2027** with the same recurring blocks, monthly events and 10 daily API-key slots. Only the owner can edit it.
- Agents see a **read-only synced overview** in their panel with the same colours and layout as the owner view; they cannot change owner blocks, checks or API keys.
- All agents are notified **once** when the updated schedule goes live. The owner can send the notice again from **My planning → Notify agents** after later changes.
- Agents should check **Work planning** for their own tasks; the owner planning notice links there.

### Phone, tablet & laptop guidance
- The owner and agent panels use one shared colour set and the same overview cards on every screen size. On a phone (iPhone, Samsung, Android) tap **☰ Menu** to jump between pages; buttons and tabs have full-height tap targets and the layouts reflow to one column. Tablets and laptops show the two-column version. All new panels respect dark/light themes and reduced-motion settings.
- The in-app **Agent guide** page is updated with all of the above; send agents there first when they ask about the new referral, gift or planning rules.
