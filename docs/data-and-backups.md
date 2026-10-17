# Data, backups and moving your workspace

Your deployed records live in your Cloudflare D1 database. Attachments live in the private R2 bucket. OAuth grants live in KV. A source-code clone contains none of those private resources.

## Export

Use **Settings → Export lab backup** to download a JSON snapshot containing active and archived lab records, relationships and settings. The browser export omits the internal audit log. Treat this file as private: notes, contact details, research plans and links can all be present.

**JSON exports do not embed attachment binaries.** Keep a separate copy of important files. An attachment URL in a backup refers to the original app's authenticated file endpoint; it does not transfer the underlying object to another installation.

## Import

Review the file before choosing **Settings → Import backup**. Selecting a valid file starts the merge; this release does not have a separate import-preview screen. A merge adds missing IDs and keeps existing records; it is not a command to overwrite the entire current database. Repeating the same import should not create duplicate records with the same IDs. Historical audit events are not restored by this import.

The browser accepts workspace JSON backups under 7 MB with up to 2,000 records. Legacy Base44 files need conversion to the workspace format first; the repository includes conversion utilities, but the browser does not convert them automatically. Original imported provenance can contain the full source record, so a backup containing imported records may reveal much more than the visible display name. Use only files you intend to bring into the workspace.

## Move to another deployment

1. Export from the original app and keep the file private.
2. Create and verify the new empty deployment with its own credentials and storage.
3. Review the file, then use **Import backup** in the new app to merge it.
4. Check people–project links, targets, archived records and custom settings.
5. Move attachments separately and update their links as appropriate.
6. Reconnect your assistants to the new `/mcp` URL and revoke grants on the old app when the move is complete.

Retain the old app until you have checked the transfer. Deleting a Worker does not necessarily remove all of its separately provisioned databases, buckets or namespaces; manage those resources deliberately in your cloud account.

## Demo data

The public demo is intentionally fabricated, including descriptions, updates and source URLs. It is not a sanitized export of a real lab. Use a fresh local clone for demonstrations and recordings. Do not record your real workspace and rely on changing only its names afterward.
