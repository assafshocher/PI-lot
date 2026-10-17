# Security

PI-lot is a single-owner application intended for deployment into your own Cloudflare account. It is not a multi-user authorization system or a substitute for your institution's data policy.

## Access model

- Browser access requires the owner password and a signed session.
- AI clients use an approved OAuth grant to access the same workspace through `/mcp`.
- `OWNER_PASSWORD` must be at least 16 characters. `SESSION_SECRET` must be an independent random value of at least 32 characters.
- `APP_ORIGIN` must match the exact HTTPS production origin. Missing or invalid configuration keeps the app closed.
- Local demo access is restricted to loopback and is for fictional data only. Do not enable demo settings in a deployed app.

An approved AI connection can expose the records it reads to the assistant provider. Inspect permissions, authorize only clients you trust, and use the assistant's available tool-approval controls. Treat copied context, exports and downloaded attachments as private data.

The app does not provide end-to-end encryption. Cloudflare operates the deployed storage, and anyone with sufficient access to your Cloudflare account can administer it. Protect that account and your source repository accordingly.

## Operate it safely

Store deployment secrets in Cloudflare's secret settings, not in tracked files or frontend environment variables. `.dev.vars` is local and must remain ignored. Do not publish `.wrangler` state, database exports, real screenshots, attachments, cookies or OAuth tokens.

Use `/auth/connections` to review and revoke AI grants. Browser logout and AI revocation are separate: logging out does not imply that an assistant's grant has been revoked. If a password or session secret might have leaked, change it through your deployment's secret settings and redeploy; also revoke AI grants and reconnect trusted clients. Do not assume changing one secret invalidates all other forms of access.

OAuth grants are stored in Cloudflare KV. Its updates are eventually consistent: a revocation may take 60 seconds or longer to reach a location that cached the previous value. Do not rely on a grant deletion as an instantaneous global emergency cutoff. If access needs to stop urgently, disable access to the deployment while investigating and applying credential changes. Revocation cannot retract data already read by a client. See [Cloudflare's KV consistency documentation](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

Back up before upgrades and verify your configured database before applying migrations. Keep dependency and runtime updates under review. The included test suite and release check help find mistakes but do not constitute an independent security audit.

## Report a vulnerability privately

If GitHub private vulnerability reporting is enabled for this repository, use **Security → Report a vulnerability**. If that option is unavailable, open a minimal issue asking the maintainer for a private reporting channel without including exploit details, credentials, or private data. Do not guess an email address or post a working exploit in a public issue.

Include the affected commit/version, a minimal reproduction using fictional data, impact, and any suggested fix. Do not test against someone else's deployment without permission. No response-time or bounty commitment is implied.

Security changes target the current main branch; operators should review and apply relevant updates to their own deployments.
