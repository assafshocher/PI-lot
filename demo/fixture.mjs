const DAY = 86_400_000;
const KINDS = new Set(["student", "project", "deadline", "deadline_target", "project_update", "lab_setting"]);
export const DEMO_OWNER = "owner";

function dateMillis(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error("Use a date in YYYY-MM-DD format.");
  const millis = Date.parse(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== value) throw new Error("Use a real calendar date.");
  return millis;
}

/** Validate this deliberately limited demo format before it can reach local storage. */
export function validateDemo(fixture) {
  if (fixture?.format !== "private-app-backup" || fixture.app !== "lab" || fixture.version !== 1 || fixture.demo?.fictional !== true) throw new Error("Expected the fictional Lab demo backup.");
  dateMillis(fixture.demo.reference_date);
  if (!Array.isArray(fixture.records) || !fixture.records.length || !Array.isArray(fixture.links)) throw new Error("The demo needs records and relationships.");
  if (fixture.files?.length || fixture.audit_events?.length) throw new Error("Demo data must not include uploaded files or audit history.");
  const records = new Map();
  for (const record of fixture.records) {
    if (!/^demo_[a-zA-Z0-9_-]+$/.test(record.id) || records.has(record.id) || !KINDS.has(record.kind)) throw new Error("Demo records need unique demo_ IDs and Lab record kinds.");
    if (!record.data || typeof record.data !== "object" || Array.isArray(record.data) || record.deleted_at) throw new Error("Demo records must contain active record data.");
    records.set(record.id, record);
    const walk = value => {
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if (["import_provenance", "user_id", "connected_students", "connected_projects"].includes(key)) throw new Error("Demo data cannot contain imported provenance, identities, or embedded relationships.");
        if (key === "files" && item?.length) throw new Error("Demo records cannot contain private attachments.");
        if (["url", "source_url"].includes(key) && item && new URL(item).hostname !== "example.org") throw new Error("Demo links must use example.org.");
        if (key === "email" && item && !/^[^@\s]+@example\.org$/.test(item)) throw new Error("Demo email addresses must use example.org.");
        walk(item);
      }
    };
    walk(record.data);
  }
  const reference = (id, kind) => { if (records.get(id)?.kind !== kind) throw new Error(`Invalid demo ${kind} reference.`); };
  const pairs = new Set();
  for (const record of fixture.records) {
    const data = record.data;
    if (data.deadline_id) reference(data.deadline_id, "deadline");
    if (data.merged_into_project_id) reference(data.merged_into_project_id, "project");
    if (["deadline_target", "project_update"].includes(record.kind)) reference(data.project_id, "project");
    if (record.kind === "deadline_target") {
      reference(data.deadline_id, "deadline");
      if (!["suggested", "tentative", "confirmed", "submitted"].includes(data.status)) throw new Error("Invalid demo target status.");
      if (data.outcome && (data.status !== "submitted" || !["pending", "accepted", "rejected"].includes(data.outcome))) throw new Error("A demo decision needs a submitted target.");
      const pair = `${data.project_id}:${data.deadline_id}`;
      if (pairs.has(pair)) throw new Error("Duplicate demo submission target.");
      pairs.add(pair);
    }
    if (record.kind === "deadline") {
      if (data.date) dateMillis(data.date);
      if (data.expected_window) {
        if (dateMillis(data.expected_window.start) > dateMillis(data.expected_window.end)) throw new Error("Invalid demo planning window.");
      }
      if (!["confirmed", "estimated", "tba"].includes(data.date_status) || (data.date_status === "confirmed" && !data.date)) throw new Error("Invalid demo date certainty.");
    }
  }
  const links = new Set();
  for (const link of fixture.links) {
    reference(link.project_id, "project"); reference(link.student_id, "student");
    const pair = `${link.project_id}:${link.student_id}`;
    if (links.has(pair)) throw new Error("Duplicate demo relationship.");
    links.add(pair);
  }
  return fixture;
}

/** Move the illustrative schedule together, retaining past/future relative distances. */
export function rebaseDemo(fixture, anchor = new Date().toISOString().slice(0, 10)) {
  validateDemo(fixture);
  const delta = dateMillis(anchor) - dateMillis(fixture.demo.reference_date);
  const years = Number(anchor.slice(0, 4)) - Number(fixture.demo.reference_date.slice(0, 4));
  const result = structuredClone(fixture);
  const dateKeys = new Set(["date", "start", "end", "created_at", "updated_at", "exported_at"]);
  const walk = value => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (dateKeys.has(key) && typeof item === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(item)) {
        const shifted = new Date((item.length === 10 ? dateMillis(item) : Date.parse(item)) + delta).toISOString();
        value[key] = item.length === 10 ? shifted.slice(0, 10) : shifted;
      } else walk(item);
    }
  };
  walk(result);
  result.demo.reference_date = anchor;
  for (const record of result.records.filter(record => record.kind === "deadline")) {
    const prior = record.data.cycle;
    if (/^\d{4}$/.test(prior || "")) {
      record.data.cycle = String(Number(prior) + years);
      record.data.conference_name = record.data.conference_name.replace(prior, record.data.cycle);
    }
  }
  return validateDemo(result);
}

/** Wrangler accepts a SQL file, so quote every value as an SQLite string literal. */
export function sqlLiteral(value) {
  if (typeof value !== "string" || value.includes("\0")) throw new Error("SQL values must be strings without NUL characters.");
  return `'${value.replaceAll("'", "''")}'`;
}

/** Additive and repeatable: existing rows and edits are never overwritten. */
export function demoSql(fixture) {
  validateDemo(fixture);
  const sql = ["-- Fictional demo only. Generated for a local D1 database."];
  for (const record of fixture.records) {
    const created = record.created_at || fixture.exported_at, updated = record.updated_at || created;
    const values = [record.id, DEMO_OWNER, record.kind, JSON.stringify(record.data), created, updated, `demo-seed:${record.id}`].map(sqlLiteral);
    sql.push(`INSERT OR IGNORE INTO records (id,user_id,kind,revision,data_json,created_at,updated_at,deleted_at,last_mutation_id) VALUES (${values[0]},${values[1]},${values[2]},1,${values[3]},${values[4]},${values[5]},NULL,${values[6]});`);
  }
  for (const link of fixture.links) {
    const values = [DEMO_OWNER, link.project_id, link.student_id, fixture.exported_at].map(sqlLiteral);
    sql.push(`INSERT OR IGNORE INTO lab_links (user_id,project_id,student_id,created_at) VALUES (${values.join(",")});`);
  }
  return sql.join("\n") + "\n";
}

export function demoCounts(fixture) {
  return { ...Object.fromEntries([...KINDS].map(kind => [kind, fixture.records.filter(record => record.kind === kind).length])), relationships: fixture.links.length };
}

export function parseSeedArgs(args) {
  if (args.some(arg => arg === "--remote" || arg.startsWith("--remote="))) throw new Error("Remote seeding is disabled. This command only writes to local D1.");
  const options = { demo: false, dryRun: false, date: new Date().toISOString().slice(0, 10), help: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--demo") options.demo = true;
    else if (args[i] === "--dry-run") options.dryRun = true;
    else if (args[i] === "--help" || args[i] === "-h") options.help = true;
    else if (args[i] === "--date") options.date = args[++i];
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!options.help && !options.demo) throw new Error("Pass --demo to explicitly load fictional sample data into local D1.");
  dateMillis(options.date);
  return options;
}
