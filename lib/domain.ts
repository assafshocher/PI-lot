import { z } from "zod";
import { trustedAuth } from "./auth-context.ts";

export class AppError extends Error {
  status: number; code: string; details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) { super(message); this.status = status; this.code = code; this.details = details; }
}
export const kinds = ["project", "student", "deadline", "deadline_target", "project_update", "lab_setting", "meal", "saved_dish", "nutrition_goal", "nutrition_profile", "measurement", "daily_expenditure", "daily_checkin", "user_fact", "workout_schedule"] as const;
export type RecordKind = typeof kinds[number];
export type AppRecord = { id: string; kind: RecordKind; revision: number; data: Record<string, unknown>; created_at: string; updated_at: string; deleted_at: string | null };
export const idSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
export const mutationKeySchema = z.string().min(1).max(180).regex(/^[a-zA-Z0-9_.:/-]+$/);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Use a real calendar date");
const short = z.string().trim().max(240), long = z.string().max(100_000);
const safeUrl = z.string().max(2048).refine(v => !v || /^https?:\/\//i.test(v) || /^\/api\/files\/[a-zA-Z0-9_-]+$/.test(v), "Use an https/http URL or a private attachment URL");
const timezone = z.string().max(80).refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Choose a valid IANA timezone").default("Asia/Jerusalem");
const deadlineTimezone = z.preprocess(v => v === "" || v === null ? "unknown" : v === undefined || v === "Anywhere on Earth" || v === "AoE" ? "Etc/GMT+12" : v, z.union([z.literal("unknown"), timezone]));
const links = z.array(z.object({ label: short.default(""), url: safeUrl })).max(100).default([]);
const files = z.array(z.object({ name: short, url: safeUrl, id: idSchema.optional(), size: z.number().nonnegative().optional() })).max(100).default([]);
const base = { name: short.min(1), details: z.string().max(4000).default(""), notes: long.default(""), links, files };
export const nutrientKeys = ["calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium", "added_sugar", "saturated_fat", "unsaturated_fat", "omega3", "calcium", "iron"] as const;
export type NutrientKey = typeof nutrientKeys[number];
export type Nutrients = Record<NutrientKey, number | null>;
const nutrientValue = z.number().finite().nonnegative().max(1_000_000).nullable();
const nutrientShape = Object.fromEntries(nutrientKeys.map(k => [k, nutrientValue.optional().default(null)])) as Record<NutrientKey, z.ZodDefault<z.ZodOptional<typeof nutrientValue>>>;
const nutrientSchema = z.object(nutrientShape);
export const ingredientSchema = z.object({
  name: short.min(1), quantity: z.number().positive().max(100_000).default(1), unit: short.default("serving"),
  grams: z.number().positive().max(100_000).nullable().optional(), servings: z.number().positive().max(100_000).optional(),
  basis: z.enum(["per_100g", "per_serving", "total"]).default("total"), nutrients: nutrientSchema.default({}),
  source: z.string().max(2000).default("User entry"), source_url: safeUrl.optional(), confidence: z.enum(["measured", "label", "estimated", "unknown"]).default("unknown"),
}).superRefine((v, ctx) => {
  if (v.basis === "per_100g" && !(v.grams && v.grams > 0)) ctx.addIssue({ code: "custom", message: "Per-100g nutrition requires consumed grams", path: ["grams"] });
  for (const [part, whole] of [["added_sugar", "sugar"], ["sugar", "carbs"], ["omega3", "unsaturated_fat"], ["unsaturated_fat", "fat"]] as const) {
    if (v.nutrients[part] != null && v.nutrients[whole] != null && v.nutrients[part]! > v.nutrients[whole]! + 0.1) ctx.addIssue({ code: "custom", message: `${part} cannot exceed ${whole}`, path: ["nutrients", part] });
  }
  if (v.nutrients.saturated_fat != null && v.nutrients.unsaturated_fat != null && v.nutrients.fat != null && v.nutrients.saturated_fat + v.nutrients.unsaturated_fat > v.nutrients.fat + 0.1) ctx.addIssue({ code: "custom", message: "Fat components cannot exceed total fat", path: ["nutrients", "fat"] });
});
export type Ingredient = z.infer<typeof ingredientSchema>;
const meal = z.object({ name: short.min(1), consumed_at: z.string().datetime({ offset: true }).nullish(), date: dateSchema.optional(), time_precision: z.enum(["time", "date"]).default("time"), timezone, meal_type: short.min(1).default("other"), ingredients: z.array(ingredientSchema).min(1).max(100), notes: long.default(""), source_message_id: z.string().max(180).optional(), saved_dish_id: idSchema.optional(), confirmed: z.boolean().optional(), source: short.default("manual") }).refine(v => v.time_precision === "date" ? Boolean(v.date) : Boolean(v.consumed_at), "Provide a meal timestamp, or a historical date with time_precision=date");
const optionalMeasure = z.number().finite().nonnegative().max(10000).nullish();
const expectedWindow = z.object({ start: dateSchema, end: dateSchema, basis: z.string().trim().min(1).max(2000) }).strict().refine(v => v.start <= v.end, "The expected window must end on or after its start");
const schemas: Record<RecordKind, z.ZodTypeAny> = {
  project: z.object({ ...base, status: short.default("Planning"), deadline_id: idSchema.nullish().or(z.literal("")), merged_into_project_id: idSchema.optional(), connected_students: z.array(idSchema).optional() }),
  student: z.object({ ...base, degree: short.default(""), lab_status: short.default("Active"), stage: short.default(""), email: z.string().email().or(z.literal("")).optional(), next_action: z.string().max(2000).default(""), connected_projects: z.array(idSchema).optional() }),
  deadline: z.object({ conference_name: short.min(1), venue: short.optional(), cycle: z.preprocess(v => typeof v === "number" && Number.isFinite(v) ? String(v) : v, short.optional()), topics: z.array(short).max(30).optional(), expected_window: expectedWindow.optional(), date: dateSchema.or(z.literal("")).nullable().optional(), date_status: z.enum(["confirmed", "estimated", "tba"]).default("confirmed"), deadline_type: z.enum(["final", "abstract", "other"]).default("final"), url: safeUrl.default(""), notes: long.default(""), timezone: deadlineTimezone, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), precision: z.enum(["date", "time"]).default("date"), source: z.string().max(2000).optional(), verified_at: z.string().datetime({ offset: true }).optional() }).refine(v => v.date_status === "tba" || Boolean(v.date) || v.date_status === "estimated" && Boolean(v.expected_window), "Confirmed deadlines need an exact date; estimated deadlines need a date or expected window; otherwise mark TBA").refine(v => v.precision !== "time" || Boolean(v.time) && v.timezone !== "unknown", "Time precision requires a recorded time and a known timezone"),
  deadline_target: z.object({ project_id: idSchema, deadline_id: idSchema, status: z.enum(["suggested", "tentative", "confirmed", "submitted"]).default("suggested"), outcome: z.enum(["pending", "accepted", "rejected"]).optional(), notes: z.string().max(4000).default(""), confidence: z.enum(["low", "medium", "high"]).optional(), source: z.string().max(2000).optional(), source_url: safeUrl.optional(), verified_at: z.string().datetime({ offset: true }).optional() }).refine(v => v.outcome === undefined || v.status === "submitted", { message: "A decision can only be recorded for an actual submission", path: ["outcome"] }),
  project_update: z.object({ project_id: idSchema, title: short.min(1), summary: z.string().min(1).max(12000), date: dateSchema, sources: links, next_action: z.string().max(2000).default(""), status: short.default("") }),
  lab_setting: z.object({ setting_type: z.enum(["project_statuses", "student_lab_statuses", "student_degrees"]), options: z.array(z.object({ label: short.min(1), color: z.string().max(50).nullable().default("#64748b") })).max(100) }),
  meal,
  saved_dish: z.object({ name: short.min(1), ingredients: z.array(ingredientSchema).min(1).max(100), servings: z.number().positive().max(1000).default(1), notes: long.default(""), tags: z.array(short).max(30).default([]), category: short.default("other"), serving_size: short.default("1 serving") }),
  nutrition_goal: z.object({ ...nutrientShape, name: short.default("Daily targets"), goal_type: z.enum(["daily", "weekly"]).default("daily"), is_active: z.boolean().default(true), tdee: nutrientValue.optional(), timezone, notes: long.default("") }),
  nutrition_profile: z.object({ name: short.default("My nutrition profile"), display_name: short.optional(), height_cm: z.number().positive().max(300).nullish(), age_years: z.number().min(1).max(130).nullish(), equation_sex: z.enum(["male", "female"]).nullish(), activity_factor: z.number().min(1).max(3).nullish(), weight_kg: z.number().positive().max(1000).nullish(), body_fat_pct: z.number().min(0).max(100).nullish(), timezone, dietary_preferences: z.array(short).max(50).default([]), allergies: z.array(short).max(50).default([]), notes: long.default("") }),
  measurement: z.object({ date: dateSchema, weight_kg: optionalMeasure, body_fat_pct: z.number().min(0).max(100).nullish(), waist_cm: optionalMeasure, chest_cm: optionalMeasure, arm_cm: optionalMeasure, notes: z.string().max(2000).default("") }),
  daily_expenditure: z.object({ date: dateSchema, base_tdee: nutrientValue.optional(), additional_burn: nutrientValue.optional(), total_expenditure: nutrientValue.optional(), activity_notes: z.string().max(4000).default("") }),
  daily_checkin: z.object({ date: dateSchema, nutrition_complete: z.boolean(), reconfirmation_required: z.boolean().optional(), timezone, notes: z.string().max(2000).default("") }),
  user_fact: z.object({ fact: z.string().min(1).max(4000), category: z.enum(["medical", "diet", "personal", "preference", "goal", "measurement", "other"]).default("other"), date: dateSchema.optional(), is_active: z.boolean().default(true) }),
  workout_schedule: z.object({ day_of_week: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]), workout_type: short.min(1), duration_minutes: optionalMeasure, estimated_calories_burned: nutrientValue.optional(), notes: z.string().max(4000).default(""), is_active: z.boolean().default(true) }),
};
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, "invalid_input", "Please check the submitted fields.", result.error.flatten());
  return result.data;
}
export function normalizeData(kind: RecordKind, value: unknown): Record<string, unknown> {
  const data = parse(schemas[kind], value) as Record<string, unknown>;
  delete data.connected_students; delete data.connected_projects;
  if (kind === "deadline" && (data.date_status === "tba" || data.date_status === "estimated" && !data.date && data.expected_window)) { data.date = null; delete data.time; data.precision = "date"; }
  if (kind === "meal" || kind === "saved_dish") {
    Object.assign(data, calculateNutrition(data.ingredients as Ingredient[]));
    if (kind === "meal") {
      if (data.time_precision === "date") data.consumed_at = null;
      else { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: data.timezone as string, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(data.consumed_at as string)); data.date = ["year", "month", "day"].map(k => parts.find(p => p.type === k)?.value).join("-"); }
    }
  }
  if (kind === "daily_checkin" && data.nutrition_complete === true) data.reconfirmation_required = false;
  if (kind === "daily_expenditure" && data.base_tdee != null && data.additional_burn != null) data.total_expenditure = (data.base_tdee as number) + (data.additional_burn as number);
  const provenance = value && typeof value === "object" ? (value as Record<string, unknown>).import_provenance : undefined;
  if (provenance !== undefined) {
    data.import_provenance = parse(z.object({ source: z.literal("Base44"), entity: z.string().max(120), original_id: z.string().max(200).optional(), original_record: z.record(z.unknown()) }).strict().refine(v => JSON.stringify(v).length <= 100_000, "Original import record is too large"), provenance);
  }
  return data;
}
export function calculateNutrition(ingredients: Ingredient[]) {
  const totals = {} as Nutrients, known_totals = {} as Record<NutrientKey, number>, completeness = {} as Record<NutrientKey, { known: number; total: number }>;
  for (const key of nutrientKeys) {
    let sum = 0, known = 0;
    for (const item of ingredients) {
      const value = item.nutrients[key]; if (value == null) continue;
      const factor = item.basis === "per_100g" ? (item.grams ?? 0) / 100 : item.basis === "per_serving" ? (item.servings ?? item.quantity) : 1;
      sum += value * factor; known++;
    }
    known_totals[key] = Math.round(sum * 100) / 100; totals[key] = known === ingredients.length ? known_totals[key] : null; completeness[key] = { known, total: ingredients.length };
  }
  return { totals, known_totals, completeness };
}
export function summarizeMeals(records: AppRecord[], date?: string) {
  const selected = records.filter(r => r.kind === "meal" && !r.deleted_at && (!date || r.data.date === date));
  return { date: date ?? null, meal_count: selected.length, ...calculateNutrition(selected.flatMap(r => r.data.ingredients as Ingredient[])), meals: selected };
}
export function requestIdentity(request: Request) {
  void request; // Request headers, email, query parameters and tool metadata are never identity.
  const auth = trustedAuth();
  if (!auth?.userId) throw new AppError(401, "sign_in_required", "Sign in to access your private workspace.");
  return auth.userId;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin"), fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || fetchSite === "cross-site") throw new AppError(403, "invalid_origin", "This request must come from this app.");
}
export const createSchema = z.object({ kind: z.enum(kinds), data: z.record(z.unknown()), id: idSchema.optional(), idempotency_key: mutationKeySchema.optional() }).strict();
export const updateSchema = z.object({ data: z.record(z.unknown()), expected_revision: z.number().int().positive(), idempotency_key: mutationKeySchema.optional() }).strict();
export const revisionSchema = z.object({ expected_revision: z.number().int().positive(), idempotency_key: mutationKeySchema.optional() }).strict();
export const linkSchema = z.object({ project_id: idSchema, student_id: idSchema, linked: z.boolean(), idempotency_key: mutationKeySchema.optional() }).strict();
