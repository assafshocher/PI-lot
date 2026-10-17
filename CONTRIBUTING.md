# Contributing to PI-lot

Small, focused improvements are welcome. For a larger feature or a change to authentication or the data model, open an issue describing the problem and proposed behavior before investing in the implementation.

## Get started

Use Node.js 24 LTS and a fresh clone:

```sh
npm ci
npm run demo
```

The demo gives you fictional people, projects and deadlines without access to any real workspace. Keep `.dev.vars`, local database state and generated exports out of commits.

Before opening a pull request:

```sh
npm test
npm run test:integration
npm run build
npm run check:release
```

Describe what changes for the user, how you checked it, and any known limitations. For visual changes, include a desktop and mobile screenshot using only the fictional fixture. Keep changes within the issue's scope.

## Project conventions

- Preserve unknown/custom labels and unrelated fields during edits and migrations.
- Keep project workflow status separate from actual submission and decision history.
- Keep changes to relationships transactional and retry-safe. Read current revisions before replacing records.
- Add focused tests for meaningful behavior changes, especially permissions, data integrity, filters and graph layout.
- Keep demo data fictional from scratch. Never add a real backup, private Slack link, student email, production identifier or credential as a test fixture.
- Never introduce a production authentication bypass to simplify local development.
- Retain third-party attribution and explain new runtime dependencies.

Browser UI lives in `components/lab/` and `src/`; route handlers are under `app/api/` and `app/mcp/`; the Worker owns routing and authentication; shared validation and persistence live in `lib/`; schema migrations live in `drizzle/`.

## Reporting bugs

Include the app version/commit, browser or MCP client version, the steps you took, expected and actual behavior, and a minimal fictional example. Redact credentials, cookies, authorization headers and private records from logs. Use [SECURITY.md](SECURITY.md) for a suspected vulnerability rather than posting an exploit publicly.

By submitting a contribution, you agree that it may be distributed under this repository's MIT license. Only contribute material you are entitled to share.
