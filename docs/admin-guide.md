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
