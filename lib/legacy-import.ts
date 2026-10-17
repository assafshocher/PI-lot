import { AppError, type RecordKind, kinds, normalizeData, nutrientKeys, parse, idSchema } from "./domain";
import { assertKind } from "./workspace";
export type ImportRecord = { id: string; kind: RecordKind; data: Record<string, unknown>; created_at?: string; deleted_at?: string | null };
export type ImportIssue = { severity: "error" | "warning"; location: string; message: string };
export type ImportPreview = {
  source: "workspace" | "Base44"; records: ImportRecord[]; links: { project_id: string; student_id: string }[];
  counts: Record<string, number>; issues: ImportIssue[]; original_count: number; can_import: boolean;
};
export const LEGACY_ENTITIES: Record<string, RecordKind> = {
  Project: "project", Student: "student", Deadline: "deadline", LabSettings: "lab_setting",
  NutritionLog: "meal", SavedDish: "saved_dish", NutritionGoal: "nutrition_goal", Measurement: "measurement",
  DailyExpenditure: "daily_expenditure", UserFact: "user_fact", WorkoutSchedule: "workout_schedule"
};
const aliases: Record<string, RecordKind> = {};
for (const [name, kind] of Object.entries(LEGACY_ENTITIES)) { aliases[name.toLowerCase()] = kind; aliases[kind] = kind; aliases[kind + "s"] = kind; }
Object.assign(aliases, { projects: "project", students: "student", deadlines: "deadline", settings: "lab_setting", nutritionlogs: "meal", nutrition_logs: "meal", saved_dishes: "saved_dish", saveddishes: "saved_dish", goals: "nutrition_goal", measurements: "measurement", dailyexpenditures: "daily_expenditure", daily_expenditures: "daily_expenditure", userfacts: "user_fact", user_facts: "user_fact", facts: "user_fact", workoutschedules: "workout_schedule", workout_schedules: "workout_schedule", workoutSchedule: "workout_schedule" });
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function stable(value: unknown): string { if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]"; if (object(value)) return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}"; return JSON.stringify(value) ?? "null"; }
async function generatedId(kind: string, row: unknown) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kind + ":" + stable(row))); return "legacy_" + kind + "_" + Array.from(new Uint8Array(bytes)).slice(0, 12).map(n => n.toString(16).padStart(2, "0")).join(""); }
function legacyNutrients(row: Record<string, unknown>, issues: ImportIssue[], location: string) {
  return Object.fromEntries(nutrientKeys.map(key => {
    const value = row[key]; if (value === undefined || value === null || value === "") return [key, null];
    if (typeof value === "number") return [key, value];
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      issues.push({ severity: "warning", location, message: key + " is stored as text; it will be read as the numeric value " + Number(value) + "." }); return [key, Number(value)];
    }
    issues.push({ severity: "error", location, message: key + " is not a numeric nutrition value. Correct the export before importing." }); return [key, null];
  }));
}
function legacyData(kind: RecordKind, row: Record<string, unknown>, entity: string, timezone: string, issues: ImportIssue[], location: string) {
  const data = { ...row };
  for (const key of ["id", "created_date", "updated_date", "created_by", "created_at", "updated_at", "deleted_at"]) delete data[key];
  if (kind === "meal" || kind === "saved_dish") {
    const name = String(row.name ?? row.meal_name ?? "");
    data.name = name;
    if (!Array.isArray(row.ingredients) || !row.ingredients.length) {
      data.ingredients = [{
        name: name || "Historical aggregate", quantity: 1, unit: typeof row.serving_size === "string" ? row.serving_size : "historical portion",
        basis: "total", nutrients: legacyNutrients(row, issues, location), confidence: "unknown",
        source: "Original Base44 " + entity + " aggregate. Ingredient breakdown and accuracy were not recorded."
      }];
      data.notes = [row.notes, "Imported historical aggregate: original nutrient values are preserved; ingredient composition and accuracy are not established."].filter(Boolean).join("\n\n");
    }
    if (kind === "meal") {
      data.timezone = row.timezone ?? timezone;
      if (typeof row.consumed_at === "string" && row.consumed_at) { data.consumed_at = row.consumed_at; data.time_precision = "time"; }
      else { data.date = row.date; data.consumed_at = null; data.time_precision = "date"; }
      data.source = "Base44 import";
    } else { data.servings = row.servings ?? 1; }
  }
  if (kind === "deadline") {
    data.date_status = row.date_status ?? (row.date ? "confirmed" : "tba");
    if (!row.date) issues.push({ severity: "warning", location, message: "No deadline date was present. It will remain TBA." });
  }
  data.import_provenance = { source: "Base44", entity, ...(row.id !== undefined ? { original_id: String(row.id) } : {}), original_record: row };
  return data;
}
export async function prepareImport(input: unknown, options: { entity?: string; timezone?: string } = {}): Promise<ImportPreview> {
  const issues: ImportIssue[] = [], rows: { kind: RecordKind; row: Record<string, unknown>; location: string; entity: string; native: boolean }[] = [];
  const native = object(input) && Array.isArray(input.records) && input.records.every(r => object(r) && typeof r.kind === "string" && object(r.data));
  const source = native ? "workspace" : "Base44";
  const timezone = options.timezone || "Asia/Jerusalem";
  const add = (kind: RecordKind, values: unknown[], entity: string, prefix: string, isNative = false) => {
    values.forEach((row, index) => {
      if (!object(row)) issues.push({ severity: "error", location: prefix + "[" + index + "]", message: "Expected an object record." });
      else rows.push({ kind, row, location: prefix + "[" + index + "]", entity, native: isNative });
    });
  };
  if (native) {
    for (const [index, value] of (input.records as Record<string, unknown>[]).entries()) {
      if (!kinds.includes(value.kind as RecordKind)) issues.push({ severity: "error", location: "records[" + index + "]", message: "Unknown record kind: " + value.kind });
      else rows.push({ kind: value.kind as RecordKind, row: value, location: "records[" + index + "]", entity: String(value.kind), native: true });
    }
  } else if (Array.isArray(input)) {
    const kind = options.entity ? aliases[options.entity.toLowerCase()] : undefined;
    if (!kind) issues.push({ severity: "error", location: "file", message: "Choose the Base44 entity for this plain array before previewing." }); else add(kind, input, options.entity!, "records");
  } else if (object(input)) {
    const entity = typeof input.entity === "string" ? input.entity : typeof input.entity_name === "string" ? input.entity_name : options.entity;
    if (entity && aliases[entity.toLowerCase()] && (Array.isArray(input.data) || Array.isArray(input.records))) add(aliases[entity.toLowerCase()], (input.data ?? input.records) as unknown[], entity, "records");
    else {
      const walk = (entry: Record<string, unknown>, prefix: string, depth: number) => {
        for (const [name, value] of Object.entries(entry)) {
          const kind = aliases[name.toLowerCase()];
          if (Array.isArray(value) && kind) add(kind, value, name, prefix + name);
          else if (Array.isArray(value) && value.length && !["links", "files", "audit_events"].includes(name)) issues.push({ severity: "warning", location: prefix + name, message: "This collection is not supported and will not be imported (" + value.length + " items)." });
          else if (object(value) && depth < 3) walk(value, prefix + name + ".", depth + 1);
        }
      };
      walk(input, "", 0);
    }
  } else issues.push({ severity: "error", location: "file", message: "Expected a workspace backup or a Base44 JSON object/array." });
  if (!rows.length) issues.push({ severity: "error", location: "file", message: "No supported records were found." });
  if (rows.length > 2000) issues.push({ severity: "error", location: "file", message: "Import at most 2,000 records per file." });
  const records: ImportRecord[] = [], idMap = new Map<string, string>(), rowIds = new Map<Record<string, unknown>, string>(), seen = new Set<string>();
  let unzonedCreatedTimestamps = 0;
  for (const entry of rows) {
    const { kind, row, location, entity } = entry;
    try {
      assertKind(kind);
      const id = row.id == null || row.id === "" ? await generatedId(kind, row) : parse(idSchema, String(row.id));
      if (seen.has(id)) throw new AppError(400, "duplicate_id", "Duplicate record ID. Resolve duplicates before importing.");
      seen.add(id); rowIds.set(row, id); if (row.id != null) idMap.set(String(row.id), id);
      const data = normalizeData(kind, entry.native ? row.data : legacyData(kind, row, entity, timezone, issues, location));
      const created = row.created_at ?? row.created_date;
      const explicitOffset = typeof created === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(created);
      const created_at = explicitOffset && Number.isFinite(Date.parse(created as string)) ? new Date(created as string).toISOString() : undefined;
      if (created && !created_at) { if (entry.native) throw new AppError(400, "invalid_created_timestamp", "A native backup creation timestamp needs an explicit timezone offset."); unzonedCreatedTimestamps++; }
      const deleted_at = row.deleted_at == null ? null : typeof row.deleted_at === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(row.deleted_at) && Number.isFinite(Date.parse(row.deleted_at)) ? new Date(row.deleted_at).toISOString() : undefined;
      if (row.deleted_at && deleted_at === undefined) throw new AppError(400, "invalid_archive_date", "The archived timestamp is invalid.");
      records.push({ id, kind, data, ...(created_at ? { created_at } : {}), deleted_at });
    } catch (error) {
      let message = error instanceof Error ? error.message : "This record cannot be read.";
      if (error instanceof AppError && error.details && object(error.details)) {
        const details = error.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
        message = [...Object.entries(details.fieldErrors ?? {}).flatMap(([key, value]) => value.map(v => key + ": " + v)), ...(details.formErrors ?? [])].join(" · ") || message;
      }
      issues.push({ severity: "error", location, message });
    }
  }
  const links: { project_id: string; student_id: string }[] = [], linkSet = new Set<string>();
  const addLink = (p: unknown, s: unknown, location: string) => {
    try {
      const project_id = parse(idSchema, idMap.get(String(p)) ?? p), student_id = parse(idSchema, idMap.get(String(s)) ?? s), key = project_id + ":" + student_id;
      if (!linkSet.has(key)) { links.push({ project_id, student_id }); linkSet.add(key); }
    } catch { issues.push({ severity: "error", location, message: "A relationship contains an invalid record ID." }); }
  };
  if (object(input) && Array.isArray(input.links)) for (const link of input.links) { if (object(link)) addLink(link.project_id, link.student_id, "links"); }
  for (const { row, kind, native: isNative, location } of rows) {
    const data = isNative && object(row.data) ? row.data : row;
    const recordId = rowIds.get(row);
    if (!recordId) continue;
    if (kind === "project" && Array.isArray(data.connected_students)) for (const student of data.connected_students) addLink(recordId, student, location);
    if (kind === "student" && Array.isArray(data.connected_projects)) for (const project of data.connected_projects) addLink(project, recordId, location);
  }
  const byId = new Map(records.map(r => [r.id, r]));
  if (unzonedCreatedTimestamps) issues.push({ severity: "warning", location: "timestamps", message: unzonedCreatedTimestamps + " original creation timestamps have no explicit timezone or are invalid. Their original strings are retained in provenance; the new record creation time will be the import time. Meal calendar dates are unchanged." });
  for (const link of links) if (!byId.has(link.project_id) || !byId.has(link.student_id)) issues.push({ severity: "warning", location: "relationships", message: "A linked project or student is not in this file. The relationship can be restored only if both records already exist in your workspace." });
  if (source === "Base44" && records.some(r => r.kind === "meal" || r.kind === "saved_dish")) issues.push({ severity: "warning", location: "nutrition", message: "Historical totals remain historical totals. Missing nutrients stay unknown; date-only meals have no invented time. Original records are retained as private provenance." });
  const counts: Record<string, number> = {}; for (const r of records) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return { source, records, links, counts, issues, original_count: rows.length, can_import: records.length > 0 && !issues.some(i => i.severity === "error") };
}
