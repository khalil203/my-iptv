# Security

- **Passwords** are stored as salted PBKDF2 hashes, never in plain text. Note: for customers created by the panel flow, the app keeps the *line* password (needed to build the stream address and to email login details); treat backups as confidential.
- **Sessions** are random tokens stored server-side with an expiry (*My account → Sessions*). Customers can see and sign out their devices; a password reset signs out every device.
- **Sign-in protection**: 8 wrong tries lock that username and that network for 15 minutes.
- **Two-step sign-in** (TOTP, RFC 6238) for the owner and for staff accounts: *My account → Two-step sign-in*.
- **Roles**: owner, staff with per-area permissions, customers. Every admin route checks the permission on the server; customers can only reach their own data (covered by automated tests).
- **Password reset** links are random, single-use and valid 30 minutes; the answer is identical whether or not the account exists.
- **Stripe webhook**: accepted only with a valid `Stripe-Signature` for one of your signing secrets, within 5 minutes; each payment is applied once (event id and session id are both checked). The browser is never trusted to say "payment succeeded".
- **Secrets** (Resend key, Stripe key, signing secrets, panel API key) stay on the server; they are masked for staff without the settings permission.
- **Audit log**: *Activity* records sign-in related changes, renewals, payments, support actions and settings changes.

## Things only the owner can do
1. Change the default admin login (`Iptv` / `Iptv`) if it is still in use — the dashboard shows a red warning until it is changed.
2. Turn on two-step sign-in.
3. Download a backup regularly (*My account → Backup*).
