# Deploy a private PI-lot

Each deployment is one owner's workspace. The source code is public; your records, password, sessions, attachments and AI grants belong in your own deployment.

## Recommended: Deploy to Cloudflare

You need a GitHub account and a Cloudflare account with Workers, D1, KV and R2 available. Cloudflare may ask you to enable a service or add billing details. Check the current [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/) and [R2](https://developers.cloudflare.com/r2/pricing/) pricing; this project does not promise free hosting.

1. Choose [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/assafshocher/PI-lot). Follow the flow to create a repository in your account and connect the Worker build.
2. Choose the Worker name and let Cloudflare provision the `DB`, `BUCKET` and `OAUTH_KV` bindings. Keep the binding names unchanged; resource names can be yours.
3. Supply a unique `OWNER_PASSWORD` of at least 16 characters and a separate random `SESSION_SECRET` of at least 32 characters. Store both as Worker secrets. A password manager can generate and retain them.
4. The expected build command is `npm run build`; the deployment command is `npm run deploy`. The latter applies the schema to the remote `DB` binding before deploying the Worker.
5. After the first deployment, copy the HTTPS Worker URL shown in Cloudflare. Set `APP_ORIGIN` to that exact origin, for example `https://pi-lot.example-subdomain.workers.dev`, without a trailing slash or path. If it is unknown during the initial deployment, leave it unset or retain the invalid placeholder; the app remains locked until corrected. Never use the local HTTP example as the production value.
6. Apply/redeploy the configuration change in Cloudflare. Leave `DEMO_MODE` unset or `false`. Visit `/login`, sign in, and create your first record.

The button does not automatically choose your password, grant an assistant permission, or populate your real workspace with sample records. Cloudflare's [deployment-button guide](https://developers.cloudflare.com/workers/platform/deploy-buttons/) explains resource provisioning, secret prompts and custom build commands.

Generate a session secret locally, if you prefer:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

This prints a new secret for you to place in the password manager and secret configuration. Do not paste it into an issue, commit, screenshot or chat with an untrusted party. `OWNER_PASSWORD` and `SESSION_SECRET` must be different values.

## Command-line deployment

For more control, clone the repository and install dependencies. These commands use your own authenticated Cloudflare account:

```sh
git clone https://github.com/assafshocher/PI-lot.git
cd PI-lot
npm ci
npx wrangler login
npx wrangler d1 create pi-lot
npx wrangler kv namespace create OAUTH_KV
npx wrangler r2 bucket create pi-lot-files
```

If a resource name already exists, choose a different one. Update `wrangler.jsonc` with the returned D1 database ID and KV namespace ID, and your actual database and bucket names. Keep the bindings named `DB`, `OAUTH_KV` and `BUCKET`. The checked-in zero IDs are placeholders, not usable cloud resources.

Configure secrets through the interactive prompts; avoid placing secret values in shell command arguments:

```sh
npx wrangler secret put OWNER_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put APP_ORIGIN
npm test
npm run test:integration
npm run build
npm run check:release
npm run deploy
```

For `APP_ORIGIN`, enter your Worker's exact HTTPS origin. If the initial Worker has not yet been created or its URL is unknown, perform the initial deployment first, then add the secrets and redeploy. An incompletely configured deployment cannot authenticate an owner or access their records. `.dev.vars` is for local development and is not a substitute for deployed secrets.

## Verify your copy

Before adding private records:

1. In a signed-out/private browser window, `/lab` should require sign-in; `/api/records` must not return records.
2. Sign in at `/login`. Add a temporary project, refresh, and confirm it persists. Archive it when finished.
3. Download a backup and confirm that it contains only records from your new workspace.
4. If using AI, follow the [connection guide](ai-connection.md), make a read-only request, then try one clearly authorized change and inspect it in the app.

These steps verify your installation. The repository's local tests and build do not prove that your account's resources, routing, secrets or a particular AI client have been configured correctly.

## Domains and updates

If you add a custom domain, update `APP_ORIGIN` to that exact HTTPS origin and use its `/mcp` address for new AI connections. The application checks its configured origin. Reconnect clients after an origin change; old tokens and callbacks should not be assumed to carry across origins.

Before upgrading, download a backup and retain your resource IDs and secrets. Review release notes and migration changes, pull the version you want, then run `npm ci`, the tests, the build and `npm run deploy`. Do not replace existing resource IDs with the template placeholders. Schema migrations are applied to the configured database, so check the account and configuration before deploying.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Setup required or app stays locked | All three required values exist; password and session secret meet their lengths; `APP_ORIGIN` exactly matches the HTTPS address being visited. |
| Login works locally but not online | The deployment needs its own secrets. Local `.dev.vars` is not deployed. |
| Storage unavailable or missing tables | `DB` points to the intended D1 database and the migrations completed remotely. |
| Attachments unavailable | `BUCKET` is bound to a private R2 bucket. |
| OAuth cannot finish | `OAUTH_KV` exists, origin and callback agree, and the client supports the documented OAuth flow. |
| A new clone shows no records | Expected: source code does not include anyone's private database. Import your own reviewed backup if needed. |
| Demo command refuses existing configuration | Use a fresh clone for the demo instead of replacing private configuration. |

See [security](../SECURITY.md) for revocation, secret rotation and reporting problems.
