# Deployment

Every push to `main` runs `.github/workflows/deploy-cloudflare.yml`: builds the Android app, runs the automated checks, refreshes the channel-logo index, and deploys to Cloudflare Workers.

Repository secrets needed: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

Addresses served: the `workers.dev` address (used by the installed apps — keep `workers_dev = true` in `wrangler.toml`), `intproto-tv.store` and `www.intproto-tv.store`.

## External services and what each one needs
| Service | Used for | You provide |
|---|---|---|
| TVplus panel | Creating / renewing lines | API details in *API settings* |
| Resend | Login, order, renewal and password-reset emails | API key and sender in *Trial & email* |
| Stripe | Payment links, balances, automatic activation | Secret key in *Banks & balances*; for automatic activation a webhook signing secret per Stripe account |
| Render | Stream relay for browsers / iPhone | The relay URL in *API settings* |

## Turning on automatic activation (per Stripe account)
1. Stripe → Developers → Webhooks → Add endpoint → `https://<your address>/api/stripe/webhook`
2. Event: `checkout.session.completed`
3. Copy the signing secret (`whsec_…`) into *Banks & balances → Automatic activation from Stripe*.

Payments are matched to a customer by the reference the app adds to each pay link (or by a unique email), and to a package by the link's package tag (or a unique price). Anything unclear is listed as *unmatched* or *needs attention* for you to handle by hand — nothing is guessed.
