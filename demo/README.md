# Fictional demo workspace

`fictional-lab.json` is an ordinary Lab backup with **12 invented people, 12 invented projects, 8 invented venues, 15 submission targets, 6 updates, 3 settings, and 21 people–project links**. Two prospective students have no project connections. Every name, research description, result, venue, decision, date, email address, and source link is fabricated. The fixture was authored from scratch; it contains no private records, imported provenance, attachments, or original audit history.

The sample is optional. It is not imported into deployed workspaces automatically.

## Run the local demo

Install dependencies and apply the project's **local** database migrations first. Then:

```sh
node scripts/seed-demo.mjs --demo
```

The script uses the `DB` binding in `wrangler.jsonc`, with an explicit `--local` flag. It refuses `--remote` and unrecognized arguments. The shared browser/MCP owner ID is `owner`. Run the app with the documented local demo configuration (`DEMO_MODE=true`); this mode only works on loopback addresses and does not open a deployed site.

Seeding is additive: existing records are never overwritten, and running it twice does not duplicate records. Start from a fresh local database for a clean recording. The script does not migrate or reset databases.

To validate without writing:

```sh
node scripts/seed-demo.mjs --demo --dry-run
```

The illustrative schedule is moved relative to today's UTC date when seeded. For a reproducible recording, provide a fixed anchor:

```sh
node scripts/seed-demo.mjs --demo --date 2026-10-18
```

The JSON itself keeps its original reference date. To try the file through the app's ordinary **Import backup** flow, use an empty test workspace and remember that its dates are illustrative. All links use the reserved `example.org` domain.

## Useful demo scenarios

- **Mosaic → Learning Systems:** add a tentative target on the research map. This pair is intentionally not connected yet.
- **Orbit:** inspect its earlier rejection and later acceptance without losing either history.
- **Nightglass:** show a rejected submission and a new confirmed target while the work continues.
- **Compass:** show a rejection followed by a resubmission awaiting a decision.
- **Atlas:** open a project with two progress updates, a confirmed target, and an alternative tentative target.
- **Signal & Scene:** inspect an estimated two-week deadline window. **Adaptive Intelligence** has a TBA date.
- **Robin / Sasha:** clear the default people filter to reveal prospective students who have not started projects.
- **Echo / Sketchbook:** clear the default project filter to reveal completed, unsubmitted work and an early idea.

For public recordings, include “Fictional demo data · dates illustrative” in the opening/end frame or accompanying description. Do not imply that demo research results, submissions, or decisions actually happened.
