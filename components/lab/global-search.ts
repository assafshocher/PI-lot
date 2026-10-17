import { deadlineDateLabel, personStatusLabel, personStatusValue, projectStatusValue, recordName, type LabRecord, type LabState } from "./model";

export type SearchKind = "student" | "project" | "deadline";
export type SearchResult = { record: LabRecord; title: string; subtitle: string; matchedInNotes: boolean };
export type SearchGroup = { kind: SearchKind; label: string; results: SearchResult[] };

type IndexedRecord = SearchResult & { kind: SearchKind; nameText: string; searchText: string };
export function normalizeSearch(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}
export function buildSearchIndex(state: LabState): IndexedRecord[] {
  const entries: IndexedRecord[] = [];
  const seen = new Set<string>();
  for (const record of [...state.students, ...state.projects, ...state.deadlines]) {
    if (record.deleted_at || !["student", "project", "deadline"].includes(record.kind)) continue;
    const key = `${record.kind}:${record.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const data = record.data, title = recordName(record), kind = record.kind as SearchKind;
    const subtitle = kind === "student" ? [data.degree, personStatusLabel(data.lab_status)].filter(Boolean).join(" · ") : kind === "project" ? projectStatusValue(data.status) || "Status not set" : [data.deadline_type === "abstract" ? "Abstract" : data.deadline_type === "other" ? "Milestone" : "Full paper", deadlineDateLabel(data)].join(" · ");
    const aliases = kind === "deadline" ? [data.venue, data.cycle, ...(data.topics || [])] : kind === "student" ? [data.email, data.degree, personStatusLabel(data.lab_status), personStatusValue(data.lab_status), data.lab_status] : [projectStatusValue(data.status), data.status];
    const nameText = normalizeSearch(title);
    const searchText = normalizeSearch([title, ...aliases, data.title, data.details, typeof data.description === "string" ? data.description : "", data.summary, data.notes, data.next_action, ...(data.links || []).map(link => link.label || link.name || "")].filter(Boolean).join(" "));
    entries.push({ record, kind, title, subtitle, matchedInNotes: false, nameText, searchText });
  }
  return entries;
}
export function searchLab(index: IndexedRecord[], query: string): SearchGroup[] {
  const normalized = normalizeSearch(query);
  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const matches = index.filter(entry => tokens.every(token => entry.searchText.includes(token))).map(entry => {
    const nameMatch = tokens.every(token => entry.nameText.includes(token));
    const rank = entry.nameText === normalized ? 0 : entry.nameText.startsWith(normalized) ? 1 : nameMatch ? 2 : 3;
    return { ...entry, matchedInNotes: !nameMatch, rank };
  }).sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title) || a.record.id.localeCompare(b.record.id));
  return ([{ kind: "student", label: "People" }, { kind: "project", label: "Projects" }, { kind: "deadline", label: "Deadlines" }] as const).map(group => ({ ...group, results: matches.filter(result => result.kind === group.kind) })).filter(group => group.results.length > 0);
}
