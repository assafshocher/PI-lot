#!/usr/bin/env node
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { demoCounts, demoSql, parseSeedArgs, rebaseDemo } from "../demo/fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function main() {
  const options = parseSeedArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/seed-demo.mjs --demo [--dry-run] [--date YYYY-MM-DD]\n\nLoads wholly fictional sample records into local D1 only. Run migrations first.\nExisting records are preserved. Remote databases are never supported.");
    return;
  }
  const fixture = rebaseDemo(JSON.parse(await readFile(join(root, "demo/fictional-lab.json"), "utf8")), options.date);
  const sql = demoSql(fixture);
  console.log(`Fictional demo, anchored to ${options.date}: ${JSON.stringify(demoCounts(fixture))}`);
  if (options.dryRun) { console.log("Validated. No database was changed."); return; }
  const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
  await access(wrangler).catch(() => { throw new Error("Install the project dependencies before loading the demo."); });
  await access(join(root, "wrangler.jsonc")).catch(() => { throw new Error("The project needs wrangler.jsonc with a DB binding."); });
  const directory = await mkdtemp(join(tmpdir(), "pi-app-demo-"));
  try {
    const path = join(directory, "fictional-demo.sql");
    await writeFile(path, sql, { mode: 0o600 });
    const code = await new Promise((resolveCode, reject) => {
      const child = spawn(process.execPath, [wrangler, "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--file", path], { cwd: root, stdio: "inherit", shell: false });
      child.once("error", reject); child.once("exit", code => resolveCode(code ?? 1));
    });
    if (code !== 0) throw new Error("The local demo could not be loaded. Apply local D1 migrations first, then retry; existing records are preserved.");
    console.log("Fictional demo loaded into local D1 for owner. No remote database was contacted.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
