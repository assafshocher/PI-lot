import type { LabData, LabRecord, LabState } from "./model";
import { isComplete, personStatusLabel, personStatusValue, projectStatusValue } from "./model";
import { deadlinePeriod } from "./default-filters";

export type GraphKind = "student" | "project" | "deadline";
export type EdgeKind = "team" | "target" | "primary";
export type Commitment = "suggested" | "tentative" | "confirmed" | "submitted";
export type GraphDensity = "compact" | "cozy";
export type GraphSort = "connections" | "deadline-date" | "person-name" | "person-status" | "project-connections";
export type GraphNode = { key: string; kind: GraphKind; record: LabRecord; name: string; degree: number; sortDate: string };
export type GraphEdge = { key: string; from: string; to: string; kind: EdgeKind; status: string; outcome?: "pending" | "accepted" | "rejected"; label: string; records: LabRecord[]; duplicateCount: number };
export type GraphIssue = { ownerKey: string; message: string; kind: "missing" | "duplicate" };
export type ResearchNetwork = { nodes: GraphNode[]; edges: GraphEdge[]; issues: GraphIssue[] };
export type GraphFilters = { degree: string[]; personStatus: string[]; projectStatus: string[]; certainty: string[]; projectLink: string[]; commitment: string[]; deadlinePeriod: string[] };
export type FilterKey = keyof GraphFilters;
export type PositionedNode = GraphNode & { x: number; y: number; width: number; height: number; column: number };
export type GraphLayout = { nodes: PositionedNode[]; edges: GraphEdge[]; width: number; height: number; columnX: number[]; nodeWidth: number; addButtonWidth: number; crossings: number };
export const COLUMN_KINDS: GraphKind[] = ["student", "project", "deadline"];
export const EMPTY_GRAPH_FILTERS: GraphFilters = { degree: [], personStatus: [], projectStatus: [], certainty: [], projectLink: [], commitment: [], deadlinePeriod: [] };
export const COMMITMENT_LABELS: Record<string, string> = { suggested: "AI recommended", tentative: "Tentative", confirmed: "Confirmed target", submitted: "Submitted", primary: "Primary field", none: "No target" };
const compare = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
export const graphKey = (kind: GraphKind, id: string) => `${kind}:${id}`;
export const graphName = (record: LabRecord) => String(record.data.name || record.data.conference_name || "Untitled");
const active = (record: LabRecord) => !record.deleted_at;
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(id);
export function projectEdgeStatus(value?: string) {
  if (/^(cancelled|canceled|abandoned|dropped)$/i.test(value?.trim() || "")) return "canceled";
  if (isComplete(value)) return "done";
  return "active";
}
export function dateCertainty(record: LabRecord) {
  if (record.data.date_status === "tba") return "tba";
  if (record.data.date_status === "estimated" && (record.data.date || record.data.expected_window)) return "estimated";
  return record.data.date ? "confirmed" : "tba";
}
export function buildResearchNetwork(state: LabState, sortDate: (data: LabData) => string = data => data.date || data.expected_window?.start || "9999-12-31"): ResearchNetwork {
  const nodes: GraphNode[] = [], issues: GraphIssue[] = [];
  const byKey = new Map<string, GraphNode>();
  for (const [kind, records] of [["student", state.students], ["project", state.projects], ["deadline", state.deadlines]] as const) {
    for (const record of [...records].filter(active).sort((a, b) => compare(a.id, b.id))) {
      if (record.kind !== kind || !validId(record.id)) continue;
      const key = graphKey(kind, record.id);
      if (!byKey.has(key)) { const node = { key, kind, record, name: graphName(record), degree: 0, sortDate: sortDate(record.data) }; nodes.push(node); byKey.set(key, node); }
    }
  }
  const edges = new Map<string, GraphEdge>(), missing = new Set<string>();
  const noteMissing = (ownerKey: string, otherKind: GraphKind, id: unknown) => {
    const key = `${ownerKey}:${otherKind}:${id}`;
    if (!missing.has(key)) { missing.add(key); issues.push({ ownerKey, kind: "missing", message: `Unavailable ${otherKind === "student" ? "person" : otherKind} reference` }); }
  };
  const addTeam = (personId: unknown, projectId: unknown, ownerKey: string) => {
    const from = graphKey("student", String(personId)), to = graphKey("project", String(projectId));
    if (!byKey.has(from) || !byKey.has(to)) { noteMissing(ownerKey, byKey.has(from) ? "project" : "student", byKey.has(from) ? projectId : personId); return; }
    const project = byKey.get(to)!.record, status = projectEdgeStatus(project.data.status), key = `team:${personId}:${projectId}`;
    edges.set(key, { key, from, to, kind: "team", status, label: `Project membership · ${projectStatusValue(project.data.status) || "status not set"}`, records: [], duplicateCount: 0 });
  };
  for (const node of nodes) {
    if (node.kind === "student") for (const id of Array.isArray(node.record.data.connected_projects) ? node.record.data.connected_projects : []) addTeam(node.record.id, id, node.key);
    if (node.kind === "project") {
      for (const id of Array.isArray(node.record.data.connected_students) ? node.record.data.connected_students : []) addTeam(id, node.record.id, node.key);
      const deadlineId = node.record.data.deadline_id;
      if (deadlineId) {
        const to = graphKey("deadline", deadlineId);
        if (byKey.has(to)) { const key = `primary:${node.record.id}:${deadlineId}`; edges.set(key, { key, from: node.key, to, kind: "primary", status: "primary", label: "Primary deadline field · commitment unspecified", records: [], duplicateCount: 0 }); }
        else noteMissing(node.key, "deadline", deadlineId);
      }
    }
  }
  const targets = new Map<string, LabRecord[]>();
  for (const target of state.targets.filter(active)) {
    const from = graphKey("project", String(target.data.project_id)), to = graphKey("deadline", String(target.data.deadline_id));
    if (!byKey.has(from) || !byKey.has(to)) { if (byKey.has(from)) noteMissing(from, "deadline", target.data.deadline_id); else if (byKey.has(to)) noteMissing(to, "project", target.data.project_id); continue; }
    const key = `target:${target.data.project_id}:${target.data.deadline_id}`;
    targets.set(key, [...targets.get(key) || [], target]);
  }
  for (const [key, records] of targets) {
    const sorted = records.sort((a, b) => compare(b.updated_at || "", a.updated_at || "") || b.revision - a.revision || compare(a.id, b.id));
    const latest = sorted[0], status = ["suggested", "tentative", "confirmed", "submitted"].includes(latest.data.status || "") ? latest.data.status! : "unknown";
    const from = graphKey("project", String(latest.data.project_id)), to = graphKey("deadline", String(latest.data.deadline_id));
    const outcome = status === "submitted" ? latest.data.outcome : undefined;
    const label = status === "submitted" ? outcome === "rejected" ? "Rejected from" : outcome === "accepted" ? "Accepted at" : outcome === "pending" ? "Submitted · awaiting decision" : "Submitted · decision not recorded" : COMMITMENT_LABELS[status] || "Commitment not set";
    edges.set(key, { key, from, to, kind: "target", status, outcome, label, records: sorted, duplicateCount: records.length - 1 });
    if (records.length > 1) issues.push({ ownerKey: from, kind: "duplicate", message: `${records.length} target records for ${byKey.get(to)!.name}; latest shown` });
  }
  const edgeList = [...edges.values()].sort((a, b) => compare(a.key, b.key)), neighbors = new Map<string, Set<string>>();
  for (const edge of edgeList) { if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set()); if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set()); neighbors.get(edge.from)!.add(edge.to); neighbors.get(edge.to)!.add(edge.from); }
  for (const node of nodes) node.degree = neighbors.get(node.key)?.size || 0;
  return { nodes, edges: edgeList, issues };
}
export function facetValues(node: GraphNode, key: FilterKey, network: ResearchNetwork): string[] {
  const d = node.record.data;
  if (key === "degree") return node.kind === "student" ? [String(d.degree || "")] : [];
  if (key === "personStatus") return node.kind === "student" ? [personStatusValue(d.lab_status)] : [];
  if (key === "projectStatus") return node.kind === "project" ? [projectStatusValue(d.status) || "Unspecified"] : [];
  if (key === "certainty") return node.kind === "deadline" ? [dateCertainty(node.record)] : [];
  if (key === "projectLink") return node.kind === "deadline" ? [node.degree ? "linked" : "unlinked"] : [];
  if (key === "deadlinePeriod" && node.kind === "deadline") return [deadlinePeriod(d, network.edges.some(edge => edge.to === node.key && edge.kind === "target" && edge.status === "submitted"))];
  if (key === "commitment" && node.kind === "deadline") {
    const statuses = network.edges.filter(e => e.to === node.key && e.kind !== "team").map(e => e.status);
    return statuses.length ? [...new Set(statuses)] : ["none"];
  }
  return [];
}
const kindFacets: Record<GraphKind, FilterKey[]> = { student: ["degree", "personStatus"], project: ["projectStatus"], deadline: ["certainty", "projectLink", "commitment", "deadlinePeriod"] };
export function matchesGraphFilters(node: GraphNode, filters: GraphFilters, network: ResearchNetwork, omit?: FilterKey) {
  return kindFacets[node.kind].every(key => key === omit || !filters[key].length || facetValues(node, key, network).some(value => filters[key].includes(value)));
}
export function graphFacetOptions(network: ResearchNetwork, filters: GraphFilters, key: FilterKey) {
  const values = new Map<string, number>();
  for (const node of network.nodes) for (const value of facetValues(node, key, network)) {
    if (!values.has(value)) values.set(value, 0);
    if (matchesGraphFilters(node, filters, network, key)) values.set(value, values.get(value)! + 1);
  }
  for (const value of filters[key]) if (!values.has(value)) values.set(value, 0);
  return [...values].sort(([a], [b]) => compare(a || "~", b || "~")).map(([value, count]) => ({ value, count }));
}
export function filterResearchNetwork(network: ResearchNetwork, filters: GraphFilters, query = "", showIsolated = true) {
  const allowed = network.nodes.filter(n => matchesGraphFilters(n, filters, network)), allowedKeys = new Set(allowed.map(n => n.key));
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = new Set(allowed.filter(n => { const d = n.record.data; const text = [n.name, d.details, d.notes, d.status, d.lab_status, personStatusLabel(d.lab_status), d.degree, d.stage, d.next_action, d.date].filter(Boolean).join(" ").toLocaleLowerCase(); return tokens.every(t => text.includes(t)); }).map(n => n.key));
  const included = new Set(matches);
  if (tokens.length) for (const e of network.edges) { if (matches.has(e.from) && allowedKeys.has(e.to)) included.add(e.to); if (matches.has(e.to) && allowedKeys.has(e.from)) included.add(e.from); }
  const edges = network.edges.filter(e => included.has(e.from) && included.has(e.to));
  const connected = new Set(edges.flatMap(e => [e.from, e.to]));
  return { nodes: allowed.filter(n => included.has(n.key) && (showIsolated || connected.has(n.key))), edges, issues: network.issues, matches, contextCount: tokens.length ? [...included].filter(k => !matches.has(k)).length : 0 };
}
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b), half = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2; }
export function countGraphCrossings(columns: GraphNode[][], edges: GraphEdge[]) {
  const positions = new Map(columns.flatMap((column, c) => column.map((node, i) => [node.key, { c, i }] as const)));
  let count = 0;
  for (const c of [0, 1]) {
    const unique = new Map<string, [number, number]>();
    for (const edge of edges) { const a = positions.get(edge.from), b = positions.get(edge.to); if (a?.c === c && b?.c === c + 1) unique.set(`${edge.from}>${edge.to}`, [a.i, b.i]); }
    const pairs = [...unique.values()];
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) count++;
  }
  return count;
}
function priority(a: GraphNode, b: GraphNode, sort: GraphSort) {
  if (sort === "person-name" && a.kind === "student") return compare(a.name, b.name);
  if (sort === "person-status" && a.kind === "student") return compare(personStatusLabel(a.record.data.lab_status) || "~", personStatusLabel(b.record.data.lab_status) || "~");
  if (sort === "deadline-date" && a.kind === "deadline") return compare(dateCertainty(a.record) !== "tba" ? a.sortDate : "9999-12-31", dateCertainty(b.record) !== "tba" ? b.sortDate : "9999-12-31");
  if (sort === "project-connections" && a.kind === "project") return b.degree - a.degree;
  return 0;
}
export function orderResearchGraph(network: ResearchNetwork, sort: GraphSort = "connections") {
  let columns = COLUMN_KINDS.map(kind => network.nodes.filter(n => n.kind === kind).sort((a, b) => priority(a, b, sort) || Number(b.degree > 0) - Number(a.degree > 0) || compare(a.name, b.name) || compare(a.key, b.key)));
  const neighbors = new Map<string, Set<string>>();
  for (const edge of network.edges) { if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set()); if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set()); neighbors.get(edge.from)!.add(edge.to); neighbors.get(edge.to)!.add(edge.from); }
  let best = columns.map(c => [...c]), score = countGraphCrossings(best, network.edges);
  for (let pass = 0; pass < 8; pass++) {
    for (const index of pass % 2 ? [2, 1, 0] : [0, 1, 2]) {
      const positions = new Map(columns.flatMap(column => column.map((n, i) => [n.key, (i + .5) / Math.max(column.length, 1)] as const)));
      const center = (n: GraphNode) => { const values = [...neighbors.get(n.key) || []].map(key => positions.get(key)).filter((v): v is number => v !== undefined); return values.length ? median(values) : 2; };
      columns = columns.map((column, i) => i !== index ? column : [...column].sort((a, b) => priority(a, b, sort) || center(a) - center(b) || compare(a.name, b.name) || compare(a.key, b.key)));
    }
    const next = countGraphCrossings(columns, network.edges);
    if (next < score) { score = next; best = columns.map(c => [...c]); }
  }
  return { columns: best, crossings: score };
}
export function graphScale(viewportWidth: number, zoom: string, canvasWidth = 1120) {
  const touch = viewportWidth < 620;
  const requested = zoom === "fit" ? touch ? 1 : Math.max(.85, Math.min(1, viewportWidth / canvasWidth)) : Number(zoom);
  const scale = Number.isFinite(requested) && requested > 0 ? requested : 1;
  return touch ? Math.max(1, scale) : scale;
}
export function layoutResearchGraph(network: ResearchNetwork, sort: GraphSort, density: GraphDensity, viewportWidth = 1120): GraphLayout {
  const { columns, crossings } = orderResearchGraph(network, sort), touch = viewportWidth < 620, width = Math.max(1120, viewportWidth), nodeWidth = (width - 160) / 3;
  const nodeHeight = density === "compact" ? touch ? 44 : 28 : 62;
  const gap = density === "compact" ? 8 : 12, addButtonWidth = touch ? 44 : density === "compact" ? 28 : 30;
  const count = Math.max(1, ...columns.map(c => c.length)), step = nodeHeight + gap, top = 76, bottom = top + (count - 1) * step, columnX = [20, 20 + nodeWidth + 60, 20 + 2 * (nodeWidth + 60)];
  const positions = new Map<string, number>();
  columns[1].forEach((n, i) => positions.set(n.key, top + i * step));
  const arrange = (column: GraphNode[]) => {
    const desired = column.map((n, i) => { const related = network.edges.filter(e => e.from === n.key || e.to === n.key).map(e => positions.get(e.from === n.key ? e.to : e.from)).filter((v): v is number => v !== undefined); return related.length ? median(related) : top + (count - column.length + i) * step; });
    const ys: number[] = [];
    desired.forEach((value, i) => ys.push(Math.max(top, value, i ? ys[i - 1] + step : top)));
    if (ys.length && ys.at(-1)! > bottom) { ys[ys.length - 1] = bottom; for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - step); }
    column.forEach((node, i) => positions.set(node.key, ys[i]));
  };
  arrange(columns[0]); arrange(columns[2]);
  const nodes = columns.flatMap((column, c) => column.map(n => ({ ...n, x: columnX[c], y: positions.get(n.key) ?? top, width: nodeWidth, height: nodeHeight, column: c })));
  return { nodes, edges: network.edges, width, height: bottom + nodeHeight + 30, columnX, nodeWidth, addButtonWidth, crossings };
}
export function graphEdgeStatus(edge: GraphEdge) {
  return edge.kind === "primary" ? "primary" : edge.kind === "target" && edge.status === "submitted" && (edge.outcome === "rejected" || edge.outcome === "accepted") ? edge.outcome : edge.status;
}
export function graphEdgePath(from: PositionedNode, to: PositionedNode, offset = 0) {
  const x1 = from.x + from.width, y1 = from.y + from.height / 2 + offset, x2 = to.x, y2 = to.y + to.height / 2 + offset;
  const bend = Math.max(0, Math.min(80, (x2 - x1) / 2));
  return `M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
export function relationPair(source: GraphNode, other: GraphNode, relation: "team" | "target") {
  if (source.key === other.key || !validId(source.record.id) || !validId(other.record.id) || !active(source.record) || !active(other.record)) return null;
  const project = source.kind === "project" ? source : other.kind === "project" ? other : null;
  const opposite = project?.key === source.key ? other : source;
  if (!project || opposite.kind !== (relation === "team" ? "student" : "deadline")) return null;
  return relation === "team" ? { project_id: project.record.id, student_id: opposite.record.id } : { project_id: project.record.id, deadline_id: opposite.record.id };
}
export function existingGraphRelation(network: ResearchNetwork, source: GraphNode, other: GraphNode, relation: "team" | "target") {
  if (!relationPair(source, other, relation)) return false;
  return network.edges.some(e => ((e.from === source.key && e.to === other.key) || (e.to === source.key && e.from === other.key)) && (relation === "team" ? e.kind === "team" : e.kind === "target" || e.kind === "primary"));
}
