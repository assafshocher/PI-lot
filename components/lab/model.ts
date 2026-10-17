export type LabKind = "project" | "student" | "deadline" | "lab_setting" | "deadline_target" | "project_update";
export type LinkItem = { label?: string; name?: string; url: string };
export type Option = { label: string; color?: string };
export type LabData = {
  name?: string; status?: string; degree?: string; lab_status?: string; details?: string;
  notes?: string; links?: LinkItem[]; files?: LinkItem[]; connected_students?: string[];
  connected_projects?: string[]; deadline_id?: string; merged_into_project_id?: string; conference_name?: string; date?: string;
  deadline_type?: string; url?: string; time?: string; precision?: "date" | "time"; timezone?: string; setting_type?: string;
  stage?: string; email?: string; next_action?: string; date_status?: string; source?: string; verified_at?: string;
  project_id?: string; confidence?: string; source_url?: string; outcome?: "pending" | "accepted" | "rejected";
  title?: string; summary?: string; sources?: { label: string; url: string }[];
  venue?: string; cycle?: string; topics?: string[]; expected_window?: { start: string; end: string; basis: string };
  options?: Option[]; [key: string]: unknown;
};
export type LabRecord = { id: string; kind: LabKind; revision: number; data: LabData; created_at: string; updated_at: string; deleted_at?: string | null };
export type LabState = { projects: LabRecord[]; students: LabRecord[]; deadlines: LabRecord[]; settings: LabRecord[]; targets: LabRecord[]; updates: LabRecord[] };
export type Tab = "overview" | "projects" | "people" | "deadlines" | "connections" | "settings";
export const EMPTY_STATE: LabState = { projects: [], students: [], deadlines: [], settings: [], targets: [], updates: [] };
export const CANDIDATE_STAGES = [{ value: "contacted", label: "Initial contact" }, { value: "exploring", label: "Exploring fit" }, { value: "applied", label: "Applied" }, { value: "interviewing", label: "Interviewing" }, { value: "accepted", label: "Accepted" }, { value: "active", label: "Active in lab" }, { value: "alumni", label: "Alumni" }, { value: "declined", label: "Not proceeding" }];
export const PROJECT_WORKFLOW_STATUSES: Option[] = [
  { label: "Done", color: "#657468" },
  { label: "Done + submitted", color: "#507ca3" },
  { label: "Done + accepted", color: "#22845b" },
  { label: "Rejected + in progress", color: "#b67a2d" },
  { label: "Rejected + resubmitted", color: "#8564ad" },
  { label: "Merged", color: "#7b718f" },
];
export const DEFAULT_OPTIONS: Record<string, Option[]> = {
  project_statuses: [{ label: "Idea", color: "#93866b" }, { label: "In Progress", color: "#148575" }, { label: "Writing", color: "#9568b0" }, ...PROJECT_WORKFLOW_STATUSES],
  student_lab_statuses: [{ label: "In Group", color: "#148575" }, { label: "Active Candidate", color: "#b88334" }, { label: "Candidate", color: "#8b93a3" }, { label: "From Another Lab", color: "#507ca3" }, { label: "Other", color: "#93866b" }],
  student_degrees: [{ label: "PhD", color: "#148575" }, { label: "MSc", color: "#507ca3" }, { label: "BSc", color: "#b88334" }, { label: "Postdoc", color: "#9568b0" }],
};
export function projectStatusValue(value?: string) {
  const trimmed = value?.trim() || "";
  const key = trimmed.toLowerCase().replace(/\s*\+\s*/g, " + ").replace(/\s+/g, " ");
  const known = [...DEFAULT_OPTIONS.project_statuses, { label: "External" }, { label: "Canceled" }, { label: "Cancelled" }, { label: "Vague Idea" }, { label: "Half Baked" }];
  return known.find(option => option.label.toLowerCase() === key)?.label || trimmed;
}
export function personStatusValue(value?: string) {
  const trimmed = value?.trim() || "";
  const aliases: Record<string, string> = { "active candidate": "Active Candidate", "project candidate": "Active Candidate", candidate: "Candidate", prospective: "Candidate", "in group": "In Group" };
  return aliases[trimmed.toLowerCase()] || trimmed;
}
export function personStatusLabel(value?: string) {
  const canonical = personStatusValue(value);
  return ({ "Active Candidate": "Project candidate", Candidate: "Prospective", "In Group": "In group" } as Record<string, string>)[canonical] || canonical;
}
export function personStatusDescription(value?: string) {
  const canonical = personStatusValue(value);
  return canonical === "Active Candidate" ? "Working on a project before admission." : canonical === "Candidate" ? "Approached, contacted, or interviewing; not yet admitted or working on a project." : "";
}
export function optionsFor(state: LabState, key: string): Option[] {
  const saved = state.settings.find(s => s.data.setting_type === key);
  const options = saved ? (saved.data.options || []) : DEFAULT_OPTIONS[key] || [];
  if (key === "project_statuses") {
    const normalized = new Map<string, Option>();
    for (const option of options) {
      const value = projectStatusValue(option.label);
      if (!normalized.has(value) || option.label === value) normalized.set(value, { ...option, label: value });
    }
    for (const required of PROJECT_WORKFLOW_STATUSES) if (!normalized.has(required.label)) normalized.set(required.label, required);
    return [...normalized.values()];
  }
  if (key !== "student_lab_statuses") return options;
  const normalized = new Map<string, Option>();
  for (const option of options) { const value = personStatusValue(option.label); if (!normalized.has(value) || option.label === value) normalized.set(value, { ...option, label: value }); }
  return [...normalized.values()];
}
export function recordName(record: LabRecord) { return record.data.name || record.data.conference_name || "Untitled"; }
export function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase(); }
export function safeUrl(value?: string) {
  if (!value) return null;
  if (/^\/api\/files\/[a-zA-Z0-9_/-]+$/.test(value)) return value;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function todayKey(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") {
  try { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); return ["year", "month", "day"].map(k => parts.find(p => p.type === k)?.value).join("-"); }
  catch { return todayKey("UTC"); }
}
export function daysUntil(data: LabData) {
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return null;
  return Math.round((Date.parse(`${data.date}T12:00:00Z`) - Date.parse(`${todayKey(data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}T12:00:00Z`)) / 86400000);
}
export function dueLabel(data: LabData) {
  const days = daysUntil(data);
  if (days === null) return data.date_status === "estimated" && data.expected_window ? "Estimated window" : "Date TBA";
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}
export function formatDate(date?: string, month: "short" | "long" = "short") {
  if (!date) return "Date TBA";
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en", { month, day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}
export function deadlineSortDate(data: LabData) { return data.date || (data.date_status === "estimated" ? data.expected_window?.start : null) || "9999-12-31"; }
export function deadlineDateLabel(data: LabData) {
  if (data.date) return `${data.date_status === "estimated" ? "≈ " : ""}${formatDate(data.date)}`;
  const w = data.date_status === "estimated" ? data.expected_window : undefined;
  if (!w) return "Date TBA";
  const month = (value: string) => new Intl.DateTimeFormat("en", {month:"short", year:"numeric", timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));
  return w.start.slice(0,7) === w.end.slice(0,7) ? `≈ ${month(w.start)}` : `≈ ${month(w.start)} – ${month(w.end)}`;
}
export function shortDeadlineName(data: LabData) {
  const original = String(data.conference_name || data.name || data.venue || "Untitled").trim();
  if (!/(?:19|20|21)\d{2}/.test(original) && !(data.venue && original.toLowerCase().startsWith(data.venue.toLowerCase()))) return original;
  const suffix = /(?:\s*[-–—:·]\s*|\s+|\s*\()(?:full[ -]paper(?:s)?(?:\s+submission)?|full\s+submission|final\s+(?:paper\s+)?submission|paper\s+(?:submission|enrollment|enrolment|registration)|abstract\s+(?:submission|registration)|submission|enrollment|enrolment|registration)(?:\s+deadline)?\)?$/i;
  const stripped = original.replace(suffix, "").replace(/[\s–—:·-]+$/, "").trim();
  if (!stripped) return original;
  return stripped.replace(/(?:\s*[-–—:·]\s*|\s+)main\s+track$/i, "").replace(/(?:\s*[-–—:·]\s*|\s+)position(?:\s+papers?)?(?:\s+track)?$/i, " · Position");
}
export function graphDeadlineDateLabel(data: LabData) {
  if (data.date_status === "tba") return "Date TBA";
  if (!data.date) return deadlineDateLabel(data);
  const date = new Date(`${data.date.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return data.date;
  const eventYear = String(data.cycle || shortDeadlineName(data)).match(/(?:19|20|21)\d{2}/)?.[0];
  const label = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", ...(eventYear === data.date.slice(0, 4) ? {} : { year: "numeric" as const }), timeZone: "UTC" }).format(date);
  return `${data.date_status === "estimated" ? "≈ " : ""}${label}`;
}
export function isComplete(status?: string) { return /^(done(?: \+ (?:submitted|accepted))?|merged|finished|completed|published|archived)$/i.test(projectStatusValue(status)); }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
let csrfToken: Promise<string> | undefined;
async function mutationToken() {
  csrfToken ??= fetch("/api/me").then(async response => {
    if (!response.ok) throw new ApiError("Sign in to save changes.", response.status);
    const session = await response.json() as { csrf_token?: string };
    if (!session.csrf_token) throw new ApiError("Refresh this page before saving changes.", 403);
    return session.csrf_token;
  }).catch(error => { csrfToken = undefined; throw error; });
  return csrfToken;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes((options.method || "GET").toUpperCase())) headers.set("X-CSRF-Token", await mutationToken());
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({})) as { error?: string | { message?: string }; message?: string };
  if (!response.ok) { if (response.status === 401 || response.status === 403) csrfToken = undefined; throw new ApiError(typeof body.error === "string" ? body.error : body.error?.message || body.message || `Request failed (${response.status})`, response.status); }
  return body as T;
}
export async function loadLab(): Promise<LabState> {
  const kinds: LabKind[] = ["project", "student", "deadline", "lab_setting", "deadline_target", "project_update"];
  const results = await Promise.all(kinds.map(async kind => {
    const records: LabRecord[] = []; let offset = 0;
    for (;;) { const page = await api<{ records: LabRecord[]; has_more?: boolean; next_offset?: number }>(`/api/records?kind=${kind}&limit=2000&offset=${offset}`); records.push(...page.records); if (!page.has_more) break; offset = page.next_offset ?? offset + page.records.length; }
    return records;
  }));
  return { projects: results[0], students: results[1], deadlines: results[2], settings: results[3], targets: results[4], updates: results[5] };
}
