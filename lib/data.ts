import { env } from "cloudflare:workers";
import { AppError, type AppRecord, type RecordKind, normalizeData, parse, idSchema, mutationKeySchema } from "./domain";
import { allowedKinds, assertKind, assertProductionScope, hasLab, isKindAllowed, WORKSPACE_KIND } from "./workspace";

type Row = { id: string; kind: RecordKind; revision: number; data_json: string; created_at: string; updated_at: string; deleted_at: string | null };
type Mutation = { request_hash: string; attempt_id: string; response_json: string | null };
export function database(): D1Database {
  assertProductionScope();
  if (!env.DB) throw new AppError(503, "storage_unavailable", "Private storage is not connected yet. Your changes were not saved.");
  return env.DB;
}
function fromRow(row: Row): AppRecord { return { id: row.id, kind: row.kind, revision: row.revision, data: JSON.parse(row.data_json), created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at }; }
const snapshot = "json_object('id',id,'kind',kind,'revision',revision,'data',json(data_json),'created_at',created_at,'updated_at',updated_at,'deleted_at',deleted_at)";
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function hash(value: unknown) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value))))).map(n => n.toString(16).padStart(2, "0")).join(""); }
async function enrich(user: string, records: AppRecord[]): Promise<AppRecord[]> {
  if (!records.some(r => r.kind === "project" || r.kind === "student")) return records;
  const { results } = await database().prepare("SELECT project_id,student_id FROM lab_links WHERE user_id=?").bind(user).all<{ project_id: string; student_id: string }>();
  return records.map(r => ({ ...r, data: { ...r.data, ...(r.kind === "project" ? { connected_students: results.filter(l => l.project_id === r.id).map(l => l.student_id) } : r.kind === "student" ? { connected_projects: results.filter(l => l.student_id === r.id).map(l => l.project_id) } : {}) } }));
}
export async function listRecords(user: string, options: { kind?: RecordKind; query?: string; archived?: string; date?: string; limit?: number; offset?: number } = {}) {
  if (options.kind) assertKind(options.kind);
  const scope = allowedKinds(), where = ["user_id=?", "kind IN (" + scope.map(() => "?").join(",") + ")"], args: (string | number)[] = [user, ...scope];
  if (options.kind) { where.push("kind=?"); args.push(options.kind); }
  if (options.archived === "true") where.push("deleted_at IS NOT NULL"); else if (options.archived !== "all") where.push("deleted_at IS NULL");
  if (options.query) { where.push("data_json LIKE ? ESCAPE '\\'"); args.push(`%${options.query.replace(/[\\%_]/g, "\\$&")}%`); }
  if (options.date) { where.push("json_extract(data_json,'$.date')=?"); args.push(options.date); }
  const limit = Math.min(Math.max(options.limit ?? 1000, 1), 2000), offset = Math.max(options.offset ?? 0, 0);
  const { results } = await database().prepare(`SELECT * FROM records WHERE ${where.join(" AND ")} ORDER BY updated_at DESC,id ASC LIMIT ? OFFSET ?`).bind(...args, limit + 1, offset).all<Row>();
  return { records: await enrich(user, results.slice(0, limit).map(fromRow)), has_more: results.length > limit, next_offset: results.length > limit ? offset + limit : null };
}
export async function getRecord(user: string, id: string, active = false): Promise<AppRecord> {
  parse(idSchema, id);
  const row = await database().prepare(`SELECT * FROM records WHERE user_id=? AND id=?${active ? " AND deleted_at IS NULL" : ""}`).bind(user, id).first<Row>();
  if (!row || !isKindAllowed(row.kind)) throw new AppError(404, "not_found", "The record could not be found.");
  return (await enrich(user, [fromRow(row)]))[0];
}
async function getMutation(user: string, key: string, requestHash: string) {
  const prior = await database().prepare("SELECT request_hash,attempt_id,response_json FROM mutations WHERE user_id=? AND key=?").bind(user, key).first<Mutation>();
  if (prior && prior.request_hash !== requestHash) throw new AppError(409, "idempotency_conflict", "This message or request key was already used for different content. Use a new key for a new action.");
  return prior;
}
function mutationResult(prior: Mutation) {
  if (!prior.response_json) throw new AppError(409, "revision_conflict", "This record changed or was archived. Refresh it before saving again.");
  const result = JSON.parse(prior.response_json);
  if (result.mutation_error === "target_already_linked") throw new AppError(409, "target_already_linked", "This project already has an active target for that deadline. Refresh and edit the existing target instead.");
  return result;
}
const matchingTarget = "SELECT 1 FROM records t WHERE t.user_id=? AND t.kind='deadline_target' AND t.deleted_at IS NULL AND t.id<>? AND json_extract(t.data_json,'$.project_id')=? AND json_extract(t.data_json,'$.deadline_id')=?";
function validateMergeSelfReference(kind: RecordKind, data: Record<string, unknown>, id: string) {
  if (kind === "project" && data.merged_into_project_id === id) throw new AppError(400, "invalid_reference", "A project cannot be merged into itself.");
}
export async function writeRecord(user: string, input: { id?: string; kind?: RecordKind; data?: Record<string, unknown>; expected_revision?: number; idempotency_key?: string }, action: "create" | "update" | "archive" | "restore" = "create"): Promise<AppRecord> {
  if (input.kind) assertKind(input.kind);
  const db = database(), key = input.idempotency_key ? parse(mutationKeySchema, input.idempotency_key) : crypto.randomUUID();
  const requestHash = await hash({ action, ...input, idempotency_key: undefined });
  const prior = await getMutation(user, key, requestHash);
  if (prior) { const result = mutationResult(prior) as AppRecord; assertKind(result.kind); return (await enrich(user, [result]))[0]; }
  const id = input.id ? parse(idSchema, input.id) : crypto.randomUUID(), now = new Date().toISOString(), attempt = crypto.randomUUID();
  const current = action === "create" ? null : await getRecord(user, id);
  const kind = input.kind ?? current?.kind;
  if (!kind) throw new AppError(400, "invalid_kind", "Choose a record kind.");
  assertKind(kind);
  const data = action === "create" || action === "update" ? normalizeData(kind, input.data) : current!.data;
  if (action === "create" || action === "update") validateMergeSelfReference(kind, data, id);
  const references: { field: "deadline_id" | "project_id" | "merged_into_project_id"; id: string; kind: RecordKind }[] = [];
  if ((kind === "project" || kind === "deadline_target") && data.deadline_id) references.push({ field: "deadline_id", id: String(data.deadline_id), kind: "deadline" });
  if (kind === "project" && data.merged_into_project_id) references.push({ field: "merged_into_project_id", id: String(data.merged_into_project_id), kind: "project" });
  if (kind === "deadline_target" || kind === "project_update") references.push({ field: "project_id", id: String(data.project_id), kind: "project" });
  // Preserve unchanged historical references on unrelated edits, including a
  // target missing from an old export. This grants no access to that target:
  // reads remain tenant-scoped, and new/changed references require an active,
  // owned record both here and inside the revision-guarded transaction.
  const activeReferences = action === "create" || action === "update"
    ? references.filter(reference => action !== "update" || current?.data[reference.field] !== reference.id)
    : [];
  for (const reference of activeReferences) {
    const record = await getRecord(user, reference.id, true);
    if (record.kind !== reference.kind) throw new AppError(400, "invalid_reference", "The selected record is not a " + reference.kind + ".");
  }
  const guard = "EXISTS (SELECT 1 FROM mutations WHERE user_id=? AND key=? AND attempt_id=?)";
  const args = [user, key, attempt];
  const deadlineGuard = activeReferences.map(() => " AND EXISTS (SELECT 1 FROM records d WHERE d.user_id=? AND d.id=? AND d.kind=? AND d.deleted_at IS NULL)").join("");
  const deadlineArgs = activeReferences.flatMap(r => [user, r.id, r.kind]);
  // D1 executes each batch transaction serially. Check inside the write, not only
  // in a preflight read, so two clients cannot add the same active target pair.
  // Existing duplicate pairs remain editable without silently deleting history.
  const guardTargetPair = kind === "deadline_target" && (action === "create" || action === "restore" || action === "update" && (data.project_id !== current?.data.project_id || data.deadline_id !== current?.data.deadline_id));
  const targetArgs = guardTargetPair ? [user, id, String(data.project_id), String(data.deadline_id)] : [];
  const targetGuard = guardTargetPair ? ` AND NOT EXISTS (${matchingTarget})` : "";
  const statements = [db.prepare("INSERT OR IGNORE INTO mutations(user_id,key,request_hash,attempt_id,created_at) VALUES(?,?,?,?,?)").bind(user, key, requestHash, attempt, now)];
  if (action === "create") statements.push(db.prepare(`INSERT OR IGNORE INTO records(id,user_id,kind,revision,data_json,created_at,updated_at,deleted_at,last_mutation_id) SELECT ?,?,?,1,?,?,?,NULL,? WHERE ${guard}${deadlineGuard}${targetGuard}`).bind(id, user, kind, JSON.stringify(data), now, now, attempt, ...args, ...deadlineArgs, ...targetArgs));
  else if (action === "update") statements.push(db.prepare(`UPDATE records SET data_json=?,revision=revision+1,updated_at=?,last_mutation_id=? WHERE user_id=? AND id=? AND revision=? AND deleted_at IS NULL AND ${guard}${deadlineGuard}${targetGuard}`).bind(JSON.stringify(data), now, attempt, user, id, input.expected_revision ?? -1, ...args, ...deadlineArgs, ...targetArgs));
  else statements.push(db.prepare(`UPDATE records SET deleted_at=?,revision=revision+1,updated_at=?,last_mutation_id=? WHERE user_id=? AND id=? AND revision=? AND deleted_at IS ${action === "restore" ? "NOT " : ""}NULL AND ${guard}${targetGuard}`).bind(action === "archive" ? now : null, now, attempt, user, id, input.expected_revision ?? -1, ...args, ...targetArgs));
  if (kind === "meal") {
    // A whole-day confirmation describes a particular log. Changing it requires the
    // user to confirm again, and must be in the same transaction as the meal write.
    const dates = [...new Set([current?.data.date, data.date].filter((value): value is string => typeof value === "string"))];
    const changedMeal = "EXISTS (SELECT 1 FROM records m WHERE m.user_id=? AND m.id=? AND m.last_mutation_id=?)";
    statements.push(db.prepare(`UPDATE records SET data_json=json_set(data_json,'$.nutrition_complete',json('false'),'$.reconfirmation_required',json('true')),revision=revision+1,updated_at=?,last_mutation_id=? WHERE user_id=? AND kind='daily_checkin' AND deleted_at IS NULL AND json_extract(data_json,'$.nutrition_complete')=1 AND json_extract(data_json,'$.date') IN (${dates.map(() => "?").join(",")}) AND ${changedMeal}`).bind(now, attempt, user, ...dates, user, id, attempt));
    statements.push(db.prepare("INSERT INTO audit_events(id,user_id,record_id,action,revision,data_json,created_at) SELECT ?||id,user_id,id,'meal_changed_reconfirm',revision,data_json,? FROM records WHERE user_id=? AND kind='daily_checkin' AND last_mutation_id=?").bind(attempt, now, user, attempt));
  }
  statements.push(db.prepare("INSERT INTO audit_events(id,user_id,record_id,action,revision,data_json,created_at) SELECT ?,user_id,id,?,revision,data_json,? FROM records WHERE user_id=? AND id=? AND last_mutation_id=?").bind(attempt, action, now, user, id, attempt));
  const response = `(SELECT ${snapshot} FROM records WHERE user_id=? AND id=? AND last_mutation_id=?)`;
  const result = guardTargetPair ? `COALESCE(${response},(SELECT json_object('mutation_error','target_already_linked') WHERE EXISTS (${matchingTarget})))` : response;
  statements.push(db.prepare(`UPDATE mutations SET response_json=${result} WHERE user_id=? AND key=? AND attempt_id=?`).bind(user, id, attempt, ...targetArgs, ...args));
  await db.batch(statements);
  return (await enrich(user, [mutationResult((await getMutation(user, key, requestHash))!)]))[0];
}
export async function setLabLink(user: string, input: { project_id: string; student_id: string; linked: boolean; idempotency_key?: string }) {
  assertKind("project");
  const db = database(), key = input.idempotency_key ?? crypto.randomUUID(), requestHash = await hash({ action: "lab_link", ...input, idempotency_key: undefined });
  const prior = await getMutation(user, key, requestHash);
  if (prior) { mutationResult(prior); return { project: await getRecord(user, input.project_id), student: await getRecord(user, input.student_id) }; }
  const [project, student] = await Promise.all([getRecord(user, input.project_id, true), getRecord(user, input.student_id, true)]);
  if (project.kind !== "project" || student.kind !== "student") throw new AppError(400, "invalid_relation", "Link one project and one student.");
  const attempt = crypto.randomUUID(), now = new Date().toISOString();
  const guard = "EXISTS (SELECT 1 FROM mutations WHERE user_id=? AND key=? AND attempt_id=?) AND EXISTS (SELECT 1 FROM records WHERE user_id=? AND id=? AND kind='project' AND deleted_at IS NULL) AND EXISTS (SELECT 1 FROM records WHERE user_id=? AND id=? AND kind='student' AND deleted_at IS NULL)";
  const args = [user, key, attempt, user, project.id, user, student.id];
  const statements = [db.prepare("INSERT OR IGNORE INTO mutations(user_id,key,request_hash,attempt_id,created_at) VALUES(?,?,?,?,?)").bind(user, key, requestHash, attempt, now)];
  statements.push(input.linked ? db.prepare(`INSERT OR IGNORE INTO lab_links(user_id,project_id,student_id,created_at) SELECT ?,?,?,? WHERE ${guard}`).bind(user, project.id, student.id, now, ...args) : db.prepare(`DELETE FROM lab_links WHERE user_id=? AND project_id=? AND student_id=? AND ${guard}`).bind(user, project.id, student.id, ...args));
  statements.push(db.prepare(`UPDATE records SET revision=revision+1,updated_at=?,last_mutation_id=? WHERE user_id=? AND id IN (?,?) AND ${guard}`).bind(now, attempt, user, project.id, student.id, ...args));
  statements.push(db.prepare("INSERT INTO audit_events(id,user_id,record_id,action,revision,data_json,created_at) SELECT ?||id,user_id,id,?,revision,?,? FROM records WHERE user_id=? AND last_mutation_id=?").bind(attempt, input.linked ? "link" : "unlink", JSON.stringify({ project_id: project.id, student_id: student.id }), now, user, attempt));
  statements.push(db.prepare("UPDATE mutations SET response_json=(SELECT json_object('linked',?,'project_id',?,'student_id',?) FROM records WHERE user_id=? AND id=? AND last_mutation_id=?) WHERE user_id=? AND key=? AND attempt_id=?").bind(Number(input.linked), project.id, student.id, user, project.id, attempt, user, key, attempt));
  await db.batch(statements); mutationResult((await getMutation(user, key, requestHash))!);
  return { project: await getRecord(user, project.id), student: await getRecord(user, student.id) };
}
export async function exportData(user: string) {
  const db = database(), scope = allowedKinds(), scopeSql = "kind IN (" + scope.map(() => "?").join(",") + ")";
  const [rows, links, files, audit] = await Promise.all([
    db.prepare("SELECT * FROM records WHERE user_id=? AND " + scopeSql + " ORDER BY created_at,id").bind(user, ...scope).all<Row>(),
    hasLab ? db.prepare("SELECT project_id,student_id,created_at FROM lab_links WHERE user_id=?").bind(user).all() : Promise.resolve({ results: [] }),
    hasLab ? db.prepare("SELECT id,name,content_type,size,created_at FROM files WHERE user_id=?").bind(user).all() : Promise.resolve({ results: [] }),
    db.prepare("SELECT record_id,action,revision,data_json,created_at FROM audit_events WHERE user_id=? AND record_id IN (SELECT id FROM records WHERE user_id=? AND " + scopeSql + ") ORDER BY created_at").bind(user, user, ...scope).all(),
  ]);
  return { format: "private-app-backup", app: WORKSPACE_KIND, version: 1, exported_at: new Date().toISOString(), records: await enrich(user, rows.results.map(fromRow)), links: links.results, files: files.results, audit_events: audit.results, attachment_note: "Attachment metadata is included. Download attachment files separately; private URLs require this app's sign-in." };
}
export async function importData(user: string, input: { records: { id: string; kind: RecordKind; data: Record<string, unknown>; deleted_at?: string | null; created_at?: string }[]; links?: { project_id: string; student_id: string }[] }) {
  // Validate the complete payload before any writes. Safe merge never overwrites an existing id.
  if (input.links?.length) assertKind("project");
  const prepared = input.records.map(r => { assertKind(r.kind); const id = parse(idSchema, r.id), data = normalizeData(r.kind, r.data); validateMergeSelfReference(r.kind, data, id); return { ...r, id, data }; });
  if (new Set(prepared.map(r => r.id)).size !== prepared.length) throw new AppError(400, "duplicate_ids", "The import contains duplicate record IDs.");
  const db = database(), now = new Date().toISOString(); let created = 0;
  if (prepared.some(r => r.kind === "deadline_target" && !r.deleted_at)) {
    const existing = await db.prepare("SELECT id,kind,data_json,deleted_at FROM records WHERE user_id=?").bind(user).all<Row>();
    const ids = new Set(existing.results.map(r => r.id));
    const pairs = new Set(existing.results.filter(r => r.kind === "deadline_target" && !r.deleted_at).map(r => { const data = JSON.parse(r.data_json); return JSON.stringify([data.project_id, data.deadline_id]); }));
    for (const record of prepared.filter(r => r.kind === "deadline_target" && !r.deleted_at && !ids.has(r.id))) {
      const pair = JSON.stringify([record.data.project_id, record.data.deadline_id]);
      if (pairs.has(pair)) throw new AppError(409, "target_already_linked", "The import would add a duplicate active project/deadline target. Keep the existing target or archive it first; no import records were written.");
      pairs.add(pair);
    }
  }
  for (let start = 0; start < prepared.length; start += 40) {
    const chunk = prepared.slice(start, start + 40);
    const batch = chunk.flatMap(r => {
      const attempt = crypto.randomUUID();
      const guardPair = r.kind === "deadline_target" && !r.deleted_at;
      return [db.prepare(`INSERT OR IGNORE INTO records(id,user_id,kind,revision,data_json,created_at,updated_at,deleted_at,last_mutation_id) SELECT ?,?,?,1,?,?,?,?,?${guardPair ? ` WHERE NOT EXISTS (${matchingTarget})` : ""}`).bind(r.id, user, r.kind, JSON.stringify(r.data), r.created_at ?? now, now, r.deleted_at ?? null, attempt, ...(guardPair ? [user, r.id, String(r.data.project_id), String(r.data.deadline_id)] : [])), db.prepare("INSERT INTO audit_events(id,user_id,record_id,action,revision,data_json,created_at) SELECT ?,user_id,id,'import',revision,data_json,? FROM records WHERE user_id=? AND id=? AND last_mutation_id=?").bind(attempt, now, user, r.id, attempt)];
    });
    const results = await db.batch(batch); created += results.filter((_, i) => i % 2 === 0).reduce((n, r) => n + r.meta.changes, 0);
    // A concurrent create can win after preflight. Do not silently label that
    // skipped target an existing ID; report the conflict and preserve both logs.
    for (let i = 0; i < chunk.length; i++) if (chunk[i].kind === "deadline_target" && !chunk[i].deleted_at && !results[i * 2].meta.changes) {
      const exists = await db.prepare("SELECT id FROM records WHERE user_id=? AND id=?").bind(user, chunk[i].id).first();
      if (!exists) throw new AppError(409, "target_already_linked", "Another request added this project/deadline target during import. Already imported records are preserved; refresh before retrying the remaining records.");
    }
  }
  const owned = await db.prepare("SELECT id,kind FROM records WHERE user_id=?").bind(user).all<{ id: string; kind: string }>();
  const ownedKinds = new Map(owned.results.map(r => [r.id, r.kind]));
  const validLinks = (input.links ?? []).filter(l => ownedKinds.get(l.project_id) === "project" && ownedKinds.get(l.student_id) === "student");
  let linksCreated = 0;
  for (let start = 0; start < validLinks.length; start += 40) {
    const results = await db.batch(validLinks.slice(start, start + 40).map(l => db.prepare("INSERT OR IGNORE INTO lab_links(user_id,project_id,student_id,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE user_id=? AND id=? AND kind='project') AND EXISTS(SELECT 1 FROM records WHERE user_id=? AND id=? AND kind='student')").bind(user, l.project_id, l.student_id, now, user, l.project_id, user, l.student_id)));
    linksCreated += results.reduce((n, r) => n + r.meta.changes, 0);
  }
  return { created, skipped: prepared.length - created, links_created: linksCreated, links_skipped: (input.links?.length ?? 0) - validLinks.length, mode: "merge", message: "Existing records were preserved. Repeating this import is safe." };
}
