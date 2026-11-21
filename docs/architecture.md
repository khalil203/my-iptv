# INTPROTO-TV — architecture

One codebase serves every product: the public website, the customer app (phone, tablet, TV, desktop), the customer account portal and the admin dashboard.

| Part | Where | Notes |
|---|---|---|
| Web app (all screens) | `public/` — `app.js`, `site.js`, `styles.css`, `i18n.js`, `logos.js` | Plain JavaScript modules, no build step |
| Backend logic | `public/core.js` | The same file runs in the Cloudflare Worker (real mode) and in the browser (demo mode) |
| Server | `worker/worker.js` on Cloudflare Workers | `/api/*`, the stream proxy `/proxy`, the image cache `/img` |
| Database | Cloudflare KV (`DB` binding) | JSON documents: `settings`, `customers`, `sales`, `tx`, `team`, `tickets`, `payments`, `log`, plus short-lived keys (sessions, rate limits) |
| Android / Android TV app | `android/` | A shell that opens the web app, with a native player |
| Desktop apps | `desktop/` | Windows and Mac shells |
| Stream relay | `relay/` (Render) | Secure relay for browsers and iPhone |

## Design system
Tokens live at the top of `public/styles.css` (`:root`): colours, the 8-point spacing scale, radius, shadows, the 44px touch target. Components use the tokens; brand colours chosen in *Login & branding* feed `--b-primary` / `--b-accent`. Day theme overrides the same tokens under `[data-theme=light]`.

## Data kept on the device only
Favourites, watch history and resume position, the parental PIN, language and theme are stored in the browser/app storage and never sent to the server.

## AI assistant and external-provider data flow
The optional assistant uses the owner-configured OpenAI-compatible HTTPS endpoint; without a key, deterministic panel answers still work. Chat context includes the agent Work planning and a scrubbed, read-only owner My planning view (dates, times, titles and icons, but no private notes, checkoffs or API-key records). Alert context is counts only and excludes customer names and contact details.

The marketing composer sends only the campaign brief, audience, tone and app name to the configured provider. Email subject/body are converted into escaped HTML by the backend; WhatsApp output is plain text, not HTML. The result is a draft only: it is not persisted or sent until a staff member uses the existing campaign workflow.

For support-photo analysis, the customer’s opt-in is stored on that individual image message. The endpoint also requires the owner’s feature toggle, a staff account with `customers_view`, and an explicit **Analyze** action. It sends the image plus a generic troubleshooting prompt to the configured HTTPS provider—not ticket text or account records—and displays the answer for staff review only. The suggestion is neither stored as a reply nor sent to the customer automatically. Customers should avoid uploading images that contain credentials or other sensitive details. Existing ticket-image retention and storage are unchanged; no packages or paid infrastructure are added.

## Why not Next.js / NestJS / PostgreSQL
The master specification recommends them, but the live service already runs on Cloudflare's free plan with real customers. Rebuilding on a different stack would have taken the service offline and required paid hosting. The same requirements (auth, roles, subscriptions, payments, audit log) are met on the current stack. If the customer base outgrows KV (thousands of customers, heavy concurrent writes), the `store` interface in `core.js` (`get` / `put` / `del`) is the single place to swap in a SQL database.
