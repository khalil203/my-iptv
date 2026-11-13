# Testing

## Automated
- `npm test` (or `node --test tests/backend.test.mjs`) — backend checks with an in-memory store and made-up data: sign-in lockout, two-step sign-in (including the RFC 6238 test vector), devices, customer isolation, support tickets, password reset, Stripe webhook signature / duplicate / unmatched cases. These run on every deploy; a failure stops the deploy.
- `python3 -m http.server 8766 --directory public` then `python3 tests/e2e.py` — a real browser walks through the website (3 languages, phone width), sign-in help, admin two-step setup, customer account (devices, support, payments, parental PIN) and the support desk.

## Manual checklist (needs real services, cannot be automated here)
| Area | Check |
|---|---|
| Live / movie / series playback | Play one of each on Android, Android TV, iPhone browser, desktop |
| Resume | Stop a movie after a minute, reopen it: it continues from the same place (web and desktop players) |
| TV remote | Reach every tab, open a channel, go back, using arrows / OK / Back only |
| Password reset email | Ask for a link with a real customer that has an email; open it; set a new password |
| Stripe | In Stripe test mode: add the webhook, pay a test payment link while signed in as a test customer, confirm the subscription extends and the payment is listed under *Banks & balances* |
| Panel renewal | With the TVplus API connected, confirm an automatic payment also renews the line on the panel |
